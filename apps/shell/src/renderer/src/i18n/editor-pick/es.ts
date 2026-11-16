import type { zh } from './zh'

export const es = {
  pickTitle: 'Elige tus editores',
  pickBody:
    'Desactiva los editores y la IA que no uses y desaparecerán de la pantalla. Puedes cambiarlo cuando quieras en Configuración → Editores e IA.',
  pickOneTimeTitle: 'Elige tus editores y la IA',
  pickOneTimeBody:
    'Ahora puedes desactivar los editores y la IA que no uses. Lo que desactives desaparece de la pantalla; los documentos abiertos siguen abiertos. Puedes cambiarlo más tarde en Configuración → Editores e IA.',
  pickSave: 'Guardar',
  pickClose: 'Cerrar',
  pickEditorsLabel: 'Editores',
  pickAiName: 'Funciones de IA',
  pickAiHint: 'Paneles de IA, botones de IA y avisos para conectar una IA',
  pickLastEditor: 'Al menos un editor debe seguir activado.',
  pickOpenDocs: 'Documentos abiertos',
  pickDoneAiOff:
    'La IA está desactivada. Puedes volver a activarla cuando quieras en Configuración → Editores e IA.',
  settingsTabName: 'Editores e IA',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Herramientas PDF',
  itemPdfToolsHint: 'Tareas de PDF como unir, dividir y comprimir',
  itemMarkdown: 'Markdown y texto',
  itemHtml: 'HTML',
  itemMindmap: 'Mapa mental',
  itemDiagram: 'Diagrama',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'Libro electrónico (EPUB)',
} satisfies Record<keyof typeof zh, string>
