export type RestrictionSite = {
  enzyme: string;
  recognition: string;
  start: number;
  end: number;
  strand: "+" | "-";
};

export type BindingContext = {
  templateName: string;
  templateLength: number;
  topology: "circular" | "linear";
  start: number;
  end: number;
  strand: "+" | "-";
  upstream: string;
  bindingSequence: string;
  downstream: string;
  primerSequence: string;
  meltingTemperature?: number;
};

export type PrimerRecord = {
  id: string;
  user_id: string;
  name: string;
  sequence: string;
  normalized_sequence: string;
  ordered_at: string;
  enzyme_sites: RestrictionSite[];
  notes: string;
  binding_context: BindingContext | null;
  source_type: "historical" | "snapgene-dna" | "snapgene-text" | "manual";
  created_at: string;
  updated_at: string;
};

export type ImportedPrimer = {
  localId: string;
  name: string;
  sequence: string;
  normalizedSequence: string;
  enzymeSites: RestrictionSite[];
  bindingContext: BindingContext | null;
  sourceType: PrimerRecord["source_type"];
  sourceFile: string;
  dateAdded?: string;
  quality: "valid" | "invalid";
  qualityReason: string;
  duplicateNames: string[];
  selected: boolean;
};

export type TemplateField =
  | "id"
  | "name"
  | "sequence"
  | "length"
  | "spec"
  | "tubes"
  | "purification"
  | "modification"
  | "delivery"
  | "notes";

export type TemplateMapping = {
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  capacity: number;
  columns: Partial<Record<TemplateField, number>>;
};

export type OrderDefaults = {
  spec: string;
  tubes: string;
  purification: string;
  modification: string;
  delivery: string;
  notes: string;
};

export type OrderTemplate = {
  id: string;
  user_id: string;
  name: string;
  file_name: string;
  storage_path: string;
  mapping: TemplateMapping;
  defaults: OrderDefaults;
  created_at: string;
  updated_at: string;
  system?: boolean;
};
