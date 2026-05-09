import { db, storage } from '../firebase-config.js';
import {
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
    query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ─── Estado ─────────────────────────────────────────────────────────────────
let secciones      = [];
let platoEditando  = null;
// cada entrada: { url: string (preview), blob?: Blob (si es nueva), isNew: bool }
let fotosPlato     = [];

// ─── Crop modal (self-contained, usa Cropper.js ya cargado en la página) ────
let _cropperInstance = null;
let _cropQueue       = [];   // archivos pendientes de cropear
let _cropCallback    = null;

function _initCropModal() {
    if (document.getElementById('carta-crop-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'carta-crop-modal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.88); z-index:99999; align-items:center; justify-content:center; flex-direction:column; gap:16px;';
    modal.innerHTML = `
        <div style="background:white; border-radius:20px; padding:22px; max-width:500px; width:calc(100% - 32px); box-shadow:0 25px 60px rgba(0,0,0,0.4);">
            <p style="font-weight:800; margin:0 0 4px; font-size:0.95rem; color:#0d2b37;">✂️ Encuadrar foto</p>
            <p style="font-size:0.72rem; color:#aaa; margin:0 0 14px;">Ajustá el encuadre. Se guardará optimizada para carga rápida.</p>
            <div id="carta-crop-wrapper" style="width:100%; height:320px; overflow:hidden; border-radius:12px; background:#111;">
                <img id="carta-crop-img" style="display:block; max-width:100%;">
            </div>
            <div id="carta-crop-preview-row" style="display:flex; gap:12px; align-items:center; margin-top:14px;">
                <div>
                    <p style="font-size:0.68rem; color:#aaa; font-weight:700; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Miniatura (card)</p>
                    <div id="carta-crop-thumb" style="width:80px; height:80px; border-radius:10px; overflow:hidden; background:#eee; border:2px solid #eee;"></div>
                </div>
                <div>
                    <p style="font-size:0.68rem; color:#aaa; font-weight:700; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Modal (detalle)</p>
                    <div id="carta-crop-thumb-wide" style="width:140px; height:105px; border-radius:10px; overflow:hidden; background:#eee; border:2px solid #eee;"></div>
                </div>
            </div>
            <div style="display:flex; gap:10px; margin-top:16px;">
                <button id="carta-btn-crop-cancel" type="button"
                    style="flex:1; padding:12px; border:1px solid #eee; border-radius:10px; background:white; font-weight:700; cursor:pointer; color:#666; font-family:inherit;">
                    Cancelar
                </button>
                <button id="carta-btn-crop-confirm" type="button"
                    style="flex:2; padding:12px; border:none; border-radius:10px; background:#0d2b37; color:white; font-weight:800; cursor:pointer; font-family:inherit;">
                    ✅ Usar esta imagen
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById('carta-btn-crop-cancel').onclick  = _cancelCrop;
    document.getElementById('carta-btn-crop-confirm').onclick = _confirmCrop;
}

function _abrirCrop(file) {
    _initCropModal();
    const modal = document.getElementById('carta-crop-modal');
    const img   = document.getElementById('carta-crop-img');

    if (_cropperInstance) { _cropperInstance.destroy(); _cropperInstance = null; }

    const url = URL.createObjectURL(file);
    img.src   = url;
    modal.style.display = 'flex';

    img.onload = () => {
        _cropperInstance = new Cropper(img, {
            aspectRatio: 4 / 3,
            viewMode: 1,
            autoCropArea: 0.9,
            movable: true,
            zoomable: true,
            cropBoxResizable: true,
            preview: ['#carta-crop-thumb', '#carta-crop-thumb-wide'],
        });
    };
}

function _cancelCrop() {
    _cropperInstance?.destroy();
    _cropperInstance = null;
    _cropQueue = [];
    document.getElementById('carta-crop-modal').style.display = 'none';
}

async function _confirmCrop() {
    if (!_cropperInstance) return;

    const btn = document.getElementById('carta-btn-crop-confirm');
    btn.textContent = 'Procesando...';
    btn.disabled = true;

    const blob = await new Promise(resolve => {
        _cropperInstance.getCroppedCanvas({ maxWidth: 1200, maxHeight: 900, fillColor: '#fff' })
            .toBlob(b => resolve(b), 'image/jpeg', 0.82);
    });

    const blobUrl = URL.createObjectURL(blob);
    fotosPlato.push({ url: blobUrl, blob, isNew: true });
    _renderFotosPreview();

    _cropperInstance.destroy();
    _cropperInstance = null;
    btn.textContent = '✅ Usar esta imagen';
    btn.disabled = false;
    document.getElementById('carta-crop-modal').style.display = 'none';

    // Si hay más fotos en la cola, procesarlas
    if (_cropQueue.length) _abrirCrop(_cropQueue.shift());
}

// ─── SECCIONES ──────────────────────────────────────────────────────────────

export async function loadSecciones() {
    const tbody = document.getElementById('carta-secciones-body');
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:#aaa;">Cargando...</td></tr>`;

    const snap = await getDocs(query(collection(db, 'carta_secciones'), orderBy('orden')));
    secciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    _renderSecciones();
    _poblarSelectSecciones();
}

function _renderSecciones() {
    const tbody = document.getElementById('carta-secciones-body');
    if (!secciones.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:#aaa;">Todavía no hay secciones.</td></tr>`;
        return;
    }
    tbody.innerHTML = secciones.map(s => `
        <tr style="border-bottom:1px solid #f5f5f5;">
            <td style="padding:12px 15px; color:#aaa; font-size:0.85rem;">${s.orden ?? '—'}</td>
            <td style="padding:12px 15px; font-weight:600;">${s.nombre}</td>
            <td style="padding:12px 15px; text-align:center;">
                <label style="cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:0.85rem;">
                    <input type="checkbox" ${s.activa ? 'checked' : ''} onchange="window.cartaAdmin.toggleSeccionActiva('${s.id}', this.checked)">
                    ${s.activa ? 'Sí' : 'No'}
                </label>
            </td>
            <td style="padding:12px 15px; text-align:right;">
                <button onclick="window.cartaAdmin.editarSeccion('${s.id}')"
                    style="padding:5px 12px; border-radius:7px; border:1px solid #ddd; background:white; font-size:0.8rem; cursor:pointer; font-family:inherit; margin-right:6px;">
                    Editar
                </button>
                <button onclick="window.cartaAdmin.eliminarSeccion('${s.id}')"
                    style="padding:5px 12px; border-radius:7px; border:none; background:#ffeaea; color:#ae2012; font-size:0.8rem; cursor:pointer; font-family:inherit; font-weight:700;">
                    Eliminar
                </button>
            </td>
        </tr>`).join('');
}

function _poblarSelectSecciones() {
    const opts = secciones.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    const el   = document.getElementById('plato-seccion');
    const fil  = document.getElementById('carta-filtro-seccion');
    if (el)  el.innerHTML  = `<option value="">— Elegir sección —</option>${opts}`;
    if (fil) fil.innerHTML = `<option value="">— Todas las secciones —</option>${opts}`;
}

export async function guardarSeccion() {
    const input  = document.getElementById('carta-sec-nombre');
    const errDiv = document.getElementById('carta-sec-error');
    const nombre = input.value.trim();
    errDiv.style.display = 'none';
    if (!nombre) { errDiv.textContent = 'El nombre es obligatorio.'; errDiv.style.display = 'block'; return; }
    const orden = secciones.length ? Math.max(...secciones.map(s => s.orden ?? 0)) + 1 : 1;
    await addDoc(collection(db, 'carta_secciones'), { nombre, orden, activa: true, creadoEn: serverTimestamp() });
    input.value = '';
    await loadSecciones();
}

export async function editarSeccion(id) {
    const sec = secciones.find(s => s.id === id);
    if (!sec) return;
    const nuevoNombre = prompt('Nombre de la sección:', sec.nombre);
    if (nuevoNombre === null || !nuevoNombre.trim()) return;
    await updateDoc(doc(db, 'carta_secciones', id), { nombre: nuevoNombre.trim() });
    await loadSecciones();
}

export async function toggleSeccionActiva(id, activa) {
    await updateDoc(doc(db, 'carta_secciones', id), { activa });
    secciones = secciones.map(s => s.id === id ? { ...s, activa } : s);
}

export async function eliminarSeccion(id) {
    const sec = secciones.find(s => s.id === id);
    if (!confirm(`¿Eliminar la sección "${sec?.nombre}"?`)) return;
    await deleteDoc(doc(db, 'carta_secciones', id));
    await loadSecciones();
}

// ─── PLATOS ─────────────────────────────────────────────────────────────────

export async function loadPlatos(seccionId = '') {
    if (!secciones.length) await loadSecciones();
    const tbody = document.getElementById('carta-platos-body');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#aaa;">Cargando...</td></tr>`;

    const snap = await getDocs(query(collection(db, 'carta_platos'), orderBy('seccionId'), orderBy('orden')));
    let platos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (seccionId) platos = platos.filter(p => p.seccionId === seccionId);

    if (!platos.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#aaa;">Todavía no hay platos.</td></tr>`;
        return;
    }

    const secMap = Object.fromEntries(secciones.map(s => [s.id, s.nombre]));
    tbody.innerHTML = platos.map(p => {
        const foto   = p.fotos?.[0] ?? '';
        const precio = p.precio != null ? `$${Number(p.precio).toLocaleString('es-AR')}` : '—';
        return `
        <tr style="border-bottom:1px solid #f5f5f5;">
            <td style="padding:10px 15px;">
                ${foto
                    ? `<img src="${foto}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`
                    : `<div style="width:48px;height:48px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍽️</div>`}
            </td>
            <td style="padding:10px 15px; font-weight:600;">${p.nombre}</td>
            <td style="padding:10px 15px; color:#888; font-size:0.85rem;">${secMap[p.seccionId] ?? '—'}</td>
            <td style="padding:10px 15px; text-align:right; font-weight:700;">${precio}</td>
            <td style="padding:10px 15px; text-align:center;">
                <input type="checkbox" ${p.activo !== false ? 'checked' : ''} onchange="window.cartaAdmin.togglePlatoActivo('${p.id}', this.checked)">
            </td>
            <td style="padding:10px 15px; text-align:right;">
                <button onclick="window.cartaAdmin.editarPlato('${p.id}')"
                    style="padding:5px 12px; border-radius:7px; border:1px solid #ddd; background:white; font-size:0.8rem; cursor:pointer; font-family:inherit; margin-right:6px;">
                    Editar
                </button>
                <button onclick="window.cartaAdmin.eliminarPlato('${p.id}')"
                    style="padding:5px 12px; border-radius:7px; border:none; background:#ffeaea; color:#ae2012; font-size:0.8rem; cursor:pointer; font-family:inherit; font-weight:700;">
                    Eliminar
                </button>
            </td>
        </tr>`;
    }).join('');
}

export function filtrarPlatosPorSeccion(seccionId) { loadPlatos(seccionId); }

export function mostrarFormPlato() {
    platoEditando = null;
    fotosPlato    = [];
    document.getElementById('plato-id').value          = '';
    document.getElementById('plato-nombre').value      = '';
    document.getElementById('plato-descripcion').value = '';
    document.getElementById('plato-precio').value      = '';
    document.getElementById('plato-seccion').value     = '';
    document.querySelectorAll('.plato-tag').forEach(cb => cb.checked = false);
    document.getElementById('form-plato-titulo').textContent = 'Nuevo Plato';
    document.getElementById('plato-form-error').style.display = 'none';
    _renderFotosPreview();
    document.getElementById('form-plato-wrapper').style.display = 'block';
    document.getElementById('form-plato-wrapper').scrollIntoView({ behavior: 'smooth' });
}

export function ocultarFormPlato() {
    document.getElementById('form-plato-wrapper').style.display = 'none';
    platoEditando = null;
    fotosPlato    = [];
}

export async function editarPlato(id) {
    if (!secciones.length) await loadSecciones();
    const snap    = await getDocs(collection(db, 'carta_platos'));
    const platoDoc = snap.docs.find(d => d.id === id);
    if (!platoDoc) return;
    const p = { id: platoDoc.id, ...platoDoc.data() };

    platoEditando = id;
    fotosPlato    = (p.fotos ?? []).map(url => ({ url, isNew: false }));

    document.getElementById('plato-id').value          = id;
    document.getElementById('plato-nombre').value      = p.nombre ?? '';
    document.getElementById('plato-descripcion').value = p.descripcion ?? '';
    document.getElementById('plato-precio').value      = p.precio ?? '';
    document.getElementById('plato-seccion').value     = p.seccionId ?? '';
    document.querySelectorAll('.plato-tag').forEach(cb => { cb.checked = (p.tags ?? []).includes(cb.value); });
    document.getElementById('form-plato-titulo').textContent = 'Editar Plato';
    document.getElementById('plato-form-error').style.display = 'none';
    _renderFotosPreview();
    document.getElementById('form-plato-wrapper').style.display = 'block';
    document.getElementById('form-plato-wrapper').scrollIntoView({ behavior: 'smooth' });
}

export async function guardarPlato() {
    const errDiv     = document.getElementById('plato-form-error');
    const btn        = document.querySelector('[onclick="window.cartaAdmin.guardarPlato()"]');
    errDiv.style.display = 'none';

    const nombre     = document.getElementById('plato-nombre').value.trim();
    const descripcion = document.getElementById('plato-descripcion').value.trim();
    const precio     = parseFloat(document.getElementById('plato-precio').value);
    const seccionId  = document.getElementById('plato-seccion').value;
    const tags       = [...document.querySelectorAll('.plato-tag:checked')].map(cb => cb.value);

    if (!nombre)   { errDiv.textContent = 'El nombre es obligatorio.'; errDiv.style.display = 'block'; return; }
    if (!seccionId) { errDiv.textContent = 'Elegí una sección.';       errDiv.style.display = 'block'; return; }

    if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }

    try {
        const platoId  = platoEditando ?? 'tmp_' + Date.now();
        const fotosUrls = await _subirFotosNuevas(platoId);

        const data = {
            nombre, descripcion,
            precio: isNaN(precio) ? null : precio,
            seccionId, tags,
            fotos: fotosUrls,
            activo: true,
            orden: 0,
            actualizadoEn: serverTimestamp()
        };

        if (platoEditando) {
            await updateDoc(doc(db, 'carta_platos', platoEditando), data);
        } else {
            const snap = await getDocs(collection(db, 'carta_platos'));
            data.orden    = snap.size;
            data.creadoEn = serverTimestamp();
            await addDoc(collection(db, 'carta_platos'), data);
        }

        ocultarFormPlato();
        await loadPlatos();
    } finally {
        if (btn) { btn.textContent = 'Guardar Plato'; btn.disabled = false; }
    }
}

export async function togglePlatoActivo(id, activo) {
    await updateDoc(doc(db, 'carta_platos', id), { activo });
}

export async function eliminarPlato(id) {
    if (!confirm('¿Eliminar este plato? Esta acción no se puede deshacer.')) return;
    await deleteDoc(doc(db, 'carta_platos', id));
    await loadPlatos();
}

// ─── Fotos ───────────────────────────────────────────────────────────────────

export function handleFotosUpload(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;

    // Abrir el primero en el crop, encolar el resto
    _cropQueue = files.slice(1);
    _abrirCrop(files[0]);
}

function _renderFotosPreview() {
    const container = document.getElementById('plato-fotos-preview');
    if (!fotosPlato.length) {
        container.innerHTML = `<span style="color:#ccc; font-size:0.85rem;">Sin fotos todavía</span>`;
        return;
    }
    container.innerHTML = fotosPlato.map((f, i) => `
        <div style="position:relative; cursor:pointer;" onclick="window.cartaAdmin.marcarPrincipal(${i})" title="Marcar como principal">
            <img src="${f.url}"
                style="width:80px; height:80px; border-radius:10px; object-fit:cover;
                       border: ${i === 0 ? '3px solid #d86634' : '2px solid #eee'};">
            ${i === 0 ? `<span style="position:absolute;top:3px;left:3px;background:#d86634;color:white;font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;">★</span>` : ''}
            <button onclick="event.stopPropagation(); window.cartaAdmin.quitarFoto(${i})"
                style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.55);border:none;border-radius:50%;width:18px;height:18px;color:white;font-size:10px;cursor:pointer;line-height:1;padding:0;">✕</button>
        </div>`).join('');
}

export function marcarPrincipal(idx) {
    if (idx === 0) return;
    const [foto] = fotosPlato.splice(idx, 1);
    fotosPlato.unshift(foto);
    _renderFotosPreview();
}

export function quitarFoto(idx) {
    fotosPlato.splice(idx, 1);
    _renderFotosPreview();
}

async function _subirFotosNuevas(platoId) {
    const urls = [];
    for (const foto of fotosPlato) {
        if (!foto.isNew) { urls.push(foto.url); continue; }
        const storageRef = ref(storage, `carta/${platoId}/${Date.now()}.jpg`);
        await uploadBytes(storageRef, foto.blob, { contentType: 'image/jpeg' });
        urls.push(await getDownloadURL(storageRef));
    }
    return urls;
}
