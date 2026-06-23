# SC23 Harita Earth Web

Bu klasor `earth.sc23harita.com` icin hazirlanan statik web surumudur.

## Dosyalar

- `index.html`: Ana uygulama
- `styles.css`: Arayuz
- `app.js`: KML/KMZ okuma, harita ve koordinat listesi
- `CNAME`: GitHub Pages domain ayari

## GitHub Pages

1. GitHub'da yeni repo ac: `sc23-harita-earth-web`
2. Bu klasordeki dosyalari repoya yukle.
3. GitHub repo ayarlarinda `Settings > Pages` bolumune gir.
4. `Deploy from branch` sec, branch olarak `main`, klasor olarak `/root` sec.
5. DNS tarafinda `earth.sc23harita.com` icin CNAME kaydi ekle:
   - Host: `earth`
   - Type: `CNAME`
   - Value: `GITHUB_KULLANICI_ADIN.github.io`

## Not

Bu web surumu Google Earth masaustu uygulamasinin birebir 3D motoru degildir. KML/KMZ icindeki nokta, cizgi, poligon ve koordinatlari web haritasinda acar. Google Earth'e ozel tur, model ve bazi 3D efektler tarayicida sinirli olabilir.
