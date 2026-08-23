"use client";

import { useQueries } from "@tanstack/react-query";
import { api, type AiRequiredSkill } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface RoleForSkillsTable {
  rowIndex: number;
  roleLabel: string;
  requestedPct?: string | number | null;
}

function uniqueCoes(skills: AiRequiredSkill[]): string[] {
  const seen: string[] = [];
  for (const s of skills) if (!seen.includes(s.coe)) seen.push(s.coe);
  return seen;
}

// One row per role: role code, its CoE(s), and its full preferred-skill list,
// all in one seamless table -- replaces stacking a separate bordered
// mini-panel per role, which read as repetitive clutter once a project has
// more than a couple of roles (the same CoE tag and near-identical skill
// sets repeated in N separate boxes, each with its own little role badge).
// Reuses AiRequiredSkillsPanel's exact query key so this never double-fetches
// against react-query's cache even if both are mounted somewhere at once.
export function PreferredSkillsTable({ roles }: { roles: RoleForSkillsTable[] }) {
  const queries = useQueries({
    queries: roles.map((r) => ({
      queryKey: ["ai-required-skills", r.rowIndex],
      queryFn: () => api.aiRequiredSkills(r.rowIndex),
      staleTime: Infinity,
      retry: false,
    })),
  });

  if (roles.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden dark:border-gray-700">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            <th className="text-left font-medium px-3 py-1.5 w-24">Role</th>
            <th className="text-left font-medium px-3 py-1.5 w-40">CoE</th>
            <th className="text-left font-medium px-3 py-1.5">Preferred skills</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r, i) => {
            const q = queries[i];
            const result = q.data;
            const skills = result?.available && !result.no_match_found ? result.required_skills ?? [] : [];
            const coes = uniqueCoes(skills);
            return (
              <tr key={r.rowIndex} className="border-t border-gray-100 dark:border-gray-800 align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {r.roleLabel}
                  </span>
                  {r.requestedPct != null && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{r.requestedPct}% allocation</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {q.isLoading ? (
                    <span className="text-[11px] text-gray-300 dark:text-gray-600">…</span>
                  ) : coes.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {coes.map((coe) => (
                        <span
                          key={coe}
                          className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-medium whitespace-nowrap dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-400"
                        >
                          {coe}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {q.isLoading ? (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">Reading this role&apos;s real details…</span>
                  ) : skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((s) => (
                        <span
                          key={s.skill}
                          title={s.rationale ?? undefined}
                          className={cn(
                            "text-[11px] px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 border border-gray-200 whitespace-nowrap dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-700",
                            s.rationale && "cursor-help"
                          )}
                        >
                          {s.skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-300 dark:text-gray-600 italic">
                      {result?.reason ?? "No suggestions available"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
