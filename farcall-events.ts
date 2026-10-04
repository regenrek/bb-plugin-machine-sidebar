import { z } from "zod";
import type { FarcallTask } from "./farcall-contract";

// SDK 0.5.29 ThreadEventRow: item/started + item/completed, data.item.type=toolCall.
// Real codex-worker events: tests/fixtures/farcall-events.sanitized.json.
// Claude Code's documented plugin MCP naming: mcp__plugin_<plugin>_<server>__<tool>.
// BB's Claude adapter splits that into server + tool; direct MCP clients use the server key.
// https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers
const SERVERS = new Map<string, FarcallTask["provider"]>([
  ["claude_worker", "claude"], ["plugin_claude-worker_claude_worker", "claude"],
  ["codex_worker", "codex"], ["plugin_codex-worker_codex_worker", "codex"],
]);
const text = z.string().trim().min(1).max(512);
// Prompt fields stay unknown here: only taskText() reads them, and only a bounded excerpt.
const requestTaskSchema = z.object({
  task_id: text.optional(), delegation_id: text.optional(), model: text.optional(),
  prompt: z.unknown().optional(), prompt_file: z.unknown().optional(),
  cwd: z.string().min(1).max(4096).optional().catch(undefined),
});
const requestSchema = requestTaskSchema.extend({ batch_id: text.optional(), tasks: z.array(requestTaskSchema).optional() });
const resultSchema = z.object({
  task_id: text.optional(), delegation_id: text.optional(), status: text.optional(),
  session_id: text.nullish(), evidence_directory: z.string().max(4096).nullish(),
  worker_result_file: z.string().max(4096).nullish(), result_file: z.string().max(4096).nullish(),
  result: z.string().nullish(), completed_at: z.unknown().optional(),
});
const taskResultSchema = resultSchema.extend({ worker_result: resultSchema.nullish() });
const responseSchema = taskResultSchema.extend({ batch_id: text.optional(), tasks: z.array(taskResultSchema).optional() });
const eventSchema = z.object({
  seq: z.number().int(), threadId: z.string(), type: z.string(), createdAt: z.unknown().optional(),
  scope: z.object({ turnId: z.string().optional() }).optional(),
  data: z.object({ item: z.unknown().optional() }),
});
const itemSchema = z.object({
  type: z.literal("toolCall"), id: z.string(), server: z.string(), tool: z.enum(["run", "run_batch"]),
  arguments: z.unknown().optional(), result: z.unknown().optional(),
  error: z.string().optional(),
  status: z.enum(["pending", "completed", "failed", "interrupted"]),
});

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** Only result text is retained. Of the arguments, prompts enter only as taskText() excerpts. */
function excerpt(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 2000 ? `${value.slice(0, 2000)}\n[Ergebnis gekürzt]` : value;
}
function known(value: string | null | undefined): string | null {
  return value && value !== "unknown" ? value : null;
}
/** Epoch ms from BB's `createdAt` or a worker's ISO `completed_at`; anything else is unavailable. */
function time(value: unknown): number | null {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const TASK_TEXT_CHARS = 240;
/**
 * What the worker was asked to do, from the call itself: the start of an inline prompt,
 * else the coordinator's task_id, else the prompt file's name (never its contents).
 */
function taskText(task: z.infer<typeof requestTaskSchema>): string | null {
  if (typeof task.prompt === "string") {
    // Display text, not a Markdown renderer. Normalize once during event projection,
    // on a bounded prefix; paths and snake_case identifiers keep their underscores.
    const line = task.prompt.slice(0, TASK_TEXT_CHARS * 4)
      .replace(/^\s*```[^\n]*$/gm, "")
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, "")
      .replace(/!?\[([^\]\n]+)\]\([^\)\n]*\)/g, "$1")
      .replace(/[*`]|~~/g, "")
      .replace(/(^|\s)_{1,2}(\S[\s\S]*?)_{1,2}(?=\s|[.,:;!?)]|$)/g, "$1$2")
      .replace(/\s+/g, " ").trim();
    if (line) return line.length <= TASK_TEXT_CHARS ? line
      : `${line.slice(0, TASK_TEXT_CHARS).replace(/\s+\S*$/, "")}…`;
  }
  if (task.task_id) return task.task_id;
  if (typeof task.prompt_file === "string") {
    const name = task.prompt_file.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
    if (name) return name.slice(-TASK_TEXT_CHARS);
  }
  return null;
}

interface Call { keys: string[]; turnId?: string; tool: "run" | "run_batch" }

/** Incremental replay of BB events; stores display metadata only, in memory. */
export class FarcallProjection {
  private calls = new Map<string, Call>();
  private tasks = new Map<string, FarcallTask>();

  apply(input: unknown): void {
    const parsedEvent = eventSchema.safeParse(input);
    if (!parsedEvent.success) return;
    const event = parsedEvent.data;
    const at = time(event.createdAt);
    if (event.type === "turn/completed" || event.type === "system/thread/interrupted") {
      for (const call of this.calls.values()) {
        if (event.type === "turn/completed" && (!event.scope?.turnId || call.turnId !== event.scope.turnId)) continue;
        for (const key of call.keys) {
          const task = this.tasks.get(key)!;
          if (task.callState === "open") Object.assign(task, { callState: "unknown", endedAt: at });
        }
      }
      return;
    }
    if (event.type !== "item/started" && event.type !== "item/completed") return;
    const parsedItem = itemSchema.safeParse(event.data.item);
    if (!parsedItem.success) return;
    const item = parsedItem.data;
    const provider = SERVERS.get(item.server);
    if (!provider) return;
    let call = this.calls.get(item.id);
    const request = requestSchema.safeParse(json(item.arguments));
    if (!call && request.success) {
      const args = request.data;
      const requests = item.tool === "run_batch" ? args.tasks ?? [] : [args];
      const keys = requests.map((task, index) => {
        // Delegation IDs are Farcall's idempotency identity, scoped to this coordinator/provider.
        const key = `${provider}:${task.delegation_id ?? `${item.id}:${task.task_id ?? index}`}`;
        const existing = this.tasks.get(key);
        if (!existing) this.tasks.set(key, {
          key, provider, taskId: task.task_id ?? null, delegationId: task.delegation_id ?? null,
          batchId: args.batch_id ?? null, requestedModel: task.model ?? null,
          status: null, callState: "open", result: null, sessionId: null, evidence: [],
          // A completion-only replay has no start time; it stays unavailable rather than zero.
          task: taskText(task), startedAt: event.type === "item/started" ? at : null, endedAt: null,
          ...((task.cwd ?? args.cwd) ? { cwd: task.cwd ?? args.cwd } : {}),
        });
        // A new call for a delegation without a known result waits again; its first start time stays.
        else if (existing.status === null && event.type === "item/started") Object.assign(existing, { callState: "open", endedAt: null });
        return key;
      });
      call = { keys, turnId: event.scope?.turnId, tool: item.tool };
      this.calls.set(item.id, call);
    }
    if (!call || event.type !== "item/completed") return;
    const response = responseSchema.safeParse(json(item.result));
    const state = item.status === "failed" ? "failed" : item.status === "interrupted" ? "interrupted" : "returned";
    for (const key of call.keys) {
      const task = this.tasks.get(key)!;
      // Repeated cached invocations never reopen or erase an already known task result.
      if (task.status !== null && !response.success) continue;
      const settled = task.status !== null;
      task.callState = state;
      let result: z.infer<typeof taskResultSchema> | undefined;
      let batchEvidence: string | null | undefined;
      if (response.success) {
        const body = response.data;
        const matches = (entry: z.infer<typeof resultSchema>) =>
          (entry.delegation_id !== undefined || entry.task_id !== undefined) &&
          (entry.delegation_id === undefined || entry.delegation_id === task.delegationId) &&
          (entry.task_id === undefined || entry.task_id === task.taskId);
        if (call.tool === "run") result = matches(body) ? body : undefined;
        else if (body.batch_id === undefined || body.batch_id === task.batchId) {
          batchEvidence = body.evidence_directory;
          const candidates = body.tasks?.filter(matches) ?? [];
          if (candidates.length === 1) result = candidates[0];
        }
      }
      if (!result) {
        if (batchEvidence && !task.evidence.includes(batchEvidence)) task.evidence.push(batchEvidence);
        if (task.status === null) task.result = excerpt(item.error ??
          (item.status === "failed" && typeof item.result === "string" && json(item.result) === null ? item.result : null));
        if (!settled) task.endedAt = at;
        continue;
      }
      const worker = result.worker_result;
      const consistent = (!worker?.delegation_id || worker.delegation_id === task.delegationId) &&
        (!worker?.status || !result.status || worker.status === result.status);
      task.status = consistent ? result.status ?? worker?.status ?? null : null;
      // A batch returns after its slowest task; the worker's own completion time is closer.
      if (!settled) task.endedAt = (consistent ? time(worker?.completed_at) ?? time(result.completed_at) : null) ?? at;
      task.result = consistent ? excerpt(worker?.result ?? result.result) : null;
      task.sessionId = consistent ? known(result.session_id) ?? known(worker?.session_id) : null;
      task.evidence = [...new Set([
        result.evidence_directory, result.worker_result_file, result.result_file,
        batchEvidence,
        ...(consistent ? [worker?.evidence_directory, worker?.result_file] : []),
      ].filter((path): path is string => Boolean(path)))];
    }
  }

  snapshot(): FarcallTask[] {
    return [...this.tasks.values()].map((task) => ({ ...task, evidence: [...task.evidence] }));
  }
}

export function projectFarcallEvents(events: readonly unknown[]): FarcallTask[] {
  const projection = new FarcallProjection();
  // SDK pages arrive ascending; sorting also permits deterministic fixture reconstruction.
  for (const event of [...events].sort((a, b) =>
    (eventSchema.safeParse(a).data?.seq ?? 0) - (eventSchema.safeParse(b).data?.seq ?? 0))) projection.apply(event);
  return projection.snapshot();
}
