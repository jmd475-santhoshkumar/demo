"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { IncludeParams } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ADVANCED_PARAMS, isNonDefaultParams } from "@/components/shared/candidateFilters";

// Shared "Advanced Filters" control -- the exact same ranking-parameter panel
// used on the Resourcing page, reused verbatim everywhere else a
// candidate list is ranked (Leave backfill, Employee Profile Replacement/
// Redeploy tabs, Relief Staffing, New Project forecast). One definition, one
// behavior, everywhere.

export function AdvancedFiltersButton({
  open, include, defaults, includeBelowCapacity, includeResumeLinkedin, onClick,
}: {
  open: boolean;
  include: IncludeParams;
  defaults: IncludeParams;
  includeBelowCapacity?: boolean;
  // Opt-in, like includeBelowCapacity -- only pass this when the caller has
  // actually wired the flag through to its data fetch, so the badge/checkbox
  // never implies a control that would silently do nothing.
  includeResumeLinkedin?: boolean;
  onClick: () => void;
}) {
  const activeCount = Object.values(include).filter(Boolean).length;
  const resumeLinkedinOff = includeResumeLinkedin === false;
  const nonDefault = isNonDefaultParams(include, defaults) || !!includeBelowCapacity || resumeLinkedinOff;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border-2 whitespace-nowrap transition",
        open || nonDefault ? "border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40" : "border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400"
      )}
      title="Choose exactly which parameters (skill, competency, availability, category match, project count) shape the ranking"
    >
      <SlidersHorizontal className="w-3 h-3" />
      Advanced{nonDefault && ` (${activeCount}/${ADVANCED_PARAMS.length}${includeBelowCapacity ? "+pool" : ""}${resumeLinkedinOff ? " · no resume/LinkedIn" : ""})`}
      <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
    </button>
  );
}

// Inline dropdown, not a modal -- opens/closes exactly like the Filters panel.
// Each parameter is its own checkbox; any combination can be applied, including
// turning off any of the defaults. At least one must stay checked (enforced
// below) since a fully-empty selection has nothing to rank by. Checking a box
// only stages a draft choice; nothing re-ranks until "Apply" is clicked.
export function AdvancedFiltersPanel({
  include,
  onApply,
  includeBelowCapacity,
  onApplyBelowCapacity,
  nearCapacityTolerancePct,
  onApplyNearCapacityTolerancePct,
  includeResumeLinkedin,
  onApplyIncludeResumeLinkedin,
}: {
  include: IncludeParams;
  onApply: (v: IncludeParams) => void;
  // Optional: the "candidate pool" gate (separate from ranking weights above).
  includeBelowCapacity?: boolean;
  onApplyBelowCapacity?: (v: boolean) => void;
  // How many points below requested % still counts as "near enough" -- fully
  // adjustable, paired with includeBelowCapacity in the same panel section.
  nearCapacityTolerancePct?: number;
  onApplyNearCapacityTolerancePct?: (v: number) => void;
  // Optional, opt-in like includeBelowCapacity: whether resume/LinkedIn-derived
  // skill & competency rows (see resume_skill_service.py) feed the match at
  // all. Defaults to true (on) wherever the caller wires this through.
  includeResumeLinkedin?: boolean;
  onApplyIncludeResumeLinkedin?: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState<IncludeParams>(include);
  const [draftBelowCapacity, setDraftBelowCapacity] = useState(includeBelowCapacity ?? false);
  const [draftTolerance, setDraftTolerance] = useState(nearCapacityTolerancePct ?? 25);
  const [draftResumeLinkedin, setDraftResumeLinkedin] = useState(includeResumeLinkedin ?? true);
  // Stay in sync if applied state changes from outside (e.g. a row/deal change
  // resets it) so the draft never silently disagrees with reality.
  useEffect(() => {
    setDraft(include);
  }, [include]);
  useEffect(() => {
    setDraftBelowCapacity(includeBelowCapacity ?? false);
  }, [includeBelowCapacity]);
  useEffect(() => {
    setDraftTolerance(nearCapacityTolerancePct ?? 25);
  }, [nearCapacityTolerancePct]);
  useEffect(() => {
    setDraftResumeLinkedin(includeResumeLinkedin ?? true);
  }, [includeResumeLinkedin]);

  const draftCount = Object.values(draft).filter(Boolean).length;
  const isDirty =
    ADVANCED_PARAMS.some((p) => draft[p.key] !== include[p.key]) ||
    draftBelowCapacity !== (includeBelowCapacity ?? false) ||
    draftTolerance !== (nearCapacityTolerancePct ?? 25) ||
    draftResumeLinkedin !== (includeResumeLinkedin ?? true);
  const appliedLabels = ADVANCED_PARAMS.filter((p) => include[p.key]).map((p) => p.label);
  const totalWeight = ADVANCED_PARAMS.filter((p) => draft[p.key]).reduce((sum, p) => sum + p.weightPct, 0);

  const toggle = (key: keyof IncludeParams, checked: boolean) => {
    // Refuse to uncheck the last remaining parameter -- nothing left to rank by.
    if (!checked && draftCount <= 1) return;
    setDraft((prev) => ({ ...prev, [key]: checked }));
  };

  const apply = () => {
    onApply(draft);
    if (onApplyBelowCapacity) onApplyBelowCapacity(draftBelowCapacity);
    if (onApplyNearCapacityTolerancePct) onApplyNearCapacityTolerancePct(draftTolerance);
    if (onApplyIncludeResumeLinkedin) onApplyIncludeResumeLinkedin(draftResumeLinkedin);
  };

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20 p-2.5 space-y-3">
      <div className="space-y-2.5">
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Ranking parameters — select any (at least one)</p>
        {ADVANCED_PARAMS.map((p) => (
          <label key={p.key} className={cn("flex items-start gap-2.5", draftCount <= 1 && draft[p.key] ? "cursor-not-allowed opacity-70" : "cursor-pointer")}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft[p.key]}
              onChange={(e) => toggle(p.key, e.target.checked)}
            />
            <span className="flex-1">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.label}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1.5">
                ({draft[p.key] && totalWeight > 0 ? `${Math.round((p.weightPct / totalWeight) * 100)}% of ranking` : `base ${p.weightPct}%`})
              </span>
              {p.description && <span className="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{p.description}</span>}
            </span>
          </label>
        ))}
      </div>
      {onApplyBelowCapacity && (
        <div className="pt-2 border-t border-amber-100 dark:border-amber-800/60 space-y-3">
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Candidate pool — not a ranking weight</p>
          <div>
            <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">
              Near-capacity tolerance: <span className="font-semibold text-gray-700 dark:text-gray-300">{draftTolerance} points</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={draftTolerance}
              onChange={(e) => setDraftTolerance(Number(e.target.value))}
              className="w-full h-1 accent-primary"
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draftBelowCapacity}
              onChange={(e) => setDraftBelowCapacity(e.target.checked)}
            />
            <span className="flex-1">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Include candidates below requested capacity</span>
            </span>
          </label>
        </div>
      )}
      {onApplyIncludeResumeLinkedin && (
        <div className="pt-2 border-t border-amber-100 dark:border-amber-800/60 space-y-2">
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Skill &amp; competency data — not a ranking weight</p>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draftResumeLinkedin}
              onChange={(e) => setDraftResumeLinkedin(e.target.checked)}
            />
            <span className="flex-1">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Include resume &amp; LinkedIn-derived skills</span>
              <span className="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                On by default. Skills and competencies added from an uploaded resume or LinkedIn PDF are self-reported and already scored lower than verified records — turn this off to rank only on the org&apos;s own verified skill &amp; competency matrix.
              </span>
            </span>
          </label>
        </div>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-amber-100 dark:border-amber-800/60">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {isDirty
            ? "Not applied yet — click Apply to update the ranking"
            : `Applied: ${appliedLabels.join(", ")} · tolerance ${nearCapacityTolerancePct ?? 25} pts${includeBelowCapacity ? " + below-capacity included" : ""}${includeResumeLinkedin === false ? " · resume/LinkedIn skills excluded" : ""}`}
        </span>
        <button
          onClick={apply}
          disabled={!isDirty}
          className={cn(
            "text-xs font-medium px-4 py-1.5 rounded-lg transition",
            isDirty ? "bg-primary text-white hover:opacity-90" : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
          )}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function RangeFilter({
  label,
  value,
  onChange,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  step: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">
        {label}
        {value > 0 ? `: ${suffix ? value : value.toFixed(1)}${suffix ?? ""}` : ": any"}
      </label>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-primary"
      />
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
      >
        {children}
      </select>
    </div>
  );
}
