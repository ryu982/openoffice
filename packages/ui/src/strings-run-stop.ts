import type { Lang } from '@genoffice/i18n'

/**
 * What the AI panel says where a run was stopped by the app's own rule (the
 * model sent edits it could not use, its edits kept failing, or it went in
 * circles), instead of the English line the run loop reports.
 */
export interface AiRunStopLabels {
  /** the model's tool input was unusable several turns in a row */
  toolInput: string
  /** why, when the input was cut off by the output limit */
  truncated: string
  /** why, when the input was broken, incomplete or of the wrong type */
  malformed: string
  /** every edit failed several turns in a row */
  toolErrors: string
  /** the model repeated the same turn */
  repeating: string
  /** the run had already changed the document; names the Continue button */
  keptChanges: string
  /** the run changed nothing */
  unchanged: string
  /** the button that sends the request again, telling the model to go on from the document as it is */
  continueAction: string
}

export const AI_RUN_STOP_LABELS: Record<Lang, AiRunStopLabels> = {
  zh: {
    toolInput: 'AI 发来的编辑内容连续多次无法读取，因此已停止。',
    truncated: '它一次要写入的内容太长，中途被截断了。',
    malformed: '它发来的内容不是应用可以使用的格式。',
    toolErrors: 'AI 的编辑连续失败，因此已停止。',
    repeating: 'AI 一直重复同一个步骤而没有进展，因此已停止。',
    keptChanges: '到这里为止的修改仍保留在文档中。点击“继续”即可从剩下的部分接着做。',
    unchanged: '文档没有被修改。请重新发送请求，或拆成几个较小的请求。',
    continueAction: '继续',
  },
  en: {
    toolInput: "The AI's edits could not be read several times in a row, so the work was stopped.",
    truncated: 'What it tried to write in one step was too long and was cut off.',
    malformed: 'What it sent was not in a form the app could use.',
    toolErrors: "The AI's edits kept failing, so the work was stopped.",
    repeating:
      'The AI kept repeating the same step without getting further, so the work was stopped.',
    keptChanges:
      'What it changed up to this point is still in the document. Press "Continue" to carry on with what is left.',
    unchanged:
      'The document was not changed. Send the request again, or split it into smaller requests.',
    continueAction: 'Continue',
  },
  ja: {
    toolInput: 'AI が送った編集内容を続けて何度も読み取れなかったため、作業を止めました。',
    truncated: '一度に書こうとした内容が長すぎて、途中で切れました。',
    malformed: 'AI が送った内容は、アプリが使える形式ではありませんでした。',
    toolErrors: 'AI の編集が続けて失敗したため、作業を止めました。',
    repeating: 'AI が同じ操作を繰り返すだけで進まなかったため、作業を止めました。',
    keptChanges: 'ここまでの変更は文書に残っています。「続ける」を押すと、残りの部分から続けます。',
    unchanged: '文書は変更されていません。もう一度送信するか、依頼を小さく分けて送ってください。',
    continueAction: '続ける',
  },
  ko: {
    toolInput: 'AI가 보낸 편집 내용을 여러 번 연달아 읽지 못해 작업을 멈췄습니다.',
    truncated: '한 번에 쓰려던 내용이 너무 길어 중간에 잘렸습니다.',
    malformed: 'AI가 보낸 내용이 앱이 쓸 수 있는 형식이 아니었습니다.',
    toolErrors: 'AI의 편집이 계속 실패해 작업을 멈췄습니다.',
    repeating: 'AI가 같은 동작만 되풀이해 작업을 멈췄습니다.',
    keptChanges:
      '여기까지 고친 내용은 문서에 남아 있습니다. "이어서 하기"를 누르면 남은 부분부터 이어 갑니다.',
    unchanged: '문서는 바뀌지 않았습니다. 요청을 다시 보내거나 더 작게 나눠 보내 보세요.',
    continueAction: '이어서 하기',
  },
  fr: {
    toolInput:
      "Les modifications envoyées par l'IA n'ont pas pu être lues plusieurs fois de suite ; le travail a été arrêté.",
    truncated: "Ce qu'elle voulait écrire en une seule fois était trop long et a été coupé.",
    malformed: "Ce qu'elle a envoyé n'était pas dans une forme utilisable par l'application.",
    toolErrors:
      "Les modifications de l'IA ont échoué à plusieurs reprises ; le travail a été arrêté.",
    repeating: "L'IA répétait la même étape sans avancer ; le travail a été arrêté.",
    keptChanges:
      "Ce qui a été modifié jusqu'ici reste dans le document. Appuyez sur « Continuer » pour reprendre ce qui reste.",
    unchanged:
      "Le document n'a pas été modifié. Renvoyez la demande ou divisez-la en demandes plus petites.",
    continueAction: 'Continuer',
  },
  de: {
    toolInput:
      'Die Änderungen der KI konnten mehrmals hintereinander nicht gelesen werden. Die Arbeit wurde angehalten.',
    truncated: 'Was sie in einem Schritt schreiben wollte, war zu lang und wurde abgeschnitten.',
    malformed: 'Was sie gesendet hat, lag nicht in einer Form vor, die die App verwenden kann.',
    toolErrors:
      'Die Änderungen der KI sind wiederholt fehlgeschlagen. Die Arbeit wurde angehalten.',
    repeating:
      'Die KI hat denselben Schritt immer wieder ausgeführt, ohne voranzukommen. Die Arbeit wurde angehalten.',
    keptChanges:
      'Was bis hierhin geändert wurde, bleibt im Dokument. Mit „Fortsetzen“ geht es mit dem Rest weiter.',
    unchanged:
      'Das Dokument wurde nicht geändert. Senden Sie die Anfrage erneut oder teilen Sie sie in kleinere Anfragen auf.',
    continueAction: 'Fortsetzen',
  },
  es: {
    toolInput:
      'Los cambios que envió la IA no se pudieron leer varias veces seguidas, así que el trabajo se detuvo.',
    truncated: 'Lo que intentó escribir de una sola vez era demasiado largo y quedó cortado.',
    malformed: 'Lo que envió no tenía una forma que la aplicación pudiera usar.',
    toolErrors: 'Los cambios de la IA fallaron una y otra vez, así que el trabajo se detuvo.',
    repeating: 'La IA repetía el mismo paso sin avanzar, así que el trabajo se detuvo.',
    keptChanges:
      'Lo que cambió hasta aquí sigue en el documento. Pulse «Continuar» para seguir con lo que falta.',
    unchanged:
      'El documento no se modificó. Envíe la solicitud de nuevo o divídala en solicitudes más pequeñas.',
    continueAction: 'Continuar',
  },
  th: {
    toolInput: 'ไม่สามารถอ่านการแก้ไขที่ AI ส่งมาได้หลายครั้งติดต่อกัน จึงหยุดการทำงาน',
    truncated: 'เนื้อหาที่ AI พยายามเขียนในครั้งเดียวยาวเกินไปและถูกตัดกลางคัน',
    malformed: 'สิ่งที่ AI ส่งมาไม่ได้อยู่ในรูปแบบที่แอปใช้ได้',
    toolErrors: 'การแก้ไขของ AI ล้มเหลวซ้ำ ๆ จึงหยุดการทำงาน',
    repeating: 'AI ทำขั้นตอนเดิมซ้ำ ๆ โดยไม่คืบหน้า จึงหยุดการทำงาน',
    keptChanges: 'สิ่งที่แก้ไขไปแล้วจนถึงตรงนี้ยังอยู่ในเอกสาร กด "ทำต่อ" เพื่อทำส่วนที่เหลือต่อ',
    unchanged: 'เอกสารไม่ได้ถูกเปลี่ยนแปลง ลองส่งคำขออีกครั้ง หรือแบ่งเป็นคำขอย่อย ๆ',
    continueAction: 'ทำต่อ',
  },
  id: {
    toolInput:
      'Suntingan yang dikirim AI tidak dapat dibaca beberapa kali berturut-turut, sehingga pekerjaan dihentikan.',
    truncated: 'Isi yang hendak ditulisnya dalam satu langkah terlalu panjang dan terpotong.',
    malformed: 'Yang dikirimnya tidak dalam bentuk yang dapat dipakai aplikasi.',
    toolErrors: 'Suntingan AI terus gagal, sehingga pekerjaan dihentikan.',
    repeating:
      'AI terus mengulang langkah yang sama tanpa kemajuan, sehingga pekerjaan dihentikan.',
    keptChanges:
      'Perubahan sampai titik ini tetap ada di dokumen. Tekan "Lanjutkan" untuk meneruskan bagian yang tersisa.',
    unchanged:
      'Dokumen tidak diubah. Kirim ulang permintaan, atau pecah menjadi permintaan yang lebih kecil.',
    continueAction: 'Lanjutkan',
  },
  ru: {
    toolInput:
      'Правки, присланные ИИ, несколько раз подряд не удалось прочитать, поэтому работа остановлена.',
    truncated:
      'То, что он пытался записать за один шаг, оказалось слишком длинным и было обрезано.',
    malformed: 'Присланное было не в том виде, который может использовать приложение.',
    toolErrors: 'Правки ИИ раз за разом не выполнялись, поэтому работа остановлена.',
    repeating: 'ИИ повторял один и тот же шаг и не продвигался, поэтому работа остановлена.',
    keptChanges:
      'Всё, что изменено до этого места, осталось в документе. Нажмите «Продолжить», чтобы доделать оставшееся.',
    unchanged:
      'Документ не изменён. Отправьте запрос ещё раз или разбейте его на несколько небольших.',
    continueAction: 'Продолжить',
  },
  ar: {
    toolInput: 'تعذّرت قراءة التعديلات التي أرسلها الذكاء الاصطناعي عدة مرات متتالية، فتوقف العمل.',
    truncated: 'ما حاول كتابته في خطوة واحدة كان طويلاً جداً فانقطع.',
    malformed: 'ما أرسله لم يكن بصيغة يستطيع التطبيق استخدامها.',
    toolErrors: 'فشلت تعديلات الذكاء الاصطناعي مراراً، فتوقف العمل.',
    repeating: 'ظل الذكاء الاصطناعي يكرر الخطوة نفسها دون تقدم، فتوقف العمل.',
    keptChanges: 'ما تم تغييره حتى الآن ما زال في المستند. اضغط "متابعة" لإكمال ما تبقى.',
    unchanged: 'لم يتغير المستند. أرسل الطلب مرة أخرى، أو قسّمه إلى طلبات أصغر.',
    continueAction: 'متابعة',
  },
  pt: {
    toolInput:
      'As alterações enviadas pela IA não puderam ser lidas várias vezes seguidas, por isso o trabalho foi interrompido.',
    truncated: 'O que ela tentou escrever de uma só vez era longo demais e foi cortado.',
    malformed: 'O que ela enviou não estava em um formato que o aplicativo pudesse usar.',
    toolErrors: 'As alterações da IA falharam repetidamente, por isso o trabalho foi interrompido.',
    repeating: 'A IA repetia o mesmo passo sem avançar, por isso o trabalho foi interrompido.',
    keptChanges:
      'O que foi alterado até aqui continua no documento. Pressione "Continuar" para seguir com o que falta.',
    unchanged:
      'O documento não foi alterado. Envie o pedido novamente ou divida-o em pedidos menores.',
    continueAction: 'Continuar',
  },
  it: {
    toolInput:
      "Le modifiche inviate dall'IA non sono state leggibili più volte di seguito, quindi il lavoro è stato interrotto.",
    truncated:
      'Ciò che ha provato a scrivere in un solo passaggio era troppo lungo ed è stato troncato.',
    malformed: "Ciò che ha inviato non era in una forma utilizzabile dall'app.",
    toolErrors: "Le modifiche dell'IA continuavano a fallire, quindi il lavoro è stato interrotto.",
    repeating:
      "L'IA ripeteva lo stesso passaggio senza avanzare, quindi il lavoro è stato interrotto.",
    keptChanges:
      'Ciò che è stato modificato fin qui resta nel documento. Premi «Continua» per proseguire con ciò che manca.',
    unchanged:
      'Il documento non è stato modificato. Invia di nuovo la richiesta o dividila in richieste più piccole.',
    continueAction: 'Continua',
  },
  pl: {
    toolInput:
      'Zmian przesłanych przez AI kilka razy z rzędu nie udało się odczytać, więc praca została zatrzymana.',
    truncated: 'To, co AI próbowało zapisać w jednym kroku, było za długie i zostało ucięte.',
    malformed: 'To, co przesłało AI, nie miało postaci, której aplikacja mogłaby użyć.',
    toolErrors: 'Zmiany AI wciąż się nie udawały, więc praca została zatrzymana.',
    repeating: 'AI powtarzało ten sam krok bez postępu, więc praca została zatrzymana.',
    keptChanges:
      'To, co zmieniono do tej pory, pozostaje w dokumencie. Naciśnij „Kontynuuj”, aby dokończyć resztę.',
    unchanged: 'Dokument nie został zmieniony. Wyślij prośbę ponownie albo podziel ją na mniejsze.',
    continueAction: 'Kontynuuj',
  },
  cs: {
    toolInput:
      'Úpravy, které AI poslala, se několikrát za sebou nepodařilo přečíst, proto byla práce zastavena.',
    truncated: 'To, co se pokusila zapsat v jednom kroku, bylo příliš dlouhé a bylo oříznuto.',
    malformed: 'To, co poslala, nemělo podobu, kterou by aplikace mohla použít.',
    toolErrors: 'Úpravy AI opakovaně selhávaly, proto byla práce zastavena.',
    repeating: 'AI opakovala stále stejný krok bez pokroku, proto byla práce zastavena.',
    keptChanges:
      'Co bylo dosud změněno, v dokumentu zůstává. Stisknutím „Pokračovat“ dokončíte zbytek.',
    unchanged: 'Dokument nebyl změněn. Odešlete požadavek znovu, nebo jej rozdělte na menší.',
    continueAction: 'Pokračovat',
  },
  nl: {
    toolInput:
      'De bewerkingen van de AI konden meerdere keren achter elkaar niet worden gelezen, dus het werk is gestopt.',
    truncated: 'Wat de AI in één stap wilde schrijven, was te lang en is afgekapt.',
    malformed: 'Wat de AI stuurde, had geen vorm die de app kon gebruiken.',
    toolErrors: 'De bewerkingen van de AI bleven mislukken, dus het werk is gestopt.',
    repeating:
      'De AI bleef dezelfde stap herhalen zonder verder te komen, dus het werk is gestopt.',
    keptChanges:
      'Wat tot hier is gewijzigd, staat nog in het document. Druk op "Doorgaan" om verder te gaan met wat er nog over is.',
    unchanged:
      'Het document is niet gewijzigd. Stuur het verzoek opnieuw of splits het op in kleinere verzoeken.',
    continueAction: 'Doorgaan',
  },
  ms: {
    toolInput:
      'Suntingan yang dihantar AI tidak dapat dibaca beberapa kali berturut-turut, jadi kerja dihentikan.',
    truncated: 'Kandungan yang cuba ditulisnya dalam satu langkah terlalu panjang dan terpotong.',
    malformed: 'Apa yang dihantarnya bukan dalam bentuk yang boleh digunakan oleh aplikasi.',
    toolErrors: 'Suntingan AI terus gagal, jadi kerja dihentikan.',
    repeating: 'AI terus mengulang langkah yang sama tanpa kemajuan, jadi kerja dihentikan.',
    keptChanges:
      'Perubahan setakat ini masih ada dalam dokumen. Tekan "Teruskan" untuk menyambung bahagian yang tinggal.',
    unchanged:
      'Dokumen tidak diubah. Hantar permintaan sekali lagi, atau pecahkan kepada permintaan yang lebih kecil.',
    continueAction: 'Teruskan',
  },
  he: {
    toolInput:
      'לא ניתן היה לקרוא את העריכות ששלחה הבינה המלאכותית כמה פעמים ברצף, ולכן העבודה נעצרה.',
    truncated: 'מה שהיא ניסתה לכתוב בצעד אחד היה ארוך מדי ונקטע.',
    malformed: 'מה שהיא שלחה לא היה בצורה שהיישום יכול להשתמש בה.',
    toolErrors: 'העריכות של הבינה המלאכותית נכשלו שוב ושוב, ולכן העבודה נעצרה.',
    repeating: 'הבינה המלאכותית חזרה על אותו צעד בלי להתקדם, ולכן העבודה נעצרה.',
    keptChanges: 'מה ששונה עד כאן נשאר במסמך. לחצו על "המשך" כדי להמשיך במה שנותר.',
    unchanged: 'המסמך לא שונה. שלחו את הבקשה שוב, או פצלו אותה לבקשות קטנות יותר.',
    continueAction: 'המשך',
  },
  hi: {
    toolInput: 'AI के भेजे संपादन लगातार कई बार पढ़े नहीं जा सके, इसलिए काम रोक दिया गया।',
    truncated: 'उसने एक बार में जो लिखना चाहा वह बहुत लंबा था और बीच में कट गया।',
    malformed: 'उसने जो भेजा वह ऐसे रूप में नहीं था जिसे ऐप इस्तेमाल कर सके।',
    toolErrors: 'AI के संपादन बार-बार विफल होते रहे, इसलिए काम रोक दिया गया।',
    repeating: 'AI बिना आगे बढ़े वही चरण दोहराता रहा, इसलिए काम रोक दिया गया।',
    keptChanges:
      'यहाँ तक जो बदला गया वह दस्तावेज़ में बना हुआ है। बचा हुआ काम आगे बढ़ाने के लिए "जारी रखें" दबाएँ।',
    unchanged: 'दस्तावेज़ नहीं बदला गया। अनुरोध दोबारा भेजें, या उसे छोटे अनुरोधों में बाँट दें।',
    continueAction: 'जारी रखें',
  },
  'zh-TW': {
    toolInput: 'AI 送來的編輯內容連續多次無法讀取，因此已停止。',
    truncated: '它一次要寫入的內容太長，中途被截斷了。',
    malformed: '它送來的內容不是應用程式可以使用的格式。',
    toolErrors: 'AI 的編輯連續失敗，因此已停止。',
    repeating: 'AI 一直重複同一個步驟而沒有進展，因此已停止。',
    keptChanges: '到這裡為止的修改仍保留在文件中。按一下「繼續」即可從剩下的部分接著做。',
    unchanged: '文件沒有被修改。請重新送出要求，或拆成幾個較小的要求。',
    continueAction: '繼續',
  },
  vi: {
    toolInput:
      'Các chỉnh sửa AI gửi đến không đọc được nhiều lần liên tiếp nên công việc đã dừng lại.',
    truncated: 'Nội dung AI định viết trong một bước quá dài và đã bị cắt giữa chừng.',
    malformed: 'Nội dung AI gửi không ở dạng mà ứng dụng dùng được.',
    toolErrors: 'Các chỉnh sửa của AI liên tục thất bại nên công việc đã dừng lại.',
    repeating: 'AI cứ lặp lại cùng một bước mà không tiến triển nên công việc đã dừng lại.',
    keptChanges:
      'Những gì đã thay đổi đến đây vẫn còn trong tài liệu. Nhấn "Tiếp tục" để làm tiếp phần còn lại.',
    unchanged:
      'Tài liệu chưa bị thay đổi. Hãy gửi lại yêu cầu hoặc chia thành các yêu cầu nhỏ hơn.',
    continueAction: 'Tiếp tục',
  },
  tr: {
    toolInput:
      'Yapay zekânın düzenlemeleri art arda birkaç kez okunamadı, bu yüzden iş durduruldu.',
    truncated: 'Tek adımda yazmaya çalıştığı içerik çok uzundu ve kesildi.',
    malformed: 'Gönderdiği içerik uygulamanın kullanabileceği biçimde değildi.',
    toolErrors: 'Yapay zekânın düzenlemeleri sürekli başarısız oldu, bu yüzden iş durduruldu.',
    repeating: 'Yapay zekâ ilerlemeden aynı adımı tekrarlayıp durdu, bu yüzden iş durduruldu.',
    keptChanges:
      'Bu noktaya kadar değiştirdikleri belgede duruyor. Kalan kısımla devam etmek için "Devam et"e basın.',
    unchanged: 'Belge değiştirilmedi. İsteği yeniden gönderin veya daha küçük isteklere bölün.',
    continueAction: 'Devam et',
  },
}
