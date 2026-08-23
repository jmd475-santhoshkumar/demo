"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, ChevronDown, ChevronUp, History, Mail } from "lucide-react";
import { api, type IncludeParams, type LeaveImpact, type ProjectAlumniCandidate, type RedeployCandidate, type SupportRequestResult } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { Badge } from "@/components/shared/Badge";
import { HoldChip } from "@/components/shared/HoldFlag";
import { AssignModal } from "@/components/shared/AssignModal";
import { cleanSkillLabel, SkillSection } from "@/components/shared/EmployeeProfileModal";
import { cn } from "@/lib/utils";

const REASON_VARIANT: Record<string, string> = { ending_soon: "amber", fully_free: "green", under_utilized: "under_utilized" };

function reasonLabel(c: RedeployCandidate): string {
  if (c.reason === "fully_free") return "Fully free";
  if (c.reason === "ending_soon") return `${c.days_to_end}d left on current work`;
  if (c.reason === "under_utilized") return `${c.current_allocation_pct}% allocated`;
  return c.reason;
}

function skillSourceLabel(source: LeaveImpact["required_skill_source"], jobName: string | null): string {
  if (source === "project_roster") return "this project's own team — what their current teammates actually know";
  if (source === "own_skills") return `${jobName ?? "the employee"}'s own skills (project roster too thin to derive a signature)`;
  return "no skill data available for this role — ranked by availability only";
}

function CandidateCard({
  candidate,
  rank,
  onSelectEmployee,
  includeParams,
  onAssign,
}: {
  candidate: RedeployCandidate;
  rank: number;
  onSelectEmployee: (id: string) => void;
  includeParams: IncludeParams;
  onAssign: () => void;
}) {
  const matched = (candidate.matched_skills ?? []).map(cleanSkillLabel).filter(Boolean);
  const missing = (candidate.missing_skills ?? []).map(cleanSkillLabel).filter(Boolean);
  const assessed = candidate.skill_bucket && candidate.skill_bucket !== "not_assessed";
  const hasSkillDetail = assessed && (matched.length > 0 || missing.length > 0);
  const [skillDetailOpen, setSkillDetailOpen] = useState(false);
  const [showAllMatched, setShowAllMatched] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);

  return (
    <div
      className={
        "rounded-xl border p-3.5 space-y-2.5 transition " +
        (rank === 0 ? "border-primary/40 bg-primary/[0.03]" : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900")
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {rank === 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary flex-shrink-0">
              <Award className="w-3.5 h-3.5" /> Top pick
            </span>
          )}
          <button onClick={() => onSelectEmployee(candidate.employee_id)} className="font-semibold text-sm text-primary hover:underline truncate">
            {candidate.employee_id}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{candidate.job_name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge variant={REASON_VARIANT[candidate.reason] ?? "default"}>{reasonLabel(candidate)}</Badge>
          {assessed && (
            <Badge variant={candidate.skill_bucket}>
              {Math.round((candidate.skill_score ?? 0) * 100)}% skill match
            </Badge>
          )}
          <HoldChip onHold={candidate.on_hold} holdProjects={candidate.hold_projects} />
          <button onClick={onAssign} className="text-[11px] px-2 py-1 rounded-lg bg-primary text-white hover:opacity-90 whitespace-nowrap">
            Assign
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5 text-[11px] text-gray-400 dark:text-gray-500 flex-wrap">
        {candidate.coe && <span>{candidate.coe}</span>}
        {candidate.location && <span>· {candidate.location}</span>}
        {candidate.composite_score != null && (
          <span className="ml-auto font-semibold text-gray-600 dark:text-gray-400">{Math.round(candidate.composite_score * 100)}% overall fit</span>
        )}
        {candidate.competency_score != null && <span>{Math.round(candidate.competency_score * 100)}% comp</span>}
        {includeParams.category_match && candidate.relevant_project_ratio != null && (
          <span>cat {Math.round(candidate.relevant_project_ratio * 100)}%</span>
        )}
        {includeParams.project_count && candidate.project_count_score != null && (
          <span>count {Math.round(candidate.project_count_score * 100)}%</span>
        )}
        {candidate.total_projects != null && candidate.total_projects > 0 && (
          <span>{candidate.relevant_project_count}/{candidate.total_projects} relevant projects</span>
        )}
      </div>

      {hasSkillDetail && (
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setSkillDetailOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            {skillDetailOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {skillDetailOpen ? "Hide" : "Show"} skill match ({matched.length} matched
            {missing.length > 0 ? `, ${missing.length} missing` : ""})
          </button>
          {skillDetailOpen && (
            <div className="space-y-1.5 mt-1.5">
              {matched.length > 0 && (
                <SkillSection
                  labels={matched}
                  variant="matched"
                  showAll={showAllMatched}
                  onToggle={(e) => { e.stopPropagation(); setShowAllMatched((v) => !v); }}
                />
              )}
              {missing.length > 0 && (
                <SkillSection
                  labels={missing}
                  variant="missing"
                  showAll={showAllMissing}
                  onToggle={(e) => { e.stopPropagation(); setShowAllMissing((v) => !v); }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STINT_STATUS_VARIANT: Record<string, string> = { BILLABLE: "billable", UNBILLABLE: "unbilled", SHADOW: "shadow" };

function AlumniCandidateCard({
  candidate,
  onSelectEmployee,
  onAssign,
  onRequest,
}: {
  candidate: ProjectAlumniCandidate;
  onSelectEmployee: (id: string) => void;
  onAssign: () => void;
  onRequest: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => onSelectEmployee(candidate.employee_id)} className="font-semibold text-sm text-primary hover:underline truncate">
            {candidate.employee_id}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{candidate.job_name ?? "-"}</span>
          {candidate.location && <span className="text-[11px] text-gray-400 dark:text-gray-500">· {candidate.location}</span>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={onRequest}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-primary/30 text-primary hover:bg-primary/5 whitespace-nowrap"
            title="Email this person to ask if they're available, CC'ing the project manager and their CDM"
          >
            <Mail className="w-3 h-3" /> Request
          </button>
          <button onClick={onAssign} className="text-[11px] px-2 py-1 rounded-lg bg-primary text-white hover:opacity-90 whitespace-nowrap">
            Assign
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {candidate.is_currently_free ? (
          <Badge variant="green">Currently free</Badge>
        ) : (
          candidate.current_projects.map((p) => (
            <Badge key={p.project_id} variant="under_utilized">
              on {p.project_id} · {p.allocation_by_percentage ?? "?"}%
            </Badge>
          ))
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-gray-100 dark:border-gray-800">
        {candidate.past_stints.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400 flex-wrap">
            <span>{s.allocated_start_date ?? "?"} → {s.allocated_end_date ?? "?"}</span>
            <Badge variant={STINT_STATUS_VARIANT[s.resourcing_status] ?? "default"}>{s.resourcing_status}</Badge>
            <span className="text-gray-400 dark:text-gray-500">{s.allocation_by_percentage ?? "?"}% allocated</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Emails a backfill candidate to ask if they're available, CC'ing the
// project's real manager and the candidate's real reporting manager (CDM
// proxy) -- resolved server-side (see leave_service.build_support_request).
// No allocation is created here; purely an outreach nudge to follow up on.
function RequestSupportModal({
  employeeId,
  projectId,
  defaultStartDate,
  defaultEndDate,
  onClose,
}: {
  employeeId: string;
  projectId: string;
  defaultStartDate: string;
  defaultEndDate: string;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SupportRequestResult | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.requestSupport(employeeId, projectId, startDate, endDate);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send this request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Request support from ${employeeId}`} onClose={onClose} widthClassName="max-w-sm">
      <div className="p-4 space-y-3 text-xs">
        {error && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800/60">{error}</p>}

        {result ? (
          <div className="space-y-2">
            <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2 font-medium dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800/60">
              Request sent to {result.sent_to}
            </p>
            {result.cc.length > 0 && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                CC: {result.cc.join(", ")}
                {result.project_manager_employee_id && ` (${result.project_manager_employee_id} · project manager`}
                {result.project_manager_employee_id && result.cdm_employee_id && ", "}
                {result.cdm_employee_id && `${result.cdm_employee_id} · CDM`}
                {(result.project_manager_employee_id || result.cdm_employee_id) && ")"}
              </p>
            )}
            <button
              onClick={onClose}
              className="w-full px-4 py-2 rounded-lg text-xs font-medium text-white"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-gray-500 dark:text-gray-400">
              Emails {employeeId} asking if they can support {projectId} during this window, CC'ing the project manager
              and their CDM. No allocation is created — this is just an availability check.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Start date</label>
                <input
                  type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none dark:border-gray-700"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">End date</label>
                <input
                  type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none dark:border-gray-700"
                />
              </div>
            </div>
            <button
              onClick={submit}
              disabled={submitting}
              className="w-full px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            >
              {submitting ? "Sending…" : "Send request"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function LeaveBackfillModal({
  impact,
  onClose,
  onSelectEmployee,
  includeParams,
  onAssigned,
}: {
  impact: LeaveImpact;
  onClose: () => void;
  onSelectEmployee: (id: string) => void;
  includeParams: IncludeParams;
  onAssigned?: () => void;
}) {
  const [assignEmployeeId, setAssignEmployeeId] = useState<string | null>(null);
  const [requestEmployeeId, setRequestEmployeeId] = useState<string | null>(null);
  const [source, setSource] = useState<"pool" | "alumni">("pool");
  const [requiredSkillsOpen, setRequiredSkillsOpen] = useState(false);
  const alumni = useQuery({
    queryKey: ["project-alumni", impact.project_id, impact.employee_id],
    queryFn: () => api.projectAlumniCandidates(impact.project_id, impact.employee_id),
    enabled: source === "alumni",
  });

  return (
    <Modal
      title={`Backfill for ${impact.employee_id}${impact.job_name ? ` (${impact.job_name})` : ""}`}
      subtitle={`${impact.project_id} · ${impact.allocation_by_percentage}% allocated · on leave ${impact.leave_start_date} → ${impact.leave_end_date}`}
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="p-5 space-y-4">
        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 text-xs font-medium w-fit">
          <button
            onClick={() => setSource("pool")}
            className={cn("px-3 py-1.5 rounded-full transition-all", source === "pool" ? "bg-white shadow-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300")}
          >
            Free Pool
          </button>
          <button
            onClick={() => setSource("alumni")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all", source === "alumni" ? "bg-white shadow-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300")}
          >
            <History className="w-3 h-3" /> Previously on this project
          </button>
        </div>

        {source === "pool" && (
          <>
            <div className="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60 px-3 py-2.5">
              <button
                onClick={() => setRequiredSkillsOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-gray-400"
              >
                {requiredSkillsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Skill match is matched against {skillSourceLabel(impact.required_skill_source, impact.job_name)}
                {impact.required_skills.length > 0 && ` (${impact.required_skills.length})`}
              </button>
              {requiredSkillsOpen && impact.required_skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {impact.required_skills.map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[11px] text-gray-600 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {impact.backfill_candidates.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-6 dark:text-gray-500">
                No one with this designation ({impact.job_name ?? "?"}) is currently free.
              </p>
            ) : (
              <div className="space-y-2.5">
                {impact.backfill_candidates.map((c, i) => (
                  <CandidateCard
                    key={c.employee_id} candidate={c} rank={i} onSelectEmployee={onSelectEmployee} includeParams={includeParams}
                    onAssign={() => setAssignEmployeeId(c.employee_id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {source === "alumni" && (
          <>
            {alumni.isLoading ? (
              <p className="text-xs text-gray-400 italic text-center py-6 dark:text-gray-500">Loading…</p>
            ) : alumni.error ? (
              <p className="text-xs text-red-500 italic text-center py-6 dark:text-red-400">Could not load past team members.</p>
            ) : !alumni.data || alumni.data.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-6 dark:text-gray-500">
                No one else has previously worked on {impact.project_id}.
              </p>
            ) : (
              <div className="space-y-2.5">
                {alumni.data.map((c) => (
                  <AlumniCandidateCard
                    key={c.employee_id} candidate={c} onSelectEmployee={onSelectEmployee}
                    onAssign={() => setAssignEmployeeId(c.employee_id)}
                    onRequest={() => setRequestEmployeeId(c.employee_id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {assignEmployeeId && (
        <AssignModal
          employeeId={assignEmployeeId}
          projectId={impact.project_id}
          defaultAllocationPct={impact.allocation_by_percentage}
          defaultStartDate={impact.leave_start_date}
          defaultEndDate={impact.leave_end_date}
          onClose={() => setAssignEmployeeId(null)}
          onAssigned={() => { setAssignEmployeeId(null); onAssigned?.(); }}
        />
      )}

      {requestEmployeeId && (
        <RequestSupportModal
          employeeId={requestEmployeeId}
          projectId={impact.project_id}
          defaultStartDate={impact.leave_start_date}
          defaultEndDate={impact.leave_end_date}
          onClose={() => setRequestEmployeeId(null)}
        />
      )}
    </Modal>
  );
}
