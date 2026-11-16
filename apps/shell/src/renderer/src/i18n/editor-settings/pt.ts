import type { zh } from './zh'

export const pt = {
  sectionDesc:
    'Os editores desativados saem das listas de novos documentos e, ao abrir um arquivo deles, o app pergunta se deve ativá-los. Os documentos já abertos continuam abertos.',
  aiOffKeeps:
    'Desativar a IA mantém seus logins, chaves, habilidades e configurações; ao reativá-la, tudo volta. Os comandos de terminal e o MCP continuam funcionando.',
  aiOffAsk: 'Tarefas de IA em andamento: {count}. Parar e desativar a IA?',
  aiOffStop: 'Parar e desativar',
  aiOffCancel: 'Cancelar',
  saveFailed: 'Não foi possível alterar. Tente novamente.',
} satisfies Record<keyof typeof zh, string>
