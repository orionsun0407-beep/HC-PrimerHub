import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ImportedPrimer, OrderHeaderMapping, OrderProfile, TemplateMapping } from "../types";
import { extractOrderProfile, fillOrderTemplate } from "./excel";

const mapping: TemplateMapping = {
  sheetName: "订单表",
  headerRow: 11,
  firstDataRow: 12,
  capacity: 17,
  columns: { id: 1, name: 2, sequence: 3, length: 4, spec: 5, tubes: 6, purification: 7, modification: 8, delivery: 9, notes: 10 },
};
const headerMapping: OrderHeaderMapping = {
  sheetName: "订单表",
  cells: {
    orderDate: "J2", customerUnit: "B6", customerName: "F6", invoiceTitle: "B7",
    principal: "F7", address: "B8", settlement: "F8", phone: "B9", email: "F9",
  },
};

async function blankTemplate(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("订单表");
  sheet.getRow(11).values = ["", "序号", "引物名称", "序列", "碱基数", "规格", "管数", "纯化", "修饰", "交付", "备注"];
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("Biosune order profile", () => {
  it("keeps the public template blank and fills only the generated download", async () => {
    const template = await blankTemplate();
    expect(await extractOrderProfile(template, headerMapping, mapping.sheetName)).toEqual({
      customerUnit: "", customerName: "", invoiceTitle: "", principal: "",
      address: "", settlement: "", phone: "", email: "",
    });

    const profile: OrderProfile = {
      customerUnit: "测试单位", customerName: "测试联系人", invoiceTitle: "测试抬头", principal: "测试负责人",
      address: "测试地址", settlement: "月结", phone: "13800000000", email: "test@example.com",
    };
    const primers: ImportedPrimer[] = [{
      localId: "p1", name: "Primer-A", sequence: "ATGCGTCGCAAGAAGACCTTCAAG",
      normalizedSequence: "ATGCGTCGCAAGAAGACCTTCAAG", enzymeSites: [], bindingContext: null,
      sourceType: "manual", sourceFile: "test", quality: "valid", qualityReason: "test", duplicateNames: [], selected: true,
    }];
    const output = await fillOrderTemplate(
      template,
      mapping,
      primers,
      { spec: "2", tubes: "1", purification: "RPC", modification: "", delivery: "液体", notes: "" },
      { profile, headerMapping, orderDate: "2026-09-02" },
    );

    expect(await extractOrderProfile(output, headerMapping, mapping.sheetName)).toEqual(profile);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as never);
    const sheet = workbook.getWorksheet("订单表")!;
    expect(sheet.getCell("J2").value).toBe("2026-09-02");
    expect(sheet.getCell("B12").value).toBe("Primer-A");
    expect(sheet.getCell("C12").value).toBe("ATGCGTCGCAAGAAGACCTTCAAG");
  });
});
