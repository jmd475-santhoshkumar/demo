"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plug, CheckCircle2, AlertCircle, UploadCloud, Loader2, Eye, FileSpreadsheet, Search,
  Sun, Moon, Monitor, Database, ShieldCheck, Table2, ChevronDown, Download, AlertTriangle,
  CalendarOff, Activity, MessageSquareText, TrendingUp, Target, Wallet, Coins, BookOpen,
} from "lucide-react";
import {
  api,
  type DataSourceInfo, type DatasetTablePreview, type DatasetSchemaSheet,
  type JdwhConnectionConfig, type JdwhAuthType, type JdwhEncryptOption, type JdwhDiscoveredTable, type JdwhLoadTablesResult,
  type JdwhUploadTableKey, type JdwhWorkbookPreview, type JdwhFilePreview, type JdwhRevertResult,
} from "@/lib/api";
import { ErrorState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { Modal } from "@/components/shared/Modal";
import { JMAN } from "@/lib/brandColors";
import { cn } from "@/lib/utils";

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function formatCell(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return v.slice(0, 10);
  return String(v);
}

// Skill Matrix -- a person (the employee) paired with rising skill-level
// bars, reads directly as "this person's skill levels", not an abstract grid.
function SkillMatrixGlyph({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <circle cx="6.8" cy="6.2" r="2.6" fill={color} />
      <path d="M1.6 18c0-4.9 2.9-7.6 5.2-7.6s5.2 2.7 5.2 7.6z" fill={color} />
      <rect x="14.6" y="13" width="2.3" height="5" rx="1" fill={color} opacity="0.5" />
      <rect x="17.9" y="9" width="2.3" height="9" rx="1" fill={color} opacity="0.75" />
      <rect x="21.2" y="5" width="2.3" height="13" rx="1" fill={color} />
    </svg>
  );
}

// Competency -- a certified/verified badge (medal + ribbon tails + check),
// reads as "assessed and confirmed", distinct from the skill-grid glyph above.
function CompetencyGlyph({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M7.2 14.2L4.6 21l4.4-1.6 1.6 2.4 2.3-6.1" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.8 14.2L19.4 21l-4.4-1.6-1.6 2.4-2.3-6.1" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="9" r="6.3" fill={color} opacity="0.12" stroke={color} strokeWidth="1.6" />
      <path d="M9 9.1l2 2 4-4.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type DatasetIconConfig =
  | { kind: "glyph"; render: (p: { color: string; className?: string }) => React.ReactNode; color: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: "icon"; render: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string };

const DATASET_ICON: Record<string, DatasetIconConfig> = {
  skill_matrix: { kind: "glyph", render: SkillMatrixGlyph, color: JMAN.emerald },
  competency: { kind: "glyph", render: CompetencyGlyph, color: JMAN.trypanBlue },
  demand_file: { kind: "image", src: "/hubspot_logo.png", alt: "HubSpot" },
  pipeline_data: { kind: "image", src: "/hubspot_logo.png", alt: "HubSpot" },
  leaves: { kind: "icon", render: CalendarOff, color: JMAN.rose },
  weekly_pulse: { kind: "icon", render: Activity, color: JMAN.amethyst },
  hr_feedback: { kind: "icon", render: MessageSquareText, color: JMAN.midnightBlue },
  performance_cycles: { kind: "icon", render: TrendingUp, color: JMAN.amber },
  performance_kra_items: { kind: "icon", render: Target, color: JMAN.trypanBlue },
  budgets_jin: { kind: "icon", render: Wallet, color: JMAN.emerald },
  budget_resources_jin: { kind: "icon", render: Coins, color: JMAN.turquoise },
  coe_skills_mapping: { kind: "icon", render: BookOpen, color: JMAN.amethyst },
};

// Accent used for table headers/highlights even where the tile itself is a
// brand image (demand_file/pipeline_data) rather than a tinted glyph --
// HubSpot's own orange, so its tables still carry a distinct identity color.
const DATASET_ACCENT: Record<string, string> = {
  skill_matrix: JMAN.emerald,
  competency: JMAN.trypanBlue,
  demand_file: "#FF7A59",
  pipeline_data: "#FF7A59",
  leaves: JMAN.rose,
  weekly_pulse: JMAN.amethyst,
  hr_feedback: JMAN.midnightBlue,
  performance_cycles: JMAN.amber,
  performance_kra_items: JMAN.trypanBlue,
  budgets_jin: JMAN.emerald,
  budget_resources_jin: JMAN.turquoise,
  coe_skills_mapping: JMAN.amethyst,
};

function DatasetIconTile({ datasetKey }: { datasetKey: string }) {
  const cfg = DATASET_ICON[datasetKey];
  if (cfg?.kind === "image") {
    return (
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-1">
        <Image src={cfg.src} alt={cfg.alt} width={28} height={28} className="object-contain w-full h-full" />
      </div>
    );
  }
  const color = cfg?.kind === "glyph" || cfg?.kind === "icon" ? cfg.color : JMAN.emerald;
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}14` }}>
      {cfg?.kind === "glyph" ? cfg.render({ color, className: "w-5 h-5" }) : null}
      {cfg?.kind === "icon" ? <cfg.render className="w-5 h-5" style={{ color }} /> : null}
    </div>
  );
}

function MiniTable({
  columns,
  rows,
  accentColor = JMAN.emerald,
  maxHeight = "max-h-[420px]",
}: {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  accentColor?: string;
  maxHeight?: string;
}) {
  return (
    <div className={cn("overflow-auto rounded-lg border border-gray-200 dark:border-gray-700", maxHeight)}>
      <table className="w-full text-[11px] border-collapse">
        <thead className="text-white sticky top-0 z-10" style={{ background: `linear-gradient(135deg, ${accentColor} 0%, ${JMAN.turquoise} 100%)` }}>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                className={cn("text-left font-semibold px-2.5 py-2 whitespace-nowrap", i < columns.length - 1 && "border-r border-white/25")}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={cn("border-b border-gray-100 dark:border-gray-800 last:border-0", i % 2 === 1 && "bg-gray-50/60 dark:bg-gray-800/60")}>
              {row.map((v, j) => (
                <td
                  key={j}
                  className={cn("px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap", j < row.length - 1 && "border-r border-gray-100 dark:border-gray-800")}
                >
                  {formatCell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewModal({
  dataKey,
  label,
  accentColor,
  onClose,
}: {
  dataKey: string;
  label: string;
  accentColor: string;
  onClose: () => void;
}) {
  const [rowsInput, setRowsInput] = useState("20");
  const [appliedRows, setAppliedRows] = useState(20);
  const preview = useQuery({
    queryKey: ["admin-dataset-preview", dataKey, appliedRows],
    queryFn: () => api.adminDatasetPreview(dataKey, appliedRows),
  });

  const applyRows = () => {
    const n = Math.min(5000, Math.max(1, parseInt(rowsInput, 10) || 20));
    setRowsInput(String(n));
    setAppliedRows(n);
  };

  return (
    <Modal title={`${label} -- current data`} subtitle="Exactly what's loaded right now, straight from the live database." onClose={onClose} widthClassName="max-w-5xl">
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">Show</span>
          <input
            type="number"
            min={1}
            max={5000}
            value={rowsInput}
            onChange={(e) => setRowsInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyRows()}
            className="w-20 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none focus:border-primary/50"
          />
          <span className="text-[11px] text-gray-400 dark:text-gray-500">rows</span>
          <button
            onClick={applyRows}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-white"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            <Search className="w-3 h-3" /> Go
          </button>
        </div>

        {preview.isLoading && <Skeleton className="h-40 w-full rounded-lg" />}
        {preview.error && <ErrorState message="Could not load current data." />}
        {preview.data?.tables.map((t: DatasetTablePreview) => (
          <div key={t.label} className="space-y-1.5">
            {preview.data!.tables.length > 1 && <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{t.label}</p>}
            {t.error ? (
              <p className="text-xs text-red-500 dark:text-red-400">{t.error}</p>
            ) : (
              <>
                <MiniTable columns={t.columns} rows={t.rows} accentColor={accentColor} />
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Showing {t.rows.length.toLocaleString()} of {t.total_row_count.toLocaleString()} row(s).
                  {t.truncated && " Increase the row count above to see more."}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SchemaModal({
  dataKey,
  label,
  fileType,
  accentColor,
  onClose,
  onChooseFile,
}: {
  dataKey: string;
  label: string;
  fileType: "csv" | "xlsx";
  accentColor: string;
  onClose: () => void;
  onChooseFile: () => void;
}) {
  const schema = useQuery({ queryKey: ["admin-dataset-schema", dataKey], queryFn: () => api.adminDatasetSchema(dataKey) });

  return (
    <Modal
      title={`${label} -- expected format`}
      subtitle={`Upload a .${fileType} matching this exact column layout${fileType === "xlsx" ? " (all sheets required)" : ""}.`}
      onClose={onClose}
      widthClassName="max-w-3xl"
    >
      <div className="p-5 space-y-4">
        {schema.isLoading && <Skeleton className="h-40 w-full rounded-lg" />}
        {schema.error && <ErrorState message="Could not load the expected format." />}
        {schema.data?.sheets.map((s: DatasetSchemaSheet) => (
          <div key={s.sheet_name ?? "sheet"} className="space-y-1.5">
            {s.sheet_name && (
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" /> Sheet: {s.sheet_name}
              </p>
            )}
            <MiniTable
              columns={s.columns}
              rows={s.sample_rows.map((r) => s.columns.map((c) => r[c]))}
              accentColor={accentColor}
              maxHeight="max-h-64"
            />
          </div>
        ))}
        <div className="flex items-center justify-end pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={onChooseFile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Choose .{fileType} file to upload
          </button>
        </div>
      </div>
    </Modal>
  );
}

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the real theme after mount (it reads
  // localStorage/system preference client-side) -- rendering the selected
  // state before that would either flash the wrong option or mismatch
  // between server and client HTML, so the control stays in its (harmless)
  // default look until then.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Inline control (no card wrapper) -- lives next to the page title now
  // instead of taking a full-width card of its own for a single 3-button
  // toggle.
  return (
    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-800 p-0.5 bg-gray-50 dark:bg-gray-800/60 flex-shrink-0">
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition",
            mounted && theme === value
              ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

const JDWH_AUTH_TYPES: JdwhAuthType[] = ["Microsoft Entra ID - Universal with MFA support", "SQL Login", "Windows Authentication"];
const JDWH_ENCRYPT_OPTIONS: JdwhEncryptOption[] = ["Mandatory", "Optional", "Strict"];

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] items-center gap-3">
      <label className="text-xs text-gray-500 dark:text-gray-400">{label}</label>
      {children}
    </div>
  );
}

const jdwhInputClass =
  "w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-xs outline-none focus:border-primary/50";

const UPLOAD_TABLE_SLOTS: { key: JdwhUploadTableKey; label: string; required: boolean }[] = [
  { key: "employee", label: "Employee", required: true },
  { key: "project", label: "Project", required: true },
  { key: "project_allocation", label: "Project Allocation", required: true },
  { key: "timesheet", label: "Timesheet", required: true },
  { key: "weekly_status_report", label: "Weekly Status Report", required: true },
  { key: "designation_history", label: "Designation History", required: false },
];

const jdwhFileInputClass = "text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:px-2 file:py-1 file:rounded-md file:border file:border-gray-200 dark:file:border-gray-700 file:bg-gray-50 dark:file:bg-gray-800 file:text-gray-600 dark:file:text-gray-300 file:text-xs";

// No live connection needed -- a real export of the warehouse's tables,
// uploaded either as one workbook (6 sheets, same shape as the data team's
// own UAT sample) or as 6 separate files. Feeds the exact same mapping and
// result as the live path (JdwhConnectionPanel below): replaces this app's
// local employee/project/allocation/timesheet/WSR data.
type FilePreviewState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; preview: JdwhFilePreview };

function JdwhUploadPanel() {
  const [shape, setShape] = useState<"workbook" | "files">("workbook");
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [files, setFiles] = useState<Record<JdwhUploadTableKey, File | null>>({
    employee: null, designation_history: null, project: null,
    project_allocation: null, timesheet: null, weekly_status_report: null,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<JdwhLoadTablesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fires the instant a file is picked -- real confirmation (sheet names,
  // row/column counts, never a cell value) that the file was actually read,
  // shown well before the destructive Load step.
  const workbookPreview = useMutation({ mutationFn: (f: File) => api.jdwhPreviewWorkbook(f) });
  const [filePreviews, setFilePreviews] = useState<Partial<Record<JdwhUploadTableKey, FilePreviewState>>>({});

  const handleWorkbookChange = (f: File | null) => {
    setWorkbookFile(f);
    setResult(null);
    setError(null);
    if (f) workbookPreview.mutate(f);
    else workbookPreview.reset();
  };

  const handleFileChange = (key: JdwhUploadTableKey, f: File | null) => {
    setFiles((prev) => ({ ...prev, [key]: f }));
    setResult(null);
    setError(null);
    if (!f) {
      setFilePreviews((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setFilePreviews((prev) => ({ ...prev, [key]: { status: "loading" } }));
    api.jdwhPreviewFile(f).then(
      (preview) => setFilePreviews((prev) => ({ ...prev, [key]: { status: "ok", preview } })),
      (e: Error) => setFilePreviews((prev) => ({ ...prev, [key]: { status: "error", message: e.message } }))
    );
  };

  const upload = useMutation({
    mutationFn: () => (shape === "workbook" ? api.jdwhUploadWorkbook(workbookFile as File) : api.jdwhUploadFiles(files)),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      setConfirmOpen(false);
    },
    onError: (e: Error) => {
      setError(e.message);
      setConfirmOpen(false);
    },
  });

  const workbookPreviewOk = workbookPreview.data && workbookPreview.data.missing_required.length === 0;
  const filesPreviewOk = UPLOAD_TABLE_SLOTS.filter((t) => t.required).every((t) => filePreviews[t.key]?.status === "ok");
  const canUpload = shape === "workbook" ? !!workbookFile && workbookPreviewOk : !!filesPreviewOk;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Upload a real export of the warehouse&apos;s tables -- no live connection needed.
      </p>

      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800/60">
        {(["workbook", "files"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setShape(s)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition",
              shape === s
                ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            )}
          >
            {s === "workbook" ? "One workbook (6 sheets)" : "6 separate files"}
          </button>
        ))}
      </div>

      {shape === "workbook" ? (
        <div className="space-y-1.5">
          <label className="text-xs text-gray-500 dark:text-gray-400 block">
            Sheets must be named exactly: employee, project, project_allocation, timesheet, weekly_status_report.
          </label>
          <input
            type="file"
            accept=".xlsx,.xls,.ods"
            onChange={(e) => handleWorkbookChange(e.target.files?.[0] ?? null)}
            className={jdwhFileInputClass}
          />

          {workbookPreview.isPending && (
            <p className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Reading file…
            </p>
          )}
          {workbookPreview.isError && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {(workbookPreview.error as Error).message}
            </p>
          )}
          {workbookPreview.data && (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2 space-y-1">
              {workbookPreview.data.sheets.map((s) => (
                <div key={s.sheet_name} className="flex items-center gap-2 text-[11px]">
                  <Table2 className="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <span className="font-mono text-gray-600 dark:text-gray-300">{s.sheet_name}</span>
                  <span className="text-gray-400 dark:text-gray-500">
                    {s.row_count != null ? `${s.row_count.toLocaleString()} rows, ${s.column_count} cols` : "could not read"}
                  </span>
                  <div className="flex-1" />
                  {s.is_required_table && <Badge variant="green">found</Badge>}
                </div>
              ))}
              {workbookPreview.data.missing_required.length > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400 pt-1">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  Missing required sheet(s): {workbookPreview.data.missing_required.join(", ")} -- rename the
                  matching sheets in the workbook to exactly this name and re-select it.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {UPLOAD_TABLE_SLOTS.map((t) => {
            const preview = filePreviews[t.key];
            return (
              <FormRow key={t.key} label={t.label + (t.required ? " *" : " (optional)")}>
                <div className="space-y-1">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.ods"
                    onChange={(e) => handleFileChange(t.key, e.target.files?.[0] ?? null)}
                    className={jdwhFileInputClass}
                  />
                  {preview?.status === "loading" && (
                    <p className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                      <Loader2 className="w-3 h-3 animate-spin" /> Reading file…
                    </p>
                  )}
                  {preview?.status === "error" && (
                    <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {preview.message}
                    </p>
                  )}
                  {preview?.status === "ok" && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      Read &quot;{preview.preview.sheet_name}&quot; -- {preview.preview.row_count.toLocaleString()} rows,{" "}
                      {preview.preview.column_count} cols
                    </p>
                  )}
                </div>
              </FormRow>
            );
          })}
        </div>
      )}

      {!confirmOpen ? (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!canUpload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:border-amber-400 dark:hover:border-amber-600 disabled:opacity-40"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          Load from upload
        </button>
      ) : (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2.5">
          <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This replaces the app&apos;s live employee/project/allocation/timesheet/WSR data right now. Continue?
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => upload.mutate()}
              disabled={upload.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40"
            >
              {upload.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Yes, load real data
            </button>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={upload.isPending}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && result.empty_tables.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {result.empty_tables.join(", ")} ended up with 0 rows -- this can break pages that expect real data.
            Use Revert below to undo this.
          </span>
        </div>
      )}
      {result && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Loaded {Object.entries(result.row_counts).map(([k, n]) => `${k}: ${n.toLocaleString()}`).join(", ")}.
            Previous data backed up -- see Revert below if needed.
          </span>
        </div>
      )}
    </div>
  );
}

// Shared by both Live Connection and Excel Upload -- either path's Load
// Tables keeps one backup generation (see dataset_store.replace_table), so
// one Revert control covers whichever one was actually used. Only the state
// right before the MOST RECENT Load Tables can be restored -- not a list of
// past snapshots to choose between.
const BACKUP_TABLE_LABELS: Record<string, string> = {
  employees: "Employees", projects: "Projects", allocations: "Allocations",
  timesheets: "Timesheets", wsr_reports: "WSR",
};

function backupLooksHealthy(rowCounts: Record<string, number>): boolean {
  return Object.values(rowCounts).every((n) => n > 0);
}

function JdwhRevertPanel() {
  const queryClient = useQueryClient();
  const backups = useQuery({ queryKey: ["jdwh-backups"], queryFn: api.jdwhBackups });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<JdwhRevertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revert = useMutation({
    mutationFn: () => api.jdwhRevert(),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["jdwh-backups"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setConfirmOpen(false);
    },
  });

  const backup = backups.data?.backups?.[0];
  if (backups.isLoading || !backup) return null;
  const healthy = backupLooksHealthy(backup.row_counts);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Data from before the last Load Tables</span>
          <Badge variant={healthy ? "green" : "red"}>{healthy ? "looks healthy" : "looks broken"}</Badge>
        </div>
        {!confirmOpen ? (
          <button
            onClick={() => setConfirmOpen(true)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
          >
            Revert to this
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => revert.mutate()}
              disabled={revert.isPending}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40"
            >
              {revert.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Yes, revert
            </button>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={revert.isPending}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(backup.row_counts).map(([key, count]) => (
          <span
            key={key}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full border",
              count > 0
                ? "bg-gray-50 dark:bg-gray-800/60 border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400"
                : "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-400"
            )}
          >
            {BACKUP_TABLE_LABELS[key] ?? key}: {count.toLocaleString()}
          </span>
        ))}
      </div>
      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}
      {result && (
        <p className="flex items-start gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Reverted: {result.restored_tables.join(", ")}.
        </p>
      )}
    </div>
  );
}

function JdwhTab() {
  const [source, setSource] = useState<"live" | "upload">("live");
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800/60">
        {(["live", "upload"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition",
              source === s
                ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            )}
          >
            {s === "live" ? "Live Connection" : "Excel Upload"}
          </button>
        ))}
      </div>
      {source === "live" ? <JdwhConnectionPanel /> : <JdwhUploadPanel />}
      <JdwhRevertPanel />
    </div>
  );
}

// Mirrors Azure Data Studio's own "Connect to SQL Server" dialog field-for-
// field -- the RM already knows this exact form from Data Studio, so there's
// nothing new to learn here, just where to type the same values in-app.
function JdwhConnectionPanel() {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ["jdwh-connection"], queryFn: api.jdwhConnection });
  const expectedTables = useQuery({ queryKey: ["jdwh-expected-tables"], queryFn: api.jdwhExpectedTables });

  const [cfg, setCfg] = useState<JdwhConnectionConfig | null>(null);
  const [password, setPassword] = useState("");
  const [discovered, setDiscovered] = useState<JdwhDiscoveredTable[] | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [loadConfirmOpen, setLoadConfirmOpen] = useState(false);
  const [loadResult, setLoadResult] = useState<JdwhLoadTablesResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data) setCfg(saved.data);
  }, [saved.data]);

  const update = <K extends keyof JdwhConnectionConfig>(key: K, value: JdwhConnectionConfig[K]) =>
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = useMutation({
    mutationFn: (c: JdwhConnectionConfig) => api.jdwhSaveConnection(c),
    onSuccess: (updated) => queryClient.setQueryData(["jdwh-connection"], updated),
  });

  const connect = useMutation({
    mutationFn: (c: JdwhConnectionConfig) => api.jdwhConnect({ ...c, password: c.auth_type === "SQL Login" ? password : null }),
    onSuccess: (result) => {
      setConnectError(null);
      setDiscovered(result.tables);
      setLoadResult(null);
      setLoadError(null);
    },
    onError: (e: Error) => {
      setConnectError(e.message);
      setDiscovered(null);
    },
  });

  const loadTables = useMutation({
    mutationFn: (c: JdwhConnectionConfig) => api.jdwhLoadTables({ ...c, password: c.auth_type === "SQL Login" ? password : null }),
    onSuccess: (result) => {
      setLoadError(null);
      setLoadResult(result);
      setLoadConfirmOpen(false);
    },
    onError: (e: Error) => {
      setLoadError(e.message);
      setLoadConfirmOpen(false);
    },
  });

  if (saved.isLoading || !cfg) return <Skeleton className="h-64 w-full rounded-lg" />;

  const isEntra = cfg.auth_type === "Microsoft Entra ID - Universal with MFA support";
  const isSqlLogin = cfg.auth_type === "SQL Login";
  const canConnect = cfg.server.trim() && cfg.database.trim() && (!isEntra || cfg.account.trim()) && (!isSqlLogin || (cfg.account.trim() && password.trim()));

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <FormRow label="Profile Name">
          <input
            value={cfg.profile_name}
            onChange={(e) => update("profile_name", e.target.value)}
            placeholder="JDWH Prod (optional)"
            className={jdwhInputClass}
          />
        </FormRow>
        <FormRow label="Connection Group">
          <span className="text-xs text-gray-400 dark:text-gray-500">&lt;Default&gt;</span>
        </FormRow>
        <FormRow label="Server name">
          <input
            value={cfg.server}
            onChange={(e) => update("server", e.target.value)}
            placeholder="your-server.database.windows.net"
            className={jdwhInputClass}
          />
        </FormRow>
        <FormRow label="Port">
          <input
            type="number"
            value={cfg.port}
            onChange={(e) => update("port", Number(e.target.value) || 1433)}
            className={cn(jdwhInputClass, "w-28")}
          />
        </FormRow>
        <FormRow label="Authentication type">
          <div className="relative">
            <select
              value={cfg.auth_type}
              onChange={(e) => update("auth_type", e.target.value as JdwhAuthType)}
              className={cn(jdwhInputClass, "appearance-none pr-7")}
            >
              {JDWH_AUTH_TYPES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </FormRow>
        {(isEntra || isSqlLogin) && (
          <FormRow label={isEntra ? "Account" : "Username"}>
            <input
              value={cfg.account}
              onChange={(e) => update("account", e.target.value)}
              placeholder={isEntra ? "your.name@jmangroup.com" : "SQL login username"}
              className={jdwhInputClass}
            />
          </FormRow>
        )}
        {isSqlLogin && (
          <FormRow label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Entered fresh each time -- never saved"
              className={jdwhInputClass}
            />
          </FormRow>
        )}
        <FormRow label="Database name">
          <input
            value={cfg.database}
            onChange={(e) => update("database", e.target.value)}
            placeholder="your-database-name"
            className={jdwhInputClass}
          />
        </FormRow>
        <FormRow label="Encrypt">
          <div className="relative">
            <select
              value={cfg.encrypt}
              onChange={(e) => update("encrypt", e.target.value as JdwhEncryptOption)}
              className={cn(jdwhInputClass, "appearance-none pr-7 w-40")}
            >
              {JDWH_ENCRYPT_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </FormRow>
        <FormRow label="Trust server certificate">
          <input
            type="checkbox"
            checked={cfg.trust_server_certificate}
            onChange={(e) => update("trust_server_certificate", e.target.checked)}
            className="w-3.5 h-3.5"
          />
        </FormRow>
      </div>

      {isEntra && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Opens Microsoft&apos;s sign-in (MFA included) -- this app never sees your password.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => save.mutate(cfg)}
          disabled={save.isPending}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
        <button
          onClick={() => connect.mutate(cfg)}
          disabled={connect.isPending || !canConnect}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {connect.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Connect
        </button>
      </div>

      {connectError && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{connectError}</span>
        </div>
      )}

      <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {discovered ? "Tables (connected)" : "Provisioned tables"}
          </p>
          {discovered && (
            <Badge variant={discovered.every((t) => t.found) ? "green" : "amber"}>
              {discovered.filter((t) => t.found).length}/{discovered.length} found
            </Badge>
          )}
        </div>
        {expectedTables.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <div className="space-y-1">
            {(discovered ?? expectedTables.data?.tables ?? []).map((t) => {
              const key = `${t.schema}.${t.table}`;
              const isDiscovered = "found" in t;
              return (
                <div key={key} className="rounded-lg border border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => setExpandedTable(expandedTable === key ? null : key)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
                  >
                    <Table2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    <span className="text-xs font-mono text-gray-700 dark:text-gray-300">{key}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{t.columns.length} columns</span>
                    <div className="flex-1" />
                    {isDiscovered && (
                      <Badge variant={(t as JdwhDiscoveredTable).found ? "green" : "red"}>
                        {(t as JdwhDiscoveredTable).found ? "found" : "missing"}
                      </Badge>
                    )}
                  </button>
                  {expandedTable === key && t.columns.length > 0 && (
                    <div className="px-2.5 pb-2 flex flex-wrap gap-1">
                      {t.columns.map((c) => (
                        <span
                          key={c.column}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-mono"
                          title={c.data_type}
                        >
                          {c.column}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
          Confirms tables are reachable via schema metadata only -- never pulls real data.
        </p>
      </div>

      {discovered && discovered.every((t) => t.found) && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Load Tables</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Pulls real employee/project/allocation/timesheet/WSR data and replaces what&apos;s in the database now
            (the previous data is backed up first).
          </p>

          {!loadConfirmOpen ? (
            <button
              onClick={() => setLoadConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:border-amber-400 dark:hover:border-amber-600"
            >
              <Download className="w-3.5 h-3.5" />
              Load Tables
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2.5">
              <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                This replaces the app&apos;s live employee/project/allocation/timesheet/WSR data right now. Continue?
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadTables.mutate(cfg)}
                  disabled={loadTables.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40"
                >
                  {loadTables.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Yes, load real data
                </button>
                <button
                  onClick={() => setLoadConfirmOpen(false)}
                  disabled={loadTables.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loadError && (
            <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{loadError}</span>
            </div>
          )}

          {loadResult && loadResult.empty_tables.length > 0 && (
            <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {loadResult.empty_tables.join(", ")} ended up with 0 rows -- this can break pages that expect real
                data. Use Revert below to undo this.
              </span>
            </div>
          )}
          {loadResult && (
            <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Loaded {Object.entries(loadResult.row_counts).map(([k, n]) => `${k}: ${n.toLocaleString()}`).join(", ")}.
                Previous local files backed up ({loadResult.backup_timestamp}).
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionPanel() {
  const status = useQuery({ queryKey: ["admin-connection-status"], queryFn: api.adminConnectionStatus });
  // Purely a local view-switch between the two panels below -- NOT a live
  // change to which adapter the running app actually reads from. This app
  // still reads real data only via Local Files (LocalAdapter) today; the JDWH
  // tab below only proves the SQL connection and discovers the 6 provisioned
  // tables' real columns (see jdwh_connection_service.py). Actually wiring
  // those tables' real rows into this app's employees/projects/allocations/
  // timesheets/WSR data is deliberately a separate, later step -- flipping
  // this toggle must never risk switching live data to an unmapped source.
  const [tab, setTab] = useState<"local" | "jin">("local");

  if (status.isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (status.error || !status.data) return <ErrorState message="Could not load connection status." />;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Data Source Connection</p>
        </div>
        <Badge variant="green">Database (live)</Badge>
      </div>

      <div className="p-4 space-y-4">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800/60">
          {(["local", "jin"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition",
                tab === t
                  ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              {t === "jin" ? <Database className="w-3.5 h-3.5 flex-shrink-0" /> : null}
              {t === "local" ? "App Database" : "JIN Data Warehouse"}
            </button>
          ))}
        </div>

        {tab === "local" ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The app&apos;s live data source today for employee, project, allocation, timesheet, and WSR data.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Connect or upload only confirms the tables -- Load Tables is what actually replaces the live data.
            </p>
            <JdwhTab />
          </>
        )}
      </div>
    </div>
  );
}

function DataSourceRow({ source }: { source: DataSourceInfo }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const accentColor = DATASET_ACCENT[source.key] ?? JMAN.emerald;

  const upload = useMutation({
    mutationFn: (file: File) => api.adminUploadDataset(source.key, file),
    onSuccess: (updated) => {
      queryClient.setQueryData<DataSourceInfo[]>(["admin-data-sources"], (prev) =>
        prev ? prev.map((s) => (s.key === updated.key ? updated : s)) : prev
      );
      queryClient.invalidateQueries({ queryKey: ["admin-dataset-preview", source.key] });
      setFeedback({ kind: "success", message: `${updated.row_count?.toLocaleString() ?? "?"} rows loaded.` });
    },
    onError: (err: Error) => setFeedback({ kind: "error", message: err.message }),
  });

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    const proceed = window.confirm(
      `Replace ${source.label} (${source.current_filename ?? "none yet"}) with "${file.name}"? The current file is kept as a backup.`
    );
    if (!proceed) return;
    setShowSchema(false);
    upload.mutate(file);
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3.5 flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <DatasetIconTile datasetKey={source.key} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{source.label}</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{source.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">Rows</p>
          <p className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">{source.row_count?.toLocaleString() ?? "-"}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">Updated</p>
          <p className="font-medium text-gray-700 dark:text-gray-300">{formatDate(source.last_modified)}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={source.file_type === "csv" ? ".csv" : ".xlsx"}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={() => setShowPreview(true)}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 flex-1"
        >
          <Eye className="w-3.5 h-3.5" />
          View data
        </button>
        <button
          onClick={() => setShowSchema(true)}
          disabled={upload.isPending}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-50 flex-1"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          {upload.isPending ? "Uploading…" : "Replace"}
        </button>
      </div>

      {feedback && (
        <div
          className={cn(
            "flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]",
            feedback.kind === "success" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
          )}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {showPreview && (
        <PreviewModal
          dataKey={source.key}
          label={source.label}
          accentColor={accentColor}
          onClose={() => setShowPreview(false)}
        />
      )}
      {showSchema && (
        <SchemaModal
          dataKey={source.key}
          label={source.label}
          fileType={source.file_type}
          accentColor={accentColor}
          onClose={() => setShowSchema(false)}
          onChooseFile={() => inputRef.current?.click()}
        />
      )}
    </div>
  );
}

export default function SettingsPage() {
  const sources = useQuery({ queryKey: ["admin-data-sources"], queryFn: api.adminDataSources });

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Settings</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Data source connection and dataset uploads.</p>
        </div>
        <AppearancePanel />
      </div>

      <div className="max-w-3xl">
        <ConnectionPanel />
      </div>

      <div className="space-y-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Manual Data Uploads</p>
        {sources.isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )}
        {sources.error && <ErrorState message="Could not load data sources." />}
        {sources.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sources.data.map((s) => <DataSourceRow key={s.key} source={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}
