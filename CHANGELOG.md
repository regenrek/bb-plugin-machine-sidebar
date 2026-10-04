# Changelog

## 0.3.0 — Unreleased

- Show Farcall worker worktree branches from matching bb environments on the
  coordinator's host, with a folder-only fallback for `worktrees/<name>` paths.
- Resolve workspace metadata at snapshot time so later environment attachments
  are reflected without replaying task history. Share an event-invalidated
  environment index; use a short snapshot cache if notifications are unavailable.
- Keep old task rows compatible and add bounded per-task/batch `cwd` metadata,
  accessible labels and CSS truncation without per-row effects or polling.
- Add workspace resolution, cache, SDK integration and rendered UI tests.
