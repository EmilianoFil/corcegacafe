'use strict';

/**
 * index-pdf.js — Igual que index.js pero en lugar de imprimir,
 * genera un PDF del ticket y lo abre automáticamente.
 * Ideal para testear sin tener la impresora térmica.
 */

const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

const { generarYAbrirPDF } = require('./ticket-pdf.js');

// ─── DIRECTORIO REAL (funciona tanto con "node index-pdf.js" como con el .exe)
// process.pkg se define cuando corre como ejecutable pkg
const BASE_DIR = process.pkg
    ? path.dirname(process.execPath)   // junto al .exe
    : __dirname;                        // junto al .js

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG_PATH = path.join(BASE_DIR, 'config.json');
const KEY_PATH = path.join(BASE_DIR, 'serviceAccountKey.json');
const LOG_FILE = path.join(BASE_DIR, 'imprimir-pdf.log');

function log(msg) {
    const ts   = new Date().toLocaleString('es-AR', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// Verificar archivos necesarios
if (!fs.existsSync(CFG_PATH)) {
    console.error(`\nERROR: no se encuentra config.json en:\n  ${CFG_PATH}\n`);
    console.error('Asegurate de que config.json esté en la misma carpeta que el .exe\n');
    waitAndExit();
}
if (!fs.existsSync(KEY_PATH)) {
    console.error(`\nERROR: no se encuentra serviceAccountKey.json en:\n  ${KEY_PATH}\n`);
    console.error('Descargalo desde Firebase Console → Cuentas de servicio\n');
    waitAndExit();
}

function waitAndExit() {
    console.error('\nPresioná ENTER para cerrar...');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
}

const config = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

// ─── FIREBASE ────────────────────────────────────────────────────────────────
try {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))),
        projectId:  config.projectId
    });
} catch (e) {
    console.error(`\nERROR al inicializar Firebase: ${e.message}`);
    console.error('Verificá que serviceAccountKey.json sea válido.\n');
    waitAndExit();
}

const db = admin.firestore();

// ─── RETRY ───────────────────────────────────────────────────────────────────
const enProceso = new Set();
const MAX_REINT = config.reintentos       || 5;
const DELAY     = config.delayReintentoMs || 15000;

async function procesarConReintentos(snap) {
    const id  = snap.id;
    const uid = id.slice(-8).toUpperCase();

    for (let i = 1; i <= MAX_REINT; i++) {
        try {
            const pdfPath = await generarYAbrirPDF(snap.data(), id);
            await db.collection('ordenes').doc(id).update({ impreso: true });
            log(`OK   #${uid} → ${pdfPath}`);
            return;
        } catch (err) {
            log(`WARN [${i}/${MAX_REINT}] #${uid}: ${err.message}`);
            if (i < MAX_REINT) await new Promise(r => setTimeout(r, DELAY));
        }
    }
    log(`ERR  #${uid} — no se pudo generar el PDF tras ${MAX_REINT} intentos.`);
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
                if (data.impreso === true) return;   // ya impreso, ignorar

                const id = change.doc.id;
                if (enProceso.has(id)) return;
                enProceso.add(id);
                log(`NUEVO #${id.slice(-8).toUpperCase()} — ${data.cliente?.nombre || '?'}`);
                procesarConReintentos(change.doc).finally(() => enProceso.delete(id));
            });
        },
        (err) => {
            log(`ERR Listener caído: ${err.message}. Reconectando en 30s...`);
            setTimeout(iniciarListener, 30000);
        }
    );
}

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
console.log('');
console.log('================================================');
console.log('  Corcega Cafe — Servicio de Impresion (PDF)');
console.log('================================================');
console.log('');
console.log('  Esta ventana tiene que quedar ABIERTA.');
console.log('  Cuando llega un pedido pagado, se abre el PDF.');
console.log('');

iniciarListener();

process.on('uncaughtException',  err => log(`ERR ${err.message}`));
process.on('unhandledRejection', r   => log(`ERR ${r}`));
