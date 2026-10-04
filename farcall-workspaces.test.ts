import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
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

describe("shared lazy workspace cache", () => {
  type List = BbPluginApi["sdk"]["environments"]["list"];
  const asList = (fn: (...args: any[]) => Promise<WorkspaceEnvironment[]>) => fn as List;
  it("coalesces concurrent snapshots, pages once and refreshes after invalidation", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => env({ id: `env-${i}`, path: `/work/${i}` }));
    const list = vi.fn(async ({ offset = 0, limit = 200 }) => rows.slice(offset, offset + limit));
    const cache = createWorkspaceCache(asList(list));
    const snapshots = await Promise.all(Array.from({ length: 10 }, () => cache.read(true)));
    expect(list).toHaveBeenCalledTimes(2);
    expect(snapshots.every((index) => index === snapshots[0])).toBe(true);
    await cache.read(true);
    expect(list).toHaveBeenCalledTimes(2);
    cache.invalidate();
    await cache.read(true);
    expect(list).toHaveBeenCalledTimes(4);
  });
  it("a missing notification connection uses a 15s cache, never a timer", async () => {
    let now = 0;
    const list = vi.fn(async () => [env()]);
    const cache = createWorkspaceCache(asList(list), () => now);
    await cache.read(false);
    now = 14_999;
    await cache.read(false);
    expect(list).toHaveBeenCalledTimes(1);
    now++;
    await cache.read(false);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("index failures degrade to no index and recover on a later snapshot", async () => {
    let now = 0;
    const list = vi.fn(async () => [env()]).mockRejectedValueOnce(new Error("offline"));
    const cache = createWorkspaceCache(asList(list), () => now);
    expect(await cache.read(true)).toBeNull();
    expect(await cache.read(true)).toBeNull();
    now = 15_000;
    expect((await cache.read(true))?.resolve(cwd, "host-a")).toEqual(resolved);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("does not return or cache an old index invalidated during a load", async () => {
    let finish!: (rows: WorkspaceEnvironment[]) => void;
    const list = vi.fn(() => new Promise<WorkspaceEnvironment[]>((resolve) => { finish = resolve; }));
    const cache = createWorkspaceCache(asList(list));
    const old = cache.read(true);
    cache.invalidate();
    finish([env()]);
    expect(await old).toBeNull();
    const next = cache.read(true);
    finish([env({ branchName: "sol/new" })]);
    expect((await next)?.resolve(cwd, "host-a")?.branch).toBe("sol/new");
  });
});

describe("snapshot enrichment through the public SDK", () => {
  it("recognizes later environments without replay, publishes events and disposes subscriptions", async () => {
    let environments = [checkout];
    const listeners = new Map<string, (event: any) => void>();
    const unsubscribe = vi.fn();
    const list = vi.fn(async () => environments);
    const host = createFakePluginHost({ pluginId: "machine-sidebar", settings: { [FARCALL_SETTING]: true }, sdk: {
      environments: { list },
      threads: {
        get: async () => makeThreadResponse({ id: "coordinator", environmentId: "checkout" }),
        events: { list: async ({ afterSeq }) => Number(afterSeq) === 0 ? fixture : [] },
      },
      subscribe: ({ event, callback }) => { listeners.set(event, callback); return unsubscribe; },
    } });
    await plugin(host.bb);
    const read = () => host.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" }) as Promise<{ tasks: { workspace?: unknown }[] }>;
    expect((await read()).tasks[0].workspace).toEqual(fallback);
    environments = [checkout, env()];
    expect((await read()).tasks[0].workspace).toEqual(fallback);
    expect(list).toHaveBeenCalledTimes(1);
    listeners.get("environment:changed")!({});
    expect(host.harness.realtimeSignals.at(-1)?.channel).toBe(FARCALL_WORKSPACES_CHANGED);
    expect((await read()).tasks[0].workspace).toEqual(resolved);
    environments = [checkout, env({ branchName: "sol/updated" })];
    listeners.get("realtime:connection")!({ state: "connected", reconnected: true });
    expect((await read()).tasks[0].workspace).toMatchObject({ branch: "sol/updated" });
    await host.harness.setSettings({ [FARCALL_SETTING]: false });
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(await read()).toEqual({ tasks: [] });
    await host.harness.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it.each(["no-index", "no-host", "no-subscriptions"])("keeps tasks usable with %s", async (failure) => {
    const host = createFakePluginHost({ pluginId: "machine-sidebar", settings: { [FARCALL_SETTING]: true }, sdk: {
      environments: { list: async () => { if (failure === "no-index") throw Error("offline"); return [checkout, env()]; } },
      threads: {
        get: async () => { if (failure === "no-host") throw Error("gone"); return makeThreadResponse({ environmentId: "checkout" }); },
        events: { list: async ({ afterSeq }) => Number(afterSeq) === 0 ? fixture : [] },
      },
      subscribe: () => { if (failure === "no-subscriptions") throw Error("unsupported"); return () => {}; },
    } });
    await plugin(host.bb);
    const result = await host.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" });
    expect(result).toMatchObject({ tasks: [{ workspace: failure === "no-subscriptions" ? resolved : fallback }, {}] });
    await host.harness.dispose();
  });
  it("uses the coordinator's current host on each snapshot and removes listeners on disposal", async () => {
    let environmentId = "checkout";
    const unsubscribe = vi.fn();
    const host = createFakePluginHost({ pluginId: "machine-sidebar", settings: { [FARCALL_SETTING]: true }, sdk: {
      environments: { list: async () => [checkout, env(), env({ id: "remote", hostId: "host-b", path: root, isWorktree: false })] },
      threads: {
        get: async () => makeThreadResponse({ environmentId }),
        events: { list: async ({ afterSeq }) => Number(afterSeq) === 0 ? fixture : [] },
      },
      subscribe: () => unsubscribe,
    } });
    await plugin(host.bb);
    const read = () => host.harness.callRpc("farcall_tasks_get", { threadId: "coordinator" });
    expect(await read()).toMatchObject({ tasks: [{ workspace: resolved }, {}] });
    environmentId = "remote";
    expect(await read()).toMatchObject({ tasks: [{ workspace: fallback }, {}] });
    await host.harness.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
