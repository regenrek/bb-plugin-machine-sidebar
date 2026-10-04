# Worker workspaces

With **Show Farcall tasks** enabled, a worker row can show a fork icon and its
worktree branch. This is metadata about the requested working directory, not a
live view of the worker's shell. A worker can change directory after dispatch.

Each `run` / `run_batch` task retains at most 4096 characters of `cwd` from bb's
tool-call arguments. A task's own `cwd` takes precedence over a batch-level
`cwd`. Invalid metadata does not discard the task. Old rows without it still
render normally. Only lexically resolvable absolute paths trigger environment
lookups or notifications. The full `cwd` stays server-side; the client receives
only `hasCwd` and the resolved workspace label.

On each snapshot, the plugin resolves the coordinator's environment to its
host and matches worker paths only to ready environments on that host. An
exact path wins; otherwise the longest ancestor at a segment boundary wins.
Ambiguous matches are ignored. A project checkout above the worker's directory
is not a match. A known worktree supplies its branch; a detached worktree shows
its folder with a “branch unavailable” tooltip.

Without a match or with unavailable metadata, a `worktrees/<name>` path supplies
only a **Working folder** label and a folder icon. It does not prove that the
directory is a Git worktree. Other paths get no workspace label. Paths are
compared lexically; no filesystem, Git, symlink resolution or case folding is
performed. Path aliases may therefore use the fallback. A known ordinary
checkout at the exact path gets no worktree marker.

The plugin uses public SDK `environments.list`, `threads.get` and
`subscribe` (`environment:changed`, `realtime:connection`). One lazy environment
index is shared across coordinators. Environment-change bursts are combined by
one trailing 300 ms debounce with a 1.5-second maximum wait from the first mark
before invalidating the index and publishing a UI signal. Connection events invalidate only upon `connected`, not on disconnect.
The client uses the same bounded debounce per visible coordinator, never per
worker. If its RPC is still pending at the deadline, the queued refresh starts
as soon as that RPC finishes; requests never overlap. Unchanged wire snapshots
skip the task-state update, avoiding another render of all worker rows.
An event arriving before the first snapshot finishes is retained until the
client knows whether that snapshot contains a resolvable working directory.

There is exactly one active index load, including during invalidation or
feature disable/re-enable. Each page requests `limit: 200`; this is a request,
not a server guarantee. Pagination advances by the actual page length and stops
at an empty page. A repeated first ID or more than 10,000 accumulated rows aborts
the load with a warning and preserves the last good index.
If the generation changes during a load, the loader restarts
serially, up to three passes. Under continuous churn or an outage it retains
the last good index. A reader joining a pending load checks the generation
afterward and can request one bounded follow-up if it is still unresolved. On a cold start
without a good index, only the folder hint may be available. One coordinator
lookup serves all tasks in its snapshot. Notifications are global rather than
host-filtered. Visible coordinators with `hasCwd: false` skip metadata refresh;
a missing field on older rows means unknown and remains eligible.

If event subscriptions cannot be established, snapshots use a 15-second cache.
A later snapshot retries subscriptions after a 60-second cooldown; no timer
retries subscriptions automatically. Metadata failures also back off for 15
seconds. A failed load or exhausted dirty passes also schedules one recovery
signal (invalidate + publish) after 15 seconds, shared by all readers. Visible
clients then request a snapshot normally. A failed recovery does not schedule
another: success or a new external environment/connected event opens a new
recovery opportunity. A successful load cancels any pending recovery signal.
A disabled or disposed lifecycle cannot subscribe, publish signals or
populate a cache after an in-flight request completes. Disposal is permanent;
disable/re-enable starts a fresh lifecycle. Queued debounce/recovery timers and listeners
are cancelled on both shutdown paths.

There is no periodic polling. Timers coalesce received events or deliver the
one-shot recovery signal; normal snapshots trigger cache loads and eligible
subscription retries. The host
assumption is that the Farcall server executes on the coordinator's machine; a
remote MCP server running elsewhere cannot be identified from these arguments.

The UI uses CSS truncation, with a tooltip and accessible label distinguishing
branch from folder. The workspace line has no state, effects, timer, resize
listener or per-row RPC. Existing call-duration updates are unchanged.
