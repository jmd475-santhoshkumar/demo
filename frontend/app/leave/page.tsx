"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Users } from "lucide-react";
import { api, DEFAULT_INCLUDE_PARAMS, type LeaveImpact } from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { StatCard } from "@/components/shared/StatCard";
import { LoadingState, ErrorState } from "@/components/shared/EmptyState";
import { StatCardGridSkeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { TableControls } from "@/components/shared/TableControls";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { LeaveBackfillModal } from "@/components/shared/LeaveBackfillModal";

type LeaveTypeFilter = "all" | "Planned" | "Sick" | "Emergency";
type Sort = "start_asc" | "start_desc" | "employee_asc" | "project_asc" | "alloc_desc" | "skill_desc" | "composite_desc";

// Matches scoring.py's ELIGIBLE_THRESHOLD -- "strong match" means the same 0.6 cutoff
// the rest of the app already uses to call a candidate "eligible" for redeployment.
const STRONG_SKILL_MATCH_THRESHOLD = 0.6;

interface FilterOptions {
  search: string;
  onLeaveOnly: boolean;
  noBackfillOnly: boolean;
  strongSkillOnly: boolean;
  leaveType: LeaveTypeFilter;
  project: string;
  coe: string;
  dateFrom: string;
  dateTo: string;
  sort: Sort;
}

function filterAndSortLeave(rows: LeaveImpact[], opts: FilterOptions): LeaveImpact[] {
  let result = rows;

  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (i) =>
        i.employee_id.toLowerCase().includes(q) ||
        (i.job_name ?? "").toLowerCase().includes(q) ||
        i.project_id.toLowerCase().includes(q)
    );
  }
  if (opts.onLeaveOnly) result = result.filter((i) => i.is_currently_on_leave);
  if (opts.noBackfillOnly) result = result.filter((i) => !i.backfill_available);
  if (opts.strongSkillOnly) result = result.filter((i) => (i.top_backfill_skill_score ?? 0) >= STRONG_SKILL_MATCH_THRESHOLD);
  if (opts.leaveType !== "all") result = result.filter((i) => i.leave_type === opts.leaveType);
  if (opts.project !== "all") result = result.filter((i) => i.project_id === opts.project);
  if (opts.coe !== "all") result = result.filter((i) => (opts.coe === "" ? i.coe === null : i.coe === opts.coe));
  if (opts.dateFrom) result = result.filter((i) => i.leave_end_date >= opts.dateFrom);
  if (opts.dateTo) result = result.filter((i) => i.leave_start_date <= opts.dateTo);

  const sorted = [...result];
  switch (opts.sort) {
    case "start_asc":
      sorted.sort((a, b) => (Number(b.is_currently_on_leave) - Number(a.is_currently_on_leave)) || a.leave_start_date.localeCompare(b.leave_start_date));
      break;
    case "start_desc":
      sorted.sort((a, b) => b.leave_start_date.localeCompare(a.leave_start_date));
      break;
    case "employee_asc":
      sorted.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
      break;
    case "project_asc":
      sorted.sort((a, b) => a.project_id.localeCompare(b.project_id));
      break;
    case "alloc_desc":
      sorted.sort((a, b) => b.allocation_by_percentage - a.allocation_by_percentage);
      break;
    case "skill_desc":
      sorted.sort((a, b) => (b.top_backfill_skill_score ?? -1) - (a.top_backfill_skill_score ?? -1));
      break;
    case "composite_desc":
      // backfill_candidates is already ranked by composite_score desc (see
      // leave_service.get_leave_impact), so [0] is the best overall fit under
      // whichever ranking parameters are currently selected.
      sorted.sort((a, b) => (b.backfill_candidates[0]?.composite_score ?? -1) - (a.backfill_candidates[0]?.composite_score ?? -1));
      break;
  }
  return sorted;
}

export default function LeavePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <LeavePageInner />
    </Suspense>
  );
}

function LeavePageInner() {
  // Backfill candidates are ranked with the same default composite (skill +
  // competency + availability + CoE preference) used everywhere else in the
  // app -- no per-page weight tuning here. This page is for spotting leave
  // coverage gaps and picking a sensible backfill, not for re-ranking
  // candidates; the per-candidate skill/competency/available % is already
  // visible on each card for a manual judgment call.
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["leave-impact"],
    queryFn: () => api.leaveImpact(DEFAULT_INCLUDE_PARAMS, false, 25),
  });
  const handleAssigned = () => {
    queryClient.invalidateQueries({ queryKey: ["leave-impact"] });
    queryClient.invalidateQueries({ queryKey: ["allocations"] });
  };
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [onLeaveOnly, setOnLeaveOnly] = useState(false);
  const [noBackfillOnly, setNoBackfillOnly] = useState(false);
  const [strongSkillOnly, setStrongSkillOnly] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveTypeFilter>("all");
  const [project, setProject] = useState("all");
  const [coe, setCoe] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<Sort>("start_asc");

  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  // Identity only (not the row object itself) -- so if Advanced Filters change
  // while this modal is open, the re-fetched `data` below re-derives fresh
  // backfill_candidates for the same employee/project instead of showing a
  // stale snapshot from before the filter change.
  const [backfillTarget, setBackfillTarget] = useState<{ employeeId: string; projectId: string } | null>(null);

  useEffect(() => {
    if (searchParams.get("onLeaveNow") === "true") setOnLeaveOnly(true);
  }, []);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        <StatCardGridSkeleton count={3} className="grid grid-cols-1 sm:grid-cols-3 gap-4" />
        <TableSkeleton columns={8} rows={8} />
      </div>
    );
  }
  if (error || !data) return <ErrorState message="Could not load leave impact." />;

  const onLeaveNow = data.filter((i) => i.is_currently_on_leave);
  const noBackfill = data.filter((i) => !i.backfill_available);
  const projects = Array.from(new Set(data.map((i) => i.project_id))).sort();
  const coes = Array.from(new Set(data.map((i) => i.coe).filter((v): v is string => Boolean(v)))).sort();

  const filtered = filterAndSortLeave(data, { search, onLeaveOnly, noBackfillOnly, strongSkillOnly, leaveType, project, coe, dateFrom, dateTo, sort });

  const hasActiveFilters =
    search !== "" || onLeaveOnly || noBackfillOnly || strongSkillOnly || leaveType !== "all" || project !== "all" || coe !== "all" || dateFrom !== "" || dateTo !== "";
  const clearFilters = () => {
    setSearch("");
    setOnLeaveOnly(false);
    setNoBackfillOnly(false);
    setStrongSkillOnly(false);
    setLeaveType("all");
    setProject("all");
    setCoe("all");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Currently On Leave"
          value={onLeaveNow.length}
          color="amber"
          onClick={() => setOnLeaveOnly((v) => !v)}
          active={onLeaveOnly}
        />
        <StatCard label="Total Impacted Allocations" value={data.length} sub="ongoing + upcoming, next 45 days" />
        <StatCard
          label="No Backfill Available"
          value={noBackfill.length}
          color={noBackfill.length > 0 ? "red" : "default"}
          onClick={() => setNoBackfillOnly((v) => !v)}
          active={noBackfillOnly}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Leave Impact ({filtered.length}/{data.length})
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[11px] text-primary hover:underline">
              Clear filters
            </button>
          )}
        </div>
        <TableControls
          search={{ value: search, onChange: setSearch, placeholder: "Search employee, designation, project…" }}
          filters={[
            {
              value: leaveType,
              onChange: (v) => setLeaveType(v as LeaveTypeFilter),
              options: [["all", "All leave types"], ["Planned", "Planned"], ["Sick", "Sick"], ["Emergency", "Emergency"]],
            },
            {
              value: project,
              onChange: setProject,
              options: [["all", "All projects"], ...projects.map((p) => [p, p] as [string, string])],
            },
            {
              value: coe,
              onChange: setCoe,
              options: [["all", "All CoEs"], ...coes.map((c) => [c, c] as [string, string]), ["", "Not determined"]],
            },
          ]}
          toggles={[
            { active: noBackfillOnly, onToggle: () => setNoBackfillOnly((v) => !v), label: "No backfill only" },
            { active: strongSkillOnly, onToggle: () => setStrongSkillOnly((v) => !v), label: "Strong skill match only" },
          ]}
          sort={{
            value: sort,
            onChange: (v) => setSort(v as Sort),
            options: [
              ["start_asc", "Most urgent first"],
              ["start_desc", "Leave start ↓"],
              ["employee_asc", "Employee A–Z"],
              ["project_asc", "Project A–Z"],
              ["alloc_desc", "Alloc % ↓"],
              ["skill_desc", "Best skill match ↓"],
              ["composite_desc", "Best overall fit ↓"],
            ],
          }}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">Leave overlaps</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          />
          <span className="text-[10px] text-gray-400 dark:text-gray-500">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          />
        </div>
      </div>

      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-xs data-table">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              {["Employee", "Designation", "Leave Type", "Dates", "Status", "Project", "Alloc %", "Backfill"].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((i, idx) => (
              <tr key={`${i.employee_id}-${i.project_id}-${idx}`} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 dark:border-gray-800 dark:hover:bg-gray-800/50">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  <button onClick={() => setSelectedEmployee(i.employee_id)} className="text-primary hover:underline">
                    {i.employee_id}
                  </button>
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{i.job_name ?? "-"}</td>
                <td className="px-3 py-2 whitespace-nowrap"><Badge variant={i.leave_type === "Emergency" ? "red" : i.leave_type === "Sick" ? "amber" : "default"}>{i.leave_type}</Badge></td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{i.leave_start_date} → {i.leave_end_date}</td>
                <td className="px-3 py-2 whitespace-nowrap">{i.is_currently_on_leave ? <Badge variant="red">on leave now</Badge> : <Badge variant="amber">upcoming</Badge>}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => setSelectedProject(i.project_id)} className="text-primary hover:underline">
                    {i.project_id}
                  </button>
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{i.allocation_by_percentage}%</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {i.backfill_available ? (
                    <button
                      onClick={() => setBackfillTarget({ employeeId: i.employee_id, projectId: i.project_id })}
                      className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
                    >
                      <Users className="w-3.5 h-3.5" />
                      View backfill ({i.backfill_candidates.length})
                      {i.top_backfill_skill_score !== null && (
                        <Badge variant={i.top_backfill_skill_score >= STRONG_SKILL_MATCH_THRESHOLD ? "eligible" : "trainable"}>
                          {Math.round(i.top_backfill_skill_score * 100)}% best match
                        </Badge>
                      )}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-red-500 dark:text-red-400"><AlertTriangle className="w-3 h-3" /> none free</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400 italic dark:text-gray-500">No leave records match the current filters.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {selectedEmployee && (
        <EmployeeProfileModal employeeId={selectedEmployee} initialTab="leave" onClose={() => setSelectedEmployee(null)} />
      )}
      {selectedProject && <ProjectHealthDetailModal projectCode={selectedProject} onClose={() => setSelectedProject(null)} />}
      {backfillTarget && (() => {
        const liveImpact = data.find((i) => i.employee_id === backfillTarget.employeeId && i.project_id === backfillTarget.projectId);
        return liveImpact ? (
          <LeaveBackfillModal impact={liveImpact} onClose={() => setBackfillTarget(null)} onSelectEmployee={setSelectedEmployee} includeParams={DEFAULT_INCLUDE_PARAMS} onAssigned={handleAssigned} />
        ) : null;
      })()}
    </div>
  );
}
