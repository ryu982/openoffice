import type { zh } from './zh'

export const ar = {
  item_docs: 'محرر Word',
  item_sheets: 'محرر Excel',
  item_slides: 'محرر PowerPoint',
  item_pdf: 'محرر PDF',
  item_pdfTools: 'أدوات PDF',
  item_markdown: 'محرر Markdown والنصوص',
  item_html: 'محرر HTML',
  item_mindmap: 'محرر الخرائط الذهنية',
  item_diagram: 'محرر المخططات',
  item_hwp: 'محرر الهانغول (HWP)',
  item_epub: 'محرر EPUB',
  offMessage: '{item} متوقف. هل تريد تشغيله والفتح؟',
  offDetailFiles: 'سيُفتح به {count} من الملفات.',
  turnOnAndOpen: 'تشغيل وفتح',
  fileOnly: 'إنشاء الملف فقط',
  cancel: 'إلغاء',
  aiOffSkillMessage: 'الذكاء الاصطناعي متوقف. هل تريد تشغيله واستيراد المهارة؟',
  aiOnAndImport: 'تشغيل الذكاء الاصطناعي والاستيراد',
  fileOnlyDetail: 'إنشاء الملف فقط: يبقى المحرر متوقفًا ويُعرض الملف الجديد في مجلده.',
  entranceDetail: 'تحتاج هذه الميزة إلى تشغيل {item}.',
  genAiOffConvert: 'الذكاء الاصطناعي متوقف: تتوفر التحويلات التي لا تستخدم الذكاء الاصطناعي فقط.',
  genAiOffNoConversion:
    'الذكاء الاصطناعي متوقف. أضف ملف خريطة ذهنية أو ملف Markdown واحدًا فقط لتحويله دون ذكاء اصطناعي.',
} satisfies Record<keyof typeof zh, string>
