import type { WordValidator } from "./game/engine";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { result: "valid" | "invalid"; expiresAt: number }>();

export const validateWithTdk: WordValidator = async (word) => {
  const cached = cache.get(word);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const baseUrl = process.env.TDK_API_URL ?? "https://sozluk.gov.tr/gts_id";
    const response = await fetch(`${baseUrl}?id=${encodeURIComponent(word)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return "unavailable";
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") return "unavailable";
    const error = "error" in data ? String(data.error) : null;
    const result = error === "Sonuç bulunamadı" ? "invalid" : "valid";
    cache.set(word, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
};
