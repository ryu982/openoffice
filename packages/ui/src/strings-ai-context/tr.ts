import type { zh } from './zh'

export const tr = {
  contextConfirm:
    'Bu istek modelin bağlam sınırına çok yakın: {limit} tokenın yaklaşık {estimated} kadarı (%{percent}). Yine de gönderilsin mi?',
  contextUnknown: 'Modelin bağlam boyutu doğrulanamadı; {limit} token varsayıldı.',
  toolsUnsupported:
    'Bu model araç çağrılarını desteklemiyor. Yalnızca metin önerir ve belgeyi değiştirmez.',
  errContextLimit:
    'Hiçbir şey gönderilmedi: istek modelin bağlam sınırına çok yakın. İsteği daha küçük parçalara bölüp yeniden deneyin.',
} satisfies Record<keyof typeof zh, string>
