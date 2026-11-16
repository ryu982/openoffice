import type { zh } from './zh'

export const de = {
  pickTitle: 'Editoren auswählen',
  pickBody:
    'Schalten Sie Editoren und KI aus, die Sie nicht nutzen – sie verschwinden dann vom Bildschirm. Sie können das jederzeit unter Einstellungen → Editoren und KI ändern.',
  pickOneTimeTitle: 'Editoren und KI auswählen',
  pickOneTimeBody:
    'Sie können jetzt Editoren und KI ausschalten, die Sie nicht nutzen. Was Sie ausschalten, verschwindet vom Bildschirm; geöffnete Dokumente bleiben geöffnet. Sie können das später unter Einstellungen → Editoren und KI ändern.',
  pickSave: 'Speichern',
  pickClose: 'Schließen',
  pickEditorsLabel: 'Editoren',
  pickAiName: 'KI-Funktionen',
  pickAiHint: 'KI-Bereiche, KI-Schaltflächen und Hinweise zum Verbinden einer KI',
  pickLastEditor: 'Mindestens ein Editor muss eingeschaltet bleiben.',
  pickOpenDocs: 'Dokumente geöffnet',
  pickDoneAiOff:
    'Die KI ist ausgeschaltet. Sie können sie jederzeit unter Einstellungen → Editoren und KI wieder einschalten.',
  settingsTabName: 'Editoren und KI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF-Werkzeuge',
  itemPdfToolsHint: 'PDF-Aufgaben wie Zusammenführen, Teilen und Komprimieren',
  itemMarkdown: 'Markdown und Text',
  itemHtml: 'HTML',
  itemMindmap: 'Mindmap',
  itemDiagram: 'Diagramm',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'E-Book (EPUB)',
} satisfies Record<keyof typeof zh, string>
