import type { Lang } from '@genoffice/i18n'

/** Labels of the card under an AI reply that changed the document (all editors share them). */
export interface AiChangesLabels {
  /** title of a run that changed the document, with how many places it touched */
  changedCount: (n: number) => string
  /** title where the editor cannot count the places */
  changed: string
  /** title once the run was taken back */
  reverted: string
  /** takes the marks of the changes off the document, keeps the changes */
  clearMarks: string
  /** the button that takes the whole run back */
  revert: string
  /** its tooltip when only this run goes back */
  revertTitle: string
  /** its tooltip when the later AI runs go back with it */
  revertLaterTitle: string
  /** tooltip of a change line that can be shown in the document */
  showChange: string
  /** the editor could not take the run back in one step */
  refused: string
  /** the run's undo point is gone (saved over, too old) */
  expired: string
  /** the run was taken back, but not all of it */
  partial: string
}

export const AI_CHANGES_LABELS: Record<Lang, AiChangesLabels> = {
  zh: {
    changedCount: (n) => `已修改文档 ${n} 处`,
    changed: '已修改文档',
    reverted: '已撤销',
    clearMarks: '清除标记',
    revert: '撤销这些修改',
    revertTitle: '撤销 AI 在这一轮所做的全部修改',
    revertLaterTitle: '撤销这一轮及其后各轮 AI 的修改',
    showChange: '在文档中查看此处',
    refused: '无法一次撤销这些修改。如果之后又编辑过文档，请使用编辑器自带的撤销（Ctrl+Z）。',
    expired: '这一轮已无法一次撤销。请使用编辑器自带的撤销（Ctrl+Z）。',
    partial: '有些修改未能撤销，请检查文档。',
  },
  en: {
    changedCount: (n) => `Changes made to the document: ${n}`,
    changed: 'Changes made to the document',
    reverted: 'Changes undone',
    clearMarks: 'Hide marks',
    revert: 'Undo these changes',
    revertTitle: 'Undo everything the AI changed in this turn',
    revertLaterTitle: 'Undo this turn and every AI turn after it',
    showChange: 'Show this place in the document',
    refused:
      'These changes could not be undone together. If the document was edited afterwards, use the editor’s own Undo (Ctrl+Z).',
    expired: 'This turn can no longer be undone in one step. Use the editor’s own Undo (Ctrl+Z).',
    partial: 'Some of these changes could not be undone. Please check the document.',
  },
  ja: {
    changedCount: (n) => `文書を ${n} か所変更しました`,
    changed: '文書を変更しました',
    reverted: '元に戻しました',
    clearMarks: '表示を消す',
    revert: '変更を元に戻す',
    revertTitle: 'このターンで AI が変更した内容をすべて元に戻します',
    revertLaterTitle: 'このターンとそれ以降の AI の変更をまとめて元に戻します',
    showChange: '文書内でこの場所を表示',
    refused:
      'まとめて元に戻せませんでした。その後に文書を編集した場合は、エディターの「元に戻す」（Ctrl+Z）を使ってください。',
    expired:
      'このターンはもうまとめて元に戻せません。エディターの「元に戻す」（Ctrl+Z）を使ってください。',
    partial: '一部の変更は元に戻せませんでした。文書を確認してください。',
  },
  ko: {
    changedCount: (n) => `문서 ${n}곳을 고쳤습니다`,
    changed: '문서를 고쳤습니다',
    reverted: '되돌렸습니다',
    clearMarks: '표시 지우기',
    revert: '되돌리기',
    revertTitle: 'AI가 이 차례에 고친 것을 모두 되돌립니다',
    revertLaterTitle: '이 차례와 그 뒤 AI 차례의 변경을 함께 되돌립니다',
    showChange: '문서에서 이 곳 보기',
    refused:
      '한꺼번에 되돌리지 못했습니다. 그 뒤에 문서를 고쳤다면 편집기의 실행 취소(Ctrl+Z)를 쓰세요.',
    expired: '이 차례는 이제 한꺼번에 되돌릴 수 없습니다. 편집기의 실행 취소(Ctrl+Z)를 쓰세요.',
    partial: '일부는 되돌리지 못했습니다. 문서를 확인해 주세요.',
  },
  fr: {
    changedCount: (n) => `Modifications apportées au document : ${n}`,
    changed: 'Modifications apportées au document',
    reverted: 'Modifications annulées',
    clearMarks: 'Masquer les marques',
    revert: 'Annuler ces modifications',
    revertTitle: 'Annuler tout ce que l’IA a modifié pendant ce tour',
    revertLaterTitle: 'Annuler ce tour et tous les tours de l’IA qui ont suivi',
    showChange: 'Afficher cet endroit dans le document',
    refused:
      'Ces modifications n’ont pas pu être annulées d’un coup. Si le document a été modifié depuis, utilisez l’annulation de l’éditeur (Ctrl+Z).',
    expired:
      'Ce tour ne peut plus être annulé d’un coup. Utilisez l’annulation de l’éditeur (Ctrl+Z).',
    partial: 'Certaines modifications n’ont pas pu être annulées. Vérifiez le document.',
  },
  de: {
    changedCount: (n) => `Änderungen am Dokument: ${n}`,
    changed: 'Änderungen am Dokument',
    reverted: 'Änderungen zurückgenommen',
    clearMarks: 'Markierungen ausblenden',
    revert: 'Diese Änderungen zurücknehmen',
    revertTitle: 'Alles zurücknehmen, was die KI in dieser Runde geändert hat',
    revertLaterTitle: 'Diese und alle späteren KI-Runden zurücknehmen',
    showChange: 'Diese Stelle im Dokument anzeigen',
    refused:
      'Diese Änderungen konnten nicht zusammen zurückgenommen werden. Wurde das Dokument danach bearbeitet, verwenden Sie „Rückgängig“ im Editor (Ctrl+Z).',
    expired:
      'Diese Runde lässt sich nicht mehr in einem Schritt zurücknehmen. Verwenden Sie „Rückgängig“ im Editor (Ctrl+Z).',
    partial:
      'Einige Änderungen konnten nicht zurückgenommen werden. Bitte prüfen Sie das Dokument.',
  },
  es: {
    changedCount: (n) => `Cambios hechos en el documento: ${n}`,
    changed: 'Cambios hechos en el documento',
    reverted: 'Cambios deshechos',
    clearMarks: 'Ocultar marcas',
    revert: 'Deshacer estos cambios',
    revertTitle: 'Deshacer todo lo que la IA cambió en este turno',
    revertLaterTitle: 'Deshacer este turno y todos los turnos de la IA posteriores',
    showChange: 'Mostrar este lugar en el documento',
    refused:
      'No se pudieron deshacer estos cambios de una vez. Si el documento se editó después, usa Deshacer del editor (Ctrl+Z).',
    expired: 'Este turno ya no se puede deshacer de una vez. Usa Deshacer del editor (Ctrl+Z).',
    partial: 'Algunos cambios no se pudieron deshacer. Revisa el documento.',
  },
  th: {
    changedCount: (n) => `แก้ไขเอกสาร ${n} แห่ง`,
    changed: 'แก้ไขเอกสารแล้ว',
    reverted: 'ยกเลิกการแก้ไขแล้ว',
    clearMarks: 'ซ่อนเครื่องหมาย',
    revert: 'ยกเลิกการแก้ไขเหล่านี้',
    revertTitle: 'ยกเลิกทุกอย่างที่ AI แก้ไขในรอบนี้',
    revertLaterTitle: 'ยกเลิกรอบนี้และทุกรอบของ AI หลังจากนั้น',
    showChange: 'แสดงตำแหน่งนี้ในเอกสาร',
    refused:
      'ไม่สามารถยกเลิกการแก้ไขเหล่านี้พร้อมกันได้ หากมีการแก้ไขเอกสารหลังจากนั้น ให้ใช้คำสั่งเลิกทำของตัวแก้ไข (Ctrl+Z)',
    expired: 'รอบนี้ไม่สามารถยกเลิกพร้อมกันได้อีกแล้ว ให้ใช้คำสั่งเลิกทำของตัวแก้ไข (Ctrl+Z)',
    partial: 'ยกเลิกการแก้ไขบางส่วนไม่ได้ โปรดตรวจสอบเอกสาร',
  },
  id: {
    changedCount: (n) => `Perubahan pada dokumen: ${n}`,
    changed: 'Perubahan pada dokumen',
    reverted: 'Perubahan dibatalkan',
    clearMarks: 'Sembunyikan tanda',
    revert: 'Batalkan perubahan ini',
    revertTitle: 'Batalkan semua yang diubah AI pada giliran ini',
    revertLaterTitle: 'Batalkan giliran ini dan semua giliran AI sesudahnya',
    showChange: 'Tampilkan tempat ini di dokumen',
    refused:
      'Perubahan ini tidak dapat dibatalkan sekaligus. Jika dokumen diedit setelahnya, gunakan Urungkan milik editor (Ctrl+Z).',
    expired:
      'Giliran ini tidak dapat lagi dibatalkan sekaligus. Gunakan Urungkan milik editor (Ctrl+Z).',
    partial: 'Sebagian perubahan tidak dapat dibatalkan. Periksa dokumen.',
  },
  ru: {
    changedCount: (n) => `Изменений в документе: ${n}`,
    changed: 'Изменения в документе',
    reverted: 'Изменения отменены',
    clearMarks: 'Скрыть отметки',
    revert: 'Отменить эти изменения',
    revertTitle: 'Отменить всё, что ИИ изменил в этом ходе',
    revertLaterTitle: 'Отменить этот ход и все последующие ходы ИИ',
    showChange: 'Показать это место в документе',
    refused:
      'Не удалось отменить эти изменения разом. Если документ после этого редактировался, используйте отмену в редакторе (Ctrl+Z).',
    expired: 'Этот ход больше нельзя отменить разом. Используйте отмену в редакторе (Ctrl+Z).',
    partial: 'Некоторые изменения не удалось отменить. Проверьте документ.',
  },
  ar: {
    changedCount: (n) => `عدد التغييرات في المستند: ${n}`,
    changed: 'تغييرات في المستند',
    reverted: 'تم التراجع عن التغييرات',
    clearMarks: 'إخفاء العلامات',
    revert: 'التراجع عن هذه التغييرات',
    revertTitle: 'التراجع عن كل ما غيّره الذكاء الاصطناعي في هذه الجولة',
    revertLaterTitle: 'التراجع عن هذه الجولة وكل جولات الذكاء الاصطناعي التي تلتها',
    showChange: 'إظهار هذا الموضع في المستند',
    refused:
      'تعذّر التراجع عن هذه التغييرات دفعة واحدة. إذا عُدّل المستند بعدها، فاستخدم أمر التراجع في المحرر (Ctrl+Z).',
    expired:
      'لم يعد ممكنًا التراجع عن هذه الجولة دفعة واحدة. استخدم أمر التراجع في المحرر (Ctrl+Z).',
    partial: 'تعذّر التراجع عن بعض التغييرات. يُرجى مراجعة المستند.',
  },
  pt: {
    changedCount: (n) => `Alterações feitas no documento: ${n}`,
    changed: 'Alterações feitas no documento',
    reverted: 'Alterações desfeitas',
    clearMarks: 'Ocultar marcas',
    revert: 'Desfazer estas alterações',
    revertTitle: 'Desfazer tudo o que a IA alterou nesta vez',
    revertLaterTitle: 'Desfazer esta vez e todas as vezes seguintes da IA',
    showChange: 'Mostrar este local no documento',
    refused:
      'Não foi possível desfazer estas alterações de uma vez. Se o documento foi editado depois, use o Desfazer do editor (Ctrl+Z).',
    expired: 'Esta vez já não pode ser desfeita de uma só vez. Use o Desfazer do editor (Ctrl+Z).',
    partial: 'Algumas alterações não puderam ser desfeitas. Verifique o documento.',
  },
  it: {
    changedCount: (n) => `Modifiche apportate al documento: ${n}`,
    changed: 'Modifiche apportate al documento',
    reverted: 'Modifiche annullate',
    clearMarks: 'Nascondi segni',
    revert: 'Annulla queste modifiche',
    revertTitle: 'Annulla tutto ciò che l’IA ha modificato in questo turno',
    revertLaterTitle: 'Annulla questo turno e tutti i turni dell’IA successivi',
    showChange: 'Mostra questo punto nel documento',
    refused:
      'Non è stato possibile annullare queste modifiche in un colpo solo. Se il documento è stato modificato in seguito, usa Annulla dell’editor (Ctrl+Z).',
    expired:
      'Questo turno non può più essere annullato in un colpo solo. Usa Annulla dell’editor (Ctrl+Z).',
    partial: 'Alcune modifiche non sono state annullate. Controlla il documento.',
  },
  pl: {
    changedCount: (n) => `Zmiany w dokumencie: ${n}`,
    changed: 'Zmiany w dokumencie',
    reverted: 'Zmiany cofnięte',
    clearMarks: 'Ukryj oznaczenia',
    revert: 'Cofnij te zmiany',
    revertTitle: 'Cofnij wszystko, co AI zmieniła w tej turze',
    revertLaterTitle: 'Cofnij tę turę i wszystkie późniejsze tury AI',
    showChange: 'Pokaż to miejsce w dokumencie',
    refused:
      'Nie udało się cofnąć tych zmian za jednym razem. Jeśli dokument był potem edytowany, użyj polecenia Cofnij w edytorze (Ctrl+Z).',
    expired:
      'Tej tury nie można już cofnąć za jednym razem. Użyj polecenia Cofnij w edytorze (Ctrl+Z).',
    partial: 'Części zmian nie udało się cofnąć. Sprawdź dokument.',
  },
  cs: {
    changedCount: (n) => `Změny v dokumentu: ${n}`,
    changed: 'Změny v dokumentu',
    reverted: 'Změny vráceny',
    clearMarks: 'Skrýt označení',
    revert: 'Vrátit tyto změny',
    revertTitle: 'Vrátit vše, co AI v tomto kole změnila',
    revertLaterTitle: 'Vrátit toto kolo a všechna pozdější kola AI',
    showChange: 'Zobrazit toto místo v dokumentu',
    refused:
      'Tyto změny se nepodařilo vrátit najednou. Pokud byl dokument poté upraven, použijte příkaz Zpět v editoru (Ctrl+Z).',
    expired: 'Toto kolo už nelze vrátit najednou. Použijte příkaz Zpět v editoru (Ctrl+Z).',
    partial: 'Některé změny se nepodařilo vrátit. Zkontrolujte dokument.',
  },
  nl: {
    changedCount: (n) => `Wijzigingen in het document: ${n}`,
    changed: 'Wijzigingen in het document',
    reverted: 'Wijzigingen ongedaan gemaakt',
    clearMarks: 'Markeringen verbergen',
    revert: 'Deze wijzigingen ongedaan maken',
    revertTitle: 'Alles ongedaan maken wat de AI in deze beurt heeft gewijzigd',
    revertLaterTitle: 'Deze beurt en alle latere AI-beurten ongedaan maken',
    showChange: 'Deze plaats in het document tonen',
    refused:
      'Deze wijzigingen konden niet in één keer ongedaan worden gemaakt. Is het document daarna bewerkt, gebruik dan Ongedaan maken van de editor (Ctrl+Z).',
    expired:
      'Deze beurt kan niet meer in één keer ongedaan worden gemaakt. Gebruik Ongedaan maken van de editor (Ctrl+Z).',
    partial: 'Sommige wijzigingen konden niet ongedaan worden gemaakt. Controleer het document.',
  },
  ms: {
    changedCount: (n) => `Perubahan pada dokumen: ${n}`,
    changed: 'Perubahan pada dokumen',
    reverted: 'Perubahan dibuat asal',
    clearMarks: 'Sembunyikan tanda',
    revert: 'Buat asal perubahan ini',
    revertTitle: 'Buat asal semua yang diubah AI pada giliran ini',
    revertLaterTitle: 'Buat asal giliran ini dan semua giliran AI selepasnya',
    showChange: 'Tunjukkan tempat ini dalam dokumen',
    refused:
      'Perubahan ini tidak dapat dibuat asal sekali gus. Jika dokumen disunting selepas itu, gunakan Buat Asal milik editor (Ctrl+Z).',
    expired:
      'Giliran ini tidak boleh lagi dibuat asal sekali gus. Gunakan Buat Asal milik editor (Ctrl+Z).',
    partial: 'Sebahagian perubahan tidak dapat dibuat asal. Sila semak dokumen.',
  },
  he: {
    changedCount: (n) => `שינויים במסמך: ${n}`,
    changed: 'שינויים במסמך',
    reverted: 'השינויים בוטלו',
    clearMarks: 'הסתר סימונים',
    revert: 'ביטול השינויים האלה',
    revertTitle: 'ביטול כל מה שה-AI שינה בסבב הזה',
    revertLaterTitle: 'ביטול הסבב הזה וכל סבבי ה-AI שאחריו',
    showChange: 'הצגת המקום הזה במסמך',
    refused:
      'לא ניתן היה לבטל את השינויים האלה בבת אחת. אם המסמך נערך לאחר מכן, השתמשו בביטול של העורך (Ctrl+Z).',
    expired: 'כבר אי אפשר לבטל את הסבב הזה בבת אחת. השתמשו בביטול של העורך (Ctrl+Z).',
    partial: 'חלק מהשינויים לא בוטלו. בדקו את המסמך.',
  },
  hi: {
    changedCount: (n) => `दस्तावेज़ में बदलाव: ${n}`,
    changed: 'दस्तावेज़ में बदलाव किए गए',
    reverted: 'बदलाव वापस लिए गए',
    clearMarks: 'चिह्न छिपाएँ',
    revert: 'ये बदलाव वापस लें',
    revertTitle: 'इस बारी में AI ने जो भी बदला, सब वापस लें',
    revertLaterTitle: 'यह बारी और उसके बाद की सभी AI बारियाँ वापस लें',
    showChange: 'दस्तावेज़ में यह स्थान दिखाएँ',
    refused:
      'ये बदलाव एक साथ वापस नहीं लिए जा सके। अगर उसके बाद दस्तावेज़ संपादित हुआ है, तो संपादक का पूर्ववत करें (Ctrl+Z) इस्तेमाल करें।',
    expired:
      'यह बारी अब एक साथ वापस नहीं ली जा सकती। संपादक का पूर्ववत करें (Ctrl+Z) इस्तेमाल करें।',
    partial: 'कुछ बदलाव वापस नहीं लिए जा सके। कृपया दस्तावेज़ जाँचें।',
  },
  'zh-TW': {
    changedCount: (n) => `已修改文件 ${n} 處`,
    changed: '已修改文件',
    reverted: '已復原',
    clearMarks: '清除標記',
    revert: '復原這些修改',
    revertTitle: '復原 AI 在這一輪所做的全部修改',
    revertLaterTitle: '復原這一輪及其後各輪 AI 的修改',
    showChange: '在文件中檢視此處',
    refused: '無法一次復原這些修改。如果之後又編輯過文件，請使用編輯器本身的復原（Ctrl+Z）。',
    expired: '這一輪已無法一次復原。請使用編輯器本身的復原（Ctrl+Z）。',
    partial: '有些修改未能復原，請檢查文件。',
  },
  vi: {
    changedCount: (n) => `Thay đổi trong tài liệu: ${n}`,
    changed: 'Thay đổi trong tài liệu',
    reverted: 'Đã hoàn tác thay đổi',
    clearMarks: 'Ẩn đánh dấu',
    revert: 'Hoàn tác các thay đổi này',
    revertTitle: 'Hoàn tác mọi thứ AI đã thay đổi trong lượt này',
    revertLaterTitle: 'Hoàn tác lượt này và mọi lượt AI sau đó',
    showChange: 'Hiển thị vị trí này trong tài liệu',
    refused:
      'Không thể hoàn tác các thay đổi này cùng lúc. Nếu tài liệu đã được sửa sau đó, hãy dùng Hoàn tác của trình soạn thảo (Ctrl+Z).',
    expired:
      'Không thể hoàn tác lượt này cùng lúc nữa. Hãy dùng Hoàn tác của trình soạn thảo (Ctrl+Z).',
    partial: 'Không thể hoàn tác một số thay đổi. Hãy kiểm tra tài liệu.',
  },
  tr: {
    changedCount: (n) => `Belgede yapılan değişiklikler: ${n}`,
    changed: 'Belgede değişiklik yapıldı',
    reverted: 'Değişiklikler geri alındı',
    clearMarks: 'İşaretleri gizle',
    revert: 'Bu değişiklikleri geri al',
    revertTitle: 'Yapay zekânın bu turda değiştirdiği her şeyi geri al',
    revertLaterTitle: 'Bu turu ve sonraki tüm yapay zekâ turlarını geri al',
    showChange: 'Bu yeri belgede göster',
    refused:
      'Bu değişiklikler birlikte geri alınamadı. Belge daha sonra düzenlendiyse düzenleyicinin kendi Geri Al işlevini (Ctrl+Z) kullanın.',
    expired:
      'Bu tur artık tek adımda geri alınamaz. Düzenleyicinin kendi Geri Al işlevini (Ctrl+Z) kullanın.',
    partial: 'Değişikliklerin bir kısmı geri alınamadı. Lütfen belgeyi kontrol edin.',
  },
}
