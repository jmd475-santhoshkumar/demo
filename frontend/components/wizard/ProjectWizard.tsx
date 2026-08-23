"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/shared/Modal";
import { Stepper, type StepDef } from "@/components/shared/Stepper";
import { Step1ProjectInformation, type WizardProject } from "@/components/wizard/Step1ProjectInformation";
import { Step2ProjectGDPR } from "@/components/wizard/Step2ProjectGDPR";
import { Step3BudgetCreation } from "@/components/wizard/Step3BudgetCreation";
import { Step4SOWCreation } from "@/components/wizard/Step4SOWCreation";
import { Step5ResourceAllocation } from "@/components/wizard/Step5ResourceAllocation";
import { Step6ProjectKickOff } from "@/components/wizard/Step6ProjectKickOff";
import type { ProfileTab, SkillMatchContext } from "@/components/shared/EmployeeProfileModal";

const STEPS: StepDef[] = [
  { step: 1, label: "Project Information" },
  { step: 2, label: "Project GDPR" },
  { step: 3, label: "Budget Creation" },
  { step: 4, label: "SOW Creation" },
  { step: 5, label: "Resource Allocation" },
  { step: 6, label: "Project KickOff" },
];

export function ProjectWizard({
  initialDealKey,
  onExit,
  onOpenProfile,
}: {
  initialDealKey: string | null;
  onExit: () => void;
  onOpenProfile: (employeeId: string, tab: ProfileTab, skillMatchContext?: SkillMatchContext) => void;
}) {
  const deals = useQuery({ queryKey: ["deals"], queryFn: api.listDeals });

  // Durable resolution: does this deal already have a project linked from a
  // previous visit (any session, survives a refresh)? If so, skip straight to
  // Step 5 with that project already loaded instead of re-offering Step 1's
  // "create a project" form for a deal that's already been through it.
  const dealLink = useQuery({
    queryKey: ["deal-project-link", initialDealKey],
    queryFn: () => api.getDealProjectLink(initialDealKey as string),
    enabled: initialDealKey != null,
  });
  const existingProjectCode = dealLink.data?.project_code ?? null;
  const existingProjectInfo = useQuery({
    queryKey: ["project-info-for-wizard", existingProjectCode],
    queryFn: () => api.projectInfo(existingProjectCode as string),
    enabled: existingProjectCode != null,
  });

  const [wizardStep, setWizardStep] = useState(1);
  const [wizardProject, setWizardProject] = useState<WizardProject | null>(null);
  const [linkedDealKey, setLinkedDealKey] = useState<string | null>(initialDealKey);
  const [isBillableDefault, setIsBillableDefault] = useState(true);
  const [savedSteps, setSavedSteps] = useState<Set<number>>(new Set());
  const [resolvedInitial, setResolvedInitial] = useState(false);
  // Set when Step 1 saves a real end-date change on an already-existing project
  // -- prompts whether to carry its active allocations forward into the new
  // period (Step 5 does the actual cloning once `cloneSignal` is set).
  const [pendingExtension, setPendingExtension] = useState<{ oldEndDate: string; newEndDate: string } | null>(null);
  const [cloneSignal, setCloneSignal] = useState<{ oldEndDate: string; newEndDate: string } | null>(null);

  useEffect(() => {
    if (resolvedInitial) return;
    if (initialDealKey == null) { setResolvedInitial(true); return; }
    if (dealLink.isLoading) return;
    if (existingProjectCode == null) { setResolvedInitial(true); return; }
    if (existingProjectInfo.isLoading) return;
    if (existingProjectInfo.data) {
      const info = existingProjectInfo.data;
      setWizardProject({
        code: info.project_code, clientId: info.client_id ?? "",
        startDate: info.project_start_date ?? "", endDate: info.project_end_date ?? "",
      });
      setSavedSteps((prev) => new Set(prev).add(1));
      setWizardStep(5);
      setResolvedInitial(true);
      return;
    }
    // The deal was linked to a project_code that no longer resolves to a real
    // project (404) -- a stale/broken link, e.g. left over from before a real
    // data reload replaced the project table. Without this branch, resolving
    // never happens: existingProjectInfo.data stays undefined forever on an
    // error, so the wizard was stuck on "Loading this deal's project..."
    // permanently instead of falling through to a normal Step 1 (confirmed:
    // this is exactly what happened for deals linked to KIA_001/TES_001/
    // POR_001, none of which exist in the current real project data).
    if (existingProjectInfo.isError) { setResolvedInitial(true); }
  }, [initialDealKey, dealLink.isLoading, existingProjectCode, existingProjectInfo.data, existingProjectInfo.isLoading, existingProjectInfo.isError, resolvedInitial]);

  function markSaved(step: number) {
    setSavedSteps((prev) => new Set(prev).add(step));
  }
  function goTo(step: number) {
    setWizardStep(step);
  }
  function next(fromStep: number) {
    markSaved(fromStep);
    setWizardStep(Math.min(6, fromStep + 1));
  }

  const deal = deals.data?.find((d) => d.deal_key === linkedDealKey) ?? null;
  const projectDates = wizardProject ? { startDate: wizardProject.startDate, endDate: wizardProject.endDate } : null;
  const projectLabel = wizardProject
    ? `${wizardProject.code} / ${deal?.solution ?? deal?.roles[0]?.resources_requested ?? wizardProject.clientId}`
    : "";

  if (initialDealKey != null && !resolvedInitial) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <button onClick={onExit} className="hover:text-primary hover:underline">← Back to Resourcing</button>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-10 text-center text-xs text-gray-400 dark:text-gray-500">
          Loading this deal&apos;s project…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <button onClick={onExit} className="hover:text-primary hover:underline">← Back to Resourcing</button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2">
        <Stepper steps={STEPS} currentStep={wizardStep} completedSteps={savedSteps} onStepClick={goTo} />
      </div>

      {/* Every step stays mounted once reached -- toggled via `hidden`, not
          conditional unmounting -- so switching steps (now free navigation,
          see Stepper) never wipes out what's already been typed/selected on
          a step you're not currently looking at. */}
      <div className={cn(wizardStep === 1 ? "" : "hidden")}>
        <Step1ProjectInformation
          initialDealKey={initialDealKey}
          wizardProject={wizardProject}
          onLinked={(project, meta) => {
            setWizardProject(project);
            setLinkedDealKey(meta.dealKey);
            setIsBillableDefault(meta.isBillable);
            markSaved(1);
          }}
          onNext={() => setWizardStep(2)}
          onExtended={(oldEndDate, newEndDate) => setPendingExtension({ oldEndDate, newEndDate })}
        />
      </div>

      <div className={cn(wizardStep === 2 ? "" : "hidden")}>
        <Step2ProjectGDPR projectCode={wizardProject?.code ?? null} onNext={() => next(2)} />
      </div>

      <div className={cn(wizardStep === 3 ? "" : "hidden")}>
        <Step3BudgetCreation
          projectCode={wizardProject?.code ?? null}
          projectLabel={projectLabel}
          defaultStartDate={wizardProject?.startDate ?? ""}
          defaultEndDate={wizardProject?.endDate ?? ""}
          defaultIsBillable={isBillableDefault}
          deal={deal}
          // Skips Step 4 (SOW Creation) -- saving the budget already staffs
          // the project (see autoAssignFromBudget), so the RM should land
          // straight on Resource Allocation to see the result, not pause on
          // an unrelated step in between.
          onNext={() => { markSaved(3); setWizardStep(5); }}
        />
      </div>

      <div className={cn(wizardStep === 4 ? "" : "hidden")}>
        <Step4SOWCreation projectCode={wizardProject?.code ?? null} onNext={() => next(4)} />
      </div>

      <div className={cn("space-y-4", wizardStep === 5 ? "" : "hidden")}>
        <Step5ResourceAllocation
          projectCode={wizardProject?.code ?? null}
          projectDates={projectDates}
          deal={deal}
          onOpenProfile={onOpenProfile}
          cloneSignal={cloneSignal}
          onCloneApplied={() => setCloneSignal(null)}
        />
        <div className="flex justify-end">
          <button onClick={() => next(5)} className="text-xs px-4 py-2 rounded-lg text-white font-medium" style={{ backgroundColor: "hsl(var(--primary))" }}>
            Next
          </button>
        </div>
      </div>

      <div className={cn(wizardStep === 6 ? "" : "hidden")}>
        <Step6ProjectKickOff projectCode={wizardProject?.code ?? null} onSave={() => markSaved(6)} />
      </div>

      {pendingExtension && (
        <Modal title="Extend allocations too?" onClose={() => setPendingExtension(null)} widthClassName="max-w-md">
          <div className="p-5 space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              This project&apos;s end date changed to <strong>{pendingExtension.newEndDate}</strong>. Clone its
              currently active allocations forward to cover the extended period? You&apos;ll still be able to
              review and edit every row (or dismiss it) in Resource Allocation before assigning.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingExtension(null)}
                className="text-xs px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Skip
              </button>
              <button
                onClick={() => { setCloneSignal(pendingExtension); setPendingExtension(null); }}
                className="text-xs px-3.5 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: "hsl(var(--primary))" }}
              >
                Clone allocations
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
