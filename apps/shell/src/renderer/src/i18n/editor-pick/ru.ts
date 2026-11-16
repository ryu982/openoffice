import type { zh } from './zh'

export const ru = {
  pickTitle: 'Выберите редакторы',
  pickBody:
    'Отключите редакторы и ИИ, которыми не пользуетесь, — они исчезнут с экрана. Изменить это можно в любой момент в разделе «Настройки → Редакторы и ИИ».',
  pickOneTimeTitle: 'Выберите редакторы и ИИ',
  pickOneTimeBody:
    'Теперь можно отключить редакторы и ИИ, которыми вы не пользуетесь. Отключённое исчезнет с экрана, а открытые документы останутся открытыми. Изменить выбор можно позже в разделе «Настройки → Редакторы и ИИ».',
  pickSave: 'Сохранить',
  pickClose: 'Закрыть',
  pickEditorsLabel: 'Редакторы',
  pickAiName: 'Функции ИИ',
  pickAiHint: 'Панели ИИ, кнопки ИИ и подсказки о подключении ИИ',
  pickLastEditor: 'Хотя бы один редактор должен оставаться включённым.',
  pickOpenDocs: 'Есть открытые документы',
  pickDoneAiOff:
    'ИИ отключён. Включить его снова можно в любой момент в разделе «Настройки → Редакторы и ИИ».',
  settingsTabName: 'Редакторы и ИИ',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Инструменты PDF',
  itemPdfToolsHint: 'Работа с PDF: объединение, разделение, сжатие',
  itemMarkdown: 'Markdown и текст',
  itemHtml: 'HTML',
  itemMindmap: 'Интеллект-карта',
  itemDiagram: 'Диаграмма',
  itemHwp: 'HWP (хангыль)',
  itemEpub: 'Электронная книга (EPUB)',
} satisfies Record<keyof typeof zh, string>
