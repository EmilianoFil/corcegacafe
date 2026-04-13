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

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Buscar nombre en Firestore
        const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
        let nombre = user.displayName || user.email.split('@')[0];
        if (snap.exists()) {
            nombre = snap.data().nombre.split(' ')[0]; // Solo primer nombre
        }
        userGreeting.innerText = `¡HOLA, ${nombre.toUpperCase()}!`;
        userGreeting.style.display = 'block';
    } else {
        userGreeting.style.display = 'none';
    }
});
const cartBadge = document.getElementById('cart-badge');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotal = document.getElementById('cart-total');
// const categoryChips = document.querySelectorAll('.category-chip'); // We'll select them inside setup

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

    productsGrid.innerHTML = filtered.map((p, index) => {
        const imagenes = p.imagenes && p.imagenes.length > 0 ? p.imagenes : [p.imagenUrl || 'https://placehold.co/400x400/fdfcf7/01323f?text=Córcega'];
        
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
                <div class="product-info" onclick="openProductModal('${p.id}')">
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

    // Re-attach add-to-cart listeners
    document.querySelectorAll('.btn-add-cart').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            addToCart(btn.dataset.id);
        };
    });

    // Make image container clickable too
    document.querySelectorAll('.product-img-container').forEach(container => {
        container.onclick = () => {
            const id = container.closest('.product-card').dataset.id;
            openProductModal(id);
        };
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
    const btnOpenCartHeader = document.getElementById('cart-btn');
    const btnOpenCartFloat = document.getElementById('btn-open-cart');
    
    if (btnOpenCartHeader) btnOpenCartHeader.onclick = openCart;
    if (btnOpenCartFloat) btnOpenCartFloat.onclick = openCart;
    
    const btnCloseCart = document.getElementById('btn-close-cart');
    if (btnCloseCart) btnCloseCart.onclick = closeCart;
    
    if (cartOverlay) cartOverlay.onclick = closeCart;

    const chips = document.querySelectorAll('.category-chip');
    chips.forEach(chip => {
        chip.onclick = () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeCategory = chip.dataset.cat;
            renderProducts();
            
            // On mobile, scroll up slightly to show products if they clicked the bottom bar
            if(window.innerWidth < 768) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };
    });

    // --- CHECKOUT FLOW ---
    const checkoutModal = document.getElementById('checkout-modal');
    
    document.getElementById('btn-go-to-checkout').onclick = () => {
        if (cart.length === 0) {
            alert("Tu carrito está vacío.");
            return;
        }

        // Si el usuario está logueado, va directo
        if (auth.currentUser) {
            window.location.href = "checkout.html";
        } else {
            // Si no, mostramos el modal interruptor
            checkoutModal.style.display = 'flex';
        }
    };

    // BOTONES DEL MODAL
    document.getElementById('modal-btn-login').onclick = () => {
        sessionStorage.setItem('redirectAfterLogin', 'checkout.html');
        window.location.href = 'tienda-cuenta.html';
    };

    document.getElementById('modal-btn-register').onclick = () => {
        sessionStorage.setItem('redirectAfterLogin', 'checkout.html');
        // Usamos un hash para que tienda-cuenta sepa que queremos registrar
        window.location.href = 'tienda-cuenta.html#register';
    };

    document.getElementById('modal-btn-guest').onclick = () => {
        window.location.href = 'checkout.html';
    };
}

// --- EXPOSE FOR INLINE ONCLICK ---
window.tienda = {
    changeQty: (id, delta) => updateQty(id, delta),
    remove: (id) => removeFromCart(id)
};

// --- RUN ---
init();
// --- PRODUCT MODAL & CAROUSEL ---
let currentProduct = null;
let currentImgIdx = 0;
let currentModalQty = 1;

// Definimos funciones globales PRIMERO
window.moveGridCarousel = function(id, delta) {
    const container = document.getElementById(`carousel-${id}`);
    if (!container) return;
    const imgs = container.querySelectorAll('img');
    if (imgs.length === 0) return;
    
    let activeIdx = Array.from(imgs).findIndex(img => img.classList.contains('active'));
    if (activeIdx === -1) activeIdx = 0;
    
    imgs[activeIdx].classList.remove('active');
    activeIdx = (activeIdx + delta + imgs.length) % imgs.length;
    imgs[activeIdx].classList.add('active');
};

window.openProductModal = function(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    currentProduct = product;
    currentImgIdx = 0;
    currentModalQty = 1;

    document.getElementById('detail-name').innerText = product.nombre;
    document.getElementById('detail-category').innerText = product.categoria || 'Café';
    document.getElementById('detail-description').innerText = product.descripcion_larga || product.descripcion || 'Sin descripción detallada por ahora.';
    document.getElementById('detail-price').innerText = `$${product.precio.toLocaleString('es-AR')}`;
    document.getElementById('detail-qty').innerText = currentModalQty;

    const imagenes = product.imagenes && product.imagenes.length > 0 ? product.imagenes : [product.imagenUrl];
    const carouselInner = document.getElementById('detail-carousel-inner');
    const dotsContainer = document.getElementById('detail-carousel-dots');

    carouselInner.innerHTML = imagenes.map(img => `<img src="${img}">`).join('');
    dotsContainer.innerHTML = imagenes.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}" onclick="window.goToDetailSlide(${i})"></span>`).join('');
    
    updateDetailCarousel();
    
    document.getElementById('product-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden'; 
};

window.moveDetailCarousel = function(delta) {
    const imagenes = currentProduct.imagenes && currentProduct.imagenes.length > 0 ? currentProduct.imagenes : [currentProduct.imagenUrl];
    currentImgIdx = (currentImgIdx + delta + imagenes.length) % imagenes.length;
    updateDetailCarousel();
};

window.goToDetailSlide = function(idx) {
    currentImgIdx = idx;
    updateDetailCarousel();
};

window.adjustDetailQty = function(delta) {
    currentModalQty = Math.max(1, currentModalQty + delta);
    document.getElementById('detail-qty').innerText = currentModalQty;
};

function updateDetailCarousel() {
    const carouselInner = document.getElementById('detail-carousel-inner');
    if (!carouselInner) return;
    carouselInner.style.transform = `translateX(-${currentImgIdx * 100}%)`;
    
    // Update dots
    const dots = document.querySelectorAll('#detail-carousel-dots .dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === currentImgIdx);
    });
}

// Cerrar Modal
document.getElementById('btn-close-product-modal').onclick = () => {
    document.getElementById('product-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

window.onclick = (event) => {
    const modal = document.getElementById('product-modal');
    if (event.target == modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

// Agregar al carrito desde Modal
document.getElementById('btn-modal-add-to-cart').onclick = () => {
    if (!currentProduct) return;
    
    for (let i = 0; i < currentModalQty; i++) {
        addToCart(currentProduct.id, false); 
    }
    
    openCart();
    document.getElementById('btn-close-product-modal').click();
};

// Ajuste en addToCart para poder silenciar el 'openCart'
window.addToCart = function(id, autoOpen = true) {
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
    if (autoOpen) openCart();
};
