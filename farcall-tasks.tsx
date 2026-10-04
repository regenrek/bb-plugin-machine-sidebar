import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { HierarchyGuides } from "./hierarchy-guides";
import { FARCALL_CHANGED, FARCALL_WORKSPACES_CHANGED, farcallChangedSchema, taskStatus, type FarcallRow, type TaskOutcome } from "./farcall-contract";
import { createFarcallRefresh } from "./farcall-refresh";
import { S } from "./strings";
import type { rpcContract } from "./server";

function useFarcallTasks(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [tasks, setTasks] = useState<FarcallRow[]>([]);
  const [error, setError] = useState(false);
  const scheduler = useRef<ReturnType<typeof createFarcallRefresh> | null>(null);
  const previousConnection = useRef(connection);
  useEffect(() => {
    const refresh = createFarcallRefresh(
      () => rpc.call("farcall_tasks_get", { threadId }),
      (next) => { setTasks(next); setError(false); },
      () => setError(true),
    );
    scheduler.current = refresh;
    refresh.start();
    const focused = () => refresh.change("tasks");
    window.addEventListener("focus", focused);
    return () => { refresh.dispose(); scheduler.current = null; window.removeEventListener("focus", focused); };
  }, [rpc, threadId]);
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") scheduler.current?.change("tasks");
    previousConnection.current = connection;
  }, [connection]);
  useRealtime(FARCALL_CHANGED, (payload) => {
    const changed = farcallChangedSchema.safeParse(payload);
    if (changed.success && changed.data.threadId === threadId) scheduler.current?.change("tasks");
  });
  useRealtime(FARCALL_WORKSPACES_CHANGED, () => { scheduler.current?.change("workspace"); });
  return { tasks, error };
}

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** BB's agent provider ids; the icons are the ones BB shows for those workers' threads. */
const PROVIDER_IDS: Record<FarcallRow["provider"], string> = { claude: "claude-code", codex: "codex" };
const PROVIDER_NAMES: Record<FarcallRow["provider"], string> = { claude: "Claude", codex: "Codex" };

/** `claude-opus-5-5` → `Opus 5.5`; other ids, like `gpt-6.1-sol`, stay as requested. */
export function modelLabel(task: FarcallRow): string {
  const model = task.requestedModel;
  if (model === null) return PROVIDER_NAMES[task.provider];
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(model);
  if (!claude) return model;
  const family = claude[1][0].toUpperCase() + claude[1].slice(1);
  return `${family} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Call time from BB events; unavailable stays unavailable. */
export function callDuration(task: FarcallRow, now: number): string {
  const end = task.callState === "open" ? now : task.endedAt;
  if (task.startedAt === null || end === null || end < task.startedAt) return "time unavailable";
  return formatDuration(end - task.startedAt);
}

/** Ticks only while an expanded open call shows its waiting time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const TONE: Partial<Record<TaskOutcome, string>> = { failed: "text-destructive", timeout: "text-destructive" };

function StatusMark({ task }: { task: FarcallRow }) {
  const status = taskStatus(task);
  const mark = status.outcome === "open"
    ? <span className="size-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none" />
    : status.outcome === "completed"
      ? <Icon name="Check" fallback="Dot" className="size-3.5" />
      : <span className="text-[11px] leading-4">{status.short}</span>;
  return (
    <span role="img" aria-label={status.label} title={status.label}
      className={cn("flex shrink-0 items-center", TONE[status.outcome] ?? "text-muted-foreground")}>
      {mark}
    </span>
  );
}

function TaskDetails({ task }: { task: FarcallRow }) {
  const now = useNow(task.callState === "open" && task.startedAt !== null);
  const status = taskStatus(task);
  return (
    <div className="flex min-w-0 flex-col gap-1 pb-2 pl-[26px] pr-2 pt-1 text-xs leading-5">
      {task.task && <p title={task.task} className="line-clamp-2 text-sidebar-foreground [overflow-wrap:anywhere]">{task.task}</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
        <span className={TONE[status.outcome]}>{status.label}</span>
        <span className="inline-flex min-w-0 items-center gap-1 tabular-nums"
          title="Elapsed tool call time from BB events, not measured worker run time">
          <Icon name="Clock" fallback="Dot" aria-hidden className="size-3 shrink-0" />
          <span>{callDuration(task, now)}</span>
        </span>
      </div>
    </div>
  );
}

type Provider = ComponentProps<typeof ProviderIcon>["provider"];

/** Snapshot metadata only: no effects, state, timers or width measurements. */
export function WorkerWorkspace({ task }: { task: FarcallRow }) {
  const workspace = task.workspace;
  if (!workspace) return null;
  const label = workspace.branch ?? workspace.label;
  const description = workspace.source === "path" ? S.workerWorkspace.folder(workspace.label)
    : workspace.branch ? S.workerWorkspace.branch(workspace.branch) : S.workerWorkspace.detached(workspace.label);
  return (
    <div title={description} aria-label={description}
      className="flex min-w-0 items-center gap-1 pb-0.5 pl-[26px] pr-1 text-[11px] leading-4 text-muted-foreground">
      <Icon name={workspace.source === "path" ? "Folder" : "GitFork"} fallback={workspace.source === "path" ? "Folder" : "GitBranch"} aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

/** Icon, model, task and status on one line; the expanded row adds call time. */
function TaskRow({ task, provider }: { task: FarcallRow; provider: Provider }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <li className="min-w-0">
      <button type="button" aria-expanded={expanded} aria-controls={detailsId}
        onClick={() => setExpanded(!expanded)}
        title={`${PROVIDER_NAMES[task.provider]} · ${task.requestedModel ?? "model unknown"} · ${taskStatus(task).label}`}
        className={cn("flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs text-sidebar-foreground/85 hover:bg-sidebar-accent", focus)}>
        <ProviderIcon providerKind="agent" provider={provider} aria-hidden className="size-3.5 shrink-0" />
        <span className="max-w-[55%] shrink-0 truncate">{modelLabel(task)}</span>
        <span title={task.task ?? undefined} className="min-w-0 flex-1 truncate text-muted-foreground">{task.task}</span>
        <StatusMark task={task} />
      </button>
      <WorkerWorkspace task={task} />
      <div id={detailsId} hidden={!expanded}>{expanded && <TaskDetails task={task} />}</div>
    </li>
  );
}

export function FarcallTasks({ threadId, title, depth, guides = false }: {
  threadId: string; title: string; depth: number; guides?: boolean;
}) {
  const { tasks, error } = useFarcallTasks(threadId);
  const { providers } = experimental_useProviders();
  const [showFinished, setShowFinished] = useState(false);
  const finishedId = useId();
  if (tasks.length === 0 && !error) return null;
  const provider = (task: FarcallRow): Provider => {
    const id = PROVIDER_IDS[task.provider];
    return providers.find((entry) => entry.id === id) ?? { id };
  };
  const open = tasks.filter((task) => task.callState === "open");
  // Newest first; the projection keeps call order.
  const finished = tasks.filter((task) => task.callState !== "open").reverse();
  // Icons line up with native child threads (`22 + (depth + 1) * 14`).
  return (
    <section aria-label={`Farcall tasks under ${title}`} style={{ paddingLeft: 32 + depth * 14 }} className="relative min-w-0">
      {guides && <HierarchyGuides levels={depth + 1} />}
      {open.length > 0 && <ul className="min-w-0">{open.map((task) => <TaskRow key={task.key} task={task} provider={provider(task)} />)}</ul>}
      {finished.length > 0 && (
        // History, dimmed like inactive threads. Its outcomes stay on each row, not as a group alarm.
        <div className="opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
          <button type="button" aria-expanded={showFinished} aria-controls={finishedId}
            onClick={() => setShowFinished(!showFinished)}
            className={cn("flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground", focus)}>
            <Icon name="ChevronRight" fallback="Dot"
              className={cn("size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none", showFinished && "rotate-90")} />
            <span>Done <span className="tabular-nums">{finished.length}</span></span>
          </button>
          <ul id={finishedId} hidden={!showFinished} className="min-w-0">
            {showFinished && finished.map((task) => <TaskRow key={task.key} task={task} provider={provider(task)} />)}
          </ul>
        </div>
      )}
      {error && <p role="status" className="px-1 text-xs text-muted-foreground">Couldn't refresh Farcall tasks.</p>}
    </section>
  );
}
