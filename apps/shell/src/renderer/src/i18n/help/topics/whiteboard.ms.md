# Papan Putih: sumbang saran, lakaran dan anotasi

Editor papan putih membuka fail `.whiteboard` dalam tab. Anda boleh menyusun nota lekat, teks, bentuk, penyambung, jadual, pelekat, gambar, kad pautan dan lakaran pen bebas pada papan bebas tanpa had atau halaman tetap, membawa halaman PDF sebagai latar belakang, mengeksport sebagai gambar atau PDF dan bekerja dengan panel AI. Semuanya berjalan secara setempat pada PC anda.

## Membuka dan mencipta

- Papan baharu bermula sebagai papan bebas tanpa had daripada jubin **Papan Putih** di Laman Utama atau melalui Baharu dalam menu Fail.
- Editor membuka fail `.whiteboard` daripada dialog buka, seretan ke tetingkap, fail terbaharu, pepohon folder, Pratonton Pantas (Space) atau Google Drive. Pada Windows, pemasangan GenOffice mendaftarkannya sebagai program lalai untuk `.whiteboard`.
- Fail Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) diimport sebagai papan putih baharu tanpa tajuk. Fail asal tidak pernah ditulis ganti, menutup tanpa suntingan tidak meminta simpanan dan simpanan pertama mencadangkan `.whiteboard` dalam folder yang sama. Unsur tidak disokong seperti benaman web dilangkau dan bilangannya dipaparkan pada sepanduk. Pada Windows, `.excalidraw` hanya ditawarkan di bawah "Buka dengan".
- Jika papan putih sudah terbuka, tabnya dibawa ke hadapan.

## Menyunting dan alat

- Satu fail `.whiteboard` boleh menggabungkan papan bebas dan halaman tetap (skrin 16:9, A4 potret, A4 landskap atau saiz halaman PDF tersuai) dalam rel halaman.
- Alat termasuk pilih, nota lekat, teks berformat, lapan bentuk, penyambung dan anak panah, pen peka tekanan, penyerlah dan pemadam, gambar, jadual, pelekat terbina dalam dan kad pautan.
- Seret fail `.pdf` ke atas papan putih yang terbuka atau pilih **Import PDF** untuk menukar halaman PDF pilihan kepada halaman latar belakang tetap bagi nota dan lakaran. Membuka `.pdf` daripada Laman Utama atau menu Fail kekal membukanya dalam editor PDF.
- Tekan F5 atau klik **Bentang** untuk memaparkan papan skrin penuh dan beralih halaman dengan kekunci anak panah.
- Dalam tema gelap, bar alat, panel dan latar belakang luar halaman menjadi gelap, manakala kertas, nota lekat, bentuk dan dakwat mengekalkan warna dokumen asalnya.

## Menyimpan, mengeksport dan mencetak

- Simpan, Simpan Sebagai, AutoSimpan, salinan pemulihan dan semakan konflik paparan terbelah berfungsi seperti editor lain. Jika tiada perubahan, fail tidak ditulis semula.
- Eksport ke PNG, SVG atau PDF bagi **Semua halaman** atau **Halaman semasa sahaja**. Pada papan bebas, eksport dan cetakan memuatkan semua objek dengan jidar atau kawasan permulaan lalai apabila kosong.
- Cetak (Ctrl+P) menyokong cetakan standard dan pilihan susun atur halaman lanjutan. Hasil eksport dan cetakan adalah sama dalam tema cerah dan gelap.

## Panel AI

- Minta AI menyusun nota lekat, membina templat bengkel atau retrospektif, menambah bentuk, penyambung, jadual atau gambar, atau meringkaskan papan.
- AI menerima jadual teks berstruktur papan dan apabila model pilihan menyokong gambar, imej halaman semasa dilampirkan secara automatik. Model teks sahaja berjalan menggunakan jadual teks sahaja.
- Setiap panggilan suntingan AI ialah satu langkah buat asal (Ctrl+Z), menyerlahkan objek yang diubah pada skrin tanpa mengubah fail disimpan dan menyediakan **Buat asal perubahan ini** pada kad balasan.
- Fail `.whiteboard` boleh dilampirkan dalam panel AI editor lain, disebut dengan `@`, dicari di Laman Utama, digunakan dalam **Cipta dokumen lain** (termasuk penukaran ke Markdown tanpa AI) dan diurus melalui [arahan terminal](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Penggunaan internet dan kad pautan

- Membuka, menyunting, mengeksport, mencetak, mengimport Excalidraw dan mengimport halaman PDF tidak menghantar apa-apa ke internet.
- Mengklik kad pautan membuka alamat `http`, `https` atau `mailto` dalam pelayar lalai anda.
- Hanya apabila anda mengaktifkan **Ambil tajuk dan imej pratonton** secara jelas semasa menambah atau menyunting kad pautan, GenOffice berhubung sekali ke halaman tersebut dan menyimpan imej pratonton di dalam fail `.whiteboard`.
