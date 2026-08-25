"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldCheck, TriangleAlert, Plus, Minus, Sparkles, Loader2 } from "lucide-react";
import type { TeamSizeBucket, TeamSizeFitResult } from "@/lib/api";
import { cn } from "@/lib/utils";

function BucketExamples({ bucket, onSelectProject }: { bucket: TeamSizeBucket; onSelectProject: (projectCode: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 hover:underline">
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Show proof
      </button>
      {open && (
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1">Clean ({bucket.clean})</p>
            <div className="space-y-0.5 max-h-[180px] overflow-y-auto pr-1">
              {bucket.clean_examples.map((p) => (
                <button
                  key={p.project_code}
                  onClick={() => onSelectProject(p.project_code)}
                  className="block w-full text-left text-[10px] text-gray-500 dark:text-gray-400 hover:text-primary hover:underline truncate"
                >
                  {p.project_name ?? p.project_code} <span className="text-gray-400 dark:text-gray-500">({p.project_code})</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1">Extension/escalation ({bucket.risky})</p>
            <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
              {bucket.risky_examples.map((p) => (
                <div key={p.project_code}>
                  <button
                    onClick={() => onSelectProject(p.project_code)}
                    className="block w-full text-left text-[10px] text-gray-500 dark:text-gray-400 hover:text-primary hover:underline truncate"
                  >
                    {p.project_name ?? p.project_code} <span className="text-gray-400 dark:text-gray-500">({p.project_code})</span>
                  </button>
                  {p.reasons && p.reasons.length > 0 && (
                    <p className="text-[9px] text-amber-600 dark:text-amber-500">{p.reasons.join(" · ")}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clean_pct(bucket?: TeamSizeBucket | null): string {
  if (!bucket || bucket.clean_rate == null) return "no data";
  return `${Math.round(bucket.clean_rate * 100)}% clean (${bucket.clean}/${bucket.total})`;
}

export function TeamRecommendationPanel({
  data,
  onAddRole,
  onRemoveRole,
  onSelectProject,
  isUpdating,
}: {
  data: TeamSizeFitResult;
  onAddRole: (designation: string) => void;
  onRemoveRole: (designation: string) => void;
  onSelectProject: (projectCode: string) => void;
  isUpdating?: boolean;
}) {
  if (data.recommendation === "no_data" || data.recommendation === "not_enough_data" || data.recommendation === "unknown_project") {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">Not enough precedent data yet for this team size.</p>
      </div>
    );
  }

  const scope = data.type_of_project ? `${data.type_of_project}${data.coe ? ` / ${data.coe}` : data.proposition_coe ? ` / ${data.proposition_coe}` : ""}` : null;
  const durationNote = data.duration_narrowed && data.target_duration_weeks ? ` · ~${Math.round(data.target_duration_weeks)}-week projects` : "";
  const isSufficient = data.recommendation === "sufficient";
  const target = data.recommendation === "add_one" ? data.larger_bucket : data.recommendation === "remove_one" ? data.smaller_bucket : undefined;

  return (
    <div className={cn("rounded-xl border overflow-hidden", isSufficient ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" : "border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20")}>
      <div className="p-3 flex items-start gap-2.5">
        {isSufficient ? (
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
        ) : (
          <TriangleAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span
              className="text-xs font-semibold text-gray-800 dark:text-gray-200 w-fit"
              title={
                data.matched_by === "type_of_project"
                  ? "No tech or proposition CoE set on this project -- matched by project type only."
                  : data.duration_narrowed
                  ? `Also narrowed to precedent projects of a similar length (roughly half to double ${Math.round(data.target_duration_weeks ?? 0)} weeks), so this isn't comparing a short engagement against a year-long one.`
                  : undefined
              }
            >
              Team size check{scope ? ` — ${scope}${durationNote}` : ""}
            </span>
            {isUpdating && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin" /> Updating…
              </span>
            )}
          </p>

          {isSufficient ? (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {data.current_headcount}-person team: {clean_pct(data.current_bucket)} at this size.
            </p>
          ) : (
            <p className="text-[11px] text-gray-700 dark:text-gray-300 mt-0.5">
              {data.current_headcount} people: {clean_pct(data.current_bucket)}.{" "}
              {data.recommendation === "add_one" ? "Adding" : "Removing"} 1 <strong>{data.suggested_role}</strong> ({target?.headcount}{" "}
              people): {clean_pct(target)}.
            </p>
          )}

          {data.ai_summary && (
            <div className="flex items-start gap-2 mt-2 px-2.5 py-2 rounded-lg border border-jman-amethyst/20 dark:border-jman-amethyst/30 bg-jman-amethyst-50 dark:bg-jman-amethyst/10">
              <Sparkles className="w-3.5 h-3.5 text-jman-amethyst-700 dark:text-jman-amethyst-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-jman-amethyst-700 dark:text-jman-amethyst-500 leading-relaxed">{data.ai_summary}</p>
            </div>
          )}

          {data.current_bucket && <div className="mt-1.5"><BucketExamples bucket={data.current_bucket} onSelectProject={onSelectProject} /></div>}
          {!isSufficient && target && (
            <div className="mt-2 pt-2 border-t border-amber-200/60 dark:border-amber-800/40">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">At {target.headcount} people:</p>
              <BucketExamples bucket={target} onSelectProject={onSelectProject} />
            </div>
          )}
        </div>

        {!isSufficient && data.suggested_role && (
          <button
            onClick={() => (data.recommendation === "add_one" ? onAddRole(data.suggested_role!) : onRemoveRole(data.suggested_role!))}
            className="flex-shrink-0 flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 whitespace-nowrap"
          >
            {data.recommendation === "add_one" ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {data.recommendation === "add_one" ? "Add" : "Remove"} 1 {data.suggested_role}
          </button>
        )}
      </div>
    </div>
  );
}
