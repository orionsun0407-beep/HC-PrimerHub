import type { ImportedPrimer } from "../types";
import { normalizeSequence, scanRestrictionSites } from "./sequence";

export function decodePrimerBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.slice(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

export function parsePrimerText(text: string, sourceFile: string): ImportedPrimer[] {
  const primers: ImportedPrimer[] = [];
  const lines = text.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) continue;
    const parts = line.includes("\t") ? line.split(/\t+/) : line.split(/,{1}(?=(?:[^\"]|\"[^\"]*\")*$)/);
    if (parts.length < 2) continue;
    const name = parts[0].replace(/^"|"$/g, "").trim();
    const sequence = parts.slice(1).join("").replace(/^"|"$/g, "").trim();
    const normalizedSequence = normalizeSequence(sequence);
    if (!name || normalizedSequence.length < 4) continue;

    primers.push({
      localId: crypto.randomUUID(),
      name,
      sequence: normalizedSequence,
      normalizedSequence,
      enzymeSites: scanRestrictionSites(normalizedSequence),
      bindingContext: null,
      sourceType: "snapgene-text",
      sourceFile,
      quality: "valid",
      qualityReason: "文本导入不包含模板结合位点",
      duplicateNames: [],
      selected: true,
    });
  }

  if (!primers.length) throw new Error("未识别到“名称 + 序列”格式的 Primer。请使用 SnapGene 导出的 TXT/TSV/CSV。 ");
  return primers;
}
