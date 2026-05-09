import { db, storage } from '../firebase-config.js';
import {
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
    query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ─── Estado local ───────────────────────────────────────────────────────────
let secciones = [];       // cache de secciones
let platoEditando = null; // id del plato en edición (null = nuevo)
let fotosPlato = [];      // array de { url, file?, isNew } en orden; fotos[0] = principal

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
        </tr>
    `).join('');
}

function _poblarSelectSecciones() {
    const opts = secciones.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    const basePlato = `<option value="">— Elegir sección —</option>${opts}`;
    const baseFiltro = `<option value="">— Todas las secciones —</option>${opts}`;
    const sel = document.getElementById('plato-seccion');
    const filtro = document.getElementById('carta-filtro-seccion');
    if (sel) sel.innerHTML = basePlato;
    if (filtro) filtro.innerHTML = baseFiltro;
}

export async function guardarSeccion() {
    const input = document.getElementById('carta-sec-nombre');
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
    if (!confirm(`¿Eliminar la sección "${sec?.nombre}"? Los platos de esa sección quedarán sin sección asignada.`)) return;
    await deleteDoc(doc(db, 'carta_secciones', id));
    await loadSecciones();
}

// ─── PLATOS ─────────────────────────────────────────────────────────────────

export async function loadPlatos(seccionId = '') {
    // Aseguramos que las secciones estén cargadas para el select y el filtro
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
        const fotoPrincipal = p.fotos?.[0] ?? '';
        const precio = p.precio != null ? `$${Number(p.precio).toLocaleString('es-AR')}` : '—';
        const secNombre = secMap[p.seccionId] ?? '—';
        return `
        <tr style="border-bottom:1px solid #f5f5f5;">
            <td style="padding:10px 15px;">
                ${fotoPrincipal
                    ? `<img src="${fotoPrincipal}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`
                    : `<div style="width:48px;height:48px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍽️</div>`
                }
            </td>
            <td style="padding:10px 15px; font-weight:600;">${p.nombre}</td>
            <td style="padding:10px 15px; color:#888; font-size:0.85rem;">${secNombre}</td>
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

export function filtrarPlatosPorSeccion(seccionId) {
    loadPlatos(seccionId);
}

export function mostrarFormPlato() {
    platoEditando = null;
    fotosPlato = [];
    document.getElementById('plato-id').value = '';
    document.getElementById('plato-nombre').value = '';
    document.getElementById('plato-descripcion').value = '';
    document.getElementById('plato-precio').value = '';
    document.getElementById('plato-seccion').value = '';
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
    fotosPlato = [];
}

export async function editarPlato(id) {
    if (!secciones.length) await loadSecciones();
    const snap = await getDocs(collection(db, 'carta_platos'));
    const platoDoc = snap.docs.find(d => d.id === id);
    if (!platoDoc) return;
    const p = { id: platoDoc.id, ...platoDoc.data() };

    platoEditando = id;
    fotosPlato = (p.fotos ?? []).map(url => ({ url, isNew: false }));

    document.getElementById('plato-id').value = id;
    document.getElementById('plato-nombre').value = p.nombre ?? '';
    document.getElementById('plato-descripcion').value = p.descripcion ?? '';
    document.getElementById('plato-precio').value = p.precio ?? '';
    document.getElementById('plato-seccion').value = p.seccionId ?? '';
    document.querySelectorAll('.plato-tag').forEach(cb => { cb.checked = (p.tags ?? []).includes(cb.value); });
    document.getElementById('form-plato-titulo').textContent = 'Editar Plato';
    document.getElementById('plato-form-error').style.display = 'none';
    _renderFotosPreview();
    document.getElementById('form-plato-wrapper').style.display = 'block';
    document.getElementById('form-plato-wrapper').scrollIntoView({ behavior: 'smooth' });
}

export async function guardarPlato() {
    const errDiv = document.getElementById('plato-form-error');
    errDiv.style.display = 'none';

    const nombre = document.getElementById('plato-nombre').value.trim();
    const descripcion = document.getElementById('plato-descripcion').value.trim();
    const precio = parseFloat(document.getElementById('plato-precio').value);
    const seccionId = document.getElementById('plato-seccion').value;
    const tags = [...document.querySelectorAll('.plato-tag:checked')].map(cb => cb.value);

    if (!nombre) { errDiv.textContent = 'El nombre es obligatorio.'; errDiv.style.display = 'block'; return; }
    if (!seccionId) { errDiv.textContent = 'Elegí una sección.'; errDiv.style.display = 'block'; return; }
    if (isNaN(precio) || precio < 0) { errDiv.textContent = 'El precio debe ser un número válido.'; errDiv.style.display = 'block'; return; }

    // Subir fotos nuevas a Storage
    const fotosUrls = await _subirFotosNuevas(platoEditando ?? 'tmp_' + Date.now());

    const data = {
        nombre, descripcion, precio, seccionId, tags,
        fotos: fotosUrls,
        activo: true,
        orden: 0,
        actualizadoEn: serverTimestamp()
    };

    if (platoEditando) {
        await updateDoc(doc(db, 'carta_platos', platoEditando), data);
    } else {
        const snap = await getDocs(collection(db, 'carta_platos'));
        data.orden = snap.size;
        data.creadoEn = serverTimestamp();
        await addDoc(collection(db, 'carta_platos'), data);
    }

    ocultarFormPlato();
    await loadPlatos();
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
    files.forEach(file => {
        const url = URL.createObjectURL(file);
        fotosPlato.push({ url, file, isNew: true });
    });
    input.value = '';
    _renderFotosPreview();
}

function _renderFotosPreview() {
    const container = document.getElementById('plato-fotos-preview');
    const empty = document.getElementById('plato-fotos-empty');
    if (!fotosPlato.length) {
        container.innerHTML = '';
        container.appendChild(empty ?? _makeEmptyMsg());
        return;
    }
    container.innerHTML = fotosPlato.map((f, i) => `
        <div style="position:relative; cursor:pointer;" onclick="window.cartaAdmin.marcarPrincipal(${i})" title="Marcar como principal">
            <img src="${f.url}" style="width:72px; height:72px; border-radius:10px; object-fit:cover; border: ${i === 0 ? '3px solid var(--primary)' : '2px solid #eee'};">
            ${i === 0 ? `<span style="position:absolute;top:3px;left:3px;background:var(--primary);color:white;font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;">★</span>` : ''}
            <button onclick="event.stopPropagation(); window.cartaAdmin.quitarFoto(${i})"
                style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.55);border:none;border-radius:50%;width:18px;height:18px;color:white;font-size:10px;cursor:pointer;line-height:1;padding:0;">✕</button>
        </div>
    `).join('');
}

function _makeEmptyMsg() {
    const span = document.createElement('span');
    span.id = 'plato-fotos-empty';
    span.style.cssText = 'color:#ccc; font-size:0.85rem;';
    span.textContent = 'Sin fotos todavía';
    return span;
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

async function _subirFotasNuevas(platoId) {
    return _subirFotosNuevas(platoId);
}

async function _subirFotosNuevas(platoId) {
    const resultado = [];
    for (const foto of fotosPlato) {
        if (!foto.isNew) {
            resultado.push(foto.url);
            continue;
        }
        const ext = foto.file.name.split('.').pop();
        const storageRef = ref(storage, `carta/${platoId}/${Date.now()}.${ext}`);
        await uploadBytes(storageRef, foto.file);
        const url = await getDownloadURL(storageRef);
        resultado.push(url);
    }
    return resultado;
}
