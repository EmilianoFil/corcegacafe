import { db, auth } from '../firebase-config.js';
console.log("=== CHECKOUT V4 ACTIVE (NO ALERT) ===");
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, serverTimestamp, doc, getDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { deleteAllSessionReservas } from './cart-reservas.js';

// --- STATE ---
let cart = JSON.parse(localStorage.getItem('corcega_cart')) || [];
let deliveryMethod = 'pickup';
let userProfile = null;
let processing = false;

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

    // 1. Fallback de seguridad (Si en 3.5s no cargó, mostramos igual)
    setTimeout(showContent, 3500);

    // 2. Auth Listener (Autofill) - Esto suele ser lo que más tarda
    onAuthStateChanged(auth, async (user) => {
        const loginModal = document.getElementById('login-mini-modal');
        try {
            if (user) {
                if (loginModal) loginModal.style.display = 'none';
                const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
                if (snap.exists()) {
                    userProfile = snap.data();
                    autofillData(userProfile);
                } else {
                    // Logueado pero sin perfil: cambiar botón a "Editar mis datos"
                    const loginBtn = document.getElementById('btn-login-toggle');
                    if (loginBtn) {
                        loginBtn.innerHTML = '<i class="fas fa-edit"></i> Editar mis datos';
                        loginBtn.onclick = () => window.location.href = 'tienda-cuenta.html#datos';
                    }
                    validateForm();
                }
            }
        } catch (err) {
            console.error("Error in auth listener:", err);
        } finally {
            showContent();
        }
    });

    // 3. Cargar Configuración y Renderizar (Async sin bloquear el hilo principal)
    loadAsyncData();
}

async function loadAsyncData() {
    try {
        await applyStoreConfig();
        renderSummary();
        setupEventListeners();
    } catch (err) {
        console.error("Error loading async data:", err);
    } finally {
        showContent();
    }
}

function showContent() {
    const container = document.getElementById('checkout-main-container');
    if (container && !container.classList.contains('ready')) {
        container.classList.add('ready');
        console.log("Checkout ready.");
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

        if (paymentMethod) {
            paymentMethod.innerHTML = paymentOptionsHTML;
            // Texto inicial del botón según método por defecto
            updateFinalizarBtnLabel(paymentMethod.value);
        }

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
        await initAgendaPicker(config.agenda, config.agenda?.pedidosMaximosDia || 0);
        
    } catch (err) {
        console.error("Error applying config:", err);
    }
}

async function initAgendaPicker(agendaConfig, pedidosMaximosDia) {
    // 1. Find the most restrictive agenda config across all cart products
    let maxDias = agendaConfig?.minAnticipacion || 0;
    let mensajeAgenda = null;

    let anyRequiresAgenda = false;
    const productIds = [...new Set(cart.map(item => item.id).filter(Boolean))];
    if (productIds.length > 0) {
        const results = await Promise.allSettled(productIds.map(id => getDoc(doc(db, "productos", id))));
        for (const result of results) {
            if (result.status !== 'fulfilled') {
                console.warn("No se pudo leer producto para agenda:", result.reason);
                continue;
            }
            const snap = result.value;
            if (!snap.exists()) continue;
            const p = snap.data();
            if (!p.requiereAgenda) continue;

            anyRequiresAgenda = true;
            let dias = p.diasAnticipacion || 0;
            // Apply cutoff time: if now is past the cutoff hour, add +1 day
            if (p.horarioCorte) {
                const [hStr, mStr] = p.horarioCorte.split(':');
                const corte = new Date();
                corte.setHours(parseInt(hStr), parseInt(mStr), 0, 0);
                if (new Date() > corte) dias += 1;
            }
            // Update max days (most restrictive wins)
            if (dias > maxDias) maxDias = dias;
            // Collect the first mensaje from any agenda product that has one
            if (p.mensajeAgenda && !mensajeAgenda) mensajeAgenda = p.mensajeAgenda;
        }
    }

    // If no product requires agenda, hide the calendar and exit
    const scheduleGroup = document.getElementById('schedule-group');
    if (!anyRequiresAgenda) {
        if (scheduleGroup) scheduleGroup.style.display = 'none';
        return;
    }
    if (scheduleGroup) scheduleGroup.style.display = 'block';

    // 2. Show/hide agenda message
    const msgEl = document.getElementById('agenda-mensaje');
    if (msgEl) {
        msgEl.innerText = mensajeAgenda || '';
        msgEl.style.display = mensajeAgenda ? 'block' : 'none';
    }

    // 3. Calculate min date
    const minDate = new Date();
    minDate.setHours(0, 0, 0, 0);
    minDate.setDate(minDate.getDate() + maxDias);

    const blockedDates = agendaConfig?.fechasBloqueadas || [];
    const workingDays = agendaConfig?.diasSemana || [0, 1, 2, 3, 4, 5, 6];

    // 4. Fetch order counts per day for calendar coloring
    let orderCountByDate = {};
    let cartAgendaQty = 0;
    if (pedidosMaximosDia > 0) {
        try {
            // Solo contar ítems de productos que requieren agenda
            const agendaSnap = await getDocs(query(collection(db, 'productos'), where('requiereAgenda', '==', true)));
            const agendaIds = new Set(agendaSnap.docs.map(d => d.id));

            // Cuántos ítems de agenda trae el carrito actual
            cartAgendaQty = cart
                .filter(it => agendaIds.has(it.id))
                .reduce((s, it) => s + (it.qty || 1), 0);

            const ordersSnap = await getDocs(collection(db, "ordenes"));
            ordersSnap.docs.forEach(d => {
                const data = d.data();
                if (data.estado === 'cancelado') return;
                const iso = data.fechaISO || parseHorarioToISO(data.horario);
                if (iso) {
                    const totalItems = (data.items || [])
                        .filter(it => agendaIds.has(it.id))
                        .reduce((s, it) => s + (it.qty || 1), 0);
                    if (totalItems > 0) orderCountByDate[iso] = (orderCountByDate[iso] || 0) + totalItems;
                }
            });
            // Show legend
            const leyenda = document.getElementById('agenda-leyenda');
            if (leyenda) leyenda.style.display = 'flex';
        } catch (err) {
            console.error("Error fetching order counts for calendar:", err);
        }
    }

    // 5. Init flatpickr
    flatpickr("#order-schedule", {
        locale: "es",
        minDate: minDate,
        dateFormat: "l d/m/Y",
        disable: [
            function(date) {
                return !workingDays.includes(date.getDay());
            },
            ...blockedDates
        ],
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const d = dayElem.dateObj;
            d.setHours(0, 0, 0, 0);

            // Skip: past or before minDate
            if (d < minDate) return;
            // Skip: day of week not in workingDays
            if (!workingDays.includes(d.getDay())) return;
            // Skip: explicitly blocked date
            const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (blockedDates.includes(iso)) return;

            // Add a small colored dot below the day number
            const dot = document.createElement('span');
            dot.style.cssText = 'display:block; width:5px; height:5px; border-radius:50%; margin: 2px auto 0; flex-shrink:0;';

            if (pedidosMaximosDia > 0) {
                const count = orderCountByDate[iso] || 0;
                const effective = count + cartAgendaQty;
                const ratio = effective / pedidosMaximosDia;
                if (ratio >= 1) {
                    dot.style.background = '#ef4444';
                    dayElem.classList.add('flatpickr-disabled');
                    dayElem.title = cartAgendaQty > 0
                        ? `Tu carrito tiene ${cartAgendaQty} producto${cartAgendaQty === 1 ? '' : 's'} con agenda y este día no tiene lugar`
                        : 'Día completo';
                } else if (ratio >= 0.7) {
                    const remaining = pedidosMaximosDia - effective;
                    dot.style.background = '#f59e0b';
                    dayElem.title = `${remaining} lugar${remaining === 1 ? '' : 'es'} disponible${remaining === 1 ? '' : 's'}`;
                } else {
                    dot.style.background = '#22c55e';
                }
                dayElem.appendChild(dot);
            }
        }
    });
}

function parseHorarioToISO(horario) {
    // Parses flatpickr format "Lunes 21/04/2025" → "2025-04-21"
    if (!horario) return null;
    const match = horario.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    return `${year}-${month}-${day.padStart(2, '0')}`;
}

function lockField(id, value) {
    const el = document.getElementById(id);
    if (!el || !value) return;
    el.value = value;
    el.readOnly = true;
    el.style.background = '#f0f0f0';
    el.style.color = '#888';
    el.style.cursor = 'not-allowed';
}

function autofillData(profile) {
    lockField('client-name',  profile.nombre);
    lockField('client-phone', profile.whatsapp);
    lockField('client-dni',   profile.dni);
    lockField('client-email', profile.email || auth.currentUser?.email);

    // Transformar botón login → "Editar mis datos"
    const loginBtn = document.getElementById('btn-login-toggle');
    if (loginBtn) {
        loginBtn.innerHTML = '<i class="fas fa-edit"></i> Editar mis datos';
        loginBtn.onclick = () => window.location.href = 'tienda-cuenta.html#datos';
        loginBtn.style.display = 'flex';
    }
    const loginModal = document.getElementById('login-mini-modal');
    if (loginModal) loginModal.style.display = 'none';

    validateForm();

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
    // GA4: begin_checkout
    if (typeof gtag === 'function' && cart.length > 0) {
        const total = cart.reduce((s, i) => s + (i.precio * i.qty), 0);
        gtag('event', 'begin_checkout', {
            currency: 'ARS',
            value: total,
            items: cart.map(i => ({ item_id: i.id, item_name: i.nombre, item_variant: i.variantLabel || undefined, price: i.precio, quantity: i.qty }))
        });
    }

    checkoutItems.innerHTML = cart.map(item => `
        <div class="order-summary-item">
            <span>
                <span class="order-item-qty">${item.qty}x</span> ${item.nombre}
                ${item.variantLabel ? `<br><span style="font-size:0.72rem; color:var(--naranja-accent); font-weight:600;">${item.variantLabel}</span>` : ''}
            </span>
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
            deliveryGroup.style.display = (deliveryMethod === 'delivery') ? 'block' : 'none';
            validateForm();
        };
    });

    // Payment Method Toggles
    paymentMethod.onchange = (e) => {
        const val = e.target.value;
        const cInfo = document.getElementById('cash-info');
        if (transferInfo) transferInfo.style.display = (val === 'transferencia') ? 'block' : 'none';
        if (cInfo) cInfo.style.display = (val === 'efectivo') ? 'block' : 'none';
        updateFinalizarBtnLabel(val);
    };

    // Input listeners para validación en tiempo real
    ['client-name', 'client-email', 'client-phone', 'client-dni', 'client-address'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', validateForm);
    });
    document.getElementById('order-schedule')?.addEventListener('change', validateForm);

    // Final Action
    btnFinalizar.onclick = handleOrderSubmission;

    validateForm();
}

function updateFinalizarBtnLabel(metodoPago) {
    if (!btnFinalizar || processing) return;
    btnFinalizar.textContent = metodoPago === 'mercadopago' ? 'PAGAR CON MERCADO PAGO' : 'GENERAR PEDIDO';
}

function validateForm() {
    const nombre   = document.getElementById('client-name')?.value.trim();
    const email    = document.getElementById('client-email')?.value.trim();
    const whatsapp = document.getElementById('client-phone')?.value.trim();
    const dni      = document.getElementById('client-dni')?.value.trim();
    const scheduleGroup = document.getElementById('schedule-group');
    const scheduleVisible = scheduleGroup && scheduleGroup.style.display !== 'none';
    const horario  = document.getElementById('order-schedule')?.value;

    let valid = !!(nombre && email && whatsapp && dni);
    if (scheduleVisible && !horario) valid = false;
    if (deliveryMethod === 'delivery') {
        const direccion = document.getElementById('client-address')?.value.trim();
        if (!direccion) valid = false;
    }

    btnFinalizar.disabled = !valid;
    if (valid) updateFinalizarBtnLabel(paymentMethod?.value);
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

    processing = true;
    btnFinalizar.disabled = true;
    btnFinalizar.innerText = "Procesando pedido... ⏳";

    try {
        const total = cart.reduce((acc, item) => acc + (item.precio * item.qty), 0);
        const rawDni = localStorage.getItem('corcega_tienda_dni');
        const sessionDni = (rawDni && /^\d{7,8}$/.test(rawDni.trim())) ? rawDni.trim() : null;
        
        const orderData = {
            cliente: {
                nombre,
                email,
                whatsapp,
                dni: dni || sessionDni || null,
                direccion: deliveryMethod === 'delivery' ? direccion : 'Retiro en local'
            },
            items: cart,
            total,
            metodoEntrega: deliveryMethod,
            horario,
            fechaISO: parseHorarioToISO(horario),
            metodoPago,
            notas,
            estado: 'pendiente_pago',
            impreso: false,
            timestamp: serverTimestamp()
        };

        // 1. Guardar en Firestore
        const docRef = await addDoc(collection(db, "ordenes"), orderData);
        const orderId = docRef.id;

        // 2. Limpiar reservas de sesión
        try { await deleteAllSessionReservas(); } catch(e) { console.warn('Error clearing reservas:', e); }

        // 3. Lógica según método de pago
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
        processing = false;
        validateForm();
    }
}

function toggleLoginModal() {
    const modal = document.getElementById('login-mini-modal');
    if (modal) modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
}
window.toggleLoginModal = toggleLoginModal;

async function loginConGoogle() {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user') {
            console.error('Error al iniciar sesión:', err);
        }
    }
}
window.loginConGoogle = loginConGoogle;

async function loginConEmail() {
    const email = document.getElementById('co-login-email').value.trim();
    const pass  = document.getElementById('co-login-pass').value;
    if (!email || !pass) return alert('Completá email y clave.');
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        alert(['auth/wrong-password','auth/user-not-found','auth/invalid-credential'].includes(err.code)
            ? 'Email o clave incorrectos.' : 'Error al iniciar sesión.');
    }
}
window.loginConEmail = loginConEmail;

init();
