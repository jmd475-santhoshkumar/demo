import type { HoldProject } from "@/lib/api";

function holdTitle(projects: HoldProject[]): string {
  const codes = projects.map((p) => p.project_code).join(", ");
  return `Currently allocated to a project flagged as likely to extend past its end date (${codes}). Availability is uncertain until that's confirmed.`;
}

// Small dot for tight spaces (table rows, name labels) -- hover for which project(s).
export function HoldDot({ onHold, holdProjects }: { onHold?: boolean; holdProjects?: HoldProject[] }) {
  if (!onHold || !holdProjects?.length) return null;
  return (
    <span
      title={holdTitle(holdProjects)}
      className="inline-block h-2 w-2 rounded-full bg-amber-500 flex-shrink-0"
    />
  );
}

// Full chip for candidate rows / cards where there's room for a label.
export function HoldChip({ onHold, holdProjects }: { onHold?: boolean; holdProjects?: HoldProject[] }) {
  if (!onHold || !holdProjects?.length) return null;
  return (
    <span
      title={holdTitle(holdProjects)}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Hold
    </span>
  );
}
