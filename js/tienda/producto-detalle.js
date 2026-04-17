import { db, auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let currentProduct = null;
let currentQty = 1;
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let selectedVariants = {};

// --- ELEMENTS ---
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotal = document.getElementById('cart-total');
const getCartBadges = () => document.querySelectorAll('.cart-count, .cart-count-badge, #cart-badge');

// --- ACTIONS ---
window.tienda = {
    toggleCart: () => {
        if (!cartDrawer) return;
        cartDrawer.classList.toggle('active');
        cartOverlay.classList.toggle('active');
        document.body.style.overflow = cartDrawer.classList.contains('active') ? 'hidden' : 'auto';
    }
};

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
    
    // Breadcrumbs y Tags
    const categoria = p.categoria || 'Tienda';
    document.getElementById('breadcrumb-category').innerText = categoria;
    document.getElementById('prod-cat-tag').innerText = categoria.toUpperCase();
    document.getElementById('breadcrumb-name').innerText = p.nombre;
    
    // Titulo y Precio
    const isAgotado = (p.stock > 0 && p.stock <= 0);
    document.getElementById('prod-title').innerText = p.nombre + (isAgotado ? ' (Agotado)' : '');
    document.getElementById('prod-price').innerText = `$${p.precio.toLocaleString('es-AR')}`;
    document.getElementById('prod-desc').innerHTML = p.descripcion_larga || p.descripcion || 'Sin descripción detallada por ahora.';

    if (isAgotado) {
        const btn = document.getElementById('btn-add-to-cart-page');
        if (btn) {
            btn.innerText = "SIN STOCK";
            btn.disabled = true;
            btn.style.background = "#ccc";
            btn.style.cursor = "not-allowed";
        }
        const qtyCtrl = document.querySelector('.quantity-control');
        if (qtyCtrl) {
            qtyCtrl.style.opacity = "0.5";
            qtyCtrl.style.pointerEvents = "none";
        }
    }

    // Imágenes
    let imagenes = [];
    if (p.imagenUrl) imagenes.push(p.imagenUrl);
    if (p.imagenes && Array.isArray(p.imagenes)) {
        imagenes = [...imagenes, ...p.imagenes];
    }
    if (imagenes.length === 0) imagenes.push('https://placehold.co/400x400/fdfcf7/01323f?text=Córcega');

    const mainImg = document.getElementById('main-prod-img');
    mainImg.style.opacity = '0';
    mainImg.style.transition = 'opacity 0.4s ease';
    mainImg.onload = () => {
        mainImg.style.opacity = '1';
        document.getElementById('main-prod-img').closest('.image-aspect')?.classList.add('img-loaded');
    };
    mainImg.src = imagenes[0];
    // Cached image
    if (mainImg.complete && mainImg.naturalHeight !== 0) {
        mainImg.style.opacity = '1';
    }

    const thumbsContainer = document.getElementById('gallery-thumbs-list');
    thumbsContainer.innerHTML = imagenes.map((img, i) => `
        <img src="${img}" class="thumb ${i === 0 ? 'active' : ''}" onclick="changeMainImage('${img}', this)">
    `).join('');

    // Toggle Visibility
    document.getElementById('main-product-loader').style.display = 'none';
    document.getElementById('product-content').style.display = 'grid';

    // Button Logic
    document.getElementById('btn-add-to-cart-page').onclick = () => addToCartFromPage();

    // Stock info para productos sin variantes
    if (!p.tieneVariantes) {
        const stockInfo = document.getElementById('prod-stock-info');
        if (stockInfo && !p.stockIlimitado) {
            const stock = p.stock || 0;
            showStockInfo(stockInfo, stock, p.avisoStock);
        }
    }

    // Variantes
    renderVariantSelectors();
}

// Interactivity
window.changeMainImage = function(url, thumbEl) {
    const mainImg = document.getElementById('main-prod-img');
    mainImg.style.opacity = '0';

    // Wait for fade-out (transition 0.4s), then swap src and only
    // restore opacity once the new image is actually loaded — no blink
    setTimeout(() => {
        mainImg.onload = null;
        mainImg.onload = () => {
            mainImg.style.opacity = '1';
            mainImg.onload = null;
        };
        mainImg.src = url;
        // If already in browser cache onload may not fire; handle that case
        if (mainImg.complete && mainImg.naturalWidth > 0) {
            mainImg.style.opacity = '1';
        }
    }, 420);

    if (thumbEl) {
        document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
        thumbEl.classList.add('active');
    }
};

window.changeQty = function(delta) {
    currentQty = Math.max(1, currentQty + delta);
    document.getElementById('prod-qty').innerText = currentQty;
};

// --- CART CORE LOGIC ---
function setupCartEvents() {
    document.getElementById('btn-open-cart')?.addEventListener('click', openCart);
    document.getElementById('cart-btn-header')?.addEventListener('click', openCart);
    document.getElementById('btn-close-cart')?.addEventListener('click', closeCart);
    cartOverlay?.addEventListener('click', closeCart);
    document.getElementById('btn-go-to-checkout')?.addEventListener('click', () => {
        window.location.href = 'checkout.html';
    });
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
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const badges = getCartBadges();
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
            <img src="${item.imagenUrl || 'https://placehold.co/100x100'}" alt="${item.nombre}" class="cart-item-img">
            <div class="cart-item-info">
                <div class="cart-item-title">${item.nombre}</div>
                ${item.variantLabel ? `<div style="font-size:0.72rem; color:var(--naranja-accent); font-weight:600; margin:2px 0;">${item.variantLabel}</div>` : ''}
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

window.updateQty = function (index, delta) {
    const item = cart[index];
    if (delta > 0 && item.stock > 0 && item.qty >= item.stock) {
        alert(`¡Lo sentimos! Solo quedan ${item.stock} unidades de este producto.`);
        return;
    }

    item.qty += delta;
    if (item.qty < 1) {
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

function showStockInfo(el, stock, avisoStock) {
    el.style.display = 'block';
    if (stock === 0) {
        el.innerText = 'Sin stock disponible';
        el.style.background = '#fff0f0';
        el.style.color = '#e74c3c';
    } else if (avisoStock && stock <= avisoStock) {
        el.innerHTML = `⚡ ¡Solo quedan <strong>${stock}</strong>, no te quedes sin el tuyo!`;
        el.style.background = '#fff8e1';
        el.style.color = '#e65100';
    } else {
        el.innerText = `${stock} disponibles`;
        el.style.background = '#f0fdf4';
        el.style.color = '#16a34a';
    }
}

function renderVariantSelectors() {
    const p = currentProduct;
    const section = document.getElementById('prod-variantes-section');
    const list = document.getElementById('prod-variantes-list');
    if (!section || !list) return;

    if (!p.tieneVariantes || !p.atributosVariantes?.length) {
        section.style.display = 'none';
        return;
    }

    selectedVariants = {};
    section.style.display = 'block';

    list.innerHTML = p.atributosVariantes.map((attr, attrIdx) => `
        <div>
            <p style="font-weight:700; font-size:0.8rem; margin:0 0 8px; color:var(--panel-oscuro); text-transform:uppercase; letter-spacing:0.5px;">${attr.nombre}</p>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${attr.opciones.map(op => {
                    const hasStock = Object.entries(p.variantes || {}).some(([key, v]) => {
                        const parts = key.split('|');
                        return parts[attrIdx] === op && (v.stock || 0) > 0;
                    });
                    return hasStock
                        ? `<button type="button"
                                data-attr="${attr.nombre}" data-val="${op}"
                                onclick="selectVariantOption('${attr.nombre}', '${op}', this)"
                                style="padding:8px 18px; border:2px solid #eee; border-radius:10px; background:white; cursor:pointer; font-size:0.85rem; font-weight:600; transition:all 0.15s; color:var(--panel-oscuro);">
                                ${op}
                           </button>`
                        : `<button type="button" disabled
                                style="padding:8px 18px; border:2px solid #f0f0f0; border-radius:10px; background:#fafafa; cursor:not-allowed; font-size:0.85rem; font-weight:600; color:#ccc; text-decoration:line-through;">
                                ${op}
                           </button>`;
                }).join('')}
            </div>
        </div>
    `).join('');
}

window.selectVariantOption = function(attrName, value, btn) {
    selectedVariants[attrName] = value;

    document.querySelectorAll(`[data-attr="${attrName}"]`).forEach(b => {
        b.style.borderColor = '#eee';
        b.style.background = 'white';
        b.style.color = 'var(--panel-oscuro)';
    });
    btn.style.borderColor = 'var(--naranja-accent)';
    btn.style.background = 'rgba(237,112,83,0.08)';
    btn.style.color = 'var(--naranja-accent)';

    // Update price & stock if all selected
    const p = currentProduct;
    const allSelected = p.atributosVariantes.every(a => selectedVariants[a.nombre]);
    if (allSelected) {
        const key = p.atributosVariantes.map(a => selectedVariants[a.nombre]).join('|');
        const varData = p.variantes?.[key];
        const precio = varData?.precio ?? p.precio;
        const stock = varData?.stock ?? 0;

        document.getElementById('prod-price').innerText = `$${precio.toLocaleString('es-AR')}`;

        // Swap main image if this variant has its own photo
        if (varData?.imagenUrl) {
            changeMainImage(varData.imagenUrl, null);
            // Also mark the matching thumb as active if it exists
            document.querySelectorAll('.thumb').forEach(t => {
                t.classList.toggle('active', t.src === varData.imagenUrl || t.src.endsWith(varData.imagenUrl));
            });
        }

        const btn2 = document.getElementById('btn-add-to-cart-page');
        if (stock === 0) {
            btn2.innerText = 'SIN STOCK EN ESTA VARIANTE';
            btn2.disabled = true;
            btn2.style.background = '#ccc';
        } else {
            btn2.innerHTML = '<i class="fas fa-shopping-cart"></i> AGREGAR AL CARRITO';
            btn2.disabled = false;
            btn2.style.background = '';
        }
        currentQty = 1;
        document.getElementById('prod-qty').innerText = '1';

        // Stock info con aviso
        const stockInfo = document.getElementById('prod-stock-info');
        if (stockInfo) showStockInfo(stockInfo, stock, p.avisoStock);
    }
};

function addToCartFromPage() {
    if (!currentProduct) return;
    const p = currentProduct;

    if (p.tieneVariantes && p.atributosVariantes?.length) {
        const allSelected = p.atributosVariantes.every(a => selectedVariants[a.nombre]);
        if (!allSelected) {
            alert('Por favor seleccioná todas las opciones antes de agregar.');
            return;
        }
        const key = p.atributosVariantes.map(a => selectedVariants[a.nombre]).join('|');
        const varData = p.variantes?.[key];
        const precio = varData?.precio ?? p.precio;
        const stock = varData?.stock ?? 0;
        const label = p.atributosVariantes.map(a => `${a.nombre}: ${selectedVariants[a.nombre]}`).join(' / ');

        if (stock === 0) { alert('Sin stock en esta variante.'); return; }

        const cartKey = `${p.id}__${key}`;
        const existing = cart.find(item => item._cartKey === cartKey);
        if (existing) {
            if (existing.qty + currentQty > stock) {
                alert(`Solo quedan ${stock} unidades de esta variante.`);
                return;
            }
            existing.qty += currentQty;
        } else {
            cart.push({
                _cartKey: cartKey,
                id: p.id,
                nombre: p.nombre,
                precio: precio,
                imagenUrl: p.imagenUrl,
                qty: currentQty,
                stock: stock,
                stockIlimitado: false,
                variantKey: key,
                variantLabel: label
            });
        }

        saveAndRefresh();
        openCart();
        return;
    }

    // No variants - original logic
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
            qty: currentQty,
            stock: currentProduct.stock
        });
    }

    saveAndRefresh();
    openCart();
}

init();
