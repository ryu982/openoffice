import type { zh } from './zh'

export const ar = {
  actMcpTool: 'أداة MCP',
  permMcpTool: 'استخدام الأداة “{tool}” من الخادم {server}',
  permAllowToolSession: 'السماح بهذه الأداة دائمًا في هذه الجلسة',
  mcpKeepInsideWarning: 'في هذه النافذة، قد يخرج المحتوى المستلم من {server} خارج هذا الحاسوب.',
  mcpExternalVaultWarning:
    'يمكن لهذه الجلسة قراءة الملاحظات وتعديلها خارج مجلد المشروع عبر خزائن Obsidian المتصلة: {vaults}.',
} satisfies Record<keyof typeof zh, string>
