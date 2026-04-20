/**
 * Componente Header para Tienda Córcega — v1.3
 * Mobile: hamburguesa a la IZQUIERDA, logo+brand al CENTRO, carrito a la DERECHA.
 * Menú desliza desde la IZQUIERDA.
 * "Productos" expandible: carga categorías desde Firestore.
 *   - En tienda.html: filtra in-page vía window.tienda.setCategory
 *   - En otras páginas: navega a tienda.html?cat=ID
 */
import { auth, db } from '../firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function initHeader() {
    const headerElement = document.querySelector('header');
    if (!headerElement) return;

    const customTitle = headerElement.getAttribute('data-title') || 'TIENDA<br>CÓRCEGA';
    const titleLines = customTitle.includes('<br>') ? customTitle.split('<br>') : [customTitle, ''];

    // ── Estructura del header ──────────────────────────────────────────
    headerElement.innerHTML = `
        <div class="header-left">
            <!-- Desktop: logo -->
            <a href="tienda.html" id="header-logo-link">
                <img src="css/img/Corcega_Logo_Original.png" alt="Logo" class="mini-logo logo-tienda">
            </a>
            <!-- Mobile: hamburguesa -->
            <button class="header-hamburger" id="header-hamburger" aria-label="Menú" aria-expanded="false">
                <span></span><span></span><span></span>
            </button>
        </div>
        <div class="header-center">
            <div class="header-center-inner">
                <!-- Mobile: logo aparece junto al brand -->
                <a href="tienda.html" class="center-logo-wrap" id="header-center-logo" aria-label="Inicio">
                    <img src="css/img/Corcega_Logo_Original.png" alt="Logo" class="mini-logo">
                </a>
                <div class="brand">
                    <span class="brand-top">${titleLines[0]}</span>
                    <span class="brand-bottom">${titleLines[1]}</span>
                </div>
            </div>
        </div>
        <div class="header-right">
            <div class="header-actions">
                <!-- Ícono usuario — visible en desktop, en mobile vive en el menú -->
                <a href="tienda-cuenta.html" title="Mi Cuenta" id="user-link" style="display:flex; align-items:center; text-decoration:none; color: var(--panel-oscuro);">
                    <span id="header-user-greeting" style="font-family: var(--font-sync); font-size: 9px; margin-right: 10px; color: var(--panel-oscuro); display: none;"></span>
                    <i class="fas fa-user-circle" style="font-size: 24px;"></i>
                </a>
                <!-- Carrito — siempre visible -->
                <div class="cart-icon" id="header-cart-btn" style="position:relative; cursor:pointer; color: var(--panel-oscuro); font-size: 24px;">
                    <i class="fas fa-shopping-bag"></i>
                    <span class="cart-count" id="cart-count">0</span>
                </div>
            </div>
        </div>
    `;

    // ── Menú mobile ────────────────────────────────────────────────────
    if (!document.getElementById('mobile-menu')) {
        const menuHTML = `
            <div class="mobile-menu-overlay" id="mobile-menu-overlay"></div>
            <div class="mobile-menu" id="mobile-menu" role="dialog" aria-label="Menú de navegación">
                <div class="mobile-menu-header">
                    <span class="brand-menu">MENÚ</span>
                    <button class="mobile-menu-close" id="mobile-menu-close" aria-label="Cerrar menú">✕</button>
                </div>

                <!-- Usuario -->
                <div class="mobile-menu-user" id="mobile-menu-user-section">
                    <div class="mobile-menu-user-greeting" id="mobile-menu-greeting" style="display:none;"></div>
                    <div class="mobile-menu-user-sub" id="mobile-menu-user-sub">Tu cuenta</div>
                </div>

                <!-- Navegación -->
                <nav class="mobile-menu-nav">
                    <!-- Productos expandible — empieza ABIERTO -->
                    <button class="mobile-menu-item mobile-menu-expand-btn" id="mobile-products-toggle" type="button">
                        <i class="fas fa-th-large"></i>
                        <span>Productos</span>
                        <i class="fas fa-chevron-down mobile-chevron open" id="mobile-products-chevron"></i>
                    </button>
                    <div class="mobile-menu-submenu open" id="mobile-categories-list">
                        <div class="mobile-menu-subitem" style="color:#aaa; font-style:italic; cursor:default;">Cargando...</div>
                    </div>

                    <div class="mobile-menu-divider"></div>

                    <a href="tienda-cuenta.html" class="mobile-menu-item" id="mobile-mi-cuenta">
                        <i class="fas fa-user-circle"></i> Mi Cuenta
                    </a>

                    <div class="mobile-menu-divider"></div>

                    <a href="#" class="mobile-menu-item danger" id="mobile-logout-btn" style="display:none;">
                        <i class="fas fa-sign-out-alt"></i> Cerrar sesión
                    </a>
                </nav>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', menuHTML);
    }

    // ── Auth ───────────────────────────────────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        const userGreeting    = document.getElementById('header-user-greeting');
        const mobileGreeting  = document.getElementById('mobile-menu-greeting');
        const mobileUserSub   = document.getElementById('mobile-menu-user-sub');
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

        if (user) {
            try {
                const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
                let nombre = user.displayName || user.email.split('@')[0];
                if (snap.exists()) nombre = snap.data().nombre.split(' ')[0];
                const nombreUpper = nombre.toUpperCase();

                if (userGreeting) { userGreeting.innerText = `¡HOLA, ${nombreUpper}!`; userGreeting.style.display = 'block'; }
                if (mobileGreeting) { mobileGreeting.innerText = `¡HOLA, ${nombreUpper}!`; mobileGreeting.style.display = 'block'; }
                if (mobileUserSub) mobileUserSub.innerText = user.email;
                if (mobileLogoutBtn) mobileLogoutBtn.style.display = 'flex';
            } catch (e) {
                console.error("Error en header auth:", e);
            }
        } else {
            if (userGreeting)    userGreeting.style.display = 'none';
            if (mobileGreeting)  mobileGreeting.style.display = 'none';
            if (mobileUserSub)   mobileUserSub.innerText = 'Tu cuenta';
            if (mobileLogoutBtn) mobileLogoutBtn.style.display = 'none';
        }
    });

    // ── Carrito ────────────────────────────────────────────────────────
    const cartBtn = document.getElementById('header-cart-btn');
    if (cartBtn) {
        cartBtn.onclick = () => {
            if (window.tienda?.toggleCart) window.tienda.toggleCart();
            else if (typeof window.openCart === 'function') window.openCart();
        };
    }

    // ── Abrir / cerrar menú ────────────────────────────────────────────
    const hamburger  = document.getElementById('header-hamburger');
    const overlay    = document.getElementById('mobile-menu-overlay');
    const mobileMenu = document.getElementById('mobile-menu');
    const closeBtn   = document.getElementById('mobile-menu-close');

    function openMenu() {
        mobileMenu?.classList.add('open');
        overlay?.classList.add('open');
        hamburger?.classList.add('open');
        hamburger?.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
        mobileMenu?.classList.remove('open');
        overlay?.classList.remove('open');
        hamburger?.classList.remove('open');
        hamburger?.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }

    hamburger?.addEventListener('click', () => {
        mobileMenu?.classList.contains('open') ? closeMenu() : openMenu();
    });
    overlay?.addEventListener('click', closeMenu);
    closeBtn?.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    // ── "Productos" toggle ─────────────────────────────────────────────
    const productsToggle = document.getElementById('mobile-products-toggle');
    const categoriesList = document.getElementById('mobile-categories-list');
    const productChevron = document.getElementById('mobile-products-chevron');

    productsToggle?.addEventListener('click', () => {
        const isOpen = categoriesList?.classList.contains('open');
        categoriesList?.classList.toggle('open', !isOpen);
        productChevron?.classList.toggle('open', !isOpen);
    });

    // ── Categorías desde Firestore ─────────────────────────────────────
    _loadCategories(closeMenu);

    // Cerrar menú al hacer tap en links de nav
    mobileMenu?.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', closeMenu);
    });

    // Logout
    document.getElementById('mobile-logout-btn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        closeMenu();
        await signOut(auth);
        window.location.href = 'tienda.html';
    });
}

// ── Carga categorías y llena el submenú ───────────────────────────────
async function _loadCategories(closeMenu) {
    const list = document.getElementById('mobile-categories-list');
    if (!list) return;

    try {
        const snap = await getDocs(query(collection(db, "categorias"), orderBy("nombre", "asc")));
        const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Determinar si estamos en tienda.html
        const onTienda = !!window.tienda?.setCategory;

        const allCats = [{ id: 'todos', nombre: 'Todos los productos' }, ...cats];

        list.innerHTML = allCats.map(cat => `
            <button class="mobile-menu-subitem" data-cat="${cat.id}" type="button">${cat.nombre}</button>
        `).join('');

        list.querySelectorAll('.mobile-menu-subitem').forEach(btn => {
            btn.addEventListener('click', () => {
                const catId = btn.dataset.cat;

                list.querySelectorAll('.mobile-menu-subitem').forEach(b => b.classList.remove('active-cat'));
                btn.classList.add('active-cat');

                if (window.tienda?.setCategory) {
                    // Estamos en tienda.html — filtrar in-page
                    window.tienda.setCategory(catId);
                    closeMenu();
                } else {
                    // Otra página — navegar a tienda.html con el filtro
                    const url = catId === 'todos' ? 'tienda.html' : `tienda.html?cat=${catId}`;
                    window.location.href = url;
                }
            });
        });
    } catch (err) {
        console.warn("Header: no se pudieron cargar categorías.", err);
        if (list) list.innerHTML = `<a class="mobile-menu-subitem" href="tienda.html">Ver todos los productos</a>`;
    }
}

// ── Auto-inicializar ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (!window.headerInitialized) {
        initHeader();
        window.headerInitialized = true;
    }
});
