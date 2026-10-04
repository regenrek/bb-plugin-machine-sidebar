import type { FarcallRow } from "./farcall-contract";

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const needsLoad = () => tasksDirty || (workspaceDirty && hasCwd !== false);
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void run(); }, 300);
  };
  const run = async () => {
    if (!alive || pending || !needsLoad()) return;
    tasksDirty = false;
    workspaceDirty = false;
    pending = true;
    try {
      const result = await load();
      if (!alive) return;
      hasCwd = result.tasks.some((task) => task.hasCwd === true);
      accept(result.tasks);
    } catch {
      if (alive) failed();
    } finally {
      pending = false;
      // Events during the first load are retained until hasCwd is known.
      if (alive && needsLoad() && timer === undefined) schedule();
    }
  };
  return {
    start() { if (alive) { tasksDirty = true; void run(); } },
    change(kind: "tasks" | "workspace") {
      if (!alive || (kind === "workspace" && hasCwd === false && !pending)) return;
      if (kind === "tasks") tasksDirty = true;
      else workspaceDirty = true;
      schedule();
    },
    dispose() { alive = false; if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}
