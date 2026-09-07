import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Archive, ChevronDown, ChevronRight, CircleAlert, Cloud, Dna, Download,
  FileSpreadsheet, FlaskConical, Library, LoaderCircle, LogOut, Menu, Plus,
  RotateCcw, Save, Search, Settings2, ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import type { BindingContext, ImportedPrimer, OrderDefaults, OrderTemplate, PrimerRecord, TemplateField, TemplateMapping } from "./types";
import { decodePrimerBuffer, parsePrimerText } from "./lib/primerText";
import { parseSnapGeneBuffer } from "./lib/snapgene";
import { findSequenceMatches, gcPercent, normalizeSequence, reverseComplement, scanRestrictionSites } from "./lib/sequence";
import {
  datedFileName, detectTemplateMapping, downloadBuffer, exportPrimerLibrary,
  fillOrderTemplate, parseHistoricalOrders,
} from "./lib/excel";
import {
  deletePrimer, downloadTemplateFile, getSession, insertPrimers, isSupabaseConfigured,
  loadPrimers, loadTemplates, removeTemplate, saveTemplate, supabase, updatePrimer,
} from "./lib/supabase";

type Tab = "library" | "order" | "templates" | "backup";
type AppUser = Pick<User, "id" | "email">;

const DEMO_USER: AppUser = { id: "00000000-0000-4000-8000-000000000001", email: "demo@primerhub.local" };
const DEFAULT_ORDER: OrderDefaults = { spec: "2", tubes: "1", purification: "RPC", modification: "", delivery: "液体", notes: "" };
function authRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

const FIELD_LABELS: Record<TemplateField, string> = {
  id: "ID/序号", name: "引物名称", sequence: "序列", length: "长度/碱基数",
  spec: "合成规格", tubes: "分装管数", purification: "纯化方式",
  modification: "修饰", delivery: "交付形式", notes: "备注",
};

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function duplicateNote(names: string[]): string {
  return names.length ? `序列与已有引物 ${[...new Set(names)].map((name) => `“${name}”`).join("、")} 相同` : "";
}

function enrichImported(imported: ImportedPrimer[], libraryRecords: PrimerRecord[]): ImportedPrimer[] {
  const bySequence = new Map<string, string[]>();
  for (const record of libraryRecords) {
    bySequence.set(record.normalized_sequence, [...(bySequence.get(record.normalized_sequence) ?? []), record.name]);
  }
  return imported.map((primer) => {
    const duplicateNames = [...new Set(bySequence.get(primer.normalizedSequence) ?? [])];
    return { ...primer, duplicateNames, selected: primer.quality === "valid" && duplicateNames.length === 0 };
  });
}

function recordToImported(record: PrimerRecord): ImportedPrimer {
  return {
    localId: `library:${record.id}`,
    name: record.name,
    sequence: record.sequence,
    normalizedSequence: record.normalized_sequence,
    enzymeSites: record.enzyme_sites,
    bindingContext: record.binding_context,
    sourceType: record.source_type,
    sourceFile: "Primer 库",
    quality: "valid",
    qualityReason: "再次合成已有 Primer",
    duplicateNames: [],
    selected: true,
  };
}

function reorderNote(record: PrimerRecord, orderedAt: string): string {
  const entry = `再次合成于 ${orderedAt}（此前订购时间 ${record.ordered_at}）`;
  return record.notes ? `${record.notes}；${entry}` : entry;
}

function AuthScreen({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectUrl() },
        });
        if (error) throw error;
        setMessage("注册成功。请检查邮箱并完成验证后登录。 ");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
    setMessage(error ? error.message : "密码重置邮件已发送。 ");
    setBusy(false);
  }

  async function resendVerification() {
    if (!supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setMessage(error ? error.message : "验证邮件已重新发送，请检查收件箱和垃圾邮件。 ");
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark large"><Dna /></div>
        <p className="eyebrow">PRIVATE MOLECULAR WORKSPACE</p>
        <h1>HC PrimerHub</h1>
        <p className="auth-lead">把历史 Primer、SnapGene 结合位点和新订单放进同一个安全、清晰的工作流。</p>
        <div className="auth-features">
          <span><ShieldCheck /> 每位用户数据完全隔离</span>
          <span><FlaskConical /> 本地解析 `.dna`，序列不外传</span>
          <span><FileSpreadsheet /> 多供应商订单模板</span>
        </div>
      </section>
      <section className="auth-card">
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>注册</button>
        </div>
        {isSupabaseConfigured ? (
          <form onSubmit={submit}>
            <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>密码<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <button className="primary wide" disabled={busy}>{busy && <LoaderCircle className="spin" />}{mode === "login" ? "登录 PrimerHub" : "创建账户"}</button>
            {mode === "login" && <button type="button" className="text-button" onClick={resetPassword}>忘记密码？</button>}
            {mode === "signup" && <button type="button" className="text-button" onClick={resendVerification} disabled={busy || !email}>重新发送验证邮件</button>}
            {message && <p className="form-message">{message}</p>}
          </form>
        ) : (
          <div className="setup-panel">
            <CircleAlert />
            <h3>尚未连接 Supabase</h3>
            <p>本地演示模式会把数据保存在当前浏览器。部署前填入 `.env` 配置即可启用真实注册与云端同步。</p>
            <button className="primary wide" onClick={onDemo}>进入本地演示</button>
          </div>
        )}
      </section>
    </main>
  );
}

function BindingDiagram({ context }: { context: BindingContext }) {
  const top = `${context.upstream}${context.bindingSequence}${context.downstream}`;
  const bottom = reverseComplement(top).split("").reverse().join("");
  const prefixLength = context.upstream.length;
  const bindingLength = context.bindingSequence.length;
  return (
    <div className="binding-diagram" aria-label="Primer 与模板结合位置示意图">
      <div className="diagram-meta">
        <span>{context.templateName}</span>
        <span>{context.start}–{context.end} · {context.strand === "+" ? "正向" : "反向"}</span>
        {context.meltingTemperature !== undefined && <span>Tm {context.meltingTemperature}°C</span>}
      </div>
      <div className="sequence-track">
        {context.strand === "+" && <div className="primer-arrow top-arrow" style={{ left: `${(prefixLength / top.length) * 100}%`, width: `${(bindingLength / top.length) * 100}%` }}>{context.primerSequence}</div>}
        <div className="sequence-line" aria-label="模板正链">{[...top].map((base, index) => <span className={index >= prefixLength && index < prefixLength + bindingLength ? "bound" : ""} key={`t${index}`}>{base}</span>)}</div>
        <div className="axis-line" />
        <div className="sequence-line muted" aria-label="模板互补链">{[...bottom].map((base, index) => <span className={index >= prefixLength && index < prefixLength + bindingLength ? "bound" : ""} key={`b${index}`}>{base}</span>)}</div>
        {context.strand === "-" && <div className="primer-arrow bottom-arrow" style={{ left: `${(prefixLength / top.length) * 100}%`, width: `${(bindingLength / top.length) * 100}%` }}>{context.primerSequence}</div>}
      </div>
      <p className="diagram-note">结合位点左右各显示最多 20 bp；坐标为 SnapGene 1-based。</p>
    </div>
  );
}

function PrimerDetail({ record, onEdit, onDelete, onReorder }: { record: PrimerRecord; onEdit: () => void; onDelete: () => void; onReorder: () => void }) {
  return (
    <div className="primer-detail">
      <div className="detail-grid">
        <div><span>5′→3′ 序列</span><code>{record.sequence}</code></div>
        <div><span>长度 / GC</span><strong>{record.normalized_sequence.length} nt · {gcPercent(record.sequence).toFixed(1)}%</strong></div>
        <div><span>来源</span><strong>{record.source_type}</strong></div>
        <div><span>备注</span><strong>{record.notes || "—"}</strong></div>
      </div>
      <div className="enzyme-list">
        <span className="detail-label">常用酶切位点</span>
        {record.enzyme_sites.length ? record.enzyme_sites.map((site, index) => (
          <span className="enzyme-chip" key={`${site.enzyme}-${site.start}-${index}`}>{site.enzyme}<small>{site.start}–{site.end}{site.strand}</small></span>
        )) : <span className="muted-text">未检测到</span>}
      </div>
      {record.binding_context && <BindingDiagram context={record.binding_context} />}
      <div className="detail-actions"><button className="reorder-action" onClick={onReorder}><RotateCcw />再次合成</button><button onClick={onEdit}><Settings2 />编辑</button><button className="danger" onClick={onDelete}><Trash2 />删除</button></div>
    </div>
  );
}

function ManualPrimerDialog({ initial, libraryRecords, onClose, onSave }: {
  initial?: PrimerRecord;
  libraryRecords: PrimerRecord[];
  onClose: () => void;
  onSave: (data: { name: string; sequence: string; orderedAt: string; notes: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sequence, setSequence] = useState(initial?.sequence ?? "");
  const [orderedAt, setOrderedAt] = useState(initial?.ordered_at ?? shanghaiToday());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const normalized = normalizeSequence(sequence);
  const duplicates = libraryRecords.filter((record) => record.id !== initial?.id && record.normalized_sequence === normalized).map((record) => record.name);
  const enzymeSites = scanRestrictionSites(normalized);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try { await onSave({ name: name.trim(), sequence: normalized, orderedAt, notes: [notes.trim(), duplicateNote(duplicates)].filter(Boolean).join("；") }); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose}><X /></button>
        <p className="eyebrow">PRIMER RECORD</p><h2>{initial ? "编辑 Primer" : "手动新增 Primer"}</h2>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>序列（5′→3′）<textarea value={sequence} onChange={(event) => setSequence(event.target.value)} required rows={3} /></label>
        <div className="inline-fields"><label>订购时间<input type="date" value={orderedAt} onChange={(event) => setOrderedAt(event.target.value)} required /></label><div className="readout"><span>标准化</span><strong>{normalized.length} nt · {enzymeSites.length} 个位点</strong></div></div>
        {duplicates.length > 0 && <div className="warning-box"><CircleAlert />序列与已有引物 {duplicates.join("、")} 相同，备注会自动记录。</div>}
        <label>备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} /></label>
        <button className="primary wide" disabled={busy || normalized.length < 4}>{busy && <LoaderCircle className="spin" />}保存</button>
      </form>
    </div>
  );
}

function LibraryView({ records, user, reload, onReorder }: { records: PrimerRecord[]; user: AppUser; reload: () => Promise<void>; onReorder: (record: PrimerRecord) => void }) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [enzyme, setEnzyme] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PrimerRecord | "new" | null>(null);
  const sequenceMatches = useMemo(() => findSequenceMatches(records, query), [records, query]);
  const enzymes = useMemo(() => [...new Set(records.flatMap((record) => record.enzyme_sites.map((site) => site.enzyme)))].sort(), [records]);
  const filtered = useMemo(() => records.filter((record) => {
    const needle = query.trim().toLowerCase();
    const textMatch = !needle || record.name.toLowerCase().includes(needle) || record.notes.toLowerCase().includes(needle) || record.normalized_sequence.toLowerCase().includes(needle) || sequenceMatches.has(record.id);
    return textMatch && (!fromDate || record.ordered_at >= fromDate) && (!toDate || record.ordered_at <= toDate) && (!enzyme || record.enzyme_sites.some((site) => site.enzyme === enzyme));
  }), [records, query, fromDate, toDate, enzyme, sequenceMatches]);

  async function saveManual(data: { name: string; sequence: string; orderedAt: string; notes: string }) {
    if (dialog && dialog !== "new") {
      await updatePrimer(user.id, dialog.id, { name: data.name, sequence: data.sequence, normalized_sequence: data.sequence, ordered_at: data.orderedAt, notes: data.notes, enzyme_sites: scanRestrictionSites(data.sequence) });
    } else {
      await insertPrimers(user.id, [{ name: data.name, sequence: data.sequence, normalized_sequence: data.sequence, ordered_at: data.orderedAt, enzyme_sites: scanRestrictionSites(data.sequence), notes: data.notes, binding_context: null, source_type: "manual" }]);
    }
    setDialog(null); await reload();
  }

  async function remove(record: PrimerRecord) {
    if (!window.confirm(`确定删除引物“${record.name}”吗？此操作不可撤销。`)) return;
    await deletePrimer(user.id, record.id); await reload();
  }

  const unique = new Set(records.map((record) => record.normalized_sequence)).size;
  return (
    <section className="page-section">
      <div className="page-heading"><div><p className="eyebrow">PRIMER LIBRARY</p><h1>我的 Primer 库</h1><p>按名称、序列片段、反向互补、日期或酶切位点快速定位历史记录。</p></div><button className="primary" onClick={() => setDialog("new")}><Plus />新增 Primer</button></div>
      <div className="stat-grid"><div><span>全部记录</span><strong>{records.length}</strong></div><div><span>唯一序列</span><strong>{unique}</strong></div><div><span>含酶切位点</span><strong>{records.filter((r) => r.enzyme_sites.length).length}</strong></div><div><span>含结合示意</span><strong>{records.filter((r) => r.binding_context).length}</strong></div></div>
      <div className="filter-bar">
        <label className="search-field"><Search /><input placeholder="名称、备注或短序列…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label><span>从</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label><span>至</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <select value={enzyme} onChange={(event) => setEnzyme(event.target.value)}><option value="">全部酶切酶</option>{enzymes.map((item) => <option key={item}>{item}</option>)}</select>
      </div>
      <div className="result-caption">显示 {filtered.length} / {records.length} 条</div>
      <div className="primer-table">
        <div className="primer-row table-head"><span>引物名称</span><span>长度</span><span>订购时间</span><span>酶切位点</span><span /></div>
        {filtered.map((record) => (
          <div className={`primer-record ${expanded === record.id ? "open" : ""}`} key={record.id}>
            <button className="primer-row" onClick={() => setExpanded(expanded === record.id ? null : record.id)}>
              <span className="primer-name"><Dna />{record.name}{record.notes.includes("序列与已有引物") && <small>重复序列</small>}</span>
              <span>{record.normalized_sequence.length} nt</span><span>{record.ordered_at}</span>
              <span className="mini-chips">{record.enzyme_sites.slice(0, 3).map((site) => <i key={`${site.enzyme}${site.start}`}>{site.enzyme}</i>)}{record.enzyme_sites.length > 3 && <i>+{record.enzyme_sites.length - 3}</i>}</span>
              <span>{expanded === record.id ? <ChevronDown /> : <ChevronRight />}</span>
            </button>
            {expanded === record.id && <PrimerDetail record={record} onEdit={() => setDialog(record)} onDelete={() => remove(record)} onReorder={() => onReorder(record)} />}
          </div>
        ))}
        {!filtered.length && <div className="empty-state"><Search /><h3>没有匹配的 Primer</h3><p>尝试缩短序列片段或清除日期、酶切酶筛选。</p></div>}
      </div>
      {dialog && <ManualPrimerDialog initial={dialog === "new" ? undefined : dialog} libraryRecords={records} onClose={() => setDialog(null)} onSave={saveManual} />}
    </section>
  );
}

function ImportedPrimerCard({ primer, onToggle }: { primer: ImportedPrimer; onToggle: () => void }) {
  return (
    <article className={`import-card ${primer.quality === "invalid" ? "invalid" : ""} ${primer.selected ? "selected" : ""}`}>
      <label className="import-select"><input type="checkbox" checked={primer.selected} disabled={primer.quality === "invalid"} onChange={onToggle} /><span /></label>
      <div className="import-main"><div className="import-title"><h3>{primer.name}</h3>{primer.dateAdded && <span className="tag">添加于 {primer.dateAdded.slice(0, 10)}</span>}{primer.duplicateNames.length ? <span className="tag amber">已有序列</span> : <span className="tag green">新 Primer</span>}{primer.quality === "invalid" && <span className="tag red">不合格</span>}</div>
        <code>{primer.sequence}</code><p>{primer.qualityReason}{primer.duplicateNames.length ? `；与 ${primer.duplicateNames.join("、")} 相同` : ""}</p>
        <div className="mini-chips">{primer.enzymeSites.map((site) => <i key={`${site.enzyme}-${site.start}`}>{site.enzyme} {site.start}–{site.end}</i>)}</div>
        {primer.bindingContext && <BindingDiagram context={primer.bindingContext} />}
      </div>
    </article>
  );
}

function OrderView({ records, templates, user, reload, reorderIds, onReorderIdsChange }: {
  records: PrimerRecord[];
  templates: OrderTemplate[];
  user: AppUser;
  reload: () => Promise<void>;
  reorderIds: string[];
  onReorderIdsChange: (ids: string[]) => void;
}) {
  const [imported, setImported] = useState<ImportedPrimer[]>([]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [defaults, setDefaults] = useState<OrderDefaults>(templates[0]?.defaults ?? DEFAULT_ORDER);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [onlyRecent, setOnlyRecent] = useState(true);
  const [reorderQuery, setReorderQuery] = useState("");
  useEffect(() => { if (!templateId && templates[0]) setTemplateId(templates[0].id); }, [templates, templateId]);
  useEffect(() => { const selected = templates.find((template) => template.id === templateId); if (selected) setDefaults(selected.defaults); }, [templateId, templates]);

  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMessage("");
    try {
      const parsed: ImportedPrimer[] = [];
      for (const file of [...files]) {
        const buffer = await file.arrayBuffer();
        if (/\.dna$/i.test(file.name)) parsed.push(...parseSnapGeneBuffer(buffer, file.name, { onlyRecent }));
        else parsed.push(...parsePrimerText(decodePrimerBuffer(buffer), file.name));
      }
      setImported(enrichImported(parsed, records));
      setMessage(parsed.length
        ? `已读取 ${parsed.length} 条自建 Primer，其中 ${parsed.filter((item) => item.quality === "invalid").length} 条未通过结合位点质量检查；SnapGene 内置 Primer 已自动忽略。`
        : `没有找到${onlyRecent ? "最近 7 天内" : "带添加时间的"}自建 Primer；SnapGene 内置 Primer 已自动忽略。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "文件解析失败"); }
    finally { setBusy(false); }
  }

  const selected = imported.filter((primer) => primer.selected && primer.quality === "valid");
  const reorderRecords = records.filter((record) => reorderIds.includes(record.id));
  const reorderPrimers = reorderRecords.map(recordToImported);
  const orderItems = [...reorderPrimers, ...selected];
  const reorderCandidates = records.filter((record) => {
    const needle = reorderQuery.trim().toLowerCase();
    return !needle || record.name.toLowerCase().includes(needle) || record.normalized_sequence.toLowerCase().includes(needle);
  }).slice(0, 10);
  function toggleReorder(recordId: string) {
    onReorderIdsChange(reorderIds.includes(recordId) ? reorderIds.filter((id) => id !== recordId) : [...reorderIds, recordId]);
  }
  async function generateOrder() {
    const template = templates.find((item) => item.id === templateId);
    if (!template || !orderItems.length) return;
    setBusy(true); setMessage("");
    try {
      const templateBuffer = await downloadTemplateFile(template);
      const output = await fillOrderTemplate(templateBuffer, template.mapping, orderItems, defaults);
      downloadBuffer(output, datedFileName(template.file_name));
      const orderedAt = shanghaiToday();
      if (selected.length) {
        await insertPrimers(user.id, selected.map((primer) => ({
          name: primer.name, sequence: primer.sequence, normalized_sequence: primer.normalizedSequence,
          ordered_at: orderedAt, enzyme_sites: primer.enzymeSites,
          notes: duplicateNote(primer.duplicateNames), binding_context: primer.bindingContext,
          source_type: primer.sourceType,
        })));
      }
      await Promise.all(reorderRecords.map((record) => updatePrimer(user.id, record.id, {
        ordered_at: orderedAt,
        notes: reorderNote(record, orderedAt),
      })));
      setMessage(`订单已下载：${selected.length} 条新 Primer，${reorderRecords.length} 条再次合成；库中最近订购时间已更新。`);
      setImported([]); onReorderIdsChange([]); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "订单生成失败"); }
    finally { setBusy(false); }
  }

  return (
    <section className="page-section">
      <div className="page-heading"><div><p className="eyebrow">IMPORT & ORDER</p><h1>读取、比对并生成订单</h1><p>`.dna` 文件在浏览器本地解析；新 Primer 默认选中，已有序列默认不选，不合格 Primer 禁止下单。</p></div></div>
      <div className="reorder-selector">
        <div className="reorder-heading"><div><p className="eyebrow">RE-SYNTHESIS</p><h2>再次合成已有 Primer</h2><p>搜索并选择多条库内记录，和新 Primer 合并到同一份订单。</p></div>{reorderRecords.length > 0 && <strong>{reorderRecords.length} 条已选</strong>}</div>
        <label className="search-field"><Search /><input placeholder="搜索已有 Primer 名称或序列…" value={reorderQuery} onChange={(event) => setReorderQuery(event.target.value)} /></label>
        <div className="reorder-candidates">{reorderCandidates.map((record) => {
          const active = reorderIds.includes(record.id);
          return <button className={active ? "active" : ""} onClick={() => toggleReorder(record.id)} key={record.id}><span>{record.name}</span><small>{record.normalized_sequence.length} nt · 上次 {record.ordered_at}</small>{active ? <X /> : <Plus />}</button>;
        })}</div>
      </div>
      <label className="import-option"><input type="checkbox" checked={onlyRecent} onChange={(event) => setOnlyRecent(event.target.checked)} /><span>只读取最近 7 天新增的 Primer（推荐）</span></label>
      <label className="drop-zone"><input type="file" multiple accept=".dna,.txt,.tsv,.csv,text/plain" onChange={(event) => readFiles(event.target.files)} /><Upload /><strong>{busy ? "正在解析…" : "拖入或选择 SnapGene 文件"}</strong><span>支持 `.dna`、TXT、TSV、CSV；可一次选择多个文件</span></label>
      {message && <div className="status-banner"><Cloud />{message}</div>}
      {imported.length > 0 && <>
        <div className="section-toolbar"><div><h2>筛选确认</h2><p>{selected.length} 条已选 / {imported.length} 条读取</p></div><div><button onClick={() => setImported(imported.map((item) => ({ ...item, selected: item.quality === "valid" })))}>选择全部合格</button><button onClick={() => setImported(imported.map((item) => ({ ...item, selected: false })))}>清空</button></div></div>
        <div className="import-list">{imported.map((primer) => <ImportedPrimerCard key={primer.localId} primer={primer} onToggle={() => setImported(imported.map((item) => item.localId === primer.localId ? { ...item, selected: !item.selected } : item))} />)}</div>
      </>}
      {orderItems.length > 0 && <div className="order-panel"><div><p className="eyebrow">ORDER OUTPUT</p><h2>订单设置</h2><p>{selected.length} 条新 Primer · {reorderRecords.length} 条再次合成</p></div>
          {templates.length ? <div className="order-form"><label>订单模板<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
            <label>合成规格<input value={defaults.spec} onChange={(event) => setDefaults({ ...defaults, spec: event.target.value })} /></label><label>分装管数<input value={defaults.tubes} onChange={(event) => setDefaults({ ...defaults, tubes: event.target.value })} /></label><label>纯化方式<input value={defaults.purification} onChange={(event) => setDefaults({ ...defaults, purification: event.target.value })} /></label><label>修饰<input value={defaults.modification} onChange={(event) => setDefaults({ ...defaults, modification: event.target.value })} /></label><label>交付形式<input value={defaults.delivery} onChange={(event) => setDefaults({ ...defaults, delivery: event.target.value })} /></label><label className="wide-field">统一备注<input value={defaults.notes} onChange={(event) => setDefaults({ ...defaults, notes: event.target.value })} /></label>
            <button className="primary wide-field" disabled={busy || !orderItems.length} onClick={generateOrder}><Download />生成并下载订单 · {orderItems.length} 条</button></div> : <div className="empty-inline"><FileSpreadsheet />请先到“订单模板”上传并保存一个模板。</div>}
      </div>}
    </section>
  );
}

function TemplateEditor({ file, initial, onCancel, onSaved, user }: { file: File; initial: TemplateMapping; onCancel: () => void; onSaved: () => Promise<void>; user: AppUser }) {
  const [name, setName] = useState(file.name.replace(/\.xlsx$/i, ""));
  const [mapping, setMapping] = useState(initial);
  const [defaults, setDefaults] = useState(DEFAULT_ORDER);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const setColumn = (field: TemplateField, value: string) => setMapping({ ...mapping, columns: { ...mapping.columns, [field]: value ? Number(value) : undefined } });
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await saveTemplate(user.id, { name, file_name: file.name, mapping, defaults }, file); await onSaved(); }
    catch (error) { setMessage(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请稍后重试。 "); }
    finally { setBusy(false); }
  }
  return (
    <form className="template-editor" onSubmit={submit}>
      <div className="editor-head"><div><p className="eyebrow">FIELD MAPPING</p><h2>确认模板字段</h2><p>列号从 A=1 开始。系统已自动识别，请只修正不准确的字段。</p></div><button type="button" onClick={onCancel}><X /></button></div>
      <div className="template-meta"><label>模板名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>工作表<input value={mapping.sheetName} onChange={(event) => setMapping({ ...mapping, sheetName: event.target.value })} required /></label><label>表头行<input type="number" min="1" value={mapping.headerRow} onChange={(event) => setMapping({ ...mapping, headerRow: Number(event.target.value) })} /></label><label>首条数据行<input type="number" min="1" value={mapping.firstDataRow} onChange={(event) => setMapping({ ...mapping, firstDataRow: Number(event.target.value) })} /></label><label>模板容量<input type="number" min="1" value={mapping.capacity} onChange={(event) => setMapping({ ...mapping, capacity: Number(event.target.value) })} /></label></div>
      <div className="mapping-grid">{(Object.keys(FIELD_LABELS) as TemplateField[]).map((field) => <label key={field}><span>{FIELD_LABELS[field]}{(field === "name" || field === "sequence") && <b>*</b>}</span><input type="number" min="1" max="100" value={mapping.columns[field] ?? ""} onChange={(event) => setColumn(field, event.target.value)} required={field === "name" || field === "sequence"} placeholder="未映射" /></label>)}</div>
      <h3>此模板的默认订购参数</h3><div className="template-meta"><label>规格<input value={defaults.spec} onChange={(e) => setDefaults({ ...defaults, spec: e.target.value })} /></label><label>管数<input value={defaults.tubes} onChange={(e) => setDefaults({ ...defaults, tubes: e.target.value })} /></label><label>纯化<input value={defaults.purification} onChange={(e) => setDefaults({ ...defaults, purification: e.target.value })} /></label><label>修饰<input value={defaults.modification} onChange={(e) => setDefaults({ ...defaults, modification: e.target.value })} /></label><label>交付<input value={defaults.delivery} onChange={(e) => setDefaults({ ...defaults, delivery: e.target.value })} /></label></div>
      {message && <div className="status-banner error"><CircleAlert />{message}</div>}
      <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />}{busy ? "正在保存…" : "保存到私有模板库"}</button>
    </form>
  );
}

function TemplatesView({ templates, user, reload }: { templates: OrderTemplate[]; user: AppUser; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<{ file: File; mapping: TemplateMapping } | null>(null);
  const [message, setMessage] = useState("");
  async function selectFile(file?: File) {
    if (!file) return;
    try { setDraft({ file, mapping: await detectTemplateMapping(await file.arrayBuffer()) }); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "模板识别失败"); }
  }
  async function remove(item: OrderTemplate) {
    if (!window.confirm(`删除模板“${item.name}”？`)) return;
    await removeTemplate(user.id, item); await reload();
  }
  return (
    <section className="page-section"><div className="page-heading"><div><p className="eyebrow">ORDER TEMPLATES</p><h1>订单模板</h1><p>上传包含客户单位和联系方式的原始 Excel 订单表。系统生成订单时只填写引物数据区域，上方内容保持原样；模板仅当前用户可访问。</p></div></div>
      {!draft && <label className="drop-zone compact"><input type="file" accept=".xlsx" onChange={(event) => selectFile(event.target.files?.[0])} /><FileSpreadsheet /><strong>上传自己的 Excel 订单模板</strong><span>客户信息和表头原样保留，只识别并填写引物数据列</span></label>}
      {message && <div className="status-banner error"><CircleAlert />{message}</div>}
      {draft && <TemplateEditor file={draft.file} initial={draft.mapping} user={user} onCancel={() => setDraft(null)} onSaved={async () => { setDraft(null); await reload(); }} />}
      <div className="template-list"><h2>我的模板</h2>{templates.length ? templates.map((item) => <article key={item.id}><div className="file-icon"><FileSpreadsheet /></div><div><h3>{item.name}</h3><p>{item.file_name} · {item.mapping.sheetName} · 第 {item.mapping.firstDataRow} 行起填写引物</p></div><button className="icon-button danger" onClick={() => remove(item)}><Trash2 /></button></article>) : <div className="empty-inline"><FileSpreadsheet />尚未上传模板，请先上传自己的订单表。</div>}</div>
    </section>
  );
}

function BackupView({ records, user, reload }: { records: PrimerRecord[]; user: AppUser; reload: () => Promise<void> }) {
  const directoryInput = useRef<HTMLInputElement>(null);
  const [migration, setMigration] = useState<Array<Omit<PrimerRecord, "id" | "user_id" | "created_at" | "updated_at">>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { directoryInput.current?.setAttribute("webkitdirectory", ""); directoryInput.current?.setAttribute("directory", ""); }, []);
  async function exportXlsx() { downloadBuffer(await exportPrimerLibrary(records), `HC-PrimerHub-backup-${shanghaiToday()}.xlsx`); }
  function exportCsv() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["引物名称", "序列", "订购时间", "酶切位点", "备注"], ...records.map((r) => [r.name, r.sequence, r.ordered_at, r.enzyme_sites.map((s) => `${s.enzyme} ${s.start}-${s.end}`).join("; "), r.notes])];
    const csv = `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`;
    downloadBuffer(new TextEncoder().encode(csv).buffer, `HC-PrimerHub-backup-${shanghaiToday()}.csv`, "text/csv;charset=utf-8");
  }
  async function scanHistory(files: FileList | null) {
    if (!files?.length) return; setBusy(true); setMessage("");
    try { const parsed = await parseHistoricalOrders([...files]); setMigration(parsed); setMessage(`识别到 ${parsed.length} 条历史订购记录，来自带日期的订单工作簿。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "历史订单读取失败"); }
    finally { setBusy(false); }
  }
  async function commitMigration() {
    setBusy(true);
    try {
      for (let start = 0; start < migration.length; start += 200) await insertPrimers(user.id, migration.slice(start, start + 200));
      setMessage(`已导入 ${migration.length} 条历史记录。`); setMigration([]); await reload();
    } finally { setBusy(false); }
  }
  return (
    <section className="page-section"><div className="page-heading"><div><p className="eyebrow">BACKUP & MIGRATION</p><h1>备份与迁移</h1><p>随时导出全部 Primer 数据。文件生成在浏览器本地，不上传备份副本。</p></div></div>
      <div className="backup-grid"><article><Download /><h2>Excel 备份</h2><p>包含序列、订购时间、酶切位点、模板结合坐标与备注。</p><button className="primary" onClick={exportXlsx}>导出 XLSX</button></article><article><Download /><h2>通用 CSV</h2><p>便于导入其他数据库或用脚本继续处理。</p><button onClick={exportCsv}>导出 CSV</button></article></div>
      <div className="migration-panel"><p className="eyebrow">HISTORY MIGRATION</p><h2>首次历史订单迁移</h2><p>选择保存历史订单的文件夹。系统只读取带日期的订单 `.xlsx`，自动忽略汇总表、临时文件和无日期文件；导入结果仅写入当前账号。</p><input ref={directoryInput} type="file" multiple accept=".xlsx" onChange={(event) => scanHistory(event.target.files)} />
        <button onClick={() => directoryInput.current?.click()} disabled={busy}><Upload />{busy ? "正在读取…" : "选择历史订单文件夹"}</button>
        {message && <div className="status-banner"><Cloud />{message}</div>}
        {migration.length > 0 && <div className="migration-summary"><strong>{migration.length} 条待导入</strong><span>{new Set(migration.map((r) => r.normalized_sequence)).size} 个唯一序列</span><span>{migration.filter((r) => r.notes).length} 条重复序列备注</span><button className="primary" onClick={commitMigration} disabled={busy}>确认写入 {user.email}</button></div>}
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>("library");
  const [menuOpen, setMenuOpen] = useState(false);
  const [records, setRecords] = useState<PrimerRecord[]>([]);
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  const [loadedUserId, setLoadedUserId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reorderIds, setReorderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const user: AppUser | null = demo ? DEMO_USER : session?.user ? { id: session.user.id, email: session.user.email } : null;

  useEffect(() => {
    getSession().then(setSession).finally(() => setBooting(false));
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  async function reload() {
    if (!user) return;
    setLoading(true); setLoadError("");
    try {
      const [nextRecords, nextTemplates] = await Promise.all([loadPrimers(user.id), loadTemplates(user.id)]);
      setRecords(nextRecords); setTemplates(nextTemplates);
      setLoadedUserId(user.id);
    }
    catch (error) { setLoadError(error instanceof Error ? error.message : "私有数据读取失败"); throw error; }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!user) return;
    setLoadedUserId(""); setRecords([]); setTemplates([]);
    void reload().catch(() => undefined);
  }, [user?.id]);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setDemo(false); setSession(null); setLoadedUserId(""); setRecords([]); setTemplates([]);
  }
  if (booting) return <div className="splash"><div className="brand-mark large"><Dna /></div><LoaderCircle className="spin" /></div>;
  if (!user) return <AuthScreen onDemo={() => setDemo(true)} />;

  const tabs: Array<{ id: Tab; label: string; icon: typeof Library }> = [
    { id: "library", label: "Primer 库", icon: Library }, { id: "order", label: "导入并下单", icon: FlaskConical },
    { id: "templates", label: "订单模板", icon: FileSpreadsheet }, { id: "backup", label: "备份与迁移", icon: Archive },
  ];
  return (
    <div className="app-shell">
      <aside className={menuOpen ? "open" : ""}><div className="side-brand"><div className="brand-mark"><Dna /></div><div><strong>HC PrimerHub</strong><span>PRIVATE WORKSPACE</span></div><button className="menu-close" onClick={() => setMenuOpen(false)}><X /></button></div>
        <nav>{tabs.map((item) => { const Icon = item.icon; return <button className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setMenuOpen(false); }} key={item.id}><Icon />{item.label}</button>; })}</nav>
        <div className="side-user"><div className="avatar">{user.email?.[0]?.toUpperCase()}</div><div><strong>{user.email}</strong><span>{isSupabaseConfigured ? "云端已同步" : "本地演示模式"}</span></div><button onClick={logout}><LogOut /></button></div>
      </aside>
      <div className="app-main"><header className="mobile-header"><button onClick={() => setMenuOpen(true)}><Menu /></button><strong>HC PrimerHub</strong>{loading ? <LoaderCircle className="spin" /> : <Cloud />}</header>
        {loadedUserId !== user.id ? <div className="page-loader">{loadError ? <><CircleAlert /><span>{loadError}</span><button className="primary" onClick={() => void reload().catch(() => undefined)}>重新读取</button></> : <><LoaderCircle className="spin" /><span>正在读取私有数据…</span></>}</div> : <>
          {tab === "library" && <LibraryView records={records} user={user} reload={reload} onReorder={(record) => { setReorderIds((ids) => ids.includes(record.id) ? ids : [...ids, record.id]); setTab("order"); }} />}
          {tab === "order" && <OrderView records={records} templates={templates} user={user} reload={reload} reorderIds={reorderIds} onReorderIdsChange={setReorderIds} />}
          {tab === "templates" && <TemplatesView templates={templates} user={user} reload={reload} />}
          {tab === "backup" && <BackupView records={records} user={user} reload={reload} />}
        </>}
      </div>
      {menuOpen && <button className="nav-backdrop" onClick={() => setMenuOpen(false)} />}
    </div>
  );
}
