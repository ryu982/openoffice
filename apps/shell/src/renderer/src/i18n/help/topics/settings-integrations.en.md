# Settings, language, theme and MCP integrations

## Opening settings

The row at the bottom left of Home opens the settings panel (the line under it shows whether an AI is connected). It has five sections: Account, AI, General, Integrations and About.

You can also open it from any tab with **⌘,** (Ctrl+, on Windows and Linux), from **Settings…** in the app menu on a Mac (the menu named after the app, at the left of the menu bar), or from **Menu (☰) ▸ Settings…** on Windows and Linux. In a Word tab ⌘, (Ctrl+,) is subscript, so open it from the menu there.

**Account** shows where your Claude, ChatGPT and Codex connections stand, and **Manage connections** leads to the AI section. AI has its own articles: [Subscription connection](help://subscription) and [AI models and settings](help://ai-models).

## Language

- The settings offer **22 UI languages**: English, Simplified Chinese, Japanese, Korean, French, German, Spanish, Thai, Indonesian, Russian, Arabic, Portuguese, Italian, Polish, Czech, Dutch, Malay, Hebrew, Hindi, Traditional Chinese, Vietnamese, Turkish.
- Switching applies immediately and persists; the native menu bar rebuilds with the language.

## Theme

Light / Dark / System. System follows the OS appearance, and the editors re-skin in sync without flashing.

## General

- **AI sidebar position** (left or right), **AI panel text size**, and **Spell check in AI chat**.
- **AI panel** — Off, Collapsed, or Last state.
- **Auto-save all documents** turns AutoSave on by default in every editor; you can still switch it off for one window.
- **Save Location** with a **Change** button, and **Default app for Office documents** to claim .docx / .xlsx / .pptx for GenOffice.
- **Save format for new HWP documents** picks whether HWP or HWPX is offered first when you first save a new document. Documents you open keep their own format.
- **AI slide fonts** sets the fonts AI uses for a new presentation when your request names none. Pick Auto, Sans serif, Serif, or Serif titles, and change the sans-serif and serif font separately. A design template you choose uses its own fonts, and pages added to a presentation in other fonts follow that presentation.

GenOffice does not collect or send usage statistics, so there is no switch for it.

## Editors and AI

Here you choose which editors you use and whether to use AI. The same list also appears once in two other places: the **Choose your editors** step of the welcome screens on first launch, and a one-time window on the Home screen for people who used GenOffice before this setting existed. Everything starts turned on, so leaving it as it is changes nothing. A change applies at once in every open window.

- **Editors**: Word, Excel, PowerPoint, PDF, PDF tools, Markdown and text, HTML, Mind map, Diagram, HWP (Hangul) and E-book (EPUB). The PDF tools are switched separately from the PDF editor. At least one editor has to stay on.
- **An editor you turn off** leaves the new-document lists: the Home cards, the tab bar's **+** menu, File ▸ New and the default-app list. Documents that are already open stay open, and recovery copies are kept.
- **Opening a file of a turned-off editor** (double-click, drag and drop, File ▸ Open, recent files) asks you to choose **Turn on and open** or **Cancel**. Opening several of its files at once asks only once.
- **Other features that would open their result in a turned-off editor**, such as converting a PDF to that format, ask before they start: **Turn on and open**, **Create the file only** (the file is made and shown in its folder, and the editor stays off) or **Cancel**.
- **With AI features off**, the AI panels, AI buttons and menus, the Home ask panel, the agent window and the AI connection prompts disappear, and the Account, AI and Skills tabs leave Settings. GenOffice does not start an AI program from its screens. Sign-ins, keys, skills and settings are kept and come back when you turn AI on again. If AI work is still running, you are asked first whether to **Stop and turn off**.
- The command line, MCP and this guide work the same whether editors or AI are on or off.

With AI on, the AI still does not make new documents for an editor that is off; it tells you to turn that editor on here.

## AI ▸ Advanced

Closed until you open it; most people never need it. The **AI Model** tab holds API keys and servers you run yourself, for chat. On the **AI Media & Search** tab each capability picks the vendor that serves it, and a vendor's key and base URL are entered once and shared:

- **Web search**, **Image generation**, **Image analysis** and **Video analysis**, each with a provider, a model, a key and a base URL.
- **Local file search** runs on this machine. Under it, **Jev search reranking** is **off by default**. Switch it on and the excerpts of the top 20 local hits — up to 1,200 characters of each document, plus the file and folder names — go to the decision endpoint you pick (Jev via OpenRouter or TypeSafe, Perplexity, Liquid AI d1, Cloudflare, a local engine, or a custom URL) to be reordered by relevance. With it off, nothing leaves the device.
- **Let automatic requests use a subscription** is **off by default**. It decides whether a request from the command line or from a connected coding agent may use your Claude or Codex subscription; see [Connecting a coding agent](help://mcp).

## About

- **Version**, the project's GitHub address, and a line naming the open-source project this app is based on.
- **Update Channel**: Stable or Beta. Changing it takes effect at once and checks for an update; it will not downgrade a Beta install back to Stable.

## Default app bindings

Settings can register GenOffice as the handler for .docx / .xlsx / .pptx / .pdf and friends (platform-level default-app registration; confirm when prompted).

## Third-party notices and updates

- Help ▸ Third-party notices: the full OSS license inventory shipped with the app.
- Menu (☰) ▸ Check for updates (Help ▸ Check for updates on a Mac): triggers a manual check; a newer version prompts to install. On a Mac the app menu has it too, right under About.

## MCP integration (for advanced users / AI clients)

**Integrations** is the pane that connects GenOffice to a coding agent, and it has its own article: Connecting a coding agent. The short version — pick a route (the command line, or MCP), follow that section, then start a new chat and ask.

Under **Local HTTP server** the app can run the server itself — an enable switch, a port — and **Advanced** adds the health-check URL and the log file. It listens on localhost only.

## Command-line cheat sheet

| Command             | What it does               |
| ------------------- | -------------------------- |
| `ieumoffice <file>` | open a file                |
| `ieumoffice mcp`    | start the local MCP server |
| `ieumoffice --help` | every command and flag     |
