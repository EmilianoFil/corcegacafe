import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Popup de bienvenida (15% OFF al registrarse). Reglas para no ser invasivo:
//  - Si el usuario está logueado, o el navegador ya quedó marcado como
//    "corcega_registered" alguna vez (lo marca header-component.js al ver
//    sesión activa, y esa marca no se borra al hacer logout), no se muestra.
//  - Si lo cerraron (X, "seguir comprando", click afuera o Esc) 3 veces,
//    no se vuelve a mostrar en ese navegador.
const PROMO_DISMISS_KEY = 'corcega_promo_dismiss_count';
const PROMO_MAX_DISMISS = 3;
const REGISTERED_KEY = 'corcega_registered';

function isRegistered() {
    return localStorage.getItem(REGISTERED_KEY) === '1';
}
function getDismissCount() {
    return parseInt(localStorage.getItem(PROMO_DISMISS_KEY) || '0', 10);
}
function registerDismiss() {
    localStorage.setItem(PROMO_DISMISS_KEY, String(getDismissCount() + 1));
}
function shouldShowPromo() {
    return !isRegistered() && getDismissCount() < PROMO_MAX_DISMISS;
}

function injectMarkup() {
    const html = `
        <div class="promo-overlay" id="promo-overlay">
          <div class="promo-modal">
            <div class="promo-header">
              <button class="promo-close" id="promo-close" aria-label="Cerrar">✕</button>
              <div class="promo-kicker">BIENVENIDO A CÓRCEGA</div>
              <div class="promo-percent">15% OFF</div>
              <div class="promo-title">en tu primera compra al registrarte</div>
            </div>
            <div class="promo-body">
              <p class="promo-desc">Creá tu cuenta gratis y sumate a Club Córcega. Te enviamos el código de descuento apenas te registrás.</p>
              <a href="tienda-cuenta.html#register" class="promo-cta" id="promo-cta">Registrarme y obtener el 15%</a>
              <button class="promo-dismiss" id="promo-dismiss">Seguir comprando sin registrarme</button>
            </div>
          </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

function initPromoPopup() {
    injectMarkup();

    const overlay = document.getElementById('promo-overlay');
    const track = (boton) => { if (typeof gtag === 'function') gtag('event', 'click_popup_bienvenida', { boton }); };

    function openPromo() { overlay.classList.add('open'); }
    function closePromo(boton) {
        track(boton);
        registerDismiss();
        overlay.classList.remove('open');
    }

    document.getElementById('promo-close').addEventListener('click', () => closePromo('cerrar_x'));
    document.getElementById('promo-dismiss').addEventListener('click', () => closePromo('seguir_sin_registrarme'));
    document.getElementById('promo-cta').addEventListener('click', () => track('registrarme'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePromo('click_afuera'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closePromo('esc'); });

    setTimeout(openPromo, 1500);
}

// Esperamos el primer chequeo de auth antes de decidir si mostramos el popup,
// para no mostrarlo un instante a alguien que en realidad está logueado.
const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    if (user) return; // header-component.js ya marca corcega_registered
    if (shouldShowPromo()) initPromoPopup();
});
