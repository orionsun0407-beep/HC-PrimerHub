import fs from "node:fs/promises";
import { detectTemplateMapping } from "../src/lib/excel";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: vite-node scripts/inspect-template.ts <file.xlsx>");
const bytes = await fs.readFile(filePath);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
console.log(JSON.stringify(await detectTemplateMapping(buffer), null, 2));
