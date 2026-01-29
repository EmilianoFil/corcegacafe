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

export async function fetchActiveBadges(db) {
    const q = query(collection(db, "badges"), where("activo", "==", true));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Evaluates a rule or a group of rules recursively.
 */
function evaluateRuleNode(node, context) {
    if (!node) return false;

    // Is it a logical group? (AND / OR)
    if (node.operador === 'AND' || node.operador === 'OR') {
        if (!node.condiciones || node.condiciones.length === 0) return true; // Empty AND is true? Let's say false for safety if OR, true if AND.

        if (node.operador === 'AND') {
            return node.condiciones.every(c => evaluateRuleNode(c, context));
        } else {
            return node.condiciones.some(c => evaluateRuleNode(c, context));
        }
    }

    // Is it a simple rule?
    const { categoria, config } = node;
    const { clienteData, now, recentLogs } = context;

    switch (categoria) {
        case 'dato':
            return evaluateFieldRule(clienteData, config);
        case 'horario':
            return evaluateTimeRule(now, config);
        case 'frecuencia':
            return evaluateFrequencyRule(recentLogs, config, now);
        default:
            // Support legacy format where 'regla' was directly the config
            if (node.campo && node.operador) {
                return evaluateFieldRule(clienteData, node);
            }
            return false;
    }
}

function evaluateFieldRule(data, config) {
    if (!config) return false;
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
    if (!config) return false;
    const { horaInicio, horaFin, dias } = config;
    const horaActual = now.getHours();
    const diaActual = now.getDay();

    if (dias && Array.isArray(dias) && dias.length > 0 && !dias.includes(diaActual)) return false;

    if (horaInicio === undefined || horaFin === undefined) return true;

    return horaActual >= horaInicio && horaActual < horaFin;
}

function evaluateFrequencyRule(logs, config, now) {
    if (!config) return false;
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
 * Main function to compute eligibility.
 */
export function computeAutoBadgesForClient({ clienteData, badges, recentLogs = [], now = new Date() }) {
    if (!clienteData) return [];

    const context = { clienteData, now, recentLogs };

    return badges.filter(badge => {
        if (badge.tipoAsignacion === 'manual') return false;
        if (!badge.regla) return false;

        return evaluateRuleNode(badge.regla, context);
    });
}

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
