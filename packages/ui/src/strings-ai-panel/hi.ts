import type { zh } from './zh'

export const hi = {
  attachMenuLabel: 'अटैचमेंट जोड़ें',
  attachFromPc: 'कंप्यूटर से फ़ाइल संलग्न करें',
  attachFromDocs: 'GenOffice दस्तावेज़ों से संलग्न करें (@)',
  attachFromDrive: 'Google Drive से संलग्न करें',
  skillButtonLabel: 'कौशल खोलें (/)',
  noEnabledSkills: 'इस संपादक के लिए कोई कौशल सक्षम नहीं है।',
  scrollToBottom: 'नीचे स्क्रॉल करें',
  copyReply: 'उत्तर कॉपी करें',
  copiedReply: 'कॉपी किया गया',
  regenerateReply: 'फिर से बनाएँ',
  workingSteps: 'कार्य जारी है…',
  workedSteps: 'पूर्ण · {n} चरण',
  workedStepOne: 'पूर्ण · 1 चरण',
  hintSkill: '/ कौशल',
  hintDocMention: '@ दस्तावेज़ संलग्न करें',
} as const satisfies Record<keyof typeof zh, string>
