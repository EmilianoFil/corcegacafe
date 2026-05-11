import { auth, db } from '../firebase-config.js';
import {
    onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword,
    createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
    sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    doc, getDoc, setDoc, updateDoc, collection, getDocs,
    query, where, increment, serverTimestamp, addDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Estado ──────────────────────────────────────────────────────────────────
let _user         = null;
let _enabled      = false;
let _likes        = new Set();   // platoIds con ❤️ Me gusta
let _quieroProbar = new Set();   // platoIds con 🔖 Quiero probarlo
let _probados     = new Set();   // platoIds con ✓ Ya lo probé (exclusivo con quieroProbar)
let _favCounts    = {};          // { platoId: N } — conteo global de likes
let _pendingAction = null;       // acción a ejecutar tras login
let _platosMap    = {};          // { platoId: { nombre, ... } } — poblado desde carta.html
let _modalAbiertoPlatoId = null; // platoId del modal de detalle abierto

const googleProvider = new GoogleAuthProvider();

// ─── Inicialización ──────────────────────────────────────────────────────────
export async function init() {
    const cfgSnap = await getDoc(doc(db, 'config', 'carta'));
    _enabled = cfgSnap.exists() ? (cfgSnap.data().loginHabilitado ?? false) : false;

    if (!_enabled) return;

    document.body.classList.add('social-activo');
    _inyectarLoginModal();

    onAuthStateChanged(auth, async user => {
        _user = user;
        if (user) {
            await Promise.all([_cargarLikes(), _cargarQuieroProbar(), _cargarProbados()]);
            _actualizarHeaderUI(user);
            _actualizarTodosLosBotones();
            if (_modalAbiertoPlatoId) await _renderSocialEnModal(_modalAbiertoPlatoId);
            if (_pendingAction) { _pendingAction(); _pendingAction = null; }
        } else {
            _likes.clear();
            _quieroProbar.clear();
            _probados.clear();
            _actualizarHeaderUI(null);
            _actualizarTodosLosBotones();
        }
    });

    await _cargarFavCounts();
    _actualizarBadgesGlobales();
}

// ─── Recibe el mapa de platos desde carta.html ───────────────────────────────
export function setPlatos(map) {
    _platosMap = map ?? {};
}

// ─── Se llama desde carta.html tras renderizar las cards ─────────────────────
export function onCartaRendered() {
    if (!_enabled) return;
    _actualizarTodosLosBotones();
    _actualizarBadgesGlobales();
}

// ─── Se llama desde carta.html cuando se abre el modal ───────────────────────
export function onModalAbierto(platoId) {
    if (!_enabled) return;
    _modalAbiertoPlatoId = platoId;
    _renderSocialEnModal(platoId);
    setDoc(doc(db, 'carta_plato_stats', platoId), { clickCount: increment(1) }, { merge: true });
}

export function onModalCerrado() {
    _modalAbiertoPlatoId = null;
}

// ─── Carga datos del usuario ─────────────────────────────────────────────────
async function _cargarLikes() {
    if (!_user) return;
    const snap = await getDoc(doc(db, 'carta_favoritos', _user.uid));
    _likes = new Set(snap.exists() ? (snap.data().platoIds ?? []) : []);
}

async function _cargarQuieroProbar() {
    if (!_user) return;
    const snap = await getDoc(doc(db, 'carta_quiero_probar', _user.uid));
    _quieroProbar = new Set(snap.exists() ? (snap.data().platoIds ?? []) : []);
}

async function _cargarProbados() {
    if (!_user) return;
    const snap = await getDoc(doc(db, 'carta_probados', _user.uid));
    _probados = new Set(snap.exists() ? (snap.data().platoIds ?? []) : []);
}

async function _cargarFavCounts() {
    const snap = await getDocs(collection(db, 'carta_plato_stats'));
    _favCounts = {};
    snap.forEach(d => { _favCounts[d.id] = d.data().favCount ?? 0; });
}

// ─── Actualizar UI del header ─────────────────────────────────────────────────
function _actualizarHeaderUI(user) {
    const btn = document.getElementById('carta-user-btn');
    if (!btn) return;
    if (user) {
        const nombre = user.displayName?.split(' ')[0] ?? user.email?.split('@')[0] ?? 'Vos';
        btn.innerHTML = `<span style="font-size:1rem;">👤</span><span>${nombre}</span>`;
    } else {
        btn.innerHTML = `<span style="font-size:1rem;">👤</span><span>Entrar</span>`;
    }
}

// Llamada directa desde el HTML del botón (igual que el corazón)
export function accionBotonUsuario() {
    if (_user) mostrarMenuUsuario();
    else mostrarLogin();
}

// ─── Actualizar botones en cards y modal ─────────────────────────────────────
function _actualizarTodosLosBotones() {
    document.querySelectorAll('.btn-fav-carta').forEach(btn => _actualizarBtnLike(btn, btn.dataset.id));
    document.querySelectorAll('.btn-qp-carta').forEach(btn => _actualizarBtnQP(btn, btn.dataset.id));
    document.querySelectorAll('.btn-probado-carta').forEach(btn => _actualizarBtnProbado(btn, btn.dataset.id));
}

function _actualizarBtnLike(btn, id) {
    const activo = _likes.has(id);
    btn.classList.toggle('fav-activo', activo);
    btn.title = activo ? 'Quitar like' : 'Me gusta';
    const icon = btn.querySelector('img');
    if (icon) icon.src = activo ? 'css/img/heart-filled.svg' : 'css/img/heart-outline.svg';
    if (btn.id === 'modal-social-fav') {
        btn.style.background = activo ? '#eb6f53' : 'white';
        btn.style.color      = activo ? 'white' : '';
        if (icon) icon.style.filter = activo ? 'brightness(0) invert(1)' : '';
    }
}

function _actualizarBtnQP(btn, id) {
    const activo = _quieroProbar.has(id);
    btn.classList.toggle('qp-activo', activo);
    btn.style.background = activo ? '#eb6f53' : 'white';
    btn.style.color      = activo ? 'white' : '';
    const icon = btn.querySelector('img');
    if (icon) {
        icon.src = activo ? 'css/img/bookmark-filled.svg' : 'css/img/bookmark-outline.svg';
        icon.style.filter = activo ? 'brightness(0) invert(1)' : '';
    }
    const span = btn.querySelector('span');
    if (span) span.textContent = activo ? 'Quiero probarlo ✓' : 'Quiero probarlo';
}

function _actualizarBtnProbado(btn, id) {
    const activo = _probados.has(id);
    btn.classList.toggle('probado-activo', activo);
    btn.style.background = activo ? '#01323f' : 'white';
    btn.style.color      = activo ? 'white' : '';
    const span = btn.querySelector('span');
    if (span) span.textContent = activo ? 'Ya lo probé ✓' : 'Ya lo probé';
}

// ─── Badges "los más amados" ─────────────────────────────────────────────────
function _actualizarBadgesGlobales() {
    document.querySelectorAll('.plato-card[data-plato-id]').forEach(card => {
        const id = card.dataset.platoId;
        const count = _favCounts[id] ?? 0;
        let badge = card.querySelector('.badge-amado');
        if (count >= 3) {
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'badge-amado';
                card.appendChild(badge);
            }
            badge.textContent = `❤️ ${count}`;
        } else if (badge) {
            badge.remove();
        }
    });
}

// ─── Toggle ❤️ Me gusta ───────────────────────────────────────────────────────
export function toggleLike(platoId) {
    if (!_user) {
        _pendingAction = () => toggleLike(platoId);
        mostrarLogin();
        return;
    }
    const era = _likes.has(platoId);
    era ? _likes.delete(platoId) : _likes.add(platoId);

    document.querySelectorAll(`.btn-fav-carta[data-id="${platoId}"]`).forEach(btn => _actualizarBtnLike(btn, platoId));
    setDoc(doc(db, 'carta_favoritos', _user.uid), { platoIds: [..._likes] }, { merge: true });

    const delta = era ? -1 : 1;
    _favCounts[platoId] = Math.max(0, (_favCounts[platoId] ?? 0) + delta);
    setDoc(doc(db, 'carta_plato_stats', platoId), { favCount: increment(delta) }, { merge: true });
    _actualizarBadgesGlobales();
}

// Alias para compatibilidad con onclick existente en cards (carta.html)
export const toggleFavorito = toggleLike;

// ─── Toggle 🔖 Quiero probarlo ────────────────────────────────────────────────
export function toggleQuieroProbar(platoId) {
    if (!_user) {
        _pendingAction = () => toggleQuieroProbar(platoId);
        mostrarLogin();
        return;
    }
    const era = _quieroProbar.has(platoId);
    era ? _quieroProbar.delete(platoId) : _quieroProbar.add(platoId);

    // Exclusividad: si activamos, quitamos de "ya lo probé"
    if (!era && _probados.has(platoId)) {
        _probados.delete(platoId);
        setDoc(doc(db, 'carta_probados', _user.uid), { platoIds: [..._probados] }, { merge: true });
        const btnProb = document.getElementById('modal-social-probado');
        if (btnProb) _actualizarBtnProbado(btnProb, platoId);
    }

    setDoc(doc(db, 'carta_quiero_probar', _user.uid), { platoIds: [..._quieroProbar] }, { merge: true });
    document.querySelectorAll(`.btn-qp-carta[data-id="${platoId}"]`).forEach(btn => _actualizarBtnQP(btn, platoId));
}

// ─── Toggle ✓ Ya lo probé ─────────────────────────────────────────────────────
export function toggleProbado(platoId) {
    if (!_user) {
        _pendingAction = () => toggleProbado(platoId);
        mostrarLogin();
        return;
    }
    const era = _probados.has(platoId);
    era ? _probados.delete(platoId) : _probados.add(platoId);

    // Exclusividad: si activamos, quitamos de "quiero probarlo"
    if (!era && _quieroProbar.has(platoId)) {
        _quieroProbar.delete(platoId);
        setDoc(doc(db, 'carta_quiero_probar', _user.uid), { platoIds: [..._quieroProbar] }, { merge: true });
        const btnQP = document.getElementById('modal-social-qp');
        if (btnQP) _actualizarBtnQP(btnQP, platoId);
    }

    setDoc(doc(db, 'carta_probados', _user.uid), { platoIds: [..._probados] }, { merge: true });
    const btnProb = document.getElementById('modal-social-probado');
    if (btnProb) _actualizarBtnProbado(btnProb, platoId);
}

// ─── Sección social en el modal ───────────────────────────────────────────────
async function _renderSocialEnModal(platoId) {
    const container = document.getElementById('modal-social');
    if (!container) return;

    // Rating guardado
    let miRating = 0;
    let miComentario = '';
    if (_user) {
        const rSnap = await getDoc(doc(db, 'carta_valoraciones', `${platoId}_${_user.uid}`));
        if (rSnap.exists()) {
            miRating     = rSnap.data().rating ?? 0;
            miComentario = rSnap.data().comentario ?? '';
        }
    }

    // Reseñas de otros
    const resenasSnap = await getDocs(
        query(collection(db, 'carta_valoraciones'), where('platoId', '==', platoId))
    );
    const todasVal = resenasSnap.docs.map(d => d.data()).filter(r => !r.oculta && r.rating);
    const avgRating = todasVal.length
        ? (todasVal.reduce((s, r) => s + r.rating, 0) / todasVal.length)
        : null;

    const resenas = todasVal
        .filter(r => r.comentario?.trim())
        .sort((a, b) => (b.creadoEn?.seconds ?? 0) - (a.creadoEn?.seconds ?? 0))
        .slice(0, 5);

    const avgHTML = avgRating != null ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #f0ece4;">
            <span style="color:#e8a838;font-size:1.05rem;">${'★'.repeat(Math.round(avgRating))}${'☆'.repeat(5-Math.round(avgRating))}</span>
            <span style="font-weight:800;font-size:0.95rem;color:#222;">${avgRating.toFixed(1)}</span>
            <span style="color:#aaa;font-size:0.76rem;">(${todasVal.length} ${todasVal.length === 1 ? 'valoración' : 'valoraciones'})</span>
        </div>` : '';

    const resenasHTML = resenas.length ? resenas.map(r => `
        <div style="padding:10px 0;border-top:1px solid #f0ece4;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-size:0.78rem;font-weight:700;color:#555;">${r.displayName ?? 'Anónimo'}</span>
                <span style="color:#e8a838;font-size:0.85rem;">${'★'.repeat(r.rating ?? 0)}${'☆'.repeat(5 - (r.rating ?? 0))}</span>
            </div>
            <p style="font-size:0.82rem;color:#666;margin:0;">${r.comentario}</p>
        </div>`).join('') : '';

    container.innerHTML = `
        <div style="border-top:1px solid #e0dbd2;margin-top:16px;padding-top:16px;">
            ${avgHTML}
            ${_user ? `
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="modal-social-qp" class="btn-qp-carta" data-id="${platoId}"
                    onclick="window.cartaSocial.toggleQuieroProbar('${platoId}')"
                    style="flex:1;min-height:42px;padding:8px 10px;border-radius:10px;border:1.5px solid #eb6f53;background:white;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;transition:background .2s,color .2s;">
                    <img src="css/img/bookmark-outline.svg" width="13" height="13" style="flex-shrink:0;"><span>Quiero probarlo</span>
                </button>
                <button id="modal-social-probado" class="btn-probado-carta" data-id="${platoId}"
                    onclick="window.cartaSocial.toggleProbado('${platoId}')"
                    style="flex:1;min-height:42px;padding:8px 10px;border-radius:10px;border:1.5px solid #01323f;background:white;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;transition:background .2s,color .2s;">
                    <span>Ya lo probé</span>
                </button>
            </div>
            <div style="margin-bottom:14px;">
                <button id="modal-social-fav" class="btn-fav-carta" data-id="${platoId}"
                    onclick="window.cartaSocial.toggleLike('${platoId}')"
                    style="width:100%;min-height:42px;padding:7px 10px;border-radius:10px;border:1.5px solid #eb6f53;background:white;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:7px;transition:background .2s,color .2s;position:static;height:auto;opacity:1;">
                    <img src="css/img/heart-outline.svg" width="13" height="13" style="flex-shrink:0;"><span>Me gusta</span>
                </button>
            </div>
            <div style="margin-bottom:14px;">
                <p style="font-size:0.78rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Tu valoración</p>
                <div id="modal-estrellas" style="display:flex;gap:4px;margin-bottom:8px;">
                    ${[1,2,3,4,5].map(n => `
                    <button onclick="window.cartaSocial._setRatingTemp(${n}, '${platoId}')"
                        data-star="${n}"
                        style="font-size:1.5rem;background:none;border:none;cursor:pointer;opacity:${n <= miRating ? '1' : '0.25'};transition:opacity .15s;padding:0 2px;">★</button>`).join('')}
                </div>
                <textarea id="modal-comentario" placeholder="Comentario opcional..." rows="2"
                    style="width:100%;padding:10px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.85rem;resize:none;"
                    >${miComentario}</textarea>
                <button onclick="window.cartaSocial.guardarRating('${platoId}')"
                    style="margin-top:8px;padding:9px 20px;border-radius:10px;border:none;background:#01323f;color:white;font-weight:700;font-size:0.82rem;cursor:pointer;font-family:inherit;">
                    Guardar valoración
                </button>
            </div>` : `
            <button onclick="window.cartaSocial.mostrarLogin()"
                style="width:100%;padding:11px;border-radius:10px;border:1.5px solid #01323f;background:white;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;color:#01323f;">
                👤 Entrá para valorar y guardar favoritos
            </button>`}
            ${resenasHTML ? `
            <div style="margin-top:14px;">
                <p style="font-size:0.78rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lo que dicen</p>
                ${resenasHTML}
            </div>` : ''}
        </div>`;

    // Aplicar estados
    if (_user) {
        const btnLike = document.getElementById('modal-social-fav');
        const btnQP   = document.getElementById('modal-social-qp');
        const btnProb = document.getElementById('modal-social-probado');
        if (btnLike) _actualizarBtnLike(btnLike, platoId);
        if (btnQP)   _actualizarBtnQP(btnQP, platoId);
        if (btnProb) _actualizarBtnProbado(btnProb, platoId);
        _tempRating = miRating;
    }
}

// ─── Rating temporal ─────────────────────────────────────────────────────────
let _tempRating = 0;

export function _setRatingTemp(n, platoId) {
    _tempRating = n;
    document.querySelectorAll('#modal-estrellas button').forEach(btn => {
        btn.style.opacity = parseInt(btn.dataset.star) <= n ? '1' : '0.25';
    });
}

export async function guardarRating(platoId) {
    if (!_user || !_tempRating) return;
    const nombre = _user.displayName?.split(' ')[0] ?? _user.email?.split('@')[0] ?? 'Anónimo';
    const comentario = document.getElementById('modal-comentario')?.value.trim() ?? '';

    await setDoc(doc(db, 'carta_valoraciones', `${platoId}_${_user.uid}`), {
        platoId, userId: _user.uid, displayName: nombre,
        rating: _tempRating, comentario, creadoEn: serverTimestamp()
    });

    const btn = document.querySelector(`[onclick="window.cartaSocial.guardarRating('${platoId}')"]`);
    if (btn) { btn.textContent = '✓ Guardado'; btn.disabled = true; }
}

// ─── Login / logout ───────────────────────────────────────────────────────────
export function mostrarLogin(vista = 'login') {
    const modal = document.getElementById('carta-login-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    _mostrarVistaLogin(vista);
}

function _ocultarLogin() {
    const modal = document.getElementById('carta-login-modal');
    if (!modal) return;
    modal.style.display = 'none';
}

function _mostrarVistaLogin(vista) {
    ['login', 'register', 'forgot'].forEach(v => {
        const el = document.getElementById(`carta-auth-${v}`);
        if (el) el.style.display = v === vista ? 'block' : 'none';
    });
}

export function mostrarMenuUsuario() {
    if (!_user) { mostrarLogin(); return; }
    const modal = document.getElementById('carta-perfil-modal');
    if (!modal) return;
    _renderPerfilPanel();
    modal.style.display = 'flex';
}

function _ocultarPerfil() {
    const modal = document.getElementById('carta-perfil-modal');
    if (modal) modal.style.display = 'none';
}

function _renderPerfilPanel() {
    const container = document.getElementById('carta-perfil-inner');
    if (!container || !_user) return;

    const nombre = _user.displayName ?? _user.email?.split('@')[0] ?? 'Vos';
    const email  = _user.email ?? '';

    const _listaPlatos = (ids) => {
        if (!ids.size) return '<p style="font-size:0.82rem;color:#aaa;margin:6px 0 0;">Todavía no hay ninguno.</p>';
        return [...ids].map(id => {
            const nombre = _platosMap[id]?.nombre ?? id;
            return `<div style="font-size:0.85rem;padding:6px 0;border-bottom:1px solid #f5f0ea;color:#333;">${nombre}</div>`;
        }).join('');
    };

    container.innerHTML = `
        <div style="width:40px;height:4px;background:#e0dbd2;border-radius:4px;margin:0 auto 20px;"></div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;">
            <div style="width:46px;height:46px;border-radius:50%;background:#01323f;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <span style="font-size:1.3rem;">👤</span>
            </div>
            <div>
                <p style="margin:0;font-weight:700;font-size:1rem;color:#01323f;">${nombre}</p>
                <p style="margin:0;font-size:0.78rem;color:#888;">${email}</p>
            </div>
        </div>

        <div style="background:#fffbf7;border:1px solid #f0ece4;border-radius:14px;padding:16px;margin-bottom:10px;">
            <p style="margin:0 0 10px;font-size:0.75rem;font-weight:700;color:#eb6f53;text-transform:uppercase;letter-spacing:0.5px;">
                🔖 Quiero probarlo (${_quieroProbar.size})
            </p>
            ${_listaPlatos(_quieroProbar)}
        </div>

        <div style="background:#fffbf7;border:1px solid #f0ece4;border-radius:14px;padding:16px;margin-bottom:10px;">
            <p style="margin:0 0 10px;font-size:0.75rem;font-weight:700;color:#01323f;text-transform:uppercase;letter-spacing:0.5px;">
                ✓ Ya probé (${_probados.size})
            </p>
            ${_listaPlatos(_probados)}
        </div>

        <div style="background:#fffbf7;border:1px solid #f0ece4;border-radius:14px;padding:16px;margin-bottom:22px;">
            <p style="margin:0 0 10px;font-size:0.75rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;">
                ❤️ Me gusta (${_likes.size})
            </p>
            ${_listaPlatos(_likes)}
        </div>

        <button onclick="window.cartaSocial._cerrarSesion()"
            style="width:100%;padding:13px;border:1.5px solid #e0dbd2;border-radius:12px;background:white;font-weight:700;font-size:0.88rem;cursor:pointer;font-family:inherit;color:#666;">
            Cerrar sesión
        </button>`;
}

export async function _cerrarSesion() {
    _ocultarPerfil();
    await signOut(auth);
}

async function _loginGoogle() {
    try {
        await signInWithPopup(auth, googleProvider);
        _ocultarLogin();
    } catch (e) { alert('Error con Google: ' + e.message); }
}

async function _loginEmail() {
    const email = document.getElementById('carta-login-email').value.trim();
    const pass  = document.getElementById('carta-login-pass').value.trim();
    if (!email || !pass) return alert('Completá email y contraseña.');
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        _ocultarLogin();
    } catch (e) { alert('Email o contraseña incorrectos.'); }
}

async function _register() {
    const nombre = document.getElementById('carta-reg-nombre').value.trim();
    const email  = document.getElementById('carta-reg-email').value.trim();
    const pass   = document.getElementById('carta-reg-pass').value.trim();
    if (!nombre || !email || !pass) return alert('Completá todos los campos.');
    if (pass.length < 6) return alert('La contraseña debe tener al menos 6 caracteres.');
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, 'usuarios_tienda', cred.user.uid), {
            uid: cred.user.uid, nombre, email, creado: serverTimestamp()
        });
        _ocultarLogin();
    } catch (e) { alert('Error al registrar: ' + e.message); }
}

async function _resetPass() {
    const email = document.getElementById('carta-forgot-email').value.trim();
    if (!email) return alert('Ingresá tu email.');
    try {
        await sendPasswordResetEmail(auth, email);
        alert('Link enviado, revisá tu bandeja.');
        _mostrarVistaLogin('login');
    } catch (e) { alert('No pudimos enviar el mail.'); }
}

// ─── Swipe-to-close en paneles bottom-sheet ───────────────────────────────────
function _addSwipeDown(panel, onClose) {
    let startY = null, dy = 0, esGesture = false;
    panel.addEventListener('touchstart', e => {
        startY = e.touches[0].clientY;
        dy = 0; esGesture = false;
        panel.style.transition = 'none';
    }, { passive: true });
    panel.addEventListener('touchmove', e => {
        if (startY === null) return;
        const delta = e.touches[0].clientY - startY;
        if (!esGesture) {
            if (delta > 8 && panel.scrollTop === 0) esGesture = true;
            else if (delta < -4 || panel.scrollTop > 0) { startY = null; return; }
            else return;
        }
        e.preventDefault();
        dy = Math.max(0, delta);
        panel.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    panel.addEventListener('touchend', () => {
        if (!esGesture) { startY = null; return; }
        panel.style.transition = 'transform 0.28s cubic-bezier(0.32,0.72,0,1)';
        if (dy > 80) {
            panel.style.transform = 'translateY(110%)';
            setTimeout(() => { panel.style.transform = ''; panel.style.transition = ''; onClose(); }, 280);
        } else {
            panel.style.transform = 'translateY(0)';
            setTimeout(() => { panel.style.transition = ''; }, 300);
        }
        startY = null; dy = 0; esGesture = false;
    });
}

// ─── Inyectar modal de login ──────────────────────────────────────────────────
function _inyectarLoginModal() {
    const modal = document.createElement('div');
    modal.id = 'carta-login-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:none;align-items:flex-end;justify-content:center;';
    modal.innerHTML = `
    <div class="login-inner" style="background:white;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:28px 24px 40px;overflow-y:auto;max-height:90vh;">
        <div style="width:40px;height:4px;background:#e0dbd2;border-radius:4px;margin:0 auto 24px;"></div>

        <div id="carta-auth-login">
            <h2 style="font-family:'Syncopate',sans-serif;font-size:1rem;margin-bottom:6px;color:#01323f;">¡Hola!</h2>
            <p style="font-size:0.85rem;color:#888;margin-bottom:20px;">Entrá para guardar favoritos y dejar tu opinión.</p>
            <button id="carta-btn-google"
                style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:13px;background:white;border:1px solid #e0dbd2;border-radius:12px;font-weight:600;cursor:pointer;font-family:inherit;font-size:0.9rem;margin-bottom:16px;">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20">
                Entrar con Google
            </button>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;color:#aaa;font-size:0.75rem;font-weight:700;">
                <div style="flex:1;height:1px;background:#eee;"></div>Ó CON EMAIL<div style="flex:1;height:1px;background:#eee;"></div>
            </div>
            <input type="email" id="carta-login-email" placeholder="tu@email.com"
                style="width:100%;padding:12px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.9rem;margin-bottom:10px;">
            <input type="password" id="carta-login-pass" placeholder="Contraseña"
                style="width:100%;padding:12px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.9rem;margin-bottom:6px;">
            <div style="text-align:right;margin-bottom:14px;">
                <span onclick="window.cartaSocial._vistaLogin('forgot')" style="font-size:0.78rem;color:#ed7053;cursor:pointer;font-weight:600;">¿Olvidaste tu contraseña?</span>
            </div>
            <button id="carta-btn-login"
                style="width:100%;padding:13px;background:#01323f;color:white;border:none;border-radius:12px;font-weight:700;font-family:inherit;cursor:pointer;font-size:0.9rem;margin-bottom:12px;">
                ENTRAR
            </button>
            <p style="text-align:center;font-size:0.82rem;color:#888;">¿No tenés cuenta? <span onclick="window.cartaSocial._vistaLogin('register')" style="color:#ed7053;font-weight:700;cursor:pointer;">Registrate</span></p>
        </div>

        <div id="carta-auth-register" style="display:none;">
            <h2 style="font-family:'Syncopate',sans-serif;font-size:1rem;margin-bottom:6px;color:#01323f;">Crear cuenta</h2>
            <p style="font-size:0.85rem;color:#888;margin-bottom:20px;">Registrate para guardar tus favoritos.</p>
            <input type="text" id="carta-reg-nombre" placeholder="Nombre"
                style="width:100%;padding:12px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.9rem;margin-bottom:10px;">
            <input type="email" id="carta-reg-email" placeholder="Email"
                style="width:100%;padding:12px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.9rem;margin-bottom:10px;">
            <input type="password" id="carta-reg-pass" placeholder="Contraseña (mín. 6 caracteres)"
                style="width:100%;padding:12px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.9rem;margin-bottom:14px;">
            <button id="carta-btn-register"
                style="width:100%;padding:13px;background:#01323f;color:white;border:none;border-radius:12px;font-weight:700;font-family:inherit;cursor:pointer;font-size:0.9rem;margin-bottom:12px;">
                REGISTRARME
            </button>
            <p style="text-align:center;font-size:0.82rem;color:#888;">¿Ya tenés cuenta? <span onclick="window.cartaSocial._vistaLogin('login')" style="color:#ed7053;font-weight:700;cursor:pointer;">Iniciá sesión</span></p>
        </div>

        <div id="carta-auth-forgot" style="display:none;">
            <h2 style="font-family:'Syncopate',sans-serif;font-size:1rem;margin-bottom:6px;color:#01323f;">Recuperar clave</h2>
            <p style="font-size:0.85rem;color:#888;margin-bottom:20px;">Te mandamos un link para crear una nueva contraseña.</p>
            <input type="email" id="carta-forgot-email" placeholder="tu@email.com"
                style="width:100%;padding:12px;border:1px solid #e0dbd2;border-radius:10px;font-family:inherit;font-size:0.9rem;margin-bottom:14px;">
            <button id="carta-btn-reset"
                style="width:100%;padding:13px;background:#01323f;color:white;border:none;border-radius:12px;font-weight:700;font-family:inherit;cursor:pointer;font-size:0.9rem;margin-bottom:12px;">
                ENVIAR LINK
            </button>
            <p style="text-align:center;font-size:0.82rem;color:#888;cursor:pointer;" onclick="window.cartaSocial._vistaLogin('login')">← Volver</p>
        </div>
    </div>`;

    document.body.appendChild(modal);

    // Cerrar al tocar el fondo
    modal.addEventListener('click', e => { if (e.target === modal) _ocultarLogin(); });
    _addSwipeDown(modal.querySelector('.login-inner'), _ocultarLogin);

    // ── Panel de perfil ──────────────────────────────────────────────────────
    const perfilModal = document.createElement('div');
    perfilModal.id = 'carta-perfil-modal';
    perfilModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:none;align-items:flex-end;justify-content:center;';
    perfilModal.innerHTML = `
    <div id="carta-perfil-inner" style="background:white;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:28px 24px 40px;overflow-y:auto;max-height:85vh;">
    </div>`;
    document.body.appendChild(perfilModal);
    perfilModal.addEventListener('click', e => { if (e.target === perfilModal) _ocultarPerfil(); });
    _addSwipeDown(document.getElementById('carta-perfil-inner'), _ocultarPerfil);

    document.getElementById('carta-btn-google').onclick  = _loginGoogle;
    document.getElementById('carta-btn-login').onclick   = _loginEmail;
    document.getElementById('carta-btn-register').onclick = _register;
    document.getElementById('carta-btn-reset').onclick   = _resetPass;
}

// ─── API pública ──────────────────────────────────────────────────────────────
export function _vistaLogin(v) { _mostrarVistaLogin(v); }

export function getFavBtnHTML(platoId) {
    if (!_enabled) return '';
    return `<button class="btn-fav-carta" data-id="${platoId}"
        onclick="event.stopPropagation(); window.cartaSocial.toggleFavorito('${platoId}')"
        title="Quiero probarlo">❤️</button>`;
}
