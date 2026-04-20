'use strict';

/**
 * index-ui.js — Servicio de impresión con interfaz web.
 * Abre automáticamente http://localhost:3000 con la cola de impresión.
 * Modo PDF (para testear) o impresora térmica (producción), según config.json
 */

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const { exec } = require('child_process');
const admin  = require('firebase-admin');

// ─── BASE DIR (exe vs node) ───────────────────────────────────────────────────
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

const CFG_PATH = path.join(BASE_DIR, 'config.json');
const KEY_PATH = path.join(BASE_DIR, 'serviceAccountKey.json');
const LOG_FILE = path.join(BASE_DIR, 'imprimir.log');
const PORT     = 3000;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function log(msg) {
    const ts   = new Date().toLocaleString('es-AR', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

function waitAndExit(msg) {
    console.error(`\n${msg}\n\nPresioná ENTER para cerrar...`);
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
}

// ─── VALIDAR ARCHIVOS ────────────────────────────────────────────────────────
if (!fs.existsSync(CFG_PATH)) return waitAndExit(`ERROR: falta config.json en ${BASE_DIR}`);
if (!fs.existsSync(KEY_PATH)) return waitAndExit(`ERROR: falta serviceAccountKey.json en ${BASE_DIR}`);

const config   = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const MODO     = config.modo || 'pdf';          // 'pdf' o 'printer'
const MAX_REINT = config.reintentos      || 5;
const DELAY    = config.delayReintentoMs || 15000;

// ─── FIREBASE ────────────────────────────────────────────────────────────────
try {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))),
        projectId:  config.projectId
    });
} catch (e) { return waitAndExit(`ERROR Firebase: ${e.message}`); }

const db = admin.firestore();

// ─── COLA EN MEMORIA ─────────────────────────────────────────────────────────
// { id, uid, nombre, total, ts, estado: 'procesando'|'impreso'|'error', detalle }
const MAX_COLA = 100;
const cola     = [];
const sseClients = new Set();

function colaUpsert(id, patch) {
    const uid = id.slice(-8).toUpperCase();
    let item = cola.find(i => i.id === id);
    if (!item) {
        item = { id, uid, nombre: '—', total: 0, ts: new Date().toISOString(), estado: 'procesando', detalle: '' };
        cola.unshift(item);
        if (cola.length > MAX_COLA) cola.pop();
    }
    Object.assign(item, patch);
    broadcast({ tipo: 'cola', cola });
}

function broadcast(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) { try { res.write(msg); } catch (_) {} }
}

// ─── IMPRIMIR ─────────────────────────────────────────────────────────────────
async function ejecutarImpresion(snap) {
    if (MODO === 'pdf') {
        const { generarYAbrirPDF } = require('./ticket-pdf.js');
        await generarYAbrirPDF(snap.data(), snap.id);
    } else {
        const net = require('net');
        const { EscposBuilder } = require('./escpos.js');
        const { generarTicket }  = require('./ticket.js');
        const IP     = config.printerIp;
        const PUERTO = config.printerPort || 9100;
        const ANCHO  = config.anchoCaracteres || 48;
        const b      = EscposBuilder(ANCHO);
        generarTicket(snap.data(), snap.id, b);
        await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            socket.setTimeout(10000);
            socket.connect(PUERTO, IP, () => { socket.write(b.build(), () => { socket.end(); resolve(); }); });
            socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
            socket.on('error', reject);
        });
    }
}

// ─── RETRY WRAPPER ────────────────────────────────────────────────────────────
const enProceso = new Set();

async function procesarConReintentos(snap) {
    const id   = snap.id;
    const data = snap.data();
    const uid  = id.slice(-8).toUpperCase();

    colaUpsert(id, {
        nombre: data.cliente?.nombre || '?',
        total:  data.total || 0,
        ts:     new Date().toISOString(),
        estado: 'procesando',
        detalle: ''
    });

    for (let i = 1; i <= MAX_REINT; i++) {
        try {
            await ejecutarImpresion(snap);
            await db.collection('ordenes').doc(id).update({ impreso: true });
            log(`OK   #${uid} — ${data.cliente?.nombre || '?'}`);
            colaUpsert(id, { estado: 'impreso', detalle: new Date().toLocaleTimeString('es-AR') });
            return;
        } catch (err) {
            log(`WARN [${i}/${MAX_REINT}] #${uid}: ${err.message}`);
            colaUpsert(id, { estado: 'error', detalle: err.message });
            if (i < MAX_REINT) await new Promise(r => setTimeout(r, DELAY));
        }
    }
    log(`ERR  #${uid} — falló tras ${MAX_REINT} intentos`);
}

// ─── LISTENER FIRESTORE ───────────────────────────────────────────────────────
function iniciarListener() {
    log('Escuchando Firestore...');
    db.collection('ordenes')
      .where('estado', '==', 'pagado')
      .onSnapshot(
        (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type !== 'added') return;
                const data = change.doc.data();
                if (data.impreso === true) {
                    // Mostrar en la cola como ya impresos (historial)
                    colaUpsert(change.doc.id, {
                        nombre: data.cliente?.nombre || '?',
                        total:  data.total || 0,
                        ts:     data.timestamp?._seconds
                                  ? new Date(data.timestamp._seconds * 1000).toISOString()
                                  : new Date().toISOString(),
                        estado: 'impreso',
                        detalle: 'ya estaba impreso'
                    });
                    return;
                }
                const id = change.doc.id;
                if (enProceso.has(id)) return;
                enProceso.add(id);
                log(`NUEVO #${id.slice(-8).toUpperCase()} — ${data.cliente?.nombre || '?'}`);
                procesarConReintentos(change.doc).finally(() => enProceso.delete(id));
            });
        },
        (err) => {
            log(`ERR Listener caído: ${err.message}. Reconectando en 30s...`);
            broadcast({ tipo: 'estado', conectado: false });
            setTimeout(iniciarListener, 30000);
        }
    );
    broadcast({ tipo: 'estado', conectado: true });
}

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Córcega — Cola de Impresión</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;color:#1a1a2e}
  header{background:#01323f;color:white;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px}
  header h1{font-size:16px;font-weight:700;letter-spacing:0.5px}
  .badge{font-size:11px;padding:4px 10px;border-radius:50px;font-weight:700}
  .badge-on{background:#22c55e;color:white}
  .badge-off{background:#ef4444;color:white}
  .badge-modo{background:rgba(255,255,255,0.15);color:white}
  main{max-width:900px;margin:24px auto;padding:0 16px}
  .section-title{font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#888;margin:20px 0 10px}
  .empty{text-align:center;padding:40px;color:#bbb;font-size:14px}
  .card{background:white;border-radius:14px;padding:16px 18px;margin-bottom:10px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:box-shadow 0.2s}
  .card:hover{box-shadow:0 4px 16px rgba(0,0,0,0.1)}
  .card-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  .icon-procesando{background:#fef9c3}
  .icon-impreso{background:#f0fdf4}
  .icon-error{background:#fef2f2}
  .card-info{flex:1;min-width:0}
  .card-title{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .card-sub{font-size:12px;color:#888;margin-top:2px}
  .card-total{font-weight:800;font-size:15px;color:#ed7053;margin-right:8px;flex-shrink:0}
  .pill{font-size:11px;font-weight:700;padding:3px 10px;border-radius:50px;flex-shrink:0}
  .pill-procesando{background:#fef9c3;color:#a16207;animation:pulse 1.5s infinite}
  .pill-impreso{background:#f0fdf4;color:#15803d}
  .pill-error{background:#fef2f2;color:#dc2626}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
  .btn-reprint{border:none;background:#01323f;color:white;padding:8px 14px;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.2s;flex-shrink:0}
  .btn-reprint:hover{background:#ed7053;transform:translateY(-1px)}
  .btn-reprint:disabled{background:#ccc;cursor:not-allowed;transform:none}
  .ts{font-size:11px;color:#ccc;flex-shrink:0;min-width:55px;text-align:right}
  .toolbar{display:flex;gap:10px;margin-bottom:4px}
  .btn-refresh{border:1px solid #e5e7eb;background:white;padding:8px 16px;border-radius:9px;font-size:13px;cursor:pointer;font-weight:600;color:#555}
  .btn-refresh:hover{background:#f9fafb}
  .detalle-err{font-size:11px;color:#dc2626;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
</head>
<body>
<header>
  <h1>🖨 Córcega Café — Cola de Impresión</h1>
  <div style="display:flex;gap:8px;align-items:center">
    <span class="badge badge-modo" id="badge-modo">—</span>
    <span class="badge badge-off" id="badge-estado">⬤ Conectando...</span>
  </div>
</header>
<main>
  <div class="toolbar">
    <button class="btn-refresh" onclick="forzarRecarga()">↻ Recargar cola</button>
  </div>
  <div class="section-title">PENDIENTES / EN PROCESO</div>
  <div id="lista-pendientes"><div class="empty">Sin pedidos pendientes ✓</div></div>
  <div class="section-title">HISTORIAL (últimas 100)</div>
  <div id="lista-impresos"><div class="empty">Aún no hay pedidos impresos.</div></div>
</main>
<script>
const modoLabel = { pdf: '📄 Modo PDF', printer: '🖨 Impresora térmica' };
let colaData = [];

function ts(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
}

function renderCola(cola) {
  colaData = cola;
  const pendientes = cola.filter(i => i.estado === 'procesando' || i.estado === 'error');
  const impresos   = cola.filter(i => i.estado === 'impreso');

  const icons = { procesando: '⏳', impreso: '✅', error: '❌' };

  function card(item) {
    const det = item.estado === 'error'
      ? \`<div class="detalle-err">⚠ \${item.detalle || 'Error desconocido'}</div>\`
      : '';
    return \`<div class="card" id="card-\${item.id}">
      <div class="card-icon icon-\${item.estado}">\${icons[item.estado] || '?'}</div>
      <div class="card-info">
        <div class="card-title">#\${item.uid} — \${item.nombre}</div>
        <div class="card-sub">Horario pedido: \${ts(item.ts)}\${item.estado==='impreso'&&item.detalle?' · impreso: '+item.detalle:''}</div>
        \${det}
      </div>
      <div class="card-total">$\${(item.total||0).toLocaleString('es-AR')}</div>
      <span class="pill pill-\${item.estado}">\${item.estado.toUpperCase()}</span>
      <button class="btn-reprint" onclick="reimprimir('\${item.id}', this)" \${item.estado==='procesando'?'disabled':''}>
        🖨 Reimprimir
      </button>
    </div>\`;
  }

  document.getElementById('lista-pendientes').innerHTML =
    pendientes.length ? pendientes.map(card).join('') : '<div class="empty">Sin pedidos pendientes ✓</div>';
  document.getElementById('lista-impresos').innerHTML =
    impresos.length ? impresos.map(card).join('') : '<div class="empty">Aún no hay pedidos impresos.</div>';
}

async function reimprimir(id, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const r = await fetch('/api/reprint/' + id, { method: 'POST' });
  const d = await r.json();
  btn.textContent = d.ok ? '✓ Enviado' : '✗ Error';
  setTimeout(() => { btn.disabled = false; btn.textContent = '🖨 Reimprimir'; }, 3000);
}

async function forzarRecarga() {
  const r = await fetch('/api/queue');
  const d = await r.json();
  renderCola(d.cola);
}

// SSE
const evs = new EventSource('/events');
evs.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.tipo === 'cola') renderCola(d.cola);
  if (d.tipo === 'estado') {
    const b = document.getElementById('badge-estado');
    b.className = 'badge ' + (d.conectado ? 'badge-on' : 'badge-off');
    b.textContent = d.conectado ? '⬤ Conectado' : '⬤ Sin conexión';
  }
  if (d.tipo === 'modo') {
    document.getElementById('badge-modo').textContent = modoLabel[d.modo] || d.modo;
  }
};
evs.onerror = () => {
  document.getElementById('badge-estado').className = 'badge badge-off';
  document.getElementById('badge-estado').textContent = '⬤ Sin conexión';
};

// Cargar cola inicial
forzarRecarga();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
    const url = req.url;

    // GET / → UI
    if (req.method === 'GET' && url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML);
    }

    // GET /events → SSE
    if (req.method === 'GET' && url === '/events') {
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ tipo: 'modo', modo: MODO })}\n\n`);
        res.write(`data: ${JSON.stringify({ tipo: 'estado', conectado: true })}\n\n`);
        res.write(`data: ${JSON.stringify({ tipo: 'cola', cola })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    // GET /api/queue → JSON
    if (req.method === 'GET' && url === '/api/queue') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ cola }));
    }

    // POST /api/reprint/:id
    const reprMatch = url.match(/^\/api\/reprint\/(.+)$/);
    if (req.method === 'POST' && reprMatch) {
        const id = reprMatch[1];
        try {
            const snap = await db.collection('ordenes').doc(id).get();
            if (!snap.exists()) throw new Error('Pedido no encontrado');
            colaUpsert(id, { estado: 'procesando', detalle: 'reimprimiendo...' });
            procesarConReintentos(snap).catch(e => log(`Reprint error: ${e.message}`));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
    }

    res.writeHead(404); res.end();
});

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('================================================');
    console.log(`  Corcega Cafe — Servicio de Impresion`);
    console.log(`  Modo: ${MODO === 'pdf' ? 'PDF (prueba)' : 'Impresora termica'}`);
    console.log('================================================');
    console.log('');
    console.log(`  Abriendo http://localhost:${PORT} ...`);
    console.log('');
    console.log('  Deja esta ventana abierta mientras uses el servicio.');
    console.log('');

    // Abrir el browser automáticamente
    const cmd = process.platform === 'win32'
        ? `start http://localhost:${PORT}`
        : `open http://localhost:${PORT}`;
    exec(cmd);

    iniciarListener();
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`  Puerto ${PORT} en uso — abriendo el que ya está corriendo...`);
        const cmd = process.platform === 'win32'
            ? `start http://localhost:${PORT}`
            : `open http://localhost:${PORT}`;
        exec(cmd);
    } else {
        waitAndExit(`ERROR servidor: ${e.message}`);
    }
});

process.on('uncaughtException',  err => log(`ERR ${err.message}`));
process.on('unhandledRejection', r   => log(`ERR ${r}`));
