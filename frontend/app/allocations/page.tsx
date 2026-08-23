"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, AlertTriangle, Clock, Users, DollarSign, Loader2 } from "lucide-react";
import { api, type AllocationRow } from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { LoadingState, ErrorState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeleton";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { ExtendProjectModal } from "@/components/shared/ExtendProjectModal";
import { ExtendAllocationModal } from "@/components/shared/ExtendAllocationModal";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { TimesheetProofModal } from "@/components/shared/TimesheetProofModal";
import { cn, formatUsd } from "@/lib/utils";

type Tab = "resource" | "project";
type StatusFilter = string;
type BandFilter = "all" | "over_allocated" | "normal" | "under_utilized";
type HoursBandFilter = "all" | "over_allocated" | "normal" | "under_utilized" | "no_data";
type Sort =
  | "alloc_desc"
  | "alloc_asc"
  | "hours_desc"
  | "hours_asc"
  | "ending_soonest"
  | "employee_asc"
  | "project_asc";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "alloc_desc", label: "Alloc % ↓" },
  { value: "alloc_asc", label: "Alloc % ↑" },
  { value: "hours_desc", label: "Hours Util. ↓" },
  { value: "hours_asc", label: "Hours Util. ↑" },
  { value: "ending_soonest", label: "Ending soonest" },
  { value: "employee_asc", label: "Employee A–Z" },
  { value: "project_asc", label: "Project A–Z" },
];

function hoursUtilizationBand(pct: number): "over_allocated" | "normal" | "under_utilized" {
  if (pct > 100) return "over_allocated";
  if (pct < 70) return "under_utilized";
  return "normal";
}

interface FilterOptions {
  search: string;
  statusFilter: StatusFilter;
  bandFilter: BandFilter;
  hoursBandFilter: HoursBandFilter;
  coeFilter: string;
  typeFilter: string;
  absenceOnly: boolean;
  endingSoonOnly: boolean;
  dateFrom: string;
  dateTo: string;
  sort: Sort;
}

function filterAndSortAllocations(rows: AllocationRow[], opts: FilterOptions): AllocationRow[] {
  let result = rows;

  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter((r) =>
      [r.employee_id, r.job_name, r.project_id, r.project_name, r.location].some((v) => v?.toLowerCase().includes(q))
    );
  }
  if (opts.statusFilter !== "all") result = result.filter((r) => r.resourcing_status === opts.statusFilter);
  if (opts.bandFilter !== "all") result = result.filter((r) => r.utilization_band === opts.bandFilter);
  if (opts.hoursBandFilter !== "all") {
    if (opts.hoursBandFilter === "no_data") result = result.filter((r) => !r.hours_data_available);
    else result = result.filter((r) => r.hours_data_available && r.hours_utilization_pct !== null && hoursUtilizationBand(r.hours_utilization_pct) === opts.hoursBandFilter);
  }
  if (opts.coeFilter !== "all") {
    result = result.filter((r) => (opts.coeFilter === "" ? r.coe === null : r.coe === opts.coeFilter));
  }
  if (opts.typeFilter !== "all") result = result.filter((r) => r.type_of_project === opts.typeFilter);
  if (opts.absenceOnly) result = result.filter((r) => r.possible_unplanned_absence);
  if (opts.endingSoonOnly) result = result.filter((r) => r.ending_soon);
  // Overlap test (active-during), not an exact-date match.
  if (opts.dateFrom) result = result.filter((r) => r.allocated_end_date >= opts.dateFrom);
  if (opts.dateTo) result = result.filter((r) => r.allocated_start_date <= opts.dateTo);

  const sorted = [...result];
  switch (opts.sort) {
    case "alloc_desc": sorted.sort((a, b) => b.allocation_by_percentage - a.allocation_by_percentage); break;
    case "alloc_asc": sorted.sort((a, b) => a.allocation_by_percentage - b.allocation_by_percentage); break;
    case "hours_desc": sorted.sort((a, b) => (b.hours_utilization_pct ?? -1) - (a.hours_utilization_pct ?? -1)); break;
    case "hours_asc": sorted.sort((a, b) => (a.hours_utilization_pct ?? 9999) - (b.hours_utilization_pct ?? 9999)); break;
    case "ending_soonest": sorted.sort((a, b) => a.days_to_end - b.days_to_end); break;
    case "employee_asc": sorted.sort((a, b) => a.employee_id.localeCompare(b.employee_id)); break;
    case "project_asc": sorted.sort((a, b) => a.project_id.localeCompare(b.project_id)); break;
  }
  return sorted;
}

export default function AllocationsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <AllocationsPageInner />
    </Suspense>
  );
}

function AllocationsPageInner() {
  const { data, isLoading, error } = useQuery({ queryKey: ["allocations"], queryFn: api.allocations });
  const healthProjects = useQuery({ queryKey: ["health-projects"], queryFn: api.healthProjects });
  const [tab, setTab] = useState<Tab>("resource");
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [bandFilter, setBandFilter] = useState<BandFilter>("all");
  const [hoursBandFilter, setHoursBandFilter] = useState<HoursBandFilter>("all");
  const [coeFilter, setCoeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [absenceOnly, setAbsenceOnly] = useState(false);
  const [endingSoonOnly, setEndingSoonOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<Sort>("alloc_desc");

  useEffect(() => {
    if (searchParams.get("endingSoon") === "true") setEndingSoonOnly(true);
    const band = searchParams.get("band");
    if (band === "over_allocated" || band === "normal" || band === "under_utilized") setBandFilter(band);
  }, []);

  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [extendingProjectCode, setExtendingProjectCode] = useState<string | null>(null);
  const [extendingAllocation, setExtendingAllocation] = useState<AllocationRow | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const toggleProjectExpanded = (projectId: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  const [selectedTimesheet, setSelectedTimesheet] = useState<{ employeeId: string; projectId: string } | null>(null);

  const healthProjectByCode = useMemo(
    () => new Map((healthProjects.data ?? []).map((p) => [p.project_code, p])),
    [healthProjects.data]
  );

  const statuses = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.resourcing_status))).sort(), [data]);
  const coes = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.coe).filter((v): v is string => Boolean(v)))).sort(), [data]);
  const types = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.type_of_project).filter((v): v is string => Boolean(v)))).sort(), [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return filterAndSortAllocations(data, {
      search, statusFilter, bandFilter, hoursBandFilter, coeFilter, typeFilter, absenceOnly, endingSoonOnly, dateFrom, dateTo, sort,
    });
  }, [data, search, statusFilter, bandFilter, hoursBandFilter, coeFilter, typeFilter, absenceOnly, endingSoonOnly, dateFrom, dateTo, sort]);

  const hasActiveFilters =
    search !== "" || statusFilter !== "all" || bandFilter !== "all" || hoursBandFilter !== "all" ||
    coeFilter !== "all" || typeFilter !== "all" || absenceOnly || endingSoonOnly || dateFrom !== "" || dateTo !== "";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setBandFilter("all");
    setHoursBandFilter("all");
    setCoeFilter("all");
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setAbsenceOnly(false);
    setEndingSoonOnly(false);
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        <TableSkeleton columns={11} rows={10} />
      </div>
    );
  }
  if (error) return <ErrorState message="Could not load allocations." />;

  const byProject = groupBy(filtered, (r) => r.project_id);

  const openProject = (projectId: string) => setSelectedProject(projectId);

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 text-xs font-medium">
          {(["resource", "project"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("px-4 py-1.5 rounded-full transition-all capitalize", tab === t ? "bg-white shadow-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300")}
            >
              By {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {filtered.length} of {data?.length ?? 0} allocation(s)
          {hasActiveFilters && (
            <button onClick={clearFilters} className="ml-2 text-primary hover:underline">
              Clear filters
            </button>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee, project, location…"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 outline-none focus:border-gray-300 dark:focus:border-gray-600"
        />

        <div className="flex items-center gap-1.5 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={bandFilter}
              onChange={(e) => setBandFilter(e.target.value as BandFilter)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
            >
              <option value="all">All utilization</option>
              <option value="over_allocated">Over-allocated</option>
              <option value="normal">Normal</option>
              <option value="under_utilized">Under-utilized</option>
            </select>
            <select
              value={hoursBandFilter}
              onChange={(e) => setHoursBandFilter(e.target.value as HoursBandFilter)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
            >
              <option value="all">All hours util.</option>
              <option value="over_allocated">Hours: over</option>
              <option value="normal">Hours: normal</option>
              <option value="under_utilized">Hours: under</option>
              <option value="no_data">Hours: no data yet</option>
            </select>
            <select
              value={coeFilter}
              onChange={(e) => setCoeFilter(e.target.value)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
            >
              <option value="all">All CoEs</option>
              {coes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="">Not determined</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
            >
              <option value="all">All project types</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => setAbsenceOnly((v) => !v)}
              className={cn(
                "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition",
                absenceOnly ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400" : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
              )}
            >
              Possible absence only
            </button>
            <button
              onClick={() => setEndingSoonOnly((v) => !v)}
              className={cn(
                "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition",
                endingSoonOnly ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400" : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
              )}
            >
              Ending soon only
            </button>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">Active during</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
              />
              <span className="text-[10px] text-gray-400 dark:text-gray-500">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 ml-auto"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
      </div>

      {tab === "resource" ? (
        <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs data-table">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                {["Employee", "Designation", "Location", "Project", "Billing", "Alloc %", "Utilization", "Hours Util.", "Ends", "Extended End", "Soon?"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <ResourceRow
                  key={`${r.employee_id}-${r.project_id}`}
                  row={r}
                  onOpenEmployee={() => setSelectedEmployee(r.employee_id)}
                  onOpenProject={() => openProject(r.project_id)}
                  onOpenTimesheet={() => setSelectedTimesheet({ employeeId: r.employee_id, projectId: r.project_id })}
                  onExtendAllocation={() => setExtendingAllocation(r)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center text-xs text-gray-400 dark:text-gray-500 italic py-6">No allocations match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      ) : tab === "project" ?  (
        <div className="space-y-2.5">
          {Object.entries(byProject).map(([projectId, rows]) => {
            const isOpen = expandedProjects.has(projectId);
            const health = healthProjectByCode.get(projectId);
            const clientId = health?.client_id ?? rows.find((r) => r.type_of_project)?.project_id.split("_").slice(0, -1).join("_") ?? null;
            const typeOfProject = health?.type_of_project ?? rows[0]?.type_of_project ?? null;
            const coe = health?.coe ?? rows[0]?.coe ?? null;
            const understaffed = health?.is_understaffed;
            const projectName = rows.find((r) => r.project_name)?.project_name ?? null;
            return (
              <div
                key={projectId}
                className={cn(
                  "rounded-xl border bg-white dark:bg-gray-900 overflow-hidden transition",
                  isOpen ? "border-primary/40 shadow-sm" : "border-gray-200 dark:border-gray-700"
                )}
              >
                <button
                  onClick={() => toggleProjectExpanded(projectId)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50/70 dark:hover:bg-gray-800/70 transition flex-wrap"
                >
                  {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />}
                  <span
                    onClick={(e) => { e.stopPropagation(); openProject(projectId); }}
                    className="text-sm font-semibold text-primary hover:underline whitespace-nowrap"
                    title="Open full project detail"
                  >
                    {projectId}
                  </span>
                  {projectName && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[280px]" title={projectName}>{projectName}</span>
                  )}
                  {clientId && <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{clientId}</span>}
                  {typeOfProject && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {typeOfProject}
                    </span>
                  )}
                  {coe && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 dark:bg-violet-950/40 dark:border-violet-800/60 dark:text-violet-400 whitespace-nowrap">
                      {coe}
                    </span>
                  )}
                  {health && (
                    <Badge variant={health.risk_band}>{health.risk_band} risk</Badge>
                  )}
                  {understaffed && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400 whitespace-nowrap">
                      <Users className="w-2.5 h-2.5" /> understaffed
                    </span>
                  )}
                  {health?.is_extension_risk && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400 whitespace-nowrap">
                      <Clock className="w-2.5 h-2.5" /> extension risk
                    </span>
                  )}
                  {health?.is_escalation_risk && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-400 whitespace-nowrap">
                      <AlertTriangle className="w-2.5 h-2.5" /> escalation
                    </span>
                  )}
                  {health && health.monthly_unbilled_value_usd > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-400 whitespace-nowrap">
                      <DollarSign className="w-2.5 h-2.5" /> {formatUsd(health.monthly_unbilled_value_usd)}/mo unbilled
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {rows.length} resource{rows.length !== 1 ? "s" : ""}
                    {health?.expected_headcount != null && (
                      <span className="text-gray-300 dark:text-gray-600"> · {health.n_employees}/{health.expected_headcount} expected</span>
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    <div className="px-3.5 py-2 bg-gray-50/60 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
                      <span>Project end: <strong className="text-gray-700 dark:text-gray-300">{rows[0]?.project_end_date ?? "?"}</strong></span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="flex items-center gap-1">
                        Extended end:
                        {rows[0]?.project_extended_end_date ? (
                          <button onClick={() => setExtendingProjectCode(projectId)} className="text-primary hover:underline">
                            {rows[0].project_extended_end_date}
                            {rows[0].project_extended_end_status && (
                              <span className="ml-1 text-gray-400 dark:text-gray-500">({rows[0].project_extended_end_status.toLowerCase()})</span>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => setExtendingProjectCode(projectId)}
                            className="text-gray-400 hover:text-primary underline decoration-dotted dark:text-gray-500"
                          >
                            + Extend
                          </button>
                        )}
                      </span>
                    </div>
                    {health && (
                      <div className="px-3.5 py-2 bg-gray-50/60 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
                        {health.wsr_latest_signal && (
                          <span>
                            Latest WSR: <Badge variant={health.wsr_latest_signal}>{health.wsr_latest_signal}</Badge>
                          </span>
                        )}
                        {health.wsr_trend && <span>Trend: {health.wsr_trend}</span>}
                        {health.root_causes.length > 0 && (
                          <span className="text-gray-400 dark:text-gray-500">Root causes: {health.root_causes.join(", ")}</span>
                        )}
                        <button onClick={() => openProject(projectId)} className="ml-auto text-primary hover:underline whitespace-nowrap">
                          View full detail →
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs data-table">
                      <tbody>
                        {rows.map((r) => (
                          <ResourceRow
                            key={`${r.employee_id}-${r.project_id}`}
                            row={r}
                            hideProject
                            onOpenEmployee={() => setSelectedEmployee(r.employee_id)}
                            onOpenProject={() => openProject(r.project_id)}
                            onOpenTimesheet={() => setSelectedTimesheet({ employeeId: r.employee_id, projectId: r.project_id })}
                            onExtendAllocation={() => setExtendingAllocation(r)}
                          />
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {Object.keys(byProject).length === 0 && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 italic py-6">No allocations match the current filters.</p>
          )}
        </div>
      ) : null}


      {selectedEmployee && <EmployeeProfileModal employeeId={selectedEmployee} initialTab="overview" onClose={() => setSelectedEmployee(null)} />}
      {selectedProject && <ProjectHealthDetailModal projectCode={selectedProject} onClose={() => setSelectedProject(null)} />}
      {extendingProjectCode && (
        <ExtendProjectModal
          projectCode={extendingProjectCode}
          originalEndDate={byProject[extendingProjectCode]?.[0]?.project_end_date ?? null}
          currentExtendedEndDate={byProject[extendingProjectCode]?.[0]?.project_extended_end_date ?? null}
          currentExtendedEndStatus={byProject[extendingProjectCode]?.[0]?.project_extended_end_status ?? null}
          onClose={() => setExtendingProjectCode(null)}
        />
      )}
      {extendingAllocation && (
        <ExtendAllocationModal
          allocationId={extendingAllocation.allocation_id}
          employeeId={extendingAllocation.employee_id}
          projectId={extendingAllocation.project_id}
          currentEndDate={extendingAllocation.allocated_end_date}
          currentExtendedEndDate={extendingAllocation.extended_end_date}
          currentExtendedStatus={extendingAllocation.extended_status}
          currentResourcingStatus={extendingAllocation.resourcing_status}
          projectExtendedEndDate={extendingAllocation.project_extended_end_date}
          onClose={() => setExtendingAllocation(null)}
        />
      )}
      {selectedTimesheet && (
        <TimesheetProofModal
          employeeId={selectedTimesheet.employeeId}
          projectId={selectedTimesheet.projectId}
          onClose={() => setSelectedTimesheet(null)}
        />
      )}
    </div>
  );
}

function ExtendAllocationDateCell({
  allocationId,
  value,
  projectExtendedEndDate,
  onOpen,
}: {
  allocationId: string;
  value: string | null;
  // The project must be extended first -- an allocation can't run past a
  // project that hasn't itself been formally extended (see ExtendProjectModal).
  projectExtendedEndDate: string | null;
  onOpen: () => void;
}) {
  // Tracks the extend mutation regardless of which component triggered it
  // (this row's own modal, or the same allocation edited from the project
  // detail's Allocations tab) -- so the row visibly shows "updating" for the
  // whole save + refetch lag, instead of just changing on its own moments later.
  const isPending = useIsMutating({ mutationKey: ["extend-allocation", allocationId] }) > 0;

  if (isPending) {
    return (
      <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500 whitespace-nowrap">
        <Loader2 className="w-3 h-3 animate-spin" /> updating…
      </span>
    );
  }

  if (!projectExtendedEndDate) {
    return (
      <button
        onClick={onOpen}
        className="text-amber-600 hover:text-amber-700 underline decoration-dotted font-medium whitespace-nowrap dark:text-amber-400 dark:hover:text-amber-300"
        title="Extend the project's end date first, then individual allocations can be extended up to it."
      >
        extend project first
      </button>
    );
  }
  return value ? (
    <button
      onClick={onOpen}
      className="text-primary hover:underline whitespace-nowrap"
      title={`Click to change (up to the project's extended end date, ${projectExtendedEndDate})`}
    >
      {value}
    </button>
  ) : (
    <button
      onClick={onOpen}
      className="text-gray-400 hover:text-primary underline decoration-dotted whitespace-nowrap dark:text-gray-500"
      title={`Extend up to the project's extended end date, ${projectExtendedEndDate}`}
    >
      + Extend
    </button>
  );
}

function ResourceRow({
  row,
  hideProject,
  onOpenEmployee,
  onOpenProject,
  onOpenTimesheet,
  onExtendAllocation,
}: {
  row: AllocationRow;
  hideProject?: boolean;
  onOpenEmployee: () => void;
  onOpenProject: () => void;
  onOpenTimesheet: () => void;
  onExtendAllocation: () => void;
}) {
  return (
    <tr className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
      <td className="px-3 py-2 whitespace-nowrap">
        <button onClick={onOpenEmployee} className="font-medium text-primary hover:underline" title="View full employee proof">
          {row.employee_id}
        </button>
      </td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.job_name ?? "-"}</td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.location ?? "-"}</td>
      {!hideProject && (
        <td className="px-3 py-2 max-w-[220px]">
          <button onClick={onOpenProject} className="block text-left" title={row.project_name ?? undefined}>
            <span className="text-primary hover:underline whitespace-nowrap">{row.project_id}</span>
            {row.project_name && (
              <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{row.project_name}</span>
            )}
          </button>
        </td>
      )}
      <td className="px-3 py-2 whitespace-nowrap"><Badge variant={row.resourcing_status}>{row.resourcing_status}</Badge></td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.allocation_by_percentage}%</td>
      <td className="px-3 py-2 whitespace-nowrap"><Badge variant={row.utilization_band}>{row.utilization_band.replace("_", " ")}</Badge></td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          onClick={onOpenTimesheet}
          className="flex items-center gap-1.5 hover:opacity-75 transition"
          title={`${row.actual_hours_logged}h logged / ${row.expected_hours}h expected -- click for the real timesheet proof`}
        >
          {row.hours_data_available && row.hours_utilization_pct !== null ? (
            <Badge variant={hoursUtilizationBand(row.hours_utilization_pct)}>{row.hours_utilization_pct}%</Badge>
          ) : (
            <span className="text-gray-300 dark:text-gray-600 underline">no data yet</span>
          )}
          {row.possible_unplanned_absence && <Badge variant="unbilled">quiet 14d+</Badge>}
        </button>
      </td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.allocated_end_date}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <ExtendAllocationDateCell
          allocationId={row.allocation_id}
          value={row.extended_end_date}
          projectExtendedEndDate={row.project_extended_end_date}
          onOpen={onExtendAllocation}
        />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.ending_soon && <Badge variant="amber">{row.days_to_end}d</Badge>}</td>
    </tr>
  );
}

function groupBy<T, K extends string | number>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ??= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}