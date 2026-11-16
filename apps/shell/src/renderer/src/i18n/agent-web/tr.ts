import type { zh } from './zh'

export const tr = {
  actWebSearch: 'Web’de arama',
  actWebFetch: 'Web sayfası oku',
  permWebSearch: 'Web’de arama yap',
  permWebFetch: 'Bu web sayfasını oku',
  permAllowSearchSession: 'Bu oturumda aramalara izin ver',
  permAllowSiteSession: 'Bu oturumda bu siteye izin ver',
  codexWebLabel: 'Web’de arama',
  codexWebCached: 'Kayıtlı sonuçlar',
  codexWebLive: 'Canlı',
  codexWebDisabled: 'Kapalı',
  codexWebNote:
    'Kayıtlı sonuçlar önceden toplanmış web içeriğinden gelir; Canlı, web’i şu andaki haliyle arar.',
  codexNetworkLabel: 'Komutlar için internet erişimi',
  codexNetworkOff: 'Kapalı',
  codexNetworkOn: 'Açık',
  codexNetworkWarning:
    'Açıldığında Codex’in çalıştırdığı komutlar internete erişebilir. “Bu projeye güven” seçiliyse sormadan erişirler. Aldığınız bir belgedeki gizli yönergeler, verilerinizin dışarı gönderilmesine yol açabilir.',
  codexFolderNote: 'Bu iki ayar her proje klasörü için ayrı ayrı hatırlanır.',
  providerCodexNoteWeb:
    'Komutlar Codex’in yalıtılmış alanında çalışır: yalnızca proje klasörüne yazılabilir ve siz açmadıkça internet erişimi yoktur.',
} satisfies Record<keyof typeof zh, string>
