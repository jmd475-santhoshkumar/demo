"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { AlertTriangle, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import {
  api,
  type DesignationRosterEntry,
  type OutlookDrilldownDeal,
  type OutlookDrilldownEmployee,
  type OutlookDrilldownResult,
} from "@/lib/api";
import { LoadingState, ErrorState } from "@/components/shared/EmptyState";
import { Skeleton, ChartSkeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { Modal } from "@/components/shared/Modal";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { cn, formatUsd } from "@/lib/utils";

const CLUSTER_COLORS = ["#3411A3", "#26D4F0", "#C36BDB", "#18978E", "#FF6196"];

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function pivotClusterMix(rows: { month: string; cluster: number; count: number }[], allMonths: string[]) {
  const byMonth = new Map<string, Record<string, number | string>>();
  for (const month of allMonths) {
    byMonth.set(month, { month });
  }
  for (const r of rows) {
    const entry = byMonth.get(r.month) ?? { month: r.month };
    entry[`cluster_${r.cluster}`] = r.count;
    byMonth.set(r.month, entry);
  }
  return Array.from(byMonth.values());
}

interface DrilldownSel {
  dimension: string;
  value?: string;
  month?: string | null;
  label: string;
  wholeWindow?: boolean;
  isConfirmed?: boolean;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-1">
      <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{label}:</span>
      <span className="text-gray-600 dark:text-gray-400 font-medium">{value}</span>
    </div>
  );
}

export function PipelineOutlookTab() {
  const [startDate, setStartDate] = useState(tomorrowStr());
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [granularity, setGranularity] = useState<"month" | "week">("month");
  const [periodFilter, setPeriodFilter] = useState<string[]>([]);
  const [roleMode, setRoleMode] = useState<"confirmed" | "unconfirmed">("confirmed");
  const [drilldown, setDrilldown] = useState<DrilldownSel | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showAllRoles, setShowAllRoles] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["six-month-outlook", startDate, horizonMonths, granularity],
    queryFn: () => api.sixMonthOutlook(startDate, horizonMonths, granularity),
  });

  const drilldownQuery = useQuery({
    queryKey: [
      "outlook-drilldown",
      drilldown?.dimension,
      drilldown?.value,
      drilldown?.month,
      drilldown?.wholeWindow,
      drilldown?.isConfirmed,
      startDate,
      horizonMonths,
      granularity,
    ],
    queryFn: () =>
      api.outlookDrilldown({
        dimension: drilldown!.dimension,
        value: drilldown!.value,
        month: drilldown!.wholeWindow ? null : drilldown!.month,
        startDate: drilldown!.wholeWindow ? startDate : undefined,
        horizonMonths: drilldown!.wholeWindow ? horizonMonths : undefined,
        granularity,
        isConfirmed: drilldown!.isConfirmed,
      }),
    enabled: !!drilldown,
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-end gap-4">
          <Skeleton className="h-9 w-32 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-3 flex-1 min-w-[260px]" />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <ChartSkeleton height={280} />
        </div>
        <TableSkeleton columns={9} rows={6} />
        <TableSkeleton columns={8} rows={6} />
      </div>
    );
  }
  if (error || !data) return <ErrorState message="Could not load the pipeline outlook." />;

  const clusterData = pivotClusterMix(
    data.project_mix_by_cluster_by_month,
    data.months.map((m) => m.month)
  );
  const clusters = Array.from(new Set(data.project_mix_by_cluster_by_month.map((r) => r.cluster))).sort();
  const periodLabel = granularity === "week" ? "week" : "month";
  const roleModeRows = data.role_demand_by_month.filter((r) => r.is_confirmed === (roleMode === "confirmed"));
  const allRoleRowsInFilter = periodFilter.length ? roleModeRows.filter((r) => periodFilter.includes(r.month)) : roleModeRows;
  const allSkillRowsInFilter = periodFilter.length
    ? data.skill_area_demand_by_month.filter((r) => periodFilter.includes(r.month))
    : data.skill_area_demand_by_month;
  const roleRows = showAllRoles ? allRoleRowsInFilter : allRoleRowsInFilter.slice(0, 12);
  const skillRows = showAllSkills ? allSkillRowsInFilter : allSkillRowsInFilter.slice(0, 12);
  const monthsInFilter = periodFilter.length ? data.months.filter((m) => periodFilter.includes(m.month)) : data.months;
  const totalConfirmedInFilter = monthsInFilter.reduce((s, m) => s + m.confirmed_demand_count, 0);
  const totalUnconfirmedInFilter = monthsInFilter.reduce((s, m) => s + m.unconfirmed_demand_count, 0);
  const totalConfirmedDealsInFilter = monthsInFilter.reduce((s, m) => s + m.confirmed_deal_count, 0);

  const togglePeriod = (m: string) =>
    setPeriodFilter((prev) => (prev.includes(m) ? prev.filter((p) => p !== m) : [...prev, m]));

  const open = (sel: DrilldownSel) => setDrilldown(sel);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">Horizon (months)</label>
          <input
            type="number"
            min={1}
            max={36}
            value={horizonMonths}
            onChange={(e) => setHorizonMonths(Math.max(1, Math.min(36, parseInt(e.target.value, 10) || 1)))}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs w-24"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">Break down by</label>
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
            {(["month", "week"] as const).map((g) => (
              <button
                key={g}
                onClick={() => {
                  setGranularity(g);
                  setPeriodFilter([]);
                }}
                className={cn(
                  "px-3 py-1.5 capitalize",
                  granularity === g ? "bg-primary text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data.first_shortfall_month && data.first_shortfall_roles.length > 0 && (
        <button
          onClick={() => {
            setRoleMode("confirmed");
            setPeriodFilter([data.first_shortfall_month!]);
            document.getElementById("role-demand-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="w-full flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-400 text-sm text-left hover:bg-red-100 dark:hover:bg-red-900/40 transition"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            First real shortfall: <strong>{data.first_shortfall_month}</strong> --{" "}
            {data.first_shortfall_roles.map((r, i) => (
              <span key={r.role}>
                {i > 0 && " and "}
                <strong>{r.role}</strong> (need {r.needed_headcount}, {r.available_headcount} available)
              </span>
            ))}
            {" "}-- redeploy or hire before then.
          </span>
        </button>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.months}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f3f7" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="confirmed_demand_count"
              name="Confirmed demand (SOW signed)"
              fill="#3411A3"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(d: { month: string }) => open({ dimension: "confirmed_demand", month: d.month, label: `Confirmed demand -- ${d.month}` })}
            />
            <Bar
              dataKey="unconfirmed_demand_count"
              name="Unconfirmed demand"
              fill="#C36BDB"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(d: { month: string }) => open({ dimension: "unconfirmed_demand", month: d.month, label: `Unconfirmed demand -- ${d.month}` })}
            />
            <Bar
              dataKey="projected_supply_count"
              name="Projected supply (freeing up)"
              fill="#18978E"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(d: { month: string }) => open({ dimension: "supply", month: d.month, label: `Projected supply -- ${d.month}` })}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-xs data-table">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              {["Period", "Confirmed", "Unconfirmed", "Supply", "Net (Supply − Confirmed)", "Confirmed $", "Unconfirmed $", "Flags"].map((h) => (
                <th
                  key={h}
                  className="text-left font-medium px-3 py-2 whitespace-nowrap"
                  title={h === "Net (Supply − Confirmed)" ? "Projected supply minus confirmed demand for this period -- negative means a real shortfall against signed deals." : undefined}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{m.month}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => open({ dimension: "confirmed_demand", month: m.month, label: `Confirmed demand -- ${m.month}` })}
                    className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline"
                  >
                    {m.confirmed_demand_count}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => open({ dimension: "unconfirmed_demand", month: m.month, label: `Unconfirmed demand -- ${m.month}` })}
                    className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline"
                  >
                    {m.unconfirmed_demand_count}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => open({ dimension: "supply", month: m.month, label: `Projected supply -- ${m.month}` })}
                    className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline"
                  >
                    {m.projected_supply_count}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() =>
                      open(
                        m.net_confirmed_surplus_shortfall < 0
                          ? { dimension: "confirmed_demand", month: m.month, label: `Confirmed demand behind the shortfall -- ${m.month}` }
                          : { dimension: "supply", month: m.month, label: `Supply behind the surplus -- ${m.month}` }
                      )
                    }
                    title="Projected supply minus confirmed demand for this period"
                    className={cn(
                      "font-medium hover:underline",
                      m.net_confirmed_surplus_shortfall < 0 ? "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300" : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
                    )}
                  >
                    {m.net_confirmed_surplus_shortfall > 0 ? `+${m.net_confirmed_surplus_shortfall}` : m.net_confirmed_surplus_shortfall}
                  </button>
                </td>
                <td className="px-3 py-2">
                  {m.confirmed_value_usd > 0 ? (
                    <button
                      onClick={() => open({ dimension: "confirmed_demand", month: m.month, label: `Confirmed $ -- ${m.month}` })}
                      className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline"
                    >
                      {formatUsd(m.confirmed_value_usd)}
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2">
                  {m.unconfirmed_value_usd > 0 ? (
                    <button
                      onClick={() => open({ dimension: "unconfirmed_demand", month: m.month, label: `Unconfirmed $ -- ${m.month}` })}
                      className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline"
                    >
                      {formatUsd(m.unconfirmed_value_usd)}
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2 space-y-1">
                  {m.early_warning && <Badge variant="red">shortfall</Badge>}
                  {!m.has_real_demand_data && <Badge variant="amber">no pipeline visibility yet</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div id="role-demand-table" className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Headcount Demand by Role</h2>
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-[11px]">
            {(["confirmed", "unconfirmed"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setRoleMode(mode);
                  setShowAllRoles(false);
                }}
                className={cn("px-2.5 py-1 capitalize", roleMode === mode ? "bg-primary text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800")}
              >
                {mode === "confirmed" ? "Confirmed (SOW signed)" : "Unconfirmed (speculative)"}
              </button>
            ))}
          </div>
        </div>
        {roleMode === "confirmed" ? (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
            Click a row to see the real deals behind it. {totalConfirmedInFilter} confirmed request(s) across{" "}
            {totalConfirmedDealsInFilter} real deal{totalConfirmedDealsInFilter === 1 ? "" : "s"} in this view -- a deal
            requesting several roles (SOW-signed deals average ~5-6 role requests each) counts once per role here, so a
            low number for one specific role just means few of these few deals happened to ask for it.
          </p>
        ) : (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
            Speculative demand, not yet signed -- {totalUnconfirmedInFilter} request(s). Available/Shortfall are shown for
            reference using the same real roster math as confirmed demand, but these requests may never materialize --
            treat as a heads-up, not a committed gap.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Filter by {periodLabel}:</span>
          {data.months.map((m) => (
            <button
              key={m.month}
              onClick={() => togglePeriod(m.month)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] border",
                periodFilter.includes(m.month)
                  ? "bg-primary text-white border-primary"
                  : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
              )}
            >
              {m.month}
            </button>
          ))}
          {periodFilter.length > 0 && (
            <button onClick={() => setPeriodFilter([])} className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-primary hover:underline ml-1">
              Clear
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-[hsl(var(--primary)/0.3)]">
          <div className="overflow-x-auto">
          <table className="w-full text-xs data-table">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                {["Period", "Role", "Needed", "Available", "Shortfall"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleRows.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 cursor-pointer"
                  onClick={() => open({ dimension: "role", value: r.role, month: r.month, label: `${r.role} -- ${r.month}`, isConfirmed: r.is_confirmed })}
                >
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.month}</td>
                  <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
                    {r.role}
                    {r.resolved_designations.length > 1 && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/60 text-violet-600 dark:text-violet-400">
                        flexible · {r.resolved_designations.length} options
                      </span>
                    )}
                    {r.resolved_designations.length === 0 && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500">
                        no internal designation
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.needed_headcount}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {r.available_headcount ?? (
                      <span title="This resource code doesn't resolve to any real internal designation, so there's no roster to check availability against.">
                        not assessed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.shortfall ? (
                      <Badge variant={r.is_confirmed ? "red" : "amber"}>{r.shortfall}</Badge>
                    ) : r.shortfall === 0 ? (
                      <span title="Available headcount meets or exceeds what's needed">
                        <Badge variant="green">covered</Badge>
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500" title="Can't be assessed -- this resource code has no internal designation to check a roster against">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {allRoleRowsInFilter.length > 12 && (
          <button onClick={() => setShowAllRoles((v) => !v)} className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline">
            {showAllRoles ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showAllRoles ? "Show fewer" : `Show all ${allRoleRowsInFilter.length}`}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Confirmed Headcount Demand by Skill Area</h2>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          {data.no_skill_area_specified_count} of the confirmed requests in the table above have no skillset on
          file, so they can&apos;t show up here -- that&apos;s why these totals look smaller.
        </p>
        <div className="flex flex-wrap gap-2">
          {skillRows.map((r, i) => (
            <button
              key={i}
              onClick={() => open({ dimension: "skill_area", value: r.skill_area, month: r.month, label: `${r.skill_area} -- ${r.month}` })}
              className="px-2.5 py-1 rounded-full text-[11px] bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary"
            >
              {r.month} · {r.skill_area} <span className="text-gray-400 dark:text-gray-500">×{r.count}</span>
            </button>
          ))}
          {allSkillRowsInFilter.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 italic">No skill-area data in this window.</p>}
        </div>
        {allSkillRowsInFilter.length > 12 && (
          <button onClick={() => setShowAllSkills((v) => !v)} className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline">
            {showAllSkills ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showAllSkills ? "Show fewer" : `Show all ${allSkillRowsInFilter.length}`}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-primary" /> Account Cluster Scorecards
        </h2>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          Real fields only -- deal counts, SOW-signed rate, illustrative $ value, top roles/skill areas, and real client
          names per cluster, across the whole selected window. Click a cluster to see every real deal in it.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.cluster_scorecards.map((c) => (
            <button
              key={c.cluster}
              onClick={() => open({ dimension: "cluster", value: String(c.cluster), wholeWindow: true, label: `Cluster ${c.cluster} -- ${data.start_date} to +${data.horizon_months}mo` })}
              className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 text-left hover:border-primary transition"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Cluster {c.cluster}</span>
                <Badge variant="default">{c.deal_count} deals</Badge>
                <span className="ml-auto text-xs font-semibold text-gray-600 dark:text-gray-400">{formatUsd(c.value_usd)}</span>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                {c.confirmed_count} confirmed · {c.unconfirmed_count} unconfirmed · {c.sow_signed_rate_pct}% SOW-signed
              </div>
              {c.top_roles.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <span className="text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-0.5">Top roles</span>
                  {c.top_roles.map((r, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                      {r.role} ×{r.count}
                    </span>
                  ))}
                </div>
              )}
              {c.top_skill_areas.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <span className="text-[9px] uppercase tracking-wide text-violet-300 dark:text-violet-400 mr-0.5">Top skill areas</span>
                  {c.top_skill_areas.map((s, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/60 text-violet-600 dark:text-violet-400">
                      {s.skill_area} ×{s.count}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate" title={c.clients.join(", ")}>
                Clients: {c.clients.join(", ")}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Project Mix by Account Cluster, Over Time</h2>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          Account mapping from clusters -- `cluster` is the one fully-populated categorical
          field on every pipeline row. Click a bar segment to see that cluster&apos;s real deals for that month.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={clusterData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f3f7" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {clusters.map((c, i) => (
              <Bar
                key={c}
                dataKey={`cluster_${c}`}
                name={`Cluster ${c}`}
                stackId="clusters"
                fill={CLUSTER_COLORS[i % CLUSTER_COLORS.length]}
                cursor="pointer"
                onClick={(d: { month: string }) => open({ dimension: "cluster", value: String(c), month: d.month, label: `Cluster ${c} -- ${d.month}` })}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Project Mix by Solution Type</h2>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Named project-type label, where known -- only a minority of pipeline rows have it filled in, so shown separately from the cluster view above.</p>
        <div className="flex flex-wrap gap-2">
          {data.project_mix_by_solution_by_month.map((r, i) => (
            <button
              key={i}
              onClick={() => open({ dimension: "solution", value: r.solution, month: r.month, label: `${r.solution} -- ${r.month}` })}
              className="px-2.5 py-1 rounded-full text-[11px] bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary"
            >
              {r.month} · {r.solution} <span className="text-gray-400 dark:text-gray-500">×{r.count}</span>
            </button>
          ))}
          {data.project_mix_by_solution_by_month.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No solution-type data available in this window.</p>
          )}
        </div>
      </div>

      {drilldown && (
        <Modal title={drilldown.label} onClose={() => setDrilldown(null)} widthClassName="max-w-3xl">
          <DrilldownContent result={drilldownQuery.data} loading={drilldownQuery.isLoading} onOpenEmployee={setSelectedEmployee} />
        </Modal>
      )}

      {selectedEmployee && <EmployeeProfileModal employeeId={selectedEmployee} initialTab="overview" onClose={() => setSelectedEmployee(null)} />}
    </div>
  );
}

function DrilldownContent({
  result,
  loading,
  onOpenEmployee,
}: {
  result: OutlookDrilldownResult | undefined;
  loading: boolean;
  onOpenEmployee: (id: string) => void;
}) {
  if (loading || !result) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-7 w-full rounded-lg" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  // Multiple rows can belong to the same real deal_id (one row per requested role) --
  // dedupe before summing so a project's flat value isn't counted once per role.
  const uniqueDeals = [...new Map(result.deals.map((d) => [d.deal_id, d])).values()];
  const totalValue = uniqueDeals.reduce((s, d) => s + (d.value_usd ?? 0), 0);
  return (
    <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
      {result.deals.length > 0 && (
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-3 py-2 flex flex-wrap gap-4 text-[11px]">
          <span className="text-gray-500 dark:text-gray-400">
            {uniqueDeals.length} real deal{uniqueDeals.length === 1 ? "" : "s"}
            {result.deals.length !== uniqueDeals.length && ` (${result.deals.length} role request${result.deals.length === 1 ? "" : "s"})`}
          </span>
          {totalValue > 0 && <span className="text-gray-700 dark:text-gray-300 font-medium">sum value: {formatUsd(totalValue)}</span>}
        </div>
      )}
      {result.deals.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">Real pipeline deals</p>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {groupByDeal(result.deals).map((roles, i) => (
              <ProjectCard key={i} roles={roles} />
            ))}
          </div>
        </div>
      )}
      {result.deals.length === 0 && result.supply_employees.length === 0 && result.designation_roster.length === 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">No matching real rows.</p>
      )}
      {result.designation_roster.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
            Proof -- every real {result.value} ({result.designation_roster.length}), and why each does or doesn&apos;t count as available
          </p>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {result.designation_roster.map((r) => (
              <RosterRow key={r.employee_id} r={r} onOpenEmployee={onOpenEmployee} />
            ))}
          </div>
        </div>
      )}
      {result.supply_employees.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
            Real employees freeing up ({result.supply_employees.length})
          </p>
          {result.supply_anomaly_note && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-2.5 py-1.5 mb-2">{result.supply_anomaly_note}</p>
          )}
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {result.supply_employees.map((e, i) => (
              <SupplyRow key={i} e={e} onOpenEmployee={onOpenEmployee} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One real deal_id is one real project, made of one or more requested-role rows sharing
// the same client/cluster/EM/solution/SOW status (ffilled from the source's first row per
// deal) -- grouping here so the UI shows one project card with N nested roles, instead of
// N separate top-level rows each redundantly repeating the SAME flat project value, which
// read as N separate $35K projects when it's really one.
function groupByDeal(deals: OutlookDrilldownDeal[]): OutlookDrilldownDeal[][] {
  const groups = new Map<string, OutlookDrilldownDeal[]>();
  deals.forEach((d, i) => {
    const key = d.deal_id != null ? String(d.deal_id) : `__no_deal_id_${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  });
  return [...groups.values()];
}

function ProjectCard({ roles }: { roles: OutlookDrilldownDeal[] }) {
  const [open, setOpen] = useState(false);
  const head = roles[0]; // deal-level fields are identical across every role row in this group
  return (
    <div className="py-1.5 text-[11px]">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        {open ? <ChevronUp className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />}
        <span className="font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{head.client}</span>
        <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">Cluster {head.cluster}</span>
        <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap truncate">
          {roles.length} role{roles.length === 1 ? "" : "s"} requested
        </span>
        <Badge variant={head.is_confirmed ? "green" : "amber"}>{head.is_confirmed ? "SOW signed" : "unconfirmed"}</Badge>
        {head.value_usd != null && <span className="ml-auto font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatUsd(head.value_usd)}</span>}
      </button>
      {open && (
        <div className="mt-2 ml-5 space-y-2">
          {head.value_usd != null && (
            <p className="text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 rounded-lg px-2 py-1.5">
              Illustrative project value -- anchored to the real ~$35K / 5-week delivery benchmark (same
              as the Revenue Target tab), flat per PROJECT regardless of role mix (shown once here, not
              once per requested role below). Requested %/duration data is too sparse in this source to
              scale further.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            <Field label="Deal ID" value={head.deal_id} />
            <Field label="Client priority" value={head.client_priority} />
            <Field label="EM" value={head.em} />
            <Field label="Solution" value={head.solution} />
            <Field label="Request received" value={head.request_received} />
            <Field label="Original requested start" value={head.original_requested_start_date} />
            <Field label="Start date confirmed" value={head.start_date_confirmed} />
            <Field label="Number of weeks" value={head.number_of_weeks} />
            <Field label="Deal stage (HubSpot)" value={head.deal_stage_hubspot?.trim()} />
            <Field label="SOW signed" value={head.sow_signed} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              {roles.length} role{roles.length === 1 ? "" : "s"} requested on this project
            </p>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {roles.map((r, i) => (
                <RoleRequestRow key={i} r={r} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleRequestRow({ r }: { r: OutlookDrilldownDeal }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.role_label}</span>
        {r.status && <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{r.status}</span>}
        {r.priority && <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{r.priority}</span>}
        {r.likely_start_date && <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap ml-auto">starts {r.likely_start_date}</span>}
      </div>
      <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
        <Field label="Role code" value={r.role_code} />
        <Field label="Resolved designation(s)" value={r.resolved_designations.join(", ") || "none"} />
        <Field label="Requested %" value={r.requested_pct} />
        <Field label="Skill areas" value={r.skill_areas.join(", ") || "none"} />
        <Field label="Notice days" value={r.notice_days} />
        <Field label="Late notice" value={r.is_late_notice == null ? null : r.is_late_notice ? "Yes" : "No"} />
      </div>
      {r.skillset && <p className="text-gray-400 dark:text-gray-500 italic mt-1">&quot;{r.skillset}&quot;</p>}
      {r.comments && <p className="text-gray-400 dark:text-gray-500 mt-1">Comments: {r.comments}</p>}
    </div>
  );
}

function RosterRow({ r, onOpenEmployee }: { r: DesignationRosterEntry; onOpenEmployee: (id: string) => void }) {
  return (
    <div className="py-2 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onOpenEmployee(r.employee_id)} className="font-medium text-primary hover:underline whitespace-nowrap">
          {r.employee_id}
        </button>
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.job_name}</span>
        <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{r.department_name}</span>
        <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{r.location}</span>
        <span
          className={cn(
            "ml-auto text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
            r.is_available ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400" : "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
          )}
        >
          {r.is_available ? `counts as available -- ${r.available_pct}% free` : `doesn't count -- only ${r.available_pct}% free`}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {r.current_allocations.length === 0 ? (
          <span className="text-gray-400 dark:text-gray-500">no current allocation -- fully free</span>
        ) : (
          r.current_allocations.map((a, i) => (
            <span
              key={i}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                a.is_internal ? "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/60 text-violet-600 dark:text-violet-400" : "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-400"
              )}
            >
              {a.project_id} · {a.allocation_by_percentage}%{a.is_internal ? " (internal, doesn't block client work)" : ""} · until{" "}
              {a.allocated_end_date}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function SupplyRow({ e, onOpenEmployee }: { e: OutlookDrilldownEmployee; onOpenEmployee: (id: string) => void }) {
  return (
    <div className="py-1.5 flex items-center gap-2 text-[11px] flex-wrap">
      <button onClick={() => onOpenEmployee(e.employee_id)} className="font-medium text-primary hover:underline whitespace-nowrap">
        {e.employee_id}
      </button>
      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{e.job_name}</span>
      <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{e.department_name}</span>
      <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{e.location}</span>
      <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">from {e.project_id}</span>
      <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">{e.allocation_by_percentage}%</span>
      {e.is_anomaly_cluster && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400">shared end-date</span>
      )}
      <span className="ml-auto text-gray-400 dark:text-gray-500 whitespace-nowrap">
        {e.allocated_start_date} → ends {e.allocated_end_date}
      </span>
    </div>
  );
}
