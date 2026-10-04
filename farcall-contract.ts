import { z } from "zod";
import { ENGLISH, type Strings } from "./strings";

export const FARCALL_SETTING = "showFarcallTasks";
export const FARCALL_CHANGED = "farcall-tasks.changed";
export const FARCALL_WORKSPACES_CHANGED = "farcall-workspaces.changed";
export const farcallChangedSchema = z.object({ threadId: z.string(), sequence: z.number().int() });

/** A display projection, never a BB child thread or a worker control handle. */
export const farcallTaskSchema = z.object({
  key: z.string(),
  provider: z.enum(["claude", "codex"]),
  taskId: z.string().nullable(),
  delegationId: z.string().nullable(),
  batchId: z.string().nullable(),
  requestedModel: z.string().nullable(),
  status: z.string().nullable(),
  callState: z.enum(["open", "returned", "failed", "interrupted", "unknown"]),
  result: z.string().nullable(),
  sessionId: z.string().nullable(),
  evidence: z.array(z.string()),
  /** Short, deterministic task text from the call arguments; never the whole prompt. */
  task: z.string().nullable(),
  /** BB event times (ms) of the tool call; they bound waiting time, not worker execution. */
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  cwd: z.string().max(4096).optional(),
});
export type FarcallTask = z.infer<typeof farcallTaskSchema>;
/** Only send what the compact sidebar renders. Full evidence stays in BB history. */
export const farcallRowSchema = farcallTaskSchema.pick({
  key: true, provider: true, requestedModel: true, status: true, callState: true,
  task: true, startedAt: true, endedAt: true,
}).extend({
  hasCwd: z.boolean().optional(),
  workspace: z.object({
    label: z.string().min(1).max(4096),
    branch: z.string().max(4096).nullable(),
    source: z.enum(["environment", "path"]),
  }).optional(),
});
export type FarcallRow = z.infer<typeof farcallRowSchema>;
export const farcallSnapshotSchema = z.object({ tasks: z.array(farcallRowSchema) });

/** `open` only proves a pending tool call, never a running worker process. */
export type TaskOutcome = "open" | "completed" | "failed" | "timeout" | "cancelled" | "unknown";
export interface TaskStatus { outcome: TaskOutcome; label: string; short: string }

/** Keys of the status texts (`farcall.status` in the string files). */
type StatusText = keyof Strings["farcall"]["status"];

/** Outcome codes stay codes; only the labels come from the string files. */
const OUTCOMES: Record<StatusText, TaskOutcome> = {
  open: "open", unknown: "unknown", completed: "completed",
  failed: "failed", spawnError: "failed", evidenceError: "failed",
  timeout: "timeout",
  cancelled: "cancelled", interrupted: "cancelled", notStarted: "cancelled",
};
/** The worker's reported `status` → its text. */
const TEXT_BY_STATUS: Record<string, StatusText> = {
  completed: "completed",
  failed: "failed", spawn_error: "spawnError", evidence_error: "evidenceError",
  timeout: "timeout", timed_out: "timeout",
  cancelled: "cancelled", interrupted: "interrupted", not_started: "notStarted",
};

export function taskStatus(task: FarcallRow, texts: Strings["farcall"]["status"] = ENGLISH.farcall.status): TaskStatus {
  const text: StatusText = task.status === null
    ? (task.callState === "open" ? "open" : "unknown")
    : TEXT_BY_STATUS[task.status] ?? "unknown";
  return { outcome: OUTCOMES[text], ...texts[text] };
}

export function taskStatusLabel(task: FarcallRow, texts?: Strings["farcall"]["status"]): string {
  return taskStatus(task, texts).label;
}
