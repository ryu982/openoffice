import type { zh } from './zh'

export const tr = {
  sectionDesc:
    'Kapattığınız düzenleyiciler yeni belge listelerinden çıkar; dosyalarından birini açarken düzenleyicinin açılıp açılmayacağı sorulur. Açık belgeler açık kalır.',
  aiOffKeeps:
    'AI’yi kapatmak oturumları, anahtarları, becerileri ve ayarları silmez; yeniden açınca her şey geri gelir. Terminal komutları ve MCP çalışmaya devam eder.',
  aiOffAsk: 'Çalışan AI işleri: {count}. Durdurup AI’yi kapatalım mı?',
  aiOffStop: 'Durdur ve kapat',
  aiOffCancel: 'İptal',
  saveFailed: 'Değiştirilemedi. Yeniden deneyin.',
} satisfies Record<keyof typeof zh, string>
