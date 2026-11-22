import type { zh } from './zh'

export const it = {
  actMcpTool: 'Strumento MCP',
  permMcpTool: 'Usa lo strumento “{tool}” del server {server}',
  permAllowToolSession: 'Consenti sempre questo strumento in questa sessione',
  mcpKeepInsideWarning:
    'In questa finestra, i contenuti ricevuti da {server} possono uscire da questo PC.',
  mcpExternalVaultWarning:
    'Questa sessione può leggere e modificare note fuori dalla cartella del progetto tramite i vault Obsidian connessi: {vaults}.',
} satisfies Record<keyof typeof zh, string>
