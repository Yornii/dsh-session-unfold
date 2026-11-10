<p align="center">
  <img src="https://raw.githubusercontent.com/yornii/dsh-session-unfold/main/assets/social-preview.png" alt="dsh-session-unfold — Unfold your sessions. See the whole flow.">
</p>

A client-side plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that replaces the sidebar's flat session list with a full-screen session tiling view: one card per session, each card a live mini conversation you can read and reply to without leaving the view.

> 中文说明见 [README.md](README.md).

## Why

The default session list gives you a title and a timestamp. With dozens of running tasks you cannot tell which ones are still working, which ones are waiting for you, and which ones are done. This plugin lays those signals out on one screen.

## Features

| Feature | Detail |
| --- | --- |
| Full-screen board | Opened from the sidebar footer button, fills the window, closes with Esc or ✕ |
| New window | The header "New window" button creates a Session in the current/recent Workspace and adds its card to the board. The board stays open, with one window per Session |
| Conversation timeline | Each card shows user messages and Markdown-rendered assistant replies; tool calls stay hidden. The All / User only toggle at the top can show only user messages |
| In-progress highlight | When a card's status is "In progress", its last user-message bubble is green |
| Approval sync | A pending permission approval shows the tool and reason on the card with direct "Allow once" and "Reject" buttons; it clears when the approval settles |
| History | A "Load earlier messages" button pages backwards through the Session event window and prepends older messages |
| Status groups | In progress / To decide / Done, inferred entirely from live Session state; users cannot change a card's status |
| Sorting | Pinned windows first, then In progress → To decide → Done, then by most recent activity |
| Window pin | The card's pin button calls the same Session pin service as the sidebar; pinned order matches the sidebar, and sidebar pins appear on the board |
| Subagent windows | The header "Subagents" toggle shows or hides subagent Session windows; hidden by default and marked with a Sub badge. They are pure read-only views: no composer, title editing, pin, approval actions, batch selection or Open session button |
| Search | Filters by task title or workspace name |
| Status filter | Show one status group only |
| Card size | Drag the bottom-right grip to resize each card; snaps to other cards' width and height; double-click the grip or press ↺ in the header to reset; sizes persisted locally |
| Batch mode | Checkboxes select cards; select all shown or clear the selection |
| Permanently delete windows | Deleting a window deletes its Session: the board runs the session-delete plugin's `delete-session` command, which stops live work and permanently removes the saved history. Requires a second confirmation and cannot be undone |
| Rename title | Click a card title to edit inline; Enter saves, Esc cancels; calls session rename so the conversation title stays in sync |
| Open session | A dedicated button at the card's top-right; clicking the card body, bubbles, or empty space no longer navigates |
| Two-way draft sync | The card input and the real session composer share the same draft in both directions |
| Wrapping input | An auto-growing textarea wraps long content; Shift+Enter inserts a newline, Enter sends |
| Inline reply | Input at the bottom of each card; Enter queues the message in that session |
| Workspace chip | Shows which workspace the session belongs to |
| Running badge | Green count on the sidebar button |
| i18n | Follows the DSH interface language (en / zh) |

## Install

```sh
dsh plugin --profile web add @yornii/dsh-session-unfold
```

Until the package is on npm, install from source instead:

```sh
dsh plugin --profile web add github:yornii/dsh-session-unfold
```

Or clone the repository and install the directory containing `package.json` through the plugin manager (`plugin_manager` with `install_bundle`, passing that absolute path as `target`). Once installation reports `application: applied`, reload the Web page — a "Task board" button appears at the bottom of the sidebar.

Permanent window deletion depends on the `delete-session` command provided by a separate `session-delete` plugin; without it installed and enabled, deletion reports that the command is unavailable.

Uninstall by removing `@yornii/dsh-session-unfold` in the plugin manager. The plugin does not modify any existing DSH file.

## Configuration

None required. One browser-local key is used; it never touches the session log or the Host:

| localStorage key | Value |
| --- | --- |
| `dsh.task-board.card-size.v1` | session id → card dimensions `{ w, h }` |

Status is read-only: running work is "In progress"; a just-finished non-main Session with an unread completion notice is "Done"; everything else is "To decide".

## How it works

- Client-only plugin: the Host half is an empty `apply()`; all logic lives in `client.js` (single file, no build step)
- Registers two slots and overrides nothing:
  - `sidebar.footer.action` — the launcher button
  - `shell.overlay` — the full-screen board
- New window calls `ctx.sessions.create({ workspaceId })`, the same Host `session/create` endpoint behind the sidebar's New session, then adds the returned Session id to the board. It never calls the navigating `uiWorkspace.startSession()`, so the board stays open. Workspace choice mirrors New session: the main view's Session Workspace, then the most recently active Workspace. The button is gated by `useRemoteAccess('session/create')`
- Each card calls `ctx.sessions.retain(sessionId, { source: 'taskBoard' })` to read that session's recent event window, re-folds it on every change, and releases the reference on unmount
- Cards fold `user/message` and `assistant/message` into one timeline; assistant replies render through a safe built-in Markdown subset (headings, bold, italic, inline code, code blocks, lists, tables, quotes, links). Tool calls stay off the card. The All / User only toggle filters the view without changing the underlying event window. Card sizes are changed with Pointer Events, snap to other cards, and are stored in localStorage
- Window pinning reads `useWorkspaces().pinnedSessionIds` and sorts those cards first in that exact order; the card button calls `uiWorkspace.pinSession` / `unpinSession`, so the sidebar and board share one pin state and order
- Subagent windows come from `useSessions().byId` rows with `origin === 'subagent'`; the header toggle controls whether they join the card list, and they stay hidden by default. Subagent cards are pure read-only views: no composer, title editor, pin, approval buttons, batch checkbox or Open session button
- History uses `binding.session.loadOlder()`: it prepends one page (at least 50 messages and two turns) to the current event window, and `eventSource.hasMore` controls the "Load earlier messages" affordance
- Title editing calls `binding.session.rename(title)`; the title projection updates the sidebar conversation title
- The input resolves `conversation.input.for(scope)` through `sessions.scope(sessionId)`, subscribes to its InputState `draft`, and writes back with `actions.setDraft(text)`, so both surfaces share one session draft
- The input is an auto-growing `textarea` sized from `scrollHeight`, with internal scrolling above `96px`
- Card status is read-only: the `shell.overlay` standard prop `useSessionStatus` supplies `running` / `completionUnread`, and the header shows only a status dot and label. There is no manual editor and no status entry in localStorage
- Approval sync reads the same `useSessionStatus`; when `pendingInteraction.kind === 'approval'`, the card renders a banner whose buttons call `approval.answer('allowed-once')` / `approval.answer('rejected')` without navigating
- Batch deletion is permanent: for each selected window the board runs `ctx.remote.commands.execute(sessionId, '/delete-session <id>', [])`, reusing the `session-delete` Host logic to stop live work, validate the session directory and remove the saved record. It requires a second confirmation and keeps failed windows. Both plugins must be enabled
- Archived sessions are filtered via `useWorkspaces().archivedSessionIds`; unarchiving in the sidebar brings the card back
- The catalog comes from the slot's standard `useSessions` prop. On very large session stores the list RPC can lag, so the board falls back to the `byId` rows already filled by the control channel instead of showing a blank screen
- Inline reply uses `binding.session.prompt([{ type: 'text', text }], 'queue')`
- Styling uses host theme tokens (`--dsw-alias-*`, `--dsw-radius-*`) so light and dark themes follow automatically

## Development

```bash
node --check client.js
node tools/render-test.mjs
```

`tools/render-test.mjs` is an offline render smoke test: it loads `client.js` with a fake Host, feeds synthetic sessions, renders the board to HTML, and asserts card structure, the full message timeline, resize handles and the presence of the controls. No browser needed, so it runs in CI.

## Limitations

- Status and card sizes live in the local browser only; they do not sync across machines
- Live message updates, session navigation and size persistence require a running Web page and are not covered by the offline smoke test
- DSH itself has no permanent-delete endpoint; batch deletion here runs the `delete-session` command from `session-delete`, so deletion fails when that plugin is disabled. Deleted sessions cannot be restored from the archive
- Draft sync carries text only; the card has no reference chips or attachment previews, so editing there degrades those rich spans to plain text
- The approval banner covers approval interactions only; plan reviews, questions, and other pending interactions still require opening the session
- The board initially shows 12 cards; more tasks page in through the "show more" button (no virtual scrolling yet)

## License

[MIT](LICENSE)
