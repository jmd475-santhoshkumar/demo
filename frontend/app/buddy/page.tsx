"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Sparkles, Loader2, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen, X, ChevronDown, ChevronUp, Wrench, ThumbsUp, ThumbsDown } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { cn, formatUsd } from "@/lib/utils";
import { Mascot } from "@/components/shared/Mascot";
import { buddyAskStream, buddyRate, type BuddyStat, type BuddyTable, type BuddyToolCall } from "@/lib/api";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { Modal } from "@/components/shared/Modal";

const EMPLOYEE_COLUMNS = new Set(["Employee"]);
const PROJECT_COLUMNS = new Set(["Project"]);

const TOOL_LABELS: Record<string, string> = {
  get_recommendations: "Searching candidates",
  list_pipeline_demand: "Looking up pipeline demand",
  get_recommendations_for_pipeline_row: "Ranking candidates for this deal",
  get_recommendations_coverage_summary: "Rolling up pipeline coverage",
  get_health_report: "Checking project risk",
  get_allocation_report: "Pulling current allocations",
  get_new_project_forecast: "Running staffing what-if",
  find_employees: "Looking up employees",
  get_employee_profile: "Pulling employee profile",
  get_free_pool: "Checking who's free",
  get_redeploy_matches_for_employee: "Finding open work for this person",
  get_leave_impact: "Checking leave impact",
  get_employee_headcount_summary: "Pulling headcount summary",
  get_project_health_detail: "Pulling project risk proof",
  get_relief_staffing_candidates: "Finding relief staffing for this project",
  get_pipeline_outlook: "Running pipeline outlook",
  get_pipeline_outlook_drilldown: "Pulling outlook drilldown",
  get_semantic_match_suggestions: "Running AI semantic match",
  get_role_mix: "Looking up role mix",
  list_role_mix_reference: "Looking up CoE/category reference",
  get_rate_card: "Looking up rate card",
  get_adjacent_designations: "Checking adjacent designations",
  get_employee_overtime_risk: "Checking overtime risk",
  get_project_effort_spikes: "Checking effort spikes",
  get_coe_skills: "Looking up CoE skills",
  get_allocation_timesheet: "Pulling timesheet proof",
  get_project_roster: "Pulling project roster",
  get_project_info: "Looking up project info",
  get_revenue_trend: "Pulling revenue trend",
  query_database: "Running a database query",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  format?: "table" | "stats" | "text";
  table?: BuddyTable;
  stats?: BuddyStat[];
  data?: unknown;
  toolTrace?: BuddyToolCall[];
  rating?: "up" | "down";
}

interface BuddyConversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
}

const CONVERSATIONS_KEY = "buddy_conversations";
const SIDEBAR_COLLAPSED_KEY = "buddy_sidebar_collapsed";

function loadConversations(): BuddyConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(list: BuddyConversation[]) {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list));
  } catch {}
}

function mostRecentId(list: BuddyConversation[]): string | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
}

function deriveTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

function relativeTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

function buildPriorContext(conversations: BuddyConversation[], excludeId: string | null): string | undefined {
  const recent = [...conversations]
    .filter((c) => c.id !== excludeId && c.messages.some((m) => m.role === "assistant" && m.content.trim()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  if (recent.length === 0) return undefined;
  const parts = recent
    .map((c) => {
      const lastAsst = [...c.messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
      if (!lastAsst) return null;
      return `Session "${c.title}" (${relativeTime(c.updatedAt)}): ${lastAsst.content.slice(0, 280)}`;
    })
    .filter(Boolean) as string[];
  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

const SUGGESTIONS = [
  "Who's currently free or under-utilized in Data Engineering?",
  "Which projects are at risk right now, and why?",
  "Who's going on leave soon, and is there a backfill?",
  "What roles does a typical AI project need, and what do they cost?",
  "What does the pipeline outlook look like for the next quarter?",
];

function Avatar() {
  return (
    <div className="hidden sm:flex w-7 h-7 rounded-full items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: "hsl(var(--primary) / 0.12)" }}>
      <Mascot className="w-5 h-5" />
    </div>
  );
}

// Renders the model's answer text as real markdown -- bold, lists, links, and
// (defensively) any stray GFM table a model appends despite the system prompt
// asking for a plain summary. Without this, that leaked markdown shows up as
// raw "**"/"|---|" characters instead of formatted text (the exact bug seen
// when a model occasionally echoes a table after its required JSON object).
function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-[13.5px]">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{children}</a>
        ),
        code: ({ children }) => <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[12px] font-mono">{children}</code>,
        table: ({ children }) => (
          <div className="w-full rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-x-auto my-2">
            <table className="w-full text-[11px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-800/60 dark:border-gray-700">{children}</thead>,
        th: ({ children }) => <th className="text-left font-semibold text-gray-500 px-2.5 py-1.5 whitespace-nowrap dark:text-gray-400">{children}</th>,
        tr: ({ children }) => <tr className="border-b border-gray-50 last:border-0 dark:border-gray-800">{children}</tr>,
        td: ({ children }) => <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function ChatTable({
  columns,
  rows,
  onEmployeeClick,
  onProjectClick,
}: BuddyTable & { onEmployeeClick: (id: string) => void; onProjectClick: (code: string) => void }) {
  const employeeColIdx = columns.findIndex((c) => EMPLOYEE_COLUMNS.has(c));
  const projectColIdx = columns.findIndex((c) => PROJECT_COLUMNS.has(c));
  return (
    <div className="w-full rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 dark:bg-gray-800/60 dark:border-gray-700">
            {columns.map((c) => (
              <th key={c} className="text-left font-semibold text-gray-500 px-2.5 py-1.5 whitespace-nowrap dark:text-gray-400">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0 dark:border-gray-800">
              {row.map((cell, j) => (
                <td key={j} className="px-2.5 py-1.5 text-gray-700 whitespace-nowrap dark:text-gray-300">
                  {j === employeeColIdx && cell ? (
                    <button onClick={() => onEmployeeClick(String(cell))} className="text-primary hover:underline">{cell}</button>
                  ) : j === projectColIdx && cell ? (
                    <button onClick={() => onProjectClick(String(cell))} className="text-primary hover:underline">{cell}</button>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChatStats({ items, toolName, data }: { items: BuddyStat[]; toolName?: string; data?: unknown }) {
  const [open, setOpen] = useState<{ label: string; table: BreakdownTable } | null>(null);
  return (
    <>
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((st) => {
          const proof = extractStatProof(toolName, st.label, data);
          return (
            <div
              key={st.label}
              onClick={proof ? () => setOpen({ label: st.label, table: proof }) : undefined}
              className={cn(
                "rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 transition",
                proof && "hover:border-primary hover:bg-primary/5 cursor-pointer"
              )}
              title={proof ? "Click for the real rows behind this number" : undefined}
            >
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5 flex items-center gap-1">
                {st.label}
                {proof && <span className="text-primary">↗</span>}
              </p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200">{st.value}</p>
            </div>
          );
        })}
      </div>
      {open && (
        <Modal title={`${open.label} (${open.table.rows.length})`} onClose={() => setOpen(null)} widthClassName="max-w-2xl">
          <div className="p-4">
            <ChatTable {...open.table} onEmployeeClick={() => {}} onProjectClick={() => {}} />
          </div>
        </Modal>
      )}
    </>
  );
}

// A handful of tool results are naturally a time series -- rendering them as a
// chart (with the same hover-tooltip UX as the rest of the app) reads faster
// than scanning a raw table. Deliberately narrow: only tools where the data
// shape is unambiguously "one row per period" get a chart, nothing is guessed.
function BuddyChart({ toolName, data }: { toolName: string | undefined; data: unknown }) {
  if (!toolName || data == null) return null;

  if (toolName === "get_revenue_trend" && Array.isArray(data) && data.length > 1) {
    const rows = data as { month: string; value: number }[];
    return (
      <div className="w-full rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 p-3" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatUsd(Number(v))} width={55} />
            <Tooltip formatter={(v: number) => formatUsd(v)} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Line type="monotone" dataKey="value" stroke="#3411A3" strokeWidth={2} dot={{ r: 3 }} name="Revenue" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (toolName === "get_pipeline_outlook" && typeof data === "object" && Array.isArray((data as BreakdownRecord).months)) {
    const months = (data as BreakdownRecord).months as BreakdownRecord[];
    if (months.length === 0) return null;
    return (
      <div className="w-full rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 p-3" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={months} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={30} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="confirmed_demand_count" name="Confirmed demand" fill="#3411A3" radius={[3, 3, 0, 0]} />
            <Bar dataKey="unconfirmed_demand_count" name="Unconfirmed demand" fill="#C36BDB" radius={[3, 3, 0, 0]} />
            <Bar dataKey="projected_supply_count" name="Projected supply" fill="#18978E" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}

// ── Breakdown drill-down ────────────────────────────────────────────────────────
// Every count Buddy cites in an answer (280 in the free pool, 15 candidates,
// 3 high-risk projects...) already came from a real tool call whose FULL,
// uncapped result is sitting right there in the message's own `data` field --
// no second lookup, no extra LLM call, just filtering/grouping data that's
// already in hand. This turns those numbers into clickable proof instead of
// leaving them as unverifiable prose.
type BreakdownRecord = Record<string, unknown>;
type BreakdownTable = { columns: string[]; rows: (string | number)[][] };
type BreakdownGroup = { label: string; count: number; items: BreakdownRecord[] };

function s(v: unknown, fallback = "-"): string {
  return v === null || v === undefined || v === "" ? fallback : String(v);
}
function pct(v: unknown): string {
  return `${Math.round(Number(v ?? 0))}%`;
}
function pct01(v: unknown): string {
  return `${Math.round(Number(v ?? 0) * 100)}%`;
}

function buildFreePoolTable(items: BreakdownRecord[]): BreakdownTable {
  return {
    columns: ["Employee", "Role", "CoE", "Reason", "Idle %"],
    rows: items.map((c) => [s(c.employee_id), s(c.job_name), s(c.primary_coe, "not determined"), s(c.reason), pct(c.idle_capacity_pct)]),
  };
}
function buildHealthTable(items: BreakdownRecord[]): BreakdownTable {
  return {
    columns: ["Project", "Risk", "Root causes"],
    rows: items.map((p) => [s(p.project_code), s(p.risk_band), Array.isArray(p.root_causes) ? (p.root_causes as string[]).join(", ") || "-" : "-"]),
  };
}
function buildAllocationTable(items: BreakdownRecord[]): BreakdownTable {
  return {
    columns: ["Employee", "Project", "Allocation %", "Status", "Ending soon"],
    rows: items.map((r) => [s(r.employee_id), s(r.project_id), pct(r.allocation_by_percentage), s(r.utilization_band), r.ending_soon ? "Yes" : "No"]),
  };
}
function buildLeaveTable(items: BreakdownRecord[]): BreakdownTable {
  return {
    columns: ["Employee", "Project", "Leave type", "Starts", "Ends", "Backfill"],
    rows: items.map((r) => [s(r.employee_id), s(r.project_id), s(r.leave_type), s(r.leave_start_date), s(r.leave_end_date), r.backfill_available ? "Yes" : "No"]),
  };
}
function buildCandidatesTable(items: BreakdownRecord[]): BreakdownTable {
  return {
    columns: ["Employee", "Role", "Signal", "Skill", "Competency", "Available %"],
    rows: items.map((c) => [s(c.employee_id), s(c.job_name), s(c.bucket), pct01(c.skill_score), pct01(c.competency_score), pct(c.available_pct)]),
  };
}

const BREAKDOWN_LABELS: Record<string, Record<string, string>> = {
  reason: { fully_free: "Fully free", under_utilized: "Under-utilized", ending_soon: "Ending soon" },
  risk_band: { high: "High risk", medium: "Medium risk", low: "Low risk" },
  bucket: { eligible: "Redeploy", trainable: "Needs training", gap: "Hire signal", not_assessed: "Not assessed" },
};

function groupByField(items: BreakdownRecord[], field: string): BreakdownGroup[] {
  const labelMap = BREAKDOWN_LABELS[field] ?? {};
  const buckets = new Map<string, BreakdownRecord[]>();
  for (const item of items) {
    const key = s(item[field], "unknown");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  return Array.from(buckets.entries()).map(([key, group]) => ({ label: labelMap[key] ?? key, count: group.length, items: group }));
}

interface Breakdown {
  groups: BreakdownGroup[];
  buildTable: (items: BreakdownRecord[]) => BreakdownTable;
}

function extractBreakdown(toolName: string | undefined, data: unknown): Breakdown | null {
  if (!toolName || data == null) return null;

  if (toolName === "get_free_pool" && Array.isArray(data)) {
    return { groups: groupByField(data as BreakdownRecord[], "reason"), buildTable: buildFreePoolTable };
  }
  if (toolName === "get_health_report" && Array.isArray(data)) {
    return { groups: groupByField(data as BreakdownRecord[], "risk_band"), buildTable: buildHealthTable };
  }
  if (toolName === "get_allocation_report" && Array.isArray(data)) {
    const items = data as BreakdownRecord[];
    const over = items.filter((r) => r.utilization_band === "over_allocated");
    const under = items.filter((r) => r.utilization_band === "under_utilized");
    const ending = items.filter((r) => r.ending_soon);
    return {
      groups: [
        { label: "Over-allocated", count: over.length, items: over },
        { label: "Under-utilized", count: under.length, items: under },
        { label: "Ending within 30 days", count: ending.length, items: ending },
      ],
      buildTable: buildAllocationTable,
    };
  }
  if (toolName === "get_leave_impact" && Array.isArray(data)) {
    const items = data as BreakdownRecord[];
    const onLeave = items.filter((r) => r.is_currently_on_leave);
    const noBackfill = items.filter((r) => !r.backfill_available);
    return {
      groups: [
        { label: "Currently on leave", count: onLeave.length, items: onLeave },
        { label: "No backfill available", count: noBackfill.length, items: noBackfill },
      ],
      buildTable: buildLeaveTable,
    };
  }
  if ((toolName === "get_recommendations" || toolName === "get_recommendations_for_pipeline_row") && data && typeof data === "object" && Array.isArray((data as BreakdownRecord).candidates)) {
    const candidates = (data as BreakdownRecord).candidates as BreakdownRecord[];
    return { groups: groupByField(candidates, "bucket"), buildTable: buildCandidatesTable };
  }
  return null;
}

// Same real-data-already-in-hand philosophy as extractBreakdown above, but for
// the "stats" card grid instead of the "table" format -- each stat tile maps
// to a specific filter of the same tool result already sitting in the
// message's `data` field, so a number like "Total shortfall (heads)" opens
// the exact real rows behind it instead of staying an unverifiable figure.
function extractStatProof(toolName: string | undefined, label: string, data: unknown): BreakdownTable | null {
  if (!toolName || data == null || typeof data !== "object") return null;
  const d = data as BreakdownRecord;

  if (toolName === "get_recommendations_coverage_summary" && Array.isArray(d.rows)) {
    const rows = d.rows as BreakdownRecord[];
    const filters: Record<string, (r: BreakdownRecord) => boolean> = {
      "Ready to redeploy": (r) => r.top_candidate_signal === "redeploy",
      "Need upskilling": (r) => r.top_candidate_signal === "redeploy_with_training",
      "Need external hire": (r) => r.top_candidate_signal === "hire",
      "No skillset specified": (r) => r.has_skillset === false,
    };
    const pred = filters[label];
    if (!pred) return null;
    return { columns: ["Client", "Role Requested"], rows: rows.filter(pred).map((r) => [s(r.client, "Unnamed"), s(r.resources_requested)]) };
  }

  if (toolName === "get_pipeline_outlook" && Array.isArray(d.months)) {
    const months = d.months as BreakdownRecord[];
    if (label === "Months with shortfall warning") {
      const flagged = months.filter((m) => m.early_warning);
      return { columns: ["Month", "Confirmed", "Supply", "Net"], rows: flagged.map((m) => [s(m.month), s(m.confirmed_demand_count), s(m.projected_supply_count), s(m.net_confirmed_surplus_shortfall)]) };
    }
    if (label === "Total confirmed demand") {
      return { columns: ["Month", "Confirmed Demand"], rows: months.map((m) => [s(m.month), s(m.confirmed_demand_count)]) };
    }
    if (label === "Total unconfirmed demand") {
      return { columns: ["Month", "Unconfirmed Demand"], rows: months.map((m) => [s(m.month), s(m.unconfirmed_demand_count)]) };
    }
  }

  if (toolName === "get_new_project_forecast" && Array.isArray(d.breakdown) && (label === "Total shortfall (heads)" || label === "Total shortfall value")) {
    const short = (d.breakdown as BreakdownRecord[]).filter((r) => Number(r.shortfall) > 0);
    return {
      columns: ["Designation", "Needed", "Covers", "Shortfall", "Shortfall $/mo"],
      rows: short.map((r) => [s(r.designation), s(r.needed_headcount), s(r.available_for_redeploy), s(r.shortfall), `$${Number(r.shortfall_value_usd ?? 0).toLocaleString()}`]),
    };
  }

  return null;
}

function BuddyBreakdown({
  toolName,
  data,
  onEmployeeClick,
  onProjectClick,
}: {
  toolName: string | undefined;
  data: unknown;
  onEmployeeClick: (id: string) => void;
  onProjectClick: (code: string) => void;
}) {
  const [open, setOpen] = useState<{ label: string; table: BreakdownTable } | null>(null);
  const breakdown = extractBreakdown(toolName, data);
  if (!breakdown || breakdown.groups.every((g) => g.count === 0)) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {breakdown.groups.filter((g) => g.count > 0).map((g) => (
          <button
            key={g.label}
            onClick={() => setOpen({ label: g.label, table: breakdown.buildTable(g.items) })}
            className="text-[11px] px-2 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-primary hover:text-primary transition dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            <span className="font-semibold">{g.count}</span> {g.label} ↗
          </button>
        ))}
      </div>
      {open && (
        <Modal title={`${open.label} (${open.table.rows.length})`} onClose={() => setOpen(null)} widthClassName="max-w-3xl">
          <div className="p-4">
            <ChatTable {...open.table} onEmployeeClick={onEmployeeClick} onProjectClick={onProjectClick} />
          </div>
        </Modal>
      )}
    </>
  );
}

function formatArgValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 50 ? `${v.slice(0, 50)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    const items = v.slice(0, 4).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    return items.join(", ") + (v.length > 4 ? ` +${v.length - 4} more` : "");
  }
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function ToolTrace({ trace }: { trace: BuddyToolCall[] }) {
  const [open, setOpen] = useState(true);
  if (!trace.length) return null;
  return (
    <div className="w-full mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-gray-700 transition mb-1.5 w-full group dark:text-gray-400 dark:hover:text-gray-200"
      >
        <Wrench className="w-3 h-3 text-primary flex-shrink-0" />
        <span>Agent trace</span>
        <span className="text-gray-400 font-normal ml-1 dark:text-gray-500">
          · {trace.length} tool {trace.length === 1 ? "call" : "calls"}
        </span>
        <span className="ml-auto text-gray-300 group-hover:text-gray-400 transition flex-shrink-0 dark:text-gray-600 dark:group-hover:text-gray-500">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>
      {open && (
        <div className="rounded-xl border border-gray-100 bg-[#fafafa] overflow-hidden text-[11px] dark:border-gray-800 dark:bg-gray-800/60">
          {trace.map((t, i) => {
            const args = Object.entries(t.arguments).filter(
              ([, v]) =>
                v !== null &&
                v !== undefined &&
                v !== "" &&
                !(Array.isArray(v) && v.length === 0)
            );
            return (
              <div
                key={i}
                className={cn("flex gap-3 px-3 py-2.5", i < trace.length - 1 && "border-b border-gray-100 dark:border-gray-800")}
              >
                {/* Step indicator + vertical connector */}
                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                  <div
                    className="rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{
                      backgroundColor: "hsl(var(--primary))",
                      width: "18px",
                      height: "18px",
                      minWidth: "18px",
                    }}
                  >
                    {i + 1}
                  </div>
                  {i < trace.length - 1 && (
                    <div
                      className="w-px bg-gray-200 dark:bg-gray-700 mt-1 flex-1"
                      style={{ minHeight: "12px" }}
                    />
                  )}
                </div>

                {/* Tool name + arguments */}
                <div className="flex-1 min-w-0 pb-0.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800 text-[12px] leading-tight dark:text-gray-200">
                      {toolLabel(t.tool)}
                    </span>
                    <span className="font-mono text-gray-400 text-[10px] dark:text-gray-500">{t.tool}</span>
                  </div>
                  {args.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                      {args.map(([k, v]) => (
                        <span key={k} className="text-gray-500 dark:text-gray-400">
                          <span className="text-gray-400 dark:text-gray-500">{k}:</span>{" "}
                          <span
                            className="font-mono text-[10px]"
                            style={{ color: "hsl(var(--primary) / 0.75)" }}
                          >
                            {formatArgValue(v)}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Guardrail footer */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 dark:bg-gray-800/60 dark:border-gray-800 dark:text-gray-500">
            <span className="text-emerald-500 dark:text-emerald-400">🔒</span>
            Read-only · Buddy never modifies data · All results from live JMAN data
          </div>
        </div>
      )}
    </div>
  );
}

function LiveToolProgress({ tools }: { tools: { tool: string; done: boolean }[] }) {
  if (!tools.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {tools.map((t, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 px-1">
          {t.done ? <Wrench className="w-3 h-3 text-primary" /> : <Loader2 className="w-3 h-3 animate-spin" />}
          {toolLabel(t.tool)}…
        </div>
      ))}
    </div>
  );
}

function ConversationRail({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  mobileOpen,
  onMobileClose,
}: {
  conversations: BuddyConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  // Always starts false (matching what the server renders, since window/localStorage
  // don't exist there) -- reading the persisted preference in an effect, rather than in
  // the useState initializer, means the client's first render still matches the server's
  // HTML exactly. Hydration compares that first render, not whatever state settles into a
  // moment later, so reading localStorage synchronously in the initializer (the previous
  // approach) caused a real "server/client mismatch" error whenever the sidebar had
  // previously been collapsed.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);

  function setCollapsedPersisted(value: boolean) {
    setCollapsed(value);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  }

  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (collapsed && !mobileOpen) {
    return (
      <div className="hidden md:flex w-12 flex-shrink-0 border-r border-gray-100 flex-col items-center bg-gray-50/50 py-2.5 gap-2 transition-all dark:border-gray-800 dark:bg-gray-800/60">
        <button
          onClick={() => setCollapsedPersisted(false)}
          title="Expand conversations"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-600 transition dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <button
          onClick={onCreate}
          title="New chat"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-white bg-primary transition hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 dark:bg-black/60 md:hidden" onClick={onMobileClose} aria-hidden="true" />
      )}
      <div
        className={cn(
          "w-72 md:w-56 flex-shrink-0 border-r border-gray-100 flex flex-col bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/60",
          "fixed inset-y-0 left-0 z-40 transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0 md:z-auto md:transition-all"
        )}
      >
        <div className="p-2.5 flex items-center gap-1.5">
          <button
            onClick={onCreate}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-primary transition hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
          <button
            onClick={onMobileClose}
            title="Close"
            className="md:hidden w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-600 transition dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCollapsedPersisted(true)}
            title="Collapse"
            className="hidden md:flex w-8 h-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-600 transition dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-0.5">
          {sorted.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cn(
                "w-full group flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition",
                c.id === activeId ? "bg-white shadow-sm dark:bg-gray-900" : "hover:bg-white/70 dark:hover:bg-gray-800/70"
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500" />
              <div className="flex-1 min-w-0">
                <p className={cn("text-xs truncate", c.id === activeId ? "text-gray-900 font-medium dark:text-gray-100" : "text-gray-600 dark:text-gray-400")}>{c.title}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">{relativeTime(c.updatedAt)}</p>
              </div>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded-md hover:bg-gray-100 text-gray-300 hover:text-red-400 transition flex-shrink-0 dark:hover:bg-gray-800 dark:text-gray-600"
              >
                <Trash2 className="w-3 h-3" />
              </span>
            </button>
          ))}
          {sorted.length === 0 && <p className="text-[11px] text-gray-300 text-center py-6 px-2 dark:text-gray-600">No conversations yet</p>}
        </div>
      </div>
    </>
  );
}

export default function BuddyPage() {
  // Always starts empty/null (matching the server, which has no localStorage) --
  // the real persisted conversations are loaded in an effect below, after mount,
  // so the client's first render still matches the server's HTML exactly. See the
  // matching comment on ConversationRail's `collapsed` state for why reading
  // localStorage directly in a useState initializer causes a real hydration
  // mismatch (this was the "Expected server HTML to contain a matching <button>"
  // error -- the server rendered an empty conversation list while the client's
  // first hydration pass already had real conversations loaded).
  const [conversations, setConversations] = useState<BuddyConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [liveTools, setLiveTools] = useState<{ tool: string; done: boolean }[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [railMobileOpen, setRailMobileOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const skipNextPersist = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Textarea has no natural height of its own (rows=1) -- grow it with the
  // content up to a cap, then let it scroll, so typing a longer question
  // never hides earlier lines behind the box's fixed edge.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    const loaded = loadConversations();
    setConversations(loaded);
    setActiveId(mostRecentId(loaded));
  }, []);

  useEffect(() => {
    // The mount-time render always starts from conversations=[] (see above) --
    // skip persisting that once so it can never clobber real localStorage data
    // before the load effect above has had a chance to populate real state.
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    saveConversations(conversations);
  }, [conversations]);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConversation?.messages ?? [];

  const allRated = conversations.flatMap((c) => c.messages).filter((m) => m.role === "assistant" && m.rating);
  const upCount = allRated.filter((m) => m.rating === "up").length;
  const pctHelpful = allRated.length > 0 ? Math.round((upCount / allRated.length) * 100) : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, liveTools.length]);

  const appendMessage = (conversationId: string, message: Message) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, messages: [...c.messages, message], updatedAt: new Date().toISOString() } : c
      )
    );
  };

  const handleSend = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || sending) return;

    const isNew = activeId === null;
    const conversationId = activeId ?? crypto.randomUUID();
    const history = (isNew ? [] : activeConversation?.messages ?? []).map((m) => ({ role: m.role, content: m.content }));
    const priorContext = isNew ? buildPriorContext(conversations, null) : undefined;

    if (isNew) {
      setConversations((prev) => [
        { id: conversationId, title: deriveTitle(message), messages: [], updatedAt: new Date().toISOString() },
        ...prev,
      ]);
      setActiveId(conversationId);
    }
    appendMessage(conversationId, { role: "user", content: message });
    setDraft("");
    setSending(true);
    setLiveTools([]);
    try {
      const trace: { tool: string; arguments: Record<string, unknown> }[] = [];
      for await (const event of buddyAskStream(message, history, priorContext)) {
        if (event.type === "tool_call" && event.tool) {
          trace.push({ tool: event.tool, arguments: event.arguments ?? {} });
          setLiveTools((prev) => [...prev, { tool: event.tool!, done: false }]);
        } else if (event.type === "tool_result" && event.tool) {
          setLiveTools((prev) => {
            const idx = prev.map((t) => t.tool === event.tool && !t.done).lastIndexOf(true);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], done: true };
            return next;
          });
        } else if (event.type === "done") {
          appendMessage(conversationId, {
            role: "assistant",
            content: event.answer ?? "",
            format: event.format,
            table: event.table,
            stats: event.stats,
            data: event.data,
            toolTrace: trace,
          });
        }
      }
    } catch (err) {
      console.error("[Buddy] stream error:", err);
      const message = err instanceof Error && err.message ? err.message : "Could not reach Buddy's backend.";
      appendMessage(conversationId, { role: "assistant", content: message });
    } finally {
      setSending(false);
      setLiveTools([]);
    }
  };

  const handleDelete = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const handleRate = (conversationId: string, messageIndex: number, rating: "up" | "down") => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== conversationId) return c;
        const msgs = [...c.messages];
        msgs[messageIndex] = { ...msgs[messageIndex], rating };
        return { ...c, messages: msgs };
      })
    );
    // Persist to backend (fire-and-forget)
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      const question = conv.messages[messageIndex - 1]?.content ?? "";
      const answer = conv.messages[messageIndex]?.content ?? "";
      buddyRate({
        session_id: conversationId,
        message_index: messageIndex,
        question,
        answer_snippet: answer.slice(0, 300),
        rating,
      }).catch(() => {});
    }
  };

  return (
    <div className="h-[calc(100dvh-56px)] flex bg-white dark:bg-gray-900">
      <ConversationRail
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setRailMobileOpen(false);
        }}
        onCreate={() => {
          setActiveId(null);
          setRailMobileOpen(false);
        }}
        onDelete={handleDelete}
        mobileOpen={railMobileOpen}
        onMobileClose={() => setRailMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2.5 px-3 sm:px-6 py-3 sm:py-3.5 border-b border-gray-100 flex-shrink-0 min-w-0 dark:border-gray-800">
          <button
            onClick={() => setRailMobileOpen(true)}
            title="Conversations"
            className="md:hidden flex-shrink-0 p-1.5 -ml-1 rounded-lg text-gray-500 hover:bg-gray-100 transition dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <span className="hidden sm:inline-flex flex-shrink-0">
            <Mascot className="w-8 h-8" />
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-gray-900 leading-tight dark:text-gray-100">Buddy</h1>
          </div>
          <div className="flex-1" />
          {pctHelpful !== null && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1 flex-shrink-0 dark:bg-gray-800/60 dark:border-gray-800">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{pctHelpful}%</span>
              <span className="text-gray-400 dark:text-gray-500">helpful</span>
              <span className="text-gray-200 dark:text-gray-700">·</span>
              <span className="text-gray-400 dark:text-gray-500">{allRated.length} rated</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-3 sm:px-6 py-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto gap-4 sm:gap-5">
              <Mascot className="w-11 h-11 sm:w-14 sm:h-14" glow />
              <div className="flex flex-col gap-1.5 sm:gap-2 w-full">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className={cn(
                      "flex items-center gap-2.5 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-gray-200 text-[13px] sm:text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition text-left dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800",
                      i >= 3 && "hidden sm:flex"
                    )}
                  >
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-5">
              {messages.map((m, i) => (
                <div key={i} className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}>
                  {m.role === "assistant" && <Avatar />}
                  <div className={cn("flex flex-col gap-2", m.role === "assistant" ? "flex-1 min-w-0" : "", m.role === "user" && "order-first ml-auto items-end")}>
                    <div
                      className={cn(
                        "max-w-[92%] sm:max-w-[80%] px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-[13.5px] leading-relaxed",
                        m.role === "user"
                          ? "text-white rounded-br-md bg-primary whitespace-pre-wrap"
                          : "bg-gray-50 text-gray-800 rounded-bl-md border border-gray-100 dark:bg-gray-800/60 dark:text-gray-200 dark:border-gray-800"
                      )}
                    >
                      {m.role === "assistant" ? <ChatMarkdown content={m.content} /> : m.content}
                    </div>
                    {m.role === "assistant" && m.format === "table" && m.table && (
                      <ChatTable {...m.table} onEmployeeClick={setSelectedEmployee} onProjectClick={setSelectedProject} />
                    )}
                    {m.role === "assistant" && m.format === "stats" && m.stats && (
                      <ChatStats items={m.stats} toolName={m.toolTrace?.[m.toolTrace.length - 1]?.tool} data={m.data} />
                    )}
                    {m.role === "assistant" && (
                      <BuddyChart toolName={m.toolTrace?.[m.toolTrace.length - 1]?.tool} data={m.data} />
                    )}
                    {m.role === "assistant" && (
                      <BuddyBreakdown
                        toolName={m.toolTrace?.[m.toolTrace.length - 1]?.tool}
                        data={m.data}
                        onEmployeeClick={setSelectedEmployee}
                        onProjectClick={setSelectedProject}
                      />
                    )}
                    {m.role === "assistant" && m.toolTrace && m.toolTrace.length > 0 && <ToolTrace trace={m.toolTrace} />}
                    {m.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-gray-300 dark:text-gray-600">Helpful?</span>
                        <button
                          onClick={() => handleRate(activeId!, i, "up")}
                          className={cn("p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition", m.rating === "up" ? "text-emerald-500 dark:text-emerald-400" : "text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400")}
                          title="Helpful"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRate(activeId!, i, "down")}
                          className={cn("p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition", m.rating === "down" ? "text-red-400" : "text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400")}
                          title="Not helpful"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                        {m.rating && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {m.rating === "up" ? "Thanks!" : "Got it — we'll improve."}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex gap-3 justify-start">
                  <Avatar />
                  <div className="flex flex-col gap-2 flex-1 min-w-0">
                    {liveTools.length === 0 ? (
                      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-gray-50 border border-gray-100 flex items-center gap-2 text-xs text-gray-400 w-fit dark:bg-gray-800/60 dark:border-gray-800 dark:text-gray-500">
                        <Loader2 className="w-3 h-3 animate-spin" /> thinking…
                      </div>
                    ) : (
                      <LiveToolProgress tools={liveTools} />
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-3 sm:px-6 py-4 flex-shrink-0 dark:border-gray-800">
          <div className="max-w-2xl mx-auto flex items-end gap-2.5">
            <div className="flex-1 flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 focus-within:border-gray-300 transition dark:border-gray-700 dark:bg-gray-900 dark:focus-within:border-gray-600">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Ask Buddy…"
                className="flex-1 text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 resize-none leading-relaxed py-0.5 max-h-40 overflow-y-auto scrollbar-thin"
                rows={1}
                disabled={sending}
              />
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!draft.trim() || sending}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 transition hover:opacity-90 bg-primary"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-[10px] text-gray-300 mt-2 dark:text-gray-600">Buddy can make mistakes. Verify important findings on dedicated pages.</p>
        </div>
      </div>

      {selectedEmployee && (
        <EmployeeProfileModal employeeId={selectedEmployee} initialTab="overview" onClose={() => setSelectedEmployee(null)} />
      )}
      {selectedProject && <ProjectHealthDetailModal projectCode={selectedProject} onClose={() => setSelectedProject(null)} />}
    </div>
  );
}
