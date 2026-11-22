import type { ListedTool } from './listing'

/**
 * Built-in Obsidian Vault connector tool definitions (7 Markdown note tools).
 *
 * Read tools carry `readOnlyHint: true` (default permission `always`);
 * `create_note` carries `destructiveHint: false` (default `ask`);
 * `append_note`, `update_note`, and `delete_note` carry `destructiveHint: true`
 * (default `ask`).
 */

export const OBSIDIAN_TOOL_NAMES = [
  'list_notes',
  'search_notes',
  'read_note',
  'create_note',
  'append_note',
  'update_note',
  'delete_note',
] as const

export type ObsidianToolName = (typeof OBSIDIAN_TOOL_NAMES)[number]

export const OBSIDIAN_LISTED_TOOLS: readonly ListedTool[] = [
  {
    name: 'list_notes',
    description:
      'List Markdown (.md) notes in the active Obsidian vault(s), sorted by most recently modified, with relative paths, modified timestamps, and tag counts.',
    inputSchema: {
      type: 'object',
      properties: {
        vault: {
          type: 'string',
          description: 'Optional vault name. Omit to list across all active vaults.',
        },
        folder: {
          type: 'string',
          description: 'Optional relative subfolder prefix inside the vault.',
        },
        tag: {
          type: 'string',
          description: 'Optional tag filter (with or without leading #).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of notes to return (default 50, max 200).',
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_notes',
    description:
      'Search Markdown (.md) notes in the active Obsidian vault(s) by title, path, body text, #tags, and YAML frontmatter.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords.',
        },
        vault: {
          type: 'string',
          description: 'Optional vault name. Omit to search across all active vaults.',
        },
        tag: {
          type: 'string',
          description: 'Optional tag filter (with or without leading #).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum matching notes to return (default 20, max 50).',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_note',
    description:
      'Read a Markdown (.md) note from an Obsidian vault with redaction applied and [[wikilink]] targets resolved. Page large notes with offset.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the .md note inside the vault (e.g. "Projects/Alpha.md").',
        },
        vault: {
          type: 'string',
          description: 'Vault name (required when 2 or more vaults are active).',
        },
        offset: {
          type: 'integer',
          description: 'Character offset to start reading from (default 0).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum characters to return (default 12000, max 30000).',
        },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_note',
    description:
      'Create a new Markdown (.md) note in an Obsidian vault. Refuses to overwrite an existing file; creates missing non-hidden subfolders inside the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path ending in .md inside the vault.',
        },
        content: {
          type: 'string',
          description: 'Markdown content of the new note.',
        },
        vault: {
          type: 'string',
          description: 'Vault name (required when 2 or more vaults are active).',
        },
      },
      required: ['path', 'content'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'append_note',
    description:
      'Append Markdown content to the end of an existing .md note, or under a specified Markdown heading. Refused if the note is currently open in an editor tab.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path ending in .md inside the vault.',
        },
        content: {
          type: 'string',
          description: 'Markdown text to append.',
        },
        heading: {
          type: 'string',
          description:
            'Optional heading text to insert under (before the next heading of same or higher level).',
        },
        vault: {
          type: 'string',
          description: 'Vault name (required when 2 or more vaults are active).',
        },
      },
      required: ['path', 'content'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'update_note',
    description:
      'Update an existing .md note by replacing the full content or a targeted old_text/new_text match. Refused if the note is currently open in an editor tab.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path ending in .md inside the vault.',
        },
        content: {
          type: 'string',
          description: 'Full replacement Markdown content (omit when using old_text/new_text).',
        },
        old_text: {
          type: 'string',
          description: 'Exact text to replace inside the note.',
        },
        new_text: {
          type: 'string',
          description: 'Replacement text for old_text.',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence of old_text instead of requiring a single match.',
        },
        vault: {
          type: 'string',
          description: 'Vault name (required when 2 or more vaults are active).',
        },
      },
      required: ['path'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'delete_note',
    description:
      'Move an existing .md note in an Obsidian vault to the OS trash. Never permanently unlinks. Refused if the note is currently open in an editor tab.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path ending in .md inside the vault.',
        },
        vault: {
          type: 'string',
          description: 'Vault name (required when 2 or more vaults are active).',
        },
      },
      required: ['path'],
    },
    annotations: { destructiveHint: true },
  },
]

/** Instructions surfaced to the model naming the enabled Obsidian vaults */
export function obsidianServerInstructions(activeVaults: readonly { name: string }[]): string {
  const names = activeVaults.map((v) => v.name).filter(Boolean)
  if (names.length === 0) return ''
  const multi =
    names.length > 1
      ? ' Multiple vaults are active: pass the `vault` argument for read_note, create_note, append_note, update_note, and delete_note.'
      : ''
  return (
    `Built-in local Obsidian vault connector. Only .md notes inside the user's vaults are accessible ` +
    `(hidden folders such as .obsidian are never accessed). Active vaults: ${names.join(', ')}.${multi}`
  )
}
