/**
 * `.whiteboard` format driver for `@genoffice/cli` (read, apply, create, convert, guide).
 * Runs headless on the Rust WASM engine (`@genoffice/whiteboard-engine/node`) for
 * read, apply, create, guide, and `--to md`. Uses `--headless-export` for `--to pdf|png|svg`.
 * Refuses `.excalidraw*` with exit code 2 (`unsupported`) — Excalidraw is GUI import-only.
 */
import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { PRODUCT_NAME } from '@genoffice/i18n'
import {
  applyTemplate,
  boardToMarkdown,
  createNewArchive,
  createNewBoard,
  openWhiteboardArchive,
  planBoardEdit,
  readBoardTable,
  type BatchMode,
  type WhiteboardArchiveHandle,
} from '@genoffice/whiteboard-engine/node'
import { flagBool, flagString, type ParsedArgs } from '../args'
import { batchCounts, batchMode, batchResult } from '../batch'
import {
  readInput,
  readTextFile,
  resolveInput,
  resolveOutput,
  stripBom,
  type PathContext,
} from '../fs'
import type { OpFailure } from '../op-errors'
import {
  signatureFromSchema,
  withFingerprint,
  type JsonSchema,
  type OpCatalog,
  type OpEntry,
} from '../op-catalog'
import { readOpsInput, readOpsStream } from '../ops-input'
import { appLaunch } from '../resources'
import { CliError, EXIT, type CommandResult, type ErrorReason } from '../result'
import { describeExit, exitCodeFor, parseEnvelope, waitFor } from './app-export'

export const WHITEBOARD_EXTENSIONS = '.whiteboard'
export const WHITEBOARD_CONVERT_TARGETS = ['md', 'pdf', 'png', 'svg'] as const
export type WhiteboardConvertTarget = (typeof WHITEBOARD_CONVERT_TARGETS)[number]

const EXCALIDRAW_RE = /\.excalidraw(\.(png|svg))?$/i
const WHITEBOARD_RE = /\.whiteboard$/i

export function isWhiteboardPath(filePath: string): boolean {
  return WHITEBOARD_RE.test(filePath) || EXCALIDRAW_RE.test(filePath)
}

export function assertWhiteboardCliPath(filePath: string): void {
  if (EXCALIDRAW_RE.test(filePath)) {
    throw new CliError(
      EXIT.file,
      `Excalidraw files are imported in the GUI app, not read or written by the CLI: ${filePath}`,
      undefined,
      {
        reason: 'unsupported',
        suggestion:
          'open the Excalidraw file in the app (it becomes a new whiteboard), save it as .whiteboard, then use that file',
      },
    )
  }
  if (!WHITEBOARD_RE.test(filePath)) {
    throw new CliError(EXIT.usage, `not a whiteboard (${WHITEBOARD_EXTENSIONS}): ${filePath}`, undefined, {
      reason: 'unsupported',
      suggestion: 'name a .whiteboard file',
    })
  }
}

export interface OpenedWhiteboard {
  path: string
  archive: WhiteboardArchiveHandle
}

export function openWhiteboardInput(file: string | undefined, ctx: PathContext): OpenedWhiteboard {
  const path = resolveInput(file, ctx)
  assertWhiteboardCliPath(path)
  try {
    const archive = openWhiteboardArchive(readInput(path))
    return { path, archive }
  } catch (err) {
    throw new CliError(
      EXIT.file,
      `${basename(path)} does not open as a whiteboard: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { reason: 'unsupported' },
    )
  }
}

function readJsonSource(
  raw: string,
  flagName: string,
  args: ParsedArgs,
  ctx: PathContext,
): { text: string; source: string } {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return { text: raw, source: `--${flagName}` }
  }
  if (raw === '-') {
    return { text: stripBom(readOpsStream(0, 'stdin')), source: 'stdin' }
  }
  if (raw.startsWith('@')) {
    return readOpsInput({ ...args, flags: { ...args.flags, ops: raw.slice(1) } }, ctx)
  }
  const filePath = resolveInput(raw, ctx)
  return { text: stripBom(readTextFile(filePath)), source: filePath }
}

export function whiteboardOpsOf(args: ParsedArgs, ctx: PathContext): Record<string, unknown>[] {
  const spec = flagString(args, 'ops')
  if (!spec) {
    throw new CliError(EXIT.usage, 'missing --ops <JSON|@file|->', undefined, {
      reason: 'missing_argument',
      suggestion: 'run `ieumoffice guide whiteboard` for the ops',
    })
  }
  const { text, source } = readJsonSource(spec, 'ops', args, ctx)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new CliError(
      EXIT.usage,
      `${source} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { reason: 'invalid_argument' },
    )
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { ops?: unknown }).ops)
      ? ((parsed as { ops: unknown[] }).ops)
      : null
  if (!list || list.length === 0) {
    throw new CliError(EXIT.usage, `${source} must be a non-empty JSON array of ops`, undefined, {
      reason: 'invalid_argument',
    })
  }
  return list as Record<string, unknown>[]
}

export function whiteboardTemplateOf(
  args: ParsedArgs,
  ctx: PathContext,
): Record<string, unknown> | undefined {
  const spec = flagString(args, 'template')
  if (spec === undefined) return undefined
  if (!spec) {
    throw new CliError(EXIT.usage, 'missing --template <JSON|@file|->', undefined, {
      reason: 'missing_argument',
    })
  }
  const { text, source } = readJsonSource(spec, 'template', args, ctx)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new CliError(
      EXIT.usage,
      `${source} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { reason: 'invalid_argument' },
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(EXIT.usage, `${source} must be a TemplateDocument JSON object`, undefined, {
      reason: 'invalid_argument',
    })
  }
  return parsed as Record<string, unknown>
}

export function readWhiteboard(
  opened: OpenedWhiteboard,
  args: ParsedArgs,
  json: boolean,
): CommandResult {
  try {
    const doc = opened.archive.getDocument()
    const pageRef = flagString(args, 'page')
    const view = readBoardTable(doc, pageRef, [])
    if (!view) {
      throw new CliError(
        EXIT.usage,
        `page "${pageRef}" not found`,
        { pages: doc.pages.map((p) => ({ id: p.id, title: p.title })) },
        { reason: 'target_not_found', suggestion: 'pass a page id, title, or 1-based index' },
      )
    }
    const objCount = view.pages.reduce((n, p) => n + p.objectCount, 0)
    const header = `${basename(opened.path)}: ${doc.pages.length} page(s); ${objCount} object(s)`
    if (json) {
      return {
        summary: header,
        detail: {
          title: doc.title,
          pages: view.pages,
        },
      }
    }
    return { summary: `${header}\n\n${view.text}` }
  } finally {
    opened.archive.dispose()
  }
}

function toEngineBatchMode(mode: ReturnType<typeof batchMode>): BatchMode {
  if (mode === 'best_effort') return 'best_effort'
  if (mode === 'stop_on_error') return 'stop_on_error'
  return 'all_or_nothing'
}

function mapEditReason(code: string | undefined): ErrorReason {
  switch (code) {
    case 'unknown_op':
      return 'unknown_op'
    case 'target_not_found':
    case 'page_not_found':
    case 'resource_not_found':
      return 'target_not_found'
    case 'invalid_argument':
    case 'invalid_template':
      return 'invalid_argument'
    default:
      return 'op_rejected'
  }
}

export function applyToWhiteboard(
  opened: OpenedWhiteboard,
  ops: Record<string, unknown>[],
  output: string,
  args: ParsedArgs,
  _ctx: PathContext,
  writeOutput: (path: string, bytes: Uint8Array) => void,
): CommandResult {
  try {
    const mode = batchMode(args)
    const doc = opened.archive.getDocument()
    const defaultPageId = flagString(args, 'page')
    const planned = planBoardEdit(doc, ops, {
      ...(defaultPageId ? { defaultPageId } : {}),
      mode: toEngineBatchMode(mode),
    })

    const failures: OpFailure[] = (planned.failures ?? []).map((f) => ({
      index: f.index,
      op: f.op,
      error: f.error?.message ?? 'operation failed',
      reason: mapEditReason(f.error?.code),
    }))

    if (!planned.ok && mode === 'atomic') {
      throw new CliError(
        EXIT.usage,
        failures[0]?.error ?? 'whiteboard edit rejected',
        {
          changed: false,
          results: planned.results,
          created: [],
          batch: batchCounts(ops.length, 0, failures.length),
          failures,
        },
        { reason: failures[0]?.reason ?? 'invalid_argument' },
      )
    }

    if (planned.changed || output !== opened.path) {
      opened.archive.setDocument(planned.doc)
      writeOutput(output, opened.archive.save())
    }

    const appliedCount = planned.results.filter((r) => r.status === 'ok').length
    const counts = batchCounts(ops.length, appliedCount, failures.length)
    return batchResult(
      {
        summary: `${basename(output)}: ${appliedCount} op(s) applied`,
        outputPath: output,
        detail: {
          changed: planned.changed,
          results: planned.results,
          created: planned.created,
        },
      },
      counts,
      failures,
    )
  } finally {
    opened.archive.dispose()
  }
}

export function createWhiteboard(
  output: string,
  ops: Record<string, unknown>[] | undefined,
  template: Record<string, unknown> | undefined,
  _ctx: PathContext,
  writeOutput: (path: string, bytes: Uint8Array) => void,
): CommandResult {
  assertWhiteboardCliPath(output)
  if (!ops && !template) {
    throw new CliError(
      EXIT.usage,
      'create --type whiteboard requires --ops <JSON|@file|-> or --template <JSON|@file|->',
      undefined,
      { reason: 'missing_argument', suggestion: 'run `ieumoffice guide whiteboard`' },
    )
  }

  let doc = createNewBoard(randomUUID(), 'page-1', basename(output, extname(output)))
  let templateCreated: string[] = []
  let opsResult: ReturnType<typeof planBoardEdit> | undefined

  if (template) {
    // CLI create --template always starts fresh pages (replace empty default page if template creates new_pages).
    const tplNormalized = { ...template, target: 'current_page' }
    const applied = applyTemplate(doc, tplNormalized, doc.pages[0]!.id)
    if (!applied.ok) {
      throw new CliError(EXIT.usage, applied.error.message, { error: applied.error }, {
        reason: 'invalid_argument',
      })
    }
    doc = applied.result.doc
    templateCreated = applied.result.createdObjectIds
  }

  if (ops && ops.length > 0) {
    const planned = planBoardEdit(doc, ops, {
      defaultPageId: doc.pages[0]?.id,
      mode: 'all_or_nothing',
    })
    if (!planned.ok) {
      const first = planned.failures?.[0]
      throw new CliError(
        EXIT.usage,
        first?.error?.message ?? 'whiteboard ops rejected',
        { results: planned.results, failures: planned.failures },
        { reason: 'invalid_argument' },
      )
    }
    doc = planned.doc
    opsResult = planned
  }

  const arch = createNewArchive(doc)
  try {
    writeOutput(output, arch.save())
  } finally {
    arch.dispose()
  }

  return {
    summary: `created ${basename(output)} (${doc.pages.length} page(s), ${doc.objects.length} object(s))`,
    outputPath: output,
    detail: {
      pages: doc.pages.length,
      objects: doc.objects.length,
      ...(template ? { templateCreated } : {}),
      ...(opsResult ? { results: opsResult.results, created: opsResult.created } : {}),
    },
  }
}

async function runWhiteboardHeadlessExport(
  input: string,
  to: 'pdf' | 'png' | 'svg',
  outPath: string,
  pageNumber: number | undefined,
  env: NodeJS.ProcessEnv,
  log?: (msg: string) => void,
): Promise<{ summary: string; paths: string[]; detail: Record<string, unknown> }> {
  const launch = appLaunch(env)
  if (!launch || (launch.args.length === 0 && !existsSync(launch.command))) {
    throw new CliError(
      EXIT.app,
      `converting a whiteboard to ${to} needs the ${PRODUCT_NAME} app, which was not found`,
      { hint: `install ${PRODUCT_NAME}, or set GENOFFICE_APP_BIN to its executable` },
      {
        reason: 'app_unavailable',
        suggestion: `install ${PRODUCT_NAME} (or set GENOFFICE_APP_BIN) and run the command again`,
      },
    )
  }
  const argv = [
    ...launch.args,
    '--headless-export',
    input,
    '--to',
    to,
    '--out',
    outPath,
    ...(pageNumber !== undefined ? ['--page', String(pageNumber)] : []),
    '--json',
  ]
  const childEnv = { ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  log?.(`starting ${PRODUCT_NAME} for whiteboard ${to} export`)
  const child = nodeSpawn(launch.command, argv, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const { code, signal, stdout, stderr, timedOut } = await waitFor(child, 180_000, 2000)
  const envelope = parseEnvelope(stdout)
  if (envelope?.status === 'ok') {
    const paths = envelope.output_paths ?? (envelope.output_path ? [envelope.output_path] : [])
    if (paths.length > 0 && paths.every((p) => existsSync(p))) {
      return { summary: envelope.summary ?? '', paths, detail: envelope.detail ?? {} }
    }
  }
  if (timedOut) {
    throw new CliError(EXIT.conversion, `${PRODUCT_NAME} did not finish the whiteboard export in time`, {
      app: launch.command,
    })
  }
  const tail = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ')
  if (!envelope && (signal || code === null)) {
    throw new CliError(
      EXIT.app,
      `${PRODUCT_NAME} ${describeExit(code, signal)} while exporting ${input}${tail ? `: ${tail}` : ''}`,
      { app: launch.command, exit_code: code, signal },
      { reason: 'app_crashed' },
    )
  }
  throw new CliError(
    exitCodeFor(code),
    envelope?.error ?? envelope?.summary ?? (tail || `${PRODUCT_NAME} exited with code ${code}`),
    { app: launch.command, exit_code: code },
  )
}

export async function convertWhiteboard(
  input: string,
  args: ParsedArgs,
  ctx: PathContext & { env: NodeJS.ProcessEnv; log?: (msg: string) => void },
  writeOutput: (path: string, bytes: Uint8Array) => void,
): Promise<CommandResult> {
  assertWhiteboardCliPath(input)
  const to = flagString(args, 'to')?.toLowerCase()
  if (!to) {
    throw new CliError(EXIT.usage, 'missing --to <md|pdf|png|svg>', undefined, {
      reason: 'missing_argument',
    })
  }
  if (!(WHITEBOARD_CONVERT_TARGETS as readonly string[]).includes(to)) {
    throw new CliError(
      EXIT.usage,
      `cannot convert .whiteboard to .${to}`,
      { supported: [...WHITEBOARD_CONVERT_TARGETS] },
      { reason: 'unsupported' },
    )
  }

  const pageRef = flagString(args, 'page')
  const stem = basename(input, extname(input))
  const defaultOut = join(dirname(input), `${stem}.${to}`)
  const out = resolveOutput(flagString(args, 'out'), ctx, {
    fallback: defaultOut,
    force: flagBool(args, 'force'),
    fresh: true,
  })

  if (to === 'md') {
    const opened = openWhiteboardInput(input, ctx)
    try {
      const doc = opened.archive.getDocument()
      const md = boardToMarkdown(doc, pageRef)
      if (md === null) {
        throw new CliError(EXIT.usage, `page "${pageRef}" not found`, undefined, {
          reason: 'target_not_found',
        })
      }
      writeOutput(out, Buffer.from(md, 'utf8'))
      return {
        summary: `converted ${basename(input)} to ${basename(out)}`,
        outputPath: out,
        detail: { pages: pageRef ? 1 : doc.pages.length, output_path: out },
      }
    } finally {
      opened.archive.dispose()
    }
  }

  // Resolve optional --page into a 1-based page number for headless export.
  let pageNumber: number | undefined
  if (pageRef !== undefined) {
    const opened = openWhiteboardInput(input, ctx)
    try {
      const doc = opened.archive.getDocument()
      const idx = doc.pages.findIndex(
        (p, i) =>
          p.id === pageRef ||
          p.title.toLowerCase() === pageRef.toLowerCase() ||
          String(i + 1) === pageRef,
      )
      if (idx < 0) {
        throw new CliError(EXIT.usage, `page "${pageRef}" not found`, undefined, {
          reason: 'target_not_found',
        })
      }
      pageNumber = idx + 1
    } finally {
      opened.archive.dispose()
    }
  }

  const res = await runWhiteboardHeadlessExport(
    input,
    to as 'pdf' | 'png' | 'svg',
    out,
    pageNumber,
    ctx.env,
    ctx.log,
  )
  return {
    summary: res.summary || `converted ${basename(input)} to ${to}`,
    outputPath: res.paths[0] ?? out,
    detail: {
      pages: res.detail.pages ?? res.paths.length,
      ...(res.paths.length > 1 ? { output_paths: res.paths } : {}),
    },
  }
}

// ---- Op catalog & guide ----

const OP_SCHEMAS: Array<{ op: string; group: string; note: string; schema: JsonSchema }> = [
  {
    op: 'add',
    group: 'objects',
    note: 'Add a sticky, text, shape, connector, stroke, image, table, sticker, or link object; auto-places free slot if x/y omitted',
    schema: {
      type: 'object',
      required: ['op', 'kind'],
      properties: {
        op: { const: 'add' },
        id: { type: 'string' },
        pageId: { type: 'string' },
        kind: {
          enum: ['sticky', 'text', 'shape', 'connector', 'stroke', 'image', 'table', 'sticker', 'link'],
        },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        text: { type: 'string' },
        color: { type: 'string' },
        shape: {
          enum: [
            'rectangle',
            'rounded_rectangle',
            'ellipse',
            'triangle',
            'diamond',
            'star',
            'speech_bubble',
            'block_arrow',
          ],
        },
        from: { type: 'string' },
        to: { type: 'string' },
        url: { type: 'string' },
        title: { type: 'string' },
        rows: { type: 'number' },
        cols: { type: 'number' },
      },
    },
  },
  {
    op: 'update',
    group: 'objects',
    note: 'Update text, style, size, position, or table cells of an existing object',
    schema: {
      type: 'object',
      required: ['op', 'id'],
      properties: {
        op: { const: 'update' },
        id: { type: 'string' },
        text: { type: 'string' },
        color: { type: 'string' },
        fill: { type: 'string' },
        stroke: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        tablePatch: { type: 'object' },
      },
    },
  },
  {
    op: 'move',
    group: 'objects',
    note: 'Move an object by absolute x/y or relative dx/dy, move across pages, or change z-order (toFront/toBack)',
    schema: {
      type: 'object',
      required: ['op', 'id'],
      properties: {
        op: { const: 'move' },
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        dx: { type: 'number' },
        dy: { type: 'number' },
        pageId: { type: 'string' },
        toFront: { type: 'boolean' },
        toBack: { type: 'boolean' },
      },
    },
  },
  {
    op: 'delete',
    group: 'objects',
    note: 'Delete an object by id',
    schema: {
      type: 'object',
      required: ['op', 'id'],
      properties: {
        op: { const: 'delete' },
        id: { type: 'string' },
      },
    },
  },
  {
    op: 'add_page',
    group: 'pages',
    note: 'Add a freeform or fixed-size page (freeform, wide_16_9, a4_portrait, a4_landscape, custom)',
    schema: {
      type: 'object',
      required: ['op'],
      properties: {
        op: { const: 'add_page' },
        id: { type: 'string' },
        title: { type: 'string' },
        format: { enum: ['freeform', 'wide_16_9', 'a4_portrait', 'a4_landscape', 'custom'] },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
  },
  {
    op: 'rename_page',
    group: 'pages',
    note: 'Rename a page',
    schema: {
      type: 'object',
      required: ['op', 'pageId', 'title'],
      properties: {
        op: { const: 'rename_page' },
        pageId: { type: 'string' },
        title: { type: 'string' },
      },
    },
  },
  {
    op: 'delete_page',
    group: 'pages',
    note: 'Delete a page and its objects (refused with last_page_delete if only 1 page remains)',
    schema: {
      type: 'object',
      required: ['op', 'pageId'],
      properties: {
        op: { const: 'delete_page' },
        pageId: { type: 'string' },
      },
    },
  },
  {
    op: 'set_page_format',
    group: 'pages',
    note: 'Change a page format (freeform, wide_16_9, a4_portrait, a4_landscape, custom) or background',
    schema: {
      type: 'object',
      required: ['op', 'pageId', 'format'],
      properties: {
        op: { const: 'set_page_format' },
        pageId: { type: 'string' },
        format: { enum: ['freeform', 'wide_16_9', 'a4_portrait', 'a4_landscape', 'custom'] },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
  },
]

export function whiteboardCatalog(): OpCatalog {
  const ops: OpEntry[] = OP_SCHEMAS.map((entry) => ({
    op: entry.op,
    group: entry.group,
    signature: signatureFromSchema(entry.schema),
    note: entry.note,
    schema: entry.schema,
  }))
  const groups = [
    {
      name: 'objects',
      summary: 'Add, edit, move, and delete whiteboard objects',
      ops: ops.filter((o) => o.group === 'objects').map((o) => o.op),
    },
    {
      name: 'pages',
      summary: 'Add, rename, format, and delete whiteboard pages',
      ops: ops.filter((o) => o.group === 'pages').map((o) => o.op),
    },
  ]
  return withFingerprint({ domain: 'whiteboard', groups, ops })
}

export function whiteboardGuideText(catalog: OpCatalog, group?: string): string {
  const lines = [
    '# Whiteboard (.whiteboard) operations & template guide',
    '',
    'Run `ieumoffice whiteboard read <file>` first to inspect page and object IDs.',
    'Batch edits (`whiteboard apply`) are atomic (all-or-nothing) by default.',
    '',
  ]
  for (const g of catalog.groups) {
    if (group && g.name !== group) continue
    lines.push(`## ${g.name} — ${g.summary ?? ''}`)
    for (const op of catalog.ops.filter((o) => o.group === g.name)) {
      lines.push(`- ${op.op} ${op.signature}`)
      if (op.note) lines.push(`  ${op.note}`)
    }
    lines.push('')
  }
  if (!group) {
    lines.push('## Declarative template (`create --type whiteboard --template`)')
    lines.push(
      'JSON object `{ "schemaVersion": 1, "title"?, "pages": [{ "key", "title"?, "format"?, "blocks": [...] }] }`.',
    )
    lines.push(
      'Containers: `stack` (direction: vertical|horizontal, gap, padding, children), `grid` (columns>=1, gap, padding, children).',
    )
    lines.push(
      'Leaf blocks (12): `title`, `card`, `zone`, `sticky`, `text`, `shape`, `connector` (from/to block keys), `stroke`, `image`, `table`, `sticker`, `link`.',
    )
  }
  return lines.join('\n')
}
