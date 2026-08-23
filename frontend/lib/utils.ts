import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export const ROOT_CAUSE_LABEL: Record<string, string> = {
  shadow_heavy: "Shadow-heavy",
  high_churn: "High churn",
  understaffed: "Understaffed",
  overtime_risk: "Overtime risk",
  effort_spike: "Effort spike",
  wsr_risk: "WSR risk",
  devops_extension_risk: "DevOps extension risk",
  pulse_risk: "Pulse risk",
};
export function rootCauseLabel(value: string): string {
  return ROOT_CAUSE_LABEL[value] ?? value.replace(/_/g, " ");
}
