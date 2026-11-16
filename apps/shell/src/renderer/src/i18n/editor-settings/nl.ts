import type { zh } from './zh'

export const nl = {
  sectionDesc:
    'Uitgeschakelde editors verdwijnen uit de lijsten met nieuwe documenten; bij het openen van een van hun bestanden wordt gevraagd of de editor aan moet. Geopende documenten blijven open.',
  aiOffKeeps:
    'AI uitschakelen bewaart je aanmeldingen, sleutels, skills en instellingen; zet je het weer aan, dan is alles terug. Terminalopdrachten en MCP blijven werken.',
  aiOffAsk: 'Lopende AI-taken: {count}. Stoppen en AI uitschakelen?',
  aiOffStop: 'Stoppen en uitschakelen',
  aiOffCancel: 'Annuleren',
  saveFailed: 'Wijzigen is mislukt. Probeer het opnieuw.',
} satisfies Record<keyof typeof zh, string>
