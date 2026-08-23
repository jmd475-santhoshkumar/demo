import { cn } from "@/lib/utils";

// Each status color gets one dark-mode-safe equivalent, reused across every
// variant on that hue: bg-X-50 -> dark:bg-X-950/40 (a translucent deep tint
// instead of a solid one, so it stays subtle against the dark surface behind
// it), text-X-700 -> dark:text-X-400 (lighter for contrast), border-X-200 ->
// dark:border-X-800/60.
const RED = "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/60";
const AMBER = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60";
const EMERALD = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60";
const BLUE = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60";
const PURPLE = "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800/60";

const VARIANTS: Record<string, string> = {
  high: RED,
  red: RED,
  over_allocated: RED,
  medium: AMBER,
  amber: AMBER,
  low: EMERALD,
  green: EMERALD,
  normal: EMERALD,
  under_utilized: BLUE,
  eligible: EMERALD,
  trainable: AMBER,
  gap: RED,
  no_color: "bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800/40 dark:text-gray-500 dark:border-gray-700",
  billable: EMERALD,
  shadow: AMBER,
  unbilled: RED,
  proposed: BLUE,
  pending: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700",
  purple: PURPLE,
  default: "bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-700",
};

export function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: string }) {
  const key = variant.toLowerCase();
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", VARIANTS[key] ?? VARIANTS.default)}>
      {children}
    </span>
  );
}
