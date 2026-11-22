import type { zh } from './zh'

export const ms = {
  actMcpTool: 'Alat MCP',
  permMcpTool: 'Guna alat “{tool}” pelayan {server}',
  permAllowToolSession: 'Sentiasa benarkan alat ini untuk sesi ini',
  mcpKeepInsideWarning:
    'Dalam tetingkap ini, kandungan yang diterima daripada {server} boleh keluar dari PC ini.',
  mcpExternalVaultWarning:
    'Sesi ini boleh membaca dan menyunting nota di luar folder projek melalui peti Obsidian bersambung: {vaults}.',
} satisfies Record<keyof typeof zh, string>
