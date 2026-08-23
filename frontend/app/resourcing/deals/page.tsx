"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Sparkles, SlidersHorizontal, XCircle, Users, List } from "lucide-react";
import {
  api,
  DEFAULT_INCLUDE_PARAMS,
  type DealCompositionRow,
  type DealSummary,
  type EmployeeProjectHistoryRow,
  type IncludeParams,
  type PipelineDemandRow,
  type RecommendationCandidate,
  type RecommendationResult,
  type SemanticMatchResult,
  type TeamRoleResult,
} from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { HoldChip, HoldDot } from "@/components/shared/HoldFlag";
import { LoadingState, ErrorState } from "@/components/shared/EmptyState";
import { Skeleton, ListSkeleton, FieldGridSkeleton, CandidateCardSkeleton } from "@/components/shared/Skeleton";
import { EmployeeProfileModal, type ProfileTab, type SkillMatchContext } from "@/components/shared/EmployeeProfileModal";
import { Modal } from "@/components/shared/Modal";
import {
  type CandidateSignalFilter,
  type SkillDataFilter,
  type CandidateSort,
  type CandidateFilterOptions,
  SIGNAL_FILTER_TO_BUCKET,
  SKILL_DATA_LABEL,
  SIGNAL_LABEL,
  UNKNOWN_COE,
  friendlyConfidence,
  normalizeLabel,
  matchesNormalized,
  buildNormalizedOptions,
  filterAndSortCandidates,
  ADVANCED_PARAMS,
} from "@/components/shared/candidateFilters";
import { AdvancedFiltersButton, AdvancedFiltersPanel, RangeFilter, FilterSelect } from "@/components/shared/AdvancedFilters";
import { CandidateRow, ProjectHistoryModal } from "@/components/shared/CandidateRow";
import { RoleRecommendationDetail } from "@/components/shared/RoleRecommendationDetail";
import { cn } from "@/lib/utils";

type DemandSort = "date_asc" | "date_desc" | "client_asc" | "cluster_asc" | "priority_desc" | "status_asc";
type StartConfirmedFilter = "all" | "confirmed" | "unconfirmed";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, complete: 4 };
const STATUS_RANK: Record<string, number> = { "not resourced": 0, "part resourced": 1, resourced: 2, complete: 3 };

function rankOf(map: Record<string, number>, value: string | null): number {
  return map[normalizeLabel(value).toLowerCase()] ?? 99;
}

export default function RecommendationsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <RecommendationsPageInner />
    </Suspense>
  );
}

type ViewMode = "by-role" | "by-project";

function RecommendationsPageInner() {
  const [viewMode, setViewMode] = useState<ViewMode>("by-project");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [openProfile, setOpenProfile] = useState<{ employeeId: string; tab: ProfileTab; skillMatchContext?: SkillMatchContext } | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // JIN's 6-step Project Edit wizard lives at its own isolated route
  // (/resourcing/[dealKey]) instead of local state here -- clicking a deal
  // below navigates there via router.push, so a refresh mid-wizard re-enters
  // straight at that deal instead of dropping back to this picker and forcing
  // a re-find through the whole deal list.

  useEffect(() => {
    const row = searchParams.get("row");
    if (row !== null && !Number.isNaN(Number(row))) setSelectedRow(Number(row));
  }, []);

  const [demandFiltersOpen, setDemandFiltersOpen] = useState(false);
  const [demandSearch, setDemandSearch] = useState("");
  const [demandSowFilter, setDemandSowFilter] = useState<"all" | "signed" | "unconfirmed">("all");
  const [demandLateOnly, setDemandLateOnly] = useState(false);
  const [demandCluster, setDemandCluster] = useState("all");
  const [demandDateFrom, setDemandDateFrom] = useState("");
  const [demandDateTo, setDemandDateTo] = useState("");
  const [demandStatus, setDemandStatus] = useState("all");
  const [demandPriority, setDemandPriority] = useState("all");
  const [demandClientPriority, setDemandClientPriority] = useState("all");
  const [demandRequestType, setDemandRequestType] = useState("all");
  const [demandStage, setDemandStage] = useState("all");
  const [demandStartConfirmed, setDemandStartConfirmed] = useState<StartConfirmedFilter>("all");
  const [demandSort, setDemandSort] = useState<DemandSort>("date_asc");

  // All 5 ranking parameters (skill, competency, availability, category match,
  // project count) are independently selectable in Advanced Filters -- the
  // selected subset gets its base weights renormalized to sum to 1.0, see
  // composite_score_v2() in scoring.py. Shared across both By Role and By
  // Project views (one panel governs ranking parameters regardless of view) --
  // and now also across every role tab within a project, so switching roles
  // doesn't reset your chosen ranking parameters.
  const [includeParams, setIncludeParams] = useState<IncludeParams>(DEFAULT_INCLUDE_PARAMS);
  // Separate from includeParams: a hard pool gate, not a ranking weight. Off by
  // default -- someone who can't actually take the requested % stays out of
  // Candidates regardless of which ranking parameters are selected.
  const [includeBelowCapacity, setIncludeBelowCapacity] = useState(false);
  // How many points below the requested % still counts as a real, actionable
  // option in the main Candidates list (not a fixed number -- fully adjustable
  // via the Advanced Filters slider). Shared across By Role and By Project,
  // same pattern as includeBelowCapacity above.
  const [nearCapacityTolerancePct, setNearCapacityTolerancePct] = useState(25);
  // Another pool-composition gate, not a ranking weight: whether resume/
  // LinkedIn-derived skill & competency rows feed the match at all. On by
  // default -- they're already discounted below verified data -- but an RM
  // can turn this off to rank purely on the org's verified records.
  const [includeResumeLinkedin, setIncludeResumeLinkedin] = useState(true);

  const [pipelineCollapsed, setPipelineCollapsed] = useState(false);

  // Project-mode state
  const [selectedDealKey, setSelectedDealKey] = useState<string | null>(null);
  const [dealListSearch, setDealListSearch] = useState("");
  const [dealListPriority, setDealListPriority] = useState("all");
  const [dealListStatus, setDealListStatus] = useState("all");
  const [dealListCluster, setDealListCluster] = useState("all");
  const [dealListClientPriority, setDealListClientPriority] = useState("all");
  const [dealListRequestType, setDealListRequestType] = useState("all");
  const [dealListStage, setDealListStage] = useState("all");
  const [dealListStartConfirmed, setDealListStartConfirmed] = useState<"all" | "confirmed" | "unconfirmed">("all");
  const [dealListDateFrom, setDealListDateFrom] = useState("");
  const [dealListDateTo, setDealListDateTo] = useState("");
  const [dealListLateOnly, setDealListLateOnly] = useState(false);
  const [dealListSow, setDealListSow] = useState<"all" | "signed" | "unconfirmed">("all");
  const [dealListSort, setDealListSort] = useState<"date_asc" | "date_desc" | "client_asc" | "cluster_asc" | "priority_desc" | "role_count_desc" | "status_asc">("date_asc");
  const [dealListFiltersOpen, setDealListFiltersOpen] = useState(false);

  // On narrow screens the two panels stack instead of sitting side by side, so picking
  // a deal from a 293-row list otherwise leaves the recommendation buried below it --
  // collapse the list out of the way so the result is the first thing visible. Desktop
  // already shows both panels at once side by side, so this only fires under the lg
  // breakpoint (matches the grid's own lg:grid-cols switch below).
  const handleSelectRow = (rowIndex: number) => {
    setSelectedRow(rowIndex);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setPipelineCollapsed(true);
    }
  };

  const pipeline = useQuery({ queryKey: ["pipeline-forecast"], queryFn: api.pipelineForecast });
  const [coverageEnabled, setCoverageEnabled] = useState(false);
  const coverage = useQuery({
    queryKey: ["recommendations-coverage-summary"],
    queryFn: api.recommendationsCoverageSummary,
    enabled: coverageEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const dealsQuery = useQuery({
    queryKey: ["deals"],
    queryFn: api.listDeals,
    enabled: viewMode === "by-project",
  });

  if (pipeline.isLoading) return <RecommendationsSkeleton />;
  if (pipeline.error) return <ErrorState message="Could not load pipeline demand." />;

  // Deal list filter options
  const allDeals = dealsQuery.data ?? [];
  const dealClusters = Array.from(new Set(allDeals.map((d) => d.cluster).filter((c): c is number => c != null))).sort((a, b) => a - b);
  const dealPriorityOptions = buildNormalizedOptions(allDeals.map((d) => d.priority));
  const dealStatusOptions = buildNormalizedOptions(allDeals.map((d) => d.status));
  const dealClientPriorityOptions = buildNormalizedOptions(allDeals.map((d) => d.client_priority));
  const dealRequestTypeOptions = buildNormalizedOptions(allDeals.map((d) => d.request_type));
  const dealStageOptions = buildNormalizedOptions(allDeals.map((d) => d.deal_stage_hubspot));
  const filteredDeals = filterAndSortDeals(allDeals, {
    search: dealListSearch,
    priority: dealListPriority,
    status: dealListStatus,
    cluster: dealListCluster,
    clientPriority: dealListClientPriority,
    requestType: dealListRequestType,
    stage: dealListStage,
    startConfirmed: dealListStartConfirmed,
    dateFrom: dealListDateFrom,
    dateTo: dealListDateTo,
    lateOnly: dealListLateOnly,
    sow: dealListSow,
    sort: dealListSort,
  });
  const dealFilterCount = [
    dealListPriority !== "all",
    dealListStatus !== "all",
    dealListCluster !== "all",
    dealListClientPriority !== "all",
    dealListRequestType !== "all",
    dealListStage !== "all",
    dealListStartConfirmed !== "all",
    dealListDateFrom !== "",
    dealListDateTo !== "",
    dealListLateOnly,
    dealListSow !== "all",
  ].filter(Boolean).length;
  const clearDealFilters = () => {
    setDealListSearch("");
    setDealListPriority("all");
    setDealListStatus("all");
    setDealListCluster("all");
    setDealListClientPriority("all");
    setDealListRequestType("all");
    setDealListStage("all");
    setDealListStartConfirmed("all");
    setDealListDateFrom("");
    setDealListDateTo("");
    setDealListLateOnly(false);
    setDealListSow("all");
  };

  const demandRows = (pipeline.data ?? []).filter((r) => r.skillset || r.resources_requested);

  const clusters = Array.from(new Set(demandRows.map((r) => r.cluster).filter((c): c is number => c != null))).sort(
    (a, b) => a - b
  );
  const statusOptions = buildNormalizedOptions(demandRows.map((r) => r.status));
  const priorityOptions = buildNormalizedOptions(demandRows.map((r) => r.priority));
  const clientPriorityOptions = buildNormalizedOptions(demandRows.map((r) => r.client_priority));
  const requestTypeOptions = buildNormalizedOptions(demandRows.map((r) => r.request_type));
  const stageOptions = buildNormalizedOptions(demandRows.map((r) => r.deal_stage_hubspot));

  const filteredDemandRows = filterAndSortDemand(demandRows, {
    search: demandSearch,
    sowFilter: demandSowFilter,
    lateOnly: demandLateOnly,
    cluster: demandCluster,
    dateFrom: demandDateFrom,
    dateTo: demandDateTo,
    status: demandStatus,
    priority: demandPriority,
    clientPriority: demandClientPriority,
    requestType: demandRequestType,
    stage: demandStage,
    startConfirmed: demandStartConfirmed,
    sort: demandSort,
  });
  const hasActiveDemandFilters =
    demandSearch !== "" ||
    demandSowFilter !== "all" ||
    demandLateOnly ||
    demandCluster !== "all" ||
    demandDateFrom !== "" ||
    demandDateTo !== "" ||
    demandStatus !== "all" ||
    demandPriority !== "all" ||
    demandClientPriority !== "all" ||
    demandRequestType !== "all" ||
    demandStage !== "all" ||
    demandStartConfirmed !== "all";
  const demandFilterCount = [
    demandSowFilter !== "all",
    demandLateOnly,
    demandCluster !== "all",
    demandDateFrom !== "",
    demandDateTo !== "",
    demandStatus !== "all",
    demandPriority !== "all",
    demandClientPriority !== "all",
    demandRequestType !== "all",
    demandStage !== "all",
    demandStartConfirmed !== "all",
  ].filter(Boolean).length;
  const clearDemandFilters = () => {
    setDemandSearch("");
    setDemandSowFilter("all");
    setDemandLateOnly(false);
    setDemandCluster("all");
    setDemandDateFrom("");
    setDemandDateTo("");
    setDemandStatus("all");
    setDemandPriority("all");
    setDemandClientPriority("all");
    setDemandRequestType("all");
    setDemandStage("all");
    setDemandStartConfirmed("all");
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode("by-project")}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition",
            viewMode === "by-project"
              ? "bg-primary text-white border-primary"
              : "bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700"
          )}
        >
          <Users className="w-3.5 h-3.5" />
          By Project
        </button>
        <button
          onClick={() => setViewMode("by-role")}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition",
            viewMode === "by-role"
              ? "bg-primary text-white border-primary"
              : "bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700"
          )}
        >
          <List className="w-3.5 h-3.5" />
          By Role
        </button>
        {viewMode === "by-role" && (
          <div className="ml-3 flex items-center gap-3 text-xs flex-wrap">
            {coverage.data ? (
              <>
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  Pipeline coverage across {coverage.data.total_demand_rows} role-requests:
                </span>
                <Badge variant="eligible">{coverage.data.redeploy_ready_count} ready to redeploy</Badge>
                <Badge variant="trainable">{coverage.data.redeploy_with_training_count} need upskilling</Badge>
                <Badge variant="gap">{coverage.data.hire_signal_count} ({coverage.data.hire_signal_pct}%) need external hire</Badge>
                {coverage.data.no_skillset_specified_count > 0 && (
                  <Badge variant="pending">{coverage.data.no_skillset_specified_count} no skillset specified yet</Badge>
                )}
              </>
            ) : coverage.isFetching ? (
              <span className="text-gray-400 italic dark:text-gray-500">Computing pipeline coverage…</span>
            ) : (
              <button
                onClick={() => setCoverageEnabled(true)}
                className="text-gray-400 hover:text-primary underline underline-offset-2 text-[11px] dark:text-gray-500"
              >
                Load pipeline coverage stats
              </button>
            )}
          </div>
        )}
      </div>

      {/* Project-based view */}
      {viewMode === "by-project" && (
        <div className={cn("grid grid-cols-1 gap-4", pipelineCollapsed ? "lg:grid-cols-[44px_1fr]" : "lg:grid-cols-[320px_1fr]")}>
          {/* Left: Deal list */}
          {pipelineCollapsed ? (
            <>
              <button
                onClick={() => setPipelineCollapsed(false)}
                className="lg:hidden sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm text-left dark:border-gray-700 dark:bg-gray-900"
              >
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Deals ({allDeals.length})</span>
                <span className="flex items-center gap-1 text-[11px] text-primary flex-shrink-0">Tap to view <ChevronDown className="w-3.5 h-3.5" /></span>
              </button>
              <div className="hidden lg:flex rounded-xl border border-gray-200 bg-white flex-col items-center gap-3 py-3 lg:max-h-[calc(100dvh-180px)] dark:border-gray-700 dark:bg-gray-900">
                <button onClick={() => setPipelineCollapsed(false)} title="Expand deal list" className="text-gray-400 hover:text-primary transition dark:text-gray-500">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <p className="text-[10px] text-gray-400 whitespace-nowrap [writing-mode:vertical-rl] dark:text-gray-500">Deals ({allDeals.length})</p>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col lg:max-h-[calc(100dvh-180px)] dark:border-gray-700 dark:bg-gray-900">
              <div className="px-3 py-2.5 border-b border-gray-100 space-y-2 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setPipelineCollapsed(true)} title="Collapse deal list" className="text-gray-400 hover:text-primary transition flex-shrink-0 dark:text-gray-500">
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Deals ({filteredDeals.length}/{allDeals.length})</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(dealListSearch || dealFilterCount > 0) && (
                      <button onClick={clearDealFilters} className="text-[11px] text-primary hover:underline whitespace-nowrap">Clear</button>
                    )}
                    <button
                      onClick={() => setDealListFiltersOpen((v) => !v)}
                      className={cn(
                        "flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition",
                        dealListFiltersOpen || dealFilterCount > 0 ? "border-primary/40 text-primary bg-primary/5" : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
                      )}
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      Filters{dealFilterCount > 0 && ` (${dealFilterCount})`}
                      <ChevronDown className={cn("w-3 h-3 transition-transform", dealListFiltersOpen && "rotate-180")} />
                    </button>
                  </div>
                </div>
                <input
                  value={dealListSearch}
                  onChange={(e) => setDealListSearch(e.target.value)}
                  placeholder="Search client, solution, role…"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-gray-300 dark:border-gray-700 dark:focus:border-gray-600"
                />
                {dealListFiltersOpen && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-2.5 space-y-2.5 dark:border-gray-800 dark:bg-gray-800/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <FilterSelect label="Status" value={dealListStatus} onChange={setDealListStatus}>
                        <option value="all">All</option>
                        {dealStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </FilterSelect>
                      <FilterSelect label="Priority" value={dealListPriority} onChange={setDealListPriority}>
                        <option value="all">All</option>
                        {dealPriorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                      </FilterSelect>
                      <FilterSelect label="Client priority" value={dealListClientPriority} onChange={setDealListClientPriority}>
                        <option value="all">All</option>
                        {dealClientPriorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                      </FilterSelect>
                      <FilterSelect label="SOW" value={dealListSow} onChange={(v) => setDealListSow(v as typeof dealListSow)}>
                        <option value="all">All</option>
                        <option value="signed">Signed</option>
                        <option value="unconfirmed">Unconfirmed</option>
                      </FilterSelect>
                      <FilterSelect label="Cluster" value={dealListCluster} onChange={setDealListCluster}>
                        <option value="all">All</option>
                        {dealClusters.map((c) => <option key={c} value={String(c)}>Cluster {c}</option>)}
                      </FilterSelect>
                      <FilterSelect label="Request type" value={dealListRequestType} onChange={setDealListRequestType}>
                        <option value="all">All</option>
                        {dealRequestTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                      </FilterSelect>
                      <FilterSelect label="Deal stage" value={dealListStage} onChange={setDealListStage}>
                        <option value="all">All</option>
                        {dealStageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </FilterSelect>
                      <FilterSelect
                        label="Start confirmed"
                        value={dealListStartConfirmed}
                        onChange={(v) => setDealListStartConfirmed(v as typeof dealListStartConfirmed)}
                      >
                        <option value="all">All</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="unconfirmed">Unconfirmed</option>
                      </FilterSelect>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-400 block mb-0.5 dark:text-gray-500">Likely start from</label>
                        <input
                          type="date"
                          value={dealListDateFrom}
                          onChange={(e) => setDealListDateFrom(e.target.value)}
                          className="w-full text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 block mb-0.5 dark:text-gray-500">Likely start to</label>
                        <input
                          type="date"
                          value={dealListDateTo}
                          onChange={(e) => setDealListDateTo(e.target.value)}
                          className="w-full text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDealListLateOnly((v) => !v)}
                        className={cn(
                          "text-[11px] px-2 py-1.5 rounded-lg border whitespace-nowrap transition",
                          dealListLateOnly ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/60" : "border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                        )}
                      >
                        Late notice only
                      </button>
                      <select
                        value={dealListSort}
                        onChange={(e) => setDealListSort(e.target.value as typeof dealListSort)}
                        className="flex-1 text-[11px] px-1.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                      >
                        <option value="date_asc">Sort: earliest start ↑</option>
                        <option value="date_desc">Sort: earliest start ↓</option>
                        <option value="client_asc">Sort: client A–Z</option>
                        <option value="cluster_asc">Sort: cluster</option>
                        <option value="priority_desc">Sort: priority (urgent first)</option>
                        <option value="role_count_desc">Sort: most roles first</option>
                        <option value="status_asc">Sort: status (not resourced first)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {dealsQuery.isLoading && <p className="text-xs text-gray-400 italic px-3 py-4 text-center dark:text-gray-500">Loading deals…</p>}
                {filteredDeals.map((deal) => (
                  <button
                    key={deal.deal_key}
                    onClick={() => {
                      setSelectedDealKey(deal.deal_key);
                      // Selecting a deal opens its Project Wizard directly, at
                      // its own isolated route -- ProjectWizard resolves
                      // whether this deal already has a linked project (and
                      // jumps to Step 5 if so) or starts a fresh Step 1. The
                      // old "browse this deal's roles" panel that used to
                      // render here duplicated the exact same matching engine
                      // Step 5 shows, minus the ability to actually assign
                      // anyone -- removed rather than kept as a redundant
                      // dead end.
                      router.push(`/resourcing/${encodeURIComponent(deal.deal_key)}`);
                    }}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition dark:border-gray-800 dark:hover:bg-gray-800 ${selectedDealKey === deal.deal_key ? "bg-primary/5" : ""}`}
                  >
                    <p className="text-xs font-medium text-gray-700 truncate dark:text-gray-300">{deal.client ?? "Unnamed client"}{deal.cluster != null && ` · Cluster ${deal.cluster}`}</p>
                    <p className="text-[11px] text-gray-400 truncate dark:text-gray-500">{deal.solution ?? (deal.roles.map((r) => r.resources_requested).filter(Boolean).join(", ") || "No roles specified")}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">{deal.role_count} role{deal.role_count !== 1 ? "s" : ""}</span>
                      {deal.sow_signed ? <Badge variant="billable">SOW signed</Badge> : <Badge variant="pending">unconfirmed</Badge>}
                      {deal.is_late_notice && <Badge variant="red">late notice</Badge>}
                      {deal.priority && <Badge variant="default">{deal.priority}</Badge>}
                      {deal.earliest_start && <span className="text-[10px] text-gray-400 dark:text-gray-500">{deal.earliest_start}</span>}
                    </div>
                  </button>
                ))}
                {!dealsQuery.isLoading && filteredDeals.length === 0 && (
                  <p className="text-xs text-gray-400 italic px-3 py-4 text-center dark:text-gray-500">No deals match the current filters.</p>
                )}
              </div>
            </div>
          )}

          {/* Right: empty state only -- clicking a deal opens its Project
              Wizard immediately (see the deal button's onClick above), so
              this column only ever shows before anything's been clicked. */}
          <div className="min-w-0">
            <div className="h-64 flex items-center justify-center text-gray-300 text-sm dark:text-gray-600">Select a deal to open its Project Wizard</div>
          </div>
        </div>
      )}

      {/* Role-based view */}
      {viewMode === "by-role" && (
      <div className={cn("grid grid-cols-1 gap-4", pipelineCollapsed ? "lg:grid-cols-[44px_1fr]" : "lg:grid-cols-[320px_1fr]")}>
        {pipelineCollapsed ? (
          <>
            {/* Mobile: a sticky horizontal bar, always reachable without scrolling back up. */}
            <button
              onClick={() => setPipelineCollapsed(false)}
              className="lg:hidden sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm text-left dark:border-gray-700 dark:bg-gray-900"
            >
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Pipeline Demand ({demandRows.length})</span>
              <span className="flex items-center gap-1 text-[11px] text-primary flex-shrink-0">
                Tap to view <ChevronDown className="w-3.5 h-3.5" />
              </span>
            </button>
            {/* Desktop: thin vertical strip alongside the detail panel. */}
            <div className="hidden lg:flex rounded-xl border border-gray-200 bg-white flex-col items-center gap-3 py-3 lg:max-h-[calc(100dvh-180px)] dark:border-gray-700 dark:bg-gray-900">
              <button
                onClick={() => setPipelineCollapsed(false)}
                title="Expand pipeline list"
                className="text-gray-400 hover:text-primary transition dark:text-gray-500"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <p className="text-[10px] text-gray-400 whitespace-nowrap [writing-mode:vertical-rl] dark:text-gray-500">
                Pipeline ({demandRows.length})
              </p>
            </div>
          </>
        ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col lg:max-h-[calc(100dvh-180px)] dark:border-gray-700 dark:bg-gray-900">
          <div className="px-3 py-2.5 border-b border-gray-100 space-y-2 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPipelineCollapsed(true)}
                  title="Collapse pipeline list"
                  className="text-gray-400 hover:text-primary transition flex-shrink-0 dark:text-gray-500"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Pipeline Demand ({filteredDemandRows.length}/{demandRows.length})
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasActiveDemandFilters && (
                  <button onClick={clearDemandFilters} className="text-[11px] text-primary hover:underline whitespace-nowrap">
                    Clear filters
                  </button>
                )}
                <button
                  onClick={() => setDemandFiltersOpen((v) => !v)}
                  className={cn(
                    "flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition",
                    demandFiltersOpen || demandFilterCount > 0
                      ? "border-primary/40 text-primary bg-primary/5"
                      : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
                  )}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  Filters{demandFilterCount > 0 && ` (${demandFilterCount})`}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", demandFiltersOpen && "rotate-180")} />
                </button>
              </div>
            </div>
            <input
              value={demandSearch}
              onChange={(e) => setDemandSearch(e.target.value)}
              placeholder="Search client, role, skill, solution…"
              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-gray-300 dark:border-gray-700 dark:focus:border-gray-600"
            />
            {demandFiltersOpen && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-2.5 space-y-2.5 dark:border-gray-800 dark:bg-gray-800/60">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <FilterSelect label="Status" value={demandStatus} onChange={setDemandStatus}>
                    <option value="all">All</option>
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </FilterSelect>
                  <FilterSelect label="Priority" value={demandPriority} onChange={setDemandPriority}>
                    <option value="all">All</option>
                    {priorityOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </FilterSelect>
                  <FilterSelect label="Client priority" value={demandClientPriority} onChange={setDemandClientPriority}>
                    <option value="all">All</option>
                    {clientPriorityOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </FilterSelect>
                  <FilterSelect
                    label="SOW"
                    value={demandSowFilter}
                    onChange={(v) => setDemandSowFilter(v as typeof demandSowFilter)}
                  >
                    <option value="all">All</option>
                    <option value="signed">Signed</option>
                    <option value="unconfirmed">Unconfirmed</option>
                  </FilterSelect>
                  <FilterSelect label="Cluster" value={demandCluster} onChange={setDemandCluster}>
                    <option value="all">All</option>
                    {clusters.map((c) => (
                      <option key={c} value={String(c)}>Cluster {c}</option>
                    ))}
                  </FilterSelect>
                  <FilterSelect label="Request type" value={demandRequestType} onChange={setDemandRequestType}>
                    <option value="all">All</option>
                    {requestTypeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </FilterSelect>
                  <FilterSelect label="Deal stage" value={demandStage} onChange={setDemandStage}>
                    <option value="all">All</option>
                    {stageOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </FilterSelect>
                  <FilterSelect
                    label="Start confirmed"
                    value={demandStartConfirmed}
                    onChange={(v) => setDemandStartConfirmed(v as StartConfirmedFilter)}
                  >
                    <option value="all">All</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="unconfirmed">Unconfirmed</option>
                  </FilterSelect>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5 dark:text-gray-500">Likely start from</label>
                    <input
                      type="date"
                      value={demandDateFrom}
                      onChange={(e) => setDemandDateFrom(e.target.value)}
                      className="w-full text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5 dark:text-gray-500">Likely start to</label>
                    <input
                      type="date"
                      value={demandDateTo}
                      onChange={(e) => setDemandDateTo(e.target.value)}
                      className="w-full text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDemandLateOnly((v) => !v)}
                    className={cn(
                      "text-[11px] px-2 py-1.5 rounded-lg border whitespace-nowrap transition",
                      demandLateOnly ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/60" : "border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                    )}
                  >
                    Late notice only
                  </button>
                  <select
                    value={demandSort}
                    onChange={(e) => setDemandSort(e.target.value as DemandSort)}
                    className="flex-1 text-[11px] px-1.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                  >
                    <option value="date_asc">Sort: start date ↑</option>
                    <option value="date_desc">Sort: start date ↓</option>
                    <option value="client_asc">Sort: client A–Z</option>
                    <option value="cluster_asc">Sort: cluster</option>
                    <option value="priority_desc">Sort: priority (urgent first)</option>
                    <option value="status_asc">Sort: status (not resourced first)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {filteredDemandRows.map((r) => (
              <button
                key={r.row_index}
                onClick={() => handleSelectRow(r.row_index)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition dark:border-gray-800 dark:hover:bg-gray-800 ${selectedRow === r.row_index ? "bg-primary/5" : ""}`}
              >
                <p className="text-xs font-medium text-gray-700 truncate dark:text-gray-300">{r.resources_requested ?? "Role TBD"} · {r.client ?? "Unnamed client"}</p>
                <p className="text-[11px] text-gray-400 truncate dark:text-gray-500">{r.skillset ?? r.solution ?? "No skillset specified"}</p>
                {(r.client_priority || r.cluster != null) && (
                  <p className="text-[10px] text-gray-400 mt-0.5 dark:text-gray-500">
                    {r.client_priority && `Priority ${r.client_priority}`}
                    {r.client_priority && r.cluster != null && " · "}
                    {r.cluster != null && `Cluster ${r.cluster}`}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {r.sow_signed === "Yes" ? <Badge variant="billable">SOW signed</Badge> : <Badge variant="pending">unconfirmed</Badge>}
                  {r.is_late_notice && <Badge variant="red">late notice</Badge>}
                  {r.skillset_coe_categories.map((cat) => (
                    <span key={cat} title="Real skill category, exact-matched from the Pipeline Skillset reference sheet" className="text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
                      {cat}
                    </span>
                  ))}
                  {r.likely_start_date && <span className="text-[10px] text-gray-400 dark:text-gray-500">{r.likely_start_date}</span>}
                </div>
              </button>
            ))}
            {filteredDemandRows.length === 0 && (
              <p className="text-xs text-gray-400 italic px-3 py-4 text-center dark:text-gray-500">No pipeline rows match the current filters.</p>
            )}
          </div>
        </div>
        )}

        <div className="min-w-0">
          {selectedRow === null ? (
            <div className="h-64 flex items-center justify-center text-gray-300 text-sm dark:text-gray-600">Select a pipeline demand row to see ranked candidates</div>
          ) : (
            <RoleRecommendationDetail
              key={selectedRow}
              rowIndex={selectedRow}
              includeParams={includeParams}
              setIncludeParams={setIncludeParams}
              includeBelowCapacity={includeBelowCapacity}
              setIncludeBelowCapacity={setIncludeBelowCapacity}
              nearCapacityTolerancePct={nearCapacityTolerancePct}
              setNearCapacityTolerancePct={setNearCapacityTolerancePct}
              includeResumeLinkedin={includeResumeLinkedin}
              setIncludeResumeLinkedin={setIncludeResumeLinkedin}
              onOpenProfile={(employeeId, tab, skillMatchContext) => setOpenProfile({ employeeId, tab, skillMatchContext })}
              onSelectSibling={handleSelectRow}
            />
          )}
        </div>
      </div>
      )}

      {openProfile && (
        <EmployeeProfileModal
          employeeId={openProfile.employeeId}
          initialTab={openProfile.tab}
          skillMatchContext={openProfile.skillMatchContext}
          onClose={() => setOpenProfile(null)}
        />
      )}
    </div>
  );
}

interface DemandFilterOptions {
  search: string;
  sowFilter: "all" | "signed" | "unconfirmed";
  lateOnly: boolean;
  cluster: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  priority: string;
  clientPriority: string;
  requestType: string;
  stage: string;
  startConfirmed: StartConfirmedFilter;
  sort: DemandSort;
}

function filterAndSortDemand(rows: PipelineDemandRow[], opts: DemandFilterOptions): PipelineDemandRow[] {
  let result = rows;

  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (r) =>
        (r.client ?? "").toLowerCase().includes(q) ||
        (r.resources_requested ?? "").toLowerCase().includes(q) ||
        (r.skillset ?? "").toLowerCase().includes(q) ||
        (r.solution ?? "").toLowerCase().includes(q)
    );
  }
  if (opts.sowFilter === "signed") result = result.filter((r) => r.sow_signed === "Yes");
  if (opts.sowFilter === "unconfirmed") result = result.filter((r) => r.sow_signed !== "Yes");
  if (opts.lateOnly) result = result.filter((r) => r.is_late_notice);
  if (opts.cluster !== "all") result = result.filter((r) => String(r.cluster) === opts.cluster);
  if (opts.dateFrom) result = result.filter((r) => (r.likely_start_date ?? "") >= opts.dateFrom);
  if (opts.dateTo) result = result.filter((r) => (r.likely_start_date ?? "") <= opts.dateTo);
  if (opts.status !== "all") result = result.filter((r) => matchesNormalized(r.status, opts.status));
  if (opts.priority !== "all") result = result.filter((r) => matchesNormalized(r.priority, opts.priority));
  if (opts.clientPriority !== "all") result = result.filter((r) => matchesNormalized(r.client_priority, opts.clientPriority));
  if (opts.requestType !== "all") result = result.filter((r) => matchesNormalized(r.request_type, opts.requestType));
  if (opts.stage !== "all") result = result.filter((r) => matchesNormalized(r.deal_stage_hubspot, opts.stage));
  if (opts.startConfirmed === "confirmed") result = result.filter((r) => matchesNormalized(r.start_date_confirmed, "Yes"));
  if (opts.startConfirmed === "unconfirmed") result = result.filter((r) => !matchesNormalized(r.start_date_confirmed, "Yes"));

  const sorted = [...result];
  switch (opts.sort) {
    case "date_asc":
      sorted.sort((a, b) => (a.likely_start_date ?? "").localeCompare(b.likely_start_date ?? ""));
      break;
    case "date_desc":
      sorted.sort((a, b) => (b.likely_start_date ?? "").localeCompare(a.likely_start_date ?? ""));
      break;
    case "client_asc":
      sorted.sort((a, b) => (a.client ?? "").localeCompare(b.client ?? ""));
      break;
    case "cluster_asc":
      sorted.sort((a, b) => (a.cluster ?? 0) - (b.cluster ?? 0));
      break;
    case "priority_desc":
      sorted.sort((a, b) => rankOf(PRIORITY_RANK, a.priority) - rankOf(PRIORITY_RANK, b.priority));
      break;
    case "status_asc":
      sorted.sort((a, b) => rankOf(STATUS_RANK, a.status) - rankOf(STATUS_RANK, b.status));
      break;
  }
  return sorted;
}


interface DealFilterOptions {
  search: string;
  priority: string;
  status: string;
  cluster: string;
  clientPriority: string;
  requestType: string;
  stage: string;
  startConfirmed: "all" | "confirmed" | "unconfirmed";
  dateFrom: string;
  dateTo: string;
  lateOnly: boolean;
  sow: "all" | "signed" | "unconfirmed";
  sort: "date_asc" | "date_desc" | "client_asc" | "cluster_asc" | "priority_desc" | "role_count_desc" | "status_asc";
}

function filterAndSortDeals(deals: DealSummary[], opts: DealFilterOptions): DealSummary[] {
  let result = deals;
  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (d) =>
        (d.client ?? "").toLowerCase().includes(q) ||
        (d.solution ?? "").toLowerCase().includes(q) ||
        d.roles.some((r) => (r.resources_requested ?? "").toLowerCase().includes(q)) ||
        d.roles.some((r) => (r.skillset ?? "").toLowerCase().includes(q))
    );
  }
  if (opts.priority !== "all") result = result.filter((d) => matchesNormalized(d.priority, opts.priority));
  if (opts.status !== "all") result = result.filter((d) => matchesNormalized(d.status, opts.status));
  if (opts.cluster !== "all") result = result.filter((d) => String(d.cluster) === opts.cluster);
  if (opts.clientPriority !== "all") result = result.filter((d) => matchesNormalized(d.client_priority, opts.clientPriority));
  if (opts.requestType !== "all") result = result.filter((d) => matchesNormalized(d.request_type, opts.requestType));
  if (opts.stage !== "all") result = result.filter((d) => matchesNormalized(d.deal_stage_hubspot, opts.stage));
  if (opts.startConfirmed === "confirmed") result = result.filter((d) => matchesNormalized(d.start_date_confirmed, "Yes"));
  if (opts.startConfirmed === "unconfirmed") result = result.filter((d) => !matchesNormalized(d.start_date_confirmed, "Yes"));
  if (opts.dateFrom) result = result.filter((d) => (d.earliest_start ?? "") >= opts.dateFrom);
  if (opts.dateTo) result = result.filter((d) => (d.earliest_start ?? "") <= opts.dateTo);
  if (opts.lateOnly) result = result.filter((d) => d.is_late_notice);
  if (opts.sow === "signed") result = result.filter((d) => d.sow_signed);
  if (opts.sow === "unconfirmed") result = result.filter((d) => !d.sow_signed);

  const sorted = [...result];
  switch (opts.sort) {
    case "date_asc":
      sorted.sort((a, b) => (a.earliest_start ?? "9999").localeCompare(b.earliest_start ?? "9999"));
      break;
    case "date_desc":
      sorted.sort((a, b) => (b.earliest_start ?? "0000").localeCompare(a.earliest_start ?? "0000"));
      break;
    case "client_asc":
      sorted.sort((a, b) => (a.client ?? "").localeCompare(b.client ?? ""));
      break;
    case "cluster_asc":
      sorted.sort((a, b) => (a.cluster ?? 0) - (b.cluster ?? 0));
      break;
    case "priority_desc":
      sorted.sort((a, b) => rankOf(PRIORITY_RANK, a.priority) - rankOf(PRIORITY_RANK, b.priority));
      break;
    case "role_count_desc":
      sorted.sort((a, b) => b.role_count - a.role_count);
      break;
    case "status_asc":
      sorted.sort((a, b) => rankOf(STATUS_RANK, a.status) - rankOf(STATUS_RANK, b.status));
      break;
  }
  return sorted;
}

function RecommendationsSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3 flex-wrap dark:border-gray-700 dark:bg-gray-900">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-5 w-32 rounded-full" />
        <Skeleton className="h-5 w-32 rounded-full" />
        <Skeleton className="h-5 w-32 rounded-full" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden dark:border-gray-700 dark:bg-gray-900">
          <div className="px-3 py-2.5 border-b border-gray-100 space-y-2 dark:border-gray-800">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-full rounded-lg" />
          </div>
          <ListSkeleton rows={7} lines={2} />
        </div>
        <div className="h-64 flex items-center justify-center">
          <Skeleton className="h-3 w-72" />
        </div>
      </div>
    </div>
  );
}
