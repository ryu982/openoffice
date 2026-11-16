import type { zh } from './zh'

export const ja = {
  sectionDesc:
    'オフにしたエディターは新規作成の一覧から消え、その形式のファイルを開くときにオンにするか確認します。開いている文書は閉じません。',
  aiOffKeeps:
    'AI をオフにしても、ログイン・キー・スキル・設定は削除されず、オンに戻すとそのまま使えます。ターミナルコマンドと MCP は AI がオフでもそのまま動作します。',
  aiOffAsk: '実行中の AI 処理が {count} 件あります。停止して AI をオフにしますか？',
  aiOffStop: '停止してオフにする',
  aiOffCancel: 'キャンセル',
  saveFailed: '変更できませんでした。もう一度お試しください。',
} satisfies Record<keyof typeof zh, string>
