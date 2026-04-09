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
        // User logged in
        showProfile(user);
    } else {
        // User logged out
        authView.style.display = 'block';
        profileView.style.display = 'none';
        localStorage.removeItem('corcega_tienda_dni');
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
    if (snap.exists()) {
        const data = snap.data();
        userName.innerText = `¡Hola, ${data.nombre || user.displayName || user.email.split('@')[0]}!`;
        userDni.innerText = data.dni ? `DNI: ${data.dni}` : "Falta vincular DNI";
        dni = data.dni;
        
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

    // El fetch de órdenes ahora es más inteligente
    fetchOrders(dni, user.email);
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
    return map[status] || '🕒 Pendiente';
}

window.logout = () => {
    signOut(auth);
};
