import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createWorkspaceCache, createWorkspaceIndex, workspaceFromPath, type WorkspaceEnvironment } from "./farcall-workspaces";
import { projectFarcallEvents } from "./farcall-events";
import { FARCALL_SETTING, FARCALL_WORKSPACES_CHANGED, farcallRowSchema } from "./farcall-contract";
import plugin from "./server";

const root = "/Users/dev/projects/app";
const cwd = `${root}/.claude/worktrees/w1`;
const fixture = JSON.parse(readFileSync("tests/fixtures/farcall-workspaces.sanitized.json", "utf8")).events;
const env = (patch: Partial<WorkspaceEnvironment> = {}): WorkspaceEnvironment => ({
  id: "worker", hostId: "host-a", path: cwd, branchName: "sol/w1", isWorktree: true, status: "ready", ...patch,
});
const checkout = env({ id: "checkout", path: root, isWorktree: false, branchName: "main" });
const resolved = { label: "w1", branch: "sol/w1", source: "environment" };
const fallback = { label: "w1", branch: null, source: "path" };

describe("worker workspace resolution", () => {
  it.each([
    ["exact", cwd, [env()], resolved],
    ["longest ancestor", `${cwd}/core/src`, [checkout, env(), env({ id: "nested", path: `${cwd}/core`, branchName: "sol/core" })], { label: "core", branch: "sol/core", source: "environment" }],
    ["segment boundary", `${root}/.claude/worktrees/w10/src`, [env()], { label: "w10", branch: null, source: "path" }],
    ["checkout ancestor only", `${cwd}/src`, [checkout], fallback],
    ["other host", cwd, [env({ hostId: "host-b" })], fallback],
    ["no environments", cwd, [], fallback],
    ["detached", cwd, [env({ branchName: null })], { label: "w1", branch: null, source: "environment" }],
    ["foreign path", "/opt/unregistered/project", [env()], undefined],
    ["unknown cwd", undefined, [env()], undefined],
    ["ambiguous exact", cwd, [env(), env({ id: "duplicate", branchName: "other" })], fallback],
    ["ambiguous ancestor blocks shorter", `${cwd}/nested/src`, [env(), env({ id: "a", path: `${cwd}/nested` }), env({ id: "b", path: `${cwd}/nested` })], fallback],
    ["confirmed ordinary checkout", cwd, [env({ isWorktree: false })], undefined],
    ["destroyed environment", cwd, [env({ status: "destroyed" })], fallback],
    ["trailing slash", `${cwd}/`, [env({ path: `${cwd}/` })], resolved],
    ["dot segments are not guessed", `${cwd}/../w2`, [env()], undefined],
    ["worktrees-like name is not a segment", "/tmp/not-worktrees/w1", [], undefined],
    ["Windows paths", "C:\\app\\worktrees\\w1\\src", [env({ path: "C:\\app\\worktrees\\w1" })], resolved],
  ] as const)("%s", (_name, path, environments, expected) => {
    expect(createWorkspaceIndex(environments).resolve(path, "host-a")).toEqual(expected);
  });

  it("never resolves an environment without a known coordinator host", () => {
    const index = createWorkspaceIndex([env(), checkout]);
    expect(index.hostFor("checkout")).toBe("host-a");
    expect(index.hostFor(null)).toBeUndefined();
    expect(index.resolve(cwd)).toEqual(fallback);
  });

  it("keeps fallback names as folders and accepts old rows with no new fields", () => {
    expect(workspaceFromPath(cwd)).toEqual(fallback);
    expect(workspaceFromPath("/tmp/worktrees")).toBeUndefined();
    const [task] = projectFarcallEvents(fixture);
    const { cwd: _cwd, ...old } = task;
    expect(farcallRowSchema.parse(old)).not.toHaveProperty("cwd");
    expect(farcallRowSchema.parse(old)).not.toHaveProperty("workspace");
  });

  it("projects task cwd, falls back to batch cwd and bounds malformed metadata without losing tasks", () => {
    const tasks = projectFarcallEvents(fixture);
    expect(tasks.map((task) => task.cwd)).toEqual([cwd, `${root}/.claude/worktrees/default`]);
    const copy = structuredClone(fixture);
    copy[0].data.item.arguments.tasks[0].cwd = "x".repeat(4097);
    expect(projectFarcallEvents(copy)[0].cwd).toBe(`${root}/.claude/worktrees/default`);
    delete copy[0].data.item.arguments.cwd;
    expect(projectFarcallEvents(copy)).toHaveLength(2);
    expect(projectFarcallEvents(copy)[0].cwd).toBeUndefined();
    copy[0].data.item.tool = "run";
    copy[0].data.item.arguments = { delegation_id: "single", cwd };
    expect(projectFarcallEvents(copy)[0].cwd).toBe(cwd);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
type List = BbPluginApi["sdk"]["environments"]["list"];
const asList = (fn: (...args: any[]) => Promise<WorkspaceEnvironment[]>) => fn as List;
const page = (rows: WorkspaceEnvironment[], offset = 0) => rows.slice(offset, offset + 200);
afterEach(() => vi.useRealTimers());

describe("shared lazy workspace cache", () => {
  it("coalesces concurrent snapshots and reads through short server-capped pages until empty", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => env({ id: `env-${i}`, path: `/work/${i}` }));
    const list = vi.fn(async ({ offset = 0 }) => rows.slice(offset, offset + 2));
    const cache = createWorkspaceCache(asList(list));
    const snapshots = await Promise.all(Array.from({ length: 10 }, () => cache.read(true)));
    expect(list.mock.calls.map(([args]) => args.offset)).toEqual([0, 2, 4, 5]);
    expect(snapshots.every((index) => index === snapshots[0])).toBe(true);
    await cache.read(true);
    expect(list).toHaveBeenCalledTimes(4);
    cache.invalidate();
    await cache.read(true);
    expect(list).toHaveBeenCalledTimes(8);
  });
  it("uses a 15s cache without notifications and retries metadata failures on demand", async () => {
    let now = 0;
    const list = vi.fn(async ({ offset = 0 }) => page([env()], offset)).mockRejectedValueOnce(Error("offline"));
    const cache = createWorkspaceCache(asList(list), () => now);
    expect(await cache.read(false)).toBeNull();
    await cache.read(false);
    expect(list).toHaveBeenCalledTimes(1);
    now = 15_000;
    expect((await cache.read(false))?.resolve(cwd, "host-a")).toEqual(resolved);
    now = 29_999;
    await cache.read(false);
    expect(list).toHaveBeenCalledTimes(3);
    now++;
    await cache.read(false);
    expect(list).toHaveBeenCalledTimes(5);
  });
  it("reloads a dirty first index in the same promise, without parallel loads or folder flicker", async () => {
    const first = deferred<WorkspaceEnvironment[]>();
    const list = vi.fn(async ({ offset = 0 }) => page([env({ branchName: "sol/new" })], offset))
      .mockImplementationOnce(() => first.promise);
    const cache = createWorkspaceCache(asList(list));
    const reads = [cache.read(true)];
    await Promise.resolve();
    cache.invalidate();
    reads.push(cache.read(true));
    expect(list).toHaveBeenCalledTimes(1);
    first.resolve([env()]);
    const indexes = await Promise.all(reads);
    expect(indexes.every((index) => index?.resolve(cwd, "host-a")?.branch === "sol/new")).toBe(true);
    expect(list.mock.calls.map(([args]) => args.offset)).toEqual([0, 0, 1]);
  });
  it("retains the last good index after an outage or three continuously dirty passes", async () => {
    let invalidateWhileReading = false;
    const list = vi.fn(async ({ offset = 0 }) => {
      if (invalidateWhileReading) cache.invalidate();
      return page([env()], offset);
    });
    const cache = createWorkspaceCache(asList(list));
    await cache.read(true);
    cache.invalidate();
    list.mockRejectedValueOnce(Error("offline"));
    expect((await cache.read(true))?.resolve(cwd, "host-a")).toEqual(resolved);
    cache.invalidate();
    invalidateWhileReading = true;
    const before = list.mock.calls.length;
    expect((await cache.read(true))?.resolve(cwd, "host-a")).toEqual(resolved);
    expect(list.mock.calls.length - before).toBe(3);
  });
  it("a joining reader retries an unresolved generation once after the shared load", async () => {
    const first = deferred<WorkspaceEnvironment[]>();
    let calls = 0;
    const list = vi.fn(async ({ offset = 0 }) => {
      calls++;
      if (calls <= 3) cache.invalidate();
      if (calls === 1) return first.promise;
      return page([env({ branchName: "sol/latest" })], offset);
    });
    const cache = createWorkspaceCache(asList(list));
    const owner = cache.read(true);
    await Promise.resolve();
    const joined = cache.read(true);
    first.resolve([env()]);
    expect(await owner).toBeNull();
    expect((await joined)?.resolve(cwd, "host-a")?.branch).toBe("sol/latest");
    expect(calls).toBe(5); // three dirty passes, then one complete pagination
  });

  it("a joining reader cannot retry an endlessly dirty load more than once", async () => {
    const first = deferred<WorkspaceEnvironment[]>();
    const list = vi.fn(async () => { cache.invalidate(); return list.mock.calls.length === 1 ? first.promise : [env()]; });
    const cache = createWorkspaceCache(asList(list));
    const owner = cache.read(true);
    await Promise.resolve();
    const joined = Array.from({ length: 10 }, () => cache.read(true));
    first.resolve([env()]);
    await Promise.all([owner, ...joined]);
    expect(list).toHaveBeenCalledTimes(6);
  });

  it.each(["repeat", "overflow"])("stops unsafe %s pagination and retains the good index", async (kind) => {
    const list = vi.fn(async ({ offset = 0 }) => page([env()], offset));
    const warn = vi.fn();
    const unsettled = vi.fn();
    const cache = createWorkspaceCache(asList(list), Date.now, { warn, unsettled });
    const good = await cache.read(true);
    cache.invalidate();
    list.mockClear();
    list.mockImplementation(async ({ offset = 0 }) => kind === "repeat" ? [env()] :
      Array.from({ length: 200 }, (_, i) => env({ id: `env-${offset + i}` })));
    expect(await cache.read(true)).toBe(good);
    expect(list).toHaveBeenCalledTimes(kind === "repeat" ? 2 : 51);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(unsettled).toHaveBeenCalledTimes(1);
  });

  it.each(["clear", "dispose"] as const)("%s during pagination blocks stale fills and further pages", async (action) => {
    const first = deferred<WorkspaceEnvironment[]>();
    const list = vi.fn(async ({ offset = 0 }) => page([env({ branchName: "sol/new" })], offset))
      .mockImplementationOnce(() => first.promise);
    const cache = createWorkspaceCache(asList(list));
    const old = cache.read(true);
    await Promise.resolve();
    cache[action]();
    const next = cache.read(true);
    expect(list).toHaveBeenCalledTimes(1);
    first.resolve([env()]);
    expect(await old).toBeNull();
    const index = await next;
    if (action === "clear") expect(index?.resolve(cwd, "host-a")?.branch).toBe("sol/new");
    else { expect(index).toBeNull(); expect(list).toHaveBeenCalledTimes(1); }
  });
});

function setup(options: { cwd?: string; subscribeFails?: () => boolean } = {}) {
  let environments = [checkout, env()];
  let environmentId: string | null = "checkout";
  const events = structuredClone(fixture);
  if (options.cwd !== undefined) {
    events[0].data.item.arguments.cwd = options.cwd;
    events[0].data.item.arguments.tasks.forEach((task: { cwd?: string }) => { task.cwd = options.cwd; });
  }
  const listeners = new Map<string, (event: any) => void>();
  const unsubscribe = vi.fn();
  const list = vi.fn(async ({ offset = 0 }) => page(environments, offset));
  const get = vi.fn(async () => makeThreadResponse({ id: "coordinator", environmentId }));
  const eventList = vi.fn(async ({ afterSeq }: { afterSeq?: string }) => Number(afterSeq) === 0 ? events : []);
  const subscribe = vi.fn(({ event, callback }: any) => {
    if (options.subscribeFails?.()) throw Error("unavailable");
    listeners.set(event, callback);
    return unsubscribe;
  });
  const host = createFakePluginHost({ pluginId: "machine-sidebar", settings: { [FARCALL_SETTING]: true }, sdk: {
    environments: { list }, threads: { get, events: { list: eventList } }, subscribe,
  } });
  return { host, listeners, unsubscribe, list, get, eventList, subscribe,
    environments: (next: WorkspaceEnvironment[]) => { environments = next; },
    hostEnvironment: (id: string | null) => { environmentId = id; },
    read: () => host.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" }) as Promise<{ tasks: { hasCwd: boolean; workspace?: unknown }[] }>,
  };
}

describe("snapshot enrichment lifecycle and bursts", () => {
  it("publishes at least once per 1.5s during five seconds of continuous changes", async () => {
    vi.useFakeTimers();
    const s = setup();
    await plugin(s.host.bb);
    await s.read();
    for (let i = 0; i < 50; i++) {
      s.listeners.get("environment:changed")!({});
      await vi.advanceTimersByTimeAsync(100);
      expect(s.host.harness.realtimeSignals.length).toBe(Math.floor((i + 1) / 15));
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(s.host.harness.realtimeSignals).toHaveLength(4);
    await s.host.harness.dispose();
  });

  it.each(["failure", "dirty"])("publishes one recovery after 15s for a %s load, updating stale labels", async (kind) => {
    vi.useFakeTimers();
    const s = setup();
    await plugin(s.host.bb);
    await s.read();
    const changed = s.listeners.get("environment:changed")!;
    changed({});
    await vi.advanceTimersByTimeAsync(300);
    if (kind === "failure") s.list.mockRejectedValueOnce(Error("offline"));
    else {
      const dirtyPage = async () => {
        changed({});
        await new Promise((resolve) => setTimeout(resolve, 301));
        return [checkout, env()];
      };
      for (let i = 0; i < 3; i++) s.list.mockImplementationOnce(dirtyPage);
    }
    const pending = s.read();
    await vi.advanceTimersByTimeAsync(kind === "dirty" ? 903 : 0);
    expect((await pending).tasks[0].workspace).toEqual(resolved);
    const before = s.host.harness.realtimeSignals.length;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(s.host.harness.realtimeSignals).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.host.harness.realtimeSignals).toHaveLength(before + 1);
    s.environments([checkout, env({ branchName: "sol/recovered" })]);
    expect((await s.read()).tasks[0].workspace).toMatchObject({ branch: "sol/recovered" });
    expect(vi.getTimerCount()).toBe(0);
    await s.host.harness.dispose();
  });

  it("does not repeat a failed recovery or duplicate its timer across readers", async () => {
    vi.useFakeTimers();
    const s = setup();
    await plugin(s.host.bb);
    s.list.mockRejectedValue(Error("offline"));
    await Promise.all([s.read(), s.read(), s.read()]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.host.harness.realtimeSignals).toHaveLength(1);
    await Promise.all([s.read(), s.read()]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.host.harness.realtimeSignals).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await s.host.harness.dispose();
  });

  it.each(["disable", "dispose", "success"])("cancels pending recovery on %s", async (action) => {
    vi.useFakeTimers();
    const s = setup();
    await plugin(s.host.bb);
    s.list.mockRejectedValueOnce(Error("offline"));
    await s.read();
    expect(vi.getTimerCount()).toBe(1);
    if (action === "disable") await s.host.harness.setSettings({ [FARCALL_SETTING]: false });
    else if (action === "dispose") await s.host.harness.dispose();
    else {
      s.listeners.get("environment:changed")!({});
      await vi.advanceTimersByTimeAsync(300);
      await s.read();
    }
    const before = s.host.harness.realtimeSignals.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.host.harness.realtimeSignals).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
    if (action !== "dispose") await s.host.harness.dispose();
  });

  it("bundles 20 changes into one invalidation, a single index reload and stable snapshots", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.environments([checkout]);
    await plugin(s.host.bb);
    expect((await s.read()).tasks[0].workspace).toEqual(fallback);
    s.environments([checkout, env()]);
    for (let i = 0; i < 20; i++) {
      s.listeners.get("environment:changed")!({});
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(s.host.harness.realtimeSignals).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.host.harness.realtimeSignals).toHaveLength(1);
    expect(s.host.harness.realtimeSignals[0].channel).toBe(FARCALL_WORKSPACES_CHANGED);
    const results = await Promise.all([s.read(), s.read(), s.read()]);
    expect(results.every((result) => JSON.stringify(result.tasks[0].workspace) === JSON.stringify(resolved))).toBe(true);
    expect(s.list.mock.calls.map(([args]) => args.offset)).toEqual([0, 1, 0, 2]);
    s.listeners.get("realtime:connection")!({ state: "disconnected" });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.host.harness.realtimeSignals).toHaveLength(1);
    s.listeners.get("realtime:connection")!({ state: "connected" });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.host.harness.realtimeSignals).toHaveLength(2);
    await s.host.harness.dispose();
    expect(s.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it.each(["events", "thread", "index"] as const)("disable or dispose while awaiting %s cannot subscribe, fill caches or publish later", async (stage) => {
    for (const action of ["disable", "dispose"] as const) {
      vi.useFakeTimers();
      const s = setup();
      const gate = deferred<any>();
      if (stage === "events") s.eventList.mockImplementationOnce(() => gate.promise);
      if (stage === "thread") s.get.mockImplementationOnce(() => gate.promise);
      if (stage === "index") s.list.mockImplementationOnce(() => gate.promise);
      await plugin(s.host.bb);
      const pending = s.read().catch(() => ({ tasks: [] })); // disposed harness may reject the RPC response
      await vi.advanceTimersByTimeAsync(0);
      if (action === "disable") await s.host.harness.setSettings({ [FARCALL_SETTING]: false });
      else await s.host.harness.dispose();
      const subscriptions = s.subscribe.mock.calls.length;
      const calls = s.host.harness.sdk.calls.length;
      gate.resolve(stage === "events" ? fixture : stage === "thread" ? makeThreadResponse({ environmentId: "checkout" }) : [checkout, env()]);
      expect(await pending).toEqual({ tasks: [] });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(s.subscribe).toHaveBeenCalledTimes(subscriptions);
      expect(s.host.harness.sdk.calls).toHaveLength(calls);
      expect(s.unsubscribe).toHaveBeenCalledTimes(subscriptions);
      expect(s.host.harness.realtimeSignals).toHaveLength(0);
      if (action === "disable") {
        await s.host.harness.setSettings({ [FARCALL_SETTING]: true });
        expect((await s.read()).tasks[0].workspace).toEqual(resolved);
        await s.host.harness.dispose();
      }
      vi.useRealTimers();
    }
  });

  it("clears queued debounce callbacks and rejects stale subscription callbacks on shutdown", async () => {
    vi.useFakeTimers();
    const s = setup();
    await plugin(s.host.bb);
    await s.read();
    const changed = s.listeners.get("environment:changed")!;
    changed({});
    await s.host.harness.setSettings({ [FARCALL_SETTING]: false });
    changed({});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.host.harness.realtimeSignals).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await s.host.harness.dispose();
  });

  it.each(["relative/path", "/project/../worktrees/w1", "", "/invalid\u0000path"])("does no metadata work for unresolvable cwd %j", async (cwd) => {
    const s = setup({ cwd });
    await plugin(s.host.bb);
    const result = await s.read();
    expect(result.tasks.every((task) => task.hasCwd === false)).toBe(true);
    expect(s.subscribe).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    expect(s.list).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('"cwd"');
    await s.host.harness.dispose();
  });

  it("retries subscription failure only on a later snapshot after 60s", async () => {
    vi.useFakeTimers();
    let fails = true;
    const s = setup({ subscribeFails: () => fails });
    await plugin(s.host.bb);
    expect((await s.read()).tasks[0].workspace).toEqual(resolved);
    expect(s.subscribe).toHaveBeenCalledTimes(1);
    fails = false;
    await vi.advanceTimersByTimeAsync(59_999);
    await s.read();
    expect(s.subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await s.read();
    expect(s.subscribe).toHaveBeenCalledTimes(3);
    await s.host.harness.dispose();
    expect(s.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("preserves tasks on missing metadata and resolves the current coordinator host", async () => {
    const s = setup();
    await plugin(s.host.bb);
    s.list.mockRejectedValueOnce(Error("offline"));
    expect((await s.read()).tasks[0].workspace).toEqual(fallback);
    s.hostEnvironment(null);
    expect((await s.read()).tasks[0].workspace).toEqual(fallback);
    await s.host.harness.dispose();
  });
});
