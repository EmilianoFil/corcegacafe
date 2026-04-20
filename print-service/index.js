'use strict';

const net   = require('net');
const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

const { EscposBuilder } = require('./escpos.js');
const { generarTicket } = require('./ticket.js');

// ─── DIRECTORIO REAL (funciona tanto con "node index.js" como con el .exe) ───
const BASE_DIR = process.pkg
    ? path.dirname(process.execPath)
    : __dirname;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG_PATH = path.join(BASE_DIR, 'config.json');
const KEY_PATH = path.join(BASE_DIR, 'serviceAccountKey.json');
const LOG_FILE = path.join(BASE_DIR, 'imprimir.log');

function log(msg) {
    const ts   = new Date().toLocaleString('es-AR', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try {
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024)
            fs.renameSync(LOG_FILE, LOG_FILE + '.old');
        fs.appendFileSync(LOG_FILE, line + '\n');
    } catch (_) {}
}

function waitAndExit() {
    console.error('\nPresiona ENTER para cerrar...');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
}

if (!fs.existsSync(CFG_PATH)) {
    console.error(`\nERROR: no se encuentra config.json en:\n  ${CFG_PATH}\n`);
    waitAndExit(); return;
}
if (!fs.existsSync(KEY_PATH)) {
    console.error(`\nERROR: no se encuentra serviceAccountKey.json en:\n  ${KEY_PATH}\n`);
    console.error('Descargalo desde Firebase Console → Cuentas de servicio\n');
    waitAndExit(); return;
}

const config   = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const ANCHO    = config.anchoCaracteres  || 48;
const IP       = config.printerIp;
const PUERTO   = config.printerPort      || 9100;
const MAX_REINT = config.reintentos      || 5;
const DELAY    = config.delayReintentoMs || 15000;

if (!IP || IP.includes('XXX')) {
    console.error('\nERROR: configura la IP de la impresora en config.json');
    console.error('  "printerIp": "192.168.1.XXX"  <- cambiar por la IP real\n');
    waitAndExit(); return;
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))),
        projectId:  config.projectId
    });
} catch (e) {
    console.error(`\nERROR al inicializar Firebase: ${e.message}\n`);
    waitAndExit(); return;
}

const db = admin.firestore();

// ─── TCP ─────────────────────────────────────────────────────────────────────
function enviarTCP(buffer) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(10000);
        socket.connect(PUERTO, IP, () => { socket.write(buffer, () => { socket.end(); resolve(); }); });
        socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
        socket.on('error',   (err) => reject(err));
    });
}

async function imprimirPedido(snap) {
    const b = EscposBuilder(ANCHO);
    generarTicket(snap.data(), snap.id, b);
    await enviarTCP(b.build());
}

// ─── RETRY ───────────────────────────────────────────────────────────────────
const enProceso = new Set();

async function imprimirConReintentos(snap) {
    const id  = snap.id;
    const uid = id.slice(-8).toUpperCase();

    for (let i = 1; i <= MAX_REINT; i++) {
        try {
            await imprimirPedido(snap);
            await db.collection('ordenes').doc(id).update({ impreso: true });
            log(`OK   #${uid} — ${snap.data().cliente?.nombre || '?'} — $${snap.data().total}`);
            return;
        } catch (err) {
            log(`WARN [${i}/${MAX_REINT}] #${uid}: ${err.message}`);
            if (i < MAX_REINT) { log(`     Reintentando en ${DELAY/1000}s...`); await sleep(DELAY); }
        }
    }
    log(`ERR  #${uid} no se pudo imprimir tras ${MAX_REINT} intentos. Quedara pendiente.`);
}

// ─── LISTENER ────────────────────────────────────────────────────────────────
// Escucha TODOS los pagados y filtra en JS (cubre órdenes sin campo "impreso")
function iniciarListener() {
    log('Escuchando pedidos pagados...');

    db.collection('ordenes')
      .where('estado', '==', 'pagado')
      .onSnapshot(
        (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type !== 'added') return;
                const data = change.doc.data();
                if (data.impreso === true) return;  // ya impreso, ignorar

                const id = change.doc.id;
                if (enProceso.has(id)) return;
                enProceso.add(id);
                log(`NUEVO #${id.slice(-8).toUpperCase()} — ${data.cliente?.nombre || '?'}`);
                imprimirConReintentos(change.doc).finally(() => enProceso.delete(id));
            });
        },
        (err) => {
            log(`ERR  Listener caido: ${err.message}. Reconectando en 30s...`);
            setTimeout(iniciarListener, 30000);
        }
    );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
console.log('');
console.log('================================================');
console.log('  Corcega Cafe — Servicio de Impresion');
console.log(`  Impresora: ${config.nombreImpresora} @ ${IP}:${PUERTO}`);
console.log('================================================');
console.log('');
console.log('  Esta ventana tiene que quedar ABIERTA.');
console.log('');

iniciarListener();

process.on('uncaughtException',  err => log(`ERR  ${err.message}`));
process.on('unhandledRejection', r   => log(`ERR  ${r}`));
