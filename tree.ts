// Pure grouping logic for Machine Sidebar: machine → project → thread.
// Kept free of React and the SDK runtime so it can be tested with plain Node.
//
// A thread belongs to the machine it runs on (its environment's host), not to
// the machine a project was first added on. A project with threads on two
// machines therefore appears under both, each time with only that machine's
// threads. Threads without a project (the personal "Threads" bucket) follow
// the same rule.
//
// Threads and projects the user marked inactive move into a per-machine
// "Inactive" group. A marked thread comes back on its own once it needs
// attention again or something new happened in it after it was marked
// (`latestAttentionAt` is newer than the mark); merely reading it does not.

export interface TreeThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isHidden: boolean;
  pinSortKey: string | null;
  pinnedAt: number | null;
  updatedAt: number;
  latestAttentionAt: number | null;
  host: { id: string; name: string } | null;
}

/** When each thread or project was marked inactive (epoch ms), by id. */
export interface InactiveMarks {
  threads: Readonly<Record<string, number>>;
  projects: Readonly<Record<string, number>>;
}

export const NO_INACTIVE_MARKS: InactiveMarks = { threads: {}, projects: {} };

export interface TreeOptions<T extends TreeThread> {
  inactive?: InactiveMarks;
  /** Threads that need the user right now never stay inactive. */
  needsAttention?: (thread: T) => boolean;
}

export interface TreeProject {
  id: string;
  name: string;
  isPersonal: boolean;
}

export interface Row<T extends TreeThread> {
  thread: T;
  depth: number;
  /** Direct children nested under this row in the same list. */
  childCount: number;
  /** Every thread nested below this row, at any depth. */
  descendantIds: string[];
}

export interface ProjectGroup<T extends TreeThread> {
  key: string;
  projectId: string;
  name: string;
  isPersonal: boolean;
  rows: Row<T>[];
}

export interface MachineGroup<T extends TreeThread> {
  key: string;
  hostId: string | null;
  name: string;
  fullName: string;
  projects: ProjectGroup<T>[];
  /** Threads marked inactive (directly or through their project), grouped the same way. */
  inactive: ProjectGroup<T>[];
}

export interface Tree<T extends TreeThread> {
  pinned: Row<T>[];
  machines: MachineGroup<T>[];
}

export const PERSONAL_GROUP_NAME = "Threads";
const NO_MACHINE = "no-machine";

/** "Ada’s MacBook Pro" → "Ada"; other names stay as they are. */
export function shortMachineName(name: string): string {
  const owner = /^(.+?)[’']s\s/u.exec(name.trim());
  return owner ? owner[1] : name.trim();
}

const newestFirst = (a: TreeThread, b: TreeThread) => b.updatedAt - a.updatedAt;

/** Orders threads newest first, nesting children under a parent in the same list. */
function nestRows<T extends TreeThread>(threads: readonly T[]): Row<T>[] {
  const ids = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of threads) {
    const parent = thread.parentThreadId;
    if (parent !== null && parent !== thread.id && ids.has(parent)) {
      const siblings = children.get(parent) ?? [];
      siblings.push(thread);
      children.set(parent, siblings);
    } else {
      roots.push(thread);
    }
  }
  const rows: Row<T>[] = [];
  const seen = new Set<string>();
  /** Adds the thread and its subtree; returns the added row, or null if already shown. */
  const visit = (thread: T, depth: number): Row<T> | null => {
    if (seen.has(thread.id)) return null;
    seen.add(thread.id);
    const row: Row<T> = { thread, depth, childCount: 0, descendantIds: [] };
    rows.push(row);
    for (const child of (children.get(thread.id) ?? []).sort(newestFirst)) {
      const childRow = visit(child, depth + 1);
      if (childRow === null) continue;
      row.childCount += 1;
      row.descendantIds.push(child.id, ...childRow.descendantIds);
    }
    return row;
  };
  for (const root of roots.sort(newestFirst)) visit(root, 0);
  return rows;
}

/** Drops rows nested under a collapsed row; `isCollapsed` takes a thread id. */
export function visibleRows<T extends TreeThread>(
  rows: readonly Row<T>[],
  isCollapsed: (threadId: string) => boolean,
): Row<T>[] {
  const result: Row<T>[] = [];
  let hideDeeperThan: number | null = null;
  for (const row of rows) {
    if (hideDeeperThan !== null) {
      if (row.depth > hideDeeperThan) continue;
      hideDeeperThan = null;
    }
    result.push(row);
    if (row.childCount > 0 && isCollapsed(row.thread.id)) hideDeeperThan = row.depth;
  }
  return result;
}

/** Whether a thread currently sits in its machine's "Inactive" group. */
export function isInactive<T extends TreeThread>(
  thread: T,
  marks: InactiveMarks,
  needsAttention: (thread: T) => boolean = () => false,
): boolean {
  const markedAt = marks.threads[thread.id] ?? marks.projects[thread.projectId];
  if (markedAt === undefined) return false;
  if (needsAttention(thread)) return false;
  return (thread.latestAttentionAt ?? 0) <= markedAt;
}

function projectGroups<T extends TreeThread>(
  machineKey: string,
  byProject: ReadonlyMap<string, T[]>,
  projects: readonly TreeProject[],
  keyPrefix: string,
): ProjectGroup<T>[] {
  const projectOrder = new Map(projects.map((project, index) => [project.id, index]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const groups = [...byProject.entries()].map(([projectId, list]) => {
    const project = projectById.get(projectId);
    const isPersonal = project?.isPersonal ?? false;
    return {
      key: `${keyPrefix}${machineKey}/${projectId}`,
      projectId,
      name: isPersonal ? PERSONAL_GROUP_NAME : (project?.name ?? "Unknown project"),
      isPersonal,
      rows: nestRows(list),
    };
  });
  // The user's project order, the personal bucket last.
  groups.sort((a, b) => {
    if (a.isPersonal !== b.isPersonal) return a.isPersonal ? 1 : -1;
    return (
      (projectOrder.get(a.projectId) ?? Number.MAX_SAFE_INTEGER) -
        (projectOrder.get(b.projectId) ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name)
    );
  });
  return groups;
}

export function buildTree<T extends TreeThread>(
  threads: readonly T[],
  projects: readonly TreeProject[],
  options: TreeOptions<T> = {},
): Tree<T> {
  const marks = options.inactive ?? NO_INACTIVE_MARKS;
  const visible = threads.filter((thread) => !thread.isHidden && !thread.isArchived);

  const pinned = visible
    .filter((thread) => thread.isPinned)
    .sort(
      (a, b) =>
        (a.pinSortKey ?? "").localeCompare(b.pinSortKey ?? "") ||
        (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0),
    )
    .map((thread) => ({ thread, depth: 0, childCount: 0, descendantIds: [] as string[] }));

  // machine key → active / inactive → project id → threads
  interface Bucket {
    host: TreeThread["host"];
    active: Map<string, T[]>;
    inactive: Map<string, T[]>;
  }
  const byMachine = new Map<string, Bucket>();
  for (const thread of visible) {
    if (thread.isPinned) continue;
    const key = thread.host?.id ?? NO_MACHINE;
    const machine = byMachine.get(key) ?? { host: thread.host, active: new Map(), inactive: new Map() };
    byMachine.set(key, machine);
    const target = isInactive(thread, marks, options.needsAttention) ? machine.inactive : machine.active;
    const list = target.get(thread.projectId) ?? [];
    list.push(thread);
    target.set(thread.projectId, list);
  }

  const machines: MachineGroup<T>[] = [...byMachine.entries()].map(([key, machine]) => {
    const fullName = machine.host?.name ?? "No machine";
    return {
      key,
      hostId: machine.host?.id ?? null,
      name: shortMachineName(fullName),
      fullName,
      projects: projectGroups(key, machine.active, projects, ""),
      inactive: projectGroups(key, machine.inactive, projects, "inactive:"),
    };
  });
  machines.sort((a, b) => {
    if ((a.hostId === null) !== (b.hostId === null)) return a.hostId === null ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return { pinned, machines };
}
