# Whiteboard: brainstorming, sketching and annotating

The whiteboard editor opens `.whiteboard` files in a tab. You can arrange sticky notes, text, shapes, connectors, tables, stickers, pictures, link cards and freehand pen strokes on either infinite freeform boards or fixed pages, bring in PDF pages as backgrounds, export as pictures or PDF, and work with the AI panel. Everything runs locally on your PC.

## Opening and creating

- A new board starts as a freeform infinite board from the **Whiteboard** tile on Home or from New in the File menu.
- The editor opens `.whiteboard` files from the open dialog, by dragging onto the window, from recent files, the folder tree, Quick Look (Space), or Google Drive. On Windows, installing GenOffice registers it as the default program for `.whiteboard`.
- Excalidraw files (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) open as a new, untitled whiteboard. The original file is never overwritten, closing without edits does not prompt to save, and the first save offers a `.whiteboard` file in the same folder. Unsupported elements such as web embeds are skipped and their count is shown in a banner. On Windows, `.excalidraw` is offered under "Open with" only.
- If a whiteboard is already open, opening it again brings its tab to the front.

## Editing and tools

- A single `.whiteboard` file can mix freeform boards and fixed pages (16:9 screen, A4 portrait, A4 landscape, or custom PDF page sizes) in the page rail.
- Tools include select, sticky note, rich text, eight shapes, connectors and arrows, pressure-sensitive pen, highlighter and eraser, image, table, built-in stickers and link cards.
- Drag a `.pdf` file onto an open whiteboard or choose **Import PDF** to turn chosen PDF pages into fixed background pages so you can sketch and place sticky notes on top. Opening a `.pdf` from Home or the File menu still opens it in the PDF editor.
- Press F5 or click **Present** to show the board full-screen and step through pages with the arrow keys.
- In the dark theme, toolbars, panels and the backdrop outside the page turn dark, while the paper, sticky notes, shapes and ink stay in their original document colors.

## Saving, exporting and printing

- Save, Save As, AutoSave, crash recovery copies and split-view save conflict checks work like the other editors. If nothing changed, the file is not rewritten.
- Export to PNG, SVG or PDF for **All pages** or **Current page only**. On a freeform board, export and printing fit all objects on the board with a margin (or the default starting area when empty).
- Print (Ctrl+P) supports both standard printing and multi-page layout options. Exports and printouts are identical in light and dark themes.

## AI panel

- Ask the AI to organize sticky notes, lay out a workshop or retrospective template, add shapes, connectors, tables or images, or summarize the board.
- The AI receives a structured text table of the board and, when the selected model supports images, automatically attaches a picture of the current page. Text-only models run using the text table alone.
- Every AI edit call is one undo step (Ctrl+Z), highlights changed objects on screen without altering the saved file, and provides **Undo these changes** on the reply card.
- `.whiteboard` files can be attached in other editors' AI panels, mentioned with `@`, searched on Home, used in **Make from document** (including AI-free conversion to Markdown), and handled from the [terminal commands](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Internet use and link cards

- Opening, editing, exporting, printing, importing Excalidraw files and importing PDF pages send nothing to the internet.
- Clicking a link card opens `http`, `https` or `mailto` addresses in your default browser.
- Only when you explicitly turn on **Fetch title and preview image** while adding or editing a link card does GenOffice connect once to that page and store the preview image inside the `.whiteboard` file.
