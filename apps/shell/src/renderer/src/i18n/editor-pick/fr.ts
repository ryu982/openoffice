import type { zh } from './zh'

export const fr = {
  pickTitle: 'Choisissez vos éditeurs',
  pickBody:
    'Désactivez les éditeurs et l’IA que vous n’utilisez pas : ils disparaissent de l’écran. Vous pouvez changer cela à tout moment dans Paramètres → Éditeurs et IA.',
  pickOneTimeTitle: 'Choisissez vos éditeurs et l’IA',
  pickOneTimeBody:
    'Vous pouvez désormais désactiver les éditeurs et l’IA que vous n’utilisez pas. Ce que vous désactivez disparaît de l’écran ; les documents ouverts restent ouverts. Vous pourrez changer cela plus tard dans Paramètres → Éditeurs et IA.',
  pickSave: 'Enregistrer',
  pickClose: 'Fermer',
  pickEditorsLabel: 'Éditeurs',
  pickAiName: 'Fonctions d’IA',
  pickAiHint: 'Panneaux IA, boutons IA et invitations à connecter une IA',
  pickLastEditor: 'Au moins un éditeur doit rester activé.',
  pickOpenDocs: 'Documents ouverts',
  pickDoneAiOff:
    'L’IA est désactivée. Vous pouvez la réactiver à tout moment dans Paramètres → Éditeurs et IA.',
  settingsTabName: 'Éditeurs et IA',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Outils PDF',
  itemPdfToolsHint: 'Tâches PDF comme fusionner, scinder ou compresser',
  itemMarkdown: 'Markdown et texte',
  itemHtml: 'HTML',
  itemMindmap: 'Carte mentale',
  itemDiagram: 'Diagramme',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'Livre numérique (EPUB)',
} satisfies Record<keyof typeof zh, string>
