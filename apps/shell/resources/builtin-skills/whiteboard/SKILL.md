---
name: whiteboard
description: 'Build and organize visual whiteboards: structure ideas with sticky notes, shapes, tables, connectors, and declarative stack/grid templates, keep generous spacing and clear hierarchy, and verify the resulting layout. Use for brainstorming boards, workshops, affinity maps, storyboards, retrospectives, and annotated visual layouts.'
metadata:
  ieum-editors: whiteboard
---

# Designing a whiteboard

A whiteboard turns messy ideas into a scannable spatial layout: columns, zones, sticky clusters, tables, and clear connections. Use this skill to pick the right visual structure and keep every board legible.

The tool names below are those of the whiteboard editor's AI panel.

## 1. Tools and operations

- Read pages and objects: `read_board`
- Atomic object and page edits: `edit_board`
  - Operations: `add`, `update`, `move`, `delete`, `add_page`, `rename_page`, `delete_page`, `set_page_format`
  - Page formats (`PageFormat`): `freeform`, `wide_16_9`, `a4_portrait`, `a4_landscape`, `custom`
  - Object kinds (`ObjectKind`): `sticky`, `text`, `shape`, `connector`, `stroke`, `image`, `table`, `sticker`, `link`
  - Shape kinds (`ShapeKind`): `rectangle`, `rounded_rectangle`, `ellipse`, `triangle`, `diamond`, `star`, `speech_bubble`, `block_arrow`
- Declarative multi-block layout: `apply_template`
  - Top-level `TemplateDocument` (`schemaVersion: 1`, `target: 'new_pages' | 'current_page'`, `pageDefaults`, `pages`)
  - Layout containers: `stack` (`direction: 'vertical' | 'horizontal'`, `gap`, `padding`), `grid` (`columns`, `gap`, `padding`)
  - Block kinds: `title`, `card`, `zone`, `sticky`, `text`, `shape`, `connector`, `stroke`, `image`, `table`, `sticker`, `link` (with optional `frame` and `repeat`)
- Images: `search_images`, `insert_image`, `generate_image`

## 2. Choose the layout first

- **New structured board (retrospective, canvas, Kanban, workshop, SWOT, timeline)**: prefer `apply_template` with `stack` and `grid` containers so columns, zones, and cards align automatically without hand-computed pixel coordinates.
- **Incremental edits on an existing board**: use `edit_board` (`add`, `update`, `move`, `delete`). Omit `at`/`near` when adding new items so the engine places them in free space without overlap, or pass `near` relative to an existing object.
- **Multiple topics or phases**: split into pages with `add_page` rather than cramming dozens of unrelated notes onto one screen. Keep freeform pages for open brainstorming and `wide_16_9` / `a4_portrait` / `a4_landscape` for presentation or printable handouts.

## 3. Visual hygiene

- Keep sticky notes short (one idea per sticky, 1–3 lines) and use at most 3–4 pastel colors with a clear meaning per color.
- Use `zone` blocks or `stack`/`grid` columns to group related notes before connecting clusters with `connector` arrows.
- Keep labels concise so text does not overflow its shape or sticky card.
- When the board already has user drawings, strokes, or PDF page backgrounds, preserve them and place new additions in clear open areas unless asked to reorganize.

## 4. Verify before replying

Call `read_board` after major edits and confirm:
- No unintended overlaps between newly added objects.
- Every connector references valid object ids or coordinates.
- Page count, page titles, and section headings match the user's request.
- Summarize in one or two sentences what was added or changed.
