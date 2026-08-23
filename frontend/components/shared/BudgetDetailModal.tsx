"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, LayoutGrid, ListTree, Scale } from "lucide-react";
import { api, type BudgetActualVsPlanned, type BudgetDetail } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { Badge } from "@/components/shared/Badge";
import { ErrorState } from "@/components/shared/EmptyState";
import { ModalBodySkeleton } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "green",
  FINANCE_APPROVED: "green",
  PENDING: "amber",
  REJECTED: "red",
  FINANCE_REJECTED: "red",
};

type Tab = "overview" | "resources" | "actual_vs_planned" | "history";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "resources", label: "Resource Lines", icon: ListTree },
  { key: "actual_vs_planned", label: "Actual vs. Planned", icon: Scale },
  { key: "history", label: "Version History", icon: History },
];

function formatFee(value: number | null): string {
  if (value == null) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function BudgetDetailModal({ budgetId, onClose }: { budgetId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const detail = useQuery({
    queryKey: ["budget-detail", budgetId],
    queryFn: () => api.getBudgetDetail(budgetId),
  });

  const header = detail.data?.header;
  const availableTabs = TABS.filter((t) => t.key !== "actual_vs_planned" || detail.data?.actual_vs_planned);

  return (
    <Modal
      title={
        header ? (
          <span className="inline-flex items-center gap-2">
            {header.project_code ?? <span className="italic text-gray-400">Unlinked budget</span>}
            <Badge variant={STATUS_BADGE[header.status] ?? "default"}>{header.status.replace(/_/g, " ")}</Badge>
          </span>
        ) : (
          "Budget detail"
        )
      }
      subtitle={header?.project_name ?? undefined}
      onClose={onClose}
      widthClassName="max-w-6xl"
    >
      <div className="flex border-b border-gray-100 dark:border-gray-800 px-5 sticky top-0 bg-white dark:bg-gray-900 z-10 overflow-x-auto">
        {availableTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition whitespace-nowrap flex items-center gap-1.5",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {detail.isLoading ? (
          <ModalBodySkeleton />
        ) : detail.error || !detail.data ? (
          <ErrorState message="Could not load this budget's detail." />
        ) : (
          <>
            {tab === "overview" && <OverviewTab detail={detail.data} />}
            {tab === "resources" && <ResourceLinesTab detail={detail.data} />}
            {tab === "actual_vs_planned" && detail.data.actual_vs_planned && (
              <ActualVsPlannedTab plan={detail.data.actual_vs_planned} />
            )}
            {tab === "history" && <HistoryTab detail={detail.data} />}
          </>
        )}
      </div>
    </Modal>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-xs text-gray-800 dark:text-gray-200 mt-0.5">{children}</p>
    </div>
  );
}

function OverviewTab({ detail }: { detail: BudgetDetail }) {
  const h = detail.header;
  const p = detail.project_context;
  if (!h) return null;
  return (
    <div className="space-y-4 text-xs">
      <div>
        <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Budget</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 bg-gray-50/60 dark:bg-gray-800/30">
          <DetailField label="Proposition CoE">{h.proposition_coe}</DetailField>
          <DetailField label="Engagement Style">{h.engagement_style}</DetailField>
          <DetailField label="Fee">
            {formatFee(h.professional_fee)} <span className="text-gray-400">(currency unconfirmed)</span>
          </DetailField>
          <DetailField label="Margin">{h.margin_pct != null ? `${h.margin_pct.toFixed(1)}%` : "-"}</DetailField>
          <DetailField label="Payment Term">{h.payment_term}</DetailField>
          <DetailField label="Billable">{h.is_billable ? "Yes" : "No"}</DetailField>
          <DetailField label="Discount">{h.discount_type === "NA" ? "None" : `${h.discount_type} ${h.discount_value ?? ""}`}</DetailField>
          <DetailField label="Created">{h.created_at ? h.created_at.slice(0, 10) : "-"}</DetailField>
          <DetailField label="Created By">{h.created_by ?? "-"}</DetailField>
          <DetailField label="Reviewed">{h.reviewed_at ? h.reviewed_at.slice(0, 10) : "-"}</DetailField>
          <DetailField label="Reviewed By">{h.reviewed_by ?? "-"}</DetailField>
        </div>
      </div>

      {h.discount_reason && (
        <div>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Discount reason</p>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{h.discount_reason}</p>
        </div>
      )}
      {h.comment && (
        <div>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Comment</p>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{h.comment}</p>
        </div>
      )}

      {p ? (
        <div>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Linked Project (real)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 bg-gray-50/60 dark:bg-gray-800/30">
            <DetailField label="Project">{p.project_code}</DetailField>
            <DetailField label="Status">{p.project_status ?? "-"}</DetailField>
            <DetailField label="Type">{p.type_of_project ?? "-"}</DetailField>
            <DetailField label="Tech CoE">{p.tech_coe ?? "-"}</DetailField>
            <DetailField label="Start">{p.project_start_date ? p.project_start_date.slice(0, 10) : "-"}</DetailField>
            <DetailField label="End">{p.project_end_date ? p.project_end_date.slice(0, 10) : "-"}</DetailField>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400 italic">
          No linked project -- this budget&apos;s projectid didn&apos;t resolve to a real project_code (a deal not yet
          turned into a project).
        </p>
      )}
    </div>
  );
}

function ResourceLinesTab({ detail }: { detail: BudgetDetail }) {
  if (detail.resource_lines.length === 0) {
    return <p className="text-xs text-gray-400 italic">No resource lines on this budget.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
            {["Designation", "Location", "Start Date", "Working Days", "Allocation %", "Cost/day", "Price/day"].map((h) => (
              <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.resource_lines.map((line, i) => (
            <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
              <td className="px-3 py-1.5 whitespace-nowrap">{line.designation}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{line.location}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{line.start_date ? line.start_date.slice(0, 10) : "-"}</td>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{line.working_days ?? "-"}</td>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{line.allocation_pct ?? "-"}%</td>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-gray-400" title="Currency unconfirmed">
                {line.cost_per_day ?? "-"}
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-gray-400" title="Currency unconfirmed">
                {line.price_per_day ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 px-3 py-1.5">Cost/price shown as entered -- currency not yet confirmed by the data warehouse.</p>
    </div>
  );
}

function ActualVsPlannedTab({ plan }: { plan: BudgetActualVsPlanned }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={STATUS_BADGE[plan.status] ?? "default"}>{plan.status.replace(/_/g, " ")} v{plan.version}</Badge>
        {plan.used_status === "latest_non_approved" && (
          <span className="text-[10px] text-gray-400 italic">no approved version yet -- showing the latest submitted one</span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
              {["Designation", "Planned Lines", "Planned Alloc %", "Actual Headcount", "Actual Alloc %"].map((h) => (
                <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-3 py-2 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.comparison.map((row) => {
              const short = row.actual_headcount < row.planned_line_count;
              return (
                <tr key={row.designation} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap">{row.designation}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{row.planned_line_count}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{row.planned_avg_allocation_pct}%</td>
                  <td className={cn("px-3 py-1.5 whitespace-nowrap tabular-nums", short && "text-red-600 dark:text-red-400 font-medium")}>
                    {row.actual_headcount}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{row.avg_allocation_pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryTab({ detail }: { detail: BudgetDetail }) {
  if (detail.version_history.length === 0) {
    return <p className="text-xs text-gray-400 italic">No version history -- this is the only submission for this project.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
            {["Version", "Status", "Fee", "Created", "Reviewed By"].map((h) => (
              <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.version_history.map((v) => (
            <tr
              key={v.budget_id}
              className={cn(
                "border-b border-gray-50 dark:border-gray-800 last:border-0",
                v.is_current && "bg-primary/5"
              )}
            >
              <td className="px-3 py-1.5 whitespace-nowrap">
                v{v.version} {v.is_current && <span className="text-primary font-medium">(this one)</span>}
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap">
                <Badge variant={STATUS_BADGE[v.status] ?? "default"}>{v.status.replace(/_/g, " ")}</Badge>
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatFee(v.professional_fee)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap text-gray-400">{v.created_at ? v.created_at.slice(0, 10) : "-"}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{v.reviewed_by ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
