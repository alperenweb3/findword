import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { gameManager } from "./src/lib/game/manager";
import type { GameEngine } from "./src/lib/game/engine";
import type { Difficulty, PlayerIdentity } from "./src/lib/game/types";
import { validateWithTdk } from "./src/lib/dictionary";
import { verifyRealtimeToken } from "./src/lib/realtime-token";
import { persistSnapshot, persistWord } from "./src/lib/game/persistence";
import { prisma } from "./src/lib/db";
import type { GameSnapshot } from "./src/lib/game/types";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const difficultySchema = z.enum(["easy", "medium", "hard"]);
const wiredGames = new Set<string>();
const persistenceQueues = new Map<string, Promise<void>>();

async function main() {
  await app.prepare();
  const httpServer = createServer((request, response) => handle(request, response));
  const io = new Server(httpServer, { cors: { origin: dev ? true : false, credentials: true } });

  function persistInOrder(gameId: string, task: () => Promise<void>): Promise<void> {
    const previous = persistenceQueues.get(gameId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    persistenceQueues.set(gameId, next);
    return next;
  }

  function wireGame(game: GameEngine) {
    if (wiredGames.has(game.id)) return;
    wiredGames.add(game.id);
    game.on("changed", (snapshot) => {
      io.to(game.id).emit("game:state", snapshot);
      void persistInOrder(game.id, () => persistSnapshot(snapshot)).catch(console.error);
    });
    game.on(
      "word",
      (entry, snapshot) =>
        void persistInOrder(game.id, () => persistWord(snapshot, entry)).catch(console.error),
    );
  }

  const recoverableGames = await prisma.game.findMany({
    where: { status: { not: "ENDED" }, state: { not: Prisma.JsonNull } },
    select: { state: true },
  });
  for (const record of recoverableGames) {
    if (!record.state || typeof record.state !== "object" || Array.isArray(record.state)) continue;
    const game = gameManager.restore(record.state as unknown as GameSnapshot);
    wireGame(game);
    game.resumeClock();
  }

  io.use(async (socket, nextMiddleware) => {
    try {
      const token = z.string().min(20).parse(socket.handshake.auth.token);
      socket.data.identity = await verifyRealtimeToken(token);
      nextMiddleware();
    } catch {
      nextMiddleware(new Error("Oturum doğrulanamadı."));
    }
  });

  io.on("connection", (socket) => {
    const identity = socket.data.identity as PlayerIdentity;
    let submitWindow = { startedAt: Date.now(), count: 0 };
    const ack = (callback: unknown, result: unknown) => {
      if (typeof callback === "function") callback(result);
    };
    const attach = async (game: GameEngine) => {
      wireGame(game);
      socket.join(game.id);
      socket.data.gameId = game.id;
      await persistInOrder(game.id, () => persistSnapshot(game.snapshot()));
      game.reconnect(identity.playerKey);
      return game.snapshot();
    };

    socket.on("game:createSolo", async (payload, callback) => {
      const parsed = difficultySchema.safeParse(payload?.difficulty);
      if (!parsed.success) return ack(callback, { ok: false, message: "Geçersiz zorluk." });
      const game = gameManager.createSolo(identity, parsed.data as Difficulty);
      ack(callback, { ok: true, snapshot: await attach(game) });
    });

    socket.on("room:create", async (payload, callback) => {
      const parsed = difficultySchema.safeParse(payload?.difficulty);
      if (!parsed.success) return ack(callback, { ok: false, message: "Geçersiz zorluk." });
      const game = gameManager.createRoom(identity, parsed.data as Difficulty);
      ack(callback, { ok: true, snapshot: await attach(game) });
    });

    socket.on("room:join", async (payload, callback) => {
      const roomCode = z.string().trim().length(6).safeParse(payload?.roomCode);
      if (!roomCode.success)
        return ack(callback, { ok: false, message: "Geçerli bir oda kodu girin." });
      const result = gameManager.joinRoom(roomCode.data, identity);
      if (!result.ok) return ack(callback, result);
      const game = gameManager.byRoom(roomCode.data)!;
      ack(callback, { ok: true, snapshot: await attach(game) });
    });

    socket.on("game:reconnect", async (payload, callback) => {
      const id = z.string().uuid().safeParse(payload?.gameId);
      const game = id.success ? gameManager.get(id.data) : undefined;
      if (!game) return ack(callback, { ok: false, message: "Oyun artık aktif değil." });
      const result = game.reconnect(identity.playerKey);
      if (!result.ok) return ack(callback, result);
      ack(callback, { ok: true, snapshot: await attach(game) });
    });

    socket.on("game:start", (payload, callback) => {
      const game = gameManager.get(socket.data.gameId);
      ack(callback, game?.start(identity.playerKey) ?? { ok: false, message: "Oyun bulunamadı." });
    });

    socket.on("word:submit", async (payload, callback) => {
      const now = Date.now();
      if (now - submitWindow.startedAt > 10_000) submitWindow = { startedAt: now, count: 0 };
      if (++submitWindow.count > 12)
        return ack(callback, { ok: false, message: "Çok hızlı deniyorsunuz." });
      const parsed = z
        .object({ word: z.string().max(60), commandId: z.string().uuid() })
        .safeParse(payload);
      const game = gameManager.get(socket.data.gameId);
      if (!parsed.success || !game) return ack(callback, { ok: false, message: "Geçersiz istek." });
      ack(
        callback,
        await game.submitWord(
          identity.playerKey,
          parsed.data.word,
          parsed.data.commandId,
          validateWithTdk,
        ),
      );
    });

    socket.on("pause:start", (_payload, callback) => {
      const game = gameManager.get(socket.data.gameId);
      ack(callback, game?.pause(identity.playerKey) ?? { ok: false, message: "Oyun bulunamadı." });
    });
    socket.on("pause:resume", (_payload, callback) => {
      const game = gameManager.get(socket.data.gameId);
      ack(
        callback,
        game?.resumePause(identity.playerKey) ?? { ok: false, message: "Oyun bulunamadı." },
      );
    });
    socket.on("game:forfeit", (_payload, callback) => {
      const game = gameManager.get(socket.data.gameId);
      ack(
        callback,
        game?.forfeit(identity.playerKey) ?? { ok: false, message: "Oyun bulunamadı." },
      );
    });
    socket.on("disconnect", () =>
      gameManager.get(socket.data.gameId)?.disconnect(identity.playerKey),
    );
  });

  httpServer.listen(port, hostname, () => console.log(`Kelime Oyunu http://${hostname}:${port}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
