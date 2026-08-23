"use client";

import { useState } from "react";
import { TrendingUp, CalendarRange } from "lucide-react";
import { NewProjectForecastTab } from "@/components/forecast/NewProjectForecastTab";
import { PipelineOutlookTab } from "@/components/forecast/PipelineOutlookTab";
import { cn } from "@/lib/utils";

type PageTab = "new_project" | "pipeline";

// Merged from two separate sidebar pages (New Project Demand Forecast +
// Pipeline Outlook) into one page with tabs -- both tab bodies stay mounted
// (hidden via CSS, not unmounted) when switched away from, so in-progress
// forecast specs/filters/mutation results survive a tab switch instead of
// resetting, same convention already used for RevenueTargetSection's own
// internal mode switch.
export default function ForecastPage() {
  const [tab, setTab] = useState<PageTab>("new_project");

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab("new_project")}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition",
            tab === "new_project" ? "bg-primary text-white border-primary" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
          )}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          New Project Forecast
        </button>
        <button
          onClick={() => setTab("pipeline")}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition",
            tab === "pipeline" ? "bg-primary text-white border-primary" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary"
          )}
        >
          <CalendarRange className="w-3.5 h-3.5" />
          Pipeline Outlook
        </button>
      </div>

      <div className={tab === "new_project" ? "" : "hidden"}>
        <NewProjectForecastTab />
      </div>
      <div className={tab === "pipeline" ? "" : "hidden"}>
        <PipelineOutlookTab />
      </div>
    </div>
  );
}
