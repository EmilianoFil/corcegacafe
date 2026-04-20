'use strict';

/**
 * ticket-pdf.js — Genera un PDF del ticket y lo abre en el visor del sistema.
 * Usa las mismas funciones de formato que ticket.js pero renderiza en PDF.
 */

const PDFDocument = require('pdfkit');
const QRCode      = require('qrcode');
const fs          = require('fs');
const path        = require('path');
const os          = require('os');
const { exec }    = require('child_process');

// 80mm de ancho en puntos PDF (1mm = 2.8346pt)
const W     = 226;   // ancho total
const ML    = 14;    // margen izquierdo
const MR    = 14;    // margen derecho
const TW    = W - ML - MR;  // ancho de texto

function formatFechaHora(ts) {
    if (!ts) return '—';
    const d = ts._seconds ? new Date(ts._seconds * 1000)
                          : (ts.toDate ? ts.toDate() : new Date(ts));
    return d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

function labelPago(m) {
    return { mercadopago: 'Mercado Pago', transferencia: 'Transferencia', efectivo: 'Efectivo' }[m] || m || '';
}

async function generarYAbrirPDF(pedido, id) {
    const p   = pedido;
    const uid = id.slice(-8).toUpperCase();
    const qrUrl = `https://corcegacafe.com.ar/seguimiento.html?id=${id}`;

    // ── Generar imagen QR ────────────────────────────────────────────────────
    const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 120, margin: 1 });

    // ── Crear documento PDF ──────────────────────────────────────────────────
    // Altura estimada generosa; pdfkit no corta páginas en un receipt
    const doc = new PDFDocument({
        size:     [W, 900],
        margins:  { top: 0, bottom: 0, left: 0, right: 0 },
        autoFirstPage: true,
        compress: true,
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    let y = 12;

    const FONT_NORMAL = 'Courier';
    const FONT_BOLD   = 'Courier-Bold';
    const SZ_NORMAL   = 8;
    const SZ_BIG      = 11;
    const LINE_H      = 12;

    function texto(txt, opts = {}) {
        const { bold, center, size, color } = opts;
        doc.font(bold ? FONT_BOLD : FONT_NORMAL)
           .fontSize(size || SZ_NORMAL)
           .fillColor(color || '#000000');

        if (center) {
            doc.text(txt, ML, y, { width: TW, align: 'center' });
        } else {
            doc.text(txt, ML, y, { width: TW });
        }
        y += (size || SZ_NORMAL) + (LINE_H - SZ_NORMAL) + (opts.extraGap || 0);
    }

    function linea() {
        doc.moveTo(ML, y).lineTo(W - MR, y).stroke('#cccccc');
        y += 7;
    }

    function espacio(n = 1) { y += LINE_H * n; }

    function fila(izq, der, bold) {
        doc.font(bold ? FONT_BOLD : FONT_NORMAL).fontSize(SZ_NORMAL).fillColor('#000');
        const derW = doc.widthOfString(der) + 2;
        doc.text(izq, ML, y, { width: TW - derW, ellipsis: true });
        doc.text(der, W - MR - derW, y, { width: derW, align: 'right' });
        y += LINE_H;
    }

    // ── HEADER ───────────────────────────────────────────────────────────────
    espacio(0.5);
    texto('Córcega Café | TIENDA ONLINE', { bold: true, center: true, size: SZ_BIG });
    espacio(0.5);

    // ── FECHA ────────────────────────────────────────────────────────────────
    texto(formatFechaHora(p.timestamp), { center: true });
    espacio();

    // ── CLIENTE ──────────────────────────────────────────────────────────────
    texto(`Cliente: ${p.cliente?.nombre || '—'}`);
    texto(`Mail:    ${p.cliente?.email || '—'}`);
    if (p.cliente?.dni) texto(`DNI:     ${p.cliente.dni}`);
    texto(`Fecha de entrega: ${p.horario || 'A confirmar'}`);
    espacio();

    // ── ITEMS ─────────────────────────────────────────────────────────────────
    texto('Pedido', { bold: true });
    linea();

    for (const item of (p.items || [])) {
        fila(`${item.qty}x ${item.nombre}`, `$${((item.precio||0)*(item.qty||1)).toLocaleString('es-AR')}`);
        if (item.variantLabel) {
            texto(`   ${item.variantLabel}`, { color: '#888' });
            y -= 4;
        }
    }

    espacio(0.5);
    fila('Total:', `$${(p.total||0).toLocaleString('es-AR')}`, true);
    espacio();

    // ── COMPROBANTE MP ────────────────────────────────────────────────────────
    linea();
    espacio(0.5);
    const mpId = p.mp_payment_id || p.pagoId;
    if (mpId) {
        texto(`Nro comprobante MP: ${mpId}`, { bold: true });
    } else if (p.metodoPago === 'transferencia') {
        texto('Pago: Transferencia bancaria');
    } else if (p.metodoPago === 'efectivo') {
        texto('Pago: Efectivo en local');
    } else {
        texto('Comprobante MP: pendiente', { color: '#888' });
    }
    espacio();

    // ── QR ───────────────────────────────────────────────────────────────────
    linea();
    espacio(0.5);
    texto('Seguimiento de tu pedido:', { center: true });
    espacio(0.3);

    const qrSize = 90;
    doc.image(qrBuffer, (W - qrSize) / 2, y, { width: qrSize, height: qrSize });
    y += qrSize + 8;

    texto(`#${uid}`, { center: true, bold: true });
    espacio();

    // ── Cortar PDF a la altura real ──────────────────────────────────────────
    const finalH = y + 12;
    doc.page.height = finalH;  // ajustar altura a contenido real

    doc.end();

    // ── Guardar y abrir ──────────────────────────────────────────────────────
    const tmpPath = path.join(os.tmpdir(), `corcega_ticket_${uid}.pdf`);
    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(tmpPath);
        ws.write(Buffer.concat(chunks));
        ws.end();
        ws.on('finish', resolve);
        ws.on('error', reject);
    });

    // Abrir en el visor de PDF del sistema (Windows: start, Mac: open)
    const cmd = process.platform === 'win32'
        ? `start "" "${tmpPath}"`
        : `open "${tmpPath}"`;
    exec(cmd);

    return tmpPath;
}

module.exports = { generarYAbrirPDF };
