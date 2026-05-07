import { db } from '../firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { writeReserva } from './cart-reservas.js';
import { cart, initCart, openCart, closeCart, saveAndRefresh, updateCartUI, showToast, setMaxUnidadesPorPedido, getMaxUnidadesPorPedido } from './cart-component.js';

// --- STATE ---
let currentProduct = null;
let currentQty = 1;
let selectedVariants = {};

// --- ACTIONS ---
window.tienda = {
    toggleCart: () => {
        if (document.getElementById('cart-drawer')?.classList.contains('active')) closeCart();
        else openCart();
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

    initCart();
    getDoc(doc(db, 'configuracion', 'tienda')).then(snap => {
        if (snap.exists()) setMaxUnidadesPorPedido(snap.data().agenda?.pedidosMaximosDia || 0);
    }).catch(() => {});
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

        // Cargar productos relacionados (si tiene)
        if (currentProduct.productosRelacionados?.length > 0) {
            loadRelatedProducts(currentProduct.productosRelacionados, currentProduct.id);
        }
    } catch (err) {
        console.error("Error loading product:", err);
    }
}

async function loadRelatedProducts(ids, currentId) {
    try {
        const validIds = ids.filter(id => id && id !== currentId).slice(0, 3);
        if (validIds.length === 0) return;

        const snaps = await Promise.all(validIds.map(id => getDoc(doc(db, "productos", id))));
        const related = snaps
            .filter(s => s.exists() && s.data().activo !== false)
            .map(s => ({ id: s.id, ...s.data() }));

        if (related.length === 0) return;

        const section = document.getElementById('related-products-section');
        const grid    = document.getElementById('related-products-grid');
        if (!section || !grid) return;

        grid.innerHTML = related.map(p => `
            <a href="producto.html?id=${p.id}" class="related-card">
                <div class="related-card-img">
                    <img src="${p.imagenUrl || 'https://placehold.co/400x400/fdfcf7/01323f?text=Córcega'}"
                         alt="${p.nombre}"
                         loading="lazy">
                </div>
                <div class="related-card-info">
                    <span class="related-card-cat">${p.categoria || ''}</span>
                    <span class="related-card-name">${p.nombre}</span>
                    <span class="related-card-price">$${p.precio.toLocaleString('es-AR')}</span>
                </div>
            </a>
        `).join('');

        section.style.display = 'block';
    } catch (err) {
        console.warn("loadRelatedProducts error:", err);
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

    // Swipe táctil en imagen principal (cicla por la galería)
    setupMainImageSwipe(imagenes);

    // GA4: view_item
    if (typeof gtag === 'function') {
        gtag('event', 'view_item', {
            currency: 'ARS',
            value: p.precio,
            items: [{ item_id: p.id, item_name: p.nombre, item_category: p.categoria || '', price: p.precio }]
        });
    }

    // "Más info" button + modal
    const masInfoContainer = document.getElementById('prod-masinfo-container');
    if (masInfoContainer) {
        if (p.masInfo?.activo && p.masInfo?.texto) {
            masInfoContainer.innerHTML = `
                <button onclick="window._openMasInfoModal()" style="background:none;border:2px solid var(--naranja-accent,#d86634);color:var(--naranja-accent,#d86634);border-radius:20px;padding:6px 18px;font-size:0.82rem;font-weight:700;cursor:pointer;margin-top:10px;">
                    ℹ️ Más info
                </button>`;
            masInfoContainer.style.display = 'block';
        } else {
            masInfoContainer.style.display = 'none';
        }
    }
    window._openMasInfoModal = function() {
        let modal = document.getElementById('masinfo-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'masinfo-modal';
            modal.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);padding:20px;';
            modal.innerHTML = `
                <div style="background:white;border-radius:20px;padding:28px 24px;max-width:420px;width:100%;position:relative;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
                    <button onclick="document.getElementById('masinfo-modal').style.display='none'"
                        style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:1.3rem;cursor:pointer;color:#aaa;">✕</button>
                    <h3 style="font-size:1rem;font-weight:800;color:var(--secondary,#01323f);margin:0 0 14px;">ℹ️ Más información</h3>
                    <p id="masinfo-modal-text" style="font-size:0.9rem;color:#444;line-height:1.6;white-space:pre-wrap;margin:0;"></p>
                </div>`;
            document.body.appendChild(modal);
            modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
        }
        document.getElementById('masinfo-modal-text').textContent = p.masInfo?.texto || '';
        modal.style.display = 'flex';
    };

    // Texto de entrega (retiroInmediato / tiempoMinimo)
    const entregaInfo = document.getElementById('prod-entrega-info');
    if (entregaInfo) {
        if (p.retiroInmediato && p.textoRetiroInmediato) {
            entregaInfo.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;background:#e8f9ee;color:#1a6b3a;border-radius:20px;padding:5px 14px;font-size:0.8rem;font-weight:700;">⚡ ${p.textoRetiroInmediato}</span>`;
            entregaInfo.style.display = 'block';
        } else if (p.tiempoMinimo && p.textoTiempoMinimo) {
            entregaInfo.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;background:#fff8e6;color:#7a5800;border-radius:20px;padding:5px 14px;font-size:0.8rem;font-weight:700;">🕐 ${p.textoTiempoMinimo}</span>`;
            entregaInfo.style.display = 'block';
        } else {
            entregaInfo.style.display = 'none';
        }
    }

    // Toggle Visibility
    document.getElementById('main-product-loader').style.display = 'none';
    document.getElementById('product-content').style.display = 'grid';

    // Button Logic
    const addBtn = document.getElementById('btn-add-to-cart-page');
    addBtn.onclick = () => addToCartFromPage();

    // Sincronizar qty picker con el estado del botón (disabled = qty deshabilitado)
    const qtyPicker = document.querySelector('.qty-picker');
    if (qtyPicker) {
        const syncQty = () => {
            qtyPicker.style.opacity = addBtn.disabled ? '0.4' : '';
            qtyPicker.style.pointerEvents = addBtn.disabled ? 'none' : '';
        };
        syncQty();
        new MutationObserver(syncQty).observe(addBtn, { attributes: true, attributeFilter: ['disabled'] });
    }

    // Stock info para productos sin variantes
    if (!p.tieneVariantes) {
        const stockInfo = document.getElementById('prod-stock-info');
        if (stockInfo && !p.stockIlimitado) {
            const inCart = cart.find(item => item.id === p.id)?.qty || 0;
            const stock = Math.max(0, (p.stock || 0) - inCart);
            showStockInfo(stockInfo, stock, p.avisoStock, inCart);
        }
    }

    // Variantes
    renderVariantSelectors();
}

// Swipe táctil en la imagen principal del detalle de producto
function setupMainImageSwipe(imagenes) {
    if (!imagenes || imagenes.length <= 1) return;
    const wrapper = document.querySelector('.main-image-wrapper');
    if (!wrapper) return;
    // Evitar doble-bind
    if (wrapper.dataset.swipeInit) return;
    wrapper.dataset.swipeInit = '1';

    let startX = 0;
    let startY = 0;
    let swipeOccurred = false;

    wrapper.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swipeOccurred = false;
    }, { passive: true });

    wrapper.addEventListener('touchmove', e => {
        const dx = Math.abs(e.touches[0].clientX - startX);
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > dy && dx > 12) swipeOccurred = true;
    }, { passive: true });

    wrapper.addEventListener('touchend', e => {
        if (!swipeOccurred) return;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) < 40) return;

        // Encontrar la imagen activa y moverse al siguiente/anterior
        const thumbs = document.querySelectorAll('#gallery-thumbs-list .thumb');
        const activeIdx = Array.from(thumbs).findIndex(t => t.classList.contains('active'));
        const next = dx < 0
            ? (activeIdx + 1) % imagenes.length
            : (activeIdx - 1 + imagenes.length) % imagenes.length;

        if (thumbs[next]) {
            window.changeMainImage(imagenes[next], thumbs[next]);
        }
    });
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
    const p = currentProduct;

    if (delta > 0) {
        const maxUnidades = getMaxUnidadesPorPedido();
        if (maxUnidades > 0 && p?.requiereAgenda) {
            const totalAgenda = cart.filter(i => i.requiereAgenda !== false).reduce((s, i) => s + i.qty, 0);
            if (totalAgenda + currentQty + delta > maxUnidades) {
                showToast(`Máximo ${maxUnidades} unidades con fecha por pedido. Para más, ¡escribinos!`, 'warning');
                return;
            }
        }
    }

    let maxQty = Infinity;

    if (p) {
        if (p.tieneVariantes && p.atributosVariantes?.length) {
            const allSelected = p.atributosVariantes.every(a => selectedVariants[a.nombre]);
            if (allSelected) {
                const key = p.atributosVariantes.map(a => selectedVariants[a.nombre]).join('|');
                const varData = p.variantes?.[key];
                if (varData && !varData.stockIlimitado) {
                    const inCart = cart.find(item => item._cartKey === `${p.id}__${key}`)?.qty || 0;
                    maxQty = Math.max(0, (varData.stock || 0) - inCart);
                }
            }
        } else if (!p.stockIlimitado) {
            const inCart = cart.find(item => item.id === p.id)?.qty || 0;
            maxQty = Math.max(0, (p.stock || 0) - inCart);
        }
    }

    currentQty = Math.min(maxQty, Math.max(1, currentQty + delta));
    document.getElementById('prod-qty').innerText = currentQty;
};

function showStockInfo(el, stock, avisoStock, inCart = 0) {
    el.style.display = 'block';
    if (inCart > 0 && stock === 0) {
        el.innerHTML = `🛒 Ya tenés <strong>${inCart}</strong> reservado${inCart > 1 ? 's' : ''} en tu carrito`;
        el.style.background = '#f0fff4';
        el.style.color = '#22c55e';
    } else if (inCart > 0 && stock > 0) {
        el.innerHTML = `🛒 Tenés <strong>${inCart}</strong> en el carrito · queda${stock > 1 ? 'n' : ''} <strong>${stock}</strong> más`;
        el.style.background = '#fff8e1';
        el.style.color = '#f59e0b';
    } else if (stock === 0) {
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

    // Verificar si todas las variantes están sin stock
    const todasAgotadas = Object.values(p.variantes || {}).length > 0 &&
        Object.values(p.variantes || {}).every(v => !v.stockIlimitado && (v.stock || 0) <= 0);

    const addBtn = document.getElementById('btn-add-to-cart-page');
    if (todasAgotadas) {
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.style.background = '#ccc';
            addBtn.style.cursor = 'not-allowed';
            addBtn.innerHTML = 'SIN STOCK';
        }
    } else {
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.style.background = '#bbb';
            addBtn.style.cursor = 'not-allowed';
            addBtn.innerHTML = '<i class="fas fa-hand-pointer"></i> Elegí las opciones';
        }
    }

    list.innerHTML = p.atributosVariantes.map((attr, attrIdx) => `
        <div>
            <p style="font-weight:700; font-size:0.8rem; margin:0 0 8px; color:var(--panel-oscuro); text-transform:uppercase; letter-spacing:0.5px;">${attr.nombre}</p>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${attr.opciones.map(op => {
                    const hasStock = Object.entries(p.variantes || {}).some(([key, v]) => {
                        const parts = key.split('|');
                        return parts[attrIdx] === op && (v.stockIlimitado || (v.stock || 0) > 0);
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
        const rawStock = varData?.stock ?? 0;
        const ilimitadoVar = varData?.stockIlimitado ?? false;
        const cartKeyVar = `${p.id}__${key}`;
        const inCartVar = cart.find(item => item._cartKey === cartKeyVar)?.qty || 0;
        const stock = ilimitadoVar ? rawStock : Math.max(0, rawStock - inCartVar);

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
        if (!ilimitadoVar && stock === 0) {
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
        if (stockInfo) {
            if (ilimitadoVar) {
                stockInfo.style.display = 'none';
            } else {
                showStockInfo(stockInfo, stock, p.avisoStock, inCartVar);
            }
        }
    }
};

function addToCartFromPage() {
    if (!currentProduct) return;
    const p = currentProduct;

    const maxUnidades = getMaxUnidadesPorPedido();
    if (maxUnidades > 0 && p.requiereAgenda) {
        const totalAgenda = cart.filter(i => i.requiereAgenda !== false).reduce((s, i) => s + i.qty, 0);
        if (totalAgenda + currentQty > maxUnidades) {
            showToast(`Máximo ${maxUnidades} unidades con fecha por pedido (entre todos los productos). Para más, ¡escribinos!`, 'warning');
            return;
        }
    }

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
        const ilimitado = varData?.stockIlimitado ?? false;
        const label = p.atributosVariantes.map(a => `${a.nombre}: ${selectedVariants[a.nombre]}`).join(' / ');

        if (!ilimitado && stock === 0) { alert('Sin stock en esta variante.'); return; }

        const cartKey = `${p.id}__${key}`;
        const existing = cart.find(item => item._cartKey === cartKey);
        if (existing) {
            if (!ilimitado && existing.qty + currentQty > stock) {
                alert(`Solo quedan ${stock} unidades de esta variante.`);
                return;
            }
            existing.qty += currentQty;
            if (!ilimitado) {
                try { writeReserva(p.id, key, existing.qty, p.nombre + ' - ' + label); } catch(e) { console.warn('writeReserva error:', e); }
            }
        } else {
            cart.push({
                _cartKey: cartKey,
                id: p.id,
                nombre: p.nombre,
                precio: precio,
                imagenUrl: p.imagenUrl,
                qty: currentQty,
                stock: stock,
                stockIlimitado: ilimitado,
                variantKey: key,
                variantLabel: label,
                requiereAgenda: p.requiereAgenda || false,
                masInfo: p.masInfo?.activo ? p.masInfo : null,
                reservadoEn: Date.now()
            });
            if (!ilimitado) {
                try { writeReserva(p.id, key, currentQty, p.nombre + ' - ' + label); } catch(e) { console.warn('writeReserva error:', e); }
            }
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
        if (currentProduct.stockIlimitado !== true) {
            try { writeReserva(currentProduct.id, null, existing.qty, currentProduct.nombre); } catch(e) { console.warn('writeReserva error:', e); }
        }
    } else {
        cart.push({
            id: currentProduct.id,
            nombre: currentProduct.nombre,
            precio: currentProduct.precio,
            imagenUrl: currentProduct.imagenUrl,
            qty: currentQty,
            stock: currentProduct.stock,
            stockIlimitado: currentProduct.stockIlimitado,
            requiereAgenda: currentProduct.requiereAgenda || false,
            masInfo: currentProduct.masInfo?.activo ? currentProduct.masInfo : null,
            reservadoEn: Date.now()
        });
        if (currentProduct.stockIlimitado !== true) {
            try { writeReserva(currentProduct.id, null, currentQty, currentProduct.nombre); } catch(e) { console.warn('writeReserva error:', e); }
        }
    }

    if (typeof gtag === 'function') {
        gtag('event', 'add_to_cart', {
            currency: 'ARS',
            value: currentProduct.precio * currentQty,
            items: [{ item_id: currentProduct.id, item_name: currentProduct.nombre, item_category: currentProduct.categoria || '', price: currentProduct.precio, quantity: currentQty }]
        });
    }

    saveAndRefresh();
    openCart();
}

init();
