import type { zh } from './zh'

export const ms = {
  sectionDesc:
    'Editor yang dimatikan hilang daripada senarai dokumen baharu, dan apabila membuka failnya anda akan ditanya sama ada mahu menghidupkannya. Dokumen yang sudah dibuka kekal terbuka.',
  aiOffKeeps:
    'Mematikan AI tidak memadam log masuk, kunci, kemahiran dan tetapan; apabila dihidupkan semula semuanya kembali. Arahan terminal dan MCP terus berfungsi.',
  aiOffAsk: 'Tugas AI yang sedang berjalan: {count}. Hentikan dan matikan AI?',
  aiOffStop: 'Hentikan dan matikan',
  aiOffCancel: 'Batal',
  saveFailed: 'Gagal menukar. Cuba lagi.',
} satisfies Record<keyof typeof zh, string>
