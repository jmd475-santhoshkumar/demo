import type { IncludeParams, RecommendationCandidate } from "@/lib/api";

export type CandidateSignalFilter = "all" | "redeploy" | "training" | "hire" | "not_assessed";
export type SkillDataFilter = "all" | "observed" | "imputed" | "no_match" | "no_requirement" | "semantic_match";
export type CandidateSort = "composite" | "skill" | "competency" | "available" | "experience";

export const UNKNOWN_COE = "__unknown__";

export const SIGNAL_FILTER_TO_BUCKET: Record<Exclude<CandidateSignalFilter, "all">, RecommendationCandidate["bucket"]> = {
  redeploy: "eligible",
  training: "trainable",
  hire: "gap",
  not_assessed: "not_assessed",
};

export const SKILL_DATA_LABEL: Record<Exclude<SkillDataFilter, "all">, string> = {
  observed: "Observed (real)",
  imputed: "Inferred",
  no_match: "No match found",
  no_requirement: "Not assessed (no skillset)",
  semantic_match: "Semantic match (AI)",
};

export const SIGNAL_LABEL: Record<RecommendationCandidate["bucket"], string> = {
  eligible: "Redeploy",
  trainable: "Needs training",
  gap: "Hire signal",
  not_assessed: "Not assessed",
};

export function friendlyConfidence(value: string | null | undefined): string {
  switch (value) {
    case "observed": return "observed (real skill records)";
    case "imputed": return "inferred (peer/default)";
    case "no_match": return "no word match";
    case "no_requirement": return "no skillset specified";
    case "semantic_match": return "semantic match via AI embeddings";
    default: return value ?? "—";
  }
}

export function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function matchesNormalized(value: string | null | undefined, filterValue: string): boolean {
  return normalizeLabel(value).toLowerCase() === filterValue.toLowerCase();
}

export function buildNormalizedOptions(values: (string | null | undefined)[]): string[] {
  const variantCounts = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const trimmed = normalizeLabel(raw);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const inner = variantCounts.get(key) ?? new Map<string, number>();
    inner.set(trimmed, (inner.get(trimmed) ?? 0) + 1);
    variantCounts.set(key, inner);
  }
  const canonical: string[] = [];
  for (const inner of variantCounts.values()) {
    canonical.push([...inner.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return canonical.sort();
}

export interface CandidateFilterOptions {
  search: string;
  signal: CandidateSignalFilter;
  designation: string;
  coe: string;
  skillData: SkillDataFilter;
  minSkill: number;
  minCompetency: number;
  minAvailable: number;
  meetsCapacityOnly: boolean;
  minRelevantProjects: number;
  relevantExperienceOnly: boolean;
  sort: CandidateSort;
}

export function filterAndSortCandidates(candidates: RecommendationCandidate[], opts: CandidateFilterOptions): RecommendationCandidate[] {
  let result = candidates;

  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (c) =>
        c.employee_id.toLowerCase().includes(q) ||
        (c.job_name ?? "").toLowerCase().includes(q) ||
        c.matched_skills.some((s) => s.toLowerCase().includes(q)) ||
        c.missing_skills.some((s) => s.toLowerCase().includes(q))
    );
  }
  if (opts.signal !== "all") {
    const signal = opts.signal;
    result = result.filter((c) => c.bucket === SIGNAL_FILTER_TO_BUCKET[signal]);
  }
  if (opts.designation !== "all") {
    const designation = opts.designation;
    result = result.filter((c) => matchesNormalized(c.job_name, designation));
  }
  if (opts.coe !== "all") {
    result = opts.coe === UNKNOWN_COE ? result.filter((c) => !c.coe) : result.filter((c) => matchesNormalized(c.coe, opts.coe));
  }
  if (opts.skillData !== "all") {
    const skillData = opts.skillData;
    result = result.filter((c) => c.skill_confidence === skillData);
  }
  if (opts.minSkill > 0) result = result.filter((c) => c.skill_score >= opts.minSkill / 100);
  if (opts.minCompetency > 0) result = result.filter((c) => c.competency_score >= opts.minCompetency / 100);
  if (opts.minAvailable > 0) result = result.filter((c) => c.available_pct >= opts.minAvailable);
  if (opts.meetsCapacityOnly) result = result.filter((c) => c.meets_requested_capacity);
  if (opts.minRelevantProjects > 0) result = result.filter((c) => c.relevant_project_count >= opts.minRelevantProjects);
  if (opts.relevantExperienceOnly) result = result.filter((c) => c.relevant_project_count > 0);

  const sorted = [...result];
  switch (opts.sort) {
    case "composite":
      // Trust the backend's own order rather than re-deriving it here: the
      // backend already applies every Advanced Filters parameter correctly
      // (skill bucket/confidence, coe_affinity, availability, AND the cost-
      // efficiency tiebreak) when it builds this response. A second,
      // independent JS re-sort duplicating that logic previously missed the
      // cost-efficiency tiebreak entirely, silently undoing it every render.
      // `.filter()` above preserves relative order, so no explicit sort call
      // is needed here at all -- doing nothing is the correct behavior.
      break;
    case "skill":
      sorted.sort((a, b) => b.skill_score - a.skill_score);
      break;
    case "competency":
      sorted.sort((a, b) => b.competency_score - a.competency_score);
      break;
    case "available":
      sorted.sort((a, b) => b.available_pct - a.available_pct);
      break;
    case "experience":
      sorted.sort((a, b) => b.relevant_project_count - a.relevant_project_count || b.relevant_project_ratio - a.relevant_project_ratio);
      break;
  }
  return sorted;
}

export interface AdvancedParamDef {
  key: keyof IncludeParams;
  label: string;
  weightPct: number; // base weight this parameter contributes when checked -- see BASE_WEIGHTS in scoring.py. Selected subset is renormalized to sum to 100%.
  description: string;
}

// One entry per independently-selectable ranking parameter, all 5 editable --
// nothing is hard-locked "always on". Extensible by design -- adding a new
// parameter later is just another entry here, a matching field on
// RecommendationCandidate, and a matching key on IncludeParams/BASE_WEIGHTS.
// Shared by every recommendation-adjacent surface in the app (Resourcing
// page, Leave backfill, Employee Profile Replacement/Redeploy tabs, Relief
// Staffing, New Project forecast) so "advanced filters" means the exact same
// thing everywhere.
export const ADVANCED_PARAMS: AdvancedParamDef[] = [
  { key: "skill", label: "Skill match", weightPct: 40, description: "" },
  { key: "competency", label: "Competency", weightPct: 25, description: "" },
  { key: "availability", label: "Availability", weightPct: 35, description: "" },
  { key: "category_match", label: "COE / Proposition category match", weightPct: 15, description: "" },
  { key: "project_count", label: "Number of projects completed", weightPct: 15, description: "" },
  { key: "coe_affinity", label: "CoE preference", weightPct: 15, description: "" },
  { key: "cost_efficiency", label: "Budget-friendly", weightPct: 0, description: "Tiebreak among near-equal matches only." },
];

export function isNonDefaultParams(include: IncludeParams, defaults: IncludeParams): boolean {
  return (Object.keys(defaults) as (keyof IncludeParams)[]).some((k) => include[k] !== defaults[k]);
}
