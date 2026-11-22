import type { zh } from './zh'

export const fr = {
  actMcpTool: 'Outil MCP',
  permMcpTool: 'Utiliser l’outil « {tool} » du serveur {server}',
  permAllowToolSession: 'Toujours autoriser cet outil pendant cette session',
  mcpKeepInsideWarning: 'Dans cette fenêtre, le contenu reçu de {server} peut sortir de ce PC.',
  mcpExternalVaultWarning:
    'Cette session peut lire et modifier des notes en dehors du dossier du projet via les coffres Obsidian connectés : {vaults}.',
} satisfies Record<keyof typeof zh, string>
