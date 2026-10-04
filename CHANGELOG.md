# Changelog

## 0.4.0 — Unreleased

- Add a `language` setting (`en` default, `de`, `auto` from the browser language). All
  user-visible texts now live in `strings/en.ts` and `strings/de.ts`; German is typed as the
  English shape, so a missing key fails the type check.
- Move the remaining hardcoded English texts into the string files, including the Farcall
  status labels, durations, tooltips and aria labels. Status outcome codes are unchanged.
- Forks add their own keys to both languages instead of replacing `strings.ts`.
- Bb-facing labels registered at load (the plugin's list name and the Title tags heading) stay English.

## 0.3.0 — 2026-10-04

- Bound workspace debouncing to 1.5 seconds under sustained events; recover once after 15 seconds when an index load fails or stays dirty.
- Guard repeated/oversized pagination, refresh legacy rows with unknown workspace eligibility, and skip unchanged task-state updates.
- Show Farcall worker worktree branches from matching bb environments on the
  coordinator's host, with a folder-only fallback for `worktrees/<name>` paths.
- Resolve workspace metadata at snapshot time so later environment attachments
  are reflected without replaying task history. Share an event-invalidated
  environment index; use a short snapshot cache if notifications are unavailable.
- Coalesce event bursts and coordinator refreshes; serialize dirty index reloads
  and retain the last good metadata. Guard every async lifecycle boundary so
  disable/dispose cannot recreate subscriptions or fill stale caches.
- Keep cwd server-side, skip unresolvable paths, and distinguish folder hints
  with a folder icon. Retry failed subscriptions on later snapshots after 60s.
- Follow actual environment page lengths until an empty page.
- Keep old task rows compatible and add bounded per-task/batch `cwd` metadata,
  accessible labels and CSS truncation without per-row effects or polling.
- Add workspace resolution, cache, SDK integration and rendered UI tests.
