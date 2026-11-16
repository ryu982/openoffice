import type { zh } from './zh'

export const es = {
  sectionDesc:
    'Los editores desactivados desaparecen de las listas de documentos nuevos y, al abrir uno de sus archivos, se pregunta si activarlos. Los documentos ya abiertos siguen abiertos.',
  aiOffKeeps:
    'Desactivar la IA conserva tus inicios de sesión, claves, habilidades y ajustes; al volver a activarla, todo regresa. Los comandos de terminal y MCP siguen funcionando.',
  aiOffAsk: 'Tareas de IA en curso: {count}. ¿Detenerlas y desactivar la IA?',
  aiOffStop: 'Detener y desactivar',
  aiOffCancel: 'Cancelar',
  saveFailed: 'No se pudo cambiar. Inténtalo de nuevo.',
} satisfies Record<keyof typeof zh, string>
