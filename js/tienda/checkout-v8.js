import { db, auth } from '../firebase-config.js';
console.log("=== CHECKOUT V4 ACTIVE (NO ALERT) ===");
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- STATE ---
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let deliveryMethod = 'pickup';
let userProfile = null;

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
    
    // Auth Listener for prefill
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
            if (snap.exists()) {
                userProfile = snap.data();
                autofillData(userProfile);
            }
        }
    });
}

function autofillData(profile) {
    if (profile.nombre) document.getElementById('client-name').value = profile.nombre;
    if (profile.whatsapp) document.getElementById('client-phone').value = profile.whatsapp;
    if (profile.dni) document.getElementById('client-dni').value = profile.dni;
    
    // Si ya tenemos el mail del perfil, lo bloqueamos pero lo dejamos visible
    if (profile.email || auth.currentUser?.email) {
        const emailInput = document.getElementById('client-email');
        emailInput.value = profile.email || auth.currentUser.email;
        emailInput.readOnly = true;
        emailInput.style.background = "#f0f0f0";
        emailInput.style.color = "#888";
        emailInput.style.cursor = "not-allowed";
    }

    // Si tiene direcciones, agregar un selector opcional
    if (profile.direcciones && profile.direcciones.length > 0) {
        let addrContainer = document.getElementById('delivery-address-group');
        let selectorHTML = `
            <div class="form-group" style="margin-bottom: 15px;">
                <label>Tus Direcciones Guardadas</label>
                <select id="saved-addresses-select" class="form-control" style="background:#f8f9fa;">
                    <option value="">-- Seleccionar una o escribir abajo --</option>
                    ${profile.direcciones.map(a => `<option value="${a.calle} ${a.num} ${a.piso || ''} ${a.nota || ''}">${a.alias.toUpperCase()}: ${a.calle} ${a.num}</option>`).join('')}
                </select>
            </div>
        `;
        addrContainer.insertAdjacentHTML('afterbegin', selectorHTML);
        
        const selector = document.getElementById('saved-addresses-select');
        selector.onchange = (e) => {
            if (e.target.value) {
                document.getElementById('client-address').value = e.target.value;
            }
        };
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
    const email = document.getElementById('client-email').value.trim();
    const whatsapp = document.getElementById('client-phone').value.trim();
    const dni = document.getElementById('client-dni').value.trim();
    const notas = document.getElementById('client-note').value.trim();
    const direccion = document.getElementById('client-address').value.trim();
    const horario = document.getElementById('order-schedule').value;
    const metodoPago = paymentMethod.value;

    // Validation
    if (!nombre || !whatsapp || !email) {
        alert("Por favor completá tu nombre, email y WhatsApp para que podamos contactarte y enviarte el seguimiento.");
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
                email,
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
            // Limpiar carrito y redirigir a éxito directamente
            localStorage.removeItem('corcega_cart');
            window.location.href = `success.html?orderId=${orderId}`;
        } else {
            // Mercado Pago FLOW REAL
            try {
                const successUrl = window.location.origin + window.location.pathname.replace('checkout.html', 'success.html') + "?orderId=" + orderId;
                const response = await fetch("https://crearpreferenciamp-ioo4dzpz2a-uc.a.run.app", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        items: cart,
                        orderId: orderId,
                        successUrl: successUrl,
                        backUrl: successUrl // Si falla o vuelve, que vaya al seguimiento de esa orden
                    })
                });

                const pref = await response.json();
                
                if (pref.init_point) {
                    window.location.href = pref.init_point;
                } else {
                    throw new Error("No se pudo obtener el link de pago");
                }
            } catch (err) {
                console.error("Error redirecting to MP:", err);
                alert("Error al conectar con Mercado Pago. Pero tu pedido fue registrado. Envianos un mensaje.");
                window.location.href = "success.html?orderId=" + orderId;
            }
        }

    } catch (err) {
        console.error(err);
        alert("Hubo un error al procesar tu pedido. Por favor intentá de nuevo.");
        btnFinalizar.disabled = false;
        btnFinalizar.innerText = "CONFIRMAR Y PAGAR";
    }
}

init();
