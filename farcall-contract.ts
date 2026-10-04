import { z } from "zod";

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

const OPEN: TaskStatus = { outcome: "open", label: "Call open", short: "open" };
const UNKNOWN: TaskStatus = { outcome: "unknown", label: "Outcome unknown", short: "unknown" };
const failed = (label: string): TaskStatus => ({ outcome: "failed", label, short: "failed" });
const TIMEOUT: TaskStatus = { outcome: "timeout", label: "Timed out", short: "timeout" };
const cancelled = (label: string, short: string): TaskStatus => ({ outcome: "cancelled", label, short });
const STATUSES: Record<string, TaskStatus> = {
  completed: { outcome: "completed", label: "Completed", short: "done" },
  failed: failed("Failed"), spawn_error: failed("Failed to start"), evidence_error: failed("Evidence error"),
  timeout: TIMEOUT, timed_out: TIMEOUT,
  cancelled: cancelled("Cancelled", "cancelled"), interrupted: cancelled("Interrupted", "interrupted"),
  not_started: cancelled("Not started", "not started"),
};

export function taskStatus(task: FarcallRow): TaskStatus {
  if (task.status === null) return task.callState === "open" ? OPEN : UNKNOWN;
  return STATUSES[task.status] ?? UNKNOWN;
}

export function taskStatusLabel(task: FarcallRow): string {
  return taskStatus(task).label;
}
