import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
  const history = await prisma.gameParticipant.findMany({
    where: { userId: session.user.id, game: { status: "ENDED" } },
    include: {
      game: {
        include: { participants: { select: { displayName: true, score: true, won: true } } },
      },
    },
    orderBy: { game: { endedAt: "desc" } },
    take: 30,
  });
  return NextResponse.json({ history });
}
