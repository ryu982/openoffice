import type { zh } from './zh'

export const en = {
  pickTitle: 'Choose your editors',
  pickBody:
    'Turn off the editors and AI you do not use, and they leave the screen. You can change this anytime in Settings → Editors and AI.',
  pickOneTimeTitle: 'Choose your editors and AI',
  pickOneTimeBody:
    'You can now turn off the editors and AI you do not use. What you turn off leaves the screen; documents that are open stay open. You can change this later in Settings → Editors and AI.',
  pickSave: 'Save',
  pickClose: 'Close',
  pickEditorsLabel: 'Editors',
  pickAiName: 'AI features',
  pickAiHint: 'AI panels, AI buttons and AI connection prompts',
  pickLastEditor: 'At least one editor has to stay on.',
  pickOpenDocs: 'Documents open',
  pickDoneAiOff: 'AI is turned off. You can turn it back on anytime in Settings → Editors and AI.',
  settingsTabName: 'Editors and AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF tools',
  itemPdfToolsHint: 'PDF tasks such as merging, splitting and compressing',
  itemMarkdown: 'Markdown and text',
  itemHtml: 'HTML',
  itemMindmap: 'Mind map',
  itemDiagram: 'Diagram',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'E-book (EPUB)',
} satisfies Record<keyof typeof zh, string>
