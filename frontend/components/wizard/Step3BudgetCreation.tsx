"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { api, type BudgetLineItem, type DealSummary } from "@/lib/api";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { TeamRecommendationPanel } from "@/components/shared/TeamRecommendationPanel";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { StepPlaceholder } from "@/components/wizard/StepPlaceholder";
import {
  BILLING_CURRENCY_OPTIONS, ENGAGEMENT_STYLE_OPTIONS, PAYMENT_TERM_OPTIONS, PROPOSITION_COE_OPTIONS, JMAN_LOCATIONS,
} from "@/lib/projectConstants";

const selectCls = "w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs bg-white dark:bg-gray-900 outline-none";

type Tab = "fees" | "discount" | "planned_cost";

// Same real, RM-provided team templates the Forecast page's own FTE
// auto-generation already uses (backend/app/engines/role_mix_engine.py) --
// reused here rather than re-hardcoding the same numbers a second time.
const DELIVERY_STANDARD_TEAM = "Delivery Project - Standard Team";

function blankRow(defaultDate: string): BudgetLineItem {
  return {
    designation: "", location: JMAN_LOCATIONS[0], estimated_start_date: defaultDate,
    hours_per_day: 8, allocation_pct: 100, working_days: null,
    base_day_rate: null, eff_day_rate: null,
  };
}

export function Step3BudgetCreation({
  projectCode,
  projectLabel,
  defaultStartDate,
  defaultEndDate,
  defaultIsBillable,
  deal,
  onNext,
}: {
  projectCode: string | null;
  projectLabel: string;
  defaultStartDate: string;
  defaultEndDate: string;
  defaultIsBillable: boolean;
  deal: DealSummary | null;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ["project-budget", projectCode],
    queryFn: () => api.getProjectBudget(projectCode as string),
    enabled: projectCode != null,
  });
  // Delivery/billable roles only -- a project budget line item should never
  // offer HR, Finance, Legal, IT-support, or exec/admin titles as a "role".
  const designations = useQuery({ queryKey: ["employee-designations", "delivery"], queryFn: () => api.employeeDesignations(true) });
  const roleMixCategories = useQuery({ queryKey: ["role-mix-categories"], queryFn: api.roleMixCategories });

  const [tab, setTab] = useState<Tab>("fees");
  const [loadedFromServer, setLoadedFromServer] = useState(false);
  const [billingCurrencies, setBillingCurrencies] = useState<string[]>([BILLING_CURRENCY_OPTIONS[0]]);
  const billingCurrency = billingCurrencies[0] ?? BILLING_CURRENCY_OPTIONS[0];
  const [engagementStyles, setEngagementStyles] = useState<string[]>([]);
  // Multi-value, consistent with Step 1's Tech/Solution COE -- this app's
  // real data already stores proposition_coe as semicolon-joined combos.
  const [propositionCoes, setPropositionCoes] = useState<string[]>([PROPOSITION_COE_OPTIONS[0]]);
  const [paymentTerms, setPaymentTerms] = useState<string[]>([]);
  const [feeMultiplier, setFeeMultiplier] = useState(1);
  const [paymentTermPct, setPaymentTermPct] = useState(0);
  const [isBillable, setIsBillable] = useState(defaultIsBillable);
  const [rows, setRows] = useState<BudgetLineItem[]>([blankRow(defaultStartDate)]);
  // Real-precedent check on the CURRENTLY selected headcount for this
  // project's type/CoE -- not a wholesale team suggestion, just whether
  // this size (or one person more/fewer) historically stayed clean. Refetches
  // whenever the actual designations change, not just on mount.
  const currentDesignationsKey = rows.map((r) => r.designation).filter(Boolean).sort().join("|");
  const teamSizeFit = useQuery({
    queryKey: ["role-mix-team-size-fit", projectCode, currentDesignationsKey],
    queryFn: () => api.roleMixTeamSizeFit(projectCode as string, rows.map((r) => r.designation)),
    enabled: projectCode != null && rows.some((r) => r.designation),
    // Keep showing the previous result while a new one loads (e.g. right
    // after adding/removing a role) instead of the panel blinking out and
    // back in -- only the very first check for this project has no prior
    // result to hold onto, which is what the loading state below covers.
    placeholderData: keepPreviousData,
  });
  const [hourlyRateCache, setHourlyRateCache] = useState<Record<string, number | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailProjectCode, setDetailProjectCode] = useState<string | null>(null);
  const [templateApplied, setTemplateApplied] = useState(false);

  // Consultant-family seats are UK-based by default on these real team
  // templates; everything else defaults to Chennai.
  function defaultLocationForDesignation(designation: string): string {
    return designation === "Consultant" || designation === "Associate Consultant" ? "UK" : JMAN_LOCATIONS[0];
  }

  function rowsFromTemplate(categoryName: string): BudgetLineItem[] {
    const cat = roleMixCategories.data?.find((c) => c.category === categoryName);
    if (!cat || cat.roles.length === 0) return [blankRow(defaultStartDate)];
    const out: BudgetLineItem[] = [];
    cat.roles.forEach((r) => {
      const headcount = Math.max(1, r.headcount);
      for (let i = 0; i < headcount; i++) {
        out.push({
          designation: r.designation, location: defaultLocationForDesignation(r.designation), estimated_start_date: defaultStartDate,
          hours_per_day: 8, allocation_pct: Math.round(r.typical_pct) || 100, working_days: null,
          base_day_rate: null, eff_day_rate: null,
        });
      }
    });
    return out;
  }

  // Minimal-change actions for the team-size-fit panel below -- add/remove
  // exactly ONE seat of the specific role real precedent data points to,
  // never a wholesale team replacement (see TeamRecommendationPanel).
  function addRoleRow(designation: string) {
    setRows((prev) => [
      ...prev,
      {
        designation, location: defaultLocationForDesignation(designation), estimated_start_date: defaultStartDate,
        hours_per_day: 8, allocation_pct: 100, working_days: null, base_day_rate: null, eff_day_rate: null,
      },
    ]);
  }
  function removeRoleRow(designation: string) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.designation === designation);
      if (idx === -1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }

  // The real combination of roles this deal actually requested in the
  // pipeline data (e.g. AP, Sol Con, SSE, SE...) -- takes priority over the
  // generic team template below whenever the deal specifies any.
  function rowsFromDeal(d: DealSummary): BudgetLineItem[] {
    const known = new Set(designations.data ?? []);
    const items = d.roles.filter((r) => r.requested_designations.length > 0);
    return items.map((r) => {
      // Pipeline data sometimes lists a real, valid title alongside a raw
      // variant of it (e.g. "Technical Solutions Architect" next to the
      // actual "Technology Solutions Architect") -- always taking index 0
      // meant a real, known role could land as an unmatched, unselected
      // dropdown just because the wrong alias happened to come first.
      const designation = r.requested_designations.find((name) => known.has(name)) ?? r.requested_designations[0];
      return {
        designation, location: defaultLocationForDesignation(designation),
        estimated_start_date: r.likely_start_date || defaultStartDate,
        hours_per_day: 8,
        allocation_pct: r.requested_pct ? Number(r.requested_pct) || 100 : 100,
        working_days: null,
        base_day_rate: null,
        eff_day_rate: null,
      };
    });
  }

  // Pre-fill a brand-new budget by default instead of one blank row, so the
  // RM edits/removes what doesn't apply rather than building from scratch --
  // the deal's own real requested roles when it specifies any, otherwise the
  // generic DELIVERY_STANDARD_TEAM template. Skipped once a real saved budget exists.
  useEffect(() => {
    if (templateApplied || loadedFromServer) return;
    if (existing.isLoading || roleMixCategories.isLoading || designations.isLoading) return;
    const savedLineItems = (existing.data as { line_items?: unknown[] } | null)?.line_items;
    if (Array.isArray(savedLineItems) && savedLineItems.length > 0) { setTemplateApplied(true); return; }
    const dealRows = deal ? rowsFromDeal(deal) : [];
    setRows(dealRows.length > 0 ? dealRows : rowsFromTemplate(DELIVERY_STANDARD_TEAM));
    setTemplateApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateApplied, loadedFromServer, existing.isLoading, existing.data, roleMixCategories.isLoading, designations.isLoading, deal]);

  useEffect(() => {
    if (existing.data && !loadedFromServer) {
      const d = existing.data as Record<string, unknown>;
      if (typeof d.billing_currency === "string" && d.billing_currency) setBillingCurrencies([d.billing_currency]);
      if (typeof d.engagement_style === "string" && d.engagement_style) setEngagementStyles([d.engagement_style]);
      if (typeof d.proposition_coe === "string" && d.proposition_coe) setPropositionCoes(d.proposition_coe.split("; ").filter(Boolean));
      if (typeof d.payment_term === "string" && d.payment_term) setPaymentTerms([d.payment_term]);
      setIsBillable(d.is_billable === "True" || d.is_billable === true);
      if (Array.isArray(d.line_items) && d.line_items.length > 0) setRows(d.line_items as BudgetLineItem[]);
      setLoadedFromServer(true);
    }
  }, [existing.data, loadedFromServer]);

  useEffect(() => {
    const missing = Array.from(new Set(rows.map((r) => r.designation).filter(Boolean))).filter((d) => !(d in hourlyRateCache));
    missing.forEach(async (d) => {
      const r = await api.projectDayRate(d, 1);
      setHourlyRateCache((prev) => ({ ...prev, [d]: r.base_day_rate }));
    });
  }, [rows, hourlyRateCache]);

  function updateRow(i: number, patch: Partial<BudgetLineItem>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, blankRow(defaultStartDate)]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function computed(row: BudgetLineItem) {
    const hourly = row.designation ? hourlyRateCache[row.designation] : null;
    const baseDayRate = hourly != null ? Math.round(hourly * row.hours_per_day * 100) / 100 : null;
    const effDayRate = baseDayRate != null ? Math.round(baseDayRate * feeMultiplier * 100) / 100 : null;
    const workingDays = row.working_days ?? 0;
    const total = effDayRate != null && workingDays ? Math.round(effDayRate * workingDays * 100) / 100 : 0;
    const cost = baseDayRate != null && workingDays ? Math.round(baseDayRate * workingDays * 100) / 100 : 0;
    const margin = total > 0 ? Math.round(((total - cost) / total) * 1000) / 10 : 0;
    return { baseDayRate, effDayRate, total, cost, margin };
  }

  const totals = rows.reduce(
    (acc, r) => {
      const c = computed(r);
      return { total: acc.total + c.total, cost: acc.cost + c.cost };
    },
    { total: 0, cost: 0 }
  );
  const blendedMargin = totals.total > 0 ? Math.round(((totals.total - totals.cost) / totals.total) * 1000) / 10 : 0;

  // Straight after the budget is saved, actually staff each budgeted role
  // with the top available real person holding that designation -- Resource
  // Allocation should already be done by the time the RM gets there, not
  // waiting on a separate manual "Assign" click per row. Roles that already
  // have enough real allocations (e.g. re-saving an edited budget) are
  // skipped so this stays idempotent rather than piling up duplicates.
  //
  // Fetches/writes run in parallel, not one role at a time: this used to
  // await a topCandidatesForRole + assignAllocation round trip sequentially
  // per row (and even re-fetch the identical candidate list twice for two
  // rows of the same designation), which is why saving a 4-role budget was
  // taking 30-60s. Now it's one parallel batch of lookups (deduped by
  // designation) followed by one parallel batch of writes.
  async function autoAssignFromBudget(items: BudgetLineItem[]) {
    if (!projectCode) return;
    // A transient failure here (e.g. a reload race right after the project
    // was just created) shouldn't abort staffing the whole budget -- worst
    // case we treat it as "no existing allocations yet" and possibly
    // over-suggest, which is far better than silently staffing nobody.
    const realCountByDesignation: Record<string, number> = {};
    try {
      const rosterData = await api.projectRoster(projectCode);
      for (const r of rosterData.roster) {
        if (r.job_name) realCountByDesignation[r.job_name] = (realCountByDesignation[r.job_name] ?? 0) + 1;
      }
    } catch {
      // proceed with an empty count -- see comment above
    }

    const seenCountByDesignation: Record<string, number> = {};
    const itemsNeedingStaff = items.filter((item) => {
      if (!item.designation) return false;
      seenCountByDesignation[item.designation] = (seenCountByDesignation[item.designation] ?? 0) + 1;
      return seenCountByDesignation[item.designation] > (realCountByDesignation[item.designation] ?? 0);
    });
    if (itemsNeedingStaff.length === 0) return;

    const distinctDesignations = Array.from(new Set(itemsNeedingStaff.map((i) => i.designation)));
    // One batched call instead of one HTTP round trip per designation -- each
    // of those individually recomputed the same expensive availability scan
    // over every allocation row, which is what made a multi-role budget save
    // slow against real data volume even though the calls were parallelized.
    const candidatesByDesignation = await api.topCandidatesForRoles(
      distinctDesignations.map((designation) => ({
        designation,
        as_of_date: itemsNeedingStaff.find((i) => i.designation === designation)?.estimated_start_date || defaultStartDate,
      })),
      20
    );

    const usedEmployeeIds = new Set<string>();
    const picks: { employeeId: string; item: BudgetLineItem }[] = [];
    for (const item of itemsNeedingStaff) {
      const pool = candidatesByDesignation[item.designation] ?? [];
      const pick = pool.find((c) => !usedEmployeeIds.has(c.employee_id));
      if (!pick) continue;
      usedEmployeeIds.add(pick.employee_id);
      picks.push({ employeeId: pick.employee_id, item });
    }

    await Promise.allSettled(
      picks.map(({ employeeId, item }) =>
        api.assignAllocation({
          employeeId, projectId: projectCode,
          allocationPct: item.allocation_pct || 100,
          startDate: item.estimated_start_date || defaultStartDate,
          endDate: defaultEndDate || item.estimated_start_date || defaultStartDate,
          resourcingStatus: "BILLABLE", shiftType: "General", reviewerEmployeeId: null,
        })
      )
    );
  }

  async function submit() {
    setError(null);
    if (!projectCode) { setError("Create the project in Step 1 first, then come back to save this."); return; }
    setSubmitting(true);
    try {
      const enrichedRows = rows.map((r) => {
        const c = computed(r);
        return { ...r, base_day_rate: c.baseDayRate, eff_day_rate: c.effDayRate };
      });
      await api.saveProjectBudget(
        projectCode,
        {
          billing_currency: billingCurrency,
          engagement_style: engagementStyles[0] ?? "",
          proposition_coe: propositionCoes.join("; "),
          payment_term: paymentTerms[0] ?? "",
          is_billable: isBillable,
        },
        enrichedRows
      );
      // Step 5 stays mounted the whole time the wizard is open (so switching
      // steps never loses in-progress edits) -- which means its own budget/
      // roster queries won't refetch on their own just because we saved here.
      // Invalidate explicitly so it picks up the new budget and the
      // allocations we're about to create below.
      qc.invalidateQueries({ queryKey: ["project-budget", projectCode] });
      await autoAssignFromBudget(enrichedRows);
      qc.invalidateQueries({ queryKey: ["roster", projectCode] });
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the budget.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          Create Budget for project
          {projectLabel && <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs align-middle">{projectLabel}</span>}
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
          Is Billable
        </label>
      </div>

      {!projectCode && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2">
          No project created yet — you can build out this budget now, but it won&apos;t save until you complete Step 1.
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Billing Currency <span className="text-red-500 dark:text-red-400">*</span></label>
          <SearchableSelect options={BILLING_CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))} value={billingCurrencies} onChange={setBillingCurrencies} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Engagement Style <span className="text-red-500 dark:text-red-400">*</span></label>
          <SearchableSelect
            options={ENGAGEMENT_STYLE_OPTIONS.map((c) => ({ value: c, label: c }))}
            value={engagementStyles}
            onChange={setEngagementStyles}
            placeholder="Select Engagement Style"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Proposition Coe <span className="text-red-500 dark:text-red-400">*</span></label>
          <div className="flex items-center gap-1.5">
            <SearchableSelect options={PROPOSITION_COE_OPTIONS.map((c) => ({ value: c, label: c }))} value={propositionCoes} onChange={setPropositionCoes} multi className="flex-1" />
            <input
              type="number" step={0.05} min={1} value={feeMultiplier}
              onChange={(e) => setFeeMultiplier(Number(e.target.value) || 1)}
              className="w-14 px-1.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-center flex-shrink-0"
              title="Fee multiplier applied to the base day rate to get the billed (Eff.) rate"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Payment Term <span className="text-red-500 dark:text-red-400">*</span></label>
          <div className="flex items-center gap-1.5">
            <SearchableSelect
              options={PAYMENT_TERM_OPTIONS.map((c) => ({ value: c, label: c }))}
              value={paymentTerms}
              onChange={setPaymentTerms}
              placeholder="Select Payment Term"
              className="flex-1"
            />
            <input
              type="number" step={1} min={0} value={paymentTermPct}
              onChange={(e) => setPaymentTermPct(Number(e.target.value) || 0)}
              className="w-14 px-1.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-center flex-shrink-0"
              title="Early/late payment adjustment %"
            />
          </div>
        </div>
      </div>

      <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 text-xs font-medium">
        {([
          ["fees", "Professional Fees"],
          ["discount", "Discount / Premium"],
          ["planned_cost", "Planned Cost"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-4 py-2.5 ${tab === key ? "text-white" : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            style={tab === key ? { backgroundColor: "hsl(var(--primary))" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "fees" && (
        <div className="space-y-2">
          {projectCode && rows.some((r) => r.designation) && (
            teamSizeFit.isLoading ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 dark:text-gray-500" />
                <span className="text-[11px] text-gray-400 dark:text-gray-500">Checking this team size against real precedent projects…</span>
              </div>
            ) : teamSizeFit.data ? (
              <TeamRecommendationPanel
                data={teamSizeFit.data}
                onAddRole={addRoleRow}
                onRemoveRole={removeRoleRow}
                onSelectProject={setDetailProjectCode}
                isUpdating={teamSizeFit.isFetching}
              />
            ) : null
          )}

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                  {["Role *", "Location", "Est. Start", "Hrs/Day", "Alloc %", "Working Days *", "Base Day Rate", "Eff. Day Rate", "Total", "Cost", "Margin %", ""].map((h) => (
                    <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const c = computed(row);
                  return (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                      <td className="px-2.5 py-1.5 min-w-[180px]">
                        <SearchableSelect
                          options={(designations.data ?? []).map((d) => ({ value: d, label: d }))}
                          value={row.designation ? [row.designation] : []}
                          onChange={(v) => updateRow(i, { designation: v[0] ?? "" })}
                        />
                      </td>
                      <td className="px-2.5 py-1.5 min-w-[100px]">
                        <SearchableSelect
                          options={JMAN_LOCATIONS.map((l) => ({ value: l, label: l }))}
                          value={row.location ? [row.location] : []}
                          onChange={(v) => updateRow(i, { location: v[0] ?? null })}
                          placeholder="-- Select --"
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input type="date" className={selectCls} value={row.estimated_start_date ?? ""} onChange={(e) => updateRow(i, { estimated_start_date: e.target.value })} />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input type="number" min={1} max={24} className={selectCls + " w-16"} value={row.hours_per_day} onChange={(e) => updateRow(i, { hours_per_day: Number(e.target.value) || 0 })} />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input type="number" min={0} max={100} className={selectCls + " w-16"} value={row.allocation_pct} onChange={(e) => updateRow(i, { allocation_pct: Number(e.target.value) || 0 })} />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input type="number" min={0} className={selectCls + " w-20"} value={row.working_days ?? ""} onChange={(e) => updateRow(i, { working_days: e.target.value ? Number(e.target.value) : null })} />
                      </td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {c.baseDayRate != null ? c.baseDayRate.toLocaleString() : "-"}
                        {row.real_median_price_per_day != null && (
                          <div
                            className="text-[9px] text-gray-400 dark:text-gray-500"
                            title="Real median day rate from JIN's approved budgets for this role -- currency not yet confirmed by the data warehouse, so shown as a reference only"
                          >
                            JIN ref: {Math.round(row.real_median_price_per_day).toLocaleString()}/day
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.effDayRate != null ? c.effDayRate.toLocaleString() : "-"}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.total.toLocaleString()}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.cost.toLocaleString()}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.margin}%</td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={addRow} className="text-[hsl(var(--primary))]"><Plus size={14} /></button>
                          <button onClick={() => removeRow(i)} className="text-red-500 dark:text-red-400"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-800/60 font-semibold text-gray-700 dark:text-gray-300">
                  <td colSpan={8} className="px-2.5 py-2 text-right">Total</td>
                  <td className="px-2.5 py-2">{billingCurrency} {totals.total.toLocaleString()}</td>
                  <td className="px-2.5 py-2">{billingCurrency} {totals.cost.toLocaleString()}</td>
                  <td className="px-2.5 py-2">{blendedMargin}%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        </div>
      )}

      {tab === "planned_cost" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Planned Revenue</p>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">{billingCurrency} {totals.total.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Planned Cost</p>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">{billingCurrency} {totals.cost.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Blended Margin</p>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">{blendedMargin}%</p>
          </div>
          <p className="sm:col-span-3 text-[11px] text-gray-400 dark:text-gray-500">Computed from the Professional Fees rows above — no separate data entry.</p>
        </div>
      )}

      {tab === "discount" && <StepPlaceholder title="Discount / Premium" />}

      <div className="flex justify-end gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {submitting ? "Saving…" : "Save & Next"}
        </button>
      </div>

      {detailProjectCode && (
        <ProjectHealthDetailModal projectCode={detailProjectCode} onClose={() => setDetailProjectCode(null)} />
      )}
    </div>
  );
}
