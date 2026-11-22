import type { zh } from './zh'

export const pl = {
  actMcpTool: 'Narzędzie MCP',
  permMcpTool: 'Użyj narzędzia „{tool}” serwera {server}',
  permAllowToolSession: 'Zawsze zezwalaj na to narzędzie w tej sesji',
  mcpKeepInsideWarning: 'W tym oknie treść otrzymana z {server} może wyjść poza ten komputer.',
  mcpExternalVaultWarning:
    'Ta sesja może czytać i edytować notatki poza folderem projektu przez połączone skarbce Obsidian: {vaults}.',
} satisfies Record<keyof typeof zh, string>
