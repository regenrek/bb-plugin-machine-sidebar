import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkerWorkspace } from "./farcall-tasks";
import type { FarcallRow } from "./farcall-contract";

// The host owns icon rendering. Keep this test about the row's semantics and text.
vi.mock("@/components/ui/icon", () => ({ Icon: (props: { name: string; className: string }) => <svg data-icon={props.name} className={props.className} /> }));
const task: FarcallRow = { key: "codex:w1", provider: "codex", requestedModel: "gpt-6.1-sol", status: null, callState: "open", task: "Build the feature", startedAt: null, endedAt: null };

describe("worker workspace row", () => {
  it("shows a confirmed branch with a fork icon and CSS truncation", () => {
    const html = renderToStaticMarkup(<WorkerWorkspace task={{ ...task, workspace: { label: "w1", branch: "sol/w1", source: "environment" } }} />);
    expect(html).toContain('data-icon="GitFork"');
    expect(html).toContain('aria-label="Worktree branch: sol/w1"');
    expect(html).toContain('title="Worktree branch: sol/w1"');
    expect(html).toContain('class="min-w-0 truncate">sol/w1</span>');
  });
  it("labels path hints as folders, handles detached branches and hides old rows", () => {
    const html = renderToStaticMarkup(<WorkerWorkspace task={{ ...task, workspace: { label: "w1", branch: null, source: "path" } }} />);
    expect(html).toContain("Working folder: w1 (from task path; branch unknown)");
    expect(html).not.toContain("Worktree branch");
    expect(renderToStaticMarkup(<WorkerWorkspace task={{ ...task, workspace: { label: "w1", branch: null, source: "environment" } }} />)).toContain("branch unavailable");
    expect(renderToStaticMarkup(<WorkerWorkspace task={task} />)).toBe("");
  });
});
