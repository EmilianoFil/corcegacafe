import { db, auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { writeReserva, deleteReserva, fetchReservedByOthers, getSessionId, CART_TIMEOUT_MS } from './cart-reservas.js';

// --- STATE ---
let products = [];
let categories = [];
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let activeCategory = 'todos';
let reservedByOthers = {};
let cartTimerInterval = null;

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
        fetchProducts(),
        fetchReservedByOthers().then(map => { reservedByOthers = map; }).catch(err => { console.warn('fetchReservedByOthers error:', err); })
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
            // Para variantes: agotado solo si TODAS las combinaciones tienen stock efectivo 0
            const stocks = Object.entries(p.variantes || {});
            isAgotado = stocks.length > 0 && stocks.every(([key, v]) => {
                if (v.stockIlimitado) return false;
                const reservaKey = `${p.id}_${key}`;
                const reserved = reservedByOthers[reservaKey] || 0;
                return (v.stock || 0) - reserved <= 0;
            });
        } else {
            if (p.stockIlimitado === true) {
                isAgotado = false;
            } else {
                const reservaKey = `${p.id}_base`;
                const reserved = reservedByOthers[reservaKey] || 0;
                const effectiveStock = (p.stock || 0) - reserved;
                isAgotado = effectiveStock <= 0;
            }
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

    // GA4: view_item_list
    if (typeof gtag === 'function') {
        gtag('event', 'view_item_list', {
            item_list_name: activeCategory === 'todos' ? 'Todos' : activeCategory,
            items: filtered.map((p, i) => ({
                item_id: p.id,
                item_name: p.nombre,
                item_category: p.categoria || '',
                price: p.precio,
                index: i
            }))
        });
    }

    // For cached images that fire onload synchronously (already complete)
    productsGrid.querySelectorAll('.card-carousel img.active').forEach(img => {
        if (img.complete && img.naturalHeight !== 0) {
            img.classList.add('img-loaded');
            img.closest('.product-img-container')?.classList.add('img-loaded');
        }
    });

    // Swipe táctil en carruseles de la grilla
    setupSwipeOnCarousels();
}

// --- TOAST ---
function showToast(msg, type = 'warning') {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed; bottom:90px; left:50%; transform:translateX(-50%); background:${type === 'warning' ? '#f59e0b' : '#ef4444'}; color:white; padding:12px 20px; border-radius:12px; font-size:13px; font-weight:700; z-index:9999; box-shadow:0 4px 20px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;`;
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
                // Find and remove expired item
                const cartKey = el.dataset.cartKey;
                const idx = cart.findIndex(item => {
                    const key = item._cartKey || `${item.id}__base`;
                    return key === cartKey;
                });
                if (idx !== -1) {
                    const item = cart[idx];
                    cart.splice(idx, 1);
                    try { deleteReserva(item.id, item.variantKey || null); } catch(e) { console.warn('deleteReserva error:', e); }
                    showToast(`⏰ "${item.nombre}" fue eliminado del carrito por inactividad.`, 'error');
                    needsRefresh = true;
                }
            } else {
                const totalSecs = Math.ceil(remaining / 1000);
                const mins = Math.floor(totalSecs / 60);
                const secs = totalSecs % 60;
                const timeStr = `⏱ ${mins}:${String(secs).padStart(2, '0')}`;
                el.innerText = timeStr;

                if (remaining <= 2 * 60 * 1000) {
                    el.style.color = '#ef4444';
                    el.style.fontWeight = '800';
                } else {
                    el.style.color = '#f59e0b';
                    el.style.fontWeight = '700';
                }
            }
        });

        if (needsRefresh) {
            saveAndRefresh();
        }
    }, 1000);
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
        const reservaKey = `${p.id}_base`;
        const reserved = reservedByOthers[reservaKey] || 0;
        const stockDisponible = Math.max(0, (p.stock || 0) - reserved);
        const inCart = (cart.find(item => item.id === id)?.qty || 0);
        if (inCart >= stockDisponible) {
            alert(`¡Lo sentimos! Solo quedan ${stockDisponible} unidades de este producto.`);
            return;
        }
    }

    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.qty++;
        if (p.stockIlimitado !== true) {
            try { writeReserva(id, null, existing.qty, p.nombre); } catch(e) { console.warn('writeReserva error:', e); }
        }
    } else {
        cart.push({ ...p, qty: 1, reservadoEn: Date.now() });
        if (p.stockIlimitado !== true) {
            try { writeReserva(id, null, 1, p.nombre); } catch(e) { console.warn('writeReserva error:', e); }
        }
    }

    if (typeof gtag === 'function') {
        gtag('event', 'add_to_cart', {
            currency: 'ARS',
            value: p.precio,
            items: [{ item_id: p.id, item_name: p.nombre, item_category: p.categoria || '', price: p.precio, quantity: 1 }]
        });
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
                        if (parts[attrIdx] !== op) return false;
                        if (v.stockIlimitado) return true;
                        const reservaKey = `${p.id}_${key}`;
                        const reserved = reservedByOthers[reservaKey] || 0;
                        return (v.stock || 0) - reserved > 0;
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
        const rawStock = varData?.stock ?? 0;
        const ilimitado = varData?.stockIlimitado ?? false;
        const reservaKey = `${_vpmProduct.id}_${key}`;
        const reserved = reservedByOthers[reservaKey] || 0;
        const cartKey = `${_vpmProduct.id}__${key}`;
        const inCart = cart.find(item => item._cartKey === cartKey)?.qty || 0;
        const stock = ilimitado ? rawStock : Math.max(0, rawStock - reserved - inCart);

        document.getElementById('vpm-precio-display').innerText = `$${precio.toLocaleString('es-AR')}`;

        // Swap picker image if variant has its own photo
        if (varData?.imagenUrl) {
            const pickerImg = document.getElementById('vpm-img');
            if (pickerImg) {
                pickerImg.style.transition = 'opacity 0.2s';
                pickerImg.style.opacity = '0';
                setTimeout(() => {
                    pickerImg.onload = null;
                    pickerImg.onload = () => {
                        pickerImg.style.opacity = '1';
                        pickerImg.onload = null;
                    };
                    pickerImg.src = varData.imagenUrl;
                    if (pickerImg.complete && pickerImg.naturalWidth > 0) {
                        pickerImg.style.opacity = '1';
                    }
                }, 220);
            }
        }

        const stockEl = document.getElementById('vpm-stock-display');
        if (ilimitado) {
            stockEl.innerText = '';
            stockEl.style.color = '#aaa';
        } else if (inCart > 0 && stock === 0) {
            // User has all remaining units in their own cart
            stockEl.innerHTML = `🛒 Ya tenés <strong>${inCart}</strong> reservado${inCart > 1 ? 's' : ''} en tu carrito`;
            stockEl.style.color = '#22c55e';
        } else if (inCart > 0 && stock > 0) {
            // User has some in cart, show remaining
            stockEl.innerHTML = `🛒 Tenés <strong>${inCart}</strong> en el carrito · queda${stock > 1 ? 'n' : ''} <strong>${stock}</strong> más`;
            stockEl.style.color = '#f59e0b';
        } else if (stock === 0) {
            stockEl.innerText = '⚠️ Sin stock';
            stockEl.style.color = 'var(--error, #e74c3c)';
        } else if (_vpmProduct.avisoStock && stock <= _vpmProduct.avisoStock) {
            stockEl.innerHTML = `⚡ ¡Solo quedan <strong>${stock}</strong>, no te quedes sin el tuyo!`;
            stockEl.style.color = '#e65100';
        } else {
            stockEl.innerText = `${stock} disponibles`;
            stockEl.style.color = '#999';
        }
        const sinStock = !ilimitado && stock === 0;
        document.getElementById('vpm-add-btn').disabled = sinStock;
        document.getElementById('vpm-add-btn').style.background = sinStock ? '#ccc' : 'var(--panel-oscuro)';
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
    const rawStock = varData?.stock ?? 0;
    const ilimitado = varData?.stockIlimitado ?? false;
    const cartKey = `${_vpmProduct.id}__${key}`;
    const inCart = cart.find(item => item._cartKey === cartKey)?.qty || 0;
    const reservaKey = `${_vpmProduct.id}_${key}`;
    const reserved = reservedByOthers[reservaKey] || 0;
    const effectiveStock = ilimitado ? Infinity : Math.max(0, rawStock - reserved);
    const maxQty = ilimitado ? Infinity : Math.max(0, effectiveStock - inCart);
    _vpmQty = Math.min(maxQty, Math.max(1, _vpmQty + delta));
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
    const rawStock = varData?.stock ?? 0;
    const ilimitado = varData?.stockIlimitado ?? false;
    const reservaKey = `${_vpmProduct.id}_${key}`;
    const reserved = reservedByOthers[reservaKey] || 0;
    const stock = ilimitado ? rawStock : Math.max(0, rawStock - reserved);
    const label = _vpmProduct.atributosVariantes.map(a => `${a.nombre}: ${_vpmSelections[a.nombre]}`).join(' / ');

    if (!ilimitado && stock === 0) {
        alert('Esta combinación no tiene stock disponible.');
        return;
    }

    // Check existing in cart (same product + same variant)
    const cartKey = `${_vpmProduct.id}__${key}`;
    const existing = cart.find(item => item._cartKey === cartKey);
    if (existing) {
        if (!ilimitado && existing.qty + _vpmQty > stock) {
            alert(`Solo quedan ${stock} unidades de esta variante.`);
            return;
        }
        existing.qty += _vpmQty;
        if (!ilimitado) {
            const totalQty = existing.qty;
            try { writeReserva(_vpmProduct.id, key, totalQty, _vpmProduct.nombre + ' - ' + label); } catch(e) { console.warn('writeReserva error:', e); }
        }
    } else {
        cart.push({
            _cartKey: cartKey,
            id: _vpmProduct.id,
            nombre: _vpmProduct.nombre,
            precio: precio,
            imagenUrl: _vpmProduct.imagenUrl,
            qty: _vpmQty,
            stock: rawStock,
            stockIlimitado: ilimitado,
            variantKey: key,
            variantLabel: label,
            reservadoEn: Date.now()
        });
        if (!ilimitado) {
            try { writeReserva(_vpmProduct.id, key, _vpmQty, _vpmProduct.nombre + ' - ' + label); } catch(e) { console.warn('writeReserva error:', e); }
        }
    }

    if (typeof gtag === 'function') {
        gtag('event', 'add_to_cart', {
            currency: 'ARS',
            value: precio * _vpmQty,
            items: [{ item_id: _vpmProduct.id, item_name: _vpmProduct.nombre, item_variant: label, item_category: _vpmProduct.categoria || '', price: precio, quantity: _vpmQty }]
        });
    }
    saveAndRefresh();
    document.getElementById('variant-picker-modal').style.display = 'none';
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

    const checkoutBtn    = document.getElementById('btn-go-to-checkout');
    const keepShoppingBtn = document.getElementById('btn-keep-shopping');
    if (cart.length === 0) {
        cartItemsList.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Tu carrito está vacío</p></div>`;
        cartTotal.innerText = "$0.00";
        if (checkoutBtn)    { checkoutBtn.innerText = 'VER PRODUCTOS'; }
        if (keepShoppingBtn) { keepShoppingBtn.style.display = 'none'; }
        return;
    }
    if (checkoutBtn)    { checkoutBtn.innerText = 'IR A PAGAR'; }
    if (keepShoppingBtn) { keepShoppingBtn.style.display = 'block'; }

    cartItemsList.innerHTML = cart.map((item, index) => {
        const cartKey = item._cartKey || `${item.id}__base`;
        const countdownHtml = (!item.stockIlimitado && item.reservadoEn) ? `
            <div class="reserva-countdown"
                 data-expires="${item.reservadoEn + CART_TIMEOUT_MS}"
                 data-cart-key="${cartKey}"
                 style="font-size:11px; font-weight:700; margin-top:3px; color:#f59e0b;">
            </div>
        ` : '';
        return `
        <div class="cart-item">
            <img src="${item.imagenUrl || 'https://placehold.co/100x100'}" alt="${item.nombre}" class="cart-item-img">
            <div class="cart-item-info">
                <div class="cart-item-title">${item.nombre}</div>
                ${item.variantLabel ? `<div style="font-size:0.72rem; color:var(--naranja-accent); font-weight:600; margin:2px 0;">${item.variantLabel}</div>` : ''}
                <div class="cart-item-price">$${item.precio.toLocaleString('es-AR')}</div>
                ${countdownHtml}
                <div class="cart-item-controls">
                    <button class="qty-btn" onclick="updateQty(${index}, -1)"><i class="fas fa-minus"></i></button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${index}, 1)"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <button class="btn-remove-item" onclick="removeItem(${index})" style="background:none; border:none; color:#ff4d4d; cursor:pointer;"><i class="fas fa-trash"></i></button>
        </div>
        `;
    }).join('');

    const total = cart.reduce((sum, item) => sum + (item.precio * item.qty), 0);
    cartTotal.innerText = `$${total.toLocaleString('es-AR')}`;

    startCartTimer();
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
    if (item.qty < 1) {
        if (item.stockIlimitado !== true) {
            try { deleteReserva(item.id, item.variantKey || null); } catch(e) { console.warn('deleteReserva error:', e); }
        }
        cart.splice(index, 1);
    } else {
        if (item.stockIlimitado !== true) {
            try { writeReserva(item.id, item.variantKey || null, item.qty, item.nombre); } catch(e) { console.warn('writeReserva error:', e); }
        }
    }
    saveAndRefresh();
};

window.removeItem = function(index) {
    const item = cart[index];
    if (item.stockIlimitado !== true) {
        try { deleteReserva(item.id, item.variantKey || null); } catch(e) { console.warn('deleteReserva error:', e); }
    }
    cart.splice(index, 1);
    saveAndRefresh();
};

function setupCartEvents() {
    document.getElementById('cart-btn-header')?.addEventListener('click', openCart);
    document.getElementById('btn-open-cart')?.addEventListener('click', openCart);
    document.getElementById('btn-close-cart')?.addEventListener('click', closeCart);
    cartOverlay?.addEventListener('click', closeCart);

    // "Seguir comprando" — cierra el carrito
    document.getElementById('btn-keep-shopping')?.addEventListener('click', closeCart);

    // "IR A PAGAR" — muestra modal si no está logueado
    document.getElementById('btn-go-to-checkout')?.addEventListener('click', () => {
        // Carrito vacío → ir a la tienda
        if (cart.length === 0) {
            window.location.href = 'tienda.html';
            return;
        }
        // Logueado → checkout directo
        if (userIsLogged) {
            window.location.href = 'checkout.html';
            return;
        }
        // No logueado → mostrar modal de opciones
        const checkoutModal = document.getElementById('checkout-modal');
        if (checkoutModal) {
            checkoutModal.style.display = 'flex';
            // Fix ghost-click en mobile: deshabilitar puntero 400ms para que el
            // tap que abrió este botón no dispare el primer botón del modal.
            checkoutModal.style.pointerEvents = 'none';
            setTimeout(() => { checkoutModal.style.pointerEvents = ''; }, 400);
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

// Touch swipe en carruseles de la grilla
function setupSwipeOnCarousels() {
    productsGrid.querySelectorAll('.card-carousel').forEach(carousel => {
        // Evitar doble-bind si ya se inicializó
        if (carousel.dataset.swipeInit) return;
        carousel.dataset.swipeInit = '1';

        let startX = 0;
        let startY = 0;
        let swipeOccurred = false;

        carousel.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            swipeOccurred = false;
        }, { passive: true });

        carousel.addEventListener('touchmove', e => {
            const dx = Math.abs(e.touches[0].clientX - startX);
            const dy = Math.abs(e.touches[0].clientY - startY);
            // Solo swipe horizontal pronunciado
            if (dx > dy && dx > 12) swipeOccurred = true;
        }, { passive: true });

        carousel.addEventListener('touchend', e => {
            if (!swipeOccurred) return;
            const dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) < 40) return;
            const id = carousel.id.replace('carousel-', '');
            window.moveGridCarousel(id, dx < 0 ? 1 : -1);
            // Bloquear el click sintético para no navegar al producto al swipear
            carousel.closest('.product-img-container')?.addEventListener('click', blockOnce, true);
        });
    });
}

function blockOnce(e) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.removeEventListener('click', blockOnce, true);
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
