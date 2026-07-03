const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'corcegacafe' });

async function main() {
  const db = admin.firestore();
  const snap = await db.collection('productos').where('activo', '==', true).get();

  const base = 'https://corcegacafe.com.ar';
  const hoy = new Date().toISOString().split('T')[0];

  const urls = [
    `  <url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${base}/tienda.html</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...snap.docs.map(d =>
      `  <url><loc>${base}/producto.html?id=${d.id}</loc><lastmod>${hoy}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(__dirname, '..', 'sitemap.xml'), xml);
  console.log(`Sitemap generado: ${snap.docs.length} productos activos`);
}

main().catch(e => { console.error(e); process.exit(1); });
