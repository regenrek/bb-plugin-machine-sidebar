// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render as mount, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRow, WorkerWorkspace } from "./farcall-tasks";
import { MachineThreadList } from "./app";
import { LanguageProvider, useStrings } from "./i18n";
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
  thread.indicator = "none";
  thread.indicatorLabel = null;
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    expect(html).toContain('title="feature/login (Git-Worktree)"');
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
    expect(workspace).toContain('aria-label="Git-Worktree-Branch: sol/w1"');
    expect(workspace).not.toContain("Worktree branch");
  });

  it("follows the browser language for auto", () => {
    sdk.settings = { language: "auto" };
    vi.stubGlobal("navigator", { language: "de-AT" });
    expect(list()).toContain('aria-label="Gespräche nach Maschine"');
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(list()).toContain('aria-label="Threads by machine"');
  });

  it.each([
    ["waiting-for-input", "Thread needs user input", "Wartet auf deine Eingabe"],
    ["queued-failed", "Queued message failed to send", "Nachricht konnte nicht gesendet werden"],
    ["queued-waiting", "Queued message waiting to send", "Nachricht wartet auf das Senden"],
  ])("translates the %s indicator from its code instead of the host label", (indicator, hostLabel, translated) => {
    sdk.settings = { language: "de" };
    thread.indicator = indicator;
    Object.assign(thread, { indicatorLabel: hostLabel });
    const html = list();
    expect(html).toContain(`aria-label="${translated}"`);
    expect(html).toContain(`title="${translated}"`);
    expect(html).not.toContain(hostLabel);
    sdk.settings = { language: "en" };
    expect(list()).not.toContain(hostLabel);
  });

  it("re-resolves auto texts on languagechange and removes the listener on unmount", () => {
    sdk.settings = { language: "auto" };
    vi.stubGlobal("navigator", { language: "en-US" });
    const subscribe = vi.spyOn(window, "addEventListener");
    const unsubscribe = vi.spyOn(window, "removeEventListener");
    const view = mount(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByText("Loading threads…")).toBeTruthy();
    act(() => {
      vi.stubGlobal("navigator", { language: "de-AT" });
      window.dispatchEvent(new Event("languagechange"));
    });
    expect(screen.getByText("Gespräche werden geladen…")).toBeTruthy();
    act(() => {
      vi.stubGlobal("navigator", { language: "fr-FR" });
      window.dispatchEvent(new Event("languagechange"));
    });
    expect(screen.getByText("Loading threads…")).toBeTruthy();
    const listener = subscribe.mock.calls.find(([event]) => event === "languagechange")?.[1];
    expect(listener).toBeTypeOf("function");
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledWith("languagechange", listener);
  });

  it("only subscribes to languagechange in auto mode", () => {
    sdk.settings = { language: "en" };
    const subscribe = vi.spyOn(window, "addEventListener");
    const unsubscribe = vi.spyOn(window, "removeEventListener");
    const view = mount(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(subscribe.mock.calls.filter(([event]) => event === "languagechange")).toHaveLength(0);
    vi.stubGlobal("navigator", { language: "de-AT" });
    sdk.settings = { language: "auto" };
    view.rerender(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByText("Gespräche werden geladen…")).toBeTruthy();
    const listener = subscribe.mock.calls.find(([event]) => event === "languagechange")?.[1];
    expect(listener).toBeTypeOf("function");
    sdk.settings = { language: "de" };
    view.rerender(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(unsubscribe).toHaveBeenCalledWith("languagechange", listener);
    expect(screen.getByText("Gespräche werden geladen…")).toBeTruthy();
  });

  it("renders auto without window or navigator", () => {
    sdk.settings = { language: "auto" };
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);
    expect(list()).toContain('aria-label="Threads by machine"');
  });
});

function LanguageProbe() {
  return <p>{useStrings().list.loading}</p>;
}
