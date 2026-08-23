"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SkillsTable, SkillsSectionHeader, type SkillGroup } from "@/components/shared/SkillsTable";

// Groups AiRequiredSkill[] by CoE, in first-seen order, for the SkillsTable --
// a flat list of 5-12 skills across multiple CoEs reads as noise without this.
function groupByCoe(skills: { skill: string; coe: string; rationale: string | null }[]): SkillGroup[] {
  const order: string[] = [];
  const byCoe = new Map<string, { skill: string; rationale: string | null }[]>();
  for (const s of skills) {
    if (!byCoe.has(s.coe)) order.push(s.coe);
    (byCoe.get(s.coe) ?? byCoe.set(s.coe, []).get(s.coe)!).push(s);
  }
  return order.map((coe) => ({
    key: coe,
    coe,
    skills: byCoe.get(coe)!.map((s) => ({ label: s.skill, title: s.rationale ?? undefined })),
  }));
}

// Self-fetching (no button, no caller-managed state) so it can be dropped
// into any pipeline-row view -- Resource Allocation, Project Information --
// and just work. Backend caches per row_index, so only the first view of a
// given role pays the LLM latency; react-query's own cache covers repeat
// mounts within the session on top of that.
export function AiRequiredSkillsPanel({
  rowIndex,
  className,
  hideHeader,
}: {
  rowIndex: number;
  className?: string;
  // True when a caller (e.g. a combined "Preferred Skills" section) already
  // renders its own header covering this panel -- avoids a second, redundant
  // "AI-suggested skills" heading stacked directly under a "Preferred
  // Skills" one.
  hideHeader?: boolean;
}) {
  const query = useQuery({
    queryKey: ["ai-required-skills", rowIndex],
    queryFn: () => api.aiRequiredSkills(rowIndex),
    staleTime: Infinity,
    retry: false,
  });

  if (query.isLoading) {
    return (
      <div className={cn("flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500", className)}>
        <Sparkles className="w-3 h-3 animate-pulse flex-shrink-0" />
        AI is reading this deal&apos;s real details to suggest required skills…
      </div>
    );
  }

  const result = query.data;
  if (query.isError || !result || !result.available) {
    return (
      <p className={cn("text-[11px] text-gray-400 italic dark:text-gray-500", className)}>
        {result?.reason ?? "AI-suggested skills aren't available right now."}
      </p>
    );
  }

  if (result.no_match_found || !result.required_skills || result.required_skills.length === 0) {
    return (
      <p className={cn("text-[11px] text-gray-400 dark:text-gray-500", className)}>
        AI found no clear real-data signal to suggest specific skills for this role.
      </p>
    );
  }

  const groups = groupByCoe(result.required_skills);

  return (
    <div className={cn("space-y-1.5", className)}>
      {!hideHeader && (
        <SkillsSectionHeader
          icon={<Sparkles className="w-3 h-3 text-primary flex-shrink-0" />}
          label="AI-suggested skills"
          badge={
            result.primary_coe && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-400">
                {result.primary_coe}
              </span>
            )
          }
        />
      )}
      <SkillsTable groups={groups} />
    </div>
  );
}
