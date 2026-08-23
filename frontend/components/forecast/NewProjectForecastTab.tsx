"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronUp, X, Search } from "lucide-react";
import {
  api, DEFAULT_INCLUDE_PARAMS,
  type ForecastBreakdownRow, type ForecastSpec, type RecommendationCandidate, type RedeployCandidate,
} from "@/lib/api";
import { ErrorState } from "@/components/shared/EmptyState";
import { Skeleton, TableSkeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { Modal } from "@/components/shared/Modal";
import { HoldDot } from "@/components/shared/HoldFlag";
import { EmployeeProfileModal, cleanSkillLabel, SkillSection, type SkillMatchContext, type ProfileTab } from "@/components/shared/EmployeeProfileModal";
import { Metric, ProjectHistoryModal } from "@/components/shared/CandidateRow";
import { cn, formatUsd } from "@/lib/utils";
import { JMAN, JMAN_HEADER_GRADIENT } from "@/lib/brandColors";

type DurationMixPct = { short: number; mid: number; long: number };

function adjustDurationMix(current: DurationMixPct, changed: keyof DurationMixPct, rawValue: number): DurationMixPct {
  const value = Math.max(0, Math.min(100, Math.round(rawValue)));
  const others = (["short", "mid", "long"] as const).filter((k) => k !== changed);
  const remaining = 100 - value;
  const othersSum = current[others[0]] + current[others[1]];
  const next: DurationMixPct = { ...current, [changed]: value };
  if (othersSum <= 0) {
    next[others[0]] = remaining;
    next[others[1]] = 0;
  } else {
    next[others[0]] = Math.round((current[others[0]] / othersSum) * remaining);
    next[others[1]] = remaining - next[others[0]];
  }
  return next;
}

function levelNoteFor(c: RedeployCandidate): string | undefined {
  if (c.level_offset == null || c.level_offset === 0) return undefined;
  return `${c.level_offset < 0 ? "one level below" : "one level above"} -- ${c.source_designation}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

const TYPE_OPTIONS = ["Client Project", "Internal Project", "Managed Services", "BAU Activity", "Sales Activity"];

const REASON_LABEL: Record<RedeployCandidate["reason"], string> = {
  ending_soon: "ending soon",
  under_utilized: "under-utilized",
  fully_free: "fully free",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  medium: "medium confidence match",
  low: "low confidence match",
  none: "no direct match",
};

function CandidateRow({
  c,
  onOpen,
  levelNote,
  qualifies,
  isTopPick,
}: {
  c: RedeployCandidate;
  onOpen: (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => void;
  levelNote?: string;
  qualifies?: boolean;
  isTopPick?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllMatched, setShowAllMatched] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<{ category?: string } | null>(null);
  const reasonDetail =
    c.reason === "ending_soon" && c.days_to_end != null
      ? `${REASON_LABEL[c.reason]} · ${c.days_to_end}d left`
      : c.reason !== "fully_free" && c.current_allocation_pct != null
      ? `${REASON_LABEL[c.reason]} · ${c.current_allocation_pct}% allocated`
      : REASON_LABEL[c.reason];
  const matchedLabels = (c.matched_skills ?? []).map(cleanSkillLabel).filter(Boolean);
  const missingLabels = (c.missing_skills ?? []).map(cleanSkillLabel).filter(Boolean);
  const open = (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => onOpen(sel);

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition",
        isTopPick ? "border-primary/40 bg-primary/[0.03]" : "border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
      )}
    >
      <button onClick={() => setExpanded((v) => !v)} className="w-full text-left p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {isTopPick && <span className="text-[10px] font-semibold text-primary whitespace-nowrap">Top pick</span>}
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                open({
                  employeeId: c.employee_id,
                  skillMatchContext: c.matched_skills || c.missing_skills ? { matchedSkills: c.matched_skills ?? [], missingSkills: c.missing_skills ?? [] } : undefined,
                });
              }}
              className="font-semibold text-sm text-primary hover:underline truncate"
            >
              {c.employee_id}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.job_name}</span>
            <HoldDot onHold={c.on_hold} holdProjects={c.hold_projects} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {c.composite_score != null && (
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {Math.round(c.composite_score * 100)}% <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500">overall fit</span>
              </span>
            )}
            <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 dark:text-gray-500 transition-transform flex-shrink-0", expanded && "rotate-180")} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          {c.coe && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/60 text-violet-600 dark:text-violet-400 whitespace-nowrap">{c.coe}</span>}
          {levelNote && <Badge variant={qualifies ? "green" : "amber"}>{levelNote}</Badge>}
          <Badge variant={c.reason === "ending_soon" ? "amber" : c.reason === "fully_free" ? "green" : "under_utilized"}>{reasonDetail}</Badge>
          {c.skill_score != null && <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">skill {Math.round(c.skill_score * 100)}%</span>}
          {c.total_projects != null && c.total_projects > 0 && (
            <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap ml-auto">{c.relevant_project_count}/{c.total_projects} relevant projects</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-3.5 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric
              label="Skill"
              value={c.skill_score ?? 0}
              suffix={`${Math.round((c.skill_score ?? 0) * 100)}%`}
              onClick={() => open({ employeeId: c.employee_id, tab: "skills", skillMatchContext: { matchedSkills: c.matched_skills ?? [], missingSkills: c.missing_skills ?? [] } })}
            />
            <Metric
              label="Competency"
              value={c.competency_score ?? 0}
              suffix={`${Math.round((c.competency_score ?? 0) * 100)}%`}
              onClick={() => open({ employeeId: c.employee_id, tab: "competency" })}
            />
            <Metric
              label="Available"
              value={(c.available_pct_as_of ?? 0) / 100}
              suffix={`${c.available_pct_as_of ?? 0}%`}
              onClick={() => open({ employeeId: c.employee_id, tab: "allocations" })}
            />
          </div>

          {(matchedLabels.length > 0 || missingLabels.length > 0) && (
            <div className="space-y-1.5">
              {matchedLabels.length > 0 && (
                <SkillSection labels={matchedLabels} variant="matched" showAll={showAllMatched} onToggle={(e) => { e.stopPropagation(); setShowAllMatched((v) => !v); }} />
              )}
              {missingLabels.length > 0 && (
                <SkillSection labels={missingLabels} variant="missing" showAll={showAllMissing} onToggle={(e) => { e.stopPropagation(); setShowAllMissing((v) => !v); }} />
              )}
            </div>
          )}

          {c.total_projects != null && c.total_projects > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap pt-1 border-t border-gray-100 dark:border-gray-800">
              <span className="text-gray-400 dark:text-gray-500 font-medium flex-shrink-0">Track record</span>
              <button
                onClick={(e) => { e.stopPropagation(); setHistoryFilter({}); }}
                className="px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary"
              >
                {c.total_projects} projects ↗
              </button>
              {c.distinct_clients != null && (
                <button
                  onClick={(e) => { e.stopPropagation(); setHistoryFilter({}); }}
                  className="px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary"
                >
                  {c.distinct_clients} clients ↗
                </button>
              )}
              {(c.top_categories ?? []).map((tc) => (
                <button
                  key={tc.category}
                  onClick={(e) => { e.stopPropagation(); setHistoryFilter({ category: tc.category }); }}
                  className="px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-primary hover:text-primary"
                >
                  {tc.category} ({tc.count}) ↗
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {historyFilter && (
        <ProjectHistoryModal employeeId={c.employee_id} category={historyFilter.category} onClose={() => setHistoryFilter(null)} />
      )}
    </div>
  );
}

// Checkbox-based multi-select filter -- any combination of options can be
// selected at once (empty selection = no filter applied, i.e. "all").
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: [string, string][]; // [value, display label][]
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border whitespace-nowrap transition",
          selected.size > 0 ? "border-primary/40 text-primary bg-primary/5" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600"
        )}
      >
        {label}
        {selected.size > 0 && ` (${selected.size})`}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 min-w-[200px] max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-2 space-y-0.5">
            {options.length === 0 && <p className="text-[11px] text-gray-400 dark:text-gray-500 px-1.5 py-1">No options available.</p>}
            {options.map(([value, optLabel]) => (
              <label key={value} className="flex items-center gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(value)}
                  onChange={() => toggle(value)}
                  className="rounded border-gray-300 dark:border-gray-600 accent-primary"
                />
                <span className="text-gray-700 dark:text-gray-300">{optLabel}</span>
              </label>
            ))}
            {selected.size > 0 && (
              <button
                onClick={() => onChange(new Set())}
                className="w-full text-left text-[10px] text-primary hover:underline pt-1 mt-1 border-t border-gray-100 dark:border-gray-800 px-1.5"
              >
                Clear ({selected.size})
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type RedeploySort = "composite_desc" | "skill_desc" | "competency_desc" | "available_desc";

const REDEPLOY_SORTS: [RedeploySort, string][] = [
  ["composite_desc", "Best overall fit ↓"],
  ["skill_desc", "Skill match ↓"],
  ["competency_desc", "Competency ↓"],
  ["available_desc", "Availability ↓"],
];

function sortRedeployCandidates(candidates: RedeployCandidate[], sort: RedeploySort): RedeployCandidate[] {
  const sorted = [...candidates];
  switch (sort) {
    case "composite_desc": sorted.sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0)); break;
    case "skill_desc": sorted.sort((a, b) => (b.skill_score ?? 0) - (a.skill_score ?? 0)); break;
    case "competency_desc": sorted.sort((a, b) => (b.competency_score ?? 0) - (a.competency_score ?? 0)); break;
    case "available_desc": sorted.sort((a, b) => (b.available_pct_as_of ?? 0) - (a.available_pct_as_of ?? 0)); break;
  }
  return sorted;
}

// Full, non-truncated, searchable/filterable candidate list -- used inside
// RoleDetailPage's tabs, which each have their own dedicated scroll space
// (and now, room for real search/filter controls), unlike the old cramped
// inline table-row expansion this replaced.
function RoleCandidateList({
  candidates,
  onOpen,
  showQualifies,
  emptyText,
  note,
  disableTopPick,
}: {
  candidates: RedeployCandidate[];
  onOpen: (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => void;
  showQualifies?: boolean;
  // Suppress the "Top pick" badge entirely -- used for lists that are shown
  // for reference only and never actually count toward filling the role
  // (e.g. same-title-but-below-skill-threshold), where highlighting a "best"
  // candidate would wrongly imply they're competing with the real shortlist.
  disableTopPick?: boolean;
  emptyText?: string;
  note?: string;
}) {
  const [search, setSearch] = useState("");
  const [coeFilter, setCoeFilter] = useState<Set<string>>(new Set());
  const [reasonFilter, setReasonFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<RedeploySort>("composite_desc");

  if (candidates.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 italic">{emptyText ?? "No candidates in this category."}</p>;
  }

  const coeOptions = Array.from(new Set(candidates.map((c) => c.coe).filter((v): v is string => Boolean(v)))).sort();
  const reasonOptions = Array.from(new Set(candidates.map((c) => c.reason)));

  let filtered = candidates;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((c) => c.employee_id.toLowerCase().includes(q) || c.job_name.toLowerCase().includes(q) || (c.coe ?? "").toLowerCase().includes(q));
  if (coeFilter.size > 0) filtered = filtered.filter((c) => c.coe != null && coeFilter.has(c.coe));
  if (reasonFilter.size > 0) filtered = filtered.filter((c) => reasonFilter.has(c.reason));
  filtered = sortRedeployCandidates(filtered, sort);

  return (
    <div>
      {note && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2.5">{note}</p>}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee ID, role, or CoE…"
          className="flex-1 min-w-[180px] text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 outline-none focus:border-primary/40 bg-white dark:bg-gray-900"
        />
        <MultiSelectFilter label="CoE" options={coeOptions.map((c) => [c, c])} selected={coeFilter} onChange={setCoeFilter} />
        <MultiSelectFilter label="Reason" options={reasonOptions.map((r) => [r, REASON_LABEL[r]])} selected={reasonFilter} onChange={setReasonFilter} />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RedeploySort)}
          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 outline-none"
        >
          {REDEPLOY_SORTS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">No candidates match the current filters.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((c, i) => (
            <CandidateRow
              key={c.employee_id}
              c={c}
              onOpen={onOpen}
              levelNote={levelNoteFor(c)}
              qualifies={showQualifies ? isQualifying(c) : undefined}
              isTopPick={!disableTopPick && i === 0 && sort === "composite_desc" && !q && coeFilter.size === 0 && reasonFilter.size === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Cross-role match / trainable tabs use RecommendationCandidate (org-wide
// search results), a different shape from RedeployCandidate -- separate row
// renderer rather than overloading CandidateRow with optional fields for
// both shapes.
function SkillMatchCandidateRow({
  c,
  onOpen,
  showMissingSkills,
  isTopPick,
}: {
  c: RecommendationCandidate;
  onOpen: (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => void;
  showMissingSkills?: boolean;
  isTopPick?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllMatched, setShowAllMatched] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [aiProofOpen, setAiProofOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<{ category?: string } | null>(null);
  const matchedLabels = c.matched_skills.map(cleanSkillLabel).filter(Boolean);
  const missingLabels = c.missing_skills.map(cleanSkillLabel).filter(Boolean);
  const open = (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => onOpen(sel);

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition",
        isTopPick ? "border-primary/40 bg-primary/[0.03]" : "border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
      )}
    >
      <button onClick={() => setExpanded((v) => !v)} className="w-full text-left p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {isTopPick && <span className="text-[10px] font-semibold text-primary whitespace-nowrap">Top pick</span>}
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                open({ employeeId: c.employee_id, skillMatchContext: { matchedSkills: c.matched_skills ?? [], missingSkills: c.missing_skills ?? [] } });
              }}
              className="font-semibold text-sm text-primary hover:underline truncate"
            >
              {c.employee_id}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.job_name}</span>
            <HoldDot onHold={c.on_hold} holdProjects={c.hold_projects} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {Math.round(c.skill_score * 100)}% <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500">skill match</span>
            </span>
            <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 dark:text-gray-500 transition-transform flex-shrink-0", expanded && "rotate-180")} />
          </div>
        </div>
        {showMissingSkills && c.missing_skills.length > 0 && (
          <p className="text-[11px] text-purple-600 dark:text-purple-400">
            Needs: {c.missing_skills.slice(0, 4).join(", ")}
            {c.missing_skills.length > 4 && <span className="text-gray-400 dark:text-gray-500"> +{c.missing_skills.length - 4} more</span>}
          </p>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-3.5 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric
              label="Skill"
              value={c.skill_score}
              suffix={`${Math.round(c.skill_score * 100)}%`}
              onClick={() => open({ employeeId: c.employee_id, tab: "skills", skillMatchContext: { matchedSkills: c.matched_skills, missingSkills: c.missing_skills } })}
            />
            <Metric
              label="Competency"
              value={c.competency_score}
              suffix={`${Math.round(c.competency_score * 100)}%`}
              onClick={() => open({ employeeId: c.employee_id, tab: "competency" })}
            />
            <Metric
              label="Available"
              value={c.available_pct / 100}
              suffix={`${c.available_pct}%`}
              onClick={() => open({ employeeId: c.employee_id, tab: "allocations" })}
            />
          </div>

          {(c.matched_skills.length + c.missing_skills.length > 0 || c.semantic_score != null) && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 text-[11px] bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-800 flex-wrap">
                <span className="text-gray-400 dark:text-gray-500 font-medium flex-shrink-0">Match method</span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-500 dark:text-gray-400">Word:</span>
                  <span className={cn("font-semibold", c.matched_skills.length > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-300 dark:text-gray-600")}>
                    {c.matched_skills.length}/{c.matched_skills.length + c.missing_skills.length}
                  </span>
                </span>
                <span className="text-gray-200 dark:text-gray-700">·</span>
                {c.semantic_score != null ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setAiProofOpen((v) => !v); }}
                    className="flex items-center gap-1 hover:underline group"
                  >
                    <span className="text-gray-500 dark:text-gray-400">AI:</span>
                    <span className={cn("font-semibold", c.semantic_score >= 0.5 ? "text-blue-600 dark:text-blue-400" : c.semantic_score >= 0.3 ? "text-blue-400 dark:text-blue-300" : "text-gray-400 dark:text-gray-500")}>
                      {Math.round(c.semantic_score * 100)}% similarity
                    </span>
                    <span className="text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:hover:text-gray-300">↗</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-1">
                    <span className="text-gray-500 dark:text-gray-400">AI:</span>
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  </span>
                )}
              </div>
              {aiProofOpen && c.semantic_score != null && (
                <div className="rounded-lg border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 px-3 py-2.5 text-[11px] space-y-1.5">
                  <p className="text-blue-700 dark:text-blue-400">
                    Score: <span className="font-semibold">{Math.round(c.semantic_score * 100)}%</span> — semantic similarity between this employee's skill profile and the role requirement.
                  </p>
                </div>
              )}
            </div>
          )}

          {matchedLabels.length > 0 && (
            <SkillSection labels={matchedLabels} variant="matched" showAll={showAllMatched} onToggle={(e) => { e.stopPropagation(); setShowAllMatched((v) => !v); }} />
          )}
          {missingLabels.length > 0 && (
            <SkillSection labels={missingLabels} variant="missing" showAll={showAllMissing} onToggle={(e) => { e.stopPropagation(); setShowAllMissing((v) => !v); }} />
          )}

          {c.total_projects > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap pt-1 border-t border-gray-100 dark:border-gray-800">
              <span className="text-gray-400 dark:text-gray-500 font-medium flex-shrink-0">Track record</span>
              <button
                onClick={(e) => { e.stopPropagation(); setHistoryFilter({}); }}
                className="px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary"
              >
                {c.total_projects} projects ↗
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setHistoryFilter({}); }}
                className="px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary"
              >
                {c.distinct_clients} clients ↗
              </button>
              {c.top_categories.map((tc) => (
                <button
                  key={tc.category}
                  onClick={(e) => { e.stopPropagation(); setHistoryFilter({ category: tc.category }); }}
                  className="px-1.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-primary hover:text-primary"
                >
                  {tc.category} ({tc.count}) ↗
                </button>
              ))}
            </div>
          )}

          {c.earliest_available_date && (
            <p className="text-[11px] text-blue-600 dark:text-blue-400">
              Free from <strong>{c.earliest_available_date}</strong>{c.earliest_available_proof ? ` — ${c.earliest_available_proof}` : ""}
            </p>
          )}
        </div>
      )}

      {historyFilter && (
        <ProjectHistoryModal employeeId={c.employee_id} category={historyFilter.category} onClose={() => setHistoryFilter(null)} />
      )}
    </div>
  );
}

type SkillMatchSort = "composite_desc" | "skill_desc" | "competency_desc" | "available_desc";

const SKILL_MATCH_SORTS: [SkillMatchSort, string][] = [
  ["composite_desc", "Best overall fit ↓"],
  ["skill_desc", "Skill match ↓"],
  ["competency_desc", "Competency ↓"],
  ["available_desc", "Availability ↓"],
];

function sortSkillMatchCandidates(candidates: RecommendationCandidate[], sort: SkillMatchSort): RecommendationCandidate[] {
  const sorted = [...candidates];
  switch (sort) {
    case "composite_desc": sorted.sort((a, b) => b.composite_score - a.composite_score); break;
    case "skill_desc": sorted.sort((a, b) => b.skill_score - a.skill_score); break;
    case "competency_desc": sorted.sort((a, b) => b.competency_score - a.competency_score); break;
    case "available_desc": sorted.sort((a, b) => b.available_pct - a.available_pct); break;
  }
  return sorted;
}

function SkillMatchCandidateList({
  candidates,
  onOpen,
  emptyText,
  note,
  showMissingSkills,
}: {
  candidates: RecommendationCandidate[];
  onOpen: (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => void;
  emptyText?: string;
  note?: string;
  showMissingSkills?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [coeFilter, setCoeFilter] = useState<Set<string>>(new Set());
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SkillMatchSort>("composite_desc");

  if (candidates.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 italic">{emptyText ?? "No candidates in this category."}</p>;
  }

  const coeOptions = Array.from(new Set(candidates.map((c) => c.coe).filter((v): v is string => Boolean(v)))).sort();
  const roleOptions = Array.from(new Set(candidates.map((c) => c.job_name).filter(Boolean))).sort();

  let filtered = candidates;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((c) => c.employee_id.toLowerCase().includes(q) || c.job_name.toLowerCase().includes(q) || (c.coe ?? "").toLowerCase().includes(q));
  if (coeFilter.size > 0) filtered = filtered.filter((c) => c.coe != null && coeFilter.has(c.coe));
  if (roleFilter.size > 0) filtered = filtered.filter((c) => roleFilter.has(c.job_name));
  filtered = sortSkillMatchCandidates(filtered, sort);

  return (
    <div>
      {note && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2.5">{note}</p>}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee ID, role, or CoE…"
          className="flex-1 min-w-[180px] text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 outline-none focus:border-primary/40 bg-white dark:bg-gray-900"
        />
        <MultiSelectFilter label="CoE" options={coeOptions.map((c) => [c, c])} selected={coeFilter} onChange={setCoeFilter} />
        <MultiSelectFilter label="Role" options={roleOptions.map((r) => [r, r])} selected={roleFilter} onChange={setRoleFilter} />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SkillMatchSort)}
          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 outline-none"
        >
          {SKILL_MATCH_SORTS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">No candidates match the current filters.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((c, i) => (
            <SkillMatchCandidateRow
              key={c.employee_id}
              c={c}
              onOpen={onOpen}
              showMissingSkills={showMissingSkills}
              isTopPick={i === 0 && sort === "composite_desc" && !q && coeFilter.size === 0 && roleFilter.size === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type RoleDetailTabKey = "on_skill" | "adjacent" | "cross_role" | "trainable";

// Trust the backend's own gating decision (meets_requested_skillset) rather
// than reimplementing "skill_score >= threshold" here -- leadership
// designations are exempt from that threshold on the backend, so guessing
// client-side would wrongly split a Manager with a low skill_score into
// "doesn't qualify" even though the backend counts them as qualifying.
function isQualifying(c: RedeployCandidate): boolean {
  return c.meets_requested_skillset ?? true;
}

// Real frequency count of missing skills across the trainable pool -- the
// concrete "what to actually run a KT/JIT session on" signal, not prose.
function aggregateMissingSkills(candidates: RecommendationCandidate[]): { skill: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    for (const raw of c.missing_skills) {
      const skill = cleanSkillLabel(raw);
      if (!skill) continue;
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count);
}

// Per-role detail: instead of dumping every category into one long inline
// block on row-expand, a full breadcrumb-navigated page (same pattern as
// Health's project drill-down) -- one category at a time via tabs, full
// list, no truncation, and real room to breathe instead of a cramped modal.
function RoleDetailPage({
  breakdown: b,
  onOpenProfile,
}: {
  breakdown: ForecastBreakdownRow;
  onOpenProfile: (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => void;
}) {
  const tabs: { key: RoleDetailTabKey; label: string; count: number }[] = [
    { key: "on_skill", label: "On-Skill", count: b.qualifying_for_redeploy },
    { key: "adjacent", label: "Adjacent Title", count: b.adjacent_level_candidates.length },
    { key: "cross_role", label: "Cross-Role Match", count: b.cross_role_candidates.length },
    { key: "trainable", label: "Trainable", count: b.training_candidates.length },
  ];
  const [tab, setTab] = useState<RoleDetailTabKey>(tabs.find((t) => t.count > 0)?.key ?? "on_skill");

  const qualifyingOnSkill = b.redeploy_candidates.filter(isQualifying);
  const nonQualifyingOnSkill = b.redeploy_candidates.filter((c) => !isQualifying(c));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{b.designation}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Needed by {b.start_date}{b.duration_weeks != null && ` (+${b.duration_weeks}w)`} ·{" "}
          <strong className="text-gray-700 dark:text-gray-300">{b.needed_headcount}</strong> needed ·{" "}
          <strong className="text-gray-700 dark:text-gray-300">{b.qualifying_for_redeploy + b.adjacent_fill_count}</strong> covers ·{" "}
          <strong className={b.shortfall > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>{b.shortfall}</strong> shortfall
          {b.shortfall > 0 ? <Badge variant="red">hire signal</Badge> : <Badge variant="green">covered</Badge>}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex border-b border-gray-100 dark:border-gray-800 px-5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-4 py-3 text-xs font-medium border-b-2 -mb-px transition whitespace-nowrap",
                tab === t.key ? "border-primary text-primary" : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300",
                t.count === 0 && "opacity-40"
              )}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === "on_skill" && (
            <div className="space-y-5">
              <RoleCandidateList
                candidates={qualifyingOnSkill}
                onOpen={onOpenProfile}
                emptyText="No one holding this title meets the requested skillset."
              />
              {nonQualifyingOnSkill.length > 0 && (
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      {nonQualifyingOnSkill.length} more hold this exact title, but not counted above
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                      Their skill match for this specific role's required skills is below the 60% bar this app uses
                      to call someone "eligible" -- even though some may still show a decent overall fit score from
                      competency/availability/track record. Reference only; these people do NOT count toward the{" "}
                      {b.qualifying_for_redeploy} covers / {b.needed_headcount} needed above.
                    </p>
                  </div>
                  <RoleCandidateList candidates={nonQualifyingOnSkill} onOpen={onOpenProfile} disableTopPick />
                </div>
              )}
            </div>
          )}
          {tab === "adjacent" && (
            <RoleCandidateList
              candidates={b.adjacent_level_candidates}
              onOpen={onOpenProfile}
              showQualifies
              emptyText="No one one level away qualifies either."
              note={b.adjacent_fill_count > 0 ? `${b.adjacent_fill_count} counted toward the need above.` : undefined}
            />
          )}
          {tab === "cross_role" && (
            <SkillMatchCandidateList
              candidates={b.cross_role_candidates}
              onOpen={onOpenProfile}
              emptyText="No cross-role skill matches found."
              note="Different job title -- not counted toward shortfall."
            />
          )}
          {tab === "trainable" && (
            <div className="space-y-3">
              {b.training_candidates.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {aggregateMissingSkills(b.training_candidates).map(({ skill, count }) => (
                    <span
                      key={skill}
                      className="text-[11px] px-2 py-1 rounded-full border border-purple-200 dark:border-purple-800/60 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 whitespace-nowrap"
                    >
                      {skill} <span className="font-semibold">×{count}</span>
                    </span>
                  ))}
                </div>
              )}
              <SkillMatchCandidateList
                candidates={b.training_candidates}
                onOpen={onOpenProfile}
                emptyText="No training candidates found."
                showMissingSkills
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RoleMixRow {
  designation: string;
  headcount: number;
  typicalPct: number;
  prevalencePct: number | null;
  common: boolean;
  // True only for rows added via "+ Add role" -- these have no historical backing at
  // all (prevalencePct is always null for them), distinct from a data-derived row whose
  // source just doesn't carry a prevalence stat (e.g. a verbatim role-mix category).
  isManual?: boolean;
}

function rowToFte(row: RoleMixRow): number {
  return Math.round(((row.headcount * row.typicalPct) / 100) * 100) / 100;
}

interface SkillChip {
  skill: string;
  subskill: string;
  employee_count?: number;
  avg_score?: number;
}

interface SpecState {
  coes: string[];
  typeOfProject: string;
  category: string | null;
  count: number;
  startDate: string;
  durationWeeks: string;
  roleMix: RoleMixRow[];
  roleMixSource: string | null;
  roleMixSampleSize: number | null;
  roleMixMatchedProjects: string[];
  roleMixEdited: boolean;
  showAllRoles: boolean;
  skills: SkillChip[];
  skillCoeBasis: { coe: string; confidence: string; fallback: string | null }[];
  previewLoading: boolean;
}

function blankSpec(): SpecState {
  return {
    coes: [],
    typeOfProject: "Client Project",
    category: null,
    count: 1,
    startDate: todayStr(),
    durationWeeks: "",
    roleMix: [],
    roleMixSource: null,
    roleMixSampleSize: null,
    roleMixMatchedProjects: [],
    roleMixEdited: false,
    showAllRoles: false,
    skills: [],
    skillCoeBasis: [],
    previewLoading: false,
  };
}

function toForecastSpec(spec: SpecState): ForecastSpec {
  const requiredSkills = spec.skills.map((s) => s.subskill || s.skill).filter(Boolean);
  const durationWeeks = parseInt(spec.durationWeeks, 10);
  return {
    coes: spec.category ? undefined : spec.coes.length ? spec.coes : undefined,
    type_of_project: spec.category ? undefined : spec.typeOfProject || undefined,
    category: spec.category ?? undefined,
    count: spec.count,
    // spec.roleMix always holds every historical role (common + rare), so the editor
    // can reveal rare ones via "Show all roles" -- but only rows actually visible to
    // the user (common, manually added, or explicitly revealed) should be submitted.
    // Without this filter, editing just one visible row silently drags ~12 hidden
    // rare roles the user never saw into the override as full headcount needs.
    role_mix_overrides: spec.roleMixEdited
      ? Object.fromEntries(
          spec.roleMix.filter((r) => r.common || spec.showAllRoles).map((r) => [r.designation, rowToFte(r)])
        )
      : undefined,
    required_skills: requiredSkills.length ? requiredSkills : undefined,
    start_date: spec.startDate || undefined,
    duration_weeks: Number.isNaN(durationWeeks) ? undefined : durationWeeks,
  };
}

function formatRoleMixSource(source: string | null | undefined, sampleSize?: number | null, scope?: string | null): string {
  switch (source) {
    case "manual_override":
      return "edited by you";
    case "docx_given":
      return scope ? `standard template · ${scope}` : "standard template";
    case "derived_empirical":
      return `based on ${sampleSize ?? 0} past project(s)${scope ? ` · ${scope}` : ""}`;
    case "derived_empirical_on_time_preferred":
      return `based on ${sampleSize ?? 0} past project(s) that finished on schedule, no extension${scope ? ` · ${scope}` : ""}`;
    case "derived_empirical_type_fallback":
      return `based on ${sampleSize ?? 0} past project(s) of this type (broader CoE match)`;
    case "derived_empirical_org_fallback":
      return `based on ${sampleSize ?? 0} past project(s) org-wide (broader fallback)`;
    case "no_data":
    case "no_coes_selected":
    case "unknown_category":
      return "no historical match yet";
    default:
      return "not previewed";
  }
}

function roleMixSourceLabel(spec: SpecState): string {
  if (spec.roleMixEdited) return "edited by you";
  const scope =
    spec.roleMixSource === "derived_empirical"
      ? spec.typeOfProject || spec.coes.join(", ") || spec.category || "any project type"
      : spec.roleMixSource === "docx_given"
      ? spec.category || undefined
      : undefined;
  return formatRoleMixSource(spec.roleMixSource, spec.roleMixSampleSize, scope);
}

type ForecastMode = "spec" | "revenue";

// "0 to hero": instead of "do we have resources for this spec", start from a
// revenue target and work backwards -- how many projects of each CoE (weighted
// toward the CoEs we're strongest/most proven in, Data Engineering first by
// default) does that require, and does the same redeploy -> adjacent-title ->
// hire waterfall used everywhere else in Forecast actually cover it (cross-role
// matches and trainable candidates are surfaced per role as extra context, not
// counted toward whether a role is covered -- see ForecastBreakdownRow in
// lib/api.ts). Revenue and role-mix figures are grounded in
// real JMAN delivery-project economics (see app/engines/revenue_engine.py's
// DELIVERY_TEMPLATE) -- ~$35k revenue, ~5 weeks, 2 engineers + 1 Solutions
// Enabler + 1 Consultant per project.
function RevenueTargetSection({
  onOpenProfile,
  onSelectRole,
}: {
  onOpenProfile: (sel: { employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab }) => void;
  onSelectRole: (b: ForecastBreakdownRow) => void;
}) {
  const coeOptions = useQuery({ queryKey: ["role-mix-coes"], queryFn: api.roleMixCoes });
  const benchmarks = useQuery({ queryKey: ["revenue-benchmarks"], queryFn: api.revenueBenchmarks });
  const durationBenchmarks = useQuery({ queryKey: ["duration-mix-benchmarks"], queryFn: api.durationMixBenchmarks });

  const [targetRevenue, setTargetRevenue] = useState("1000000");
  const [priorityCoes, setPriorityCoes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [durationWeeks, setDurationWeeks] = useState("");
  const [typeOfProject, setTypeOfProject] = useState("");
  const [mixOverride, setMixOverride] = useState<DurationMixPct | null>(null);
  const [viewTab, setViewTab] = useState<"mix" | "financial">("mix");
  const [targetDate, setTargetDate] = useState("");
  const [showHitDateProof, setShowHitDateProof] = useState(false);
  // No real D&D-to-delivery conversion rate exists in this org's data --
  // 100% preserves the old fixed 1:1-per-project assumption; editable so the
  // RM can plug in their own real-world win-rate estimate.
  const [dndWinRatePct, setDndWinRatePct] = useState("100");

  const togglePriorityCoe = (coe: string) =>
    setPriorityCoes((prev) => (prev.includes(coe) ? prev.filter((c) => c !== coe) : [...prev, coe]));

  const durationBuckets = durationBenchmarks.data?.buckets;
  const defaultDurationMix: DurationMixPct | null = durationBuckets
    ? {
        short: Math.round(durationBuckets.short?.historical_mix_pct ?? 0),
        mid: Math.round(durationBuckets.mid?.historical_mix_pct ?? 0),
        long: Math.round(durationBuckets.long?.historical_mix_pct ?? 0),
      }
    : null;
  const durationMix = mixOverride ?? defaultDurationMix;
  const isTypicalMix = mixOverride == null;

  const revenue = useMutation({
    mutationFn: () =>
      api.revenueTargetForecast({
        targetRevenueUsd: Number(targetRevenue) || 0,
        priorityCoes: priorityCoes.length > 0 ? priorityCoes : null,
        startDate: startDate || null,
        durationWeeks: durationWeeks ? Number(durationWeeks) : null,
        typeOfProject: typeOfProject || null,
        // Only sent once the RM actually adjusts a bucket -- until then this
        // stays null so the backend falls back to the flat, real $35k/5-week
        // template. The un-adjusted "typical mix" shown in the inputs is
        // historical Short/Mid/Long *bucket* durations, but the Long bucket's
        // ~59w average reflects pooled multi-phase project_codes in the
        // source data, not one clean project's real length -- auto-applying
        // it by default silently inflated every project's revenue ~4-5x.
        durationMix: !durationWeeks && mixOverride
          ? { short: mixOverride.short / 100, mid: mixOverride.mid / 100, long: mixOverride.long / 100 }
          : null,
        dndWinRatePct: dndWinRatePct ? Number(dndWinRatePct) : null,
        targetDate: viewTab === "financial" && targetDate ? targetDate : null,
        include: DEFAULT_INCLUDE_PARAMS,
      }),
  });

  const dataKnownCoes = new Set(Object.keys(benchmarks.data ?? {}));
  const forecast = revenue.data?.forecast;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Target revenue (USD)</label>
            <input
              type="number"
              min={0}
              value={targetRevenue}
              onChange={(e) => setTargetRevenue(e.target.value)}
              className="w-40 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Start date (optional)</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Duration (weeks)</label>
            <input
              type="number"
              min={1}
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(e.target.value)}
              className="w-24 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Project type (optional)</label>
            <select
              value={typeOfProject}
              onChange={(e) => setTypeOfProject(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none bg-white dark:bg-gray-900"
            >
              <option value="">Any</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
            Priority CoEs -- click in the order you want them prioritized (unclicked defaults to Data Engineering first, then the rest by revenue strength)
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(coeOptions.data ?? []).map((c) => {
              const rank = priorityCoes.indexOf(c.coe);
              const selected = rank !== -1;
              return (
                <button
                  key={c.coe}
                  onClick={() => togglePriorityCoe(c.coe)}
                  disabled={!dataKnownCoes.has(c.coe) && benchmarks.data != null}
                  title={!dataKnownCoes.has(c.coe) && benchmarks.data != null ? "No historical revenue benchmark for this CoE yet" : undefined}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-30 disabled:cursor-not-allowed",
                    selected ? "bg-primary text-white border-primary" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
                  )}
                >
                  {selected && <span className="font-bold mr-1">{rank + 1}.</span>}
                  {c.coe}
                </button>
              );
            })}
          </div>
        </div>

        {durationMix && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Project duration mix{durationWeeks ? " (disabled -- manual duration set above)" : ""}
              </p>
              {durationBenchmarks.data && durationBenchmarks.data.total_sample_size < 20 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                  Low confidence (n={durationBenchmarks.data.total_sample_size})
                </span>
              )}
              {!isTypicalMix && !durationWeeks && (
                <button onClick={() => setMixOverride(null)} className="text-[10px] text-primary hover:underline ml-auto">
                  Reset to typical mix
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {(["short", "mid", "long"] as const).map((bucket) => {
                const b = durationBuckets?.[bucket];
                const label = bucket === "short" ? "Short" : bucket === "mid" ? "Mid" : "Long";
                return (
                  <div key={bucket} className="flex-1 min-w-[140px]">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                      <span>{label}{b ? ` (~${b.avg_weeks}w)` : ""}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={durationMix[bucket]}
                        disabled={!!durationWeeks}
                        onChange={(e) => setMixOverride(adjustDurationMix(durationMix, bucket, Number(e.target.value)))}
                        className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none disabled:opacity-40"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">
            D&amp;D → delivery win rate (editable -- no real conversion data exists to fit this)
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={100}
              value={dndWinRatePct}
              onChange={(e) => setDndWinRatePct(e.target.value)}
              className="w-20 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {(["mix", "financial"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setViewTab(tab)}
              className={cn(
                "text-[11px] px-3 py-1.5 rounded-lg border transition",
                viewTab === tab ? "bg-primary text-white border-primary" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
              )}
            >
              {tab === "mix" ? "Project Mix" : "Financial Summary"}
            </button>
          ))}
          {viewTab === "financial" && (
            <div className="ml-2">
              <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Target by date</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => revenue.mutate()}
            disabled={
              revenue.isPending || !targetRevenue || Number(targetRevenue) <= 0 || (viewTab === "financial" && !targetDate)
            }
            className="px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            {revenue.isPending ? "Computing…" : viewTab === "mix" ? "Run Revenue-Target Forecast" : "Run Financial Summary"}
          </button>
        </div>
      </div>

      {revenue.isPending && !revenue.data && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <TableSkeleton columns={7} rows={5} />
        </div>
      )}

      {revenue.data?.error && <ErrorState message={revenue.data.error} />}

      {revenue.data && !revenue.data.error && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Target</p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatUsd(revenue.data.target_revenue_usd)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">This mix delivers</p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {formatUsd(revenue.data.total_projected_revenue_usd)}
                {revenue.data.pct_of_target_covered != null && <span className="text-gray-400 dark:text-gray-500 font-normal"> ({revenue.data.pct_of_target_covered}%)</span>}
              </p>
            </div>
            {forecast && forecast.pct_achievable_with_current_headcount != null && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
                <p className="text-[10px] text-gray-400 dark:text-gray-500">Staffable with your team today</p>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {forecast.pct_achievable_with_current_headcount}%
                  {forecast.total_shortfall_headcount > 0 && (
                    <span className="text-red-600 dark:text-red-400 font-normal"> · {forecast.total_shortfall_headcount} to hire</span>
                  )}
                </p>
              </div>
            )}
            {revenue.data.revenue_hit_estimate && (
              <button
                onClick={() => setShowHitDateProof(true)}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-left hover:border-primary/40 transition"
                title="Click for the calculation behind this date"
              >
                <p className="text-[10px] text-gray-400 dark:text-gray-500">Hit {formatUsd(revenue.data.target_revenue_usd)} by</p>
                <p className="text-sm font-semibold text-primary underline decoration-dotted underline-offset-2">
                  {revenue.data.revenue_hit_estimate.hit_date}
                  {revenue.data.revenue_hit_estimate.has_staffing_gap && (
                    <span className="text-amber-600 dark:text-amber-400 font-normal text-[11px]"> · assumes gap filled</span>
                  )}
                </p>
              </button>
            )}
            {viewTab === "financial" && revenue.data.timeline && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
                <p className="text-[10px] text-gray-400 dark:text-gray-500">By {revenue.data.timeline.target_date}</p>
                <p className={cn("text-sm font-semibold", revenue.data.timeline.likely_fits ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                  {revenue.data.timeline.likely_fits
                    ? "On time"
                    : `Tight -- projects take ~${revenue.data.timeline.typical_project_weeks}w, you have ~${revenue.data.timeline.weeks_available}w`}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white dark:bg-gray-900 overflow-hidden" style={{ border: `1px solid ${JMAN.emerald}40` }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs data-table">
                <thead className="text-white" style={{ background: JMAN_HEADER_GRADIENT }}>
                  <tr>
                    {["CoE", "Priority weight", "Projects", "D&D Needed", "Avg revenue/project", "Projected revenue", "Sample size"].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {revenue.data.project_mix.map((m) => (
                    <tr key={m.coe} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{m.coe}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{m.weight_pct}%</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 font-semibold">{m.project_count}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{m.dnd_engagements_needed}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{formatUsd(m.avg_revenue_per_project)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{formatUsd(m.projected_revenue_usd)}</td>
                      <td className="px-3 py-2 text-gray-400 dark:text-gray-500">{m.sample_size} past projects</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {revenue.data.design_and_discovery && (
            <div className="rounded-xl bg-white dark:bg-gray-900 p-4" style={{ border: `1px solid ${JMAN.emerald}40` }}>
              <div className="flex items-center gap-2 mb-1">
                <Search className="w-4 h-4" style={{ color: JMAN.emerald }} />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Design & Discovery (precursor phase)</p>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                Clients typically sign a paid D&D engagement first (~{revenue.data.design_and_discovery.duration_weeks} weeks,{" "}
                {formatUsd(revenue.data.design_and_discovery.revenue_usd_low)}-{formatUsd(revenue.data.design_and_discovery.revenue_usd_high)}{" "}
                each). At a {revenue.data.design_and_discovery.win_rate_pct}% win rate, that's{" "}
                <strong>{revenue.data.design_and_discovery.engagements_needed} D&D engagement(s)</strong> ={" "}
                {formatUsd(revenue.data.design_and_discovery.total_revenue_usd_low)}-{formatUsd(revenue.data.design_and_discovery.total_revenue_usd_high)}{" "}
                more revenue (not in the totals above).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(revenue.data.design_and_discovery.role_mix).map(([role, fte]) => (
                  <span key={role} className="text-[11px] px-2 py-1 rounded-full text-gray-700 dark:text-gray-300" style={{ background: `${JMAN.emerald}0D` }}>
                    {role} <strong>{Math.round(fte * 100)}%</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {forecast && forecast.breakdown.length > 0 && (
            <div className="rounded-xl bg-white dark:bg-gray-900 overflow-hidden" style={{ border: `1px solid ${JMAN.emerald}40` }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs data-table">
                  <thead className="text-white" style={{ background: JMAN_HEADER_GRADIENT }}>
                    <tr>
                      {["", "Designation", "Needed", "Covers", "Hiring Gap", "Signal"].map((h) => (
                        <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.breakdown.map((b) => {
                      const rowKey = `${b.designation}__${b.start_date}`;
                      return (
                        <tr
                          key={rowKey}
                          onClick={() => onSelectRole(b)}
                          className="border-b border-gray-50 dark:border-gray-800/60 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 cursor-pointer"
                        >
                          <td className="px-3 py-2">
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{b.designation}</td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{b.needed_headcount}</td>
                          <td className="px-3 py-2 align-top">
                            <span className="text-gray-700 dark:text-gray-300 font-semibold" title="Same-title + adjacent-title matches only -- what Shortfall is calculated against.">
                              {b.qualifying_for_redeploy + b.adjacent_fill_count}
                            </span>
                            {b.cross_role_match_count > 0 && (
                              <span className="block text-[10px] text-blue-600 dark:text-blue-400 font-normal">
                                +{b.cross_role_match_count} cross-role match (not counted)
                              </span>
                            )}
                            {b.training_candidates.length > 0 && (
                              <span className="block text-[10px] text-purple-600 dark:text-purple-400 font-normal">
                                +{b.training_candidates.length} trainable
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{b.shortfall > 0 ? b.shortfall : "-"}</td>
                          <td className="px-3 py-2">
                            {b.shortfall === 0 ? <Badge variant="green">Covered</Badge> : <Badge variant="red">Hiring needed</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showHitDateProof && revenue.data?.revenue_hit_estimate && (
        <Modal title="How this date was calculated" onClose={() => setShowHitDateProof(false)} widthClassName="max-w-lg">
          <div className="p-5 space-y-3 text-xs text-gray-600 dark:text-gray-400">
            <p>
              <strong>{revenue.data.revenue_hit_estimate.project_count} delivery project(s)</strong> in this mix are
              assumed to start together on <strong>{revenue.data.revenue_hit_estimate.start_date_used}</strong> and run
              in parallel (your team works them concurrently, not one project queued after another).
            </p>
            <p>
              Each takes about <strong>{revenue.data.revenue_hit_estimate.duration_weeks} week(s)</strong> -- the same
              typical duration used to price this mix&apos;s revenue above. That puts the last project finishing, and
              this mix&apos;s revenue landing, on{" "}
              <strong className="text-primary">{revenue.data.revenue_hit_estimate.hit_date}</strong>.
            </p>
            {revenue.data.revenue_hit_estimate.has_staffing_gap && (
              <p className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-2.5 py-1.5">
                This assumes the {revenue.data.revenue_hit_estimate.shortfall_headcount} role(s) your team doesn&apos;t
                cover yet ("Staffable with your team today" above) are filled by the start date -- no real
                hiring-lead-time data exists in this system to say exactly when that happens, so the date isn&apos;t
                pushed out for it.
              </p>
            )}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Project mix behind this date:</p>
              {revenue.data.project_mix.filter((m) => m.project_count > 0).map((m) => (
                <div key={m.coe} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-600 dark:text-gray-400">{m.coe}</span>
                  <span className="text-gray-500 dark:text-gray-400">{m.project_count} project(s) · {formatUsd(m.avg_revenue_per_project)} each</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function NewProjectForecastTab() {
  const [mode, setMode] = useState<ForecastMode>("spec");
  const coeOptions = useQuery({ queryKey: ["role-mix-coes"], queryFn: api.roleMixCoes });
  const categories = useQuery({ queryKey: ["role-mix-categories"], queryFn: api.roleMixCategories });
  const designations = useQuery({ queryKey: ["employee-designations"], queryFn: api.employeeDesignations });
  const knownDesignations = new Set((designations.data ?? []).map((d) => d.toLowerCase()));

  const [specs, setSpecs] = useState<SpecState[]>([blankSpec()]);
  const [rareRolesOpen, setRareRolesOpen] = useState(false);
  const [skillDrafts, setSkillDrafts] = useState<Record<number, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<number, { designation: string; headcount: string; pct: string }>>({});
  const [selectedEmployee, setSelectedEmployee] = useState<{ employeeId: string; skillMatchContext?: SkillMatchContext; tab?: ProfileTab } | null>(null);
  const [detailRole, setDetailRole] = useState<ForecastBreakdownRow | null>(null);
  const forecast = useMutation({ mutationFn: () => api.newProjectForecast(specs.map(toForecastSpec), DEFAULT_INCLUDE_PARAMS) });

  if (coeOptions.isLoading || categories.isLoading) {
    return (
      <div className="w-full space-y-5">
        <Skeleton className="h-3 w-64" />
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-16 rounded-lg" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-24 rounded-lg" />
            ))}
          </div>
          <TableSkeleton columns={3} rows={4} />
        </div>
      </div>
    );
  }
  if (coeOptions.error || categories.error) return <ErrorState message="Could not load role-mix reference data." />;

  const coeList = coeOptions.data ?? [];
  const sortedCoes = [...coeList].sort((a, b) => b.sample_size - a.sample_size);

  async function runPreview(specIndex: number, coes: string[], typeOfProject: string) {
    if (coes.length === 0) return;
    setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, previewLoading: true })));
    try {
      const [roleMixResult, skillsResult] = await Promise.all([
        api.roleMixPreview(coes, typeOfProject || null),
        api.roleMixCoeSkills(coes),
      ]);
      const roleMix: RoleMixRow[] = roleMixResult.roles.map((r) => ({
        designation: r.designation,
        headcount: r.headcount,
        typicalPct: r.typical_pct,
        prevalencePct: r.prevalence_pct,
        common: r.common,
      }));
      const skills: SkillChip[] = skillsResult.combined.map((s) => ({
        skill: s.skill,
        subskill: s.subskill,
        employee_count: s.employee_count,
        avg_score: s.avg_score,
      }));
      const skillCoeBasis = coes.map((coe) => ({
        coe,
        confidence: skillsResult.by_coe[coe]?.confidence ?? "none",
        fallback: skillsResult.by_coe[coe]?.fallback ?? null,
      }));
      setSpecs((prev) =>
        prev.map((s, i) =>
          i !== specIndex
            ? s
            : {
                ...s,
                roleMix,
                roleMixSource: roleMixResult.source,
                roleMixSampleSize: roleMixResult.sample_size,
                roleMixMatchedProjects: roleMixResult.matched_project_codes,
                roleMixEdited: false,
                showAllRoles: false,
                skills,
                skillCoeBasis,
                previewLoading: false,
              }
        )
      );
    } catch {
      setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, previewLoading: false })));
    }
  }

  function toggleCoe(specIndex: number, coe: string) {
    const spec = specs[specIndex];
    const newCoes = spec.coes.includes(coe) ? spec.coes.filter((c) => c !== coe) : [...spec.coes, coe];
    setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, category: null, coes: newCoes })));
    runPreview(specIndex, newCoes, spec.typeOfProject);
  }

  function changeTypeOfProject(specIndex: number, typeOfProject: string) {
    const spec = specs[specIndex];
    setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, typeOfProject })));
    if (spec.coes.length > 0) runPreview(specIndex, spec.coes, typeOfProject);
  }

  function quickFillCategory(specIndex: number, category: string) {
    if (!category) {
      setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, category: null })));
      return;
    }
    const cat = categories.data?.find((c) => c.category === category);
    if (!cat) return;
    setSpecs((prev) =>
      prev.map((s, i) =>
        i !== specIndex
          ? s
          : {
              ...s,
              category,
              coes: [],
              roleMix: cat.roles.map((r) => ({
                designation: r.designation,
                headcount: r.headcount,
                typicalPct: r.typical_pct,
                prevalencePct: r.prevalence_pct,
                common: r.common,
              })),
              roleMixSource: cat.source,
              roleMixSampleSize: cat.sample_size,
              roleMixMatchedProjects: [],
              roleMixEdited: false,
              showAllRoles: false,
              skills: [],
              skillCoeBasis: [],
            }
      )
    );
  }

  function updateHeadcount(specIndex: number, rowIndex: number, headcount: number) {
    setSpecs((prev) =>
      prev.map((s, i) =>
        i !== specIndex ? s : { ...s, roleMixEdited: true, roleMix: s.roleMix.map((r, ri) => (ri !== rowIndex ? r : { ...r, headcount })) }
      )
    );
  }

  function updateTypicalPct(specIndex: number, rowIndex: number, typicalPct: number) {
    setSpecs((prev) =>
      prev.map((s, i) =>
        i !== specIndex ? s : { ...s, roleMixEdited: true, roleMix: s.roleMix.map((r, ri) => (ri !== rowIndex ? r : { ...r, typicalPct })) }
      )
    );
  }

  function removeRoleMixRow(specIndex: number, rowIndex: number) {
    setSpecs((prev) =>
      prev.map((s, i) => (i !== specIndex ? s : { ...s, roleMixEdited: true, roleMix: s.roleMix.filter((_, ri) => ri !== rowIndex) }))
    );
  }

  function toggleShowAllRoles(specIndex: number) {
    setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, showAllRoles: !s.showAllRoles })));
  }

  function addRoleMixRow(specIndex: number) {
    const draft = roleDrafts[specIndex];
    const designation = draft?.designation.trim();
    const headcount = parseInt(draft?.headcount ?? "", 10);
    const typicalPct = parseFloat(draft?.pct ?? "");
    if (!designation || Number.isNaN(headcount) || Number.isNaN(typicalPct)) return;
    const newRow: RoleMixRow = { designation, headcount, typicalPct, prevalencePct: null, common: true, isManual: true };
    setSpecs((prev) =>
      prev.map((s, i) => (i !== specIndex ? s : { ...s, roleMixEdited: true, roleMix: [...s.roleMix, newRow] }))
    );
    setRoleDrafts((prev) => ({ ...prev, [specIndex]: { designation: "", headcount: "", pct: "" } }));
  }

  function removeSkill(specIndex: number, skillIndex: number) {
    setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, skills: s.skills.filter((_, si) => si !== skillIndex) })));
  }

  function addSkill(specIndex: number) {
    const text = (skillDrafts[specIndex] ?? "").trim();
    if (!text) return;
    setSpecs((prev) => prev.map((s, i) => (i !== specIndex ? s : { ...s, skills: [...s.skills, { skill: text, subskill: text }] })));
    setSkillDrafts((prev) => ({ ...prev, [specIndex]: "" }));
  }

  const anyPreviewLoading = specs.some((s) => s.previewLoading);

  return (
    <div className="w-full space-y-4">
      {detailRole && (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <button onClick={() => setDetailRole(null)} className="hover:text-primary hover:underline">
              New Project Demand Forecast
            </button>
            <span>/</span>
            <span className="text-gray-700 dark:text-gray-300 font-medium">{detailRole.designation}</span>
          </div>
          <RoleDetailPage breakdown={detailRole} onOpenProfile={setSelectedEmployee} />
        </div>
      )}
      {/* Kept mounted (just hidden) rather than conditionally unmounted --
          RevenueTargetSection owns its own form/mutation state internally, and
          unmounting it every time a role detail is opened would wipe the
          entered target revenue and fetched results on every "back" click. */}
      <div className={cn("space-y-5", detailRole && "hidden")}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode("spec")}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-lg border transition",
            mode === "spec" ? "bg-primary text-white border-primary" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
          )}
        >
          By Project Spec
        </button>
        <button
          onClick={() => setMode("revenue")}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-lg border transition",
            mode === "revenue" ? "bg-primary text-white border-primary" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
          )}
        >
          By Revenue Target
        </button>
      </div>

      {mode === "revenue" && (
        <RevenueTargetSection onOpenProfile={(sel) => setSelectedEmployee(sel)} onSelectRole={setDetailRole} />
      )}

      {mode === "spec" && (
      <>
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">What if these new projects started on a given date?</p>
        <datalist id="known-designations">
          {(designations.data ?? []).map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        {specs.map((spec, i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Project spec {i + 1}</p>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-gray-400 dark:text-gray-500">Count</label>
                <input
                  type="number"
                  min={1}
                  value={spec.count}
                  onChange={(e) =>
                    setSpecs((prev) => prev.map((s, idx) => (idx !== i ? s : { ...s, count: Math.max(1, parseInt(e.target.value) || 1) })))
                  }
                  className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
                />
                <button
                  onClick={() => setSpecs((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={specs.length === 1}
                  className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">Start date</label>
                <input
                  type="date"
                  value={spec.startDate}
                  onChange={(e) => setSpecs((prev) => prev.map((s, idx) => (idx !== i ? s : { ...s, startDate: e.target.value || todayStr() })))}
                  className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">Duration (weeks)</label>
                <input
                  type="number"
                  min={1}
                  value={spec.durationWeeks}
                  onChange={(e) => setSpecs((prev) => prev.map((s, idx) => (idx !== i ? s : { ...s, durationWeeks: e.target.value })))}
                  placeholder="e.g. 12"
                  className="w-28 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
                />
              </div>
              {spec.durationWeeks && !Number.isNaN(parseInt(spec.durationWeeks, 10)) && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 self-end pb-1.5">
                  through {addWeeks(spec.startDate, parseInt(spec.durationWeeks, 10))}
                </p>
              )}
            </div>

            <div>
              <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-1">Complexion of COEs</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {sortedCoes.map((c) => (
                  <button
                    key={c.coe}
                    title={`${c.sample_size} historical project${c.sample_size === 1 ? "" : "s"}`}
                    onClick={() => toggleCoe(i, c.coe)}
                    className={cn(
                      "text-[11px] px-2 py-1 rounded-lg border transition",
                      spec.coes.includes(c.coe) ? "bg-primary/10 border-primary text-primary" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                    )}
                  >
                    {c.coe}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <select
                  value={spec.typeOfProject}
                  onChange={(e) => changeTypeOfProject(i, e.target.value)}
                  className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 max-w-full"
                >
                  <option value="">Any project type</option>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  value={spec.category ?? ""}
                  onChange={(e) => quickFillCategory(i, e.target.value)}
                  className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 max-w-full"
                >
                  <option value="">Or quick-fill from a project category…</option>
                  {(categories.data ?? []).map((c) => (
                    <option key={c.category} value={c.category}>{c.category}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{spec.previewLoading ? "loading…" : roleMixSourceLabel(spec)}</p>
                {spec.roleMix.some((r) => !r.common) && (
                  <button onClick={() => toggleShowAllRoles(i)} className="text-[11px] text-primary hover:underline whitespace-nowrap">
                    {spec.showAllRoles ? "Hide rare roles" : "Show all roles (incl. rare)"}
                  </button>
                )}
              </div>
              {spec.roleMix.length === 0 && !spec.previewLoading ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic mb-2">Select CoEs above, or a project category, to auto-fill this.</p>
              ) : (
                <div className="space-y-1 mb-2">
                  {spec.roleMix
                    .map((row, ri) => ({ row, ri }))
                    .filter(({ row }) => row.common || spec.showAllRoles)
                    .map(({ row, ri }) => (
                      <div key={ri} className="flex items-center gap-2 text-xs">
                        <span
                          className="flex-1 text-gray-700 dark:text-gray-300"
                          title={
                            row.prevalencePct != null
                              ? `used in ${row.prevalencePct}% of matched historical projects`
                              : row.isManual
                              ? "Manually added -- no historical project data to back this role, headcount, or %"
                              : "No historical prevalence stat for this role-mix source"
                          }
                        >
                          {row.designation}
                          {row.prevalencePct != null && !row.common && (
                            <span className="text-gray-300 dark:text-gray-600 ml-1">({row.prevalencePct}% of projects)</span>
                          )}
                          {row.isManual && <span className="text-gray-300 dark:text-gray-600 ml-1">(manual)</span>}
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={row.headcount}
                          onChange={(e) => updateHeadcount(i, ri, Math.max(0, parseInt(e.target.value, 10) || 0))}
                          title="Headcount"
                          className="w-12 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
                        />
                        <span className="text-gray-400 dark:text-gray-500">x</span>
                        <input
                          type="number"
                          min={0}
                          step={5}
                          value={row.typicalPct}
                          onChange={(e) => updateTypicalPct(i, ri, parseFloat(e.target.value) || 0)}
                          title="Typical allocation % per person"
                          className="w-20 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs outline-none"
                        />
                        <span className="text-gray-400 dark:text-gray-500">%</span>
                        <button onClick={() => removeRoleMixRow(i, ri)} className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  value={roleDrafts[i]?.designation ?? ""}
                  onChange={(e) =>
                    setRoleDrafts((prev) => ({
                      ...prev,
                      [i]: { designation: e.target.value, headcount: prev[i]?.headcount ?? "", pct: prev[i]?.pct ?? "" },
                    }))
                  }
                  list="known-designations"
                  placeholder="Add a role (designation)…"
                  className="flex-1 min-w-[140px] text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 outline-none"
                />
                <input
                  value={roleDrafts[i]?.headcount ?? ""}
                  onChange={(e) =>
                    setRoleDrafts((prev) => ({
                      ...prev,
                      [i]: { designation: prev[i]?.designation ?? "", headcount: e.target.value, pct: prev[i]?.pct ?? "" },
                    }))
                  }
                  placeholder="Headcount"
                  className="w-20 text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 outline-none"
                />
                <input
                  value={roleDrafts[i]?.pct ?? ""}
                  onChange={(e) =>
                    setRoleDrafts((prev) => ({
                      ...prev,
                      [i]: { designation: prev[i]?.designation ?? "", headcount: prev[i]?.headcount ?? "", pct: e.target.value },
                    }))
                  }
                  placeholder="%"
                  className="w-16 text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 outline-none"
                />
                <button onClick={() => addRoleMixRow(i)} className="text-[11px] text-primary hover:underline whitespace-nowrap">
                  + Add role
                </button>
              </div>
              {roleDrafts[i]?.designation.trim() &&
                designations.data &&
                !knownDesignations.has(roleDrafts[i]!.designation.trim().toLowerCase()) && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    No employee currently holds this exact title -- it will show as a pure hire need with zero
                    redeploy candidates. Pick a suggestion from the list to match a real designation.
                  </p>
                )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">Skills needed</p>
              {spec.skillCoeBasis.length > 0 && (
                <div className="mb-1.5 space-y-0.5">
                  {spec.skillCoeBasis.map((b) => (
                    <p key={b.coe} className="text-[10px] text-gray-400 dark:text-gray-500">
                      {b.coe}: {b.fallback ? "no direct COE skill data -- showing org-wide common skills instead" : CONFIDENCE_LABEL[b.confidence]}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                {spec.skills.map((sk, si) => (
                  <span
                    key={`${sk.skill}-${sk.subskill}-${si}`}
                    title={sk.employee_count != null ? `${sk.employee_count} employees with real proficiency, avg score ${sk.avg_score}` : "manually added"}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400"
                  >
                    {sk.subskill || sk.skill}
                    <button onClick={() => removeSkill(i, si)} className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-300">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {spec.skills.length === 0 && <span className="text-xs text-gray-400 dark:text-gray-500 italic">No skills specified yet.</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={skillDrafts[i] ?? ""}
                  onChange={(e) => setSkillDrafts((prev) => ({ ...prev, [i]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill(i))}
                  placeholder="Add a skill…"
                  className="flex-1 text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 outline-none"
                />
                <button onClick={() => addSkill(i)} className="text-[11px] text-primary hover:underline whitespace-nowrap">
                  + Add skill
                </button>
              </div>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between">
          <button
            onClick={() => setSpecs((prev) => [...prev, blankSpec()])}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add project
          </button>
          <button
            onClick={() => forecast.mutate()}
            disabled={forecast.isPending || anyPreviewLoading}
            className="px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            {forecast.isPending ? "Computing…" : "Run Forecast"}
          </button>
        </div>
      </div>

      {forecast.isPending && !forecast.data && (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
          <TableSkeleton columns={8} rows={6} />
        </div>
      )}

      {forecast.data && (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-1">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">What was forecast</p>
            {forecast.data.role_mix_sources.map((rs, i) => (
              <p key={i} className="text-[11px] text-gray-500 dark:text-gray-400">
                Spec {i + 1}: {rs.spec.count}x {rs.spec.coes?.join(", ") || rs.spec.category || "manual role-mix"}
                {rs.spec.type_of_project ? ` (${rs.spec.type_of_project})` : ""} -- role-mix:{" "}
                {formatRoleMixSource(rs.source, rs.sample_size, rs.source === "docx_given" ? rs.spec.category : rs.spec.type_of_project)}
              </p>
            ))}
            {forecast.data.required_skills.length > 0 && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Skills considered across this run: {forecast.data.required_skills.join(", ")}
              </p>
            )}
          </div>

          {forecast.data.total_shortfall_headcount > 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Shortfall of <strong>{forecast.data.total_shortfall_headcount}</strong> heads across roles -- redeployment alone can&apos;t cover this.
              {forecast.data.total_shortfall_value_usd > 0 && (
                <span className="ml-1">That&apos;s <strong>{formatUsd(forecast.data.total_shortfall_value_usd)}/mo</strong> of demand we can&apos;t staff without hiring.</span>
              )}
              {forecast.data.pct_achievable_with_current_headcount != null && (
                <span className="ml-1">
                  With the headcount we already have, we can hit{" "}
                  <strong>{forecast.data.pct_achievable_with_current_headcount}%</strong> of this engagement&apos;s
                  monthly billable value without hiring.
                </span>
              )}
            </div>
          ) : (
            <div className="px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400 text-sm">
              Fully coverable by redeployment -- no hiring needed for this scenario
              {forecast.data.pct_achievable_with_current_headcount != null &&
                ` (100% of monthly billable value achievable with current headcount)`}
              .
            </div>
          )}

          <div className="rounded-xl bg-white dark:bg-gray-900 overflow-hidden" style={{ border: `1px solid ${JMAN.emerald}40` }}>
            <div className="overflow-x-auto">
            <table className="w-full text-xs data-table">
              <thead className="text-white" style={{ background: JMAN_HEADER_GRADIENT }}>
                <tr>
                  {["", "Designation", "Needed By", "Needed Headcount", "Covers This Role", "Shortfall", "Shortfall $/mo", "Signal"].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecast.data.breakdown.map((b) => {
                  const rowKey = `${b.designation}__${b.start_date}`;
                  return (
                    <tr
                      key={rowKey}
                      onClick={() => setDetailRole(b)}
                      className="border-b border-gray-50 dark:border-gray-800/60 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 cursor-pointer"
                    >
                      <td className="px-3 py-2">
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{b.designation}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {b.start_date}
                        {b.duration_weeks != null && <span className="text-gray-300 dark:text-gray-600"> +{b.duration_weeks}w</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{b.needed_headcount}</td>
                      <td className="px-3 py-2 align-top">
                        <span
                          className="text-gray-800 dark:text-gray-200 font-semibold"
                          title="Same-title + adjacent-title matches only -- the only pool the Shortfall column trusts as a realistic redeployment."
                        >
                          {b.qualifying_for_redeploy + b.adjacent_fill_count} covers / {b.needed_headcount} needed
                        </span>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                          <div>
                            {b.qualifying_for_redeploy} on-skill, same title
                            {b.qualifying_for_redeploy < b.available_for_redeploy && (
                              <span
                                className="text-amber-600 dark:text-amber-400"
                                title="Holds this title but doesn't meet the requested skillset"
                              > ({b.available_for_redeploy} hold the title in total)</span>
                            )}
                          </div>
                          {b.adjacent_fill_count > 0 && (
                            <div className="text-emerald-600 dark:text-emerald-400">+{b.adjacent_fill_count} adjacent-title, flexible fit</div>
                          )}
                          {b.cross_role_match_count > 0 && (
                            <div className="text-blue-600 dark:text-blue-400" title="Real skill-record overlap from a different job title -- not counted toward Shortfall">
                              {b.cross_role_match_count} cross-role match (not counted toward shortfall)
                            </div>
                          )}
                          {b.training_candidates.length > 0 && (
                            <div className="text-purple-600 dark:text-purple-400">{b.training_candidates.length} trainable (real skill gap)</div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{b.shortfall}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{b.shortfall_value_usd > 0 ? formatUsd(b.shortfall_value_usd) : "-"}</td>
                      <td className="px-3 py-2">{b.hire_signal ? <Badge variant="red">hire</Badge> : <Badge variant="green">covered</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          {forecast.data.excluded_rare_roles.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
              <button
                onClick={() => setRareRolesOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                <span>
                  {forecast.data.excluded_rare_roles.length} rare role{forecast.data.excluded_rare_roles.length > 1 ? "s" : ""} not counted
                  toward headcount need (historically needed on under 40% of past projects)
                </span>
                {rareRolesOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />}
              </button>
              {rareRolesOpen && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 flex flex-wrap gap-1.5">
                  {forecast.data.excluded_rare_roles.map((r) => (
                    <span
                      key={r.designation}
                      title={`Needed ${r.fte} FTE in this run, but only ~${r.prevalence_pct ?? "?"}% of historical projects in this role-mix needed one at all`}
                      className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400"
                    >
                      {r.designation} ({r.prevalence_pct ?? "?"}% of past projects)
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
      </div>

      {selectedEmployee && (
        <EmployeeProfileModal
          employeeId={selectedEmployee.employeeId}
          initialTab={selectedEmployee.tab ?? "allocations"}
          skillMatchContext={selectedEmployee.skillMatchContext}
          onClose={() => setSelectedEmployee(null)}
        />
      )}
    </div>
  );
}
