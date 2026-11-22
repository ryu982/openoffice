# Pengaturan, bahasa, tema, dan integrasi MCP

## Membuka pengaturan

Baris di kiri bawah Beranda membuka panel pengaturan (baris di bawahnya menunjukkan apakah ada AI yang terhubung). Panel ini punya lima bagian: Akun, AI, Umum, Integrasi, dan Tentang.

Anda juga dapat membukanya dari tab mana pun dengan **⌘,** (Ctrl+, di Windows dan Linux), dari **Pengaturan…** di menu aplikasi di Mac (menu bernama aplikasi, di kiri bilah menu), atau dari **Menu (☰) ▸ Pengaturan…** di Windows dan Linux. Di tab Word, ⌘, (Ctrl+,) adalah subskrip, jadi bukalah dari menu.

**Akun** menunjukkan keadaan koneksi Claude, ChatGPT, dan Codex Anda, dan **Kelola koneksi** membawa Anda ke bagian AI. AI punya artikel tersendiri: [Koneksi langganan](help://subscription) dan [Model AI dan pengaturan](help://ai-models).

## Bahasa

- Pengaturan menawarkan **22 bahasa antarmuka**: Inggris, Tionghoa Sederhana, Jepang, Korea, Prancis, Jerman, Spanyol, Thai, Indonesia, Rusia, Arab, Portugis, Italia, Polandia, Ceko, Belanda, Melayu, Ibrani, Hindi, Tionghoa Tradisional, Vietnam, Turki.
- Beralih bahasa berlaku seketika dan bertahan; bilah menu sistem dibangun ulang mengikuti bahasa tersebut.

## Tema

Terang / Gelap / Ikuti Sistem. Mode Ikuti Sistem mengikuti tampilan sistem operasi, dan para editor mengganti tema senada tanpa berkedip.

## Umum

- **Posisi bilah samping AI** (kiri atau kanan), **Ukuran teks panel AI** dan **Pemeriksaan ejaan di obrolan AI**.
- **Panel AI** — Nonaktif, Diciutkan, atau Status terakhir.
- **Simpan otomatis semua dokumen** menyalakan AutoSave secara default di setiap editor; Anda tetap bisa mematikannya untuk satu jendela.
- **Lokasi penyimpanan** dengan tombol **Ubah**, dan **Aplikasi default untuk dokumen Office** untuk mengambil alih .docx / .xlsx / .pptx bagi GenOffice.
- **Format penyimpanan dokumen HWP baru** memilih apakah HWP atau HWPX yang ditawarkan lebih dulu saat menyimpan dokumen baru pertama kali. Dokumen yang dibuka tetap memakai formatnya sendiri.
- **Font slide AI** menentukan font yang dipakai AI untuk presentasi baru saat permintaan Anda tidak menyebut font. Pilih Otomatis, Sans serif, Serif, atau Judul serif, lalu ganti font sans serif dan font serif secara terpisah. Templat desain yang dipilih memakai fontnya sendiri, dan halaman yang ditambahkan ke presentasi dengan font lain mengikuti presentasi itu.

GenOffice tidak mengumpulkan atau mengirim statistik penggunaan, jadi tidak ada sakelar untuk itu.

## Editor dan AI

Di sini Anda memilih editor mana yang dipakai dan apakah memakai AI. Daftar yang sama juga muncul sekali di dua tempat lain: langkah **Pilih editor yang Anda pakai** pada layar selamat datang saat pertama kali dijalankan, dan jendela yang muncul sekali di Beranda bagi orang yang sudah memakai GenOffice sebelum pengaturan ini ada. Awalnya semua menyala, jadi kalau dibiarkan tidak ada yang berubah. Perubahan langsung berlaku di semua jendela yang terbuka.

- **Editor**: Word, Excel, PowerPoint, PDF, Alat PDF, Markdown dan teks, HTML, Peta pikiran, Diagram, HWP (Hangul), dan Buku elektronik (EPUB). Alat PDF dinyalakan dan dimatikan terpisah dari editor PDF. Setidaknya satu editor harus tetap menyala.
- **Editor yang dimatikan** hilang dari daftar dokumen baru: kartu di Beranda, menu **+** di bilah tab, File ▸ Baru, dan daftar aplikasi default. Dokumen yang sudah terbuka tetap terbuka, dan salinan pemulihan tetap disimpan.
- **Saat membuka file milik editor yang dimatikan** (klik ganda, seret dan lepas, File ▸ Buka, file terbaru), Anda diminta memilih **Aktifkan dan buka** atau **Batal**. Membuka beberapa filenya sekaligus hanya ditanyakan sekali.
- **Fitur lain yang akan membuka hasilnya di editor yang dimatikan**, misalnya mengubah PDF ke format itu, bertanya sebelum mulai: **Aktifkan dan buka**, **Buat file saja** (file dibuat dan ditampilkan di foldernya, editor tetap mati), atau **Batal**.
- **Saat fitur AI dimatikan**, panel AI, tombol dan menu AI, panel tanya di Beranda, jendela agen, serta ajakan menghubungkan AI hilang, dan tab Akun, AI, serta Skill keluar dari pengaturan. GenOffice tidak menjalankan program AI apa pun dari layarnya. Info masuk, kunci, skill, dan pengaturan tetap disimpan dan kembali saat AI dinyalakan lagi. Jika pekerjaan AI masih berjalan, Anda ditanya dulu apakah ingin **Hentikan dan matikan**.
- Baris perintah, MCP, dan panduan ini bekerja sama saja, baik editor atau AI menyala maupun mati.

Meskipun AI menyala, AI tidak membuat dokumen baru untuk editor yang dimatikan; AI meminta Anda menyalakan editor itu di sini.

## AI ▸ Lanjutan

Tertutup sampai Anda membukanya; kebanyakan orang tidak pernah memerlukannya. Tab **Model AI** berisi kunci API dan server yang Anda jalankan sendiri, untuk obrolan. Di tab **Media & Pencarian AI**, setiap kemampuan memilih vendor yang melayaninya, dan kunci serta URL dasar sebuah vendor cukup diisi sekali lalu dipakai bersama:

- **Pencarian web**, **Pembuatan gambar**, **Analisis gambar** dan **Analisis video**, masing-masing dengan satu provider, satu model, satu kunci, dan satu URL dasar.
- **Pencarian berkas lokal** berjalan di mesin ini. Di bawahnya, **reranking pencarian Jev** **nonaktif secara bawaan**. Diaktifkan, kutipan 20 hit lokal teratas — hingga 1.200 karakter per dokumen, plus nama berkas dan folder — pergi ke endpoint keputusan pilihan Anda (Jev via OpenRouter atau TypeSafe, Perplexity, Liquid AI d1, Cloudflare, mesin lokal, atau URL kustom) untuk diurutkan ulang menurut relevansi. Nonaktif, tak ada yang meninggalkan perangkat.
- **Izinkan permintaan otomatis memakai langganan** **nonaktif secara bawaan**. Sakelar ini menentukan apakah permintaan dari baris perintah atau dari agen pemrograman yang terhubung boleh memakai langganan Claude atau Codex Anda; lihat [Menghubungkan agen coding](help://mcp).

## Tentang

- **Versi**, alamat GitHub proyek, dan satu baris yang menyebutkan proyek sumber terbuka yang menjadi dasar aplikasi ini.
- **Saluran Pembaruan**: Stabil atau Beta. Mengubahnya langsung berlaku dan memeriksa pembaruan; ini tidak akan menurunkan instalasi Beta kembali ke Stabil.

## Pengikatan aplikasi predefinida

Pengaturan dapat mendaftarkan GenOffice sebagai aplikasi penangan .docx / .xlsx / .pptx / .pdf dan sejenisnya (pendaftaran aplikasi predefinida tingkat sistem; konfirmasi saat diminta).

## Pemberitahuan pihak ketiga dan pembaruan

- Bantuan ▸ Pemberitahuan Perangkat Lunak Pihak Ketiga: inventaris lengkap lisensi OSS yang disertakan dengan aplikasi.
- Menu (☰) ▸ Periksa Pembaruan… (di Mac: Bantuan ▸ Periksa Pembaruan…): memicu pemeriksaan manual; versi yang lebih baru menawarkan dipasang. Di Mac, perintah ini juga ada di menu aplikasi, tepat di bawah Tentang GenOffice.

## Integrasi MCP (untuk pengguna lanjutan / klien AI)

**Integrasi** adalah panel yang menghubungkan GenOffice dengan agen pemrograman, dan ia punya artikel tersendiri: Menghubungkan agen pemrograman. Versi singkat — pilih jalurnya (baris perintah, atau MCP), ikuti bagian itu, lalu mulai obrolan baru dan bertanya.

Di bawah **Server HTTP lokal**, aplikasi juga bisa menjalankan server itu sendiri — sakelar aktif dan port — dan **Lanjutan** menambahkan URL pemeriksaan kesehatan serta file log, alih-alih menghandalkannya kepada asisten. Ia hanya mendengarkan di localhost.

Di bagian atas **Pengaturan ▸ Integrasi**, **Layanan terhubung** menghimpun Google Drive, Notion, Canva, Brankas Obsidian, Korean Law MCP, kordoc MCP, dan server MCP khusus di atas bagian agen koding.

## Lembar pintasan baris perintah

| Perintah            | Fungsinya                |
| ------------------- | ------------------------ |
| `ieumoffice <file>` | membuka sebuah file      |
| `ieumoffice mcp`    | memulai server MCP lokal |
| `ieumoffice --help` | semua perintah dan opsi  |
