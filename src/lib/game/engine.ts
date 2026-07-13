import { EventEmitter } from "node:events";
import {
  calculatePausePenalty,
  calculateWordPoints,
  isValidWordShape,
  normalizeTurkishWord,
  PAUSE_LIMIT_MS,
  RECONNECT_GRACE_MS,
  requiredLetter,
  TURN_LIMITS,
} from "./rules";
import type {
  AcceptedWord,
  CommandResult,
  Difficulty,
  EndReason,
  GameMode,
  GameSnapshot,
  GameStatus,
  PlayerIdentity,
  PlayerState,
} from "./types";

export type WordValidator = (word: string) => Promise<"valid" | "invalid" | "unavailable">;

export class GameEngine extends EventEmitter {
  readonly id: string;
  readonly roomCode?: string;
  readonly mode: GameMode;
  readonly difficulty: Difficulty;
  readonly hostKey: string;

  private players: PlayerState[] = [];
  private words: AcceptedWord[] = [];
  private status: GameStatus = "waiting";
  private activeIndex = 0;
  private deadline: number | null = null;
  private pauseDeadline: number | null = null;
  private reconnectDeadline: number | null = null;
  private winnerKey: string | null = null;
  private endReason: EndReason | null = null;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private remainingBeforeInterruption = 0;
  private pausedAt = 0;
  private pausedBy: string | null = null;
  private reconnectUsed = new Set<string>();
  private commandLocked = false;
  private commandIds = new Set<string>();

  constructor(input: {
    id: string;
    roomCode?: string;
    mode: GameMode;
    difficulty: Difficulty;
    host: PlayerIdentity;
  }) {
    super();
    this.id = input.id;
    this.roomCode = input.roomCode;
    this.mode = input.mode;
    this.difficulty = input.difficulty;
    this.hostKey = input.host.playerKey;
    this.addPlayer(input.host);
  }

  static restore(snapshot: GameSnapshot): GameEngine {
    if (!snapshot.players.length) throw new Error("Cannot restore a game without players");
    const game = new GameEngine({
      id: snapshot.id,
      roomCode: snapshot.roomCode,
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      host: snapshot.players[0],
    });
    game.players = snapshot.players.map((player) => ({ ...player, connected: false }));
    game.words = snapshot.words.map((word) => ({ ...word }));
    game.status = snapshot.status;
    game.activeIndex = Math.max(
      0,
      game.players.findIndex((player) => player.playerKey === snapshot.activePlayerKey),
    );
    game.deadline = snapshot.deadline;
    game.pauseDeadline = snapshot.pauseDeadline;
    game.reconnectDeadline = snapshot.reconnectDeadline;
    game.winnerKey = snapshot.winnerKey;
    game.endReason = snapshot.endReason;
    game.startedAt = snapshot.startedAt;
    game.endedAt = snapshot.endedAt;
    game.pausedBy = snapshot.pausedByKey;
    game.pausedAt = snapshot.pausedAt ?? 0;
    game.remainingBeforeInterruption = snapshot.remainingTurnMs;
    return game;
  }

  resumeClock(): void {
    if (this.status === "playing" && this.deadline) {
      this.armTurnTimer(Math.max(0, this.deadline - Date.now()));
    } else if (this.status === "paused" && this.pauseDeadline && this.pausedBy) {
      this.timer = setTimeout(
        () => this.resumePause(this.pausedBy!),
        Math.max(0, this.pauseDeadline - Date.now()),
      );
    } else if (this.status === "reconnecting" && this.reconnectDeadline) {
      this.timer = setTimeout(
        () => {
          const disconnected = this.players.find((player) => !player.connected);
          if (disconnected)
            this.finish(this.opponentOf(disconnected.playerKey)?.playerKey ?? null, "disconnect");
        },
        Math.max(0, this.reconnectDeadline - Date.now()),
      );
    }
  }

  addPlayer(identity: PlayerIdentity): CommandResult {
    if (this.status !== "waiting") return this.fail("Oyun zaten başladı.");
    if (this.players.some((player) => player.playerKey === identity.playerKey)) {
      return { ok: true, snapshot: this.snapshot() };
    }
    if ((this.mode === "solo" && this.players.length >= 1) || this.players.length >= 2) {
      return this.fail("Oda dolu.");
    }
    this.players.push({
      ...identity,
      score: 0,
      pauseUsed: false,
      pauseSeconds: 0,
      connected: true,
    });
    this.changed();
    return { ok: true, snapshot: this.snapshot() };
  }

  start(playerKey: string): CommandResult {
    if (playerKey !== this.hostKey) return this.fail("Oyunu yalnızca oda sahibi başlatabilir.");
    if (this.status !== "waiting") return this.fail("Oyun zaten başladı.");
    if (this.mode === "multiplayer" && this.players.length !== 2) {
      return this.fail("Başlamak için ikinci oyuncu bekleniyor.");
    }
    this.status = "playing";
    this.startedAt = Date.now();
    this.activeIndex = 0;
    this.beginTurn();
    this.changed();
    return { ok: true, snapshot: this.snapshot() };
  }

  async submitWord(
    playerKey: string,
    rawWord: string,
    commandId: string,
    validator: WordValidator,
  ): Promise<CommandResult> {
    if (this.commandIds.has(commandId)) return { ok: true, snapshot: this.snapshot() };
    if (this.status !== "playing") return this.fail("Oyun şu anda kelime kabul etmiyor.");
    if (this.activePlayer()?.playerKey !== playerKey) return this.fail("Sıra diğer oyuncuda.");
    if (this.commandLocked) return this.fail("Önceki kelime hâlâ kontrol ediliyor.");

    const word = normalizeTurkishWord(rawWord);
    if (!isValidWordShape(word))
      return this.fail("En az iki Türkçe harften oluşan bir kelime girin.");
    if (this.words.some((entry) => entry.word === word))
      return this.fail("Bu kelime daha önce kullanıldı.");
    const expected = this.requiredLetter();
    if (expected && Array.from(word)[0] !== expected) {
      return this.fail(`Kelime “${expected.toLocaleUpperCase("tr-TR")}” harfiyle başlamalı.`);
    }

    this.commandLocked = true;
    const validation = await validator(word);
    this.commandLocked = false;
    if (this.status !== "playing" || this.activePlayer()?.playerKey !== playerKey) {
      return this.fail("Kelime kontrol edilirken tur sona erdi.");
    }
    if (validation === "unavailable")
      return this.fail("Sözlük servisine ulaşılamıyor; lütfen tekrar deneyin.");
    if (validation === "invalid") return this.fail("Bu kelime TDK sözlüğünde bulunamadı.");

    const remainingMs = Math.max(0, (this.deadline ?? Date.now()) - Date.now());
    if (remainingMs <= 0) {
      this.finishByTimeout();
      return this.fail("Süre doldu.");
    }
    const points = calculateWordPoints(this.difficulty, remainingMs);
    const entry: AcceptedWord = {
      word,
      playerKey,
      points,
      turnNumber: this.words.length + 1,
      remainingMs,
    };
    this.words.push(entry);
    this.activePlayer()!.score += points;
    this.commandIds.add(commandId);
    if (this.mode === "multiplayer")
      this.activeIndex = (this.activeIndex + 1) % this.players.length;
    this.beginTurn();
    this.emit("word", entry, this.snapshot());
    this.changed();
    return { ok: true, snapshot: this.snapshot() };
  }

  pause(playerKey: string): CommandResult {
    if (this.status !== "playing") return this.fail("Oyun şu anda duraklatılamaz.");
    const player = this.activePlayer();
    if (!player || player.playerKey !== playerKey)
      return this.fail("Yalnızca sırası gelen oyuncu duraklatabilir.");
    if (player.pauseUsed) return this.fail("Bu oyundaki duraklatma hakkınızı kullandınız.");
    player.pauseUsed = true;
    this.remainingBeforeInterruption = Math.max(0, (this.deadline ?? Date.now()) - Date.now());
    this.clearTimer();
    this.status = "paused";
    this.pausedAt = Date.now();
    this.pausedBy = playerKey;
    this.pauseDeadline = this.pausedAt + PAUSE_LIMIT_MS;
    this.timer = setTimeout(() => this.resumePause(playerKey), PAUSE_LIMIT_MS);
    this.changed();
    return { ok: true, snapshot: this.snapshot() };
  }

  resumePause(playerKey: string): CommandResult {
    if (this.status !== "paused" || this.pausedBy !== playerKey) {
      return this.fail("Aktif bir duraklatmanız yok.");
    }
    this.clearTimer();
    const player = this.players.find((candidate) => candidate.playerKey === playerKey)!;
    const penalty = calculatePausePenalty(Date.now() - this.pausedAt);
    player.pauseSeconds = penalty.seconds;
    player.score = Math.max(0, player.score - penalty.points);
    this.status = "playing";
    this.pauseDeadline = null;
    this.pausedBy = null;
    this.deadline = Date.now() + this.remainingBeforeInterruption;
    this.armTurnTimer(this.remainingBeforeInterruption);
    this.changed();
    return { ok: true, snapshot: this.snapshot() };
  }

  disconnect(playerKey: string): void {
    const player = this.players.find((candidate) => candidate.playerKey === playerKey);
    if (!player) return;
    player.connected = false;
    if (this.status === "waiting") {
      this.changed();
      return;
    }
    if (this.status === "ended") return;
    if (this.status === "paused" && this.pausedBy) {
      const pausedPlayer = this.players.find((candidate) => candidate.playerKey === this.pausedBy);
      if (pausedPlayer) {
        const penalty = calculatePausePenalty(Date.now() - this.pausedAt);
        pausedPlayer.pauseSeconds = penalty.seconds;
        pausedPlayer.score = Math.max(0, pausedPlayer.score - penalty.points);
      }
      this.pausedBy = null;
    }
    if (this.reconnectUsed.has(playerKey)) {
      this.finish(this.opponentOf(playerKey)?.playerKey ?? null, "disconnect");
      return;
    }
    this.reconnectUsed.add(playerKey);
    this.remainingBeforeInterruption =
      this.status === "playing"
        ? Math.max(0, (this.deadline ?? Date.now()) - Date.now())
        : this.remainingBeforeInterruption;
    this.clearTimer();
    this.status = "reconnecting";
    this.pauseDeadline = null;
    this.reconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
    this.timer = setTimeout(() => {
      if (!player.connected)
        this.finish(this.opponentOf(playerKey)?.playerKey ?? null, "disconnect");
    }, RECONNECT_GRACE_MS);
    this.changed();
  }

  reconnect(playerKey: string): CommandResult {
    const player = this.players.find((candidate) => candidate.playerKey === playerKey);
    if (!player) return this.fail("Bu oyunda oyuncu kaydınız yok.");
    player.connected = true;
    if (this.status === "reconnecting") {
      this.clearTimer();
      this.reconnectDeadline = null;
      this.status = "playing";
      this.deadline = Date.now() + this.remainingBeforeInterruption;
      this.armTurnTimer(this.remainingBeforeInterruption);
    }
    this.changed();
    return { ok: true, snapshot: this.snapshot() };
  }

  forfeit(playerKey: string): CommandResult {
    if (this.status === "ended") return this.fail("Oyun zaten bitti.");
    this.finish(this.opponentOf(playerKey)?.playerKey ?? null, "forfeit");
    return { ok: true, snapshot: this.snapshot() };
  }

  snapshot(): GameSnapshot {
    return {
      id: this.id,
      roomCode: this.roomCode,
      mode: this.mode,
      difficulty: this.difficulty,
      status: this.status,
      players: this.players.map((player) => ({ ...player })),
      activePlayerKey: this.status === "ended" ? null : (this.activePlayer()?.playerKey ?? null),
      requiredLetter: this.requiredLetter(),
      words: this.words.map((word) => ({ ...word })),
      deadline: this.deadline,
      pauseDeadline: this.pauseDeadline,
      reconnectDeadline: this.reconnectDeadline,
      winnerKey: this.winnerKey,
      endReason: this.endReason,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      pausedByKey: this.pausedBy,
      pausedAt: this.pausedAt || null,
      remainingTurnMs: this.remainingBeforeInterruption,
    };
  }

  private requiredLetter(): string | null {
    return this.words.length ? requiredLetter(this.words.at(-1)!.word) : null;
  }

  private activePlayer(): PlayerState | undefined {
    return this.players[this.activeIndex];
  }

  private opponentOf(playerKey: string): PlayerState | undefined {
    return this.players.find((player) => player.playerKey !== playerKey);
  }

  private beginTurn(): void {
    const duration = TURN_LIMITS[this.difficulty];
    this.deadline = Date.now() + duration;
    this.armTurnTimer(duration);
  }

  private armTurnTimer(duration: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.finishByTimeout(), Math.max(0, duration));
  }

  private finishByTimeout(): void {
    const loser = this.activePlayer();
    const winner =
      this.mode === "multiplayer" && loser ? this.opponentOf(loser.playerKey) : undefined;
    this.finish(winner?.playerKey ?? null, "timeout");
  }

  private finish(winnerKey: string | null, reason: EndReason): void {
    this.clearTimer();
    this.status = "ended";
    this.deadline = null;
    this.pauseDeadline = null;
    this.reconnectDeadline = null;
    this.winnerKey = winnerKey;
    this.endReason = reason;
    this.endedAt = Date.now();
    this.changed();
    this.emit("ended", this.snapshot());
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private changed(): void {
    this.emit("changed", this.snapshot());
  }

  private fail(message: string): CommandResult {
    return { ok: false, message, snapshot: this.snapshot() };
  }
}
