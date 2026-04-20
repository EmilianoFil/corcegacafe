'use strict';

/**
 * ticket.js — Define QUÉ se imprime y cómo se ve el ticket.
 * Editá este archivo para cambiar el diseño del comprobante.
 *
 * Funciones disponibles del builder (b):
 *   b.centro(texto)       — texto centrado
 *   b.izquierda(texto)    — texto alineado a la izquierda
 *   b.bold(texto)         — texto en negrita
 *   b.bigBold(texto)      — texto grande + negrita (doble altura)
 *   b.linea()             — línea divisoria ─────────────────
 *   b.espacio()           — línea en blanco
 *   b.fila(izq, der)      — texto izquierda + precio a la derecha
 *   b.cortar()            — corte de papel (siempre al final)
 */

const { norm } = require('./escpos.js');

function formatearFecha(ts) {
    if (!ts) return '';
    const d = ts._seconds ? new Date(ts._seconds * 1000)
                           : (ts.toDate ? ts.toDate() : new Date(ts));
    return d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

function labelPago(metodo) {
    return { mercadopago: 'Mercado Pago', transferencia: 'Transferencia', efectivo: 'Efectivo' }[metodo] || metodo || '';
}

/**
 * Genera el ticket de un pedido.
 * @param {object} pedido  — datos del doc de Firestore
 * @param {string} id      — ID del documento
 * @param {object} b       — builder (escpos o consoleBuilder)
 */
function generarTicket(pedido, id, b) {
    const p    = pedido;
    const uid  = id.slice(-8).toUpperCase();

    // ── CABECERA ─────────────────────────────────────────────────────────────
    b.espacio();
    b.bigBold('CORCEGA CAFE');
    b.centro('Rebeldia Cafetera');
    b.linea();

    // ── NÚMERO Y FECHA ────────────────────────────────────────────────────────
    b.centro(`# ${uid}`);
    b.centro(formatearFecha(p.timestamp));
    b.linea();

    // ── ITEMS ─────────────────────────────────────────────────────────────────
    b.bold('ITEMS:');
    for (const item of (p.items || [])) {
        const nombre = norm(`${item.qty}x ${item.nombre}`);
        const precio = `$${((item.precio || 0) * (item.qty || 1)).toLocaleString('es-AR')}`;
        b.fila(nombre, precio);
        if (item.variantLabel) {
            b.izquierda(`   ${norm(item.variantLabel)}`);
        }
    }

    // ── TOTAL ─────────────────────────────────────────────────────────────────
    b.linea();
    b.fila('TOTAL:', `$${(p.total || 0).toLocaleString('es-AR')}`, true /* bold */);
    b.linea();

    // ── ENTREGA ───────────────────────────────────────────────────────────────
    const esDelivery = p.metodoEntrega === 'delivery';
    b.bold(esDelivery ? '[ ENVIO A DOMICILIO ]' : '[ RETIRO EN LOCAL ]');
    if (esDelivery && p.cliente?.direccion) {
        b.izquierda(`Dir: ${norm(p.cliente.direccion)}`);
    }
    if (p.horario) {
        b.izquierda(`Horario: ${norm(p.horario)}`);
    }
    b.linea();

    // ── CLIENTE ───────────────────────────────────────────────────────────────
    if (p.cliente?.nombre)   b.izquierda(`Cliente: ${norm(p.cliente.nombre)}`);
    if (p.cliente?.whatsapp) b.izquierda(`WA: ${p.cliente.whatsapp}`);
    b.izquierda(`Pago: ${labelPago(p.metodoPago)}`);

    // ── NOTAS ─────────────────────────────────────────────────────────────────
    if (p.notas?.trim()) {
        b.linea();
        b.bold('NOTAS:');
        b.izquierda(norm(p.notas.trim()));
    }

    // ── PIE ───────────────────────────────────────────────────────────────────
    b.linea();
    b.centro('Gracias!');
    b.centro('corcegacafe.com.ar');
    b.espacio();
    b.cortar();
}

module.exports = { generarTicket };
