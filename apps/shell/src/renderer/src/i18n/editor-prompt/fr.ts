import type { zh } from './zh'

export const fr = {
  item_docs: 'Éditeur Word',
  item_sheets: 'Éditeur Excel',
  item_slides: 'Éditeur PowerPoint',
  item_pdf: 'Éditeur PDF',
  item_pdfTools: 'Outils PDF',
  item_markdown: 'Éditeur Markdown et texte',
  item_html: 'Éditeur HTML',
  item_mindmap: 'Éditeur de cartes mentales',
  item_diagram: 'Éditeur de diagrammes',
  item_hwp: 'Éditeur Hangul (HWP)',
  item_epub: 'Éditeur EPUB',
  offMessage: '{item} est désactivé. L’activer et ouvrir ?',
  offDetailFiles: '{count} fichiers s’ouvriront avec lui.',
  turnOnAndOpen: 'Activer et ouvrir',
  fileOnly: 'Créer seulement le fichier',
  cancel: 'Annuler',
  aiOffSkillMessage: 'L’IA est désactivée. Activer l’IA et importer la compétence ?',
  aiOnAndImport: 'Activer l’IA et importer',
  fileOnlyDetail:
    'Créer le fichier seulement : l’éditeur reste désactivé et le nouveau fichier est affiché dans son dossier.',
  entranceDetail: 'Cette fonction nécessite que l’{item} soit activé.',
  genAiOffConvert: 'L’IA est désactivée : seules les conversions sans IA sont disponibles.',
  genAiOffNoConversion:
    'L’IA est désactivée. Ajoutez une seule carte mentale ou un seul fichier Markdown pour le convertir sans IA.',
} satisfies Record<keyof typeof zh, string>
