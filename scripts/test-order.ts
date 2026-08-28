import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { detectTemplateMapping, fillOrderTemplate } from "../src/lib/excel";
import type { ImportedPrimer } from "../src/types";

const inputPath = process.argv[2];
const outputPath = process.argv[3] || "/private/tmp/hc-primerhub-order-test.xlsx";
if (!inputPath) throw new Error("Usage: vite-node scripts/test-order.ts <template.xlsx> [output.xlsx]");
const bytes = await fs.readFile(inputPath);
const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const mapping = await detectTemplateMapping(input);
const primers: ImportedPrimer[] = Array.from({ length: 25 }, (_, index) => ({
  localId: String(index + 1), name: `Primer ${index + 1}`, sequence: "ATGCGTCGCAAGAAGACCTTCAAG",
  normalizedSequence: "ATGCGTCGCAAGAAGACCTTCAAG", enzymeSites: [], bindingContext: null,
  sourceType: "manual", sourceFile: "test", quality: "valid", qualityReason: "test", duplicateNames: [], selected: true,
}));
const output = await fillOrderTemplate(input, mapping, primers, { spec: "2", tubes: "1", purification: "RPC", modification: "", delivery: "液体", notes: "" });
await fs.writeFile(outputPath, new Uint8Array(output));
const check = new ExcelJS.Workbook();
await check.xlsx.load(output as never);
const sheet = check.getWorksheet(mapping.sheetName)!;
const lastRow = mapping.firstDataRow + primers.length - 1;
console.log(JSON.stringify({
  mapping,
  outputPath,
  firstPrimer: sheet.getRow(mapping.firstDataRow).getCell(mapping.columns.name!).value,
  lastPrimer: sheet.getRow(lastRow).getCell(mapping.columns.name!).value,
  lastFormula: sheet.getRow(lastRow).getCell(mapping.columns.length!).value,
  sheetRows: sheet.rowCount,
}, null, 2));
