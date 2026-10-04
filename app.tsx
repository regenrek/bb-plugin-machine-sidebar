// bb-plugin-machine-sidebar — frontend entry.
//
// Replaces bb's sidebar thread list with a machine → project → thread tree.
// Grouping lives in tree.ts; this file draws it and wires bb's actions.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_usePluginId,
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  ThreadTitle,
  useSidebarThreadDraft,
  useSidebarThreadShortcut,
  useSettings,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useInactiveMarks, type SetInactive } from "./inactive";
import TagSettings from "./settings";
import { TagColorProvider, useTagColor } from "./tag-rules";
import { parseTitleTags } from "./tags";
import { LANGUAGES } from "./strings";
import { LanguageProvider, useStrings } from "./i18n";
import { FARCALL_SETTING } from "./farcall-contract";
import { FarcallTasks } from "./farcall-tasks";
import { HierarchyGuides, useHierarchyGuides } from "./hierarchy-guides";
import {
  buildTree,
  visibleRows,
  NO_INACTIVE_MARKS,
  type InactiveMarks,
  type MachineGroup,
  type ProjectGroup,
  type Row,
} from "./tree";

type SidebarThread = ReturnType<typeof experimental_useSidebarThreads>["threads"][number];
type Actions = ReturnType<typeof experimental_useSidebarThreadActions>;

// ---------------------------------------------------------------- inactive marks

const InactiveContext = createContext<{ marks: InactiveMarks; setInactive: SetInactive }>({
  marks: NO_INACTIVE_MARKS,
  setInactive: () => undefined,
});

/** Only a thread waiting for the user's input pulls it out of "Inactive" by itself;
 * finished and failed turns wake it through `latestAttentionAt` (see tree.ts). */
const isWaitingForUser = (thread: SidebarThread) =>
  thread.hasPendingInteraction || thread.indicator === "waiting-for-input";

// ---------------------------------------------------------------- collapse state

function useCollapsed() {
  const pluginId = experimental_usePluginId();
  const storageKey = `${pluginId}.collapsed`;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback(
    (key: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // Storage full or unavailable: keep the in-memory state.
        }
        return next;
      });
    },
    [storageKey],
  );
  return { collapsed, toggle };
}

// ---------------------------------------------------------------- status

type Attention = "waiting" | "failed" | "done" | null;

/**
 * The agent itself is working on a turn. These are the runtime states bb's own
 * list treats as busy; a background command such as a dev server does not
 * count, so it never keeps the spinner going.
 */
const AGENT_WORKING = new Set(["active", "starting", "provisioning", "stopping", "host-reconnecting"]);
const isAgentWorking = (thread: SidebarThread) => AGENT_WORKING.has(thread.runtimeStatus);

function attentionOf(thread: SidebarThread): Attention {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "waiting";
  if (thread.indicator === "unread-error" || thread.indicator === "queued-failed") return "failed";
  if (thread.indicator === "unread-success") return "done";
  return null;
}

const ATTENTION_DOT: Record<Exclude<Attention, null>, string> = {
  waiting: "bg-attention",
  failed: "bg-destructive",
  done: "bg-success",
};

/** The most urgent attention among threads. */
function mostUrgent(threads: readonly SidebarThread[]): Attention {
  const kinds = threads.map(attentionOf);
  return kinds.includes("waiting")
    ? "waiting"
    : kinds.includes("failed")
      ? "failed"
      : kinds.includes("done")
        ? "done"
        : null;
}

/** The most urgent attention among rows, for collapsed group headers. */
function rollup(rows: readonly Row<SidebarThread>[]): Attention {
  return mostUrgent(rows.map((row) => row.thread));
}

function Dot({ kind, label }: { kind: Exclude<Attention, null>; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-2 shrink-0 animate-pulse rounded-full", ATTENTION_DOT[kind])}
    />
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground"
    />
  );
}

/**
 * One status glyph per row. `hidden` are threads folded under a collapsed
 * parent: their attention and work show on the parent until it is expanded.
 */
function StatusGlyph({
  thread,
  hidden = [],
}: {
  thread: SidebarThread;
  hidden?: readonly SidebarThread[];
}) {
  const S = useStrings();
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const attention = mostUrgent([thread, ...hidden]);
  const ownAttention = attentionOf(thread);
  if (attention !== null) {
    const label =
      ownAttention === attention
        ? (thread.indicatorLabel ?? S.status.attention[attention])
        : S.status.subThreadAttention(attention);
    return <Dot kind={attention} label={label} />;
  }
  if (isAgentWorking(thread)) return <Spinner label={S.status.agentWorking} />;
  if (hidden.some(isAgentWorking)) return <Spinner label={S.status.subThreadAgentWorking} />;
  if (thread.indicator === "queued-waiting") {
    return <Icon name="Clock" fallback="Dot" className="size-3 shrink-0 text-muted-foreground" />;
  }
  if (hasUnsubmittedDraft) {
    return (
      <Icon name="Pencil" fallback="EditFile" className="size-3 shrink-0 text-muted-foreground" />
    );
  }
  return null;
}

/** Background work bb reports per thread, drawn calmly next to the status. */
const ACTIVITY = [
  { key: "backgroundAgents", icon: "UserRoundPlus", fallback: "Users" },
  { key: "backgroundCommands", icon: "Terminal", fallback: "Code" },
  { key: "workflows", icon: "Workflow", fallback: "Dot" },
  { key: "planMode", icon: "ListTodo", fallback: "Dot" },
  { key: "goals", icon: "Target", fallback: "Dot" },
] as const;

function ActivityGlyphs({ thread }: { thread: SidebarThread }) {
  const S = useStrings();
  const running = ACTIVITY.filter((item) => thread.activity[item.key] > 0);
  if (running.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      {running.map((item) => {
        const count = thread.activity[item.key];
        const [one, many] = S.activity[item.key];
        const label = S.status.activity(count, one, many);
        return (
          <span key={item.key} role="img" aria-label={label} title={label} className="flex items-center gap-0.5">
            <Icon name={item.icon} fallback={item.fallback} className="size-3" />
            {count > 1 && <span className="text-[10px] leading-none">{count}</span>}
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------- row menu

interface MenuItem {
  label: string;
  run: () => void;
  destructive?: boolean;
}

function RowMenu({ items }: { items: MenuItem[] }) {
  const S = useStrings();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (position === null) return;
    const close = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setPosition(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPosition(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
    };
  }, [position]);

  const open = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 180) });
  };

  return (
    <>
      <button
        type="button"
        aria-label={S.row.actions}
        aria-haspopup="menu"
        onClick={open}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
          position === null && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Icon name="MoreHorizontal" fallback="Dot" className="size-3.5" />
      </button>
      {position !== null && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: position.top, left: position.left, zIndex: 60 }}
          className="w-[180px] rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPosition(null);
                item.run();
              }}
              className={cn(
                "flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-accent",
                item.destructive && "text-destructive-text",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- thread row

function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (title: string | null) => void;
}) {
  const S = useStrings();
  const [value, setValue] = useState(initial);
  const finish = (title: string | null) => onDone(title?.trim() ? title.trim() : null);
  return (
    <input
      autoFocus
      value={value}
      aria-label={S.row.titleInput}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(value);
        if (event.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value)}
      className="min-w-0 flex-1 rounded bg-background px-1 text-sm text-foreground outline-none ring-1 ring-ring"
    />
  );
}

function ProviderGlyph({ providerId }: { providerId: string }) {
  const { providers } = experimental_useProviders();
  const provider = providers.find((entry) => entry.id === providerId) ?? { id: providerId };
  return (
    <ProviderIcon
      providerKind="agent"
      provider={provider}
      aria-hidden
      className="size-3.5 shrink-0"
    />
  );
}

/**
 * The thread title with leading "[Tag]" prefixes drawn as colored pills.
 * Titles without tags use bb's ThreadTitle, which also renders @mentions.
 */
function TitleLine({ thread }: { thread: SidebarThread }) {
  const tagColor = useTagColor();
  const { tags, rest } = parseTitleTags(thread.displayTitle);
  if (tags.length === 0) {
    return (
      <span className="truncate">
        <ThreadTitle threadId={thread.id} />
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      {tags.map((tag, index) => (
        <span
          key={`${index}:${tag}`}
          style={{
            color: tagColor(tag),
            background: `color-mix(in srgb, ${tagColor(tag)} 16%, transparent)`,
          }}
          className="shrink-0 rounded px-1 text-[10px] font-semibold leading-4"
        >
          {tag}
        </span>
      ))}
      <span className="min-w-0 truncate">{rest}</span>
    </span>
  );
}

/** A title-line-high box (20px, the text-sm line height) that centers a glyph. */
function LineBox({ children }: { children: ReactNode }) {
  return <span className="flex h-5 shrink-0 items-center">{children}</span>;
}

function ThreadRow({
  row,
  active,
  actions,
  onNavigate,
  inInactive = false,
  childrenCollapsed = false,
  onToggleChildren,
  hiddenDescendants = [],
}: {
  row: Row<SidebarThread>;
  active: boolean;
  actions: Actions;
  onNavigate: () => void;
  inInactive?: boolean;
  childrenCollapsed?: boolean;
  onToggleChildren?: () => void;
  /** Threads folded under this row while its children are collapsed. */
  hiddenDescendants?: readonly SidebarThread[];
}) {
  const S = useStrings();
  const { thread, depth } = row;
  const { marks, setInactive } = useContext(InactiveContext);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const [renaming, setRenaming] = useState(false);
  const { values } = useSettings();
  const guides = useHierarchyGuides();
  const branch = thread.environment?.branchName ?? null;

  const items: MenuItem[] = [
    { label: S.menu.split, run: () => actions.open(thread.id, { split: true }) },
    { label: S.menu.rename, run: () => setRenaming(true) },
    {
      label: thread.isPinned ? S.menu.unpin : S.menu.pin,
      run: () => void actions.setPinned(thread.id, !thread.isPinned),
    },
    {
      label: thread.isUnread ? S.menu.markRead : S.menu.markUnread,
      run: () => void actions.setRead(thread.id, thread.isUnread),
    },
    inInactive
      ? marks.threads[thread.id] !== undefined
        ? { label: S.menu.markActive, run: () => setInactive("thread", thread.id, false) }
        : { label: S.menu.markProjectActive, run: () => setInactive("project", thread.projectId, false) }
      : { label: S.menu.markInactive, run: () => setInactive("thread", thread.id, true) },
    { label: S.menu.archive, run: () => actions.archive(thread.id) },
    { label: S.menu.delete, run: () => actions.requestDelete(thread.id), destructive: true },
  ];

  return (
    <>
    <a
      href={thread.href}
      data-sidebar-thread-shortcut-target=""
      data-sidebar-thread-id={thread.id}
      aria-current={active ? "page" : undefined}
      aria-label={thread.displayTitle}
      onClick={(event) => {
        if (renaming) {
          event.preventDefault();
          return;
        }
        onNavigate();
      }}
      style={{ paddingLeft: 22 + depth * 14 }}
      className={cn(
        "group/row relative flex min-w-0 gap-2 rounded-md pr-1.5 text-sm text-sidebar-foreground no-underline hover:bg-sidebar-accent",
        // Two-line rows (title + branch) keep every glyph on the title line.
        branch !== null && !renaming ? "min-h-7 items-start py-1" : "h-7 items-center",
        active && "bg-sidebar-accent font-medium",
        attentionOf(thread) === null && !active && "text-sidebar-foreground/85",
      )}
    >
      {guides && <HierarchyGuides levels={depth} />}
      {row.childCount > 0 && onToggleChildren !== undefined && (
        <button
          type="button"
          aria-expanded={!childrenCollapsed}
          aria-label={S.subThreads.toggle(childrenCollapsed, row.childCount)}
          title={S.subThreads.count(row.childCount)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleChildren();
          }}
          style={{ left: 4 + depth * 14 }}
          className="absolute top-1.5 flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Icon name={childrenCollapsed ? "ChevronRight" : "ChevronDown"} fallback="Dot" className="size-3" />
        </button>
      )}
      <LineBox>
        <ProviderGlyph providerId={thread.providerId} />
      </LineBox>
      {renaming ? (
        <RenameInput
          initial={thread.displayTitle}
          onDone={(title) => {
            setRenaming(false);
            if (title !== null && title !== thread.displayTitle) void actions.rename(thread.id, title);
          }}
        />
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <TitleLine thread={thread} />
          {branch !== null && (
            <span
              title={S.row.branchTitle(branch, thread.environment?.isWorktree === true)}
              className="flex min-w-0 items-center gap-1 text-[11px] font-normal leading-4 text-muted-foreground"
            >
              <Icon name="GitBranch" fallback="Code" className="size-3 shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
        </span>
      )}
      <LineBox>
        <span className="flex items-center gap-1.5">
          {thread.environment?.isWorktree === true && (
            <span role="img" aria-label={S.status.worktree} title={S.status.worktreeTitle} className="flex shrink-0 text-muted-foreground">
              <Icon name="GitFork" fallback="GitBranch" aria-hidden className="size-3.5" />
            </span>
          )}
          <ActivityGlyphs thread={thread} />
          {shortcut !== null ? (
            <kbd className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
              {shortcut.label}
            </kbd>
          ) : (
            <StatusGlyph thread={thread} hidden={hiddenDescendants} />
          )}
        </span>
      </LineBox>
      {!renaming && (
        <LineBox>
          <button
            type="button"
            aria-label={S.row.archiveThread}
            title={S.row.archive}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              actions.archive(thread.id);
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/row:opacity-100 focus-visible:opacity-100"
          >
            <Icon name="Archive" fallback="Dot" className="size-3.5" />
          </button>
          <RowMenu items={items} />
        </LineBox>
      )}
    </a>
    {values?.[FARCALL_SETTING] === true && (
      <FarcallTasks threadId={thread.id} title={thread.displayTitle} depth={depth} guides={guides} />
    )}
    </>
  );
}

// ---------------------------------------------------------------- group headers

function GroupHeader({
  collapsed,
  onToggle,
  level,
  title,
  icon,
  attention,
  count,
  action,
}: {
  collapsed: boolean;
  onToggle: () => void;
  level: "machine" | "project" | "inactive";
  title: string;
  icon?: ReactNode;
  attention: Attention;
  count: number;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/row flex h-7 min-w-0 items-center gap-1.5 rounded-md pr-1.5",
        level === "machine" && "pl-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        level === "project" && "pl-2 text-sm text-sidebar-foreground",
        level === "inactive" && "pl-2 text-xs text-muted-foreground",
      )}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <Icon
          name={collapsed ? "ChevronRight" : "ChevronDown"}
          fallback="Dot"
          className="size-3 shrink-0 text-muted-foreground"
        />
        {icon}
        <span className="min-w-0 truncate">{title}</span>
        {collapsed && (
          <span className="shrink-0 text-[10px] font-normal text-muted-foreground">{count}</span>
        )}
      </button>
      {collapsed && attention !== null && <Dot kind={attention} />}
      {action}
    </div>
  );
}

function NewThreadButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/row:opacity-100 focus-visible:opacity-100"
    >
      <Icon name="Plus" fallback="Dot" className="size-3.5" />
    </button>
  );
}

function ProjectSection({
  machine,
  project,
  collapsed,
  toggle,
  activeThreadId,
  actions,
  onNavigate,
  inInactive = false,
}: {
  machine: MachineGroup<SidebarThread>;
  project: ProjectGroup<SidebarThread>;
  collapsed: ReadonlySet<string>;
  toggle: (key: string) => void;
  activeThreadId: string | null;
  actions: Actions;
  onNavigate: () => void;
  inInactive?: boolean;
}) {
  const S = useStrings();
  const key = `p:${project.key}`;
  const isCollapsed = collapsed.has(key);
  const { marks, setInactive } = useContext(InactiveContext);
  const threadById = new Map(project.rows.map((row) => [row.thread.id, row.thread]));
  const projectMarked = marks.projects[project.projectId] !== undefined;
  const menu: MenuItem[] = [];
  if (projectMarked) {
    menu.push({
      label: S.menu.markProjectActive,
      run: () => setInactive("project", project.projectId, false),
    });
  } else if (inInactive) {
    menu.push({
      label: S.menu.markAllActive,
      run: () => {
        for (const row of project.rows) setInactive("thread", row.thread.id, false);
      },
    });
  } else if (!project.isPersonal) {
    menu.push({
      label: S.menu.markProjectInactive,
      run: () => setInactive("project", project.projectId, true),
    });
  }
  return (
    <div>
      <GroupHeader
        level="project"
        collapsed={isCollapsed}
        onToggle={() => toggle(key)}
        title={project.name}
        attention={rollup(project.rows)}
        count={project.rows.length}
        action={
          <>
            <NewThreadButton
              label={S.row.newThreadIn(project.name, machine.name)}
              onClick={() => {
                actions.openNewThread({
                  ...(project.isPersonal ? {} : { projectId: project.projectId }),
                  ...(machine.hostId !== null ? { hostId: machine.hostId } : {}),
                  focusPrompt: true,
                });
                onNavigate();
              }}
            />
            {menu.length > 0 && <RowMenu items={menu} />}
          </>
        }
      />
      {!isCollapsed &&
        visibleRows(project.rows, (id) => collapsed.has(`t:${id}`)).map((row) => {
          const childrenCollapsed = collapsed.has(`t:${row.thread.id}`);
          return (
            <ThreadRow
              key={row.thread.id}
              row={row}
              active={row.thread.id === activeThreadId}
              actions={actions}
              onNavigate={onNavigate}
              inInactive={inInactive}
              childrenCollapsed={childrenCollapsed}
              onToggleChildren={() => toggle(`t:${row.thread.id}`)}
              hiddenDescendants={
                childrenCollapsed
                  ? row.descendantIds.flatMap((id) => threadById.get(id) ?? [])
                  : undefined
              }
            />
          );
        })}
    </div>
  );
}

/** A machine's quiet threads: last, collapsed by default, dimmed. */
function InactiveSection({
  machine,
  collapsed,
  toggle,
  activeThreadId,
  actions,
  onNavigate,
}: {
  machine: MachineGroup<SidebarThread>;
  collapsed: ReadonlySet<string>;
  toggle: (key: string) => void;
  activeThreadId: string | null;
  actions: Actions;
  onNavigate: () => void;
}) {
  const S = useStrings();
  // Stored as "open" so a new machine's inactive group starts collapsed.
  const openKey = `inactive-open:${machine.key}`;
  const isCollapsed = !collapsed.has(openKey);
  const count = machine.inactive.reduce((sum, project) => sum + project.rows.length, 0);
  return (
    <div className="mt-1">
      <GroupHeader
        level="inactive"
        collapsed={isCollapsed}
        onToggle={() => toggle(openKey)}
        title={S.groups.inactive}
        icon={<Icon name="Moon" fallback="EyeOff" className="size-3 shrink-0" />}
        attention={null}
        count={count}
      />
      {!isCollapsed && (
        <div className="opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
          {machine.inactive.map((project) => (
            <ProjectSection
              key={project.key}
              machine={machine}
              project={project}
              collapsed={collapsed}
              toggle={toggle}
              activeThreadId={activeThreadId}
              actions={actions}
              onNavigate={onNavigate}
              inInactive
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- list

export function MachineThreadList(props: PluginThreadListProps) {
  return (
    <LanguageProvider>
      <TagColorProvider>
        <MachineThreadTree {...props} />
      </TagColorProvider>
    </LanguageProvider>
  );
}

function MachineThreadTree({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const S = useStrings();
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const { collapsed, toggle } = useCollapsed();
  const inactive = useInactiveMarks();
  const tree = useMemo(
    () =>
      buildTree(threads, projects, { inactive: inactive.marks, needsAttention: isWaitingForUser, groups: S.groups }),
    [threads, projects, inactive.marks, S.groups],
  );

  if (status === "loading" && threads.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">{S.list.loading}</p>;
  }
  if (status === "error" && threads.length === 0) {
    return <p className="px-3 py-2 text-sm text-destructive-text">{S.list.loadError}</p>;
  }
  if (tree.pinned.length === 0 && tree.machines.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">{S.list.empty}</p>;
  }

  return (
    <InactiveContext.Provider value={inactive}>
    <nav aria-label={S.list.label} className="flex flex-col gap-3 px-2 pb-4">
      {tree.pinned.length > 0 && (
        <div>
          <GroupHeader
            level="machine"
            collapsed={collapsed.has("pinned")}
            onToggle={() => toggle("pinned")}
            title={S.groups.pinned}
            icon={<Icon name="Pin" fallback="Dot" className="size-3 shrink-0" />}
            attention={rollup(tree.pinned)}
            count={tree.pinned.length}
          />
          {!collapsed.has("pinned") &&
            tree.pinned.map((row) => (
              <ThreadRow
                key={row.thread.id}
                row={{ ...row, depth: -1 }}
                active={row.thread.id === activeThreadId}
                actions={actions}
                onNavigate={onNavigate}
              />
            ))}
        </div>
      )}
      {tree.machines.map((machine) => {
        const key = `m:${machine.key}`;
        const isCollapsed = collapsed.has(key);
        const rows = machine.projects.flatMap((project) => project.rows);
        return (
          <section key={machine.key} aria-label={machine.fullName}>
            <GroupHeader
              level="machine"
              collapsed={isCollapsed}
              onToggle={() => toggle(key)}
              title={machine.name}
              icon={<Icon name="Laptop" fallback="Monitor" className="size-3 shrink-0" />}
              attention={rollup(rows)}
              count={rows.length}
            />
            {!isCollapsed &&
              machine.projects.map((project) => (
                <ProjectSection
                  key={project.key}
                  machine={machine}
                  project={project}
                  collapsed={collapsed}
                  toggle={toggle}
                  activeThreadId={activeThreadId}
                  actions={actions}
                  onNavigate={onNavigate}
                />
              ))}
            {!isCollapsed && machine.inactive.length > 0 && (
              <InactiveSection
                machine={machine}
                collapsed={collapsed}
                toggle={toggle}
                activeThreadId={activeThreadId}
                actions={actions}
                onNavigate={onNavigate}
              />
            )}
          </section>
        );
      })}
    </nav>
    </InactiveContext.Provider>
  );
}

export default definePluginApp((app) => {
  // Registered once at load, so these host-shown labels stay English.
  const S = LANGUAGES.en;
  app.slots.experimental_threadList({
    id: "machine-tree",
    title: S.list.title,
    description: S.list.description,
    component: MachineThreadList,
  });
  app.slots.settingsSection({
    id: "tags",
    title: S.tags.sectionTitle,
    description: S.tags.sectionDescription,
    component: TagSettings,
  });
});
