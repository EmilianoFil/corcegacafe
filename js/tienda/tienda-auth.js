import { app, db, auth } from '../firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signInWithPopup, 
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc, setDoc, getDocs, query, collection, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- ELEMENTS ---
const authView = document.getElementById('auth-view');
const profileView = document.getElementById('profile-view');
const ordersList = document.getElementById('orders-list');
const userName = document.getElementById('user-name');
const userDni = document.getElementById('user-dni');

// --- BUTTONS ---
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register');
const btnGoogle = document.getElementById('btn-google');

const googleProvider = new GoogleAuthProvider();

// --- INITIALIZATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Redirección inmediata si venimos del checkout
        const redirect = sessionStorage.getItem('redirectAfterLogin');
        if (redirect) {
            sessionStorage.removeItem('redirectAfterLogin');
            window.location.href = redirect;
            return;
        }
        
        // Si no hay redirección, mostrar perfil normal
        showProfile(user);
    } else {
        // User logged out
        authView.style.display = 'block';
        profileView.style.display = 'none';
        localStorage.removeItem('corcega_tienda_dni');

        // Detectar si queremos mostrar Registro directamente
        if (window.location.hash === '#register') {
            toggleAuth('register');
        }
    }
});

if (btnLogin) btnLogin.onclick = handleLogin;
if (btnRegister) btnRegister.onclick = handleRegister;
if (btnGoogle) btnGoogle.onclick = handleGoogleLogin;

// --- LOGIC ---
async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    if (!email || !pass) return alert("Completá email y clave.");

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        console.error(err);
        alert("Error: Usuario o contraseña incorrectos.");
    }
}

async function handleGoogleLogin() {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (err) {
        console.error(err);
        alert("Error al ingresar con Google.");
    }
}

async function handleRegister() {
    const nombre = document.getElementById('reg-nombre').value.trim();
    const dni = document.getElementById('reg-dni').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const tel = document.getElementById('reg-tel').value.trim();
    const pass = document.getElementById('reg-pass').value.trim();

    if (!nombre || !dni || !email || !pass) return alert("Por favor completá los campos obligatorios.");
    if (pass.length < 6) return alert("La clave debe tener al menos 6 caracteres.");

    try {
        // 1. Crear usuario en Firebase Auth
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        const user = cred.user;

        // 2. Guardar datos extras en Firestore
        await setDoc(doc(db, "usuarios_tienda", user.uid), {
            uid: user.uid,
            dni, nombre, email, whatsapp: tel,
            creado: serverTimestamp()
        });

        // 3. Vincular con Cafecitos
        const loyaltyRef = doc(db, "clientes", dni);
        const loyaltySnap = await getDoc(loyaltyRef);
        if (!loyaltySnap.exists()) {
            await setDoc(loyaltyRef, {
                dni, nombre, email, cafes: 0,
                tienda_uid: user.uid,
                creado: serverTimestamp()
            });
        }

    } catch (err) {
        console.error(err);
        alert("Error al registrar: " + err.message);
    }
}

async function showProfile(user) {
    authView.style.display = 'none';
    profileView.style.display = 'block';
    
    // Traer datos extras de Firestore
    const snap = await getDoc(doc(db, "usuarios_tienda", user.uid));
    let dni = "";
    let whatsapp = "";
    let diaRec = "";
    let mesRec = "";

    if (snap.exists()) {
        const data = snap.data();
        userName.innerText = `¡Hola, ${data.nombre || user.displayName || user.email.split('@')[0]}!`;
        userDni.innerText = data.dni ? `DNI: ${data.dni}` : "Falta vincular DNI";
        dni = data.dni;
        whatsapp = data.whatsapp || "";
        diaRec = data.nacimiento_dia || "";
        mesRec = data.nacimiento_mes || "";
        
        document.getElementById('dni-link-section').style.display = data.dni ? 'none' : 'block';
        
        if (dni) {
            localStorage.setItem('corcega_tienda_dni', dni);
            localStorage.setItem('corcega_tienda_nombre', data.nombre);
        }
    } else {
        userName.innerText = `¡Hola, ${user.displayName || user.email}!`;
        userDni.innerText = "Registrá tu DNI para ver tus pedidos.";
        document.getElementById('dni-link-section').style.display = 'block';
    }

    // --- AUTOPRELOAD FROM LOYALTY ---
    if (dni) {
        const loyaltySnap = await getDoc(doc(db, "clientes", dni));
        if (loyaltySnap.exists()) {
            const loyData = loyaltySnap.data();
            // En el club de fidelidad los campos se llaman cumple_dia, cumple_mes y telefono
            if (!whatsapp) whatsapp = loyData.telefono || loyData.whatsapp || "";
            if (!diaRec && loyData.cumple_dia) diaRec = loyData.cumple_dia;
            if (!mesRec && loyData.cumple_mes) mesRec = loyData.cumple_mes;
        }
    }

    // Populate fields
    document.getElementById('user-tel-input').value = whatsapp;
    document.getElementById('user-nac-dia').value = diaRec;
    document.getElementById('user-nac-mes').value = mesRec;

    // El fetch de órdenes ahora es más inteligente
    fetchOrders(dni, user.email);
    loadAddresses(user.uid);
}

// --- SAVE DATA ---
const btnSaveData = document.getElementById('btn-save-data');
if (btnSaveData) {
    btnSaveData.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const whatsapp = document.getElementById('user-tel-input').value.trim();
        const dia = document.getElementById('user-nac-dia').value.trim();
        const mes = document.getElementById('user-nac-mes').value.trim();

        try {
            await setDoc(doc(db, "usuarios_tienda", user.uid), {
                whatsapp,
                nacimiento_dia: dia,
                nacimiento_mes: mes,
                actualizado: serverTimestamp()
            }, { merge: true });
            alert("¡Datos guardados correctamente!");
        } catch (err) {
            console.error(err);
            alert("Error al guardar datos.");
        }
    };
}

// --- ADDRESSES LOGIC ---
window.showAddAddressForm = () => {
    document.getElementById('address-form').style.display = 'block';
};

const btnSaveAddress = document.getElementById('btn-save-address');
if (btnSaveAddress) {
    btnSaveAddress.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const alias = document.getElementById('addr-alias').value.trim();
        const calle = document.getElementById('addr-calle').value.trim();
        const num = document.getElementById('addr-num').value.trim();
        const piso = document.getElementById('addr-piso').value.trim();
        const nota = document.getElementById('addr-nota').value.trim();

        if (!alias || !calle || !num) return alert("Completá alias, calle y número.");

        try {
            const userRef = doc(db, "usuarios_tienda", user.uid);
            const userSnap = await getDoc(userRef);
            let addresses = [];
            if (userSnap.exists()) {
                addresses = userSnap.data().direcciones || [];
            }
            
            const newAddr = { id: Date.now(), alias, calle, num, piso, nota };
            addresses.push(newAddr);

            await setDoc(userRef, { direcciones: addresses }, { merge: true });
            
            alert("Dirección guardada.");
            document.getElementById('address-form').style.display = 'none';
            loadAddresses(user.uid);
        } catch (err) {
            console.error(err);
            alert("Error al guardar dirección.");
        }
    };
}

async function loadAddresses(uid) {
    const addressesList = document.getElementById('addresses-list');
    const snap = await getDoc(doc(db, "usuarios_tienda", uid));
    if (snap.exists() && snap.data().direcciones && snap.data().direcciones.length > 0) {
        addressesList.innerHTML = snap.data().direcciones.map(addr => `
            <div class="address-card">
                <div>
                    <strong style="font-size: 13px;">${addr.alias.toUpperCase()}</strong><br>
                    <span style="font-size: 12px; opacity: 0.8;">${addr.calle} ${addr.num} ${addr.piso ? '('+addr.piso+')' : ''}</span>
                    ${addr.nota ? `<br><small style="font-style:italic; opacity:0.6;">${addr.nota}</small>` : ''}
                </div>
                <button onclick="deleteAddress(${addr.id})" style="background:none; border:none; color:red; cursor:pointer;"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');
    } else {
        addressesList.innerHTML = '<p style="font-size:12px; opacity:0.6; text-align:center;">No tenés direcciones guardadas.</p>';
    }
}

window.deleteAddress = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    if (!confirm("¿Borrar esta dirección?")) return;

    try {
        const userRef = doc(db, "usuarios_tienda", user.uid);
        const snap = await getDoc(userRef);
        const addresses = (snap.data().direcciones || []).filter(a => a.id !== id);
        await setDoc(userRef, { direcciones: addresses }, { merge: true });
        loadAddresses(user.uid);
    } catch (err) {
        console.error(err);
    }
}

// Botón para vincular DNI después de entrar con Google
const btnLinkDni = document.getElementById('btn-link-dni');
if (btnLinkDni) {
    btnLinkDni.onclick = async () => {
        const dni = document.getElementById('link-dni-input').value.trim();
        if (!dni) return alert("Ingresá tu DNI.");
        
        const user = auth.currentUser;
        if (!user) return;

        try {
            await setDoc(doc(db, "usuarios_tienda", user.uid), {
                uid: user.uid,
                email: user.email,
                nombre: user.displayName || user.email.split('@')[0],
                dni: dni,
                whatsapp: "",
                direcciones: [],
                actualizado: serverTimestamp()
            }, { merge: true });
            
            alert("¡DNI vinculado! Cargando tus datos...");
            showProfile(user);
        } catch (err) {
            console.error(err);
            alert("Error al vincular DNI.");
        }
    };
}

async function fetchOrders(dni, email) {
    ordersList.innerHTML = '<p style="font-size:12px; opacity:0.6;">Cargando tus pedidos...</p>';
    
    try {
        let orders = [];

        // 1. Buscar por DNI (Prioridad)
        if (dni) {
            const qDni = query(
                collection(db, "ordenes"),
                where("cliente.dni", "==", dni),
                orderBy("timestamp", "desc")
            );
            const snapDni = await getDocs(qDni);
            snapDni.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
        }

        // 2. Buscar por Email (Seguro)
        if (email) {
            const qEmail = query(
                collection(db, "ordenes"),
                where("cliente.email", "==", email),
                orderBy("timestamp", "desc")
            );
            const snapEmail = await getDocs(qEmail);
            snapEmail.forEach(doc => {
                // Evitar duplicados si ya lo encontramos por DNI
                if (!orders.find(o => o.id === doc.id)) {
                    orders.push({ id: doc.id, ...doc.data() });
                }
            });
        }

        if (orders.length === 0) {
            ordersList.innerHTML = '<div class="order-card" style="text-align:center; opacity:0.6;">Aún no tenés pedidos registrados.</div>';
            return;
        }

        // Ordenar por fecha (ya que combinamos dos queries)
        orders.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        ordersList.innerHTML = orders.map(order => {
            const date = order.timestamp ? order.timestamp.toDate().toLocaleDateString('es-AR') : '-';
            return `
                <div class="order-card">
                    <div class="order-header">
                        <span style="font-weight:700; color:var(--panel-oscuro);">Pedido #${order.id.substring(0,8)}</span>
                        <span class="order-status status-${order.estado || 'pendiente_pago'}">${formatStatus(order.estado)}</span>
                    </div>
                    <div style="font-size:13px; margin-bottom:10px; color:var(--texto-muted);">${date}</div>
                    <div style="font-size:13px; border-top:1px solid #eee; padding-top:10px;">
                        ${order.items.map(item => `${item.qty}x ${item.nombre}`).join('<br>')}
                    </div>
                    <div style="margin-top:10px; padding-top:10px; border-top:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:700; color:var(--panel-oscuro);">$${order.total.toLocaleString('es-AR')}</span>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                            ${order.estado === 'pendiente_pago' 
                                ? (order.metodoPago === 'transferencia' 
                                    ? `<a href="https://wa.me/5491136053892?text=${encodeURIComponent('Hola Córcega! Adjunto comprobante del pedido #' + order.id.substring(0,6))}" target="_blank" style="background:#25d366; border:none; color:white; padding:6px 15px; border-radius:100px; font-size:11px; font-weight:800; cursor:pointer; text-decoration:none; display:flex; align-items:center; gap:5px;"><img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" style="width:14px; height:14px;"> COMPROBANTE</a>
                                       <button onclick="payOrder('${order.id}', this)" style="background:var(--naranja-accent); border:none; color:white; padding:6px 15px; border-radius:100px; font-size:11px; font-weight:800; cursor:pointer;">PAGAR MP</button>`
                                    : `<button onclick="payOrder('${order.id}', this)" style="background:var(--naranja-accent); border:none; color:white; padding:6px 15px; border-radius:100px; font-size:11px; font-weight:800; cursor:pointer;">PAGAR CON MERCADOPAGO</button>`)
                                : ''}
                            <button onclick="window.location.href='success.html?orderId=${order.id}'" style="background:none; border:2px solid var(--naranja-accent); color:var(--naranja-accent); padding:6px 15px; border-radius:100px; font-size:11px; font-weight:800; cursor:pointer;">VER SEGUIMIENTO</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error(err);
        ordersList.innerHTML = '<p style="color:red; font-size:12px;">Error al cargar pedidos.</p>';
    }
}

window.payOrder = async (orderId, btn) => {
    const originalText = btn.innerText;
    btn.innerText = "Redirigiendo... ⏳";
    btn.disabled = true;

    try {
        const successUrl = window.location.origin + "/success.html?orderId=" + orderId;
        const response = await fetch('https://crearpreferenciamp-ioo4dzpz2a-uc.a.run.app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, successUrl })
        });
        
        const data = await response.json();
        if (data.init_point) {
            window.location.href = data.init_point;
        } else {
            alert("No pudimos generar el link de pago.");
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert("Error al conectar con Mercado Pago.");
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

function formatStatus(status) {
    const map = {
        'pendiente_pago': '🕒 Pendiente',
        'pagado': '💰 Pagado',
        'en_preparacion': '☕ Preparando',
        'listo': '📦 Listo',
        'en_camino': '🛵 En camino',
        'entregado': '✅ Entregado',
        'cancelado': '❌ Cancelado',
        'rechazado': '🚫 Rechazado'
    };
    return map[status] || '🕒 Pendiente';
}

// Interfaz de Navegación de Solapas (Tabs)
window.showTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
};

window.logout = () => {
    signOut(auth);
};
