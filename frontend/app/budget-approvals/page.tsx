"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, Clock, CheckCircle2, XCircle, Link2Off } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { ErrorState } from "@/components/shared/EmptyState";
import { StatCardGridSkeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { BudgetDetailModal } from "@/components/shared/BudgetDetailModal";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "green",
  FINANCE_APPROVED: "green",
  PENDING: "amber",
  REJECTED: "red",
  FINANCE_REJECTED: "red",
};

const STATUS_GROUPS: Record<string, string[]> = {
  Pending: ["PENDING"],
  Approved: ["APPROVED", "FINANCE_APPROVED"],
  Rejected: ["REJECTED", "FINANCE_REJECTED"],
};

type Sort = "created_desc" | "fee_desc" | "project_asc";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "created_desc", label: "Most recent first" },
  { value: "fee_desc", label: "Highest fee first" },
  { value: "project_asc", label: "Project A–Z" },
];

function formatFee(value: number | null): string {
  if (value == null) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

const TONE_CHIP = {
  lightblue: "bg-jman-lightblue-50 text-jman-lightblue-700 dark:bg-jman-lightblue/15 dark:text-jman-lightblue",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  rose: "bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400",
} as const;

function StatCard({
  icon: Icon, label, value, tone, active, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: keyof typeof TONE_CHIP;
  active: boolean;
  onClick: () => void;
}) {
  const hasSignal = value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group text-left rounded-2xl border p-4 transition-all duration-200 bg-white dark:bg-gray-900",
        "hover:shadow-md hover:-translate-y-0.5",
        active ? "border-gray-400 dark:border-gray-500 ring-2 ring-gray-200 dark:ring-gray-700" : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg mb-3", hasSignal ? TONE_CHIP[tone] : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500")}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-[28px] leading-none font-bold tracking-tight text-gray-900 dark:text-gray-100">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{label}</p>
    </button>
  );
}

export default function BudgetApprovalsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["budget-approvals"],
    queryFn: api.getBudgetApprovals,
  });

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [coeFilter, setCoeFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("created_desc");
  const [openBudgetId, setOpenBudgetId] = useState<string | null>(null);

  const coeOptions = useMemo(
    () => Array.from(new Set((data ?? []).map((r) => r.proposition_coe))).sort(),
    [data]
  );

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      pending: rows.filter((r) => STATUS_GROUPS.Pending.includes(r.status)).length,
      approved: rows.filter((r) => STATUS_GROUPS.Approved.includes(r.status)).length,
      rejected: rows.filter((r) => STATUS_GROUPS.Rejected.includes(r.status)).length,
      unlinked: rows.filter((r) => !r.project_code).length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (statusFilter.length > 0) {
      const allowed = new Set(statusFilter.flatMap((g) => STATUS_GROUPS[g] ?? []));
      rows = rows.filter((r) => allowed.has(r.status));
    }
    if (coeFilter.length > 0) rows = rows.filter((r) => coeFilter.includes(r.proposition_coe));
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.project_code ?? "").toLowerCase().includes(q) ||
          (r.project_name ?? "").toLowerCase().includes(q) ||
          r.proposition_coe.toLowerCase().includes(q)
      );
    }
    rows = [...rows];
    switch (sort) {
      case "created_desc": rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")); break;
      case "fee_desc": rows.sort((a, b) => (b.professional_fee ?? -1) - (a.professional_fee ?? -1)); break;
      case "project_asc": rows.sort((a, b) => (a.project_code ?? "￿").localeCompare(b.project_code ?? "￿")); break;
    }
    return rows;
  }, [data, statusFilter, coeFilter, search, sort]);

  function toggleStatusGroup(group: string) {
    setStatusFilter((prev) => (prev.includes(group) && prev.length === 1 ? [] : [group]));
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        <StatCardGridSkeleton count={4} />
        <TableSkeleton columns={9} />
      </div>
    );
  }
  if (isError) return <ErrorState message="Failed to load budget approvals." />;

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Real JIN budget-approval workflow. Currency isn&apos;t yet confirmed by the data warehouse, so fee figures are shown
        exactly as entered — never converted.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Wallet} label="Total budgets" value={counts.total} tone="lightblue" active={statusFilter.length === 0} onClick={() => setStatusFilter([])} />
        <StatCard icon={Clock} label="Pending" value={counts.pending} tone="amber" active={statusFilter.includes("Pending")} onClick={() => toggleStatusGroup("Pending")} />
        <StatCard icon={CheckCircle2} label="Approved" value={counts.approved} tone="green" active={statusFilter.includes("Approved")} onClick={() => toggleStatusGroup("Approved")} />
        <StatCard icon={XCircle} label="Rejected" value={counts.rejected} tone="rose" active={statusFilter.includes("Rejected")} onClick={() => toggleStatusGroup("Rejected")} />
      </div>

      {counts.unlinked > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          <Link2Off className="h-3 w-3" />
          {counts.unlinked} of {counts.total} budgets have no linked project yet (a deal not yet turned into a project).
        </p>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project code, name, or proposition CoE…"
          className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-primary/40 bg-white dark:border-gray-700 dark:bg-gray-900"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">Status:</span>
          <SearchableSelect
            options={Object.keys(STATUS_GROUPS).map((g) => ({ value: g, label: g }))}
            value={statusFilter}
            onChange={setStatusFilter}
            multi
            placeholder="All statuses"
            size="sm"
            className="w-44"
          />
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 ml-2">Proposition CoE:</span>
          <SearchableSelect
            options={coeOptions.map((c) => ({ value: c, label: c }))}
            value={coeFilter}
            onChange={setCoeFilter}
            multi
            placeholder="All CoEs"
            size="sm"
            className="w-52"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="ml-auto text-[11px] px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                {["Project", "Proposition CoE", "Engagement", "Status", "Ver.", "Fee", "Lines", "Reviewed By", "Created"].map((h) => (
                  <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-3 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.budget_id}
                  onClick={() => setOpenBudgetId(row.budget_id)}
                  className="border-b border-gray-50 dark:border-gray-800 last:border-0 cursor-pointer transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-800/40"
                >
                  <td className="px-3 py-2 whitespace-nowrap max-w-[220px]">
                    {row.project_code ? (
                      <span className="font-medium text-primary hover:underline">{row.project_code}</span>
                    ) : (
                      <span className="text-gray-400 italic">Unlinked</span>
                    )}
                    {row.project_name && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{row.project_name}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.proposition_coe}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">{row.engagement_style}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant={STATUS_BADGE[row.status] ?? "default"}>{row.status.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">v{row.version}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700 dark:text-gray-300 tabular-nums">{formatFee(row.professional_fee)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400 tabular-nums">{row.resource_line_count}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">{row.reviewed_by ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400 dark:text-gray-500">{row.created_at ? row.created_at.slice(0, 10) : "-"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-400 text-sm">
                    No budgets match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openBudgetId && <BudgetDetailModal budgetId={openBudgetId} onClose={() => setOpenBudgetId(null)} />}
    </div>
  );
}
