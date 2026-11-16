import type { zh } from './zh'

export const hi = {
  item_docs: 'Word संपादक',
  item_sheets: 'Excel संपादक',
  item_slides: 'PowerPoint संपादक',
  item_pdf: 'PDF संपादक',
  item_pdfTools: 'PDF टूल',
  item_markdown: 'Markdown और टेक्स्ट संपादक',
  item_html: 'HTML संपादक',
  item_mindmap: 'माइंड मैप संपादक',
  item_diagram: 'आरेख संपादक',
  item_hwp: 'हंगुल (HWP) संपादक',
  item_epub: 'EPUB संपादक',
  offMessage: '{item} बंद है। चालू करके खोलें?',
  offDetailFiles: 'इससे {count} फ़ाइलें खुलेंगी।',
  turnOnAndOpen: 'चालू करें और खोलें',
  fileOnly: 'केवल फ़ाइल बनाएँ',
  cancel: 'रद्द करें',
  aiOffSkillMessage: 'AI बंद है। AI चालू करके कौशल आयात करें?',
  aiOnAndImport: 'AI चालू करें और आयात करें',
  fileOnlyDetail: 'केवल फ़ाइल बनाएँ: एडिटर बंद रहेगा और नई फ़ाइल उसके फ़ोल्डर में दिखाई जाएगी।',
  entranceDetail: 'इस सुविधा के लिए {item} चालू होना चाहिए।',
  genAiOffConvert: 'AI बंद है: केवल AI के बिना होने वाले रूपांतरण उपलब्ध हैं।',
  genAiOffNoConversion:
    'AI बंद है। AI के बिना रूपांतरण के लिए केवल एक माइंड मैप या Markdown फ़ाइल जोड़ें।',
} satisfies Record<keyof typeof zh, string>
