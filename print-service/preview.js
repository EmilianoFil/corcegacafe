'use strict';

/**
 * preview.js — Muestra en consola cómo se verá el ticket.
 * Uso:  node preview.js
 *       npm run preview
 */

const { ConsoleBuilder } = require('./escpos.js');
const { generarTicket }  = require('./ticket.js');
const config = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'config.json'), 'utf8'));

const pedidoEjemplo = {
    timestamp:    { _seconds: Math.floor(Date.now() / 1000) },
    items: [
        { qty: 2, nombre: 'Cafe Cortado',       precio: 1200, variantLabel: null },
        { qty: 1, nombre: 'Medialunas x3',       precio: 1800, variantLabel: null },
        { qty: 1, nombre: 'Torta de Chocolate',  precio: 3500, variantLabel: 'Porcion individual' },
    ],
    total:         7700,
    metodoEntrega: 'pickup',
    horario:       'Lunes 21/04/2026',
    metodoPago:    'mercadopago',
    mp_payment_id: '87654321098',
    cliente: {
        nombre:   'Juan Perez',
        email:    'juan@mail.com',
        whatsapp: '1122334455',
        dni:      '35123456',
    },
    notas: '',
};

const idEjemplo = 'xKj3pQ8mNAB12CD34';
const ANCHO = config.anchoCaracteres || 48;

const b = ConsoleBuilder(ANCHO);
generarTicket(pedidoEjemplo, idEjemplo, b);

const top = '┌' + '─'.repeat(ANCHO + 2) + '┐';
const bot = '└' + '─'.repeat(ANCHO + 2) + '┘';

console.log('\n' + top);
b.render().split('\n').forEach(l => {
    const visible = l.replace(/[^\x20-\x7E─✂►◄]/g, ' ');
    const pad = ANCHO - visible.length;
    console.log(`│ ${l}${' '.repeat(Math.max(0, pad))} │`);
});
console.log(bot + '\n');
console.log('  Para cambiar el diseño: editá ticket.js y corré "npm run preview" de nuevo.\n');
