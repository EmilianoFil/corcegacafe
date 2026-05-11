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
let _favs         = new Set();   // platoIds favoritos del usuario
let _probados     = new Set();   // platoIds probados por el usuario
let _favCounts    = {};          // { platoId: N } — conteo global de favs
let _pendingAction = null;       // acción a ejecutar tras login

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
            await Promise.all([_cargarFavs(), _cargarProbados()]);
            _actualizarHeaderUI(user);
            _actualizarTodosLosBotones();
            if (_pendingAction) { _pendingAction(); _pendingAction = null; }
        } else {
            _favs.clear();
            _probados.clear();
            _actualizarHeaderUI(null);
            _actualizarTodosLosBotones();
        }
    });

    await _cargarFavCounts();
    _actualizarBadgesGlobales();
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
    _renderSocialEnModal(platoId);
}

// ─── Carga datos del usuario ─────────────────────────────────────────────────
async function _cargarFavs() {
    if (!_user) return;
    const snap = await getDoc(doc(db, 'carta_favoritos', _user.uid));
    _favs = new Set(snap.exists() ? (snap.data().platoIds ?? []) : []);
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
        btn.onclick = mostrarMenuUsuario;
    } else {
        btn.innerHTML = `<span style="font-size:1rem;">👤</span><span>Entrar</span>`;
        btn.onclick = mostrarLogin;
    }
}

// ─── Actualizar botones ❤️ en cards ──────────────────────────────────────────
function _actualizarTodosLosBotones() {
    document.querySelectorAll('.btn-fav-carta').forEach(btn => {
        const id = btn.dataset.id;
        _actualizarBtnFav(btn, id);
    });
    document.querySelectorAll('.btn-probado-carta').forEach(btn => {
        const id = btn.dataset.id;
        _actualizarBtnProbado(btn, id);
    });
}

function _actualizarBtnFav(btn, id) {
    const activo = _favs.has(id);
    btn.classList.toggle('fav-activo', activo);
    btn.title = activo ? 'Quitar de favoritos' : 'Quiero probarlo';
    const icon = btn.querySelector('img');
    if (icon) icon.src = activo ? 'css/img/heart-filled.svg' : 'css/img/heart-outline.svg';
}

function _actualizarBtnProbado(btn, id) {
    const activo = _probados.has(id);
    btn.classList.toggle('probado-activo', activo);
    btn.textContent = activo ? '✓ Ya lo probé' : '✓ Marcar como probado';
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

// ─── Toggle favorito ─────────────────────────────────────────────────────────
export function toggleFavorito(platoId) {
    if (!_user) {
        _pendingAction = () => toggleFavorito(platoId);
        mostrarLogin();
        return;
    }
    const esFav = _favs.has(platoId);
    if (esFav) {
        _favs.delete(platoId);
    } else {
        _favs.add(platoId);
    }

    // Actualizar botones inmediatamente (optimistic)
    document.querySelectorAll(`.btn-fav-carta[data-id="${platoId}"]`).forEach(btn => {
        _actualizarBtnFav(btn, platoId);
    });

    // Guardar en Firestore
    setDoc(doc(db, 'carta_favoritos', _user.uid),
        { platoIds: [..._favs] }, { merge: true });

    // Actualizar contador global
    const delta = esFav ? -1 : 1;
    _favCounts[platoId] = Math.max(0, (_favCounts[platoId] ?? 0) + delta);
    setDoc(doc(db, 'carta_plato_stats', platoId),
        { favCount: increment(delta) }, { merge: true });
    _actualizarBadgesGlobales();

    // Actualizar corazón en el modal si está abierto
    const modalFav = document.getElementById('modal-social-fav');
    if (modalFav && modalFav.dataset.id === platoId) {
        _actualizarBtnFav(modalFav, platoId);
    }
}

// ─── Toggle probado ───────────────────────────────────────────────────────────
export function toggleProbado(platoId) {
    if (!_user) {
        _pendingAction = () => toggleProbado(platoId);
        mostrarLogin();
        return;
    }
    if (_probados.has(platoId)) {
        _probados.delete(platoId);
    } else {
        _probados.add(platoId);
    }
    setDoc(doc(db, 'carta_probados', _user.uid),
        { platoIds: [..._probados] }, { merge: true });

    const btn = document.getElementById('modal-social-probado');
    if (btn) _actualizarBtnProbado(btn, platoId);
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
    const resenas = resenasSnap.docs.map(d => d.data())
        .filter(r => r.comentario?.trim())
        .sort((a, b) => (b.creadoEn?.seconds ?? 0) - (a.creadoEn?.seconds ?? 0))
        .slice(0, 5);

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
            ${_user ? `
            <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;">
                <button id="modal-social-fav" class="btn-fav-carta" data-id="${platoId}"
                    onclick="window.cartaSocial.toggleFavorito('${platoId}')"
                    style="flex:1;padding:10px;border-radius:10px;border:1.5px solid #eb6f53;background:white;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s;position:static;width:auto;height:auto;opacity:1;">
                    <img id="modal-fav-icon" src="css/img/heart-outline.svg" width="15" height="15" style="flex-shrink:0;"> Quiero probarlo
                </button>
                <button id="modal-social-probado" class="btn-probado-carta" data-id="${platoId}"
                    onclick="window.cartaSocial.toggleProbado('${platoId}')"
                    style="flex:1;padding:10px;border-radius:10px;border:1.5px solid #01323f;background:white;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .2s;">
                    ✓ Marcar como probado
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
        const btnFav = document.getElementById('modal-social-fav');
        const btnProb = document.getElementById('modal-social-probado');
        if (btnFav) _actualizarBtnFav(btnFav, platoId);
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
    const inner = modal.querySelector('.login-inner');
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        if (inner) inner.style.transform = 'translateY(0)';
    });
    _mostrarVistaLogin(vista);
}

function _ocultarLogin() {
    const modal = document.getElementById('carta-login-modal');
    if (!modal) return;
    const inner = modal.querySelector('.login-inner');
    modal.style.opacity = '0';
    if (inner) inner.style.transform = 'translateY(100%)';
    setTimeout(() => { modal.style.display = 'none'; }, 280);
}

function _mostrarVistaLogin(vista) {
    ['login', 'register', 'forgot'].forEach(v => {
        const el = document.getElementById(`carta-auth-${v}`);
        if (el) el.style.display = v === vista ? 'block' : 'none';
    });
}

export function mostrarMenuUsuario() {
    if (!_user) { mostrarLogin(); return; }
    const nombre = _user.displayName ?? _user.email ?? '';
    if (confirm(`Conectado como ${nombre}\n\n¿Cerrar sesión?`)) {
        signOut(auth);
    }
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

// ─── Inyectar modal de login ──────────────────────────────────────────────────
function _inyectarLoginModal() {
    const modal = document.createElement('div');
    modal.id = 'carta-login-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:none;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .25s;';
    modal.innerHTML = `
    <div class="login-inner" style="background:white;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:28px 24px max(36px,env(safe-area-inset-bottom));overflow-y:auto;max-height:90vh;transform:translateY(100%);transition:transform .3s ease-out;">
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
