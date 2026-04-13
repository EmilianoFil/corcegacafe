import { db, auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let products = [];
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

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
        let nombre = user.displayName || user.email.split('@')[0];
        if (snap.exists()) {
            nombre = snap.data().nombre.split(' ')[0];
        }
        userGreeting.innerText = `¡HOLA, ${nombre.toUpperCase()}!`;
        userGreeting.style.display = 'block';
    } else {
        userGreeting.style.display = 'none';
    }
});

// --- INITIALIZATION ---
async function init() {
    await fetchProducts();
    renderProducts();
    updateCartUI();
    setupEventListeners();
}

// --- DATA FETCHING ---
async function fetchProducts() {
    try {
        const productsRef = collection(db, "productos");
        const q = query(productsRef, where("activo", "==", true), orderBy("creadoEn", "desc"));
        const snap = await getDocs(q);
        products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error("Error fetching products:", err);
        productsGrid.innerHTML = `<div style="grid-column: 1/-1; color: var(--texto-muted);">Error al cargar productos.</div>`;
    }
}

// --- RENDERING ---
function renderProducts() {
    const filtered = activeCategory === 'todos' 
        ? products 
        : products.filter(p => p.categoria === activeCategory);

    if (filtered.length === 0) {
        productsGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; color: var(--texto-muted);">No hay productos en esta categoría.</div>`;
        return;
    }

    productsGrid.innerHTML = filtered.map((p, index) => {
        let imagenes = [];
        if (p.imagenUrl) imagenes.push(p.imagenUrl);
        if (p.imagenes && Array.isArray(p.imagenes)) {
            imagenes = [...imagenes, ...p.imagenes];
        }
        if (imagenes.length === 0) imagenes.push('https://placehold.co/400x400/fdfcf7/01323f?text=Córcega');
        
        const isAgotado = (p.stock > 0 && p.stock <= 0); // Esto se calcula dinámicamente si quisiéramos ocultarlo
        
        return `
            <div class="product-card" data-id="${p.id}" style="animation-delay: ${index * 0.05}s">
                <div class="product-img-container">
                    <div class="card-carousel" id="carousel-${p.id}">
                        ${imagenes.map((img, i) => `
                            <img src="${img}" class="${i === 0 ? 'active' : ''}" alt="${p.nombre}">
                        `).join('')}
                    </div>
                    ${imagenes.length > 1 ? `
                        <button class="card-nav prev" onclick="event.stopPropagation(); moveGridCarousel('${p.id}', -1)"><i class="fas fa-chevron-left"></i></button>
                        <button class="card-nav next" onclick="event.stopPropagation(); moveGridCarousel('${p.id}', 1)"><i class="fas fa-chevron-right"></i></button>
                    ` : ''}
                </div>
                <div class="product-info" onclick="window.location.href='producto.html?id=${p.id}'">
                    <h3 class="product-title">${p.nombre}</h3>
                    <p class="product-desc">${p.descripcion || ''}</p>
                    <div class="product-footer">
                        <span class="product-price">$${p.precio.toLocaleString('es-AR')}</span>
                        <button class="btn-add-cart" data-id="${p.id}" onclick="event.stopPropagation()">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// --- GLOBAL FUNCTIONS & EVENTS ---
window.moveGridCarousel = function(productId, direction) {
    const carousel = document.getElementById(`carousel-${productId}`);
    if (!carousel) return;
    const items = carousel.querySelectorAll('img');
    if (items.length <= 1) return;

    let activeIndex = Array.from(items).findIndex(img => img.classList.contains('active'));
    items[activeIndex].classList.remove('active');

    activeIndex += direction;
    if (activeIndex >= items.length) activeIndex = 0;
    if (activeIndex < 0) activeIndex = items.length - 1;

    items[activeIndex].classList.add('active');
};

function setupEventListeners() {
    // Delegación para botones de agregar al carrito
    productsGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-add-cart');
        if (btn) {
            const id = btn.dataset.id;
            window.addToCart(id);
        }
    });

    const categoryChips = document.querySelectorAll('.category-chip');
    categoryChips.forEach(chip => {
        chip.addEventListener('click', () => {
            categoryChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeCategory = chip.dataset.category;
            renderProducts();
        });
    });

    document.getElementById('cart-btn-header')?.addEventListener('click', openCart);
    document.getElementById('btn-open-cart')?.addEventListener('click', openCart);
    document.getElementById('btn-close-cart')?.addEventListener('click', closeCart);
    cartOverlay?.addEventListener('click', closeCart);
    document.getElementById('btn-go-to-checkout')?.addEventListener('click', () => {
        window.location.href = 'checkout.html';
    });
}

// --- CART CORE ---
function openCart() {
    cartDrawer.classList.add('active');
    cartOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    cartDrawer.classList.remove('active');
    cartOverlay.classList.remove('active');
    document.body.style.overflow = 'auto';
}

window.addToCart = function(id, autoOpen = true, requestedQty = 1) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    if (product.stock > 0) {
        const inCart = (cart.find(item => item.id === id)?.qty || 0);
        if (inCart + requestedQty > product.stock) {
            alert(`¡Lo sentimos! Solo quedan ${product.stock} unidades de este producto.`);
            return;
        }
    }

    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.qty += requestedQty;
    } else {
        cart.push({
            id: product.id,
            nombre: product.nombre,
            precio: product.precio,
            imagenUrl: product.imagenUrl,
            qty: requestedQty,
            stock: product.stock
        });
    }

    saveCart();
    updateCartUI();
    if (autoOpen) openCart();
};

window.updateQty = function(index, delta) {
    const item = cart[index];
    if (delta > 0 && item.stock > 0 && item.qty >= item.stock) {
        alert(`¡Lo sentimos! Solo quedan ${item.stock} unidades de este producto.`);
        return;
    }

    item.qty += delta;
    if (item.qty < 1) {
        cart.splice(index, 1);
    }
    saveCart();
    updateCartUI();
};

window.removeItem = function(index) {
    cart.splice(index, 1);
    saveCart();
    updateCartUI();
};

function saveCart() {
    localStorage.setItem('corcega_cart', JSON.stringify(cart));
}

function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const badges = document.querySelectorAll('.cart-count, .cart-count-badge');
    badges.forEach(b => {
        b.innerText = totalItems;
        b.style.display = totalItems > 0 ? 'flex' : 'none';
        if (totalItems > 0) b.style.setProperty('display', 'flex', 'important');
    });

    if (cart.length === 0) {
        cartItemsList.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Tu carrito está vacío</p></div>`;
        cartTotal.innerText = "$0.00";
        return;
    }

    cartItemsList.innerHTML = cart.map((item, index) => `
        <div class="cart-item">
            <img src="${item.imagenUrl || 'https://placehold.co/100x100'}" alt="${item.nombre}">
            <div class="cart-item-info">
                <h4>${item.nombre}</h4>
                <p>$${item.precio.toLocaleString('es-AR')}</p>
                <div class="cart-item-qty">
                    <button onclick="updateQty(${index}, -1)"><i class="fas fa-minus"></i></button>
                    <span>${item.qty}</span>
                    <button onclick="updateQty(${index}, 1)"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <button class="btn-remove-item" onclick="removeItem(${index})"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');

    const total = cart.reduce((sum, item) => sum + (item.precio * item.qty), 0);
    cartTotal.innerText = `$${total.toLocaleString('es-AR')}`;
}

init();
