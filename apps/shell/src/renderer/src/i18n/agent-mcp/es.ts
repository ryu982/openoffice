import type { zh } from './zh'

export const es = {
  actMcpTool: 'Herramienta MCP',
  permMcpTool: 'Usar la herramienta «{tool}» del servidor {server}',
  permAllowToolSession: 'Permitir siempre esta herramienta en esta sesión',
  mcpKeepInsideWarning:
    'En esta ventana, el contenido recibido de {server} puede salir de este PC.',
  mcpExternalVaultWarning:
    'Esta sesión puede leer y editar notas fuera de la carpeta del proyecto mediante las bóvedas de Obsidian conectadas: {vaults}.',
} satisfies Record<keyof typeof zh, string>
