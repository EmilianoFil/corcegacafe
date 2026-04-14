/**
 * Componente Header para Tienda Córcega
 * Centraliza el diseño y la lógica del header en todas las páginas de la tienda.
 */
import { auth, db } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function initHeader() {
    const headerElement = document.querySelector('header');
    if (!headerElement) return;

    // Inyectamos la estructura estandarizada
    headerElement.innerHTML = `
        <div class="header-left">
            <a href="index.html">
                <img src="css/img/Corcega_Logo_Original.png" alt="Logo" class="mini-logo logo-tienda">
            </a>
        </div>
        <div class="header-center">
            <div class="brand">
                <span class="brand-top">TIENDA</span>
                <span class="brand-bottom">CÓRCEGA</span>
            </div>
        </div>
        <div class="header-right">
            <div class="header-actions">
                <a href="tienda-cuenta.html" title="Mi Cuenta" id="user-link" style="display:flex; align-items:center; text-decoration:none; color: var(--panel-oscuro);">
                    <span id="header-user-greeting" style="font-family: var(--font-sync); font-size: 9px; margin-right: 10px; color: var(--panel-oscuro); display: none;"></span>
                    <i class="fas fa-user-circle" style="font-size: 24px;"></i>
                </a>
                <div class="cart-icon" id="header-cart-btn" style="position:relative; cursor:pointer; color: var(--panel-oscuro); font-size: 24px;">
                    <i class="fas fa-shopping-bag"></i>
                    <span class="cart-count" id="cart-count">0</span>
                </div>
            </div>
        </div>
    `;

    // Lógica de Auth para el saludo
    onAuthStateChanged(auth, async (user) => {
        const userGreeting = document.getElementById('header-user-greeting');
        if (user) {
            try {
                const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
                let nombre = user.displayName || user.email.split('@')[0];
                if (snap.exists()) {
                    nombre = snap.data().nombre.split(' ')[0];
                }
                if (userGreeting) {
                    userGreeting.innerText = `¡HOLA, ${nombre.toUpperCase()}!`;
                    userGreeting.style.display = 'block';
                }
            } catch (e) {
                console.error("Error en header auth:", e);
            }
        } else {
            if (userGreeting) userGreeting.style.display = 'none';
        }
    });

    // Eventos del Carrito (Abrir el drawer)
    const cartBtn = document.getElementById('header-cart-btn');
    if (cartBtn) {
        cartBtn.onclick = () => {
            // Buscamos si existe una función global de tienda para abrir el carrito
            if (window.tienda?.toggleCart) {
                window.tienda.toggleCart();
            } else if (typeof window.openCart === 'function') {
                window.openCart();
            }
        };
    }
}

// Auto-inicializar si no se importa como modulo específicamente
document.addEventListener('DOMContentLoaded', () => {
    // Si no se inició manualmente, lo hacemos
    if (!window.headerInitialized) {
        initHeader();
        window.headerInitialized = true;
    }
});
