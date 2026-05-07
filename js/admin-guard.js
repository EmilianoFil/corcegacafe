/**
 * admin-guard.js
 * Protección centralizada para todas las páginas de administración.
 * Si el usuario logueado NO está en ADMIN_EMAILS ni en la colección "admins"
 * de Firestore, lo desloguea y manda al login de admin.
 */
import { auth, onAuthStateChanged } from './firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = getFirestore();

// Lista maestra de emails autorizados como admin
export const ADMIN_EMAILS = ['emilianofilgueira@gmail.com', 'lemacafesrl@gmail.com'];

/**
 * Llama a onAuthStateChanged, verifica permisos de admin y ejecuta el callback
 * solo si el usuario es admin legítimo.
 * @param {function(user: User): void} onAdmin - callback con el usuario verificado
 */
export function requireAdmin(onAdmin) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        // Verificar en colección "admins" (usada por el login de Google)
        // y en "admin" (datos completos del admin)
        const [adminsSnap, adminSnap] = await Promise.all([
            getDoc(doc(db, 'admins', user.uid)),
            getDoc(doc(db, 'admin', user.uid))
        ]);

        const isAdmin = ADMIN_EMAILS.includes(user.email)
            || adminsSnap.exists()
            || adminSnap.exists();

        if (!isAdmin) {
            console.warn('[admin-guard] Acceso denegado para:', user.email);
            await auth.signOut();
            window.location.href = 'login.html';
            return;
        }

        onAdmin(user, adminSnap.exists() ? adminSnap.data() : null);
    });
}
