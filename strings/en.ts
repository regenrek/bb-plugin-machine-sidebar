// English texts, the default language. This file defines the shape every other
// language must follow: `Strings` below is inferred from it, so a key missing
// in `de.ts` fails the type check.
import { forms, plural } from "./helpers.ts";
import type { TagRulesErrorCode } from "../tag-errors.ts";

const tagErrors = {
  network: "Could not connect to the server.",
  timeout: "The request timed out. Try again.",
  unavailable: "The plugin is unavailable. Check that it is running.",
  validation: "The server rejected the tag rules.",
  server: "The server could not process the tag rules.",
  unknown: "An unexpected error occurred.",
} satisfies Record<TagRulesErrorCode, string>;

export const en = {
  workerWorkspace: {
    branch: (branch: string) => `Worktree branch: ${branch}`,
    folder: (name: string) => `Working folder: ${name} (from task path; branch unknown)`,
    detached: (name: string) => `Worktree: ${name} (branch unavailable)`,
  },
  list: {
    title: "Machine → Project",
    description: "Threads grouped by the machine they run on, then by project.",
    label: "Threads by machine",
    loading: "Loading threads…",
    loadError: "Could not load threads.",
    empty: "No threads yet.",
  },
  groups: {
    personal: "Threads",
    unknownProject: "Unknown project",
    noMachine: "No machine",
    pinned: "Pinned",
    inactive: "Inactive",
  },
  status: {
    agentWorking: "Agent is working",
    subThreadAgentWorking: "A sub-thread's agent is working",
    subThreadAttention: (kind: "waiting" | "failed" | "done") =>
      `A sub-thread ${kind === "waiting" ? "needs your input" : kind === "failed" ? "failed" : "finished"}`,
    /** Labels derived from attention codes, independent of host-language text. */
    attention: { waiting: "Needs your input", failed: "Failed", done: "Finished" },
    queuedFailed: "Message could not be sent",
    queuedWaiting: "Message queued to send",
    worktree: "Worktree",
    worktreeTitle: "Git worktree",
    activity: (count: number, one: string, many: string) => `${count} ${plural(count, one, many)} running`,
  },
  activity: {
    backgroundAgents: forms("subagent", "subagents"),
    backgroundCommands: forms("background command", "background commands"),
    workflows: forms("workflow", "workflows"),
    planMode: forms("plan in progress", "plans in progress"),
    goals: forms("goal", "goals"),
  },
  subThreads: {
    count: (count: number) => `${count} ${plural(count, "sub-thread", "sub-threads")}`,
    toggle: (collapsed: boolean, count: number) =>
      `${collapsed ? "Show" : "Hide"} ${count} ${plural(count, "sub-thread", "sub-threads")}`,
  },
  row: {
    actions: "Thread actions",
    titleInput: "Thread title",
    archive: "Archive",
    archiveThread: "Archive thread",
    branchTitle: (branch: string, isWorktree: boolean) => (isWorktree ? `${branch} (worktree)` : branch),
    newThreadIn: (project: string, machine: string) => `New thread in ${project} on ${machine}`,
  },
  menu: {
    split: "Open in split",
    rename: "Rename",
    pin: "Pin",
    unpin: "Unpin",
    markRead: "Mark as read",
    markUnread: "Mark as unread",
    markActive: "Mark active",
    markInactive: "Mark inactive",
    markProjectActive: "Mark project active",
    markProjectInactive: "Mark project inactive",
    markAllActive: "Mark all active",
    archive: "Archive",
    delete: "Delete…",
  },
  farcall: {
    tasksUnder: (title: string) => `Farcall tasks under ${title}`,
    done: "Done",
    refreshError: "Couldn't refresh Farcall tasks.",
    callTimeHint: "Elapsed tool call time from BB events, not measured worker run time",
    modelUnknown: "model unknown",
    /** `label` is the full text; `short` is the compact word beside a finished row. */
    status: {
      open: { label: "Call open", short: "open" },
      unknown: { label: "Outcome unknown", short: "unknown" },
      completed: { label: "Completed", short: "done" },
      failed: { label: "Failed", short: "failed" },
      spawnError: { label: "Failed to start", short: "failed" },
      evidenceError: { label: "Evidence error", short: "failed" },
      timeout: { label: "Timed out", short: "timeout" },
      cancelled: { label: "Cancelled", short: "cancelled" },
      interrupted: { label: "Interrupted", short: "interrupted" },
      notStarted: { label: "Not started", short: "not started" },
    },
    duration: {
      unavailable: "time unavailable",
      lessThanMinute: "<1m",
      minutes: (minutes: number) => `${minutes}m`,
      hoursMinutes: (hours: number, minutes: string) => `${hours}h ${minutes}m`,
      daysHours: (days: number, hours: number) => `${days}d ${hours}h`,
    },
  },
  tags: {
    sectionTitle: "Title tags",
    sectionDescription: "Colors for [Tag] prefixes in thread titles.",
    loading: "Loading tags…",
    errors: tagErrors,
    loadError: (error: TagRulesErrorCode) => `Could not load tags: ${tagErrors[error]}`,
    tagName: "Tag name",
    introStart: "Start a thread title with ",
    introExampleTag: "[Tag]",
    introMiddle: " to show it as a pill in the sidebar, e.g. ",
    introExampleTitle: "[Bug] Login fails",
    introEnd:
      ". Tags listed here use the color you pick; other tags get an automatic color. Matching ignores upper and lower case.",
    empty: "No tag colors yet.",
    duplicate: (tag: string) => `“${tag}” is listed twice; only the first entry is used.`,
    add: "Add tag",
    save: "Save",
    saving: "Saving…",
    discard: "Discard",
    saved: "Saved. Open windows update right away.",
    saveError: (error: TagRulesErrorCode) => `Could not save: ${tagErrors[error]}`,
    remove: (tag: string) => `Remove ${tag || "tag"}`,
    colorFor: (tag: string) => `Color for ${tag || "new tag"}`,
    colors: {
      red: "Red",
      orange: "Orange",
      amber: "Amber",
      green: "Green",
      teal: "Teal",
      blue: "Blue",
      violet: "Violet",
      pink: "Pink",
      gray: "Gray",
    },
  },
};

export type Strings = typeof en;
