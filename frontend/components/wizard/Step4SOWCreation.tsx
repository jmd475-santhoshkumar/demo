"use client";

import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScrollText, Upload, Download, Sparkles, Loader2, User, Search,
  RefreshCw, Building2, Hash, Clock3, Users, Code2, Award, CheckCircle2, AlertCircle,
} from "lucide-react";
import { api, type SowExtractionResult } from "@/lib/api";
import { SowChatModal } from "@/components/wizard/SowChatModal";

export function Step4SOWCreation({ projectCode, onNext }: { projectCode: string | null; onNext: () => void }) {
  const qc = useQueryClient();
  const files = useQuery({
    queryKey: ["project-sow", projectCode],
    queryFn: () => api.listProjectSow(projectCode as string),
    enabled: projectCode != null,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatFilename, setChatFilename] = useState<string | null>(null);

  async function handleFile(f: File) {
    setError(null);
    if (!projectCode) { setError("Create the project in Step 1 first, then come back to upload."); return; }
    setUploading(true);
    try {
      await api.uploadProjectSow(projectCode, f);
      await qc.invalidateQueries({ queryKey: ["project-sow", projectCode] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const list = files.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Statement Of Work Documents</p>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          <Upload size={13} /> {uploading ? "Uploading…" : "Upload SOW"}
        </button>
        <input
          ref={fileInput} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      {!projectCode && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2">
          No project created yet — complete Step 1 before uploading a SOW.
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2">{error}</p>}

      {list.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-8">
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ScrollText className="text-gray-300 dark:text-gray-600" size={32} />
            <p className="text-sm text-rose-500 dark:text-rose-400 font-medium">No SOW Submitted Yet</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((f) => (
            <div key={f.filename} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 transition hover:border-gray-300 dark:hover:border-gray-600 space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 shrink-0">
                    <ScrollText size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-gray-800 dark:text-gray-200 font-medium truncate">{f.filename}</p>
                    <p className="text-gray-400 dark:text-gray-500 text-[11px]">{(f.size_bytes / 1024).toFixed(1)} KB · {new Date(f.uploaded_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setChatFilename(f.filename)}
                    className="flex items-center gap-1 text-gray-400 dark:text-gray-500 hover:text-[hsl(var(--primary))] transition"
                    title="Ask questions about this SOW"
                  >
                    <Search size={13} /> Ask
                  </button>
                  <a
                    href={api.projectSowDownloadUrl(projectCode as string, f.filename)}
                    className="flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"
                    download
                  >
                    <Download size={13} /> Download
                  </a>
                </div>
              </div>
              <SowExtractionPanel projectCode={projectCode as string} filename={f.filename} />
            </div>
          ))}
        </div>
      )}

      {chatFilename && projectCode && (
        <SowChatModal projectCode={projectCode} filename={chatFilename} onClose={() => setChatFilename(null)} />
      )}

      <div className="flex justify-end">
        <button onClick={onNext} className="text-xs px-4 py-2 rounded-lg text-white font-medium" style={{ backgroundColor: "hsl(var(--primary))" }}>
          Next
        </button>
      </div>
    </div>
  );
}

function SowExtractionPanel({ projectCode, filename }: { projectCode: string; filename: string }) {
  const qc = useQueryClient();
  const cached = useQuery({
    queryKey: ["sow-extraction", projectCode, filename],
    queryFn: () => api.getProjectSowExtraction(projectCode, filename),
  });

  const extract = useMutation({
    mutationFn: () => api.extractProjectSow(projectCode, filename),
    onSuccess: (result) => qc.setQueryData(["sow-extraction", projectCode, filename], result),
  });

  if (cached.isLoading) return null;

  const data: SowExtractionResult | null = extract.data ?? (cached.data && "roles_required" in cached.data ? cached.data : null);

  if (extract.isPending) {
    return (
      <div className="rounded-xl border border-[hsl(var(--primary)/0.15)] bg-[hsl(var(--primary)/0.03)] px-4 py-6 flex flex-col items-center justify-center gap-2 text-center">
        <Loader2 size={18} className="animate-spin text-[hsl(var(--primary))]" />
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Reading the SOW and extracting requirements…</p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">Roles, skills, and competency areas, grounded only in this document&apos;s own text.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.02)] px-4 py-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] shrink-0">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Extract requirements from this SOW</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">AI reads the document and pulls out the roles, skills, and competency areas it calls for.</p>
          </div>
        </div>
        <button
          onClick={() => extract.mutate()}
          className="flex items-center gap-1.5 text-xs font-medium text-white px-3.5 py-2 rounded-lg shrink-0 transition hover:opacity-90"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          <Sparkles size={13} /> Extract
        </button>
      </div>
    );
  }

  const contextChips = [
    data.client_name && { icon: Building2, text: data.client_name },
    data.project_reference && { icon: Hash, text: data.project_reference },
    data.engagement_duration && { icon: Clock3, text: data.engagement_duration },
  ].filter((c): c is { icon: typeof Building2; text: string } => Boolean(c));

  return (
    <div className="rounded-xl border border-[hsl(var(--primary)/0.15)] bg-gradient-to-br from-[hsl(var(--primary)/0.035)] to-transparent overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <Sparkles size={12} />
          </span>
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">AI-Extracted Requirements</p>
        </div>
        <button
          onClick={() => extract.mutate()}
          className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 hover:text-[hsl(var(--primary))] transition"
        >
          <RefreshCw size={11} /> Re-extract
        </button>
      </div>

      <div className="px-4 pt-2.5 pb-4 space-y-3.5">
        {data.project_mismatch_warning && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>{data.project_mismatch_warning}</span>
          </div>
        )}
        {contextChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contextChips.map(({ icon: Icon, text }, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[10.5px] text-gray-500 dark:text-gray-400">
                <Icon size={10} /> {text}
              </span>
            ))}
          </div>
        )}

        {data.scope_summary && (
          <p className="text-xs text-gray-600 dark:text-gray-400 italic border-l-2 border-[hsl(var(--primary)/0.3)] pl-3 leading-relaxed">{data.scope_summary}</p>
        )}

        <div className="h-px bg-gray-100 dark:bg-gray-800" />

        <SowRequirementSection icon={Users} label="Roles Required">
          {data.roles_required.map((r, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-medium ${
                r.matches_real_designation
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-400"
                  : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400"
              }`}
              title={r.matches_real_designation ? "Matches a real JMAN designation" : "Not a standard JMAN designation -- engagement-level label"}
            >
              {r.matches_real_designation ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {r.count > 1 && `${r.count}x `}
              {r.role_text}
              {r.named_person && (
                <span className="inline-flex items-center gap-0.5 text-gray-500 dark:text-gray-400 font-normal">
                  <User size={10} />
                  {r.named_person}
                </span>
              )}
            </span>
          ))}
        </SowRequirementSection>

        {data.skills_required.length > 0 && (
          <SowRequirementSection icon={Code2} label="Skills Required">
            {data.skills_required.map((s) => (
              <span key={s} className="px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800/60 dark:text-blue-400 text-[11px] font-medium">
                {s}
              </span>
            ))}
          </SowRequirementSection>
        )}

        {data.competency_areas_required.length > 0 && (
          <SowRequirementSection icon={Award} label="Competency Areas Required">
            {data.competency_areas_required.map((c) => (
              <span key={c} className="px-2.5 py-1 rounded-full border border-purple-200 bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:border-purple-800/60 dark:text-purple-400 text-[11px] font-medium">
                {c}
              </span>
            ))}
          </SowRequirementSection>
        )}
      </div>
    </div>
  );
}

function SowRequirementSection({
  icon: Icon, label, children,
}: { icon: typeof Users; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        <Icon size={11} /> {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
