# Worker workspaces

With **Show Farcall tasks** enabled, a worker row can show a fork icon and its
worktree branch. This is metadata about the requested working directory, not a
live view of the worker's shell. A worker can change directory after dispatch.

Each `run` / `run_batch` task retains at most 4096 characters of `cwd` from bb's
tool-call arguments. A task's own `cwd` takes precedence over a batch-level
`cwd`. Invalid metadata does not discard the task. Old rows without it still
render normally.

On each snapshot, the plugin resolves the coordinator's environment to its
host and matches worker paths only to ready environments on that host. An
exact path wins; otherwise the longest ancestor at a segment boundary wins.
Ambiguous matches are ignored. A project checkout above the worker's directory
is not a match. A known worktree supplies its branch; a detached worktree shows
its folder with a “branch unavailable” tooltip.

Without a match or with unavailable metadata, a `worktrees/<name>` path supplies
only a **Working folder** label and a fork icon. It does not prove that the
directory is a Git worktree. Other paths get no workspace label. Paths are
compared lexically; no filesystem, Git, symlink resolution or case folding is
performed. Path aliases may therefore use the fallback. A known ordinary
checkout at the exact path gets no worktree marker.

The plugin uses public SDK `environments.list`, `threads.get` and
`subscribe` (`environment:changed`, `realtime:connection`). One lazy environment
index is shared across coordinators and refreshed after invalidation. Requests
for the same index are coalesced and environment pages contain at most 200 rows.
One coordinator lookup serves all tasks in its snapshot. A changed environment
invalidates the UI so a later attachment can replace a folder hint with a branch.

If event subscriptions cannot be established, snapshots use a 15-second cache.
Metadata failures also expire after 15 seconds. There is no polling timer or
automatic retry: a later normal snapshot triggers the next read. Reload,
disabling the feature and disposal clear the cache and unsubscribe listeners.
Reconnect invalidation covers missed environment events. The host assumption
is that the Farcall server executes on the coordinator's machine; a remote MCP
server running elsewhere cannot be identified from these arguments.

The UI uses CSS truncation, with a tooltip and accessible label distinguishing
branch from folder. The workspace line has no state, effects, timer, resize
listener or per-row RPC. Existing call-duration updates are unchanged.
