"use client";

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  CheckCircle2, ChevronDown, ChevronUp, Sparkles, XCircle,
  RefreshCw, AlertTriangle, Clock, Zap, Users, MessageSquare, Star,
  UploadCloud, Loader2, AlertCircle, Linkedin, X,
} from "lucide-react";
import {
  api,
  DEFAULT_INCLUDE_PARAMS,
  type AllocationRow, type EmployeeAllocationRow, type EmployeeProfile,
  type BackfillResult, type RecommendationCandidate, type FallbackCandidates,
  type IncludeParams, type RedeployMatch, type EmployeeFeedbackEntry,
  type EmployeeTimesheetRow,
  type WeeklyPulseWeek,
  type PerformanceCycleSummary, type PerformanceCycleDetail, type PerformanceStage,
  type PerformanceAiSummary,
  type DocumentImportRecord,
} from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { Badge } from "@/components/shared/Badge";
import { ErrorState } from "@/components/shared/EmptyState";
import { ModalBodySkeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { TableControls } from "@/components/shared/TableControls";
import { AdvancedFiltersButton, AdvancedFiltersPanel } from "@/components/shared/AdvancedFilters";
import { FiredBadge } from "@/components/shared/FiredBadge";
import { HoldDot, HoldChip } from "@/components/shared/HoldFlag";
import { TimesheetProofModal } from "@/components/shared/TimesheetProofModal";
import { AssignModal } from "@/components/shared/AssignModal";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { AllocationTimeline } from "@/components/shared/AllocationTimeline";
import { cn } from "@/lib/utils";

export type ProfileTab =
  | "overview"
  | "allocations"
  | "overtime"
  | "skills"
  | "competency"
  | "leave"
  | "feedback"
  | "timesheet"
  | "redeploy_matches"
  | "replacement";

export interface SkillMatchContext {
  matchedSkills: string[];
  missingSkills: string[];
}

interface ReplacementContext {
  projectId: string;
  allocPct: number;
}

interface EmployeeProfileModalProps {
  employeeId: string;
  initialTab: ProfileTab;
  onClose: () => void;
  skillMatchContext?: SkillMatchContext;
  showRedeployMatches?: boolean;
}

const BASE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "allocations", label: "Allocations" },
  { key: "overtime", label: "Overtime & Effort" },
  { key: "skills", label: "Skills" },
  { key: "competency", label: "Competency" },
  { key: "leave", label: "Leave" },
  { key: "feedback", label: "Feedback" },
  { key: "timesheet", label: "Timesheet" },
];

export function EmployeeProfileModal({
  employeeId, initialTab, onClose, skillMatchContext, showRedeployMatches,
}: EmployeeProfileModalProps) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [replacementCtx, setReplacementCtx] = useState<ReplacementContext | null>(null);
  const [openProjectCode, setOpenProjectCode] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: ["employee-profile", employeeId],
    queryFn: () => api.employeeProfile(employeeId),
  });

  function handleFindReplacement(ctx: ReplacementContext | null) {
    setReplacementCtx(ctx);
    if (ctx) setTab("replacement");
    else if (tab === "replacement") setTab("allocations");
  }

  const tabs = [
    ...BASE_TABS,
    ...(showRedeployMatches ? [{ key: "redeploy_matches" as const, label: "Redeploy Matches" }] : []),
    ...(replacementCtx ? [{ key: "replacement" as const, label: `Replace · ${replacementCtx.projectId}` }] : []),
  ];

  return (
    <Modal
      title={
        profile.data ? (
          <span className="inline-flex items-center gap-1.5">
            {employeeId}
            {profile.data.employee_full_name && <> — {profile.data.employee_full_name}</>}
            {" "}({profile.data.job_name ?? "Employee"})
            <HoldDot onHold={profile.data.signals.on_hold} holdProjects={profile.data.signals.hold_projects} />
          </span>
        ) : (
          employeeId
        )
      }
      onClose={onClose}
      widthClassName="max-w-7xl"
    >
      <div className="flex border-b border-gray-100 dark:border-gray-800 px-5 sticky top-0 bg-white dark:bg-gray-900 z-10 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition whitespace-nowrap flex items-center gap-1",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            )}
          >
            {t.key === "redeploy_matches" && <Sparkles className="w-3 h-3" />}
            {t.key === "replacement" && <RefreshCw className="w-3 h-3" />}
            {t.key === "feedback" && <MessageSquare className="w-3 h-3" />}
            {t.key === "timesheet" && <Clock className="w-3 h-3" />}
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {profile.isLoading ? (
          <ModalBodySkeleton />
        ) : profile.error ? (
          <ErrorState message="Could not load this employee's profile." />
        ) : profile.data ? (
          <>
            {tab === "overview" && <OverviewTab profile={profile.data} onOpenProject={setOpenProjectCode} />}
            {tab === "allocations" && (
              <AllocationsTab
                profile={profile.data}
                onFindReplacement={handleFindReplacement}
                activeReplacementProjectId={replacementCtx?.projectId ?? null}
                onOpenProject={setOpenProjectCode}
              />
            )}
            {tab === "overtime" && <OvertimeTab profile={profile.data} />}
            {tab === "skills" && <SkillsTab employeeId={employeeId} profile={profile.data} matchContext={skillMatchContext} />}
            {tab === "competency" && <CompetencyTab profile={profile.data} />}
            {tab === "leave" && <LeaveTab profile={profile.data} />}
            {tab === "feedback" && <FeedbackTab employeeId={employeeId} />}
            {tab === "timesheet" && <TimesheetTab employeeId={employeeId} />}
            {tab === "redeploy_matches" && <RedeployMatchesTab employeeId={employeeId} />}
            {tab === "replacement" && replacementCtx && (
              <ReplacementTab
                employeeId={employeeId}
                projectId={replacementCtx.projectId}
                allocPct={replacementCtx.allocPct}
                onClose={() => handleFindReplacement(null)}
              />
            )}
          </>
        ) : null}
      </div>
      {openProjectCode && (
        <ProjectHealthDetailModal projectCode={openProjectCode} onClose={() => setOpenProjectCode(null)} />
      )}
    </Modal>
  );
}

// ── Replacement Tab ────────────────────────────────────────────────────────────

type ReplacementSort = "composite_desc" | "skill_desc" | "available_desc" | "competency_desc";

function ReplacementTab({
  employeeId, projectId, allocPct, onClose,
}: {
  employeeId: string;
  projectId: string;
  allocPct: number;
  onClose: () => void;
}) {
  const [bucketFilter, setBucketFilter] = useState<string[]>([]);
  const [coeFilter, setCoeFilter] = useState<string[]>([]);
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<ReplacementSort>("composite_desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bestFitOpen, setBestFitOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [openProfile, setOpenProfile] = useState<string | null>(null);
  // Same ranking-parameter flexibility as the main Resourcing engine.
  const [includeParams, setIncludeParams] = useState<IncludeParams>(DEFAULT_INCLUDE_PARAMS);
  const [includeBelowCapacity, setIncludeBelowCapacity] = useState(false);
  const [nearCapacityTolerancePct, setNearCapacityTolerancePct] = useState(25);
  const [includeResumeLinkedin, setIncludeResumeLinkedin] = useState(true);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<BackfillResult>({
    queryKey: ["backfill", employeeId, projectId, includeParams, includeBelowCapacity, nearCapacityTolerancePct, includeResumeLinkedin],
    queryFn: () => api.backfillCandidates(employeeId, projectId, 15, includeParams, includeBelowCapacity, nearCapacityTolerancePct, includeResumeLinkedin),
  });
  const [assignEmployeeId, setAssignEmployeeId] = useState<string | null>(null);
  const handleAssigned = () => {
    queryClient.invalidateQueries({ queryKey: ["backfill", employeeId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["allocations"] });
  };

  const allCandidates = data?.candidates ?? [];

  let candidates = allCandidates;
  if (bucketFilter.length > 0) candidates = candidates.filter((c) => bucketFilter.includes(c.bucket));
  if (coeFilter.length > 0) candidates = candidates.filter((c) => c.coe != null && coeFilter.includes(c.coe));
  if (roleFilter.length > 0) candidates = candidates.filter((c) => c.job_name != null && roleFilter.includes(c.job_name));
  candidates = [...candidates];
  switch (sort) {
    case "composite_desc": candidates.sort((a, b) => b.composite_score - a.composite_score); break;
    case "skill_desc":     candidates.sort((a, b) => b.skill_score - a.skill_score); break;
    case "available_desc": candidates.sort((a, b) => b.available_pct - a.available_pct); break;
    case "competency_desc":candidates.sort((a, b) => b.competency_score - a.competency_score); break;
  }

  const coeOptions   = Array.from(new Set(allCandidates.map((c) => c.coe).filter((v): v is string => Boolean(v)))).sort();
  const roleOptions  = Array.from(new Set(allCandidates.map((c) => c.job_name).filter((v): v is string => Boolean(v)))).sort();

  const bestFit      = data?.best_fit_if_delayed ?? [];
  const fallback     = data?.fallback_candidates;
  const fallbackCount = (fallback?.same_grade?.length ?? 0) + (fallback?.adjacent_level?.length ?? 0);
  const ctx          = data?.backfill_context;
  const isTopPick    = bucketFilter.length === 0 && sort === "composite_desc";

  if (isLoading) return <div className="space-y-3"><TableSkeleton columns={7} rows={5} /></div>;
  if (isError)   return <ErrorState message="Could not load replacement candidates." />;

  return (
    <div className="space-y-4">
      {/* Context header */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">
              Replacing {employeeId} on {projectId}
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              {allocPct}% allocation vacated
              {ctx?.pulled_employee_job && ` · ${ctx.pulled_employee_job}`}
              {ctx?.pulled_employee_coe && ` · ${ctx.pulled_employee_coe} CoE`}
            </p>
            {ctx?.skill_basis && ctx.skill_basis.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {ctx.skill_basis.slice(0, 6).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-400">
                    {s}
                  </span>
                ))}
                {ctx.skill_basis.length > 6 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400">
                    +{ctx.skill_basis.length - 6} more
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-amber-400 dark:text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 transition text-[11px] px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/60 hover:border-amber-400 dark:hover:border-amber-600 whitespace-nowrap"
          >
            ✕ Clear
          </button>
        </div>
      </div>

      {/* Hire signal banner */}
      {data?.hire_vs_redeploy_flag && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-400 font-medium">
            No strong internal match — this role may require an external hire or significant training.
          </p>
        </div>
      )}

      {data?.error && <p className="text-xs text-red-500 dark:text-red-400">{data.error}</p>}

      {!data?.error && (
        <>
          {/* Filter + sort bar */}
          <div className="flex items-center justify-end">
            <AdvancedFiltersButton
              open={advancedFiltersOpen}
              include={includeParams}
              defaults={DEFAULT_INCLUDE_PARAMS}
              includeBelowCapacity={includeBelowCapacity}
              includeResumeLinkedin={includeResumeLinkedin}
              onClick={() => setAdvancedFiltersOpen((v) => !v)}
            />
          </div>
          {advancedFiltersOpen && (
            <AdvancedFiltersPanel
              include={includeParams}
              onApply={setIncludeParams}
              includeBelowCapacity={includeBelowCapacity}
              onApplyBelowCapacity={setIncludeBelowCapacity}
              nearCapacityTolerancePct={nearCapacityTolerancePct}
              onApplyNearCapacityTolerancePct={setNearCapacityTolerancePct}
              includeResumeLinkedin={includeResumeLinkedin}
              onApplyIncludeResumeLinkedin={setIncludeResumeLinkedin}
            />
          )}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <SearchableSelect
              options={[
                { value: "eligible", label: "Eligible — ready now" },
                { value: "trainable", label: "Trainable — some gap" },
                { value: "gap", label: "Gap — significant training" },
              ]}
              value={bucketFilter}
              onChange={setBucketFilter}
              multi
              placeholder="All tiers"
              size="sm"
              className="w-40"
            />
            <SearchableSelect
              options={coeOptions.map((c) => ({ value: c, label: c }))}
              value={coeFilter}
              onChange={setCoeFilter}
              multi
              placeholder="All CoEs"
              size="sm"
              className="w-40"
            />
            <SearchableSelect
              options={roleOptions.map((r) => ({ value: r, label: r }))}
              value={roleFilter}
              onChange={setRoleFilter}
              multi
              placeholder="All roles"
              size="sm"
              className="w-44"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ReplacementSort)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 ml-auto"
            >
              <option value="composite_desc">Best overall fit ↓</option>
              <option value="skill_desc">Skill match ↓</option>
              <option value="available_desc">Availability ↓</option>
              <option value="competency_desc">Competency ↓</option>
            </select>
          </div>

          {/* Candidate table */}
          {candidates.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">
              {allCandidates.length === 0
                ? "No internal replacement candidates found — consider hiring or cross-training."
                : "No candidates match the current filters."}
            </p>
          ) : (
            <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                      {["#", "Employee", "Role", "CoE", "Tier", "Skill", "Competency", "Available", "Flags", ""].map((h) => (
                        <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c, i) => {
                      const isExpanded = expandedId === c.employee_id;
                      const isTop = isTopPick && i === 0;
                      return (
                        <React.Fragment key={c.employee_id}>
                          <tr
                            className={cn(
                              "border-b border-gray-50 dark:border-gray-800/60 cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-800/60 transition",
                              isTop && "border-l-2 border-l-emerald-400 dark:border-l-emerald-500",
                              isExpanded && "bg-gray-50/80 dark:bg-gray-800/80"
                            )}
                            onClick={() => setExpandedId(isExpanded ? null : c.employee_id)}
                          >
                            <td className="px-2.5 py-1.5">
                              <div className="flex items-center gap-1">
                                <span className={cn("font-bold", isTop ? "text-emerald-600 dark:text-emerald-400" : "text-gray-300 dark:text-gray-600")}>{i + 1}</span>
                                {isTop && (
                                  <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-1 py-0.5 rounded-full">
                                    Top pick
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <button
                                onClick={(e) => { e.stopPropagation(); setOpenProfile(c.employee_id); }}
                                className="text-primary hover:underline font-medium"
                              >
                                {c.employee_id}
                              </button>
                            </td>
                            <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap max-w-[120px] truncate" title={c.job_name ?? ""}>
                              {c.job_name ?? "-"}
                            </td>
                            <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{c.coe ?? "-"}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <Badge variant={c.bucket}>{c.bucket}</Badge>
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <span className={cn(
                                "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                c.bucket === "eligible" ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400" :
                                c.bucket === "trainable" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                              )}>
                                {Math.round(c.skill_score * 100)}%
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                              {Math.round(c.competency_score * 100)}%
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <span className={cn(
                                "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                c.available_pct >= 80 ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400" :
                                c.available_pct >= 40 ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" : "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400"
                              )}>
                                {c.available_pct}%
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                {c.on_leave_now && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 text-orange-700 dark:text-orange-400">
                                    <Clock className="w-2.5 h-2.5" />On leave
                                  </span>
                                )}
                                {c.in_free_pool && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-400">
                                    <Zap className="w-2.5 h-2.5" />Free pool
                                  </span>
                                )}
                                <HoldChip onHold={c.on_hold} holdProjects={c.hold_projects} />
                              </div>
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setAssignEmployeeId(c.employee_id); }}
                                  className="text-[11px] px-2 py-1 rounded-lg bg-primary text-white hover:opacity-90 whitespace-nowrap"
                                >
                                  Assign
                                </button>
                                {isExpanded
                                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                                  : <ChevronDown className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/40">
                              <td colSpan={10} className="px-5 py-2.5 border-l-2 border-l-gray-100">
                                <CandidateDetail candidate={c} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Best Fit If Delayed */}
          {bestFit.length > 0 && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800/60 overflow-hidden">
              <button
                onClick={() => setBestFitOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition text-xs font-semibold text-blue-700 dark:text-blue-400"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  Best fit if start is delayed ({bestFit.length})
                </div>
                {bestFitOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {bestFitOpen && (
                <div className="p-3 bg-blue-50/30 dark:bg-blue-950/30 space-y-2">
                  <p className="text-[11px] text-blue-500 dark:text-blue-400">
                    Currently busy but freeing up soon — consider these if the backfill start can wait.
                  </p>
                  <CandidateMiniList candidates={bestFit} onOpenProfile={setOpenProfile} />
                </div>
              )}
            </div>
          )}

          {/* Fallback Cascade */}
          {fallback && fallbackCount > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 overflow-hidden">
              <button
                onClick={() => setFallbackOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition text-xs font-semibold text-amber-700 dark:text-amber-400"
              >
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" />
                  Fallback cascade — same grade & adjacent level ({fallbackCount})
                </div>
                {fallbackOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {fallbackOpen && (
                <div className="p-3 bg-amber-50/30 dark:bg-amber-950/30 space-y-3">
                  {(fallback.same_grade ?? []).length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1.5">
                        Same grade ({fallback.same_grade.length})
                      </p>
                      <CandidateMiniList candidates={fallback.same_grade} onOpenProfile={setOpenProfile} />
                    </div>
                  )}
                  {(fallback.adjacent_level ?? []).length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1.5">
                        Adjacent level ({fallback.adjacent_level.length})
                      </p>
                      <CandidateMiniList candidates={fallback.adjacent_level} onOpenProfile={setOpenProfile} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {openProfile && (
        <EmployeeProfileModal
          employeeId={openProfile}
          initialTab="overview"
          onClose={() => setOpenProfile(null)}
        />
      )}

      {assignEmployeeId && (
        <AssignModal
          employeeId={assignEmployeeId}
          projectId={projectId}
          defaultAllocationPct={allocPct}
          defaultStartDate={data?.backfill_context?.vacated_start_date}
          defaultEndDate={data?.backfill_context?.vacated_end_date}
          onClose={() => setAssignEmployeeId(null)}
          onAssigned={handleAssigned}
        />
      )}
    </div>
  );
}

export function cleanSkillLabel(s: string): string {
  const cleaned = s.split("|")[0].replace(/\s*\(score [\d.]+\/\d+\)\s*$/i, "").trim();
  return cleaned.length > 42 ? cleaned.slice(0, 40) + "…" : cleaned;
}

const MATCH_SHOW = 5;
const MISS_SHOW  = 3;

export function SkillSection({
  labels,
  variant,
  showAll,
  onToggle,
}: {
  labels: string[];
  variant: "matched" | "missing";
  showAll: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  const cap      = variant === "matched" ? MATCH_SHOW : MISS_SHOW;
  const overflow = labels.length - cap;
  const chipCls  = variant === "matched"
    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400"
    : "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400";
  const label    = variant === "matched"
    ? <><CheckCircle2 className="w-3 h-3 text-emerald-500 dark:text-emerald-400" /> <span className="text-emerald-600 dark:text-emerald-400">Matched ({labels.length})</span></>
    : <><XCircle className="w-3 h-3 text-gray-300 dark:text-gray-600" /> <span className="text-gray-400 dark:text-gray-500">Missing ({labels.length})</span></>;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold flex items-center gap-1">{label}</p>

      {/* Primary row — always one tidy line */}
      <div className="flex items-center gap-1 flex-nowrap overflow-hidden">
        {labels.slice(0, cap).map((s, i) => (
          <span
            key={i}
            title={s}
            className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 ${chipCls}`}
          >
            {s}
          </span>
        ))}
        {overflow > 0 && !showAll && (
          <button
            onClick={onToggle}
            className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-primary hover:text-primary transition whitespace-nowrap flex-shrink-0"
          >
            +{overflow} more
          </button>
        )}
      </div>

      {/* Overflow box — appears below, neatly contained */}
      {showAll && overflow > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 shadow-sm">
          <div className="flex flex-wrap gap-1">
            {labels.slice(cap).map((s, i) => (
              <span key={i} title={s} className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${chipCls}`}>
                {s}
              </span>
            ))}
          </div>
          <button
            onClick={onToggle}
            className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline mt-1.5 block"
          >
            ↑ Show less
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateDetail({ candidate: c }: { candidate: RecommendationCandidate }) {
  const [showAllMatched, setShowAllMatched] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [showRationale, setShowRationale]   = useState(false);

  const matchedLabels = c.matched_skills.map(cleanSkillLabel).filter(Boolean);
  const missingLabels = c.missing_skills.map(cleanSkillLabel).filter(Boolean);

  return (
    <div className="space-y-2 py-0.5 text-[11px]">
      {/* Matched skills */}
      {matchedLabels.length > 0 && (
        <SkillSection
          labels={matchedLabels}
          variant="matched"
          showAll={showAllMatched}
          onToggle={(e) => { e.stopPropagation(); setShowAllMatched((v) => !v); }}
        />
      )}

      {/* Missing skills */}
      {missingLabels.length > 0 && (
        <SkillSection
          labels={missingLabels}
          variant="missing"
          showAll={showAllMissing}
          onToggle={(e) => { e.stopPropagation(); setShowAllMissing((v) => !v); }}
        />
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-[10px] pt-1.5 border-t border-gray-100 dark:border-gray-800">
        {c.earliest_available_date && (
          <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
            <Clock className="w-3 h-3" />
            Available from <span className="font-semibold">{c.earliest_available_date}</span>
          </span>
        )}
        {c.skill_confidence && (
          <span className="text-gray-400 dark:text-gray-500">Confidence: {c.skill_confidence}</span>
        )}
        {c.explanation && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowRationale((v) => !v); }}
            className="ml-auto text-gray-400 dark:text-gray-500 hover:text-primary transition text-[10px] underline"
          >
            {showRationale ? "Hide rationale" : "Why this match?"}
          </button>
        )}
      </div>

      {showRationale && c.explanation && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
          {c.explanation}
        </p>
      )}
    </div>
  );
}

function CandidateMiniList({
  candidates, onOpenProfile,
}: {
  candidates: RecommendationCandidate[];
  onOpenProfile: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800">
              {["Employee", "Role", "Tier", "Skill", "Available", "Flags", "Earliest avail."].map((h) => (
                <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.employee_id} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <button onClick={() => onOpenProfile(c.employee_id)} className="text-primary hover:underline font-medium">
                    {c.employee_id}
                  </button>
                </td>
                <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.job_name ?? "-"}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap"><Badge variant={c.bucket}>{c.bucket}</Badge></td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    c.bucket === "eligible" ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400" :
                    c.bucket === "trainable" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                  )}>
                    {Math.round(c.skill_score * 100)}%
                  </span>
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    c.available_pct >= 80 ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400" :
                    c.available_pct >= 40 ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" : "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400"
                  )}>
                    {c.available_pct}%
                  </span>
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <div className="flex items-center gap-1 flex-nowrap">
                    {c.on_leave_now && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 text-orange-700 dark:text-orange-400 whitespace-nowrap">On leave</span>
                    )}
                    {c.in_free_pool && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-400 whitespace-nowrap">Free pool</span>
                    )}
                    <HoldChip onHold={c.on_hold} holdProjects={c.hold_projects} />
                  </div>
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap text-blue-500 dark:text-blue-400 text-[10px]">
                  {c.earliest_available_date ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Redeploy Matches Tab ───────────────────────────────────────────────────────

type RedeployMatchSort = "composite_desc" | "skill_desc" | "competency_desc" | "available_desc";

function RedeployMatchesTab({ employeeId }: { employeeId: string }) {
  const [includeParams, setIncludeParams] = useState<IncludeParams>(DEFAULT_INCLUDE_PARAMS);
  const [includeBelowCapacity, setIncludeBelowCapacity] = useState(false);
  const [nearCapacityTolerancePct, setNearCapacityTolerancePct] = useState(25);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const matches = useQuery({
    queryKey: ["free-pool-matches", employeeId, includeParams, includeBelowCapacity, nearCapacityTolerancePct],
    queryFn: () => api.freePoolMatches(employeeId, 20, includeParams, includeBelowCapacity, nearCapacityTolerancePct),
  });
  const [coeFilter, setCoeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sort, setSort] = useState<RedeployMatchSort>("composite_desc");

  if (matches.isLoading) return <TableSkeleton columns={8} rows={5} />;
  if (matches.error) return <ErrorState message="Could not load redeploy matches." />;
  const allRows = matches.data ?? [];

  const coeOptions = Array.from(new Set(allRows.flatMap((m) => m.skill_areas))).sort();
  const roleOptions = Array.from(new Set(allRows.map((m) => m.resources_requested).filter((v): v is string => Boolean(v)))).sort();

  let rows = allRows;
  if (coeFilter !== "all") rows = rows.filter((m) => m.skill_areas.includes(coeFilter));
  if (roleFilter !== "all") rows = rows.filter((m) => m.resources_requested === roleFilter);
  rows = [...rows];
  switch (sort) {
    case "composite_desc": rows.sort((a, b) => b.composite_score - a.composite_score); break;
    case "skill_desc":     rows.sort((a, b) => b.skill_score - a.skill_score); break;
    case "competency_desc":rows.sort((a, b) => b.competency_score - a.competency_score); break;
    case "available_desc": rows.sort((a, b) => b.available_pct - a.available_pct); break;
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Open pipeline demand this person could redeploy into, ranked by the same skill + competency + availability
        composite score used everywhere else in the app.
      </p>
      {allRows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          No real skill overlap with any currently-open pipeline demand.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-end">
            <AdvancedFiltersButton
              open={advancedFiltersOpen}
              include={includeParams}
              defaults={DEFAULT_INCLUDE_PARAMS}
              includeBelowCapacity={includeBelowCapacity}
              onClick={() => setAdvancedFiltersOpen((v) => !v)}
            />
          </div>
          {advancedFiltersOpen && (
            <AdvancedFiltersPanel
              include={includeParams}
              onApply={setIncludeParams}
              includeBelowCapacity={includeBelowCapacity}
              onApplyBelowCapacity={setIncludeBelowCapacity}
              nearCapacityTolerancePct={nearCapacityTolerancePct}
              onApplyNearCapacityTolerancePct={setNearCapacityTolerancePct}
            />
          )}
          <TableControls
            filters={[
              { value: coeFilter, onChange: setCoeFilter, options: [["all", "All skill areas / CoE"], ...coeOptions.map((c) => [c, c] as [string, string])] },
              { value: roleFilter, onChange: setRoleFilter, options: [["all", "All roles"], ...roleOptions.map((r) => [r, r] as [string, string])] },
            ]}
            sort={{
              value: sort,
              onChange: (v) => setSort(v as RedeployMatchSort),
              options: [
                ["composite_desc", "Best overall fit ↓"],
                ["skill_desc", "Skill match ↓"],
                ["competency_desc", "Competency ↓"],
                ["available_desc", "Availability ↓"],
              ],
            }}
          />
          {rows.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No matches with the current filters.</p>
          ) : (
            <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                      {["Fit", "Skill", "Competency", "Available", "Client", "Role requested", "Skill area / CoE", "Flags", ""].map((h) => (
                        <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.row_index} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <td className="px-2.5 py-1.5">
                          <Badge variant={m.bucket}>{Math.round(m.composite_score * 100)}%</Badge>
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={`Matched: ${m.matched_skills.join(", ") || "none"}. Missing: ${m.missing_skills.join(", ") || "none"}.`}>
                          {Math.round(m.skill_score * 100)}%
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {Math.round(m.competency_score * 100)}%
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {m.available_pct}%{m.meets_requested_capacity === false && <span className="text-amber-600 dark:text-amber-400"> (below requested %)</span>}
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{m.client ?? "-"}</td>
                        <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{m.resources_requested ?? "-"}</td>
                        <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 max-w-[160px] truncate" title={m.skill_areas.join(", ")}>
                          {m.skill_areas.join(", ") || "-"}
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <HoldChip onHold={m.on_hold} holdProjects={m.hold_projects} />
                        </td>
                        <td className="px-2.5 py-1.5">
                          <Link href={`/resourcing/deals?row=${m.row_index}`} className="text-primary hover:underline whitespace-nowrap">
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Allocations Tab ────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-gray-700 dark:text-gray-300 font-medium">{value}</p>
    </div>
  );
}

function OverviewTab({ profile, onOpenProject }: { profile: EmployeeProfile; onOpenProject: (projectCode: string) => void }) {
  const s = profile.signals;
  const [timesheetProject, setTimesheetProject] = useState<string | null>(null);
  const quietAllocations = profile.current_allocations.filter((a) => a.possible_unplanned_absence);
  const rows: { key: string; label: string; fired: boolean; detail: ReactNode }[] = [
    {
      key: "on_hold",
      label: "Hold / doubt",
      fired: s.on_hold,
      detail:
        s.hold_projects.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1.5">
            Current project(s) flagged as likely to extend past end date:
            {s.hold_projects.map((p) => (
              <button key={p.project_code} onClick={() => onOpenProject(p.project_code)} className="text-amber-700 dark:text-amber-400 font-medium hover:underline">
                {p.project_code}
              </button>
            ))}
            <span className="text-gray-400 dark:text-gray-500">— availability uncertain until confirmed.</span>
          </span>
        ) : (
          "no current allocation on a project flagged as extending"
        ),
    },
    {
      key: "over_allocated",
      label: "Over-allocated",
      fired: s.over_allocated,
      detail:
        profile.employee_client_allocation_pct != null ? (
          <>{profile.employee_client_allocation_pct}% client allocation — threshold &gt;{s.over_allocated_threshold}%</>
        ) : (
          "no current allocations"
        ),
    },
    {
      key: "under_utilized",
      label: "Under-utilized",
      fired: s.under_utilized,
      detail:
        profile.employee_total_allocation_pct != null
          ? `${profile.employee_total_allocation_pct}% total allocation — threshold <${s.under_utilized_threshold}%`
          : "no current allocations",
    },
    {
      key: "sustained_overtime",
      label: "Sustained overtime",
      fired: s.sustained_overtime,
      detail: `${profile.overtime_risk.overtime_days_recent} day(s) >${s.overtime_daily_threshold_hours}h in the last ${s.overtime_window_days} days (max ${profile.overtime_risk.max_daily_hours_recent}h) — threshold ${s.overtime_sustained_min_days}+ days`,
    },
    {
      key: "possible_unplanned_absence",
      label: "Possible unplanned absence",
      fired: s.possible_unplanned_absence,
      detail:
        quietAllocations.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1.5">
            Quiet 14d+ on:
            {quietAllocations.map((a) => (
              <button key={a.project_id} onClick={() => setTimesheetProject(a.project_id)} className="text-primary hover:underline">
                {a.project_id}
              </button>
            ))}
            <span className="text-gray-400 dark:text-gray-500">(click for real proof)</span>
          </span>
        ) : (
          "no current allocation shows this"
        ),
    },
    {
      key: "pulse",
      label: "Pulse",
      fired: profile.pulse?.is_not_happy ?? false,
      detail: !profile.pulse
        ? "no Weekly Pulse submissions for this employee"
        : `${profile.pulse.avg_score}/4 avg (inspired/valued/workload), ${profile.pulse.response_count} response(s), last ${profile.pulse.window_weeks}w. Worst: ${profile.pulse.worst_question}.`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
        <Field label="Designation" value={profile.job_name ?? "-"} />
        <Field label="Department" value={profile.department_name ?? "-"} />
        <Field label="Manager" value={profile.manager_employee_id ?? "-"} />
        <Field label="Location" value={profile.location ?? "-"} />
        <Field label="Joined" value={profile.date_of_join ?? "-"} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {profile.account_status != null && (
          <Badge variant={profile.account_status ? "billable" : "default"}>{profile.account_status ? "Active employee" : "Inactive"}</Badge>
        )}
        {profile.coe && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/60">
            CoE · {profile.coe}
          </span>
        )}
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {profile.employee_total_allocation_pct != null ? `${profile.employee_total_allocation_pct}% total allocation right now` : "no current allocations"}
        </span>
      </div>
      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Signal</th>
                <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Status</th>
                <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Actual vs. threshold</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <td className="px-2.5 py-2 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{r.label}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap"><FiredBadge fired={r.fired} /></td>
                  <td className="px-2.5 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {timesheetProject && (
        <TimesheetProofModal employeeId={profile.employee_id} projectId={timesheetProject} onClose={() => setTimesheetProject(null)} />
      )}
    </div>
  );
}

type AllocSort = "start_desc" | "start_asc" | "end_desc" | "end_asc" | "pct_desc" | "employee_asc";

// Internal overhead buckets, not real client/delivery work -- hidden by
// default in the Allocations tab so it reads as real project staffing.
const OVERHEAD_PROJECT_TYPES = new Set(["BAU Activity", "Sales Activity"]);

function hoursFor(row: EmployeeAllocationRow, current: AllocationRow[]): AllocationRow | undefined {
  return current.find((c) => c.project_id === row.project_id);
}

function AllocationsTab({
  profile, onFindReplacement, activeReplacementProjectId, onOpenProject,
}: {
  profile: EmployeeProfile;
  onFindReplacement: (ctx: { projectId: string; allocPct: number } | null) => void;
  activeReplacementProjectId: string | null;
  onOpenProject: (projectCode: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  // BAU/Sales Activity are internal overhead buckets, not real client/delivery
  // work -- hidden by default so this tab reads as "what is this person
  // actually staffed on" rather than being dominated by evergreen BAU rows,
  // but never permanently hidden: one click brings them back.
  const [hideOverhead, setHideOverhead] = useState(true);
  const [sort, setSort] = useState<AllocSort>("start_desc");
  const [timesheetProject, setTimesheetProject] = useState<string | null>(null);

  if (profile.allocations.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">No allocation history for this employee.</p>;
  }

  const statuses = Array.from(new Set(profile.allocations.map((a) => a.resourcing_status))).sort();
  const overheadCount = profile.allocations.filter((a) => OVERHEAD_PROJECT_TYPES.has(a.type_of_project ?? "")).length;

  let rows = profile.allocations;
  const q = search.trim().toLowerCase();
  if (q) rows = rows.filter((a) => a.project_id.toLowerCase().includes(q) || (a.client_id ?? "").toLowerCase().includes(q));
  if (statusFilter !== "all") rows = rows.filter((a) => a.resourcing_status === statusFilter);
  if (activeOnly) rows = rows.filter((a) => a.is_allocation_active);
  if (hideOverhead) rows = rows.filter((a) => !OVERHEAD_PROJECT_TYPES.has(a.type_of_project ?? ""));

  rows = [...rows];
  switch (sort) {
    case "start_desc": rows.sort((a, b) => (b.allocated_start_date ?? "").localeCompare(a.allocated_start_date ?? "")); break;
    case "start_asc":  rows.sort((a, b) => (a.allocated_start_date ?? "").localeCompare(b.allocated_start_date ?? "")); break;
    case "end_desc":   rows.sort((a, b) => (b.allocated_end_date ?? "").localeCompare(a.allocated_end_date ?? "")); break;
    case "end_asc":    rows.sort((a, b) => (a.allocated_end_date ?? "").localeCompare(b.allocated_end_date ?? "")); break;
    case "pct_desc":   rows.sort((a, b) => (b.allocation_by_percentage ?? 0) - (a.allocation_by_percentage ?? 0)); break;
    case "employee_asc": rows.sort((a, b) => a.project_id.localeCompare(b.project_id)); break;
  }

  // The timeline graph follows the same "hide BAU/Sales overhead" toggle as
  // the table below, but not the table's own search/status text filters --
  // it's the big-picture view and shouldn't go blank just because someone
  // typed a search query meant for the row list.
  const timelineAllocations = hideOverhead
    ? profile.allocations.filter((a) => !OVERHEAD_PROJECT_TYPES.has(a.type_of_project ?? ""))
    : profile.allocations;

  return (
    <div>
      <AllocationTimeline allocations={timelineAllocations} onOpenProject={onOpenProject} />
      <TableControls
        search={{ value: search, onChange: setSearch, placeholder: "Search project or client…" }}
        filters={[{ value: statusFilter, onChange: setStatusFilter, options: [["all", "All statuses"], ...statuses.map((s) => [s, s] as [string, string])] }]}
        toggles={[
          { active: activeOnly, onToggle: () => setActiveOnly((v) => !v), label: "Active only" },
          {
            active: hideOverhead,
            onToggle: () => setHideOverhead((v) => !v),
            label: hideOverhead
              ? `Hiding BAU/Sales${overheadCount > 0 ? ` (${overheadCount})` : ""}`
              : "Showing all types",
          },
        ]}
        sort={{
          value: sort,
          onChange: (v) => setSort(v as AllocSort),
          options: [
            ["start_desc", "Start date ↓ (latest first)"],
            ["start_asc", "Start date ↑"],
            ["end_desc", "End date ↓"],
            ["end_asc", "End date ↑"],
            ["pct_desc", "Allocation % ↓"],
            ["employee_asc", "Project A–Z"],
          ],
        }}
      />
      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                {["Project", "Client", "Type", "Status", "Alloc %", "Start", "End", "Active?", "Hours Util.", ""].map((h) => (
                  <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => {
                const hours = a.is_allocation_active ? hoursFor(a, profile.current_allocations) : undefined;
                const isActiveReplacement = activeReplacementProjectId === a.project_id;
                return (
                  <tr key={i} className={cn("border-b border-gray-50 dark:border-gray-800/60 last:border-0", isActiveReplacement && "bg-amber-50/40 dark:bg-amber-950/40")}>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <button onClick={() => onOpenProject(a.project_id)} className="text-primary font-medium hover:underline">
                        {a.project_id}
                      </button>
                    </td>
                    <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{a.client_id ?? "-"}</td>
                    <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{a.type_of_project ?? "-"}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap"><Badge variant={a.resourcing_status}>{a.resourcing_status}</Badge></td>
                    <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{a.allocation_by_percentage ?? 0}%</td>
                    <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{a.allocated_start_date ?? "-"}</td>
                    <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{a.allocated_end_date ?? "-"}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      {a.is_allocation_active ? <Badge variant="billable">Active</Badge> : <Badge variant="default">Past</Badge>}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      {hours ? (
                        <button
                          onClick={() => setTimesheetProject(a.project_id)}
                          className="flex items-center gap-1.5 hover:opacity-75 transition"
                          title={`${hours.actual_hours_logged}h logged / ${hours.expected_hours}h expected`}
                        >
                          {hours.hours_data_available && hours.hours_utilization_pct !== null ? (
                            <Badge variant={hours.utilization_band}>{hours.hours_utilization_pct}%</Badge>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600 underline">no data yet</span>
                          )}
                          {hours.possible_unplanned_absence && <Badge variant="unbilled">quiet 14d+</Badge>}
                        </button>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      {a.is_allocation_active && (
                        <button
                          onClick={() =>
                            onFindReplacement(
                              isActiveReplacement
                                ? null
                                : { projectId: a.project_id, allocPct: a.allocation_by_percentage ?? 100 }
                            )
                          }
                          className={cn(
                            "flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border transition whitespace-nowrap",
                            isActiveReplacement
                              ? "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                              : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-amber-300 dark:hover:border-amber-700 hover:text-amber-700 dark:hover:text-amber-400"
                          )}
                          title="Find who can replace this person if they are pulled from this project"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          {isActiveReplacement ? "View replacement" : "Find replacement"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">No allocations match the current filters.</p>}
      </div>
      {timesheetProject && (
        <TimesheetProofModal employeeId={profile.employee_id} projectId={timesheetProject} onClose={() => setTimesheetProject(null)} />
      )}
    </div>
  );
}

const PULSE_QUESTION_LABELS: Record<string, string> = {
  q1_inspired_motivated: "Inspired/motivated",
  q2_valued_supported: "Valued/supported",
  q3_feedback_growth: "Feedback & growth",
  q4_cdm_guidance: "CDM guidance",
  q5_workload_sustainable: "Workload sustainable",
};

function OvertimeTab({ profile }: { profile: EmployeeProfile }) {
  const r = profile.overtime_risk;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Sustained overtime</p>
        <FiredBadge fired={profile.signals.sustained_overtime} />
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Hours are summed across every project/task that day. {r.overtime_days_recent} day(s) &gt;{profile.signals.overtime_daily_threshold_hours}h
        in the last {profile.signals.overtime_window_days} days (max {r.max_daily_hours_recent}h) — threshold {profile.signals.overtime_sustained_min_days}+ days.
      </p>
      {profile.daily_hours_recent.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No timesheet history in the trailing window for this employee.</p>
      ) : (
        <div className="flex gap-1.5 flex-wrap">
          {profile.daily_hours_recent.map((dh) => (
            <span
              key={dh.date}
              title={dh.date}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                dh.is_overtime ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-400" : "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
              )}
            >
              {dh.date.slice(5)}: {dh.hours}h
            </span>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Weekly Pulse - Not happy</p>
          <FiredBadge fired={profile.pulse?.is_not_happy ?? false} />
        </div>
        {!profile.pulse || profile.pulse.responses.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No weekly pulse responses in the trailing window.</p>
        ) : (
          <div className="space-y-2">
            {profile.pulse.responses.map((resp) => (
              <div key={resp.week_start_date + resp.project_id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-2">
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                  {resp.week_start_date} · {resp.project_id}
                </p>
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(resp.answers).map(([q, a]) => (
                    <span
                      key={q}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                        a.is_not_happy_question && a.score <= 2
                          ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-400"
                          : "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                      )}
                    >
                      {PULSE_QUESTION_LABELS[q] ?? q}: {a.meaning}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type ImportChannel = "resume" | "linkedin";

function DocumentImportModal({
  employeeId, channel, onClose,
}: { employeeId: string; channel: ImportChannel; onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [previewImportId, setPreviewImportId] = useState<string | null>(null);
  const isLinkedIn = channel === "linkedin";

  const imports = useQuery({
    queryKey: ["employee-document-imports", employeeId],
    queryFn: () => api.employeeDocumentImports(employeeId),
  });
  const channelImports = (imports.data ?? []).filter((r) => r.channel === channel);
  const previewRecord = channelImports.find((r) => r.import_id === previewImportId) ?? null;

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadEmployeeResume(employeeId, file, channel),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employee-profile", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-document-imports", employeeId] });

      const parts: string[] = [];
      if (result.added_skills.length > 0) parts.push(`${result.added_skills.length} new skill(s): ${result.added_skills.join(", ")}`);
      if (result.added_competencies.length > 0) parts.push(`${result.added_competencies.length} competency statement(s) with real evidence`);
      const nothingNew = result.added_skills.length === 0 && result.added_competencies.length === 0;

      setFeedback({
        kind: "success",
        message: nothingNew
          ? `Found ${result.extracted_skill_count} skill(s) and ${result.extracted_competency_count} competency match(es), but all were already on record.`
          : `Added ${parts.join(" and ")}.`,
      });
      setPreviewImportId(result.import_id);
    },
    onError: (err: Error) => setFeedback({ kind: "error", message: err.message }),
  });

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    upload.mutate(file);
  };

  return (
    <Modal
      title={isLinkedIn ? "Import from LinkedIn" : "Upload Resume"}
      subtitle={
        isLinkedIn
          ? "Export the employee's LinkedIn profile as a PDF, then upload it below."
          : "PDF or Word -- an AI reads it and adds any real skills or evidenced competencies not already on record."
      }
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="p-5 space-y-4">
        {isLinkedIn && (
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
            <li>Open the employee&apos;s LinkedIn profile.</li>
            <li>Click <strong>More</strong> (below the profile photo) → <strong>Save to PDF</strong>.</li>
            <li>Upload the downloaded PDF below -- it goes through the same AI analysis as a resume.</li>
          </ol>
        )}

        <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: isLinkedIn ? "#0A66C2" : "hsl(var(--primary))" }}
        >
          {upload.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
          {upload.isPending
            ? "Analyzing…"
            : channelImports.length > 0
              ? "Reupload a new file"
              : isLinkedIn
                ? "I have the PDF -- upload it"
                : "Choose file to upload"}
        </button>

        {feedback && (
          <div
            className={cn(
              "flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]",
              feedback.kind === "success" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
            )}
          >
            {feedback.kind === "success" ? (
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {imports.isLoading
              ? "Checking for past imports…"
              : channelImports.length > 0
                ? `Already imported (${channelImports.length})`
                : "No past imports yet for this employee"}
          </p>
          {channelImports.map((r) => (
            <DocumentImportCard
              key={r.import_id}
              employeeId={employeeId}
              record={r}
              onPreview={() => setPreviewImportId(r.import_id)}
            />
          ))}
        </div>
      </div>

      {previewRecord && (
        <DocumentPreviewOverlay
          employeeId={employeeId}
          record={previewRecord}
          onClose={() => setPreviewImportId(null)}
        />
      )}
    </Modal>
  );
}

function DocumentImportCard({
  employeeId, record, onPreview,
}: { employeeId: string; record: DocumentImportRecord; onPreview: () => void }) {
  const fileUrl = api.documentImportFileUrl(employeeId, record.import_id);

  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{record.filename}</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{new Date(record.uploaded_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onPreview} className="text-[10px] text-primary hover:underline">
            Preview
          </button>
          <a href={fileUrl} target="_blank" rel="noreferrer" className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:underline">
            Open
          </a>
        </div>
      </div>

      {(record.added_skills.length > 0 || record.added_competencies.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {record.added_skills.map((s) => (
            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/60">{s}</span>
          ))}
          {record.added_competencies.map((c) => (
            <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-800/60 max-w-[240px] truncate" title={c}>
              {c}
            </span>
          ))}
        </div>
      )}
      {record.added_skills.length === 0 && record.added_competencies.length === 0 && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Nothing new -- everything found was already on record.</p>
      )}
    </div>
  );
}

function DocumentPreviewOverlay({
  employeeId, record, onClose,
}: { employeeId: string; record: DocumentImportRecord; onClose: () => void }) {
  const isPdf = record.filename.toLowerCase().endsWith(".pdf");
  const fileUrl = api.documentImportFileUrl(employeeId, record.import_id);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-[88vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{record.filename}</p>
          <div className="flex items-center gap-3 flex-shrink-0 ml-3">
            <a href={fileUrl} target="_blank" rel="noreferrer" className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:underline">
              Open in new tab
            </a>
            <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-50 dark:bg-gray-800/60">
          {isPdf ? (
            <iframe
              // navpanes=0 hides Chrome's own left thumbnail sidebar (a second,
              // unrelated container next to the actual document); view=FitH
              // fits the page to the available width so the resume is readable
              // without the user having to zoom the PDF or the browser tab.
              src={`${fileUrl}#toolbar=1&navpanes=0&view=FitH`}
              className="w-full h-full border-0"
              title={record.filename}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">Inline preview isn&apos;t available for Word documents -- use &quot;Open in new tab&quot; to view it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type SkillSort = "score_desc" | "source_asc" | "skill_asc";

function SkillsTab({
  employeeId,
  profile,
  matchContext,
}: {
  employeeId: string;
  profile: EmployeeProfile;
  matchContext?: SkillMatchContext;
}) {
  const [activeImport, setActiveImport] = useState<ImportChannel | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SkillSort>("source_asc");
  const hasMatchContext = Boolean(matchContext && (matchContext.matchedSkills.length > 0 || matchContext.missingSkills.length > 0));
  const [showAll, setShowAll] = useState(!hasMatchContext);

  const imports = useQuery({
    queryKey: ["employee-document-imports", employeeId],
    queryFn: () => api.employeeDocumentImports(employeeId),
  });
  const hasResumeImport = (imports.data ?? []).some((r) => r.channel === "resume");
  const hasLinkedInImport = (imports.data ?? []).some((r) => r.channel === "linkedin");

  let rows = profile.skills;
  const q = search.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (s) =>
        (s.coe_skill ?? "").toLowerCase().includes(q) ||
        (s.skill ?? "").toLowerCase().includes(q) ||
        (s.subskill ?? "").toLowerCase().includes(q)
    );
  }
  rows = [...rows];
  switch (sort) {
    case "score_desc": rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); break;
    case "source_asc": rows.sort((a, b) => Number(b.skill_source === "observed") - Number(a.skill_source === "observed")); break;
    case "skill_asc":  rows.sort((a, b) => (a.skill ?? "").localeCompare(b.skill ?? "")); break;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 px-3 py-2.5 flex-wrap">
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Add skills &amp; competencies from a document</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">PDF or Word -- an AI reads it and adds any real skills or evidenced competencies not already on record.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setActiveImport("resume")}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Upload Resume
            {hasResumeImport && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" title="Already imported" />}
          </button>
          <button
            onClick={() => setActiveImport("linkedin")}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
            style={{ borderColor: "#0A66C2", color: "#0A66C2" }}
          >
            <Linkedin className="w-3.5 h-3.5" />
            Import from LinkedIn
            {hasLinkedInImport && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" title="Already imported" />}
          </button>
        </div>
      </div>

      {activeImport && (
        <DocumentImportModal employeeId={employeeId} channel={activeImport} onClose={() => setActiveImport(null)} />
      )}

      {hasMatchContext && matchContext && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">What matched for this request</p>
          {matchContext.matchedSkills.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <span className="text-gray-600 dark:text-gray-400">{matchContext.matchedSkills.join(", ")}</span>
            </div>
          )}
          {matchContext.missingSkills.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs">
              <XCircle className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-0.5" />
              <span className="text-gray-400 dark:text-gray-500">{matchContext.missingSkills.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      <button onClick={() => setShowAll((v) => !v)} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
        {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showAll ? "Hide" : "Show"} all {profile.skills.length} skill records, real and inferred
      </button>

      {showAll && (
        <div>
          <TableControls
            search={{ value: search, onChange: setSearch, placeholder: "Search skill, sub-skill, or COE…" }}
            sort={{ value: sort, onChange: (v) => setSort(v as SkillSort), options: [["source_asc", "Observed first"], ["score_desc", "Score ↓"], ["skill_asc", "Skill A–Z"]] }}
          />
          <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                    {["COE Skill", "Skill", "Sub-skill", "Experience", "Score", "Source"].map((h) => (
                      <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 max-w-[14rem]">{s.coe_skill ?? "-"}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 font-medium max-w-[14rem]">{s.skill ?? "-"}</td>
                      <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 max-w-[16rem]">{s.subskill ?? "-"}</td>
                      <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.experience ?? "-"}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{s.score != null ? s.score.toFixed(1) : "-"}/5</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap"><SourceTag value={s.skill_source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">No skill records match this search.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

type CompetencySort = "score_desc" | "source_asc";

function CompetencyTab({ profile }: { profile: EmployeeProfile }) {
  const [sort, setSort] = useState<CompetencySort>("score_desc");

  if (profile.competencies.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">No competency records for this employee.</p>;
  }

  const rows = [...profile.competencies];
  switch (sort) {
    case "score_desc": rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); break;
    case "source_asc": rows.sort((a, b) => Number(b.competency_source === "observed") - Number(a.competency_source === "observed")); break;
  }

  return (
    <div>
      <TableControls
        sort={{ value: sort, onChange: (v) => setSort(v as CompetencySort), options: [["score_desc", "Score ↓"], ["source_asc", "Observed first"]] }}
      />
      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                {["Competency question", "Response", "Score", "Source"].map((h) => (
                  <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <td className="px-2.5 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.competency_question ?? "-"}</td>
                  <td className="px-2.5 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.response ?? "-"}</td>
                  <td className="px-2.5 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.score != null ? c.score.toFixed(1) : "-"}/5</td>
                  <td className="px-2.5 py-2 whitespace-nowrap"><SourceTag value={c.competency_source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LeaveTab({ profile }: { profile: EmployeeProfile }) {
  if (profile.leaves.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">No leave records for this employee.</p>;
  }
  return (
    <div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
        {profile.leaves.length} leave record(s).
      </p>
      <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                {["Type", "Start", "End", "Status", "Currently on leave?"].map((h) => (
                  <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.leaves.map((l, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{l.leave_type}</td>
                  <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{l.leave_start_date ?? "-"}</td>
                  <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{l.leave_end_date ?? "-"}</td>
                  <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{l.status}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{l.is_currently_on_leave && <Badge variant="amber">Currently on leave</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Feedback Tab ───────────────────────────────────────────────────────────────
// Real HR/PM performance-review check-ins on real projects, written by a real
// reviewing employee -- a manual "proof" surface for the resource manager to
// cross-check a recommendation candidate against, never an input to
// recommendation scoring itself.

const WEEKS_BACK_OPTIONS: [string, string][] = [
  ["all", "All time"],
  ["4", "Last 4 weeks"],
  ["8", "Last 8 weeks"],
  ["12", "Last 12 weeks"],
  ["26", "Last 6 months"],
  ["52", "Last 12 months"],
];

// All 5 real rating values -- the scale is 1-5, no 0, and every value is
// independently selectable (e.g. just 5 and 2, to see the extremes only)
// rather than a single "N+" threshold.
const RATING_OPTIONS = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} star${n === 1 ? "" : "s"}` }));

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn("w-3 h-3", n <= rating ? "fill-amber-400 text-amber-400 dark:text-amber-500" : "text-gray-200 dark:text-gray-700")}
        />
      ))}
    </span>
  );
}

function FeedbackDetailModal({ entry, onClose }: { entry: EmployeeFeedbackEntry; onClose: () => void }) {
  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2">
          {entry.project_id} — feedback
          <StarRating rating={entry.rating} />
        </span>
      }
      subtitle={`${entry.feedback_date} · Reviewed by ${entry.reviewer_employee_id} (${entry.reviewer_role})`}
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {entry.client_id && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {entry.client_id}
            </span>
          )}
          {entry.coe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/60 text-violet-700 dark:text-violet-400 whitespace-nowrap">
              {entry.coe}
            </span>
          )}
          {entry.themes.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full border bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60 text-teal-700 dark:text-teal-400 whitespace-nowrap">
              {t}
            </span>
          ))}
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
            entry.would_recommend ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400"
          )}>
            {entry.would_recommend ? "Would recommend" : "Would not recommend"}
          </span>
        </div>
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/60 p-4">
          <p className="text-[12px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{entry.full_text}</p>
        </div>
      </div>
    </Modal>
  );
}

function FeedbackEntryCard({ entry, onOpen }: { entry: EmployeeFeedbackEntry; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-1.5 hover:border-primary/40 hover:bg-gray-50/60 dark:hover:bg-gray-800/60 transition"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
          <span className="text-gray-700 dark:text-gray-300 font-medium">{entry.project_id}</span>
          {entry.client_id && <span>· {entry.client_id}</span>}
          {entry.coe && <span>· {entry.coe}</span>}
          <span>· {entry.feedback_date}</span>
          <span>· by {entry.reviewer_employee_id} ({entry.reviewer_role})</span>
        </div>
        <StarRating rating={entry.rating} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {entry.themes.map((t) => (
          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full border bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60 text-teal-700 dark:text-teal-400 whitespace-nowrap">
            {t}
          </span>
        ))}
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
          entry.would_recommend ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400"
        )}>
          {entry.would_recommend ? "Would recommend" : "Would not recommend"}
        </span>
      </div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{entry.summary_comment}</p>
      <p className="text-[10px] text-primary">Read full feedback →</p>
    </button>
  );
}

type FeedbackSubTab = "project" | "performance";

function FeedbackTab({ employeeId }: { employeeId: string }) {
  const [subTab, setSubTab] = useState<FeedbackSubTab>("project");

  const subTabs: { key: FeedbackSubTab; label: string }[] = [
    { key: "project", label: "Project Feedback" },
    { key: "performance", label: "Performance Reviews" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800 -mt-1">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition whitespace-nowrap",
              subTab === t.key ? "border-primary text-primary" : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "project" && <ProjectFeedbackTab employeeId={employeeId} />}
      {subTab === "performance" && <PerformanceReviewsTab employeeId={employeeId} />}
    </div>
  );
}

function ProjectFeedbackTab({ employeeId }: { employeeId: string }) {
  const [weeksBack, setWeeksBack] = useState("all");
  const [coe, setCoe] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [reviewerEmployeeId, setReviewerEmployeeId] = useState("all");
  const [theme, setTheme] = useState("all");
  const [ratings, setRatings] = useState<string[]>([]);
  const [openEntry, setOpenEntry] = useState<EmployeeFeedbackEntry | null>(null);

  const feedback = useQuery({
    queryKey: ["employee-feedback", employeeId, weeksBack, coe, projectId, reviewerEmployeeId, theme, ratings],
    queryFn: () =>
      api.employeeFeedback(employeeId, {
        weeksBack: weeksBack === "all" ? undefined : Number(weeksBack),
        coe: coe === "all" ? undefined : coe,
        projectId: projectId === "all" ? undefined : projectId,
        reviewerEmployeeId: reviewerEmployeeId === "all" ? undefined : reviewerEmployeeId,
        theme: theme === "all" ? undefined : theme,
        ratings: ratings.length > 0 ? ratings.map(Number) : undefined,
      }),
  });

  if (feedback.isLoading) return <TableSkeleton columns={4} rows={5} />;
  if (feedback.error) return <ErrorState message="Could not load feedback for this employee." />;
  const data = feedback.data;
  if (!data || data.total_response_count === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">No HR feedback records for this employee.</p>;
  }

  return (
    <div className="space-y-3">
      <TableControls
        filters={[
          { value: weeksBack, onChange: setWeeksBack, options: WEEKS_BACK_OPTIONS },
          { value: coe, onChange: setCoe, options: [["all", "All CoEs"], ...data.available_coes.map((c) => [c, c] as [string, string])] },
          { value: projectId, onChange: setProjectId, options: [["all", "All projects"], ...data.available_projects.map((p) => [p, p] as [string, string])] },
          {
            value: reviewerEmployeeId,
            onChange: setReviewerEmployeeId,
            options: [["all", "All reviewers"], ...data.available_reviewers.map((r) => [r.employee_id, `${r.employee_id} (${r.role})`] as [string, string])],
          },
          { value: theme, onChange: setTheme, options: [["all", "All themes"], ...data.available_themes.map((t) => [t, t] as [string, string])] },
        ]}
      />
      <div className="flex items-center gap-1.5 -mt-1.5">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">Rating:</span>
        <SearchableSelect
          options={RATING_OPTIONS}
          value={ratings}
          onChange={setRatings}
          multi
          placeholder="All ratings"
          className="w-36"
          size="sm"
        />
      </div>

      {data.response_count === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">No feedback matches the current filters.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Avg rating</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.avg_rating}/5</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Responses</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.response_count}</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Would recommend</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.would_recommend_pct}%</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Projects covered</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.distinct_project_count}</p>
            </div>
          </div>

          {Object.keys(data.theme_averages).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.entries(data.theme_averages).map(([t, avg]) => (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {t}: {avg}/5
                </span>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {data.entries.map((entry) => (
              <FeedbackEntryCard key={entry.feedback_id} entry={entry} onOpen={() => setOpenEntry(entry)} />
            ))}
          </div>
        </>
      )}

      {openEntry && <FeedbackDetailModal entry={openEntry} onClose={() => setOpenEntry(null)} />}
    </div>
  );
}

// ── Performance Reviews (KRA cycles) ────────────────────────────────────────

const PERFORMANCE_STATUS_BADGE: Record<string, string> = {
  "Closed": "green",
  "Management Review": "amber",
  "Appraiser Submit": "amber",
  "Appraisee Submit": "blue",
  "Reviewer Intervention": "amber",
  "Reviewer Submit": "amber",
};

const PERFORMANCE_GRADE_BADGE: Record<string, string> = {
  BE: "red",
  ME: "amber",
  MEE: "blue",
  EE: "green",
};

function PerformanceAiSummaryCard({ employeeId }: { employeeId: string }) {
  const summary = useMutation({
    mutationFn: () => api.employeePerformanceSummary(employeeId),
  });

  if (!summary.data && !summary.isPending) {
    return (
      <button
        onClick={() => summary.mutate()}
        className="w-full rounded-lg border border-dashed border-primary/30 p-3 flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/[0.03] transition"
      >
        <Sparkles className="w-3.5 h-3.5" /> Generate AI Summary (Projects, Products &amp; Overall Feedback)
      </button>
    );
  }

  if (summary.isPending) {
    return (
      <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Summarizing performance history...
      </div>
    );
  }

  if (summary.isError) {
    return <p className="text-xs text-red-500 dark:text-red-400 italic">Could not generate a summary — try again.</p>;
  }

  const data = summary.data;
  if (!data || !data.available || !data.summary) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        {data?.reason ?? "No summary available."}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
        <Sparkles className="w-3 h-3" /> AI Summary — Latest Cycle ({data.cycle_label})
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{data.summary}</p>
      <div className="flex justify-end">
        <button onClick={() => summary.mutate()} className="text-[10px] text-primary hover:underline shrink-0">
          Regenerate
        </button>
      </div>
    </div>
  );
}

function PerformanceReviewsTab({ employeeId }: { employeeId: string }) {
  const [openCycleId, setOpenCycleId] = useState<string | null>(null);

  const cycles = useQuery({
    queryKey: ["employee-performance-cycles", employeeId],
    queryFn: () => api.employeePerformanceCycles(employeeId),
  });

  if (cycles.isLoading) return <TableSkeleton columns={4} rows={4} />;
  if (cycles.error) return <ErrorState message="Could not load performance cycles for this employee." />;
  const data = cycles.data ?? [];

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">No performance review cycles for this employee.</p>;
  }

  return (
    <div className="space-y-3">
      <PerformanceAiSummaryCard employeeId={employeeId} />
      <div className="space-y-2">
        {data.map((cycle) => (
          <PerformanceCycleCard key={cycle.cycle_id} cycle={cycle} onOpen={() => setOpenCycleId(cycle.cycle_id)} />
        ))}
      </div>
      {openCycleId && (
        <PerformanceCycleDetailModal
          employeeId={employeeId}
          cycleId={openCycleId}
          onClose={() => setOpenCycleId(null)}
        />
      )}
    </div>
  );
}

function PerformanceCycleCard({ cycle, onOpen }: { cycle: PerformanceCycleSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-gray-100 dark:border-gray-800 p-3 hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50/60 dark:hover:bg-gray-800/60 transition flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{cycle.form_name}</p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {cycle.cycle_label} · Published {cycle.published_on ?? "—"} · Ends {cycle.form_end_date ?? "—"}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {cycle.total_score !== null && (
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{cycle.total_score}/400</span>
        )}
        {cycle.performance_rating_code && (
          <Badge variant={PERFORMANCE_GRADE_BADGE[cycle.performance_rating_code] ?? "default"}>
            {cycle.performance_rating_code}
          </Badge>
        )}
        <Badge variant={PERFORMANCE_STATUS_BADGE[cycle.status] ?? "default"}>{cycle.status}</Badge>
      </div>
    </button>
  );
}

function PerformanceCycleDetailModal({
  employeeId, cycleId, onClose,
}: { employeeId: string; cycleId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["employee-performance-cycle-detail", employeeId, cycleId],
    queryFn: () => api.employeePerformanceCycleDetail(employeeId, cycleId),
  });

  return (
    <Modal title={detail.data ? `${detail.data.form_name} — ${detail.data.cycle_label}` : "Performance Cycle"} onClose={onClose} widthClassName="max-w-3xl">
      <div className="p-5 space-y-5">
        {detail.isLoading ? (
          <ModalBodySkeleton />
        ) : detail.error || !detail.data ? (
          <ErrorState message="Could not load this performance cycle." />
        ) : (
          <PerformanceCycleDetailBody detail={detail.data} />
        )}
      </div>
    </Modal>
  );
}

function PerformanceCycleDetailBody({ detail }: { detail: PerformanceCycleDetail }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={PERFORMANCE_STATUS_BADGE[detail.status] ?? "default"}>{detail.status}</Badge>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            Appraiser: {detail.appraiser_employee_id} · Published {detail.published_on ?? "—"} · Ends {detail.form_end_date ?? "—"}
          </span>
        </div>
        {detail.total_score !== null ? (
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Total Score</p>
              <p className="text-lg font-semibold text-gray-700 dark:text-gray-300 tabular-nums">{detail.total_score}/400</p>
            </div>
            {detail.performance_rating_code && (
              <Badge variant={PERFORMANCE_GRADE_BADGE[detail.performance_rating_code] ?? "default"}>
                {detail.performance_rating_code}: {detail.performance_rating_label}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">Cycle still in progress — no final score yet.</span>
        )}
      </div>

      <PerformanceStageTracker stages={detail.stage_tracker} />

      {detail.sections.map((section) => (
        <div key={section.category} className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">{section.category}</p>
          <div className="rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="grid grid-cols-4 gap-2 bg-gray-50 dark:bg-gray-800/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
              <span>KRA &amp; KPI</span>
              <span>Goal</span>
              <span>Appraisee Rating</span>
              <span>Appraiser Rating</span>
            </div>
            {section.items.map((item) => (
              <div key={item.kra_name} className="grid grid-cols-4 gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-gray-800 text-xs">
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
                    {item.kra_name}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
                      wt {item.weight}
                    </span>
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{item.kra_kpi_description}</p>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{item.goal_text}</p>
                <PerformanceRatingCell text={item.appraisee_rating_text} score={item.appraisee_score} />
                <PerformanceRatingCell text={item.appraiser_rating_text} score={item.appraiser_score} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {(detail.overall_appraiser_feedback || detail.overall_areas_of_improvement) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Overall Feedback</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Appraiser Feedback</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{detail.overall_appraiser_feedback}</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Areas of Improvement</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{detail.overall_areas_of_improvement}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PerformanceRatingCell({ text, score }: { text: string; score: number | null }) {
  return (
    <div className="flex items-start gap-2">
      <p className="text-[11px] text-gray-500 dark:text-gray-400 flex-1">{text}</p>
      {score !== null && (
        <span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] font-semibold flex items-center justify-center tabular-nums">
          {score}
        </span>
      )}
    </div>
  );
}

function PerformanceStageTracker({ stages }: { stages: PerformanceStage[] }) {
  return (
    <div className="flex items-start overflow-x-auto pb-1">
      {stages.map((s, i) => (
        <div key={s.stage} className="flex items-center">
          <div className="flex flex-col items-center gap-1 w-[92px] shrink-0">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                s.state === "complete" && "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400",
                s.state === "current" && "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400",
                s.state === "pending" && "bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600"
              )}
            >
              {s.state === "complete" ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : s.state === "current" ? (
                <Clock className="w-3.5 h-3.5" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
              )}
            </div>
            <p className={cn("text-[9.5px] text-center leading-tight", s.state === "pending" ? "text-gray-300 dark:text-gray-600" : "text-gray-500 dark:text-gray-400")}>
              {s.stage}
            </p>
            <p className="text-[9px] text-gray-300 dark:text-gray-600">{s.assignee_employee_id}</p>
          </div>
          {i < stages.length - 1 && (
            <div className={cn("h-px w-4 shrink-0 -mt-4", s.state === "pending" ? "bg-gray-100 dark:bg-gray-800" : "bg-emerald-200 dark:bg-emerald-700")} />
          )}
        </div>
      ))}
    </div>
  );
}

type TimesheetSort = "date_desc" | "date_asc" | "hours_desc";

function TimesheetTab({ employeeId }: { employeeId: string }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [billingStatus, setBillingStatus] = useState("all");
  const [sort, setSort] = useState<TimesheetSort>("date_desc");
  const [openPulse, setOpenPulse] = useState<WeeklyPulseWeek | null>(null);

  const ts = useQuery({
    queryKey: ["employee-timesheet", employeeId, startDate, endDate, projectId, billingStatus],
    queryFn: () =>
      api.employeeTimesheet(employeeId, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        projectId: projectId === "all" ? undefined : projectId,
        billingStatus: billingStatus === "all" ? undefined : billingStatus,
      }),
  });
  const pulse = useQuery({
    queryKey: ["employee-pulse", employeeId],
    queryFn: () => api.employeePulse(employeeId),
  });

  if (ts.isLoading) return <TableSkeleton columns={5} rows={6} />;
  if (ts.error || !ts.data) return <ErrorState message="Could not load timesheet data for this employee." />;
  const data = ts.data;

  function pulseForDate(date: string): WeeklyPulseWeek | undefined {
    return pulse.data?.find((p) => date >= p.week_start_date && date <= p.week_end_date);
  }

  const rows: EmployeeTimesheetRow[] = [...data.rows];
  switch (sort) {
    case "date_desc": rows.sort((a, b) => b.date.localeCompare(a.date)); break;
    case "date_asc": rows.sort((a, b) => a.date.localeCompare(b.date)); break;
    case "hours_desc": rows.sort((a, b) => b.hours - a.hours); break;
  }

  const billingOptions = Object.keys(data.by_billing_status);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Real day-by-day timesheet entries for this employee
        {data.data_start_date && data.data_end_date && ` — data available ${data.data_start_date} → ${data.data_end_date}`}.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">From</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            min={data.data_start_date ?? undefined}
            max={data.data_end_date ?? undefined}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">To</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={data.data_start_date ?? undefined}
            max={data.data_end_date ?? undefined}
            className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
          />
        </div>
        {(startDate || endDate) && (
          <button
            onClick={() => { setStartDate(""); setEndDate(""); }}
            className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline"
          >
            Clear dates
          </button>
        )}
      </div>

      <TableControls
        filters={[
          { value: projectId, onChange: setProjectId, options: [["all", "All projects"], ...data.available_projects.map((p) => [p, p] as [string, string])] },
          { value: billingStatus, onChange: setBillingStatus, options: [["all", "All billing status"], ...billingOptions.map((b) => [b, b] as [string, string])] },
        ]}
        sort={{
          value: sort,
          onChange: (v) => setSort(v as TimesheetSort),
          options: [
            ["date_desc", "Latest day first"],
            ["date_asc", "Earliest day first"],
            ["hours_desc", "Most hours first"],
          ],
        }}
      />

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">No timesheet entries match the current filters.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Total hours</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.total_hours}h</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Days logged</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.days_logged}</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Avg hrs/day logged</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.avg_hours_per_logged_day}h</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Entries</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{data.entry_count}</p>
            </div>
          </div>

          {data.by_project.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {data.by_project.map((p) => (
                <span key={p.project_id} className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {p.project_id}: {p.hours}h
                </span>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden max-h-96 overflow-y-auto scrollbar-thin">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0">
                  <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Date</th>
                    <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Project</th>
                    <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Hours</th>
                    <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Status</th>
                    <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Billing</th>
                    <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Weekly Pulse</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rowPulse = pulseForDate(r.date);
                    return (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.date}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{r.project_id}</td>
                      <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.hours}h</td>
                      <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.status}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap"><Badge variant={r.billing_status.toLowerCase()}>{r.billing_status}</Badge></td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {rowPulse ? (
                          <button
                            onClick={() => setOpenPulse(rowPulse)}
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border font-medium hover:opacity-75 transition",
                              rowPulse.is_not_happy ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-400" : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400"
                            )}
                          >
                            Weekly Pulse
                          </button>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {openPulse && (
        <Modal
          title={`Weekly Pulse — ${openPulse.week_start_date} → ${openPulse.week_end_date}`}
          onClose={() => setOpenPulse(null)}
          widthClassName="max-w-lg"
        >
          <div className="p-4 space-y-2.5">
            {openPulse.answers.map((a, i) => (
              <div key={i} className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.question}</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-0.5">{a.meaning}</p>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// Maps every real skill_source/competency_source value this app writes to a
// human label + color -- so the table shows exactly where a row came from
// (real skill/competency matrix, a resume upload, a LinkedIn PDF, or one of
// the imputation fallbacks) instead of collapsing everything non-"observed"
// into a generic "inferred".
const SOURCE_TAG_META: Record<string, { label: string; className: string }> = {
  observed: { label: "Skill Matrix", className: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400" },
  resume_extracted: { label: "Resume", className: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-600 dark:text-blue-400" },
  linkedin_extracted: { label: "LinkedIn", className: "bg-[#E8F1FB] border-[#0A66C2]/30 text-[#0A66C2]" },
  imputed_peer: { label: "Peer-imputed", className: "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500" },
  imputed_default: { label: "Org-default", className: "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500" },
  imputed_tenure_proxy: { label: "Tenure proxy", className: "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500" },
};

function SourceTag({ value }: { value: string }) {
  const meta = SOURCE_TAG_META[value] ?? { label: value.replace(/_/g, " "), className: "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500" };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap", meta.className)}>
      {meta.label}
    </span>
  );
}
