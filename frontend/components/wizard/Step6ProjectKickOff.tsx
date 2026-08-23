"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { KICKOFF_TOPIC_FIELDS } from "@/lib/projectConstants";

const selectCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:border-[hsl(var(--primary))]";
const YES_NO_OPTIONS = [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }];

export function Step6ProjectKickOff({ projectCode, onSave }: { projectCode: string | null; onSave: () => void }) {
  const existing = useQuery({
    queryKey: ["project-kickoff", projectCode],
    queryFn: () => api.getProjectKickoff(projectCode as string),
    enabled: projectCode != null,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (existing.data) setValues(existing.data as Record<string, string>);
  }, [existing.data]);

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit() {
    setError(null);
    if (!projectCode) { setError("Create the project in Step 1 first, then come back to save this."); return; }
    setSubmitting(true);
    try {
      await api.saveProjectKickoff(projectCode, values);
      setSaved(true);
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save kick-off details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">Project Kick-Off</p>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-5">
        {!projectCode && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2">
            No project created yet — you can fill this in now, but it won&apos;t save until you complete Step 1.
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2">{error}</p>}
        {saved && !error && <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-lg px-3 py-2">Saved.</p>}

        <div>
          <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2">Internal Kick-Off</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Did you hold an internal kick-off session? <span className="text-red-500 dark:text-red-400">*</span></label>
              <SearchableSelect
                options={YES_NO_OPTIONS}
                value={values.held_internal_session ? [values.held_internal_session] : []}
                onChange={(v) => set("held_internal_session", v[0] ?? "")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Did you use the internal kick-off materials?</label>
              <SearchableSelect
                options={YES_NO_OPTIONS}
                value={values.used_internal_materials ? [values.used_internal_materials] : []}
                onChange={(v) => set("used_internal_materials", v[0] ?? "")}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-1">Project-Focused Topics</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Did you cover the following in the internal session?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            {KICKOFF_TOPIC_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{f.label}</label>
                <SearchableSelect
                  options={YES_NO_OPTIONS}
                  value={values[f.key] ? [values[f.key]] : []}
                  onChange={(v) => set(f.key, v[0] ?? "")}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2">Session Details</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Approximately how much time was spent on the internal kick-off? (Hours)</label>
              <input
                type="number" step={0.5} min={0} className={selectCls} placeholder="e.g. 1.5"
                value={values.session_hours ?? ""} onChange={(e) => set("session_hours", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Comments / Notes <span className="text-red-500 dark:text-red-400">*</span></label>
              <input
                className={selectCls} placeholder="Please explain why there was no kick-off conducted"
                value={values.comments ?? ""} onChange={(e) => set("comments", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={submitting}
          className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
