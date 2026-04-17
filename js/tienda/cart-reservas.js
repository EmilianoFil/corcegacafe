// FIRESTORE RULES NEEDED:
// match /reservas/{id} {
//   allow read: if true;
//   allow write: if true; // sessionId is set by client, low-security data
// }

import { db } from '../firebase-config.js';
import { doc, setDoc, deleteDoc, getDocs, collection, query, where, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const CART_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function getSessionId() {
    let id = localStorage.getItem('corcega_session_id');
    if (!id) {
        id = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
        localStorage.setItem('corcega_session_id', id);
    }
    return id;
}

export function getReservaId(productId, variantKey) {
    return `${getSessionId()}_${productId}_${variantKey || 'base'}`;
}

// Write or update a reservation. qty=0 deletes it.
export async function writeReserva(productId, variantKey, qty, nombre) {
    const id = getReservaId(productId, variantKey);
    if (qty <= 0) {
        await deleteDoc(doc(db, 'reservas', id));
        return;
    }
    const expiresAt = Timestamp.fromMillis(Date.now() + CART_TIMEOUT_MS);
    await setDoc(doc(db, 'reservas', id), {
        sessionId: getSessionId(),
        productId,
        variantKey: variantKey || null,
        qty,
        nombre,
        expiresAt
    });
}

export async function deleteReserva(productId, variantKey) {
    await deleteDoc(doc(db, 'reservas', getReservaId(productId, variantKey)));
}

export async function deleteAllSessionReservas() {
    const sessionId = getSessionId();
    const snap = await getDocs(query(collection(db, 'reservas'), where('sessionId', '==', sessionId)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// Returns a map: { "productId_variantKey": reservedQty } for reservations by OTHER sessions
// Only includes non-expired reservations
export async function fetchReservedByOthers() {
    const sessionId = getSessionId();
    const now = Timestamp.now();
    const snap = await getDocs(collection(db, 'reservas'));
    const map = {};
    snap.docs.forEach(d => {
        const data = d.data();
        if (data.sessionId === sessionId) return; // skip own
        if (data.expiresAt.toMillis() <= now.toMillis()) return; // skip expired
        const key = `${data.productId}_${data.variantKey || 'base'}`;
        map[key] = (map[key] || 0) + data.qty;
    });
    return map;
}
