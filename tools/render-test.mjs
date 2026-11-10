/**
 * Offline render harness: loads the plugin's client module with a fake
 * __ModuleLoader__, renders the board against synthetic session events, and
 * prints the resulting static HTML. No Host, no browser.
 * Run: node tools/render-test.mjs
 * Needs React and ReactDOM >= 18 resolvable from the DSH source checkout
 * (set DSH_ROOT to that checkout; defaults to ~/deepseek-harness).
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

// React is only a test dependency; resolve it from a DSH checkout (a pnpm store)
// or from a plain `npm i react react-dom` in this repository.
const root = process.env.DSH_ROOT ?? path.join(os.homedir(), 'deepseek-harness')
const require = createRequire(
  process.env.REACT_ROOT
    ? path.join(process.env.REACT_ROOT, 'package.json')
    : path.join(root, 'node_modules', '.pnpm', 'react@18.3.1', 'node_modules', 'react', 'package.json'),
)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// SSR uses getServerSnapshot; the board reads its open flag from getSnapshot,
// so make the hook resolve that snapshot here (client behaviour).
React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'client.js')
const source = readFileSync(clientPath, 'utf8')

let mod
globalThis.window = {
  __ModuleLoader__: { load: ({ factory }) => { mod = factory((name) => require(name)) } },
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
    setItem(key, value) { this.store.set(key, value) },
  },
  addEventListener() {}, removeEventListener() {}, setInterval() { return 0 }, clearInterval() {},
}
globalThis.document = { createElement: () => ({ innerHTML: '' }) }

new Function('module', 'exports', source.replace('let isOpen = false', 'let isOpen = true'))({}, {})

// ---- synthetic host: sessions with an event window per session ----
const now = Date.now()
const mkEntries = (title, running) => {
  const entries = [
    { type: 'event', event: { type: 'user/message', time: now - 9000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `帮我看下 ${title}` }] } } },
    { type: 'event', event: { type: 'turn/start', time: now - 8000, data: {} } },
    { type: 'event', event: { type: 'tool/call', time: now - 7000, data: { name: 'bash' } } },
    { type: 'event', event: { type: 'tool/call', time: now - 6000, data: { name: 'bash' } } },
    { type: 'event', event: { type: 'assistant/message', time: now - 5000, data: { message: { content: [{ type: 'text', text: `## 结论\n\n**${title}** 已处理完，无异常\n\n- \`ok\`` }] } } } },
  ]
  if (!running) entries.push({ type: 'event', event: { type: 'turn/end', time: now - 4000, data: { reason: { kind: 'completed' } } } })
  return entries
}
const sessions = [
  { id: 'a', title: 'Refactor auth middleware', running: true, at: now - 60e3 },
  { id: 'b', title: 'Investigate p99 latency', running: false, at: now - 900e3 },
  { id: 'c', title: 'Draft release notes', running: false, at: now - 3600e3 },
  { id: 'd', title: 'Security ticket triage', running: false, at: now - 7200e3 },
  { id: 'e', title: 'Empty scratch session', running: false, at: now - 86400e3 },
]
const windows = new Map(sessions.map(s => [s.id, mkEntries(s.title, s.running)]))

const byId = Object.fromEntries(sessions.map(s => [s.id, {
  id: s.id, displayTitle: s.title, running: s.running, updatedAt: s.at, blank: false, retainedBy: {},
}]))
byId.s = {
  id: 's', displayTitle: 'Subagent worker', running: false, updatedAt: now - 30e3,
  blank: false, origin: 'subagent', parentId: 'a', retainedBy: {},
}
const workspaces = [
  { workspaceId: 'w1', title: 'web-app', sessionIds: ['a', 'b', 'c'] },
  { workspaceId: 'w2', title: 'docs', sessionIds: ['d', 'e'] },
]

function makeHook(getSnapshot) {
  return (selector) => selector(getSnapshot())
}

const value = mod

// Grab the registered components by intercepting ctx.slots.register.
let Board, Launcher
const ctx = {
  locale: { register: () => () => {}, bind: () => (key, params) => {
    const dict = { subtitle: `${params ? params.total : ''} 个任务`, title: '任务大屏' }
    return dict[key] ?? key
  } },
  sessions: {
    retain: (sessionId) => {
      const listeners = new Set()
      const windowValue = { entries: windows.get(sessionId) }
      return {
        sessionId,
        binding: {
          eventSource: { getSnapshot: () => windowValue, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) } },
          session: { prompt: async () => ({ ok: true, value: { accepted: true } }) },
        },
        release: () => {},
      }
    },
  },
  uiWorkspace: { openSession: () => {} },
  effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
  slots: {
    inject: (_key, fn) => fn(),
    register: (_options, component) => {
      if (_options.name === 'shell.overlay') Board = component
      else Launcher = component
      return () => {}
    },
  },
}

value.apply(ctx)

const t = (key, params) => {
  const dict = {
    title: 'Task board',
    subtitle: '{total} tasks · {running} in progress',
    close: 'Close', search: 'Search tasks', filterHint: 'Filter by status',
    more: 'Show {n} more', resetSizes: 'Reset sizes', resizeHint: 'Resize',
    loadOlder: 'Load earlier', loadingOlder: 'Loading earlier…',
    batchMode: 'Batch', done: 'Done', selectedCount: '{n} selected', selectAll: 'Select shown',
    clearSelection: 'Clear', deleteWindows: 'Delete windows',
    deleteWindowsTitle: 'Permanently delete {n} windows?', deleteWindowsDesc: 'Delete windows description',
    continue: 'Continue', cancel: 'Cancel', back: 'Back', deleteSessionsTitle: 'Permanently delete {n} sessions?',
    deleteSessionsDesc: 'Delete sessions description', deleteSessionsWarning: 'Delete warning',
    confirmDeleteForever: 'Delete permanently', deleting: 'Deleting…',
    deletedWindows: 'Deleted {n}', deleteFailed: 'Delete failed {n}',
    newWindow: 'New window', newWindowHint: 'Create a session window without leaving the task board',
  creatingWindow: 'Creating…', newWindowNoWorkspace: 'No workspace', newWindowFailed: 'Failed: {message}',
  openSession: 'Open session', editTitle: 'Edit title', renameFailed: 'Rename failed',
    selectWindow: 'Select window', messageFilter: 'Message display', allMessages: 'All', userOnly: 'User only',
    tool: 'tool', approvalWaiting: 'Waiting: {tool}',
    allowOnce: 'Allow once', reject: 'Reject', approvalFailed: 'Approval failed',
    noSessions: 'No tasks', noMatch: 'No matches', loadingCard: 'Loading…', loadFailed: 'Load failed',
    noMessages: 'No messages yet', noUserMessages: 'No user messages yet', reply: 'Reply here', send: 'Send', statusHint: 'Status',
    'status.all': 'all', 'status.todo': 'to decide', 'status.doing': 'in progress', 'status.done': 'done',
    justNow: 'just now', minutesAgo: '{n}m ago', hoursAgo: '{n}h ago', daysAgo: '{n}d ago',
  }
  let out = dict[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) out = out.replace(`{${k}}`, String(v))
  return out
}

const sessionStatus = new Map([
  ['a', { running: true, pendingInteraction: undefined, completionUnread: false }],
  ['b', { running: false, pendingInteraction: undefined, completionUnread: true }],
])
const props = {
  t,
  sessions: ctx.sessions,
  openSession: () => {},
  deleteSession: async () => {},
  useSessions: makeHook(() => ({ ids: sessions.map(s => s.id), byId, phase: 'ready', projectionsBySession: {} })),
  useSessionStatus: (selector) => selector(sessionStatus),
  useRemoteAccess: (action) => action === 'session/create',
  createSession: async () => 'new-session',
  useWorkspaces: makeHook(() => ({ items: workspaces, archivedSessionIds: [], pinnedSessionIds: ['b'], state: 'idle', phase: 'ready', error: null })),
}

// Open the board before rendering.
const launcherHtml = renderToStaticMarkup(React.createElement(Launcher, { ...props, wide: true }))
console.log('LAUNCHER_OK:', launcherHtml.includes('dshtb-launch'))

// The shared flag starts closed; flip it through the module's own launcher path
// is not reachable from outside, so call the store via a synthetic click hook.
// Instead: render the board after the flag is set by a click handler on the launcher.
const boardHtml = renderToStaticMarkup(React.createElement(Board, props))
console.log('BOARD_HTML_BYTES:', boardHtml.length)
const noAccessHtml = renderToStaticMarkup(React.createElement(Board, {
  ...props,
  useRemoteAccess: () => false,
}))
for (const probe of ['Refactor auth middleware', 'web-app', 'docs', 'in progress', 'to decide', 'Reply here', 'dshtb-card', 'dshtb-cardWrap', 'dshtb-resize', 'dshtb-open', 'dshtb-filter', 'dshtb-bubbleAssistant', 'dshtb-md', 'dshtb-subagents', 'dshtb-pin']) {
  console.log(`HAS ${probe}:`, boardHtml.includes(probe))
}
const cards = (boardHtml.match(/class="dshtb-card"/g) || []).length
console.log('CARDS:', cards)
const order = [...boardHtml.matchAll(/class="dshtb-cardTitle"[^>]*>([^<]+)</g)].map(m => m[1])
console.log('ORDER:', order.join(' | '))
console.log('HAS_RESIZE_HANDLE:', boardHtml.includes('dshtb-resize'))
console.log('HAS_DEFAULT_CARD_SIZE:', boardHtml.includes('width:380px;height:250px'))
console.log('HAS_SEND_BUTTON:', boardHtml.includes('dshtb-sendBtn'))
console.log('HAS_TEXTAREA:', boardHtml.includes('<textarea'))
console.log('HAS_GREEN_BUBBLE_CSS:', boardHtml.includes('dshtb-bubbleDoing'))
console.log('HAS_STATUS_LABEL:', (boardHtml.match(/dshtb-stateLabel/g) || []).length)
console.log('HAS_AUTO_DONE:', boardHtml.includes('data-status="done"'))

// Simulate opening: the launcher's onClick calls setOpen(true); invoke it through
// React's props by rendering with a synthetic event is not needed — instead use
// the module's exported behaviour: dispatch a click on a mounted tree is DOM-only.
// Fallback: re-load module and patch isOpen through a second render pass.
// Exit non-zero when any expectation fails, so CI (and npm run check) can gate on it.
const failures = []
if (!launcherHtml.includes('dshtb-launch')) failures.push('launcher button missing')
if (!boardHtml.includes('dshtb-card')) failures.push('board did not render')
if (cards !== 5) failures.push(`expected 5 cards, got ${cards}`)
if (!source.includes("assistant/message")) failures.push('assistant messages are not projected')
if (source.includes("tool/call")) failures.push('tool calls should be hidden')
if (order[0] !== 'Investigate p99 latency') failures.push(`pinned task should sort first, got ${order[0]}`)
if (!boardHtml.includes('dshtb-cardWrap')) failures.push('resizable card wrapper missing')
if (!boardHtml.includes('dshtb-resize')) failures.push('card resize handle missing')
if (!boardHtml.includes('dshtb-open')) failures.push('open-session button missing')
if (!boardHtml.includes('class="dshtb-new"')) failures.push('new-session button missing')
if (!boardHtml.includes('without leaving the task board')) failures.push('new-window hint missing')
if (noAccessHtml.includes('class="dshtb-new"')) failures.push('new-window button ignores the session/create access gate')
if (!source.includes('ctx.sessions.create({ workspaceId })')) failures.push('new window does not create a Session')
if (source.includes('uiWorkspace.startSession()')) failures.push('new window still navigates away from the board')
if (!source.includes('/delete-session ${sessionId}')) failures.push('batch delete does not use the session-delete command')
if (source.includes('archiveSession')) failures.push('batch delete still archives instead of deleting')
if (source.includes('hideSessions') || source.includes('dsh.task-board.hidden')) failures.push('local-only window hiding still present')
if (!source.includes('deletedWindows')) failures.push('permanent delete result notice missing')
if (!boardHtml.includes('width:380px;height:250px')) failures.push('default card size missing')
if (!boardHtml.includes('dshtb-subagents')) failures.push('subagent toggle missing')
if (!boardHtml.includes('dshtb-pin')) failures.push('window pin control missing')
if (!source.includes('dshtb-readonly') || !source.includes('subagentReadOnly')) failures.push('subagent read-only view missing')
if (boardHtml.includes('Subagent worker')) failures.push('subagent window should be hidden by default')
if (!source.includes('pinSession')) failures.push('window pin does not use the Session pin service')
if (!boardHtml.includes('dshtb-sendBtn')) failures.push('inline reply missing')
if (!boardHtml.includes('dshtb-sendIcon')) failures.push('send icon missing')
if (boardHtml.includes('↵')) failures.push('old return-arrow send glyph still present')
if (!boardHtml.includes('border-radius:999px')) failures.push('maximum input rounding missing')
if (!boardHtml.includes('scrollbar-width:none')) failures.push('input scrollbar line still visible')
if (!boardHtml.includes('border-radius:50%;background:var(--dsw-alias-brand-primary)')) failures.push('circular blue send button missing')
if (!boardHtml.includes('dshtb-filterBar') || !boardHtml.includes('dshtb-bubbleAssistant') || !boardHtml.includes('dshtb-md')) failures.push('assistant timeline or user-only toggle missing')
if (boardHtml.includes('dshtb-toolName')) failures.push('tool call rows still visible')
if (!boardHtml.includes('dshtb-mdH2') || !boardHtml.includes('.dshtb-md code')) failures.push('assistant Markdown styles missing')
if (!boardHtml.includes('<textarea')) failures.push('wrapping draft textarea missing')
if (!boardHtml.includes('dshtb-bubbleDoing')) failures.push('in-progress bubble style missing')
if (boardHtml.includes('dshtb-stateSelect') || source.includes('dsh.task-board.status.v1')) failures.push('manual status control still present')
if (!boardHtml.includes('dshtb-stateLabel')) failures.push('read-only status label missing')
if (!boardHtml.includes('data-status="done"')) failures.push('automatic done status missing')
if (!boardHtml.includes('box-shadow:0 2px 6px rgba(0,0,0,.10)')) failures.push('card outer shadow missing')
if (!boardHtml.includes('web-app')) failures.push('workspace chip missing')
if (!boardHtml.includes('--dsh-frame-chrome-top')) failures.push('window chrome safe area missing')
if (failures.length > 0) {
  console.error('FAIL:', failures.join('; '))
  process.exit(1)
}
console.log('ALL ASSERTIONS PASSED')
