import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRow, WorkerWorkspace } from "./farcall-tasks";
import { MachineThreadList } from "./app";
import { LanguageProvider } from "./i18n";
import type { FarcallRow } from "./farcall-contract";

const sdk = vi.hoisted(() => ({ settings: undefined as Record<string, string | number | boolean> | undefined }));
const thread = {
  id: "t1", projectId: "p1", parentThreadId: null, isPinned: false, isArchived: false, isHidden: false,
  pinSortKey: null, pinnedAt: null, updatedAt: 1, latestAttentionAt: null, displayTitle: "Fix login",
  href: "/t/t1", providerId: "codex", indicator: "none", indicatorLabel: null, runtimeStatus: "idle",
  hasPendingInteraction: false, isUnread: false, host: { id: "h1", name: "Ada's MacBook Pro" },
  environment: { branchName: "feature/login", isWorktree: true },
  activity: { backgroundAgents: 2, backgroundCommands: 0, workflows: 0, planMode: 0, goals: 0 },
};

// The host owns the SDK runtime. These stand-ins give the components just what they read.
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<object>()),
  useSettings: () => ({ values: sdk.settings, isLoading: false }),
  useRpc: () => ({ call: () => new Promise(() => undefined) }),
  useRealtime: () => undefined,
  experimental_usePluginId: () => "machine-sidebar",
  experimental_useProviders: () => ({ providers: [] }),
  experimental_ProviderIcon: () => null,
  experimental_useSidebarThreads: () => ({ status: "ready", threads: [thread], projects: [{ id: "p1", name: "Shop", isPersonal: false }] }),
  experimental_useSidebarThreadActions: () => ({}),
  useSidebarThreadDraft: () => ({ hasUnsubmittedDraft: false }),
  useSidebarThreadShortcut: () => null,
  ThreadTitle: () => null,
}));
vi.mock("@/components/ui/icon", () => ({ Icon: (props: { name: string }) => <svg data-icon={props.name} /> }));

const row: FarcallRow = { key: "codex:w1", provider: "codex", requestedModel: null, status: "timed_out", callState: "failed", task: "Build", startedAt: null, endedAt: null };
const render = (node: ReactNode) => renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
const list = () => render(<MachineThreadList activeThreadId={null} activeProjectId={null} isCompactViewport={false} searchQuery="" onNavigate={() => undefined} />);

beforeEach(() => {
  sdk.settings = undefined;
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("language setting", () => {
  it("renders english by default and without a stored value", () => {
    const html = list();
    expect(html).toContain('aria-label="Threads by machine"');
    expect(html).toContain('aria-label="Archive thread"');
    expect(render(<TaskRow task={row} provider={{ id: "codex" }} />)).toContain('aria-label="Timed out"');
    sdk.settings = { language: "klingon" };
    expect(list()).toContain('aria-label="Threads by machine"');
  });

  it("renders german list texts, including rows, status and activity labels", () => {
    sdk.settings = { language: "de" };
    const html = list();
    expect(html).toContain('aria-label="Gespräche nach Maschine"');
    expect(html).toContain('aria-label="Gespräch archivieren"');
    expect(html).toContain('aria-label="Gesprächsaktionen"');
    expect(html).toContain('title="feature/login (Worktree)"');
    expect(html).toContain('aria-label="2 Unteragenten aktiv"');
    expect(html).not.toContain("Archive thread");
  });

  it("renders a german Farcall status label and worktree line", () => {
    sdk.settings = { language: "de" };
    const task = render(<TaskRow task={row} provider={{ id: "codex" }} />);
    expect(task).toContain('aria-label="Zeitüberschreitung"');
    expect(task).toContain("Codex · Modell unbekannt · Zeitüberschreitung");
    expect(task).not.toContain("Timed out");
    const workspace = render(<WorkerWorkspace task={{ ...row, workspace: { label: "w1", branch: "sol/w1", source: "environment" } }} />);
    expect(workspace).toContain('aria-label="Worktree-Branch: sol/w1"');
    expect(workspace).not.toContain("Worktree branch");
  });

  it("follows the browser language for auto", () => {
    sdk.settings = { language: "auto" };
    vi.stubGlobal("navigator", { language: "de-AT" });
    expect(list()).toContain('aria-label="Gespräche nach Maschine"');
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(list()).toContain('aria-label="Threads by machine"');
  });
});
