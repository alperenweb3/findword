import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kelime Oyunu",
  description: "Tek başına veya arkadaşlarınla Türkçe kelime zinciri oyna.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
