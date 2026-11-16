import type { zh } from './zh'

export const ru = {
  handTool: 'Инструмент «Рука»',
  handToolTip:
    'Когда включён, перетаскивание сдвигает вид страницы. Перетаскивание с зажатой средней кнопкой (колёсиком) сдвигает его в любой момент. H — включить или выключить, Esc — выключить.',
} satisfies Record<keyof typeof zh, string>
