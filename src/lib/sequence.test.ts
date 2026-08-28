import { describe, expect, it } from "vitest";
import { findSequenceMatches, normalizeSequence, reverseComplement, scanRestrictionSites } from "./sequence";
import type { PrimerRecord } from "../types";

describe("sequence utilities", () => {
  it("normalizes and reverse-complements IUPAC bases", () => {
    expect(normalizeSequence(" aa tg-c n ")).toBe("AATGCN");
    expect(reverseComplement("AATGCRY")).toBe("RYGCATT");
  });

  it("reports common restriction sites with one-based coordinates", () => {
    const sites = scanRestrictionSites("TTTGAATTCCCGGATCCAAA");
    expect(sites).toEqual(expect.arrayContaining([
      expect.objectContaining({ enzyme: "EcoRI", start: 4, end: 9 }),
      expect.objectContaining({ enzyme: "BamHI", start: 12, end: 17 }),
    ]));
  });

  it("finds a short sequence and its reverse complement", () => {
    const records = [{ id: "p1", normalized_sequence: "AAACCGTTAACC" }] as PrimerRecord[];
    expect(findSequenceMatches(records, "CGTT").has("p1")).toBe(true);
    expect(findSequenceMatches(records, "AACG").has("p1")).toBe(true);
  });
});
