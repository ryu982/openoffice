import type { zh } from './zh'

export const zhTW = {
  sectionDesc:
    '關閉的編輯器會從新增文件清單中消失，開啟該格式的檔案時會詢問是否開啟。已開啟的文件不會被關閉。',
  aiOffKeeps:
    '關閉 AI 不會刪除登入、金鑰、技能和設定，重新開啟後一切照舊。終端機指令和 MCP 在 AI 關閉時仍照常運作。',
  aiOffAsk: '有 {count} 個 AI 工作正在執行。要停止它們並關閉 AI 嗎？',
  aiOffStop: '停止並關閉',
  aiOffCancel: '取消',
  saveFailed: '無法變更，請再試一次。',
} satisfies Record<keyof typeof zh, string>
