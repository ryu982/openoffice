import { flagBool } from '../args'
import { BATCH_OPTIONS } from '../batch'
import {
  applyMap,
  createMap,
  mapOpsOf,
  openMapInput,
  outlineOutputPath,
  outlineTextOf,
  readMap,
  MAP_EXTENSION,
} from '../formats/map'
import { resolveOutput, writeOutput } from '../fs'
import type { CommandDef } from '../registry'
import { CliError, EXIT } from '../result'

/**
 * `map read`, `map apply` and `map create`: mind maps (`.xmind`) with six topic
 * ops that edit the way the editor does. Everything runs in this process through
 * `@genoffice/xmind-engine`, so untouched parts of the file stay byte for byte
 * and no app is ever started.
 */
export const mapCommand: CommandDef = {
  name: 'map',
  summary: `Read, edit or create a mind map (${MAP_EXTENSION}) with topic ops that edit the way the editor does.`,
  usage:
    'map read <file> [--json] | map apply <file> --ops <JSON|@file|-> [--out <path>] [--best-effort|--stop-on-error] [--force] | map create --outline <file|-> [--out <path.xmind>] [--force]',
  options: [
    {
      name: 'outline',
      value: 'file|-',
      description:
        'create: the outline text to build the map from (`# ` heading per sheet, `- ` item per topic), a file path or "-" for stdin',
    },
    {
      name: 'ops',
      value: 'JSON|@file|-',
      description:
        'apply: JSON array of ops, each { "op": "<name>", ...fields } (add_topic, rename_topic, move_topic, delete_topic, set_note, set_link), inline, @<file>, a file path, or "-" for stdin. See `ieumoffice guide map`.',
    },
    ...BATCH_OPTIONS,
    {
      name: 'out',
      value: 'path',
      description:
        'apply: write here instead of in place. create: the map to write (default: the outline name with .xmind)',
    },
    {
      name: 'force',
      description:
        'apply: overwrite an existing --out, or write a file open in GenOffice. create: overwrite an existing output',
    },
  ],
  async run(args, ctx) {
    const [verb, file] = args.positionals
    if (verb === 'read') {
      for (const flag of ['ops', 'outline', 'out', 'force', 'best-effort', 'stop-on-error']) {
        if (args.flags[flag] !== undefined) {
          throw new CliError(EXIT.usage, `--${flag} goes with map apply or map create`, undefined, {
            reason: 'unknown_option',
          })
        }
      }
      return readMap(await openMapInput(file, ctx), flagBool(args, 'json'))
    }
    if (verb === 'apply') {
      if (args.flags.outline !== undefined) {
        throw new CliError(EXIT.usage, '--outline goes with map create', undefined, {
          reason: 'unknown_option',
        })
      }
      const opened = await openMapInput(file, ctx)
      const out = args.flags.out
      if (out === true) {
        throw new CliError(EXIT.usage, 'missing --out <path>', undefined, {
          reason: 'missing_argument',
        })
      }
      const ops = mapOpsOf(args, ctx)
      const output = resolveOutput(out, ctx, {
        fallback: opened.path,
        force: flagBool(args, 'force'),
        // in-place edits overwrite by design; --out onto another existing file needs --force
        fresh: out !== undefined,
      })
      return applyMap(opened, ops, output, args, writeOutput)
    }
    if (verb === 'create') {
      for (const flag of ['ops', 'best-effort', 'stop-on-error']) {
        if (args.flags[flag] !== undefined) {
          throw new CliError(EXIT.usage, `--${flag} goes with map apply`, undefined, {
            reason: 'unknown_option',
          })
        }
      }
      if (file !== undefined) {
        throw new CliError(
          EXIT.usage,
          `map create takes no file argument (${file}); the map is written by --out`,
          undefined,
          { reason: 'invalid_argument', suggestion: 'run `ieumoffice help map`' },
        )
      }
      const out = args.flags.out
      if (out === true) {
        throw new CliError(EXIT.usage, 'missing --out <path>', undefined, {
          reason: 'missing_argument',
        })
      }
      const { text, path } = outlineTextOf(args, ctx)
      const output = resolveOutput(out, ctx, {
        ...(path === null ? {} : { fallback: outlineOutputPath(path) }),
        force: flagBool(args, 'force'),
        fresh: true,
      })
      return createMap(text, output, writeOutput)
    }
    throw new CliError(
      EXIT.usage,
      'expected "map read <file>", "map apply <file> --ops <JSON|@file|->" or "map create --outline <file|->"',
      undefined,
      {
        reason: verb === undefined ? 'missing_argument' : 'invalid_argument',
        suggestion: 'run `ieumoffice help map`',
      },
    )
  },
}
