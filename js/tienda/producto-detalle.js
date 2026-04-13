import { db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let currentProduct = null;
let currentQty = 1;
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];

// --- INIT ---
async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        window.location.href = 'tienda.html';
        return;
    }

    await loadProductData(productId);
    updateCartVisuals();
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

// Render UI
function renderProductDetail() {
    const p = currentProduct;
    
    // Textos
    document.getElementById('breadcrumb-category').innerText = p.categoria || 'Tienda';
    document.getElementById('breadcrumb-name').innerText = p.nombre;
    document.getElementById('prod-title').innerText = p.nombre;
    document.getElementById('prod-price').innerText = `$${p.precio.toLocaleString('es-AR')}`;
    document.getElementById('prod-desc').innerHTML = p.descripcion_larga || p.descripcion || 'Sin descripción detallada por ahora.';

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
    document.getElementById('main-prod-img').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('main-prod-img').src = url;
        document.getElementById('main-prod-img').style.opacity = '1';
    }, 200);

    document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
    thumbEl.classList.add('active');
};

window.changeQty = function(delta) {
    currentQty = Math.max(1, currentQty + delta);
    document.getElementById('prod-qty').innerText = currentQty;
};

// Cart Logic Integration
function addToCartFromPage() {
    if (!currentProduct) return;

    for(let i=0; i<currentQty; i++) {
        const existing = cart.find(item => item.id === currentProduct.id);
        if (existing) {
            existing.qty++;
        } else {
            cart.push({
                id: currentProduct.id,
                nombre: currentProduct.nombre,
                precio: currentProduct.precio,
                imagenUrl: currentProduct.imagenUrl,
                qty: 1
            });
        }
    }

    localStorage.setItem('corcega_cart', JSON.stringify(cart));
    
    // Animación de feedback
    const btn = document.getElementById('btn-add-to-cart-page');
    const originalText = btn.innerText;
    btn.innerText = "¡AGREGADO! ✅";
    btn.style.background = "#27ae60";
    
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = "";
    }, 2000);
}

function updateCartVisuals() {
    // Aquí podrías agregar un contador de carrito si quisieras arriba, 
    // pero por ahora compartimos el localStorage con tienda.html
}

init();
