import type ExcelJS from "exceljs";
import type { ImportedPrimer, OrderDefaults, OrderHeaderMapping, OrderProfile, PrimerRecord, TemplateField, TemplateMapping } from "../types";
import { normalizeSequence, scanRestrictionSites } from "./sequence";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function createWorkbook(): Promise<ExcelJS.Workbook> {
  const { default: ExcelJSRuntime } = await import("exceljs");
  return new ExcelJSRuntime.Workbook();
}

const FIELD_SYNONYMS: Record<TemplateField, string[]> = {
  id: ["id", "序号", "编号"],
  name: ["引物名称", "primername", "oligoname", "名称"],
  sequence: ["引物序列", "序列", "sequence", "5to3", "5'to3'", "5’-3’"],
  length: ["碱基数", "长度", "length", "bases"],
  spec: ["合成规格", "od值", "每管od", "spec", "scale"],
  tubes: ["分装管数", "管数", "tubes"],
  purification: ["纯化方式", "纯化", "purification"],
  modification: ["修饰", "modification", "5'修饰", "3'修饰"],
  delivery: ["交付形式", "交付", "delivery"],
  notes: ["备注", "说明", "notes", "comment"],
};

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value && "richText" in value) {
    return ((value as { richText: Array<{ text?: unknown }> }).richText ?? []).map((item) => String(item.text ?? "")).join("");
  }
  if (typeof value === "object" && value && "text" in value) return String((value as { text: unknown }).text ?? "");
  if (typeof value === "object" && value && "result" in value) return String((value as { result: unknown }).result ?? "");
  return String(value);
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[\s（）()'’"：:＊*\-_/]/g, "");
}

function detectField(header: string): TemplateField | null {
  const candidate = compact(header);
  let best: { field: TemplateField; length: number } | null = null;
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as Array<[TemplateField, string[]]>) {
    for (const synonym of synonyms) {
      const normalized = compact(synonym);
      if (candidate.includes(normalized) && (!best || normalized.length > best.length)) best = { field, length: normalized.length };
    }
  }
  return best?.field ?? null;
}

export async function detectTemplateMapping(buffer: ArrayBuffer): Promise<TemplateMapping> {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(buffer as never);
  let best: { score: number; mapping: TemplateMapping } | null = null;

  for (const sheet of workbook.worksheets) {
    const maxRow = Math.min(sheet.rowCount || 100, 100);
    const maxColumn = Math.min(sheet.columnCount || 30, 30);
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
      const columns: Partial<Record<TemplateField, number>> = {};
      for (let column = 1; column <= maxColumn; column += 1) {
        const field = detectField(text(sheet.getRow(rowNumber).getCell(column).value));
        if (field && !columns[field]) columns[field] = column;
      }
      const score = Object.keys(columns).length + (columns.name ? 5 : 0) + (columns.sequence ? 5 : 0);
      if (columns.name && columns.sequence && (!best || score > best.score)) {
        let capacity = 1;
        for (let scan = rowNumber + 1; scan <= Math.min(sheet.rowCount || rowNumber + 30, rowNumber + 60); scan += 1) {
          const idValue = columns.id ? text(sheet.getRow(scan).getCell(columns.id).value).trim() : "";
          const stylePresent = Boolean(
            Object.keys(sheet.getRow(scan).getCell(columns.name).style ?? {}).length ||
            Object.keys(sheet.getRow(scan).getCell(columns.sequence).style ?? {}).length,
          );
          if (idValue || stylePresent) capacity = scan - rowNumber;
          else if (capacity > 1) break;
        }
        best = {
          score,
          mapping: { sheetName: sheet.name, headerRow: rowNumber, firstDataRow: rowNumber + 1, capacity: Math.max(1, capacity), columns },
        };
      }
    }
  }

  if (!best) throw new Error("没有自动识别到同时包含“引物名称”和“序列”的表头，请手动确认模板。 ");
  return (best as { score: number; mapping: TemplateMapping }).mapping;
}

function clone<T>(value: T): T {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) as T : value;
}

function ensureCapacity(sheet: ExcelJS.Worksheet, mapping: TemplateMapping, required: number): number {
  if (required <= mapping.capacity) return 0;
  const added = required - mapping.capacity;
  const templateRowNumber = mapping.firstDataRow + mapping.capacity - 1;
  if (typeof sheet.duplicateRow === "function") {
    sheet.duplicateRow(templateRowNumber, added, true);
  } else {
    sheet.spliceRows(templateRowNumber + 1, 0, ...Array.from({ length: added }, () => []));
    const source = sheet.getRow(templateRowNumber);
    for (let offset = 1; offset <= added; offset += 1) {
      const target = sheet.getRow(templateRowNumber + offset);
      target.height = source.height;
      for (let column = 1; column <= sheet.columnCount; column += 1) target.getCell(column).style = clone(source.getCell(column).style);
    }
  }
  return added;
}

function columnLetter(column: number): string {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export async function fillOrderTemplate(
  buffer: ArrayBuffer,
  mapping: TemplateMapping,
  primers: ImportedPrimer[],
  defaults: OrderDefaults,
  options: { profile?: OrderProfile; headerMapping?: OrderHeaderMapping; orderDate?: string } = {},
): Promise<ArrayBuffer> {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.getWorksheet(mapping.sheetName);
  if (!sheet) throw new Error(`模板中不存在工作表“${mapping.sheetName}”。`);

  if (options.headerMapping) {
    const headerSheetName = options.headerMapping.sheetName ?? mapping.sheetName;
    const headerSheet = workbook.getWorksheet(headerSheetName);
    if (!headerSheet) throw new Error(`模板中不存在订购资料工作表“${headerSheetName}”。`);
    const values: Record<keyof OrderProfile | "orderDate", string> = {
      ...(options.profile ?? {
        customerUnit: "", customerName: "", invoiceTitle: "", principal: "",
        address: "", settlement: "", phone: "", email: "",
      }),
      orderDate: options.orderDate ?? "",
    };
    for (const [field, address] of Object.entries(options.headerMapping.cells) as Array<[keyof typeof values, string]>) {
      if (address) headerSheet.getCell(address).value = values[field] ?? "";
    }
  }
  const added = ensureCapacity(sheet, mapping, primers.length);
  const totalCapacity = mapping.capacity + added;

  for (let index = 0; index < totalCapacity; index += 1) {
    const rowNumber = mapping.firstDataRow + index;
    const row = sheet.getRow(rowNumber);
    const primer = primers[index];
    const set = (field: TemplateField, value: ExcelJS.CellValue) => {
      const column = mapping.columns[field];
      if (column) row.getCell(column).value = value;
    };
    if (!primer) {
      for (const field of Object.keys(mapping.columns) as TemplateField[]) set(field, null);
      continue;
    }
    set("id", index + 1);
    set("name", primer.name);
    set("sequence", primer.sequence);
    if (mapping.columns.length !== undefined && mapping.columns.sequence) {
      set("length", { formula: `LEN(SUBSTITUTE(${columnLetter(mapping.columns.sequence)}${rowNumber}," ",""))`, result: primer.normalizedSequence.length });
    }
    set("spec", defaults.spec);
    set("tubes", defaults.tubes);
    set("purification", defaults.purification);
    set("modification", defaults.modification);
    set("delivery", defaults.delivery);
    set("notes", defaults.notes);
  }
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function extractOrderProfile(
  buffer: ArrayBuffer,
  mapping: OrderHeaderMapping,
  fallbackSheetName: string,
): Promise<OrderProfile> {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(buffer as never);
  const sheetName = mapping.sheetName ?? fallbackSheetName;
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`订单中不存在工作表“${sheetName}”。`);
  const profile: OrderProfile = {
    customerUnit: "", customerName: "", invoiceTitle: "", principal: "",
    address: "", settlement: "", phone: "", email: "",
  };
  for (const field of Object.keys(profile) as Array<keyof OrderProfile>) {
    const address = mapping.cells[field];
    if (address) profile[field] = text(sheet.getCell(address).value).trim();
  }
  return profile;
}

export function datedFileName(fileName: string, date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  const compactDate = formatter.format(date).replaceAll("-", "");
  const extension = fileName.match(/\.[^.]+$/)?.[0] || ".xlsx";
  const base = fileName.slice(0, -extension.length);
  const updated = /20\d{6}/.test(base) ? base.replace(/20\d{6}(?!.*20\d{6})/, compactDate) : `${base}-${compactDate}`;
  return `${updated}${extension}`;
}

export function downloadBuffer(buffer: ArrayBuffer, fileName: string, mime = MIME_XLSX): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function dateFromFileName(fileName: string): string | null {
  const match = fileName.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export async function parseHistoricalOrders(files: File[]): Promise<Array<Omit<PrimerRecord, "id" | "user_id" | "created_at" | "updated_at">>> {
  const extracted: Array<Omit<PrimerRecord, "id" | "user_id" | "created_at" | "updated_at">> = [];
  const candidates = files.filter((file) => /\.xlsx$/i.test(file.name) && !file.name.startsWith(".~") && !/汇总|summary/i.test(file.name));
  for (const file of candidates) {
    const orderedAt = dateFromFileName(file.name);
    if (!orderedAt) continue;
    const buffer = await file.arrayBuffer();
    let mapping: TemplateMapping;
    try {
      mapping = await detectTemplateMapping(buffer);
    } catch {
      continue;
    }
    const workbook = await createWorkbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet(mapping.sheetName);
    if (!sheet || !mapping.columns.name || !mapping.columns.sequence) continue;
    let emptyRun = 0;
    for (let rowNumber = mapping.firstDataRow; rowNumber <= Math.min(sheet.rowCount, mapping.firstDataRow + 500); rowNumber += 1) {
      const name = text(sheet.getRow(rowNumber).getCell(mapping.columns.name).value).trim();
      const rawSequence = text(sheet.getRow(rowNumber).getCell(mapping.columns.sequence).value).trim();
      const sequence = normalizeSequence(rawSequence);
      if (!name || sequence.length < 4) {
        emptyRun += 1;
        if (emptyRun >= 10) break;
        continue;
      }
      emptyRun = 0;
      extracted.push({
        name,
        sequence,
        normalized_sequence: sequence,
        ordered_at: orderedAt,
        enzyme_sites: scanRestrictionSites(sequence),
        notes: "",
        binding_context: null,
        source_type: "historical",
      });
    }
  }

  extracted.sort((left, right) => left.ordered_at.localeCompare(right.ordered_at));
  const previous = new Map<string, string[]>();
  for (const record of extracted) {
    const names = previous.get(record.normalized_sequence) ?? [];
    if (names.length) record.notes = `序列与已有引物 ${[...new Set(names)].map((name) => `“${name}”`).join("、")} 相同`;
    previous.set(record.normalized_sequence, [...names, record.name]);
  }
  return extracted;
}

export async function exportPrimerLibrary(records: PrimerRecord[]): Promise<ArrayBuffer> {
  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet("Primer 库");
  sheet.columns = [
    { header: "引物名称", key: "name", width: 32 },
    { header: "序列 (5′→3′)", key: "sequence", width: 54 },
    { header: "长度", key: "length", width: 10 },
    { header: "订购时间", key: "orderedAt", width: 14 },
    { header: "酶切位点", key: "enzymes", width: 36 },
    { header: "模板结合位置", key: "binding", width: 32 },
    { header: "备注", key: "notes", width: 50 },
  ];
  for (const record of records) {
    sheet.addRow({
      name: record.name,
      sequence: record.sequence,
      length: record.normalized_sequence.length,
      orderedAt: record.ordered_at,
      enzymes: record.enzyme_sites.map((site) => `${site.enzyme} ${site.start}-${site.end}`).join("; "),
      binding: record.binding_context ? `${record.binding_context.templateName}: ${record.binding_context.start}-${record.binding_context.end} (${record.binding_context.strand})` : "",
      notes: record.notes,
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123C36" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "G1" };
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
