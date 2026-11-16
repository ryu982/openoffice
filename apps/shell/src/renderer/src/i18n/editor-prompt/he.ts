import type { zh } from './zh'

export const he = {
  item_docs: 'עורך Word',
  item_sheets: 'עורך Excel',
  item_slides: 'עורך PowerPoint',
  item_pdf: 'עורך PDF',
  item_pdfTools: 'כלי PDF',
  item_markdown: 'עורך Markdown וטקסט',
  item_html: 'עורך HTML',
  item_mindmap: 'עורך מפות חשיבה',
  item_diagram: 'עורך תרשימים',
  item_hwp: 'עורך האנגול (HWP)',
  item_epub: 'עורך EPUB',
  offMessage: '{item} כבוי. להפעיל ולפתוח?',
  offDetailFiles: 'ייפתחו בו {count} קבצים.',
  turnOnAndOpen: 'הפעלה ופתיחה',
  fileOnly: 'יצירת הקובץ בלבד',
  cancel: 'ביטול',
  aiOffSkillMessage: 'הבינה המלאכותית כבויה. להפעיל אותה ולייבא את המיומנות?',
  aiOnAndImport: 'הפעלת AI וייבוא',
  fileOnlyDetail: 'יצירת הקובץ בלבד: העורך נשאר כבוי והקובץ החדש מוצג בתיקייה שלו.',
  entranceDetail: 'תכונה זו דורשת שה{item} יהיה מופעל.',
  genAiOffConvert: 'הבינה המלאכותית כבויה: זמינות רק המרות ללא בינה מלאכותית.',
  genAiOffNoConversion:
    'הבינה המלאכותית כבויה. הוסיפו קובץ מפת חשיבה או Markdown אחד בלבד כדי להמיר אותו ללא בינה מלאכותית.',
} satisfies Record<keyof typeof zh, string>
