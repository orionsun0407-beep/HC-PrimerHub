import fs from "node:fs/promises";
import { parseSnapGeneBuffer } from "../src/lib/snapgene";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: vite-node scripts/inspect-dna.ts <file.dna>");
const bytes = await fs.readFile(filePath);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const primers = parseSnapGeneBuffer(buffer, filePath.split("/").pop() || "template.dna");
console.log(JSON.stringify({
  total: primers.length,
  valid: primers.filter((primer) => primer.quality === "valid").length,
  invalid: primers.filter((primer) => primer.quality === "invalid").map((primer) => ({ name: primer.name, reason: primer.qualityReason })),
  first: primers[0] ? {
    name: primers[0].name,
    sequence: primers[0].sequence,
    binding: primers[0].bindingContext,
    enzymes: primers[0].enzymeSites,
  } : null,
}, null, 2));
