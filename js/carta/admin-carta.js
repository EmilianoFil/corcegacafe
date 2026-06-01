import { db, storage, auth } from '../firebase-config.js';
import {
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
    query, orderBy, serverTimestamp, writeBatch, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ─── Estado ─────────────────────────────────────────────────────────────────
let secciones          = [];
let platoEditando      = null;
let _snapshotAnterior  = null; // { precio, precioPY, nombre } antes de editar
let _platosListaCache  = [];   // cache para form manual de historial
// cada entrada: { url: string (preview), blob?: Blob (si es nueva), isNew: bool }
let fotosPlato         = [];
let stockosRecipeId    = null; // ID de la receta vinculada en StockOS

// ─── StockOS fetch helper ─────────────────────────────────────────────────────
const STOCKOS_URL = 'https://us-central1-corcega-loyalty-club.cloudfunctions.net/getStockosPrice';

async function _fetchStockos(recipeId = null) {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('No autenticado');
    const url = new URL(STOCKOS_URL);
    if (recipeId) url.searchParams.set('recipeId', recipeId);
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Error ${resp.status} al consultar StockOS`);
    return resp.json();
}

// Cache de recetas StockOS { recipeId: recipe } — compartido entre lista y modal de precios
let _stockosPriceCache = {};

async function _cargarPreciosStockos(platos) {
    const ids = platos.map(p => p.stockosRecipeId).filter(Boolean);
    if (!ids.length) return;
    if (ids.every(id => id in _stockosPriceCache)) return; // ya cargado
    try {
        const data = await _fetchStockos();
        (data.recipes ?? []).forEach(r => { _stockosPriceCache[r.id] = r; });
    } catch (_) { /* StockOS no disponible, continúa sin precios */ }
}

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

// ─── STOCKOS ─────────────────────────────────────────────────────────────────

function _renderStockosSection(recipe = null, loading = false) {
    const el = document.getElementById('stockos-section-content');
    if (!el) return;

    if (loading) {
        el.innerHTML = `<p style="font-size:0.82rem; color:#888; margin:0;">Consultando StockOS...</p>`;
        return;
    }

    if (!stockosRecipeId) {
        el.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:0.82rem; color:#aaa; flex:1;">Sin vincular</span>
                <button type="button" onclick="window.cartaAdmin.vincularStockos()"
                    style="padding:7px 14px; border-radius:8px; border:1px solid #c9dff7; background:white; color:#1a6bc4; font-size:0.8rem; font-weight:700; cursor:pointer; font-family:inherit;">
                    + Vincular con StockOS
                </button>
            </div>`;
        return;
    }

    const precioStockos  = recipe?.salePrice    ?? null;
    const costoActual    = recipe?.currentCost  ?? null;
    const rentabilidad   = recipe?.profitability ?? null;
    const nombre         = recipe?.name         ?? stockosRecipeId;
    const porciones      = recipe?.portions      ?? null;
    const costoPorcion   = recipe?.costPerPortion ?? null;
    const precioLocal    = parseFloat(document.getElementById('plato-precio')?.value);
    const diferencia     = precioStockos != null && !isNaN(precioLocal) ? precioStockos - precioLocal : null;

    const fmtARS = v => v != null ? `$${Number(v).toLocaleString('es-AR')}` : '—';
    const fmtPct = v => v != null ? `${Number(v).toFixed(1)}%` : '—';

    let diferenciaBadge = '';
    if (diferencia !== null) {
        if (diferencia === 0) {
            diferenciaBadge = `<span style="font-size:0.72rem; background:#e8f5e9; color:#2d7a4f; padding:2px 7px; border-radius:20px; font-weight:700;">= Sin diferencia</span>`;
        } else if (diferencia > 0) {
            diferenciaBadge = `<span style="font-size:0.72rem; background:#fff3e0; color:#e65100; padding:2px 7px; border-radius:20px; font-weight:700;">StockOS +${fmtARS(diferencia)} más caro</span>`;
        } else {
            diferenciaBadge = `<span style="font-size:0.72rem; background:#fff3e0; color:#e65100; padding:2px 7px; border-radius:20px; font-weight:700;">StockOS ${fmtARS(diferencia)} más barato</span>`;
        }
    }

    el.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="font-size:0.85rem; font-weight:700; color:#0d2b37; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${nombre}">${nombre}</span>
                <button type="button" onclick="window.cartaAdmin.desvincularStockos()"
                    style="padding:4px 10px; border-radius:6px; border:1px solid #f0c4c4; background:white; color:#ae2012; font-size:0.75rem; font-weight:700; cursor:pointer; font-family:inherit; white-space:nowrap;">
                    Desvincular
                </button>
            </div>
            ${recipe ? `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:8px;">
                <div style="background:white; border-radius:8px; padding:8px 10px; border:1px solid #d0e4f8;">
                    <p style="margin:0 0 2px; font-size:0.68rem; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.4px;">Precio StockOS</p>
                    <p style="margin:0; font-size:0.95rem; font-weight:800; color:#1a6bc4;">${fmtARS(precioStockos)}</p>
                </div>
                <div style="background:white; border-radius:8px; padding:8px 10px; border:1px solid #d0e4f8;">
                    <p style="margin:0 0 2px; font-size:0.68rem; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.4px;">Costo actual</p>
                    <p style="margin:0; font-size:0.95rem; font-weight:800; color:#555;">${fmtARS(costoActual)}</p>
                </div>
                <div style="background:white; border-radius:8px; padding:8px 10px; border:1px solid #d0e4f8;">
                    <p style="margin:0 0 2px; font-size:0.68rem; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.4px;">Rentabilidad</p>
                    <p style="margin:0; font-size:0.95rem; font-weight:800; color:#2d7a4f;">${fmtPct(rentabilidad)}</p>
                </div>
                ${porciones > 1 ? `
                <div style="background:white; border-radius:8px; padding:8px 10px; border:1px solid #d0e4f8;">
                    <p style="margin:0 0 2px; font-size:0.68rem; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.4px;">Porciones</p>
                    <p style="margin:0; font-size:0.95rem; font-weight:800; color:#555;">${porciones}${costoPorcion != null ? ` · ${fmtARS(costoPorcion)}/u` : ''}</p>
                </div>` : ''}
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                ${diferenciaBadge}
                <button type="button" onclick="window.cartaAdmin.sincronizarPrecioStockos(${precioStockos})"
                    style="padding:7px 14px; border-radius:8px; border:none; background:#1a6bc4; color:white; font-size:0.8rem; font-weight:700; cursor:pointer; font-family:inherit; white-space:nowrap;">
                    Actualizar precio a ${fmtARS(precioStockos)}
                </button>
            </div>` : `<p style="margin:0; font-size:0.8rem; color:#aaa;">No se pudo obtener el precio de StockOS.</p>`}
        </div>`;
}

export async function vincularStockos() {
    const btn = document.querySelector('[onclick="window.cartaAdmin.vincularStockos()"]');
    if (btn) { btn.textContent = 'Cargando...'; btn.disabled = true; }

    let recipes = [];
    try {
        const result = await _fetchStockos();
        recipes = result.recipes ?? [];
    } catch (e) {
        alert('No se pudo conectar con StockOS: ' + e.message);
        if (btn) { btn.textContent = '+ Vincular con StockOS'; btn.disabled = false; }
        return;
    }

    // Modal de búsqueda
    let modal = document.getElementById('modal-stockos-vincular');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'modal-stockos-vincular';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';

    const filas = recipes.map(r => `
        <tr style="border-bottom:1px solid #f0f0f0; cursor:pointer;" onclick="window.cartaAdmin._elegirRecetaStockos('${r.id}')"
            onmouseover="this.style.background='#f0f7ff'" onmouseout="this.style.background='white'">
            <td style="padding:10px 12px; font-weight:600; font-size:0.88rem;">${r.name}</td>
            <td style="padding:10px 12px; text-align:right; font-weight:700; color:#1a6bc4; font-size:0.88rem;">$${Number(r.salePrice).toLocaleString('es-AR')}</td>
            <td style="padding:10px 12px; text-align:right; color:#2d7a4f; font-size:0.82rem;">${r.profitability != null ? r.profitability.toFixed(1) + '%' : '—'}</td>
            <td style="padding:10px 12px; font-size:0.75rem; color:#aaa;">${r.code ?? ''}</td>
        </tr>`).join('');

    modal.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:640px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="background:#0d2b37;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <div>
                <p style="margin:0;font-weight:800;font-size:1rem;color:white;">Vincular con receta de StockOS</p>
                <p style="margin:4px 0 0;font-size:0.75rem;color:rgba(255,255,255,0.55);">${recipes.length} recetas disponibles</p>
            </div>
            <button onclick="document.getElementById('modal-stockos-vincular').remove()"
                style="background:rgba(255,255,255,0.12);border:none;border-radius:8px;color:white;font-size:1.2rem;width:34px;height:34px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:14px 18px;border-bottom:1px solid #f0f0f0;flex-shrink:0;">
            <input type="text" id="stockos-buscar" placeholder="Buscar receta..." oninput="window.cartaAdmin._filtrarRecetasStockos(this.value)"
                style="width:100%;padding:9px 14px;border-radius:9px;border:1px solid #ddd;font-size:0.9rem;font-family:inherit;box-sizing:border-box;outline:none;">
        </div>
        <div style="overflow-y:auto;flex:1;">
            <table style="width:100%;border-collapse:collapse;" id="tabla-stockos-recetas">
                <thead style="position:sticky;top:0;background:#f7f7f7;z-index:1;">
                    <tr style="font-size:0.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;">
                        <th style="padding:9px 12px;text-align:left;">Nombre</th>
                        <th style="padding:9px 12px;text-align:right;">Precio venta</th>
                        <th style="padding:9px 12px;text-align:right;">Rentab.</th>
                        <th style="padding:9px 12px;text-align:left;">Código</th>
                    </tr>
                </thead>
                <tbody id="tbody-stockos-recetas">${filas}</tbody>
            </table>
        </div>
    </div>`;

    document.body.appendChild(modal);
    document.getElementById('stockos-buscar').focus();

    // Guardar recetas para el filtro
    window._stockosRecetasCache = recipes;
}

export function _filtrarRecetasStockos(q) {
    const filas = document.querySelectorAll('#tbody-stockos-recetas tr');
    const texto = q.toLowerCase();
    filas.forEach(tr => {
        const nombre = tr.querySelector('td')?.textContent?.toLowerCase() ?? '';
        tr.style.display = nombre.includes(texto) ? '' : 'none';
    });
}

export function _elegirRecetaStockos(id) {
    stockosRecipeId = id;
    document.getElementById('modal-stockos-vincular')?.remove();
    _renderStockosSection(null, true);
    // Buscar la receta del cache para mostrar datos sin otro round-trip
    const cached = (window._stockosRecetasCache ?? []).find(r => r.id === id);
    if (cached) {
        _renderStockosSection(cached);
    } else {
        _fetchStockos(id)
            .then(r => _renderStockosSection(r.recipe ?? null))
            .catch(() => _renderStockosSection(null));
    }
}

export function desvincularStockos() {
    if (!confirm('¿Desvincular este plato de StockOS?')) return;
    stockosRecipeId = null;
    _renderStockosSection();
}

export function sincronizarPrecioStockos(precioStockos) {
    if (precioStockos == null) return;
    const fmtARS = v => `$${Number(v).toLocaleString('es-AR')}`;
    if (!confirm(`¿Actualizar el precio a ${fmtARS(precioStockos)}? Esto reemplaza el precio actual del plato.`)) return;
    const inp = document.getElementById('plato-precio');
    if (inp) {
        inp.value = precioStockos;
        window.cartaAdmin._calcPrecioPY();
        _renderStockosSection(
            (window._stockosRecetasCache ?? []).find(r => r.id === stockosRecipeId) ?? { salePrice: precioStockos }
        );
    }
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

    await _cargarPreciosStockos(platos);

    const secMap = Object.fromEntries(secciones.map(s => [s.id, s.nombre]));

    // Banner de alerta de precios desactualizados respecto a StockOS
    const platosConDiferencia = platos.filter(p => {
        const sInfo = p.stockosRecipeId ? _stockosPriceCache[p.stockosRecipeId] : null;
        return sInfo != null && p.precio != null && sInfo.salePrice !== p.precio;
    });
    const bannerExistente = document.getElementById('stockos-diff-banner');
    if (bannerExistente) bannerExistente.remove();
    if (platosConDiferencia.length) {
        const banner = document.createElement('div');
        banner.id = 'stockos-diff-banner';
        const nombres = platosConDiferencia.map(p => {
            const sInfo = _stockosPriceCache[p.stockosRecipeId];
            const diff = sInfo.salePrice - p.precio;
            const signo = diff > 0 ? '+' : '';
            return `<strong>${p.nombre}</strong> (StockOS ${signo}$${Math.abs(diff).toLocaleString('es-AR')})`;
        }).join(', ');
        banner.innerHTML = `
            <div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:10px;">
                <span style="font-size:1.1rem;flex-shrink:0;">⚠️</span>
                <div style="flex:1;min-width:0;">
                    <p style="margin:0 0 3px;font-size:0.85rem;font-weight:800;color:#e65100;">
                        ${platosConDiferencia.length} plato${platosConDiferencia.length > 1 ? 's' : ''} con precio distinto en StockOS
                    </p>
                    <p style="margin:0;font-size:0.78rem;color:#bf360c;line-height:1.4;">${nombres}</p>
                </div>
                <button onclick="window.cartaAdmin.abrirEditorPrecios()"
                    style="padding:6px 14px;border-radius:8px;border:none;background:#e65100;color:white;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0;">
                    Actualizar precios
                </button>
            </div>`;
        tbody.closest('table')?.parentElement?.insertBefore(banner, tbody.closest('table'));
    }

    tbody.innerHTML = platos.map(p => {
        const fotoRaw    = p.fotos?.[0] ?? '';
        const foto       = typeof fotoRaw === 'string' ? fotoRaw : (fotoRaw.thumb ?? '');
        const precio     = p.precio   != null ? `$${Number(p.precio).toLocaleString('es-AR')}` : '—';
        const precioPY   = p.precioPY != null ? `$${Number(p.precioPY).toLocaleString('es-AR')}` : '—';
        const sInfo      = p.stockosRecipeId ? _stockosPriceCache[p.stockosRecipeId] : null;
        const preciosDifieren = sInfo != null && p.precio != null && sInfo.salePrice !== p.precio;
        const dotTitle   = sInfo
            ? `StockOS: $${Number(sInfo.salePrice).toLocaleString('es-AR')} · Costo: $${Number(sInfo.currentCost ?? 0).toLocaleString('es-AR')} · Rentab: ${Number(sInfo.profitability ?? 0).toFixed(1)}%`
            : 'Vinculado a StockOS';
        const dot        = p.stockosRecipeId
            ? `<span title="${dotTitle}" style="display:inline-flex;align-items:center;gap:3px;background:${preciosDifieren ? '#fff3e0' : '#e8f0fd'};color:${preciosDifieren ? '#e65100' : '#1a6bc4'};font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:20px;margin-left:8px;vertical-align:middle;white-space:nowrap;cursor:help;letter-spacing:0.2px;">${sInfo ? `${preciosDifieren ? '⚠ ' : ''}$${Number(sInfo.salePrice).toLocaleString('es-AR')}` : 'S'}</span>`
            : '';
        return `
        <tr style="border-bottom:1px solid #f5f5f5;">
            <td style="padding:10px 15px;">
                ${foto
                    ? `<img src="${foto}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`
                    : `<div style="width:48px;height:48px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍽️</div>`}
            </td>
            <td style="padding:10px 15px; font-weight:600;">${p.nombre}${dot}</td>
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
    platoEditando   = null;
    fotosPlato      = [];
    stockosRecipeId = null;
    _snapshotAnterior = null;
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
    _renderStockosSection();
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

    platoEditando   = id;
    stockosRecipeId = p.stockosRecipeId ?? null;
    // Compatibilidad: fotos puede ser string[] (viejo) u objeto[] {thumb,medium,full} (nuevo)
    fotosPlato = (p.fotos ?? []).map(f => ({
        url:    typeof f === 'string' ? f : f.thumb,
        stored: f,   // guardar el valor original para re-persistir sin resubir
        isNew:  false
    }));

    _snapshotAnterior = { precio: p.precio ?? null, precioPY: p.precioPY ?? null, nombre: p.nombre ?? '' };
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
    // Mostrar sección StockOS y cargar datos si hay vínculo
    if (stockosRecipeId) {
        _renderStockosSection(null, true);
        _fetchStockos(stockosRecipeId)
            .then(r => _renderStockosSection(r.recipe ?? null))
            .catch(() => _renderStockosSection(null));
    } else {
        _renderStockosSection();
    }
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
            stockosRecipeId: stockosRecipeId ?? null,
            activo: true,
            orden: 0,
            actualizadoEn: serverTimestamp()
        };

        if (platoEditando) {
            await updateDoc(doc(db, 'carta_platos', platoEditando), data);
            if (_snapshotAnterior) {
                const nuevoPrecio = isNaN(precio) ? null : precio;
                const nuevoPY     = isNaN(precioPY) ? null : precioPY;
                const cambioBase  = _snapshotAnterior.precio   !== nuevoPrecio;
                const cambioPY    = _snapshotAnterior.precioPY !== nuevoPY;
                if (cambioBase || cambioPY) {
                    await _registrarHistorial([{
                        platoId: platoEditando,
                        platoNombre: nombre,
                        tipo: 'cambio',
                        precioAnterior:   cambioBase ? _snapshotAnterior.precio   : null,
                        precioNuevo:      cambioBase ? nuevoPrecio                : null,
                        precioPYAnterior: cambioPY   ? _snapshotAnterior.precioPY : null,
                        precioPYNuevo:    cambioPY   ? nuevoPY                   : null,
                        nota: '',
                    }]);
                }
            }
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

    await _cargarPreciosStockos(platos);

    const secMap      = Object.fromEntries(secciones.map(s => [s.id, s.nombre]));
    const hayStockos  = platos.some(p => p.stockosRecipeId);

    let modal = document.getElementById('modal-precios');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-precios';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';

    const filas = platos.map(p => {
        const precioActual   = p.precio   != null ? p.precio   : '';
        const precioPYActual = p.precioPY != null ? p.precioPY : '';
        const pctPY          = p.pctPY    != null ? p.pctPY    : '';
        const sInfo          = p.stockosRecipeId ? _stockosPriceCache[p.stockosRecipeId] : null;
        const precioStockos  = sInfo?.salePrice ?? null;

        const celdaStockos = hayStockos ? `
            <td style="padding:8px 12px;">
                ${precioStockos != null ? `
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:0.88rem;font-weight:700;color:#1a6bc4;white-space:nowrap;">$${Number(precioStockos).toLocaleString('es-AR')}</span>
                    <button type="button" onclick="window.cartaAdmin._copiarPrecioStockos(this.closest('tr'), ${precioStockos})"
                        title="Usar precio de StockOS"
                        style="padding:3px 8px;border-radius:6px;border:none;background:#e8f0fd;color:#1a6bc4;font-size:0.75rem;font-weight:800;cursor:pointer;font-family:inherit;">↓</button>
                </div>` : `<span style="color:#ccc;font-size:0.82rem;">—</span>`}
            </td>` : '';

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
            ${celdaStockos}
            <td style="padding:8px 12px;">
                <input type="number" class="inp-precio-nuevo" value="${precioActual}"
                    min="0" step="50"
                    style="width:110px;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;font-family:inherit;text-align:right;"
                    oninput="_marcarCambio(this)">
            </td>
            <td style="padding:8px 12px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    ${pctPY !== '' ? `<span style="font-size:0.72rem;color:#bbb;font-weight:600;white-space:nowrap;min-width:30px;">${pctPY}%</span>` : `<span style="min-width:30px;"></span>`}
                    <input type="number" class="inp-precio-py-nuevo" value="${precioPYActual}"
                        min="0" step="50"
                        style="width:110px;padding:7px 10px;border:1px solid #f0ddd0;border-radius:8px;font-size:0.9rem;font-family:inherit;text-align:right;background:#fff8f0;"
                        oninput="_marcarCambioPY(this)">
                </div>
            </td>
        </tr>`;
    }).join('');

    modal.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:${hayStockos ? 920 : 780}px;box-shadow:0 30px 80px rgba(0,0,0,0.35);overflow:hidden;margin:auto;">
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
                        ${hayStockos ? `<th style="padding:10px 12px;text-align:left;color:#1a6bc4;">💰 StockOS</th>` : ''}
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

export function _copiarPrecioStockos(tr, precio) {
    const inp = tr.querySelector('.inp-precio-nuevo');
    if (!inp) return;
    inp.value = precio;
    _marcarCambio(inp);
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

    const histEntries = cambios.map(tr => {
        const original   = parseFloat(tr.dataset.precioOriginal);
        const nuevo      = parseFloat(tr.querySelector('.inp-precio-nuevo').value);
        const originalPY = parseFloat(tr.dataset.precioPyOriginal);
        const nuevoPY    = parseFloat(tr.querySelector('.inp-precio-py-nuevo')?.value);
        const nombre     = tr.querySelector('td:nth-child(2)')?.textContent?.trim() ?? '';
        const cambioBase = !isNaN(nuevo) && nuevo !== original;
        const cambioPY   = !isNaN(nuevoPY) && nuevoPY !== originalPY;
        return {
            platoId: tr.dataset.id, platoNombre: nombre, tipo: 'cambio',
            precioAnterior:   cambioBase ? (isNaN(original)   ? null : original)   : null,
            precioNuevo:      cambioBase ? nuevo   : null,
            precioPYAnterior: cambioPY   ? (isNaN(originalPY) ? null : originalPY) : null,
            precioPYNuevo:    cambioPY   ? nuevoPY : null,
            nota: '',
        };
    });
    await _registrarHistorial(histEntries);

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

// ─── HISTORIAL DE PRECIOS ────────────────────────────────────────────────────

async function _registrarHistorial(entries) {
    if (!entries.length) return;
    const batch = writeBatch(db);
    entries.forEach(e => {
        batch.set(doc(collection(db, 'carta_precios_historial')), { ...e, fecha: serverTimestamp() });
    });
    await batch.commit();
}

function _formatFecha(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _precioChange(ant, nuevo) {
    if (ant == null && nuevo == null) return '<span style="color:#ddd;">—</span>';
    const fmt = v => v != null ? `$${Number(v).toLocaleString('es-AR')}` : '—';
    if (ant == null) return `<span style="color:#555;">${fmt(nuevo)}</span>`;
    if (nuevo == null) return fmt(ant);
    const diff  = nuevo - ant;
    const color = diff > 0 ? '#ae2012' : '#2d7a4f';
    const sign  = diff > 0 ? '+' : '';
    return `${fmt(ant)} → <strong style="color:${color};">${fmt(nuevo)}</strong>&nbsp;<small style="color:${color};">(${sign}$${Math.abs(diff).toLocaleString('es-AR')})</small>`;
}

export async function abrirHistorialPrecios() {
    const [histSnap, platosSnap] = await Promise.all([
        getDocs(query(collection(db, 'carta_precios_historial'), orderBy('fecha', 'desc'))),
        getDocs(query(collection(db, 'carta_platos'), orderBy('nombre')))
    ]);
    const historial = histSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _platosListaCache = platosSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombre }));

    let modal = document.getElementById('modal-historial');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'modal-historial';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';

    const filas = historial.length
        ? historial.map(h => `
            <tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:10px 12px;font-size:0.8rem;color:#888;white-space:nowrap;">${_formatFecha(h.fecha)}</td>
                <td style="padding:10px 12px;font-weight:600;font-size:0.88rem;">${h.platoNombre ?? '—'}</td>
                <td style="padding:10px 12px;font-size:0.85rem;">${_precioChange(h.precioAnterior, h.precioNuevo)}</td>
                <td style="padding:10px 12px;font-size:0.85rem;">${_precioChange(h.precioPYAnterior, h.precioPYNuevo)}</td>
                <td style="padding:10px 12px;font-size:0.78rem;color:#aaa;font-style:italic;">${h.nota ?? ''}</td>
                <td style="padding:10px 12px;text-align:center;">
                    <span style="font-size:0.68rem;padding:2px 8px;border-radius:20px;background:${h.tipo === 'inicial' ? '#e8f5e9' : '#f0f4ff'};color:${h.tipo === 'inicial' ? '#2d7a4f' : '#555'};">
                        ${h.tipo === 'inicial' ? 'inicial' : 'cambio'}
                    </span>
                </td>
            </tr>`).join('')
        : `<tr><td colspan="6" style="text-align:center;padding:40px;color:#aaa;">Sin historial todavía.</td></tr>`;

    const optsPlatos = _platosListaCache.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

    modal.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:920px;box-shadow:0 30px 80px rgba(0,0,0,0.35);overflow:hidden;margin:auto;">
        <div style="background:#0d2b37;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <p style="margin:0;font-weight:800;font-size:1.05rem;color:white;">Historial de precios</p>
                <p style="margin:4px 0 0;font-size:0.75rem;color:rgba(255,255,255,0.55);">${historial.length} registro${historial.length !== 1 ? 's' : ''}</p>
            </div>
            <button onclick="document.getElementById('modal-historial').remove()"
                style="background:rgba(255,255,255,0.12);border:none;border-radius:8px;color:white;font-size:1.2rem;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <div style="padding:16px 24px;border-bottom:1px solid #f0f0f0;background:#fafafa;">
            <details id="det-entrada-manual">
                <summary style="cursor:pointer;font-size:0.85rem;font-weight:700;color:#0d2b37;user-select:none;list-style:none;display:flex;align-items:center;gap:6px;">
                    <span>+</span> Agregar precio histórico <span style="font-weight:400;color:#aaa;font-size:0.78rem;">(para registrar precios anteriores al historial automático)</span>
                </summary>
                <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 2fr auto;gap:10px;align-items:end;margin-top:14px;">
                    <div>
                        <label style="font-size:0.72rem;font-weight:700;color:#888;display:block;margin-bottom:4px;">PLATO</label>
                        <select id="hist-plato-id" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;font-family:inherit;background:white;">
                            <option value="">— Elegir —</option>${optsPlatos}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:700;color:#888;display:block;margin-bottom:4px;">FECHA</label>
                        <input type="date" id="hist-fecha" value="${new Date().toISOString().slice(0,10)}"
                            style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;font-family:inherit;">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:700;color:#888;display:block;margin-bottom:4px;">PRECIO BASE ($)</label>
                        <input type="number" id="hist-precio" placeholder="0" min="0" step="50"
                            style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;font-family:inherit;">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:700;color:#d86634;display:block;margin-bottom:4px;">PRECIO PY ($)</label>
                        <input type="number" id="hist-precio-py" placeholder="0" min="0" step="50"
                            style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #f0ddd0;font-size:0.85rem;font-family:inherit;background:#fff8f0;">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:700;color:#888;display:block;margin-bottom:4px;">NOTA</label>
                        <input type="text" id="hist-nota" placeholder="ej: Precio de enero 2025"
                            style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;font-family:inherit;">
                    </div>
                    <div>
                        <button onclick="window.cartaAdmin._guardarEntradaManual()"
                            style="padding:9px 18px;border-radius:8px;border:none;background:#0d2b37;color:white;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;white-space:nowrap;">
                            Guardar
                        </button>
                    </div>
                </div>
                <div id="hist-manual-error" style="display:none;color:#ae2012;font-size:0.8rem;margin-top:8px;"></div>
            </details>
        </div>

        <div style="max-height:60vh;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;">
                <thead style="position:sticky;top:0;background:#f7f7f7;z-index:1;">
                    <tr style="font-size:0.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;">
                        <th style="padding:10px 12px;text-align:left;">Fecha</th>
                        <th style="padding:10px 12px;text-align:left;">Plato</th>
                        <th style="padding:10px 12px;text-align:left;">Precio base</th>
                        <th style="padding:10px 12px;text-align:left;color:#d86634;">🛵 Precio PY</th>
                        <th style="padding:10px 12px;text-align:left;">Nota</th>
                        <th style="padding:10px 12px;text-align:center;">Tipo</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>
    </div>`;

    document.body.appendChild(modal);
}

export async function _guardarEntradaManual() {
    const errDiv   = document.getElementById('hist-manual-error');
    errDiv.style.display = 'none';
    const platoId  = document.getElementById('hist-plato-id').value;
    const fechaStr = document.getElementById('hist-fecha').value;
    const precio   = parseFloat(document.getElementById('hist-precio').value);
    const precioPY = parseFloat(document.getElementById('hist-precio-py').value);
    const nota     = document.getElementById('hist-nota').value.trim();

    if (!platoId)  { errDiv.textContent = 'Elegí un plato.';  errDiv.style.display = 'block'; return; }
    if (!fechaStr) { errDiv.textContent = 'Elegí una fecha.'; errDiv.style.display = 'block'; return; }
    if (isNaN(precio) && isNaN(precioPY)) {
        errDiv.textContent = 'Ingresá al menos un precio.'; errDiv.style.display = 'block'; return;
    }

    const plato   = _platosListaCache.find(p => p.id === platoId);
    const fechaTs = Timestamp.fromDate(new Date(fechaStr + 'T12:00:00'));

    await setDoc(doc(collection(db, 'carta_precios_historial')), {
        platoId, platoNombre: plato?.nombre ?? '', tipo: 'inicial',
        precioAnterior: null, precioNuevo: isNaN(precio) ? null : precio,
        precioPYAnterior: null, precioPYNuevo: isNaN(precioPY) ? null : precioPY,
        nota, fecha: fechaTs,
    });

    await abrirHistorialPrecios();
}
