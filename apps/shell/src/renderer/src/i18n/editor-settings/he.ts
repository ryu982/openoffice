import type { zh } from './zh'

export const he = {
  sectionDesc:
    'עורכים כבויים יוצאים מרשימות המסמכים החדשים, ובפתיחת קובץ שלהם תופיע שאלה אם להפעיל אותם. מסמכים פתוחים נשארים פתוחים.',
  aiOffKeeps:
    'כיבוי AI לא מוחק התחברויות, מפתחות, מיומנויות והגדרות; בהפעלה מחדש הכול חוזר. פקודות מסוף ו-MCP ממשיכים לעבוד.',
  aiOffAsk: 'משימות AI פועלות: {count}. לעצור אותן ולכבות את ה-AI?',
  aiOffStop: 'לעצור ולכבות',
  aiOffCancel: 'ביטול',
  saveFailed: 'השינוי נכשל. נסו שוב.',
} satisfies Record<keyof typeof zh, string>
