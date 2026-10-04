// bb-plugin-machine-sidebar — backend entry.
//
// Stores the tag color rules edited on the plugin's settings page and the
// threads/projects marked inactive, and tells every open window when either
// changes. The optional Farcall projection reads existing BB thread events;
// rendering and native thread actions stay in app.tsx.
import { createBoundedDebounce } from "./lib/bounded-debounce";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { FARCALL_CHANGED, FARCALL_SETTING, FARCALL_WORKSPACES_CHANGED, farcallSnapshotSchema } from "./farcall-contract";
import { createFarcallReader } from "./farcall-reader";
import { createWorkspaceCache, pathKey, workspaceFromPath } from "./farcall-workspaces";
import { HIERARCHY_GUIDES_SETTING } from "./tree";
import {
  INACTIVE_CHANGED,
  MAX_TAG_LENGTH,
  MAX_TAG_RULES,
  normalizeRules,
  TAG_COLOR_IDS,
  TAG_RULES_CHANGED,
  type TagRule,
} from "./tags";

const tagRuleSchema = z.object({
  tag: z.string().max(MAX_TAG_LENGTH + 2),
  color: z.enum(TAG_COLOR_IDS),
});

const idSchema = z.string().min(1).max(128);
const marksSchema = z.object({
  threads: z.record(idSchema, z.number()),
  projects: z.record(idSchema, z.number()),
});
type InactiveMarks = z.infer<typeof marksSchema>;

export const rpcContract = defineRpcContract({
  farcall_tasks_get: {
    input: z.object({ threadId: z.string().min(1).max(128) }),
    output: farcallSnapshotSchema,
  },
  inactive_get: {
    input: z.null(),
    output: marksSchema,
  },
  inactive_set: {
    input: z.object({
      kind: z.enum(["thread", "project"]),
      id: idSchema,
      inactive: z.boolean(),
    }),
    output: marksSchema,
  },
  tag_rules_get: {
    input: z.null(),
    output: z.object({ rules: z.array(tagRuleSchema) }),
  },
  tag_rules_set: {
    input: z.object({ rules: z.array(tagRuleSchema).max(MAX_TAG_RULES) }),
    output: z.object({ rules: z.array(tagRuleSchema) }),
  },
});

const TAG_RULES_KEY = "tag-rules";
const INACTIVE_KEY = "inactive-marks";
/** Bounds the stored marks; the oldest are dropped first. */
const MAX_MARKS = 2000;

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
  const settings = bb.settings.define({
    [FARCALL_SETTING]: {
      type: "boolean", default: false, label: "Show Farcall tasks",
      description: "Lists Claude and Codex worker calls under their coordinator. Never starts, retries or controls workers.",
    },
    [HIERARCHY_GUIDES_SETTING]: {
      type: "boolean", default: false, label: "Show hierarchy guides",
      description: "Draws thin vertical lines through nested threads and Farcall tasks.",
    },
  });
  const farcall = createFarcallReader((args) => bb.sdk.threads.events.list(args));
  const workspaces = createWorkspaceCache((args) => bb.sdk.environments.list(args), Date.now, {
    unsettled: () => scheduleRecovery(),
    settled: () => { cancelRecovery(); recoveryUsed = false; },
    warn: (message) => bb.log.warn(message),
  });
  let lifecycle = 0;
  let disposed = false;
  const current = (epoch: number) => !disposed && epoch === lifecycle;
  let subscriptions: (() => void)[] = [];
  let nextSubscriptionAttempt = 0;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryUsed = false;
  const cancelRecovery = () => {
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  };
  const publishWorkspaceChange = () => {
    workspaces.invalidate();
    bb.realtime.publish(FARCALL_WORKSPACES_CHANGED, null);
  };
  const scheduleRecovery = () => {
    if (disposed || recoveryUsed || recoveryTimer !== undefined) return;
    const epoch = lifecycle;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (!current(epoch)) return;
      recoveryUsed = true;
      publishWorkspaceChange();
    }, 15_000);
  };
  const workspaceDebounce = createBoundedDebounce(() => {
    if (!disposed) publishWorkspaceChange();
  });
  const dropSubscriptions = () => {
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };
  const stopWorkspaces = () => {
    workspaceDebounce.cancel();
    cancelRecovery();
    recoveryUsed = false;
    dropSubscriptions();
    nextSubscriptionAttempt = 0;
  };
  const observeWorkspaces = (epoch: number) => {
    if (!current(epoch) || subscriptions.length > 0 || Date.now() < nextSubscriptionAttempt) return;
    const invalidate = () => {
      if (!current(epoch)) return;
      recoveryUsed = false; // A new external change opens a new recovery opportunity.
      workspaceDebounce.mark();
    };
    try {
      subscriptions.push(bb.sdk.subscribe({ event: "environment:changed", callback: invalidate }));
      subscriptions.push(bb.sdk.subscribe({ event: "realtime:connection", callback: (event) => {
        if (event.state === "connected") invalidate();
      } }));
    } catch {
      // Only the partial subscriptions go; a scheduled recovery is still the sole signal.
      dropSubscriptions();
      nextSubscriptionAttempt = Date.now() + 60_000;
      bb.log.warn("Environment notifications unavailable; retry on a snapshot after 60s. Workspace cache expires after 15s.");
    }
  };
  bb.onDispose(() => {
    disposed = true;
    lifecycle++;
    stopWorkspaces();
    farcall.clear();
    workspaces.dispose();
  });
  settings.onChange((next) => {
    if (!next.showFarcallTasks) {
      lifecycle++;
      stopWorkspaces();
      farcall.clear();
      workspaces.clear();
    }
  });
  bb.events.on("experimental_thread.events", async ({ thread, sequence }) => {
    const epoch = lifecycle;
    if (current(epoch) && (await settings.get()).showFarcallTasks && current(epoch))
      bb.realtime.publish(FARCALL_CHANGED, { threadId: thread.id, sequence });
  });
  bb.events.on("thread.deleted", ({ thread }) => { farcall.clearThread(thread.id); });

  const readRules = async (): Promise<TagRule[]> => {
    const stored = z.array(tagRuleSchema).safeParse(await bb.storage.kv.get(TAG_RULES_KEY));
    return stored.success ? normalizeRules(stored.data) : [];
  };

  const readMarks = async (): Promise<InactiveMarks> => {
    const stored = marksSchema.safeParse(await bb.storage.kv.get(INACTIVE_KEY));
    return stored.success ? stored.data : { threads: {}, projects: {} };
  };

  const newest = (record: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(record)
        .sort(([, a], [, b]) => b - a)
        .slice(0, MAX_MARKS),
    );

  bb.rpc.register(rpcContract, {
    farcall_tasks_get: async ({ threadId }) => {
      const epoch = lifecycle;
      if (!current(epoch) || !(await settings.get()).showFarcallTasks || !current(epoch)) return { tasks: [] };
      const snapshot = await farcall.read(threadId);
      if (!current(epoch)) return { tasks: [] };
      const rows = snapshot.tasks.map((task) => ({ ...task, hasCwd: pathKey(task.cwd) !== null }));
      if (!rows.some((task) => task.hasCwd)) return farcallSnapshotSchema.parse({ tasks: rows });
      const coordinator = await (async () => {
        try { return await bb.sdk.threads.get({ threadId }); } catch { return null; }
      })();
      if (!current(epoch)) return { tasks: [] };
      observeWorkspaces(epoch);
      const index = await workspaces.read(subscriptions.length > 0);
      if (!current(epoch)) return { tasks: [] };
      const hostId = coordinator ? index?.hostFor(coordinator.environmentId) : undefined;
      return farcallSnapshotSchema.parse({ tasks: rows.map((task) => {
        const workspace = index ? index.resolve(task.cwd, hostId) : workspaceFromPath(task.cwd);
        return workspace ? { ...task, workspace } : task;
      }) });
    },
    inactive_get: () => readMarks(),
    inactive_set: async ({ kind, id, inactive }) => {
      const marks = await readMarks();
      const target = kind === "thread" ? marks.threads : marks.projects;
      if (inactive) target[id] = Date.now();
      else delete target[id];
      const next = { threads: newest(marks.threads), projects: newest(marks.projects) };
      await bb.storage.kv.set(INACTIVE_KEY, next);
      bb.realtime.publish(INACTIVE_CHANGED, null);
      return next;
    },
    tag_rules_get: async () => ({ rules: await readRules() }),
    tag_rules_set: async ({ rules }) => {
      const next = normalizeRules(rules);
      await bb.storage.kv.set(TAG_RULES_KEY, next);
      bb.realtime.publish(TAG_RULES_CHANGED, next);
      bb.log.info(`tag rules saved (${next.length})`);
      return { rules: next };
    },
  });
}
