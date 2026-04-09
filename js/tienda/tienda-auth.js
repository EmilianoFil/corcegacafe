import { db } from '../firebase-config.js';
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

// --- INITIALIZATION ---
async function init() {
    const sessionDni = localStorage.getItem('corcega_tienda_dni');
    if (sessionDni) {
        showProfile(sessionDni);
    }

    if (btnLogin) btnLogin.onclick = handleLogin;
    if (btnRegister) btnRegister.onclick = handleRegister;
}

// --- LOGIC ---
async function handleLogin() {
    const dni = document.getElementById('login-dni').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    if (!dni || !pass) return alert("Completá todos los campos.");

    try {
        const userRef = doc(db, "usuarios_tienda", dni);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
            const userData = snap.data();
            if (userData.password === pass) {
                localStorage.setItem('corcega_tienda_dni', dni);
                localStorage.setItem('corcega_tienda_nombre', userData.nombre);
                showProfile(dni);
            } else {
                alert("PIN/Clave incorrecta.");
            }
        } else {
            alert("No encontramos una cuenta con ese DNI. Por favor registrate.");
        }
    } catch (err) {
        console.error(err);
        alert("Error al iniciar sesión.");
    }
}

async function handleRegister() {
    const nombre = document.getElementById('reg-nombre').value.trim();
    const dni = document.getElementById('reg-dni').value.trim();
    const email = document.getElementById('reg-mail').value.trim();
    const tel = document.getElementById('reg-tel').value.trim();
    const pass = document.getElementById('reg-pass').value.trim();

    if (!nombre || !dni || !email || !pass) return alert("Por favor completá los campos obligatorios.");
    if (pass.length < 4) return alert("La clave debe tener al menos 4 caracteres.");

    try {
        const userRef = doc(db, "usuarios_tienda", dni);
        const existing = await getDoc(userRef);
        if (existing.exists()) return alert("Ya existe una cuenta con este DNI.");

        // 1. Guardar en Usuarios Tienda
        const userStoreData = {
            dni, nombre, email, whatsapp: tel, password: pass,
            creado: serverTimestamp()
        };
        await setDoc(userRef, userStoreData);

        // 2. Vinculación inteligente con Cafecitos (Loyalty)
        const loyaltyRef = doc(db, "clientes", dni);
        const loyaltySnap = await getDoc(loyaltyRef);
        
        if (!loyaltySnap.exists()) {
            // Lo creamos en cafecitos también para que ya tenga su tarjeta
            await setDoc(loyaltyRef, {
                dni, nombre, email, cafes: 0, 
                tienda_active: true, // Tip para saber que viene de la tienda
                creado: serverTimestamp()
            });
        }

        localStorage.setItem('corcega_tienda_dni', dni);
        localStorage.setItem('corcega_tienda_nombre', nombre);
        showProfile(dni);

    } catch (err) {
        console.error(err);
        alert("Error al registrar cuenta.");
    }
}

async function showProfile(dni) {
    authView.style.display = 'none';
    profileView.style.display = 'block';
    
    userName.innerText = `¡Hola, ${localStorage.getItem('corcega_tienda_nombre')}!`;
    userDni.innerText = `DNI: ${dni}`;

    fetchOrders(dni);
}

async function fetchOrders(dni) {
    ordersList.innerHTML = '<p style="font-size:12px; opacity:0.6;">Cargando tus pedidos...</p>';
    
    try {
        const q = query(
            collection(db, "ordenes"),
            where("cliente.dni", "==", dni),
            orderBy("timestamp", "desc")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            ordersList.innerHTML = '<div class="order-card" style="text-align:center; opacity:0.6;">Aún no tenés pedidos realizados.</div>';
            return;
        }

        ordersList.innerHTML = snap.docs.map(doc => {
            const order = doc.data();
            const date = order.timestamp ? order.timestamp.toDate().toLocaleDateString('es-AR') : '-';
            return `
                <div class="order-card">
                    <div class="order-header">
                        <span style="font-weight:700; color:var(--panel-oscuro);">Pedido #${doc.id.substring(0,8)}</span>
                        <span class="order-status status-${order.estado}">${formatStatus(order.estado)}</span>
                    </div>
                    <div style="font-size:13px; margin-bottom:10px; color:var(--texto-muted);">${date}</div>
                    <div style="font-size:13px; border-top:1px solid #eee; padding-top:10px;">
                        ${order.items.map(item => `${item.qty}x ${item.nombre}`).join('<br>')}
                    </div>
                    <div style="margin-top:10px; font-weight:700; text-align:right;">
                        TOTAL: $${order.total.toLocaleString('es-AR')}
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error(err);
        ordersList.innerHTML = '<p style="color:red; font-size:12px;">Error al cargar pedidos.</p>';
    }
}

function formatStatus(status) {
    const map = {
        'pendiente_pago': '🕒 Pendiente',
        'pagado': '💰 Pagado',
        'en_preparacion': '☕ Preparando',
        'listo': '📦 Listo',
        'en_camino': '🛵 En camino',
        'entregado': '✅ Entregado'
    };
    return map[status] || status;
}

window.logout = () => {
    localStorage.removeItem('corcega_tienda_dni');
    localStorage.removeItem('corcega_tienda_nombre');
    window.location.reload();
};

init();
