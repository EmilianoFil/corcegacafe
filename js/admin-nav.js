/**
 * admin-nav.js
 * Hace que los formularios y modales del admin se comporten como pantallas
 * propias: ocultan el resto de la sección y el botón "atrás" del navegador
 * o del celular los cierra en lugar de salir del panel.
 *
 * No hay que llamar nada al abrir o cerrar: se observa el `display` de cada
 * elemento registrado abajo.
 */

// Formularios que ocupan la sección entera mientras están abiertos
const PANTALLAS = {
    'form-producto-container': () => window.tiendaAdmin.ocultarFormularioProducto(),
    'form-cupon-container':    () => window.tiendaAdmin.ocultarFormularioCupon(),
    'form-plato-wrapper':      () => window.cartaAdmin.ocultarFormPlato(),
    'form-qr-container':       () => window.qrAdmin.ocultarFormularioQr(),
};

// Ventanas flotantes: solo necesitan que "atrás" las cierre
const MODALES = [
    'crop-modal', 'modal-stock-history', 'modal-calendario-pedidos',
    'modal-campanas', 'modal-detalle-campana',
];

const pila = [];      // capas abiertas, la última es la que está arriba
let ignorarPops = 0;  // popstate provocados por nosotros mismos

const estaVisible = el => el.style.display !== '' && el.style.display !== 'none';
const contenedorScroll = () => document.querySelector('main');

// El detalle de una orden se crea y se destruye en vez de ocultarse
const ID_DETALLE_ORDEN = 'modal-detalle-orden';

function observarDetalleOrden() {
    new MutationObserver(() => {
        const el = document.getElementById(ID_DETALLE_ORDEN);
        const i = pila.findIndex(c => c.id === ID_DETALLE_ORDEN);
        if (el && i === -1) abrir(el);
        else if (el) pila[i].el = el; // se volvió a dibujar con datos nuevos
        else if (i !== -1) {
            pila.splice(i, 1);
            ignorarPops++;
            history.back();
        }
    }).observe(document.body, { childList: true });
}

function cerrarElemento(capa) {
    if (capa.id === ID_DETALLE_ORDEN) return capa.el.remove();
    if (capa.id === 'crop-modal') window.tiendaAdmin.cancelCrop();
    else if (PANTALLAS[capa.id]) PANTALLAS[capa.id]();
    if (estaVisible(capa.el)) capa.el.style.display = 'none';
}

function abrir(el) {
    const capa = { id: el.id, el, scrollMain: contenedorScroll()?.scrollTop || 0, scrollWin: window.scrollY };
    if (PANTALLAS[el.id]) {
        const seccion = el.closest('.section-content');
        // Solo se ocultan los hermanos visibles, para restaurarlos tal cual estaban
        capa.ocultos = [...seccion.children].filter(h => h !== el && !h.contains(el));
        capa.ocultos.forEach(h => h.classList.add('oculto-por-pantalla'));
        el.classList.add('pantalla-activa');
        requestAnimationFrame(() => {
            contenedorScroll()?.scrollTo({ top: 0 });
            window.scrollTo({ top: 0 });
        });
    }
    pila.push(capa);
    history.pushState({ capa: pila.length }, '');
}

function restaurar(capa) {
    if (!capa.ocultos) return;
    capa.ocultos.forEach(h => h.classList.remove('oculto-por-pantalla'));
    capa.el.classList.remove('pantalla-activa');
    requestAnimationFrame(() => {
        const main = contenedorScroll();
        if (main) main.scrollTop = capa.scrollMain;
        window.scrollTo(0, capa.scrollWin);
    });
}

function alCambiar(el) {
    const i = pila.findIndex(c => c.el === el);
    if (estaVisible(el)) {
        if (i === -1) abrir(el);
    } else if (i !== -1) {
        // La cerró la propia app (guardar, cancelar, ✕): consumir su entrada del historial
        const [capa] = pila.splice(i, 1);
        restaurar(capa);
        ignorarPops++;
        history.back();
    }
}

window.addEventListener('popstate', () => {
    if (ignorarPops > 0) { ignorarPops--; return; }
    const capa = pila.pop();
    if (!capa) return;
    restaurar(capa);
    cerrarElemento(capa);
});

function iniciar() {
    observarDetalleOrden();
    const observer = new MutationObserver(muts => muts.forEach(m => alCambiar(m.target)));
    [...Object.keys(PANTALLAS), ...MODALES].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        observer.observe(el, { attributes: true, attributeFilter: ['style'] });
        if (!PANTALLAS[id]) return;
        const volver = document.createElement('button');
        volver.type = 'button';
        volver.className = 'btn-volver';
        volver.textContent = '← Volver';
        volver.addEventListener('click', () => PANTALLAS[id]());
        el.prepend(volver);
    });
}

window.adminNav = {
    // Al cambiar de sección desde el menú se cierra todo sin tocar el historial
    cerrarTodo() {
        while (pila.length) {
            const capa = pila.pop();
            restaurar(capa);
            cerrarElemento(capa);
        }
    }
};

iniciar();
