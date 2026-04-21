import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { writeReserva, deleteReserva, CART_TIMEOUT_MS } from './cart-reservas.js';

// --- STATE ---
const cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let userIsLogged = false;
let cartTimerInterval = null;
let _maxUnidadesPorPedido = 0;
export function setMaxUnidadesPorPedido(n) { _maxUnidadesPorPedido = n; }

// --- ELEMENTS (set after inject) ---
let cartDrawer = null;
let cartOverlay = null;
let cartItemsList = null;
let cartTotal = null;

// --- AUTH ---
onAuthStateChanged(auth, (user) => {
    userIsLogged = !!user;
});

// --- HTML INJECTION ---
function _injectHTML() {
    if (document.getElementById('cart-root')) return;
    const root = document.createElement('div');
    root.id = 'cart-root';
    root.innerHTML = `
  <div class="cart-overlay" id="cart-overlay"></div>
  <div class="cart-drawer" id="cart-drawer">
    <div class="cart-header">
      <h2>Mi Carrito</h2>
      <button class="btn-close-cart" id="btn-close-cart"><i class="fas fa-times"></i></button>
    </div>
    <div class="cart-items" id="cart-items-list">
      <div class="cart-empty">
        <i class="fas fa-shopping-basket"></i>
        <p>Tu carrito está vacío</p>
      </div>
    </div>
    <div class="cart-footer">
      <div class="total-row">
        <span class="total-label">Total estimado</span>
        <span class="total-amount" id="cart-total">$0.00</span>
      </div>
      <button class="btn-checkout" id="btn-go-to-checkout">IR A PAGAR</button>
      <button class="btn-keep-shopping" id="btn-keep-shopping" style="display:none;">SEGUIR COMPRANDO</button>
    </div>
  </div>
  <div class="modal-overlay" id="checkout-modal" style="display:none;">
    <div class="modal-checkout">
      <h2 style="font-family:var(--font-display);color:var(--panel-oscuro);">¡Casi listo! ☕</h2>
      <p>Iniciá sesión para sumar cafecitos y ver tu historial, o continuá como invitado.</p>
      <div class="modal-actions">
        <button class="btn-modal btn-modal-primary" id="modal-btn-login">INICIAR SESIÓN</button>
        <button class="btn-modal btn-modal-accent" id="modal-btn-register">CREAR CUENTA</button>
        <button class="btn-modal btn-modal-outline" id="modal-btn-guest">CONTINUAR COMO INVITADO</button>
      </div>
      <button onclick="document.getElementById('checkout-modal').style.display='none'"
        style="margin-top:20px;background:none;border:none;font-size:12px;font-weight:600;color:#999;cursor:pointer;">
        VOLVER AL CARRITO
      </button>
    </div>
  </div>
`;
    document.body.appendChild(root);
}

// --- BIND ELEMENTS ---
function _bindElements() {
    cartDrawer = document.getElementById('cart-drawer');
    cartOverlay = document.getElementById('cart-overlay');
    cartItemsList = document.getElementById('cart-items-list');
    cartTotal = document.getElementById('cart-total');
}

// --- EVENTS ---
function _setupEvents() {
    document.getElementById('cart-btn-header')?.addEventListener('click', openCart);
    document.getElementById('btn-open-cart')?.addEventListener('click', openCart);
    document.getElementById('btn-close-cart')?.addEventListener('click', closeCart);
    cartOverlay?.addEventListener('click', closeCart);
    document.getElementById('btn-keep-shopping')?.addEventListener('click', closeCart);

    document.getElementById('btn-go-to-checkout')?.addEventListener('click', () => {
        if (cart.length === 0) { window.location.href = 'tienda.html'; return; }
        if (userIsLogged) { window.location.href = 'checkout.html'; return; }
        const modal = document.getElementById('checkout-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.pointerEvents = 'none';
            setTimeout(() => { modal.style.pointerEvents = ''; }, 400);
        } else {
            window.location.href = 'checkout.html';
        }
    });

    document.getElementById('modal-btn-login')?.addEventListener('click', () => {
        sessionStorage.setItem('redirectAfterLogin', 'checkout.html');
        window.location.href = 'tienda-cuenta.html';
    });
    document.getElementById('modal-btn-register')?.addEventListener('click', () => {
        sessionStorage.setItem('redirectAfterLogin', 'checkout.html');
        window.location.href = 'tienda-cuenta.html#register';
    });
    document.getElementById('modal-btn-guest')?.addEventListener('click', () => {
        window.location.href = 'checkout.html';
    });
}

// --- OPEN / CLOSE ---
export function openCart() {
    cartDrawer?.classList.add('active');
    cartOverlay?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

export function closeCart() {
    cartDrawer?.classList.remove('active');
    cartOverlay?.classList.remove('active');
    document.body.style.overflow = 'auto';
}

// --- TOAST ---
export function showToast(msg, type = 'warning') {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:${type === 'warning' ? '#f59e0b' : '#ef4444'};color:white;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);animation:fadeIn 0.3s ease;`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// --- CART TIMER ---
function startCartTimer() {
    if (cartTimerInterval) clearInterval(cartTimerInterval);
    cartTimerInterval = setInterval(() => {
        const countdowns = document.querySelectorAll('.reserva-countdown');
        if (countdowns.length === 0) return;
        const now = Date.now();
        let needsRefresh = false;
        countdowns.forEach(el => {
            const expires = parseInt(el.dataset.expires, 10);
            const remaining = expires - now;
            if (remaining <= 0) {
                const cartKey = el.dataset.cartKey;
                const idx = cart.findIndex(item => {
                    const key = item._cartKey || `${item.id}__base`;
                    return key === cartKey;
                });
                if (idx !== -1) {
                    const item = cart[idx];
                    cart.splice(idx, 1);
                    try { deleteReserva(item.id, item.variantKey || null); } catch(e) {}
                    showToast(`⏰ "${item.nombre}" fue eliminado del carrito por inactividad.`, 'error');
                    needsRefresh = true;
                }
            } else {
                const totalSecs = Math.ceil(remaining / 1000);
                const mins = Math.floor(totalSecs / 60);
                const secs = totalSecs % 60;
                el.innerText = `⏱ ${mins}:${String(secs).padStart(2, '0')}`;
                el.style.color = remaining <= 2 * 60 * 1000 ? '#ef4444' : '#f59e0b';
                el.style.fontWeight = remaining <= 2 * 60 * 1000 ? '800' : '700';
            }
        });
        if (needsRefresh) saveAndRefresh();
    }, 1000);
}

// --- UPDATE UI ---
export function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    document.querySelectorAll('.cart-count, .cart-count-badge, #cart-badge').forEach(b => {
        b.innerText = totalItems;
        b.style.display = totalItems > 0 ? 'flex' : 'none';
        if (totalItems > 0) b.style.setProperty('display', 'flex', 'important');
    });

    const checkoutBtn = document.getElementById('btn-go-to-checkout');
    const keepShoppingBtn = document.getElementById('btn-keep-shopping');

    if (cart.length === 0) {
        if (cartItemsList) cartItemsList.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Tu carrito está vacío</p></div>`;
        if (cartTotal) cartTotal.innerText = '$0.00';
        if (checkoutBtn) checkoutBtn.innerText = 'VER PRODUCTOS';
        if (keepShoppingBtn) keepShoppingBtn.style.display = 'none';
        return;
    }
    if (checkoutBtn) checkoutBtn.innerText = 'IR A PAGAR';
    if (keepShoppingBtn) keepShoppingBtn.style.display = 'block';

    if (!cartItemsList) return;
    cartItemsList.innerHTML = cart.map((item, index) => {
        const cartKey = item._cartKey || `${item.id}__base`;
        const countdownHtml = (!item.stockIlimitado && item.reservadoEn) ? `
            <div class="reserva-countdown" data-expires="${item.reservadoEn + CART_TIMEOUT_MS}" data-cart-key="${cartKey}" style="font-size:11px;font-weight:700;margin-top:3px;color:#f59e0b;"></div>
        ` : '';
        return `
        <div class="cart-item">
            <img src="${item.imagenUrl || 'https://placehold.co/100x100'}" alt="${item.nombre}" class="cart-item-img">
            <div class="cart-item-info">
                <div class="cart-item-title">${item.nombre}</div>
                ${item.variantLabel ? `<div style="font-size:0.72rem;color:var(--naranja-accent);font-weight:600;margin:2px 0;">${item.variantLabel}</div>` : ''}
                <div class="cart-item-price">$${item.precio.toLocaleString('es-AR')}</div>
                ${countdownHtml}
                <div class="cart-item-controls">
                    <button class="qty-btn" onclick="updateQty(${index}, -1)"><i class="fas fa-minus"></i></button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${index}, 1)"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <button class="btn-remove-item" onclick="removeItem(${index})" style="background:none;border:none;color:#ff4d4d;cursor:pointer;"><i class="fas fa-trash"></i></button>
        </div>`;
    }).join('');

    if (cartTotal) cartTotal.innerText = `$${cart.reduce((s, i) => s + i.precio * i.qty, 0).toLocaleString('es-AR')}`;
    startCartTimer();
}

// --- SAVE & REFRESH ---
export function saveAndRefresh() {
    localStorage.setItem('corcega_cart', JSON.stringify(cart));
    updateCartUI();
}

// --- WINDOW HANDLERS ---
window.updateQty = function(index, delta) {
    const item = cart[index];
    if (delta > 0) {
        if (_maxUnidadesPorPedido > 0 && item.requiereAgenda) {
            const totalAgenda = cart.filter(i => i.requiereAgenda).reduce((s, i) => s + i.qty, 0);
            if (totalAgenda + delta > _maxUnidadesPorPedido) {
                showToast(`Máximo ${_maxUnidadesPorPedido} unidades por pedido (entre todos los productos con fecha). Para cantidades mayores, ¡escribinos!`, 'warning');
                return;
            }
        }
        if (item.stockIlimitado !== true) {
            const stockDisponible = item.stock || 0;
            if (item.qty >= stockDisponible) {
                alert(`¡Lo sentimos! Solo quedan ${stockDisponible} unidades disponibles.`);
                return;
            }
        }
    }
    item.qty += delta;
    if (item.qty < 1) {
        if (item.stockIlimitado !== true) {
            try { deleteReserva(item.id, item.variantKey || null); } catch(e) {}
        }
        cart.splice(index, 1);
    } else {
        if (item.stockIlimitado !== true) {
            try { writeReserva(item.id, item.variantKey || null, item.qty, item.nombre); } catch(e) {}
        }
    }
    saveAndRefresh();
};

window.removeItem = function(index) {
    const item = cart[index];
    if (item.stockIlimitado !== true) {
        try { deleteReserva(item.id, item.variantKey || null); } catch(e) {}
    }
    cart.splice(index, 1);
    saveAndRefresh();
};

// --- INIT ---
export function initCart() {
    _injectHTML();
    _bindElements();
    _setupEvents();
    updateCartUI();

    window.tienda = {
        toggleCart: () => {
            if (document.getElementById('cart-drawer')?.classList.contains('active')) closeCart();
            else openCart();
        }
    };
}

export { cart };
