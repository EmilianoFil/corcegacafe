// Sección "Usuarios del panel": listar, dar de alta y quitar administradores.
import { app } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const gestionar = httpsCallable(getFunctions(app, 'us-central1'), 'gestionarAdmins');
const $ = id => document.getElementById(id);
const esc = t => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let usuarios = [];

const fila = texto => `<tr><td colspan="4" style="text-align:center; padding:30px; color:#999;">${texto}</td></tr>`;

function mensajeError(e) {
    if (!navigator.onLine) return 'No hay conexión.';
    // 'internal' y 'not-found' llegan sin un texto entendible
    return ['functions/internal', 'functions/not-found'].includes(e.code)
        ? 'No se pudo completar. Probá de nuevo en un rato.'
        : e.message;
}

function aviso(texto, esError = false) {
    const el = $('usuario-msg');
    el.textContent = texto;
    el.style.color = esError ? '#c0392b' : '#27ae60';
}

export async function load() {
    const tbody = $('usuarios-body');
    if (!usuarios.length) tbody.innerHTML = fila('Cargando usuarios…');
    try {
        const { data } = await gestionar({ accion: 'listar' });
        usuarios = data.usuarios;
        tbody.innerHTML = usuarios.map(u => `
            <tr style="border-bottom:1px solid #f5f5f5;">
                <td style="padding:12px;">
                    <div style="font-weight:700; color:var(--secondary);">${esc(u.nombre) || '—'}</div>
                    <div style="font-size:0.8rem; color:#888;">${esc(u.email)}</div>
                </td>
                <td style="padding:12px; font-size:0.8rem;">${u.principal ? 'Principal' : 'Administrador'}${u.sinCuenta ? ' · sin cuenta de acceso' : ''}</td>
                <td style="padding:12px; font-size:0.8rem; color:#888;">${u.ultimoIngreso ? new Date(u.ultimoIngreso).toLocaleDateString('es-AR') : 'Nunca'}</td>
                <td style="padding:12px; text-align:right;">
                    ${u.soyYo ? '<span style="font-size:0.8rem; color:#999;">Sos vos</span>'
                        : u.principal ? ''
                        : `<button type="button" class="btn-volver" style="margin:0; color:#c0392b;" onclick="window.usuariosAdmin.quitar('${esc(u.uid)}', this)">Borrar</button>`}
                </td>
            </tr>`).join('') || fila('No hay usuarios.');
    } catch (e) {
        console.error('Error listando usuarios:', e);
        tbody.innerHTML = fila(esc(mensajeError(e)));
    }
}

export async function crear(event) {
    event.preventDefault();
    const btn = $('usuario-crear-btn');
    btn.disabled = true;
    btn.textContent = 'Creando…';
    aviso('');
    try {
        const { data } = await gestionar({
            accion: 'crear',
            nombre: $('usuario-nombre').value,
            email: $('usuario-email').value,
            password: $('usuario-pass').value
        });
        aviso(data.yaExistia
            ? 'Ese email ya tenía cuenta: ahora también es administrador y entra con su contraseña de siempre.'
            : 'Usuario creado. Ya puede entrar con ese email y contraseña.');
        event.target.reset();
        await load();
    } catch (e) {
        console.error('Error creando usuario:', e);
        aviso(mensajeError(e), true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Dar de alta';
    }
}

export async function quitar(uid, btn) {
    const u = usuarios.find(x => x.uid === uid);
    if (!u || !confirm(`¿Borrar el acceso al panel de ${u.email}?`)) return;
    btn.disabled = true;
    btn.textContent = 'Borrando…';
    try {
        const { data } = await gestionar({ accion: 'quitar', uid });
        aviso(data.cuentaBorrada
            ? `Se borró la cuenta de ${u.email}.`
            : `${u.email} ya no entra al panel (su cuenta de cliente se conserva).`);
        await load();
    } catch (e) {
        console.error('Error borrando usuario:', e);
        aviso(mensajeError(e), true);
        btn.disabled = false;
        btn.textContent = 'Borrar';
    }
}
