export type Difficulty = "easy" | "medium" | "hard";
export type GameMode = "solo" | "multiplayer";
export type GameStatus = "waiting" | "playing" | "paused" | "reconnecting" | "ended";
export type EndReason = "timeout" | "forfeit" | "disconnect";

export interface PlayerIdentity {
  playerKey: string;
  userId: string | null;
  displayName: string;
}

export interface PlayerState extends PlayerIdentity {
  score: number;
  pauseUsed: boolean;
  pauseSeconds: number;
  connected: boolean;
}

export interface AcceptedWord {
  word: string;
  playerKey: string;
  points: number;
  turnNumber: number;
  remainingMs: number;
}

export interface GameSnapshot {
  id: string;
  roomCode?: string;
  mode: GameMode;
  difficulty: Difficulty;
  status: GameStatus;
  players: PlayerState[];
  activePlayerKey: string | null;
  requiredLetter: string | null;
  words: AcceptedWord[];
  deadline: number | null;
  pauseDeadline: number | null;
  reconnectDeadline: number | null;
  winnerKey: string | null;
  endReason: EndReason | null;
  startedAt: number | null;
  endedAt: number | null;
  pausedByKey: string | null;
  pausedAt: number | null;
  remainingTurnMs: number;
}

export interface CommandResult {
  ok: boolean;
  message?: string;
  snapshot?: GameSnapshot;
}
