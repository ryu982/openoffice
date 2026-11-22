import { flagBool } from '../args'
import { BATCH_OPTIONS } from '../batch'
import {
  WHITEBOARD_EXTENSIONS,
  applyToWhiteboard,
  openWhiteboardInput,
  readWhiteboard,
  whiteboardOpsOf,
} from '../formats/whiteboard'
import { resolveOutput, writeOutput } from '../fs'
import type { CommandDef } from '../registry'
import { CliError, EXIT } from '../result'

export const whiteboardCommand: CommandDef = {
  name: 'whiteboard',
  summary: `Read or edit a whiteboard (${WHITEBOARD_EXTENSIONS}) locally via Rust WASM.`,
  usage:
    'whiteboard read <file> [--page <id|name>] | whiteboard apply <file> --ops <JSON|@file|-> [--page <id|name>] [--out <path>] [--best-effort|--stop-on-error] [--force]',
  options: [
    {
      name: 'page',
      value: 'id|name',
      description:
        'read: only this page (default: every page). apply: default page for ops without pageId',
    },
    {
      name: 'ops',
      value: 'JSON|@file|-',
      description:
        'apply: JSON array of ops (add, update, move, delete, add_page, rename_page, delete_page, set_page_format), inline, @<file>, file path, or "-" for stdin. See `ieumoffice guide whiteboard`.',
    },
    ...BATCH_OPTIONS,
    {
      name: 'out',
      value: 'path',
      description: 'apply: write here instead of in place',
    },
    {
      name: 'force',
      description: 'apply: overwrite an existing --out, or write a file open in GenOffice',
    },
  ],
  async run(args, ctx) {
    const [verb, file] = args.positionals
    if (verb === 'read') {
      for (const flag of ['ops', 'out', 'force', 'best-effort', 'stop-on-error']) {
        if (args.flags[flag] !== undefined) {
          throw new CliError(EXIT.usage, `--${flag} goes with whiteboard apply`, undefined, {
            reason: 'unknown_option',
          })
        }
      }
      return readWhiteboard(openWhiteboardInput(file, ctx), args, flagBool(args, 'json'))
    }
    if (verb === 'apply') {
      const opened = openWhiteboardInput(file, ctx)
      const out = args.flags.out
      if (out === true) {
        throw new CliError(EXIT.usage, 'missing --out <path>', undefined, {
          reason: 'missing_argument',
        })
      }
      const ops = whiteboardOpsOf(args, ctx)
      const output = resolveOutput(out, ctx, {
        fallback: opened.path,
        force: flagBool(args, 'force'),
        fresh: out !== undefined,
      })
      return applyToWhiteboard(opened, ops, output, args, ctx, writeOutput)
    }
    throw new CliError(
      EXIT.usage,
      'expected "whiteboard read <file>" or "whiteboard apply <file> --ops <JSON|@file|->"',
      undefined,
      {
        reason: verb === undefined ? 'missing_argument' : 'invalid_argument',
        suggestion: 'run `ieumoffice help whiteboard`',
      },
    )
  },
}
