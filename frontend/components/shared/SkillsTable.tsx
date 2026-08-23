import { cn } from "@/lib/utils";

export interface SkillChip {
  label: string;
  title?: string;
}

export interface SkillGroup {
  key: string;
  coe: string | null;
  skills: (string | SkillChip)[];
}

function normalizeChip(s: string | SkillChip): SkillChip {
  return typeof s === "string" ? { label: s } : s;
}

// Shared "skills table" look for every place a role's required/suggested
// skills show up (Resource Allocation's candidate panel, Project
// Information) -- one row per CoE group, a fixed-width CoE tag on the left,
// skills as chips on the right. Replaces the old pattern of a plain-text
// comma sentence PLUS a separate row of pill badges repeating the exact same
// list, and the "CoE: skill, skill, skill" inline text prefix for AI-
// suggested skills -- both read as cluttered/redundant next to each other.
export function SkillsTable({ groups }: { groups: SkillGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden dark:border-gray-700">
      {groups.map((g, i) => (
        <div
          key={g.key}
          className={cn(
            "flex gap-3 px-3 py-2",
            i > 0 && "border-t border-gray-100 dark:border-gray-800"
          )}
        >
          <div className="w-[104px] shrink-0 pt-0.5">
            {g.coe && (
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-medium leading-tight dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-400">
                {g.coe}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {g.skills.map(normalizeChip).map((s) => (
              <span
                key={s.label}
                title={s.title}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 border border-gray-200 whitespace-nowrap dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-700",
                  s.title && "cursor-help"
                )}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkillsSectionHeader({
  icon,
  label,
  badge,
  trailing,
}: {
  icon?: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {icon}
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
        {badge}
      </div>
      {trailing}
    </div>
  );
}
