import fs from "node:fs/promises";
import path from "node:path";
import { parseHistoricalOrders } from "../src/lib/excel";

const folder = process.argv[2];
if (!folder) throw new Error("Usage: vite-node scripts/inspect-history.ts <order-folder>");
const names = await fs.readdir(folder);
const files: File[] = [];
for (const name of names.filter((item) => item.toLowerCase().endsWith(".xlsx"))) {
  const bytes = await fs.readFile(path.join(folder, name));
  files.push(new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
const records = await parseHistoricalOrders(files);
console.log(JSON.stringify({
  workbooks: files.length,
  records: records.length,
  uniqueSequences: new Set(records.map((record) => record.normalized_sequence)).size,
  duplicatedRecords: records.filter((record) => record.notes).length,
  range: records.length ? [records[0].ordered_at, records.at(-1)?.ordered_at] : [],
  sample: records.slice(0, 3),
}, null, 2));
