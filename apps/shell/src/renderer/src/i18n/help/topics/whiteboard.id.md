# Papan Tulis: curah pendapat, sketsa, dan anotasi

Editor papan tulis membuka berkas `.whiteboard` di dalam tab. Anda dapat menata catatan tempel, teks, bentuk, penghubung, tabel, stiker, gambar, kartu tautan, dan goresan pena bebas pada papan bebas tak terbatas atau halaman tetap, membawa halaman PDF sebagai latar belakang, mengekspor ke gambar atau PDF, serta bekerja dengan panel AI. Semuanya berjalan secara lokal di PC Anda.

## Membuka dan membuat

- Papan baru dimulai sebagai papan bebas tak terbatas dari ubin **Papan Tulis** di Beranda atau melalui Baru di menu Berkas.
- Editor membuka berkas `.whiteboard` dari dialog buka, menyeret ke jendela, berkas terbaru, pohon folder, Pratinjau Cepat (Spasi), atau Google Drive. Di Windows, pemasangan GenOffice mendaftarkannya sebagai program bawaan untuk `.whiteboard`.
- Berkas Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) diimpor sebagai papan tulis baru tanpa judul. Berkas asli tidak pernah ditimpa, menutup tanpa suntingan tidak menanyakan penyimpanan, dan penyimpanan pertama menyarankan `.whiteboard` di folder yang sama. Elemen yang tidak didukung seperti sematan web dilewati dan jumlahnya ditampilkan di bilah pemberitahuan. Di Windows, `.excalidraw` hanya muncul di "Buka dengan".
- Jika papan tulis sudah terbuka, tabnya akan dibawa ke depan.

## Menyunting dan alat

- Satu berkas `.whiteboard` dapat mencampur papan bebas dan halaman tetap (layar 16:9, A4 potret, A4 lanskap, atau ukuran halaman PDF khusus) di rel halaman.
- Alat mencakup pilih, catatan tempel, teks kaya, delapan bentuk, penghubung dan panah, pena peka tekanan, penyorot dan penghapus, gambar, tabel, stiker bawaan, dan kartu tautan.
- Untuk memilih beberapa objek sekaligus, seret persegi panjang dari tempat kosong dengan alat pilih. Jika objek tidak menyisakan tempat kosong, pilih **Pilih area** (M) di bilah alat kiri lalu mulai menyeret langsung di atas objek. Hanya objek yang seluruhnya berada di dalam persegi panjang yang terpilih. Shift+klik (atau Ctrl+klik) pada objek menambahkannya ke pilihan atau mengeluarkannya, menyeret sambil menahan Shift menambahkan objek dari persegi panjang lain, dan Ctrl+A (⌘A di Mac) memilih semua objek di halaman saat ini. Menyeret salah satu objek terpilih memindahkan semuanya bersama-sama, dan Bawa ke depan, Kirim ke belakang, Duplikat, serta Hapus berlaku untuk semuanya sekaligus, masing-masing sebagai satu langkah urungkan.
- Seret berkas `.pdf` ke papan tulis yang terbuka atau pilih **Impor PDF** untuk mengubah halaman PDF terpilih menjadi halaman latar tetap agar Anda bisa menulis dan menggambar di atasnya. Membuka `.pdf` dari Beranda atau menu Berkas tetap membukanya di editor PDF.
- Tekan F5 atau klik **Presentasi** untuk menampilkan papan layar penuh dan berpindah halaman dengan tombol panah.
- Di tema gelap, bilah alat, panel, dan latar di luar halaman menjadi gelap, sedangkan kertas, catatan tempel, bentuk, dan tinta tetap dalam warna dokumen aslinya.

## Menyimpan, mengekspor, dan mencetak

- Simpan, Simpan Sebagai, Simpan Otomatis, salinan pemulihan, dan pemeriksaan konflik tampilan terbagi bekerja seperti editor lainnya. Jika tidak ada perubahan, berkas tidak ditulis ulang.
- Ekspor ke PNG, SVG, atau PDF untuk **Semua halaman** atau **Halaman saat ini saja**. Di papan bebas, ekspor dan cetak menyesuaikan semua objek dengan margin atau area awal bawaan saat kosong.
- Cetak (Ctrl+P) mendukung pencetakan standar maupun tata letak halaman lanjutan. Hasil ekspor dan cetak identik di tema terang maupun gelap.

## Panel AI

- Minta AI menata catatan tempel, menyusun templat lokakarya atau retrospektif, menambah bentuk, penghubung, tabel, atau gambar, atau meringkas papan.
- AI menerima tabel teks terstruktur dari papan dan, bila model terpilih mendukung gambar, otomatis melampirkan gambar halaman saat ini. Model khusus teks berjalan menggunakan tabel teks saja.
- Setiap panggilan suntingan AI adalah satu langkah urungkan (Ctrl+Z), menyorot objek yang berubah di layar tanpa mengubah berkas tersimpan, dan menyediakan **Urungkan perubahan ini** di kartu balasan.
- Berkas `.whiteboard` dapat dilampirkan di panel AI editor lain, disebut dengan `@`, dicari di Beranda, dipakai pada **Buat dokumen lain** (termasuk konversi ke Markdown tanpa AI), dan dijalankan dari [perintah terminal](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Penggunaan internet dan kartu tautan

- Membuka, menyunting, mengekspor, mencetak, mengimpor Excalidraw, dan mengimpor halaman PDF tidak mengirim apa pun ke internet.
- Mengklik kartu tautan membuka alamat `http`, `https`, atau `mailto` di peramban bawaan Anda.
- Hanya ketika Anda secara eksplisit mengaktifkan **Ambil judul dan gambar pratinjau** saat menambah atau menyunting kartu tautan, GenOffice terhubung sekali ke halaman tersebut dan menyimpan gambar pratinjau di dalam berkas `.whiteboard`.
