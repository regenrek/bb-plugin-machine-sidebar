# Machine Sidebar for bb

A thread list for [bb](https://github.com/get-bb/bb) that groups threads by the
**machine they run on**, then by **project**. Useful when you work across
several machines, for example a laptop and a remote Mac or Linux box.

![Machine Sidebar](docs/sidebar.png)

## Features

- **Machine → project → thread.** A thread is grouped under the machine its
  environment runs on. A project with threads on two machines appears under
  both, each with only that machine's threads. Threads without a project
  appear as "Threads" under their machine.
- **Title tags.** Start a title with `[Tag]`, e.g. `[Coding][Running] Checkout Flow`,
  and each tag is drawn as a colored pill. Pick colors per tag under
  Settings → Installed plugins → Machine Sidebar → Title tags; other tags get a
  stable automatic color. Changes show up in every open window right away.
- **Inactive.** Mark a thread or a whole project inactive from its **…** menu.
  It moves into its machine's **Inactive** group at the bottom, collapsed and
  dimmed. It comes back by itself when it waits for your input or a new turn
  finishes or fails; opening or reading it does not wake it.
- **Branch and status.** Each row shows the git branch under the title and a
  status dot: amber waits for you, red failed, green finished and unread. A
  spinner appears only while the agent itself is working on a turn.
  Collapsed groups show the most urgent dot they contain.
- **Background work.** Quiet icons with a count show what keeps running
  without the agent: subagents, background commands such as a dev server,
  workflows, plan mode, and goals. A dev server no longer looks like a
  thinking agent.
- **Sub-threads.** Child threads sit under their parent with a chevron to fold
  them. A folded parent shows how many it hides and still raises their status
  dot or spinner.
- **Farcall worker tasks (optional).** If you run workers through
  [farcall-mcp](https://github.com/regenrek/farcall-mcp) (`claude_worker` /
  `codex_worker` `run` and `run_batch`), each coordinator thread lists its
  worker tasks underneath: provider, model, task, elapsed call time and the
  final outcome. The list is built only from bb's own tool-call events; it
  never starts, retries or controls workers. While a batch call is open the
  sidebar shows "Call open" rather than guessing per-worker progress. Turn it
  on under Settings → Installed plugins → Machine Sidebar → Show Farcall tasks.
  A second compact line shows the worker's worktree branch when its requested
  working directory matches a bb environment on the coordinator's machine.
  Otherwise, a `worktrees/<name>` path shows a folder icon and name; its tooltip says
  **Working folder**, never claiming a branch. Updates are debounced; working
  directory paths stay on the server. [Matching and cache behavior](docs/worker-workspaces.md).
  Works well with [split-orchestrator](https://github.com/regenrek/split-orchestrator).
- **Hierarchy guides (optional).** Thin vertical lines through nested threads
  and worker tasks, like an editor's file tree (Show hierarchy guides).
- **Worktree marker.** Threads running in a git worktree show a small fork icon.
- **Quick actions.** Hover a project for **+** (new thread in that project on
  that machine). Hover a thread for **Archive** and **…** (open in split,
  rename, pin, mark read/unread, mark inactive, delete).
- Pinned threads sit on top; child threads are indented under their parent.
  bb's `Cmd+1…9` and next/previous-thread shortcuts keep working.

Tag colors and inactive marks are stored on the bb server, so every window and
machine sees the same state. Collapsed groups are remembered per window.

## Language

The sidebar speaks English (default) or German. Choose under Settings →
Installed plugins → Machine Sidebar → Language: `en`, `de`, or `auto`, which
follows the browser language and falls back to English. The labels bb itself
shows for this plugin (its name in Settings → Appearance and the Title tags
heading) stay English. To add a language, create `strings/<code>.ts` typed as
`Strings` and register it in `strings.ts`.
See the [German terminology glossary](docs/glossary.md) when editing translations.

## Install

From the bb plugin marketplace, or:

```sh
bb plugin install git:https://github.com/regenrek/bb-plugin-machine-sidebar.git
```

bb switches to the new list automatically. To switch back, choose another list
under Settings → Appearance → Sidebar, or run `bb plugin disable machine-sidebar`.

Requires bb 0.44 or later.

## Development

```sh
npm install
npx tsc -p .                              # type check
npm test                                  # unit tests (node --test + vitest)
bb plugin build                           # build dist/
bb plugin install . --yes                 # install from this folder
bb plugin dev                             # rebuild and reload on save
```

| File | Purpose |
| --- | --- |
| `app.tsx` | Thread list UI |
| `tree.ts` | Grouping, nesting, inactive rules |
| `tags.ts` | Title tag parsing, colors, rule cleanup |
| `tag-rules.tsx`, `inactive.tsx` | Loading and live refresh of tag rules and inactive marks |
| `settings.tsx` | Title tags settings page |
| `farcall-*.ts(x)` | Optional Farcall task projection from bb tool-call events |
| `hierarchy-guides.tsx` | Optional tree guide lines |
| `strings.ts`, `strings/en.ts`, `strings/de.ts` | Every user-visible text, one file per language; forks add their own keys to both |
| `i18n.tsx` | Picks the language from the setting and shares it with the components |
| `server.ts` | Settings, storage and RPC for tag rules, inactive marks and Farcall tasks |

## License

MIT
