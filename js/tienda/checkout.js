import { db } from '../firebase-config.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let deliveryMethod = 'pickup';

// --- ELEMENTS ---
const checkoutItems = document.getElementById('checkout-items');
const checkoutTotal = document.getElementById('checkout-total');
const methodCards = document.querySelectorAll('.method-card');
const deliveryGroup = document.getElementById('delivery-address-group');
const paymentMethod = document.getElementById('payment-method');
const transferInfo = document.getElementById('transfer-info');
const btnFinalizar = document.getElementById('btn-finalizar-pedido');

// --- INITIALIZATION ---
function init() {
    if (cart.length === 0) {
        alert("Tu carrito está vacío.");
        window.location.href = 'tienda.html';
        return;
    }
    renderSummary();
    setupEventListeners();
    checkExistingSession();
}

function checkExistingSession() {
    const sessionDni = localStorage.getItem('corcega_tienda_dni');
    if (sessionDni) {
        // Podríamos traer los datos de Firestore o usar los guardados en localStorage
        document.getElementById('client-name').value = localStorage.getItem('corcega_tienda_nombre') || '';
        // Si quisiéramos email/tel, tendríamos que guardarlos en el login
    }
}

function renderSummary() {
    checkoutItems.innerHTML = cart.map(item => `
        <div class="order-summary-item">
            <span><span class="order-item-qty">${item.qty}x</span> ${item.nombre}</span>
            <span>$${(item.precio * item.qty).toLocaleString('es-AR')}</span>
        </div>
    `).join('');

    const total = cart.reduce((acc, item) => acc + (item.precio * item.qty), 0);
    checkoutTotal.innerText = `$${total.toLocaleString('es-AR')}`;
}

function setupEventListeners() {
    // Delivery Method Toggles
    methodCards.forEach(card => {
        card.onclick = () => {
            methodCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            deliveryMethod = card.dataset.method;
            
            if (deliveryMethod === 'delivery') {
                deliveryGroup.style.display = 'block';
            } else {
                deliveryGroup.style.display = 'none';
            }
        };
    });

    // Payment Method Toggles
    paymentMethod.onchange = (e) => {
        if (e.target.value === 'transferencia') {
            transferInfo.style.display = 'block';
        } else {
            transferInfo.style.display = 'none';
        }
    };

    // Final Action
    btnFinalizar.onclick = handleOrderSubmission;
}

async function handleOrderSubmission() {
    const nombre = document.getElementById('client-name').value.trim();
    const whatsapp = document.getElementById('client-phone').value.trim();
    const dni = document.getElementById('client-dni').value.trim();
    const notas = document.getElementById('client-note').value.trim();
    const direccion = document.getElementById('client-address').value.trim();
    const horario = document.getElementById('order-schedule').value;
    const metodoPago = paymentMethod.value;

    // Validation
    if (!nombre || !whatsapp) {
        alert("Por favor completá tu nombre y WhatsApp para que podamos contactarte.");
        return;
    }

    if (deliveryMethod === 'delivery' && !direccion) {
        alert("Por favor ingresá una dirección de envío.");
        return;
    }

    btnFinalizar.disabled = true;
    btnFinalizar.innerText = "Procesando pedido... ⏳";

    try {
        const total = cart.reduce((acc, item) => acc + (item.precio * item.qty), 0);
        const sessionDni = localStorage.getItem('corcega_tienda_dni');
        
        const orderData = {
            cliente: {
                nombre,
                whatsapp,
                dni: sessionDni || null,
                direccion: deliveryMethod === 'delivery' ? direccion : 'Retiro en local'
            },
            items: cart,
            total,
            metodoEntrega: deliveryMethod,
            horario,
            metodoPago,
            notas,
            estado: 'pendiente_pago',
            timestamp: serverTimestamp()
        };

        // 1. Guardar en Firestore
        const docRef = await addDoc(collection(db, "ordenes"), orderData);
        const orderId = docRef.id;

        // 2. Lógica según método de pago
        if (metodoPago === 'transferencia') {
            // Limpiar carrito y redirigir a éxito
            localStorage.removeItem('corcega_cart');
            alert("¡Pedido realizado con éxito! Por favor enviá el comprobante de transferencia por WhatsApp.");
            window.location.href = `https://wa.me/5491122334455?text=Hola! Realicé el pedido #${orderId}. Te adjunto el comprobante.`;
        } else {
            // Mercado Pago FLOW
            alert("Redirigiendo a Mercado Pago...");
            // TODO: Integrar con Cloud Function para obtener el link de pago real
            // Por ahora registramos la orden y simulamos
            localStorage.removeItem('corcega_cart');
            window.location.href = "success.html?orderId=" + orderId;
        }

    } catch (err) {
        console.error(err);
        alert("Hubo un error al procesar tu pedido. Por favor intentá de nuevo.");
        btnFinalizar.disabled = false;
        btnFinalizar.innerText = "CONFIRMAR Y PAGAR";
    }
}

init();
