import { createClient, type Session } from "@supabase/supabase-js";
import type { OrderTemplate, PrimerRecord } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const syncRevisions = new Map<string, number>();
async function syncMutation(userId: string, entity: string, id: string, payload: Record<string, unknown>, operation = "upsert") {
  if (!supabase) throw new Error("Supabase 尚未配置");
  const { data, error } = await supabase.rpc("hc_wb_apply", {
    request_id: crypto.randomUUID(), entity_name: entity, record_id: id,
    expected_revision: syncRevisions.get(`${entity}:${id}`) ?? 0,
    operation, payload: { ...payload, id, user_id: userId },
  });
  if (error) throw new Error(`云端同步接口尚未升级或请求失败：${error.message}`);
  if (data.status === "conflict") throw new Error("这条记录已在其他设备修改。请刷新列表、核对网站版本后再保存；本次没有覆盖云端数据。");
  syncRevisions.set(`${entity}:${id}`, data.row.revision);
  return data.row;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function loadPrimers(userId: string): Promise<PrimerRecord[]> {
  if (!supabase) return readDemo<PrimerRecord[]>("primers", []);
  const { data, error } = await supabase
    .from("primers")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("ordered_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) syncRevisions.set(`primers:${row.id}`, row.revision ?? 0);
  return (data ?? []) as PrimerRecord[];
}

export async function insertPrimers(
  userId: string,
  records: Array<Omit<PrimerRecord, "id" | "user_id" | "created_at" | "updated_at">>,
): Promise<PrimerRecord[]> {
  if (!records.length) return [];
  if (!supabase) {
    const current = await loadPrimers(userId);
    const now = new Date().toISOString();
    const inserted = records.map((record) => ({
      ...record,
      id: crypto.randomUUID(),
      user_id: userId,
      created_at: now,
      updated_at: now,
    }));
    writeDemo("primers", [...inserted, ...current]);
    return inserted;
  }
  const inserted: PrimerRecord[] = [];
  for (const record of records) inserted.push(await syncMutation(userId, "primers", crypto.randomUUID(), record));
  return inserted;
}

export async function updatePrimer(
  userId: string,
  primerId: string,
  patch: Partial<Pick<PrimerRecord, "name" | "sequence" | "normalized_sequence" | "ordered_at" | "enzyme_sites" | "notes" | "binding_context">>,
): Promise<void> {
  if (!supabase) {
    const current = await loadPrimers(userId);
    writeDemo("primers", current.map((record) => record.id === primerId ? { ...record, ...patch, updated_at: new Date().toISOString() } : record));
    return;
  }
  const { data: current, error: readError } = await supabase.from("primers").select("*").eq("id", primerId).eq("user_id", userId).single();
  if (readError) throw readError;
  await syncMutation(userId, "primers", primerId, { ...current, ...patch });
}

export async function deletePrimer(userId: string, primerId: string): Promise<void> {
  if (!supabase) {
    writeDemo("primers", (await loadPrimers(userId)).filter((record) => record.id !== primerId));
    return;
  }
  await syncMutation(userId, "primers", primerId, {}, "delete");
}

export async function loadTemplates(userId: string): Promise<OrderTemplate[]> {
  if (!supabase) return readDemo<OrderTemplate[]>("templates", []);
  const { data, error } = await supabase
    .from("order_templates")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) syncRevisions.set(`order_templates:${row.id}`, row.revision ?? 0);
  return (data ?? []) as OrderTemplate[];
}

export async function saveTemplate(
  userId: string,
  template: Omit<OrderTemplate, "id" | "user_id" | "storage_path" | "created_at" | "updated_at">,
  file: File,
): Promise<OrderTemplate> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const storagePath = `${userId}/${id}/template.xlsx`;
  if (!supabase) {
    const saved: OrderTemplate = { ...template, id, user_id: userId, storage_path: storagePath, created_at: now, updated_at: now };
    const templates = await loadTemplates(userId);
    writeDemo("templates", [saved, ...templates]);
    const buffer = await file.arrayBuffer();
    localStorage.setItem(`primerhub:template-file:${id}`, arrayBufferToBase64(buffer));
    return saved;
  }

  const { error: uploadError } = await supabase.storage.from("order-templates").upload(storagePath, file, {
    upsert: false,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (uploadError) throw uploadError;
  try {
    return await syncMutation(userId, "order_templates", id, { ...template, storage_path: storagePath }) as OrderTemplate;
  } catch (error) {
    // Keep the private file if the RPC response was lost after a successful commit.
    throw error;
  }
}

export async function downloadTemplateFile(template: OrderTemplate): Promise<ArrayBuffer> {
  if (!supabase) {
    const encoded = localStorage.getItem(`primerhub:template-file:${template.id}`);
    if (!encoded) throw new Error("本地演示模板文件不存在。 ");
    return base64ToArrayBuffer(encoded);
  }
  const { data, error } = await supabase.storage.from("order-templates").download(template.storage_path);
  if (error) throw error;
  return data.arrayBuffer();
}

export async function removeTemplate(userId: string, template: OrderTemplate): Promise<void> {
  if (!supabase) {
    writeDemo("templates", (await loadTemplates(userId)).filter((item) => item.id !== template.id));
    localStorage.removeItem(`primerhub:template-file:${template.id}`);
    return;
  }
  await syncMutation(userId, "order_templates", template.id, {}, "delete");
  // Immutable private files remain available for conflict resolution and historical evidence.
}

function readDemo<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(`primerhub:demo:${key}`);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeDemo(key: string, value: unknown): void {
  localStorage.setItem(`primerhub:demo:${key}`, JSON.stringify(value));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
