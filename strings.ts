// Every user-visible text of Machine Sidebar in one place. A variant of this
// plugin (for example a translated fork) replaces only this file, so merges
// from upstream do not conflict in the code that uses the texts.

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const S = {
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
    worktree: "Worktree",
    worktreeTitle: "Git worktree",
    activity: (count: number, one: string, many: string) => `${count} ${plural(count, one, many)} running`,
  },
  activity: {
    backgroundAgents: ["subagent", "subagents"],
    backgroundCommands: ["background command", "background commands"],
    workflows: ["workflow", "workflows"],
    planMode: ["plan in progress", "plans in progress"],
    goals: ["goal", "goals"],
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
  tags: {
    sectionTitle: "Title tags",
    sectionDescription: "Colors for [Tag] prefixes in thread titles.",
    loading: "Loading tags…",
    loadError: (error: string) => `Could not load tags: ${error}`,
    tagName: "Tag name",
    remove: (tag: string) => `Remove ${tag || "tag"}`,
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
} as const;
