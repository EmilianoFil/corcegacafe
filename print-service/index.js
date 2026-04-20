'use strict';

/**
 * Córcega Café — Servicio de Impresión Automática
 * ─────────────────────────────────────────────────
 * Escucha Firestore y manda a imprimir cada pedido que
 * pasa a estado "pagado". Al arrancar también imprime
 * todo lo pendiente (pedidos mientras la impresora estaba apagada).
 *
 * Sin dependencias nativas: usa TCP directo al puerto 9100 (ESC/POS estándar).
 */

const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const admin  = require('firebase-admin');

const { EscposBuilder } = require('./escpos.js');
const { generarTicket } = require('./ticket.js');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG_PATH = path.join(__dirname, 'config.json');
const config   = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

const ANCHO    = config.anchoCaracteres  || 48;
const IP       = config.printerIp;
const PUERTO   = config.printerPort      || 9100;
const MAX_REINT = config.reintentos      || 5;
const DELAY    = config.delayReintentoMs || 15000;

// ─── LOGGER ──────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'imprimir.log');

function log(msg) {
    const ts   = new Date().toLocaleString('es-AR', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try {
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
            fs.renameSync(LOG_FILE, LOG_FILE + '.old');
        }
        fs.appendFileSync(LOG_FILE, line + '\n');
    } catch (_) {}
}

// ─── FIREBASE ────────────────────────────────────────────────────────────────
const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(KEY_PATH)) {
    console.error('\nERROR: falta serviceAccountKey.json');
    console.error('Ver INSTALAR.txt para descargarlo desde Firebase Console.\n');
    process.exit(1);
}
if (!IP || IP.includes('XXX')) {
    console.error('\nERROR: configurá la IP de la impresora en config.json');
    console.error('  "printerIp": "192.168.1.XXX"  ← cambiar por la IP real\n');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH)),
    projectId:  config.projectId
});

const db = admin.firestore();

// ─── IMPRIMIR VÍA TCP ────────────────────────────────────────────────────────
function enviarTCP(buffer) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(10000);

        socket.connect(PUERTO, IP, () => {
            socket.write(buffer, () => {
                socket.end();
                resolve();
            });
        });

        socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
        socket.on('error',   (err) => reject(err));
    });
}

// ─── GENERAR + ENVIAR TICKET ─────────────────────────────────────────────────
async function imprimirPedido(snap) {
    const b = EscposBuilder(ANCHO);
    generarTicket(snap.data(), snap.id, b);
    await enviarTCP(b.build());
}

// ─── RETRY WRAPPER ───────────────────────────────────────────────────────────
const enProceso = new Set();

async function imprimirConReintentos(snap) {
    const id    = snap.id;
    const uid   = id.slice(-8).toUpperCase();

    for (let i = 1; i <= MAX_REINT; i++) {
        try {
            await imprimirPedido(snap);
            await db.collection('ordenes').doc(id).update({ impreso: true });
            log(`OK   #${uid} — ${snap.data().cliente?.nombre || '?'} — $${snap.data().total}`);
            return;
        } catch (err) {
            log(`WARN [${i}/${MAX_REINT}] #${uid}: ${err.message}`);
            if (i < MAX_REINT) {
                log(`     Reintentando en ${DELAY / 1000}s...`);
                await sleep(DELAY);
            }
        }
    }

    log(`ERR  #${uid} no se pudo imprimir tras ${MAX_REINT} intentos. Quedará pendiente.`);
    // NO marcamos impreso:true → al reiniciar el servicio reintentará
}

// ─── LISTENER FIRESTORE ──────────────────────────────────────────────────────
function iniciarListener() {
    log('Escuchando Firestore...');

    db.collection('ordenes')
      .where('estado',  '==', 'pagado')
      .where('impreso', '==', false)
      .onSnapshot(
        (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type !== 'added') return;
                const id = change.doc.id;
                if (enProceso.has(id)) return;
                enProceso.add(id);

                const nombre = change.doc.data().cliente?.nombre || '?';
                log(`NUEVO #${id.slice(-8).toUpperCase()} — ${nombre}`);
                imprimirConReintentos(change.doc).finally(() => enProceso.delete(id));
            });
        },
        (err) => {
            log(`ERR  Listener caído: ${err.message}. Reconectando en 30s...`);
            setTimeout(iniciarListener, 30000);
        }
    );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
log('='.repeat(48));
log('  Córcega Café — Servicio de Impresión');
log(`  Impresora: ${config.nombreImpresora} @ ${IP}:${PUERTO}`);
log('='.repeat(48));

iniciarListener();

process.on('uncaughtException',  err => log(`ERR  ${err.message}`));
process.on('unhandledRejection', r   => log(`ERR  ${r}`));
