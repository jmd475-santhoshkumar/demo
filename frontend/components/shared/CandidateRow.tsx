"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CheckCircle2, XCircle } from "lucide-react";
import {
  api,
  DEFAULT_INCLUDE_PARAMS,
  type EmployeeProjectHistoryRow,
  type IncludeParams,
  type RecommendationCandidate,
} from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { HoldChip } from "@/components/shared/HoldFlag";
import { Modal } from "@/components/shared/Modal";
import { SIGNAL_LABEL } from "@/components/shared/candidateFilters";
import type { ProfileTab, SkillMatchContext } from "@/components/shared/EmployeeProfileModal";
import { cn } from "@/lib/utils";

// The exact same candidate row used on the Resourcing page -- shared so
// every other surface that lists ranked candidates (Leave backfill, Employee
// Profile Replacement tab, Relief Staffing, New Project forecast) renders
// them identically: same badges, same expandable skill/AI/track-record proof,
// same hold flag.

export function ProjectHistoryModal({
  employeeId,
  category,
  onClose,
}: {
  employeeId: string;
  category?: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["employee-project-history", employeeId, category],
    queryFn: () => api.employeeProjectHistory(employeeId, category),
  });

  return (
    <Modal
      title={category ? `${employeeId} — ${category} projects` : `${employeeId} — Project history`}
      subtitle={data ? `${data.length} project${data.length === 1 ? "" : "s"}` : undefined}
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="p-4">
        {isLoading && <p className="text-xs text-gray-400 dark:text-gray-500">Loading…</p>}
        {error != null && <p className="text-xs text-red-500 dark:text-red-400">Could not load project history.</p>}
        {data && data.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">No matching projects.</p>}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:text-gray-500 dark:border-gray-800">
                  <th className="py-1.5 pr-3 font-medium">Project</th>
                  <th className="py-1.5 pr-3 font-medium">Category</th>
                  <th className="py-1.5 pr-3 font-medium">Tech CoE</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Period</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row: EmployeeProjectHistoryRow) => (
                  <tr key={row.project_code} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{row.project_name}</td>
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{row.proposition_coe.join(", ") || "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{row.tech_coe.join(", ") || "—"}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={row.status === "ACTIVE" ? "eligible" : "trainable"}>{row.status}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap dark:text-gray-500">{row.start_date ?? "?"} → {row.end_date ?? "?"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function Metric({ label, value, suffix, onClick }: { label: string; value: number; suffix?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="text-left group" type="button">
      <p className="text-gray-400 mb-0.5 group-hover:text-primary transition dark:text-gray-500">{label}</p>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden dark:bg-gray-800">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(value, 1) * 100}%` }} />
      </div>
      <p className="text-gray-500 mt-0.5 group-hover:underline dark:text-gray-400">{suffix ?? value.toFixed(2)}</p>
    </button>
  );
}

export function CandidateRow({
  candidate,
  rank,
  isTopPick,
  isExpanded,
  onToggleExpand,
  onOpenProfile,
  includeParams = DEFAULT_INCLUDE_PARAMS,
  onAssign,
}: {
  candidate: RecommendationCandidate;
  rank: number;
  isTopPick: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenProfile: (tab: ProfileTab, skillMatchContext?: SkillMatchContext) => void;
  includeParams?: IncludeParams;
  onAssign?: () => void;
}) {
  const [aiProofOpen, setAiProofOpen] = useState(false);
  const [projectHistoryFilter, setProjectHistoryFilter] = useState<{ category?: string } | null>(null);
  return (
    <div
      className={cn(
        "rounded-xl border bg-white overflow-hidden transition dark:bg-gray-900",
        isTopPick ? "border-emerald-300 ring-1 ring-emerald-100 dark:border-emerald-700 dark:ring-emerald-900/40" : "border-gray-200 dark:border-gray-700"
      )}
    >
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50/70 transition flex-wrap dark:hover:bg-gray-800/70"
      >
        <span className="text-[11px] text-gray-400 w-4 flex-shrink-0 dark:text-gray-500">{rank}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenProfile("overview"); }}
          className="text-sm font-semibold text-primary hover:underline whitespace-nowrap"
        >
          {candidate.employee_id}
          {candidate.employee_full_name && <span className="font-normal text-gray-500 dark:text-gray-400"> - {candidate.employee_full_name}</span>}
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{candidate.job_name}</span>
        {candidate.coe ? (
  <span
    title={candidate.coe_preferred
      ? "This candidate's home CoE matches what this role is asking for"
      : "This candidate's home CoE is not the preferred one for this role — shown because no preferred-CoE candidate ranked higher"}
    className={cn(
      "text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 border",
      candidate.coe_preferred
        ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-400"
        : "bg-violet-50 border-violet-200 text-violet-600 dark:bg-violet-950/40 dark:border-violet-800/60 dark:text-violet-400"
    )}
  >
    {candidate.coe}{candidate.coe_preferred ? " · preferred" : ""}
  </span>
) : null}
        {candidate.bucket !== "gap" && <Badge variant={candidate.bucket}>{SIGNAL_LABEL[candidate.bucket]}</Badge>}
        {isTopPick && <Badge variant="eligible">Top pick</Badge>}
        {!candidate.meets_requested_capacity && <Badge variant="amber">below requested %</Badge>}
        <HoldChip onHold={candidate.on_hold} holdProjects={candidate.hold_projects} />
        {candidate.match_tier === "same_grade_fallback" && (
          <span
            title="Same grade/CoE as requested -- no verified skill overlap"
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap flex-shrink-0 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400"
          >
            grade match only
          </span>
        )}
        {candidate.match_tier === "adjacent_level_fallback" && (
          <span
            title="One level up/down the seniority ladder from what was requested -- no verified skill overlap"
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap flex-shrink-0 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400"
          >
            adjacent level
          </span>
        )}
        {candidate.skill_confidence === "semantic_match" && (
          <span
            title="AI semantic similarity only — no matching skill records found in this employee's profile. Verify skill fit before selecting."
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-600 whitespace-nowrap flex-shrink-0 dark:bg-blue-950/40 dark:border-blue-800/60 dark:text-blue-400"
          >
            AI{candidate.semantic_score != null ? ` ${Math.round(candidate.semantic_score * 100)}%` : ""} · no word match
          </span>
        )}
        {candidate.experience_confidence === "observed" && (
          <span
            title={`${candidate.relevant_project_count} of ${candidate.total_projects} completed/active projects match this deal's category`}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0",
              candidate.relevant_project_ratio >= 0.6
                ? "bg-teal-50 border-teal-200 text-teal-700 dark:bg-teal-950/40 dark:border-teal-800/60 dark:text-teal-400"
                : "bg-gray-50 border-gray-200 text-gray-500 dark:bg-gray-800/60 dark:border-gray-700 dark:text-gray-400"
            )}
          >
            {candidate.relevant_project_ratio >= 0.6 ? "specialist · " : ""}
            {candidate.relevant_project_count}/{candidate.total_projects} relevant projects
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0 dark:text-gray-500">
          {candidate.hourly_rate_usd != null && <span>${candidate.hourly_rate_usd}/hr</span>}
          <span>{Math.round(candidate.skill_score * 100)}% skill</span>
          <span>{Math.round(candidate.competency_score * 100)}% comp</span>
          <span>{candidate.available_pct}% avail</span>
          <span className="text-gray-600 font-semibold dark:text-gray-400">{Math.round(candidate.composite_score * 100)}%</span>
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} />
        </span>
      </button>
      {onAssign && (
        <div className="px-3.5 pb-2.5 -mt-1">
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            className="text-[11px] px-2 py-1 rounded-lg bg-primary text-white hover:opacity-90"
          >
            Assign
          </button>
        </div>
      )}
      {isExpanded && (
        <div className="border-t border-gray-100 px-3.5 py-3 space-y-2.5 dark:border-gray-800">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric
              label="Skill"
              value={candidate.skill_score}
              suffix={`${Math.round(candidate.skill_score * 100)}%`}
              onClick={() =>
                onOpenProfile("skills", {
                  matchedSkills: candidate.matched_skills,
                  missingSkills: candidate.missing_skills,
                })
              }
            />
            <Metric
              label="Competency"
              value={candidate.competency_score}
              suffix={`${Math.round(candidate.competency_score * 100)}%`}
              onClick={() => onOpenProfile("competency")}
            />
            <Metric
              label="Available"
              value={candidate.available_pct / 100}
              suffix={`${candidate.available_pct}%`}
              onClick={() => onOpenProfile("allocations")}
            />
          </div>
          {/* Word match vs AI breakdown — clickable for proof */}
          {(candidate.matched_skills.length + candidate.missing_skills.length > 0 || candidate.semantic_score != null) && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 text-[11px] bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 flex-wrap dark:bg-gray-800/60 dark:border-gray-800">
                <span className="text-gray-400 font-medium flex-shrink-0 dark:text-gray-500">Match method</span>
                {candidate.matched_skills.length + candidate.missing_skills.length > 0 && (
                  <button
                    onClick={() => onOpenProfile("skills", { matchedSkills: candidate.matched_skills, missingSkills: candidate.missing_skills })}
                    className="flex items-center gap-1 hover:underline group"
                    title="Click to see full skill records proof"
                  >
                    <span className="text-gray-500 dark:text-gray-400">Word:</span>
                    <span className={cn("font-semibold", candidate.matched_skills.length > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-300 dark:text-gray-600")}>
                      {candidate.matched_skills.length}/{candidate.matched_skills.length + candidate.missing_skills.length}
                    </span>
                    <span className="text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300">skills ↗</span>
                  </button>
                )}
                <span className="text-gray-200 dark:text-gray-700">·</span>
                {candidate.semantic_score != null ? (
                  <button
                    onClick={() => setAiProofOpen((v) => !v)}
                    className="flex items-center gap-1 hover:underline group"
                    title="Click to see AI similarity proof"
                  >
                    <span className="text-gray-500 dark:text-gray-400">AI:</span>
                    <span className={cn(
                      "font-semibold",
                      candidate.semantic_score >= 0.5 ? "text-blue-600 dark:text-blue-400" :
                      candidate.semantic_score >= 0.3 ? "text-blue-400 dark:text-blue-300" :
                      "text-gray-400 dark:text-gray-500"
                    )}>
                      {Math.round(candidate.semantic_score * 100)}% similarity
                    </span>
                    <span className="text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300">↗</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-1">
                    <span className="text-gray-500 dark:text-gray-400">AI:</span>
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  </span>
                )}
              </div>
              {aiProofOpen && candidate.semantic_score != null && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] space-y-1.5 dark:border-blue-900/60 dark:bg-blue-950/40">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-blue-700 dark:text-blue-400">AI Semantic Similarity — Proof</span>
                    <button onClick={() => setAiProofOpen(false)} className="text-blue-400 hover:text-blue-600 text-xs leading-none dark:text-blue-300 dark:hover:text-blue-400">✕</button>
                  </div>
                  <p className="text-blue-700 dark:text-blue-400">
                    Score: <span className="font-semibold">{Math.round(candidate.semantic_score * 100)}%</span>
                    {" — "}
                    {candidate.semantic_score >= 0.6
                      ? "Strong semantic overlap between this employee's skill profile and the job requirement."
                      : candidate.semantic_score >= 0.4
                      ? "Moderate semantic overlap detected."
                      : candidate.semantic_score >= 0.25
                      ? "Weak overlap — word token matching is the stronger signal here."
                      : "Very low similarity — AI found minimal semantic overlap with the required skillset."}
                  </p>
                  <p className="text-blue-500 dark:text-blue-400">
                    Method: all-MiniLM-L6-v2 sentence embeddings, cosine similarity. Final skill score blends 65% AI + 35% word token match.
                    {candidate.skill_confidence === "semantic_match"
                      ? " Word matching found no overlap — AI is the sole signal for surfacing this candidate."
                      : " Word matching also found evidence — AI acts as a supporting signal."}
                  </p>
                </div>
              )}
            </div>
          )}
          {candidate.matched_skills.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5 dark:text-emerald-400" />
              <span className="text-gray-500 dark:text-gray-400">{candidate.matched_skills.join(", ")}</span>
            </div>
          )}
          {candidate.missing_skills.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs">
              <XCircle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5 dark:text-gray-600" />
              <span className="text-gray-400 dark:text-gray-500">{candidate.missing_skills.join(", ")}</span>
            </div>
          )}
          {candidate.total_projects > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
              <span className="text-gray-400 font-medium flex-shrink-0 dark:text-gray-500">Track record</span>
              <button
                onClick={() => setProjectHistoryFilter({})}
                className="px-1.5 py-0.5 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-primary hover:text-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
              >
                {candidate.total_projects} projects ↗
              </button>
              <button
                onClick={() => setProjectHistoryFilter({})}
                className="px-1.5 py-0.5 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-primary hover:text-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
              >
                {candidate.distinct_clients} clients ↗
              </button>
              {candidate.top_categories.map((tc) => (
                <button
                  key={tc.category}
                  onClick={() => setProjectHistoryFilter({ category: tc.category })}
                  className={cn(
                    "px-1.5 py-0.5 rounded-full border",
                    candidate.experience_confidence === "observed" && tc.category === candidate.top_categories[0].category
                      ? "bg-teal-50 border-teal-200 text-teal-700 hover:border-teal-400 dark:bg-teal-950/40 dark:border-teal-800/60 dark:text-teal-400 dark:hover:border-teal-600"
                      : "bg-white border-gray-200 text-gray-500 hover:border-primary hover:text-primary dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400"
                  )}
                >
                  {tc.category} ({tc.count}) ↗
                </button>
              ))}
              {includeParams.category_match && (
                <span className="ml-auto text-gray-400 dark:text-gray-500">cat {Math.round(candidate.relevant_project_ratio * 100)}%</span>
              )}
              {includeParams.project_count && (
                <span className="text-gray-400 dark:text-gray-500">count {Math.round(candidate.project_count_score * 100)}%</span>
              )}
            </div>
          )}
          {projectHistoryFilter && (
            <ProjectHistoryModal
              employeeId={candidate.employee_id}
              category={projectHistoryFilter.category}
              onClose={() => setProjectHistoryFilter(null)}
            />
          )}
          {candidate.earliest_available_date && (
            <p className="text-[11px] text-blue-600 dark:text-blue-400">
              Free from <strong>{candidate.earliest_available_date}</strong> — {candidate.earliest_available_proof}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
