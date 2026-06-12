// ─────────────────────────────────────────────────────────────────────────────
// ADMIN REVIEWS — Sección "Reviews Google" del Admin Dash
// FASE 1: datos de demostración. En Fase 3 se reemplaza fetchReviews() por
// la lectura de Firestore (colección "google_reviews" sincronizada por la
// Cloud Function con la Business Profile API).
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '../firebase-config.js';

const MODO_DEMO = true;
// Cloud Function que genera respuestas con Claude + manual de marca (Fase 2)
const GENERAR_URL = 'https://us-central1-corcega-loyalty-club.cloudfunctions.net/generarRespuestaReview';

// ── DATOS DE DEMO ────────────────────────────────────────────────────────────
const DEMO_REVIEWS = [
    { id: 'r01', autor: 'Mariana López', rating: 5, fecha: '2026-06-08', texto: 'El mejor café de especialidad de la zona. El flat white es espectacular y las medialunas de manteca recién hechas, un golazo. La atención de las chicas siempre con una sonrisa.', respondida: true, respuesta: '¡Gracias Mariana! Te esperamos siempre con el cafecito listo ☕' },
    { id: 'r02', autor: 'Joaquín Pereyra', rating: 5, fecha: '2026-06-05', texto: 'Lugar hermoso, muy luminoso y tranquilo para trabajar. El wifi anda perfecto y nadie te apura. El cold brew muy bueno.', respondida: false },
    { id: 'r03', autor: 'Carla Domínguez', rating: 2, fecha: '2026-06-04', texto: 'La comida rica pero esperamos 40 minutos un sábado al mediodía y nadie nos avisó de la demora. Cuando llegó, el tostado estaba frío. Una lástima porque el lugar es lindo.', respondida: false },
    { id: 'r04', autor: 'Federico Báez', rating: 4, fecha: '2026-06-01', texto: 'Muy buen café y la torta de zanahoria increíble. Le pongo 4 porque los precios subieron bastante últimamente, pero la calidad lo vale.', respondida: false },
    { id: 'r05', autor: 'Sofía Gutiérrez', rating: 5, fecha: '2026-05-28', texto: 'Fui con mi perra y la recibieron con agua y todo. Pet friendly de verdad. El brunch de fin de semana es enorme y delicioso. Volveremos!', respondida: true, respuesta: '¡Gracias Sofía! Mimos para tu perrita de parte del equipo 🐶💛' },
    { id: 'r06', autor: 'Martín Acosta', rating: 3, fecha: '2026-05-25', texto: 'El café muy bueno pero el local estaba lleno y no había lugar para sentarse. Estaría bueno que tengan más mesas afuera en verano.', respondida: false },
    { id: 'r07', autor: 'Lucía Fernández', rating: 5, fecha: '2026-05-22', texto: 'Las chicas de la barra son lo más. Me recomendaron un V60 de Etiopía que me voló la cabeza. Se nota que saben de café.', respondida: true, respuesta: '¡Gracias Lucía! El de Etiopía es nuestro favorito también 😍' },
    { id: 'r08', autor: 'Diego Romano', rating: 1, fecha: '2026-05-20', texto: 'Pedí por la tienda online y el pedido llegó incompleto, faltaba un budín. Mandé mail y tardaron dos días en responder. Mal.', respondida: false },
    { id: 'r09', autor: 'Valentina Ruiz', rating: 5, fecha: '2026-05-18', texto: 'El programa de puntos del Club Córcega está buenísimo, ya me gané dos cafés gratis. El lugar impecable y la música siempre bien elegida.', respondida: true, respuesta: '¡Eso! El Club Córcega premia a los cafeteros de ley ☕✨ ¡Gracias Valen!' },
    { id: 'r10', autor: 'Gonzalo Medina', rating: 4, fecha: '2026-05-15', texto: 'Excelente café de especialidad. El único tema es que los fines de semana hay que esperar mesa un buen rato. Consejo: vayan temprano.', respondida: false },
    { id: 'r11', autor: 'Agustina Vega', rating: 5, fecha: '2026-05-12', texto: 'Probé el cappuccino con leche de almendras y está perfecto. Tienen muchas opciones veggie y sin TACC, se agradece un montón.', respondida: false },
    { id: 'r12', autor: 'Ramiro Suárez', rating: 2, fecha: '2026-05-10', texto: 'El lugar es lindo pero el día que fui la moza estaba claramente desbordada, tardó muchísimo en tomarnos el pedido y se olvidó de traer un jugo. Falta personal.', respondida: false },
    { id: 'r13', autor: 'Camila Ortiz', rating: 5, fecha: '2026-05-07', texto: 'Hermosa cafetería, decoración preciosa para sacar fotos. La tostada de palta con huevo es mi desayuno favorito de la ciudad.', respondida: true, respuesta: '¡Gracias Cami! La de palta es un clásico de la casa 🥑' },
    { id: 'r14', autor: 'Nicolás Ferrer', rating: 4, fecha: '2026-05-03', texto: 'Buen café, buena pastelería y buena onda. El estacionamiento por la zona es un quilombo, pero eso no es culpa de ellos.', respondida: false },
    { id: 'r15', autor: 'Julieta Mansilla', rating: 5, fecha: '2026-04-29', texto: 'Festejé mi cumple acá con amigas y nos armaron la mesa divina, con tortita y velita sorpresa. Atención de 10, se pasaron.', respondida: true, respuesta: '¡Feliz cumple otra vez Juli! Gracias por elegirnos para festejar 🎂' },
    { id: 'r16', autor: 'Pablo Giménez', rating: 3, fecha: '2026-04-25', texto: 'Rico todo pero las porciones de la pastelería me parecieron chicas para el precio. El café sí, impecable.', respondida: false },
    { id: 'r17', autor: 'Florencia Castro', rating: 5, fecha: '2026-04-20', texto: 'El mejor brunch! Variado, abundante y todo fresco. Las mermeladas caseras son otro nivel. Ya es nuestro plan de domingo.', respondida: false },
    { id: 'r18', autor: 'Andrés Villalba', rating: 5, fecha: '2026-04-15', texto: 'Compré café en grano por la tienda online y llegó rapidísimo, muy bien empaquetado. El tueste medio es excelente para filtrados.', respondida: true, respuesta: '¡Gracias Andrés! Nos alegra que la tienda online te haya funcionado bien 📦☕' },
];

// Borradores que "generó el agente" para las reviews sin responder (DEMO).
// En Fase 2 esto lo genera la Cloud Function con Claude + manual de marca.
const DEMO_BORRADORES = {
    r02: ['¡Gracias Joaquín! Nos encanta ser tu oficina con olor a café recién molido ☕💻 El cold brew te espera cuando quieras volver.',
          '¡Mil gracias por la buena onda, Joaquín! Acá siempre vas a tener tu rincón tranquilo para trabajar. ¡Te esperamos!'],
    r03: ['Hola Carla, ante todo gracias por contarnos esto y mil disculpas por la espera y el tostado frío: no es la experiencia que queremos dar. Ya lo hablamos con el equipo de cocina para los mediodías de sábado. Nos encantaría que nos des otra oportunidad: escribinos a corcega.cafe@gmail.com y te invitamos el próximo tostado con café. 💛',
          'Carla, lamentamos mucho la demora y que el plato no haya llegado como corresponde. Tomamos nota para reforzar los sábados al mediodía. Gracias por avisarnos y ojalá podamos recibirte de nuevo para revertir esta experiencia.'],
    r04: ['¡Gracias Fede! La torta de zanahoria manda saludos 🥕 Sobre los precios: hacemos malabares para sostener la calidad de siempre con insumos que suben todos los meses. Valoramos un montón que lo reconozcas. ¡Te esperamos!'],
    r06: ['¡Gracias Martín! Tomamos nota: estamos viendo cómo sumar más mesas en la vereda para la temporada. Mientras tanto, los días de semana a la tarde suele estar más tranqui para encontrar lugar 😉'],
    r08: ['Hola Diego, tenés toda la razón en enojarte y te pedimos disculpas: el pedido incompleto y la demora en responder no se condicen con cómo queremos trabajar. Escribinos a corcega.cafe@gmail.com con tu número de orden y te compensamos el budín faltante con envío sin cargo. Gracias por avisarnos, nos ayuda a mejorar.'],
    r10: ['¡Gracias Gonza por la data y las 4 estrellas! Sí, los findes explota 🙈 Tip confirmado: antes de las 10 se consigue mesa seguro. ¡Te esperamos!'],
    r11: ['¡Gracias Agus! Nos pone muy contentos que encuentres opciones ricas siendo veggie. La carta sin TACC va a seguir creciendo, atenta a las novedades 🌱'],
    r12: ['Hola Ramiro, gracias por contarnos y disculpas por la espera y el jugo olvidado. Estamos reforzando el equipo de salón justamente para los días de más movimiento. Ojalá nos des revancha pronto.'],
    r14: ['¡Gracias Nico! Buena onda es nuestro ingrediente secreto 😄 Lo del estacionamiento lo sufrimos todos, ¡pero el café compensa! Te esperamos.'],
    r16: ['¡Gracias Pablo por la devolución sincera! Tomamos nota de lo de las porciones, lo estamos revisando con la pastelera. Nos alegra que el café haya estado impecable, como siempre intentamos. 💪'],
    r17: ['¡Gracias Flor! Que el brunch de Córcega sea su plan de domingo es el mejor cumplido que nos pueden hacer 🥐💛 Las mermeladas las hace nuestra cocinera con fruta de estación. ¡Hasta el domingo!'],
};

// Análisis "del agente" (DEMO). En Fase 2 lo genera Claude y se guarda en Firestore.
const DEMO_ANALISIS = {
    ventajas: [
        { tema: 'Calidad del café de especialidad', menciones: 9, cita: '"Me recomendaron un V60 de Etiopía que me voló la cabeza"' },
        { tema: 'Atención cálida del personal', menciones: 6, cita: '"Las chicas de la barra son lo más"' },
        { tema: 'Pastelería y brunch caseros', menciones: 6, cita: '"Las mermeladas caseras son otro nivel"' },
        { tema: 'Ambiente lindo para quedarse / trabajar', menciones: 5, cita: '"Muy luminoso y tranquilo para trabajar"' },
        { tema: 'Inclusivo: veggie, sin TACC, pet friendly', menciones: 3, cita: '"Pet friendly de verdad"' },
        { tema: 'Club de puntos y tienda online', menciones: 2, cita: '"Ya me gané dos cafés gratis"' },
    ],
    desventajas: [
        { tema: 'Demoras en fines de semana / hora pico', menciones: 4, cita: '"Esperamos 40 minutos un sábado al mediodía"' },
        { tema: 'Falta de personal en salón', menciones: 2, cita: '"La moza estaba claramente desbordada"' },
        { tema: 'Percepción de precios altos', menciones: 2, cita: '"Los precios subieron bastante últimamente"' },
        { tema: 'Capacidad del local limitada', menciones: 2, cita: '"No había lugar para sentarse"' },
        { tema: 'Errores en pedidos de tienda online', menciones: 1, cita: '"El pedido llegó incompleto"' },
    ],
};

// ── ESTADO ───────────────────────────────────────────────────────────────────
let _reviews = [];
let _filtroEstrellas = 0;   // 0 = todas
let _filtroEstado = 'todas'; // todas | pendientes | respondidas
let _cargado = false;

// ── HELPERS ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const estrellas = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const colorRating = (n) => n >= 4 ? 'var(--success)' : (n === 3 ? '#b58900' : 'var(--error)');
const fechaLinda = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg, ok = true) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed; bottom:24px; right:24px; z-index:9999; padding:14px 22px;
        background:${ok ? 'var(--secondary)' : 'var(--error)'}; color:white; border-radius:12px;
        font-weight:600; font-size:0.85rem; box-shadow:0 8px 30px rgba(0,0,0,0.25); animation:fadeIn 0.3s;`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
}

// Simula la fuente de datos. Fase 3: leer de Firestore "google_reviews".
async function fetchReviews() {
    return DEMO_REVIEWS.map(r => ({
        ...r,
        borradores: DEMO_BORRADORES[r.id] || null,
        borradorIdx: 0,
    }));
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
function renderKPIs() {
    const total = _reviews.length;
    const avg = (_reviews.reduce((a, r) => a + r.rating, 0) / total).toFixed(1);
    const respondidas = _reviews.filter(r => r.respondida).length;
    const pendientes = total - respondidas;
    const negativas = _reviews.filter(r => r.rating <= 2 && !r.respondida).length;

    $('rev-stat-avg').textContent = avg + ' ★';
    $('rev-stat-total').textContent = total;
    $('rev-stat-respondidas').textContent = Math.round(respondidas / total * 100) + '%';
    $('rev-stat-pendientes').textContent = pendientes;
    $('rev-alert-negativas').style.display = negativas > 0 ? 'block' : 'none';
    if (negativas > 0) $('rev-alert-negativas-num').textContent = negativas;
}

// ── BANDEJA DE BORRADORES (el corazón de la sección) ─────────────────────────
function renderBandeja() {
    const cont = $('rev-bandeja');
    const pendientes = _reviews.filter(r => !r.respondida && r.borradores);
    $('rev-bandeja-count').textContent = pendientes.length;

    if (!pendientes.length) {
        cont.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">
            🎉 ¡Bandeja vacía! Todas las reviews tienen respuesta.</div>`;
        return;
    }

    // Las negativas primero: son las urgentes
    pendientes.sort((a, b) => a.rating - b.rating || b.fecha.localeCompare(a.fecha));

    cont.innerHTML = pendientes.map(r => `
        <div class="card rev-draft-card" id="draft-${r.id}" style="margin-bottom:16px; ${r.rating <= 2 ? 'border-left:4px solid var(--error);' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                <div>
                    <strong>${esc(r.autor)}</strong>
                    <span style="color:${colorRating(r.rating)}; margin-left:8px; letter-spacing:2px;">${estrellas(r.rating)}</span>
                    <span style="color:var(--text-muted); font-size:0.78rem; margin-left:8px;">${fechaLinda(r.fecha)}</span>
                </div>
                ${r.rating <= 2 ? '<span style="background:#fff5f5; color:var(--error); font-size:0.7rem; font-weight:700; padding:4px 10px; border-radius:20px;">⚠️ REVISAR CON CUIDADO</span>' : ''}
            </div>
            <p style="margin:12px 0; font-size:0.88rem; color:var(--text-main); background:var(--bg-color); padding:12px 16px; border-radius:12px;">${esc(r.texto)}</p>
            <div style="font-size:0.72rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">
                🤖 Respuesta sugerida por el agente
            </div>
            <textarea id="draft-text-${r.id}" style="width:100%; min-height:90px; padding:12px 14px; border:1px solid var(--border);
                border-radius:12px; font-family:inherit; font-size:0.85rem; resize:vertical; background:var(--primary-light);">${esc(r.borradores[r.borradorIdx])}</textarea>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                <button class="btn-rev" style="background:var(--success); color:white;" onclick="window.reviewsAdmin.aprobar('${r.id}')">✅ Aprobar y publicar</button>
                <button class="btn-rev" style="background:var(--white); border:1px solid var(--border);" onclick="window.reviewsAdmin.regenerar('${r.id}', this)">🔄 Otra versión</button>
                <button class="btn-rev" style="background:var(--white); border:1px solid var(--border); color:var(--text-muted);" onclick="window.reviewsAdmin.descartar('${r.id}')">🗑️ Descartar</button>
            </div>
        </div>`).join('');
}

// ── NUBE DE PALABRAS ─────────────────────────────────────────────────────────
const STOPWORDS = new Set(('de la que el en y a los se del las un por con no una su para es al lo como ' +
    'más pero sus le ya o fue este ha sí porque esta son entre cuando muy sin sobre también me hasta hay ' +
    'donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes ' +
    'algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar ' +
    'estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros si fui era estaba estamos ' +
    'fue fueron ser tiene tienen tenía había han he hemos está están estaban va van iba bien buen buena ' +
    'bueno buenos buenas rico rica ricos ricas lindo linda gracias lugar día vez nadie nuestro nuestra ya').split(/\s+/));

function renderNube() {
    const freq = {};
    _reviews.forEach(r => {
        r.texto.toLowerCase().replace(/[^\wáéíóúüñ\s]/g, ' ').split(/\s+/).forEach(w => {
            if (w.length < 4 || STOPWORDS.has(w)) return;
            freq[w] = (freq[w] || 0) + 1;
        });
    });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 40);
    if (!top.length) { $('rev-nube').innerHTML = ''; return; }
    const max = top[0][1];
    const colores = ['var(--primary)', 'var(--secondary)', 'var(--success)', '#b58900', 'var(--primary-dark)'];
    // Mezclar para que las grandes no queden todas juntas
    top.sort(() => Math.random() - 0.5);
    $('rev-nube').innerHTML = top.map(([w, n], i) => {
        const size = 0.75 + (n / max) * 1.5;
        return `<span title="${n} menciones" style="font-size:${size.toFixed(2)}rem; font-weight:${n / max > 0.5 ? 800 : 600};
            color:${colores[i % colores.length]}; padding:2px 8px; cursor:default; line-height:1.4;">${esc(w)}</span>`;
    }).join('');
}

// ── VENTAJAS / DESVENTAJAS ───────────────────────────────────────────────────
function renderAnalisis() {
    const item = (x, pos) => `
        <li style="margin-bottom:14px; list-style:none;">
            <div style="display:flex; justify-content:space-between; gap:8px;">
                <strong style="font-size:0.85rem;">${pos ? '💚' : '🔴'} ${esc(x.tema)}</strong>
                <span style="font-size:0.72rem; color:var(--text-muted); white-space:nowrap;">${x.menciones} menciones</span>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted); font-style:italic; margin-top:3px;">${esc(x.cita)}</div>
        </li>`;
    $('rev-ventajas').innerHTML = DEMO_ANALISIS.ventajas.map(x => item(x, true)).join('');
    $('rev-desventajas').innerHTML = DEMO_ANALISIS.desventajas.map(x => item(x, false)).join('');
}

// ── LISTA COMPLETA ───────────────────────────────────────────────────────────
function renderLista() {
    let lista = [..._reviews].sort((a, b) => b.fecha.localeCompare(a.fecha));
    if (_filtroEstrellas) lista = lista.filter(r => r.rating === _filtroEstrellas);
    if (_filtroEstado === 'pendientes') lista = lista.filter(r => !r.respondida);
    if (_filtroEstado === 'respondidas') lista = lista.filter(r => r.respondida);

    $('rev-lista').innerHTML = lista.length ? lista.map(r => `
        <div style="padding:16px 0; border-bottom:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                <div>
                    <strong style="font-size:0.88rem;">${esc(r.autor)}</strong>
                    <span style="color:${colorRating(r.rating)}; margin-left:8px; letter-spacing:2px;">${estrellas(r.rating)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:0.75rem; color:var(--text-muted);">${fechaLinda(r.fecha)}</span>
                    ${r.respondida
                        ? '<span style="font-size:0.68rem; font-weight:700; color:var(--success); background:#edf7f2; padding:3px 10px; border-radius:20px;">✓ RESPONDIDA</span>'
                        : '<span style="font-size:0.68rem; font-weight:700; color:var(--primary); background:var(--primary-light); padding:3px 10px; border-radius:20px;">⏳ PENDIENTE</span>'}
                </div>
            </div>
            <p style="margin:8px 0 0; font-size:0.85rem; color:var(--text-main);">${esc(r.texto)}</p>
            ${r.respondida && r.respuesta ? `
                <div style="margin-top:10px; padding:10px 14px; background:var(--bg-color); border-left:3px solid var(--success); border-radius:0 10px 10px 0;">
                    <div style="font-size:0.68rem; font-weight:700; color:var(--success); margin-bottom:3px;">RESPUESTA DE CÓRCEGA</div>
                    <span style="font-size:0.82rem; color:var(--text-muted);">${esc(r.respuesta)}</span>
                </div>` : ''}
        </div>`).join('')
        : '<div style="padding:30px; text-align:center; color:var(--text-muted);">No hay reviews con esos filtros.</div>';
}

function renderTodo() {
    renderKPIs();
    renderBandeja();
    renderNube();
    renderAnalisis();
    renderLista();
}

// ── ACCIONES PÚBLICAS ────────────────────────────────────────────────────────
export async function load() {
    if (_cargado) return;
    _cargado = true;
    _reviews = await fetchReviews();
    $('rev-demo-banner').style.display = MODO_DEMO ? 'flex' : 'none';
    renderTodo();
}

export function aprobar(id) {
    const r = _reviews.find(x => x.id === id);
    if (!r) return;
    const texto = $(`draft-text-${id}`).value.trim();
    if (!texto) { toast('La respuesta no puede estar vacía', false); return; }
    // FASE 3: acá se llama a la Cloud Function que publica vía Business Profile API
    r.respondida = true;
    r.respuesta = texto;
    r.borradores = null;
    toast(MODO_DEMO ? '✅ (Demo) Respuesta "publicada" en Google' : '✅ Respuesta publicada en Google');
    renderTodo();
}

export async function regenerar(id, btn) {
    const r = _reviews.find(x => x.id === id);
    if (!r || !r.borradores) return;

    if (btn) { btn.disabled = true; btn.textContent = '🤖 Generando...'; }
    try {
        // Genera una versión nueva con Claude + manual de marca (Cloud Function)
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(GENERAR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ autor: r.autor, rating: r.rating, texto: r.texto, previas: r.borradores }),
        });
        if (!res.ok) throw new Error((await res.json()).error || res.status);
        const { respuesta } = await res.json();
        r.borradores.push(respuesta);
        r.borradorIdx = r.borradores.length - 1;
        $(`draft-text-${id}`).value = respuesta;
        toast('🤖 Nueva versión generada por el agente');
    } catch (e) {
        console.warn('[reviews] Falló la generación con IA, uso versión local:', e);
        if (r.borradores.length > 1) {
            r.borradorIdx = (r.borradorIdx + 1) % r.borradores.length;
            $(`draft-text-${id}`).value = r.borradores[r.borradorIdx];
            toast('🔄 Versión alternativa (local)');
        } else {
            toast('No se pudo generar otra versión', false);
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Otra versión'; }
    }
}

export function descartar(id) {
    const r = _reviews.find(x => x.id === id);
    if (!r) return;
    r.borradores = null;
    toast('Borrador descartado — la review queda pendiente');
    renderTodo();
}

export function filtrarEstrellas(n, btn) {
    _filtroEstrellas = (_filtroEstrellas === n) ? 0 : n;
    document.querySelectorAll('.rev-filter-star').forEach(b => b.classList.remove('active'));
    if (_filtroEstrellas) btn.classList.add('active');
    renderLista();
}

export function filtrarEstado(estado, btn) {
    _filtroEstado = estado;
    document.querySelectorAll('.rev-filter-estado').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLista();
}
