import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/**
 * Strings for the Obsidian, Notion, and Canva direct-attach menu items and
 * wire-result notes in `AiAttachMenu`. `zh` defines the canonical key set across all 22 languages.
 */
const zh = {
  attachFromObsidian: '从 Obsidian 保管库附加笔记',
  attachFromNotion: '附加 Notion 页面',
  attachFromCanva: '从 Canva 导入设计',
  connectorBusy: '另一个选择窗口已打开，请先完成或关闭它。',
  connectorNotConnected: '尚未连接此服务，请先在“设置 › 集成”中连接。',
  connectorFailed: '无法读取所选内容，请重试。',
  connectorSkipped: '已跳过 {n} 个无法附加的项目。',
  connectorOmittedNonText: '已省略 Notion 页面中的 {n} 个图片或附件等非文本项目。',
}

export const CONNECTOR_ATTACH_STRINGS = defineStrings({
  zh,
  en: {
    attachFromObsidian: 'Attach notes from Obsidian vault',
    attachFromNotion: 'Attach Notion pages',
    attachFromCanva: 'Import from Canva',
    connectorBusy: 'Another picker window is already open. Finish or close it first.',
    connectorNotConnected:
      'This service is not connected yet. Connect it in Settings › Integrations.',
    connectorFailed: 'Could not read the selected items. Please try again.',
    connectorSkipped: 'Skipped {n} item(s) that could not be attached.',
    connectorOmittedNonText:
      'Omitted {n} non-text item(s) (such as images or files) from Notion pages.',
  },
  ja: {
    attachFromObsidian: 'Obsidian 保管庫からノートを添付',
    attachFromNotion: 'Notion ページを添付',
    attachFromCanva: 'Canva からデザインを取り込む',
    connectorBusy: '別の選択ウィンドウが開いています。先に完了するか閉じてください。',
    connectorNotConnected:
      'このサービスはまだ接続されていません。「設定 › 連携」で接続してください。',
    connectorFailed: '選択した項目を読み込めませんでした。もう一度お試しください。',
    connectorSkipped: '添付できない {n} 件の項目をスキップしました。',
    connectorOmittedNonText:
      'Notion ページの画像やファイルなど非テキスト項目 {n} 件を省略しました。',
  },
  ko: {
    attachFromObsidian: 'Obsidian 볼트에서 노트 첨부',
    attachFromNotion: 'Notion 페이지 첨부',
    attachFromCanva: 'Canva에서 디자인 가져오기',
    connectorBusy: '다른 선택 창이 이미 열려 있습니다. 먼저 마치거나 닫아 주세요.',
    connectorNotConnected: '아직 연결되지 않았습니다. 설정 ▸ 연동에서 먼저 연결해 주세요.',
    connectorFailed: '고른 항목을 불러오지 못했습니다. 다시 시도해 주세요.',
    connectorSkipped: '첨부할 수 없는 항목 {n}개를 건너뛰었습니다.',
    connectorOmittedNonText: 'Notion 페이지의 그림·파일 등 글이 아닌 항목 {n}개는 제외했습니다.',
  },
  fr: {
    attachFromObsidian: 'Joindre des notes du coffre Obsidian',
    attachFromNotion: 'Joindre des pages Notion',
    attachFromCanva: 'Importer depuis Canva',
    connectorBusy:
      'Une autre fenêtre de sélection est déjà ouverte. Terminez-la ou fermez-la d’abord.',
    connectorNotConnected:
      'Ce service n’est pas encore connecté. Connectez-le dans Réglages › Intégrations.',
    connectorFailed: 'Impossible de lire les éléments sélectionnés. Veuillez réessayer.',
    connectorSkipped: '{n} élément(s) non joignable(s) ignoré(s).',
    connectorOmittedNonText:
      '{n} élément(s) non textuel(s) (images ou fichiers) omis des pages Notion.',
  },
  de: {
    attachFromObsidian: 'Notizen aus Obsidian-Vault anhängen',
    attachFromNotion: 'Notion-Seiten anhängen',
    attachFromCanva: 'Aus Canva importieren',
    connectorBusy:
      'Ein anderes Auswahlfenster ist bereits geöffnet. Bitte schließen Sie es zuerst.',
    connectorNotConnected:
      'Dieser Dienst ist noch nicht verbunden. Verbinden Sie ihn unter Einstellungen › Integrationen.',
    connectorFailed: 'Ausgewählte Elemente konnten nicht gelesen werden. Bitte erneut versuchen.',
    connectorSkipped: '{n} nicht anhängbare(s) Element(e) übersprungen.',
    connectorOmittedNonText:
      '{n} Nicht-Text-Element(e) (z. B. Bilder oder Dateien) aus Notion-Seiten ausgelassen.',
  },
  es: {
    attachFromObsidian: 'Adjuntar notas del almacén de Obsidian',
    attachFromNotion: 'Adjuntar páginas de Notion',
    attachFromCanva: 'Importar desde Canva',
    connectorBusy: 'Ya hay otra ventana de selección abierta. Ciérrala o termínala primero.',
    connectorNotConnected:
      'Este servicio aún no está conectado. Conéctalo en Ajustes › Integraciones.',
    connectorFailed: 'No se pudieron leer los elementos seleccionados. Inténtalo de nuevo.',
    connectorSkipped: 'Se omitieron {n} elemento(s) que no se pudieron adjuntar.',
    connectorOmittedNonText:
      'Se omitieron {n} elemento(s) no textuales (imágenes o archivos) de las páginas de Notion.',
  },
  th: {
    attachFromObsidian: 'แนบโน้ตจากคลัง Obsidian',
    attachFromNotion: 'แนบหน้า Notion',
    attachFromCanva: 'นำเข้าจาก Canva',
    connectorBusy: 'มีหน้าต่างเลือกอื่นเปิดอยู่แล้ว กรุณาปิดหรือดำเนินการให้เสร็จก่อน',
    connectorNotConnected: 'ยังไม่ได้เชื่อมต่อบริการนี้ กรุณาเชื่อมต่อใน การตั้งค่า › การเชื่อมต่อ',
    connectorFailed: 'ไม่สามารถอ่านรายการที่เลือกได้ กรุณาลองอีกครั้ง',
    connectorSkipped: 'ข้าม {n} รายการที่ไม่สามารถแนบได้',
    connectorOmittedNonText:
      'ละเว้นรายการที่ไม่ใช่ข้อความ {n} รายการ (เช่น รูปภาพหรือไฟล์) จากหน้า Notion',
  },
  id: {
    attachFromObsidian: 'Lampirkan catatan dari brankas Obsidian',
    attachFromNotion: 'Lampirkan halaman Notion',
    attachFromCanva: 'Impor dari Canva',
    connectorBusy: 'Jendela pemilih lain sudah terbuka. Selesaikan atau tutup terlebih dahulu.',
    connectorNotConnected: 'Layanan ini belum terhubung. Hubungkan di Pengaturan › Integrasi.',
    connectorFailed: 'Tidak dapat membaca item yang dipilih. Silakan coba lagi.',
    connectorSkipped: 'Melewati {n} item yang tidak dapat dilampirkan.',
    connectorOmittedNonText:
      'Menghilangkan {n} item non-teks (seperti gambar atau file) dari halaman Notion.',
  },
  ru: {
    attachFromObsidian: 'Прикрепить заметки из хранилища Obsidian',
    attachFromNotion: 'Прикрепить страницы Notion',
    attachFromCanva: 'Импортировать из Canva',
    connectorBusy: 'Другое окно выбора уже открыто. Сначала завершите или закройте его.',
    connectorNotConnected:
      'Этот сервис ещё не подключён. Подключите его в «Настройки › Интеграции».',
    connectorFailed: 'Не удалось прочитать выбранные элементы. Повторите попытку.',
    connectorSkipped: 'Пропущено элементов, которые нельзя прикрепить: {n}.',
    connectorOmittedNonText:
      'Исключено нетекстовых элементов (изображений или файлов) со страниц Notion: {n}.',
  },
  ar: {
    attachFromObsidian: 'إرفاق ملاحظات من خزنة Obsidian',
    attachFromNotion: 'إرفاق صفحات Notion',
    attachFromCanva: 'استيراد من Canva',
    connectorBusy: 'توجد نافذة اختيار أخرى مفتوحة بالفعل. يرجى إنهاؤها أو إغلاقها أولاً.',
    connectorNotConnected: 'هذه الخدمة غير متصلة بعد. قم بتوصيلها من الإعدادات › التكاملات.',
    connectorFailed: 'تعذرت قراءة العناصر المحددة. يرجى المحاولة مرة أخرى.',
    connectorSkipped: 'تم تخطي {n} عنصر(عناصر) تعذر إرفاقها.',
    connectorOmittedNonText:
      'تم استبعاد {n} عنصر(عناصر) غير نصية (مثل الصور أو الملفات) من صفحات Notion.',
  },
  pt: {
    attachFromObsidian: 'Anexar notas do cofre Obsidian',
    attachFromNotion: 'Anexar páginas do Notion',
    attachFromCanva: 'Importar do Canva',
    connectorBusy: 'Outra janela de seleção já está aberta. Conclua ou feche-a primeiro.',
    connectorNotConnected:
      'Este serviço ainda não está conectado. Conecte-o em Configurações › Integrações.',
    connectorFailed: 'Não foi possível ler os itens selecionados. Tente novamente.',
    connectorSkipped: '{n} item(ns) que não puderam ser anexados foram ignorados.',
    connectorOmittedNonText:
      '{n} item(ns) não textuais (imagens ou arquivos) foram omitidos das páginas do Notion.',
  },
  it: {
    attachFromObsidian: 'Allega note dal vault Obsidian',
    attachFromNotion: 'Allega pagine Notion',
    attachFromCanva: 'Importa da Canva',
    connectorBusy: 'Un’altra finestra di selezione è già aperta. Completala o chiudila prima.',
    connectorNotConnected:
      'Questo servizio non è ancora connesso. Connettilo in Impostazioni › Integrazioni.',
    connectorFailed: 'Impossibile leggere gli elementi selezionati. Riprova.',
    connectorSkipped: 'Ignorati {n} elementi non allegabili.',
    connectorOmittedNonText:
      'Omessi {n} elementi non testuali (immagini o file) dalle pagine Notion.',
  },
  pl: {
    attachFromObsidian: 'Dołącz notatki ze skarbca Obsidian',
    attachFromNotion: 'Dołącz strony Notion',
    attachFromCanva: 'Importuj z Canva',
    connectorBusy: 'Inne okno wyboru jest już otwarte. Najpierw je zamknij lub zakończ.',
    connectorNotConnected:
      'Ta usługa nie jest jeszcze połączona. Połącz ją w Ustawienia › Integracje.',
    connectorFailed: 'Nie udało się odczytać wybranych elementów. Spróbuj ponownie.',
    connectorSkipped: 'Pominięto {n} element(y), których nie można dołączyć.',
    connectorOmittedNonText:
      'Pominięto {n} element(y) nietekstowe (obrazy lub pliki) ze stron Notion.',
  },
  cs: {
    attachFromObsidian: 'Připojit poznámky z trezoru Obsidian',
    attachFromNotion: 'Připojit stránky Notion',
    attachFromCanva: 'Importovat z Canva',
    connectorBusy: 'Jiné okno výběru je již otevřené. Nejprve jej dokončete nebo zavřete.',
    connectorNotConnected: 'Tato služba ještě není připojena. Připojte ji v Nastavení › Integrace.',
    connectorFailed: 'Vybrané položky se nepodařilo přečíst. Zkuste to znovu.',
    connectorSkipped: 'Přeskočeno {n} položek, které nelze připojit.',
    connectorOmittedNonText:
      'Ze stránek Notion bylo vynecháno {n} netextových položek (obrázky nebo soubory).',
  },
  nl: {
    attachFromObsidian: 'Notities uit Obsidian-kluis bijvoegen',
    attachFromNotion: 'Notion-pagina’s bijvoegen',
    attachFromCanva: 'Importeren uit Canva',
    connectorBusy: 'Er is al een ander selectievenster geopend. Sluit of voltooi dat eerst.',
    connectorNotConnected:
      'Deze service is nog niet verbonden. Verbind deze via Instellingen › Integraties.',
    connectorFailed: 'Kan de geselecteerde items niet lezen. Probeer het opnieuw.',
    connectorSkipped: '{n} item(s) overgeslagen die niet konden worden bijgevoegd.',
    connectorOmittedNonText:
      '{n} niet-tekstitem(s) (zoals afbeeldingen of bestanden) uit Notion-pagina’s weggelaten.',
  },
  ms: {
    attachFromObsidian: 'Lampirkan nota daripada peti Obsidian',
    attachFromNotion: 'Lampirkan halaman Notion',
    attachFromCanva: 'Import daripada Canva',
    connectorBusy: 'Tetingkap pemilih lain sudah dibuka. Selesaikan atau tutupnya dahulu.',
    connectorNotConnected:
      'Perkhidmatan ini belum disambungkan. Sambungkannya di Tetapan › Integrasi.',
    connectorFailed: 'Tidak dapat membaca item yang dipilih. Sila cuba lagi.',
    connectorSkipped: 'Melangkau {n} item yang tidak dapat dilampirkan.',
    connectorOmittedNonText:
      'Mengecualikan {n} item bukan teks (seperti imej atau fail) daripada halaman Notion.',
  },
  he: {
    attachFromObsidian: 'צירוף הערות מכספת Obsidian',
    attachFromNotion: 'צירוף דפי Notion',
    attachFromCanva: 'ייבוא מ-Canva',
    connectorBusy: 'חלון בחירה אחר כבר פתוח. יש לסיים או לסגור אותו קודם.',
    connectorNotConnected: 'שירות זה עדיין לא מחובר. חבר אותו דרך הגדרות › אינטגרציות.',
    connectorFailed: 'לא ניתן היה לקרוא את הפריטים שנבחרו. נסה שוב.',
    connectorSkipped: 'דילגנו על {n} פריט(ים) שלא ניתן לצרף.',
    connectorOmittedNonText: 'הושמטו {n} פריט(ים) שאינם טקסט (כגון תמונות או קבצים) מדפי Notion.',
  },
  hi: {
    attachFromObsidian: 'Obsidian वॉल्ट से नोट्स संलग्न करें',
    attachFromNotion: 'Notion पृष्ठ संलग्न करें',
    attachFromCanva: 'Canva से आयात करें',
    connectorBusy: 'एक अन्य चयन विंडो पहले से खुली है। पहले उसे पूरा करें या बंद करें।',
    connectorNotConnected: 'यह सेवा अभी जुड़ी नहीं है। इसे सेटिंग्स › एकीकरण में जोड़ें।',
    connectorFailed: 'चयनित आइटम पढ़े नहीं जा सके। कृपया पुनः प्रयास करें।',
    connectorSkipped: '{n} आइटम छोड़े गए जो संलग्न नहीं किए जा सके।',
    connectorOmittedNonText: 'Notion पृष्ठों से {n} गैर-पाठ आइटम (जैसे चित्र या फ़ाइलें) हटाए गए।',
  },
  'zh-TW': {
    attachFromObsidian: '從 Obsidian 保管庫附加筆記',
    attachFromNotion: '附加 Notion 頁面',
    attachFromCanva: '從 Canva 匯入設計',
    connectorBusy: '另一個選擇視窗已開啟，請先完成或關閉它。',
    connectorNotConnected: '尚未連接此服務，請先在「設定 › 整合」中連接。',
    connectorFailed: '無法讀取所選項目，請重試。',
    connectorSkipped: '已略過 {n} 個無法附加的項目。',
    connectorOmittedNonText: '已省略 Notion 頁面中的 {n} 個圖片或附件等非文字項目。',
  },
  vi: {
    attachFromObsidian: 'Đính kèm ghi chú từ kho Obsidian',
    attachFromNotion: 'Đính kèm trang Notion',
    attachFromCanva: 'Nhập từ Canva',
    connectorBusy: 'Một cửa sổ chọn khác đang mở. Hãy hoàn tất hoặc đóng nó trước.',
    connectorNotConnected: 'Dịch vụ này chưa được kết nối. Hãy kết nối trong Cài đặt › Tích hợp.',
    connectorFailed: 'Không thể đọc các mục đã chọn. Vui lòng thử lại.',
    connectorSkipped: 'Đã bỏ qua {n} mục không thể đính kèm.',
    connectorOmittedNonText:
      'Đã lược bỏ {n} mục không phải văn bản (như hình ảnh hoặc tệp) từ trang Notion.',
  },
  tr: {
    attachFromObsidian: 'Obsidian kasasından not ekle',
    attachFromNotion: 'Notion sayfaları ekle',
    attachFromCanva: 'Canva’dan içe aktar',
    connectorBusy: 'Başka bir seçim penceresi zaten açık. Önce onu tamamlayın veya kapatın.',
    connectorNotConnected:
      'Bu hizmet henüz bağlı değil. Ayarlar › Entegrasyonlar bölümünden bağlayın.',
    connectorFailed: 'Seçilen öğeler okunamadı. Lütfen tekrar deneyin.',
    connectorSkipped: 'Eklenemeyen {n} öğe atlandı.',
    connectorOmittedNonText:
      'Notion sayfalarından {n} metin dışı öğe (resim veya dosya gibi) hariç tutuldu.',
  },
})

export type ConnectorAttachStringKey = keyof typeof zh

export const connectorAttachText: (
  lang: Lang,
  key: ConnectorAttachStringKey,
  params?: Params,
) => string = createI18n(CONNECTOR_ATTACH_STRINGS)
