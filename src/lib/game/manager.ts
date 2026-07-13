import { randomBytes, randomUUID } from "node:crypto";
import { GameEngine } from "./engine";
import type { Difficulty, PlayerIdentity } from "./types";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class GameManager {
  private games = new Map<string, GameEngine>();
  private rooms = new Map<string, string>();

  createSolo(host: PlayerIdentity, difficulty: Difficulty): GameEngine {
    const game = new GameEngine({ id: randomUUID(), mode: "solo", difficulty, host });
    this.games.set(game.id, game);
    game.start(host.playerKey);
    return game;
  }

  createRoom(host: PlayerIdentity, difficulty: Difficulty): GameEngine {
    const roomCode = this.uniqueRoomCode();
    const game = new GameEngine({
      id: randomUUID(),
      roomCode,
      mode: "multiplayer",
      difficulty,
      host,
    });
    this.games.set(game.id, game);
    this.rooms.set(roomCode, game.id);
    return game;
  }

  joinRoom(roomCode: string, player: PlayerIdentity) {
    const game = this.byRoom(roomCode);
    if (!game) return { ok: false as const, message: "Oda bulunamadı." };
    return game.addPlayer(player);
  }

  get(id: string): GameEngine | undefined {
    return this.games.get(id);
  }

  restore(snapshot: import("./types").GameSnapshot): GameEngine {
    const existing = this.games.get(snapshot.id);
    if (existing) return existing;
    const game = GameEngine.restore(snapshot);
    this.games.set(game.id, game);
    if (game.roomCode) this.rooms.set(game.roomCode, game.id);
    return game;
  }

  byRoom(roomCode: string): GameEngine | undefined {
    const id = this.rooms.get(roomCode.trim().toUpperCase());
    return id ? this.games.get(id) : undefined;
  }

  private uniqueRoomCode(): string {
    let result = "";
    do {
      const bytes = randomBytes(6);
      result = Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
    } while (this.rooms.has(result));
    return result;
  }
}

export const gameManager = new GameManager();
