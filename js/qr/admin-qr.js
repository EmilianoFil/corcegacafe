// ─────────────────────────────────────────────────────────────────────────────
// ADMIN QRs — Sección "Códigos QR" del Admin Dash.
// Cada doc en Firestore "qrs/{slug}" define a dónde redirige un QR propio.
// El QR "QR1" es el que ya está impreso y apunta a /qr1.html; los que se
// creen desde acá apuntan a /qr.html?id=SLUG (no hace falta imprimir un
// archivo nuevo por cada QR).
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '../firebase-config.js';
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, orderBy, query
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const BASE_URL = 'https://corcegacafe.com.ar';
const QRCODE_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';

let _qrsCache = [];
let _qrLibPromise = null;

function urlDe(slug) {
  return slug === 'QR1' ? `${BASE_URL}/qr1.html` : `${BASE_URL}/qr.html?id=${encodeURIComponent(slug)}`;
}

function cargarLibreriaQr() {
  if (window.QRCode) return Promise.resolve();
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QRCODE_LIB_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar la librería de QR'));
    document.head.appendChild(script);
  });
  return _qrLibPromise;
}

function slugify(nombre) {
  return nombre
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function loadQrsTable() {
  const tbody = document.getElementById('lista-qrs-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="padding:15px; color:var(--text-muted);">Cargando...</td></tr>';

  const snap = await getDocs(query(collection(db, 'qrs'), orderBy('creadoEn', 'desc')));
  _qrsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (_qrsCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:15px; color:var(--text-muted);">Todavía no creaste ningún QR. El físico ya impreso ("QR1") sigue funcionando aunque no aparezca acá — creálo con ese mismo nombre para poder editar a dónde apunta.</td></tr>';
    return;
  }

  tbody.innerHTML = _qrsCache.map(q => `
    <tr>
      <td style="padding:12px 15px; font-weight:700;">${q.id}</td>
      <td style="padding:12px 15px;">${q.nombre || ''}</td>
      <td style="padding:12px 15px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${q.destino || ''}">${q.destino || ''}</td>
      <td style="padding:12px 15px;">${q.clicks || 0}</td>
      <td style="padding:12px 15px;">
        <span style="padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700; ${q.activo === false ? 'background:#fdecea; color:#c0392b;' : 'background:#eafaf1; color:#1e8449;'}">
          ${q.activo === false ? 'Inactivo' : 'Activo'}
        </span>
      </td>
      <td style="padding:12px 15px; text-align:right; white-space:nowrap;">
        <button class="btn-secondary" style="margin:0; width:auto; padding:6px 12px; font-size:0.78rem; height:auto;" onclick="window.qrAdmin.mostrarQrImagen('${q.id}')">Ver QR</button>
        <button class="btn-secondary" style="margin:0; width:auto; padding:6px 12px; font-size:0.78rem; height:auto;" onclick="window.qrAdmin.mostrarFormularioQr('${q.id}')">Editar</button>
        <button class="btn-secondary" style="margin:0; width:auto; padding:6px 12px; font-size:0.78rem; height:auto; color:#c0392b;" onclick="window.qrAdmin.eliminarQr('${q.id}')">Borrar</button>
      </td>
    </tr>
  `).join('');
}

export function mostrarFormularioQr(slug) {
  const cont = document.getElementById('form-qr-container');
  const title = document.getElementById('form-qr-title');
  cont.style.display = 'block';
  document.getElementById('qr-slug-original').value = slug || '';
  document.getElementById('qr-slug').dataset.tocado = '';

  if (slug) {
    const q = _qrsCache.find(x => x.id === slug);
    title.textContent = `Editar QR — ${slug}`;
    document.getElementById('qr-nombre').value = q?.nombre || '';
    document.getElementById('qr-slug').value = slug;
    document.getElementById('qr-slug').disabled = true;
    document.getElementById('qr-destino').value = q?.destino || '';
    document.getElementById('qr-activo').checked = q?.activo !== false;
  } else {
    title.textContent = 'Nuevo QR';
    document.getElementById('qr-nombre').value = '';
    document.getElementById('qr-slug').value = '';
    document.getElementById('qr-slug').disabled = false;
    document.getElementById('qr-destino').value = '';
    document.getElementById('qr-activo').checked = true;
  }
  cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function ocultarFormularioQr() {
  document.getElementById('form-qr-container').style.display = 'none';
}

export function autocompletarSlugQr() {
  const slugInput = document.getElementById('qr-slug');
  if (slugInput.disabled || slugInput.dataset.tocado === '1') return;
  slugInput.value = slugify(document.getElementById('qr-nombre').value);
}

export async function guardarQr() {
  const original = document.getElementById('qr-slug-original').value;
  const nombre = document.getElementById('qr-nombre').value.trim();
  let slug = document.getElementById('qr-slug').value.trim().toUpperCase();
  let destino = document.getElementById('qr-destino').value.trim();
  const activo = document.getElementById('qr-activo').checked;

  if (!nombre) return alert('Ingresá un nombre para identificar el QR.');
  slug = slugify(slug || nombre);
  if (!slug) return alert('El identificador del QR quedó vacío, probá con otro nombre.');
  if (!destino) return alert('Ingresá la URL de destino.');
  if (!/^https?:\/\//i.test(destino)) destino = 'https://' + destino;

  if (!original && slug !== 'QR1') {
    const existente = await getDoc(doc(db, 'qrs', slug));
    if (existente.exists()) return alert(`Ya existe un QR con el identificador "${slug}". Elegí otro nombre o editá el existente.`);
  }

  try {
    await setDoc(doc(db, 'qrs', slug), {
      nombre,
      destino,
      activo,
      actualizadoEn: serverTimestamp(),
      ...(original ? {} : { creadoEn: serverTimestamp(), clicks: 0 })
    }, { merge: true });

    ocultarFormularioQr();
    await loadQrsTable();
    mostrarQrImagen(slug);
  } catch (err) {
    console.error(err);
    alert('Error al guardar el QR.');
  }
}

export async function eliminarQr(slug) {
  if (!confirm(`¿Borrar el QR "${slug}"? Si el código físico ya está impreso apuntando acá, dejará de redirigir.`)) return;
  try {
    await deleteDoc(doc(db, 'qrs', slug));
    await loadQrsTable();
  } catch (err) {
    console.error(err);
    alert('Error al borrar el QR.');
  }
}

export async function mostrarQrImagen(slug) {
  const q = _qrsCache.find(x => x.id === slug) || { id: slug };
  const url = urlDe(slug);

  const modal = document.getElementById('qr-preview-modal');
  document.getElementById('qr-preview-title').textContent = q.nombre ? `${q.nombre} (${slug})` : slug;
  document.getElementById('qr-preview-url').textContent = url;
  modal.style.display = 'flex';

  const canvas = document.getElementById('qr-preview-canvas');
  try {
    await cargarLibreriaQr();
    await window.QRCode.toCanvas(canvas, url, { width: 320, margin: 2, color: { dark: '#2b1a12', light: '#ffffff' } });
  } catch (err) {
    console.error(err);
    alert('No se pudo generar la imagen del QR.');
  }
}

export function cerrarQrImagen() {
  document.getElementById('qr-preview-modal').style.display = 'none';
}

export function descargarQrImagen() {
  const canvas = document.getElementById('qr-preview-canvas');
  const titulo = document.getElementById('qr-preview-title').textContent.replace(/[^a-z0-9]+/gi, '_');
  const link = document.createElement('a');
  link.download = `QR_${titulo || 'corcega'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function imprimirQrImagen() {
  const canvas = document.getElementById('qr-preview-canvas');
  const titulo = document.getElementById('qr-preview-title').textContent;
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Imprimir QR — ${titulo}</title></head>
    <body style="text-align:center; font-family:sans-serif; margin-top:40px;">
      <h2>${titulo}</h2>
      <img src="${canvas.toDataURL('image/png')}" style="width:320px;" />
      <script>window.onload = () => { window.print(); }<\/script>
    </body></html>
  `);
  win.document.close();
}
