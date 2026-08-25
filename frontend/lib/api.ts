
import {
  uploadDatasetViaManager,
  uploadJdwhFilesViaManager,
  uploadJdwhWorkbookViaManager,
} from "./uploadManager";

const BASE = "/api";

// FastAPI's HTTPException(status_code, detail=...) puts the actual, specific
// reason (e.g. "Could not connect: <the real pyodbc error>") in the response
// body's `detail` field -- a bare `${path} failed: ${status}` throws that
// away and leaves every error banner in the app equally uninformative.
async function extractErrorMessage(res: Response, path: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // Response wasn't JSON (or was empty) -- fall through to the generic message.
  }
  return `${path} failed: ${res.status}`;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await extractErrorMessage(res, path));
  return res.json();
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, path));
  return res.json();
}

export interface AuthConfig {
  sso_enabled: boolean;
}

export interface AuthUser {
  email: string;
  name: string | null;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  return getJSON<AuthConfig>("/auth/config");
}

export async function getCurrentUser(): Promise<AuthUser> {
  return getJSON<AuthUser>("/auth/me");
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: "POST" });
}

export interface AllocationRow {
  allocation_id: string;
  employee_id: string;
  job_name: string | null;
  department_name: string | null;
  location: string | null;
  project_id: string;
  // Real project name from the JDWH source (e.g. "Permira - Ergomed - Sales
  // Funnel / ICP Phase 1") -- null for anything mapped before this field
  // existed, never fabricated.
  project_name: string | null;
  type_of_project: string | null;
  coe: string | null;
  resourcing_status: string;
  allocation_by_percentage: number;
  allocated_start_date: string;
  allocated_end_date: string;
  // Resource manager's own record of a real-world extension, kept separate
  // from allocated_end_date/project_end_date so both remain visible.
  extended_end_date: string | null;
  extended_status: "BILLABLE" | "UNBILLABLE" | "SHADOW" | null;
  project_end_date: string | null;
  project_extended_end_date: string | null;
  project_extended_end_status: "BILLABLE" | "UNBILLABLE" | null;
  employee_total_allocation_pct: number;
  // Excludes Internal Project allocation -- this is what utilization_band's
  // "over_allocated" is actually judged on, since internal work is discretionary.
  employee_client_allocation_pct: number;
  employee_internal_allocation_pct: number;
  over_allocated_due_to_internal: boolean;
  utilization_band: "over_allocated" | "normal" | "under_utilized";
  actual_hours_logged: number;
  expected_hours: number;
  hours_utilization_pct: number | null;
  hours_data_available: boolean;
  possible_unplanned_absence: boolean;
  days_to_end: number;
  ending_soon: boolean;
}

export interface RoleMixTemplate {
  type_of_project: string;
  tech_coe: string | null;
  role_mix: Record<string, number>;
  sample_size: number | null;
  source: string;
}

export interface RoleMixDetailRow {
  designation: string;
  headcount: number;
  typical_pct: number;
  prevalence_pct: number | null;
  common: boolean;
}

export interface DocxCategoryRoleMix {
  category: string;
  role_mix: Record<string, number>;
  roles: RoleMixDetailRow[];
  sample_size: number | null;
  source: string;
  resolved_via?: Record<string, unknown>;
}

export interface TeamSizeBucketExample {
  project_code: string;
  project_name: string | null;
  // Only populated for a risky example -- which real signal(s) fired (a
  // real extension and whether it was billable/unbillable, a WSR RED
  // status, a real WSR risk note, a real logged Cluster Governance risk, or
  // a real effort spike near the project's end).
  reasons?: string[];
}

export interface TeamSizeBucket {
  headcount: number;
  total: number;
  clean: number;
  risky: number;
  clean_rate: number | null;
  clean_examples: TeamSizeBucketExample[];
  risky_examples: TeamSizeBucketExample[];
}

// Minimal-change guidance for the team currently selected in the budget --
// does its headcount match a size that historically stayed clean for real
// completed projects of this same type/CoE, or would adding/removing
// exactly one person (of a specific role) have a meaningfully better track
// record. See backend/app/engines/role_mix_engine.py's analyze_team_size_fit.
export interface TeamSizeFitResult {
  current_headcount: number;
  recommendation: "sufficient" | "add_one" | "remove_one" | "not_enough_data" | "no_data" | "unknown_project";
  suggested_role?: string | null;
  coe: string | null;
  type_of_project: string | null;
  proposition_coe: string | null;
  matched_by: string | null;
  // The real duration this project is planned for, and whether precedent
  // projects were also narrowed to a similar length (0.5x-2x) before
  // bucketing by headcount -- only applied when enough precedents remain to
  // still bucket meaningfully, else the comparison stays type/CoE-only.
  target_duration_weeks?: number | null;
  duration_narrowed?: boolean;
  current_bucket?: TeamSizeBucket;
  smaller_bucket?: TeamSizeBucket | null;
  larger_bucket?: TeamSizeBucket;
  best_bucket?: TeamSizeBucket;
  // AI-generated plain-language read of the same real numbers above -- null
  // whenever no AI provider is configured, a call fails, or there's nothing
  // to reason about yet (see backend/app/services/team_size_insight_service.py).
  ai_summary?: string | null;
}

export type StaffingSignal = "redeploy" | "redeploy_with_training" | "hire" | "not_assessed";
export type CandidateBucket = "eligible" | "trainable" | "gap" | "not_assessed";

export type MatchTier = "skill_match" | "same_grade_fallback" | "adjacent_level_fallback" | null;

export type ExperienceConfidence = "observed" | "related_only" | "no_history" | "no_match" | "no_requirement";

// All 5 ranking parameters are independently selectable in Advanced Filters --
// mirrors scoring.BASE_WEIGHTS on the backend. skill/competency/availability
// default true, the other two default false.
export interface IncludeParams {
  skill: boolean;
  competency: boolean;
  availability: boolean;
  category_match: boolean;
  project_count: boolean;
  cost_efficiency: boolean;
  coe_affinity: boolean;
}

export const DEFAULT_INCLUDE_PARAMS: IncludeParams = {
  skill: true,
  competency: true,
  availability: true,
  category_match: false,
  project_count: false,
  cost_efficiency: false,
  coe_affinity: true,
};

export interface EmployeeProjectHistoryRow {
  project_code: string;
  project_name: string;
  proposition_coe: string[];
  tech_coe: string[];
  status: string;
  type_of_project: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ExperienceCategory {
  category: string;
  count: number;
}

export interface HoldProject {
  project_code: string;
  is_extension_risk: boolean;
  devops_extension_risk: boolean;
  projected_extension_duration_label: string | null;
  projected_extension_confidence: "none" | "low" | "medium";
}

export interface RecommendationCandidate {
  employee_id: string;
  employee_full_name: string | null;
  job_name: string;
  coe: string | null;
  coe_preferred?: boolean;
  coe_affinity_rank?: number;
  composite_score: number;
  bucket: CandidateBucket;
  staffing_signal: StaffingSignal;
  explanation: string;
  skill_score: number;
  matched_skills: string[];
  missing_skills: string[];
  skill_confidence: string;
  semantic_score?: number | null;
  competency_score: number;
  competency_confidence: string;
  available_pct: number;
  meets_requested_capacity: boolean;
  hourly_rate_usd: number | null;
  match_tier?: MatchTier;
  earliest_available_date?: string | null;
  earliest_available_proof?: string | null;
  on_leave_now?: boolean;
  in_free_pool?: boolean;
  // True when this person is currently actively allocated to a project the
  // Health monitor flags as likely to extend past its end date -- see
  // app/engines/availability_hold.py. They may look free/available on paper
  // while their current project is actually at risk of running long.
  on_hold?: boolean;
  hold_projects?: HoldProject[];
  // Track-record / experience layer -- see app/engines/experience_engine.py
  total_projects: number;
  distinct_clients: number;
  relevant_project_count: number;
  relevant_project_ratio: number;
  experience_confidence: ExperienceConfidence;
  top_categories: ExperienceCategory[];
  project_count_score: number;
}

export interface FallbackCandidates {
  requested_designations: string[];
  same_grade: RecommendationCandidate[];
  adjacent_level: RecommendationCandidate[];
}

export interface DealCompositionRow {
  row_index: number;
  resources_requested: string | null;
  requested_pct: string | null;
  skillset: string | null;
  is_current: boolean;
}

export interface RecommendationResult {
  request: {
    skillset_text: string;
    required_phrases: string[];
    likely_start_date: string;
    requested_pct: number;
    near_capacity_tolerance_pct?: number;
  };
  candidates: RecommendationCandidate[];
  // Designation-proximity gate applied to the candidate pool: 1=same level
  // only, 2=+/-1 level, 3=+/-2 levels. designation_pool_counts is how many
  // delivery-eligible employees exist at EACH tier (independent of the tier
  // actually selected), so the UI can hint "try Flex 2" even before the RM
  // clicks it.
  designation_flex_level?: number | null;
  designation_pool_counts?: Record<string, number> | null;
  hire_vs_redeploy_flag: boolean;
  top_candidate_signal: StaffingSignal;
  // false when no skillset was specified at all -- candidates are then ranked by
  // competency/availability only, with zero skill match performed (bucket "not_assessed"
  // for all of them). The fixed top-15 display cap looks identical either way without this.
  has_skillset: boolean;
  total_employees_considered: number;
  candidate_pool_size: number;
  candidates_with_real_skill_match: number;
  genuine_skill_match_count?: number;
  observed_skill_match_count?: number;
  inferred_skill_match_count?: number;
  semantic_only_match_count?: number;
  fallback_candidates?: FallbackCandidates | null;
  best_fit_if_delayed?: RecommendationCandidate[];
  // Everyone scored who isn't in `candidates` above -- same engine, same fields,
  // no gating/cap. Powers the "Other options to consider" section.
  other_options?: RecommendationCandidate[];
  other_options_window_days?: number;
  deal_composition: DealCompositionRow[];
  pipeline_row?: {
    row_index: number;
    deal_id: number | null;
    cluster: number | null;
    client: string | null;
    client_priority: string | null;
    em: string | null;
    solution: string | null;
    resources_requested: string | null;
    requested_pct: string | null;
    sow_signed: string | null;
    status: string | null;
    priority: string | null;
    likely_start_date: string | null;
    request_received: string | null;
    original_requested_start_date: string | null;
    start_date_confirmed: string | null;
    number_of_weeks: number | string | null;
    request_type: string | null;
    deal_stage_hubspot: string | null;
    comments: string | null;
    skillset_coe_categories: string[];
    skillset_classification_proof: SkillsetClassificationProofRow[];
    requested_designations?: string[];
    // "given" when the deal author's own real skillset text was used;
    // otherwise which fallback tier supplied it -- see
    // app/engines/pipeline_skill_inference.py for the exact priority chain.
    required_skill_source?: "given" | "coe_mapping" | "embedding_match" | "org_fallback";
    inferred_skill_info?: InferredSkillInfo | null;
  };
}

export interface InferredSkillInfo {
  skillset_text: string;
  required_skills: string[];
  source: "coe_mapping" | "embedding_match" | "org_fallback";
  matched_coe: string | null;
  confidence: "medium" | "low" | "very_low";
  match_score_pct?: number;
  detail: string;
}

export interface DealRole {
  row_index: number;
  resources_requested: string | null;
  requested_pct: string | null;
  skillset: string | null;
  status: string | null;
  priority: string | null;
  likely_start_date: string | null;
  client_priority: string | null;
  request_type: string | null;
  deal_stage_hubspot: string | null;
  start_date_confirmed: string | null;
  is_late_notice: boolean | null;
  requested_designations: string[];
}

export interface DealSummary {
  deal_key: string;
  row_indices: number[];
  client: string | null;
  cluster: number | null;
  solution: string | null;
  role_count: number;
  roles: DealRole[];
  earliest_start: string | null;
  priority: string | null;
  status: string | null;
  sow_signed: boolean;
  is_late_notice: boolean;
  start_date_confirmed: string | null;
  client_priority: string | null;
  request_type: string | null;
  deal_stage_hubspot: string | null;
}

export type TeamRoleStatus = "assigned" | "hire_signal" | "conflict";

export interface TeamRoleResult {
  row_index: number;
  pipeline_row: RecommendationResult["pipeline_row"];
  requested_pct: number;
  has_skillset: boolean;
  hire_vs_redeploy_flag: boolean;
  status: TeamRoleStatus;
  assigned: RecommendationCandidate | null;
  alternatives: RecommendationCandidate[];
  candidates: RecommendationCandidate[];
  fallback_candidates?: FallbackCandidates | null;
}

export interface TeamCoverageSummary {
  total: number;
  assigned: number;
  hire_signal: number;
  conflict: number;
}

export interface ProjectTeamRecommendation {
  roles: TeamRoleResult[];
  coverage_summary: TeamCoverageSummary;
}

export interface SkillsetClassificationProofRow {
  coe_skill: string | null;
  coe_skills_list: string | null;
  skills_combined: string | null;
}

export interface CoverageSummaryRow {
  row_index: number;
  client: string | null;
  resources_requested: string | null;
  top_candidate_signal: StaffingSignal | null;
  top_bucket: CandidateBucket | null;
  has_skillset: boolean;
  real_skillset_given: boolean;
}

export interface CoverageSummary {
  total_demand_rows: number;
  // Now near-zero -- a real fallback (see pipeline_skill_inference.py) is
  // inferred for any row with no given skillset, so almost nothing is
  // actually unscoreable anymore.
  no_skillset_specified_count: number;
  // The real, still-useful data-hygiene signal: how many deals the author
  // never actually typed a skills list for (even though they're now scored
  // against an inferred one).
  no_real_skillset_given_count: number;
  redeploy_ready_count: number;
  redeploy_with_training_count: number;
  hire_signal_count: number;
  hire_signal_pct: number;
  rows: CoverageSummaryRow[];
}

export interface PipelineDemandRow {
  row_index: number;
  deal_id: number | null;
  cluster: number | null;
  client: string | null;
  client_priority: string | null;
  em: string | null;
  solution: string | null;
  status: string;
  priority: string | null;
  resources_requested: string | null;
  requested_pct: string | null;
  skillset: string | null;
  request_received: string | null;
  original_requested_start_date: string | null;
  request_type: string | null;
  start_date_confirmed: string | null;
  number_of_weeks: number | string | null;
  deal_stage_hubspot: string | null;
  comments: string | null;
  likely_start_date: string | null;
  sow_signed: string | null;
  notice_days: number | null;
  is_late_notice: boolean | null;
  skillset_coe_categories: string[];
}

export interface HealthProject {
  project_code: string;
  project_name: string | null;
  client_id: string | null;
  type_of_project: string;
  tech_coe: string | null;
  coe: string | null;
  n_employees: number;
  expected_headcount: number | null;
  is_understaffed: boolean;
  overrun_days: number | null;
  effective_end_date: string | null;
  planned_extension_days: number | null;
  shadow_unbilled_share: number | null;
  monthly_unbilled_value_usd: number;
  // Share (0-1) of the project's distinct team who joined more than 2 weeks
  // after the project's own start date, or left more than 2 weeks before its
  // end date -- real mid-project turnover, not team-size density. Only
  // computed/flagged for "Client Project" type_of_project.
  churn_rate: number | null;
  overtime_employee_count: number;
  is_effort_spike: boolean;
  wsr_trend: "deteriorating" | "stable" | "improving" | null;
  risk_score: number;
  risk_band: "high" | "medium" | "low";
  root_causes: string[];
  root_cause_categories: Record<string, string[]>;
  is_extension_risk: boolean;
  is_escalation_risk: boolean;
  is_pulse_risk: boolean;
  pulse_avg_score: number | null;
  pulse_response_count: number;
  is_ramp_down_candidate: boolean;
  days_to_ramp_down: number | null;
  wsr_data_available: boolean;
  wsr_worst_signal: string | null;
  wsr_latest_signal: string | null;
  devops_data_available: boolean;
  devops_extension_risk: boolean;
  devops_open_tickets: number;
  devops_blocked_tickets: number;
  devops_in_progress_tickets: number;
  devops_tickets_past_project_end: number;
  devops_remaining_effort_hours: number;
  devops_completed_work_hours: number;
  devops_original_estimate_hours: number;
  devops_effort_completion_pct: number | null;
  devops_to_do_tickets: number;
  devops_within_risk_window: boolean;
  devops_working_days_in_window: number;
  devops_team_capacity_hours: number;
  devops_team_capacity_hours_after_leave: number;
  devops_capacity_surplus_hours: number | null;
  devops_is_overdue: boolean;
  devops_tickets_missing_remaining_estimate: number;
  devops_tickets_with_no_effort_data: number;
  extension_unbilled_value_usd: number;
  team_daily_extension_cost_usd: number;
  projected_extension_days: number | null;
  projected_extension_weeks: number | null;
  predicted_extension_start_date: string | null;
  predicted_extension_end_date: string | null;
  projected_extension_duration_label: string | null;
  projected_extension_confidence: "none" | "low" | "medium";
  predicted_extension_revenue_loss_usd: number;
}

// ── Cluster Governance ──────────────────────────────────────────────────────

export interface GovernanceClusterSummary {
  number: number;
  name: string;
  project_count: number;
}

export interface GovernanceProject {
  project_code: string;
  project_name: string | null;
  client_id: string | null;
  type_of_project: string | null;
  project_start_date: string | null;
  project_end_date: string | null;
  extended_end_date: string | null;
  wsr_latest_signal: string | null;
  wsr_worst_signal: string | null;
  devops_data_available: boolean;
  devops_extension_risk: boolean;
  devops_open_tickets: number;
  devops_blocked_tickets: number;
  devops_in_progress_tickets: number;
  devops_tickets_past_project_end: number;
  devops_remaining_effort_hours: number;
  devops_capacity_surplus_hours: number | null;
  devops_is_overdue: boolean;
}

export interface GovernanceRisk {
  risk_id: string;
  project_code: string;
  project_name?: string | null;
  wsr_signal?: string | null;
  risk_description: string;
  risk_type: string | null;
  mitigation_steps: string | null;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}

// A suggested risk for a project with no real logged risk yet. When
// is_synthetic is false, risk_description is WSR's own real `risk` field
// verbatim (mitigation_steps is still AI-generated, grounded in that real
// text). When is_synthetic is true, both fields are AI-generated from the
// WSR RAG colors alone (pending real WSR comment access) -- unless
// is_ai_generated is also false, meaning no AI provider responded and
// risk_description is a plain "unavailable" status message, not content.
export interface GovernanceSuggestedRisk {
  risk_id: string;
  project_code: string;
  project_name: string | null;
  wsr_signal?: string | null;
  risk_description: string;
  risk_type: string | null;
  mitigation_steps: string | null;
  is_synthetic: boolean;
  is_ai_generated: boolean;
}

export interface GovernanceSpotlightEntry extends GovernanceProject {
  // Real, computed fresh every load -- never manually typed.
  devops_visibility: string;
  milestone_facts: string[];
  comments: string | null; // AI sentence grounded strictly in devops_visibility + milestone_facts
  // Genuinely manual -- no real data source for it.
  action_plan: string | null;
  // true if this project is here because it's a real top-risk_score pick
  // for the cluster (the default), false if someone manually added it.
  is_auto_picked: boolean;
}

export interface GovernanceKickoffEntry {
  project_code: string;
  project_name: string | null;
  project_start_date: string;
  kickoff_completed: "yes" | "no" | "pending";
  scope_approved: "yes" | "no" | "pending";
  devops_setup: "yes" | "no" | "pending";
  comment: string | null;
}

export interface GovernanceEndingEntry {
  project_code: string;
  project_name: string | null;
  scheduled_end_date: string | null;
  actual_end_date: string | null;
  open_risks: GovernanceRisk[];
}

export interface GovernanceWsrEntry {
  project_code: string;
  project_name: string | null;
  comment?: string | null;
  risk_note?: string | null;
  scope_status?: string;
  schedule_status?: string;
  quality_status?: string;
  csat_status?: string;
  team_status?: string;
  // Real PM-confirmed hygiene checkboxes for this week's WSR -- null means
  // "not confirmed either way" (most rows), never "confirmed not done".
  jin_allocations_updated?: boolean | null;
  team_timesheets_submitted?: boolean | null;
  devops_updated?: boolean | null;
}

export interface GovernanceClusterDashboard {
  number: number;
  name: string;
  week_start_date: string;
  week_end_date: string;
  projects: GovernanceProject[];
  open_risks: GovernanceRisk[];
  synthetic_risks: GovernanceSuggestedRisk[];
  spotlight: GovernanceSpotlightEntry[];
  kickoff_this_week: GovernanceKickoffEntry[];
  ending_this_week: GovernanceEndingEntry[];
  wsr_status: {
    RED: GovernanceWsrEntry[];
    AMBER: GovernanceWsrEntry[];
    GREEN: GovernanceWsrEntry[];
    no_report: GovernanceWsrEntry[];
  };
  // AI highlight bullet points opening the call, grounded strictly in the
  // real aggregates from the sections below (risks, spotlight, kick-off/
  // ending, WSR counts) -- null if no AI provider responded.
  cluster_summary_points: string[] | null;
  is_current_week: boolean;
  // True when this payload came from a stored snapshot (a past week) rather
  // than a live computation -- DevOps/allocations/the AI summary have no
  // historical trail, so past weeks only ever show what was actually
  // captured while they were current, never a live recompute.
  is_snapshot: boolean;
  captured_at: string | null;
}

export interface GovernanceWeek {
  week_start_date: string;
  week_end_date: string;
  is_current: boolean;
}

export interface RosterEntry {
  allocation_id: string;
  employee_id: string;
  employee_full_name: string | null;
  job_name: string | null;
  resourcing_status: string;
  allocation_by_percentage: number;
  allocated_start_date: string | null;
  allocated_end_date: string | null;
  extended_start_date: string | null;
  extended_end_date: string | null;
  extended_status: "BILLABLE" | "UNBILLABLE" | "SHADOW" | null;
  is_allocation_active: boolean;
  shift_type: string | null;
  reviewer_employee_id: string | null;
}

export interface ProjectRoster {
  project_code: string;
  roster: RosterEntry[];
  distinct_employees: number;
}

export interface ShadowHeavyProof {
  fired: boolean;
  threshold_share: number;
  shadow_unbilled_share: number | null;
  monthly_unbilled_value_usd: number;
  total_allocation_rows: number;
  shadow_allocation_rows: number;
  qualifying_allocations: {
    employee_id: string;
    job_name: string | null;
    resourcing_status: string;
    allocation_by_percentage: number;
    hourly_rate_usd: number | null;
    monthly_unbilled_value_usd: number;
    allocated_start_date: string | null;
    allocated_end_date: string | null;
  }[];
}

export interface HighChurnProof {
  fired: boolean;
  churn_rate: number | null;
  cohort_p75_threshold: number;
  distinct_employees: number;
  roster_timeline: RosterEntry[];
}

export interface RoleStaffMember {
  employee_id: string;
  allocation_by_percentage: number;
}

export interface UnderstaffedProof {
  fired: boolean;
  ratio_threshold: number;
  actual_headcount_all_time: number;
  // Distinct people currently active on this project, across all roles --
  // the real "how many members does this project have right now" total.
  actual_headcount_active_now: number;
  expected_headcount: number | null;
  role_mix_source: string;
  role_mix_sample_size: number | null;
  // Present only when role_mix_source === "real_budget" -- the real approved
  // JIN budget this project's expected roles came from, instead of the
  // statistical model averaged over similar past projects.
  budget_version?: number;
  budget_status?: string;
  expected_roles: RoleMixDetailRow[];
  expected_role_mix: Record<string, number>;
  actual_headcount_active_now_by_role: Record<string, number>;
  actual_fte_active_now_by_role: Record<string, number>;
  // Who is actually filling each role right now -- employee_id is the only
  // real identifier this app ever shows (no names/emails anywhere in the
  // data model), click through to the same employee profile used elsewhere.
  active_employees_by_role: Record<string, RoleStaffMember[]>;
  // Whether a role is REALLY short once real staffing flexibility is
  // accounted for -- someone one seniority level up/down, or the other UK/
  // India naming family's equivalent at the same level, already on this
  // project with spare capacity beyond their own role's own quota. Only
  // genuine surplus is ever borrowed, and each surplus person counts once
  // (see health_detail_service._compute_flexible_shortfall).
  flexible_shortfall_by_role: Record<string, { is_short: boolean; borrowed_headcount: number; borrowed_from: string[] }>;
  headcount_all_time_by_role: Record<string, number>;
}

export interface OvertimeEmployeeProof {
  employee_id: string;
  job_name: string | null;
  overtime_days_recent: number;
  max_daily_hours_recent: number;
  is_sustained_overtime: boolean;
  daily_hours: { date: string; hours: number; is_overtime: boolean }[];
}

export interface OvertimeRiskProof {
  fired: boolean;
  daily_threshold_hours: number;
  sustained_min_days: number;
  window_days: number;
  overtime_employee_count: number;
  employees: OvertimeEmployeeProof[];
}

export interface EffortSpikeProof {
  fired: boolean;
  ratio_threshold: number;
  min_baseline_weeks: number;
  weekly_hours: { week: string; hours: number }[];
}

export interface SentimentScore {
  date: string | null;
  label: string;
  compound: number;
  comment: string;
}

export interface SentimentSummary {
  has_data: boolean;
  label: string | null;
  compound: number | null;
  avg_compound?: number | null;
  trend: string | null;
  risk_signal: string;
  latest_comment: string | null;
  recent_scores?: SentimentScore[];
}

export interface WsrReportRow {
  week_start_date: string | null;
  week_end_date: string | null;
  scope_status: string;
  schedule_status: string;
  quality_status: string;
  csat_status: string;
  team_status: string;
  worst_signal: string;
  comment?: string | null;
}

export interface WsrProof {
  fired: boolean;
  fired_deteriorating: boolean;
  fired_critical: boolean;
  fired_long_term_decline: boolean;
  data_available: boolean;
  worst_signal: string | null;
  latest_signal: string | null;
  trend: "deteriorating" | "stable" | "improving" | null;
  is_critical: boolean;
  is_long_term_decline: boolean;
  recent_avg_severity: number | null;
  prior_avg_severity: number | null;
  baseline_avg_severity: number | null;
  critical_severity_threshold: number;
  recent_n: number;
  min_reports_required: number;
  critical_min_reports_required: number;
  long_term_min_reports_required: number;
  reports: WsrReportRow[];
}


export interface DevopsTicketRow {
  id: number | null;
  title: string | null;
  work_item_type: string | null;
  state: string;
  is_blocked: boolean;
  is_in_progress: boolean;
  assigned_to: string | null;
  start_date: string | null;
  due_date: string | null;
  is_past_project_end: boolean;
  original_estimate_hours: number | null;
  remaining_hours: number | null;
  completed_hours: number | null;
  is_effort_inconsistent: boolean;
  sprint_name: string;
  effective_remaining_hours: number | null;
}

export interface SprintBreakdownRow {
  iteration_path: string;
  sprint_name: string;
  ticket_count: number;
  blocked_count: number;
  in_progress_count: number;
  to_do_count: number;
  remaining_hours: number;
  tickets_with_no_effort_data: number;
  sprint_start_date: string | null;
  sprint_end_date: string | null;
  latest_due_date: string | null;
  has_open_work: boolean;
}

export interface DevopsExtensionRiskProof {
  fired: boolean;
  data_available: boolean;
  window_days: number;
  open_ticket_count: number;
  blocked_ticket_count: number;
  in_progress_ticket_count: number;
  to_do_ticket_count: number;
  tickets_due_past_project_end: number;
  remaining_effort_hours: number;
  completed_work_hours: number;
  original_estimate_hours: number;
  effort_completion_pct: number | null;
  within_risk_window: boolean;
  working_days_in_window: number;
  team_capacity_hours: number;
  team_capacity_hours_after_leave: number;
  team_daily_capacity_hours: number;
  capacity_surplus_hours: number | null;
  days_to_clear_backlog: number | null;
  is_overdue: boolean;
  tickets_missing_remaining_estimate: number;
  tickets_with_no_effort_data: number;
  sprint_breakdown: SprintBreakdownRow[];
  tickets: DevopsTicketRow[];
  
}

export interface ProjectExtensionRecord {
  project_code: string;
  recorded_at: string;
  from_end_date: string | null;
  to_end_date: string | null;
  status: string | null;
}

export interface ExtensionEstimate {
  planned_extension_days: number;
  originally_planned_end_date: string | null;
  currently_resourced_through_date: string | null;
  committed_overrun_days: number;
  committed_overrun_source: string;
  projected_additional_days: number | null;
  projected_additional_weeks: number | null;
  projected_additional_days_confidence: "none" | "low" | "medium";
  projected_basis: string | null;
  predicted_extension_start_date: string | null;
  predicted_extension_end_date: string | null;
  projected_extension_duration_label: string | null;
  note: string;
}
export interface ProjectHealthDetail {
  project_code: string;
  project_name: string | null;
  is_health_tracked: boolean;
  project_status: string | null;
  client_id: string | null;
  type_of_project: string;
  tech_coe: string | null;
  project_start_date: string | null;
  project_end_date: string | null;
  effective_end_date: string | null;
  planned_extension_days: number | null;
  project_extended_end_date: string | null;
  project_extended_end_status: "BILLABLE" | "UNBILLABLE" | null;
  risk_score: number;
  risk_band: "high" | "medium" | "low";
  root_causes: string[];
  shadow_heavy: ShadowHeavyProof;
  high_churn: HighChurnProof;
  understaffed: UnderstaffedProof;
  overtime_risk: OvertimeRiskProof;
  effort_spike: EffortSpikeProof;
  wsr: WsrProof;
  devops: DevopsExtensionRiskProof;
  allocations_roster: RosterEntry[];
  // Real approved-budget team plan vs. real current allocations for this
  // project (see backend jin_budget_service.py); null when there's no
  // matching JIN budget record for this project yet.
  budget_plan: BudgetActualVsPlanned | null;
  root_cause_categories: Record<string, string[]>;
  is_extension_risk: boolean;
  is_escalation_risk: boolean;
  is_pulse_risk: boolean;
  pulse: {
    response_count: number;
    distinct_employees: number;
    avg_score: number;
    scores: Record<string, number>;
    is_pulse_risk: boolean;
    worst_question: string;
    window_weeks: number;
  } | null;
  extension_estimate: ExtensionEstimate;
   extension_revenue: {
    fired: boolean;
    daily_hours_basis: number;
    extension_unbilled_value_usd: number;
    team_daily_extension_cost_usd: number;
    projected_extension_days: number | null;
    projected_extension_weeks: number | null;
    projected_extension_confidence: "none" | "low" | "medium";
    predicted_extension_start_date: string | null;
    predicted_extension_end_date: string | null;
    projected_extension_duration_label: string | null;
    predicted_extension_revenue_loss_usd: number;
    note: string;
    predicted_breakdown: {
      employee_id: string;
      job_name: string | null;
      resourcing_status: string;
      allocation_by_percentage: number;
      hourly_rate_usd: number | null;
      predicted_additional_usd: number;
    }[];
    qualifying_allocations: {
      employee_id: string;
      job_name: string | null;
      resourcing_status: string;
      allocation_by_percentage: number;
      hourly_rate_usd: number | null;
      overrun_working_days: number;
      extension_unbilled_value_usd: number;
      allocated_end_date: string | null;
    }[];
  };
}

export interface FreePoolCandidate {
  employee_id: string;
  job_name: string | null;
  department_name: string | null;
  location: string | null;
  reason: "ending_soon" | "under_utilized" | "fully_free";
  project_id: string | null;
  days_to_end?: number;
  current_allocation_pct?: number;
  ending_allocation_pct?: number;
  ending_allocations?: { project_id: string; allocation_pct: number; days_to_end: number }[];
  primary_coe: string | null;
  idle_capacity_pct: number;
  hourly_rate_usd: number | null;
  idle_value_usd_per_month: number | null;
  days_free: number | null;
  last_ended_project_id: string | null;
  last_ended_date: string | null;
  recommended_project_count?: number;
  top_recommended_project?: TopRecommendedProject | null;
  on_hold?: boolean;
  hold_projects?: HoldProject[];
}

export interface TopRecommendedProject {
  row_index: number;
  client: string | null;
  resources_requested: string | null;
  skill_areas: string[];
  skill_score: number;
  composite_score: number;
}

export interface ReliefCandidate extends FreePoolCandidate {
  composite_score: number;
  skill_score: number;
  matched_skills: string[];
  missing_skills: string[];
  skill_confidence: "observed" | "imputed" | "no_match" | "no_requirement";
  competency_score: number;
  competency_confidence: "observed" | "imputed";
  skill_bucket: "eligible" | "trainable" | "gap" | "not_assessed";
  coe_matches_project: boolean;
  coe_affinity_rank?: number;
  total_projects?: number;
  distinct_clients?: number;
  relevant_project_count?: number;
  relevant_project_ratio?: number;
  experience_confidence?: ExperienceConfidence;
  top_categories?: ExperienceCategory[];
  project_count_score?: number;
  // Only present on available_soon_candidates -- still busy today, but with a real,
  // dated end to that.
  days_to_available?: number | null;
  available_from_date?: string | null;
}

export interface ReliefStaffingResult {
  project_code: string;
  overtime_fired: boolean;
  understaffed_fired: boolean;
  overtime_employee_count: number;
  project_coe: string | null;
  required_skills: string[];
  required_skill_source: "project_roster" | "coe_typical" | "none";
  candidate_pool_size: number;
  candidates: ReliefCandidate[];
  available_soon_candidates: ReliefCandidate[];
}

export interface ProjectBurnoutOverview {
  total_flagged: number;
  overtime_count: number;
  understaffed_count: number;
  projects: HealthProject[];
}

export interface BurnoutOvertimeEmployee {
  employee_id: string;
  job_name: string | null;
  department_name: string | null;
  overtime_days_recent: number;
  max_daily_hours_recent: number;
  daily_hours: { date: string; hours: number; is_overtime: boolean }[];
  recent_projects: { project_id: string; hours_recent: number; needs_support: boolean }[];
}

export interface NotHappyEmployee {
  employee_id: string;
  job_name: string | null;
  department_name: string | null;
}

export interface EmployeeBurnoutOverview {
  overtime_employee_count: number;
  overtime_employees: BurnoutOvertimeEmployee[];
  not_happy_count: number;
  not_happy_employees: NotHappyEmployee[];
}

export interface RedeployMatch {
  row_index: number;
  client: string | null;
  resources_requested: string | null;
  requested_pct: string | null;
  likely_start_date: string | null;
  status: string | null;
  priority: string | null;
  solution?: string | null;
  skill_areas: string[];
  skill_score: number;
  matched_skills: string[];
  missing_skills: string[];
  skill_confidence: "observed" | "imputed" | "no_match" | "no_requirement";
  competency_score: number;
  competency_confidence: "observed" | "imputed";
  available_pct: number;
  composite_score: number;
  bucket: "eligible" | "trainable" | "gap" | "not_assessed";
  meets_requested_capacity?: boolean;
  near_capacity?: boolean;
  total_projects?: number;
  distinct_clients?: number;
  relevant_project_count?: number;
  relevant_project_ratio?: number;
  experience_confidence?: ExperienceConfidence;
  top_categories?: ExperienceCategory[];
  project_count_score?: number;
  coe?: string | null;
  coe_preferred?: boolean;
  coe_affinity_rank?: number;
  hourly_rate_usd?: number | null;
  on_hold?: boolean;
  hold_projects?: HoldProject[];
}

export interface RevenueMonth {
  month: string;
  value: number;
  raw: string;
}


export interface RedeployCandidate {
  employee_id: string;
  job_name: string;
  department_name?: string | null;
  location?: string | null;
  coe?: string | null;
  reason: "ending_soon" | "under_utilized" | "fully_free";
  project_id: string | null;
  days_to_end?: number;
  current_allocation_pct?: number;
  available_pct_as_of?: number;
  skill_score?: number;
  matched_skills?: string[];
  missing_skills?: string[];
  skill_confidence?: "observed" | "imputed" | "no_match" | "no_requirement";
  skill_bucket?: "eligible" | "trainable" | "gap" | "not_assessed";
  // Authoritative flag from the backend for whether this candidate is inside
  // qualifying_for_redeploy -- NOT re-derivable from skill_score alone
  // client-side, since leadership designations (Manager/Principal/Associate
  // Partner/Partner) are exempt from the skill-score threshold there.
  meets_requested_skillset?: boolean;
  source_designation?: string;
  level_offset?: number;
  on_hold?: boolean;
  hold_projects?: HoldProject[];
  // Full ranking-parameter parity with the main Resourcing engine -- see
  // scoring.composite_score_v2 / experience_engine.match_experience.
  composite_score?: number;
  competency_score?: number;
  competency_confidence?: "observed" | "imputed";
  coe_affinity_rank?: number;
  coe_preferred?: boolean;
  relevant_project_count?: number;
  relevant_project_ratio?: number;
  total_projects?: number;
  distinct_clients?: number;
  experience_confidence?: ExperienceConfidence;
  top_categories?: ExperienceCategory[];
  project_count_score?: number;
  hourly_rate_usd?: number | null;
  meets_requested_capacity?: boolean;
  near_capacity?: boolean;
}

export interface ForecastBreakdownRow {
  designation: string;
  start_date: string;
  duration_weeks: number | null;
  needed_fte: number;
  needed_headcount: number;
  available_for_redeploy: number;
  // Same as available_for_redeploy -- holding the exact requested title, with
  // real availability, is itself what counts toward covering the need here
  // (a skill gap on one specific required skill is trainable, not a hire
  // signal, for a headcount forecast).
  qualifying_for_redeploy: number;
  redeploy_candidates: RedeployCandidate[];
  adjacent_level_candidates: RedeployCandidate[];
  adjacent_fill_count: number;
  // Cross-role tier: same org-wide skill/competency/availability search the
  // main Resourcing page uses, unrestricted by designation -- surfaces
  // real skill-tag matches from OTHER job titles (e.g. a Consultant whose
  // actual skill record matches a Data Engineering build). Shown as context
  // only -- does NOT reduce shortfall or the hire signal, since a skill-tag
  // match alone isn't the same as a realistic redeployment; same-title +
  // adjacent-title candidates are the only pool the shortfall math trusts.
  // `trainable` bucket candidates are a real skill gap, surfaced as upskill
  // candidates, and never assumed to fill a seat automatically.
  cross_role_candidates: RecommendationCandidate[];
  cross_role_match_count: number;
  training_candidates: RecommendationCandidate[];
  shortfall: number;
  shortfall_value_usd: number;
  full_role_monthly_value_usd: number;
  achievable_monthly_value_usd: number;
  hire_signal: boolean;
}

export interface ForecastSpec {
  coes?: string[] | null;
  type_of_project?: string | null;
  category?: string | null;
  count: number;
  role_mix_overrides?: Record<string, number> | null;
  required_skills?: string[] | null;
  start_date?: string | null;
  duration_weeks?: number | null;
}

export interface ExcludedRareRole {
  designation: string;
  prevalence_pct: number | null;
  fte: number;
}

export interface NewProjectForecastResult {
  specs: ForecastSpec[];
  role_mix_sources: { spec: ForecastSpec; source: string; sample_size: number | null; matched_project_codes: string[] }[];
  required_skills: string[];
  breakdown: ForecastBreakdownRow[];
  excluded_rare_roles: ExcludedRareRole[];
  total_shortfall_headcount: number;
  total_shortfall_value_usd: number;
  total_full_role_value_usd: number;
  total_achievable_value_usd: number;
  pct_achievable_with_current_headcount: number | null;
}

export interface CoeOption {
  coe: string;
  sample_size: number;
}

export interface RevenueBenchmark {
  avg_revenue_per_project: number;
  avg_revenue_per_fte_month: number;
  sample_size: number;
}

export interface ProjectMixRow {
  coe: string;
  weight_pct: number;
  target_share_usd: number;
  project_count: number;
  avg_revenue_per_project: number;
  projected_revenue_usd: number;
  sample_size: number;
  dnd_engagements_needed: number;
}

export interface DesignAndDiscoveryInfo {
  engagements_needed: number;
  win_rate_pct: number;
  duration_weeks: number;
  revenue_usd_low: number;
  revenue_usd_high: number;
  total_revenue_usd_low: number;
  total_revenue_usd_high: number;
  role_mix: Record<string, number>;
  note: string;
}

export interface TimelineFeasibility {
  target_date: string;
  weeks_available: number;
  typical_project_weeks: number;
  likely_fits: boolean;
}

export interface RevenueHitEstimate {
  start_date_used: string;
  hit_date: string;
  duration_weeks: number;
  project_count: number;
  has_staffing_gap: boolean;
  shortfall_headcount: number;
  is_staggered: boolean;
}

export interface PipelineCoverageDeal {
  deal_id: number;
  client: string;
  solution: string | null;
  likely_start_date: string;
  deal_stage_hubspot: string | null;
  value_usd: number;
}

export interface PipelineCoverage {
  range_start: string;
  range_end: string;
  deal_count: number;
  value_per_deal_usd: number;
  total_value_usd: number;
  deals: PipelineCoverageDeal[];
  deal_ids: number[];
  clients: string[];
}

export interface RevenueTargetForecastResult {
  target_revenue_usd: number;
  priority_coes: string[];
  pipeline_coverage: PipelineCoverage | null;
  effective_target_revenue_usd: number;
  project_mix: ProjectMixRow[];
  total_projected_revenue_usd: number;
  total_covered_revenue_usd: number;
  revenue_gap_usd: number;
  pct_of_target_covered: number | null;
  forecast: NewProjectForecastResult | null;
  design_and_discovery: DesignAndDiscoveryInfo | null;
  effective_duration_weeks: number | null;
  timeline: TimelineFeasibility | null;
  revenue_hit_estimate: RevenueHitEstimate | null;
  error?: string;
}

export interface DurationBucket {
  min_weeks: number | null;
  max_weeks: number | null;
  avg_weeks: number;
  historical_mix_pct: number;
  sample_size: number;
}

export interface DurationMixBenchmarks {
  buckets: Record<"short" | "mid" | "long", DurationBucket>;
  total_sample_size: number;
}

export interface RoleMixPreview {
  role_mix: Record<string, number>;
  roles: RoleMixDetailRow[];
  sample_size: number | null;
  source: string;
  on_time_sample_size?: number;
  all_completed_sample_size?: number;
  matched_project_codes: string[];
}

export interface CoeSkill {
  skill: string;
  subskill: string;
  employee_count: number;
  avg_score: number;
  common_experience: string | null;
}

export interface CoeSkillsForCoe {
  skills: CoeSkill[];
  confidence: "medium" | "low" | "none";
  matched_skill_coes: string[];
  fallback: string | null;
}

export interface CoeSkillsResult {
  by_coe: Record<string, CoeSkillsForCoe>;
  combined: CoeSkill[];
}

export interface LeaveImpact {
  employee_id: string;
  job_name: string | null;
  leave_type: "Planned" | "Sick" | "Emergency";
  leave_start_date: string;
  leave_end_date: string;
  is_currently_on_leave: boolean;
  project_id: string;
  coe: string | null;
  allocation_by_percentage: number;
  backfill_candidates: RedeployCandidate[];
  backfill_available: boolean;
  top_backfill_skill_score: number | null;
  required_skills: string[];
  // "project_roster": matched against the skills of this project's own team;
  // "own_skills": project roster too thin, fell back to the leave-taker's own skills;
  // "none": neither was available -- skill fit isn't assessed for this row.
  required_skill_source: "project_roster" | "own_skills" | "none";
}

export interface ProjectAlumniStint {
  allocated_start_date: string | null;
  allocated_end_date: string | null;
  resourcing_status: string;
  allocation_by_percentage: number | null;
  is_allocation_active: boolean;
}

export interface ProjectAlumniCurrentProject {
  project_id: string;
  allocation_by_percentage: number | null;
  resourcing_status: string;
}

export interface ProjectAlumniCandidate {
  employee_id: string;
  job_name: string | null;
  location: string | null;
  is_currently_free: boolean;
  current_projects: ProjectAlumniCurrentProject[];
  past_stints: ProjectAlumniStint[];
  most_recent_end_date: string | null;
}

export interface OutlookMonth {
  month: string;
  confirmed_demand_count: number;
  confirmed_deal_count: number;
  unconfirmed_demand_count: number;
  unconfirmed_deal_count: number;
  projected_supply_count: number;
  net_confirmed_surplus_shortfall: number;
  early_warning: boolean;
  has_real_demand_data: boolean;
  has_real_supply_data: boolean;
  supply_anomaly_note: string | null;
  confirmed_value_usd: number;
  unconfirmed_value_usd: number;
}

export interface OutlookRoleDemandRow {
  month: string;
  role: string;
  role_code: string;
  resolved_designations: string[];
  needed_headcount: number;
  available_headcount: number | null;
  shortfall: number | null;
  is_confirmed: boolean;
}

export interface OutlookSkillAreaDemandRow {
  month: string;
  skill_area: string;
  count: number;
}

export interface OutlookClusterScorecard {
  cluster: number;
  deal_count: number;
  confirmed_count: number;
  unconfirmed_count: number;
  sow_signed_rate_pct: number;
  value_usd: number;
  top_roles: { role: string; count: number }[];
  top_skill_areas: { skill_area: string; count: number }[];
  clients: string[];
}

export interface SixMonthOutlookResult {
  start_date: string;
  horizon_months: number;
  granularity: "month" | "week";
  months: OutlookMonth[];
  first_shortfall_month: string | null;
  first_shortfall_roles: OutlookRoleDemandRow[];
  real_demand_data_through: string | null;
  real_supply_data_through: string | null;
  role_demand_by_month: OutlookRoleDemandRow[];
  skill_area_demand_by_month: OutlookSkillAreaDemandRow[];
  no_skill_area_specified_count: number;
  project_mix_by_cluster_by_month: { month: string; cluster: number; count: number }[];
  project_mix_by_solution_by_month: { month: string; solution: string; count: number }[];
  cluster_scorecards: OutlookClusterScorecard[];
  assumption: string;
}

export interface OutlookDrilldownDeal {
  deal_id: number | null;
  client: string | null;
  cluster: number | null;
  client_priority: string | null;
  em: string | null;
  solution: string | null;
  status: string | null;
  priority: string | null;
  role_code: string | null;
  role_label: string;
  resolved_designations: string[];
  requested_pct: string | null;
  skillset: string | null;
  skill_areas: string[];
  request_received: string | null;
  original_requested_start_date: string | null;
  likely_start_date: string | null;
  request_type: string | null;
  start_date_confirmed: string | null;
  number_of_weeks: string | number | null;
  deal_stage_hubspot: string | null;
  comments: string | null;
  sow_signed: string | null;
  is_confirmed: boolean;
  notice_days: number | null;
  is_late_notice: boolean | null;
  value_usd: number | null;
}

export interface OutlookDrilldownEmployee {
  employee_id: string;
  job_name: string | null;
  department_name: string | null;
  location: string | null;
  project_id: string | null;
  resourcing_status: string | null;
  allocation_by_percentage: number | null;
  allocated_start_date: string | null;
  allocated_end_date: string | null;
  is_anomaly_cluster: boolean;
}

export interface RosterAllocation {
  project_id: string;
  type_of_project: string | null;
  allocation_by_percentage: number;
  allocated_start_date: string | null;
  allocated_end_date: string | null;
  is_internal: boolean;
}

export interface DesignationRosterEntry {
  employee_id: string;
  job_name: string | null;
  location: string | null;
  department_name: string | null;
  available_pct: number;
  is_available: boolean;
  current_allocations: RosterAllocation[];
}

export interface OutlookDrilldownResult {
  month: string | null;
  dimension: string;
  value: string | null;
  deals: OutlookDrilldownDeal[];
  supply_employees: OutlookDrilldownEmployee[];
  supply_anomaly_note: string | null;
  designation_roster: DesignationRosterEntry[];
}

export interface SemanticMatchCandidate {
  employee_id: string;
  employee_full_name: string | null;
  matched_requirement: string;
  skill: string | null;
  subskill: string | null;
  score: number | null;
  skill_source: string;
  confidence: "high" | "medium";
  rationale: string | null;
}

export interface SemanticMatchResult {
  available: boolean;
  reason?: string;
  requirement?: string | null;
  required_skill_source?: "given" | "coe_mapping" | "embedding_match" | "org_fallback";
  matches?: SemanticMatchCandidate[];
  candidates_considered?: number;
  no_match_found?: boolean;
}

export interface AiRequiredSkill {
  skill: string;
  coe: string;
  rationale: string | null;
}

export interface AiRequiredSkillsResult {
  available: boolean;
  reason?: string;
  required_skills?: AiRequiredSkill[];
  primary_coe?: string | null;
  no_match_found?: boolean;
}

export interface BuddyTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface BuddyStat {
  label: string;
  value: string;
}

export interface BuddyAnswer {
  answer: string;
  format: "table" | "stats" | "text";
  table?: BuddyTable;
  stats?: BuddyStat[];
  data?: unknown;
}

export interface BuddyToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface BuddyStreamEvent {
  type: "tool_call" | "tool_result" | "done";
  tool?: string;
  arguments?: Record<string, unknown>;
  answer?: string;
  format?: "table" | "stats" | "text";
  table?: BuddyTable;
  stats?: BuddyStat[];
  data?: unknown;
}

/** SSE variant of api.buddyAsk -- yields {type: "tool_call"|"tool_result"|"done", ...}
 * as Buddy works, instead of waiting for the full answer. Uses fetch() directly since
 * the structured-final-answer JSON only arrives once on the "done" event, not streamed
 * token-by-token (the backend's final answer is parsed JSON, not free prose). */
// 120s of total silence (no new SSE bytes at all -- tool_call/tool_result events reset this
// on every real turn) aborts the connection with a clear, catchable error instead of leaving
// the caller awaiting forever. This is a real recovery path, not just a defensive nicety: an
// in-flight request whose backend worker gets killed mid-stream (e.g. uvicorn --reload
// restarting while a request is in flight) never sends a clean close, so without this the
// browser's fetch reader can hang indefinitely with no way for the UI to recover on its own.
// Was 60s -- measured real GPT-4o final-answer generation (the one gap with zero intermediate
// SSE events) taking 30s+ on its own for an ordinary question, so 60s had too little margin
// and was aborting requests that were still genuinely working, not actually stuck.
const STREAM_INACTIVITY_TIMEOUT_MS = 120000;

export async function* buddyAskStream(
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  priorContext?: string
): AsyncGenerator<BuddyStreamEvent> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_TIMEOUT_MS);
  };

  armTimeout();
  try {
    const res = await fetch(`${BASE}/buddy/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, prior_context: priorContext }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`/buddy/ask/stream failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      armTimeout();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) yield JSON.parse(line.slice(6));
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("Buddy didn't respond in time -- the connection was reset. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function buddyRate(params: {
  session_id: string;
  message_index: number;
  question: string;
  answer_snippet: string;
  rating: "up" | "down";
}): Promise<void> {
  await fetch(`${BASE}/buddy/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, timestamp: new Date().toISOString() }),
  });
}

export interface EmployeeSkillRow {
  coe: string | null;
  coe_skill: string | null;
  skill: string | null;
  subskill: string | null;
  experience: string | null;
  score: number | null;
  skill_source: string;
}

export interface EmployeeCompetencyRow {
  competency_sheet: string | null;
  competency_question: string | null;
  response: string | null;
  score: number | null;
  competency_source: string;
}

export interface EmployeeAllocationRow {
  project_id: string;
  client_id: string | null;
  type_of_project: string | null;
  project_status: string | null;
  resourcing_status: string;
  allocation_by_percentage: number | null;
  allocated_start_date: string | null;
  allocated_end_date: string | null;
  is_allocation_active: boolean;
}

export interface EmployeeOvertimeRisk {
  overtime_days_recent: number;
  max_daily_hours_recent: number;
  is_sustained_overtime: boolean;
}

export interface EmployeeDailyHours {
  date: string;
  hours: number;
  is_overtime: boolean;
}

export interface EmployeeLeaveRow {
  leave_type: string;
  leave_start_date: string | null;
  leave_end_date: string | null;
  status: string;
  source: string;
  is_currently_on_leave: boolean;
}

export interface EmployeeSignals {
  over_allocated: boolean;
  over_allocated_threshold: number;
  // True when the only reason total allocation exceeds 100% is internal-project work
  // stacked on top of an at-or-under-100% client commitment -- not a real overload.
  over_allocated_due_to_internal: boolean;
  under_utilized: boolean;
  under_utilized_threshold: number;
  sustained_overtime: boolean;
  overtime_daily_threshold_hours: number;
  overtime_sustained_min_days: number;
  overtime_window_days: number;
  possible_unplanned_absence: boolean;
  on_hold: boolean;
  hold_projects: HoldProject[];
}

export interface EmployeeProfile {
  employee_id: string;
  // Real name from JDWH's employee_full_name column -- null whenever the
  // source hasn't populated it (e.g. a masked UAT export), never fabricated.
  employee_full_name: string | null;
  job_name: string | null;
  department_name: string | null;
  location: string | null;
  date_of_join: string | null;
  account_status: boolean | null;
  coe: string | null;
  manager_employee_id: string | null;
  employee_total_allocation_pct: number | null;
  employee_client_allocation_pct: number | null;
  employee_internal_allocation_pct: number | null;
  skills: EmployeeSkillRow[];
  competencies: EmployeeCompetencyRow[];
  allocations: EmployeeAllocationRow[];
  current_allocations: AllocationRow[];
  overtime_risk: EmployeeOvertimeRisk;
  daily_hours_recent: EmployeeDailyHours[];
  leaves: EmployeeLeaveRow[];
  signals: EmployeeSignals;
  pulse: EmployeePulseDetail | null;
}

export interface EmployeePulseAnswer {
  score: number;
  meaning: string;
  is_not_happy_question: boolean;
}

export interface EmployeePulseResponse {
  week_start_date: string;
  project_id: string;
  is_not_happy: boolean;
  answers: Record<string, EmployeePulseAnswer>;
}

export interface EmployeePulseDetail {
  is_not_happy: boolean;
  response_count: number;
  avg_score: number;
  scores: Record<string, number>;
  worst_question: string;
  responses: EmployeePulseResponse[];
  window_weeks: number;
}

// One real HR/PM performance-review check-in on a real (employee, project)
// engagement, written by a real reviewing employee -- manual "proof" surface
// only, never an input to recommendation scoring.
export interface EmployeeFeedbackEntry {
  feedback_id: string;
  project_id: string;
  client_id: string | null;
  coe: string | null;
  feedback_date: string | null;
  reviewer_employee_id: string;
  reviewer_role: string;
  rating: number;
  would_recommend: boolean;
  themes: string[];
  summary_comment: string;
  full_text: string;
}

export interface EmployeeFeedbackReviewer {
  employee_id: string;
  role: string;
}

export interface EmployeeFeedbackResult {
  employee_id: string;
  total_response_count: number;
  response_count: number;
  distinct_project_count: number;
  avg_rating: number | null;
  would_recommend_pct: number | null;
  rating_breakdown: Record<string, number>;
  theme_averages: Record<string, number>;
  available_coes: string[];
  available_projects: string[];
  available_themes: string[];
  available_reviewers: EmployeeFeedbackReviewer[];
  entries: EmployeeFeedbackEntry[];
}

// Half-yearly KRA/appraisal cycle -- synthetic data modeled on JMAN's real
// internal Performance Edge / KRA-KPI Forms tool (hackathon team never
// provided a real export). Manual "proof" surface only, never an input to
// recommendation scoring.
export interface PerformanceCycleSummary {
  cycle_id: string;
  form_name: string;
  cycle_label: string;
  published_on: string | null;
  form_end_date: string | null;
  status: string;
  appraiser_employee_id: string;
  total_score: number | null;
  performance_rating_code: string | null;
  performance_rating_label: string | null;
}

export interface PerformanceStage {
  stage: string;
  state: "complete" | "current" | "pending";
  assignee_employee_id: string;
}

export interface PerformanceKraItem {
  kra_name: string;
  weight: number;
  kra_kpi_description: string;
  goal_text: string;
  appraisee_rating_text: string;
  appraisee_score: number | null;
  appraiser_rating_text: string;
  appraiser_score: number | null;
}

export interface PerformanceSection {
  category: string;
  items: PerformanceKraItem[];
}

export interface PerformanceAiSummary {
  available: boolean;
  summary: string | null;
  cycle_label: string | null;
  reason: string | null;
}

export interface PerformanceCycleDetail extends PerformanceCycleSummary {
  employee_id: string;
  stage_tracker: PerformanceStage[];
  sections: PerformanceSection[];
  overall_appraiser_feedback: string | null;
  overall_areas_of_improvement: string | null;
}

export interface EmployeeTimesheetRow {
  date: string;
  project_id: string;
  job_name: string | null;
  hours: number;
  status: string;
  billing_status: string;
}

export interface EmployeeTimesheetResult {
  employee_id: string;
  total_hours: number;
  days_logged: number;
  entry_count: number;
  avg_hours_per_logged_day: number;
  data_start_date: string | null;
  data_end_date: string | null;
  available_projects: string[];
  by_project: { project_id: string; hours: number }[];
  by_billing_status: Record<string, number>;
  rows: EmployeeTimesheetRow[];
}

export interface WeeklyPulseAnswer {
  question: string;
  score: number;
  meaning: string;
}

export interface WeeklyPulseWeek {
  week_start_date: string;
  week_end_date: string;
  is_not_happy: boolean;
  answers: WeeklyPulseAnswer[];
}

// One successful resume/LinkedIn-PDF import for an employee -- returned both
// right after an upload and when listing an employee's past imports, so the
// Skills tab can show "already imported" state (what got added, when, from
// which channel) instead of re-asking blind, with a reupload option.
export interface DocumentImportRecord {
  import_id: string;
  employee_id: string;
  channel: "resume" | "linkedin";
  filename: string;
  uploaded_at: string;
  summary: string | null;
  extracted_skill_count: number;
  added_skills: string[];
  skipped_existing_skill_count: number;
  extracted_competency_count: number;
  added_competencies: string[];
  skipped_existing_competency_count: number;
}

export type ResumeUploadResult = DocumentImportRecord;

export interface AllocationTimesheet extends AllocationRow {
  hours_window_end: string;
  daily_hours: { date: string; hours: number | null; expected_hours: number; utilization_pct: number | null; is_missing: boolean }[];
}

export interface UpdateAllocationResult {
  allocation_id: string;
  allocation_by_percentage: number;
  allocated_start_date: string;
  allocated_end_date: string;
  resourcing_status: string;
  shift_type: string | null;
  reviewer_employee_id: string | null;
}

export interface AssignAllocationResult {
  project_rolebased_user_id: string;
  project_id: string;
  employee_id: string;
  resourcing_status: string;
  allocated_start_date: string;
  allocated_end_date: string;
  is_allocation_active: number;
  allocation_by_percentage: number;
  is_active_version: number;
}

export interface ProjectInfo {
  project_code: string;
  client_id: string | null;
  type_of_project: string | null;
  tech_coe: string | null;
  proposition_coe: string | null;
  project_status: string | null;
  project_start_date: string | null;
  project_end_date: string | null;
  is_health_tracked: boolean;
}

// One row in the wizard's Step 3 "Professional Fees" table -- role/location
// picked by the RM, rates looked up from this app's existing rate authority
// (rate_card_service, designation-only/illustrative -- not JIN's real
// location-adjusted rate card), everything else computed client-side.
export interface BudgetLineItem {
  designation: string;
  location: string | null;
  estimated_start_date: string | null;
  hours_per_day: number;
  allocation_pct: number;
  working_days: number | null;
  base_day_rate: number | null;
  eff_day_rate: number | null;
  // Present only on suggestions from getSuggestedTeam -- real signal from
  // JIN's approved budgets, not currency-normalized (see backend
  // jin_budget_service.py), so shown as a reference next to the editable
  // illustrative rate, never substituted into base_day_rate/eff_day_rate.
  real_frequency_pct?: number;
  real_median_cost_per_day?: number | null;
  real_median_price_per_day?: number | null;
}

export interface BudgetApprovalEntry {
  budget_id: string;
  version: number | null;
  project_code: string | null;
  project_name: string | null;
  engagement_style: string;
  status: string;
  proposition_coe: string;
  professional_fee: number | null;
  currency_id: string;
  margin_pct: number | null;
  payment_term: string;
  discount_type: string;
  discount_value: number | null;
  discount_reason: string | null;
  comment: string | null;
  is_billable: boolean;
  resource_line_count: number;
  created_at: string | null;
  created_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface BudgetActualVsPlannedRow {
  designation: string;
  planned_line_count: number;
  planned_avg_allocation_pct: number;
  actual_headcount: number;
  avg_allocation_pct: number;
}

export interface BudgetActualVsPlanned {
  budget_id: string;
  version: number;
  status: string;
  used_status: "approved" | "latest_non_approved";
  comparison: BudgetActualVsPlannedRow[];
}

export interface BudgetResourceLine {
  designation: string;
  location: string;
  start_date: string | null;
  working_days: number | null;
  allocation_pct: number | null;
  cost_per_day: number | null;
  price_per_day: number | null;
}

export interface BudgetProjectContext {
  project_code: string;
  project_name: string | null;
  project_status: string | null;
  type_of_project: string | null;
  tech_coe: string | null;
  client_id: string | null;
  project_start_date: string | null;
  project_end_date: string | null;
}

export interface BudgetVersionHistoryEntry {
  budget_id: string;
  version: number;
  status: string;
  professional_fee: number | null;
  created_at: string | null;
  reviewed_by: string | null;
  is_current: boolean;
}

export interface BudgetDetail {
  header: BudgetApprovalEntry | null;
  resource_lines: BudgetResourceLine[];
  project_context: BudgetProjectContext | null;
  version_history: BudgetVersionHistoryEntry[];
  actual_vs_planned: BudgetActualVsPlanned | null;
}

export interface SowFile {
  filename: string;
  size_bytes: number;
  uploaded_at: string;
}

// AI extraction of a SOW's real staffing/skill requirements -- grounded
// strictly in the document's own text, never wired into scoring or the
// budget step (proof/display surface only for now).
export interface SowRoleRequired {
  role_text: string;
  count: number;
  named_person: string | null;
  matches_real_designation: boolean;
}

export interface SowExtractionResult {
  available?: boolean;
  project_code: string;
  filename: string;
  extracted_at: string;
  roles_required: SowRoleRequired[];
  skills_required: string[];
  competency_areas_required: string[];
  client_name: string | null;
  project_reference: string | null;
  engagement_duration: string | null;
  scope_summary: string | null;
  project_mismatch_warning: string | null;
}

export interface SowRoleComparisonRow {
  role: string;
  sow_count: number;
  budget_count: number;
  aligned: boolean;
}

export interface SowNamedPerson {
  role_text: string;
  matches_real_designation: boolean;
  named_person: string;
  resolved_employee_id: string | null;
  source_filename: string | null;
}

export interface SowBudgetComparison {
  has_sow_data: boolean;
  has_budget_data: boolean;
  role_comparison: SowRoleComparisonRow[];
  fully_aligned: boolean | null;
  unmatched_sow_roles: string[];
  named_people: SowNamedPerson[];
}

// Chat with one SOW -- strictly document-scoped Q&A. Every citation is
// verified server-side to be a real, exact quote from the document before
// being returned, so it's safe to render without re-checking client-side.
export interface SowChatCitation {
  quote: string;
  location: string;
}

export interface SowChatResponse {
  answer: string;
  citations: SowChatCitation[];
}

export interface SowChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// Ranked-by-real-availability shortlist for one designation (get_redeploy_candidates_as_of) --
// used to pre-select a real "top guy" per budgeted role in the wizard's Resource Allocation step.
export interface TopRoleCandidate {
  employee_id: string;
  employee_full_name: string | null;
  job_name: string | null;
  department_name: string | null;
  location: string | null;
  reason: "fully_free" | "under_utilized";
  current_allocation_pct: number;
  available_pct_as_of: number;
  on_hold: boolean;
}

export interface EmployeeHeadcountSummary {
  total_ever: number;
  currently_active: number;
  delivery_active: number;
  already_departed: number;
  in_notice_period: number;
}

export interface BackfillContext {
  pulled_employee_id: string;
  pulled_employee_job: string | null;
  pulled_employee_coe: string | null;
  source_project_id: string;
  vacated_allocation_pct: number;
  vacated_start_date: string | null;
  vacated_end_date: string | null;
  skill_basis: string[];
}

export interface BackfillResult {
  candidates: RecommendationCandidate[];
  best_fit_if_delayed?: RecommendationCandidate[];
  fallback_candidates?: FallbackCandidates | null;
  hire_vs_redeploy_flag?: boolean;
  backfill_context: BackfillContext | null;
  error?: string;
}

export interface OvertimeRiskSummary {
  employees_at_risk: number;
  threshold_days: number;
  window_days: number;
  daily_hours_threshold: number;
  employees: {
    employee_id: string;
    job_name: string | null;
    overtime_days_recent: number;
    max_daily_hours_recent: number;
  }[];
}

export interface EmployeeListRow {
  employee_id: string;
  // Real name from JDWH's employee_full_name column -- null whenever the
  // source hasn't populated it (e.g. a masked UAT export), never fabricated.
  employee_full_name: string | null;
  job_name: string | null;
  department_name: string | null;
  location: string | null;
  manager_employee_id: string | null;
  date_of_join: string | null;
  date_of_resignation: string | null;
  status: "active" | "departed" | "notice_period";
  // Real primary CoE for this employee (employee_coe.py) -- null when not determined
  // (no observed Skill Details row on record), never a guessed default.
  coe: string | null;
  // Region/entity/employment-type group derived from the employee_id prefix
  // (JMD/JMG/JML/JMU/INT/TRN/EXT/CRN) -- see employee_profile_service._employee_group.
  employee_group: string;
  // Current total allocation % across active projects -- null if no active allocation.
  current_allocation_pct: number | null;
  on_hold: boolean;
  hold_projects: HoldProject[];
}

export interface DigestSendResult {
  sent_to: string;
  no_backfill_count: number;
  high_risk_total_count: number;
}

// Sent to a backfill candidate asking for their availability -- CC's the
// project's real manager and the candidate's real reporting manager (CDM
// proxy, no distinct CDM field exists in the data). No allocation is created;
// purely an outreach nudge the RM can follow up on manually.
export interface SupportRequestResult {
  sent_to: string;
  cc: string[];
  project_manager_employee_id: string | null;
  cdm_employee_id: string | null;
  subject: string;
}

export const api = {
  tables: () => getJSON<Record<string, number>>("/meta/tables"),
  sendDigestNow: () => postJSON<DigestSendResult>(`/digest/send?period_label=${encodeURIComponent("right now")}`, {}),
  buddyAsk: (message: string, history: { role: "user" | "assistant"; content: string }[] = []) =>
    postJSON<BuddyAnswer>("/buddy/ask", { message, history }),
  employeeProfile: (employeeId: string) => getJSON<EmployeeProfile>(`/employees/${encodeURIComponent(employeeId)}/profile`),
  employeeProjectHistory: (employeeId: string, category?: string) =>
    getJSON<EmployeeProjectHistoryRow[]>(
      `/employees/${encodeURIComponent(employeeId)}/project-history${category ? `?category=${encodeURIComponent(category)}` : ""}`
    ),
  employeeFeedback: (
    employeeId: string,
    filters: { weeksBack?: number; coe?: string; projectId?: string; reviewerEmployeeId?: string; theme?: string; ratings?: number[] } = {}
  ) => {
    const params = new URLSearchParams();
    if (filters.weeksBack) params.set("weeks_back", String(filters.weeksBack));
    if (filters.coe) params.set("coe", filters.coe);
    if (filters.projectId) params.set("project_id", filters.projectId);
    if (filters.reviewerEmployeeId) params.set("reviewer_employee_id", filters.reviewerEmployeeId);
    if (filters.theme) params.set("theme", filters.theme);
    for (const r of filters.ratings ?? []) params.append("ratings", String(r));
    const qs = params.toString();
    return getJSON<EmployeeFeedbackResult>(`/employees/${encodeURIComponent(employeeId)}/feedback${qs ? `?${qs}` : ""}`);
  },
  employeeTimesheet: (
    employeeId: string,
    filters: { startDate?: string; endDate?: string; projectId?: string; billingStatus?: string } = {}
  ) => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set("start_date", filters.startDate);
    if (filters.endDate) params.set("end_date", filters.endDate);
    if (filters.projectId) params.set("project_id", filters.projectId);
    if (filters.billingStatus) params.set("billing_status", filters.billingStatus);
    const qs = params.toString();
    return getJSON<EmployeeTimesheetResult>(`/employees/${encodeURIComponent(employeeId)}/timesheet${qs ? `?${qs}` : ""}`);
  },
  employeePulse: (employeeId: string) => getJSON<WeeklyPulseWeek[]>(`/employees/${encodeURIComponent(employeeId)}/pulse`),
  employeePerformanceCycles: (employeeId: string) =>
    getJSON<PerformanceCycleSummary[]>(`/employees/${encodeURIComponent(employeeId)}/performance-cycles`),
  employeePerformanceCycleDetail: (employeeId: string, cycleId: string) =>
    getJSON<PerformanceCycleDetail>(`/employees/${encodeURIComponent(employeeId)}/performance-cycles/${encodeURIComponent(cycleId)}`),
  employeePerformanceSummary: (employeeId: string) =>
    getJSON<PerformanceAiSummary>(`/employees/${encodeURIComponent(employeeId)}/performance-summary`),
  uploadEmployeeResume: async (employeeId: string, file: File, channel: "resume" | "linkedin" = "resume"): Promise<DocumentImportRecord> => {
    const form = new FormData();
    form.append("file", file);
    form.append("channel", channel);
    const res = await fetch(`${BASE}/employees/${encodeURIComponent(employeeId)}/resume`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  employeeDocumentImports: (employeeId: string) =>
    getJSON<DocumentImportRecord[]>(`/employees/${encodeURIComponent(employeeId)}/document-imports`),
  documentImportFileUrl: (employeeId: string, importId: string) =>
    `${BASE}/employees/${encodeURIComponent(employeeId)}/document-imports/${encodeURIComponent(importId)}/file`,
  employeeHeadcountSummary: () => getJSON<EmployeeHeadcountSummary>("/employees/headcount-summary"),
  overtimeRiskSummary: () => getJSON<OvertimeRiskSummary>("/employees/overtime-risk-summary"),
  employeesList: () => getJSON<EmployeeListRow[]>("/employees"),
  employeeDesignations: (deliveryOnly: boolean = false) =>
    getJSON<string[]>(`/employees/designations${deliveryOnly ? "?delivery_only=true" : ""}`),
  allocations: () => getJSON<AllocationRow[]>("/allocations/current"),
  allocationTimesheet: (employeeId: string, projectId: string) =>
    getJSON<AllocationTimesheet>(`/allocations/timesheet?employee_id=${encodeURIComponent(employeeId)}&project_id=${encodeURIComponent(projectId)}`),
  assignAllocation: async (body: {
    employeeId: string; projectId: string; allocationPct: number;
    startDate: string; endDate: string; resourcingStatus?: string;
    shiftType?: string | null; reviewerEmployeeId?: string | null;
  }): Promise<AssignAllocationResult> => {
    const res = await fetch(`${BASE}/allocations/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: body.employeeId, project_id: body.projectId, allocation_pct: body.allocationPct,
        start_date: body.startDate, end_date: body.endDate, resourcing_status: body.resourcingStatus ?? "BILLABLE",
        shift_type: body.shiftType ?? null, reviewer_employee_id: body.reviewerEmployeeId ?? null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Assign failed: ${res.status}`);
    }
    return res.json();
  },
  extendAllocationEndDate: async (
    allocationId: string,
    extendedEndDate: string | null,
    status: "BILLABLE" | "UNBILLABLE" | "SHADOW" | null
  ): Promise<{ allocation_id: string; extended_start_date: string | null; extended_end_date: string | null; extended_status: string | null }> => {
    const res = await fetch(`${BASE}/allocations/${encodeURIComponent(allocationId)}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extended_end_date: extendedEndDate, status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Extend failed: ${res.status}`);
    }
    return res.json();
  },
  updateAllocation: async (
    allocationId: string,
    body: {
      allocationPct: number;
      startDate: string;
      endDate: string;
      resourcingStatus: string;
      shiftType?: string | null;
      reviewerEmployeeId?: string | null;
    }
  ): Promise<UpdateAllocationResult> => {
    const res = await fetch(`${BASE}/allocations/${encodeURIComponent(allocationId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocation_pct: body.allocationPct,
        start_date: body.startDate,
        end_date: body.endDate,
        resourcing_status: body.resourcingStatus,
        shift_type: body.shiftType ?? null,
        reviewer_employee_id: body.reviewerEmployeeId ?? null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Update failed: ${res.status}`);
    }
    return res.json();
  },
  deleteAllocation: async (allocationId: string): Promise<{ allocation_id: string; deleted: boolean; employee_id: string; project_id: string }> => {
    const res = await fetch(`${BASE}/allocations/${encodeURIComponent(allocationId)}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Delete failed: ${res.status}`);
    }
    return res.json();
  },
  extendProjectEndDate: async (
    projectCode: string,
    extendedEndDate: string | null,
    status: "BILLABLE" | "UNBILLABLE" | null
  ): Promise<{ project_code: string; extended_end_date: string | null; extended_end_status: string | null }> => {
    const res = await fetch(`${BASE}/allocations/projects/${encodeURIComponent(projectCode)}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extended_end_date: extendedEndDate, status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Extend failed: ${res.status}`);
    }
    return res.json();
  },
  projectExtensionHistory: (projectCode: string) =>
    getJSON<ProjectExtensionRecord[]>(`/allocations/projects/${encodeURIComponent(projectCode)}/extensions`),
  suggestProjectCode: (name: string) =>
    getJSON<{ suggested_code: string }>(`/projects/suggest-code?name=${encodeURIComponent(name)}`),
  projectCodeExists: (projectCode: string) =>
    getJSON<{ exists: boolean }>(`/projects/code-exists?project_code=${encodeURIComponent(projectCode)}`),
  createProject: async (body: {
    projectCode: string; clientId: string; typeOfProject: string;
    startDate: string; endDate: string; techCoe?: string | null; propositionCoe?: string | null;
    projectStatus?: string;
  }): Promise<{ project_code: string; client_id: string; project_start_date: string; project_end_date: string; project_status: string }> => {
    const res = await fetch(`${BASE}/projects/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_code: body.projectCode, client_id: body.clientId, type_of_project: body.typeOfProject,
        start_date: body.startDate, end_date: body.endDate,
        tech_coe: body.techCoe ?? null, proposition_coe: body.propositionCoe ?? null,
        project_status: body.projectStatus ?? "ACTIVE",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Create project failed: ${res.status}`);
    }
    return res.json();
  },
  updateProject: async (projectCode: string, body: {
    clientId?: string | null; typeOfProject?: string | null;
    startDate?: string | null; endDate?: string | null;
    techCoe?: string | null; propositionCoe?: string | null; projectStatus?: string | null;
  }): Promise<{ project_code: string; client_id: string; project_start_date: string; project_end_date: string; project_status: string }> => {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectCode)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: body.clientId ?? null, type_of_project: body.typeOfProject ?? null,
        start_date: body.startDate ?? null, end_date: body.endDate ?? null,
        tech_coe: body.techCoe ?? null, proposition_coe: body.propositionCoe ?? null,
        project_status: body.projectStatus ?? null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Update project failed: ${res.status}`);
    }
    return res.json();
  },
  listProjectClients: () => getJSON<string[]>("/projects/clients"),
  getDealProjectLink: (dealKey: string) =>
    getJSON<{ project_code: string | null }>(`/projects/deal-link?deal_key=${encodeURIComponent(dealKey)}`),
  linkDealToProject: (dealKey: string, projectCode: string) =>
    postJSON<{ deal_key: string; project_code: string }>(
      `/projects/deal-link?deal_key=${encodeURIComponent(dealKey)}&project_code=${encodeURIComponent(projectCode)}`,
      {}
    ),
  projectDayRate: (designation: string, hoursPerDay = 8) =>
    getJSON<{ designation: string; base_day_rate: number | null }>(
      `/projects/day-rate?designation=${encodeURIComponent(designation)}&hours_per_day=${hoursPerDay}`
    ),
  getProjectGdpr: (projectCode: string) => getJSON<Record<string, string | null> | null>(`/projects/${encodeURIComponent(projectCode)}/gdpr`),
  saveProjectGdpr: (projectCode: string, fields: Record<string, string>) =>
    postJSON<Record<string, string | null>>(`/projects/${encodeURIComponent(projectCode)}/gdpr`, { fields }),
  getProjectBudget: (projectCode: string) =>
    getJSON<{ line_items: BudgetLineItem[] } & Record<string, string | null> | null>(`/projects/${encodeURIComponent(projectCode)}/budget`),
  saveProjectBudget: (projectCode: string, header: Record<string, string | boolean>, lineItems: BudgetLineItem[]) =>
    postJSON<Record<string, unknown>>(`/projects/${encodeURIComponent(projectCode)}/budget`, { header, line_items: lineItems }),
  getSuggestedTeam: (propositionCoe: string, hoursPerDay = 8) =>
    getJSON<BudgetLineItem[]>(`/projects/budget/suggested-team?proposition_coe=${encodeURIComponent(propositionCoe)}&hours_per_day=${hoursPerDay}`),
  getBudgetActualVsPlanned: (projectCode: string) =>
    getJSON<BudgetActualVsPlanned | null>(`/projects/${encodeURIComponent(projectCode)}/budget/actual-vs-planned`),
  getBudgetApprovals: () => getJSON<BudgetApprovalEntry[]>(`/projects/budget/approvals`),
  getBudgetDetail: (budgetId: string) => getJSON<BudgetDetail | null>(`/projects/budget/approvals/${encodeURIComponent(budgetId)}`),
  listProjectSow: (projectCode: string) => getJSON<SowFile[]>(`/projects/${encodeURIComponent(projectCode)}/sow`),
  sowCompareBudget: (projectCode: string) =>
    getJSON<SowBudgetComparison>(`/projects/${encodeURIComponent(projectCode)}/sow/compare-budget`),
  uploadProjectSow: async (projectCode: string, file: File): Promise<SowFile> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectCode)}/sow`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  projectSowDownloadUrl: (projectCode: string, filename: string) =>
    `${BASE}/projects/${encodeURIComponent(projectCode)}/sow/${encodeURIComponent(filename)}`,
  projectSowViewUrl: (projectCode: string, filename: string) =>
    `${BASE}/projects/${encodeURIComponent(projectCode)}/sow/${encodeURIComponent(filename)}/view`,
  projectSowPreviewPdfUrl: (projectCode: string, filename: string) =>
    `${BASE}/projects/${encodeURIComponent(projectCode)}/sow/${encodeURIComponent(filename)}/preview-pdf`,
  getProjectSowExtraction: (projectCode: string, filename: string) =>
    getJSON<SowExtractionResult | { available: false }>(
      `/projects/${encodeURIComponent(projectCode)}/sow/${encodeURIComponent(filename)}/extract`
    ),
  extractProjectSow: (projectCode: string, filename: string) =>
    postJSON<SowExtractionResult>(`/projects/${encodeURIComponent(projectCode)}/sow/${encodeURIComponent(filename)}/extract`, {}),
  askSowQuestion: (projectCode: string, filename: string, message: string, history: SowChatHistoryMessage[] = []) =>
    postJSON<SowChatResponse>(`/projects/${encodeURIComponent(projectCode)}/sow/${encodeURIComponent(filename)}/chat`, { message, history }),
  getProjectKickoff: (projectCode: string) => getJSON<Record<string, string | null> | null>(`/projects/${encodeURIComponent(projectCode)}/kickoff`),
  saveProjectKickoff: (projectCode: string, fields: Record<string, string>) =>
    postJSON<Record<string, string | null>>(`/projects/${encodeURIComponent(projectCode)}/kickoff`, { fields }),
  roleMixTemplates: () => getJSON<RoleMixTemplate[]>("/role-mix/templates"),
  roleMixCategories: () => getJSON<DocxCategoryRoleMix[]>("/role-mix/categories"),
  roleMixTeamSizeFit: (projectCode: string, designations: string[]) =>
    postJSON<TeamSizeFitResult>("/role-mix/team-size-fit", { project_code: projectCode, designations }),
  recommendationsForPipelineRow: (
    rowIndex: number, topN: number = 15, include: IncludeParams = DEFAULT_INCLUDE_PARAMS,
    includeBelowCapacity: boolean = false, nearCapacityTolerancePct: number = 25,
    includeResumeLinkedin: boolean = true, designationFlexLevel: number = 1
  ) =>
    getJSON<RecommendationResult>(
      `/recommendations/pipeline-row/${rowIndex}?top_n=${topN}` +
        `&include_skill=${include.skill}&include_competency=${include.competency}&include_availability=${include.availability}` +
        `&include_category_match=${include.category_match}&include_project_count=${include.project_count}` +
        `&include_coe_affinity=${include.coe_affinity}` +
        `&include_cost_efficiency=${include.cost_efficiency}` +
        `&include_below_capacity=${includeBelowCapacity}` +
        `&near_capacity_tolerance_pct=${nearCapacityTolerancePct}` +
        `&include_resume_linkedin=${includeResumeLinkedin}` +
        `&designation_flex_level=${designationFlexLevel}`
    ),
  recommendationsCoverageSummary: () => getJSON<CoverageSummary>("/recommendations/coverage-summary"),
  semanticMatch: (rowIndex: number) =>
    postJSON<SemanticMatchResult>(`/recommendations/pipeline-row/${rowIndex}/semantic-match`, {}),
  aiRequiredSkills: (rowIndex: number) =>
    getJSON<AiRequiredSkillsResult>(`/recommendations/pipeline-row/${rowIndex}/ai-required-skills`),
  recommendationsSearch: (skillsetText: string, likelyStartDate: string, requestedPct = "100") =>
    getJSON<RecommendationResult>(
      `/recommendations/search?skillset_text=${encodeURIComponent(skillsetText)}&likely_start_date=${likelyStartDate}&requested_pct=${requestedPct}`
    ),
  listDeals: () => getJSON<DealSummary[]>("/recommendations/deals"),
  projectTeamRecommendation: (rowIndices: number[], topN: number = 15, include: IncludeParams = DEFAULT_INCLUDE_PARAMS) =>
    postJSON<ProjectTeamRecommendation>("/recommendations/project-team", {
      row_indices: rowIndices, top_n: topN,
      include_skill: include.skill, include_competency: include.competency, include_availability: include.availability,
      include_category_match: include.category_match, include_project_count: include.project_count,include_coe_affinity: include.coe_affinity,
      include_cost_efficiency: include.cost_efficiency,
    }),
  pipelineForecast: () => getJSON<PipelineDemandRow[]>("/pipeline/forecast"),
  healthProjects: () => getJSON<HealthProject[]>("/health-monitor/projects"),
  governanceClusters: () => getJSON<GovernanceClusterSummary[]>("/governance/clusters"),
  governanceWeeks: () => getJSON<GovernanceWeek[]>("/governance/weeks"),
  governanceCluster: (clusterNumber: number, week?: string) =>
    getJSON<GovernanceClusterDashboard | null>(`/governance/clusters/${clusterNumber}${week ? `?week=${encodeURIComponent(week)}` : ""}`),
  governanceUnassignedProjects: () =>
    getJSON<{ project_code: string; project_name: string | null; client_id: string | null }[]>("/governance/unassigned-projects"),
  governanceAssignCluster: (projectCode: string, clusterNumber: number) =>
    postJSON<{ project_code: string; cluster_number: number }>("/governance/assign-cluster", {
      project_code: projectCode, cluster_number: clusterNumber,
    }),
  governanceAddRisk: (projectCode: string, riskDescription: string, riskType: string | null, mitigationSteps: string | null) =>
    postJSON<GovernanceRisk>("/governance/risks", {
      project_code: projectCode, risk_description: riskDescription, risk_type: riskType, mitigation_steps: mitigationSteps,
    }),
  governanceResolveRisk: (riskId: string) => postJSON<GovernanceRisk>(`/governance/risks/${encodeURIComponent(riskId)}/resolve`, {}),
  governanceSaveSpotlight: (
    projectCode: string,
    fields: { action_plan?: string | null }
  ) => postJSON<GovernanceSpotlightEntry>("/governance/spotlight", { project_code: projectCode, ...fields }),
  governanceRemoveFromSpotlight: async (projectCode: string): Promise<{ removed: boolean }> => {
    const res = await fetch(`${BASE}/governance/spotlight/${encodeURIComponent(projectCode)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await extractErrorMessage(res, "/governance/spotlight"));
    return res.json();
  },
  governanceSaveKickoffTracking: (
    projectCode: string,
    fields: { kickoff_completed?: string; scope_approved?: string; devops_setup?: string; comment?: string | null }
  ) => postJSON<GovernanceKickoffEntry>("/governance/kickoff-tracking", { project_code: projectCode, ...fields }),
  projectRoster: (projectCode: string) => getJSON<ProjectRoster>(`/health-monitor/projects/${encodeURIComponent(projectCode)}/roster`),
  healthProjectDetail: (projectCode: string) => getJSON<ProjectHealthDetail>(`/health-monitor/projects/${encodeURIComponent(projectCode)}/detail`),
  reliefStaffingCandidates: (projectCode: string, include: IncludeParams = DEFAULT_INCLUDE_PARAMS) =>
    getJSON<ReliefStaffingResult>(
      `/health-monitor/projects/${encodeURIComponent(projectCode)}/relief-candidates?` +
        `include_skill=${include.skill}&include_competency=${include.competency}&include_availability=${include.availability}` +
        `&include_category_match=${include.category_match}&include_project_count=${include.project_count}` +
        `&include_coe_affinity=${include.coe_affinity}&include_cost_efficiency=${include.cost_efficiency}`
    ),
  healthProjectSentiment: (projectCode: string, lastN?: number) =>
    getJSON<SentimentSummary>(`/health-monitor/projects/${encodeURIComponent(projectCode)}/sentiment${lastN ? `?last_n=${lastN}` : ""}`),
  projectBurnoutOverview: () => getJSON<ProjectBurnoutOverview>("/wellbeing/projects"),
  employeeBurnoutOverview: () => getJSON<EmployeeBurnoutOverview>("/wellbeing/employees"),
  projectInfo: (projectCode: string) => getJSON<ProjectInfo>(`/health-monitor/projects/${encodeURIComponent(projectCode)}/info`),
  newProjectForecast: (specs: ForecastSpec[], include: IncludeParams = DEFAULT_INCLUDE_PARAMS) =>
    postJSON<NewProjectForecastResult>(
      `/forecast/new-projects?include_skill=${include.skill}&include_competency=${include.competency}` +
        `&include_availability=${include.availability}&include_category_match=${include.category_match}` +
        `&include_project_count=${include.project_count}`,
      specs
    ),
  roleMixPreview: (coes: string[], typeOfProject: string | null) =>
    postJSON<RoleMixPreview>("/forecast/role-mix-preview", { coes, type_of_project: typeOfProject }),
  revenueBenchmarks: () => getJSON<Record<string, RevenueBenchmark>>("/forecast/revenue-benchmarks"),
  revenueTargetForecast: (opts: {
    targetRevenueUsd: number;
    priorityCoes?: string[] | null;
    startDate?: string | null;
    durationWeeks?: number | null;
    typeOfProject?: string | null;
    durationMix?: Record<string, number> | null;
    dndWinRatePct?: number | null;
    targetDate?: string | null;
    include?: IncludeParams;
  }) => {
    const include = opts.include ?? DEFAULT_INCLUDE_PARAMS;
    return postJSON<RevenueTargetForecastResult>("/forecast/revenue-target", {
      target_revenue_usd: opts.targetRevenueUsd,
      priority_coes: opts.priorityCoes ?? null,
      start_date: opts.startDate ?? null,
      duration_weeks: opts.durationWeeks ?? null,
      type_of_project: opts.typeOfProject ?? null,
      duration_mix: opts.durationMix ?? null,
      dnd_win_rate_pct: opts.dndWinRatePct ?? null,
      target_date: opts.targetDate ?? null,
      include_skill: include.skill,
      include_competency: include.competency,
      include_availability: include.availability,
      include_category_match: include.category_match,
      include_project_count: include.project_count,
    });
  },
  durationMixBenchmarks: () => getJSON<DurationMixBenchmarks>("/forecast/duration-mix-benchmarks"),
  roleMixCoes: () => getJSON<CoeOption[]>("/role-mix/coes"),
  topCandidatesForRole: (designation: string, asOfDate: string, limit = 15) =>
    getJSON<TopRoleCandidate[]>(
      `/forecast/top-candidates-for-role?designation=${encodeURIComponent(designation)}&as_of_date=${asOfDate}&limit=${limit}`
    ),
  // Batched form of topCandidatesForRole -- one request for several
  // {designation, as_of_date} pairs, so the wizard's auto-staffing (which used
  // to fire one HTTP call per budgeted role) doesn't pay for the same
  // expensive availability computation once per role.
  topCandidatesForRoles: (requests: { designation: string; as_of_date: string }[], limit = 20) =>
    postJSON<Record<string, TopRoleCandidate[]>>("/forecast/top-candidates-for-roles", { requests, limit }),
  roleMixCoeSkills: (coes: string[]) =>
    getJSON<CoeSkillsResult>(`/role-mix/coe-skills?coes=${encodeURIComponent(coes.join(","))}`),
  sixMonthOutlook: (startDate?: string, horizonMonths?: number, granularity?: "month" | "week") => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (horizonMonths) params.set("horizon_months", String(horizonMonths));
    if (granularity) params.set("granularity", granularity);
    const qs = params.toString();
    return getJSON<SixMonthOutlookResult>(`/forecast/six-month-outlook${qs ? `?${qs}` : ""}`);
  },
  outlookDrilldown: (opts: {
    dimension: string;
    value?: string;
    month?: string | null;
    startDate?: string;
    horizonMonths?: number;
    granularity?: "month" | "week";
    isConfirmed?: boolean;
  }) => {
    const params = new URLSearchParams({ dimension: opts.dimension });
    if (opts.value != null) params.set("value", opts.value);
    if (opts.month) params.set("month", opts.month);
    if (opts.startDate) params.set("start_date", opts.startDate);
    if (opts.horizonMonths) params.set("horizon_months", String(opts.horizonMonths));
    if (opts.granularity) params.set("granularity", opts.granularity);
    if (opts.isConfirmed != null) params.set("is_confirmed", String(opts.isConfirmed));
    return getJSON<OutlookDrilldownResult>(`/forecast/six-month-outlook/drilldown?${params.toString()}`);
  },
  freePool: (jmdOnly: boolean = false) => getJSON<FreePoolCandidate[]>(`/free-pool${jmdOnly ? "?jmd_only=true" : ""}`),
  freePoolMatches: (
    employeeId: string, topN = 20, include: IncludeParams = DEFAULT_INCLUDE_PARAMS,
    includeBelowCapacity: boolean = false, nearCapacityTolerancePct: number = 25
  ) =>
    getJSON<RedeployMatch[]>(
      `/free-pool/${encodeURIComponent(employeeId)}/matches?top_n=${topN}` +
        `&include_skill=${include.skill}&include_competency=${include.competency}&include_availability=${include.availability}` +
        `&include_category_match=${include.category_match}&include_project_count=${include.project_count}` +
        `&include_coe_affinity=${include.coe_affinity}&include_cost_efficiency=${include.cost_efficiency}` +
        `&include_below_capacity=${includeBelowCapacity}&near_capacity_tolerance_pct=${nearCapacityTolerancePct}`
    ),
  backfillCandidates: (
    employeeId: string, sourceProjectId: string, topN = 15, include: IncludeParams = DEFAULT_INCLUDE_PARAMS,
    includeBelowCapacity: boolean = false, nearCapacityTolerancePct: number = 25,
    includeResumeLinkedin: boolean = true
  ) =>
    getJSON<BackfillResult>(
      `/recommendations/backfill?employee_id=${encodeURIComponent(employeeId)}&source_project_id=${encodeURIComponent(sourceProjectId)}&top_n=${topN}` +
        `&include_skill=${include.skill}&include_competency=${include.competency}&include_availability=${include.availability}` +
        `&include_category_match=${include.category_match}&include_project_count=${include.project_count}` +
        `&include_coe_affinity=${include.coe_affinity}&include_cost_efficiency=${include.cost_efficiency}` +
        `&include_below_capacity=${includeBelowCapacity}&near_capacity_tolerance_pct=${nearCapacityTolerancePct}` +
        `&include_resume_linkedin=${includeResumeLinkedin}`
    ),
  revenueTrend: () => getJSON<RevenueMonth[]>("/revenue/trend"),
  leaveImpact: (
    include: IncludeParams = DEFAULT_INCLUDE_PARAMS,
    includeBelowCapacity: boolean = false, nearCapacityTolerancePct: number = 25
  ) =>
    getJSON<LeaveImpact[]>(
      `/leave/impact?include_skill=${include.skill}&include_competency=${include.competency}&include_availability=${include.availability}` +
        `&include_category_match=${include.category_match}&include_project_count=${include.project_count}` +
        `&include_coe_affinity=${include.coe_affinity}&include_cost_efficiency=${include.cost_efficiency}` +
        `&include_below_capacity=${includeBelowCapacity}&near_capacity_tolerance_pct=${nearCapacityTolerancePct}`
    ),
  projectAlumniCandidates: (projectCode: string, excludeEmployeeId?: string) =>
    getJSON<ProjectAlumniCandidate[]>(
      `/leave/project-alumni?project_code=${encodeURIComponent(projectCode)}` +
        (excludeEmployeeId ? `&exclude_employee_id=${encodeURIComponent(excludeEmployeeId)}` : "")
    ),
  requestSupport: (employeeId: string, projectId: string, startDate: string, endDate: string) =>
    postJSON<SupportRequestResult>("/leave/request-support", {
      employee_id: employeeId, project_id: projectId, start_date: startDate, end_date: endDate,
    }),
  headcountPrediction: (horizonMonths: number = 12) =>
    getJSON<HeadcountPredictionResult>(`/forecast/headcount-prediction?horizon_months=${horizonMonths}`),
  headcountPredictionTables: () =>
    getJSON<HeadcountRawTableSummary[]>("/forecast/headcount-prediction/tables"),
  headcountPredictionRawData: (table: string) =>
    getJSON<HeadcountRawTable>(`/forecast/headcount-prediction/raw-data?table=${encodeURIComponent(table)}`),
  headcountPredictionSimulate: (horizonMonths: number, history: Record<string, HeadcountRawCellValue>[]) =>
    postJSON<HeadcountPredictionResult>("/forecast/headcount-prediction/simulate", { horizon_months: horizonMonths, history }),
  adminDataSources: () => getJSON<DataSourceInfo[]>("/admin/data-sources"),
  adminConnectionStatus: () => getJSON<ConnectionStatus>("/admin/connection-status"),
  adminSaveConnection: (mode: string, baseUrl: string | null, apiKey: string | null) =>
    postJSON<ConnectionStatus>("/admin/connection", { mode, base_url: baseUrl, api_key: apiKey }),
  adminTestConnection: () => postJSON<ConnectionTestResult>("/admin/connection/test", {}),
  jdwhConnection: () => getJSON<JdwhConnectionConfig>("/admin/jdwh/connection"),
  jdwhExpectedTables: () => getJSON<{ tables: JdwhExpectedTable[] }>("/admin/jdwh/expected-tables"),
  jdwhSaveConnection: (cfg: JdwhConnectionConfig) => postJSON<JdwhConnectionConfig>("/admin/jdwh/connection", cfg),
  jdwhConnect: (cfg: JdwhConnectionConfig & { password?: string | null }) =>
    postJSON<JdwhConnectResult>("/admin/jdwh/connect", cfg),
  jdwhLoadTables: (cfg: JdwhConnectionConfig & { password?: string | null }) =>
    postJSON<JdwhLoadTablesResult>("/admin/jdwh/load-tables", cfg),
  jdwhBackups: () => getJSON<{ backups: JdwhBackupInfo[] }>("/admin/jdwh/backups"),
  jdwhRevert: () => postJSON<JdwhRevertResult>("/admin/jdwh/revert", { timestamp: null }),
  adminDatasetPreview: (key: string, rows = 20) =>
    getJSON<DatasetPreview>(`/admin/data-sources/${encodeURIComponent(key)}/preview?rows=${rows}`),
  adminDatasetSchema: (key: string) => getJSON<DatasetSchema>(`/admin/data-sources/${encodeURIComponent(key)}/schema`),
  listFeedback: () => getJSON<FeedbackEntry[]>("/feedback"),
  submitFeedback: (name: string, category: string, message: string) =>
    postJSON<FeedbackEntry>("/feedback", { name: name || null, category, message }),
  // Fire-and-poll: the backend now processes every upload in the background
  // (see routers/admin.py) so one large file can never block other users --
  // this call just hands off the raw bytes and gets a job_id back
  // immediately. Used as the fallback path when S3 isn't configured; see
  // lib/uploadManager.ts for the S3-relayed path and the public
  // adminUploadDataset()/jdwhUploadWorkbook() functions below that most
  // pages should actually call (same old "await the final result" shape,
  // progress + persistence handled internally).
  adminUploadDatasetDirect: async (key: string, file: File): Promise<UploadJobHandle> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/admin/data-sources/${encodeURIComponent(key)}/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await extractErrorMessage(res, "upload"));
    return res.json();
  },
  adminPresignUpload: (kind: string, filename: string, contentType: string, fileSizeBytes: number) =>
    postJSON<PresignedUpload>("/admin/s3/presign-upload", {
      kind, filename, content_type: contentType, file_size_bytes: fileSizeBytes,
    }),
  adminConfirmS3Upload: (kind: string, s3Key: string, filename: string) =>
    postJSON<UploadJobHandle>("/admin/s3/confirm-upload", { kind, s3_key: s3Key, filename }),
  adminJobStatus: (jobId: string) => getJSON<UploadJobStatus>(`/admin/jobs/${encodeURIComponent(jobId)}`),
  jdwhPreviewWorkbook: async (file: File): Promise<JdwhWorkbookPreview> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/admin/jdwh/preview-workbook`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Could not read this file: ${res.status}`);
    }
    return res.json();
  },
  jdwhPreviewFile: async (file: File): Promise<JdwhFilePreview> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/admin/jdwh/preview-file`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Could not read this file: ${res.status}`);
    }
    return res.json();
  },
  jdwhUploadWorkbookDirect: async (file: File): Promise<UploadJobHandle> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/admin/jdwh/upload-workbook`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await extractErrorMessage(res, "upload"));
    return res.json();
  },
  jdwhUploadFilesDirect: async (files: Record<JdwhUploadTableKey, File | null>): Promise<UploadJobHandle> => {
    const form = new FormData();
    (Object.entries(files) as [JdwhUploadTableKey, File | null][]).forEach(([key, file]) => {
      if (file) form.append(key, file);
    });
    const res = await fetch(`${BASE}/admin/jdwh/upload-files`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await extractErrorMessage(res, "upload"));
    return res.json();
  },
  // Public entry points -- same "await the final result" shape every
  // existing caller already expects, but now backed by a background job with
  // real progress and (when S3 is configured) a direct-to-storage transfer
  // instead of proxying the bytes through this backend. See
  // lib/uploadManager.ts for the actual orchestration + the persistent
  // progress widget it feeds.
  adminUploadDataset: (key: string, file: File): Promise<DataSourceInfo> =>
    uploadDatasetViaManager(key, file) as Promise<DataSourceInfo>,
  jdwhUploadWorkbook: (file: File): Promise<JdwhLoadTablesResult> =>
    uploadJdwhWorkbookViaManager(file) as Promise<JdwhLoadTablesResult>,
  jdwhUploadFiles: (files: Record<JdwhUploadTableKey, File | null>): Promise<JdwhLoadTablesResult> =>
    uploadJdwhFilesViaManager(files) as Promise<JdwhLoadTablesResult>,
};

// ── Headcount Prediction (rebuilt on real employee data -- see
// backend/app/engines/headcount_prediction_engine.py) ──────────────────────
export interface HeadcountHistoryRow {
  month: string;
  total_active_headcount: number;
  new_hires: number;
  resignations: number;
  hires_by_location: Record<string, number>;
  hires_estimated: boolean;
  note: string | null;
}

export interface HeadcountForecastRow {
  month: string;
  forecast: number;
  lower: number;
  upper: number;
  sample_months: number;
  resignation_sample_months: number;
  low_confidence: boolean;
  forecast_new_hires: number;
  forecast_resignations: number;
  forecast_hires_by_location: Record<string, number>;
}

export interface HeadcountRiskFlag {
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface HeadcountCoeMixRow {
  coe: string;
  headcount: number;
  share_pct: number;
}

export interface HeadcountHiresVsResignationsRow {
  month: string;
  new_hires: number;
  resignations: number;
  net: number;
}

export interface HeadcountProductivityPoint {
  month: string;
  value: number;
  revenue_ltm_gbp_000: number;
  headcount: number;
  is_real_revenue_anchor: boolean;
}

export interface HeadcountInsights {
  executive_summary: string[];
  risk_flags: HeadcountRiskFlag[];
  headcount_change_pct_3mo: number | null;
  forecast_change_pct: number | null;
  productivity: {
    current_revenue_per_head_gbp: number;
    predicted_revenue_per_head_gbp_forecast: number | null;
    history: HeadcountProductivityPoint[];
    forecast: HeadcountProductivityPoint[];
    current_ebitda_margin_pct: number;
    predicted_ebitda_margin_pct_forecast: number | null;
    ebitda_margin_history: { month: string; value: number }[];
    ebitda_margin_forecast: { month: string; value: number }[];
  };
  coe_breakdown: {
    latest_month: string;
    mix: HeadcountCoeMixRow[];
  };
  attrition: {
    hires_vs_resignations: HeadcountHiresVsResignationsRow[];
    hires_vs_resignations_forecast: HeadcountHiresVsResignationsRow[];
  };
  utilization: {
    free_pool_current: number;
    over_allocated_current: number;
    under_allocated_current: number;
  };
}

export interface HeadcountPredictionResult {
  history: HeadcountHistoryRow[];
  training_period: string;
  horizon_months: number;
  forecast: HeadcountForecastRow[];
  insights: HeadcountInsights;
  model_info: {
    type: string;
    sample_months: number;
    resignation_sample_months: number;
    low_confidence: boolean;
    trained_on: string;
    note: string;
  };
}

export type HeadcountRawCellValue = string | number | boolean | null | Record<string, number>;

export interface HeadcountRawTableSummary {
  table: string;
  label: string;
  description: string;
}

export interface UploadJobHandle {
  job_id: string;
}

export interface PresignedUpload {
  s3_key: string;
  upload_url: string;
}

export interface UploadJobStatus {
  job_id: string;
  kind: string;
  label: string;
  status: "queued" | "processing" | "done" | "error";
  progress_pct: number;
  message: string;
  size_bytes: number | null;
  estimated_seconds: number | null;
  remaining_seconds: number | null;
  result: unknown;
  error: string | null;
}

export interface DataSourceInfo {
  key: string;
  label: string;
  description: string;
  file_type: "csv" | "xlsx";
  current_filename: string | null;
  row_count: number | null;
  last_modified: string | null;
  source: string;
}

export interface ConnectionStatus {
  mode: string;
  jin_base_url: string | null;
  jin_has_api_key: boolean;
  jin_configured: boolean;
  jin_connected: boolean;
  message: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export type JdwhAuthType = "Microsoft Entra ID - Universal with MFA support" | "SQL Login" | "Windows Authentication";
export type JdwhEncryptOption = "Mandatory" | "Optional" | "Strict";

export interface JdwhConnectionConfig {
  profile_name: string;
  server: string;
  port: number;
  database: string;
  auth_type: JdwhAuthType;
  account: string;
  encrypt: JdwhEncryptOption;
  trust_server_certificate: boolean;
}

export interface JdwhColumn {
  column: string;
  data_type: string;
  nullable: boolean;
}

export interface JdwhExpectedTable {
  schema: string;
  table: string;
  label: string;
  columns: JdwhColumn[];
}

export interface JdwhDiscoveredTable extends JdwhExpectedTable {
  found: boolean;
}

export interface JdwhConnectResult {
  success: boolean;
  tables: JdwhDiscoveredTable[];
}

export interface JdwhLoadTablesResult {
  success: boolean;
  row_counts: Record<string, number>;
  backup_timestamp: string;
  empty_tables: string[];
}

// Single-generation backup only (the state right before the last Load
// Tables) -- not a list of timestamped snapshots to choose between.
export interface JdwhBackupInfo {
  available: boolean;
  row_counts: Record<string, number>;
}

export interface JdwhRevertResult {
  success: boolean;
  restored_tables: string[];
}

export type JdwhUploadTableKey =
  | "employee" | "designation_history" | "project" | "project_allocation" | "timesheet" | "weekly_status_report";

export interface JdwhWorkbookPreviewSheet {
  sheet_name: string;
  row_count: number | null;
  column_count: number | null;
  is_required_table: boolean;
}

export interface JdwhWorkbookPreview {
  sheets: JdwhWorkbookPreviewSheet[];
  missing_required: string[];
}

export interface JdwhFilePreview {
  sheet_name: string | null;
  row_count: number;
  column_count: number;
}

export interface FeedbackEntry {
  submitted_at: string;
  name: string;
  category: string;
  message: string;
}

export interface DatasetTablePreview {
  label: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  total_row_count: number;
  truncated: boolean;
  error?: string;
}

export interface DatasetPreview {
  key: string;
  label: string;
  tables: DatasetTablePreview[];
}

export interface DatasetSchemaSheet {
  sheet_name: string | null;
  columns: string[];
  sample_rows: Record<string, string | number | boolean | null>[];
}

export interface DatasetSchema {
  key: string;
  label: string;
  file_type: "csv" | "xlsx";
  sheets: DatasetSchemaSheet[];
}

export interface HeadcountRawTable extends HeadcountRawTableSummary {
  columns: string[];
  rows: Record<string, HeadcountRawCellValue>[];
  row_count: number;
}
