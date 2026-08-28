import type { PrimerRecord, RestrictionSite } from "../types";

const IUPAC: Record<string, string> = {
  A: "A",
  C: "C",
  G: "G",
  T: "T",
  U: "T",
  R: "AG",
  Y: "CT",
  S: "GC",
  W: "AT",
  K: "GT",
  M: "AC",
  B: "CGT",
  D: "AGT",
  H: "ACT",
  V: "ACG",
  N: "ACGT",
};

const COMPLEMENT: Record<string, string> = {
  A: "T", T: "A", U: "A", C: "G", G: "C",
  R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
  B: "V", V: "B", D: "H", H: "D", N: "N",
};

export const COMMON_ENZYMES = [
  ["AatII", "GACGTC"], ["AflII", "CTTAAG"], ["AgeI", "ACCGGT"],
  ["ApaI", "GGGCCC"], ["AscI", "GGCGCGCC"], ["AarI", "CACCTGC"],
  ["AvrII", "CCTAGG"], ["BamHI", "GGATCC"], ["BbsI", "GAAGAC"],
  ["BglII", "AGATCT"], ["BsaI", "GGTCTC"], ["BsiWI", "CGTACG"],
  ["BsmBI/Esp3I", "CGTCTC"], ["BspQI/SapI", "GCTCTTC"], ["BsrGI", "TGTACA"],
  ["BstBI", "TTCGAA"], ["BtgZI", "GCGATG"], ["ClaI", "ATCGAT"],
  ["DraI", "TTTAAA"], ["EagI", "CGGCCG"], ["EcoRI", "GAATTC"],
  ["EcoRV", "GATATC"], ["FseI", "GGCCGGCC"], ["HincII", "GTYRAC"],
  ["HindIII", "AAGCTT"], ["HpaI", "GTTAAC"], ["KpnI", "GGTACC"],
  ["MfeI", "CAATTG"], ["MluI", "ACGCGT"], ["NcoI", "CCATGG"],
  ["NdeI", "CATATG"], ["NheI", "GCTAGC"], ["NotI", "GCGGCCGC"],
  ["PacI", "TTAATTAA"], ["PmeI", "GTTTAAAC"], ["PstI", "CTGCAG"],
  ["PvuI", "CGATCG"], ["PvuII", "CAGCTG"], ["SacI", "GAGCTC"],
  ["SacII", "CCGCGG"], ["SalI", "GTCGAC"], ["SbfI", "CCTGCAGG"],
  ["SfiI", "GGCCNNNNNGGCC"], ["SmaI/XmaI", "CCCGGG"], ["SnaBI", "TACGTA"],
  ["SpeI", "ACTAGT"], ["SphI", "GCATGC"], ["StuI", "AGGCCT"],
  ["XbaI", "TCTAGA"], ["XhoI", "CTCGAG"],
] as const;

export function normalizeSequence(sequence: string): string {
  return sequence.toUpperCase().replace(/[^ACGTURYSWKMBDHVN]/g, "").replace(/U/g, "T");
}

export function reverseComplement(sequence: string): string {
  return normalizeSequence(sequence)
    .split("")
    .reverse()
    .map((base) => COMPLEMENT[base] ?? "N")
    .join("");
}

function motifMatches(sequence: string, motif: string, start: number): boolean {
  for (let index = 0; index < motif.length; index += 1) {
    const observed = IUPAC[sequence[start + index]] ?? "";
    const allowed = IUPAC[motif[index]] ?? "";
    if (!observed || ![...observed].every((base) => allowed.includes(base))) return false;
  }
  return true;
}

export function scanRestrictionSites(rawSequence: string): RestrictionSite[] {
  const sequence = normalizeSequence(rawSequence);
  const sites: RestrictionSite[] = [];

  for (const [enzyme, motif] of COMMON_ENZYMES) {
    const orientations: Array<{ motif: string; strand: "+" | "-" }> = [{ motif, strand: "+" }];
    const reverse = reverseComplement(motif);
    if (reverse !== motif) orientations.push({ motif: reverse, strand: "-" });

    for (const orientation of orientations) {
      for (let start = 0; start <= sequence.length - orientation.motif.length; start += 1) {
        if (motifMatches(sequence, orientation.motif, start)) {
          sites.push({
            enzyme,
            recognition: motif,
            start: start + 1,
            end: start + orientation.motif.length,
            strand: orientation.strand,
          });
        }
      }
    }
  }

  return sites.sort((left, right) => left.start - right.start || left.enzyme.localeCompare(right.enzyme));
}

export function findSequenceMatches(records: PrimerRecord[], query: string): Set<string> {
  const normalized = normalizeSequence(query);
  if (normalized.length < 3) return new Set();
  const reverse = reverseComplement(normalized);
  return new Set(
    records
      .filter((record) =>
        record.normalized_sequence.includes(normalized) ||
        record.normalized_sequence.includes(reverse),
      )
      .map((record) => record.id),
  );
}

export function gcPercent(sequence: string): number {
  const normalized = normalizeSequence(sequence);
  if (!normalized.length) return 0;
  const gc = [...normalized].filter((base) => base === "G" || base === "C").length;
  return (gc / normalized.length) * 100;
}
