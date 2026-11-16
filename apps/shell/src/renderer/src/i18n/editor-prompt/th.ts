import type { zh } from './zh'

export const th = {
  item_docs: 'ตัวแก้ไข Word',
  item_sheets: 'ตัวแก้ไข Excel',
  item_slides: 'ตัวแก้ไข PowerPoint',
  item_pdf: 'ตัวแก้ไข PDF',
  item_pdfTools: 'เครื่องมือ PDF',
  item_markdown: 'ตัวแก้ไข Markdown และข้อความ',
  item_html: 'ตัวแก้ไข HTML',
  item_mindmap: 'ตัวแก้ไขแผนที่ความคิด',
  item_diagram: 'ตัวแก้ไขไดอะแกรม',
  item_hwp: 'ตัวแก้ไขฮันกึล (HWP)',
  item_epub: 'ตัวแก้ไข EPUB',
  offMessage: '{item} ปิดอยู่ เปิดใช้แล้วเปิดไฟล์ไหม',
  offDetailFiles: 'มีไฟล์ {count} ไฟล์ที่จะเปิดด้วยตัวนี้',
  turnOnAndOpen: 'เปิดใช้และเปิด',
  fileOnly: 'สร้างไฟล์อย่างเดียว',
  cancel: 'ยกเลิก',
  aiOffSkillMessage: 'AI ปิดอยู่ เปิด AI แล้วนำเข้าสกิลไหม',
  aiOnAndImport: 'เปิด AI และนำเข้า',
  fileOnlyDetail: 'สร้างไฟล์อย่างเดียว: ตัวแก้ไขยังปิดอยู่ และจะแสดงไฟล์ใหม่ในโฟลเดอร์',
  entranceDetail: 'ต้องเปิด{item}ก่อนจึงจะใช้ฟังก์ชันนี้ได้',
  genAiOffConvert: 'AI ปิดอยู่: ใช้ได้เฉพาะการแปลงที่ไม่ใช้ AI',
  genAiOffNoConversion:
    'AI ปิดอยู่ เพิ่มไฟล์แผนผังความคิดหรือไฟล์ Markdown เพียงไฟล์เดียวเพื่อแปลงโดยไม่ใช้ AI',
} satisfies Record<keyof typeof zh, string>
