import type { zh } from './zh'

export const ja = {
  actMcpTool: 'MCP ツール',
  permMcpTool: '{server} サーバーの「{tool}」ツールを使う',
  permAllowToolSession: 'このセッション中はこのツールを常に許可',
  mcpKeepInsideWarning:
    'このウィンドウでは、{server} から受け取った内容が外部に出る可能性があります。',
  mcpExternalVaultWarning:
    'このセッションでは、接続された Obsidian 保管庫（{vaults}）を通じてプロジェクトフォルダー外のノートを読み書きできます。',
} satisfies Record<keyof typeof zh, string>
