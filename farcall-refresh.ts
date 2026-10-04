import { createBoundedDebounce } from "./lib/bounded-debounce";
import type { FarcallRow } from "./farcall-contract";

/** Compare the bounded, JSON-only wire rows once per snapshot, not per render. */
export function sameFarcallRows(previous: FarcallRow[], next: FarcallRow[]): boolean {
  return previous === next || JSON.stringify(previous) === JSON.stringify(next);
}

/** One scheduler per visible coordinator, not per worker. No periodic polling. */
export function createFarcallRefresh(
  load: () => Promise<{ tasks: FarcallRow[] }>,
  accept: (tasks: FarcallRow[]) => void,
  failed: () => void,
) {
  let alive = true;
  let pending = false;
  let hasCwd: boolean | undefined;
  let tasksDirty = false;
  let workspaceDirty = false;
  let refreshDue = false;
  const needsLoad = () => tasksDirty || (workspaceDirty && hasCwd !== false);
  const debounce = createBoundedDebounce(() => { refreshDue = true; void run(); });
  const run = async () => {
    if (!alive || pending || !needsLoad()) return;
    refreshDue = false;
    tasksDirty = false;
    workspaceDirty = false;
    pending = true;
    try {
      const result = await load();
      if (!alive) return;
      hasCwd = result.tasks.some((task) => task.hasCwd !== false);
      accept(result.tasks);
    } catch {
      if (alive) failed();
    } finally {
      pending = false;
      // Events during the first load are retained until hasCwd is known.
      if (alive && needsLoad() && refreshDue) void run();
    }
  };
  return {
    start() { if (alive) { tasksDirty = true; void run(); } },
    change(kind: "tasks" | "workspace") {
      if (!alive || (kind === "workspace" && hasCwd === false && !pending)) return;
      if (kind === "tasks") tasksDirty = true;
      else workspaceDirty = true;
      debounce.mark();
    },
    dispose() { alive = false; debounce.cancel(); },
  };
}
