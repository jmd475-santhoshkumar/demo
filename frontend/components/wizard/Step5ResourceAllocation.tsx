"use client";

import { useEffect, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, X, Sparkles, RefreshCw } from "lucide-react";
import { api, type AllocationRow, type BudgetLineItem, type DealSummary, type RosterEntry, DEFAULT_INCLUDE_PARAMS } from "@/lib/api";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AssignWithOverAllocationCheck, OverAllocationWarningModal } from "@/components/shared/OverAllocationWarningModal";
import { RESOURCING_STATUSES, SHIFT_TYPES } from "@/components/shared/AssignModal";
import { RoleRecommendationDetail } from "@/components/shared/RoleRecommendationDetail";
import type { ProfileTab, SkillMatchContext } from "@/components/shared/EmployeeProfileModal";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DraftRow {
  key: string;
  designation: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  resourcingStatus: string;
  shiftType: string;
  reviewerEmployeeId: string;
  allocationPct: number;
  source: "budget" | "cloned" | "sow";
}

export function Step5ResourceAllocation({
  projectCode,
  projectDates,
  deal,
  onOpenProfile,
  cloneSignal,
  onCloneApplied,
}: {
  projectCode: string | null;
  projectDates: { startDate: string; endDate: string } | null;
  deal: DealSummary | null;
  onOpenProfile: (employeeId: string, tab: ProfileTab, skillMatchContext?: SkillMatchContext) => void;
  cloneSignal?: { oldEndDate: string; newEndDate: string } | null;
  onCloneApplied?: () => void;
}) {
  const qc = useQueryClient();
  const roster = useQuery({
    queryKey: ["roster", projectCode],
    queryFn: () => api.projectRoster(projectCode as string),
    enabled: projectCode != null,
  });
  const budget = useQuery({
    queryKey: ["project-budget", projectCode],
    queryFn: () => api.getProjectBudget(projectCode as string),
    enabled: projectCode != null,
  });
  // Real SOW-vs-budget role alignment, plus any real named person the SOW
  // specified for a role -- only meaningful once a SOW has actually been
  // extracted (Step 4), so a project with no SOW extraction yet just gets
  // has_sow_data: false and this whole feature quietly does nothing.
  const sowComparison = useQuery({
    queryKey: ["sow-compare-budget", projectCode],
    queryFn: () => api.sowCompareBudget(projectCode as string),
    enabled: projectCode != null,
  });
  const employees = useQuery({ queryKey: ["employees-list"], queryFn: api.employeesList });

  const realBudgetLineItems = (budget.data?.line_items ?? []).filter((li) => li.designation);
  // No budget was ever created in Step 3 (no FTE/role selected) -- default to
  // the combination of roles this deal actually requested in the real
  // pipeline data (e.g. AP, Sol Con, SSE, SE...) instead of showing nothing.
  const fallbackLineItems: BudgetLineItem[] =
    realBudgetLineItems.length === 0 && deal
      ? deal.roles
          .filter((r) => r.requested_designations.length > 0)
          .map((r) => ({
            designation: r.requested_designations[0],
            location: null,
            estimated_start_date: r.likely_start_date,
            hours_per_day: 8,
            allocation_pct: r.requested_pct ? Number(r.requested_pct) || 100 : 100,
            working_days: null,
            base_day_rate: null,
            eff_day_rate: null,
          }))
      : [];
  const lineItems = realBudgetLineItems.length > 0 ? realBudgetLineItems : fallbackLineItems;
  const distinctDesignations = Array.from(new Set(lineItems.map((li) => li.designation)));
  const asOfDate = projectDates?.startDate ?? todayStr();

  // One ranked-by-availability shortlist per distinct budgeted role -- the
  // real signal behind "pre-select the top guys" instead of leaving every
  // row blank the way JIN's own Resource Allocation table does.
  const topCandidatesQueries = useQueries({
    queries: distinctDesignations.map((designation) => ({
      queryKey: ["top-candidates-for-role", designation, asOfDate],
      // 50, not 20 -- the backend now also includes same-level cross-family
      // peers (e.g. "Principal"/"Principal Technology Architect" for a
      // "Principal Architect" request), so the ranked list is longer than
      // one exact title's headcount; a low limit here would silently push
      // some of those real peers into this component's own exact-title-only
      // fallback list below, which doesn't know about the peer relationship.
      queryFn: () => api.topCandidatesForRole(designation, asOfDate, 50),
      enabled: projectCode != null,
    })),
  });
  const candidatesByDesignation: Record<string, { employee_id: string; employee_full_name: string | null }[]> = {};
  distinctDesignations.forEach((d, i) => {
    candidatesByDesignation[d] = topCandidatesQueries[i]?.data ?? [];
  });
  const topCandidatesLoading = topCandidatesQueries.some((q) => q.isLoading);

  // The ranked top-20 list can run out before every budgeted slot for that
  // designation is filled (e.g. budget wants 2 "Solutions Enabler" but only 1
  // real ranked candidate exists) -- when that happens the draft's employeeId
  // is legitimately blank, not a bug, but the dropdown must still offer every
  // real employee with that title so the row is never a dead end with zero
  // options to pick from.
  const allByDesignation: Record<string, { employee_id: string; employee_full_name: string | null; job_name: string | null }[]> = {};
  for (const e of employees.data ?? []) {
    if (!e.job_name) continue;
    (allByDesignation[e.job_name] ??= []).push(e);
  }
  // mustIncludeEmployeeId: a row can be pre-set to a real employee whose OWN
  // real job title doesn't exactly match this row's designation (confirmed
  // real case: a SOW named a "Consultant" for the role, but that specific
  // real employee's own title is "Associate Consultant" -- a different, also
  // real designation) -- without this, that employee never appears in their
  // own dropdown's option list at all, so the row silently renders as blank
  // ("Select ...") even though the correct employee_id is already set.
  function optionsForDesignation(designation: string, mustIncludeEmployeeId?: string) {
    const ranked = candidatesByDesignation[designation] ?? [];
    const seen = new Set(ranked.map((c) => c.employee_id));
    const rest = (allByDesignation[designation] ?? []).filter((e) => !seen.has(e.employee_id));
    let combined: { employee_id: string; employee_full_name: string | null }[] = [...ranked, ...rest];
    if (mustIncludeEmployeeId && !combined.some((c) => c.employee_id === mustIncludeEmployeeId)) {
      const forced = (employees.data ?? []).find((e) => e.employee_id === mustIncludeEmployeeId);
      if (forced) combined = [forced, ...combined];
    }
    return combined.map((c) => ({
      value: c.employee_id,
      label: c.employee_full_name ? `${c.employee_id} - ${c.employee_full_name} (${designation})` : `${c.employee_id} (${designation})`,
    }));
  }

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  // Reconciles rather than one-shot-initializes: every time the budget or
  // roster data actually changes (a fresh save in Step 3, an auto-assign
  // completing, a manual Assign here), scan for budgeted roles not yet
  // covered by a real allocation OR an existing draft, and add drafts only
  // for those. This component is mounted for the whole wizard session (see
  // ProjectWizard's hidden-class steps), so a naive "run once" effect could
  // permanently lock onto an empty/stale budget snapshot from before Step 3
  // was even visited -- appending instead of replacing also means an
  // in-progress edit on one draft is never wiped out by another role's
  // suggestions arriving later.
  useEffect(() => {
    if (!projectCode || budget.isLoading || roster.isLoading || topCandidatesLoading) return;

    setDrafts((prevDrafts) => {
      const realCountByDesignation: Record<string, number> = {};
      for (const r of roster.data?.roster ?? []) {
        if (r.job_name) realCountByDesignation[r.job_name] = (realCountByDesignation[r.job_name] ?? 0) + 1;
      }
      const coveredCountByDesignation: Record<string, number> = { ...realCountByDesignation };
      for (const d of prevDrafts) {
        coveredCountByDesignation[d.designation] = (coveredCountByDesignation[d.designation] ?? 0) + 1;
      }
      const suggestedByDesignation: Record<string, Set<string>> = {};
      for (const d of prevDrafts) {
        (suggestedByDesignation[d.designation] ??= new Set()).add(d.employeeId);
      }

      const additions: DraftRow[] = [];
      lineItems.forEach((item, idx) => {
        const designation = item.designation;
        const alreadyCovered = coveredCountByDesignation[designation] ?? 0;
        const realOnly = realCountByDesignation[designation] ?? 0;
        // How many total slots for this designation have we walked past so far
        // (real + covered-by-draft), vs. how many this budget wants overall --
        // approximate via a running per-designation counter across all items.
        const wantedSoFar = lineItems.slice(0, idx + 1).filter((li) => li.designation === designation).length;
        if (wantedSoFar <= Math.max(alreadyCovered, realOnly)) return;

        const pool = candidatesByDesignation[designation] ?? [];
        const used = suggestedByDesignation[designation] ?? new Set<string>();
        const pick = pool.find((c) => !used.has(c.employee_id));
        if (pick) used.add(pick.employee_id);
        suggestedByDesignation[designation] = used;
        coveredCountByDesignation[designation] = (coveredCountByDesignation[designation] ?? 0) + 1;

        additions.push({
          key: `draft-${idx}`,
          designation,
          employeeId: pick?.employee_id ?? "",
          startDate: item.estimated_start_date || projectDates?.startDate || todayStr(),
          endDate: projectDates?.endDate || todayStr(),
          resourcingStatus: "BILLABLE",
          shiftType: "General",
          reviewerEmployeeId: "",
          allocationPct: item.allocation_pct || 100,
          source: "budget",
        });
      });

      return additions.length > 0 ? [...prevDrafts, ...additions] : prevDrafts;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCode, budget.data, roster.data, topCandidatesLoading]);

  // Any real person the SOW explicitly named for a role (Step 4 extraction),
  // resolved to a real employee_id, gets its own draft row tagged source:
  // "sow" -- distinct from the generic "top candidate by availability"
  // suggestions above, since the SOW itself already decided who fills this
  // seat. Skipped if that person is already on the real roster or already has
  // a draft (any source) for this project, so it never duplicates a row.
  useEffect(() => {
    const namedPeople = sowComparison.data?.named_people;
    // Real bug this guards against: this effect only ever ADDS a draft, never
    // corrects one already added -- if it ran once before the employee list
    // finished loading, jobNameById below would be empty, so a role whose SOW
    // text doesn't match this person's own real title (e.g. "Snr. Oversight"
    // for someone whose real title is "Principal") would permanently lock in
    // the literal SOW text as the designation instead of a real one.
    if (!projectCode || !namedPeople?.length || employees.isLoading) return;

    setDrafts((prevDrafts) => {
      const realEmployeeIds = new Set((roster.data?.roster ?? []).map((r) => r.employee_id));
      const draftEmployeeIds = new Set(prevDrafts.map((d) => d.employeeId).filter(Boolean));
      const jobNameById = new Map((employees.data ?? []).map((e) => [e.employee_id, e.job_name]));

      const additions: DraftRow[] = [];
      namedPeople.forEach((p, idx) => {
        const empId = p.resolved_employee_id;
        if (!empId || realEmployeeIds.has(empId) || draftEmployeeIds.has(empId)) return;
        draftEmployeeIds.add(empId);
        // Prefer the SOW's own role text when it's a real designation; otherwise
        // fall back to this employee's real current job title rather than
        // guessing -- either way the row starts on a real, valid designation.
        const designation = (p.matches_real_designation && p.role_text) || jobNameById.get(empId) || p.role_text;
        // The SOW text itself never states a percentage for this role (checked
        // directly against the real document) -- but an "oversight"-type role
        // (e.g. bi-weekly ExCo / weekly SteerCo attendance, not day-to-day
        // delivery work) is real-world light-touch, not full-time, so it
        // defaults lower than a normal delivery role rather than assuming 100%.
        const allocationPct = /oversight/i.test(p.role_text) ? 25 : 100;
        additions.push({
          key: `sow-draft-${idx}`,
          designation,
          employeeId: empId,
          startDate: projectDates?.startDate || todayStr(),
          endDate: projectDates?.endDate || todayStr(),
          resourcingStatus: "BILLABLE",
          shiftType: "General",
          reviewerEmployeeId: "",
          allocationPct,
          source: "sow",
        });
      });

      return additions.length > 0 ? [...prevDrafts, ...additions] : prevDrafts;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCode, sowComparison.data, roster.data, employees.data, employees.isLoading]);

  // When a project's end date is extended (see ProjectWizard's confirm modal),
  // carry every currently-active real allocation forward into the new period --
  // pre-filled, fully editable, using the same draft mechanism as budget
  // suggestions above. Runs once per `cloneSignal` (cleared via onCloneApplied
  // right after), and keys are stable per allocation_id so a stray re-fire
  // before the signal clears can't duplicate rows.
  useEffect(() => {
    if (!cloneSignal || roster.isLoading) return;
    const activeRows = (roster.data?.roster ?? []).filter((r) => r.is_allocation_active);
    setDrafts((prevDrafts) => {
      const existingKeys = new Set(prevDrafts.map((d) => d.key));
      const additions: DraftRow[] = activeRows
        .filter((r) => !existingKeys.has(`cloned-${r.allocation_id}`))
        .map((r) => ({
          key: `cloned-${r.allocation_id}`,
          designation: r.job_name ?? "",
          employeeId: r.employee_id,
          startDate: r.allocated_end_date ? addDaysToDateStr(r.allocated_end_date, 1) : cloneSignal.oldEndDate,
          endDate: cloneSignal.newEndDate,
          resourcingStatus: r.resourcing_status,
          shiftType: r.shift_type ?? "General",
          reviewerEmployeeId: r.reviewer_employee_id ?? "",
          allocationPct: r.allocation_by_percentage,
          source: "cloned",
        }));
      return additions.length > 0 ? [...prevDrafts, ...additions] : prevDrafts;
    });
    onCloneApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloneSignal, roster.data, roster.isLoading]);

  function updateDraft(key: string, patch: Partial<DraftRow>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  const [adding, setAdding] = useState(false);
  const [activeRoleRowIndex, setActiveRoleRowIndex] = useState<number | null>(deal?.roles[0]?.row_index ?? null);
  const [manualSkillsetText, setManualSkillsetText] = useState("");
  const [manualQuery, setManualQuery] = useState<string | null>(null);

  const [includeParams, setIncludeParams] = useState(DEFAULT_INCLUDE_PARAMS);
  const [includeBelowCapacity, setIncludeBelowCapacity] = useState(false);
  const [nearCapacityTolerancePct, setNearCapacityTolerancePct] = useState(25);
  const [includeResumeLinkedin, setIncludeResumeLinkedin] = useState(true);

  const manualSearch = useQuery({
    queryKey: ["recommendations-search", manualQuery, projectDates?.startDate],
    queryFn: () => api.recommendationsSearch(manualQuery as string, projectDates?.startDate ?? todayStr()),
    enabled: manualQuery != null,
  });

  const rows = roster.data?.roster ?? [];
  const employeeOptions = (employees.data ?? []).map((e) => ({
    value: e.employee_id,
    label: e.employee_full_name ? `${e.employee_id} - ${e.employee_full_name} (${e.job_name})` : `${e.employee_id} (${e.job_name})`,
  }));

  function refreshRoster() {
    qc.invalidateQueries({ queryKey: ["roster", projectCode] });
  }

  return (
    <div className="space-y-4">
      {!projectCode && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800/60">
          No project created yet — you can browse candidates below, but assigning someone needs a project from Step 1.
        </p>
      )}
      <div>
        <p className="text-sm font-semibold text-gray-800 mb-2 dark:text-gray-200">
          Resource Allocations ({rows.length}{drafts.length > 0 && ` + ${drafts.length} draft${drafts.length > 1 ? "s" : ""}`})
        </p>
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <colgroup>
                <col className="min-w-[240px]" />
                <col className="w-[130px]" />
                <col className="w-[130px]" />
                <col className="min-w-[110px]" />
                <col className="min-w-[110px]" />
                <col className="min-w-[160px]" />
                <col className="w-[90px]" />
                <col className="w-[70px]" />
              </colgroup>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 dark:bg-gray-800/60 dark:border-gray-700">
                  {["Name (Designation)", "Start Date", "End Date", "Status", "Shift Type", "Reviewer", "Allocation %", ""].map((h) => (
                    <th key={h} className="text-left font-semibold text-gray-500 px-2.5 py-2 whitespace-nowrap dark:text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RealAllocationRow key={r.allocation_id} row={r} employeeOptions={employeeOptions} onSaved={refreshRoster} />
                ))}
                {drafts.map((d) => (
                  <tr key={d.key} className="border-b border-gray-50 last:border-0 bg-[hsl(var(--primary)/0.04)] dark:border-gray-800">
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {d.source === "cloned" ? (
                          <span title="Cloned from a prior allocation -- continuing into the extended project period" className="flex-shrink-0 inline-flex">
                            <RefreshCw size={13} className="text-blue-500 dark:text-blue-400" />
                          </span>
                        ) : d.source === "sow" ? (
                          <span
                            title="Named for this role in the uploaded SOW"
                            className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                          >
                            SOW
                          </span>
                        ) : (
                          <span title="Suggested from Budget" className="flex-shrink-0 inline-flex">
                            <Sparkles size={13} className="text-amber-500 dark:text-amber-400" />
                          </span>
                        )}
                        <SearchableSelect
                          size="sm"
                          className="flex-1"
                          options={optionsForDesignation(d.designation, d.employeeId || undefined)}
                          value={d.employeeId ? [d.employeeId] : []}
                          onChange={(v) => updateDraft(d.key, { employeeId: v[0] ?? "" })}
                          placeholder={`Select ${d.designation}`}
                        />
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="date" className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs outline-none dark:border-gray-600 dark:bg-gray-900" value={d.startDate} onChange={(e) => updateDraft(d.key, { startDate: e.target.value })} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="date" className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs outline-none dark:border-gray-600 dark:bg-gray-900" value={d.endDate} onChange={(e) => updateDraft(d.key, { endDate: e.target.value })} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <SearchableSelect size="sm" options={RESOURCING_STATUSES.map((s) => ({ value: s, label: s }))} value={[d.resourcingStatus]} onChange={(v) => updateDraft(d.key, { resourcingStatus: v[0] ?? "BILLABLE" })} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <SearchableSelect size="sm" options={SHIFT_TYPES.map((s) => ({ value: s, label: s }))} value={[d.shiftType]} onChange={(v) => updateDraft(d.key, { shiftType: v[0] ?? "General" })} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <SearchableSelect size="sm" options={employeeOptions} value={d.reviewerEmployeeId ? [d.reviewerEmployeeId] : []} onChange={(v) => updateDraft(d.key, { reviewerEmployeeId: v[0] ?? "" })} placeholder="Select Employee" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input
                        type="number" min={0} max={100}
                        className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs outline-none dark:border-gray-600 dark:bg-gray-900"
                        value={d.allocationPct}
                        onChange={(e) => updateDraft(d.key, { allocationPct: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <DraftRowActions
                        row={d}
                        projectCode={projectCode}
                        onAssigned={() => { removeDraft(d.key); refreshRoster(); }}
                        onDismiss={() => removeDraft(d.key)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && drafts.length === 0 && (
            <p className="text-xs text-gray-400 italic text-center py-6 dark:text-gray-500">
              No resources allocated to this project yet{projectCode ? " -- add roles in Budget Creation to get suggestions here." : "."}
            </p>
          )}
        </div>
      </div>

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-white px-3.5 py-2 rounded-lg"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          <Plus size={13} /> Add Resource
        </button>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Find a candidate</p>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">Close</button>
          </div>

          {deal && deal.roles.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {deal.roles.map((r) => (
                  <button
                    key={r.row_index}
                    onClick={() => { setActiveRoleRowIndex(r.row_index); setManualQuery(null); }}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      activeRoleRowIndex === r.row_index ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700"
                    }`}
                    style={activeRoleRowIndex === r.row_index ? { backgroundColor: "hsl(var(--primary))" } : undefined}
                  >
                    {r.resources_requested ?? `Role ${r.row_index}`}
                  </button>
                ))}
              </div>
              {activeRoleRowIndex != null && (
                <RoleRecommendationDetail
                  key={activeRoleRowIndex}
                  rowIndex={activeRoleRowIndex}
                  includeParams={includeParams}
                  setIncludeParams={setIncludeParams}
                  includeBelowCapacity={includeBelowCapacity}
                  setIncludeBelowCapacity={setIncludeBelowCapacity}
                  nearCapacityTolerancePct={nearCapacityTolerancePct}
                  setNearCapacityTolerancePct={setNearCapacityTolerancePct}
                  includeResumeLinkedin={includeResumeLinkedin}
                  setIncludeResumeLinkedin={setIncludeResumeLinkedin}
                  onOpenProfile={onOpenProfile}
                  onSelectSibling={setActiveRoleRowIndex}
                  projectCode={projectCode}
                  projectDates={projectDates}
                />
              )}
            </>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-gray-400 block mb-0.5 dark:text-gray-500">What role/skillset are you filling?</label>
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none dark:border-gray-600 dark:bg-gray-900"
                    value={manualSkillsetText}
                    onChange={(e) => setManualSkillsetText(e.target.value)}
                    placeholder="e.g. Senior Software Engineer, SQL, Python, Databricks"
                  />
                </div>
                <button
                  onClick={() => setManualQuery(manualSkillsetText)}
                  disabled={!manualSkillsetText.trim()}
                  className="text-xs px-3.5 py-2 rounded-lg text-white font-medium disabled:opacity-50"
                  style={{ backgroundColor: "hsl(var(--primary))" }}
                >
                  Search
                </button>
              </div>
              {manualSearch.data && (
                <div className="space-y-1.5">
                  {manualSearch.data.candidates.map((c, i) => (
                    <div key={c.employee_id} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-800">
                      <button onClick={() => onOpenProfile(c.employee_id, "overview")} className="text-left hover:underline">
                        {i + 1}. {c.employee_id}{c.employee_full_name && ` - ${c.employee_full_name}`} — {c.job_name} ({(c.skill_score * 100).toFixed(0)}% skill match)
                      </button>
                      <AssignInlineButton projectCode={projectCode} projectDates={projectDates} employeeId={c.employee_id} onDone={refreshRoster} />
                    </div>
                  ))}
                  {manualSearch.data.candidates.length === 0 && <p className="text-xs text-gray-400 italic dark:text-gray-500">No candidates found.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// A real, already-committed allocation -- editable in place (dates, status,
// shift, reviewer, allocation %) rather than frozen the moment it's saved.
// Employee identity itself isn't editable here (re-assigning a committed row
// to a different person is a new allocation, not an edit); Save only enables
// once something actually differs from the row's real saved values.
function RealAllocationRow({
  row,
  employeeOptions,
  onSaved,
}: {
  row: RosterEntry;
  employeeOptions: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const [startDate, setStartDate] = useState(row.allocated_start_date ?? "");
  const [endDate, setEndDate] = useState(row.allocated_end_date ?? "");
  const [status, setStatus] = useState(row.resourcing_status);
  const [shiftType, setShiftType] = useState(row.shift_type ?? "General");
  const [reviewerEmployeeId, setReviewerEmployeeId] = useState(row.reviewer_employee_id ?? "");
  const [allocationPct, setAllocationPct] = useState(row.allocation_by_percentage);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    startDate !== (row.allocated_start_date ?? "") ||
    endDate !== (row.allocated_end_date ?? "") ||
    status !== row.resourcing_status ||
    shiftType !== (row.shift_type ?? "General") ||
    reviewerEmployeeId !== (row.reviewer_employee_id ?? "") ||
    allocationPct !== row.allocation_by_percentage;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateAllocation(row.allocation_id, {
        allocationPct, startDate, endDate, resourcingStatus: status,
        shiftType, reviewerEmployeeId: reviewerEmployeeId || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${row.employee_id}'s allocation entirely? This can't be undone.`)) return;
    setRemoving(true);
    setError(null);
    try {
      await api.deleteAllocation(row.allocation_id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this allocation.");
      setRemoving(false);
    }
  }

  return (
    <tr className="border-b border-gray-50 last:border-0 dark:border-gray-800">
      <td className="px-2.5 py-1.5 font-medium text-gray-700 whitespace-nowrap dark:text-gray-300">
        {row.employee_id}{row.employee_full_name && ` - ${row.employee_full_name}`}{" "}
        {row.job_name && <span className="text-gray-400 font-normal dark:text-gray-500">({row.job_name})</span>}
      </td>
      <td className="px-2.5 py-1.5">
        <input type="date" className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs outline-none dark:border-gray-600 dark:bg-gray-900" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </td>
      <td className="px-2.5 py-1.5">
        <input type="date" className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs outline-none dark:border-gray-600 dark:bg-gray-900" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </td>
      <td className="px-2.5 py-1.5">
        <SearchableSelect size="sm" options={RESOURCING_STATUSES.map((s) => ({ value: s, label: s }))} value={[status]} onChange={(v) => setStatus(v[0] ?? status)} />
      </td>
      <td className="px-2.5 py-1.5">
        <SearchableSelect size="sm" options={SHIFT_TYPES.map((s) => ({ value: s, label: s }))} value={[shiftType]} onChange={(v) => setShiftType(v[0] ?? "General")} />
      </td>
      <td className="px-2.5 py-1.5">
        <SearchableSelect
          size="sm"
          options={employeeOptions}
          value={reviewerEmployeeId ? [reviewerEmployeeId] : []}
          onChange={(v) => setReviewerEmployeeId(v[0] ?? "")}
          placeholder="Select Employee"
        />
      </td>
      <td className="px-2.5 py-1.5">
        <input
          type="number" min={0} max={100}
          className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs outline-none dark:border-gray-600 dark:bg-gray-900"
          value={allocationPct}
          onChange={(e) => setAllocationPct(Number(e.target.value) || 0)}
        />
      </td>
      <td className="px-2.5 py-1.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {error && <span className="text-red-500 dark:text-red-400" title={error}>!</span>}
          <button
            onClick={save}
            disabled={!dirty || saving || removing}
            title={dirty ? "Save changes" : "No changes to save"}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:bg-gray-50 disabled:text-gray-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/40 dark:disabled:bg-gray-800/60 dark:disabled:text-gray-600"
          >
            <Check size={13} />
          </button>
          <button
            onClick={remove}
            disabled={saving || removing}
            title="Remove this allocation"
            className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:bg-gray-800/60 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 disabled:opacity-50"
          >
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// A draft row is already fully specified inline (employee, dates, status,
// shift, reviewer, allocation %) -- clicking Assign commits those exact
// values directly rather than reopening AssignModal to re-enter them, but
// still runs the same over-allocation pre-check as every other assign path.
function DraftRowActions({
  row, projectCode, onAssigned, onDismiss,
}: {
  row: DraftRow; projectCode: string | null; onAssigned: () => void; onDismiss: () => void;
}) {
  const qc = useQueryClient();
  const allocations = useQuery({ queryKey: ["allocations"], queryFn: api.allocations });
  const [warningRows, setWarningRows] = useState<AllocationRow[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doAssign() {
    if (!projectCode) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.assignAllocation({
        employeeId: row.employeeId, projectId: projectCode,
        allocationPct: row.allocationPct, startDate: row.startDate, endDate: row.endDate,
        resourcingStatus: row.resourcingStatus, shiftType: row.shiftType,
        reviewerEmployeeId: row.reviewerEmployeeId || null,
      });
      // This bypasses AssignModal (the row is already fully specified inline),
      // so it needs the same broad refresh AssignModal's own submit() does --
      // this employee's allocations, this project's roster, and every open
      // candidate/recommendation list whose availability just changed.
      qc.invalidateQueries({ queryKey: ["allocations"] });
      qc.invalidateQueries({ queryKey: ["roster", projectCode] });
      qc.invalidateQueries({ queryKey: ["recommendation"] });
      onAssigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign this employee.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClick() {
    if (!row.employeeId) return;
    const empRows = (allocations.data ?? []).filter((a) => a.employee_id === row.employeeId);
    if (empRows.some((a) => a.utilization_band === "over_allocated")) {
      setWarningRows(empRows);
      return;
    }
    doAssign();
  }

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-red-500 dark:text-red-400" title={error}>!</span>}
      <button
        onClick={handleClick}
        disabled={!projectCode || !row.employeeId || submitting}
        title="Assign"
        className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:bg-gray-50 disabled:text-gray-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/40 dark:disabled:bg-gray-800/60 dark:disabled:text-gray-600"
      >
        <Check size={13} />
      </button>
      <button onClick={onDismiss} title="Dismiss" className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:bg-gray-800/60 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400">
        <X size={13} />
      </button>
      {warningRows && (
        <OverAllocationWarningModal
          employeeId={row.employeeId}
          rows={warningRows}
          onCancel={() => setWarningRows(null)}
          onOverride={() => { setWarningRows(null); doAssign(); }}
        />
      )}
    </div>
  );
}

function AssignInlineButton({
  projectCode, projectDates, employeeId, onDone,
}: {
  projectCode: string | null; projectDates: { startDate: string; endDate: string } | null; employeeId: string; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!projectCode) {
    return (
      <span className="text-gray-300 font-medium cursor-not-allowed dark:text-gray-600" title="Create the project in Step 1 first">
        Assign
      </span>
    );
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-[hsl(var(--primary))] font-medium hover:underline">Assign</button>
      {open && (
        <AssignWithOverAllocationCheck
          employeeId={employeeId} projectId={projectCode}
          defaultStartDate={projectDates?.startDate} defaultEndDate={projectDates?.endDate}
          onClose={() => setOpen(false)}
          onAssigned={() => { setOpen(false); onDone(); }}
        />
      )}
    </>
  );
}
