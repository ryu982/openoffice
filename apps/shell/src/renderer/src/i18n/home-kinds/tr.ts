import type { zh } from './zh'

export const tr = {
  setHomeKinds: 'Giriş ekranındaki yeni belgeler',
  setHomeKindsDesc:
    'Kapattığınız türler Giriş ekranındaki yeni belge kartlarından ve Yeni menülerinden kalkar. Bu türdeki dosyalar yine eskisi gibi açılır.',
  homeKindUp: '{name} öğesini yukarı taşı',
  homeKindDown: '{name} öğesini aşağı taşı',
  homeKindsReset: 'İlk sırayı geri getir',
} satisfies Record<keyof typeof zh, string>
