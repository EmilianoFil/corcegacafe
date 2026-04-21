'use strict';

const { norm } = require('./escpos.js');

const BASE_URL = 'https://corcegacafe.com.ar/seguimiento.html';

function formatFechaHora(ts) {
    if (!ts) return '—';
    const d = ts._seconds ? new Date(ts._seconds * 1000)
                           : (ts.toDate ? ts.toDate() : new Date(ts));
    return d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

/**
 * Genera el ticket de un pedido.
 * @param {object} pedido  — datos del doc de Firestore
 * @param {string} id      — ID del documento
 * @param {object} b       — builder (EscposBuilder o ConsoleBuilder)
 */
function generarTicket(pedido, id, b) {
    const p   = pedido;
    const uid = p.orderNumber || id.slice(-8).toUpperCase();
    const qrUrl = `${BASE_URL}?id=${id}`;

    // ── CABECERA ──────────────────────────────────────────────────────────────
    b.espacio();
    b.bigBold('Corcega Cafe | TIENDA ONLINE');
    b.espacio();

    // ── FECHA/HORA DEL PEDIDO ────────────────────────────────────────────────
    b.centro(formatFechaHora(p.timestamp));
    b.espacio();

    // ── DATOS DEL CLIENTE ────────────────────────────────────────────────────
    b.boldLeft('Cliente:', norm(p.cliente?.nombre || '—'));
    b.boldLeft('Mail:', p.cliente?.email || '—');
    b.boldLeft('Celular:', p.cliente?.whatsapp || '—');
    if (p.cliente?.dni) {
        b.boldLeft('DNI:', p.cliente.dni);
    }
    b.boldLeft('Entrega:', norm(p.horario || 'A confirmar'));
    if (p.notas) {
        b.boldLeft('Nota:', norm(p.notas));
    }
    b.espacio();

    // ── ITEMS ─────────────────────────────────────────────────────────────────
    b.bold(`Pedido #${uid}`);
    b.linea();

    for (const item of (p.items || [])) {
        const nombre = norm(`${item.qty}x ${item.nombre}`);
        const precio = `$${((item.precio || 0) * (item.qty || 1)).toLocaleString('es-AR')}`;
        b.fila(nombre, precio);
        if (item.variantLabel) {
            b.izquierda(`   ${norm(item.variantLabel)}`);
        }
    }

    b.espacio();
    b.fila('Total:', `$${(p.total || 0).toLocaleString('es-AR')}`, true /* bold */);
    b.espacio();

    // ── COMPROBANTE MP ────────────────────────────────────────────────────────
    b.linea();
    b.espacio();
    const mpId = p.mp_payment_id || p.pagoId || null;
    if (mpId) {
        b.bold(`Nro comprobante MP: ${mpId}`);
    } else if (p.metodoPago === 'transferencia') {
        b.izquierda('Pago: Transferencia bancaria');
    } else if (p.metodoPago === 'efectivo') {
        b.izquierda('Pago: Efectivo en local');
    } else {
        b.izquierda('Comprobante MP: pendiente de confirmacion');
    }
    b.espacio();

    // ── QR DE SEGUIMIENTO ────────────────────────────────────────────────────
    b.linea();
    b.espacio();
    b.centro('Seguimiento de tu pedido:');
    b.qr(qrUrl);
    b.espacio();
    b.centro(`#${uid}`);
    b.espacio();

    b.cortar();
}

module.exports = { generarTicket };
