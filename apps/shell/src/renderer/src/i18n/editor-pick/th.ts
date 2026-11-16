import type { zh } from './zh'

export const th = {
  pickTitle: 'เลือกโปรแกรมแก้ไขที่จะใช้',
  pickBody:
    'ปิดโปรแกรมแก้ไขและ AI ที่ไม่ได้ใช้ แล้วสิ่งเหล่านั้นจะหายไปจากหน้าจอ เปลี่ยนได้ทุกเมื่อที่ การตั้งค่า → โปรแกรมแก้ไขและ AI',
  pickOneTimeTitle: 'เลือกโปรแกรมแก้ไขและ AI ที่จะใช้',
  pickOneTimeBody:
    'ตอนนี้คุณปิดโปรแกรมแก้ไขและ AI ที่ไม่ได้ใช้ได้แล้ว สิ่งที่ปิดจะหายไปจากหน้าจอ ส่วนเอกสารที่เปิดอยู่จะไม่ถูกปิด เปลี่ยนภายหลังได้ที่ การตั้งค่า → โปรแกรมแก้ไขและ AI',
  pickSave: 'บันทึก',
  pickClose: 'ปิด',
  pickEditorsLabel: 'โปรแกรมแก้ไข',
  pickAiName: 'ฟีเจอร์ AI',
  pickAiHint: 'แผง AI ปุ่ม AI และคำแนะนำการเชื่อมต่อ AI',
  pickLastEditor: 'ต้องเปิดโปรแกรมแก้ไขไว้อย่างน้อยหนึ่งรายการ',
  pickOpenDocs: 'มีเอกสารเปิดอยู่',
  pickDoneAiOff: 'ปิด AI แล้ว เปิดกลับได้ทุกเมื่อที่ การตั้งค่า → โปรแกรมแก้ไขและ AI',
  settingsTabName: 'โปรแกรมแก้ไขและ AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'เครื่องมือ PDF',
  itemPdfToolsHint: 'งาน PDF เช่น รวม แยก และบีบอัด',
  itemMarkdown: 'Markdown และข้อความ',
  itemHtml: 'HTML',
  itemMindmap: 'แผนที่ความคิด',
  itemDiagram: 'ไดอะแกรม',
  itemHwp: 'HWP (ฮันกึล)',
  itemEpub: 'อีบุ๊ก (EPUB)',
} satisfies Record<keyof typeof zh, string>
