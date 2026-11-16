import { basename, dirname, extname, join } from 'node:path'
import {
  countPreservedWithTopics,
  createXmindDocumentFromOutline,
  isShownLink,
  isWritableBranchLine,
  newXmindId,
  openXmind,
  reconcileSheet,
  sheetToView,
  sheetsToOutline,
  type BranchLineKey,
  type ViewBranchLine,
  type ViewSheet,
  type ViewSummary,
  type ViewTopic,
  type XmindDocument,
} from '@genoffice/xmind-engine'
import { flagString, type ParsedArgs } from '../args'
import { batchCounts, batchMode, batchResult } from '../batch'
import { readInput, readTextFile, resolveInput, stripBom, type PathContext } from '../fs'
import type { OpFailure } from '../op-errors'
import { readOpsInput, readOpsStream } from '../ops-input'
import {
  renderGroups,
  signatureFromSchema,
  withFingerprint,
  type JsonSchema,
  type OpCatalog,
  type OpEntry,
} from '../op-catalog'
import { CliError, EXIT, type CommandResult, type ErrorReason } from '../result'

/** Mind map files, by their file-name ending. */
export const MAP_EXTENSION = '.xmind'

const GUIDE_HINT =
  'run `ieumoffice map read <file> --json` for the topic ids, and `ieumoffice guide map` for the ops'

export interface OpenedMap {
  path: string
  document: XmindDocument
}

/**
 * Resolves, policy-checks and opens a mind map with the engine (no app).
 * The engine's open is the front door: the zip gate, the structure check and
 * the byte-preservation rules all apply as in the app.
 */
export async function openMapInput(file: string | undefined, ctx: PathContext): Promise<OpenedMap> {
  const path = resolveInput(file, ctx)
  if (extname(path).toLowerCase() !== MAP_EXTENSION) {
    throw new CliError(EXIT.usage, `not a mind map (${MAP_EXTENSION}): ${path}`, undefined, {
      reason: 'unsupported',
      suggestion: 'name a .xmind file',
    })
  }
  const opened = await openXmind(readInput(path))
  if (opened.status !== 'ok') {
    throw new CliError(
      EXIT.file,
      `${basename(path)} does not open as a mind map: ${opened.detail}`,
      { status: opened.status },
      {
        reason: 'unsupported',
        suggestion:
          opened.status === 'encrypted'
            ? 'decrypt the map in XMind first, then use the saved file'
            : 'open the file in the app to see what is wrong with it',
      },
    )
  }
  return { path, document: opened.document }
}

// ---- read ----

/** Every topic of a sheet's shown tree, in walk order (the central topic first). */
function topicJson(view: ViewSheet): Record<string, unknown>[] {
  const topics: Record<string, unknown>[] = []
  const walk = (topic: ViewTopic): void => {
    topics.push({
      id: topic.id,
      title: topic.title,
      note: topic.note,
      link: topic.link,
      children: topic.children.map((child) => child.id),
      ...(topic.summaries.length > 0
        ? {
            summaries: topic.summaries.map((summary) => ({
              id: summary.id,
              topicId: summary.topicId,
              title: summary.title,
              start: summary.start,
              end: summary.end,
            })),
          }
        : {}),
    })
    for (const child of topic.children) walk(child)
  }
  walk(view.root)
  return topics
}

function countTopics(view: ViewSheet): number {
  let count = 0
  const pending: ViewTopic[] = [view.root]
  for (let topic = pending.pop(); topic; topic = pending.pop()) {
    count++
    pending.push(...topic.children)
  }
  return count
}

/** `map read`: every sheet's outline (`# ` heading per sheet), or the structure with ids. */
export function readMap(opened: OpenedMap, json: boolean): CommandResult {
  const views = opened.document.viewSheets()
  const topics = views.reduce((sum, view) => sum + countTopics(view), 0)
  const counted = `${basename(opened.path)}: ${views.length} sheet(s), ${topics} topic(s)`
  if (json) {
    return {
      summary: counted,
      detail: {
        sheets: views.map((view) => ({
          index: view.index,
          id: view.id,
          title: view.title,
          root: view.root.id,
          topics: topicJson(view),
        })),
      },
    }
  }
  return { summary: [counted, '', sheetsToOutline(opened.document.sheets)].join('\n') }
}

// ---- ops ----

/**
 * `--ops`: inline JSON (`[...]` or `{"ops": [...]}`), `@<file>`, a file path, or `-` for stdin.
 * An empty array is a no-op batch (nothing changed, nothing written in place;
 * `guide map` has the batch rules); a malformed list is refused.
 */
export function mapOpsOf(args: ParsedArgs, ctx: PathContext): unknown[] {
  const spec = flagString(args, 'ops')
  if (spec === undefined || spec === '') {
    throw new CliError(EXIT.usage, 'missing --ops <JSON|@file|->', undefined, {
      reason: 'missing_argument',
      suggestion: 'run `ieumoffice guide map` for the ops',
    })
  }
  let text: string
  let source: string
  const trimmed = spec.trimStart()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    text = spec
    source = '--ops'
  } else if (spec.startsWith('@')) {
    ;({ text, source } = readOpsInput(
      { ...args, flags: { ...args.flags, ops: spec.slice(1) } },
      ctx,
    ))
  } else {
    ;({ text, source } = readOpsInput(args, ctx))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new CliError(
      EXIT.usage,
      `${source}: not valid JSON (${(err as Error).message})`,
      undefined,
      { reason: 'invalid_json' },
    )
  }
  const ops = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { ops?: unknown }).ops)
      ? (parsed as { ops: unknown[] }).ops
      : null
  if (!ops) {
    throw new CliError(EXIT.usage, `${source}: expected an array of ops`, undefined, {
      reason: 'invalid_argument',
      suggestion: 'run `ieumoffice guide map` for the ops',
    })
  }
  return ops
}

/** `--outline <file|->`: the outline text to build a map from, and the file it came from (null for stdin). */
export function outlineTextOf(
  args: ParsedArgs,
  ctx: PathContext,
): { text: string; path: string | null } {
  const spec = flagString(args, 'outline')
  if (spec === undefined || spec === '') {
    throw new CliError(EXIT.usage, 'missing --outline <file|->', undefined, {
      reason: 'missing_argument',
      suggestion: 'pass a markdown outline: `# ` heading per sheet, `- ` item per topic',
    })
  }
  const from = spec === '-' ? null : resolveInput(spec, ctx)
  const text = from === null ? stripBom(readOpsStream(0, 'stdin')) : stripBom(readTextFile(from))
  if (text.trim() === '') {
    throw new CliError(EXIT.usage, `--outline ${spec}: the outline is empty`, undefined, {
      reason: 'invalid_argument',
    })
  }
  return { text, path: from }
}

/** The `.xmind` name an outline file gets when `--out` is absent. */
export function outlineOutputPath(outlinePath: string): string {
  const ext = extname(outlinePath)
  return join(dirname(outlinePath), `${basename(outlinePath, ext)}.xmind`)
}

// ---- the six ops ----

/** The fields every op takes; anything else is refused. */
const MAP_OP_FIELDS: Readonly<
  Record<string, { required: readonly string[]; optional: readonly string[] }>
> = {
  add_topic: { required: ['parent', 'title'], optional: ['after', 'note', 'link'] },
  rename_topic: { required: ['id', 'title'], optional: [] },
  move_topic: { required: ['id', 'parent'], optional: ['after'] },
  delete_topic: { required: ['id'], optional: [] },
  set_note: { required: ['id', 'note'], optional: [] },
  set_link: { required: ['id', 'url'], optional: [] },
}

/** One op as the executor applies it: a name and string fields. */
export interface MapOp {
  op: string
  fields: Record<string, string>
}

function opFailure(index: number, op: string, error: string, reason: ErrorReason): CliError {
  return new CliError(EXIT.usage, error, { index, op }, { reason, suggestion: GUIDE_HINT })
}

/** Checks one raw op against `MAP_OP_FIELDS`; refuses unknown ops, unknown keys and non-text values. */
export function readMapOp(raw: unknown, index: number): MapOp {
  const name = raw !== null && typeof raw === 'object' ? (raw as { op?: unknown }).op : undefined
  const label = typeof name === 'string' ? name : '(no op)'
  if (typeof name !== 'string' || !Object.hasOwn(MAP_OP_FIELDS, name)) {
    throw opFailure(
      index,
      label,
      `unknown op: ${label} (the ops are ${Object.keys(MAP_OP_FIELDS).join(', ')})`,
      'unknown_op',
    )
  }
  const spec = MAP_OP_FIELDS[name]!
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'op') continue
    if (!spec.required.includes(key) && !spec.optional.includes(key)) {
      throw opFailure(
        index,
        name,
        `${name}: unknown field ${key} (it takes ${[...spec.required, ...spec.optional].join(', ')})`,
        'invalid_argument',
      )
    }
    if (typeof value !== 'string') {
      throw opFailure(index, name, `${name}: ${key} is not text`, 'invalid_argument')
    }
    fields[key] = value
  }
  for (const key of spec.required) {
    if (fields[key] === undefined) {
      throw opFailure(index, name, `${name}: missing ${key}`, 'invalid_argument')
    }
  }
  return { op: name, fields }
}

/** Where an id sits in one sheet's shown tree. */
type Spot =
  | { kind: 'topic'; topic: ViewTopic; parent: ViewTopic | null }
  | { kind: 'summary'; carrier: ViewTopic; summary: ViewSummary }

function findSpot(state: ViewSheet, id: string): Spot | null {
  const walk = (topic: ViewTopic, parent: ViewTopic | null): Spot | null => {
    if (topic.id === id) return { kind: 'topic', topic, parent }
    for (const summary of topic.summaries) {
      if (summary.topicId === id) return { kind: 'summary', carrier: topic, summary }
    }
    for (const child of topic.children) {
      const found = walk(child, topic)
      if (found) return found
    }
    return null
  }
  return walk(state.root, null)
}

/** The one sheet an id lives on; the same id on two sheets is refused as ambiguous. */
function sheetOf(document: XmindDocument, id: string, op: string): number {
  const hits: number[] = []
  document.sheets.forEach((sheet, index) => {
    if (findSpot(sheetToView(sheet, index), id)) hits.push(index)
  })
  if (hits.length === 0) {
    throw new CliError(
      EXIT.usage,
      `${op}: no topic ${id} in the map`,
      { topic: id },
      {
        reason: 'target_not_found',
        suggestion: 'run `ieumoffice map read <file> --json` for the ids',
      },
    )
  }
  if (hits.length > 1) {
    throw new CliError(
      EXIT.usage,
      `${op}: topic ${id} is on more than one sheet (${hits.join(', ')}), so it cannot be targeted at all; only a future sheet selector would fix that`,
      { topic: id, sheets: hits },
      {
        reason: 'invalid_argument',
        suggestion:
          'an id on more than one sheet cannot be targeted at all yet; only a future sheet selector would fix that',
      },
    )
  }
  return hits[0]!
}

function inSheet(state: ViewSheet, id: string, op: string): Spot {
  const spot = findSpot(state, id)
  if (!spot) {
    throw new CliError(
      EXIT.usage,
      `${op}: no topic ${id} in the map`,
      { topic: id },
      {
        reason: 'target_not_found',
        suggestion: 'run `ieumoffice map read <file> --json` for the ids',
      },
    )
  }
  return spot
}

function aBranch(
  spot: Spot,
  op: string,
  id: string,
): { kind: 'topic'; topic: ViewTopic; parent: ViewTopic | null } {
  if (spot.kind !== 'topic') {
    throw new CliError(
      EXIT.usage,
      `${op}: ${id} is a summary topic, and ${op} works on branch topics`,
      { topic: id },
      {
        reason: 'invalid_argument',
        suggestion: 'delete_topic and rename_topic accept a summary topic',
      },
    )
  }
  return spot
}

function isBelow(ancestor: ViewTopic, topic: ViewTopic): boolean {
  const pending: ViewTopic[] = [...topic.children]
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (next.id === ancestor.id) return true
    pending.push(...next.children)
  }
  return false
}

/** Inserts `made` in `parent`'s branches: after the branch `after` names, else at the end. */
function insertBranch(
  parent: ViewTopic,
  made: ViewTopic,
  after: string | undefined,
  op: string,
): void {
  if (after === undefined) {
    parent.children.push(made)
    return
  }
  const at = parent.children.findIndex((child) => child.id === after)
  if (at < 0) {
    throw new CliError(
      EXIT.usage,
      `${op}: after ${after} is not a branch of ${parent.id}`,
      { topic: after, parent: parent.id },
      { reason: 'target_not_found', suggestion: 'pass an id from the children of the parent' },
    )
  }
  parent.children.splice(at + 1, 0, made)
}

function checkedLink(link: string | undefined, op: string): string | null {
  if (link === undefined) return null
  if (!isShownLink(link)) {
    throw new CliError(
      EXIT.usage,
      `${op}: ${JSON.stringify(link)} is empty or a reference into the map file`,
      undefined,
      {
        reason: 'invalid_argument',
        suggestion: 'pass an http(s) or mailto address, or leave the link out',
      },
    )
  }
  return link
}

/** What one applied op did beyond the tree edit. */
export interface MapOpOutcome {
  /** `add_topic`: the id the new topic got */
  created?: string
}

const LINE_KEYS = ['shape', 'width', 'color', 'pattern'] as const satisfies readonly BranchLineKey[]
const MAX_DEPTH = 1024

/** Whether two sets of line values hold the same keys with the same values. */
function sameLine(a: ViewBranchLine, b: ViewBranchLine): boolean {
  return LINE_KEYS.every((key) => a[key] === b[key])
}

/**
 * The line values written on a topic itself that the engine writes: what a
 * topic arriving under it takes (decision 0102). Values the engine never
 * writes (another program's width like `2.5pt`) are not taken.
 */
function writableLineOf(topic: ViewTopic): ViewBranchLine {
  const out: ViewBranchLine = {}
  for (const key of LINE_KEYS) {
    const value = topic.line?.[key]
    if (typeof value === 'string' && isWritableBranchLine(key, value)) out[key] = value
  }
  return out
}

/** Every topic of a branch, the topic first; stops at a depth no file reaches. */
function branchTopics(topic: ViewTopic): ViewTopic[] {
  const out: ViewTopic[] = []
  const visit = (at: ViewTopic, depth: number): void => {
    out.push(at)
    if (depth > MAX_DEPTH) return
    for (const child of at.children) visit(child, depth + 1)
  }
  visit(topic, 0)
  return out
}

/**
 * A topic arrived under `parent` (decision 0102): it and every topic below it
 * take the line values the parent has written on itself (those the engine
 * writes), over their own, key by key. Nothing changes when the parent has
 * none. Returns the ids of the topics that changed — the ones the reconcile
 * must write line values for, the way the app's controller names them
 * (`restyledTopicLines`). The ops never set a line themselves, so no value
 * set by the same op can lose here.
 */
function inheritLineArrival(parent: ViewTopic, topic: ViewTopic): string[] {
  const line = writableLineOf(parent)
  if (Object.keys(line).length === 0) return []
  const changed: string[] = []
  for (const at of branchTopics(topic)) {
    const before = at.line ?? {}
    const after: ViewBranchLine = { ...before, ...line }
    if (sameLine(before, after)) continue
    at.line = after
    changed.push(at.id)
  }
  return changed
}

/**
 * One op on the document, through `reconcileSheet`: the sheet's view is edited
 * and reconciled back, so untouched keys of `content.json` and the other
 * archive entries stay as they were. Like the app's map controller, only the
 * view is edited; the reconciler decides what reaches the source tree.
 */
export function applyMapOp(document: XmindDocument, op: MapOp, index: number): MapOpOutcome {
  const { fields } = op
  const anchor = op.op === 'add_topic' ? fields.parent! : fields.id!
  const sheetIndex = sheetOf(document, anchor, op.op)
  const state = sheetToView(document.sheets[sheetIndex]!, sheetIndex)

  if (op.op === 'add_topic') {
    const spot = aBranch(inSheet(state, fields.parent!, op.op), op.op, fields.parent!)
    const id = newXmindId()
    const made: ViewTopic = {
      id,
      title: fields.title!,
      folded: false,
      labels: [],
      note: fields.note ?? null,
      link: checkedLink(fields.link, op.op),
      image: null,
      markers: [],
      style: {},
      titleRuns: null,
      summaries: [],
      children: [],
    }
    insertBranch(spot.topic, made, fields.after, op.op)
    // the new topic arrives under its parent: it takes the line values the
    // parent has written on itself (decision 0102)
    const relined = inheritLineArrival(spot.topic, made)
    const out = reconcile(document, sheetIndex, state, op, index, relined)
    return { created: out.ids.topics.get(id) ?? id }
  }

  const spot = inSheet(state, fields.id!, op.op)
  let relined: string[] = []
  if (op.op === 'rename_topic') {
    if (spot.kind === 'summary') spot.summary.title = fields.title!
    else spot.topic.title = fields.title!
  } else if (op.op === 'set_note') {
    const target = aBranch(spot, op.op, fields.id!)
    target.topic.note = fields.note!
  } else if (op.op === 'set_link') {
    const target = aBranch(spot, op.op, fields.id!)
    const url = fields.url!
    if (url !== '' && !isShownLink(url)) {
      throw new CliError(
        EXIT.usage,
        `set_link: ${JSON.stringify(url)} is empty or a reference into the map file`,
        { topic: fields.id },
        {
          reason: 'invalid_argument',
          suggestion: 'pass an http(s) or mailto address, or "" to take the link off',
        },
      )
    }
    target.topic.link = url === '' ? null : url
  } else if (op.op === 'move_topic') {
    const moved = aBranch(spot, op.op, fields.id!)
    if (moved.parent === null) {
      throw new CliError(EXIT.usage, 'move_topic: the central topic cannot be moved', undefined, {
        reason: 'invalid_argument',
      })
    }
    const parent = aBranch(inSheet(state, fields.parent!, op.op), op.op, fields.parent!)
    if (parent.topic.id === moved.topic.id || isBelow(parent.topic, moved.topic)) {
      throw new CliError(
        EXIT.usage,
        `move_topic: ${fields.parent} lies below ${fields.id}`,
        { topic: fields.id, parent: fields.parent },
        { reason: 'invalid_argument', suggestion: 'a topic cannot move into its own branch' },
      )
    }
    if (fields.after === fields.id) {
      throw new CliError(EXIT.usage, 'move_topic: after names the topic being moved', undefined, {
        reason: 'invalid_argument',
      })
    }
    moved.parent.children = moved.parent.children.filter((child) => child.id !== moved.topic.id)
    insertBranch(parent.topic, moved.topic, fields.after, op.op)
    // the moved topic stands under another parent afterwards: it and its whole
    // branch take that parent's line values (decision 0102). A reorder among
    // the topic's own siblings is not an arrival and keeps every value.
    if (parent.topic.id !== moved.parent.id) {
      relined = inheritLineArrival(parent.topic, moved.topic)
    }
  } else {
    // delete_topic: the guard first, on the sheet as it is — a deletion that
    // would take elements the map preserves (boundaries, floating topics,
    // callouts, the branches under a summary topic) is refused with the count.
    const taken = countPreservedWithTopics(document.sheets[sheetIndex]!, [fields.id!])
    if (taken > 0) {
      throw new CliError(
        EXIT.usage,
        `delete_topic: ${fields.id} would take ${taken} element(s) the map preserves (boundaries, floating topics, callouts, summary branches); nothing was changed`,
        { topic: fields.id, preserved: taken },
        {
          reason: 'op_rejected',
          suggestion: 'delete those elements in the app first, or leave this topic alone',
        },
      )
    }
    if (spot.kind === 'summary') {
      spot.carrier.summaries = spot.carrier.summaries.filter((s) => s.topicId !== fields.id)
    } else {
      if (spot.parent === null) {
        throw new CliError(
          EXIT.usage,
          'delete_topic: the central topic cannot be deleted',
          undefined,
          {
            reason: 'invalid_argument',
          },
        )
      }
      spot.parent.children = spot.parent.children.filter((child) => child.id !== fields.id)
    }
  }
  reconcile(document, sheetIndex, state, op, index, relined)
  return {}
}

function reconcile(
  document: XmindDocument,
  sheetIndex: number,
  state: ViewSheet,
  op: MapOp,
  index: number,
  restyledTopicLines: readonly string[] = [],
) {
  const out = reconcileSheet(document, sheetIndex, state, { restyledTopicLines })
  if (!out.ok) {
    throw opFailure(index, op.op, `${op.op}: ${out.problem}`, 'op_rejected')
  }
  return out
}

export interface MapOpResult {
  index: number
  op: string
  status: 'ok' | 'failed' | 'skipped'
  created?: string
  error?: string
  reason?: ErrorReason
  /** what the refusal carried (e.g. `delete_topic`'s preserved count) */
  detail?: Record<string, unknown>
}

function opNameOf(raw: unknown): string {
  const name = raw !== null && typeof raw === 'object' ? (raw as { op?: unknown }).op : undefined
  return typeof name === 'string' ? name : ''
}

/**
 * `map apply`: the batch on the map, written to `output` (default: in place).
 * Atomic by default — one refused op leaves the file as it was — with the
 * other document commands' `--best-effort` and `--stop-on-error`. Every write
 * goes through `XmindDocument.save`, which keeps an unchanged file byte for
 * byte and otherwise rewrites `content.json` only.
 */
export async function applyMap(
  opened: OpenedMap,
  ops: unknown[],
  output: string,
  args: ParsedArgs,
  write: (path: string, bytes: Uint8Array) => void,
): Promise<CommandResult> {
  const mode = batchMode(args)
  const results: MapOpResult[] = []
  const failures: OpFailure[] = []
  let stopped = false
  for (const [index, raw] of ops.entries()) {
    const name = opNameOf(raw)
    if (stopped) {
      results.push({ index, op: name, status: 'skipped' })
      continue
    }
    let op: MapOp
    try {
      op = readMapOp(raw, index)
      const outcome = applyMapOp(opened.document, op, index)
      results.push({
        index,
        op: op.op,
        status: 'ok',
        ...(outcome.created ? { created: outcome.created } : {}),
      })
    } catch (err) {
      const failure =
        err instanceof CliError
          ? { index, op: name || '(no op)', error: err.message, reason: err.reason }
          : {
              index,
              op: name || '(no op)',
              error: String(err),
              reason: 'op_rejected' as ErrorReason,
            }
      const detail = err instanceof CliError ? err.detail : undefined
      results.push({ ...failure, status: 'failed', ...(detail ? { detail } : {}) })
      failures.push(failure)
      if (mode !== 'best_effort') stopped = true
    }
  }
  if (mode === 'atomic' && failures.length > 0) {
    const first = failures[0]!
    const firstDetail = results.find((r) => r.status === 'failed')?.detail
    throw new CliError(
      EXIT.usage,
      `no ops were applied: op ${first.index} (${first.op}) refused: ${first.error}; the file is unchanged`,
      {
        failures,
        batch: batchCounts(ops.length, 0, failures.length),
        results,
        ...(firstDetail ?? {}),
      },
      { reason: first.reason, suggestion: GUIDE_HINT },
    )
  }
  const applied = results.filter((r) => r.status === 'ok').length
  const counts = batchCounts(ops.length, applied, failures.length)
  const changed = opened.document.changed
  if (changed || output !== opened.path) {
    write(output, await opened.document.save())
    return batchResult(
      {
        summary: `applied ${applied} of ${ops.length} ops to ${basename(output)}`,
        outputPath: output,
        detail: { changed, results },
      },
      counts,
      failures,
    )
  }
  return batchResult(
    {
      summary: `applied ${applied} of ${ops.length} ops; nothing changed, nothing written`,
      detail: { changed: false, results },
    },
    counts,
    failures,
  )
}

// ---- create ----

/** `map create --outline`: a new `.xmind` from outline text. */
export async function createMap(
  text: string,
  output: string,
  write: (path: string, bytes: Uint8Array) => void,
): Promise<CommandResult> {
  const document = await createXmindDocumentFromOutline(text, { untitled: 'Untitled' })
  write(output, await document.save())
  return {
    summary: `created ${basename(output)}: ${document.sheets.length} sheet(s)`,
    outputPath: output,
    detail: { sheets: document.sheets.length },
  }
}

// ---- the op reference ----

const GROUPS: { name: string; summary: string; ops: string[] }[] = [
  {
    name: 'topics',
    summary: 'the branches of the map: add, rename, move, delete',
    ops: ['add_topic', 'rename_topic', 'move_topic', 'delete_topic'],
  },
  { name: 'values', summary: 'the note and the link of a topic', ops: ['set_note', 'set_link'] },
]

const str: JsonSchema = { type: 'string' }

/** The input schema of one op object, in the shape the sheets and docs catalogs use. */
function opSchema(op: string, fields: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return {
    type: 'object',
    properties: { op: { type: 'string', const: op }, ...fields },
    required: ['op', ...required],
  }
}

const OP_SCHEMAS: Record<string, () => JsonSchema> = {
  add_topic: () =>
    opSchema(
      'add_topic',
      {
        parent: { ...str, description: 'id of the topic the new topic hangs from' },
        after: { ...str, description: 'id of the branch to insert after (default: the last)' },
        title: str,
        note: str,
        link: str,
      },
      ['parent', 'title'],
    ),
  rename_topic: () => opSchema('rename_topic', { id: str, title: str }, ['id', 'title']),
  move_topic: () =>
    opSchema(
      'move_topic',
      {
        id: str,
        parent: { ...str, description: 'id of the new parent' },
        after: { ...str, description: 'id of the branch to insert after (default: the last)' },
      },
      ['id', 'parent'],
    ),
  delete_topic: () =>
    opSchema(
      'delete_topic',
      { id: { ...str, description: 'a branch, or a summary topic for its summary' } },
      ['id'],
    ),
  set_note: () =>
    opSchema('set_note', { id: str, note: { ...str, description: 'plain text; "" clears' } }, [
      'id',
      'note',
    ]),
  set_link: () =>
    opSchema('set_link', { id: str, url: { ...str, description: 'http(s)/mailto; "" clears' } }, [
      'id',
      'url',
    ]),
}

/** `guide map`: the six ops `map apply` runs, with the schema each one is checked against. */
export function mapCatalog(): OpCatalog {
  const ops: OpEntry[] = Object.keys(MAP_OP_FIELDS).map((op) => {
    const schema = OP_SCHEMAS[op]!()
    return {
      op,
      group: GROUPS.find((g) => g.ops.includes(op))?.name ?? 'other',
      signature: signatureFromSchema(schema),
      note: MAP_OP_NOTES[op],
      schema,
    }
  })
  const groups = GROUPS.map((g) => ({
    name: g.name,
    summary: g.summary,
    ops: ops.filter((e) => e.group === g.name).map((e) => e.op),
  })).filter((g) => g.ops.length > 0)
  return withFingerprint({ domain: 'map', groups, ops })
}

const MAP_OP_NOTES: Readonly<Record<string, string>> = {
  add_topic: 'a new branch below parent, after the branch after names (else the last)',
  rename_topic: 'the title of a topic (a summary topic renames its summary)',
  move_topic: 'a branch to another parent, after the branch after names (else the last)',
  delete_topic: 'a branch with everything below it; refused when it would take preserved elements',
  set_note: 'the topic note as plain text; "" takes it off',
  set_link: 'the topic link; "" takes it off',
}

/** The text form of the map catalog, with the rules an agent needs before writing ops. */
export function mapGuideText(catalog: OpCatalog, group?: string): string {
  return [
    'Map ops (ieumoffice map apply --ops; map create builds a new map from an outline): a JSON array; every entry is { "op": "<name>", ...fields }. They edit the map the way the mind map editor does, through the same engine path and the same delete guard.',
    'Topics are named by the ids `ieumoffice map read <file> --json` lists; ids are unique per sheet only, and there is no sheet selector, so an id that appears on more than one sheet cannot be targeted at all: every op naming it is refused, and only a future sheet selector would fix that. Later ops run against the map as the earlier ops left it, but can only name ids the map already had: a new topic id comes back in detail.results[].created, and no later op in the same batch can name it (a later `map apply` run can).',
    'delete_topic is refused when the topic would take elements the map preserves (boundaries, floating topics, callouts, the branches under a summary topic): the refusal reports how many. Everything the editor does not show goes back out on save as it came in.',
    'A batch is all or nothing by default: one refused op leaves the file as it was. --best-effort applies every op that can apply, --stop-on-error stops at the first refusal. An empty list (or one where nothing changed) writes nothing unless --out names another file.',
    'Field notation: bare = string, n = number, bool = boolean, ? = optional, a|b = one of.',
    '',
    ...renderGroups(catalog, group),
  ].join('\n')
}
