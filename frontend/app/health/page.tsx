"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Users, DollarSign, Clock, AlertTriangle, ChevronRight } from "lucide-react";
import { api, type HealthProject } from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { LoadingState, ErrorState } from "@/components/shared/EmptyState";
import { StatCardGridSkeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { Modal } from "@/components/shared/Modal";
import { ProjectHealthDetailContent } from "@/components/health/ProjectHealthDetailModal";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { cn, formatUsd, ROOT_CAUSE_LABEL } from "@/lib/utils";

type RiskFilter = "all" | "high" | "medium" | "low";
type WsrFilter = "all" | "RED" | "AMBER" | "GREEN" | "no_report" | "has_report";
type RevenuePeriod = "day" | "week" | "month";

function convertRevenue(monthly: number, period: RevenuePeriod): number {
  if (period === "day") return monthly / 30;
  if (period === "week") return (monthly / 30) * 7;
  return monthly;
}

type HealthSort =
  | "risk_desc"
  | "overrun_desc"
  | "unbilled_desc"
  | "churn_desc"
  | "headcount_desc"
  | "headcount_asc"
  | "rampdown_asc"
  | "project_asc"
  | "client_asc";

const ROOT_CAUSES: { value: string; label: string }[] = Object.entries(ROOT_CAUSE_LABEL).map(
  ([value, label]) => ({ value, label })
);

const SORT_OPTIONS: { value: HealthSort; label: string }[] = [
  { value: "risk_desc",      label: "Sort: highest risk first" },
  { value: "overrun_desc",   label: "Sort: most overrun days" },
  { value: "unbilled_desc",  label: "Sort: highest $ at risk" },
  { value: "churn_desc",     label: "Sort: highest churn" },
  { value: "headcount_desc", label: "Sort: largest team" },
  { value: "headcount_asc",  label: "Sort: smallest team" },
  { value: "rampdown_asc",   label: "Sort: ending soonest" },
  { value: "project_asc",    label: "Sort: project A–Z" },
  { value: "client_asc",     label: "Sort: client A–Z" },
];

// ── TABLE COLUMNS (single source of truth so header count == cell count) ──
const TABLE_COLUMNS = [
  "Project",
  "Type",
  "Team (actual/expected)",
  "Risk",
  "Root Causes",
  "Unbilled $/mo",
  "Real WSR (latest)",
  "DevOps board",
  // "Ramp-down?", -- column hidden from the frontend table per request
] as const;

interface HealthFilterOptions {
  search: string;
  riskFilter: RiskFilter;
  rootCauseFilter: string;
  typeFilter: string;
  coeFilter: string;
  wsrFilter: WsrFilter;
  understaffedOnly: boolean;
  rampDownOnly: boolean;
  hasUnbilledValueOnly: boolean;
  devopsRiskOnly: boolean; // ← NEW
  sort: HealthSort;
  extensionRiskOnly: boolean;
  escalationRiskOnly: boolean;
  pulseRiskOnly: boolean;
}

function filterAndSortHealth(rows: HealthProject[], opts: HealthFilterOptions): HealthProject[] {
  let result = rows;

  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (p) =>
        p.project_code.toLowerCase().includes(q) ||
        (p.project_name ?? "").toLowerCase().includes(q) ||
        (p.client_id ?? "").toLowerCase().includes(q) ||
        p.type_of_project.toLowerCase().includes(q) ||
        (p.tech_coe ?? "").toLowerCase().includes(q)
    );
  }
  if (opts.riskFilter !== "all")      result = result.filter((p) => p.risk_band === opts.riskFilter);
  if (opts.rootCauseFilter !== "all") result = result.filter((p) => p.root_causes.includes(opts.rootCauseFilter));
  if (opts.typeFilter !== "all")      result = result.filter((p) => p.type_of_project === opts.typeFilter);
  if (opts.coeFilter !== "all") {
    result = result.filter((p) =>
      opts.coeFilter === "" ? p.coe === null : p.coe === opts.coeFilter
    );
  }
  if (opts.wsrFilter === "no_report")   result = result.filter((p) => !p.wsr_data_available);
  else if (opts.wsrFilter === "has_report") result = result.filter((p) => p.wsr_data_available);
  else if (opts.wsrFilter !== "all")    result = result.filter((p) => p.wsr_latest_signal === opts.wsrFilter);
  if (opts.understaffedOnly)    result = result.filter((p) => p.is_understaffed);
  if (opts.rampDownOnly)        result = result.filter((p) => p.is_ramp_down_candidate);
  if (opts.hasUnbilledValueOnly) result = result.filter((p) => p.monthly_unbilled_value_usd > 0);
  if (opts.devopsRiskOnly)      result = result.filter((p) => p.devops_extension_risk); // ← NEW
  if (opts.extensionRiskOnly)   result = result.filter((p) => p.is_extension_risk);
  if (opts.escalationRiskOnly)  result = result.filter((p) => p.is_escalation_risk);
  if (opts.pulseRiskOnly)       result = result.filter((p) => p.is_pulse_risk);

  const sorted = [...result];
  switch (opts.sort) {
    case "risk_desc":      sorted.sort((a, b) => b.risk_score - a.risk_score); break;
    case "overrun_desc":   sorted.sort((a, b) => (b.overrun_days ?? -Infinity) - (a.overrun_days ?? -Infinity)); break;
    case "unbilled_desc":  sorted.sort((a, b) => b.monthly_unbilled_value_usd - a.monthly_unbilled_value_usd); break;
    case "churn_desc":     sorted.sort((a, b) => (b.churn_rate ?? -Infinity) - (a.churn_rate ?? -Infinity)); break;
    case "headcount_desc": sorted.sort((a, b) => b.n_employees - a.n_employees); break;
    case "headcount_asc":  sorted.sort((a, b) => a.n_employees - b.n_employees); break;
    case "rampdown_asc":   sorted.sort((a, b) => (a.days_to_ramp_down ?? Infinity) - (b.days_to_ramp_down ?? Infinity)); break;
    case "project_asc":    sorted.sort((a, b) => a.project_code.localeCompare(b.project_code)); break;
    case "client_asc":     sorted.sort((a, b) => (a.client_id ?? "").localeCompare(b.client_id ?? "")); break;
  }
  return sorted;
}

// ── Inline DevOps cell — what the resource manager sees in each row ────────
function DevopsBoardCell({ p, onOpenProject }: { p: HealthProject; onOpenProject: (code: string, tab?: string) => void }) {
  if (!p.devops_data_available) {
    return <span className="text-gray-300 dark:text-gray-600 text-[11px]">—</span>;
  }

  if (p.devops_open_tickets === 0) {
    return <span className="text-emerald-500 text-[11px]">all closed</span>;
  }

  // Build a compact one-line summary for the RM
  const parts: string[] = [];
  if (p.devops_blocked_tickets > 0)       parts.push(`${p.devops_blocked_tickets} blocked`);
  if (p.devops_in_progress_tickets > 0)   parts.push(`${p.devops_in_progress_tickets} in progress`);
  if (p.devops_tickets_past_project_end > 0) parts.push(`${p.devops_tickets_past_project_end} past end`);

  const tooltip = [
    `${p.devops_open_tickets} open ticket(s)`,
    p.devops_remaining_effort_hours > 0 ? `${p.devops_remaining_effort_hours}h remaining` : null,
    p.devops_effort_completion_pct != null ? `${p.devops_effort_completion_pct}% effort done` : null,
    p.devops_is_overdue ? "project end date passed" : null,
    p.devops_within_risk_window
      ? `${p.devops_working_days_in_window} working day(s) left`
      : null,
    p.devops_capacity_surplus_hours != null
      ? p.devops_capacity_surplus_hours >= 0
        ? `${p.devops_capacity_surplus_hours}h capacity surplus`
        : `${Math.abs(p.devops_capacity_surplus_hours)}h capacity shortfall`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      onClick={() => onOpenProject(p.project_code, "devops")}
      title={tooltip}
      className="text-left"
    >
      {p.devops_extension_risk ? (
        <span className="inline-flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">
            {p.devops_is_overdue
              ? `overdue · ${p.devops_remaining_effort_hours}h left`
              : p.devops_capacity_surplus_hours != null && p.devops_capacity_surplus_hours < 0
              ? `${Math.abs(p.devops_capacity_surplus_hours)}h shortfall`
              : parts.join(" · ") || `${p.devops_open_tickets} open`}
          </span>
          {p.devops_remaining_effort_hours > 0 && !p.devops_is_overdue && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {p.devops_remaining_effort_hours}h remaining
            </span>
          )}
        </span>
      ) : (
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {p.devops_open_tickets} open · on track
        </span>
      )}
    </button>
  );
}

export default function HealthPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <HealthPageInner />
    </Suspense>
  );
}

// ── MetricCard — shared visual language for the stat row ───────────────────
// Deliberately restrained: a plain white card with a small tinted icon chip is
// the only color accent -- the big number stays neutral dark gray rather than
// a full red/amber card wash, so this row of KPI tiles doesn't read as alarms.
// The two real severity signals on this page (the per-row Risk badge and WSR
// badge, which mirror the actual risk score / real weekly status report) keep
// their real red/amber/green -- these 4 summary tiles are just counts.
// Real alert severity (Escalation Risk) stays true red -- that's a genuine
// "something's wrong" signal and needs to read as urgent regardless of brand
// styling. Understaffed/Extension Risk are real counts but not alarms on
// their own (see the tone note in the pre-brand-color version of this
// comment above), so they get distinct real JMAN secondary brand colors
// instead of sharing one generic "amber" -- each KPI reads as its own
// thing at a glance instead of two different concepts looking identical.
const METRIC_TONES = {
  red: "bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400",
  turquoise: "bg-jman-turquoise-50 text-jman-turquoise-700 dark:bg-jman-turquoise/15 dark:text-jman-turquoise",
  amethyst: "bg-jman-amethyst-50 text-jman-amethyst-700 dark:bg-jman-amethyst/15 dark:text-jman-amethyst",
} as const;

function MetricCard({
  icon: Icon, label, value, sub, active, onClick, tone = "turquoise",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub: string;
  active: boolean;
  onClick: () => void;
  tone?: keyof typeof METRIC_TONES;
}) {
  const hasSignal = value > 0;
  const chip = METRIC_TONES[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-2xl border p-4 transition-all duration-200 bg-white dark:bg-gray-900",
        "hover:shadow-md hover:-translate-y-0.5",
        active ? "border-gray-400 dark:border-gray-500 ring-2 ring-gray-200 dark:ring-gray-700" : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", hasSignal ? chip : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500")}>
          <Icon className="h-4 w-4" />
        </span>
        <ChevronRight className={cn("h-4 w-4 text-gray-300 dark:text-gray-600 transition-transform", active && "rotate-90 text-gray-400 dark:text-gray-500")} />
      </div>
      <p className="text-[28px] leading-none font-bold tracking-tight text-gray-900 dark:text-gray-100">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{sub}</p>
    </button>
  );
}

// ── RiskCountCard — the 3 headline High/Medium/Low tiles ───────────────────
// A plain white card with a thin colored left accent + colored label is
// enough to convey which band is which -- a full solid-color card fill for
// all 3 (including "High") made the very top of the page read as one big red
// block before any real per-project detail was even visible.
function RiskCountCard({
  label, value, tone, active, onClick,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "green";
  active: boolean;
  onClick: () => void;
}) {
  const dot = { red: "bg-rose-400", amber: "bg-amber-400", green: "bg-emerald-400" }[tone];
  const text = { red: "text-rose-600 dark:text-rose-400", amber: "text-amber-600 dark:text-amber-400", green: "text-emerald-600 dark:text-emerald-400" }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border bg-white dark:bg-gray-900 p-4 transition-all duration-200 hover:shadow-sm",
        active ? "border-gray-400 dark:border-gray-500 ring-2 ring-gray-200 dark:ring-gray-700" : "border-gray-200 dark:border-gray-700"
      )}
    >
      <p className={cn("flex items-center gap-1.5 text-xs font-semibold", text)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{value}</p>
    </button>
  );
}

// ── ScrollHintTable ──────────────────────────────────────────────────────────
// Wraps a wide table in an overflow-x-auto container and shows edge fades +
// a "scroll for more" hint whenever there's more content than fits, so users
// don't mistake a horizontally-scrollable table for one that's just missing data.
function ScrollHintTable({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  });

  return (
    <div className="relative">
      <div ref={scrollRef} onScroll={updateScrollState} className="overflow-x-auto">
        {children}
      </div>
      {canScrollRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-white dark:from-gray-900 to-transparent" />
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full bg-gray-900/80 px-2 py-1 text-[10px] font-medium text-white">
            scroll for more <ChevronRight className="h-3 w-3" />
          </div>
        </>
      )}
      {canScrollLeft && (
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-white dark:from-gray-900 to-transparent" />
      )}
    </div>
  );
}

function HealthPageInner() {
  const projects     = useQuery({ queryKey: ["health-projects"],       queryFn: api.healthProjects });

  const [selectedProject, setSelectedProject]         = useState<string | null>(null);
  const [selectedProjectTab, setSelectedProjectTab]   = useState<string | undefined>(undefined);
  const [unbilledProofProject, setUnbilledProofProject] = useState<{ code: string; client: string | null } | null>(null);
  const [revenueBreakdownTab, setRevenueBreakdownTab] = useState<"unbillable" | "extension">("unbillable");
  const [extensionProofProject, setExtensionProofProject] = useState<{ code: string; client: string | null } | null>(null);
  const [selectedEmployee, setSelectedEmployee]       = useState<string | null>(null);
  const searchParams = useSearchParams();

  const [search,             setSearch]             = useState("");
  const [riskFilter,         setRiskFilter]         = useState<RiskFilter>("all");
  const [rootCauseFilter,    setRootCauseFilter]    = useState("all");
  const [typeFilter,         setTypeFilter]         = useState("all");
  const [coeFilter,          setCoeFilter]          = useState("all");
  const [wsrFilter,          setWsrFilter]          = useState<WsrFilter>("all");
  const [understaffedOnly,   setUnderstaffedOnly]   = useState(false);
  const [rampDownOnly,       setRampDownOnly]       = useState(false);
  const [hasUnbilledValueOnly, setHasUnbilledValueOnly] = useState(false);
  const [devopsRiskOnly,     setDevopsRiskOnly]     = useState(false); // ← NEW
  const [revenueBreakdownOpen, setRevenueBreakdownOpen] = useState(false);
  const [revenuePeriod,      setRevenuePeriod]      = useState<RevenuePeriod>("month");
  const [sort,               setSort]               = useState<HealthSort>("risk_desc");

  const [extensionRiskOnly, setExtensionRiskOnly] = useState(false);
const [escalationRiskOnly, setEscalationRiskOnly] = useState(false);
  const [pulseRiskOnly, setPulseRiskOnly] = useState(false);

  useEffect(() => {
    const risk = searchParams.get("risk");
    if (risk === "high" || risk === "medium" || risk === "low") setRiskFilter(risk);
    if (searchParams.get("understaffed") === "true") setUnderstaffedOnly(true);
    if (searchParams.get("wsr") === "has_report")    setWsrFilter("has_report");
    if (searchParams.get("devops") === "true")       setDevopsRiskOnly(true); // ← NEW: deep-link support
    if (searchParams.get("revenue") === "true") {
      setHasUnbilledValueOnly(true);
      setRevenueBreakdownOpen(true);
    }
  }, []);

  const toggleRiskFilter = (band: "high" | "medium" | "low") =>
    setRiskFilter((current) => (current === band ? "all" : band));

  const toggleRevenue = () => {
    setHasUnbilledValueOnly((v) => {
      const next = !v;
      setRevenueBreakdownOpen(next);
      if (next) setRevenueBreakdownTab("unbillable");
      return next;
    });
  };

  // Open a project's detail modal, optionally jumping straight to a tab
  const openProject = (code: string, tab?: string) => {
    setSelectedProject(code);
    setSelectedProjectTab(tab);
  };

  if (projects.isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        <StatCardGridSkeleton count={3} className="grid grid-cols-1 sm:grid-cols-3 gap-4" />
        <StatCardGridSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-4" />
        <TableSkeleton columns={TABLE_COLUMNS.length} rows={10} />
      </div>
    );
  }
  if (projects.error) return <ErrorState message="Could not load health data." />;

  const data  = projects.data ?? [];
  const types = Array.from(new Set(data.map((p) => p.type_of_project))).sort();
  const coes  = Array.from(new Set(data.map((p) => p.coe).filter((v): v is string => Boolean(v)))).sort();

  const filtered = filterAndSortHealth(data, {
    search, riskFilter, rootCauseFilter, typeFilter, coeFilter,
    wsrFilter, understaffedOnly, rampDownOnly, hasUnbilledValueOnly,
    devopsRiskOnly, extensionRiskOnly, escalationRiskOnly, pulseRiskOnly, sort,
  });

  const hasActiveFilters =
    search !== "" ||
    riskFilter !== "all" ||
    rootCauseFilter !== "all" ||
    typeFilter !== "all" ||
    coeFilter !== "all" ||
    wsrFilter !== "all" ||
    understaffedOnly ||
    rampDownOnly ||
    hasUnbilledValueOnly ||
    devopsRiskOnly ||
    extensionRiskOnly ||
    escalationRiskOnly ||
    pulseRiskOnly;

  const clearFilters = () => {
    setSearch("");
    setRiskFilter("all");
    setRootCauseFilter("all");
    setTypeFilter("all");
    setCoeFilter("all");
    setWsrFilter("all");
    setUnderstaffedOnly(false);
    setRampDownOnly(false);
    setHasUnbilledValueOnly(false);
    setDevopsRiskOnly(false); // ← NEW
    setRevenueBreakdownOpen(false);
    setExtensionRiskOnly(false);
    setEscalationRiskOnly(false);
    setPulseRiskOnly(false);
  };

  const counts = {
    high:   data.filter((p) => p.risk_band === "high").length,
    medium: data.filter((p) => p.risk_band === "medium").length,
    low:    data.filter((p) => p.risk_band === "low").length,
  };
  const understaffedCount  = data.filter((p) => p.is_understaffed).length;
  const devopsRiskCount    = data.filter((p) => p.devops_extension_risk).length; // ← NEW
  const extensionRiskCount = data.filter((p) => p.is_extension_risk).length;
  const escalationRiskCount = data.filter((p) => p.is_escalation_risk).length;
  const pulseRiskCount = data.filter((p) => p.is_pulse_risk).length;
  const totalUnbilledValue = data.reduce((sum, p) => sum + p.monthly_unbilled_value_usd, 0);
  const unbilledProjects = [...data]
    .filter((p) => p.monthly_unbilled_value_usd > 0)
    .sort((a, b) => b.monthly_unbilled_value_usd - a.monthly_unbilled_value_usd);
  const totalExtensionPredicted = data.reduce((sum, p) => sum + (p.predicted_extension_revenue_loss_usd ?? 0), 0);
  const extensionProjects = [...data]
    .filter((p) => (p.extension_unbilled_value_usd ?? 0) > 0 || (p.predicted_extension_revenue_loss_usd ?? 0) > 0)
    .sort((a, b) =>
      ((b.extension_unbilled_value_usd ?? 0) + (b.predicted_extension_revenue_loss_usd ?? 0)) -
      ((a.extension_unbilled_value_usd ?? 0) + (a.predicted_extension_revenue_loss_usd ?? 0))
    );

  if (selectedProject) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        {/* ── Breadcrumb -- drills into the project's full detail as a page instead of
            a modal, since the Health page is where those tabs get used most heavily
            and a modal is cramped for that. Same content as ProjectHealthDetailModal
            (which is untouched, and still used everywhere else). ── */}
        <nav className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => { setSelectedProject(null); setSelectedProjectTab(undefined); }}
            className="text-primary hover:underline"
          >
            Health
          </button>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="text-gray-500 dark:text-gray-400 font-medium">{selectedProject}</span>
        </nav>
        <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
          <ProjectHealthDetailContent projectCode={selectedProject} initialTab={selectedProjectTab as any} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">

      {/* ── Row 1: three separate risk cards (High/Medium/Low), each independently clickable ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <RiskCountCard
          label="High Risk"
          value={counts.high}
          tone="red"
          active={riskFilter === "high"}
          onClick={() => toggleRiskFilter("high")}
        />
        <RiskCountCard
          label="Medium Risk"
          value={counts.medium}
          tone="amber"
          active={riskFilter === "medium"}
          onClick={() => toggleRiskFilter("medium")}
        />
        <RiskCountCard
          label="Low Risk"
          value={counts.low}
          tone="green"
          active={riskFilter === "low"}
          onClick={() => toggleRiskFilter("low")}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Users}
          label="Understaffed"
          value={understaffedCount}
          sub="below 75% of expected headcount"
          tone="turquoise"
          active={understaffedOnly}
          onClick={() => setUnderstaffedOnly((v) => !v)}
        />
        <UnbilledValueCard
          totalMonthly={totalUnbilledValue}
          period={revenuePeriod}
          onPeriodChange={setRevenuePeriod}
          active={hasUnbilledValueOnly}
          onClick={toggleRevenue}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Escalation Risk"
          value={escalationRiskCount}
          sub="WSR stuck/worsening, or a recent effort spike"
          tone="red"
          active={escalationRiskOnly}
          onClick={() => setEscalationRiskOnly((v) => !v)}
        />
        <MetricCard
          icon={Clock}
          label="Extension Risk"
          value={extensionRiskCount}
          sub="DevOps ticket work forecast to run past the project's end date"
          tone="amethyst"
          active={extensionRiskOnly}
          onClick={() => setExtensionRiskOnly((v) => !v)}
        />
      </div>

{/* ── Revenue breakdown panel ── */}
      {revenueBreakdownOpen && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 p-3.5 space-y-2.5">
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg p-0.5 w-fit border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setRevenueBreakdownTab("unbillable")}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-md font-medium transition",
                revenueBreakdownTab === "unbillable" ? "bg-gradient-jman text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              )}
            >
              Unbillable work
            </button>
            <button
              onClick={() => setRevenueBreakdownTab("extension")}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-md font-medium transition",
                revenueBreakdownTab === "extension" ? "bg-gradient-jman text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              )}
            >
              Extension overrun
            </button>
          </div>

          {revenueBreakdownTab === "unbillable" ? (
            <>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Projected unbilled value for the selected period (allocation % × hourly rate × 160 monthly hours), for people currently marked SHADOW/UNBILLED.
              </p>
              <div className="rounded-lg border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
                <ScrollHintTable>
                  <table className="w-full text-xs">
                    <thead className="bg-secondary text-secondary-foreground">
                      <tr>
                        <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Project</th>
                        <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">$ at risk / {revenuePeriod}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unbilledProjects.map((p) => (
                        <tr key={p.project_code} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                          <td className="px-3 py-1.5 max-w-[240px]">
                            <button onClick={() => openProject(p.project_code)} className="block text-left" title={p.project_name ?? undefined}>
                              <span className="font-medium text-primary hover:underline whitespace-nowrap">{p.project_code}</span>
                              {p.project_name && <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{p.project_name}</span>}
                            </button>
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => setUnbilledProofProject({ code: p.project_code, client: p.client_id })}
                              className="text-gray-700 dark:text-gray-300 font-medium hover:underline hover:text-primary"
                              title="Click to see exactly which allocations this figure comes from"
                            >
                              {formatUsd(convertRevenue(p.monthly_unbilled_value_usd, revenuePeriod))}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {unbilledProjects.length === 0 && (
                        <tr>
                          <td colSpan={2} className="text-center text-xs text-gray-400 dark:text-gray-500 italic py-4">
                            No projects currently have unbilled value at risk.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ScrollHintTable>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                <strong>Predicted</strong> = the DevOps-capacity day forecast (same as each project&apos;s Overview tab) × the current team&apos;s $/working-day if they keep going ({formatUsd(totalExtensionPredicted)} total). Day/week/month toggle above doesn&apos;t apply — this is a working-day total.
              </p>
              <div className="rounded-lg border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
                <ScrollHintTable>
                  <table className="w-full text-xs">
                    <thead className="bg-secondary text-secondary-foreground">
                      <tr>
                        <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Project</th>
                        <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Predicted window</th>
                        <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Time</th>
                        <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Predicted $ (more)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extensionProjects.map((p) => (
                        <tr key={p.project_code} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                          <td className="px-3 py-1.5 max-w-[240px]">
                            <button onClick={() => openProject(p.project_code)} className="block text-left" title={p.project_name ?? undefined}>
                              <span className="font-medium text-primary hover:underline whitespace-nowrap">{p.project_code}</span>
                              {p.project_name && <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{p.project_name}</span>}
                            </button>
                          </td>
                          <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {p.predicted_extension_start_date && p.predicted_extension_end_date
                              ? `${p.predicted_extension_start_date} → ${p.predicted_extension_end_date}`
                              : "-"}
                          </td>
                          <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {p.projected_extension_duration_label ?? "-"}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            {(p.predicted_extension_revenue_loss_usd ?? 0) > 0 ? (
                              <button
                                onClick={() => setExtensionProofProject({ code: p.project_code, client: p.client_id })}
                                className="text-gray-700 dark:text-gray-300 font-medium hover:underline hover:text-primary"
                                title={`${p.projected_extension_duration_label ?? `${p.projected_extension_days}d`} · ${p.projected_extension_confidence} confidence — click to see breakdown`}
                              >
                                {formatUsd(p.predicted_extension_revenue_loss_usd ?? 0)}
                              </button>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {extensionProjects.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center text-xs text-gray-400 dark:text-gray-500 italic py-4">
                            No projects currently show extension-related revenue loss.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ScrollHintTable>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Filter panel ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Projects ({filtered.length}/{data.length})
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[11px] text-primary hover:underline">
              Clear filters
            </button>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as HealthSort)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 ml-auto dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project, client, type, tech COE…"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-gray-300 dark:border-gray-700 dark:focus:border-gray-600"
        />

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Risk pill tabs */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 text-xs font-medium">
            {(["all", "high", "medium", "low"] as RiskFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setRiskFilter(f)}
                className={cn(
                  "px-3 py-1 rounded-full transition-all capitalize",
                  riskFilter === f ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Dropdown filters */}
          <select
            value={rootCauseFilter}
            onChange={(e) => setRootCauseFilter(e.target.value)}
            className={cn(
              "text-[11px] px-1.5 py-1 rounded-lg border bg-white dark:bg-gray-900 transition-colors",
              rootCauseFilter !== "all"
                ? "border-primary/50 text-primary font-semibold bg-primary/5"
                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            )}
          >
            <option value="all">All root causes</option>
            {ROOT_CAUSES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={cn(
              "text-[11px] px-1.5 py-1 rounded-lg border bg-white dark:bg-gray-900 transition-colors",
              typeFilter !== "all"
                ? "border-primary/50 text-primary font-semibold bg-primary/5"
                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            )}
          >
            <option value="all">All project types</option>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={coeFilter}
            onChange={(e) => setCoeFilter(e.target.value)}
            className={cn(
              "text-[11px] px-1.5 py-1 rounded-lg border bg-white dark:bg-gray-900 transition-colors",
              coeFilter !== "all"
                ? "border-primary/50 text-primary font-semibold bg-primary/5"
                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            )}
          >
            <option value="all">All CoEs</option>
            {coes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="">Not determined</option>
          </select>

          <select
            value={wsrFilter}
            onChange={(e) => setWsrFilter(e.target.value as WsrFilter)}
            className={cn(
              "text-[11px] px-1.5 py-1 rounded-lg border bg-white dark:bg-gray-900 transition-colors",
              wsrFilter !== "all"
                ? "border-primary/50 text-primary font-semibold bg-primary/5"
                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            )}
          >
            <option value="all">All WSR</option>
            <option value="RED">Latest WSR: RED</option>
            <option value="AMBER">Latest WSR: AMBER</option>
            <option value="GREEN">Latest WSR: GREEN</option>
            <option value="no_report">No WSR report</option>
          </select>

          {/* Toggle buttons */}
          <button
            onClick={() => setUnderstaffedOnly((v) => !v)}
            className={cn(
              "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
              understaffedOnly
                ? "bg-primary/10 border-primary/40 text-primary font-semibold"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
            )}
          >
            Understaffed only
          </button>

          <button
            onClick={() => setRampDownOnly((v) => !v)}
            className={cn(
              "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
              rampDownOnly
                ? "bg-primary/10 border-primary/40 text-primary font-semibold"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
            )}
          >
            Ramp-down only
          </button>

          {/* ← NEW: DevOps risk toggle */}
          <button
            onClick={() => setDevopsRiskOnly((v) => !v)}
            className={cn(
              "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
              devopsRiskOnly
                ? "bg-primary/10 border-primary/40 text-primary font-semibold"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
            )}
          >
            DevOps risk only
            {devopsRiskCount > 0 && (
              <span
                className={cn(
                  "ml-1 inline-flex items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none",
                  devopsRiskOnly ? "bg-gradient-jman text-white shadow-sm" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                )}
              >
                {devopsRiskCount}
              </span>
            )}
          </button>

          <button
  onClick={() => setExtensionRiskOnly((v) => !v)}
  className={cn(
    "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
    extensionRiskOnly
      ? "bg-primary/10 border-primary/40 text-primary font-semibold"
      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
  )}
>
  Extension risk only
  {extensionRiskCount > 0 && (
    <span className={cn(
      "ml-1 inline-flex items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none",
      extensionRiskOnly ? "bg-gradient-jman text-white shadow-sm" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
    )}>
      {extensionRiskCount}
    </span>
  )}
</button>

<button
  onClick={() => setEscalationRiskOnly((v) => !v)}
  className={cn(
    "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
    escalationRiskOnly
      ? "bg-primary/10 border-primary/40 text-primary font-semibold"
      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
  )}
>
  Escalation only
  {escalationRiskCount > 0 && (
    <span className={cn(
      "ml-1 inline-flex items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none",
      escalationRiskOnly ? "bg-gradient-jman text-white shadow-sm" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
    )}>
      {escalationRiskCount}
    </span>
  )}
</button>

<button
  onClick={() => setPulseRiskOnly((v) => !v)}
  className={cn(
    "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
    pulseRiskOnly
      ? "bg-primary/10 border-primary/40 text-primary font-semibold"
      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
  )}
>
  Pulse risk only
  {pulseRiskCount > 0 && (
    <span className={cn(
      "ml-1 inline-flex items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none",
      pulseRiskOnly ? "bg-gradient-jman text-white shadow-sm" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
    )}>
      {pulseRiskCount}
    </span>
  )}
</button>
        </div>
      </div>

      {/* ── Main project table ── */}
      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
        <ScrollHintTable>
          <table className="w-full text-xs data-table">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                {TABLE_COLUMNS.map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.project_code} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">

                  {/* Project */}
                  <td className="px-3 py-2 max-w-[240px]">
                    <button
                      onClick={() => openProject(p.project_code)}
                      className="block text-left"
                      title={p.project_name ?? "View full proof & allocation detail"}
                    >
                      <span className="font-medium text-primary hover:underline whitespace-nowrap">{p.project_code}</span>
                      {p.project_name && (
                        <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{p.project_name}</span>
                      )}
                    </button>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.type_of_project}</td>

                  {/* Team */}
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {p.n_employees} / {p.expected_headcount ?? "?"}
                    {p.is_understaffed && <Badge variant="default">understaffed</Badge>}
                  </td>

                  {/* Risk */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant={p.risk_band}>{p.risk_band}</Badge>
                  </td>

                  {/* Root causes -- kept neutral/outlined rather than solid red/amber/purple
                      pills: the Risk badge and WSR badge (below) are the two real severity
                      signals on this row, these are just which real factors fed into that
                      score, so they don't need to shout too. Every category that actually
                      fired is shown here (staffing/financial included, not just
                      extension/escalation/pulse) -- an earlier version silently dropped
                      staffing (high_churn/understaffed) and financial (shadow_heavy), which
                      made e.g. a genuine high_churn+wsr_risk "high" project look like it
                      only had one weak signal ("escalation") instead of the real two. */}
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    <div className="flex items-center gap-1 flex-wrap">
                      {p.is_extension_risk && <Badge variant="default">extension</Badge>}
                      {p.is_escalation_risk && <Badge variant="default">escalation</Badge>}
                      {(p.root_cause_categories.staffing?.length ?? 0) > 0 && <Badge variant="default">staffing</Badge>}
                      {(p.root_cause_categories.financial?.length ?? 0) > 0 && <Badge variant="default">financial</Badge>}
                      {p.root_cause_categories.people?.includes("overtime_risk") && <Badge variant="default">overtime</Badge>}
                      {p.is_pulse_risk && <Badge variant="default">pulse {p.pulse_avg_score}/4</Badge>}
                      {Object.keys(p.root_cause_categories).length === 0 && <span className="text-gray-300 dark:text-gray-600">-</span>}
                    </div>
                  </td>

                  {/* Unbilled $/mo */}
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {p.monthly_unbilled_value_usd > 0
                      ? formatUsd(p.monthly_unbilled_value_usd)
                      : "-"}
                  </td>

                  {/* Real WSR (latest) */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {p.wsr_latest_signal ? (
                        <span title={`Most recent real WSR report. Worst ever: ${p.wsr_worst_signal ?? "n/a"}.`}>
                          <Badge variant={p.wsr_latest_signal}>{p.wsr_latest_signal}</Badge>
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">no report</span>
                      )}
                      {p.wsr_trend && (
                        <span
                          title={`WSR trend: ${p.wsr_trend}`}
                          className={cn(
                            "text-xs font-semibold",
                            p.wsr_trend === "deteriorating"
                              ? "text-red-500"
                              : p.wsr_trend === "improving"
                              ? "text-emerald-500"
                              : "text-gray-300 dark:text-gray-600"
                          )}
                        >
                          {p.wsr_trend === "deteriorating" ? "↓" : p.wsr_trend === "improving" ? "↑" : "→"}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* ← NEW: DevOps board cell */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <DevopsBoardCell p={p} onOpenProject={openProject} />
                  </td>

                  {/* Ramp-down column hidden from the frontend table per request -- kept here, commented, in case it's needed again:
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.is_ramp_down_candidate && (
                      <Badge variant="default">{p.days_to_ramp_down}d</Badge>
                    )}
                  </td>
                  */}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={TABLE_COLUMNS.length} // ← was hardcoded 9, now always in sync
                    className="text-center text-xs text-gray-400 dark:text-gray-500 italic py-6"
                  >
                    No projects match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollHintTable>
      </div>

      {/* ── Modals ── */}
      {unbilledProofProject && (
        <UnbilledValueProofModal
          projectCode={unbilledProofProject.code}
          client={unbilledProofProject.client}
          period={revenuePeriod}
          onClose={() => setUnbilledProofProject(null)}
        />
      )}
      {extensionProofProject && (
        <ExtensionRevenueProofModal
          projectCode={extensionProofProject.code}
          client={extensionProofProject.client}
          onClose={() => setExtensionProofProject(null)}
        />
      )}
      {selectedEmployee && (
        <EmployeeProfileModal
          employeeId={selectedEmployee}
          initialTab="overtime"
          onClose={() => setSelectedEmployee(null)}
        />
      )}
    </div>
  );
}


// ── UnbilledValueProofModal ────────────────────────────────────────────────
function UnbilledValueProofModal({
  projectCode, client, period, onClose,
}: {
  projectCode: string;
  client: string | null;
  period: RevenuePeriod;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["health-project-detail", projectCode],
    queryFn: () => api.healthProjectDetail(projectCode),
  });

  return (
    <Modal
      title={`${projectCode}${client ? ` — ${client}` : ""} — Unbilled Value Proof`}
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="p-5 space-y-3 text-xs">
        {detail.isLoading ? (
          <LoadingState label="Loading allocation proof…" />
        ) : detail.error || !detail.data ? (
          <ErrorState message="Could not load this project's allocation detail." />
        ) : (() => {
          const proof = detail.data.shadow_heavy;
          const rows  = proof.qualifying_allocations;
          return (
            <>
              <p className="text-gray-500 dark:text-gray-400">
                Every currently-active SHADOW/UNBILLED allocation on this project, converted to{" "}
                <strong>per {period}</strong> (allocation % × Rate Card hourly rate × 160 standard monthly hours).
                These rows exactly sum to the {formatUsd(convertRevenue(proof.monthly_unbilled_value_usd, period))}/{period} shown in the table.
              </p>
              {rows.length === 0 ? (
                <p className="text-gray-400 dark:text-gray-500 italic">No currently-active shadow/unbilled allocations on this project.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left font-medium py-1.5">Employee</th>
                      <th className="text-left font-medium py-1.5">Designation</th>
                      <th className="text-left font-medium py-1.5">Status</th>
                      <th className="text-right font-medium py-1.5">Alloc %</th>
                      <th className="text-right font-medium py-1.5">Rate/hr</th>
                      <th className="text-right font-medium py-1.5">$/{period}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                        <td className="py-1.5 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.employee_id}</td>
                        <td className="py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.job_name ?? "-"}</td>
                        <td className="py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.resourcing_status}</td>
                        <td className="py-1.5 text-right text-gray-700 dark:text-gray-300">{r.allocation_by_percentage}%</td>
                        <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">
                          {r.hourly_rate_usd != null ? `$${r.hourly_rate_usd}` : "-"}
                        </td>
                        <td className="py-1.5 text-right text-gray-700 dark:text-gray-300 font-medium">
                          {formatUsd(convertRevenue(r.monthly_unbilled_value_usd, period))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 dark:border-gray-700">
                      <td colSpan={5} className="py-1.5 text-right font-semibold text-gray-700 dark:text-gray-300">Total</td>
                      <td className="py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">
                        {formatUsd(rows.reduce((sum, r) => sum + convertRevenue(r.monthly_unbilled_value_usd, period), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </>
          );
        })()}
      </div>
    </Modal>
  );
}

// ── ExtensionRevenueProofModal ──────────────────────────────────────────────
function ExtensionRevenueProofModal({
  projectCode, client, onClose,
}: {
  projectCode: string;
  client: string | null;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["health-project-detail", projectCode],
    queryFn: () => api.healthProjectDetail(projectCode),
  });

  return (
    <Modal
      title={`${projectCode}${client ? ` — ${client}` : ""} — Extension Revenue Proof`}
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="p-5 space-y-4 text-xs">
        {detail.isLoading ? (
          <LoadingState label="Loading extension proof…" />
        ) : detail.error || !detail.data ? (
          <ErrorState message="Could not load this project's allocation detail." />
        ) : (() => {
          const proof = detail.data.extension_revenue;
          const accruedRows   = proof.qualifying_allocations;
          const predictedRows = proof.predicted_breakdown;
          return (
            <>
              <p className="text-gray-500 dark:text-gray-400">{proof.note}</p>

              <div className="space-y-1.5">
                <p className="font-semibold text-gray-700 dark:text-gray-300">
                  Accrued — {formatUsd(proof.extension_unbilled_value_usd)} total
                </p>
                {accruedRows.length === 0 ? (
                  <p className="text-gray-400 dark:text-gray-500 italic">No billable allocations currently overrunning the project end date.</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left font-medium py-1.5">Employee</th>
                        <th className="text-left font-medium py-1.5">Designation</th>
                        <th className="text-left font-medium py-1.5">Status</th>
                        <th className="text-right font-medium py-1.5">Alloc %</th>
                        <th className="text-right font-medium py-1.5">Rate/hr</th>
                        <th className="text-right font-medium py-1.5">Overrun days</th>
                        <th className="text-right font-medium py-1.5">Accrued $</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accruedRows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                          <td className="py-1.5 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.employee_id}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.job_name ?? "-"}</td>
                          <td className="py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.resourcing_status}</td>
                          <td className="py-1.5 text-right text-gray-700 dark:text-gray-300">{r.allocation_by_percentage}%</td>
                          <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">
                            {r.hourly_rate_usd != null ? `$${r.hourly_rate_usd}` : "-"}
                          </td>
                          <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">{r.overrun_working_days}</td>
                          <td className="py-1.5 text-right text-gray-700 dark:text-gray-300 font-medium">
                            {formatUsd(r.extension_unbilled_value_usd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 dark:border-gray-700">
                        <td colSpan={6} className="py-1.5 text-right font-semibold text-gray-700 dark:text-gray-300">Total</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">
                          {formatUsd(accruedRows.reduce((sum, r) => sum + r.extension_unbilled_value_usd, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-gray-700 dark:text-gray-300">
                  Predicted (more) — {formatUsd(proof.predicted_extension_revenue_loss_usd)}
                  {proof.projected_extension_duration_label ? ` over ${proof.projected_extension_duration_label}` : ""}
                  {proof.projected_extension_confidence !== "none" ? ` · ${proof.projected_extension_confidence} confidence` : ""}
                </p>
                {predictedRows.length === 0 ? (
                  <p className="text-gray-400 dark:text-gray-500 italic">No forward extension forecast for this project.</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left font-medium py-1.5">Employee</th>
                        <th className="text-left font-medium py-1.5">Designation</th>
                        <th className="text-left font-medium py-1.5">Status</th>
                        <th className="text-right font-medium py-1.5">Alloc %</th>
                        <th className="text-right font-medium py-1.5">Rate/hr</th>
                        <th className="text-right font-medium py-1.5">Predicted $</th>
                      </tr>
                    </thead>
                    <tbody>
                      {predictedRows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                          <td className="py-1.5 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.employee_id}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.job_name ?? "-"}</td>
                          <td className="py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.resourcing_status}</td>
                          <td className="py-1.5 text-right text-gray-700 dark:text-gray-300">{r.allocation_by_percentage}%</td>
                          <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">
                            {r.hourly_rate_usd != null ? `$${r.hourly_rate_usd}` : "-"}
                          </td>
                          <td className="py-1.5 text-right text-gray-700 dark:text-gray-300 font-medium">
                            {formatUsd(r.predicted_additional_usd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 dark:border-gray-700">
                        <td colSpan={5} className="py-1.5 text-right font-semibold text-gray-700 dark:text-gray-300">Total</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">
                          {formatUsd(predictedRows.reduce((sum, r) => sum + r.predicted_additional_usd, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </>
          );
        })()}
      </div>
    </Modal>
  );
}

// ── UnbilledValueCard ───────────────────────────────────────────────────────
function UnbilledValueCard({
  totalMonthly, period, onPeriodChange, active, onClick,
}: {
  totalMonthly: number;
  period: RevenuePeriod;
  onPeriodChange: (p: RevenuePeriod) => void;
  active: boolean;
  onClick: () => void;
}) {
  const value = convertRevenue(totalMonthly, period);
  const hasSignal = totalMonthly > 0;

  return (
    <div
      className={cn(
        "group relative rounded-2xl border p-4 transition-all duration-200 bg-white dark:bg-gray-900",
        "hover:shadow-md hover:-translate-y-0.5",
        active ? "border-gray-400 dark:border-gray-500 ring-2 ring-gray-200 dark:ring-gray-700" : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", hasSignal ? "bg-jman-lightblue-50 text-jman-lightblue-700 dark:bg-jman-lightblue/15 dark:text-jman-lightblue" : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500")}>
          <DollarSign className="h-4 w-4" />
        </span>
        <div className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 dark:bg-gray-800 p-0.5">
          {(["day", "week", "month"] as RevenuePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full capitalize font-medium transition",
                p === period ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onClick} className="w-full text-left">
        <p className="text-[28px] leading-none font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {formatUsd(value)}
        </p>
        <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Unbilled Value at Risk</p>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">rate card, per {period}</p>
      </button>
    </div>
  );
}
