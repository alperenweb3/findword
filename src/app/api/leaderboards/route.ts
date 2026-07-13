import { NextResponse } from "next/server";
import { Difficulty, GameMode, GameStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

const querySchema = z.object({
  mode: z.enum(["solo", "multiplayer"]).default("solo"),
  difficulty: z.enum(["easy", "medium", "hard"]).default("easy"),
  period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
});

function periodStart(period: "daily" | "weekly" | "monthly"): Date {
  const now = new Date();
  if (period === "daily")
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "monthly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz filtre." }, { status: 400 });
  const { mode, difficulty, period } = parsed.data;
  const entries = await prisma.gameParticipant.findMany({
    where: {
      userId: { not: null },
      game: {
        mode: mode === "solo" ? GameMode.SOLO : GameMode.MULTIPLAYER,
        difficulty: Difficulty[difficulty.toUpperCase() as keyof typeof Difficulty],
        status: GameStatus.ENDED,
        endedAt: { gte: periodStart(period) },
      },
    },
    include: { user: { select: { displayName: true } }, game: { select: { endedAt: true } } },
    orderBy: [{ score: "desc" }, { game: { endedAt: "asc" } }],
  });
  const best = new Map<string, (typeof entries)[number]>();
  for (const entry of entries)
    if (entry.userId && !best.has(entry.userId)) best.set(entry.userId, entry);
  const leaderboard = Array.from(best.values())
    .slice(0, 50)
    .map((entry, index) => ({
      rank: index + 1,
      displayName: entry.user?.displayName ?? entry.displayName,
      score: entry.score,
      achievedAt: entry.game.endedAt,
    }));
  return NextResponse.json({ periodStart: periodStart(period), leaderboard });
}
