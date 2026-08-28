import { describe, expect, it } from "vitest";
import { parseSnapGeneBuffer } from "./snapgene";

const encoder = new TextEncoder();

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

describe("SnapGene parser", () => {
  it("ignores simplified display bindings and rejects genuine multiple sites", () => {
    const template = "AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGG";
    const sequencePacket = packet(0, new Uint8Array([0, ...encoder.encode(template)]));
    const xml = `<?xml version="1.0"?><Primers><Primer name="Valid Fw" sequence="CCCCGG">
      <BindingSite location="21-26" boundStrand="0" annealedBases="CCCCGG" meltingTemperature="60" />
      <BindingSite simplified="1" location="23-26" boundStrand="0" annealedBases="CCGG" meltingTemperature="60" />
      </Primer><Primer name="Bad multi" sequence="AAAACC">
      <BindingSite location="1-6" boundStrand="0" annealedBases="AAAACC" />
      <BindingSite location="17-22" boundStrand="0" annealedBases="AAAACC" />
      <BindingSite simplified="1" location="1-6" boundStrand="0" annealedBases="AAAACC" />
      </Primer></Primers>`;
    const parsed = parseSnapGeneBuffer(join(sequencePacket, packet(5, encoder.encode(xml))), "template.dna");

    expect(parsed).toHaveLength(2);
    expect(parsed[0].quality).toBe("valid");
    expect(parsed[0].bindingContext).toMatchObject({ templateName: "template", start: 21, end: 26, strand: "+", upstream: "AAAACCCCGGGGTTTTAAAA", bindingSequence: "CCCCGG" });
    expect(parsed[0].bindingContext?.downstream).toBe("GGTTTTAAAACCCCGGGGTT");
    expect(parsed[1].quality).toBe("invalid");
    expect(parsed[1].qualityReason).toContain("2 个");
  });
});
