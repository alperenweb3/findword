import { describe, expect, it } from "vitest";
import {
  calculatePausePenalty,
  calculateWordPoints,
  isValidWordShape,
  normalizeTurkishWord,
  requiredLetter,
} from "./rules";

describe("Turkish word rules", () => {
  it("normalizes Turkish casing and Unicode", () => {
    expect(normalizeTurkishWord("  İNCİR  ")).toBe("incir");
    expect(normalizeTurkishWord("IŞIK")).toBe("ışık");
  });

  it("accepts only Turkish letters and at least two characters", () => {
    expect(isValidWordShape("şeker")).toBe(true);
    expect(isValidWordShape("a")).toBe(false);
    expect(isValidWordShape("test-1")).toBe(false);
  });

  it("takes the second Unicode character", () => {
    expect(requiredLetter("ağaç")).toBe("ğ");
  });
});

describe("scoring", () => {
  it("normalizes speed and weights difficulty", () => {
    expect(calculateWordPoints("easy", 60_000)).toBe(100);
    expect(calculateWordPoints("easy", 0)).toBe(50);
    expect(calculateWordPoints("medium", 40_000)).toBe(200);
    expect(calculateWordPoints("hard", 20_000)).toBe(300);
  });

  it("rounds pause duration upward and caps it", () => {
    expect(calculatePausePenalty(1)).toEqual({ seconds: 1, points: 5 });
    expect(calculatePausePenalty(30_500)).toEqual({ seconds: 30, points: 150 });
  });
});
