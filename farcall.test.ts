import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server";
import { createFarcallReader } from "./farcall-reader";
import { projectFarcallEvents, FarcallProjection } from "./farcall-events";
import { FARCALL_CHANGED, FARCALL_SETTING, taskStatusLabel } from "./farcall-contract";

type ThreadEventRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];
type EventListArgs = Parameters<BbPluginApi["sdk"]["threads"]["events"]["list"]>[0];
const fixture = JSON.parse(readFileSync("tests/fixtures/farcall-events.sanitized.json", "utf8")).events as ThreadEventRow[];
const args = { delegation_id: "one", model: "requested-model", prompt: "PROMPT MUST NOT BE COPIED" };
function event(seq: number, type = "item/started", patch: Record<string, unknown> = {}) {
  return { seq, threadId: "coordinator", scope: { kind: "turn", turnId: "turn" }, type, data: {
    item: { type: "toolCall", id: "call", server: "plugin_codex-worker_codex_worker", tool: "run", arguments: args,
      status: type === "item/started" ? "pending" : "completed", ...patch },
  } };
}
const done = (patch: Record<string, unknown> = {}) => event(2, "item/completed", {
  result: JSON.stringify({ delegation_id: "one", status: "completed", result: "Result", session_id: "session", evidence_directory: "/evidence" }), ...patch,
});

describe("Farcall event projection", () => {
  it("replays all 42 real events including run, run_batch and rejected calls without prompt copies", () => {
    expect(fixture).toHaveLength(42);
    const tasks = projectFarcallEvents(fixture);
    expect(tasks.length).toBeGreaterThan(30);
    expect(new Set(tasks.map((task) => task.key)).size).toBe(tasks.length);
    expect(tasks.find((task) => task.delegationId === "tgb-review-r1")).toMatchObject({ provider: "codex", requestedModel: "gpt-6-astra", status: "completed" });
    expect(tasks.find((task) => task.taskId === "w5-sidebar")).toMatchObject({ batchId: "tgb-v21-phaseA", status: "completed" });
    const rejected = tasks.find((task) => task.delegationId === "tgb-w1-p1")!;
    expect(rejected).toMatchObject({ callState: "failed", status: null });
    expect(rejected.result).toContain("Batch requires distinct");
    expect(taskStatusLabel(rejected)).toBe("Outcome unknown");
    expect(JSON.stringify(tasks)).not.toContain('"prompt"');
    const review = tasks.find((task) => task.delegationId === "tgb-review-r1")!;
    expect(review.task).toMatch(/^Recheck round 1\. /);
    expect(review.startedAt).toBeTypeOf("number");
    expect(review.endedAt! - review.startedAt!).toBeGreaterThan(0);
  });

  it("derives a bounded task text from the call: inline prompt excerpt, else task_id, else the prompt file name", () => {
    const task = (patch: Record<string, unknown>) => projectFarcallEvents([event(1, "item/started", { arguments: { delegation_id: "one", ...patch } })])[0].task;
    const prompt = `Build   the\n\nsidebar ${"word ".repeat(400)}SECRET-TAIL`;
    const excerpt = task({ prompt, task_id: "w5-sidebar" })!;
    expect(excerpt.startsWith("Build the sidebar word")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(241);
    expect(excerpt.endsWith("word…")).toBe(true);
    expect(excerpt).not.toContain("SECRET-TAIL");
    expect(task({ prompt: "   ", task_id: "w5-sidebar" })).toBe("w5-sidebar");
    // Only the name: prompt files are never opened.
    expect(task({ prompt_file: "/Users/me/repo/artifacts/second-opinion/prompt.md" })).toBe("second-opinion/prompt.md");
    expect(task({ prompt: { nested: true } })).toBeNull();
    expect(task({ prompt: "## Integration **Part 2**\n1. Merge `opus/agentic-shell-chat`.\n- Read [brief](https://example.test/brief)." }))
      .toBe("Integration Part 2 Merge opus/agentic-shell-chat. Read brief.");
    expect(task({ prompt: "Review __the changes__ and _tests_ in src/my_file.ts; **unfinished" }))
      .toBe("Review the changes and tests in src/my_file.ts; unfinished");
  });

  it("measures call time from BB event times without resetting it on retries or replays", () => {
    const at = (e: ReturnType<typeof event>, createdAt: number) => ({ ...e, createdAt });
    const [timed] = projectFarcallEvents([at(event(1), 1_000), at(done(), 61_000)]);
    expect(timed).toMatchObject({ startedAt: 1_000, endedAt: 61_000 });
    // A batch returns with its slowest task; the worker's own completion time wins.
    const batch = { batch_id: "b", tasks: [{ task_id: "a", delegation_id: "a-d" }] };
    const [worker] = projectFarcallEvents([at(event(1, "item/started", { tool: "run_batch", arguments: batch }), Date.parse("2026-10-02T05:00:00Z")),
      at(done({ tool: "run_batch", arguments: batch, result: { batch_id: "b", tasks: [{ task_id: "a", delegation_id: "a-d", status: "completed",
        worker_result: { delegation_id: "a-d", status: "completed", completed_at: "2026-10-02T05:10:00Z" } }] } }), Date.parse("2026-10-02T05:40:00Z"))]);
    expect(worker.endedAt! - worker.startedAt!).toBe(10 * 60_000);
    // Missing BB times stay unavailable instead of becoming zero.
    expect(projectFarcallEvents([event(1), done()])[0]).toMatchObject({ startedAt: null, endedAt: null });
    expect(projectFarcallEvents([at(done(), 5_000)])[0]).toMatchObject({ startedAt: null, endedAt: 5_000 });
    // Turn ended without a return: the wait ended then, the outcome is unknown.
    const turnEnd = { seq: 3, threadId: "coordinator", scope: { turnId: "turn" }, type: "turn/completed", createdAt: 9_000, data: {} };
    expect(projectFarcallEvents([at(event(1), 1_000), turnEnd])[0]).toMatchObject({ callState: "unknown", startedAt: 1_000, endedAt: 9_000 });
    // The coordinator asks for the same delegation again: open again, original start kept.
    const retry = at(event(4, "item/started", { id: "retry" }), 20_000);
    expect(projectFarcallEvents([at(event(1), 1_000), turnEnd, retry])[0]).toMatchObject({ callState: "open", startedAt: 1_000, endedAt: null });
    expect(projectFarcallEvents([at(event(1), 1_000), turnEnd, retry, at({ ...done({ id: "retry" }), seq: 5 }, 30_000)])[0])
      .toMatchObject({ status: "completed", startedAt: 1_000, endedAt: 30_000 });
    // A cached replay of a known result neither reopens nor moves the end.
    const replayed = projectFarcallEvents([at(event(1), 1_000), at(done(), 61_000), at(event(3, "item/started", { id: "again" }), 90_000),
      at({ ...done({ id: "again" }), seq: 4 }, 91_000)])[0];
    expect(replayed).toMatchObject({ callState: "returned", startedAt: 1_000, endedAt: 61_000 });
  });

  it.each(["claude_worker", "plugin_claude-worker_claude_worker", "codex_worker", "plugin_codex-worker_codex_worker"])("recognizes documented MCP server %s", (server) => {
    expect(projectFarcallEvents([event(1, "item/started", { server })])[0].provider).toBe(server.includes("claude") ? "claude" : "codex");
  });
  it("ignores unrelated servers, preflight, non-tool rows and malformed arguments", () => {
    expect(projectFarcallEvents([
      event(1, "item/started", { server: "other_codex_worker" }), event(2, "item/started", { tool: "preflight" }),
      event(3, "item/started", { type: "delegation" }), event(4, "item/started", { arguments: null }),
    ])).toEqual([]);
  });
  it("shows open calls without claiming a running process; a settled turn with no return is unknown", () => {
    const open = projectFarcallEvents([event(1)])[0];
    expect(taskStatusLabel(open)).toBe("Call open");
    const closed = projectFarcallEvents([event(1), { seq: 3, threadId: "coordinator", scope: { turnId: "turn" }, type: "turn/completed", data: {} }])[0];
    expect(taskStatusLabel(closed)).toBe("Outcome unknown");
    expect(projectFarcallEvents([done({ result: undefined })])[0].status).toBeNull();
  });
  it("never promotes a successful tool/batch return to per-task success, and matches by IDs rather than order", () => {
    const batch = { batch_id: "batch", tasks: [{ task_id: "a", delegation_id: "a-d", model: "m1" }, { task_id: "b", delegation_id: "b-d", model: "m2" }, { task_id: "c", delegation_id: "c-d" }] };
    const tasks = projectFarcallEvents([event(1, "item/started", { tool: "run_batch", arguments: batch }),
      done({ tool: "run_batch", arguments: batch, result: JSON.stringify({ batch_id: "batch", status: "completed", tasks: [
        { task_id: "b", delegation_id: "b-d", status: "failed", worker_result: { delegation_id: "b-d", status: "failed", result: "Failure", session_id: "s-b", result_file: "/result-b" } },
        { task_id: "a", delegation_id: "a-d", status: "completed", session_id: "s-a", evidence_directory: "/evidence-a" },
      ] }) })]);
    expect(tasks.map((task) => task.status)).toEqual(["completed", "failed", null]);
    expect(tasks[1]).toMatchObject({ requestedModel: "m2", result: "Failure", sessionId: "s-b", evidence: ["/result-b"] });
    expect(taskStatusLabel(tasks[2])).toBe("Outcome unknown");
  });
  it("preserves a result across identical repeats and reconstructs identically after reload", () => {
    const events = [event(1), done(), event(3, "item/started", { id: "repeat" }), { ...done({ id: "repeat" }), seq: 4 }];
    const projection = new FarcallProjection();
    for (const e of events) projection.apply(e);
    for (const e of events) projection.apply(e);
    expect(projection.snapshot()).toEqual(projectFarcallEvents([...events].reverse()));
    expect(projection.snapshot()).toHaveLength(1);
    expect(projection.snapshot()[0].callState).toBe("returned");
    expect(Object.values({ ...projection.snapshot()[0], task: null }).join()).not.toContain("PROMPT MUST NOT BE COPIED");
  });
  it("uses unknown for ambiguous or mismatched results, preserves raw task status, bounds result text", () => {
    expect(projectFarcallEvents([done({ result: { delegation_id: "wrong", status: "completed" } })])[0].status).toBeNull();
    const ambiguous = { delegation_id: "one", status: "completed", worker_result: { status: "failed" } };
    expect(projectFarcallEvents([done({ result: ambiguous })])[0].status).toBeNull();
    const missing = projectFarcallEvents([done({ result: { delegation_id: "one", status: "missing_result", session_id: "unknown", result: "x".repeat(2500) } })])[0];
    expect(missing.sessionId).toBeNull();
    expect(taskStatusLabel(missing)).toBe("Outcome unknown");
    expect(missing.result?.length).toBeLessThan(2100);
  });
  it("supports completion-only replay and interrupted calls with error text", () => {
    expect(projectFarcallEvents([done()])[0]).toMatchObject({ status: "completed", sessionId: "session" });
    const interrupted = projectFarcallEvents([done({ status: "interrupted", error: "Connection lost", result: null })])[0];
    expect(interrupted).toMatchObject({ callState: "interrupted", result: "Connection lost", status: null });
    expect(taskStatusLabel(interrupted)).toBe("Outcome unknown");
  });
  it("rejects duplicate task-result matches as ambiguous while retaining the batch evidence reference", () => {
    const batch = { batch_id: "batch", tasks: [{ task_id: "a", delegation_id: "one" }] };
    const result = { batch_id: "batch", evidence_directory: "/batch-evidence", tasks: [
      { task_id: "a", delegation_id: "one", status: "completed" }, { task_id: "a", delegation_id: "one", status: "failed" },
    ] };
    const task = projectFarcallEvents([done({ tool: "run_batch", arguments: batch, result })])[0];
    expect(task.status).toBeNull();
    expect(task.evidence).toEqual(["/batch-evidence"]);
  });
});

describe("Farcall SDK reader and backend", () => {
  const list = (events: readonly unknown[]) => vi.fn(async ({ afterSeq, limit }: EventListArgs) => {
    const pageSize = Number(limit ?? "100");
    if (pageSize > 100) throw new Error("Thread event limit cannot exceed 100");
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Invalid thread event limit");
    return events.filter((e) => (e as { seq: number }).seq > Number(afterSeq ?? 0)).slice(0, pageSize) as ThreadEventRow[];
  });

  it("paginates through history and reads incrementally; a new reader rebuilds the same tasks", async () => {
    const sdkList = list(fixture);
    const reader = createFarcallReader(sdkList);
    const first = await reader.read("coordinator");
    expect(first.tasks).toEqual(projectFarcallEvents(fixture));
    expect(sdkList.mock.calls.length).toBe(2);
    expect(sdkList.mock.calls[0][0]).toMatchObject({ afterSeq: "0", limit: "100", types: ["item/started", "item/completed", "turn/completed", "system/thread/interrupted"] });
    await reader.read("coordinator");
    expect(sdkList.mock.calls).toHaveLength(3);
    expect(await createFarcallReader(list(fixture)).read("coordinator")).toEqual(first);
  });
  it("enforces BB's 100-event limit and reconstructs results across multiple cursor pages", async () => {
    const history = Array.from({ length: 125 }, (_, index) => {
      const delegation_id = `task-${index}`;
      const patch = { id: `call-${index}`, arguments: { ...args, delegation_id } };
      return [event(index * 2 + 1, "item/started", patch), event(index * 2 + 2, "item/completed", {
        ...patch, result: JSON.stringify({ delegation_id, status: "completed", session_id: `session-${index}` }),
      })];
    }).flat();
    const sdkList = list(history);
    await expect(sdkList({ threadId: "coordinator", limit: "500" })).rejects.toThrow("Thread event limit cannot exceed 100");
    sdkList.mockClear();
    const reader = createFarcallReader(sdkList);
    const first = await reader.read("coordinator");
    expect(first.tasks).toHaveLength(125);
    expect(first.tasks.every((task) => task.status === "completed")).toBe(true);
    expect(sdkList.mock.calls.map(([call]) => call.afterSeq)).toEqual(["0", "100", "200", "250"]);
    expect(sdkList.mock.calls.every(([call]) => call.limit === "100")).toBe(true);
    expect(await reader.read("coordinator")).toEqual(first);
    expect(sdkList.mock.calls.at(-1)?.[0].afterSeq).toBe("250");
    expect(await createFarcallReader(list(history)).read("coordinator")).toEqual(first);
  });
  it("rejects a stalled cursor instead of looping, and recovers from read failures without retry timers", async () => {
    const stalled = vi.fn(async () => [event(1)] as unknown as ThreadEventRow[]);
    await expect(createFarcallReader(stalled).read("coordinator")).rejects.toThrow("cursor");
    expect(stalled).toHaveBeenCalledTimes(2);
    const sdkList = list([event(1), done()]);
    sdkList.mockRejectedValueOnce(new Error("offline"));
    const reader = createFarcallReader(sdkList);
    await expect(reader.read("coordinator")).rejects.toThrow("offline");
    expect(sdkList).toHaveBeenCalledTimes(1);
    expect((await reader.read("coordinator")).tasks[0].status).toBe("completed");
  });
  it("defaults off, uses native settings, and performs no event reads or Farcall notifications while off", async () => {
    const host = createFakePluginHost({ pluginId: "team-sidebar" });
    await plugin(host.bb);
    expect(host.harness.registrations.settingsDescriptors[FARCALL_SETTING]).toMatchObject({ type: "boolean", default: false });
    expect(await host.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" })).toEqual({ tasks: [] });
    await host.harness.emitThreadEvent("experimental_thread.events", { thread: makeThreadResponse({ id: "coordinator" }), sequence: 10 });
    expect(host.harness.sdk.calls).toEqual([]);
    expect(host.harness.realtimeSignals).toEqual([]);
    await host.harness.dispose();
  });
  it("uses only SDK event reads, publishes invalidations while enabled, and rebuilds after plugin reload", async () => {
    const sdkList = list(fixture);
    const host = createFakePluginHost({ pluginId: "team-sidebar", settings: { [FARCALL_SETTING]: true }, sdk: { threads: { events: { list: sdkList } } } });
    await plugin(host.bb);
    const first = await host.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" });
    const rows = (first as { tasks: Record<string, unknown>[] }).tasks;
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["callState", "endedAt", "key", "provider", "requestedModel", "startedAt", "status", "task"]);
    }
    // Result text, sessions and evidence remain in BB history, not each sidebar refresh.
    expect(JSON.stringify(first).length).toBeLessThan(JSON.stringify({ tasks: projectFarcallEvents(fixture) }).length);
    await host.harness.emitThreadEvent("experimental_thread.events", { thread: makeThreadResponse({ id: "coordinator" }), sequence: 10 });
    expect(host.harness.realtimeSignals.at(-1)).toMatchObject({ channel: FARCALL_CHANGED, payload: { threadId: "coordinator", sequence: 10 } });
    expect(sdkList.mock.calls).toHaveLength(2); // Notification itself only invalidates; it reads nothing.
    expect(new Set(host.harness.sdk.calls.map((call) => call.path))).toEqual(new Set(["threads.events.list"]));
    const next = await host.harness.reload(plugin);
    expect(await next.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" })).toEqual(first);
    await next.harness.setSettings({ [FARCALL_SETTING]: false });
    const count = sdkList.mock.calls.length;
    expect(await next.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" })).toEqual({ tasks: [] });
    expect(sdkList).toHaveBeenCalledTimes(count);
    await next.harness.setSettings({ [FARCALL_SETTING]: true });
    expect(await next.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" })).toEqual(first);
    expect(sdkList.mock.calls[count][0]).toMatchObject({ afterSeq: "0" }); // Disabling cleared the in-memory projection.
    await next.harness.dispose();
  });
});
