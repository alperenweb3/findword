import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "./engine";

const host = { playerKey: "host", userId: "u1", displayName: "Ada" };
const guest = { playerKey: "guest", userId: null, displayName: "Efe" };
const valid = async () => "valid" as const;

afterEach(() => vi.useRealTimers());

describe("GameEngine", () => {
  it("runs a solo chain and prevents duplicate words", async () => {
    const game = new GameEngine({ id: "game", mode: "solo", difficulty: "easy", host });
    expect(game.start(host.playerKey).ok).toBe(true);
    expect((await game.submitWord("host", "Arı", crypto.randomUUID(), valid)).ok).toBe(true);
    expect((await game.submitWord("host", "Rüya", crypto.randomUUID(), valid)).ok).toBe(true);
    const duplicate = await game.submitWord("host", "Arı", crypto.randomUUID(), valid);
    expect(duplicate.ok).toBe(false);
    expect(game.snapshot().players[0].score).toBeGreaterThan(0);
    game.forfeit("host");
  });

  it("alternates players after every multiplayer word", async () => {
    const game = new GameEngine({
      id: "game",
      roomCode: "ABC123",
      mode: "multiplayer",
      difficulty: "medium",
      host,
    });
    game.addPlayer(guest);
    game.start(host.playerKey);
    await game.submitWord("host", "kalem", crypto.randomUUID(), valid);
    expect(game.snapshot().activePlayerKey).toBe("guest");
    const wrongTurn = await game.submitWord("host", "armut", crypto.randomUUID(), valid);
    expect(wrongTurn.ok).toBe(false);
    game.forfeit("host");
  });

  it("allows one pause and applies elapsed penalty", () => {
    vi.useFakeTimers();
    const game = new GameEngine({ id: "game", mode: "solo", difficulty: "easy", host });
    game.start(host.playerKey);
    expect(game.pause("host").ok).toBe(true);
    vi.advanceTimersByTime(2_100);
    expect(game.resumePause("host").ok).toBe(true);
    expect(game.snapshot().players[0].pauseSeconds).toBe(3);
    expect(game.pause("host").ok).toBe(false);
    game.forfeit("host");
  });

  it("declares the opponent winner on timeout", () => {
    vi.useFakeTimers();
    const game = new GameEngine({ id: "game", mode: "multiplayer", difficulty: "hard", host });
    game.addPlayer(guest);
    game.start(host.playerKey);
    vi.advanceTimersByTime(20_001);
    expect(game.snapshot()).toMatchObject({
      status: "ended",
      winnerKey: "guest",
      endReason: "timeout",
    });
  });

  it("restores authoritative state and its absolute deadline", () => {
    vi.useFakeTimers();
    const original = new GameEngine({ id: "game", mode: "multiplayer", difficulty: "hard", host });
    original.addPlayer(guest);
    original.start(host.playerKey);
    vi.advanceTimersByTime(5_000);
    const saved = original.snapshot();
    original.forfeit(host.playerKey);

    const restored = GameEngine.restore(saved);
    restored.resumeClock();
    expect(restored.snapshot().status).toBe("playing");
    vi.advanceTimersByTime(15_001);
    expect(restored.snapshot()).toMatchObject({
      status: "ended",
      winnerKey: "guest",
      endReason: "timeout",
    });
  });
});
