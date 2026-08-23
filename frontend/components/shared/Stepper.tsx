"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JMAN, JMAN_HEADER_GRADIENT } from "@/lib/brandColors";

export interface StepDef {
  step: number;
  label: string;
}

// JIN's numbered-circle-with-dashed-connector wizard shape, restyled in
// JMAN brand colors instead of JIN's own purple/magenta chrome. Forward
// navigation is gated by the caller via `completedSteps` (only a completed
// or the current step is clickable); backward is always allowed.
export function Stepper({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: {
  steps: StepDef[];
  currentStep: number;
  completedSteps: Set<number>;
  // Free navigation: every step is clickable regardless of completion --
  // the RM should be able to jump around (e.g. peek at Resource Allocation
  // before finishing GDPR) rather than being forced through in order.
  onStepClick?: (step: number) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="flex items-center min-w-max px-1 py-2">
        {steps.map((s, i) => {
          const isDone = completedSteps.has(s.step);
          const isCurrent = s.step === currentStep;
          const clickable = Boolean(onStepClick);

          return (
            <div key={s.step} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepClick?.(s.step)}
                className={cn("flex flex-col items-center gap-1.5 shrink-0", clickable && "cursor-pointer")}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border",
                    isDone && "text-white border-transparent",
                    isCurrent && !isDone && "text-white border-transparent ring-2 ring-offset-2",
                    !isDone && !isCurrent && "bg-white border-gray-200 text-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-500"
                  )}
                  style={
                    isDone
                      ? { backgroundColor: JMAN.emerald }
                      : isCurrent
                      ? { backgroundImage: JMAN_HEADER_GRADIENT, boxShadow: `0 0 0 2px ${JMAN.turquoise}55` }
                      : undefined
                  }
                >
                  {isDone ? <Check size={14} /> : s.step}
                </span>
                <span
                  className={cn(
                    "text-[11px] text-center leading-tight whitespace-nowrap",
                    isCurrent ? "font-semibold text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <div
                  className={cn("flex-1 min-w-8 h-px border-t border-dashed mx-2 mb-4", isDone ? "border-emerald-300 dark:border-emerald-700" : "border-gray-200 dark:border-gray-700")}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
