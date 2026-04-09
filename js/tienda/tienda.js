import { db } from '../firebase-config.js';
import { collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let products = [];
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let activeCategory = 'todos';

// --- ELEMENTS ---
const productsGrid = document.getElementById('products-container');
const cartBadge = document.getElementById('cart-badge');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotal = document.getElementById('cart-total');
const categoryChips = document.querySelectorAll('.cat-chip');

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
        productsGrid.innerHTML = `<div style="grid-column: 1/-1; color: var(--texto-muted);">Error al cargar productos. Por favor intenta de nuevo.</div>`;
    }
}

// --- RENDERING ---
function renderProducts() {
    const filtered = activeCategory === 'todos' 
        ? products 
        : products.filter(p => p.categoria === activeCategory);

    if (filtered.length === 0) {
        productsGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; color: var(--texto-muted);">No hay productos en esta categoría por ahora.</div>`;
        return;
    }

    productsGrid.innerHTML = filtered.map((p, index) => `
        <div class="product-card" style="animation-delay: ${index * 0.05}s">
            <div class="product-img-container">
                <img src="${p.imagenUrl || 'https://placehold.co/400x400/fdfcf7/01323f?text=Córcega'}" alt="${p.nombre}">
            </div>
            <div class="product-info">
                <h3 class="product-title">${p.nombre}</h3>
                <p class="product-desc">${p.descripcion || ''}</p>
                <div class="product-footer">
                    <span class="product-price">$${p.precio.toLocaleString('es-AR')}</span>
                    <button class="btn-add-cart" data-id="${p.id}">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    // Re-attach add-to-cart listeners
    document.querySelectorAll('.btn-add-cart').forEach(btn => {
        btn.onclick = () => addToCart(btn.dataset.id);
    });
}

// --- CART LOGIC ---
function addToCart(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({
            id: product.id,
            nombre: product.nombre,
            precio: product.precio,
            imagenUrl: product.imagenUrl,
            qty: 1
        });
    }

    saveCart();
    updateCartUI();
    openCart();
}

function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    saveCart();
    updateCartUI();
}

function updateQty(id, delta) {
    const item = cart.find(i => i.id === id);
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        removeFromCart(id);
    } else {
        saveCart();
        updateCartUI();
    }
}

function saveCart() {
    localStorage.setItem('corcega_cart', JSON.stringify(cart));
}

function updateCartUI() {
    // Total count badge
    const totalQty = cart.reduce((acc, item) => acc + item.qty, 0);
    cartBadge.innerText = totalQty;
    cartBadge.style.display = totalQty > 0 ? 'flex' : 'none';

    // List items
    if (cart.length === 0) {
        cartItemsList.innerHTML = `
            <div class="cart-empty">
                <i class="fas fa-shopping-basket"></i>
                <p>Tu carrito está vacío</p>
                <button class="btn-checkout" style="background: var(--panel-oscuro); margin-top: 20px;" onclick="document.getElementById('btn-close-cart').click()">VER PRODUCTOS</button>
            </div>
        `;
        cartTotal.innerText = `$0`;
    } else {
        cartItemsList.innerHTML = cart.map(item => `
            <div class="cart-item">
                <img src="${item.imagenUrl || 'https://placehold.co/400x400/fdfcf7/01323f?text=Córcega'}" class="cart-item-img">
                <div class="cart-item-info">
                    <div class="cart-item-title">${item.nombre}</div>
                    <div class="cart-item-price">$${(item.precio * item.qty).toLocaleString('es-AR')}</div>
                    <div class="cart-item-controls">
                        <button class="qty-btn" onclick="window.tienda.changeQty('${item.id}', -1)"><i class="fas fa-minus"></i></button>
                        <span>${item.qty}</span>
                        <button class="qty-btn" onclick="window.tienda.changeQty('${item.id}', 1)"><i class="fas fa-plus"></i></button>
                        <button class="qty-btn" style="margin-left:auto; color: #ff5252; border:none" onclick="window.tienda.remove('${item.id}')"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
            </div>
        `).join('');

        const total = cart.reduce((acc, item) => acc + (item.precio * item.qty), 0);
        cartTotal.innerText = `$${total.toLocaleString('es-AR')}`;
    }
}

// --- UI TRIGGERS ---
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

// --- EVENTS ---
function setupEventListeners() {
    document.getElementById('btn-open-cart').onclick = openCart;
    document.getElementById('btn-close-cart').onclick = closeCart;
    cartOverlay.onclick = closeCart;

    categoryChips.forEach(chip => {
        chip.onclick = () => {
            categoryChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeCategory = chip.dataset.cat;
            renderProducts();
        };
    });

    document.getElementById('btn-go-to-checkout').onclick = () => {
        if (cart.length === 0) {
            alert("Tu carrito está vacío.");
            return;
        }
        // Save current checkout state if needed
        window.location.href = "checkout.html";
    };
}

// --- EXPOSE FOR INLINE ONCLICK ---
window.tienda = {
    changeQty: (id, delta) => updateQty(id, delta),
    remove: (id) => removeFromCart(id)
};

// --- RUN ---
init();
