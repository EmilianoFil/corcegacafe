'use strict';

/**
 * Servicio de impresión automática — Córcega Café
 * ─────────────────────────────────────────────────
 * Escucha Firestore en tiempo real y manda a imprimir
 * cada pedido que pasa a estado "pagado".
 *
 * Al arrancar también imprime todo lo pendiente,
 * resolviendo el caso "la impresora estaba apagada".
 */

const admin  = require('firebase-admin');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const fs     = require('fs');
const path   = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const LOG_FILE     = path.join(__dirname, 'imprimir.log');
const MAX_LOG_MB   = 5;       // rotar si supera 5 MB
const ANCHO        = config.anchoCaracteres || 48;

// ─── LOGGER ──────────────────────────────────────────────────────────────────
function log(msg) {
    const ts   = new Date().toLocaleString('es-AR', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try {
        // Rotar log si es muy grande
        if (fs.existsSync(LOG_FILE)) {
            const { size } = fs.statSync(LOG_FILE);
            if (size > MAX_LOG_MB * 1024 * 1024) {
                fs.renameSync(LOG_FILE, LOG_FILE + '.old');
            }
        }
        fs.appendFileSync(LOG_FILE, line + '\n');
    } catch (_) { /* si falla el log, no rompemos todo */ }
}

// ─── FIREBASE ADMIN ──────────────────────────────────────────────────────────
const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
    console.error('');
    console.error('ERROR: falta el archivo serviceAccountKey.json');
    console.error('Descargalo desde Firebase Console:');
    console.error('  Configuracion del proyecto → Cuentas de servicio → Generar nueva clave privada');
    console.error('Guardalo como: print-service/serviceAccountKey.json');
    console.error('');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: config.projectId
});

const db = admin.firestore();

// ─── FORMATO TICKET ──────────────────────────────────────────────────────────

function formatearFecha(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts._seconds * 1000);
    return d.toLocaleString('es-AR', {
        day:    '2-digit',
        month:  '2-digit',
        year:   'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

/** Genera una línea con texto izquierda + precio derecha */
function lineaConPrecio(izq, der, ancho) {
    const max   = ancho - der.length - 1;
    const texto = izq.length > max ? izq.slice(0, max - 1) + '.' : izq;
    const pad   = ancho - texto.length - der.length;
    return texto + ' '.repeat(Math.max(1, pad)) + der;
}

function normalizarTexto(str) {
    // Reemplaza caracteres que la impresora puede no soportar
    return (str || '')
        .replace(/[áàä]/gi, 'a')
        .replace(/[éèë]/gi, 'e')
        .replace(/[íìï]/gi, 'i')
        .replace(/[óòö]/gi, 'o')
        .replace(/[úùü]/gi, 'u')
        .replace(/[ñ]/gi, 'n')
        .replace(/[¿¡]/g, '');
}

async function imprimirPedido(snap) {
    const p  = snap.data();
    const id = snap.id;

    const printer = new ThermalPrinter({
        type:                   PrinterTypes.EPSON,
        interface:              `printer:${config.nombreImpresora}`,
        characterSet:           CharacterSet.PC437_USA,
        removeSpecialCharacters: true,
        lineCharacter:          '-',
        width:                  ANCHO,
        options: { timeout: 15000 }
    });

    // ── Verificar que la impresora esté lista ────────────────────────────────
    const online = await printer.isPrinterConnected().catch(() => false);
    if (!online) throw new Error(`Impresora "${config.nombreImpresora}" no disponible`);

    // ── HEADER ───────────────────────────────────────────────────────────────
    printer.alignCenter();
    printer.setTextDoubleHeight();
    printer.bold(true);
    printer.println('CORCEGA CAFE');
    printer.bold(false);
    printer.setTextNormal();
    printer.println('Rebeldia Cafetera');
    printer.drawLine();

    // ── ID + FECHA ────────────────────────────────────────────────────────────
    printer.println(`Pedido: #${id.slice(-8).toUpperCase()}`);
    printer.println(formatearFecha(p.timestamp));
    printer.drawLine();

    // ── ITEMS ─────────────────────────────────────────────────────────────────
    printer.alignLeft();
    printer.bold(true);
    printer.println('ITEMS:');
    printer.bold(false);

    for (const item of (p.items || [])) {
        const nombre = normalizarTexto(`${item.qty}x ${item.nombre}`);
        const precio = `$${((item.precio || 0) * (item.qty || 1)).toLocaleString('es-AR')}`;
        printer.println(lineaConPrecio(nombre, precio, ANCHO));
        if (item.variantLabel) {
            printer.println(`   ${normalizarTexto(item.variantLabel)}`);
        }
    }

    // ── TOTAL ─────────────────────────────────────────────────────────────────
    printer.drawLine();
    printer.bold(true);
    printer.println(lineaConPrecio('TOTAL:', `$${(p.total || 0).toLocaleString('es-AR')}`, ANCHO));
    printer.bold(false);
    printer.drawLine();

    // ── ENTREGA ───────────────────────────────────────────────────────────────
    printer.alignCenter();
    printer.bold(true);
    printer.println(p.metodoEntrega === 'delivery' ? '[ ENVIO A DOMICILIO ]' : '[ RETIRO EN LOCAL ]');
    printer.bold(false);
    printer.alignLeft();

    if (p.metodoEntrega === 'delivery' && p.cliente?.direccion) {
        printer.println(`Dir: ${normalizarTexto(p.cliente.direccion)}`);
    }
    if (p.horario) {
        printer.println(`Horario: ${normalizarTexto(p.horario)}`);
    }

    printer.drawLine();

    // ── CLIENTE ───────────────────────────────────────────────────────────────
    if (p.cliente?.nombre)    printer.println(`Cliente: ${normalizarTexto(p.cliente.nombre)}`);
    if (p.cliente?.whatsapp)  printer.println(`WA: ${p.cliente.whatsapp}`);

    const metodoPagoLabel = {
        mercadopago:  'Mercado Pago',
        transferencia: 'Transferencia',
        efectivo:      'Efectivo'
    }[p.metodoPago] || (p.metodoPago || '');
    printer.println(`Pago: ${metodoPagoLabel}`);

    // ── NOTAS ─────────────────────────────────────────────────────────────────
    if (p.notas && p.notas.trim()) {
        printer.drawLine();
        printer.bold(true);
        printer.println('NOTAS:');
        printer.bold(false);
        // Wrap largo a múltiples líneas
        const nota = normalizarTexto(p.notas.trim());
        for (let i = 0; i < nota.length; i += ANCHO) {
            printer.println(nota.slice(i, i + ANCHO));
        }
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    printer.drawLine();
    printer.alignCenter();
    printer.println('Gracias!');
    printer.println('corcegacafe.com.ar');
    printer.newLine();
    printer.cut();

    await printer.execute();
    log(`OK  Pedido #${id.slice(-8).toUpperCase()} — ${normalizarTexto(p.cliente?.nombre || '?')} — $${p.total}`);
}

// ─── RETRY WRAPPER ───────────────────────────────────────────────────────────
const enProceso = new Set();

async function imprimirConReintentos(snap) {
    const id  = snap.id;
    const max = config.reintentos || 5;

    for (let i = 1; i <= max; i++) {
        try {
            await imprimirPedido(snap);

            // Marcar como impreso en Firestore
            await db.collection('ordenes').doc(id).update({ impreso: true });
            return; // ✅ éxito

        } catch (err) {
            log(`WARN [${i}/${max}] Pedido #${id.slice(-8).toUpperCase()}: ${err.message}`);
            if (i < max) {
                log(`     Reintentando en ${config.delayReintentoMs / 1000}s...`);
                await sleep(config.delayReintentoMs || 15000);
            }
        }
    }

    log(`ERR  Pedido #${id.slice(-8).toUpperCase()} no impreso tras ${max} intentos. Quedara pendiente.`);
    // NO marcamos impreso:true → al reiniciar el servicio lo reintentará
}

// ─── LISTENER ────────────────────────────────────────────────────────────────
function iniciarListener() {
    log('Escuchando Firestore...');

    const query = db.collection('ordenes')
        .where('estado',  '==', 'pagado')
        .where('impreso', '==', false);

    query.onSnapshot(
        (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const id = change.doc.id;
                    if (enProceso.has(id)) return;
                    enProceso.add(id);

                    const nombre = normalizarTexto(change.doc.data().cliente?.nombre || '?');
                    log(`NUEVO Pedido #${id.slice(-8).toUpperCase()} — ${nombre}`);

                    imprimirConReintentos(change.doc).finally(() => enProceso.delete(id));
                }
            });
        },
        (err) => {
            log(`ERR  Listener caido: ${err.message}. Reconectando en 30s...`);
            setTimeout(iniciarListener, 30000);
        }
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
log('='.repeat(48));
log('  Servicio de Impresion — Corcega Cafe');
log(`  Impresora: ${config.nombreImpresora}`);
log('='.repeat(48));

iniciarListener();

// Mantener el proceso vivo
process.on('uncaughtException', (err) => {
    log(`ERR  Excepcion no capturada: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
    log(`ERR  Promesa rechazada: ${reason}`);
});
