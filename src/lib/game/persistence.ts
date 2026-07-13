import { Difficulty, EndReason, GameMode, GameStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { AcceptedWord, GameSnapshot } from "./types";

const enumMap = {
  solo: GameMode.SOLO,
  multiplayer: GameMode.MULTIPLAYER,
  easy: Difficulty.EASY,
  medium: Difficulty.MEDIUM,
  hard: Difficulty.HARD,
};

export async function persistSnapshot(snapshot: GameSnapshot): Promise<void> {
  const state = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
  await prisma.game.upsert({
    where: { id: snapshot.id },
    create: {
      id: snapshot.id,
      roomCode: snapshot.roomCode,
      mode: enumMap[snapshot.mode],
      difficulty: enumMap[snapshot.difficulty],
      status:
        snapshot.status === "waiting"
          ? GameStatus.WAITING
          : snapshot.status === "ended"
            ? GameStatus.ENDED
            : GameStatus.PLAYING,
      startedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : null,
      endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : null,
      state,
      participants: {
        create: snapshot.players.map((player, seat) => ({
          playerKey: player.playerKey,
          userId: player.userId,
          displayName: player.displayName,
          seat,
          score: player.score,
          pauseUsed: player.pauseUsed,
          pauseSeconds: player.pauseSeconds,
        })),
      },
    },
    update: {
      status:
        snapshot.status === "ended"
          ? GameStatus.ENDED
          : snapshot.status === "waiting"
            ? GameStatus.WAITING
            : GameStatus.PLAYING,
      winnerId: snapshot.winnerKey,
      endReason: snapshot.endReason
        ? EndReason[snapshot.endReason.toUpperCase() as keyof typeof EndReason]
        : null,
      startedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : null,
      endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : null,
      state,
    },
  });
  await Promise.all(
    snapshot.players.map((player, seat) =>
      prisma.gameParticipant.upsert({
        where: { gameId_playerKey: { gameId: snapshot.id, playerKey: player.playerKey } },
        create: {
          gameId: snapshot.id,
          playerKey: player.playerKey,
          userId: player.userId,
          displayName: player.displayName,
          seat,
          score: player.score,
          pauseUsed: player.pauseUsed,
          pauseSeconds: player.pauseSeconds,
          won: snapshot.status === "ended" ? snapshot.winnerKey === player.playerKey : null,
        },
        update: {
          score: player.score,
          pauseUsed: player.pauseUsed,
          pauseSeconds: player.pauseSeconds,
          won: snapshot.status === "ended" ? snapshot.winnerKey === player.playerKey : null,
        },
      }),
    ),
  );
}

export async function persistWord(snapshot: GameSnapshot, entry: AcceptedWord): Promise<void> {
  const participant = await prisma.gameParticipant.findUnique({
    where: { gameId_playerKey: { gameId: snapshot.id, playerKey: entry.playerKey } },
  });
  if (!participant) return;
  await prisma.wordSubmission.upsert({
    where: { gameId_turnNumber: { gameId: snapshot.id, turnNumber: entry.turnNumber } },
    create: {
      gameId: snapshot.id,
      participantId: participant.id,
      turnNumber: entry.turnNumber,
      word: entry.word,
      normalizedWord: entry.word,
      points: entry.points,
      remainingMs: entry.remainingMs,
    },
    update: {},
  });
}
