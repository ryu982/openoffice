# Operasi fail: menamakan semula, memadam, dan eksport

Bab ini merangkumi operasi fail yang dikongsi oleh semua editor. Pilihan eksport khusus setiap editor ada dalam babnya sendiri.

**⋯ menu** pada baris fail, yang muncul apabila anda meletakkan penuding di atasnya, mengumpulkan tindakan berikut:

![⋯ menu pada baris fail](img/file-ops.png)

## Menamakan semula

Terdapat dua cara untuk mengakses, tetapi kedua-duanya menggunakan semakan yang sama:

- **⋯ ▸ Namakan semula** pada baris di Laman Utama.
- **Klik dua kali pada tab fail** untuk menamakan semula terus di tempat. Lihat [Tab dan pengurusan tingkap](help://tabs-and-windows).

Peraturannya ialah seperti berikut. Sambungan dikekalkan secara automatik. Aksara terlarang, titik di penghujung, dan nama yang dikhaskan seperti CON dan NUL akan ditolak dengan mesej. Pertindiran nama dalam folder yang sama juga akan disekat. Fail sebenar pada cakera akan dinamakan semula, dan senarai terkini serta senarai berbintang akan dikemas kini.

## Memadam

- **⋯ ▸ Padam** pada Laman Utama akan bertanya fail yang mana, kemudian memindahkan fail tersebut ke **tong sampah sistem**, yang boleh dipulihkan daripada sistem pengendalian. GenOffice tiada menyimpan undur sendiri untuk ini — pemulihan ialah tugas tong sampah, bukan notis.

## Membuat salinan

**⋯ ▸ Buat salinan** mencipta salinan bagi <nama> dalam folder yang sama. Jika nama itu sudah digunakan, nombor akan ditambah secara automatik. Salinan itu ditambah ke **Terkini** dan bukan dibuka untuk anda — satu klik sahaja, bukan di hadapan mata.

## Simpan dan Simpan Sebagai

- **⌘S atau ctrl+S** menyimpan fail semasa. Fail tanpa tajuk akan meminta lokasi dan nama terlebih dahulu.
- Dalam kebanyakan editor, senarai jenis fail dalam dialog Simpan Sebagai juga menawarkan format eksport (PDF, imej, format dokumen lain). Memilih salah satunya hanya menulis salinan; dokumen yang terbuka dan tabnya kekal pada fail asal. Imej beberapa halaman dipecahkan kepada `nama-01.png`, `nama-02.png`, ….
- **Docs**: senarai Simpan Sebagai juga menawarkan .hwp dan .hwpx (Fail ▸ Eksport sebagai dokumen HWP… melakukan perkara yang sama). Jika ada yang tidak dapat dipindahkan, seperti ulasan, persamaan atau kotak teks, anda dimaklumkan sebelum fail ditulis.
- **Simpan Sebagai** menulis fail baharu dan membiarkan fail asal tidak berubah. Suntingan selepas itu akan disimpan ke fail baharu itu.
- Setiap simpanan bersifat atomik, iaitu melalui fail sementara dan penamaan semula. Menutup aplikasi di tengah-tengah penulisan tidak akan merosakkan fail.
- Simpan automatik mengikut suis setiap editor; dokumen baharu tanpa fail sendiri bermula selepas simpanan pertamanya (lihat [Mula pantas](help://getting-started)).

## Eksport ke PDF

- **Docs**: Fail ▸ Eksport sebagai PDF, atau butang pada reben, dengan pemenggalan halaman seperti yang dipaparkan.
- **Slides**: eksport menukar setiap halaman kepada imej, dan menunjukkan kemajuan bagi persembahan yang besar.
- **Sheets**: eksport mengikut pemenggalan cetakan.
- Eksport dipaparkan dalam tingkap tersembunyi dan disimpan di tempat pilihan anda.

## Eksport ke Word dan imej

- **Eksport sebagai Word** menukar fail PDF kepada fail .docx. Penukaran ini dilakukan secara tempatan, dan susun atur yang kompleks hanya dipulihkan sepenuhnya.
- **Docs** boleh mengeksport halaman sebagai imej, iaitu PNG bagi setiap halaman.

## Cetakan

Fail ▸ Cetak (⌘P/ctrl+P) dalam setiap editor membuka tetingkap cetakan. Docs, PDF, Sheets, Slides dan Markdown mempunyai bahagian **Susun atur halaman** dalam tetingkap cetakan sedia ada, HWP dalam pratonton cetakan, manakala HTML, peta minda dan rajah dalam tetingkap cetakan kecil yang baharu. Jika anda tidak memilih apa-apa dalam Susun atur halaman, cetakan berjalan sama seperti sebelum ini.

- **Cara susunan**: pilih salah satu daripada Satu halaman setiap helai, Beberapa halaman setiap helai (2, 4, 6, 9 atau 16), Buku kecil (jilid di kiri atau kanan), Poster (helaian melintang dan menegak, pertindihan, garis potong) atau Label (satu halaman setiap label atau halaman sama pada setiap label, label mula, saiz A4 yang lazim atau saiz sendiri).
- **Muka ganjil sahaja, muka genap sahaja, susunan terbalik**: muka dikira selepas susunan dibuat, berdasarkan muka yang benar-benar keluar dari pencetak. Gunakan pada pencetak tanpa cetakan dua belah: cetak muka hadapan, terbalikkan kertas, kemudian cetak muka belakang.
- **Kecilkan supaya muat pada kertas**: hanya halaman yang lebih besar daripada kertas yang dipilih dikecilkan; halaman yang lebih kecil tidak dibesarkan. Sheets dan Markdown menggunakan medan kertas dan skala sedia ada.
- **Skala kelabu dan resolusi imej**: apabila mencetak dengan pilihan Susun atur halaman, setiap halaman ditukar menjadi imej sebelum dihantar ke pencetak. Resolusi dipilih daripada Automatik, 150, 300 atau 600 dpi.
- **Pilihan sahaja**: Docs dan Markdown mencetak teks yang dipilih sahaja, disusun semula bermula dari halaman pertama; Slides mencetak slaid yang dipilih dan PDF mencetak halaman yang dipilih. Sheets tetap mencetak julat yang dipilih seperti sebelum ini.
- **Rajah susunan dan pratonton hasil**: rajah terus menunjukkan kedudukan setiap nombor halaman pada kertas, dan **Pratonton hasil** menunjukkan hasil yang benar-benar dibuat. Dengan **Simpan hasil susunan sebagai PDF**, susunan yang sama boleh dicetak pada PC lain atau di kedai cetak.
- **Tetingkap cetakan sistem**: untuk buku kecil, pilih cetakan dua belah yang diterbalikkan pada sisi pendek. Biarkan julat halaman dan bilangan halaman setiap helai dalam tetingkap sistem seperti sedia ada.

Fail PDF dicetak mengikut susunan halaman dan putaran semasa.

## Di mana fail tanpa tajuk berada

Lokasi yang anda pilih semasa simpanan pertama menjadi rumah fail tersebut. Sebelum itu, dokumen belum mempunyai fail sendiri: kandungannya yang belum disimpan hanya wujud sebagai salinan pemulihan dalam folder data aplikasi, jadi ia boleh kembali jika aplikasi tertutup secara tiba-tiba (lihat [Tab dan pengurusan tingkap](help://tabs-and-windows)). Autosimpan mengambil alih hanya selepas simpanan pertama itu.
