import { db } from '../firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Lógica compartida de disponibilidad de retiro (agenda):
// la usan el checkout, la página de producto y el drawer del carrito.

const FECHA_KEY = 'corcega_fecha_retiro';

// --- Fecha elegida (persiste entre páginas hasta finalizar el pedido) ---
export function getFechaRetiro() {
    try {
        const data = JSON.parse(localStorage.getItem(FECHA_KEY));
        return (data && data.iso) ? data : null;
    } catch { return null; }
}

export function saveFechaRetiro(iso, fmt) {
    localStorage.setItem(FECHA_KEY, JSON.stringify({ iso, fmt }));
    window.dispatchEvent(new CustomEvent('corcega:fecha-retiro'));
}

export function clearFechaRetiro() {
    localStorage.removeItem(FECHA_KEY);
    window.dispatchEvent(new CustomEvent('corcega:fecha-retiro'));
}

// --- Helpers de fechas ---
export function isoFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateFromISO(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    return date;
}

export function parseHorarioToISO(horario) {
    // Parses flatpickr format "Lunes 21/04/2025" → "2025-04-21"
    if (!horario) return null;
    const match = horario.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    return `${year}-${month}-${day.padStart(2, '0')}`;
}

// --- Config de tienda ---
export async function getAgendaConfig() {
    const snap = await getDoc(doc(db, 'configuracion', 'tienda'));
    const config = snap.exists() ? snap.data() : {};
    return {
        agendaConfig: config.agenda || {},
        pedidosMaximosDia: config.agenda?.pedidosMaximosDia || 0
    };
}

// Dado un listado de items ({id, qty}), busca los productos y calcula la config
// de agenda más restrictiva (días de anticipación, horario de corte, mensaje).
export async function computeAgendaMeta(items, agendaConfig) {
    let maxDias = agendaConfig?.minAnticipacion || 0;
    let mensajeAgenda = null;
    let anyRequiresAgenda = false;
    const agendaCartIds = new Set(); // IDs de productos del listado que requieren agenda

    const productIds = [...new Set(items.map(item => item.id).filter(Boolean))];
    if (productIds.length > 0) {
        const results = await Promise.allSettled(productIds.map(id => getDoc(doc(db, "productos", id))));
        for (const result of results) {
            if (result.status !== 'fulfilled') {
                console.warn("No se pudo leer producto para agenda:", result.reason);
                continue;
            }
            const snap = result.value;
            if (!snap.exists()) continue;
            const p = snap.data();
            if (!p.requiereAgenda) continue;

            anyRequiresAgenda = true;
            agendaCartIds.add(snap.id);
            let dias = p.diasAnticipacion || 0;
            // Apply cutoff time: if now is past the cutoff hour, add +1 day
            if (p.horarioCorte) {
                const [hStr, mStr] = p.horarioCorte.split(':');
                const corte = new Date();
                corte.setHours(parseInt(hStr), parseInt(mStr), 0, 0);
                if (new Date() > corte) dias += 1;
            }
            // Update max days (most restrictive wins)
            if (dias > maxDias) maxDias = dias;
            // Collect the first mensaje from any agenda product that has one
            if (p.mensajeAgenda && !mensajeAgenda) mensajeAgenda = p.mensajeAgenda;
        }
    }

    return { anyRequiresAgenda, maxDias, mensajeAgenda, agendaCartIds };
}

// Cuenta unidades ya pedidas por día (solo productos con agenda) para colorear el calendario.
export async function fetchOrderCounts() {
    const agendaSnap = await getDocs(query(collection(db, 'productos'), where('requiereAgenda', '==', true)));
    const agendaIds = new Set(agendaSnap.docs.map(d => d.id));

    const orderCountByDate = {};
    const ordersSnap = await getDocs(collection(db, "ordenes"));
    ordersSnap.docs.forEach(d => {
        const data = d.data();
        if (data.estado === 'cancelado') return;
        const iso = data.fechaISO || parseHorarioToISO(data.horario);
        if (iso) {
            const totalItems = (data.items || [])
                .filter(it => agendaIds.has(it.id))
                .reduce((s, it) => s + (it.qty || 1), 0);
            if (totalItems > 0) orderCountByDate[iso] = (orderCountByDate[iso] || 0) + totalItems;
        }
    });
    return { orderCountByDate, agendaIds };
}

// ¿Se puede elegir esta fecha con las reglas actuales? (para revalidar una fecha guardada)
export function isDateSelectable(iso, { minDate, workingDays, blockedDates, pedidosMaximosDia, orderCountByDate, extraQty = 0 }) {
    const d = dateFromISO(iso);
    if (!d || d < minDate) return false;
    if (!workingDays.includes(d.getDay())) return false;
    if (blockedDates.includes(iso)) return false;
    if (pedidosMaximosDia > 0) {
        const effective = (orderCountByDate[iso] || 0) + extraQty;
        if (effective / pedidosMaximosDia >= 1) return false;
    }
    return true;
}

// Config base de flatpickr con el coloreo de días (verde/amarillo/rojo).
export function buildCalendarConfig({ minDate, workingDays, blockedDates, pedidosMaximosDia, orderCountByDate, extraQty = 0 }) {
    return {
        locale: "es",
        minDate: minDate,
        dateFormat: "l d/m/Y",
        disable: [
            function(date) {
                return !workingDays.includes(date.getDay());
            },
            ...blockedDates
        ],
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const d = dayElem.dateObj;
            d.setHours(0, 0, 0, 0);

            // Skip: past or before minDate
            if (d < minDate) return;
            // Skip: day of week not in workingDays
            if (!workingDays.includes(d.getDay())) return;
            // Skip: explicitly blocked date
            const iso = isoFromDate(d);
            if (blockedDates.includes(iso)) return;

            // Add a small colored dot below the day number
            const dot = document.createElement('span');
            dot.style.cssText = 'display:block; width:5px; height:5px; border-radius:50%; margin: 2px auto 0; flex-shrink:0;';

            if (pedidosMaximosDia > 0) {
                const count = orderCountByDate[iso] || 0;
                const effective = count + extraQty;
                const ratio = effective / pedidosMaximosDia;
                if (ratio >= 1) {
                    dot.style.background = '#ef4444';
                    dayElem.classList.add('flatpickr-disabled');
                    dayElem.title = extraQty > 0
                        ? `Tu pedido tiene ${extraQty} producto${extraQty === 1 ? '' : 's'} con agenda y este día no tiene lugar`
                        : 'Día completo';
                } else if (ratio >= 0.7) {
                    const remaining = pedidosMaximosDia - effective;
                    dot.style.background = '#f59e0b';
                    dayElem.title = `${remaining} lugar${remaining === 1 ? '' : 'es'} disponible${remaining === 1 ? '' : 's'}`;
                } else {
                    dot.style.background = '#22c55e';
                }
                dayElem.appendChild(dot);
            }
        }
    };
}

// --- Carga perezosa de flatpickr (producto/tienda no lo incluyen en el HTML) ---
let _fpLoading = null;
function ensureFlatpickr() {
    if (window.flatpickr && window.flatpickr.l10ns?.es) return Promise.resolve();
    if (_fpLoading) return _fpLoading;

    const loadScript = src => new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });

    if (!document.querySelector('link[href*="flatpickr"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
        document.head.appendChild(link);
    }

    _fpLoading = (window.flatpickr ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/flatpickr'))
        .then(() => window.flatpickr.l10ns?.es ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/es.js'))
        .catch(err => { _fpLoading = null; throw err; });
    return _fpLoading;
}

// --- Modal de disponibilidad ---
let _modalFp = null;

function ensureModalDom() {
    let modal = document.getElementById('disponibilidad-modal');
    if (modal) return modal;

    const style = document.createElement('style');
    style.textContent = `
        #disponibilidad-modal .flatpickr-calendar { font-family: var(--font-base, inherit) !important; font-size: 13px !important; border-radius: 16px !important; padding: 4px !important; }
        #disponibilidad-modal .flatpickr-calendar.inline { margin: 0 auto; box-shadow: none !important; border: 1px solid #eee !important; top: 0 !important; }
        #disponibilidad-modal .flatpickr-months { padding: 8px 4px 4px !important; }
        #disponibilidad-modal .flatpickr-month { font-size: 14px !important; height: 34px !important; }
        #disponibilidad-modal .flatpickr-current-month { font-size: 14px !important; font-weight: 700 !important; padding-top: 4px !important; }
        #disponibilidad-modal .flatpickr-weekday { font-size: 11px !important; font-weight: 700 !important; color: #aaa !important; }
        #disponibilidad-modal .flatpickr-day { font-size: 12px !important; height: 36px !important; border-radius: 10px !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; line-height: 1 !important; padding-top: 6px !important; }
        #disponibilidad-modal .flatpickr-day.selected, #disponibilidad-modal .flatpickr-day.selected:hover { background: var(--naranja-accent, #d86634) !important; border-color: var(--naranja-accent, #d86634) !important; }
        #disponibilidad-modal .flatpickr-day.today { border-color: var(--naranja-accent, #d86634) !important; }
        #disponibilidad-modal .flatpickr-day.flatpickr-disabled, #disponibilidad-modal .flatpickr-day.flatpickr-disabled:hover { color: #ddd !important; text-decoration: none !important; }
    `;
    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'disponibilidad-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9500;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);padding:20px;';
    modal.innerHTML = `
        <div style="background:white;border-radius:20px;padding:24px 20px;max-width:400px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
            <button id="dispo-modal-close" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:1.3rem;cursor:pointer;color:#aaa;">✕</button>
            <h3 style="font-size:1rem;font-weight:800;color:var(--secondary,#01323f);margin:0 0 4px;">📅 Disponibilidad de retiro</h3>
            <p style="font-size:0.8rem;color:#888;margin:0 0 14px;">Elegí un día disponible o mirá la agenda. Podés confirmarlo después, al finalizar tu pedido.</p>
            <div id="dispo-modal-loader" style="text-align:center;padding:30px 0;color:#999;font-size:0.85rem;">Cargando disponibilidad… ⏳</div>
            <div id="dispo-modal-body" style="display:none;">
                <div id="dispo-modal-mensaje" style="display:none;margin-bottom:12px;padding:10px 14px;background:linear-gradient(135deg,#fff8e1,#fff3cd);border-left:4px solid #f59e0b;border-radius:10px;font-size:12px;color:#78350f;font-weight:500;line-height:1.5;"></div>
                <div id="dispo-modal-calendar"><input type="text" id="dispo-modal-input" style="position:absolute;visibility:hidden;height:0;padding:0;border:none;"></div>
                <div id="dispo-modal-leyenda" style="display:none;justify-content:center;margin-top:10px;gap:12px;font-size:11px;color:#888;">
                    <span>🟢 Disponible</span>
                    <span>🟡 Casi lleno</span>
                    <span>🔴 Completo</span>
                </div>
                <div id="dispo-modal-seleccion" style="display:none;margin-top:12px;padding:10px 14px;background:#e8f9ee;border-radius:10px;font-size:12.5px;color:#1a6b3a;font-weight:600;line-height:1.5;"></div>
                <button id="dispo-modal-listo" style="display:none;width:100%;margin-top:12px;background:var(--naranja-accent,#d86634);color:white;border:none;border-radius:12px;padding:12px;font-size:0.85rem;font-weight:800;cursor:pointer;letter-spacing:0.5px;">LISTO</button>
                <button id="dispo-modal-quitar" style="display:none;width:100%;margin-top:8px;background:none;border:none;color:#999;font-size:11.5px;font-weight:600;cursor:pointer;text-decoration:underline;">Quitar fecha elegida (la elijo en el checkout)</button>
            </div>
            <div id="dispo-modal-error" style="display:none;text-align:center;padding:20px 0;color:#b45309;font-size:0.85rem;"></div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => { modal.style.display = 'none'; };
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('#dispo-modal-close').addEventListener('click', close);
    modal.querySelector('#dispo-modal-listo').addEventListener('click', close);
    modal.querySelector('#dispo-modal-quitar').addEventListener('click', () => {
        if (_modalFp) _modalFp.clear(); // dispara onChange → limpia la fecha guardada
    });
    return modal;
}

function updateModalSeleccion(fmt) {
    const sel = document.getElementById('dispo-modal-seleccion');
    const listo = document.getElementById('dispo-modal-listo');
    const quitar = document.getElementById('dispo-modal-quitar');
    if (fmt) {
        sel.innerHTML = `✅ Elegiste <strong>${fmt}</strong>. La vas a confirmar al finalizar tu pedido.`;
        sel.style.display = 'block';
        listo.style.display = 'block';
        quitar.style.display = 'block';
    } else {
        sel.style.display = 'none';
        listo.style.display = 'none';
        quitar.style.display = 'none';
    }
}

// Abre el modal de disponibilidad para un listado de items ({id, qty}).
// items: carrito completo, o carrito + producto que se está viendo.
export async function openDisponibilidadModal({ items = [] } = {}) {
    const modal = ensureModalDom();
    modal.style.display = 'flex';

    const loader = document.getElementById('dispo-modal-loader');
    const body = document.getElementById('dispo-modal-body');
    const errorEl = document.getElementById('dispo-modal-error');
    loader.style.display = 'block';
    body.style.display = 'none';
    errorEl.style.display = 'none';

    try {
        const [, { agendaConfig, pedidosMaximosDia }] = await Promise.all([ensureFlatpickr(), getAgendaConfig()]);
        const meta = await computeAgendaMeta(items, agendaConfig);

        if (!meta.anyRequiresAgenda) {
            loader.style.display = 'none';
            errorEl.innerText = 'Este producto no necesita agendar fecha: está disponible sin reserva previa. 🎉';
            errorEl.style.display = 'block';
            return;
        }

        const minDate = new Date();
        minDate.setHours(0, 0, 0, 0);
        minDate.setDate(minDate.getDate() + meta.maxDias);

        const blockedDates = agendaConfig?.fechasBloqueadas || [];
        const workingDays = agendaConfig?.diasSemana || [0, 1, 2, 3, 4, 5, 6];

        let orderCountByDate = {};
        if (pedidosMaximosDia > 0) {
            try {
                ({ orderCountByDate } = await fetchOrderCounts());
            } catch (err) {
                console.error("Error fetching order counts for calendar:", err);
            }
        }

        // Unidades con agenda del pedido actual (afecta el coloreo de capacidad)
        const extraQty = items
            .filter(it => meta.agendaCartIds.has(it.id))
            .reduce((s, it) => s + (it.qty || 1), 0);

        loader.style.display = 'none';
        body.style.display = 'block';

        const msgEl = document.getElementById('dispo-modal-mensaje');
        msgEl.innerText = meta.mensajeAgenda || '';
        msgEl.style.display = meta.mensajeAgenda ? 'block' : 'none';

        const leyenda = document.getElementById('dispo-modal-leyenda');
        leyenda.style.display = pedidosMaximosDia > 0 ? 'flex' : 'none';

        const rules = { minDate, workingDays, blockedDates, pedidosMaximosDia, orderCountByDate, extraQty };
        const config = buildCalendarConfig(rules);
        config.inline = true;
        config.appendTo = document.getElementById('dispo-modal-calendar');
        config.onChange = (dates, dStr, fp) => {
            if (dates[0]) {
                saveFechaRetiro(isoFromDate(dates[0]), dStr);
                updateModalSeleccion(dStr);
            } else {
                clearFechaRetiro();
                updateModalSeleccion(null);
            }
        };

        // Preseleccionar la fecha ya guardada si sigue siendo válida
        const stored = getFechaRetiro();
        if (stored && isDateSelectable(stored.iso, rules)) {
            config.defaultDate = dateFromISO(stored.iso);
        } else if (stored) {
            clearFechaRetiro();
        }

        if (_modalFp) { try { _modalFp.destroy(); } catch(e) {} _modalFp = null; }
        _modalFp = flatpickr('#dispo-modal-input', config);
        updateModalSeleccion(_modalFp.selectedDates[0] ? _modalFp.input.value : null);

    } catch (err) {
        console.error("Error abriendo disponibilidad:", err);
        loader.style.display = 'none';
        errorEl.innerText = 'No pudimos cargar la disponibilidad. Probá de nuevo en un ratito.';
        errorEl.style.display = 'block';
    }
}
