import type { zh } from './zh'

export const he = {
  pickTitle: 'בחירת העורכים שבשימוש',
  pickBody:
    'כבו את העורכים ואת ה-AI שאינכם משתמשים בהם, והם ייעלמו מהמסך. אפשר לשנות זאת בכל עת דרך הגדרות ← עורכים ו-AI.',
  pickOneTimeTitle: 'בחירת עורכים ו-AI',
  pickOneTimeBody:
    'עכשיו אפשר לכבות עורכים ו-AI שאינכם משתמשים בהם. מה שתכבו ייעלם מהמסך; מסמכים פתוחים יישארו פתוחים. אפשר לשנות זאת מאוחר יותר דרך הגדרות ← עורכים ו-AI.',
  pickSave: 'שמירה',
  pickClose: 'סגירה',
  pickEditorsLabel: 'עורכים',
  pickAiName: 'תכונות AI',
  pickAiHint: 'חלוניות AI, לחצני AI והנחיות לחיבור AI',
  pickLastEditor: 'לפחות עורך אחד צריך להישאר מופעל.',
  pickOpenDocs: 'יש מסמכים פתוחים',
  pickDoneAiOff: 'ה-AI כבוי. אפשר להפעיל אותו שוב בכל עת דרך הגדרות ← עורכים ו-AI.',
  settingsTabName: 'עורכים ו-AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'כלי PDF',
  itemPdfToolsHint: 'פעולות PDF כמו מיזוג, פיצול ודחיסה',
  itemMarkdown: 'Markdown וטקסט',
  itemHtml: 'HTML',
  itemMindmap: 'מפת חשיבה',
  itemDiagram: 'תרשים',
  itemHwp: 'HWP (האנגול)',
  itemEpub: 'ספר אלקטרוני (EPUB)',
} satisfies Record<keyof typeof zh, string>
