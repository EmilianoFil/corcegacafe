import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    doc,
    setDoc,
    serverTimestamp,
    orderBy,
    limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Fetches all badges marked as active.
 */
export async function fetchActiveBadges(db) {
    const q = query(collection(db, "badges"), where("activo", "==", true));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Fetches all named rules from the rules library.
 */
export async function fetchRulesLibrary(db) {
    const snap = await getDocs(collection(db, "reglas_badges"));
    const library = {};
    snap.forEach(d => {
        library[d.id] = d.data();
    });
    return library;
}

/**
 * Evaluates which badges a client is eligible for.
 * @param {Object} params
 * @param {Object} params.clienteData - Firestore data of the client.
 * @param {Array} params.badges - Active badges.
 * @param {Object} params.rulesLibrary - Pre-fetched rules dictionary.
 * @param {Array} params.recentLogs - Last logs of the client (for frequency checks).
 * @param {Date} params.now - Current time context.
 */
export function computeAutoBadgesForClient({ clienteData, badges, rulesLibrary, recentLogs = [], now = new Date() }) {
    if (!clienteData) return [];

    return badges.filter(badge => {
        if (badge.tipoAsignacion === 'manual') return false;

        // El badge puede tener la regla fija (legacy) o un ID de regla de la librería
        const regla = badge.reglaId ? rulesLibrary[badge.reglaId] : badge.regla;
        if (!regla) return false;

        const { categoria, config } = regla;

        // Si la regla no tiene categoría, asumimos que es el formato viejo de "campo/operacdo/valor"
        if (!categoria) {
            return evaluateFieldRule(clienteData, regla);
        }

        switch (categoria) {
            case 'dato':
                return evaluateFieldRule(clienteData, config);
            case 'horario':
                return evaluateTimeRule(now, config);
            case 'frecuencia':
                return evaluateFrequencyRule(recentLogs, config, now);
            default:
                return false;
        }
    });
}

function evaluateFieldRule(data, config) {
    const { campo, operador, valor } = config;
    const valorCliente = data[campo];
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
}

function evaluateTimeRule(now, config) {
    const { horaInicio, horaFin, dias } = config; // dias: [1,2,3,4,5,6,0]
    const horaActual = now.getHours();
    const diaActual = now.getDay();

    if (dias && Array.isArray(dias) && !dias.includes(diaActual)) return false;

    // Si no hay horas definidas, solo chequea días
    if (horaInicio === undefined || horaFin === undefined) return true;

    return horaActual >= horaInicio && horaActual < horaFin;
}

function evaluateFrequencyRule(logs, config, now) {
    const { cantidadVisitas, diasRango } = config;
    if (!logs || logs.length === 0) return false;

    const msLimite = diasRango * 24 * 60 * 60 * 1000;
    const timestampLimite = now.getTime() - msLimite;

    const visitasRecientes = logs.filter(l => {
        const ts = l.timestamp?.toDate ? l.timestamp.toDate().getTime() : new Date(l.timestamp).getTime();
        return ts >= timestampLimite && (l.accion === 'sumar_cafecito' || l.accion === 'invitar_cafecito');
    });

    return visitasRecientes.length >= cantidadVisitas;
}

/**
 * Assigns a badge to a client.
 */
export async function assignBadgeToClient({ db, dni, badgeDoc, origen, asignadoPor }) {
    const badgeSlug = badgeDoc.slug;
    const badgeSubcollRef = doc(db, "clientes", dni, "badges", badgeSlug);

    const existingSnap = await getDoc(badgeSubcollRef);
    if (existingSnap.exists()) return;

    await setDoc(badgeSubcollRef, {
        badgeId: badgeDoc.id,
        slug: badgeSlug,
        nombre: badgeDoc.nombre,
        origen: origen,
        asignadoPor: asignadoPor,
        obtenidoEn: serverTimestamp()
    });
}
