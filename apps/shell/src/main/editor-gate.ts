import { basename } from 'node:path'
import type { Lang } from '@genoffice/i18n'
import type { AppChoice, AppChoicePatch, EditorItemId } from '../shared/editor-choice'
import {
  editorPromptText,
  type EditorPromptStringKey,
} from '../renderer/src/i18n/strings-editor-prompt'

/**
 * The gate in front of every way a file opens while editors can be turned off
 * (Settings → Editors and AI): whether a file opens, asks first or is
 * refused, the native questions ("<editor> is turned off. Turn it on and
 * open?", also with "Create the file only"), one question per turned-off
 * editor when several files open at once, and "turn on" through the shell's
 * one choice service, so every window hears it. Electron-free: index.ts
 * hands in the message box, the choice and the router.
 */

/**
 * Who asked for the file:
 * - `user`: a person (Explorer / Finder, a drop, File → Open, Home's lists,
 *   a document link, a Drive pick, Quick Look, reopening a closed tab). An
 *   open with no origin counts as this.
 * - `automation`: the terminal command through the control server, the
 *   in-app MCP server, a crashed tab reloading. Never asks.
 * - `ai`: the AI opening a document it made. Refused for a turned-off editor.
 * - `restore`: tabs coming back at launch. Asks, like a person's open.
 */
export type OpenOrigin = 'user' | 'automation' | 'ai' | 'restore'

/**
 * - `open`: the file's editor is on (or no editor owns the file: the router
 *   says why it does not open)
 * - `open-without-asking`: the editor is off, but the file is already open
 *   (it is brought forward) or the terminal / MCP asked
 * - `ask`: the editor is off: ask before anything opens
 * - `refuse`: the editor is off and the AI asked
 */
export type OpenDecision = 'open' | 'open-without-asking' | 'ask' | 'refuse'

export interface OpenDecisionInput {
  origin: OpenOrigin
  /** the item whose editor opens the file; null = none */
  item: EditorItemId | null
  /** the items turned off now */
  off: readonly EditorItemId[]
  /** the file is already in a tab or a detached window */
  alreadyOpen: boolean
}

export function decideOpen(input: OpenDecisionInput): OpenDecision {
  if (!input.item || !input.off.includes(input.item)) return 'open'
  if (input.alreadyOpen || input.origin === 'automation') return 'open-without-asking'
  if (input.origin === 'ai') return 'refuse'
  return 'ask'
}

/** whether a decision lets the file go on to the router now */
export function opensNow(decision: OpenDecision): boolean {
  return decision === 'open' || decision === 'open-without-asking'
}

/** something to restore at launch: a planned tab, a remembered split pane */
export interface RestoreEntry {
  key: string
  item: EditorItemId | null
}

/**
 * The questions a launch asks before it places restored tabs: one per
 * turned-off item, with the keys it covers, in the entries' order.
 */
export function restoreQuestions(
  entries: readonly RestoreEntry[],
  off: readonly EditorItemId[],
): Map<EditorItemId, string[]> {
  const questions = new Map<EditorItemId, string[]>()
  for (const entry of entries) {
    if (!entry.item || !off.includes(entry.item)) continue
    const keys = questions.get(entry.item) ?? []
    keys.push(entry.key)
    questions.set(entry.item, keys)
  }
  return questions
}

/** a native message box: the index of the button pressed */
export interface GateMessageBox {
  message: string
  detail?: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

export interface EditorGateDeps {
  /** the choice that applies now */
  choice(): AppChoice
  /** change it through the shell's choice service (stored, told to every window) */
  setChoice(patch: AppChoicePatch): AppChoice
  /** the item whose editor opens this file (the router's own answer); null = none */
  itemOfPath(path: string): EditorItemId | null
  /** the file is in a tab or a detached window now */
  isOpen(path: string): boolean
  showMessageBox(box: GateMessageBox): Promise<number>
  lang(): Lang
}

/** what opens a file once the gate lets it through; false = nothing opened */
export type OpenNow = (path: string) => boolean

export type TurnOnAnswer = 'turn-on' | 'cancel'
export type TurnOnOrFileAnswer = 'turn-on' | 'file-only' | 'cancel'

export interface AskOptions {
  /** the file the answer is about; its name is shown */
  fileName?: string
  /** how many files the answer is about (more than one: the count is shown) */
  fileCount?: number
  /** a line under the question instead of the file name or count */
  detail?: string
}

export interface EditorGate {
  /** the decision for one file now */
  decide(path: string, origin: OpenOrigin): OpenDecision
  /**
   * A synchronous router's first step. Null = go on and open; true = the
   * question is up (the open is handled: no fallback), and its "Turn on and
   * open" opens the file through `open`; false = refused (AI).
   */
  check(path: string, origin: OpenOrigin, open: OpenNow): boolean | null
  /** one file, waiting for the answer when there is a question; true = it opened */
  openOne(path: string, origin: OpenOrigin, open: OpenNow): Promise<boolean>
  /**
   * Several files a person opened at once (a launch, a drop, File → Open):
   * files of editors that are on open at once, in order; then one question
   * per turned-off editor, with the file count. True = anything opened.
   */
  openMany(paths: readonly string[], origin: OpenOrigin, open: OpenNow): Promise<boolean>
  /**
   * [Turn on and open] [Cancel]. "Turn on" turns the item on before it
   * answers; an item that is on by the time the question would show answers
   * "turn-on" without asking. Questions show one at a time.
   */
  askTurnOn(item: EditorItemId, options?: AskOptions): Promise<TurnOnAnswer>
  /** [Turn on and open] [Create the file only] [Cancel], otherwise as askTurnOn */
  askTurnOnOrFileOnly(item: EditorItemId, options?: AskOptions): Promise<TurnOnOrFileAnswer>
  /** turn one item on (stored, every window told) */
  turnOn(item: EditorItemId): void
  /**
   * Before a launch places restored things: one question per turned-off item.
   * Answers the refused keys; synchronously (an empty set) when nothing is
   * off, so a launch with nothing to ask keeps its order. An item refused
   * once is refused again without a question for the rest of the run, unless
   * `askAgain` (the person chose the copy in the launch list: an open).
   */
  askRestore(
    entries: readonly RestoreEntry[],
    options?: { askAgain?: boolean },
  ): ReadonlySet<string> | Promise<ReadonlySet<string>>
  /**
   * A skill file dropped while AI is off: [Turn on AI and import] [Cancel].
   * True = AI is on now (turned on, or already on).
   */
  askAiOnForSkills(): Promise<boolean>
}

interface WaitingOpen {
  path: string
  open: OpenNow
  resolve: (opened: boolean) => void
}

export function createEditorGate(deps: EditorGateDeps): EditorGate {
  let queue: Promise<unknown> = Promise.resolve()
  /** the files waiting on the question about their item (later opens join it) */
  const waiting = new Map<EditorItemId, WaitingOpen[]>()
  const refusedRestore = new Set<EditorItemId>()

  const text = (key: EditorPromptStringKey, params?: Record<string, string | number>): string =>
    editorPromptText(deps.lang(), key, params)
  const isOff = (item: EditorItemId): boolean => deps.choice().off.includes(item)

  /** questions never overlap: each waits for the one before */
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  const turnOn = (item: EditorItemId): void => {
    const choice = deps.choice()
    if (!choice.off.includes(item)) return
    deps.setChoice({ off: choice.off.filter((id) => id !== item) })
  }

  const detailOf = (options: AskOptions | undefined): string | undefined => {
    if (options?.detail) return options.detail
    if (options?.fileCount !== undefined && options.fileCount > 1)
      return text('offDetailFiles', { count: options.fileCount })
    return options?.fileName ? basename(options.fileName) : undefined
  }

  const ask = (
    item: EditorItemId,
    withFileOnly: boolean,
    options: () => AskOptions | undefined,
  ): Promise<TurnOnOrFileAnswer> =>
    inTurn(async () => {
      if (!isOff(item)) return 'turn-on'
      const buttons = withFileOnly
        ? [text('turnOnAndOpen'), text('fileOnly'), text('cancel')]
        : [text('turnOnAndOpen'), text('cancel')]
      const detail = detailOf(options())
      const pressed = await deps.showMessageBox({
        message: text('offMessage', { item: text(`item_${item}`) }),
        ...(detail ? { detail } : {}),
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
      })
      if (pressed === 0) {
        turnOn(item)
        return 'turn-on'
      }
      return withFileOnly && pressed === 1 ? 'file-only' : 'cancel'
    })

  const askTurnOn = async (item: EditorItemId, options?: AskOptions): Promise<TurnOnAnswer> =>
    (await ask(item, false, () => options)) === 'turn-on' ? 'turn-on' : 'cancel'

  /** ask about `item` once for every file waiting on it, then open them or not */
  const askThenOpen = (item: EditorItemId, paths: readonly string[], open: OpenNow) => {
    if (paths.length === 0) return Promise.resolve(false)
    // a question about this item is already waiting: these files join it
    const joining = waiting.has(item)
    const list = waiting.get(item) ?? []
    waiting.set(item, list)
    const results = paths.map(
      (path) => new Promise<boolean>((resolve) => list.push({ path, open, resolve })),
    )
    if (!joining) {
      void ask(item, false, () => {
        const files = waiting.get(item) ?? []
        return files.length === 1 ? { fileName: files[0].path } : { fileCount: files.length }
      }).then(
        (answer) => settle(item, answer === 'turn-on'),
        () => settle(item, false),
      )
    }
    return Promise.all(results).then((opened) => opened.some(Boolean))
  }

  const settle = (item: EditorItemId, openThem: boolean): void => {
    const files = waiting.get(item) ?? []
    waiting.delete(item)
    for (const file of files) {
      let opened = false
      if (openThem) {
        try {
          opened = file.open(file.path)
        } catch (error) {
          console.warn('[editor-gate] the file could not be opened:', error)
        }
      }
      file.resolve(opened)
    }
  }

  const decide = (path: string, origin: OpenOrigin): OpenDecision =>
    decideOpen({
      origin,
      item: deps.itemOfPath(path),
      off: deps.choice().off,
      alreadyOpen: deps.isOpen(path),
    })

  return {
    decide,

    check(path, origin, open) {
      const decision = decide(path, origin)
      if (opensNow(decision)) return null
      if (decision === 'refuse') return false
      const item = deps.itemOfPath(path)
      if (!item) return null
      void askThenOpen(item, [path], open)
      return true
    },

    async openOne(path, origin, open) {
      const decision = decide(path, origin)
      if (opensNow(decision)) return open(path)
      const item = deps.itemOfPath(path)
      if (decision === 'refuse' || !item) return false
      return askThenOpen(item, [path], open)
    },

    async openMany(paths, origin, open) {
      let opened = false
      const asking = new Map<EditorItemId, string[]>()
      for (const path of paths) {
        const decision = decide(path, origin)
        if (opensNow(decision)) {
          opened = open(path) || opened
          continue
        }
        const item = deps.itemOfPath(path)
        if (decision === 'refuse' || !item) continue
        asking.set(item, [...(asking.get(item) ?? []), path])
      }
      const answers = await Promise.all(
        [...asking].map(([item, files]) => askThenOpen(item, files, open)),
      )
      return answers.some(Boolean) || opened
    },

    askTurnOn,

    askTurnOnOrFileOnly: (item, options) => ask(item, true, () => options),

    turnOn,

    askRestore(entries, options) {
      const questions = restoreQuestions(entries, deps.choice().off)
      if (questions.size === 0) return new Set<string>()
      return (async () => {
        const refused = new Set<string>()
        for (const [item, keys] of questions) {
          const answer =
            refusedRestore.has(item) && !options?.askAgain
              ? 'cancel'
              : await askTurnOn(item, { fileCount: keys.length })
          if (answer === 'turn-on') continue
          refusedRestore.add(item)
          for (const key of keys) refused.add(key)
        }
        return refused
      })()
    },

    askAiOnForSkills() {
      return inTurn(async () => {
        if (deps.choice().aiFeatures) return true
        const pressed = await deps.showMessageBox({
          message: text('aiOffSkillMessage'),
          buttons: [text('aiOnAndImport'), text('cancel')],
          defaultId: 0,
          cancelId: 1,
        })
        if (pressed !== 0) return false
        return deps.setChoice({ aiFeatures: true }).aiFeatures
      })
    },
  }
}

let installed: EditorGate | null = null

/** index.ts installs the shell's gate once, before anything opens */
export function installEditorGate(gate: EditorGate | null): void {
  installed = gate
}

/** the shell's gate, for the main modules that ask before they open (PDF tools, generate) */
export function editorGate(): EditorGate {
  if (!installed) throw new Error('the editor gate is not installed')
  return installed
}

/**
 * A value that may come at once or later (askRestore): run `next` with it,
 * synchronously when it is already there.
 */
export function whenReady<T>(value: T | Promise<T>, next: (value: T) => void): void {
  if (value instanceof Promise) void value.then(next)
  else next(value)
}
