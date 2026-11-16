import type { zh } from './zh'

export const tr = {
  setSlidesFonts: 'AI slayt yazı tipleri',
  setSlidesFontsDesc:
    'İsteğiniz yazı tipi belirtmediğinde AI’ın yeni bir sunu için kullandığı yazı tipleri. Seçtiğiniz bir tasarım şablonu kendi yazı tiplerini kullanır.',
  slidesFontModeAuto: 'Otomatik',
  slidesFontModeAutoDesc: 'AI seçer',
  slidesFontModeSans: 'Tırnaksız',
  slidesFontModeSerif: 'Tırnaklı',
  slidesFontModeSerifTitle: 'Tırnaklı başlıklar',
  slidesFontSampleTitle: 'Başlık Aa',
  slidesFontSampleBody: 'Gövde Aa',
  setSlidesFontSans: 'Tırnaksız yazı tipi',
  setSlidesFontSerif: 'Tırnaklı yazı tipi',
  slidesFontGroupSuggested: 'Önerilen yazı tipleri',
  slidesFontGroupPc: 'Bu bilgisayardaki yazı tipleri',
  slidesFontPortableHint:
    'Bu yazı tipi olmayan bir bilgisayardaki PowerPoint onun yerine başka bir yazı tipi gösterir. Dışa aktarılan PDF’ler onu korur.',
} satisfies Record<keyof typeof zh, string>
