"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CLUSTER_COLORS } from "@/components/health/ClusterBalls";
import { ClusterGovernanceView } from "@/components/health/ClusterGovernanceView";
import { WeekCalendarPicker } from "@/components/health/WeekCalendarPicker";
import { ProjectHealthDetailContent } from "@/components/health/ProjectHealthDetailModal";
import { StatCardGridSkeleton } from "@/components/shared/Skeleton";

// Cluster Governance used to live squeezed at the top of the Health page (a
// row of balls above the risk cards) -- moved to its own page now that
// Governance is a real nav destination in its own right, not just a strip on
// top of something else. Same real components/data as before (ClusterBalls,
// ClusterGovernanceView), just given real page space: a proper header, and
// room for the picker to breathe before a cluster is chosen.
//
// The week picker lives HERE (not inside ClusterGovernanceView) so it stays
// selected while switching between clusters -- checking how every cluster
// looked in a given past week is exactly the real JQA-meeting workflow this
// page replaces.
export default function ClustersPage() {
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedProjectTab, setSelectedProjectTab] = useState<string | undefined>(undefined);
  const [selectedWeek, setSelectedWeek] = useState<string | undefined>(undefined);
  const weeks = useQuery({ queryKey: ["governance-weeks"], queryFn: api.governanceWeeks });

  function openProject(code: string, tab?: string) {
    setSelectedProject(code);
    setSelectedProjectTab(tab);
  }

  if (selectedProject) {
    return (
      <div className="p-4 sm:p-6 w-full space-y-4">
        <nav className="flex items-center gap-1.5 text-xs">
          <button onClick={() => { setSelectedProject(null); setSelectedProjectTab(undefined); setSelectedCluster(null); }} className="text-primary hover:underline">
            Clusters
          </button>
          {selectedCluster && (
            <>
              <span className="text-gray-300 dark:text-gray-600">/</span>
              <button onClick={() => { setSelectedProject(null); setSelectedProjectTab(undefined); }} className="text-primary hover:underline">
                Cluster {selectedCluster}
              </button>
            </>
          )}
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="text-gray-500 dark:text-gray-400 font-medium">{selectedProject}</span>
        </nav>
        <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <ProjectHealthDetailContent projectCode={selectedProject} initialTab={selectedProjectTab as any} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full">
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Cluster Governance</h2>
        </div>
        <WeekCalendarPicker weekOptions={weeks.data ?? []} selectedWeek={selectedWeek} onSelectWeek={setSelectedWeek} />
      </div>

      {selectedCluster ? (
        <ClusterGovernanceView
          clusterNumber={selectedCluster}
          week={selectedWeek}
          onBack={() => setSelectedCluster(null)}
          onOpenProject={(code) => openProject(code)}
          onBackToCurrentWeek={() => setSelectedWeek(undefined)}
        />
      ) : (
        <ClusterPicker onSelect={setSelectedCluster} />
      )}
    </div>
  );
}

function ClusterPicker({ onSelect }: { onSelect: (n: number) => void }) {
  const clusters = useQuery({ queryKey: ["governance-clusters"], queryFn: api.governanceClusters });

  if (clusters.isLoading) return <StatCardGridSkeleton count={5} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" />;
  if (!clusters.data) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {clusters.data.map((c) => (
        <button
          key={c.number}
          onClick={() => onSelect(c.number)}
          className="group text-left rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600"
        >
          <div className="flex items-center justify-between mb-4">
            <span className={cn("flex items-center justify-center h-10 w-10 rounded-full text-white text-sm font-bold shadow-sm", CLUSTER_COLORS[c.number] ?? "bg-gray-400")}>
              {c.number}
            </span>
            <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 transition group-hover:text-gray-400 dark:group-hover:text-gray-500 group-hover:translate-x-0.5" />
          </div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{c.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {c.project_count} project{c.project_count === 1 ? "" : "s"}
          </p>
        </button>
      ))}
    </div>
  );
}
