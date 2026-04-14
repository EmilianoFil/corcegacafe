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
async function init() {
    if (cart.length === 0) {
        alert("Tu carrito está vacío.");
        window.location.href = 'tienda.html';
        return;
    }

    // 1. Cargar Configuración
    await applyStoreConfig();
    renderSummary();
    setupEventListeners();
    
    // 2. Auth Listener (Autofill)
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
            if (snap.exists()) {
                userProfile = snap.data();
                autofillData(userProfile);
            }
        }
        // Ocultar loader una vez que sabemos si hay usuario o no
        hideGlobalLoader();
    });

    // Fallback por si Auth tarda demasiado
    setTimeout(hideGlobalLoader, 3000);
}

function hideGlobalLoader() {
    const loader = document.getElementById('loader-global');
    const container = document.getElementById('checkout-main-container');
    if (loader && !loader.classList.contains('hidden')) {
        loader.classList.add('hidden');
        if (container) container.classList.add('ready');
    }
}

async function applyStoreConfig() {
    try {
        const snap = await getDoc(doc(db, "configuracion", "tienda"));
        if (!snap.exists()) return;
        const config = snap.data();

        // 1. Delivery
        if (config.delivery?.habilitado === false) {
            const deliveryCard = document.querySelector('.method-card[data-method="delivery"]');
            if (deliveryCard) deliveryCard.style.display = 'none';
            deliveryMethod = 'pickup';
        }

        // 2. Pagos
        const mpEnabled = config.pagos?.mercadopago !== false;
        const transferEnabled = config.pagos?.transferencia?.habilitado !== false;
        const cashEnabled = config.pagos?.efectivo?.habilitado === true;

        let paymentOptionsHTML = "";
        if (mpEnabled) paymentOptionsHTML += `<option value="mercadopago">Mercado Pago</option>`;
        if (transferEnabled) paymentOptionsHTML += `<option value="transferencia">Transferencia Bancaria</option>`;
        if (cashEnabled) paymentOptionsHTML += `<option value="efectivo">Efectivo / En Local</option>`;

        if (paymentMethod) paymentMethod.innerHTML = paymentOptionsHTML;

        // 3. Info de pagos
        if (config.pagos?.transferencia?.info) {
             if (transferInfo) {
                 transferInfo.innerHTML = `
                    <p style="margin-top:0"><strong>Datos para transferir:</strong></p>
                    <p style="white-space: pre-wrap; font-family: 'Inter', sans-serif;">${config.pagos.transferencia.info}</p>
                    <p style="margin-bottom:0; font-size:11px; opacity:0.8;">* Una vez realizado el pedido, enviá el comprobante por WhatsApp.</p>
                 `;
             }
        }

        if (config.pagos?.efectivo?.info) {
            const cashInfoEl = document.createElement('div');
            cashInfoEl.id = 'cash-info';
            cashInfoEl.style.cssText = "display: none; padding: 15px; background: #fdfaf0; border-radius: 12px; border: 1px solid #f2e9d0; font-size: 13px; color: #4d4430; margin-top: 10px;";
            cashInfoEl.innerHTML = `<p style="margin:0; white-space: pre-wrap;">${config.pagos.efectivo.info}</p>`;
            transferInfo.parentNode.insertBefore(cashInfoEl, transferInfo.nextSibling);
        }

        // 4. Agenda
        initAgendaPicker(config.agenda);
        
    } catch (err) {
        console.error("Error applying config:", err);
    }
}

function initAgendaPicker(agendaConfig) {
    const minDays = agendaConfig?.minAnticipacion || 0;
    const blockedDates = agendaConfig?.fechasBloqueadas || [];
    const workingDays = agendaConfig?.diasSemana || [0, 1, 2, 3, 4, 5, 6];

    const minDate = new Date();
    // Ajuste por zona horaria local para evitar saltos raros
    minDate.setHours(0,0,0,0);
    minDate.setDate(minDate.getDate() + minDays);

    flatpickr("#order-schedule", {
        locale: "es",
        minDate: minDate,
        dateFormat: "l d/m/Y",
        disable: [
            function(date) {
                // date.getDay() devuelve 0 para domingo, 1 para lunes, etc.
                return !workingDays.includes(date.getDay());
            },
            ...blockedDates
        ],
        // Si el primer día calculado está deshabilitado, flatpickr buscará el siguiente automáticamente al abrir
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
        const val = e.target.value;
        const cInfo = document.getElementById('cash-info');

        if (transferInfo) transferInfo.style.display = (val === 'transferencia') ? 'block' : 'none';
        if (cInfo) cInfo.style.display = (val === 'efectivo') ? 'block' : 'none';
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
