"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { PreferredSkillsTable } from "@/components/shared/PreferredSkillsTable";
import { SowSkillsPanel } from "@/components/shared/SowSkillsPanel";
import {
  PROJECT_TYPE_OPTIONS, PROJECT_STATUS_OPTIONS, PROPOSITION_COE_OPTIONS,
} from "@/lib/projectConstants";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function addWeeksToDate(dateStr: string, weeks: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
function weeksBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(ms / (7 * 24 * 60 * 60 * 1000)));
}

export interface WizardProject {
  code: string;
  clientId: string;
  startDate: string;
  endDate: string;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
        {label}
        {required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:border-[hsl(var(--primary))]";
const uppercaseInputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm uppercase outline-none focus:border-[hsl(var(--primary))]";

export function Step1ProjectInformation({
  initialDealKey,
  wizardProject,
  onLinked,
  onNext,
  onExtended,
}: {
  initialDealKey: string | null;
  wizardProject: WizardProject | null;
  onLinked: (project: WizardProject, meta: { dealKey: string | null; isBillable: boolean }) => void;
  onNext: () => void;
  onExtended?: (oldEndDate: string, newEndDate: string) => void;
}) {
  const deals = useQuery({ queryKey: ["deals"], queryFn: api.listDeals });
  const clients = useQuery({ queryKey: ["project-clients"], queryFn: api.listProjectClients });
  const employees = useQuery({ queryKey: ["employees-list"], queryFn: api.employeesList });
  const roleMixCoes = useQuery({ queryKey: ["role-mix-coes"], queryFn: api.roleMixCoes });
  // Re-fetched whenever a project already exists so revisiting this step
  // (Stepper now allows jumping anywhere) shows what was actually saved,
  // pre-filled and still editable -- not a dead-end confirmation banner.
  const projectInfo = useQuery({
    queryKey: ["project-info", wizardProject?.code],
    queryFn: () => api.projectInfo(wizardProject!.code),
    enabled: wizardProject != null,
  });
  const [loadedForCode, setLoadedForCode] = useState<string | null>(null);

  const [selectedDealKeys, setSelectedDealKeys] = useState<string[]>(initialDealKey ? [initialDealKey] : []);
  const selectedDealKey = selectedDealKeys[0] ?? null;
  const selectedDeal = deals.data?.find((d) => d.deal_key === selectedDealKey) ?? null;

  const [manualClientIds, setManualClientIds] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [typeOfProjects, setTypeOfProjects] = useState<string[]>([PROJECT_TYPE_OPTIONS[0]]);
  const [projectStatuses, setProjectStatuses] = useState<string[]>([PROJECT_STATUS_OPTIONS[0]]);
  // Tech/Proposition COE are genuinely multi-value in this app's real data --
  // the CSV's own tech_coe column already stores semicolon-joined combos for
  // projects spanning more than one COE.
  const [techCoes, setTechCoes] = useState<string[]>([]);
  const [propositionCoes, setPropositionCoes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(selectedDeal?.earliest_start ?? todayStr());
  const [endDate, setEndDate] = useState(addWeeksToDate(selectedDeal?.earliest_start ?? todayStr(), 12));
  // Snapshot of the end date as last loaded from the server -- compared against
  // the editable `endDate` on save to detect a real extension (not set until the
  // sync-once effect below actually loads a saved project, so an empty value
  // never falsely looks like an extension).
  const [initialEndDate, setInitialEndDate] = useState("");
  const [projectNameA, setProjectNameA] = useState("");
  const [projectNameB, setProjectNameB] = useState("");
  const [accountManagers, setAccountManagers] = useState<string[]>([]);
  const [engagementManagers, setEngagementManagers] = useState<string[]>([]);
  const [projectManagers, setProjectManagers] = useState<string[]>([]);
  const [surveyRequired, setSurveyRequired] = useState(true);
  const [isBillable, setIsBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clientId = selectedDeal?.client || manualClientIds[0] || "";
  const weeks = weeksBetween(startDate, endDate);

  // Sync local form state from the backend exactly once per project code --
  // after that, further edits here are the user's, not something a refetch
  // should silently overwrite.
  useEffect(() => {
    if (!wizardProject || !projectInfo.data || loadedForCode === wizardProject.code) return;
    const info = projectInfo.data;
    setTypeOfProjects(info.type_of_project ? [info.type_of_project] : [PROJECT_TYPE_OPTIONS[0]]);
    setProjectStatuses(info.project_status ? [info.project_status] : [PROJECT_STATUS_OPTIONS[0]]);
    setTechCoes(info.tech_coe ? info.tech_coe.split("; ").filter(Boolean) : []);
    setPropositionCoes(info.proposition_coe ? info.proposition_coe.split("; ").filter(Boolean) : []);
    if (info.client_id) setManualClientIds([info.client_id]);
    if (info.project_start_date) setStartDate(info.project_start_date);
    if (info.project_end_date) { setEndDate(info.project_end_date); setInitialEndDate(info.project_end_date); }
    setCode(wizardProject.code);
    setCodeTouched(true);
    setLoadedForCode(wizardProject.code);
  }, [wizardProject, projectInfo.data, loadedForCode]);

  const dealOptions = (deals.data ?? []).map((d) => ({
    value: d.deal_key,
    label: `${d.client ?? "Unknown client"} — ${d.solution ?? d.roles[0]?.resources_requested ?? "Deal"}`,
  }));
  const clientOptions = (clients.data ?? []).map((c) => ({ value: c, label: c }));
  const employeeOptions = (employees.data ?? []).map((e) => ({ value: e.employee_id, label: `${e.employee_id} (${e.job_name})` }));
  const coeOptions = (roleMixCoes.data ?? []).map((c) => ({ value: c.coe, label: c.coe }));
  const propositionCoeOptions = PROPOSITION_COE_OPTIONS.map((c) => ({ value: c, label: c }));

  async function ensureCode() {
    if (codeTouched && code) return code;
    const r = await api.suggestProjectCode(clientId || projectNameA || "New Project");
    setCode(r.suggested_code);
    setCodeTouched(true);
    return r.suggested_code;
  }

  async function submit() {
    setError(null);
    if (!clientId) { setError("Pick a Primary Opportunity or a Client."); return; }
    setSubmitting(true);
    try {
      if (wizardProject) {
        // Edit mode -- this project already exists, update its fields in
        // place rather than trying to create a second one under the same code.
        const updated = await api.updateProject(wizardProject.code, {
          clientId,
          typeOfProject: typeOfProjects[0] ?? PROJECT_TYPE_OPTIONS[0],
          startDate, endDate,
          techCoe: techCoes.length ? techCoes.join("; ") : null,
          propositionCoe: propositionCoes.length ? propositionCoes.join("; ") : null,
          projectStatus: projectStatuses[0] ?? PROJECT_STATUS_OPTIONS[0],
        });
        onLinked(
          { code: updated.project_code, clientId: updated.client_id, startDate: updated.project_start_date, endDate: updated.project_end_date },
          { dealKey: selectedDealKey, isBillable }
        );
        if (initialEndDate && endDate !== initialEndDate) onExtended?.(initialEndDate, endDate);
        onNext();
      } else {
        const finalCode = await ensureCode();
        const { exists } = await api.projectCodeExists(finalCode);
        if (exists) { setError(`Project code "${finalCode}" already exists — edit it to something unused.`); return; }
        const created = await api.createProject({
          projectCode: finalCode, clientId,
          typeOfProject: typeOfProjects[0] ?? PROJECT_TYPE_OPTIONS[0],
          startDate, endDate,
          techCoe: techCoes.length ? techCoes.join("; ") : null,
          propositionCoe: propositionCoes.length ? propositionCoes.join("; ") : null,
          projectStatus: projectStatuses[0] ?? PROJECT_STATUS_OPTIONS[0],
        });
        // Durable so re-opening this deal's wizard later (even a fresh
        // session, after a refresh) resumes here with this project loaded
        // instead of offering to create a second one for the same deal.
        if (selectedDealKey) await api.linkDealToProject(selectedDealKey, created.project_code);
        onLinked(
          { code: created.project_code, clientId: created.client_id, startDate: created.project_start_date, endDate: created.project_end_date },
          { dealKey: selectedDealKey, isBillable }
        );
        onNext();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this project.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Fill up the Project Information</p>
        {wizardProject && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60">
            Saved as {wizardProject.code} — editable below
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Project Type" required>
          <SearchableSelect options={PROJECT_TYPE_OPTIONS.map((t) => ({ value: t, label: t }))} value={typeOfProjects} onChange={setTypeOfProjects} />
        </Field>
        <Field label="Primary Opportunity" required>
          <SearchableSelect
            options={dealOptions}
            value={selectedDealKeys}
            onChange={(v) => {
              setSelectedDealKeys(v);
              const d = deals.data?.find((x) => x.deal_key === v[0]);
              if (d?.earliest_start) { setStartDate(d.earliest_start); setEndDate(addWeeksToDate(d.earliest_start, weeks || 12)); }
            }}
            placeholder="-- No opportunity (manual project) --"
          />
        </Field>
        <Field label="Client Name" required>
          {selectedDeal ? (
            <input className={inputCls} value={selectedDeal.client ?? ""} disabled />
          ) : (
            <SearchableSelect options={clientOptions} value={manualClientIds} onChange={setManualClientIds} />
          )}
        </Field>
        <Field label="Project Code">
          <input
            className={uppercaseInputCls} value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }}
            onFocus={() => { if (!codeTouched) ensureCode(); }}
            placeholder="Auto-suggested on save"
          />
        </Field>

        <Field label="Project Name">
          <input className={inputCls} value={projectNameA} onChange={(e) => setProjectNameA(e.target.value)} placeholder="Not saved to the project record yet" />
        </Field>
        <Field label="">
          <input className={inputCls} value={projectNameB} onChange={(e) => setProjectNameB(e.target.value)} placeholder="(phase / sub-name)" />
        </Field>
        <Field label="Project Start Date">
          <input type="date" className={inputCls} value={startDate} onChange={(e) => { setStartDate(e.target.value); }} />
        </Field>
        <Field label="Project End Date">
          <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>

        <Field label="Project Length (weeks)">
          <input className={inputCls} value={weeks} disabled />
        </Field>
        <Field label="Account Manager">
          <SearchableSelect options={employeeOptions} value={accountManagers} onChange={setAccountManagers} />
        </Field>
        <Field label="Engagement Manager">
          <SearchableSelect options={employeeOptions} value={engagementManagers} onChange={setEngagementManagers} />
        </Field>
        <Field label="Project Manager">
          <SearchableSelect options={employeeOptions} value={projectManagers} onChange={setProjectManagers} />
        </Field>

        <Field label="Tech COE" required>
          <SearchableSelect options={coeOptions} value={techCoes} onChange={setTechCoes} multi />
        </Field>
        <Field label="Solution COE">
          <SearchableSelect options={propositionCoeOptions} value={propositionCoes} onChange={setPropositionCoes} multi />
        </Field>
        <Field label="Project Status" required>
          <SearchableSelect options={PROJECT_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} value={projectStatuses} onChange={setProjectStatuses} />
        </Field>
      </div>

      {selectedDeal && selectedDeal.roles.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3.5 space-y-3 dark:border-gray-700 dark:bg-gray-900">
          <SowSkillsPanel projectCode={wizardProject?.code} />
          <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="text-xs font-semibold text-gray-700 mb-2 dark:text-gray-300">
              Preferred skills for this project
              {selectedDeal.roles.length > 1 && <span className="font-normal text-gray-400 dark:text-gray-500"> ({selectedDeal.roles.length} roles)</span>}
            </p>
            <PreferredSkillsTable
              roles={selectedDeal.roles.map((role) => ({
                rowIndex: role.row_index,
                roleLabel: role.resources_requested ?? "Role TBD",
                requestedPct: role.requested_pct,
              }))}
            />
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Cluster, Coverage Location and DevOps Board aren&apos;t tracked in ResourceIQ (no backing data for these yet), so they&apos;re
        omitted here rather than shown with made-up options. Project Name and Account/Engagement/Project Manager aren&apos;t persisted
        to the project record yet either — they&apos;re captured for this session only.
      </p>

      <div className="flex items-center gap-5 text-xs text-gray-600 dark:text-gray-400">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={surveyRequired} onChange={(e) => setSurveyRequired(e.target.checked)} /> Survey Required
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} /> Is Billable
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {submitting ? "Saving…" : wizardProject ? "Update & Next" : "Save & Next"}
        </button>
      </div>
    </div>
  );
}
