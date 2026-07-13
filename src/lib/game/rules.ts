import type { Difficulty } from "./types";

export const TURN_LIMITS: Record<Difficulty, number> = {
  easy: 60_000,
  medium: 40_000,
  hard: 20_000,
};

export const DIFFICULTY_MULTIPLIERS: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export const PAUSE_LIMIT_MS = 30_000;
export const PAUSE_PENALTY_PER_SECOND = 5;
export const RECONNECT_GRACE_MS = 30_000;

export function normalizeTurkishWord(value: string): string {
  return value.trim().normalize("NFC").toLocaleLowerCase("tr-TR");
}

export function isValidWordShape(word: string): boolean {
  return word.length >= 2 && /^[abcçdefgğhıijklmnoöprsştuüvyz]+$/u.test(word);
}

export function requiredLetter(word: string): string | null {
  return Array.from(word)[1] ?? null;
}

export function calculateWordPoints(difficulty: Difficulty, remainingMs: number): number {
  const limit = TURN_LIMITS[difficulty];
  const ratio = Math.max(0, Math.min(1, remainingMs / limit));
  return Math.round(100 * DIFFICULTY_MULTIPLIERS[difficulty] * (0.5 + 0.5 * ratio));
}

export function calculatePausePenalty(elapsedMs: number): { seconds: number; points: number } {
  const seconds = Math.min(30, Math.ceil(Math.max(0, elapsedMs) / 1000));
  return { seconds, points: seconds * PAUSE_PENALTY_PER_SECOND };
}
