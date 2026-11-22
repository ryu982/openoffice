import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/**
 * Settings → Integrations: curated connector cards (Notion, Canva, Obsidian
 * Vaults, Korean Law MCP, kordoc MCP). All 22 UI languages; `zh` defines the
 * canonical key set.
 */
export const connectorsUiStrings = defineStrings({
  zh: {
    sectionTitle: '已连接的服务',
    customTitle: '其他 MCP 服务器',
    connect: '连接',
    disconnect: '断开连接',
    disconnectConfirm: '确定要断开 {name} 并删除已保存的凭据和注册信息吗？',
    showTools: '工具与设置',
    hideTools: '收起',
    continueSignIn: '在浏览器中登录',
    registerAndReview: '添加并检查启动命令',
    thirdPartyNote: '此服务由外部提供方运营，与 GenOffice 无隶属关系。',
    notionDesc: '搜索并读取 Notion 页面，或在 AI 面板中直接附加页面。',
    notionNotice:
      '当 AI 调用 Notion 工具时，查询词和选定的文本会发送到 Notion，返回的内容会提供给当前 AI 对话。',
    canvaDesc: '导入或在新标签页中打开我的 Canva 设计，或根据当前文档生成 Canva 设计。',
    canvaNotice:
      '当 AI 调用 Canva 工具时，查询词和选定的文本会发送到 Canva，返回的内容会提供给当前 AI 对话。',
    obsidianName: 'Obsidian 仓库',
    obsidianDesc: '直接读写本地 .md 笔记，无需运行 Obsidian 应用，也不会在仓库中创建额外文件。',
    obsidianAddVault: '添加仓库文件夹',
    obsidianVaultCount: '已连接 {n} 个仓库',
    obsidianMissingDirConfirm:
      '所选文件夹“{name}”中没有 .obsidian 文件夹。仍要将其作为普通 Markdown 文件夹连接吗？',
    obsidianConnectAnyway: '仍然连接',
    obsidianForbidden: '无法注册系统文件夹、主目录或应用数据文件夹。请选择具体的笔记文件夹。',
    obsidianDuplicate: '该文件夹已添加为仓库。',
    obsidianRename: '重命名',
    obsidianRemoveVault: '移除',
    obsidianRemoveVaultConfirm: '从已连接仓库列表中移除“{name}”吗？硬盘上的笔记文件不会被删除。',
    koreanLawDesc: '使用国家法令信息中心公开 API 搜索韩国法规与判例。',
    koreanLawNotice: '此服务通过本机上的第三方开源包运行。添加后需先检查并允许运行命令。',
    koreanLawKeyLabel: '国家法令信息中心 OC 邮箱前缀 (LAW_OC)',
    koreanLawKeyHint: '填写注册邮箱中 @ 之前的部分。',
    koreanLawGuideLink: '前往国家法令信息中心申请 LAW_OC',
    kordocDesc: '在本机直接读写和转换 HWP / HWPX 文档。',
    kordocNotice:
      '此服务通过本机上的第三方开源包直接读写磁盘文件。编辑器中的遮盖（隐私隐藏）不会应用于 kordoc 直接读取的文件。',
  },
  en: {
    sectionTitle: 'Connected services',
    customTitle: 'Other MCP servers',
    connect: 'Connect',
    disconnect: 'Disconnect',
    disconnectConfirm: 'Disconnect {name} and remove all saved credentials and settings for it?',
    showTools: 'Tools & settings',
    hideTools: 'Hide',
    continueSignIn: 'Sign in with browser',
    registerAndReview: 'Add and review command',
    thirdPartyNote: 'Operated by an independent third party and not affiliated with GenOffice.',
    notionDesc: 'Search and read Notion pages, or attach pages directly in the AI panel.',
    notionNotice:
      'When the AI uses Notion tools, queries and selected text are sent to Notion, and returned content enters the AI chat.',
    canvaDesc:
      'Import or open your Canva designs in tabs, or create new Canva designs from your document.',
    canvaNotice:
      'When the AI uses Canva tools, queries and selected text are sent to Canva, and returned content enters the AI chat.',
    obsidianName: 'Obsidian Vault',
    obsidianDesc:
      'Reads and edits local .md notes directly without running Obsidian or creating any extra files in your vault.',
    obsidianAddVault: 'Add vault folder',
    obsidianVaultCount: '{n} vault(s) connected',
    obsidianMissingDirConfirm:
      'The folder “{name}” has no .obsidian folder. Connect it as a regular Markdown folder anyway?',
    obsidianConnectAnyway: 'Connect anyway',
    obsidianForbidden:
      'System, home, and app data folders cannot be added. Pick a specific notes folder.',
    obsidianDuplicate: 'This folder is already added as a vault.',
    obsidianRename: 'Rename',
    obsidianRemoveVault: 'Remove',
    obsidianRemoveVaultConfirm:
      'Remove “{name}” from connected vaults? Your note files on disk will not be deleted.',
    koreanLawDesc:
      'Search Korean statutes and case law via the National Law Information Center API.',
    koreanLawNotice:
      'Runs a third-party open-source package on this PC. After adding it, review and allow the exact command before it runs.',
    koreanLawKeyLabel: 'National Law Information Center OC ID (LAW_OC)',
    koreanLawKeyHint: 'Enter the part before @ in your registered email address.',
    koreanLawGuideLink: 'Get LAW_OC at open.law.go.kr',
    kordocDesc: 'Read, edit, and convert local HWP / HWPX files directly on this PC.',
    kordocNotice:
      'Runs a third-party open-source package that reads and writes files directly on disk. Editor redaction does not apply to files read directly by kordoc.',
  },
  ko: {
    sectionTitle: '연결한 서비스',
    customTitle: '직접 추가한 MCP 서버',
    connect: '연결',
    disconnect: '연결 끊기',
    disconnectConfirm: '{name} 연결을 끊고 저장된 로그인·열쇠·설정을 모두 지울까요?',
    showTools: '도구 · 설정',
    hideTools: '접기',
    continueSignIn: '브라우저로 로그인',
    registerAndReview: '등록하고 실행 확인',
    thirdPartyNote: '제3자가 운영하는 외부 서비스이며 GenOffice와 제휴 관계가 아닙니다.',
    notionDesc: 'Notion 페이지를 검색·열람하고 AI 창에서 바로 첨부합니다.',
    notionNotice:
      'AI가 Notion 도구를 부르면 검색어와 선택한 내용이 Notion으로 전송되며, 받아 온 내용이 AI 대화에 들어갑니다.',
    canvaDesc:
      '내 Canva 디자인을 첨부하거나 탭으로 열고, 작성 중인 문서로 Canva 디자인을 만듭니다.',
    canvaNotice:
      'AI가 Canva 도구를 부르면 검색어와 선택한 내용이 Canva로 전송되며, 받아 온 내용이 AI 대화에 들어갑니다.',
    obsidianName: 'Obsidian 볼트',
    obsidianDesc:
      'Obsidian 앱 없이 로컬 .md 노트를 직접 읽고 고칩니다. 볼트 폴더 안에 관리 파일을 만들지 않습니다.',
    obsidianAddVault: '볼트 폴더 추가',
    obsidianVaultCount: '연결된 볼트 {n}개',
    obsidianMissingDirConfirm:
      '고른 폴더 “{name}”에 .obsidian 폴더가 없습니다. 일반 마크다운 폴더로 연결할까요?',
    obsidianConnectAnyway: '그래도 연결',
    obsidianForbidden:
      '시스템 폴더·사용자 홈·앱 데이터 폴더는 등록할 수 없습니다. 노트 폴더를 고르세요.',
    obsidianDuplicate: '이미 등록된 볼트 폴더입니다.',
    obsidianRename: '이름 바꾸기',
    obsidianRemoveVault: '제거',
    obsidianRemoveVaultConfirm:
      '“{name}” 볼트 연결을 제거할까요? PC에 있는 노트 파일은 지워지지 않습니다.',
    koreanLawDesc: '국가법령정보센터 공개 API로 대한민국 법령·판례를 검색합니다.',
    koreanLawNotice:
      '이 PC에서 제3자 오픈소스 패키지를 실행합니다. 등록한 뒤 아래 실행 명령을 확인하고 허락해야 동작합니다.',
    koreanLawKeyLabel: '국가법령정보센터 OC 아이디 (LAW_OC)',
    koreanLawKeyHint: '가입한 이메일의 @ 앞부분을 입력하세요.',
    koreanLawGuideLink: '국가법령정보센터(open.law.go.kr)에서 LAW_OC 발급받기',
    kordocDesc: '이 PC의 HWP / HWPX 문서를 직접 읽고 변환·편집합니다.',
    kordocNotice:
      '제3자 오픈소스 패키지가 디스크의 파일을 직접 읽고 씁니다. 편집기에서 지정한 가리기(민감 정보 숨김)는 kordoc이 직접 읽는 파일에는 적용되지 않습니다.',
  },
  ja: {
    sectionTitle: '連携サービス',
    customTitle: 'その他の MCP サーバー',
    connect: '接続',
    disconnect: '接続解除',
    disconnectConfirm: '{name} の接続を解除し、保存された認証情報と設定をすべて削除しますか？',
    showTools: 'ツールと設定',
    hideTools: '閉じる',
    continueSignIn: 'ブラウザーでサインイン',
    registerAndReview: '登録してコマンドを確認',
    thirdPartyNote: '独立した第三者が運営するサービスであり、GenOffice と提携していません。',
    notionDesc: 'Notion ページを検索・閲覧し、AI パネルに直接添付します。',
    notionNotice:
      'AI が Notion ツールを使うと、検索語や選択したテキストが Notion に送信され、結果が AI 会話に渡されます。',
    canvaDesc:
      '自分の Canva デザインを添付・タブで開くほか、作成中の文書から Canva デザインを作成します。',
    canvaNotice:
      'AI が Canva ツールを使うと、検索語や選択したテキストが Canva に送信され、結果が AI 会話に渡されます。',
    obsidianName: 'Obsidian 保管庫',
    obsidianDesc:
      'Obsidian を起動せずローカルの .md ノートを直接読み書きします。保管庫内に管理ファイルは作成しません。',
    obsidianAddVault: '保管庫フォルダーを追加',
    obsidianVaultCount: '{n} 件の保管庫を接続中',
    obsidianMissingDirConfirm:
      '「{name}」に .obsidian フォルダーがありません。通常の Markdown フォルダーとして接続しますか？',
    obsidianConnectAnyway: 'このまま接続',
    obsidianForbidden:
      'システム、ホーム、アプリデータのフォルダーは登録できません。ノート用フォルダーを選んでください。',
    obsidianDuplicate: 'このフォルダーはすでに登録されています。',
    obsidianRename: '名前を変更',
    obsidianRemoveVault: '削除',
    obsidianRemoveVaultConfirm:
      '「{name}」の連携を解除しますか？ディスク上のノートファイルは削除されません。',
    koreanLawDesc: '韓国の国家法令情報センター公開 API で法令・判例を検索します。',
    koreanLawNotice:
      'この PC 上でサードパーティ製オープンソースパッケージを実行します。登録後、実行コマンドを確認して許可してください。',
    koreanLawKeyLabel: '国家法令情報センター OC ID (LAW_OC)',
    koreanLawKeyHint: '登録メールアドレスの @ より前の部分を入力します。',
    koreanLawGuideLink: 'open.law.go.kr で LAW_OC を取得',
    kordocDesc: 'この PC 上の HWP / HWPX ファイルを直接読み書き・変換します。',
    kordocNotice:
      'サードパーティ製パッケージがディスクのファイルを直接読み書きします。エディターの墨消し（マスキング）は kordoc 経由の読み取りには適用されません。',
  },
  fr: {
    sectionTitle: 'Services connectés',
    customTitle: 'Autres serveurs MCP',
    connect: 'Connecter',
    disconnect: 'Déconnecter',
    disconnectConfirm: 'Déconnecter {name} et supprimer tous ses identifiants enregistrés ?',
    showTools: 'Outils et paramètres',
    hideTools: 'Masquer',
    continueSignIn: 'Se connecter via le navigateur',
    registerAndReview: 'Ajouter et vérifier la commande',
    thirdPartyNote: 'Exploité par un tiers indépendant, sans affiliation avec GenOffice.',
    notionDesc: 'Rechercher et lire des pages Notion, ou les joindre dans le panneau IA.',
    notionNotice:
      'Lorsque l’IA utilise les outils Notion, les requêtes et textes sélectionnés sont envoyés à Notion et les réponses reviennent dans le chat.',
    canvaDesc:
      'Importez ou ouvrez vos designs Canva dans un onglet, ou créez-en à partir de votre document.',
    canvaNotice:
      'Lorsque l’IA utilise les outils Canva, les requêtes et textes sélectionnés sont envoyés à Canva et les réponses reviennent dans le chat.',
    obsidianName: 'Coffre Obsidian',
    obsidianDesc:
      'Lit et modifie vos notes .md locales sans lancer Obsidian ni créer de fichiers de gestion dans le coffre.',
    obsidianAddVault: 'Ajouter un coffre',
    obsidianVaultCount: '{n} coffre(s) connecté(s)',
    obsidianMissingDirConfirm:
      'Le dossier « {name} » ne contient pas de dossier .obsidian. Le connecter comme dossier Markdown classique ?',
    obsidianConnectAnyway: 'Connecter quand même',
    obsidianForbidden:
      'Les dossiers système, personnels ou de données d’application ne peuvent pas être ajoutés.',
    obsidianDuplicate: 'Ce dossier est déjà ajouté comme coffre.',
    obsidianRename: 'Renommer',
    obsidianRemoveVault: 'Retirer',
    obsidianRemoveVaultConfirm:
      'Retirer « {name} » des coffres connectés ? Vos fichiers de notes sur le disque ne seront pas supprimés.',
    koreanLawDesc: 'Rechercher la législation et la jurisprudence coréennes via l’API publique.',
    koreanLawNotice:
      'Exécute un paquet open-source tiers sur ce PC. Vérifiez et autorisez la commande avant exécution.',
    koreanLawKeyLabel: 'Identifiant OC (LAW_OC)',
    koreanLawKeyHint: 'Saisissez la partie avant @ de votre adresse e-mail enregistrée.',
    koreanLawGuideLink: 'Obtenir LAW_OC sur open.law.go.kr',
    kordocDesc: 'Lire, modifier et convertir directement les fichiers HWP / HWPX locaux.',
    kordocNotice:
      'Un paquet tiers lit et écrit directement sur le disque. Le masquage de l’éditeur ne s’applique pas aux fichiers lus par kordoc.',
  },
  de: {
    sectionTitle: 'Verbundene Dienste',
    customTitle: 'Weitere MCP-Server',
    connect: 'Verbinden',
    disconnect: 'Trennen',
    disconnectConfirm:
      '{name} trennen und alle gespeicherten Zugangsdaten und Einstellungen löschen?',
    showTools: 'Werkzeuge & Einstellungen',
    hideTools: 'Ausblenden',
    continueSignIn: 'Im Browser anmelden',
    registerAndReview: 'Hinzufügen und Befehl prüfen',
    thirdPartyNote:
      'Wird von einem unabhängigen Drittanbieter betrieben, nicht mit GenOffice verbunden.',
    notionDesc: 'Notion-Seiten durchsuchen, lesen oder direkt im KI-Panel anhängen.',
    notionNotice:
      'Wenn die KI Notion-Werkzeuge nutzt, werden Suchbegriffe und gewählter Text an Notion gesendet und Antworten in den Chat übernommen.',
    canvaDesc:
      'Eigene Canva-Designs importieren oder in Tabs öffnen und neue Designs aus Ihrem Dokument erstellen.',
    canvaNotice:
      'Wenn die KI Canva-Werkzeuge nutzt, werden Suchbegriffe und gewählter Text an Canva gesendet und Antworten in den Chat übernommen.',
    obsidianName: 'Obsidian-Vault',
    obsidianDesc:
      'Liest und bearbeitet lokale .md-Notizen direkt ohne Obsidian-App und ohne zusätzliche Dateien im Vault.',
    obsidianAddVault: 'Vault-Ordner hinzufügen',
    obsidianVaultCount: '{n} Vault(s) verbunden',
    obsidianMissingDirConfirm:
      'Der Ordner „{name}“ enthält keinen .obsidian-Ordner. Trotzdem als normalen Markdown-Ordner verbinden?',
    obsidianConnectAnyway: 'Trotzdem verbinden',
    obsidianForbidden:
      'System-, Benutzer- und App-Datenordner können nicht hinzugefügt werden. Wählen Sie einen Notizordner.',
    obsidianDuplicate: 'Dieser Ordner ist bereits als Vault hinzugefügt.',
    obsidianRename: 'Umbenennen',
    obsidianRemoveVault: 'Entfernen',
    obsidianRemoveVaultConfirm:
      '„{name}“ aus den verbundenen Vaults entfernen? Die Notizdateien auf der Festplatte bleiben erhalten.',
    koreanLawDesc: 'Koreanische Gesetze und Urteile über die öffentliche API durchsuchen.',
    koreanLawNotice:
      'Führt ein Open-Source-Paket eines Drittanbieters auf diesem PC aus. Prüfen und erlauben Sie danach den Befehl.',
    koreanLawKeyLabel: 'OC-Kennung (LAW_OC)',
    koreanLawKeyHint: 'Geben Sie den Teil vor @ Ihrer registrierten E-Mail-Adresse ein.',
    koreanLawGuideLink: 'LAW_OC auf open.law.go.kr anfordern',
    kordocDesc: 'Lokale HWP-/HWPX-Dateien direkt auf diesem PC lesen, bearbeiten und konvertieren.',
    kordocNotice:
      'Ein Drittanbieter-Paket liest und schreibt Dateien direkt auf der Festplatte. Editor-Schwärzungen gelten nicht für Dateien, die kordoc direkt liest.',
  },
  es: {
    sectionTitle: 'Servicios conectados',
    customTitle: 'Otros servidores MCP',
    connect: 'Conectar',
    disconnect: 'Desconectar',
    disconnectConfirm: '¿Desconectar {name} y eliminar todas sus credenciales y ajustes guardados?',
    showTools: 'Herramientas y ajustes',
    hideTools: 'Ocultar',
    continueSignIn: 'Iniciar sesión en el navegador',
    registerAndReview: 'Añadir y revisar comando',
    thirdPartyNote: 'Operado por un tercero independiente y no afiliado a GenOffice.',
    notionDesc: 'Busca y lee páginas de Notion, o adjúntalas directamente en el panel de IA.',
    notionNotice:
      'Cuando la IA usa herramientas de Notion, las consultas y el texto seleccionado se envían a Notion y el resultado vuelve al chat.',
    canvaDesc:
      'Importa o abre tus diseños de Canva en pestañas, o crea nuevos diseños desde tu documento.',
    canvaNotice:
      'Cuando la IA usa herramientas de Canva, las consultas y el texto seleccionado se envían a Canva y el resultado vuelve al chat.',
    obsidianName: 'Bóveda de Obsidian',
    obsidianDesc:
      'Lee y edita notas .md locales directamente sin ejecutar Obsidian ni crear archivos adicionales en tu bóveda.',
    obsidianAddVault: 'Añadir carpeta de bóveda',
    obsidianVaultCount: '{n} bóveda(s) conectada(s)',
    obsidianMissingDirConfirm:
      'La carpeta «{name}» no tiene una carpeta .obsidian. ¿Conectarla igualmente como carpeta Markdown?',
    obsidianConnectAnyway: 'Conectar de todos modos',
    obsidianForbidden:
      'No se pueden añadir carpetas del sistema, de usuario ni de datos de la aplicación.',
    obsidianDuplicate: 'Esta carpeta ya está añadida como bóveda.',
    obsidianRename: 'Renombrar',
    obsidianRemoveVault: 'Quitar',
    obsidianRemoveVaultConfirm:
      '¿Quitar «{name}» de las bóvedas conectadas? Tus archivos de notas en el disco no se eliminarán.',
    koreanLawDesc: 'Busca leyes y jurisprudencia coreanas mediante la API pública.',
    koreanLawNotice:
      'Ejecuta un paquete de código abierto de terceros en este PC. Después de añadirlo, revisa y permite el comando.',
    koreanLawKeyLabel: 'ID OC (LAW_OC)',
    koreanLawKeyHint: 'Introduce la parte anterior a @ de tu correo registrado.',
    koreanLawGuideLink: 'Obtener LAW_OC en open.law.go.kr',
    kordocDesc: 'Lee, edita y convierte archivos HWP / HWPX locales directamente en este PC.',
    kordocNotice:
      'Un paquete de terceros lee y escribe archivos directamente en el disco. El ocultado del editor no se aplica a los archivos que lee kordoc.',
  },
  th: {
    sectionTitle: 'บริการที่เชื่อมต่อ',
    customTitle: 'เซิร์ฟเวอร์ MCP อื่น ๆ',
    connect: 'เชื่อมต่อ',
    disconnect: 'ยกเลิกการเชื่อมต่อ',
    disconnectConfirm:
      'ยกเลิกการเชื่อมต่อ {name} และลบข้อมูลรับรองกับการตั้งค่าที่บันทึกไว้ทั้งหมดหรือไม่?',
    showTools: 'เครื่องมือและการตั้งค่า',
    hideTools: 'ซ่อน',
    continueSignIn: 'ลงชื่อเข้าใช้ด้วยเบราว์เซอร์',
    registerAndReview: 'เพิ่มและตรวจสอบคำสั่ง',
    thirdPartyNote: 'ดำเนินการโดยบุคคลที่สามและไม่มีส่วนเกี่ยวข้องกับ GenOffice',
    notionDesc: 'ค้นหาและอ่านหน้า Notion หรือแนบหน้าโดยตรงในแผง AI',
    notionNotice:
      'เมื่อ AI ใช้เครื่องมือ Notion คำค้นหาและข้อความที่เลือกจะถูกส่งไปยัง Notion และผลลัพธ์จะกลับเข้าสู่แชท AI',
    canvaDesc: 'นำเข้าหรือเปิดงานออกแบบ Canva ของคุณในแท็บ หรือสร้างงานออกแบบใหม่จากเอกสารของคุณ',
    canvaNotice:
      'เมื่อ AI ใช้เครื่องมือ Canva คำค้นหาและข้อความที่เลือกจะถูกส่งไปยัง Canva และผลลัพธ์จะกลับเข้าสู่แชท AI',
    obsidianName: 'คลัง Obsidian',
    obsidianDesc:
      'อ่านและแก้ไขโน้ต .md ในเครื่องโดยตรงโดยไม่ต้องเปิด Obsidian และไม่สร้างไฟล์จัดการเพิ่มในคลัง',
    obsidianAddVault: 'เพิ่มโฟลเดอร์คลัง',
    obsidianVaultCount: 'เชื่อมต่อแล้ว {n} คลัง',
    obsidianMissingDirConfirm:
      'โฟลเดอร์ “{name}” ไม่มีโฟลเดอร์ .obsidian ต้องการเชื่อมต่อเป็นโฟลเดอร์ Markdown ทั่วไปหรือไม่?',
    obsidianConnectAnyway: 'เชื่อมต่อต่อไป',
    obsidianForbidden: 'ไม่สามารถเพิ่มโฟลเดอร์ระบบ โฟลเดอร์หลัก หรือโฟลเดอร์ข้อมูลแอปได้',
    obsidianDuplicate: 'เพิ่มโฟลเดอร์นี้เป็นคลังแล้ว',
    obsidianRename: 'เปลี่ยนชื่อ',
    obsidianRemoveVault: 'นำออก',
    obsidianRemoveVaultConfirm:
      'นำ “{name}” ออกจากรายการคลังที่เชื่อมต่อหรือไม่? ไฟล์โน้ตบนดิสก์จะไม่ถูกลบ',
    koreanLawDesc: 'ค้นหากฎหมายและคำพิพากษาเกาหลีผ่าน API สาธารณะ',
    koreanLawNotice:
      'รันแพ็กเกจโอเพนซอร์สของบุคคลที่สามบนพีซีนี้ หลังเพิ่มแล้วโปรดตรวจสอบและอนุญาตคำสั่งก่อนใช้งาน',
    koreanLawKeyLabel: 'รหัส OC (LAW_OC)',
    koreanLawKeyHint: 'กรอกส่วนหน้าเครื่องหมาย @ ของอีเมลที่ลงทะเบียนไว้',
    koreanLawGuideLink: 'รับ LAW_OC ที่ open.law.go.kr',
    kordocDesc: 'อ่าน แก้ไข และแปลงไฟล์ HWP / HWPX ในเครื่องโดยตรง',
    kordocNotice:
      'แพ็กเกจของบุคคลที่สามจะอ่านและเขียนไฟล์บนดิสก์โดยตรง การปกปิดข้อมูลในตัวแก้ไขจะไม่ถูกใช้กับไฟล์ที่ kordoc อ่านโดยตรง',
  },
  id: {
    sectionTitle: 'Layanan terhubung',
    customTitle: 'Server MCP lainnya',
    connect: 'Hubungkan',
    disconnect: 'Putuskan',
    disconnectConfirm: 'Putuskan {name} dan hapus semua kredensial serta pengaturan tersimpan?',
    showTools: 'Alat & pengaturan',
    hideTools: 'Sembunyikan',
    continueSignIn: 'Masuk lewat browser',
    registerAndReview: 'Tambahkan dan tinjau perintah',
    thirdPartyNote:
      'Dioperasikan oleh pihak ketiga independen dan tidak berafiliasi dengan GenOffice.',
    notionDesc: 'Cari dan baca halaman Notion, atau lampirkan langsung di panel AI.',
    notionNotice:
      'Saat AI memakai alat Notion, kueri dan teks pilihan dikirim ke Notion dan hasilnya masuk ke obrolan AI.',
    canvaDesc:
      'Impor atau buka desain Canva Anda di tab, atau buat desain Canva baru dari dokumen Anda.',
    canvaNotice:
      'Saat AI memakai alat Canva, kueri dan teks pilihan dikirim ke Canva dan hasilnya masuk ke obrolan AI.',
    obsidianName: 'Brankas Obsidian',
    obsidianDesc:
      'Membaca dan mengedit catatan .md lokal langsung tanpa aplikasi Obsidian dan tanpa membuat file tambahan di brankas.',
    obsidianAddVault: 'Tambah folder brankas',
    obsidianVaultCount: '{n} brankas terhubung',
    obsidianMissingDirConfirm:
      'Folder “{name}” tidak memiliki folder .obsidian. Tetap hubungkan sebagai folder Markdown biasa?',
    obsidianConnectAnyway: 'Tetap hubungkan',
    obsidianForbidden:
      'Folder sistem, folder beranda, dan folder data aplikasi tidak dapat ditambahkan.',
    obsidianDuplicate: 'Folder ini sudah ditambahkan sebagai brankas.',
    obsidianRename: 'Ubah nama',
    obsidianRemoveVault: 'Hapus',
    obsidianRemoveVaultConfirm:
      'Hapus “{name}” dari brankas terhubung? File catatan Anda di disk tidak akan dihapus.',
    koreanLawDesc: 'Cari peraturan dan yurisprudensi Korea melalui API publik.',
    koreanLawNotice:
      'Menjalankan paket sumber terbuka pihak ketiga di PC ini. Tinjau dan izinkan perintahnya setelah menambahkan.',
    koreanLawKeyLabel: 'ID OC (LAW_OC)',
    koreanLawKeyHint: 'Masukkan bagian sebelum @ dari alamat email terdaftar Anda.',
    koreanLawGuideLink: 'Dapatkan LAW_OC di open.law.go.kr',
    kordocDesc: 'Baca, edit, dan konversi file HWP / HWPX lokal langsung di PC ini.',
    kordocNotice:
      'Paket pihak ketiga membaca dan menulis file langsung di disk. Penyembunyian teks editor tidak berlaku pada file yang dibaca langsung oleh kordoc.',
  },
  ru: {
    sectionTitle: 'Подключённые сервисы',
    customTitle: 'Другие серверы MCP',
    connect: 'Подключить',
    disconnect: 'Отключить',
    disconnectConfirm: 'Отключить {name} и удалить все сохранённые учётные данные и настройки?',
    showTools: 'Инструменты и настройки',
    hideTools: 'Скрыть',
    continueSignIn: 'Войти через браузер',
    registerAndReview: 'Добавить и проверить команду',
    thirdPartyNote: 'Сервис управляется независимой стороной и не связан с GenOffice.',
    notionDesc: 'Поиск и чтение страниц Notion, а также прямое прикрепление в панели ИИ.',
    notionNotice:
      'Когда ИИ вызывает инструменты Notion, запросы и выбранный текст отправляются в Notion, а ответ поступает в чат ИИ.',
    canvaDesc:
      'Импортируйте или открывайте свои дизайны Canva во вкладках и создавайте новые из документа.',
    canvaNotice:
      'Когда ИИ вызывает инструменты Canva, запросы и выбранный текст отправляются в Canva, а ответ поступает в чат ИИ.',
    obsidianName: 'Хранилище Obsidian',
    obsidianDesc:
      'Читает и редактирует локальные заметки .md напрямую без запуска Obsidian и не создаёт служебных файлов.',
    obsidianAddVault: 'Добавить папку хранилища',
    obsidianVaultCount: 'Подключено хранилищ: {n}',
    obsidianMissingDirConfirm:
      'В папке «{name}» нет папки .obsidian. Всё равно подключить её как обычную папку Markdown?',
    obsidianConnectAnyway: 'Подключить всё равно',
    obsidianForbidden:
      'Нельзя добавлять системные папки, домашнюю папку или папку данных приложения.',
    obsidianDuplicate: 'Эта папка уже добавлена как хранилище.',
    obsidianRename: 'Переименовать',
    obsidianRemoveVault: 'Убрать',
    obsidianRemoveVaultConfirm:
      'Убрать «{name}» из подключённых хранилищ? Файлы заметок на диске не будут удалены.',
    koreanLawDesc: 'Поиск корейских законов и судебной практики через открытый API.',
    koreanLawNotice:
      'Запускает сторонний пакет с открытым исходным кодом на этом ПК. После добавления проверьте и разрешите команду.',
    koreanLawKeyLabel: 'Идентификатор OC (LAW_OC)',
    koreanLawKeyHint: 'Введите часть адреса электронной почты до символа @.',
    koreanLawGuideLink: 'Получить LAW_OC на open.law.go.kr',
    kordocDesc: 'Чтение, редактирование и конвертация локальных файлов HWP / HWPX на этом ПК.',
    kordocNotice:
      'Сторонний пакет читает и записывает файлы напрямую на диске. Скрытие данных в редакторе не применяется к файлам, читаемым kordoc.',
  },
  ar: {
    sectionTitle: 'الخدمات المتصلة',
    customTitle: 'خوادم MCP أخرى',
    connect: 'اتصال',
    disconnect: 'قطع الاتصال',
    disconnectConfirm: 'هل تريد قطع اتصال {name} وإزالة جميع بيانات الاعتماد والإعدادات المحفوظة؟',
    showTools: 'الأدوات والإعدادات',
    hideTools: 'إخفاء',
    continueSignIn: 'تسجيل الدخول عبر المتصفح',
    registerAndReview: 'إضافة ومراجعة الأمر',
    thirdPartyNote: 'تُشغَّل هذه الخدمة بواسطة طرف ثالث مستقل ولا تتبع GenOffice.',
    notionDesc: 'البحث في صفحات Notion وقراءتها، أو إرفاقها مباشرة في لوحة الذكاء الاصطناعي.',
    notionNotice:
      'عندما يستخدم الذكاء الاصطناعي أدوات Notion، تُرسل الاستعلامات والنصوص المحددة إلى Notion وتدخل النتائج إلى المحادثة.',
    canvaDesc: 'استيراد تصاميم Canva الخاصة بك أو فتحها في تبويب، أو إنشاء تصاميم جديدة من مستندك.',
    canvaNotice:
      'عندما يستخدم الذكاء الاصطناعي أدوات Canva، تُرسل الاستعلامات والنصوص المحددة إلى Canva وتدخل النتائج إلى المحادثة.',
    obsidianName: 'خزينة Obsidian',
    obsidianDesc:
      'يقرأ ويعدّل ملاحظات .md المحلية مباشرة دون تشغيل Obsidian ودون إنشاء أي ملفات إضافية في الخزينة.',
    obsidianAddVault: 'إضافة مجلد خزينة',
    obsidianVaultCount: '{n} خزينة متصلة',
    obsidianMissingDirConfirm:
      'لا يحتوي المجلد «{name}» على مجلد .obsidian. هل تريد توصيله كمجلد Markdown عادي؟',
    obsidianConnectAnyway: 'التوصيل على أي حال',
    obsidianForbidden: 'لا يمكن إضافة مجلدات النظام أو المجلد الرئيسي أو مجلد بيانات التطبيق.',
    obsidianDuplicate: 'تمت إضافة هذا المجلد كخزينة بالفعل.',
    obsidianRename: 'إعادة تسمية',
    obsidianRemoveVault: 'إزالة',
    obsidianRemoveVaultConfirm:
      'هل تريد إزالة «{name}» من الخزائن المتصلة؟ لن يتم حذف ملفات الملاحظات من القرص.',
    koreanLawDesc: 'البحث في القوانين والسوابق الكورية عبر واجهة برمجة التطبيقات العامة.',
    koreanLawNotice:
      'يُشغِّل حزمة مفتوحة المصدر من طرف ثالث على هذا الحاسوب. راجع الأمر واسمح بتشغيله بعد الإضافة.',
    koreanLawKeyLabel: 'معرّف OC‏ (LAW_OC)',
    koreanLawKeyHint: 'أدخل الجزء الذي يسبق @ في بريدك الإلكتروني المسجّل.',
    koreanLawGuideLink: 'الحصول على LAW_OC من open.law.go.kr',
    kordocDesc: 'قراءة وتعديل وتحويل ملفات HWP / HWPX المحلية مباشرة على هذا الحاسوب.',
    kordocNotice:
      'تقرأ حزمة الطرف الثالث الملفات وتكتبها مباشرة على القرص. لا ينطبق إخفاء البيانات في المحرر على الملفات التي يقرؤها kordoc مباشرة.',
  },
  pt: {
    sectionTitle: 'Serviços conectados',
    customTitle: 'Outros servidores MCP',
    connect: 'Conectar',
    disconnect: 'Desconectar',
    disconnectConfirm: 'Desconectar {name} e remover todas as credenciais e configurações salvas?',
    showTools: 'Ferramentas e configurações',
    hideTools: 'Ocultar',
    continueSignIn: 'Entrar pelo navegador',
    registerAndReview: 'Adicionar e revisar comando',
    thirdPartyNote: 'Operado por um terceiro independente e sem vínculo com o GenOffice.',
    notionDesc: 'Pesquise e leia páginas do Notion ou anexe-as diretamente no painel de IA.',
    notionNotice:
      'Quando a IA usa ferramentas do Notion, consultas e textos selecionados são enviados ao Notion e as respostas entram no chat.',
    canvaDesc:
      'Importe ou abra seus designs do Canva em abas, ou crie novos designs a partir do documento.',
    canvaNotice:
      'Quando a IA usa ferramentas do Canva, consultas e textos selecionados são enviados ao Canva e as respostas entram no chat.',
    obsidianName: 'Cofre Obsidian',
    obsidianDesc:
      'Lê e edita notas .md locais diretamente sem abrir o Obsidian e sem criar arquivos extras no cofre.',
    obsidianAddVault: 'Adicionar pasta de cofre',
    obsidianVaultCount: '{n} cofre(s) conectado(s)',
    obsidianMissingDirConfirm:
      'A pasta “{name}” não tem uma pasta .obsidian. Conectar mesmo assim como pasta Markdown?',
    obsidianConnectAnyway: 'Conectar mesmo assim',
    obsidianForbidden:
      'Pastas do sistema, pasta pessoal e pastas de dados do app não podem ser adicionadas.',
    obsidianDuplicate: 'Esta pasta já foi adicionada como cofre.',
    obsidianRename: 'Renomear',
    obsidianRemoveVault: 'Remover',
    obsidianRemoveVaultConfirm:
      'Remover “{name}” dos cofres conectados? Seus arquivos de notas no disco não serão apagados.',
    koreanLawDesc: 'Pesquise leis e jurisprudência coreanas pela API pública.',
    koreanLawNotice:
      'Executa um pacote de código aberto de terceiros neste PC. Após adicionar, revise e permita o comando.',
    koreanLawKeyLabel: 'ID OC (LAW_OC)',
    koreanLawKeyHint: 'Digite a parte antes de @ do seu e-mail cadastrado.',
    koreanLawGuideLink: 'Obter LAW_OC em open.law.go.kr',
    kordocDesc: 'Leia, edite e converta arquivos HWP / HWPX locais diretamente neste PC.',
    kordocNotice:
      'Um pacote de terceiros lê e grava arquivos diretamente no disco. A ocultação do editor não se aplica aos arquivos lidos diretamente pelo kordoc.',
  },
  it: {
    sectionTitle: 'Servizi connessi',
    customTitle: 'Altri server MCP',
    connect: 'Connetti',
    disconnect: 'Disconnetti',
    disconnectConfirm:
      'Disconnettere {name} e rimuovere tutte le credenziali e impostazioni salvate?',
    showTools: 'Strumenti e impostazioni',
    hideTools: 'Nascondi',
    continueSignIn: 'Accedi dal browser',
    registerAndReview: 'Aggiungi e verifica comando',
    thirdPartyNote: 'Gestito da una terza parte indipendente e non affiliato a GenOffice.',
    notionDesc: 'Cerca e leggi pagine Notion o allegale direttamente nel pannello IA.',
    notionNotice:
      'Quando l’IA usa gli strumenti Notion, le query e il testo selezionato vengono inviati a Notion e i risultati tornano nella chat.',
    canvaDesc:
      'Importa o apri i tuoi progetti Canva in schede, oppure crea nuovi progetti dal tuo documento.',
    canvaNotice:
      'Quando l’IA usa gli strumenti Canva, le query e il testo selezionato vengono inviati a Canva e i risultati tornano nella chat.',
    obsidianName: 'Vault Obsidian',
    obsidianDesc:
      'Legge e modifica le note .md locali senza avviare Obsidian e senza creare file extra nel vault.',
    obsidianAddVault: 'Aggiungi cartella vault',
    obsidianVaultCount: '{n} vault connessi',
    obsidianMissingDirConfirm:
      'La cartella «{name}» non contiene una cartella .obsidian. Connetterla comunque come cartella Markdown?',
    obsidianConnectAnyway: 'Connetti comunque',
    obsidianForbidden:
      'Le cartelle di sistema, home o dei dati dell’app non possono essere aggiunte.',
    obsidianDuplicate: 'Questa cartella è già stata aggiunta come vault.',
    obsidianRename: 'Rinomina',
    obsidianRemoveVault: 'Rimuovi',
    obsidianRemoveVaultConfirm:
      'Rimuovere «{name}» dai vault connessi? I file delle note sul disco non verranno eliminati.',
    koreanLawDesc: 'Cerca leggi e sentenze coreane tramite l’API pubblica.',
    koreanLawNotice:
      'Esegue un pacchetto open-source di terze parti su questo PC. Dopo l’aggiunta, controlla e consenti il comando.',
    koreanLawKeyLabel: 'ID OC (LAW_OC)',
    koreanLawKeyHint: 'Inserisci la parte prima di @ della tua email registrata.',
    koreanLawGuideLink: 'Ottieni LAW_OC su open.law.go.kr',
    kordocDesc: 'Leggi, modifica e converti direttamente file HWP / HWPX locali su questo PC.',
    kordocNotice:
      'Un pacchetto di terze parti legge e scrive direttamente su disco. L’oscuramento dell’editor non si applica ai file letti da kordoc.',
  },
  pl: {
    sectionTitle: 'Połączone usługi',
    customTitle: 'Inne serwery MCP',
    connect: 'Połącz',
    disconnect: 'Rozłącz',
    disconnectConfirm:
      'Rozłączyć {name} i usunąć wszystkie zapisane dane logowania oraz ustawienia?',
    showTools: 'Narzędzia i ustawienia',
    hideTools: 'Ukryj',
    continueSignIn: 'Zaloguj w przeglądarce',
    registerAndReview: 'Dodaj i sprawdź polecenie',
    thirdPartyNote: 'Usługa prowadzona przez niezależny podmiot, bez powiązania z GenOffice.',
    notionDesc: 'Wyszukuj i czytaj strony Notion lub dołączaj je bezpośrednio w panelu AI.',
    notionNotice:
      'Gdy AI używa narzędzi Notion, zapytania i wybrany tekst są wysyłane do Notion, a wyniki trafiają do czatu AI.',
    canvaDesc:
      'Importuj lub otwieraj swoje projekty Canva w kartach albo twórz nowe z bieżącego dokumentu.',
    canvaNotice:
      'Gdy AI używa narzędzi Canva, zapytania i wybrany tekst są wysyłane do Canva, a wyniki trafiają do czatu AI.',
    obsidianName: 'Skarbiec Obsidian',
    obsidianDesc:
      'Czyta i edytuje lokalne notatki .md bez uruchamiania Obsidian i bez tworzenia dodatkowych plików w skarbcu.',
    obsidianAddVault: 'Dodaj folder skarbca',
    obsidianVaultCount: 'Połączone skarbce: {n}',
    obsidianMissingDirConfirm:
      'Folder „{name}” nie zawiera folderu .obsidian. Połączyć go mimo to jako zwykły folder Markdown?',
    obsidianConnectAnyway: 'Połącz mimo to',
    obsidianForbidden:
      'Nie można dodać folderów systemowych, folderu domowego ani folderu danych aplikacji.',
    obsidianDuplicate: 'Ten folder jest już dodany jako skarbiec.',
    obsidianRename: 'Zmień nazwę',
    obsidianRemoveVault: 'Usuń',
    obsidianRemoveVaultConfirm:
      'Usunąć „{name}” z połączonych skarbców? Pliki notatek na dysku nie zostaną usunięte.',
    koreanLawDesc: 'Wyszukuj koreańskie przepisy i orzecznictwo przez publiczne API.',
    koreanLawNotice:
      'Uruchamia zewnętrzny pakiet open-source na tym komputerze. Po dodaniu sprawdź i zezwól na polecenie.',
    koreanLawKeyLabel: 'Identyfikator OC (LAW_OC)',
    koreanLawKeyHint: 'Wpisz część przed @ zarejestrowanego adresu e-mail.',
    koreanLawGuideLink: 'Uzyskaj LAW_OC na open.law.go.kr',
    kordocDesc:
      'Czytaj, edytuj i konwertuj lokalne pliki HWP / HWPX bezpośrednio na tym komputerze.',
    kordocNotice:
      'Zewnętrzny pakiet czyta i zapisuje pliki bezpośrednio na dysku. Maskowanie w edytorze nie obejmuje plików czytanych bezpośrednio przez kordoc.',
  },
  cs: {
    sectionTitle: 'Připojené služby',
    customTitle: 'Další servery MCP',
    connect: 'Připojit',
    disconnect: 'Odpojit',
    disconnectConfirm: 'Odpojit {name} a odstranit všechny uložené přihlašovací údaje a nastavení?',
    showTools: 'Nástroje a nastavení',
    hideTools: 'Skrýt',
    continueSignIn: 'Přihlásit v prohlížeči',
    registerAndReview: 'Přidat a zkontrolovat příkaz',
    thirdPartyNote: 'Provozováno nezávislou třetí stranou bez spojení s GenOffice.',
    notionDesc: 'Vyhledávejte a čtěte stránky Notion nebo je připojujte přímo v panelu AI.',
    notionNotice:
      'Když AI používá nástroje Notion, dotazy a vybraný text se odesílají do Notion a výsledky se vrací do chatu.',
    canvaDesc:
      'Importujte nebo otevírejte své návrhy Canva na kartách, případně vytvářejte nové z dokumentu.',
    canvaNotice:
      'Když AI používá nástroje Canva, dotazy a vybraný text se odesílají do Canva a výsledky se vrací do chatu.',
    obsidianName: 'Trezor Obsidian',
    obsidianDesc:
      'Čte a upravuje místní poznámky .md přímo bez spuštění Obsidian a nevytváří v trezoru žádné soubory navíc.',
    obsidianAddVault: 'Přidat složku trezoru',
    obsidianVaultCount: 'Připojené trezory: {n}',
    obsidianMissingDirConfirm:
      'Složka „{name}“ neobsahuje složku .obsidian. Připojit ji i tak jako běžnou složku Markdown?',
    obsidianConnectAnyway: 'Přesto připojit',
    obsidianForbidden: 'Systémové složky, domovskou složku ani složku dat aplikace nelze přidat.',
    obsidianDuplicate: 'Tato složka je již přidána jako trezor.',
    obsidianRename: 'Přejmenovat',
    obsidianRemoveVault: 'Odebrat',
    obsidianRemoveVaultConfirm:
      'Odebrat „{name}“ z připojených trezorů? Soubory poznámek na disku nebudou smazány.',
    koreanLawDesc: 'Vyhledávejte korejské zákony a judikaturu přes veřejné API.',
    koreanLawNotice:
      'Spouští na tomto počítači open-source balíček třetí strany. Po přidání příkaz zkontrolujte a povolte.',
    koreanLawKeyLabel: 'OC ID (LAW_OC)',
    koreanLawKeyHint: 'Zadejte část před @ vaší registrované e-mailové adresy.',
    koreanLawGuideLink: 'Získat LAW_OC na open.law.go.kr',
    kordocDesc: 'Čtěte, upravujte a převádějte místní soubory HWP / HWPX přímo v tomto počítači.',
    kordocNotice:
      'Balíček třetí strany čte a zapisuje soubory přímo na disk. Skrývání údajů v editoru se nevztahuje na soubory čtené přímo nástrojem kordoc.',
  },
  nl: {
    sectionTitle: 'Verbonden services',
    customTitle: 'Andere MCP-servers',
    connect: 'Verbinden',
    disconnect: 'Verbinding verbreken',
    disconnectConfirm:
      '{name} loskoppelen en alle opgeslagen inloggegevens en instellingen verwijderen?',
    showTools: 'Hulpmiddelen & instellingen',
    hideTools: 'Verbergen',
    continueSignIn: 'Inloggen via browser',
    registerAndReview: 'Toevoegen en opdracht bekijken',
    thirdPartyNote: 'Beheerd door een onafhankelijke derde partij en niet gelieerd aan GenOffice.',
    notionDesc: 'Zoek en lees Notion-pagina’s of voeg ze direct bij in het AI-paneel.',
    notionNotice:
      'Wanneer de AI Notion-hulpmiddelen gebruikt, worden zoekopdrachten en geselecteerde tekst naar Notion gestuurd.',
    canvaDesc:
      'Importeer of open je eigen Canva-ontwerpen in tabbladen, of maak nieuwe vanuit je document.',
    canvaNotice:
      'Wanneer de AI Canva-hulpmiddelen gebruikt, worden zoekopdrachten en geselecteerde tekst naar Canva gestuurd.',
    obsidianName: 'Obsidian-kluis',
    obsidianDesc:
      'Leest en bewerkt lokale .md-notities direct zonder Obsidian te draaien en zonder extra bestanden in de kluis.',
    obsidianAddVault: 'Kluismap toevoegen',
    obsidianVaultCount: '{n} kluis(zen) verbonden',
    obsidianMissingDirConfirm:
      'De map “{name}” bevat geen .obsidian-map. Toch verbinden als gewone Markdown-map?',
    obsidianConnectAnyway: 'Toch verbinden',
    obsidianForbidden: 'Systeem-, gebruikers- en app-datamappen kunnen niet worden toegevoegd.',
    obsidianDuplicate: 'Deze map is al als kluis toegevoegd.',
    obsidianRename: 'Hernoemen',
    obsidianRemoveVault: 'Verwijderen',
    obsidianRemoveVaultConfirm:
      '“{name}” uit verbonden kluizen verwijderen? Je notitiebestanden op schijf blijven behouden.',
    koreanLawDesc: 'Zoek Koreaanse wetten en uitspraken via de openbare API.',
    koreanLawNotice:
      'Voert een open-sourcepakket van derden uit op deze pc. Controleer en sta de opdracht na toevoegen toe.',
    koreanLawKeyLabel: 'OC-ID (LAW_OC)',
    koreanLawKeyHint: 'Voer het deel vóór @ van je geregistreerde e-mailadres in.',
    koreanLawGuideLink: 'LAW_OC aanvragen op open.law.go.kr',
    kordocDesc: 'Lees, bewerk en converteer lokale HWP- / HWPX-bestanden direct op deze pc.',
    kordocNotice:
      'Een pakket van derden leest en schrijft bestanden direct op schijf. Redactie in de editor geldt niet voor bestanden die kordoc rechtstreeks leest.',
  },
  ms: {
    sectionTitle: 'Perkhidmatan bersambung',
    customTitle: 'Pelayan MCP lain',
    connect: 'Sambung',
    disconnect: 'Putuskan sambungan',
    disconnectConfirm: 'Putuskan {name} dan padam semua kelayakan serta tetapan yang disimpan?',
    showTools: 'Alat & tetapan',
    hideTools: 'Sembunyikan',
    continueSignIn: 'Log masuk dengan pelayar',
    registerAndReview: 'Tambah dan semak arahan',
    thirdPartyNote: 'Dikendalikan oleh pihak ketiga bebas dan tidak bergabung dengan GenOffice.',
    notionDesc: 'Cari dan baca halaman Notion, atau lampirkan terus dalam panel AI.',
    notionNotice:
      'Apabila AI menggunakan alat Notion, pertanyaan dan teks pilihan dihantar ke Notion dan hasilnya masuk ke sembang AI.',
    canvaDesc:
      'Import atau buka reka bentuk Canva anda dalam tab, atau cipta reka bentuk baharu daripada dokumen.',
    canvaNotice:
      'Apabila AI menggunakan alat Canva, pertanyaan dan teks pilihan dihantar ke Canva dan hasilnya masuk ke sembang AI.',
    obsidianName: 'Peti Obsidian',
    obsidianDesc:
      'Membaca dan menyunting nota .md tempatan terus tanpa aplikasi Obsidian dan tanpa mencipta fail tambahan.',
    obsidianAddVault: 'Tambah folder peti',
    obsidianVaultCount: '{n} peti disambungkan',
    obsidianMissingDirConfirm:
      'Folder “{name}” tiada folder .obsidian. Sambungkan juga sebagai folder Markdown biasa?',
    obsidianConnectAnyway: 'Sambung juga',
    obsidianForbidden: 'Folder sistem, folder rumah dan folder data aplikasi tidak boleh ditambah.',
    obsidianDuplicate: 'Folder ini sudah ditambah sebagai peti.',
    obsidianRename: 'Namakan semula',
    obsidianRemoveVault: 'Buang',
    obsidianRemoveVaultConfirm:
      'Buang “{name}” daripada peti bersambung? Fail nota anda pada cakera tidak akan dipadam.',
    koreanLawDesc: 'Cari undang-undang dan kes Korea melalui API awam.',
    koreanLawNotice:
      'Menjalankan pakej sumber terbuka pihak ketiga pada PC ini. Semak dan benarkan arahannya selepas menambah.',
    koreanLawKeyLabel: 'ID OC (LAW_OC)',
    koreanLawKeyHint: 'Masukkan bahagian sebelum @ daripada e-mel berdaftar anda.',
    koreanLawGuideLink: 'Dapatkan LAW_OC di open.law.go.kr',
    kordocDesc: 'Baca, sunting dan tukar fail HWP / HWPX tempatan terus pada PC ini.',
    kordocNotice:
      'Pakej pihak ketiga membaca dan menulis fail terus pada cakera. Penyuntingan perlindungan editor tidak terpakai pada fail yang dibaca terus oleh kordoc.',
  },
  he: {
    sectionTitle: 'שירותים מחוברים',
    customTitle: 'שרתי MCP אחרים',
    connect: 'חיבור',
    disconnect: 'ניתוק',
    disconnectConfirm: 'לנתק את {name} ולהסיר את כל פרטי ההתחברות וההגדרות השמורות?',
    showTools: 'כלים והגדרות',
    hideTools: 'הסתרה',
    continueSignIn: 'התחברות בדפדפן',
    registerAndReview: 'הוספה ובדיקת הפקודה',
    thirdPartyNote: 'מופעל על ידי צד שלישי עצמאי ואינו קשור ל-GenOffice.',
    notionDesc: 'חיפוש וקריאת דפי Notion או צירופם ישירות בלוח ה-AI.',
    notionNotice:
      'כאשר ה-AI משתמש בכלי Notion, שאילתות וטקסט נבחר נשלחים אל Notion והתוצאות נכנסות לשיחת ה-AI.',
    canvaDesc: 'ייבוא או פתיחת עיצובי Canva שלך בכרטיסיות, או יצירת עיצובים חדשים מהמסמך שלך.',
    canvaNotice:
      'כאשר ה-AI משתמש בכלי Canva, שאילתות וטקסט נבחר נשלחים אל Canva והתוצאות נכנסות לשיחת ה-AI.',
    obsidianName: 'כספת Obsidian',
    obsidianDesc:
      'קורא ועורך הערות .md מקומיות ישירות ללא אפליקציית Obsidian ובלי ליצור קבצים נוספים בכספת.',
    obsidianAddVault: 'הוספת תיקיית כספת',
    obsidianVaultCount: '{n} כספות מחוברות',
    obsidianMissingDirConfirm:
      'בתיקייה “{name}” אין תיקיית .obsidian. לחבר אותה בכל זאת כתיקיית Markdown רגילה?',
    obsidianConnectAnyway: 'חיבור בכל זאת',
    obsidianForbidden: 'לא ניתן להוסיף תיקיות מערכת, תיקיית בית או תיקיית נתוני האפליקציה.',
    obsidianDuplicate: 'תיקייה זו כבר נוספה ככספת.',
    obsidianRename: 'שינוי שם',
    obsidianRemoveVault: 'הסרה',
    obsidianRemoveVaultConfirm:
      'להסיר את “{name}” מהכספות המחוברות? קובצי ההערות שבמחשב לא יימחקו.',
    koreanLawDesc: 'חיפוש חוקים ופסיקה קוריאניים דרך ה-API הציבורי.',
    koreanLawNotice:
      'מריץ חבילת קוד פתוח של צד שלישי במחשב זה. לאחר ההוספה יש לבדוק ולאשר את הפקודה.',
    koreanLawKeyLabel: 'מזהה OC ‏(LAW_OC)',
    koreanLawKeyHint: 'הזינו את החלק שלפני @ בכתובת הדוא״ל הרשומה.',
    koreanLawGuideLink: 'קבלת LAW_OC באתר open.law.go.kr',
    kordocDesc: 'קריאה, עריכה והמרה של קובצי HWP / HWPX מקומיים ישירות במחשב זה.',
    kordocNotice:
      'חבילת צד שלישי קוראת וכותבת קבצים ישירות מהדיסק. השחרת מידע בעורך אינה חלה על קבצים שנקראים ישירות על ידי kordoc.',
  },
  hi: {
    sectionTitle: 'कनेक्टेड सेवाएँ',
    customTitle: 'अन्य MCP सर्वर',
    connect: 'कनेक्ट करें',
    disconnect: 'डिस्कनेक्ट करें',
    disconnectConfirm:
      'क्या {name} को डिस्कनेक्ट करें और इसके सभी सहेजे गए क्रेडेंशियल व सेटिंग्स हटाएँ?',
    showTools: 'टूल और सेटिंग्स',
    hideTools: 'छिपाएँ',
    continueSignIn: 'ब्राउज़र से साइन इन करें',
    registerAndReview: 'जोड़ें और कमांड जाँचें',
    thirdPartyNote: 'यह एक स्वतंत्र तृतीय पक्ष द्वारा संचालित है और GenOffice से संबद्ध नहीं है।',
    notionDesc: 'Notion पेज खोजें और पढ़ें, या AI पैनल में सीधे संलग्न करें।',
    notionNotice:
      'जब AI Notion टूल का उपयोग करता है, तो प्रश्न और चुना गया पाठ Notion को भेजा जाता है और परिणाम चैट में आते हैं।',
    canvaDesc:
      'अपने Canva डिज़ाइन आयात करें या टैब में खोलें, या अपने दस्तावेज़ से नए डिज़ाइन बनाएँ।',
    canvaNotice:
      'जब AI Canva टूल का उपयोग करता है, तो प्रश्न और चुना गया पाठ Canva को भेजा जाता है और परिणाम चैट में आते हैं।',
    obsidianName: 'Obsidian वॉल्ट',
    obsidianDesc:
      'Obsidian ऐप चलाए बिना स्थानीय .md नोट्स सीधे पढ़ता-संपादित करता है और वॉल्ट में कोई अतिरिक्त फ़ाइल नहीं बनाता।',
    obsidianAddVault: 'वॉल्ट फ़ोल्डर जोड़ें',
    obsidianVaultCount: '{n} वॉल्ट कनेक्टेड',
    obsidianMissingDirConfirm:
      'फ़ोल्डर “{name}” में .obsidian फ़ोल्डर नहीं है। क्या फिर भी इसे सामान्य Markdown फ़ोल्डर के रूप में कनेक्ट करें?',
    obsidianConnectAnyway: 'फिर भी कनेक्ट करें',
    obsidianForbidden:
      'सिस्टम, होम या ऐप डेटा फ़ोल्डर जोड़े नहीं जा सकते। कृपया नोट्स फ़ोल्डर चुनें।',
    obsidianDuplicate: 'यह फ़ोल्डर पहले से वॉल्ट के रूप में जुड़ा हुआ है।',
    obsidianRename: 'नाम बदलें',
    obsidianRemoveVault: 'हटाएँ',
    obsidianRemoveVaultConfirm:
      'क्या “{name}” को कनेक्टेड वॉल्ट से हटाएँ? डिस्क पर आपकी नोट फ़ाइलें नहीं हटेंगी।',
    koreanLawDesc: 'सार्वजनिक API के माध्यम से कोरियाई कानून और निर्णय खोजें।',
    koreanLawNotice:
      'यह इस PC पर तृतीय-पक्ष ओपन-सोर्स पैकेज चलाता है। जोड़ने के बाद चलने वाला कमांड जाँचकर अनुमति दें।',
    koreanLawKeyLabel: 'OC आईडी (LAW_OC)',
    koreanLawKeyHint: 'अपने पंजीकृत ईमेल के @ से पहले का भाग दर्ज करें।',
    koreanLawGuideLink: 'open.law.go.kr से LAW_OC प्राप्त करें',
    kordocDesc: 'इस PC पर स्थानीय HWP / HWPX फ़ाइलें सीधे पढ़ें, संपादित करें और रूपांतरित करें।',
    kordocNotice:
      'तृतीय-पक्ष पैकेज सीधे डिस्क पर फ़ाइलें पढ़ता और लिखता है। एडिटर की गोपनीयता छुपाने की सुविधा kordoc द्वारा सीधे पढ़ी गई फ़ाइलों पर लागू नहीं होती।',
  },
  'zh-TW': {
    sectionTitle: '已連線的服務',
    customTitle: '其他 MCP 伺服器',
    connect: '連線',
    disconnect: '中斷連線',
    disconnectConfirm: '確定要中斷 {name} 並刪除已儲存的憑證與設定嗎？',
    showTools: '工具與設定',
    hideTools: '收合',
    continueSignIn: '使用瀏覽器登入',
    registerAndReview: '加入並檢查執行指令',
    thirdPartyNote: '此服務由獨立第三方營運，與 GenOffice 無隸屬關係。',
    notionDesc: '搜尋與閱讀 Notion 頁面，或在 AI 面板中直接附加頁面。',
    notionNotice:
      '當 AI 呼叫 Notion 工具時，查詢字詞與選取文字會傳送到 Notion，傳回的內容會進入 AI 對話。',
    canvaDesc: '匯入或在新分頁開啟我的 Canva 設計，或根據目前文件建立新的 Canva 設計。',
    canvaNotice:
      '當 AI 呼叫 Canva 工具時，查詢字詞與選取文字會傳送到 Canva，傳回的內容會進入 AI 對話。',
    obsidianName: 'Obsidian 倉庫',
    obsidianDesc: '直接讀寫本機 .md 筆記，無需開啟 Obsidian，也不會在倉庫中建立任何管理檔案。',
    obsidianAddVault: '新增倉庫資料夾',
    obsidianVaultCount: '已連線 {n} 個倉庫',
    obsidianMissingDirConfirm:
      '所選資料夾「{name}」中沒有 .obsidian 資料夾。仍要將它當作一般 Markdown 資料夾連線嗎？',
    obsidianConnectAnyway: '仍然連線',
    obsidianForbidden: '無法註冊系統資料夾、主目錄或應用程式資料夾。請選擇筆記資料夾。',
    obsidianDuplicate: '此資料夾已加入為倉庫。',
    obsidianRename: '重新命名',
    obsidianRemoveVault: '移除',
    obsidianRemoveVaultConfirm: '從已連線倉庫中移除「{name}」嗎？磁碟上的筆記檔案不會被刪除。',
    koreanLawDesc: '透過韓國國家法令資訊中心公開 API 搜尋法規與判例。',
    koreanLawNotice: '此服務會在本機執行第三方開源套件。加入後請先檢視並允許執行指令。',
    koreanLawKeyLabel: '國家法令資訊中心 OC ID (LAW_OC)',
    koreanLawKeyHint: '請輸入註冊電子郵件中 @ 之前的部分。',
    koreanLawGuideLink: '前往 open.law.go.kr 申請 LAW_OC',
    kordocDesc: '在本機直接讀寫與轉換 HWP / HWPX 檔案。',
    kordocNotice:
      '第三方套件會直接讀寫磁碟上的檔案。編輯器中的遮蔽（隱私隱藏）不會套用於 kordoc 直接讀取的檔案。',
  },
  vi: {
    sectionTitle: 'Dịch vụ đã kết nối',
    customTitle: 'Máy chủ MCP khác',
    connect: 'Kết nối',
    disconnect: 'Ngắt kết nối',
    disconnectConfirm:
      'Ngắt kết nối {name} và xóa toàn bộ thông tin đăng nhập cùng cài đặt đã lưu?',
    showTools: 'Công cụ & cài đặt',
    hideTools: 'Ẩn',
    continueSignIn: 'Đăng nhập bằng trình duyệt',
    registerAndReview: 'Thêm và kiểm tra lệnh chạy',
    thirdPartyNote: 'Do bên thứ ba độc lập vận hành và không liên kết với GenOffice.',
    notionDesc: 'Tìm kiếm và đọc trang Notion, hoặc đính kèm trực tiếp trong bảng AI.',
    notionNotice:
      'Khi AI dùng công cụ Notion, truy vấn và văn bản được chọn sẽ gửi tới Notion và kết quả sẽ vào cuộc trò chuyện AI.',
    canvaDesc:
      'Nhập hoặc mở thiết kế Canva của bạn trong tab, hoặc tạo thiết kế mới từ tài liệu hiện tại.',
    canvaNotice:
      'Khi AI dùng công cụ Canva, truy vấn và văn bản được chọn sẽ gửi tới Canva và kết quả sẽ vào cuộc trò chuyện AI.',
    obsidianName: 'Kho Obsidian',
    obsidianDesc:
      'Đọc và sửa trực tiếp ghi chú .md cục bộ mà không cần mở Obsidian và không tạo tệp phụ trong kho.',
    obsidianAddVault: 'Thêm thư mục kho',
    obsidianVaultCount: 'Đã kết nối {n} kho',
    obsidianMissingDirConfirm:
      'Thư mục “{name}” không có thư mục .obsidian. Vẫn kết nối như thư mục Markdown thông thường?',
    obsidianConnectAnyway: 'Vẫn kết nối',
    obsidianForbidden: 'Không thể thêm thư mục hệ thống, thư mục chính hoặc dữ liệu ứng dụng.',
    obsidianDuplicate: 'Thư mục này đã được thêm làm kho.',
    obsidianRename: 'Đổi tên',
    obsidianRemoveVault: 'Gỡ bỏ',
    obsidianRemoveVaultConfirm:
      'Gỡ “{name}” khỏi danh sách kho đã kết nối? Tệp ghi chú trên ổ đĩa sẽ không bị xóa.',
    koreanLawDesc: 'Tra cứu luật và án lệ Hàn Quốc qua API công khai.',
    koreanLawNotice:
      'Chạy gói mã nguồn mở của bên thứ ba trên máy tính này. Sau khi thêm, hãy xem và cho phép lệnh chạy.',
    koreanLawKeyLabel: 'Mã OC (LAW_OC)',
    koreanLawKeyHint: 'Nhập phần trước ký tự @ trong địa chỉ email đã đăng ký.',
    koreanLawGuideLink: 'Lấy LAW_OC tại open.law.go.kr',
    kordocDesc: 'Đọc, chỉnh sửa và chuyển đổi trực tiếp tệp HWP / HWPX cục bộ trên máy này.',
    kordocNotice:
      'Gói bên thứ ba đọc và ghi tệp trực tiếp trên ổ đĩa. Tính năng che thông tin trong trình soạn thảo không áp dụng cho tệp kordoc đọc trực tiếp.',
  },
  tr: {
    sectionTitle: 'Bağlı hizmetler',
    customTitle: 'Diğer MCP sunucuları',
    connect: 'Bağlan',
    disconnect: 'Bağlantıyı kes',
    disconnectConfirm:
      '{name} bağlantısı kesilsin ve kayıtlı tüm kimlik bilgileriyle ayarları silinsin mi?',
    showTools: 'Araçlar ve ayarlar',
    hideTools: 'Gizle',
    continueSignIn: 'Tarayıcıyla giriş yap',
    registerAndReview: 'Ekle ve komutu incele',
    thirdPartyNote: 'Bağımsız bir üçüncü tarafça işletilir ve GenOffice ile ilişkili değildir.',
    notionDesc: 'Notion sayfalarını arayın, okuyun veya doğrudan AI paneline ekleyin.',
    notionNotice:
      'AI, Notion araçlarını kullandığında sorgular ve seçilen metin Notion’a gönderilir ve sonuçlar sohbete gelir.',
    canvaDesc:
      'Canva tasarımlarınızı içe aktarın veya sekmede açın, ya da belgenizden yeni tasarımlar oluşturun.',
    canvaNotice:
      'AI, Canva araçlarını kullandığında sorgular ve seçilen metin Canva’ya gönderilir ve sonuçlar sohbete gelir.',
    obsidianName: 'Obsidian Kasası',
    obsidianDesc:
      'Obsidian uygulaması olmadan yerel .md notlarını doğrudan okur/düzenler ve kasada ek dosya oluşturmaz.',
    obsidianAddVault: 'Kasa klasörü ekle',
    obsidianVaultCount: '{n} kasa bağlı',
    obsidianMissingDirConfirm:
      '“{name}” klasöründe .obsidian klasörü yok. Yine de normal Markdown klasörü olarak bağlansın mı?',
    obsidianConnectAnyway: 'Yine de bağlan',
    obsidianForbidden: 'Sistem, kullanıcı ana veya uygulama veri klasörleri eklenemez.',
    obsidianDuplicate: 'Bu klasör zaten kasa olarak eklenmiş.',
    obsidianRename: 'Yeniden adlandır',
    obsidianRemoveVault: 'Kaldır',
    obsidianRemoveVaultConfirm:
      '“{name}” bağlı kasalardan kaldırılsın mı? Diskteki not dosyalarınız silinmez.',
    koreanLawDesc: 'Kore yasalarını ve içtihatlarını açık API üzerinden arayın.',
    koreanLawNotice:
      'Bu bilgisayarda üçüncü taraf açık kaynak paketi çalıştırır. Ekledikten sonra komutu inceleyip izin verin.',
    koreanLawKeyLabel: 'OC Kimliği (LAW_OC)',
    koreanLawKeyHint: 'Kayıtlı e-posta adresinizin @ işaretinden önceki kısmını girin.',
    koreanLawGuideLink: 'open.law.go.kr üzerinden LAW_OC alın',
    kordocDesc:
      'Bu bilgisayardaki HWP / HWPX dosyalarını doğrudan okuyun, düzenleyin ve dönüştürün.',
    kordocNotice:
      'Üçüncü taraf paket dosyaları doğrudan diskte okur ve yazar. Düzenleyici gizleme (redaksiyon) kordoc tarafından doğrudan okunan dosyalara uygulanmaz.',
  },
})

export type ConnectorsStringKey = keyof typeof connectorsUiStrings.zh

const translate = createI18n(connectorsUiStrings)

export function connectorsText(lang: Lang, key: ConnectorsStringKey, params?: Params): string {
  return translate(lang, key, params)
}
