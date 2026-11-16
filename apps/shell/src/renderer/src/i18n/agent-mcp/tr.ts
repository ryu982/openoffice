import type { zh } from './zh'

export const tr = {
  actMcpTool: 'MCP aracı',
  permMcpTool: '{server} sunucusunun “{tool}” aracını kullan',
  permAllowToolSession: 'Bu oturum boyunca bu araca her zaman izin ver',
  mcpKeepInsideWarning: 'Bu pencerede {server} sunucusundan gelen içerik dışarı gönderilebilir.',
} satisfies Record<keyof typeof zh, string>
