# Operasi file: ganti nama, hapus, ekspor

Bab ini mencakup operasi file yang dipakai bersama oleh semua editor; pilihan ekspor khas tiap editor ada di babnya masing-masing.

**Menu ⋯** pada baris file (arahkan kursor ke baris file) mengumpulkan tindakan berikut:

![Menu ⋯ pada baris file](img/file-ops.png)

## Mengganti nama

Ada dua pintu masuk, satu set pemeriksaan:

- **⋯ ▸ Ganti nama** dari baris di Beranda.
- **Klik dua kali tab file** untuk mengganti nama di tempat (lihat [Tab dan pengelolaan jendela](help://tabs-and-windows)).

Aturannya: ekstensi dipertahankan otomatis; karakter terlarang, titik di akhir, dan nama cadangan (CON/NUL dan sejenisnya) ditolak dengan pesan; dan nama yang bentrok di folder yang sama juga dicegah. Berkas sungguhan di disk diganti namanya, serta daftar terbaru dan bintang ikut menyesuaikan.

## Menghapus

- **⋯ ▸ Hapus** di Beranda: menanyakan file mana, lalu memindahkannya ke **tempat sampah sistem**, tempat sistem operasi dapat memulihkannya. GenOffice tidak menyimpan undo sendiri untuk ini — pemulihan adalah urusan tempat sampah, bukan notifikasi.

## Duplikat

**⋯ ▸ Duplikat** membuat salinan <nama> di folder yang sama; bila nama bertabrakan, angka ditambahkan otomatis. Salinan masuk ke **Terbaru** alih-alih langsung dibuka — satu klik lagi, bukan tepat di depan Anda.

## Simpan dan Simpan Sebagai

- **⌘S / ctrl+S** menyimpan file saat ini; file tanpa nama akan lebih dulu meminta lokasi dan nama.
- Di sebagian besar editor, daftar jenis berkas di dialog Simpan Sebagai juga menawarkan format ekspor (PDF, gambar, format dokumen lain). Memilih salah satunya hanya menulis salinan; dokumen yang terbuka dan tabnya tetap pada berkas asli. Gambar dari beberapa halaman dipecah menjadi `nama-01.png`, `nama-02.png`, ….
- **Docs**: daftar Simpan Sebagai juga menawarkan .hwp dan .hwpx (File ▸ Ekspor sebagai dokumen HWP… sama saja). Jika ada yang tidak bisa dipindahkan, seperti komentar, persamaan, atau kotak teks, Anda diberi tahu sebelum berkas ditulis.
- **Simpan Sebagai…** menulis berkas baru dan membiarkan aslinya tidak tersentuh; penyuntingan setelahnya menyasar berkas baru.
- Setiap penyimpanan bersifat atomik (berkas sementara + ganti nama); berhenti di tengah penulisan tidak akan merusak file.
- Simpan Otomatis mengikuti tombol di setiap editor; dokumen baru tanpa berkas sendiri mulai setelah penyimpanan pertamanya (lihat [Mulai cepat](help://getting-started)).

## Ekspor ke PDF

- **Docs**: Arquivo ▸ Ekspor sebagai PDF… (atau tombol di pita), dengan pemenggalan halaman seperti tata letaknya.
- **Slides**: ekspor meraster halaman demi halaman, dengan progres untuk dek besar.
- **Sheets**: ekspor mengikuti pemenggalan halaman cetak.
- Ekspor dirender di jendela tersembunyi dan hasilnya mendarat di mana pun yang Anda pilih.

## Ekspor ke Word / gambar

- **PDF ▸ PDF ke Word**: mengubah PDF menjadi .docx (dikonversi secara lokal; tata letak kompleks dibuat semaksimal mungkin).
- **Docs** dapat mengekspor halaman sebagai gambar (PNG per halaman).

## Mencetak

File ▸ Cetak (⌘P/ctrl+P) di tiap editor membuka jendela cetak. Docs, PDF, Sheets, Slides, dan Markdown punya bagian **Tata letak halaman** di jendela cetak yang sudah ada, HWP di pratinjau cetak, sedangkan HTML, peta pikiran, dan diagram di jendela cetak kecil yang baru. Jika Anda tidak memilih apa pun di Tata letak halaman, pencetakan berjalan sama seperti sebelumnya.

- **Cara penataan**: pilih salah satu dari Satu halaman per lembar, Beberapa halaman per lembar (2, 4, 6, 9, atau 16), Buklet (jilid di kiri atau kanan), Poster (lembar mendatar dan menurun, tumpang tindih, garis potong), atau Label (satu halaman per label atau halaman yang sama di setiap label, label awal, ukuran A4 yang umum atau ukuran sendiri).
- **Hanya sisi ganjil, hanya sisi genap, urutan terbalik**: sisi dihitung setelah penataan, berdasarkan sisi yang benar-benar keluar dari printer. Berguna untuk printer tanpa cetak bolak-balik: cetak sisi depan, balik kertasnya, lalu cetak sisi belakang.
- **Perkecil agar muat di kertas**: hanya halaman yang lebih besar dari kertas yang dipilih yang diperkecil; halaman yang lebih kecil tidak diperbesar. Sheets dan Markdown memakai kolom kertas dan skala yang sudah ada.
- **Skala abu-abu dan resolusi gambar**: saat mencetak dengan pilihan Tata letak halaman, setiap halaman diubah menjadi gambar sebelum dikirim ke printer. Resolusi dipilih dari Otomatis, 150, 300, atau 600 dpi.
- **Hanya pilihan**: Docs dan Markdown mencetak hanya teks yang dipilih, ditata ulang mulai halaman pertama; Slides mencetak slide yang dipilih dan PDF mencetak halaman yang dipilih. Sheets tetap mencetak rentang yang dipilih seperti sebelumnya.
- **Bagan tata letak dan pratinjau hasil**: bagan langsung menunjukkan letak setiap nomor halaman di kertas, dan **Pratinjau hasil** menampilkan hasil yang benar-benar dibuat. Dengan **Simpan hasil tata letak sebagai PDF**, tata letak yang sama bisa dicetak di PC lain atau di percetakan.
- **Jendela cetak sistem**: untuk buklet, pilih cetak bolak-balik dengan balik pada sisi pendek. Biarkan rentang halaman dan jumlah halaman per lembar di jendela sistem apa adanya.

PDF dicetak dengan urutan halaman dan rotasi saat ini.

## Di mana berkas tanpa nama tinggal

Lokasi yang Anda pilih saat penyimpanan pertama menjadi rumah berkas itu. Sebelumnya dokumen belum punya berkas sendiri: kontennya yang belum disimpan hanya ada sebagai salinan pemulihan di folder data aplikasi, sehingga bisa kembali jika aplikasi mati mendadak (lihat [Tab dan pengelolaan jendela](help://tabs-and-windows)). Simpan Otomatis baru mengambil alih setelah penyimpanan pertama itu.
