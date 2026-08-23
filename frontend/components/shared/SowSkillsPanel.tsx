"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { api, type SowExtractionResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SkillsTable, SkillsSectionHeader } from "@/components/shared/SkillsTable";

// Self-fetching, same pattern as AiRequiredSkillsPanel: lists this project's
// uploaded SOWs, reads the most recent one's cached extraction, and -- since
// there's genuinely nothing useful to show without it -- runs the real
// extraction itself if it hasn't been run yet, rather than leaving the
// section blank until someone finds the SOW tab and clicks a button. Backend
// caches per (project, filename), so this only pays the real AI-extraction
// cost once per SOW.
export function SowSkillsPanel({ projectCode, className }: { projectCode: string | null | undefined; className?: string }) {
  const sowFiles = useQuery({
    queryKey: ["project-sow-list", projectCode],
    queryFn: () => api.listProjectSow(projectCode as string),
    enabled: !!projectCode,
    staleTime: 60_000,
  });

  // Already sorted most-recent-first by the backend.
  const latestFile = sowFiles.data?.[0] ?? null;

  const extraction = useQuery({
    queryKey: ["sow-skills-extraction", projectCode, latestFile?.filename],
    queryFn: async (): Promise<SowExtractionResult> => {
      const cached = await api.getProjectSowExtraction(projectCode as string, latestFile!.filename);
      if (cached.available === false) {
        return api.extractProjectSow(projectCode as string, latestFile!.filename);
      }
      return cached as SowExtractionResult;
    },
    enabled: !!projectCode && !!latestFile,
    staleTime: Infinity,
    retry: false,
  });

  const header = (icon: React.ReactNode, badge?: React.ReactNode) => (
    <SkillsSectionHeader icon={icon} label="SOW skills" badge={badge} />
  );

  if (!projectCode || (sowFiles.isSuccess && sowFiles.data.length === 0)) {
    return (
      <div className={cn("space-y-1.5", className)}>
        {header(<FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />)}
        <p className="text-[11px] text-gray-400 italic dark:text-gray-500">
          SOW upload pending — skills will show here once a Statement of Work is uploaded for this project.
        </p>
      </div>
    );
  }

  if (sowFiles.isLoading || extraction.isLoading) {
    return (
      <div className={cn("space-y-1.5", className)}>
        {header(<FileText className="w-3 h-3 text-gray-400 flex-shrink-0 animate-pulse" />)}
        <p className="text-[11px] text-gray-400 dark:text-gray-500">Reading the uploaded SOW…</p>
      </div>
    );
  }

  if (extraction.isError || !extraction.data) {
    return (
      <div className={cn("space-y-1.5", className)}>
        {header(<FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />)}
        <p className="text-[11px] text-gray-400 italic dark:text-gray-500">Could not extract skills from the uploaded SOW.</p>
      </div>
    );
  }

  const fileBadge = latestFile && (
    <span
      title={latestFile.filename}
      className="text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-500 max-w-[160px] truncate dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400"
    >
      {latestFile.filename}
    </span>
  );

  const skills = extraction.data.skills_required;
  if (!skills || skills.length === 0) {
    return (
      <div className={cn("space-y-1.5", className)}>
        {header(<FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />, fileBadge)}
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          The uploaded SOW doesn&apos;t name any specific technologies or skills in its scope text.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {header(<FileText className="w-3 h-3 text-primary flex-shrink-0" />, fileBadge)}
      <SkillsTable groups={[{ key: "sow", coe: null, skills }]} />
    </div>
  );
}
