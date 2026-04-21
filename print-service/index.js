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

const config    = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const MODO      = config.modo            || 'printer';
const ANCHO     = config.anchoCaracteres || 48;
const IP        = config.printerIp;
const PUERTO    = config.printerPort     || 9100;
const NOMBRE    = config.nombreImpresora || 'TICKET';
const MAX_REINT = config.reintentos      || 5;
const DELAY     = config.delayReintentoMs || 15000;

if (MODO !== 'windows' && (!IP || IP.includes('XXX'))) {
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

// ─── WINDOWS SPOOLER ─────────────────────────────────────────────────────────
// Sends raw ESC/POS bytes to a Windows printer by its registered name.
// Uses PowerShell + P/Invoke into winspool.Drv so no native addons are needed.
function imprimirWindows(buffer, nombreImpresora) {
    const os           = require('os');
    const { execFile } = require('child_process');
    const tmpFile      = path.join(os.tmpdir(), `corcega_${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, buffer);

    const psName = nombreImpresora.replace(/'/g, "''");
    const psPath = tmpFile.replace(/'/g, "''");

    const ps = `Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DocInfo {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA",    CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr p);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter",    CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr h, int lv, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter",   CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter",  CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter",    CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr h, IntPtr b, int n, out int w);
    public static void Send(string printer, string file) {
        IntPtr hPrinter;
        if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero))
            throw new Exception("OpenPrinter failed: " + printer);
        var di = new DocInfo { pDocName = "Ticket", pOutputFile = null, pDataType = "RAW" };
        if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); throw new Exception("StartDocPrinter failed"); }
        StartPagePrinter(hPrinter);
        byte[] data = File.ReadAllBytes(file);
        IntPtr ptr = Marshal.AllocCoTaskMem(data.Length);
        Marshal.Copy(data, 0, ptr, data.Length);
        int written;
        WritePrinter(hPrinter, ptr, data.Length, out written);
        Marshal.FreeCoTaskMem(ptr);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
    }
}
'@
[RawPrint]::Send('${psName}', '${psPath}')`;

    return new Promise((resolve, reject) => {
        execFile('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps],
            { windowsHide: true, timeout: 20000 },
            (err, _stdout, stderr) => {
                try { fs.unlinkSync(tmpFile); } catch (_) {}
                if (err) reject(new Error((stderr || err.message).trim()));
                else resolve();
            }
        );
    });
}

async function imprimirPedido(snap) {
    const b = EscposBuilder(ANCHO);
    generarTicket(snap.data(), snap.id, b);
    if (MODO === 'windows') {
        await imprimirWindows(b.build(), NOMBRE);
    } else {
        await enviarTCP(b.build());
    }
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
console.log(MODO === 'windows'
    ? `  Impresora: ${NOMBRE} (Windows spooler)`
    : `  Impresora: ${NOMBRE} @ ${IP}:${PUERTO}`);
console.log('================================================');
console.log('');
console.log('  Esta ventana tiene que quedar ABIERTA.');
console.log('');

iniciarListener();

process.on('uncaughtException',  err => log(`ERR  ${err.message}`));
process.on('unhandledRejection', r   => log(`ERR  ${r}`));
