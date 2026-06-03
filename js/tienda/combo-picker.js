/**
 * Combo Picker — módulo compartido para tienda.js y producto-detalle.js
 * Gestiona el modal de selección de variantes al armar un combo.
 *
 * Uso:
 *   initComboPicker({ getProducts, getReservedByOthers, cart, onAddToCart, openCart })
 *   window.openComboPicker(comboProduct)
 */

import { writeReserva } from './cart-reservas.js';

export function initComboPicker({ getProducts, getReservedByOthers, cart, onAddToCart, openCartFn }) {

    let _product = null;
    let _selections = {};
    let _qty = 1;

    // ── helpers ──────────────────────────────────────────────────────────────

    function compStockAvailable(cid) {
        const comp = getProducts().find(x => x.id === cid);
        if (!comp) return 0;
        const reserved = getReservedByOthers();
        if (comp.tieneVariantes && comp.variantes) {
            return Object.entries(comp.variantes).reduce((sum, [key, v]) => {
                if (v.stockIlimitado) return sum + 9999;
                const r = reserved[`${comp.id}_${key}`] || 0;
                return sum + Math.max(0, (v.stock || 0) - r);
            }, 0);
        }
        if (comp.stockIlimitado) return 9999;
        const r = reserved[`${comp.id}_base`] || 0;
        return Math.max(0, (comp.stock || 0) - r);
    }

    function variantKey(comp, sels) {
        return comp.atributosVariantes.map(a => sels[a.nombre]).join('|');
    }

    function availableForCurrentSelection() {
        return Math.min(..._product.componentIds.map(cid => {
            const comp = getProducts().find(x => x.id === cid);
            if (!comp) return 0;
            if (!comp.tieneVariantes) return compStockAvailable(cid);
            const key = variantKey(comp, _selections[cid] || {});
            const varData = comp.variantes?.[key];
            if (!varData) return 0;
            if (varData.stockIlimitado) return 9999;
            const reserved = getReservedByOthers();
            const r = reserved[`${comp.id}_${key}`] || 0;
            return Math.max(0, (varData.stock || 0) - r);
        }));
    }

    function buildCartKey(p, variantSelections) {
        const selStr = Object.keys(variantSelections).sort().map(k => `${k}:${variantSelections[k]}`).join('|');
        return `combo__${p.id}__${selStr}`;
    }

    function buildLabel(variantSelections) {
        return Object.entries(variantSelections).map(([cid, key]) => {
            const comp = getProducts().find(x => x.id === cid);
            return comp ? `${comp.nombre}: ${key.replace(/\|/g, '/')}` : null;
        }).filter(Boolean).join(' · ');
    }

    // ── expose stock checker globally (for cart-component.js) ────────────────
    window.getComboCartStock = function(item) {
        if (!item.esCombo || !item.componentIds?.length) return item.stock || 0;
        return Math.min(...item.componentIds.map(cid => {
            const comp = getProducts().find(x => x.id === cid);
            if (!comp) return 0;
            const reserved = getReservedByOthers();
            const variantKey = item.comboVariantSelections?.[cid];
            if (comp.tieneVariantes && variantKey) {
                const varData = comp.variantes?.[variantKey];
                if (!varData) return 0;
                if (varData.stockIlimitado) return 9999;
                const r = reserved[`${comp.id}_${variantKey}`] || 0;
                return Math.max(0, (varData.stock || 0) - r);
            }
            return compStockAvailable(cid);
        }));
    };

    // ── public: open picker ──────────────────────────────────────────────────
    window.openComboPicker = function(p) {
        _selections = {};
        _qty = 1;

        // Sin variantes → agregar directo
        const hasVariantComps = p.componentIds.some(cid => {
            const c = getProducts().find(x => x.id === cid);
            return c?.tieneVariantes && c.atributosVariantes?.length;
        });
        if (!hasVariantComps) {
            const minStock = Math.min(...p.componentIds.map(cid => compStockAvailable(cid)));
            const inCart = cart.find(item => item.id === p.id)?.qty || 0;
            if (inCart >= minStock) {
                alert('¡Lo sentimos! No hay suficiente stock para armar más combos.');
                return;
            }
            _product = p;
            _doAddToCart({});
            return;
        }

        // Ordenar: sin variantes primero
        _product = {
            ...p,
            componentIds: [...p.componentIds].sort((a, b) => {
                const av = getProducts().find(x => x.id === a)?.tieneVariantes ? 1 : 0;
                const bv = getProducts().find(x => x.id === b)?.tieneVariantes ? 1 : 0;
                return av - bv;
            })
        };

        const modal = document.getElementById('combo-picker-modal');
        document.getElementById('cpm-nombre').innerText = p.nombre;
        document.getElementById('cpm-qty').innerText = '1';

        const container = document.getElementById('cpm-componentes');
        container.innerHTML = _product.componentIds.map(cid => {
            const comp = getProducts().find(x => x.id === cid);
            if (!comp) return '';
            if (!comp.tieneVariantes || !comp.atributosVariantes?.length) {
                return `<div style="display:flex;align-items:center;gap:10px;padding:12px;background:#f9fafb;border-radius:12px;">
                    <img src="${comp.imagenUrl||''}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#eee;">
                    <div style="font-weight:600;font-size:0.9rem;color:#333;">${comp.nombre}</div>
                </div>`;
            }
            _selections[cid] = {};
            const reserved = getReservedByOthers();
            return `<div style="background:#fafafa;border-radius:14px;padding:16px;border:1px solid #eee;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <img src="${comp.imagenUrl||''}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#eee;">
                    <div style="font-weight:700;font-size:0.95rem;color:var(--panel-oscuro);">${comp.nombre}</div>
                </div>
                ${comp.atributosVariantes.map(attr => `
                    <div style="margin-bottom:10px;">
                        <div style="font-size:0.78rem;font-weight:700;color:#666;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">${attr.nombre}</div>
                        <div style="display:flex;flex-wrap:wrap;gap:6px;">
                            ${attr.opciones.map(op => {
                                const hasStock = Object.entries(comp.variantes||{}).some(([key,v]) => {
                                    const parts = key.split('|');
                                    const idx = comp.atributosVariantes.findIndex(a => a.nombre === attr.nombre);
                                    if (parts[idx] !== op) return false;
                                    if (v.stockIlimitado) return true;
                                    const r = reserved[`${comp.id}_${key}`] || 0;
                                    return (v.stock||0) - r > 0;
                                });
                                return `<button type="button"
                                    data-comp="${cid}" data-attr="${attr.nombre}" data-op="${op}"
                                    onclick="window.cpmSelectOption('${cid}','${attr.nombre}','${op}')"
                                    ${!hasStock ? 'disabled' : ''}
                                    style="padding:6px 14px;border-radius:20px;border:1.5px solid ${hasStock?'#ddd':'#f0f0f0'};background:white;font-size:0.82rem;font-weight:600;cursor:${hasStock?'pointer':'not-allowed'};color:${hasStock?'#333':'#ccc'};transition:all 0.15s;">
                                    ${op}
                                </button>`;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>`;
        }).join('');

        const btn = document.getElementById('cpm-add-btn');
        btn.disabled = true;
        btn.style.background = '#bbb';
        btn.innerHTML = '<i class="fas fa-hand-point-up"></i> Elegí las opciones';

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    window.cpmSelectOption = function(compId, attrNombre, opcion) {
        if (!_selections[compId]) _selections[compId] = {};
        _selections[compId][attrNombre] = opcion;

        document.querySelectorAll(`button[data-comp="${compId}"][data-attr="${attrNombre}"]`).forEach(btn => {
            const sel = btn.dataset.op === opcion;
            btn.style.background = sel ? 'var(--panel-oscuro)' : 'white';
            btn.style.color = sel ? 'white' : '#333';
            btn.style.borderColor = sel ? 'var(--panel-oscuro)' : '#ddd';
        });

        const allDone = _product.componentIds.every(cid => {
            const comp = getProducts().find(x => x.id === cid);
            if (!comp?.tieneVariantes) return true;
            return comp.atributosVariantes.every(a => _selections[cid]?.[a.nombre]);
        });

        if (allDone) {
            const btn = document.getElementById('cpm-add-btn');
            btn.disabled = false;
            btn.style.background = 'var(--panel-oscuro)';
            btn.innerHTML = 'AGREGAR AL CARRITO';
        }
    };

    window.cpmAdjustQty = function(delta) {
        const max = Math.max(1, availableForCurrentSelection());
        _qty = Math.min(max, Math.max(1, _qty + delta));
        document.getElementById('cpm-qty').innerText = _qty;
    };

    window.cpmConfirm = function() {
        const variantSelections = {};
        for (const cid of _product.componentIds) {
            const comp = getProducts().find(x => x.id === cid);
            if (!comp?.tieneVariantes) continue;
            const allSelected = comp.atributosVariantes.every(a => _selections[cid]?.[a.nombre]);
            if (!allSelected) { alert('Por favor elegí todas las opciones antes de continuar.'); return; }
            variantSelections[cid] = variantKey(comp, _selections[cid]);
        }
        if (availableForCurrentSelection() <= 0) { alert('¡Sin stock para esta combinación!'); return; }
        _doAddToCart(variantSelections);
    };

    function _doAddToCart(variantSelections) {
        const p = _product;
        const cartKey = buildCartKey(p, variantSelections);
        const comboVariantLabel = buildLabel(variantSelections);

        const existing = cart.find(item => item._cartKey === cartKey);
        const itemData = {
            _cartKey: cartKey,
            id: p.id,
            nombre: p.nombre,
            precio: p.precio,
            imagenUrl: p.imagenUrl,
            esCombo: true,
            componentIds: p.componentIds,
            comboVariantSelections: variantSelections,
            comboVariantLabel: comboVariantLabel || null,
            stockIlimitado: false,
            reservadoEn: Date.now()
        };
        const newQty = (existing?.qty || 0) + _qty;
        if (existing) {
            existing.qty = newQty;
        } else {
            cart.push({ ...itemData, qty: _qty });
        }

        // Registrar reservas por cada componente y actualizar mapa local
        const reserved = getReservedByOthers();
        for (const cid of p.componentIds) {
            const comp = getProducts().find(x => x.id === cid);
            if (!comp) continue;
            const vKey = variantSelections[cid] || null;
            const reservaKey = `${comp.id}_${vKey || 'base'}`;
            // Actualizar mapa local inmediatamente para que la UI refleje el nuevo stock
            reserved[reservaKey] = (reserved[reservaKey] || 0) + _qty;
            // Persistir en Firestore (async, no bloqueante)
            try { writeReserva(comp.id, vKey, newQty, comp.nombre + (vKey ? ` (${vKey})` : '')); } catch(e) {}
        }

        if (typeof gtag === 'function') {
            gtag('event', 'add_to_cart', { currency: 'ARS', value: p.precio * _qty,
                items: [{ item_id: p.id, item_name: p.nombre, price: p.precio, quantity: _qty }] });
        }
        onAddToCart();
        document.getElementById('combo-picker-modal').style.display = 'none';
        document.body.style.overflow = '';
        openCartFn();
    }
}
