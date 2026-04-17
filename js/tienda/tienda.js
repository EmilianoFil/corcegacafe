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
const cartBadge = document.getElementById('cart-badge');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotal = document.getElementById('cart-total');
const catsNav = document.getElementById('categories-nav');

// --- ACTIONS ---
let userIsLogged = false;
onAuthStateChanged(auth, (user) => {
    userIsLogged = !!user;
});

window.tienda = {
    toggleCart: () => {
        if (!cartDrawer) return;
        cartDrawer.classList.toggle('active');
        cartOverlay.classList.toggle('active');
        document.body.style.overflow = cartDrawer.classList.contains('active') ? 'hidden' : 'auto';
    }
};

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
        
        let isAgotado;
        if (p.tieneVariantes) {
            // Para variantes: agotado solo si TODAS las combinaciones tienen stock 0
            const stocks = Object.values(p.variantes || {});
            isAgotado = stocks.length > 0 && stocks.every(v => (v.stock || 0) === 0);
        } else {
            isAgotado = (p.stockIlimitado !== true && (p.stock === 0 || p.stock === undefined));
        }

        return `
            <div class="product-card ${isAgotado ? 'agotado' : ''}" data-id="${p.id}" style="animation-delay: ${index * 0.05}s">
                <div class="product-img-container" onclick="window.location.href='producto.html?id=${p.id}'">
                    ${isAgotado ? '<div class="badge-agotado">AGOTADO</div>' : ''}
                    <div class="card-carousel" id="carousel-${p.id}">
                        ${imagenes.map((img, i) => `
                            <img src="${img}" class="${i === 0 ? 'active' : ''}" alt="${p.nombre}" onload="this.classList.add('img-loaded'); if(${i===0}) this.closest('.product-img-container')?.classList.add('img-loaded');">
                        `).join('')}
                    </div>
                    ${imagenes.length > 1 ? `
                        <button class="card-carousel-btn prev" onclick="event.stopPropagation(); window.moveGridCarousel('${p.id}', -1)">&#8249;</button>
                        <button class="card-carousel-btn next" onclick="event.stopPropagation(); window.moveGridCarousel('${p.id}', 1)">&#8250;</button>
                    ` : ''}
                </div>
                <div class="product-info" onclick="window.location.href='producto.html?id=${p.id}'">
                    <h3 class="product-title">${p.nombre}</h3>
                    <p class="product-desc">${p.descripcion || ''}</p>
                    <div class="product-footer">
                        <span class="product-price">$${p.precio.toLocaleString('es-AR')}</span>
                        <button class="btn-add-cart" onclick="event.stopPropagation(); window.addToCart('${p.id}')" ${isAgotado ? 'disabled' : ''}>
                            <i class="fas fa-${isAgotado ? 'times' : 'plus'}"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // For cached images that fire onload synchronously (already complete)
    productsGrid.querySelectorAll('.card-carousel img.active').forEach(img => {
        if (img.complete && img.naturalHeight !== 0) {
            img.classList.add('img-loaded');
            img.closest('.product-img-container')?.classList.add('img-loaded');
        }
    });
}

// --- CART INTERACTIVITY ---
window.addToCart = function(id) {
    const p = products.find(item => item.id === id);
    if (!p) return;

    // If product has variants, open the variant picker modal
    if (p.tieneVariantes && p.atributosVariantes?.length) {
        openVariantPicker(p);
        return;
    }

    // Validación de Stock
    if (p.stockIlimitado !== true) {
        const stockDisponible = p.stock || 0;
        const inCart = (cart.find(item => item.id === id)?.qty || 0);
        if (inCart >= stockDisponible) {
            alert(`¡Lo sentimos! Solo quedan ${stockDisponible} unidades de este producto.`);
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

// --- VARIANT PICKER ---
let _vpmProduct = null;
let _vpmSelections = {};
let _vpmQty = 1;

function openVariantPicker(p) {
    _vpmProduct = p;
    _vpmSelections = {};
    _vpmQty = 1;

    document.getElementById('vpm-nombre').innerText = p.nombre;
    document.getElementById('vpm-img').src = p.imagenUrl || 'https://placehold.co/60x60';
    document.getElementById('vpm-precio-display').innerText = `$${p.precio.toLocaleString('es-AR')}`;
    document.getElementById('vpm-qty').innerText = '1';
    document.getElementById('vpm-stock-display').innerText = '';

    const attrContainer = document.getElementById('vpm-atributos');
    attrContainer.innerHTML = p.atributosVariantes.map((attr, attrIdx) => `
        <div>
            <p style="font-weight:700; font-size:0.85rem; margin:0 0 8px; color:var(--panel-oscuro);">${attr.nombre}</p>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${attr.opciones.map(op => {
                    // Check if this option has ANY combination with stock > 0
                    const hasStock = Object.entries(p.variantes || {}).some(([key, v]) => {
                        const parts = key.split('|');
                        return parts[attrIdx] === op && (v.stock || 0) > 0;
                    });
                    return hasStock
                        ? `<button type="button" class="vpm-option-btn"
                                data-attr="${attr.nombre}" data-val="${op}"
                                onclick="window.vpmSelectOption('${attr.nombre}', '${op}', this)"
                                style="padding:8px 16px; border:2px solid #eee; border-radius:10px; background:white; cursor:pointer; font-size:0.85rem; font-weight:600; transition:all 0.15s; color:var(--panel-oscuro);">
                                ${op}
                           </button>`
                        : `<button type="button" disabled
                                style="padding:8px 16px; border:2px solid #f0f0f0; border-radius:10px; background:#fafafa; cursor:not-allowed; font-size:0.85rem; font-weight:600; color:#ccc; text-decoration:line-through;">
                                ${op}
                           </button>`;
                }).join('')}
            </div>
        </div>
    `).join('');

    document.getElementById('variant-picker-modal').style.display = 'flex';
}

window.vpmSelectOption = function(attrName, value, btn) {
    _vpmSelections[attrName] = value;

    // Update button styles for this attribute
    document.querySelectorAll(`[data-attr="${attrName}"]`).forEach(b => {
        b.style.borderColor = '#eee';
        b.style.background = 'white';
        b.style.color = 'var(--panel-oscuro)';
    });
    btn.style.borderColor = 'var(--naranja-accent)';
    btn.style.background = 'rgba(237,112,83,0.08)';
    btn.style.color = 'var(--naranja-accent)';

    // Update price and stock display if all selected
    if (!_vpmProduct) return;
    const allSelected = _vpmProduct.atributosVariantes.every(a => _vpmSelections[a.nombre]);
    if (allSelected) {
        const key = _vpmProduct.atributosVariantes.map(a => _vpmSelections[a.nombre]).join('|');
        const varData = _vpmProduct.variantes?.[key];
        const precio = varData?.precio ?? _vpmProduct.precio;
        const stock = varData?.stock ?? 0;
        document.getElementById('vpm-precio-display').innerText = `$${precio.toLocaleString('es-AR')}`;

        // Swap picker image if variant has its own photo
        if (varData?.imagenUrl) {
            const pickerImg = document.getElementById('vpm-img');
            if (pickerImg) {
                pickerImg.style.opacity = '0';
                pickerImg.style.transition = 'opacity 0.2s';
                setTimeout(() => {
                    pickerImg.src = varData.imagenUrl;
                    pickerImg.style.opacity = '1';
                }, 180);
            }
        }

        const stockEl = document.getElementById('vpm-stock-display');
        if (stock === 0) {
            stockEl.innerText = '⚠️ Sin stock';
            stockEl.style.color = 'var(--error, #e74c3c)';
        } else if (_vpmProduct.avisoStock && stock <= _vpmProduct.avisoStock) {
            stockEl.innerHTML = `⚡ ¡Solo quedan <strong>${stock}</strong>, no te quedes sin el tuyo!`;
            stockEl.style.color = '#e65100';
        } else {
            stockEl.innerText = `${stock} disponibles`;
            stockEl.style.color = '#999';
        }
        document.getElementById('vpm-add-btn').disabled = stock === 0;
        document.getElementById('vpm-add-btn').style.background = stock === 0 ? '#ccc' : 'var(--panel-oscuro)';
        _vpmQty = 1;
        document.getElementById('vpm-qty').innerText = '1';
    }
};

window.vpmAdjustQty = function(delta) {
    if (!_vpmProduct) return;
    const allSelected = _vpmProduct.atributosVariantes.every(a => _vpmSelections[a.nombre]);
    if (!allSelected) return;
    const key = _vpmProduct.atributosVariantes.map(a => _vpmSelections[a.nombre]).join('|');
    const varData = _vpmProduct.variantes?.[key];
    const stock = varData?.stock ?? 0;
    _vpmQty = Math.min(Math.max(1, _vpmQty + delta), stock);
    document.getElementById('vpm-qty').innerText = _vpmQty;
};

window.vpmConfirm = function() {
    if (!_vpmProduct) return;
    const allSelected = _vpmProduct.atributosVariantes.every(a => _vpmSelections[a.nombre]);
    if (!allSelected) {
        alert('Por favor seleccioná todas las opciones antes de agregar.');
        return;
    }
    const key = _vpmProduct.atributosVariantes.map(a => _vpmSelections[a.nombre]).join('|');
    const varData = _vpmProduct.variantes?.[key];
    const precio = varData?.precio ?? _vpmProduct.precio;
    const stock = varData?.stock ?? 0;
    const label = _vpmProduct.atributosVariantes.map(a => `${a.nombre}: ${_vpmSelections[a.nombre]}`).join(' / ');

    if (stock === 0) {
        alert('Esta combinación no tiene stock disponible.');
        return;
    }

    // Check existing in cart (same product + same variant)
    const cartKey = `${_vpmProduct.id}__${key}`;
    const existing = cart.find(item => item._cartKey === cartKey);
    if (existing) {
        if (existing.qty + _vpmQty > stock) {
            alert(`Solo quedan ${stock} unidades de esta variante.`);
            return;
        }
        existing.qty += _vpmQty;
    } else {
        cart.push({
            _cartKey: cartKey,
            id: _vpmProduct.id,
            nombre: _vpmProduct.nombre,
            precio: precio,
            imagenUrl: _vpmProduct.imagenUrl,
            qty: _vpmQty,
            stock: stock,
            stockIlimitado: false,
            variantKey: key,
            variantLabel: label
        });
    }

    document.getElementById('variant-picker-modal').style.display = 'none';
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

window.updateQty = function(index, delta) {
    const item = cart[index];
    if (delta > 0 && item.stockIlimitado !== true) {
        const stockDisponible = item.stock || 0;
        if (item.qty >= stockDisponible) {
            alert(`¡Lo sentimos! Solo quedan ${stockDisponible} unidades disponibles.`);
            return;
        }
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
        // Si ya está logueado, vamos directo al checkout
        if (userIsLogged) {
            window.location.href = 'checkout.html';
            return;
        }

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
    const nextImg = imgs[activeIdx];
    nextImg.classList.add('active');
    // If already loaded, ensure img-loaded class is present so the image is visible
    if (nextImg.complete && nextImg.naturalHeight !== 0) {
        nextImg.classList.add('img-loaded');
    }
};

init();
