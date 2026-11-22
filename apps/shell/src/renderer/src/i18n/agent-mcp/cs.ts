import type { zh } from './zh'

export const cs = {
  actMcpTool: 'Nástroj MCP',
  permMcpTool: 'Použít nástroj „{tool}“ serveru {server}',
  permAllowToolSession: 'V této relaci tento nástroj vždy povolit',
  mcpKeepInsideWarning:
    'V tomto okně může obsah přijatý ze serveru {server} opustit tento počítač.',
  mcpExternalVaultWarning:
    'Tato relace může číst a upravovat poznámky mimo složku projektu přes připojené trezory Obsidian: {vaults}.',
} satisfies Record<keyof typeof zh, string>
