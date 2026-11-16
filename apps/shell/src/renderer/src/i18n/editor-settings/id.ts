import type { zh } from './zh'

export const id = {
  sectionDesc:
    'Editor yang dimatikan hilang dari daftar dokumen baru, dan saat membuka berkasnya akan ditanya apakah editor itu dinyalakan. Dokumen yang sudah terbuka tetap terbuka.',
  aiOffKeeps:
    'Mematikan AI tidak menghapus login, kunci, skill, dan pengaturan; saat dinyalakan lagi semuanya kembali. Perintah terminal dan MCP tetap berjalan.',
  aiOffAsk: 'Tugas AI yang berjalan: {count}. Hentikan dan matikan AI?',
  aiOffStop: 'Hentikan dan matikan',
  aiOffCancel: 'Batal',
  saveFailed: 'Gagal mengubah. Coba lagi.',
} satisfies Record<keyof typeof zh, string>
