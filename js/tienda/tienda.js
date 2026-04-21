import { db } from '../firebase-config.js';
import { collection, getDocs, getDoc, doc, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { fetchReservedByOthers, getSessionId, writeReserva } from './cart-reservas.js';
import { cart, initCart, openCart, closeCart, saveAndRefresh, showToast } from './cart-component.js';

// --- STATE ---
let products = [];
let categories = [];
let activeCategory = 'todos';
let reservedByOthers = {};
let maxUnidadesPorPedido = 0;

// --- ELEMENTS ---
const productsGrid = document.getElementById('products-container');
const catsNav = document.getElementById('categories-nav');

window.tienda = {
    toggleCart: () => {
        if (document.getElementById('cart-drawer')?.classList.contains('active')) closeCart();
        else openCart();
    },
    setCategory: (catId) => {
        activeCategory = catId;
        document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
        document.querySelector(`.category-chip[data-cat="${catId}"]`)?.classList.add('active');
        renderProducts();
        document.getElementById('products-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

// --- INITIALIZATION ---
async function init() {
    initCart();

    // Leer filtro de categoría desde URL (ej: tienda.html?cat=cafeteria)
    const urlParams = new URLSearchParams(window.location.search);
    const catFromUrl = urlParams.get('cat');
    if (catFromUrl) activeCategory = catFromUrl;

    await Promise.all([
        fetchCategories(),
        fetchProducts(),
        fetchReservedByOthers().then(map => { reservedByOthers = map; }).catch(err => { console.warn('fetchReservedByOthers error:', err); }),
        getDoc(doc(db, "configuracion", "tienda")).then(snap => {
            if (snap.exists()) maxUnidadesPorPedido = snap.data().agenda?.pedidosMaximosDia || 0;
        }).catch(() => {})
    ]);
    renderCategories();
    renderProducts();

    // Si hay categoría en la URL, marcar chip activo en el menú mobile
    if (catFromUrl) {
        const list = document.getElementById('mobile-categories-list');
        list?.querySelectorAll('.mobile-menu-subitem').forEach(btn => {
            btn.classList.toggle('active-cat', btn.dataset.cat === catFromUrl);
        });
    }
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
                            ${isAgotado
                                ? '<i class="fas fa-times"></i>'
                                : '<span class="cart-plus-icon"><i class="fas fa-shopping-cart"></i><i class="fas fa-plus"></i></span>'
                            }
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
    if (maxUnidadesPorPedido > 0) {
        const currentQty = existing?.qty || 0;
        if (currentQty >= maxUnidadesPorPedido) {
            showToast(`Máximo ${maxUnidadesPorPedido} unidades por pedido. Para cantidades mayores, ¡escribinos!`, 'warning');
            return;
        }
    }
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

    // Deshabilitar "Agregar" hasta que estén seleccionadas todas las variantes
    const vpmBtn = document.getElementById('vpm-add-btn');
    if (vpmBtn) {
        vpmBtn.disabled = true;
        vpmBtn.style.background = '#bbb';
        vpmBtn.innerHTML = '<i class="fas fa-hand-point-up"></i> Elegí las opciones';
    }

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
            stockEl.innerHTML = `🛒 Ya tenés <strong>${inCart}</strong> reservado${inCart > 1 ? 's' : ''} en tu carrito`;
            stockEl.style.color = '#22c55e';
        } else if (inCart > 0 && stock > 0) {
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
        const btn = document.getElementById('vpm-add-btn');
        btn.disabled = sinStock;
        btn.style.background = sinStock ? '#ccc' : 'var(--panel-oscuro)';
        btn.innerHTML = sinStock
            ? '<i class="fas fa-times"></i> Sin stock'
            : '<i class="fas fa-shopping-cart"></i> AGREGAR AL CARRITO';
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
    if (maxUnidadesPorPedido > 0) {
        const currentQty = existing?.qty || 0;
        if (currentQty + _vpmQty > maxUnidadesPorPedido) {
            showToast(`Máximo ${maxUnidadesPorPedido} unidades por pedido. Para cantidades mayores, ¡escribinos!`, 'warning');
            return;
        }
    }
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
