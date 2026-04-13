import { db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let currentProduct = null;
let currentQty = 1;
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];

// --- ELEMENTS ---
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotal = document.getElementById('cart-total');
// Selector más agresivo para las burbujas
const getCartBadges = () => document.querySelectorAll('.cart-count, .cart-count-badge, #cart-badge');

// --- INIT ---
async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        window.location.href = 'tienda.html';
        return;
    }

    setupCartEvents();
    await loadProductData(productId);
    updateCartUI();
}

// Load from Firestore
async function loadProductData(id) {
    try {
        const docRef = doc(db, "productos", id);
        const snap = await getDoc(docRef);

        if (!snap.exists()) {
            window.location.href = 'tienda.html';
            return;
        }

        currentProduct = { id: snap.id, ...snap.data() };
        renderProductDetail();
    } catch (err) {
        console.error("Error loading product:", err);
    }
}

// Render UI Detail
function renderProductDetail() {
    const p = currentProduct;
    
    // Breadcrumbs
    document.getElementById('breadcrumb-category').innerText = p.categoria || 'Tienda';
    document.getElementById('breadcrumb-name').innerText = p.nombre;
    
    // Titulo y Precio
    const isAgotado = p.controlarStock && p.stock <= 0;
    document.getElementById('prod-title').innerText = p.nombre + (isAgotado ? ' (Agotado)' : '');
    document.getElementById('prod-price').innerText = `$${p.precio.toLocaleString('es-AR')}`;
    document.getElementById('prod-desc').innerHTML = p.descripcion_larga || p.descripcion || 'Sin descripción detallada por ahora.';

    if (isAgotado) {
        const btn = document.getElementById('btn-add-to-cart-page');
        btn.innerText = "SIN STOCK";
        btn.disabled = true;
        btn.style.background = "#ccc";
        btn.style.cursor = "not-allowed";
        document.querySelector('.quantity-control').style.opacity = "0.5";
        document.querySelector('.quantity-control').style.pointerEvents = "none";
    }

    // Imágenes
    let imagenes = [];
    if (p.imagenUrl) imagenes.push(p.imagenUrl);
    if (p.imagenes && Array.isArray(p.imagenes)) {
        imagenes = [...imagenes, ...p.imagenes];
    }
    if (imagenes.length === 0) imagenes.push('https://placehold.co/400x400/fdfcf7/01323f?text=Córcega');

    const mainImg = document.getElementById('main-prod-img');
    mainImg.src = imagenes[0];

    const thumbsContainer = document.getElementById('gallery-thumbs-list');
    thumbsContainer.innerHTML = imagenes.map((img, i) => `
        <img src="${img}" class="thumb ${i === 0 ? 'active' : ''}" onclick="changeMainImage('${img}', this)">
    `).join('');

    // Toggle Visibility
    document.getElementById('main-product-loader').style.display = 'none';
    document.getElementById('product-content').style.display = 'grid';

    // Button Logic
    document.getElementById('btn-add-to-cart-page').onclick = () => addToCartFromPage();
}

// Interactivity
window.changeMainImage = function(url, thumbEl) {
    const mainImg = document.getElementById('main-prod-img');
    mainImg.style.opacity = '0';
    setTimeout(() => {
        mainImg.src = url;
        mainImg.style.opacity = '1';
    }, 200);

    document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
    thumbEl.classList.add('active');
};

window.changeQty = function(delta) {
    currentQty = Math.max(1, currentQty + delta);
    document.getElementById('prod-qty').innerText = currentQty;
};

// --- CART CORE LOGIC ---
function setupCartEvents() {
    document.getElementById('btn-open-cart').onclick = openCart;
    document.getElementById('cart-btn-header').onclick = openCart;
    document.getElementById('btn-close-cart').onclick = closeCart;
    cartOverlay.onclick = closeCart;
    document.getElementById('btn-go-to-checkout').onclick = () => window.location.href = 'checkout.html';
}

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

function updateCartUI() {
    // Badges count
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const badges = getCartBadges();
    badges.forEach(b => {
        b.innerText = totalItems;
        b.style.display = totalItems > 0 ? 'flex' : 'none';
        // Forzar visibilidad
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

window.updateQty = function(index, delta) {
    cart[index].qty += delta;
    if (cart[index].qty < 1) {
        cart.splice(index, 1);
    }
    saveAndRefresh();
};

window.removeItem = function(index) {
    cart.splice(index, 1);
    saveAndRefresh();
};

function saveAndRefresh() {
    localStorage.setItem('corcega_cart', JSON.stringify(cart));
    updateCartUI();
}

function addToCartFromPage() {
    if (!currentProduct) return;

    // VALIDACIÓN DE STOCK: Solo si es > 0 (0 es ilimitado)
    if (currentProduct.stock > 0) {
        const inCart = (cart.find(item => item.id === currentProduct.id)?.qty || 0);
        if (inCart + currentQty > currentProduct.stock) {
            alert(`¡Lo sentimos! Solo quedan ${currentProduct.stock} unidades de este producto.`);
            return;
        }
    }

    const existing = cart.find(item => item.id === currentProduct.id);
    if (existing) {
        existing.qty += currentQty;
    } else {
        cart.push({
            id: currentProduct.id,
            nombre: currentProduct.nombre,
            precio: currentProduct.precio,
            imagenUrl: currentProduct.imagenUrl,
            qty: currentQty
        });
    }

    saveAndRefresh();
    openCart();
}

init();
