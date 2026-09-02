import { describe, expect, it } from "vitest";
import { parseSnapGeneBuffer } from "./snapgene";

const encoder = new TextEncoder();
const now = new Date("2026-01-10T12:00:00Z");

function packet(type: number, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length + 5);
  output[0] = type;
  new DataView(output.buffer).setUint32(1, data.length, false);
  output.set(data, 5);
  return output;
}

function join(...parts: Uint8Array[]): ArrayBuffer {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output.buffer;
}

function dna(template: string, xml: string, circular = false): ArrayBuffer {
  const sequencePacket = packet(0, new Uint8Array([circular ? 1 : 0, ...encoder.encode(template)]));
  return join(sequencePacket, packet(5, encoder.encode(xml)));
}

describe("SnapGene parser", () => {
  it("uses zero-based SnapGene locations correctly and ignores low-Tm weak matches", () => {
    const template = "AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT";
    const xml = `<?xml version="1.0"?><Primers>
      <HybridizationParams minMeltingTemperature="40" />
      <Primer name="Valid Fw" sequence="CCCCGG" dateAdded="2026-01-08T10:00:00Z">
        <BindingSite location="4-9" boundStrand="0" annealedBases="CCCCGG" meltingTemperature="31" />
        <BindingSite location="20-25" boundStrand="0" annealedBases="CCCCGG" meltingTemperature="60" />
        <BindingSite simplified="1" location="20-25" boundStrand="0" annealedBases="CCCCGG" meltingTemperature="60" />
      </Primer>
    </Primers>`;
    const [primer] = parseSnapGeneBuffer(dna(template, xml), "template.dna", { now });

    expect(primer.quality).toBe("valid");
    expect(primer.qualityReason).toContain("已忽略 1 个低于 40°C");
    expect(primer.bindingContext).toMatchObject({
      templateName: "template",
      start: 21,
      end: 26,
      strand: "+",
      upstream: "AAAACCCCGGGGTTTTAAAA",
      bindingSequence: "CCCCGG",
      downstream: "GGTTTT",
    });
  });

  it("still rejects multiple strong binding sites", () => {
    const template = "AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT";
    const xml = `<?xml version="1.0"?><Primers><Primer name="Bad multi" sequence="AAAACC" dateAdded="2026-01-08T10:00:00Z">
      <BindingSite location="0-5" boundStrand="0" annealedBases="AAAACC" meltingTemperature="55" />
      <BindingSite location="16-21" boundStrand="0" annealedBases="AAAACC" meltingTemperature="55" />
    </Primer></Primers>`;
    const [primer] = parseSnapGeneBuffer(dna(template, xml), "template.dna", { now });

    expect(primer.quality).toBe("invalid");
    expect(primer.qualityReason).toContain("2 个有效模板结合位点");
  });

  it("keeps only recent user-created primers and ignores undated bundled primers", () => {
    const template = "AAAACCCCGGGGTTTT";
    const binding = '<BindingSite location="0-5" boundStrand="0" annealedBases="AAAACC" meltingTemperature="55" />';
    const xml = `<?xml version="1.0"?><Primers>
      <Primer name="Recent" sequence="AAAACC" dateAdded="2026-01-08T10:00:00Z">${binding}</Primer>
      <Primer name="Old" sequence="AAAACC" dateAdded="2025-12-20T10:00:00Z">${binding}</Primer>
      <Primer name="Built in" sequence="AAAACC">${binding}</Primer>
    </Primers>`;

    expect(parseSnapGeneBuffer(dna(template, xml), "template.dna", { now }).map((item) => item.name)).toEqual(["Recent"]);
    expect(parseSnapGeneBuffer(dna(template, xml), "template.dna", { now, onlyRecent: false }).map((item) => item.name)).toEqual(["Recent", "Old"]);
  });

  it("extracts a circular binding site that crosses the origin", () => {
    const template = "AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT";
    const xml = `<?xml version="1.0"?><Primers><Primer name="Origin Fw" sequence="TTTTAAAA" dateAdded="2026-01-08T10:00:00Z">
      <BindingSite location="28-3" boundStrand="0" annealedBases="TTTTAAAA" meltingTemperature="50" />
    </Primer></Primers>`;
    const [primer] = parseSnapGeneBuffer(dna(template, xml, true), "circle.dna", { now });

    expect(primer.bindingContext).toMatchObject({ start: 29, end: 4, bindingSequence: "TTTTAAAA", topology: "circular" });
    expect(primer.bindingContext?.upstream).toHaveLength(20);
    expect(primer.bindingContext?.downstream).toHaveLength(20);
  });
});
