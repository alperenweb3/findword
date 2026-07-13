import { SignJWT, jwtVerify } from "jose";
import type { PlayerIdentity } from "./game/types";

const secret = () =>
  new TextEncoder().encode(process.env.AUTH_SECRET ?? "development-secret-change-me-please-32");

export async function createRealtimeToken(identity: PlayerIdentity): Promise<string> {
  return new SignJWT({
    playerKey: identity.playerKey,
    userId: identity.userId,
    displayName: identity.displayName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export async function verifyRealtimeToken(token: string): Promise<PlayerIdentity> {
  const { payload } = await jwtVerify(token, secret());
  if (typeof payload.playerKey !== "string" || typeof payload.displayName !== "string") {
    throw new Error("Invalid realtime token");
  }
  return {
    playerKey: payload.playerKey,
    userId: typeof payload.userId === "string" ? payload.userId : null,
    displayName: payload.displayName,
  };
}
