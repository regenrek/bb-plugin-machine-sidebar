import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FarcallRow } from "./farcall-contract";

type Sdk = BbPluginApi["sdk"];
type Environment = Awaited<ReturnType<Sdk["environments"]["list"]>>[number];
export type WorkspaceEnvironment = Pick<Environment, "id" | "hostId" | "path" | "isWorktree" | "branchName" | "status">;
type Workspace = FarcallRow["workspace"];

/** Lexical paths only: no filesystem, Git, symlink or case-folding guesses. */
export function pathKey(value: string | null | undefined): string | null {
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

/** One active pagination, even across invalidations or feature disable/re-enable. */
export function createWorkspaceCache(list: Sdk["environments"]["list"], now = Date.now) {
  type Index = ReturnType<typeof createWorkspaceIndex>;
  let generation = 0;
  let lifecycle = 0;
  let disposed = false;
  let lastGood: Index | null = null;
  let cachedGeneration = -1;
  let expiresAt = 0;
  let pending: { lifecycle: number; promise: Promise<Index | null> } | undefined;
  const clear = () => {
    lifecycle++;
    generation++;
    lastGood = null;
    expiresAt = 0;
    // Retain the in-flight promise until it settles: no overlapping loads.
  };
  const cache = {
    invalidate() { generation++; },
    clear,
    dispose() { disposed = true; clear(); },
    async read(eventDriven: boolean): Promise<Index | null> {
      if (disposed) return null;
      const epoch = lifecycle;
      if (pending) {
        if (pending.lifecycle === epoch) return pending.promise;
        await pending.promise;
        return disposed || epoch !== lifecycle ? null : cache.read(eventDriven);
      }
      if (cachedGeneration === generation && expiresAt > now()) return lastGood;
      const current = () => !disposed && epoch === lifecycle;
      const load = async (): Promise<Index | null> => {
        // A busy host cannot keep one RPC pending indefinitely. Retain the last
        // good index after three dirty passes; the next snapshot can try again.
        for (let attempt = 0; attempt < 3 && current(); attempt++) {
          const revision = generation;
          const environments: WorkspaceEnvironment[] = [];
          try {
            for (let offset = 0; ; ) {
              const page = await list({ limit: 200, offset });
              if (!current()) return null;
              if (revision !== generation) break;
              if (page.length === 0) {
                lastGood = createWorkspaceIndex(environments);
                cachedGeneration = revision;
                expiresAt = eventDriven ? Infinity : now() + 15_000;
                return lastGood;
              }
              environments.push(...page);
              offset += page.length; // A server may cap pages below the requested limit.
            }
          } catch {
            if (!current()) return null;
            if (revision !== generation) continue;
            cachedGeneration = revision;
            expiresAt = now() + 15_000;
            return lastGood;
          }
        }
        return current() ? lastGood : null;
      };
      const promise = Promise.resolve().then(load).finally(() => { pending = undefined; });
      pending = { lifecycle: epoch, promise };
      return promise;
    },
  };
  return cache;
}
