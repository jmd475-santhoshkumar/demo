"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Sparkles, Users, X } from "lucide-react";
import {
  api,
  type GovernanceEndingEntry,
  type GovernanceKickoffEntry,
  type GovernanceProject,
  type GovernanceRisk,
  type GovernanceSpotlightEntry,
  type GovernanceSuggestedRisk,
  type GovernanceWsrEntry,
} from "@/lib/api";
import { Badge } from "@/components/shared/Badge";
import { Modal } from "@/components/shared/Modal";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { LoadingState, ErrorState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import { CLUSTER_COLORS } from "@/components/health/ClusterBalls";

function wsrBadge(signal: string | null | undefined) {
  if (!signal) return <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>;
  return <Badge variant={signal.toLowerCase()}>{signal}</Badge>;
}

// Shared header bar for both the loaded dashboard and the "no snapshot for
// this week" empty state. The week itself is picked one level up (see
// WeekCalendarPicker on the Clusters page) so it stays consistent while
// switching between clusters -- this bar just displays it.
function ClusterHeaderBar({
  clusterNumber, clusterName, weekStartDate, projectCount, onBack, onManageAssignment,
}: {
  clusterNumber: number;
  clusterName: string | undefined;
  weekStartDate: string | undefined;
  projectCount: number | undefined;
  onBack: () => void;
  onManageAssignment: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 dark:text-gray-500 hover:text-primary transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className={cn("flex items-center justify-center h-8 w-8 rounded-full text-white text-xs font-bold", CLUSTER_COLORS[clusterNumber] ?? "bg-gray-400")}>
          {clusterNumber}
        </span>
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Cluster {clusterNumber}{clusterName && <> — {clusterName}</>}</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {weekStartDate ? `Week of ${weekStartDate}` : "No data"}
            {projectCount != null && <> · {projectCount} project{projectCount === 1 ? "" : "s"}</>}
          </p>
        </div>
      </div>
      {onManageAssignment && (
        <button
          onClick={onManageAssignment}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary transition"
        >
          <Users className="w-3.5 h-3.5" /> Manage assignment
        </button>
      )}
    </div>
  );
}

export function ClusterGovernanceView({
  clusterNumber, week, onBack, onOpenProject, onBackToCurrentWeek,
}: {
  clusterNumber: number;
  // Controlled by the parent Clusters page's calendar picker (undefined =
  // current week) so the same week stays selected while switching clusters.
  week: string | undefined;
  onBack: () => void;
  onOpenProject: (code: string) => void;
  onBackToCurrentWeek: () => void;
}) {
  const qc = useQueryClient();
  const dashboard = useQuery({
    queryKey: ["governance-cluster", clusterNumber, week ?? "current"],
    queryFn: () => api.governanceCluster(clusterNumber, week),
  });
  const [manageOpen, setManageOpen] = useState(false);
  const [addRiskOpen, setAddRiskOpen] = useState(false);
  const [addSpotlightOpen, setAddSpotlightOpen] = useState(false);
  const [promotingRisk, setPromotingRisk] = useState<GovernanceSuggestedRisk | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["governance-cluster", clusterNumber, week ?? "current"] });
  const invalidateAll = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["governance-clusters"] });
  };

  const resolveRisk = useMutation({ mutationFn: (riskId: string) => api.governanceResolveRisk(riskId), onSuccess: invalidate });
  const removeSpotlight = useMutation({ mutationFn: (code: string) => api.governanceRemoveFromSpotlight(code), onSuccess: invalidate });

  if (dashboard.isLoading) return <LoadingState label="Loading cluster…" />;
  if (dashboard.error) return <ErrorState message="Could not load this cluster." />;

  if (!dashboard.data) {
    return (
      <div className="space-y-5">
        <ClusterHeaderBar clusterNumber={clusterNumber} clusterName={undefined} weekStartDate={week} projectCount={undefined} onBack={onBack} onManageAssignment={undefined} />
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No snapshot was captured for this cluster during that week.</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Snapshots are captured automatically whenever a week's dashboard is viewed while it's current.</p>
        </div>
      </div>
    );
  }

  const d = dashboard.data;
  const readOnly = !d.is_current_week;
  const spotlightCodes = new Set(d.spotlight.map((s) => s.project_code));
  const projectOptions = d.projects.map((p) => ({ value: p.project_code, label: `${p.project_code} — ${p.project_name ?? "Unnamed"}` }));

  return (
    <div className="space-y-5">
      <ClusterHeaderBar
        clusterNumber={clusterNumber}
        clusterName={d.name}
        weekStartDate={d.week_start_date}
        projectCount={d.projects.length}
        onBack={onBack}
        onManageAssignment={readOnly ? undefined : () => setManageOpen(true)}
      />

      {readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Viewing a historical snapshot{d.captured_at && <> captured on {new Date(d.captured_at).toLocaleString()}</>} — DevOps status, staffing, and the
            summary are frozen as of that capture. Editing is disabled here.
          </p>
          <button onClick={onBackToCurrentWeek} className="flex-shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap">
            Back to current week
          </button>
        </div>
      )}

      {/* ── Cluster Summary -- the call's opening highlight line, read first ── */}
      <ClusterSummarySection clusterNumber={clusterNumber} points={d.cluster_summary_points} />

      {/* ── Risks & Key Projects ───────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200">Risks &amp; Key Projects</h3>
          {!readOnly && (
            <button onClick={() => setAddRiskOpen(true)} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
              <Plus className="w-3 h-3" /> Add risk
            </button>
          )}
        </div>
        <RisksTable
          openRisks={d.open_risks}
          suggestedRisks={d.synthetic_risks}
          onOpenProject={onOpenProject}
          onResolve={(riskId) => resolveRisk.mutate(riskId)}
          onPromote={setPromotingRisk}
          readOnly={readOnly}
        />
      </section>

      {/* ── Top Projects — end to end review (spotlight) ───────────────── */}
      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200">Top Projects — End to End Review</h3>
          {!readOnly && (
            <button onClick={() => setAddSpotlightOpen(true)} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
              <Plus className="w-3 h-3" /> Add project
            </button>
          )}
        </div>
        <SpotlightTable spotlight={d.spotlight} onOpenProject={onOpenProject} onSaved={invalidate} onRemove={(code) => removeSpotlight.mutate(code)} readOnly={readOnly} />
      </section>

      {/* ── Kick-off / Ending this week ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KickoffSection entries={d.kickoff_this_week} onOpenProject={onOpenProject} onSaved={invalidate} readOnly={readOnly} />
        <EndingSection entries={d.ending_this_week} onOpenProject={onOpenProject} />
      </div>

      {/* ── WSR Status ───────────────────────────────────────────────────── */}
      <WsrStatusSection wsrStatus={d.wsr_status} onOpenProject={onOpenProject} />

      {manageOpen && (
        <ManageAssignmentModal
          clusterNumber={clusterNumber}
          clusterName={d.name}
          projects={d.projects}
          onClose={() => setManageOpen(false)}
          onChanged={invalidateAll}
        />
      )}
      {addRiskOpen && (
        <AddRiskModal projectOptions={projectOptions} onClose={() => setAddRiskOpen(false)} onSaved={() => { invalidate(); setAddRiskOpen(false); }} />
      )}
      {promotingRisk && (
        <AddRiskModal
          projectOptions={projectOptions}
          initial={promotingRisk}
          onClose={() => setPromotingRisk(null)}
          onSaved={() => { invalidate(); setPromotingRisk(null); }}
        />
      )}
      {addSpotlightOpen && (
        <AddToSpotlightModal
          projectOptions={projectOptions.filter((o) => !spotlightCodes.has(o.value))}
          onClose={() => setAddSpotlightOpen(false)}
          onSaved={() => { invalidate(); setAddSpotlightOpen(false); }}
        />
      )}
    </div>
  );
}

// ── Risks & Key Projects table -- one unified, PPT-shaped table (Project |
// WSR | Risk Description | Risk Type | Suggested Mitigation Steps) for both
// real logged risks and unlogged-but-flagged suggestions, sorted worst-
// signal-first so the projects needing attention surface at the top. ──────
const WSR_SEVERITY_RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2 };

// Shared JMAN table border treatment (dashed rose separators, rose header
// underline) -- the same look as the Risks & Key Projects and Spotlight
// tables, reused here for Kick-off/Ending so every table on this page reads
// as one consistent format instead of three different styles.
const ROSE_TABLE_WRAPPER = "overflow-x-auto rounded-lg border border-jman-rose/30 dark:border-jman-rose/20";
const ROSE_HEADER_ROW = "text-left bg-jman-rose-50 dark:bg-jman-rose/10 text-gray-500 dark:text-gray-400 border-b-2 border-jman-rose/40 dark:border-jman-rose/30";
const ROSE_HEADER_CELL = "py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px]";
const ROSE_ROW = "border-t border-dashed border-jman-rose/25 dark:border-jman-rose/20 align-top hover:bg-jman-rose-50/40 dark:hover:bg-jman-rose/5 transition-colors";
const ROSE_CELL_BORDER = "border-r border-dashed border-jman-rose/25 dark:border-jman-rose/20 last:border-r-0";
const ROSE_EMPTY_BOX = "rounded-lg border border-dashed border-jman-rose/30 dark:border-jman-rose/20 py-8 text-center";

function WsrCell({ signal }: { signal?: string | null }) {
  if (!signal) return <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>;
  return <Badge variant={signal.toLowerCase()}>{signal}</Badge>;
}

function RiskTypeChips({ riskType }: { riskType: string | null }) {
  if (!riskType) return <span className="text-gray-300 dark:text-gray-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {riskType.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
        <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 whitespace-nowrap">
          {t}
        </span>
      ))}
    </div>
  );
}

type UnifiedRiskRow =
  | ({ kind: "logged" } & GovernanceRisk)
  | ({ kind: "suggested" } & GovernanceSuggestedRisk);

function RisksTable({
  openRisks, suggestedRisks, onOpenProject, onResolve, onPromote, readOnly,
}: {
  openRisks: GovernanceRisk[];
  suggestedRisks: GovernanceSuggestedRisk[];
  onOpenProject: (code: string) => void;
  onResolve: (riskId: string) => void;
  onPromote: (risk: GovernanceSuggestedRisk) => void;
  readOnly?: boolean;
}) {
  const rows: UnifiedRiskRow[] = [
    ...openRisks.map((r) => ({ kind: "logged" as const, ...r })),
    ...suggestedRisks.map((r) => ({ kind: "suggested" as const, ...r })),
  ].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "logged" ? -1 : 1;
    const rankA = WSR_SEVERITY_RANK[a.wsr_signal ?? ""] ?? 3;
    const rankB = WSR_SEVERITY_RANK[b.wsr_signal ?? ""] ?? 3;
    return rankA - rankB;
  });

  if (rows.length === 0) {
    return (
      <div className={ROSE_EMPTY_BOX}>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">No risks logged or flagged for this cluster right now.</p>
      </div>
    );
  }

  const cellBorder = ROSE_CELL_BORDER;
  return (
    <div className={ROSE_TABLE_WRAPPER}>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-left bg-jman-rose-50 dark:bg-jman-rose/10 text-gray-500 dark:text-gray-400 border-b-2 border-jman-rose/40 dark:border-jman-rose/30">
            <th className={cn("py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px]", cellBorder)}>Project</th>
            <th className={cn("py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px]", cellBorder)}>WSR</th>
            <th className={cn("py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px]", cellBorder)}>Risk Description</th>
            <th className={cn("py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px]", cellBorder)}>Risk Type</th>
            <th className={cn("py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px]", cellBorder)}>Suggested Mitigation Steps</th>
            <th className="py-2.5 px-3 font-semibold uppercase tracking-wide text-[10px] text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.risk_id} className="border-t border-dashed border-jman-rose/25 dark:border-jman-rose/20 align-top hover:bg-jman-rose-50/40 dark:hover:bg-jman-rose/5 transition-colors">
              <td className={cn("py-3 px-3 min-w-[9rem]", cellBorder)}>
                <button onClick={() => onOpenProject(r.project_code)} className="text-xs font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors block">
                  {r.project_code}
                </button>
                {r.project_name && <span className="block text-[10px] text-gray-400 dark:text-gray-500 leading-snug mt-0.5">{r.project_name}</span>}
              </td>
              <td className={cn("py-3 px-3", cellBorder)}><WsrCell signal={r.wsr_signal} /></td>
              <td className={cn("py-3 px-3 text-gray-600 dark:text-gray-400 leading-relaxed min-w-[16rem] max-w-md", cellBorder)}>{r.risk_description}</td>
              <td className={cn("py-3 px-3 min-w-[7rem]", cellBorder)}><RiskTypeChips riskType={r.risk_type} /></td>
              <td className={cn("py-3 px-3 text-gray-500 dark:text-gray-400 leading-relaxed min-w-[14rem] max-w-md", cellBorder)}>{r.mitigation_steps ?? "—"}</td>
              <td className="py-3 px-3 text-right whitespace-nowrap">
                {r.kind === "logged" ? (
                  readOnly ? (
                    <span className="text-[10px] text-gray-300 dark:text-gray-600">Open</span>
                  ) : (
                    <button onClick={() => onResolve(r.risk_id)} className="text-[10px] font-medium text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                      Resolve
                    </button>
                  )
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={cn(
                        "text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap",
                        !r.is_synthetic
                          ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                          : r.is_ai_generated
                          ? "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400"
                          : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                      )}
                      title={
                        !r.is_synthetic
                          ? "Real WSR risk note, shown exactly as recorded — no AI involved"
                          : r.is_ai_generated
                          ? "AI-suggested from WSR status colors only — real WSR comments aren't available yet"
                          : "No AI provider responded — nothing generated"
                      }
                    >
                      {!r.is_synthetic ? "From WSR" : r.is_ai_generated ? "AI-suggested" : "AI unavailable"}
                    </span>
                    {!readOnly && (
                      <button onClick={() => onPromote(r)} className="text-[10px] font-medium text-primary hover:underline whitespace-nowrap">
                        Log as real risk
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Manage assignment ─────────────────────────────────────────────────────
function ManageAssignmentModal({
  clusterNumber, clusterName, projects, onClose, onChanged,
}: {
  clusterNumber: number;
  clusterName: string;
  projects: GovernanceProject[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const unassigned = useQuery({ queryKey: ["governance-unassigned"], queryFn: api.governanceUnassignedProjects });
  const [picked, setPicked] = useState<string[]>([]);
  const assign = useMutation({
    mutationFn: (code: string) => api.governanceAssignCluster(code, clusterNumber),
    onSuccess: () => { onChanged(); unassigned.refetch(); setPicked([]); },
  });
  // Reassigning away removes it from this cluster by moving it to none of the
  // 5 -- there's no "unassign" endpoint, so the practical path is picking a
  // different cluster from this same picker on that cluster's own view.

  return (
    <Modal title={`Cluster ${clusterNumber} — ${clusterName}`} subtitle="Manage which projects belong to this cluster" onClose={onClose}>
      <div className="p-5 space-y-4">
        <div>
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-2">Currently in this cluster ({projects.length})</p>
          {projects.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic">No projects assigned yet.</p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {projects.map((p) => (
                <li key={p.project_code} className="text-xs text-gray-700 dark:text-gray-300 flex items-center justify-between">
                  <span>{p.project_code} — {p.project_name ?? "Unnamed"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-2">Add an unassigned project</p>
          <div className="flex items-center gap-2">
            <SearchableSelect
              options={(unassigned.data ?? []).map((p) => ({ value: p.project_code, label: `${p.project_code} — ${p.project_name ?? "Unnamed"}` }))}
              value={picked}
              onChange={setPicked}
              placeholder="Search projects…"
            />
            <button
              disabled={picked.length === 0 || assign.isPending}
              onClick={() => picked[0] && assign.mutate(picked[0])}
              className="text-xs px-3 py-2 rounded-lg text-white font-medium disabled:opacity-40"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Add risk (also used to "promote" a suggested/synthetic risk to real) ──
function AddRiskModal({
  projectOptions, onClose, onSaved, initial,
}: {
  projectOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
  initial?: GovernanceSuggestedRisk;
}) {
  const [project, setProject] = useState<string[]>(initial ? [initial.project_code] : []);
  const [description, setDescription] = useState(initial?.risk_description ?? "");
  const [riskType, setRiskType] = useState(initial?.risk_type ?? "");
  const [mitigation, setMitigation] = useState(initial?.mitigation_steps ?? "");
  const save = useMutation({
    mutationFn: () => api.governanceAddRisk(project[0], description, riskType || null, mitigation || null),
    onSuccess: onSaved,
  });

  return (
    <Modal
      title={initial ? "Log as real risk" : "Add risk"}
      subtitle={initial ? "Review and edit the suggested text, then save it as a real, tracked risk." : undefined}
      onClose={onClose}
      widthClassName="max-w-lg"
    >
      <div className="p-5 space-y-3">
        <div>
          <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block mb-1">Project</label>
          <SearchableSelect options={projectOptions} value={project} onChange={setProject} placeholder="Select project…" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block mb-1">Risk Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block mb-1">Risk Type</label>
          <input value={riskType} onChange={(e) => setRiskType(e.target.value)} placeholder="e.g. Schedule, Scope, CSAT" className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block mb-1">Suggested Mitigation Steps</label>
          <textarea value={mitigation} onChange={(e) => setMitigation(e.target.value)} rows={2} className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2" />
        </div>
        {save.isError && <p className="text-[11px] text-red-500">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">Cancel</button>
          <button
            disabled={!project[0] || !description.trim() || save.isPending}
            onClick={() => save.mutate()}
            className="text-xs px-3.5 py-2 rounded-lg text-white font-medium disabled:opacity-40"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            Add risk
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add to spotlight ─────────────────────────────────────────────────────
function AddToSpotlightModal({
  projectOptions, onClose, onSaved,
}: {
  projectOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [project, setProject] = useState<string[]>([]);
  const save = useMutation({ mutationFn: () => api.governanceSaveSpotlight(project[0], {}), onSuccess: onSaved });

  return (
    <Modal title="Add project to this week's spotlight" onClose={onClose} widthClassName="max-w-md">
      <div className="p-5 space-y-4">
        <SearchableSelect options={projectOptions} value={project} onChange={setProject} placeholder="Select project…" />
        {save.isError && <p className="text-[11px] text-red-500">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">Cancel</button>
          <button
            disabled={!project[0] || save.isPending}
            onClick={() => save.mutate()}
            className="text-xs px-3.5 py-2 rounded-lg text-white font-medium disabled:opacity-40"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Spotlight table -- same JMAN dashed-border table format as RisksTable,
// matching the PPT's own "Top N Projects end to end Review" table shape
// (Project | DevOps Visibility | Milestone Visibility | Comments | Score
// Card | Action Plan). DevOps Visibility / Milestone Visibility / Comments
// are real, computed server-side every load, plain text -- only Score Card
// and Action Plan are manual, since those are genuine subjective judgment
// calls with no real data source.
function SpotlightTable({
  spotlight, onOpenProject, onSaved, onRemove, readOnly,
}: {
  spotlight: GovernanceSpotlightEntry[];
  onOpenProject: (code: string) => void;
  onSaved: () => void;
  onRemove: (projectCode: string) => void;
  readOnly?: boolean;
}) {
  const cellBorder = ROSE_CELL_BORDER;

  if (spotlight.length === 0) {
    return (
      <div className={ROSE_EMPTY_BOX}>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">No projects assigned to this cluster yet — assign some via "Manage assignment" above.</p>
      </div>
    );
  }

  return (
    <div className={ROSE_TABLE_WRAPPER}>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className={ROSE_HEADER_ROW}>
            <th className={cn(ROSE_HEADER_CELL, cellBorder)}>Project</th>
            <th className={cn(ROSE_HEADER_CELL, cellBorder)}>DevOps Visibility</th>
            <th className={cn(ROSE_HEADER_CELL, cellBorder)}>Milestone Visibility</th>
            <th className={cn(ROSE_HEADER_CELL, cellBorder)}>Comments</th>
            <th className={ROSE_HEADER_CELL}>Action Plan</th>
          </tr>
        </thead>
        <tbody>
          {spotlight.map((s) => (
            <SpotlightRow key={s.project_code} entry={s} onOpenProject={onOpenProject} onSaved={onSaved} onRemove={() => onRemove(s.project_code)} cellBorder={cellBorder} readOnly={readOnly} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpotlightRow({
  entry, onOpenProject, onSaved, onRemove, cellBorder, readOnly,
}: {
  entry: GovernanceSpotlightEntry;
  onOpenProject: (code: string) => void;
  onSaved: () => void;
  onRemove: () => void;
  cellBorder: string;
  readOnly?: boolean;
}) {
  const [actionPlan, setActionPlan] = useState(entry.action_plan ?? "");
  const dirty = actionPlan !== (entry.action_plan ?? "");
  const save = useMutation({
    mutationFn: () => api.governanceSaveSpotlight(entry.project_code, { action_plan: actionPlan || null }),
    onSuccess: onSaved,
  });

  return (
    <tr className="border-t border-dashed border-jman-rose/25 dark:border-jman-rose/20 align-top hover:bg-jman-rose-50/40 dark:hover:bg-jman-rose/5 transition-colors">
      <td className={cn("py-3 px-3 min-w-[9rem]", cellBorder)}>
        <div className="flex items-start justify-between gap-1">
          <button onClick={() => onOpenProject(entry.project_code)} className="text-xs font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors block">
            {entry.project_code}
          </button>
          {!readOnly && (
            <button onClick={onRemove} title="Remove from this week's spotlight" className="flex-shrink-0 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {entry.project_name && <span className="block text-[10px] text-gray-400 dark:text-gray-500 leading-snug mt-0.5">{entry.project_name}</span>}
        <div className="mt-1">{wsrBadge(entry.wsr_latest_signal)}</div>
      </td>
      <td className={cn("py-3 px-3 text-gray-600 dark:text-gray-400 leading-relaxed min-w-[12rem] max-w-xs", cellBorder)}>{entry.devops_visibility}</td>
      <td className={cn("py-3 px-3 text-gray-600 dark:text-gray-400 leading-relaxed min-w-[14rem] max-w-sm", cellBorder)}>
        {entry.milestone_facts.length > 0 ? (
          <ul className="list-disc list-inside space-y-0.5">
            {entry.milestone_facts.map((f) => <li key={f}>{f}</li>)}
          </ul>
        ) : (
          "No real delivery signals on record."
        )}
      </td>
      <td className={cn("py-3 px-3 text-gray-600 dark:text-gray-400 leading-relaxed min-w-[14rem] max-w-sm", cellBorder)}>
        {entry.comments ?? "AI-generated summary unavailable right now."}
      </td>
      <td className="py-2 px-3 min-w-[10rem]">
        {readOnly ? (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{entry.action_plan || "—"}</p>
        ) : (
          <>
            <textarea
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
              rows={2}
              className="w-full text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1.5"
            />
            {dirty && (
              <button onClick={() => save.mutate()} disabled={save.isPending} className="mt-1 text-[10px] font-medium text-primary hover:underline disabled:opacity-40">
                {save.isPending ? "Saving…" : "Save"}
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

// ── Kick-off this week ───────────────────────────────────────────────────
const TRI_OPTIONS: { value: "yes" | "no" | "pending"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

function TriSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "text-[11px] rounded-md border px-1.5 py-1 bg-white dark:bg-gray-800 disabled:opacity-60",
        value === "yes" ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400" :
        value === "no" ? "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400" :
        "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
      )}
    >
      {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function KickoffSection({
  entries, onOpenProject, onSaved, readOnly,
}: {
  entries: GovernanceKickoffEntry[];
  onOpenProject: (code: string) => void;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const save = useMutation({
    mutationFn: (vars: { code: string; fields: Partial<Record<"kickoff_completed" | "scope_approved" | "devops_setup", string>> }) =>
      api.governanceSaveKickoffTracking(vars.code, vars.fields),
    onSuccess: onSaved,
  });

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200">Projects Kick Off — This Week</h3>
      {entries.length === 0 ? (
        <div className={ROSE_EMPTY_BOX}>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">No projects scheduled to start this week.</p>
        </div>
      ) : (
        <div className={ROSE_TABLE_WRAPPER}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className={ROSE_HEADER_ROW}>
                <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Project</th>
                <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Kick Off</th>
                <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Scope Approved</th>
                <th className={ROSE_HEADER_CELL}>DevOps Setup</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.project_code} className={ROSE_ROW}>
                  <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>
                    <button onClick={() => onOpenProject(e.project_code)} className="text-xs font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors block">{e.project_code}</button>
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{e.project_start_date}</span>
                  </td>
                  <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}><TriSelect value={e.kickoff_completed} onChange={(v) => save.mutate({ code: e.project_code, fields: { kickoff_completed: v } })} disabled={readOnly} /></td>
                  <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}><TriSelect value={e.scope_approved} onChange={(v) => save.mutate({ code: e.project_code, fields: { scope_approved: v } })} disabled={readOnly} /></td>
                  <td className="py-3 px-3"><TriSelect value={e.devops_setup} onChange={(v) => save.mutate({ code: e.project_code, fields: { devops_setup: v } })} disabled={readOnly} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Ending / extending this week ─────────────────────────────────────────
function EndingSection({ entries, onOpenProject }: { entries: GovernanceEndingEntry[]; onOpenProject: (code: string) => void }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200">Projects Ending / Extending — This Week</h3>
      {entries.length === 0 ? (
        <div className={ROSE_EMPTY_BOX}>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">No projects scheduled to end this week.</p>
        </div>
      ) : (
        <div className={ROSE_TABLE_WRAPPER}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className={ROSE_HEADER_ROW}>
                <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Project</th>
                <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Scheduled</th>
                <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Actual</th>
                <th className={ROSE_HEADER_CELL}>Delivery Risk</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.project_code} className={ROSE_ROW}>
                  <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>
                    <button onClick={() => onOpenProject(e.project_code)} className="text-xs font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors block">{e.project_code}</button>
                  </td>
                  <td className={cn("py-3 px-3 text-gray-500 dark:text-gray-400", ROSE_CELL_BORDER)}>{e.scheduled_end_date ?? "—"}</td>
                  <td className={cn("py-3 px-3 text-gray-500 dark:text-gray-400", ROSE_CELL_BORDER)}>{e.actual_end_date ?? "—"}</td>
                  <td className="py-3 px-3 text-gray-500 dark:text-gray-400">
                    {e.open_risks.length > 0 ? e.open_risks.map((r) => r.risk_description).join("; ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── WSR Status ────────────────────────────────────────────────────────────
// Real PM-confirmed hygiene checkboxes -- only ever appear as "confirmed
// true" in the real data (no row has ever recorded a confirmed-false), so
// only render the ones that are true; a missing flag says nothing (most
// projects simply don't have this tracked), not "not done".
const HYGIENE_LABELS: { key: "jin_allocations_updated" | "team_timesheets_submitted" | "devops_updated"; label: string }[] = [
  { key: "jin_allocations_updated", label: "JIN allocations" },
  { key: "team_timesheets_submitted", label: "Timesheets" },
  { key: "devops_updated", label: "DevOps board" },
];

function HygieneBadges({ entry }: { entry: GovernanceWsrEntry }) {
  const confirmed = HYGIENE_LABELS.filter((h) => entry[h.key]);
  if (confirmed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {confirmed.map((h) => (
        <span
          key={h.key}
          title="Most recent confirmation on record for this project — not necessarily this week's WSR, since this flag is rarely filled in"
          className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
        >
          ✓ {h.label} updated (on record)
        </span>
      ))}
    </div>
  );
}

function WsrRow({ entry, onOpenProject }: { entry: GovernanceWsrEntry; onOpenProject: (code: string) => void }) {
  // risk_note is WSR's own real free-text field (see map_wsr_table) and is
  // the one that's actually ever populated -- `comment` coalesces 4 source
  // columns that are 100% empty in the real data, so it's kept only as a
  // fallback for whenever JDWH does start sending it.
  const noteText = entry.risk_note ?? entry.comment ?? "—";
  return (
    <tr className={ROSE_ROW}>
      <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>
        <button onClick={() => onOpenProject(entry.project_code)} className="text-xs font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors">{entry.project_code}</button>
      </td>
      <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>{entry.scope_status && <Badge variant={entry.scope_status.toLowerCase()}>{entry.scope_status}</Badge>}</td>
      <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>{entry.schedule_status && <Badge variant={entry.schedule_status.toLowerCase()}>{entry.schedule_status}</Badge>}</td>
      <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>{entry.quality_status && <Badge variant={entry.quality_status.toLowerCase()}>{entry.quality_status}</Badge>}</td>
      <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>{entry.csat_status && <Badge variant={entry.csat_status.toLowerCase()}>{entry.csat_status}</Badge>}</td>
      <td className={cn("py-3 px-3", ROSE_CELL_BORDER)}>{entry.team_status && <Badge variant={entry.team_status.toLowerCase()}>{entry.team_status}</Badge>}</td>
      <td className="py-3 px-3 text-gray-600 dark:text-gray-400 leading-relaxed min-w-[14rem] max-w-sm">
        {noteText}
        <HygieneBadges entry={entry} />
      </td>
    </tr>
  );
}

function WsrStatusSection({
  wsrStatus, onOpenProject,
}: {
  wsrStatus: { RED: GovernanceWsrEntry[]; AMBER: GovernanceWsrEntry[]; GREEN: GovernanceWsrEntry[]; no_report: GovernanceWsrEntry[] };
  onOpenProject: (code: string) => void;
}) {
  const groups: { key: "RED" | "AMBER" | "GREEN"; label: string }[] = [
    { key: "RED", label: "WSR Status — Red" },
    { key: "AMBER", label: "WSR Status — Amber" },
    { key: "GREEN", label: "WSR Status — Green" },
  ];
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-4">
      <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200">WSR Status <span className="font-normal text-gray-400">(live, latest report per project)</span></h3>
      {groups.map(({ key, label }) =>
        wsrStatus[key].length > 0 ? (
          <div key={key}>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{label}</p>
            <div className={ROSE_TABLE_WRAPPER}>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className={ROSE_HEADER_ROW}>
                    <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Project</th>
                    <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Scope</th>
                    <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Schedule</th>
                    <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Quality</th>
                    <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>CSAT</th>
                    <th className={cn(ROSE_HEADER_CELL, ROSE_CELL_BORDER)}>Team</th>
                    <th className={ROSE_HEADER_CELL}>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {wsrStatus[key].map((e) => <WsrRow key={e.project_code} entry={e} onOpenProject={onOpenProject} />)}
                </tbody>
              </table>
            </div>
          </div>
        ) : null
      )}
      {wsrStatus.no_report.length > 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          No WSR data: {wsrStatus.no_report.map((e) => e.project_code).join(", ")}
        </p>
      )}
      {groups.every(({ key }) => wsrStatus[key].length === 0) && wsrStatus.no_report.length === 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">No WSR reports for this cluster's projects yet.</p>
      )}
    </section>
  );
}

// ── Cluster Summary -- 3-4 AI highlight bullet points grounded strictly in
// the real aggregates from every section below (risks, spotlight, kick-off/
// ending, WSR counts) -- what a Resource Manager reads aloud to OPEN this
// cluster's discussion on the call, so it sits at the top of the page,
// right under the header. Background matches this cluster's own ball color
// (same CLUSTER_COLORS used for the circles at the top of the Health page)
// so each cluster's summary reads as visually "that cluster's" the moment
// you land on it, rather than one shared color for all five.
function ClusterSummarySection({ clusterNumber, points }: { clusterNumber: number; points: string[] | null }) {
  return (
    <section className={cn("rounded-xl text-white p-4 sm:p-5 shadow-sm", CLUSTER_COLORS[clusterNumber] ?? "bg-gray-500")}>
      <div className="flex items-start gap-2.5">
        <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5 opacity-90" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80 mb-1.5">Cluster Summary</p>
          {points && points.length > 0 ? (
            <ul className="space-y-1">
              {points.map((point) => (
                <li key={point} className="text-xs leading-relaxed flex items-start gap-1.5">
                  <span className="opacity-70 mt-0.5">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed opacity-90">
              AI-generated summary unavailable right now (no AI provider responded) -- see the sections below for the real underlying detail.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
