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

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const config   = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const LOG_FILE = path.join(__dirname, 'imprimir-pdf.log');

function log(msg) {
    const ts   = new Date().toLocaleString('es-AR', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ─── FIREBASE ────────────────────────────────────────────────────────────────
const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(KEY_PATH)) {
    console.error('\nERROR: falta serviceAccountKey.json — ver INSTALAR.txt\n');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))),
    projectId:  config.projectId
});

const db = admin.firestore();

// ─── RETRY WRAPPER ───────────────────────────────────────────────────────────
const enProceso = new Set();
const MAX_REINT = config.reintentos      || 5;
const DELAY     = config.delayReintentoMs || 15000;

async function procesarConReintentos(snap) {
    const id  = snap.id;
    const uid = id.slice(-8).toUpperCase();

    for (let i = 1; i <= MAX_REINT; i++) {
        try {
            const pdfPath = await generarYAbrirPDF(snap.data(), id);
            await db.collection('ordenes').doc(id).update({ impreso: true });
            log(`OK   #${uid} → PDF abierto: ${pdfPath}`);
            return;
        } catch (err) {
            log(`WARN [${i}/${MAX_REINT}] #${uid}: ${err.message}`);
            if (i < MAX_REINT) await new Promise(r => setTimeout(r, DELAY));
        }
    }
    log(`ERR  #${uid} — no se pudo generar el PDF tras ${MAX_REINT} intentos.`);
}

// ─── LISTENER ────────────────────────────────────────────────────────────────
function iniciarListener() {
    log('Escuchando Firestore (modo PDF)...');

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
                log(`NUEVO #${id.slice(-8).toUpperCase()} — ${change.doc.data().cliente?.nombre || '?'}`);
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
log('='.repeat(48));
log('  Córcega Café — Servicio de Impresión (PDF)');
log(`  Modo: PDF visual — sin impresora`);
log('='.repeat(48));

iniciarListener();

process.on('uncaughtException',  err => log(`ERR ${err.message}`));
process.on('unhandledRejection', r   => log(`ERR ${r}`));
