'use strict';

/**
 * ticket-pdf.js — Genera un HTML del ticket y lo abre en el browser.
 * Sin dependencias de pdfkit ni archivos .afm — funciona dentro del exe.
 */

const QRCode   = require('qrcode');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { exec } = require('child_process');

function formatFechaHora(ts) {
    if (!ts) return '—';
    const d = ts._seconds ? new Date(ts._seconds * 1000)
                          : (ts.toDate ? ts.toDate() : new Date(ts));
    return d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

async function generarYAbrirPDF(pedido, id) {
    const p   = pedido;
    const uid = p.orderNumber || id.slice(-8).toUpperCase();
    const qrUrl = `https://corcegacafe.com.ar/seguimiento.html?id=${id}`;

    // QR como data URL (no necesita archivos externos)
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 180, margin: 1 });

    // Comprobante de pago
    const mpId = p.mp_payment_id || p.pagoId;
    let pagoHtml = '';
    if (mpId) {
        pagoHtml = `<div class="bold">Nro comprobante MP: ${mpId}</div>`;
    } else if (p.metodoPago === 'transferencia') {
        pagoHtml = `<div>Pago: Transferencia bancaria</div>`;
    } else if (p.metodoPago === 'efectivo') {
        pagoHtml = `<div>Pago: Efectivo en local</div>`;
    } else {
        pagoHtml = `<div class="muted">Comprobante MP: pendiente</div>`;
    }

    // Items
    const itemsHtml = (p.items || []).map(item => {
        const subtotal = ((item.precio || 0) * (item.qty || 1)).toLocaleString('es-AR');
        const variante = item.variantLabel ? `<div class="variante">${item.variantLabel}</div>` : '';
        return `
        <div class="fila">
            <span>${item.qty || 1}x ${item.nombre}</span>
            <span>$${subtotal}</span>
        </div>
        ${variante}`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket #${uid}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 13px;
    background: #f5f5f5;
    display: flex;
    justify-content: center;
    padding: 30px 10px;
  }
  .ticket {
    background: white;
    width: 300px;
    padding: 18px 16px;
    border-radius: 6px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  }
  .header {
    text-align: center;
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 4px;
  }
  .center { text-align: center; }
  .muted { color: #888; }
  .bold { font-weight: bold; }
  .linea {
    border: none;
    border-top: 1px dashed #ccc;
    margin: 10px 0;
  }
  .fila {
    display: flex;
    justify-content: space-between;
    margin-bottom: 3px;
  }
  .fila.total {
    font-weight: bold;
    font-size: 14px;
    margin-top: 6px;
  }
  .variante {
    color: #888;
    font-size: 11px;
    margin-left: 14px;
    margin-bottom: 3px;
  }
  .qr-wrap {
    text-align: center;
    margin: 10px 0 6px;
  }
  .qr-wrap img { width: 130px; height: 130px; }
  .uid {
    text-align: center;
    font-weight: bold;
    font-size: 12px;
    letter-spacing: 2px;
  }
  .campo { margin-bottom: 3px; }
  .campo b { font-weight: bold; }
  .espacio { margin-bottom: 8px; }
  @media print {
    body { background: white; padding: 0; }
    .ticket { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="ticket">
  <div class="header">Córcega Café | TIENDA ONLINE</div>
  <div class="center muted espacio">${formatFechaHora(p.timestamp)}</div>

  <div class="campo"><b>Cliente:</b> ${p.cliente?.nombre || '—'}</div>
  <div class="campo"><b>Mail:</b> ${p.cliente?.email || '—'}</div>
  ${p.cliente?.whatsapp ? `<div class="campo"><b>Celular:</b> ${p.cliente.whatsapp}</div>` : ''}
  ${p.cliente?.dni ? `<div class="campo"><b>DNI:</b> ${p.cliente.dni}</div>` : ''}
  <div class="campo"><b>Entrega:</b> ${p.horario || 'A confirmar'}</div>
  ${p.notas ? `<div class="campo espacio"><b>Nota:</b> ${p.notas}</div>` : '<div class="espacio"></div>'}

  <div class="bold" style="margin-top:10px;">Pedido #${uid}</div>
  <hr class="linea">

  ${itemsHtml}

  <div class="fila total">
    <span>Total:</span>
    <span>$${(p.total || 0).toLocaleString('es-AR')}</span>
  </div>

  <hr class="linea">
  ${pagoHtml}
  <hr class="linea">

  <div class="center muted espacio">Seguimiento de tu pedido:</div>
  <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR"></div>
  <div class="uid">#${uid}</div>
</div>
</body>
</html>`;

    // Guardar en carpeta temporal y abrir en el browser
    const tmpPath = path.join(os.tmpdir(), `corcega_ticket_${uid}.html`);
    fs.writeFileSync(tmpPath, html, 'utf8');

    const cmd = process.platform === 'win32'
        ? `start "" "${tmpPath}"`
        : `open "${tmpPath}"`;
    exec(cmd);

    return tmpPath;
}

module.exports = { generarYAbrirPDF };
