import { db, auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let products = [];
let categories = [];
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let activeCategory = 'todos';

// --- ELEMENTS ---
const productsGrid = document.getElementById('products-container');
const userGreeting = document.getElementById('user-greeting');
const cartBadge = document.getElementById('cart-badge');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotal = document.getElementById('cart-total');
const catsNav = document.getElementById('categories-nav');

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
        let nombre = user.displayName || user.email.split('@')[0];
        if (snap.exists()) {
            nombre = snap.data().nombre.split(' ')[0];
        }
        if (userGreeting) {
            userGreeting.innerText = `¡HOLA, ${nombre.toUpperCase()}!`;
            userGreeting.style.display = 'block';
        }
    } else {
        if (userGreeting) userGreeting.style.display = 'none';
    }
});

// --- INITIALIZATION ---
async function init() {
    await Promise.all([
        fetchCategories(),
        fetchProducts()
    ]);
    renderCategories();
    renderProducts();
    updateCartUI();
    setupCartEvents();
}

// --- DATA FETCHING ---
async function fetchCategories() {
    try {
        const snap = await getDocs(query(collection(db, "categorias"), orderBy("nombre", "asc")));
        categories = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error("Error fetching categories:", err);
        categories = [];
    }
}

async function fetchProducts() {
    try {
        const productsRef = collection(db, "productos");
        const q = query(productsRef, where("activo", "==", true), orderBy("creadoEn", "desc"));
        const snap = await getDocs(q);
        products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error("Error fetching products:", err);
        if (productsGrid) productsGrid.innerHTML = `<div style="grid-column: 1/-1; color: var(--texto-muted);">Error al cargar productos.</div>`;
    }
}

// --- RENDERING ---
function renderCategories() {
    if (!catsNav) return;
    
    let html = `<div class="category-chip ${activeCategory === 'todos' ? 'active' : ''}" data-cat="todos">Todos</div>`;
    
    html += categories.map(c => `
        <div class="category-chip ${activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${c.nombre}</div>
    `).join('');
    
    catsNav.innerHTML = html;

    // Eventos para los chips
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            activeCategory = chip.dataset.cat;
            document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderProducts();
        });
    });
}

function renderProducts() {
    if (!productsGrid) return;

    const filtered = activeCategory === 'todos' 
        ? products 
        : products.filter(p => p.categoria === activeCategory);

    if (filtered.length === 0) {
        productsGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; color: var(--texto-muted); text-align:center;">No hay productos en esta categoría.</div>`;
        return;
    }

    productsGrid.innerHTML = filtered.map((p, index) => {
        let imagenes = [];
        if (p.imagenUrl) imagenes.push(p.imagenUrl);
        if (p.imagenes && Array.isArray(p.imagenes)) {
            imagenes = [...imagenes, ...p.imagenes];
        }
        if (imagenes.length === 0) imagenes.push('https://placehold.co/400x400/fdfcf7/01323f?text=Córcega');
        
        return `
            <div class="product-card" data-id="${p.id}" style="animation-delay: ${index * 0.05}s">
                <div class="product-img-container" onclick="window.location.href='producto.html?id=${p.id}'">
                    <div class="card-carousel" id="carousel-${p.id}">
                        ${imagenes.map((img, i) => `
                            <img src="${img}" class="${i === 0 ? 'active' : ''}" alt="${p.nombre}">
                        `).join('')}
                    </div>
                </div>
                <div class="product-info" onclick="window.location.href='producto.html?id=${p.id}'">
                    <h3 class="product-title">${p.nombre}</h3>
                    <p class="product-desc">${p.descripcion || ''}</p>
                    <div class="product-footer">
                        <span class="product-price">$${p.precio.toLocaleString('es-AR')}</span>
                        <button class="btn-add-cart" onclick="event.stopPropagation(); window.addToCart('${p.id}')">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// --- CART INTERACTIVITY ---
window.addToCart = function(id) {
    const p = products.find(item => item.id === id);
    if (!p) return;

    // Validación de Stock
    if (p.stock > 0) {
        const inCart = (cart.find(item => item.id === id)?.qty || 0);
        if (inCart >= p.stock) {
            alert(`¡Lo sentimos! Solo quedan ${p.stock} unidades de este producto.`);
            return;
        }
    }

    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ ...p, qty: 1 });
    }

    saveAndRefresh();
    openCart();
};

function saveAndRefresh() {
    localStorage.setItem('corcega_cart', JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const badges = document.querySelectorAll('.cart-count, .cart-count-badge, #cart-badge');
    badges.forEach(b => {
        b.innerText = totalItems;
        b.style.display = totalItems > 0 ? 'flex' : 'none';
        if (totalItems > 0) {
            b.style.setProperty('display', 'flex', 'important');
        }
    });

    if (!cartItemsList) return;

    if (cart.length === 0) {
        cartItemsList.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Tu carrito está vacío</p></div>`;
        cartTotal.innerText = "$0.00";
        return;
    }

    cartItemsList.innerHTML = cart.map((item, index) => `
        <div class="cart-item">
            <img src="${item.imagenUrl || 'https://placehold.co/100x100'}" alt="${item.nombre}" class="cart-item-img">
            <div class="cart-item-info">
                <div class="cart-item-title">${item.nombre}</div>
                <div class="cart-item-price">$${item.precio.toLocaleString('es-AR')}</div>
                <div class="cart-item-controls">
                    <button class="qty-btn" onclick="updateQty(${index}, -1)"><i class="fas fa-minus"></i></button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${index}, 1)"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <button class="btn-remove-item" onclick="removeItem(${index})" style="background:none; border:none; color:#ff4d4d; cursor:pointer;"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');

    const total = cart.reduce((sum, item) => sum + (item.precio * item.qty), 0);
    cartTotal.innerText = `$${total.toLocaleString('es-AR')}`;
}

window.updateQty = function(index, delta) {
    const item = cart[index];
    if (delta > 0 && item.stock > 0 && item.qty >= item.stock) {
        alert(`¡Lo sentimos! Solo quedan ${item.stock} unidades de este producto.`);
        return;
    }
    item.qty += delta;
    if (item.qty < 1) cart.splice(index, 1);
    saveAndRefresh();
};

window.removeItem = function(index) {
    cart.splice(index, 1);
    saveAndRefresh();
};

function setupCartEvents() {
    document.getElementById('cart-btn-header')?.addEventListener('click', openCart);
    document.getElementById('btn-open-cart')?.addEventListener('click', openCart);
    document.getElementById('btn-close-cart')?.addEventListener('click', closeCart);
    cartOverlay?.addEventListener('click', closeCart);
    document.getElementById('btn-go-to-checkout')?.addEventListener('click', () => {
        const checkoutModal = document.getElementById('checkout-modal');
        if (checkoutModal) {
            checkoutModal.style.display = 'flex';
        } else {
            window.location.href = 'checkout.html';
        }
    });

    // Modal Events
    document.getElementById('modal-btn-login')?.addEventListener('click', () => {
        window.location.href = 'login.html?redirect=checkout.html';
    });
    document.getElementById('modal-btn-register')?.addEventListener('click', () => {
        window.location.href = 'registro.html?redirect=checkout.html';
    });
    document.getElementById('modal-btn-guest')?.addEventListener('click', () => {
        window.location.href = 'checkout.html';
    });
}

function openCart() {
    cartDrawer?.classList.add('active');
    cartOverlay?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    cartDrawer?.classList.remove('active');
    cartOverlay?.classList.remove('active');
    document.body.style.overflow = 'auto';
}

// Carousel Nav in Grid
window.moveGridCarousel = function(id, delta) {
    const container = document.getElementById(`carousel-${id}`);
    if (!container) return;
    const imgs = container.querySelectorAll('img');
    let activeIdx = Array.from(imgs).findIndex(img => img.classList.contains('active'));
    
    imgs[activeIdx].classList.remove('active');
    activeIdx = (activeIdx + delta + imgs.length) % imgs.length;
    imgs[activeIdx].classList.add('active');
};

init();
