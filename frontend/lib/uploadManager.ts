// Global, app-shell-level upload orchestration -- a module-level singleton
// (not a React context) so an in-progress upload survives client-side
// navigation to any other page: the task list lives here, independent of
// which component mounted it, and UploadManagerWidget (rendered once in
// app/layout.tsx, above the page content) subscribes to it via
// useSyncExternalStore. Closing the tab/browser still stops an upload (a
// real browser limitation, not something client-side JS can work around) --
// this only guarantees "switch pages inside the app without losing
// progress," which is what was actually asked for.
//
// Two transfer paths, chosen automatically per upload:
//   - S3-relayed (large files): presigned PUT straight from the browser to
//     S3 (this backend never sees the bytes), tracked via XMLHttpRequest's
//     upload.onprogress (fetch has no upload-progress event, which is why
//     this uses XHR specifically for the transfer step). Falls back
//     automatically to the direct path if S3 isn't configured on this
//     server (a 503 from /admin/s3/presign-upload).
//   - Direct-to-backend: a plain FormData POST, no byte-level progress
//     available (used for the JDWH "6 separate files" shape, which isn't
//     S3-relayed -- see routers/admin.py's note on why).
// Either way, the backend now always processes the upload as a background
// job (see routers/admin.py) and hands back a job_id immediately -- this
// module polls GET /admin/jobs/{job_id} for the real parse/clean/write
// progress and resolves with the same final result shape every existing
// caller (Settings page, etc.) already expects.
import { api, type JdwhUploadTableKey } from "./api";

export type UploadPhase = "uploading" | "processing" | "done" | "error";

export interface UploadTask {
  id: string;
  label: string;
  phase: UploadPhase;
  /** Byte-transfer progress (0-100), or null once processing starts / for the no-progress direct path. */
  transferPct: number | null;
  /** Backend job progress (0-100) once the file has fully arrived. */
  processingPct: number;
  message: string;
  remainingSeconds: number | null;
  error: string | null;
  createdAt: number;
}

type Listener = () => void;

let tasks: UploadTask[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  tasks = [...tasks];
  listeners.forEach((l) => l());
}

export function subscribeToUploads(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUploadTasks(): UploadTask[] {
  return tasks;
}

function upsertTask(id: string, patch: Partial<UploadTask>): void {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    tasks.push({
      id,
      label: "",
      phase: "uploading",
      transferPct: 0,
      processingPct: 0,
      message: "",
      remainingSeconds: null,
      error: null,
      createdAt: Date.now(),
      ...patch,
    });
  } else {
    tasks[idx] = { ...tasks[idx], ...patch };
  }
  notify();
}

// Finished tasks stay visible briefly (so a fast upload's "Done" state is
// actually seen) then are dropped, so a long working session doesn't
// accumulate an ever-growing list in the widget.
function scheduleRemoval(id: string, delayMs: number): void {
  setTimeout(() => {
    tasks = tasks.filter((t) => t.id !== id);
    notify();
  }, delayMs);
}

function xhrPutWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload to storage failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload to storage failed -- network error"));
    xhr.send(file);
  });
}

async function pollJob(jobId: string, taskId: string): Promise<unknown> {
  upsertTask(taskId, { phase: "processing", transferPct: null, processingPct: 1, message: "Processing" });
  // A background status check, not a latency-sensitive call -- 1s keeps the
  // widget responsive without hammering the backend on a long-running job.
  for (;;) {
    const job = await api.adminJobStatus(jobId);
    upsertTask(taskId, {
      processingPct: job.progress_pct,
      message: job.message,
      remainingSeconds: job.remaining_seconds,
    });
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "Upload failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function runUpload(
  taskId: string,
  label: string,
  kind: string,
  file: File,
  directUpload: (file: File) => Promise<{ job_id: string }>
): Promise<unknown> {
  upsertTask(taskId, { label, phase: "uploading", transferPct: 0, message: "Starting upload" });
  try {
    const presign = await api.adminPresignUpload(kind, file.name, file.type || "application/octet-stream", file.size).catch(() => null);
    let jobId: string;
    if (presign) {
      upsertTask(taskId, { message: "Uploading" });
      await xhrPutWithProgress(presign.upload_url, file, (pct) => upsertTask(taskId, { transferPct: pct }));
      const confirmed = await api.adminConfirmS3Upload(kind, presign.s3_key, file.name);
      jobId = confirmed.job_id;
    } else {
      // S3 isn't configured on this server -- fall back to a direct upload.
      // No byte-level progress is available on this path (a plain FormData
      // POST, not XHR), so the task just shows "Uploading" until the server
      // has fully received the file and background processing begins.
      upsertTask(taskId, { transferPct: null, message: "Uploading" });
      const direct = await directUpload(file);
      jobId = direct.job_id;
    }
    const result = await pollJob(jobId, taskId);
    upsertTask(taskId, { phase: "done", processingPct: 100, message: "Done" });
    scheduleRemoval(taskId, 8000);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    upsertTask(taskId, { phase: "error", error: message, message });
    scheduleRemoval(taskId, 20000);
    throw e instanceof Error ? e : new Error(message);
  }
}

export function uploadDatasetViaManager(key: string, file: File): Promise<unknown> {
  const taskId = `dataset:${key}:${Date.now()}`;
  return runUpload(taskId, file.name, `dataset:${key}`, file, (f) => api.adminUploadDatasetDirect(key, f));
}

export function uploadJdwhWorkbookViaManager(file: File): Promise<unknown> {
  const taskId = `jdwh_workbook:${Date.now()}`;
  return runUpload(taskId, file.name, "jdwh_workbook", file, (f) => api.jdwhUploadWorkbookDirect(f));
}

// Not S3-relayed -- see this module's header note on why the "6 separate
// files" shape stays direct-to-backend. Still routed through the same job
// polling for a consistent progress/ETA experience.
export function uploadJdwhFilesViaManager(files: Record<JdwhUploadTableKey, File | null>): Promise<unknown> {
  const taskId = `jdwh_files:${Date.now()}`;
  const label = Object.values(files).filter(Boolean).length + " files";
  upsertTask(taskId, { label, phase: "uploading", transferPct: null, message: "Uploading" });
  return api.jdwhUploadFilesDirect(files).then(
    (direct) => pollJob(direct.job_id, taskId).then((result) => {
      upsertTask(taskId, { phase: "done", processingPct: 100, message: "Done" });
      scheduleRemoval(taskId, 8000);
      return result;
    }),
    (e: Error) => {
      upsertTask(taskId, { phase: "error", error: e.message, message: e.message });
      scheduleRemoval(taskId, 20000);
      throw e;
    }
  );
}
