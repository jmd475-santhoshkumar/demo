"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type EmployeeListRow } from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { HoldDot } from "@/components/shared/HoldFlag";
import { StatCard } from "@/components/shared/StatCard";
import { ErrorState } from "@/components/shared/EmptyState";
import { StatCardGridSkeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "active" | "departed" | "notice_period";
type Sort = "name_asc" | "alloc_desc" | "alloc_asc" | "join_desc" | "join_asc";

const STATUS_LABEL: Record<string, string> = { active: "active", departed: "departed", notice_period: "notice period" };
const STATUS_VARIANT: Record<string, string> = { active: "green", departed: "default", notice_period: "amber" };

// The well-understood real prefixes -- JMD/JMG/JML/JMU are real distinct
// regions/entities, Intern/Trainee/External are real employment-type
// categories. Shown as their own card, biggest first. Everything else
// (uncatalogued raw prefixes like "CRN"/"JMAN"/"JMUExternal", and "Other" --
// employee_ids with no alphabetic prefix at all) is real too, just too small
// and too unexplained to give equal visual weight to a 642-person group --
// folded into one "Other" card instead of 4 tiny, confusingly-labeled ones.
const PRIMARY_GROUPS = [
  "JMD", "JMG", "JML", "JMU", "Intern (pre-conversion)", "External/Contractor", "Trainee",
];
const OTHER_GROUP_FILTER = "__other__";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "name_asc", label: "Employee A–Z" },
  { value: "alloc_desc", label: "Allocation % ↓" },
  { value: "alloc_asc", label: "Allocation % ↑" },
  { value: "join_desc", label: "Newest joiners first" },
  { value: "join_asc", label: "Longest tenure first" },
];

export default function EmployeesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["employees-list"], queryFn: api.employeesList });

  const [search, setSearch] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [coeFilter, setCoeFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [sort, setSort] = useState<Sort>("name_asc");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const coes = useMemo(() => Array.from(new Set((data ?? []).map((e) => e.coe).filter((v): v is string => Boolean(v)))).sort(), [data]);
  const departments = useMemo(
    () => Array.from(new Set((data ?? []).map((e) => e.department_name).filter((v): v is string => Boolean(v)))).sort(),
    [data]
  );
  const groups = useMemo(() => Array.from(new Set((data ?? []).map((e) => e.employee_group))).sort(), [data]);

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      active: rows.filter((r) => r.status === "active").length,
      departed: rows.filter((r) => r.status === "departed").length,
      notice_period: rows.filter((r) => r.status === "notice_period").length,
    };
  }, [data]);

  const groupCounts = useMemo(() => {
    const rows = data ?? [];
    const tally = new Map<string, number>();
    for (const r of rows) tally.set(r.employee_group, (tally.get(r.employee_group) ?? 0) + 1);

    const primary = PRIMARY_GROUPS.filter((g) => tally.has(g))
      .map((g) => ({ group: g, count: tally.get(g)! }))
      .sort((a, b) => b.count - a.count);

    const otherGroups = Array.from(tally.keys()).filter((g) => !PRIMARY_GROUPS.includes(g)).sort();
    const otherCount = otherGroups.reduce((sum, g) => sum + tally.get(g)!, 0);

    return { primary, otherGroups, otherCount };
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.employee_id, r.employee_full_name, r.job_name, r.department_name, r.location, r.coe, r.employee_group].some((v) => v?.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (coeFilter !== "all") rows = rows.filter((r) => (coeFilter === "" ? r.coe === null : r.coe === coeFilter));
    if (deptFilter !== "all") rows = rows.filter((r) => r.department_name === deptFilter);
    if (groupFilter === OTHER_GROUP_FILTER) rows = rows.filter((r) => !PRIMARY_GROUPS.includes(r.employee_group));
    else if (groupFilter !== "all") rows = rows.filter((r) => r.employee_group === groupFilter);

    const sorted = [...rows];
    switch (sort) {
      case "name_asc":
        sorted.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
        break;
      case "alloc_desc":
        sorted.sort((a, b) => (b.current_allocation_pct ?? -1) - (a.current_allocation_pct ?? -1));
        break;
      case "alloc_asc":
        sorted.sort((a, b) => (a.current_allocation_pct ?? 9999) - (b.current_allocation_pct ?? 9999));
        break;
      case "join_desc":
        sorted.sort((a, b) => (b.date_of_join ?? "").localeCompare(a.date_of_join ?? ""));
        break;
      case "join_asc":
        sorted.sort((a, b) => (a.date_of_join ?? "").localeCompare(b.date_of_join ?? ""));
        break;
    }
    return sorted;
  }, [data, search, statusFilter, coeFilter, deptFilter, groupFilter, sort]);

  const hasActiveFilters = search !== "" || statusFilter !== "all" || coeFilter !== "all" || deptFilter !== "all" || groupFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCoeFilter("all");
    setDeptFilter("all");
    setGroupFilter("all");
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        <StatCardGridSkeleton count={2} className="grid grid-cols-1 sm:grid-cols-2 gap-4" />
        <TableSkeleton columns={8} rows={10} />
      </div>
    );
  }
  if (error || !data) return <ErrorState message="Could not load employees." />;

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          label="Total"
          value={data.length}
          sub="ever on roster — click to see groups"
          onClick={() => setGroupsOpen((v) => !v)}
          active={groupsOpen}
        />
        <StatCard
          label="Active"
          value={counts.active}
          color="green"
          onClick={() => setStatusFilter((v) => (v === "active" ? "all" : "active"))}
          active={statusFilter === "active"}
        />
      </div>

      {groupsOpen && (
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-xs font-semibold text-gray-700 mb-3 dark:text-gray-300">Employee Groups</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {groupCounts.primary.map(({ group, count }) => (
            <StatCard
              key={group}
              label={group}
              value={count}
              color="blue"
              onClick={() => setGroupFilter((v) => (v === group ? "all" : group))}
              active={groupFilter === group}
            />
          ))}
          {groupCounts.otherCount > 0 && (
            <StatCard
              label="Other"
              value={groupCounts.otherCount}
              color="blue"
              onClick={() => setGroupFilter((v) => (v === OTHER_GROUP_FILTER ? "all" : OTHER_GROUP_FILTER))}
              active={groupFilter === OTHER_GROUP_FILTER}
              tooltip={
                <span>
                  Small or uncatalogued groups: {groupCounts.otherGroups.join(", ")}. Use the &quot;All regions/entities&quot; filter
                  below to pick one specifically.
                </span>
              }
            />
          )}
        </div>
      </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Employees ({filtered.length}/{data.length})
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[11px] text-primary hover:underline">
              Clear filters
            </button>
          )}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee, name, designation, department, location, CoE…"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-gray-300 dark:border-gray-700 dark:focus:border-gray-600"
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            <option value="all">All regions/entities</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <select
            value={coeFilter}
            onChange={(e) => setCoeFilter(e.target.value)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            <option value="all">All CoEs</option>
            {coes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="">Not determined</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 ml-auto"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white overflow-hidden dark:bg-gray-900">
        <div className="overflow-x-auto">
        <table className="w-full text-xs data-table">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              {["Employee", "Name", "Designation", "Department", "Location", "Group", "CoE", "Status", "Allocation %", "Joined"].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.employee_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 dark:border-gray-800 dark:hover:bg-gray-800/50">
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <button onClick={() => setSelectedEmployee(r.employee_id)} className="font-medium text-primary hover:underline">
                      {r.employee_id}
                    </button>
                    <HoldDot onHold={r.on_hold} holdProjects={r.hold_projects} />
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap dark:text-gray-300">{r.employee_full_name ?? "-"}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap dark:text-gray-400">{r.job_name ?? "-"}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap dark:text-gray-400">{r.department_name ?? "-"}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap dark:text-gray-400">{r.location ?? "-"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 whitespace-nowrap dark:bg-gray-800/60 dark:border-gray-700 dark:text-gray-400">
                    {r.employee_group}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.coe ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 whitespace-nowrap dark:bg-violet-950/40 dark:border-violet-800/60 dark:text-violet-400">
                      {r.coe}
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">not determined</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap"><Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap dark:text-gray-400">{r.current_allocation_pct != null ? `${r.current_allocation_pct}%` : "-"}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap dark:text-gray-400">{r.date_of_join ?? "-"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className={cn("text-center text-xs text-gray-400 italic py-6 dark:text-gray-500")}>No employees match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {selectedEmployee && (
        <EmployeeProfileModal employeeId={selectedEmployee} initialTab="overview" onClose={() => setSelectedEmployee(null)} />
      )}
    </div>
  );
}
