# ShortsStudio

YouTube linkini yapıştırıp, istediğin aralığı kesip **1080×1920 dikey shorts** olarak indirebileceğin web uygulaması.

## Özellikler

- YouTube linki ile video indirme (yt-dlp)
- Zaman çizgisinde sürükleyerek kesit seçme
- 15 / 30 / 60 saniye hızlı seçim
- Üç çıktı formatı:
  - **Blur arka plan** – video ortada, arkası bulanık (önerilen)
  - **Ortadan kırp** – tam ekran dikey
  - **Orijinal (16:9)** – yatay
- MP4 çıktı (H.264 + AAC), anında indirme
- Maksimum 180 saniyelik kesit

## Kurulum

Gereksinimler: **Node.js 18+**, **Python 3.9+**

```bash
cd shorts-studio
npm install
python -m pip install --upgrade yt-dlp imageio-ffmpeg
npm start
```

Ardından <http://localhost:3000> adresini aç.

> Windows'ta `kurulum.bat` dosyası bu iki adımı birlikte yapar, `baslat.bat` ise sunucuyu başlatır.

## Kullanım

1. YouTube video linkini yapıştır ve **Videoyu Yükle**'ye bas.
2. Video hazır olunca zaman çizgisinden başlangıç/bitiş noktalarını sürükle.
   İstersen videoyu oynatıp **Başlangıç yap** / **Bitiş yap** düğmelerini kullan.
3. Formatı seç ve **Shorts'u Oluştur**'a bas.
4. Oluşan videoyu önizle ve **Videoyu İndir** ile kaydet.

## Ortam değişkenleri

| Değişken | Açıklama | Varsayılan |
| --- | --- | --- |
| `PORT` | Sunucu portu | `3000` |
| `PYTHON` | Python çalıştırılabilir dosyası | `python` |
| `FFMPEG` | ffmpeg tam yolu | `imageio-ffmpeg` ile otomatik bulunur |

## Nasıl çalışır?

- `yt-dlp` videoyu en fazla 1080p çözünürlükte indirir.
- `ffmpeg` seçilen aralığı yeniden kodlayarak 1080×1920 (veya 1920×1080) MP4'e dönüştürür.
- İşler 24 saat sonra otomatik temizlenir.

## Notlar

- Bazı videolar telif/kota nedeniyle indirilemeyebilir; uygulama bu durumda hata mesajı gösterir.
- YouTube'un giriş gerektirdiği veya bölgeye kısıtlı videolar çalışmayabilir.
- Bu araç yalnızca kişisel kullanım ve telif hakkı size ait içerikler için tasarlanmıştır.