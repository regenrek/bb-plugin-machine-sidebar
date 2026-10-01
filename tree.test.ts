// Run: node --test tree.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTree, isInactive, shortMachineName, visibleRows, type TreeThread } from "./tree.ts";

const MAC = { id: "h_mac", name: "laptop" };
const DEV = { id: "h_dev", name: "Ada’s MacBook Pro" };

function thread(id: string, overrides: Partial<TreeThread>): TreeThread {
  return {
    id,
    projectId: "p_a",
    parentThreadId: null,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    pinSortKey: null,
    pinnedAt: null,
    updatedAt: 0,
    latestAttentionAt: null,
    host: MAC,
    ...overrides,
  };
}

const projects = [
  { id: "p_personal", name: "Personal", isPersonal: true },
  { id: "p_b", name: "beta", isPersonal: false },
  { id: "p_a", name: "alpha", isPersonal: false },
];

const rowsOf = (groups: ReturnType<typeof buildTree>["machines"][number]["projects"]) =>
  groups.map((project) => ({
    project: project.name,
    rows: project.rows.map((row) => `${"-".repeat(row.depth)}${row.thread.id}`),
  }));

const shape = (tree: ReturnType<typeof buildTree>) =>
  tree.machines.map((machine) => ({ machine: machine.name, projects: rowsOf(machine.projects) }));

const inactiveShape = (tree: ReturnType<typeof buildTree>) =>
  tree.machines.map((machine) => ({ machine: machine.name, inactive: rowsOf(machine.inactive) }));

test("groups by the thread's machine, then project in the user's order", () => {
  const tree = buildTree(
    [
      thread("a1", { projectId: "p_a", host: MAC, updatedAt: 1 }),
      thread("a2", { projectId: "p_a", host: DEV, updatedAt: 2 }),
      thread("b1", { projectId: "p_b", host: MAC, updatedAt: 3 }),
      thread("t1", { projectId: "p_personal", host: DEV, updatedAt: 4 }),
      thread("a3", { projectId: "p_a", host: MAC, updatedAt: 5 }),
    ],
    projects,
  );
  assert.deepEqual(shape(tree), [
    {
      machine: "Ada",
      projects: [
        { project: "alpha", rows: ["a2"] },
        { project: "Threads", rows: ["t1"] },
      ],
    },
    {
      machine: "laptop",
      projects: [
        { project: "beta", rows: ["b1"] },
        { project: "alpha", rows: ["a3", "a1"] },
      ],
    },
  ]);
});

test("nests children under their parent and keeps orphans at the top", () => {
  const tree = buildTree(
    [
      thread("parent", { updatedAt: 1 }),
      thread("child-old", { parentThreadId: "parent", updatedAt: 2 }),
      thread("child-new", { parentThreadId: "parent", updatedAt: 3 }),
      thread("grandchild", { parentThreadId: "child-old", updatedAt: 4 }),
      thread("orphan", { parentThreadId: "gone", updatedAt: 0 }),
      thread("elsewhere", { parentThreadId: "parent", host: DEV, updatedAt: 5 }),
    ],
    projects,
  );
  assert.deepEqual(shape(tree), [
    { machine: "Ada", projects: [{ project: "alpha", rows: ["elsewhere"] }] },
    {
      machine: "laptop",
      projects: [
        {
          project: "alpha",
          rows: ["parent", "-child-new", "-child-old", "--grandchild", "orphan"],
        },
      ],
    },
  ]);
});

test("pins go to the top; archived, hidden and machine-less threads are handled", () => {
  const tree = buildTree(
    [
      thread("pin-b", { isPinned: true, pinSortKey: "b" }),
      thread("pin-a", { isPinned: true, pinSortKey: "a", host: DEV }),
      thread("archived", { isArchived: true }),
      thread("hidden", { isHidden: true }),
      thread("nowhere", { host: null }),
    ],
    projects,
  );
  assert.deepEqual(
    tree.pinned.map((row) => row.thread.id),
    ["pin-a", "pin-b"],
  );
  assert.deepEqual(shape(tree), [
    { machine: "No machine", projects: [{ project: "alpha", rows: ["nowhere"] }] },
  ]);
});

test("shortens owner-style machine names", () => {
  assert.equal(shortMachineName("Ada’s MacBook Pro"), "Ada");
  assert.equal(shortMachineName("build-box"), "build-box");
});

test("marked threads and projects move to their machine's inactive group", () => {
  const tree = buildTree(
    [
      thread("keep", { projectId: "p_a", updatedAt: 3 }),
      thread("quiet", { projectId: "p_a", updatedAt: 2 }),
      thread("b-mac", { projectId: "p_b", host: MAC, updatedAt: 1 }),
      thread("b-dev", { projectId: "p_b", host: DEV, updatedAt: 1 }),
      thread("pinned", { projectId: "p_b", isPinned: true }),
    ],
    projects,
    { inactive: { threads: { quiet: 100 }, projects: { p_b: 100 } } },
  );
  assert.deepEqual(shape(tree), [
    { machine: "Ada", projects: [] },
    { machine: "laptop", projects: [{ project: "alpha", rows: ["keep"] }] },
  ]);
  assert.deepEqual(inactiveShape(tree), [
    { machine: "Ada", inactive: [{ project: "beta", rows: ["b-dev"] }] },
    {
      machine: "laptop",
      inactive: [
        { project: "beta", rows: ["b-mac"] },
        { project: "alpha", rows: ["quiet"] },
      ],
    },
  ]);
  assert.deepEqual(
    tree.pinned.map((row) => row.thread.id),
    ["pinned"],
  );
});

test("inactive threads wake up on new attention, not on reading", () => {
  const marks = { threads: { t: 100 }, projects: {} };
  // Opened and read after marking: updatedAt moves, attention does not.
  assert.equal(isInactive(thread("t", { updatedAt: 500, latestAttentionAt: 90 }), marks), true);
  // A turn finished after marking.
  assert.equal(isInactive(thread("t", { latestAttentionAt: 150 }), marks), false);
  // Waiting for input right now.
  assert.equal(
    isInactive(thread("t", { latestAttentionAt: 90 }), marks, () => true),
    false,
  );
  // Unmarked threads are never inactive.
  assert.equal(isInactive(thread("other", {}), marks), false);
});

test("a thread mark takes precedence over its project's mark", () => {
  const marks = { threads: { t: 300 }, projects: { p_a: 100 } };
  assert.equal(isInactive(thread("t", { latestAttentionAt: 200 }), marks), true);
});

test("counts children and hides rows under a collapsed parent", () => {
  const tree = buildTree(
    [
      thread("parent", { updatedAt: 1 }),
      thread("child-old", { parentThreadId: "parent", updatedAt: 2 }),
      thread("child-new", { parentThreadId: "parent", updatedAt: 3 }),
      thread("grandchild", { parentThreadId: "child-old", updatedAt: 4 }),
      thread("next", { updatedAt: 0 }),
    ],
    projects,
  );
  const rows = tree.machines[0].projects[0].rows;
  const byId = new Map(rows.map((row) => [row.thread.id, row]));
  assert.equal(byId.get("parent")?.childCount, 2);
  assert.deepEqual(byId.get("parent")?.descendantIds.sort(), ["child-new", "child-old", "grandchild"]);
  assert.equal(byId.get("child-old")?.childCount, 1);
  assert.equal(byId.get("next")?.childCount, 0);

  const ids = (collapsed: string[]) =>
    visibleRows(rows, (id) => collapsed.includes(id)).map((row) => row.thread.id);
  assert.deepEqual(ids([]), ["parent", "child-new", "child-old", "grandchild", "next"]);
  assert.deepEqual(ids(["parent"]), ["parent", "next"]);
  assert.deepEqual(ids(["child-old"]), ["parent", "child-new", "child-old", "next"]);
  // Collapsing a row without children changes nothing.
  assert.deepEqual(ids(["next"]), ["parent", "child-new", "child-old", "grandchild", "next"]);
});
