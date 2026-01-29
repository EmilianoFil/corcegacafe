import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    doc,
    setDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Fetches all badges marked as active in the database.
 * @param {Firestore} db - Firebase Firestore instance.
 * @returns {Promise<Array>} List of active badge documents.
 */
export async function fetchActiveBadges(db) {
    const q = query(collection(db, "badges"), where("activo", "==", true));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Evaluates which badges a client is eligible for based on their current data.
 * @param {Object} params
 * @param {Object} params.clienteData - Current client data from Firestore.
 * @param {Array} params.badges - List of active badges to evaluate.
 * @returns {Array} List of badge objects the client qualifies for.
 */
export function computeAutoBadgesForClient({ clienteData, badges }) {
    if (!clienteData) return [];

    return badges.filter(badge => {
        if (badge.tipoAsignacion === 'manual') return false;
        if (!badge.regla) return false;

        const { campo, operador, valor } = badge.regla;
        const valorCliente = clienteData[campo];

        // Se el cliente no tiene el campo, no califica (a menos que el operador sea !=)
        if (valorCliente === undefined && operador !== '!=') return false;

        switch (operador) {
            case '>': return valorCliente > valor;
            case '>=': return valorCliente >= valor;
            case '<': return valorCliente < valor;
            case '<=': return valorCliente <= valor;
            case '==': return valorCliente == valor;
            case '!=': return valorCliente != valor;
            default: return false;
        }
    });
}

/**
 * Assigns a badge to a client if they don't already have it.
 * @param {Object} params
 * @param {Firestore} params.db - Firestore instance.
 * @param {string} params.dni - Client DNI.
 * @param {Object} params.badgeDoc - Badge info (id, slug, nombre).
 * @param {string} params.origen - 'manual' or 'auto'.
 * @param {string} params.asignadoPor - Admin email or 'system'.
 */
export async function assignBadgeToClient({ db, dni, badgeDoc, origen, asignadoPor }) {
    const badgeSlug = badgeDoc.slug;
    const badgeSubcollRef = doc(db, "clientes", dni, "badges", badgeSlug);

    // Check if client already has this badge (using slug as ID for easier check)
    const existingSnap = await getDoc(badgeSubcollRef);
    if (existingSnap.exists()) {
        console.log(`Cliente ${dni} ya tiene el badge ${badgeSlug}.`);
        return;
    }

    await setDoc(badgeSubcollRef, {
        badgeId: badgeDoc.id,
        slug: badgeSlug,
        nombre: badgeDoc.nombre,
        origen: origen,
        asignadoPor: asignadoPor,
        obtenidoEn: serverTimestamp()
    });

    console.log(`Badge ${badgeSlug} asignado a ${dni}.`);
}

/**
 * Utility for debugging: simulates which auto badges a client should have.
 * @param {Firestore} db
 * @param {string} dni
 */
export async function simulateAutoBadgesForDni(db, dni) {
    const clientSnap = await getDoc(doc(db, "clientes", dni));
    if (!clientSnap.exists()) {
        console.error("Cliente no encontrado.");
        return;
    }

    const clienteData = clientSnap.data();
    const activeBadges = await fetchActiveBadges(db);
    const eligible = computeAutoBadgesForClient({ clienteData, badges: activeBadges });

    console.log(`--- Simulación de Badges para ${dni} ---`);
    console.log(`Datos: ${clienteData.nombre}, Totales: ${clienteData.cafes_acumulados_total}`);
    console.log(`Badges elegibles:`, eligible.map(b => b.nombre));
}
