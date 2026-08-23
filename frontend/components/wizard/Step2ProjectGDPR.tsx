"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { GDPR_FIELD_DEFS } from "@/lib/projectConstants";

const selectCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:border-[hsl(var(--primary))]";

export function Step2ProjectGDPR({ projectCode, onNext }: { projectCode: string | null; onNext: () => void }) {
  const existing = useQuery({
    queryKey: ["project-gdpr", projectCode],
    queryFn: () => api.getProjectGdpr(projectCode as string),
    enabled: projectCode != null,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) setValues(existing.data as Record<string, string>);
  }, [existing.data]);

  const fullWidth = GDPR_FIELD_DEFS.filter((f) => f.fullWidth);
  const grid = GDPR_FIELD_DEFS.filter((f) => !f.fullWidth);

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function renderField(f: (typeof GDPR_FIELD_DEFS)[number]) {
    const required = f.key !== "third_parties" || values.transfer_to_third_parties === "Yes";
    return (
      <div key={f.key}>
        <label className="text-xs font-medium text-purple-800 dark:text-purple-200 block mb-1">
          {f.label}
          {required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
        </label>
        {f.type === "select" ? (
          <SearchableSelect
            options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
            value={values[f.key] ? [values[f.key]] : []}
            onChange={(v) => set(f.key, v[0] ?? "")}
          />
        ) : (
          <input
            className={selectCls} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
            placeholder="Enter" disabled={f.key === "third_parties" && values.transfer_to_third_parties !== "Yes"}
          />
        )}
      </div>
    );
  }

  async function submit() {
    setError(null);
    if (!projectCode) { setError("Create the project in Step 1 first, then come back to save this."); return; }
    setSubmitting(true);
    try {
      await api.saveProjectGdpr(projectCode, values);
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save GDPR details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">Project GDPR</p>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
        {!projectCode && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2">
            No project created yet — you can fill this in now, but it won&apos;t save until you complete Step 1.
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2">{error}</p>}
        {fullWidth.map(renderField)}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {grid.map(renderField)}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={submitting}
          className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {submitting ? "Saving…" : "Save & Next"}
        </button>
      </div>
    </div>
  );
}
