import { auth } from "@/auth";
import { GameApp } from "@/components/game-app";

export default async function Home() {
  const session = await auth();
  return <GameApp account={session?.user ?? null} />;
}
