/**
 * Task board Client half: a sidebar launcher plus a full-screen board of live
 * Session mini-conversations.
 *
 * Data: the slot's `useSessions` / `useWorkspaces` standard props for the
 * catalog, `ctx.sessions.retain()` per card for the recent event window, and
 * `localStorage` for the per-Session status and card dimensions. No Host
 * projection is declared: the board only presents already-committed events.
 */
window.__ModuleLoader__.load({
  id: '@yornii/dsh-session-unfold',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'task-board'
    const INITIAL_VISIBLE = 12
    const SNAP_DISTANCE = 8
    const DEFAULT_CARD = { w: 380, h: 250 }
    const MIN_CARD = { w: 260, h: 180 }
    const MAX_CARD = { w: 960, h: 720 }
    const STATUSES = ['todo', 'doing', 'done']
    const STATUS_RANK = { doing: 0, todo: 1, done: 2 }
    const SIZE_STORAGE = 'dsh.task-board.card-size.v1'

    // ── shared open flag (the launcher and the overlay live in two slots) ──
    let isOpen = false
    const openListeners = new Set()
    function setOpen(next) {
      if (isOpen === next) return
      isOpen = next
      for (const listener of openListeners) listener()
    }
    function useOpen() {
      return React.useSyncExternalStore(
        (listener) => { openListeners.add(listener); return () => { openListeners.delete(listener) } },
        () => isOpen,
        () => false,
      )
    }

    // ── persisted card size ──
    function readStorage(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        return parsed ?? fallback
      } catch (_error) {
        return fallback
      }
    }
    function writeStorage(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)) } catch (_error) { /* private mode */ }
    }

    function clampSize(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }
    function resolveCardSize(value) {
      if (value === null || typeof value !== 'object') return { ...DEFAULT_CARD }
      const width = Number(value.w)
      const height = Number(value.h)
      return {
        w: Number.isFinite(width) ? clampSize(Math.round(width), MIN_CARD.w, MAX_CARD.w) : DEFAULT_CARD.w,
        h: Number.isFinite(height) ? clampSize(Math.round(height), MIN_CARD.h, MAX_CARD.h) : DEFAULT_CARD.h,
      }
    }

    let cardSizes = readStorage(SIZE_STORAGE, {})
    if (cardSizes === null || typeof cardSizes !== 'object' || Array.isArray(cardSizes)) cardSizes = {}
    const sizeListeners = new Set()
    function notifySizes() {
      for (const listener of sizeListeners) listener()
    }
    function setCardSize(sessionId, size) {
      cardSizes = { ...cardSizes, [sessionId]: resolveCardSize(size) }
      writeStorage(SIZE_STORAGE, cardSizes)
      notifySizes()
    }
    function resetCardSize(sessionId) {
      if (!(sessionId in cardSizes)) return
      const next = { ...cardSizes }
      delete next[sessionId]
      cardSizes = next
      writeStorage(SIZE_STORAGE, cardSizes)
      notifySizes()
    }
    function resetCardSizes() {
      if (Object.keys(cardSizes).length === 0) return
      cardSizes = {}
      writeStorage(SIZE_STORAGE, cardSizes)
      notifySizes()
    }
    function useCardSizes() {
      return React.useSyncExternalStore(
        (listener) => { sizeListeners.add(listener); return () => { sizeListeners.delete(listener) } },
        () => cardSizes,
        () => cardSizes,
      )
    }

    // ── event → card timeline ──
    function textOf(content) {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
      }
      return out.trim()
    }

    // ── compact, safe Markdown for assistant replies ──
    let markdownKey = 0
    function nextMarkdownKey(prefix) {
      markdownKey += 1
      return `${prefix}-${markdownKey}`
    }

    function markdownTextWithBreaks(text) {
      const nodes = []
      const lines = String(text).split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i] !== '') nodes.push(h(React.Fragment, { key: nextMarkdownKey('text') }, lines[i]))
        if (i < lines.length - 1) nodes.push(h('br', { key: nextMarkdownKey('br') }))
      }
      return nodes
    }

    function markdownInline(text) {
      const nodes = []
      const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g
      let last = 0
      let match
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(...markdownTextWithBreaks(text.slice(last, match.index)))
        const token = match[0]
        if (token.startsWith('`')) {
          nodes.push(h('code', { key: nextMarkdownKey('code') }, token.slice(1, -1)))
        } else if (token.startsWith('**') || token.startsWith('__')) {
          nodes.push(h('strong', { key: nextMarkdownKey('strong') }, markdownInline(token.slice(2, -2))))
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key: nextMarkdownKey('del') }, markdownInline(token.slice(2, -2))))
        } else if (token.startsWith('*') || token.startsWith('_')) {
          nodes.push(h('em', { key: nextMarkdownKey('em') }, markdownInline(token.slice(1, -1))))
        } else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          if (link === null) {
            nodes.push(h(React.Fragment, { key: nextMarkdownKey('text') }, token))
          } else if (/^(https?:\/\/|mailto:)/i.test(link[2])) {
            nodes.push(h('a', {
              key: nextMarkdownKey('link'),
              href: link[2],
              target: '_blank',
              rel: 'noreferrer noopener',
            }, markdownInline(link[1])))
          } else {
            nodes.push(h(React.Fragment, { key: nextMarkdownKey('text') }, link[1]))
          }
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(...markdownTextWithBreaks(text.slice(last)))
      return nodes
    }

    function markdownTableCells(line) {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      return trimmed.split('|').map(cell => cell.trim())
    }

    function markdownTableSeparator(line) {
      const cells = markdownTableCells(line)
      return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
    }

    function markdownBlocks(source) {
      const lines = String(source).replace(/\r\n?/g, '\n').split('\n')
      const blocks = []
      let index = 0
      const blank = (line) => line.trim() === ''
      const blockStart = (line) => {
        const value = line.trim()
        return /^```/.test(value)
          || /^#{1,6}\s+/.test(value)
          || /^>\s?/.test(value)
          || /^[-*+]\s+/.test(value)
          || /^\d+\.\s+/.test(value)
          || /^(\*{3,}|-{3,}|_{3,})$/.test(value)
      }

      while (index < lines.length) {
        const line = lines[index]
        if (blank(line)) {
          index += 1
          continue
        }

        const fence = /^```(.*)$/.exec(line)
        if (fence !== null) {
          const language = fence[1].trim()
          index += 1
          const code = []
          while (index < lines.length && !/^```\s*$/.test(lines[index])) {
            code.push(lines[index])
            index += 1
          }
          if (index < lines.length) index += 1
          blocks.push(h('pre', {
            key: nextMarkdownKey('pre'),
            className: 'dshtb-mdPre',
            'data-lang': language === '' ? undefined : language,
          }, h('code', null, code.join('\n'))))
          continue
        }

        if (line.includes('|') && index + 1 < lines.length && markdownTableSeparator(lines[index + 1])) {
          const head = markdownTableCells(line)
          index += 2
          const rows = []
          while (index < lines.length && !blank(lines[index]) && lines[index].includes('|')) {
            const cells = markdownTableCells(lines[index])
            rows.push(h('tr', { key: nextMarkdownKey('tr') }, head.map((_cell, cellIndex) => h('td', {
              key: nextMarkdownKey('td'),
            }, markdownInline(cells[cellIndex] ?? '')))))
            index += 1
          }
          blocks.push(h('div', {
            key: nextMarkdownKey('tableWrap'),
            className: 'dshtb-mdTableWrap',
          }, h('table', { className: 'dshtb-mdTable' },
          h('thead', null, h('tr', null, head.map((cell) => h('th', {
            key: nextMarkdownKey('th'),
          }, markdownInline(cell))))),
          h('tbody', null, rows))))
          continue
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          const level = heading[1].length
          blocks.push(h('div', {
            key: nextMarkdownKey('heading'),
            className: `dshtb-mdHeading dshtb-mdH${level}`,
            role: 'heading',
            'aria-level': level,
          }, markdownInline(heading[2])))
          index += 1
          continue
        }

        if (/^>\s?/.test(line)) {
          const quote = []
          while (index < lines.length && /^>\s?/.test(lines[index])) {
            quote.push(lines[index].replace(/^>\s?/, ''))
            index += 1
          }
          blocks.push(h('blockquote', {
            key: nextMarkdownKey('quote'),
            className: 'dshtb-mdQuote',
          }, markdownInline(quote.join('\n'))))
          continue
        }

        const unordered = /^[-*+]\s+(.*)$/.exec(line)
        const ordered = /^\d+\.\s+(.*)$/.exec(line)
        if (unordered !== null || ordered !== null) {
          const isOrdered = ordered !== null
          const items = []
          while (index < lines.length) {
            const item = isOrdered ? /^\d+\.\s+(.*)$/.exec(lines[index]) : /^[-*+]\s+(.*)$/.exec(lines[index])
            if (item === null) break
            items.push(h('li', { key: nextMarkdownKey('li') }, markdownInline(item[1])))
            index += 1
          }
          blocks.push(h(isOrdered ? 'ol' : 'ul', {
            key: nextMarkdownKey('list'),
            className: 'dshtb-mdList',
          }, items))
          continue
        }

        if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
          blocks.push(h('hr', { key: nextMarkdownKey('hr'), className: 'dshtb-mdHr' }))
          index += 1
          continue
        }

        const paragraph = [line]
        index += 1
        while (index < lines.length && !blank(lines[index]) && !blockStart(lines[index])) {
          paragraph.push(lines[index])
          index += 1
        }
        blocks.push(h('p', {
          key: nextMarkdownKey('paragraph'),
          className: 'dshtb-mdP',
        }, markdownInline(paragraph.join('\n'))))
      }
      return blocks
    }

    function MarkdownText({ text }) {
      return h('div', { className: 'dshtb-md' }, markdownBlocks(text))
    }

    /**
     * Fold the loaded event window into the card timeline: user messages and
     * assistant replies. Tool calls are intentionally hidden on the board.
     * Older pages are prepended by the Session controller when the user asks for
     * history, and `hasMore` tells the card whether another page exists.
     * @param entries - contiguous Client event window of one Session.
     */
    function summarize(entries) {
      const items = []
      let turnStart = 0
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        if (entry.type === 'transient') continue
        const event = entry.event
        if (!event) continue
        if (event.type === 'turn/start') {
          turnStart = event.time || 0
        } else if (event.type === 'turn/end') {
          turnStart = 0
        } else if (event.type === 'user/message') {
          const data = event.data || {}
          const source = data.source
          const text = textOf(data.content)
          const fromUser = source && (source.kind === 'user' || source.kind === 'user-rpc')
          if (fromUser && text !== '') {
            items.push({ kind: 'user', text, time: event.time || 0 })
          }
        } else if (event.type === 'assistant/message') {
          const data = event.data || {}
          const text = textOf(data.message?.content ?? data.content)
          if (text !== '') {
            items.push({ kind: 'assistant', text, time: event.time || 0 })
          }
        }
      }
      return {
        items,
        turnStart,
      }
    }

    // ── formatting ──
    function relativeTime(time, t, now) {
      if (!time) return ''
      const diff = now - time
      if (diff < 60e3) return t('justNow')
      const minutes = Math.floor(diff / 60e3)
      if (minutes < 60) return t('minutesAgo', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('hoursAgo', { n: hours })
      return t('daysAgo', { n: Math.floor(hours / 24) })
    }

    function elapsed(since, now) {
      if (!since || since > now) return ''
      const total = Math.floor((now - since) / 1000)
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`
    }

    // ── one Session card ──
    function Card(props) {
      const {
        sessionId, summary, status, workspace, size, selecting, selected, approval, pinned,
        t, sessions, now, onOpen, onToggleSelect, onTogglePin, onResize, onResetSize,
      } = props
      const [state, setState] = React.useState(null)
      const [userOnly, setUserOnly] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const [loadingOlder, setLoadingOlder] = React.useState(false)
      const [snap, setSnap] = React.useState('')
      const [dims, setDims] = React.useState(size)
      const [editingTitle, setEditingTitle] = React.useState(false)
      const [titleDraft, setTitleDraft] = React.useState(summary.displayTitle)
      const [titleOverride, setTitleOverride] = React.useState(null)
      const [savingTitle, setSavingTitle] = React.useState(false)
      const [titleError, setTitleError] = React.useState(false)
      const [approvalBusy, setApprovalBusy] = React.useState(false)
      const [approvalError, setApprovalError] = React.useState(false)
      const [pinBusy, setPinBusy] = React.useState(false)
      const referenceRef = React.useRef(null)
      const dragCleanupRef = React.useRef(null)
      const bodyRef = React.useRef(null)
      const loadedRef = React.useRef(false)
      const titleInputRef = React.useRef(null)
      const titleSavingRef = React.useRef(false)
      const skipTitleBlurRef = React.useRef(false)
      const inputShellRef = React.useRef(null)
      const inputRef = React.useRef(null)

      React.useEffect(() => {
        setDims(size)
      }, [size.w, size.h])

      React.useEffect(() => {
        setTitleOverride(null)
      }, [summary.displayTitle])

      React.useEffect(() => {
        setApprovalBusy(false)
        setApprovalError(false)
      }, [approval === null || approval === undefined ? '' : approval.key])

      React.useEffect(() => {
        const input = titleInputRef.current
        if (!editingTitle || input === null) return
        input.focus()
        input.select()
      }, [editingTitle])

      React.useEffect(() => () => {
        if (dragCleanupRef.current !== null) dragCleanupRef.current()
      }, [])

      React.useEffect(() => {
        let reference
        try {
          reference = sessions.retain(sessionId, { source: 'taskBoard' })
        } catch (_error) {
          setState({ failed: true })
          return undefined
        }
        referenceRef.current = reference
        const source = reference.binding.eventSource
        const read = () => {
          try {
            const snapshot = source.getSnapshot()
            const summary = summarize(snapshot.entries)
            setState({
              ...summary,
              hasMore: snapshot.hasMore === true,
              change: snapshot.change === undefined ? 'replace' : snapshot.change.kind,
            })
          } catch (_error) {
            setState({ failed: true })
          }
        }
        read()
        const dispose = source.subscribe(read)
        return () => {
          referenceRef.current = null
          dispose()
          try { reference.release() } catch (_error) { /* already disposed */ }
        }
      }, [sessionId, sessions])

      React.useEffect(() => {
        let shell
        try {
          const scope = sessions.scope(sessionId)
          const conversation = scope === undefined ? undefined : scope.get('conversation')
          shell = conversation === undefined ? undefined : conversation.input.for(scope)
        } catch (_error) {
          shell = undefined
        }
        if (shell === undefined) return undefined
        inputShellRef.current = shell
        const read = () => {
          try {
            const snapshot = shell.state.getSnapshot()
            setDraft(typeof snapshot.draft === 'string' ? snapshot.draft : '')
          } catch (_error) {
            /* The composer may be torn down while the card is still mounted. */
          }
        }
        read()
        const dispose = shell.state.subscribe(read)
        return () => {
          if (inputShellRef.current === shell) inputShellRef.current = null
          dispose()
        }
      }, [sessionId, sessions])

      const updateDraft = (text) => {
        setDraft(text)
        const shell = inputShellRef.current
        if (shell === null) return
        try { shell.actions.setDraft(text) } catch (_error) { /* composer unavailable */ }
      }

      const resizeTextarea = () => {
        const input = inputRef.current
        if (input === null) return
        input.style.height = 'auto'
        input.style.height = `${Math.min(input.scrollHeight, 96)}px`
      }

      React.useEffect(() => {
        resizeTextarea()
      }, [draft, dims.w])

      const send = async () => {
        const text = draft.trim()
        const reference = referenceRef.current
        if (text === '' || sending || reference === null) return
        updateDraft('')
        setSending(true)
        try {
          const result = await reference.binding.session.prompt([{ type: 'text', text }], 'queue')
          if (result === undefined || !result.ok) updateDraft(text)
        } catch (_error) {
          updateDraft(text)
        } finally {
          setSending(false)
        }
      }

      const loadOlder = async () => {
        const reference = referenceRef.current
        if (reference === null || loadingOlder || !state || state.hasMore !== true) return
        setLoadingOlder(true)
        try {
          await reference.binding.session.loadOlder()
        } catch (_error) {
          /* The Session keeps the current window when an older page cannot be read. */
        } finally {
          setLoadingOlder(false)
        }
      }

      const displayTitle = titleOverride ?? summary.displayTitle ?? ''
      const approvalReason = approval !== null && approval !== undefined && typeof approval.reason === 'string'
        ? approval.reason
        : ''

      const answerApproval = async (outcome) => {
        if (approval === null || approval === undefined || approvalBusy || approval.answerable === false) return
        setApprovalBusy(true)
        setApprovalError(false)
        try {
          await approval.answer(outcome)
        } catch (_error) {
          setApprovalError(true)
        } finally {
          setApprovalBusy(false)
        }
      }

      const startTitleEdit = () => {
        skipTitleBlurRef.current = false
        setTitleDraft(displayTitle)
        setTitleError(false)
        setEditingTitle(true)
      }

      const cancelTitleEdit = () => {
        skipTitleBlurRef.current = true
        setEditingTitle(false)
        setTitleDraft(displayTitle)
        setTitleError(false)
      }

      const commitTitle = async () => {
        if (!editingTitle || titleSavingRef.current) return
        const next = titleDraft.trim()
        if (next === '' || next === displayTitle) {
          setEditingTitle(false)
          setTitleDraft(displayTitle)
          setTitleError(false)
          return
        }
        const reference = referenceRef.current
        if (reference === null) {
          setTitleError(true)
          return
        }
        titleSavingRef.current = true
        setSavingTitle(true)
        try {
          const result = await reference.binding.session.rename(next)
          if (result !== undefined && result.ok) {
            setTitleOverride(result.value.title)
            setTitleDraft(result.value.title)
            setTitleError(false)
            setEditingTitle(false)
          } else {
            setTitleError(true)
          }
        } catch (_error) {
          setTitleError(true)
        } finally {
          titleSavingRef.current = false
          setSavingTitle(false)
        }
      }

      const beginResize = (event) => {
        if (event.button !== 0 && event.pointerType !== 'touch') return
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startY = event.clientY
        const startW = dims.w
        const startH = dims.h
        const wrapper = event.currentTarget.closest === undefined
          ? null
          : event.currentTarget.closest('.dshtb-cardWrap')
        const board = wrapper === null ? null : wrapper.parentElement
        const widthTargets = []
        const heightTargets = []
        if (board !== null) {
          for (const card of board.querySelectorAll('.dshtb-cardWrap')) {
            if (card === wrapper) continue
            const rect = card.getBoundingClientRect()
            const width = Math.round(rect.width)
            const height = Math.round(rect.height)
            if (width >= MIN_CARD.w && width <= MAX_CARD.w) widthTargets.push(width)
            if (height >= MIN_CARD.h && height <= MAX_CARD.h) heightTargets.push(height)
          }
        }
        const nearest = (value, targets) => {
          let best = null
          let bestDistance = SNAP_DISTANCE + 1
          for (const target of targets) {
            const distance = Math.abs(target - value)
            if (distance < bestDistance) {
              best = target
              bestDistance = distance
            }
          }
          return bestDistance <= SNAP_DISTANCE ? best : null
        }
        const nextSize = (clientX, clientY) => {
          const rawWidth = clampSize(Math.round(startW + clientX - startX), MIN_CARD.w, MAX_CARD.w)
          const rawHeight = clampSize(Math.round(startH + clientY - startY), MIN_CARD.h, MAX_CARD.h)
          const snapWidth = nearest(rawWidth, widthTargets)
          const snapHeight = nearest(rawHeight, heightTargets)
          setSnap(`${snapWidth === null ? '' : 'w'}${snapHeight === null ? '' : 'h'}`)
          return {
            w: snapWidth ?? rawWidth,
            h: snapHeight ?? rawHeight,
          }
        }
        function cleanup() {
          setSnap('')
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', cancel)
          dragCleanupRef.current = null
        }
        function move(moveEvent) {
          setDims(nextSize(moveEvent.clientX, moveEvent.clientY))
        }
        function finish(upEvent) {
          const next = nextSize(upEvent.clientX, upEvent.clientY)
          cleanup()
          setDims(next)
          onResize(sessionId, next)
        }
        function cancel() {
          cleanup()
          setDims({ w: startW, h: startH })
        }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch (_error) { /* pointer capture is best effort */ }
        dragCleanupRef.current = cleanup
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', cancel)
      }

      const resizeBy = (dw, dh) => {
        const next = {
          w: clampSize(dims.w + dw, MIN_CARD.w, MAX_CARD.w),
          h: clampSize(dims.h + dh, MIN_CARD.h, MAX_CARD.h),
        }
        setDims(next)
        onResize(sessionId, next)
      }

      const allItems = state && state.items ? state.items : []
      const items = userOnly ? allItems.filter(item => item.kind === 'user') : allItems
      let lastUserIndex = -1
      for (let index = 0; index < items.length; index += 1) {
        if (items[index].kind === 'user') lastUserIndex = index
      }
      const failed = state !== null && state.failed === true
      const readOnly = summary.origin === 'subagent'

      React.useEffect(() => {
        const body = bodyRef.current
        if (body === null || state === null) return
        if (state.change === 'prepend') {
          body.scrollTop = 0
          return
        }
        if (!loadedRef.current) {
          loadedRef.current = true
          body.scrollTop = body.scrollHeight
          return
        }
        const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 48
        if (nearBottom) body.scrollTop = body.scrollHeight
      }, [state])

      React.useEffect(() => {
        const body = bodyRef.current
        if (body !== null) body.scrollTop = body.scrollHeight
      }, [userOnly])

      return h('div', {
        className: 'dshtb-cardWrap',
        style: { width: dims.w, height: dims.h },
        'data-session': sessionId,
        'data-snap': snap === '' ? undefined : snap,
      },
      h('div', {
        className: 'dshtb-card',
        'data-status': status,
        'data-selected': selected ? 'true' : undefined,
      },
      h('div', { className: 'dshtb-cardHead' },
        selecting && !readOnly
          ? h('input', {
            type: 'checkbox',
            className: 'dshtb-check',
            checked: selected,
            'aria-label': t('selectWindow'),
            onClick: (event) => event.stopPropagation(),
            onChange: () => onToggleSelect(sessionId),
          })
          : null,
        h('span', {
          className: 'dshtb-state',
          'data-status': status,
          title: t('statusHint'),
          'aria-label': `${t('statusHint')}: ${t(`status.${status}`)}`,
        },
        h('span', { className: 'dshtb-stateDot' }),
        h('span', { className: 'dshtb-stateLabel' }, t(`status.${status}`))),
        readOnly
          ? h('span', {
            className: 'dshtb-cardTitle dshtb-cardTitleReadonly',
            title: displayTitle,
          }, displayTitle)
          : editingTitle
            ? h('input', {
            ref: titleInputRef,
            className: 'dshtb-titleInput',
            value: titleDraft,
            disabled: savingTitle,
            'data-error': titleError ? 'true' : undefined,
            'aria-invalid': titleError ? 'true' : undefined,
            'aria-label': t('editTitle'),
            title: titleError ? t('renameFailed') : t('editTitle'),
            onChange: (event) => { setTitleDraft(event.target.value); setTitleError(false) },
            onBlur: () => {
              if (skipTitleBlurRef.current) {
                skipTitleBlurRef.current = false
                return
              }
              void commitTitle()
            },
            onKeyDown: (event) => {
              if (event.nativeEvent?.isComposing === true || event.isComposing === true) return
              if (event.key === 'Enter') {
                event.preventDefault()
                void commitTitle()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                cancelTitleEdit()
              }
            },
          })
          : h('button', {
            type: 'button',
            className: 'dshtb-cardTitle',
            title: displayTitle === '' ? t('editTitle') : `${displayTitle} · ${t('editTitle')}`,
            onClick: startTitleEdit,
          }, displayTitle),
        summary.origin === 'subagent'
          ? h('span', { className: 'dshtb-subagentTag', title: t('subagentTag') }, t('subagentTag'))
          : null,
        workspace !== undefined
          ? h('span', { className: 'dshtb-ws', title: workspace }, workspace)
          : null,
        summary.running && state && state.turnStart
          ? h('span', { className: 'dshtb-time dshtb-running' }, elapsed(state.turnStart, now))
          : h('span', { className: 'dshtb-time' }, relativeTime(summary.updatedAt, t, now)),
        summary.origin !== 'subagent'
          ? h('button', {
            type: 'button',
            className: `dshtb-pin${pinned ? ' on' : ''}`,
            title: pinned ? t('unpin') : t('pin'),
            'aria-label': pinned ? t('unpin') : t('pin'),
            'aria-pressed': pinned,
            disabled: pinBusy,
            onClick: (event) => {
              event.stopPropagation()
              if (pinBusy) return
              setPinBusy(true)
              Promise.resolve(onTogglePin(sessionId, !pinned)).finally(() => setPinBusy(false))
            },
          }, h(PinIcon))
          : null,
        readOnly
          ? null
          : h('button', {
            type: 'button',
            className: 'dshtb-open',
            title: t('openSession'),
            'aria-label': t('openSession'),
            onClick: (event) => {
              event.stopPropagation()
              onOpen(sessionId)
            },
          }, h(OpenIcon))),
      h('div', {
        className: 'dshtb-filterBar',
        role: 'group',
        'aria-label': t('messageFilter'),
      },
      h('button', {
        type: 'button',
        className: `dshtb-filter${userOnly ? '' : ' on'}`,
        'aria-pressed': !userOnly,
        onClick: (event) => {
          event.stopPropagation()
          setUserOnly(false)
        },
      }, t('allMessages')),
      h('button', {
        type: 'button',
        className: `dshtb-filter${userOnly ? ' on' : ''}`,
        'aria-pressed': userOnly,
        onClick: (event) => {
          event.stopPropagation()
          setUserOnly(true)
        },
      }, t('userOnly'))),
      approval !== null && approval !== undefined
        ? h('div', { className: 'dshtb-approval', role: 'status' },
          h('span', { className: 'dshtb-approvalDot' }),
          h('div', { className: 'dshtb-approvalText' },
            h('div', { className: 'dshtb-approvalTitle' },
              t('approvalWaiting', { tool: approval.toolName || t('tool') })),
            approvalReason === ''
              ? null
              : h('div', { className: 'dshtb-approvalReason', title: approvalReason }, approvalReason),
            approvalError
              ? h('div', { className: 'dshtb-approvalError', role: 'alert' }, t('approvalFailed'))
              : null),
          approval.answerable === false || readOnly
            ? null
            : h('div', { className: 'dshtb-approvalActions' },
              h('button', {
                type: 'button',
                className: 'dshtb-approvalReject',
                disabled: approvalBusy,
                onClick: (event) => {
                  event.stopPropagation()
                  void answerApproval('rejected')
                },
              }, approvalBusy ? '…' : t('reject')),
              h('button', {
                type: 'button',
                className: 'dshtb-approvalAllow',
                disabled: approvalBusy,
                onClick: (event) => {
                  event.stopPropagation()
                  void answerApproval('allowed-once')
                },
              }, approvalBusy ? '…' : t('allowOnce'))))
        : null,
      titleError && editingTitle
        ? h('div', { className: 'dshtb-titleError', role: 'alert' }, t('renameFailed'))
        : null,
      h('div', {
        className: 'dshtb-body',
        ref: bodyRef,
      },
      state !== null && !failed && state.hasMore
        ? h('button', {
          type: 'button',
          className: 'dshtb-history',
          disabled: loadingOlder,
          onPointerDown: (event) => event.stopPropagation(),
          onClick: (event) => {
            event.stopPropagation()
            void loadOlder()
          },
        }, loadingOlder ? t('loadingOlder') : t('loadOlder'))
        : null,
      state === null ? h('div', { className: 'dshtb-empty' }, t('loadingCard')) : null,
      failed ? h('div', { className: 'dshtb-empty' }, t('loadFailed')) : null,
      state !== null && !failed && items.length === 0
        ? h('div', { className: 'dshtb-empty' }, userOnly ? t('noUserMessages') : t('noMessages'))
        : null,
      failed ? null : items.map((item, index) => {
        const title = item.time ? new Date(item.time).toLocaleString() : undefined
        if (item.kind === 'user') {
          const doing = status === 'doing' && index === lastUserIndex
          return h('div', {
            key: `user-${index}-${item.time}`,
            className: `dshtb-bubble dshtb-bubbleUser${doing ? ' dshtb-bubbleDoing' : ''}`,
            title,
          }, item.text)
        }
        return h('div', {
          key: `assistant-${index}-${item.time}`,
          className: 'dshtb-bubble dshtb-bubbleAssistant',
          title,
        }, h(MarkdownText, { text: item.text }))
      })),
      readOnly
        ? h('div', { className: 'dshtb-readonly' }, t('subagentReadOnly'))
        : h('div', {
          className: 'dshtb-send',
          onClick: (event) => event.stopPropagation(),
        },
        h('textarea', {
          ref: inputRef,
          className: 'dshtb-input',
          rows: 1,
          wrap: 'soft',
          value: draft,
          placeholder: t('reply'),
          'aria-label': t('reply'),
          onChange: (event) => updateDraft(event.target.value),
          onKeyDown: (event) => {
            if (
              event.key === 'Enter'
              && !event.shiftKey
              && event.nativeEvent?.isComposing !== true
              && event.isComposing !== true
            ) {
              event.preventDefault()
              void send()
            }
          },
        }),
        h('button', {
          type: 'button',
          className: 'dshtb-sendBtn',
          disabled: sending || draft.trim() === '',
          onClick: () => { void send() },
          title: t('send'),
        }, sending ? '…' : h(SendIcon))),
      h('button', {
        type: 'button',
        className: 'dshtb-resize',
        title: t('resizeHint'),
        'aria-label': t('resizeHint'),
        onPointerDown: beginResize,
        onDoubleClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onResetSize(sessionId)
        },
        onKeyDown: (event) => {
          const step = event.shiftKey ? 40 : 10
          if (event.key === 'ArrowRight') { event.preventDefault(); resizeBy(step, 0) }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); resizeBy(-step, 0) }
          else if (event.key === 'ArrowDown') { event.preventDefault(); resizeBy(0, step) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); resizeBy(0, -step) }
        },
      })))
    }

    // ── the full-screen board ──
    function Board(props) {
      const open = useOpen()
      const ids = props.useSessions(state => state.ids)
      const byId = props.useSessions(state => state.byId)
      const workspaceItems = props.useWorkspaces(state => state.items)
      const archivedIds = props.useWorkspaces(state => state.archivedSessionIds ?? [])
      const pinnedIds = props.useWorkspaces(state => state.pinnedSessionIds ?? [])
      const cardSizes = useCardSizes()
      const sessionStatuses = props.useSessionStatus(state => state)
      const canCreateSession = props.useRemoteAccess('session/create')
      const [query, setQuery] = React.useState('')
      const [statusFilter, setStatusFilter] = React.useState('all')
      const [shown, setShown] = React.useState(INITIAL_VISIBLE)
      const [now, setNow] = React.useState(() => Date.now())
      const [selecting, setSelecting] = React.useState(false)
      const [selected, setSelected] = React.useState(() => new Set())
      const [deleteRequest, setDeleteRequest] = React.useState(null)
      const [deleting, setDeleting] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [creating, setCreating] = React.useState(false)
      const [createdSessionIds, setCreatedSessionIds] = React.useState(() => new Set())
      const [revealSessionId, setRevealSessionId] = React.useState(null)
      const [showSubagents, setShowSubagents] = React.useState(false)
      const gridRef = React.useRef(null)
      const creatingRef = React.useRef(false)
      const deletingRef = React.useRef(false)
      const t = props.t

      const archived = React.useMemo(() => new Set(archivedIds), [archivedIds])
      const pinnedOrder = React.useMemo(() => new Map(pinnedIds.map((id, index) => [id, index])), [pinnedIds])
      const subagents = React.useMemo(() => (
        Object.values(byId).filter(summary => summary.origin === 'subagent' && !archived.has(summary.id))
      ), [byId, archived])

      const workspaceOf = React.useMemo(() => {
        const map = new Map()
        for (const item of workspaceItems) {
          for (const sessionId of item.sessionIds) map.set(sessionId, item.title)
        }
        return map
      }, [workspaceItems])

      const workspaceIdOf = React.useMemo(() => {
        const map = new Map()
        for (const item of workspaceItems) {
          for (const sessionId of item.sessionIds) map.set(sessionId, item.workspaceId)
        }
        return map
      }, [workspaceItems])

      // New Window follows New Session's Workspace policy: the Workspace of the
      // Session retained by the main view, otherwise the most recently active one.
      const targetWorkspaceId = React.useMemo(() => {
        let currentSessionId
        let currentTime = Number.NEGATIVE_INFINITY
        for (const summary of Object.values(byId)) {
          if ((summary.retainedBy?.mainView ?? 0) <= 0) continue
          if ((summary.updatedAt || 0) > currentTime) {
            currentSessionId = summary.id
            currentTime = summary.updatedAt || 0
          }
        }
        if (currentSessionId !== undefined) {
          const currentWorkspace = workspaceIdOf.get(currentSessionId)
          if (currentWorkspace !== undefined) return currentWorkspace
        }
        let selected
        let selectedTime = Number.NEGATIVE_INFINITY
        for (const item of workspaceItems) {
          let latest = Number.NEGATIVE_INFINITY
          for (const sessionId of item.sessionIds) {
            const summary = byId[sessionId]
            if (summary !== undefined) latest = Math.max(latest, summary.updatedAt || 0)
          }
          if (latest === Number.NEGATIVE_INFINITY) {
            const created = Date.parse(item.createdAt || '')
            latest = Number.isFinite(created) ? created : 0
          }
          if (selected === undefined || latest > selectedTime) {
            selected = item.workspaceId
            selectedTime = latest
          }
        }
        return selected
      }, [byId, workspaceIdOf, workspaceItems])

      // `ids` is the Host list order; it stays empty until `session.list` lands,
      // while `byId` is already filled from the control baseline. Fall back to
      // non-subagent rows so the board is usable before the list RPC settles.
      const rows = React.useMemo(() => {
        const list = []
        const seen = new Set()
        const add = (summary) => {
          if (summary === undefined || seen.has(summary.id)) return
          if (archived.has(summary.id)) return
          if (summary.origin === 'subagent' && !showSubagents) return
          seen.add(summary.id)
          list.push(summary)
        }
        for (const id of ids) add(byId[id])
        // A just-created blank Session may land in `byId` before the ordered
        // catalog row reaches `ids`; its card must still appear immediately.
        for (const id of createdSessionIds) add(byId[id])
        if (showSubagents) {
          for (const summary of Object.values(byId)) {
            if (summary.origin === 'subagent') add(summary)
          }
        }
        if (list.length === 0) {
          for (const summary of Object.values(byId)) {
            if (summary.origin !== 'subagent') add(summary)
          }
        }
        return list
      }, [ids, byId, archived, createdSessionIds, showSubagents])

      // Status is read-only and comes from live Session state: running work is
      // "doing", a finished but unread non-main turn is "done", everything else
      // waits for the user.
      const statusOf = React.useCallback((summary) => {
        const live = sessionStatuses.get(summary.id)
        if (summary.running === true || live?.running === true) return 'doing'
        if (live?.completionUnread === true) return 'done'
        return 'todo'
      }, [sessionStatuses])

      const visible = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        const list = []
        for (const summary of rows) {
          const status = statusOf(summary)
          if (statusFilter !== 'all' && status !== statusFilter) continue
          if (needle !== '') {
            const workspace = workspaceOf.get(summary.id) ?? ''
            const haystack = `${summary.displayTitle ?? ''} ${workspace}`.toLowerCase()
            if (!haystack.includes(needle)) continue
          }
          list.push({ summary, status })
        }
        list.sort((left, right) => {
          const leftPin = pinnedOrder.get(left.summary.id)
          const rightPin = pinnedOrder.get(right.summary.id)
          if (leftPin !== undefined || rightPin !== undefined) {
            if (leftPin === undefined) return 1
            if (rightPin === undefined) return -1
            if (leftPin !== rightPin) return leftPin - rightPin
          }
          const rank = (STATUS_RANK[left.status] ?? 9) - (STATUS_RANK[right.status] ?? 9)
          if (rank !== 0) return rank
          return (right.summary.updatedAt || 0) - (left.summary.updatedAt || 0)
        })
        return list
      }, [rows, query, statusFilter, statusOf, workspaceOf, pinnedOrder])

      const running = visible.reduce((count, row) => count + (row.summary.running ? 1 : 0), 0)
      const limit = shown
      const displayed = visible.slice(0, limit)

      const approvalOf = (sessionId) => {
        const pending = sessionStatuses.get(sessionId)?.pendingInteraction
        return pending !== undefined && pending.kind === 'approval' ? pending : null
      }

      const toggleSelected = (sessionId) => {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(sessionId)) next.delete(sessionId)
          else next.add(sessionId)
          return next
        })
      }

      const selectAllDisplayed = () => {
        setSelected(new Set(displayed
          .filter(row => row.summary.origin !== 'subagent')
          .map(row => row.summary.id)))
      }

      // One window per Session: create a real Session without navigating, then
      // surface its card on the board. `sessions.create` is the same Host
      // `session/create` endpoint the sidebar's New Session uses.
      const startNewSession = async () => {
        if (creatingRef.current) return
        if (targetWorkspaceId === undefined) {
          setNotice(t('newWindowNoWorkspace'))
          return
        }
        creatingRef.current = true
        setCreating(true)
        setNotice(null)
        try {
          const sessionId = await props.createSession(targetWorkspaceId)
          setCreatedSessionIds((previous) => {
            if (previous.has(sessionId)) return previous
            const next = new Set(previous)
            next.add(sessionId)
            return next
          })
          setQuery('')
          setStatusFilter('all')
          setRevealSessionId(sessionId)
        } catch (error) {
          setNotice(t('newWindowFailed', {
            message: error instanceof Error ? error.message : String(error),
          }))
        } finally {
          creatingRef.current = false
          setCreating(false)
        }
      }

      const togglePin = async (sessionId, nextPinned) => {
        try {
          await props.togglePin(sessionId, nextPinned)
        } catch (_error) {
          setNotice(t('pinFailed'))
        }
      }

      const toggleSubagents = () => {
        const next = !showSubagents
        setShowSubagents(next)
        if (next && subagents.length > 0) setRevealSessionId(subagents[0].id)
      }

      const performDelete = async () => {
        if (deleteRequest === null || deletingRef.current) return
        const request = deleteRequest
        deletingRef.current = true
        setDeleting(true)
        const deleted = []
        const failed = []
        try {
          // The session-delete plugin's global command is the single permanent
          // deletion path. Running it per Session also stops live work first.
          for (const sessionId of request.ids) {
            try {
              await props.deleteSession(sessionId)
              deleted.push(sessionId)
            } catch (_error) {
              failed.push(sessionId)
            }
          }
          if (failed.length === 0) {
            setSelected(new Set())
            setSelecting(false)
            setNotice(t('deletedWindows', { n: deleted.length }))
          } else {
            setSelected(new Set(failed))
            setNotice(t('deleteFailed', { n: failed.length }))
          }
          setDeleteRequest(null)
        } finally {
          deletingRef.current = false
          setDeleting(false)
        }
      }

      const confirmDelete = () => {
        if (deleteRequest === null) return
        if (deleteRequest.step === 1) {
          setDeleteRequest({ ...deleteRequest, step: 2 })
          return
        }
        void performDelete()
      }

      React.useEffect(() => {
        setSelected((previous) => {
          if (previous.size === 0) return previous
          const available = new Set(visible.map(row => row.summary.id))
          const next = new Set([...previous].filter(sessionId => available.has(sessionId)))
          return next.size === previous.size ? previous : next
        })
      }, [visible])

      React.useEffect(() => { setShown(INITIAL_VISIBLE) }, [query, statusFilter])

      React.useEffect(() => {
        if (revealSessionId === null) return
        const index = visible.findIndex(row => row.summary.id === revealSessionId)
        if (index < 0) return
        if (index >= limit) {
          setShown(index + 1)
          return
        }
        const grid = gridRef.current
        if (grid === null) return
        let card = null
        for (const candidate of grid.querySelectorAll('.dshtb-cardWrap')) {
          if (candidate.getAttribute('data-session') === revealSessionId) {
            card = candidate
            break
          }
        }
        if (card === null) return
        if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' })
        setRevealSessionId(null)
      }, [revealSessionId, visible, limit])

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (deleteRequest !== null) {
            if (deleting) return
            event.preventDefault()
            event.stopPropagation()
            setDeleteRequest(null)
            return
          }
          setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, deleteRequest, deleting])

      React.useEffect(() => {
        if (!open) return undefined
        setNow(Date.now())
        const delay = running > 0 ? 1000 : 30000
        const timer = window.setInterval(() => setNow(Date.now()), delay)
        return () => window.clearInterval(timer)
      }, [open, running])

      const renderDeleteDialog = () => {
        if (deleteRequest === null) return null
        const firstStep = deleteRequest.step === 1
        return h('div', {
          className: 'dshtb-modalLayer',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !deleting) setDeleteRequest(null)
          },
        },
        h('div', {
          className: 'dshtb-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('deleteWindows'),
        },
        h('div', { className: 'dshtb-modalTitle' },
          firstStep
            ? t('deleteWindowsTitle', { n: deleteRequest.ids.length })
            : t('deleteSessionsTitle', { n: deleteRequest.ids.length })),
        h('div', { className: 'dshtb-modalBody' },
          firstStep
            ? [
              h('p', { key: 'desc', className: 'dshtb-modalText' }, t('deleteWindowsDesc', { n: deleteRequest.ids.length })),
              h('p', { key: 'warn', className: 'dshtb-modalWarning' }, t('deleteSessionsWarning')),
            ]
            : [
              h('p', { key: 'desc', className: 'dshtb-modalText' }, t('deleteSessionsDesc', { n: deleteRequest.ids.length })),
              h('p', { key: 'warn', className: 'dshtb-modalWarning' }, t('deleteSessionsWarning')),
            ]),
        h('div', { className: 'dshtb-modalActions' },
          firstStep
            ? null
            : h('button', {
              type: 'button',
              className: 'dshtb-modalSecondary',
              disabled: deleting,
              onClick: () => setDeleteRequest({ ...deleteRequest, step: 1 }),
            }, t('back')),
          h('button', {
            type: 'button',
            className: 'dshtb-modalSecondary',
            autoFocus: true,
            disabled: deleting,
            onClick: () => setDeleteRequest(null),
          }, t('cancel')),
          h('button', {
            type: 'button',
            className: firstStep ? 'dshtb-modalPrimary' : 'dshtb-modalDanger',
            disabled: deleting,
            onClick: confirmDelete,
          }, deleting
            ? t('deleting')
            : firstStep
              ? t('continue')
              : t('confirmDeleteForever')))))
      }

      if (!open) return null

      return h(React.Fragment, null,
        h('style', { key: 'css', dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { key: 'board', className: 'dshtb-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title') },
          h('div', { className: 'dshtb-top' },
            h('div', { className: 'dshtb-topTitle' },
              h('span', { className: 'dshtb-title' }, t('title')),
              h('span', { className: 'dshtb-sub' }, t('subtitle', { total: visible.length, running }))),
            h('div', { className: 'dshtb-topTools' },
              canCreateSession
                ? h('button', {
                  type: 'button',
                  className: 'dshtb-new',
                  title: t('newWindowHint'),
                  'aria-label': t('newWindow'),
                  disabled: creating,
                  'aria-busy': creating ? 'true' : undefined,
                  onClick: startNewSession,
                }, h(PlusIcon), h('span', { className: 'dshtb-newLabel' },
                  creating ? t('creatingWindow') : t('newWindow')))
                : null,
              subagents.length > 0
                ? h('button', {
                  type: 'button',
                  className: `dshtb-subagents${showSubagents ? ' on' : ''}`,
                  title: t('subagentsHint'),
                  'aria-label': t('subagentsHint'),
                  'aria-pressed': showSubagents,
                  onClick: toggleSubagents,
                }, t('subagents'), h('span', { className: 'dshtb-subagentsCount' }, String(subagents.length)))
                : null,
              h('input', {
                className: 'dshtb-search',
                value: query,
                placeholder: t('search'),
                onChange: (event) => setQuery(event.target.value),
              }),
              h('select', {
                className: 'dshtb-select',
                value: statusFilter,
                onChange: (event) => setStatusFilter(event.target.value),
                title: t('filterHint'),
              },
              h('option', { value: 'all' }, t('status.all')),
              STATUSES.map(key => h('option', { key, value: key }, t(`status.${key}`)))),
              h('button', {
                type: 'button',
                className: `dshtb-batchToggle${selecting ? ' on' : ''}`,
                onClick: () => {
                  if (selecting) {
                    setSelecting(false)
                    setSelected(new Set())
                  } else {
                    setSelected(new Set())
                    setSelecting(true)
                  }
                },
                title: t('batchMode'),
                'aria-pressed': selecting ? 'true' : 'false',
              }, selecting ? t('done') : t('batchMode')),
              h('button', {
                type: 'button',
                className: 'dshtb-reset',
                onClick: resetCardSizes,
                title: t('resetSizes'),
                'aria-label': t('resetSizes'),
              }, '↺'),
              h('button', {
                type: 'button',
                className: 'dshtb-close',
                onClick: () => setOpen(false),
                title: t('close'),
                'aria-label': t('close'),
              }, '✕'))),
          selecting
            ? h('div', { className: 'dshtb-batchBar' },
              h('span', { className: 'dshtb-batchCount' }, t('selectedCount', { n: selected.size })),
              h('button', {
                type: 'button',
                className: 'dshtb-batchAction',
                onClick: selectAllDisplayed,
                disabled: displayed.length === 0,
              }, t('selectAll')),
              h('button', {
                type: 'button',
                className: 'dshtb-batchAction',
                onClick: () => setSelected(new Set()),
                disabled: selected.size === 0,
              }, t('clearSelection')),
              h('span', { className: 'dshtb-batchSpacer' }),
              h('button', {
                type: 'button',
                className: 'dshtb-batchDelete',
                onClick: () => {
                  if (selected.size === 0) return
                  setDeleteRequest({ ids: [...selected], step: 1 })
                },
                disabled: selected.size === 0 || deleting,
              }, t('deleteWindows')))
            : null,
          notice !== null
            ? h('div', { className: 'dshtb-notice', role: 'status' },
              h('span', { className: 'dshtb-noticeText' }, notice),
              h('button', {
                type: 'button',
                className: 'dshtb-noticeClose',
                onClick: () => setNotice(null),
                title: t('close'),
                'aria-label': t('close'),
              }, '✕'))
            : null,
          h('div', { className: 'dshtb-grid', ref: gridRef },
          visible.length === 0
            ? h('div', { className: 'dshtb-empty dshtb-gridEmpty' },
              h('div', null, query.trim() !== '' || statusFilter !== 'all' ? t('noMatch') : t('noSessions')))
            : displayed.map(row => h(Card, {
              key: row.summary.id,
              sessionId: row.summary.id,
              summary: row.summary,
              status: row.status,
              workspace: workspaceOf.get(row.summary.id),
              size: resolveCardSize(cardSizes[row.summary.id]),
              selecting,
              selected: selected.has(row.summary.id),
              approval: approvalOf(row.summary.id),
              pinned: pinnedOrder.has(row.summary.id),
              sessions: props.sessions,
              now,
              t,
              onOpen: props.openSession,
              onToggleSelect: toggleSelected,
              onTogglePin: togglePin,
              onResize: setCardSize,
              onResetSize: resetCardSize,
            })),
          visible.length > limit
            ? h('div', { className: 'dshtb-moreRow' },
              h('button', {
                type: 'button',
                className: 'dshtb-more',
                onClick: () => setShown(limit + INITIAL_VISIBLE),
              }, t('more', { n: visible.length - limit })))
            : null),
          renderDeleteDialog()))
    }

    // ── sidebar launcher ──
    function GridIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('rect', { x: 1.5, y: 1.5, width: 5.5, height: 5.5, rx: 1.2, fill: 'currentColor', opacity: 0.95 }),
      h('rect', { x: 9, y: 1.5, width: 5.5, height: 5.5, rx: 1.2, fill: 'currentColor', opacity: 0.65 }),
      h('rect', { x: 1.5, y: 9, width: 5.5, height: 5.5, rx: 1.2, fill: 'currentColor', opacity: 0.65 }),
      h('rect', { x: 9, y: 9, width: 5.5, height: 5.5, rx: 1.2, fill: 'currentColor', opacity: 0.95 }))
    }

    function PinIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', {
        d: 'M3 2.5h10M8 13.5V5M11.5 8.5 8 5 4.5 8.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function SendIcon() {
      return h('svg', {
        className: 'dshtb-sendIcon',
        width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', {
        d: 'M14.5 1.5 1.5 7.1l5.1 1.8 1.8 5.1 6.1-12.5Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'm6.6 8.9 7.9-7.4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
      }))
    }

    function PlusIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', {
        d: 'M8 3.25v9.5M3.25 8h9.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      }))
    }

    function OpenIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', {
        d: 'M9.5 2H14v4.5M14 2 7.5 8.5M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function Launcher(props) {
      const running = props.useSessions(state => {
        let count = 0
        for (const id of state.ids) {
          const summary = state.byId[id]
          if (summary && summary.running) count += 1
        }
        return count
      })
      const label = props.t('open')
      return h(React.Fragment, null,
        h('style', { key: 'css', dangerouslySetInnerHTML: { __html: CSS } }),
        h('button', {
          key: 'launcher',
          type: 'button',
          className: 'dshtb-launch',
          title: label,
          'aria-label': label,
          onClick: () => setOpen(true),
        },
        h(GridIcon),
        props.wide ? h('span', { className: 'dshtb-launch-label' }, label) : null,
        running > 0 ? h('span', { className: 'dshtb-badge' }, String(running)) : null))
    }

    const CSS = `
.dshtb-launch{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;margin:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dshtb-launch:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-launch-label{white-space:nowrap}
.dshtb-badge{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-success-primary);color:#fff;font-size:10px;line-height:16px;text-align:center;flex:none}
.dshtb-layer{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,0px));right:0;bottom:0;left:0;z-index:60;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);pointer-events:auto;font-family:var(--dsw-font-family)}
.dshtb-top{display:flex;align-items:center;gap:16px;padding:0 20px;height:56px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}
.dshtb-topTitle{display:flex;align-items:baseline;gap:10px;min-width:0;flex:1 1 auto;overflow:hidden}
.dshtb-title{font-size:15px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dshtb-sub{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshtb-topTools{display:flex;align-items:center;gap:8px;margin-left:auto;flex:none}
.dshtb-new{height:28px;flex:none;display:inline-flex;align-items:center;gap:5px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.dshtb-new:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-interactive-bg-hover))}
.dshtb-new:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dshtb-new:disabled{opacity:.6;cursor:default}
.dshtb-newLabel{white-space:nowrap}
.dshtb-subagents{height:28px;flex:none;display:inline-flex;align-items:center;gap:4px;padding:0 9px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshtb-subagents:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-subagents.on{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.dshtb-subagentsCount{min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;text-align:center}
.dshtb-search{box-sizing:border-box;width:200px;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}
.dshtb-search::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshtb-search:focus{border-color:var(--dsw-alias-brand-primary)}
.dshtb-select{box-sizing:border-box;height:28px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;outline:none;cursor:pointer}
.dshtb-close{width:28px;height:28px;flex:none;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}
.dshtb-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-reset{width:28px;height:28px;flex:none;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer}
.dshtb-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-batchToggle{height:28px;flex:none;padding:0 9px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshtb-batchToggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-batchToggle.on{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.dshtb-batchBar{display:flex;align-items:center;gap:8px;height:40px;padding:0 20px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dshtb-batchCount{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshtb-batchAction{height:26px;padding:0 9px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dshtb-batchAction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-batchAction:disabled{opacity:.45;cursor:default}
.dshtb-batchSpacer{flex:1}
.dshtb-batchDelete{height:26px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-error-primary);color:#fff;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dshtb-batchDelete:disabled{opacity:.45;cursor:default}
.dshtb-notice{display:flex;align-items:center;gap:8px;min-height:32px;padding:0 16px 0 20px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.dshtb-noticeText{flex:1;min-width:0}
.dshtb-noticeClose{width:24px;height:24px;flex:none;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dshtb-noticeClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-grid{flex:1;min-height:0;overflow:auto;display:flex;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:12px;padding:16px 20px 24px}
.dshtb-cardWrap{position:relative;display:flex;flex:0 0 auto;max-width:100%;min-width:0}
.dshtb-card{position:relative;box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:120px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:0 2px 6px rgba(0,0,0,.10),0 1px 2px rgba(0,0,0,.06);overflow:hidden;transition:border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),box-shadow var(--ds-transition-duration-fast) var(--ds-ease-in-out);container-type:inline-size}
.dshtb-card:hover{border-color:var(--dsw-alias-border-l3)}
.dshtb-cardWrap[data-snap] .dshtb-card,.dshtb-card[data-selected=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary),0 2px 8px rgba(0,0,0,.14)}
.dshtb-cardHead{display:flex;align-items:center;gap:8px;padding:8px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshtb-check{width:14px;height:14px;margin:0;flex:none;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshtb-state{display:inline-flex;align-items:center;gap:4px;flex:none}
.dshtb-stateDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.dshtb-state[data-status=doing] .dshtb-stateDot{background:var(--dsw-alias-state-success-primary);animation:dshtb-pulse 1.6s ease-in-out infinite}
.dshtb-state[data-status=done] .dshtb-stateDot{background:var(--dsw-alias-brand-primary)}
.dshtb-stateLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;white-space:nowrap;max-width:64px;overflow:hidden;text-overflow:ellipsis}
.dshtb-cardTitle{flex:1;min-width:0;border:0;background:transparent;padding:0;text-align:left;font:inherit;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:text}
.dshtb-cardTitle:hover{color:var(--dsw-alias-brand-primary)}
.dshtb-cardTitleReadonly{cursor:default}
.dshtb-cardTitleReadonly:hover{color:var(--dsw-alias-label-primary)}
.dshtb-readonly{flex:none;padding:7px 28px 7px 10px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}
.dshtb-titleInput{flex:1;min-width:0;height:22px;padding:0 5px;border:1px solid var(--dsw-alias-brand-primary);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;outline:none}
.dshtb-titleInput[data-error=true]{border-color:var(--dsw-alias-state-error-primary)}
.dshtb-titleError{padding:0 10px 5px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}
.dshtb-filterBar{display:flex;align-items:center;gap:4px;padding:4px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshtb-filter{height:20px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:1;cursor:pointer}
.dshtb-filter:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-filter.on{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.dshtb-approval{display:flex;align-items:center;gap:8px;padding:6px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.dshtb-approvalDot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
.dshtb-approvalText{flex:1;min-width:0}
.dshtb-approvalTitle{font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshtb-approvalReason{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshtb-approvalError{font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary)}
.dshtb-approvalActions{display:flex;align-items:center;gap:6px;flex:none}
.dshtb-approvalReject,.dshtb-approvalAllow{height:22px;padding:0 8px;border-radius:var(--dsw-radius-sm);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dshtb-approvalReject{border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary)}
.dshtb-approvalReject:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-approvalAllow{border:0;background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-base)}
.dshtb-approvalAllow:hover:not(:disabled){filter:brightness(.94)}
.dshtb-approvalReject:disabled,.dshtb-approvalAllow:disabled{opacity:.55;cursor:default}
.dshtb-ws{flex:none;max-width:96px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshtb-time{flex:none;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshtb-running{color:var(--dsw-alias-state-success-primary)}
.dshtb-subagentTag{flex:none;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;white-space:nowrap}
.dshtb-pin{width:24px;height:24px;flex:none;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.dshtb-pin:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dshtb-pin.on{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-brand-primary)}
.dshtb-pin:disabled{opacity:.45;cursor:default}
.dshtb-open{width:24px;height:24px;flex:none;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.dshtb-open:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dshtb-body{flex:1;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;justify-content:flex-start;gap:6px;cursor:default}
.dshtb-bubble{max-width:86%;padding:6px 10px;border-radius:12px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.dshtb-bubbleUser{align-self:flex-end;border-radius:12px 12px 4px 12px;background:var(--dsw-alias-bg-module-platform)}
.dshtb-bubbleAssistant{align-self:flex-start;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px 12px 12px 4px;background:var(--dsw-alias-bg-layer-2);white-space:normal}
.dshtb-bubble.dshtb-bubbleDoing{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-base)}
.dshtb-md{min-width:0;overflow-wrap:anywhere}
.dshtb-md>:first-child{margin-top:0}
.dshtb-md>:last-child{margin-bottom:0}
.dshtb-mdP{margin:0 0 6px}
.dshtb-mdHeading{margin:0 0 5px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary)}
.dshtb-mdH1{font-size:14px}
.dshtb-mdH2{font-size:13px}
.dshtb-mdH3,.dshtb-mdH4,.dshtb-mdH5,.dshtb-mdH6{font-size:12px}
.dshtb-mdList{margin:0 0 6px;padding-left:18px}
.dshtb-mdList li{margin:1px 0}
.dshtb-md code{padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-base);font-family:var(--ds-font-family-code,monospace);font-size:11px}
.dshtb-mdPre{max-width:100%;margin:0 0 6px;padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);overflow:auto}
.dshtb-mdPre code{padding:0;background:transparent;white-space:pre}
.dshtb-mdQuote{margin:0 0 6px;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.dshtb-mdHr{margin:6px 0;border:0;border-top:1px solid var(--dsw-alias-border-l1)}
.dshtb-mdTableWrap{max-width:100%;margin:0 0 6px;overflow:auto}
.dshtb-mdTable{border-collapse:collapse;font-size:11px}
.dshtb-mdTable th,.dshtb-mdTable td{padding:3px 6px;border:0.5px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:top}
.dshtb-mdTable th{background:var(--dsw-alias-bg-base);font-weight:600}
.dshtb-md a{color:var(--dsw-alias-brand-primary);text-decoration:underline}
.dshtb-history{flex:none;align-self:center;height:24px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dshtb-history:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-history:disabled{opacity:.55;cursor:default}
.dshtb-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:2px 0}
.dshtb-body>.dshtb-empty{align-self:center;margin:auto 0}
.dshtb-gridEmpty{flex:1 0 100%;min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.dshtb-send{display:flex;align-items:flex-end;gap:6px;padding:6px 28px 6px 8px;flex:none;border-top:1px solid var(--dsw-alias-border-l1)}
.dshtb-input{box-sizing:border-box;flex:1;min-width:0;min-height:24px;max-height:96px;padding:4px 8px;border:0.5px solid transparent;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:16px;resize:none;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;white-space:pre-wrap;overflow-wrap:anywhere;outline:none}
.dshtb-input::-webkit-scrollbar{width:0;height:0;display:none}
.dshtb-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshtb-input:focus{border-color:var(--dsw-alias-brand-primary);background:transparent}
.dshtb-sendBtn{width:24px;height:24px;flex:none;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-brand-primary);color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.dshtb-sendBtn:hover:not(:disabled){background:var(--dsw-alias-brand-primary);color:#fff;filter:brightness(.94)}
.dshtb-sendBtn:disabled{opacity:.35;cursor:default}
.dshtb-sendIcon{display:block;pointer-events:none}
.dshtb-resize{position:absolute;right:3px;bottom:3px;z-index:3;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);opacity:.55;cursor:nwse-resize;touch-action:none;display:flex;align-items:flex-end;justify-content:flex-end}
.dshtb-resize::before{content:"";width:8px;height:8px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;border-radius:0 0 2px 0;margin:0 1px 1px 0}
.dshtb-resize:hover,.dshtb-resize:focus-visible{opacity:1;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);outline:none}
.dshtb-moreRow{flex:0 0 100%;display:flex;justify-content:center;padding-top:2px}
.dshtb-more{height:28px;padding:0 14px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dshtb-more:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-modalLayer{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,0px));right:0;bottom:0;left:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32))}
.dshtb-modal{box-sizing:border-box;width:min(440px,100%);max-height:100%;overflow:auto;padding:20px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.dshtb-modalTitle{font-size:15px;font-weight:600;line-height:24px;margin-bottom:10px}
.dshtb-modalBody{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dshtb-modalText{margin:0 0 10px}
.dshtb-modalWarning{margin:10px 0 0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.55}
.dshtb-modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.dshtb-modalSecondary,.dshtb-modalPrimary,.dshtb-modalDanger{height:30px;padding:0 12px;border-radius:var(--dsw-radius-sm);font:inherit;font-size:12px;cursor:pointer}
.dshtb-modalSecondary{border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary)}
.dshtb-modalSecondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshtb-modalPrimary{border:0;background:var(--dsw-alias-brand-primary);color:#fff}
.dshtb-modalDanger{border:0;background:var(--dsw-alias-state-error-primary);color:#fff}
.dshtb-modalPrimary:disabled,.dshtb-modalDanger:disabled,.dshtb-modalSecondary:disabled{opacity:.5;cursor:default}
@media (max-width:900px){.dshtb-sub{display:none}.dshtb-search{width:160px}}
@media (max-width:760px){.dshtb-top{gap:8px;padding:0 12px}.dshtb-search{width:120px}.dshtb-newLabel{display:none}.dshtb-new{padding:0 8px}}
@container (max-width:460px){.dshtb-time{display:none}}
@container (max-width:360px){.dshtb-ws{display:none}}
@keyframes dshtb-pulse{0%,100%{opacity:1}50%{opacity:.35}}
`

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: {
            open: '任务大屏',
            title: '任务大屏',
            subtitle: '共 {total} 个任务 · {running} 个进行中',
            close: '关闭',
            search: '搜索任务或工作区',
            filterHint: '按状态筛选',
            batchMode: '批量管理',
            done: '完成',
            selectedCount: '已选 {n} 个',
            selectAll: '全选当前',
            clearSelection: '取消选择',
            subagents: '子智能体',
            subagentsHint: '显示/隐藏子智能体窗口',
            subagentTag: '子',
            subagentReadOnly: '子智能体窗口只读',
            pin: '置顶',
            unpin: '取消置顶',
            pinFailed: '置顶操作失败',
            deleteWindows: '删除窗口',
            deleteWindowsTitle: '永久删除 {n} 个窗口？',
            deleteWindowsDesc: '窗口和对应会话会被一起永久删除，保存的对话记录也会删除；删除后无法恢复。',
            continue: '继续',
            cancel: '取消',
            back: '返回',
            deleteSessionsTitle: '确认永久删除 {n} 个会话？',
            deleteSessionsDesc: '这是第二次确认。删除后窗口和会话都会消失，无法恢复。',
            deleteSessionsWarning: '正在运行的回合、子智能体或后台任务会先被停止；会话记录会被永久删除，不能从“已归档”恢复。',
            confirmDeleteForever: '确认永久删除',
            deleting: '正在删除…',
            deletedWindows: '已永久删除 {n} 个会话及其窗口。',
            deleteFailed: '有 {n} 个会话删除失败，相关窗口已保留。',
            newWindow: '新建窗口',
            newWindowHint: '新建一个会话窗口，不离开任务大屏',
            creatingWindow: '正在新建…',
            newWindowNoWorkspace: '没有可用的工作区，无法新建窗口',
            newWindowFailed: '新建窗口失败：{message}',
            openSession: '打开会话',
            editTitle: '修改标题',
            renameFailed: '标题修改失败，请重试',
            selectWindow: '选择此窗口',
            messageFilter: '消息显示范围',
            allMessages: '全部',
            userOnly: '仅用户',
            tool: '工具',
            approvalWaiting: '等待权限审批：{tool}',
            allowOnce: '允许一次',
            reject: '拒绝',
            approvalFailed: '审批操作失败，请重试',
            more: '再看 {n} 个',
            resetSizes: '重置所有卡片大小',
            resizeHint: '拖动右下角调整卡片大小，自动吸附其它窗口；双击恢复默认',
            loadOlder: '加载更早消息',
            loadingOlder: '正在加载…',
            noSessions: '还没有任务',
            noMatch: '没有匹配的任务',
            loading: '正在读取会话列表…',
            loadingCard: '读取中…',
            loadFailed: '读取会话失败',
            noMessages: '还没有消息',
            noUserMessages: '还没有用户消息',
            reply: '在这里继续对话…',
            send: '发送',
            statusHint: '会话状态（自动）',
            'status.all': '全部状态',
            'status.todo': '待确定',
            'status.doing': '进行中',
            'status.done': '已完成',
            justNow: '刚刚',
            minutesAgo: '{n} 分钟前',
            hoursAgo: '{n} 小时前',
            daysAgo: '{n} 天前',
          },
          en: {
            open: 'Task board',
            title: 'Task board',
            subtitle: '{total} tasks · {running} in progress',
            close: 'Close',
            search: 'Search tasks or workspaces',
            filterHint: 'Filter by status',
            batchMode: 'Batch',
            done: 'Done',
            selectedCount: '{n} selected',
            selectAll: 'Select shown',
            clearSelection: 'Clear',
            subagents: 'Subagents',
            subagentsHint: 'Show or hide subagent windows',
            subagentTag: 'Sub',
            subagentReadOnly: 'Subagent window is read-only',
            pin: 'Pin',
            unpin: 'Unpin',
            pinFailed: 'Could not update the pin',
            deleteWindows: 'Delete windows',
            deleteWindowsTitle: 'Permanently delete {n} windows?',
            deleteWindowsDesc: 'Each window and its Session are permanently deleted, including the saved conversation history. This cannot be undone.',
            continue: 'Continue',
            cancel: 'Cancel',
            back: 'Back',
            deleteSessionsTitle: 'Permanently delete {n} sessions?',
            deleteSessionsDesc: 'This is the second confirmation. The windows and their sessions will be gone for good.',
            deleteSessionsWarning: 'Running turns, subagents, and background jobs are stopped first; the saved history is permanently deleted and cannot be restored from the archive.',
            confirmDeleteForever: 'Delete permanently',
            deleting: 'Deleting…',
            deletedWindows: 'Permanently deleted {n} sessions and their windows.',
            deleteFailed: '{n} sessions could not be deleted; their windows were kept.',
            newWindow: 'New window',
            newWindowHint: 'Create a session window without leaving the task board',
            creatingWindow: 'Creating…',
            newWindowNoWorkspace: 'No workspace is available for a new window',
            newWindowFailed: 'Could not create the window: {message}',
            openSession: 'Open session',
            editTitle: 'Edit title',
            renameFailed: 'Could not rename the title. Try again.',
            selectWindow: 'Select this window',
            messageFilter: 'Message display',
            allMessages: 'All',
            userOnly: 'User only',
            tool: 'tool',
            approvalWaiting: 'Waiting for permission: {tool}',
            allowOnce: 'Allow once',
            reject: 'Reject',
            approvalFailed: 'Could not answer the request. Try again.',
            more: 'Show {n} more',
            resetSizes: 'Reset all card sizes',
            resizeHint: 'Drag the bottom-right corner to resize; snaps to other cards; double-click to reset',
            loadOlder: 'Load earlier messages',
            loadingOlder: 'Loading…',
            noSessions: 'No tasks yet',
            noMatch: 'No matching tasks',
            loading: 'Loading sessions…',
            loadingCard: 'Loading…',
            loadFailed: 'Could not load this session',
            noMessages: 'No messages yet',
            noUserMessages: 'No user messages yet',
            reply: 'Reply here…',
            send: 'Send',
            statusHint: 'Session status (automatic)',
            'status.all': 'All statuses',
            'status.todo': 'To decide',
            'status.doing': 'In progress',
            'status.done': 'Done',
            justNow: 'just now',
            minutesAgo: '{n}m ago',
            hoursAgo: '{n}h ago',
            daysAgo: '{n}d ago',
          },
        }), 'task-board.locale')

        const business = () => ({
          t: ctx.locale.bind(NS),
          sessions: ctx.sessions,
          createSession: (workspaceId) => ctx.sessions.create({ workspaceId }),
          togglePin: (sessionId, nextPinned) => (
            nextPinned ? ctx.uiWorkspace.pinSession(sessionId) : ctx.uiWorkspace.unpinSession(sessionId)
          ),
          deleteSession: async (sessionId) => {
            const result = await ctx.remote.commands.execute(
              sessionId,
              `/delete-session ${sessionId}`,
              [],
            )
            if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
            const outcome = result.value?.result
            if (outcome === undefined) throw new Error('delete-session returned no result')
            if (outcome.kind === 'error') throw new Error(outcome.text)
          },
          openSession: (sessionId) => {
            setOpen(false)
            ctx.uiWorkspace.openSession(sessionId)
          },
        })

        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'task-board',
          order: 6,
          label: () => ctx.locale.bind(NS)('open'),
          locale: NS,
          inject: business,
        }, Launcher)), 'task-board.launcher')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'task-board',
          order: 6,
          locale: NS,
          inject: business,
        }, Board)), 'task-board.overlay')
      },
    }
  },
})
