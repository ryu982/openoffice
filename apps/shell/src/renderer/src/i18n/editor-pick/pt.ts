import type { zh } from './zh'

export const pt = {
  pickTitle: 'Escolha seus editores',
  pickBody:
    'Desative os editores e a IA que você não usa e eles saem da tela. Você pode mudar isso a qualquer momento em Configurações → Editores e IA.',
  pickOneTimeTitle: 'Escolha seus editores e a IA',
  pickOneTimeBody:
    'Agora você pode desativar os editores e a IA que não usa. O que for desativado sai da tela; os documentos abertos continuam abertos. Você pode mudar isso depois em Configurações → Editores e IA.',
  pickSave: 'Salvar',
  pickClose: 'Fechar',
  pickEditorsLabel: 'Editores',
  pickAiName: 'Recursos de IA',
  pickAiHint: 'Painéis de IA, botões de IA e avisos para conectar uma IA',
  pickLastEditor: 'Pelo menos um editor precisa ficar ativado.',
  pickOpenDocs: 'Há documentos abertos',
  pickDoneAiOff:
    'A IA está desativada. Você pode reativá-la a qualquer momento em Configurações → Editores e IA.',
  settingsTabName: 'Editores e IA',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Ferramentas de PDF',
  itemPdfToolsHint: 'Tarefas de PDF como juntar, dividir e compactar',
  itemMarkdown: 'Markdown e texto',
  itemHtml: 'HTML',
  itemMindmap: 'Mapa mental',
  itemDiagram: 'Diagrama',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'Livro digital (EPUB)',
} satisfies Record<keyof typeof zh, string>
