import { db, storage } from '../firebase-config.js';
import {
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
    query, orderBy, serverTimestamp, writeBatch
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
    modal.style.display = 'flex';

    // Esperar un frame para que el modal tenga dimensiones reales antes de Cropper
    requestAnimationFrame(() => {
        img.onload = () => {
            setTimeout(() => {
                _cropperInstance = new Cropper(img, {
                    aspectRatio: 4 / 3,
                    viewMode: 1,
                    autoCropArea: 0.9,
                    movable: true,
                    zoomable: true,
                    cropBoxResizable: true,
                    preview: '#carta-crop-thumb, #carta-crop-thumb-wide',
                });
            }, 50);
        };
        img.src = url;
    });
}

function _cancelCrop() {
    _cropperInstance?.destroy();
    _cropperInstance = null;
    _cropQueue = [];
    document.getElementById('carta-crop-modal').style.display = 'none';
}

// Redimensiona un canvas a maxPx en el lado largo y lo convierte a blob JPEG
function _resizeCanvas(srcCanvas, maxPx, quality) {
    return new Promise(resolve => {
        const ratio = Math.min(maxPx / srcCanvas.width, maxPx / srcCanvas.height, 1);
        const w = Math.round(srcCanvas.width  * ratio);
        const h = Math.round(srcCanvas.height * ratio);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
        c.toBlob(b => resolve(b), 'image/jpeg', quality);
    });
}

async function _confirmCrop() {
    if (!_cropperInstance) return;

    const btn = document.getElementById('carta-btn-crop-confirm');
    btn.textContent = 'Procesando...';
    btn.disabled = true;

    // Canvas base sin redimensionar (máxima calidad del crop)
    const srcCanvas = _cropperInstance.getCroppedCanvas({ fillColor: '#fff' });

    // Generar los 3 tamaños en paralelo
    const [thumbBlob, mediumBlob, fullBlob] = await Promise.all([
        _resizeCanvas(srcCanvas,  500, 0.75),   // card thumbnail
        _resizeCanvas(srcCanvas, 1400, 0.88),   // modal view
        _resizeCanvas(srcCanvas, 2800, 0.96),   // full HD
    ]);

    const thumbUrl = URL.createObjectURL(thumbBlob);
    fotosPlato.push({ url: thumbUrl, thumbBlob, mediumBlob, fullBlob, isNew: true });
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
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#aaa;">Todavía no hay secciones.</td></tr>`;
        return;
    }
    tbody.innerHTML = secciones.map(s => `
        <tr data-id="${s.id}" style="border-bottom:1px solid #f5f5f5;">
            <td class="drag-handle" style="padding:12px 10px 12px 15px; color:#ccc; cursor:grab; font-size:1.1rem; user-select:none; touch-action:none;">⠿</td>
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

    _initSortable(tbody);
}

function _initSortable(tbody) {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(tbody, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const rows   = [...tbody.querySelectorAll('tr[data-id]')];
            const batch  = writeBatch(db);
            rows.forEach((row, i) => {
                batch.update(doc(db, 'carta_secciones', row.dataset.id), { orden: i + 1 });
            });
            await batch.commit();
            // Actualizar cache local para que _poblarSelectSecciones quede en orden
            const nuevoOrden = rows.map(r => r.dataset.id);
            secciones = nuevoOrden.map(id => secciones.find(s => s.id === id)).filter(Boolean);
            secciones.forEach((s, i) => s.orden = i + 1);
            _poblarSelectSecciones();
        }
    });
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#aaa;">Todavía no hay platos.</td></tr>`;
        return;
    }

    const secMap = Object.fromEntries(secciones.map(s => [s.id, s.nombre]));
    tbody.innerHTML = platos.map(p => {
        const foto     = p.fotos?.[0] ?? '';
        const precio   = p.precio   != null ? `$${Number(p.precio).toLocaleString('es-AR')}` : '—';
        const precioPY = p.precioPY != null ? `$${Number(p.precioPY).toLocaleString('es-AR')}` : '—';
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
            <td style="padding:10px 15px; text-align:right; font-weight:700; color:#d86634;">${precioPY}</td>
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
    document.getElementById('plato-pct-py').value      = '';
    document.getElementById('plato-precio-py').value   = '';
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
    // Compatibilidad: fotos puede ser string[] (viejo) u objeto[] {thumb,medium,full} (nuevo)
    fotosPlato = (p.fotos ?? []).map(f => ({
        url:    typeof f === 'string' ? f : f.thumb,
        stored: f,   // guardar el valor original para re-persistir sin resubir
        isNew:  false
    }));

    document.getElementById('plato-id').value          = id;
    document.getElementById('plato-nombre').value      = p.nombre ?? '';
    document.getElementById('plato-descripcion').value = p.descripcion ?? '';
    document.getElementById('plato-precio').value      = p.precio ?? '';
    document.getElementById('plato-seccion').value     = p.seccionId ?? '';
    document.getElementById('plato-pct-py').value      = p.pctPY ?? '';
    document.getElementById('plato-precio-py').value   = p.precioPY ?? '';
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
    const pctPY      = parseFloat(document.getElementById('plato-pct-py').value);
    const precioPY   = parseFloat(document.getElementById('plato-precio-py').value);

    if (!nombre)   { errDiv.textContent = 'El nombre es obligatorio.'; errDiv.style.display = 'block'; return; }
    if (!seccionId) { errDiv.textContent = 'Elegí una sección.';       errDiv.style.display = 'block'; return; }

    if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }

    try {
        const platoId  = platoEditando ?? 'tmp_' + Date.now();
        const fotosUrls = await _subirFotosNuevas(platoId);

        const data = {
            nombre, descripcion,
            precio:   isNaN(precio)   ? null : precio,
            pctPY:    isNaN(pctPY)    ? null : pctPY,
            precioPY: isNaN(precioPY) ? null : precioPY,
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

export function _calcPrecioPY() {
    const precio = parseFloat(document.getElementById('plato-precio').value);
    const pct    = parseFloat(document.getElementById('plato-pct-py').value);
    const pyInp  = document.getElementById('plato-precio-py');
    if (!isNaN(precio) && !isNaN(pct) && pct >= 0) {
        pyInp.value = _redondear50(precio * (1 + pct / 100));
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

// ─── EDITOR MASIVO DE PRECIOS ────────────────────────────────────────────────

function _redondear50(precio) {
    return Math.ceil(precio / 50) * 50;
}

export async function abrirEditorPrecios() {
    const snap = await getDocs(query(collection(db, 'carta_platos'), orderBy('seccionId'), orderBy('orden')));
    const platos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const secMap = Object.fromEntries(secciones.map(s => [s.id, s.nombre]));

    let modal = document.getElementById('modal-precios');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-precios';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';

    const filas = platos.map(p => {
        const precioActual   = p.precio   != null ? p.precio   : '';
        const precioPYActual = p.precioPY != null ? p.precioPY : '';
        const pctPY          = p.pctPY    != null ? p.pctPY    : '';
        return `
        <tr data-id="${p.id}" data-precio-original="${precioActual}" data-precio-py-original="${precioPYActual}" data-pct-py="${pctPY}" style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:10px 12px;text-align:center;">
                <input type="checkbox" class="chk-plato" checked style="width:16px;height:16px;cursor:pointer;">
            </td>
            <td style="padding:10px 12px;font-weight:600;font-size:0.9rem;">${p.nombre}</td>
            <td style="padding:10px 12px;font-size:0.8rem;color:#888;">${secMap[p.seccionId] ?? '—'}</td>
            <td style="padding:10px 12px;font-weight:700;color:#555;text-align:right;">
                ${precioActual !== '' ? `$${Number(precioActual).toLocaleString('es-AR')}` : '—'}
            </td>
            <td style="padding:8px 12px;">
                <input type="number" class="inp-precio-nuevo" value="${precioActual}"
                    min="0" step="50"
                    style="width:110px;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;font-family:inherit;text-align:right;"
                    oninput="_marcarCambio(this)">
            </td>
            <td style="padding:8px 12px;">
                <input type="number" class="inp-precio-py-nuevo" value="${precioPYActual}"
                    min="0" step="50"
                    style="width:110px;padding:7px 10px;border:1px solid #f0ddd0;border-radius:8px;font-size:0.9rem;font-family:inherit;text-align:right;background:#fff8f0;"
                    oninput="_marcarCambioPY(this)">
                ${pctPY !== '' ? `<span style="font-size:0.72rem;color:#aaa;display:block;text-align:right;margin-top:2px;">${pctPY}%</span>` : ''}
            </td>
        </tr>`;
    }).join('');

    modal.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:780px;box-shadow:0 30px 80px rgba(0,0,0,0.35);overflow:hidden;margin:auto;">
        <div style="background:#0d2b37;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <p style="margin:0;font-weight:800;font-size:1.05rem;color:white;">Actualizar precios</p>
                <p style="margin:4px 0 0;font-size:0.75rem;color:rgba(255,255,255,0.55);">Los precios se redondean al múltiplo de 50 más cercano hacia arriba</p>
            </div>
            <button onclick="document.getElementById('modal-precios').remove()"
                style="background:rgba(255,255,255,0.12);border:none;border-radius:8px;color:white;font-size:1.2rem;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <!-- Toolbar aumento % -->
        <div style="padding:16px 24px;border-bottom:1px solid #f0f0f0;background:#fafafa;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <label style="font-size:0.8rem;font-weight:700;color:#555;">Aumentar seleccionados:</label>
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="number" id="inp-pct-aumento" value="10" min="0" max="999" step="1"
                    style="width:70px;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;font-family:inherit;text-align:right;">
                <span style="font-size:0.9rem;font-weight:700;color:#555;">%</span>
                <button onclick="window.cartaAdmin._aplicarPorcentaje()"
                    style="padding:8px 18px;border-radius:8px;border:none;background:#0d2b37;color:white;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;">
                    Aplicar
                </button>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;">
                <button onclick="window.cartaAdmin._seleccionarTodos(true)"
                    style="padding:6px 12px;border-radius:7px;border:1px solid #ddd;background:white;font-size:0.78rem;cursor:pointer;font-family:inherit;">
                    Seleccionar todo
                </button>
                <button onclick="window.cartaAdmin._seleccionarTodos(false)"
                    style="padding:6px 12px;border-radius:7px;border:1px solid #ddd;background:white;font-size:0.78rem;cursor:pointer;font-family:inherit;">
                    Ninguno
                </button>
            </div>
        </div>

        <!-- Tabla -->
        <div style="max-height:60vh;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;">
                <thead style="position:sticky;top:0;background:#f7f7f7;z-index:1;">
                    <tr style="font-size:0.75rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;">
                        <th style="padding:10px 12px;text-align:center;width:40px;">✓</th>
                        <th style="padding:10px 12px;text-align:left;">Nombre</th>
                        <th style="padding:10px 12px;text-align:left;">Sección</th>
                        <th style="padding:10px 12px;text-align:right;">Precio actual</th>
                        <th style="padding:10px 12px;text-align:left;">Precio nuevo</th>
                        <th style="padding:10px 12px;text-align:left;color:#d86634;">🛵 Precio PY</th>
                    </tr>
                </thead>
                <tbody id="tabla-precios-body">
                    ${filas}
                </tbody>
            </table>
        </div>

        <!-- Footer -->
        <div style="padding:16px 24px;border-top:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <span id="lbl-cambios-precios" style="font-size:0.82rem;color:#888;"></span>
            <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('modal-precios').remove()"
                    style="padding:10px 20px;border-radius:10px;border:1px solid #ddd;background:white;font-size:0.85rem;cursor:pointer;font-family:inherit;font-weight:600;">
                    Cancelar
                </button>
                <button id="btn-guardar-precios" onclick="window.cartaAdmin._guardarPrecios()"
                    style="padding:10px 24px;border-radius:10px;border:none;background:#d86634;color:white;font-weight:800;font-size:0.85rem;cursor:pointer;font-family:inherit;">
                    Guardar cambios
                </button>
            </div>
        </div>
    </div>`;

    document.body.appendChild(modal);
    _actualizarContadorCambios();
}

export function _aplicarPorcentaje() {
    const pct = parseFloat(document.getElementById('inp-pct-aumento').value);
    if (isNaN(pct) || pct < 0) return;
    document.querySelectorAll('#tabla-precios-body tr').forEach(tr => {
        const chk = tr.querySelector('.chk-plato');
        if (!chk?.checked) return;
        const original = parseFloat(tr.dataset.precioOriginal);
        if (isNaN(original)) return;
        const nuevo = _redondear50(original * (1 + pct / 100));
        const inp = tr.querySelector('.inp-precio-nuevo');
        inp.value = nuevo;
        _marcarCambio(inp);
    });
    _actualizarContadorCambios();
}

export function _seleccionarTodos(estado) {
    document.querySelectorAll('#tabla-precios-body .chk-plato').forEach(chk => { chk.checked = estado; });
}

function _marcarCambio(inp) {
    const tr = inp.closest('tr');
    const original = parseFloat(tr.dataset.precioOriginal);
    const nuevo = parseFloat(inp.value);
    const cambio = !isNaN(nuevo) && nuevo !== original;
    inp.style.borderColor = cambio ? '#d86634' : '#ddd';
    inp.style.fontWeight  = cambio ? '700' : '400';

    if (!isNaN(nuevo)) {
        const pctPY = parseFloat(tr.dataset.pctPy);
        if (!isNaN(pctPY) && pctPY > 0) {
            const pyInp = tr.querySelector('.inp-precio-py-nuevo');
            if (pyInp) pyInp.value = _redondear50(nuevo * (1 + pctPY / 100));
        }
    }

    _actualizarContadorCambios();
}

function _marcarCambioPY(inp) {
    const tr = inp.closest('tr');
    const original = parseFloat(tr.dataset.precioPyOriginal);
    const nuevo = parseFloat(inp.value);
    const cambio = !isNaN(nuevo) && nuevo !== original;
    inp.style.borderColor = cambio ? '#d86634' : '#f0ddd0';
    _actualizarContadorCambios();
}

window._marcarCambio   = _marcarCambio;
window._marcarCambioPY = _marcarCambioPY;

function _actualizarContadorCambios() {
    let cambios = 0;
    document.querySelectorAll('#tabla-precios-body tr').forEach(tr => {
        const original   = parseFloat(tr.dataset.precioOriginal);
        const nuevo      = parseFloat(tr.querySelector('.inp-precio-nuevo')?.value);
        const originalPY = parseFloat(tr.dataset.precioPyOriginal);
        const nuevoPY    = parseFloat(tr.querySelector('.inp-precio-py-nuevo')?.value);
        if ((!isNaN(nuevo) && nuevo !== original) || (!isNaN(nuevoPY) && nuevoPY !== originalPY)) cambios++;
    });
    const lbl = document.getElementById('lbl-cambios-precios');
    if (lbl) lbl.textContent = cambios > 0 ? `${cambios} precio${cambios > 1 ? 's' : ''} modificado${cambios > 1 ? 's' : ''}` : '';
}

export async function _guardarPrecios() {
    const btn = document.getElementById('btn-guardar-precios');
    const filas = [...document.querySelectorAll('#tabla-precios-body tr')];
    const cambios = filas.filter(tr => {
        const original   = parseFloat(tr.dataset.precioOriginal);
        const nuevo      = parseFloat(tr.querySelector('.inp-precio-nuevo')?.value);
        const originalPY = parseFloat(tr.dataset.precioPyOriginal);
        const nuevoPY    = parseFloat(tr.querySelector('.inp-precio-py-nuevo')?.value);
        return (!isNaN(nuevo) && nuevo !== original) || (!isNaN(nuevoPY) && nuevoPY !== originalPY);
    });
    if (!cambios.length) { document.getElementById('modal-precios').remove(); return; }

    btn.textContent = 'Guardando...';
    btn.disabled = true;

    const batch = writeBatch(db);
    cambios.forEach(tr => {
        const original   = parseFloat(tr.dataset.precioOriginal);
        const nuevo      = parseFloat(tr.querySelector('.inp-precio-nuevo').value);
        const originalPY = parseFloat(tr.dataset.precioPyOriginal);
        const nuevoPY    = parseFloat(tr.querySelector('.inp-precio-py-nuevo')?.value);
        const updateData = { actualizadoEn: serverTimestamp() };
        if (!isNaN(nuevo)   && nuevo   !== original)   updateData.precio   = nuevo;
        if (!isNaN(nuevoPY) && nuevoPY !== originalPY) updateData.precioPY = nuevoPY;
        batch.update(doc(db, 'carta_platos', tr.dataset.id), updateData);
    });
    await batch.commit();

    document.getElementById('modal-precios').remove();
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

async function _uploadBlob(blob, path) {
    const r = ref(storage, path);
    await uploadBytes(r, blob, { contentType: 'image/jpeg' });
    return getDownloadURL(r);
}

async function _subirFotosNuevas(platoId) {
    const urls = [];
    for (const foto of fotosPlato) {
        if (!foto.isNew) {
            // Persistir el valor original tal cual (string o {thumb,medium,full})
            urls.push(foto.stored ?? foto.url);
            continue;
        }
        const base = `carta/${platoId}/${Date.now()}`;
        const [thumb, medium, full] = await Promise.all([
            _uploadBlob(foto.thumbBlob,  `${base}_thumb.jpg`),
            _uploadBlob(foto.mediumBlob, `${base}_medium.jpg`),
            _uploadBlob(foto.fullBlob,   `${base}_full.jpg`),
        ]);
        urls.push({ thumb, medium, full });
    }
    return urls;
}
