import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FarcallRow } from "./farcall-contract";

type Sdk = BbPluginApi["sdk"];
type Environment = Awaited<ReturnType<Sdk["environments"]["list"]>>[number];
export type WorkspaceEnvironment = Pick<Environment, "id" | "hostId" | "path" | "isWorktree" | "branchName" | "status">;
type Workspace = FarcallRow["workspace"];

/** Lexical paths only: no filesystem, Git, symlink or case-folding guesses. */
function pathKey(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null;
  const path = value.replace(/\\/g, "/");
  if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path)) return null;
  if (path.split("/").some((part) => part === "." || part === "..") || /[\x00-\x1f]/.test(path)) return null;
  return path.replace(/\/+$/, "") || "/";
}

function folder(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** A folder hint, never evidence of a branch or of an actual Git worktree. */
export function workspaceFromPath(cwd?: string): Workspace {
  const path = pathKey(cwd);
  if (!path) return undefined;
  const parts = path.split("/");
  const index = parts.lastIndexOf("worktrees");
  const name = parts[index + 1];
  return index >= 0 && name ? { label: name, branch: null, source: "path" } : undefined;
}

export function createWorkspaceIndex(environments: readonly WorkspaceEnvironment[]) {
  const byId = new Map(environments.map((environment) => [environment.id, environment]));
  const hosts = new Map<string, Map<string, WorkspaceEnvironment[]>>();
  for (const environment of byId.values()) {
    const path = pathKey(environment.path);
    if (!path || environment.status !== "ready") continue;
    let paths = hosts.get(environment.hostId);
    if (!paths) hosts.set(environment.hostId, paths = new Map());
    const matches = paths.get(path) ?? [];
    matches.push(environment);
    paths.set(path, matches);
  }
  return {
    hostFor: (environmentId: string | null) => environmentId ? byId.get(environmentId)?.hostId : undefined,
    resolve(cwd: string | undefined, hostId?: string): Workspace {
      const path = pathKey(cwd);
      const paths = hostId ? hosts.get(hostId) : undefined;
      if (path && paths) {
        // Walk exact path, then segment ancestors: O(path depth), not O(environments).
        let ancestor = path;
        while (ancestor) {
          const matches = paths.get(ancestor);
          if (matches) {
            if (matches.length !== 1) break; // Ambiguous, never pick a shorter candidate.
            const environment = matches[0];
            if (environment.isWorktree) return {
              label: folder(ancestor), branch: environment.branchName, source: "environment",
            };
            if (ancestor === path) return undefined; // A confirmed ordinary checkout.
            break; // Descendants of a project checkout are not a workspace match.
          }
          if (ancestor === "/") break;
          ancestor = ancestor.slice(0, ancestor.lastIndexOf("/")) || "/";
        }
      }
      return workspaceFromPath(cwd);
    },
  };
}

/** One shared lazy index; no timers. Events invalidate it, snapshots refresh it. */
export function createWorkspaceCache(list: Sdk["environments"]["list"], now = Date.now) {
  let generation = 0;
  let cached: { index: ReturnType<typeof createWorkspaceIndex> | null; expiresAt: number } | undefined;
  let pending: Promise<ReturnType<typeof createWorkspaceIndex> | null> | undefined;
  return {
    invalidate() { generation++; cached = undefined; pending = undefined; },
    async read(eventDriven: boolean) {
      if (cached && cached.expiresAt > now()) return cached.index;
      if (pending) return pending;
      const revision = generation;
      const load = async () => {
        const environments: WorkspaceEnvironment[] = [];
        try {
          const limit = 200;
          for (let offset = 0; ; offset += limit) {
            const page = await list({ limit, offset });
            environments.push(...page);
            if (page.length < limit) break;
          }
          const index = createWorkspaceIndex(environments);
          if (revision === generation) cached = { index, expiresAt: eventDriven ? Infinity : now() + 15_000 };
          return revision === generation ? index : null;
        } catch {
          // Metadata outages must not erase worker outcomes. Retry only on a later snapshot.
          if (revision === generation) cached = { index: null, expiresAt: now() + 15_000 };
          return null;
        } finally {
          if (revision === generation) pending = undefined;
        }
      };
      pending = load();
      return pending;
    },
  };
}
