import type { zh } from './zh'

export const hi = {
  pickTitle: 'इस्तेमाल होने वाले एडिटर चुनें',
  pickBody:
    'जिन एडिटर और AI का आप इस्तेमाल नहीं करते, उन्हें बंद करें — वे स्क्रीन से हट जाएँगे। इसे कभी भी सेटिंग्स → एडिटर और AI में बदला जा सकता है।',
  pickOneTimeTitle: 'एडिटर और AI चुनें',
  pickOneTimeBody:
    'अब आप उन एडिटर और AI को बंद कर सकते हैं जिनका आप इस्तेमाल नहीं करते। बंद की गई चीज़ें स्क्रीन से हट जाती हैं; खुले दस्तावेज़ खुले ही रहते हैं। इसे बाद में सेटिंग्स → एडिटर और AI में बदला जा सकता है।',
  pickSave: 'सहेजें',
  pickClose: 'बंद करें',
  pickEditorsLabel: 'एडिटर',
  pickAiName: 'AI सुविधाएँ',
  pickAiHint: 'AI पैनल, AI बटन और AI कनेक्ट करने के संकेत',
  pickLastEditor: 'कम से कम एक एडिटर चालू रहना चाहिए।',
  pickOpenDocs: 'दस्तावेज़ खुले हैं',
  pickDoneAiOff: 'AI बंद है। इसे कभी भी सेटिंग्स → एडिटर और AI में फिर से चालू कर सकते हैं।',
  settingsTabName: 'एडिटर और AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF टूल',
  itemPdfToolsHint: 'PDF के काम, जैसे जोड़ना, बाँटना और छोटा करना',
  itemMarkdown: 'Markdown और टेक्स्ट',
  itemHtml: 'HTML',
  itemMindmap: 'माइंड मैप',
  itemDiagram: 'आरेख',
  itemHwp: 'HWP (हांगुल)',
  itemEpub: 'ई-बुक (EPUB)',
} satisfies Record<keyof typeof zh, string>
