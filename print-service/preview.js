'use strict';

/**
 * preview.js — Muestra en consola cómo se verá un ticket
 * sin necesitar impresora ni Firestore.
 *
 * Uso:
 *   node preview.js
 *
 * Para cambiar el diseño editá ticket.js y volvé a correr esto.
 */

const { ConsoleBuilder } = require('./escpos.js');
const { generarTicket }  = require('./ticket.js');
const config = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'config.json'), 'utf8'));

// ── Pedido de ejemplo ─────────────────────────────────────────────────────────
const pedidoEjemplo = {
    timestamp: { _seconds: Math.floor(Date.now() / 1000) },
    items: [
        { qty: 2, nombre: 'Café Cortado',      precio: 1200, variantLabel: null },
        { qty: 1, nombre: 'Medialunas x3',     precio: 1800, variantLabel: null },
        { qty: 1, nombre: 'Torta de Chocolate',precio: 3500, variantLabel: 'Porcion individual' },
    ],
    total: 7700,
    metodoEntrega: 'pickup',       // 'pickup' o 'delivery'
    horario: 'Lunes 21/04/2026',
    metodoPago: 'mercadopago',     // 'mercadopago' | 'transferencia' | 'efectivo'
    cliente: {
        nombre:   'Juan Pérez',
        whatsapp: '1122334455',
        direccion: 'Av. Santa Fe 1234, 4to B',
    },
    notas: 'Sin azucar en los cortados, por favor!',
};

const idEjemplo = 'xKj3pQ8mNAB12CD34';

// ── Renderizar ────────────────────────────────────────────────────────────────
const b = ConsoleBuilder(config.anchoCaracteres || 48);
generarTicket(pedidoEjemplo, idEjemplo, b);

const border = '┌' + '─'.repeat((config.anchoCaracteres || 48) + 2) + '┐';
const sep    = '└' + '─'.repeat((config.anchoCaracteres || 48) + 2) + '┘';

console.log('\n' + border);
b.render().split('\n').forEach(l => {
    const pad = (config.anchoCaracteres || 48) - l.replace(/[^\x20-\x7E]/g, ' ').length;
    console.log(`│ ${l}${' '.repeat(Math.max(0, pad))} │`);
});
console.log(sep + '\n');
console.log('👆  Así se verá el ticket. Editá ticket.js para cambiar el diseño.\n');
