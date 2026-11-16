import type { zh } from './zh'

export const ar = {
  pickTitle: 'اختر المحررات التي تستخدمها',
  pickBody:
    'أوقف المحررات والذكاء الاصطناعي الذي لا تستخدمه فيختفي من الشاشة. يمكنك تغيير ذلك في أي وقت من الإعدادات ← المحررات والذكاء الاصطناعي.',
  pickOneTimeTitle: 'اختر المحررات والذكاء الاصطناعي',
  pickOneTimeBody:
    'يمكنك الآن إيقاف المحررات والذكاء الاصطناعي الذي لا تستخدمه. ما توقفه يختفي من الشاشة، أما المستندات المفتوحة فتبقى مفتوحة. يمكنك تغيير ذلك لاحقًا من الإعدادات ← المحررات والذكاء الاصطناعي.',
  pickSave: 'حفظ',
  pickClose: 'إغلاق',
  pickEditorsLabel: 'المحررات',
  pickAiName: 'ميزات الذكاء الاصطناعي',
  pickAiHint: 'لوحات الذكاء الاصطناعي وأزراره وإرشادات ربطه',
  pickLastEditor: 'يجب أن يبقى محرر واحد على الأقل قيد التشغيل.',
  pickOpenDocs: 'توجد مستندات مفتوحة',
  pickDoneAiOff:
    'تم إيقاف الذكاء الاصطناعي. يمكنك تشغيله مجددًا في أي وقت من الإعدادات ← المحررات والذكاء الاصطناعي.',
  settingsTabName: 'المحررات والذكاء الاصطناعي',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'أدوات PDF',
  itemPdfToolsHint: 'مهام PDF مثل الدمج والتقسيم والضغط',
  itemMarkdown: 'Markdown والنصوص',
  itemHtml: 'HTML',
  itemMindmap: 'خريطة ذهنية',
  itemDiagram: 'مخطط',
  itemHwp: 'HWP (الهانغول)',
  itemEpub: 'كتاب إلكتروني (EPUB)',
} satisfies Record<keyof typeof zh, string>
