// bb-plugin-machine-sidebar — backend entry.
//
// Stores the tag color rules edited on the plugin's settings page and the
// threads/projects marked inactive, and tells every open window when either
// changes. The optional Farcall projection reads existing BB thread events;
// rendering and native thread actions stay in app.tsx.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { FARCALL_CHANGED, FARCALL_SETTING, farcallSnapshotSchema } from "./farcall-contract";
import { createFarcallReader } from "./farcall-reader";
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
  settings.onChange((next) => { if (!next.showFarcallTasks) farcall.clear(); });
  bb.events.on("experimental_thread.events", async ({ thread, sequence }) => {
    if ((await settings.get()).showFarcallTasks) bb.realtime.publish(FARCALL_CHANGED, { threadId: thread.id, sequence });
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
    farcall_tasks_get: async ({ threadId }) =>
      (await settings.get()).showFarcallTasks
        ? farcallSnapshotSchema.parse(await farcall.read(threadId))
        : { tasks: [] },
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
