import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createRealtimeToken, verifyRealtimeToken } from "@/lib/realtime-token";

const schema = z.object({ displayName: z.string().trim().min(2).max(30).optional() });
const GUEST_COOKIE = "kelime-guest";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: "Geçerli bir oyuncu adı girin." }, { status: 400 });
  const account = await auth();
  if (account?.user) {
    const identity = {
      playerKey: `user:${account.user.id}`,
      userId: account.user.id,
      displayName: account.user.name ?? "Oyuncu",
    };
    return NextResponse.json({
      identity,
      token: await createRealtimeToken(identity),
      authenticated: true,
    });
  }

  const cookieStore = await cookies();
  const existing = cookieStore.get(GUEST_COOKIE)?.value;
  let guestId: string | null = null;
  if (existing) {
    try {
      const previous = await verifyRealtimeToken(existing);
      if (previous.playerKey.startsWith("guest:")) guestId = previous.playerKey.slice(6);
    } catch {
      /* issue a fresh guest identity */
    }
  }
  if (!parsed.data.displayName) {
    return NextResponse.json({ error: "Misafir oyunu için oyuncu adı gerekli." }, { status: 400 });
  }
  const identity = {
    playerKey: `guest:${guestId ?? randomUUID()}`,
    userId: null,
    displayName: parsed.data.displayName,
  };
  const token = await createRealtimeToken(identity);
  const response = NextResponse.json({ identity, token, authenticated: false });
  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
