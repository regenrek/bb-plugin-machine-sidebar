import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarcallRefresh } from "./farcall-refresh";
import type { FarcallRow } from "./farcall-contract";
const task: FarcallRow = { key: "w1", provider: "codex", requestedModel: "model", status: null, callState: "open", task: "Example", startedAt: null, endedAt: null, hasCwd: true };
const result = { tasks: [task] };
afterEach(() => vi.useRealTimers());

describe("coordinator refresh scheduler", () => {
  it("20 events cause one refresh per visible coordinator, with no concurrent RPCs", async () => {
    vi.useFakeTimers();
    const coordinators = Array.from({ length: 3 }, () => {
      const load = vi.fn(async () => result);
      const accept = vi.fn();
      const scheduler = createFarcallRefresh(load, accept, vi.fn());
      scheduler.start();
      return { load, accept, scheduler };
    });
    await vi.advanceTimersByTimeAsync(0);
    for (const { load, accept } of coordinators) { load.mockClear(); accept.mockClear(); }
    for (let i = 0; i < 20; i++) {
      for (const { scheduler } of coordinators) scheduler.change("workspace");
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(coordinators.every(({ load }) => load.mock.calls.length === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    for (const { load, accept, scheduler } of coordinators) {
      expect(load).toHaveBeenCalledTimes(1);
      expect(accept).toHaveBeenCalledTimes(1);
      scheduler.dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("retains invalidation during the first pending snapshot, hasCwd=%s", async (hasCwd) => {
    vi.useFakeTimers();
    let finish!: (value: typeof result) => void;
    const load = vi.fn(async () => result).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const accept = vi.fn();
    const scheduler = createFarcallRefresh(load, accept, vi.fn());
    scheduler.start();
    for (let i = 0; i < 20; i++) scheduler.change("workspace");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(1);
    finish({ tasks: [{ ...task, hasCwd }] });
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(hasCwd ? 2 : 1);
    scheduler.dispose();
  });

  it("queues task and workspace changes during a refresh as one follow-up", async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof result) => void;
    const load = vi.fn(async () => result);
    const scheduler = createFarcallRefresh(load, vi.fn(), vi.fn());
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    scheduler.change("tasks");
    await vi.advanceTimersByTimeAsync(300);
    for (let i = 0; i < 20; i++) { scheduler.change("workspace"); scheduler.change("tasks"); }
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(2);
    finish(result);
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(3);
    scheduler.dispose();
  });

  it("does not refresh confirmed rows without hasCwd, and ignores late results after unmount", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async (): Promise<typeof result> => ({ tasks: [{ ...task, hasCwd: false }] }));
    const accept = vi.fn();
    const scheduler = createFarcallRefresh(load, accept, vi.fn());
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.change("workspace");
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(1);
    let finish!: (value: typeof result) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    scheduler.change("tasks");
    await vi.advanceTimersByTimeAsync(300);
    scheduler.change("tasks");
    scheduler.dispose();
    finish(result);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
