import type { BindingContext, ImportedPrimer } from "../types";
import { normalizeSequence, scanRestrictionSites } from "./sequence";
import { XMLParser } from "fast-xml-parser";

type RawBinding = {
  start: number;
  end: number;
  strand: "+" | "-";
  annealedBases: string;
  meltingTemperature?: number;
};

export type SnapGeneParseOptions = {
  onlyRecent?: boolean;
  recentDays?: number;
  now?: Date;
};

function wrapSlice(sequence: string, startZero: number, length: number, circular: boolean): string {
  if (!circular) {
    const start = Math.max(0, startZero);
    const end = Math.min(sequence.length, startZero + length);
    return sequence.slice(start, end);
  }
  if (!sequence.length || length <= 0) return "";
  let output = "";
  for (let offset = 0; offset < length; offset += 1) {
    const index = ((startZero + offset) % sequence.length + sequence.length) % sequence.length;
    output += sequence[index];
  }
  return output;
}

function rangeLength(start: number, end: number, templateLength: number): number {
  return end >= start ? end - start + 1 : templateLength - start + 1 + end;
}

function parseLocation(location: string): { start: number; end: number } | null {
  const match = location.match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]) };
}

function buildContext(
  templateName: string,
  sequence: string,
  circular: boolean,
  primerSequence: string,
  binding: RawBinding,
): BindingContext {
  const bindingLength = rangeLength(binding.start, binding.end, sequence.length);
  return {
    templateName,
    templateLength: sequence.length,
    topology: circular ? "circular" : "linear",
    // SnapGene stores zero-based inclusive coordinates; the UI displays one-based values.
    start: binding.start + 1,
    end: binding.end + 1,
    strand: binding.strand,
    upstream: wrapSlice(sequence, binding.start - 20, 20, circular),
    bindingSequence: wrapSlice(sequence, binding.start, bindingLength, circular),
    downstream: wrapSlice(sequence, binding.end + 1, 20, circular),
    primerSequence,
    meltingTemperature: binding.meltingTemperature,
  };
}

export function parseSnapGeneBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options: SnapGeneParseOptions = {},
): ImportedPrimer[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8");
  let offset = 0;
  let templateSequence = "";
  let circular = false;
  let primersXml = "";

  while (offset + 5 <= bytes.length) {
    const packetType = view.getUint8(offset);
    const packetLength = view.getUint32(offset + 1, false);
    const dataStart = offset + 5;
    const dataEnd = dataStart + packetLength;
    if (dataEnd > bytes.length) throw new Error("SnapGene 文件数据包长度无效，文件可能已损坏。 ");
    const data = bytes.slice(dataStart, dataEnd);

    if (packetType === 0 && data.length > 1) {
      circular = Boolean(data[0] & 0x01);
      templateSequence = normalizeSequence(decoder.decode(data.slice(1)));
    } else if (packetType === 5) {
      primersXml = decoder.decode(data);
    }
    offset = dataEnd;
  }

  if (!templateSequence) throw new Error("没有从 .dna 文件读取到模板序列。 ");
  if (!primersXml) return [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const parsed = parser.parse(primersXml) as {
    Primers?: {
      HybridizationParams?: Record<string, unknown>;
      Primer?: Record<string, unknown> | Array<Record<string, unknown>>;
    };
  };
  const rawPrimerNodes = parsed.Primers?.Primer;
  const primerNodes = rawPrimerNodes ? (Array.isArray(rawPrimerNodes) ? rawPrimerNodes : [rawPrimerNodes]) : [];
  const templateName = fileName.replace(/\.dna$/i, "");
  const onlyRecent = options.onlyRecent ?? true;
  const recentDays = options.recentDays ?? 7;
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - recentDays * 24 * 60 * 60 * 1000;
  const minimumTemperatureRaw = Number(parsed.Primers?.HybridizationParams?.["@_minMeltingTemperature"]);
  const minimumTemperature = Number.isFinite(minimumTemperatureRaw) ? minimumTemperatureRaw : 40;
  const eligibleNodes = primerNodes.filter((node) => {
    const timestamp = Date.parse(String(node["@_dateAdded"] ?? ""));
    if (!Number.isFinite(timestamp)) return false;
    return !onlyRecent || timestamp >= cutoff;
  });

  return eligibleNodes.map((node) => {
    const name = String(node["@_name"] ?? "").trim() || "未命名 Primer";
    const sequence = normalizeSequence(String(node["@_sequence"] ?? ""));
    const dateAdded = String(node["@_dateAdded"] ?? "");
    const rawBindings = node.BindingSite
      ? (Array.isArray(node.BindingSite) ? node.BindingSite : [node.BindingSite]) as Array<Record<string, unknown>>
      : [];
    const trueBindings = rawBindings.filter((binding) => String(binding["@_simplified"] ?? "") !== "1");
    const allBindings: RawBinding[] = trueBindings.flatMap((binding) => {
      const range = parseLocation(String(binding["@_location"] ?? ""));
      if (!range) return [];
      const temperature = Number(binding["@_meltingTemperature"]);
      return [{
        ...range,
        strand: String(binding["@_boundStrand"] ?? "") === "1" ? "-" as const : "+" as const,
        annealedBases: normalizeSequence(String(binding["@_annealedBases"] ?? "")),
        meltingTemperature: Number.isFinite(temperature) ? temperature : undefined,
      }];
    });
    const bindings = allBindings.filter((binding) =>
      binding.meltingTemperature === undefined || binding.meltingTemperature >= minimumTemperature,
    );
    const ignoredWeakBindings = allBindings.length - bindings.length;

    const isValid = bindings.length === 1 && sequence.length > 0;
    const weakMatchNote = ignoredWeakBindings
      ? `；已忽略 ${ignoredWeakBindings} 个低于 ${minimumTemperature}°C 的弱匹配`
      : "";
    const reason = !sequence
      ? "Primer 序列为空"
      : bindings.length === 0
        ? `没有达到 ${minimumTemperature}°C 的有效模板结合位点${weakMatchNote}`
        : bindings.length > 1
          ? `检测到 ${bindings.length} 个有效模板结合位点${weakMatchNote}`
          : `恰好一个有效模板结合位点${weakMatchNote}`;

    return {
      localId: crypto.randomUUID(),
      name,
      sequence,
      normalizedSequence: sequence,
      enzymeSites: scanRestrictionSites(sequence),
      bindingContext: isValid
        ? buildContext(templateName, templateSequence, circular, sequence, bindings[0])
        : null,
      sourceType: "snapgene-dna" as const,
      sourceFile: fileName,
      dateAdded,
      quality: isValid ? "valid" as const : "invalid" as const,
      qualityReason: reason,
      duplicateNames: [],
      selected: isValid,
    };
  });
}
