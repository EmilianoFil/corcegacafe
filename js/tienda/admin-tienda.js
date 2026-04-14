import { db, storage } from '../firebase-config.js';
import {
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDoc, query, orderBy, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

let productosData = [];
let imagenesGaleria = []; // Para manejar las fotos extra en el formulario

// ============================================
// UI FORMS
// ============================================

export async function mostrarFormularioProducto() {
    document.getElementById('form-producto-container').style.display = 'block';
    document.getElementById('form-producto-title').innerText = 'Nuevo Producto';
    document.getElementById('form-producto').reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('prod-imagen-url').value = '';
    document.getElementById('prod-preview-container').style.display = 'none';
    document.getElementById('prod-imagen-preview').src = '';
    
    // Reset Galería
    imagenesGaleria = [];
    renderGalleryPreviews();

    // Asegurar que las categorías estén cargadas
    await fetchCategoriasParaForm();
    
    // Scroll hacia el formulario
    document.getElementById('form-producto-container').scrollIntoView({ behavior: 'smooth' });
}

async function fetchCategoriasParaForm() {
    try {
        const q = query(collection(db, "categorias"), orderBy("nombre", "asc"));
        const snap = await getDocs(q);
        const cats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const select = document.getElementById('prod-categoria');
        if (select) {
            select.innerHTML = cats.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
        }
    } catch (err) {
        console.error("Error fetching categories for form:", err);
    }
}

export function ocultarFormularioProducto() {
    document.getElementById('form-producto-container').style.display = 'none';
    document.getElementById('form-producto').reset();
}

export async function handleProductImageUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const btn = document.getElementById('btn-select-prod-img');
    const preview = document.getElementById('prod-imagen-preview');
    const previewContainer = document.getElementById('prod-preview-container');

    btn.disabled = true;
    btn.innerHTML = "Subiendo... ⏳";

    try {
        const fileName = `productos/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, fileName);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        document.getElementById('prod-imagen-url').value = url;
        preview.src = url;
        previewContainer.style.display = "block";
        btn.innerHTML = "📸 ¡Cambiar Foto!";

    } catch (err) {
        console.error(err);
        alert("Error al subir imagen");
        btn.innerHTML = "📸 Seleccionar Foto Principal";
    } finally {
        btn.disabled = false;
    }
}

export async function agregarAFotosGaleria(input) {
    const file = input.files[0];
    if (!file) return;

    const btn = document.getElementById('btn-add-gallery');
    const status = document.getElementById('gallery-status');

    btn.disabled = true;
    status.innerText = "Subiendo... ⏳";

    try {
        const fileName = `productos/galeria/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, fileName);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        imagenesGaleria.push(url);
        renderGalleryPreviews();
        status.innerText = "¡Agregada! ✅";

    } catch (err) {
        console.error(err);
        status.innerText = "Error ❌";
    } finally {
        btn.disabled = false;
        setTimeout(() => status.innerText = "", 2000);
    }
}

function renderGalleryPreviews() {
    const container = document.getElementById('gallery-previews');
    container.innerHTML = imagenesGaleria.map((url, index) => `
        <div style="position: relative;">
            <img src="${url}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px;">
            <button type="button" onclick="window.tiendaAdmin.eliminarDeGaleria(${index})" style="position: absolute; top: -5px; right: -5px; background: #e74c3c; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 10px;">×</button>
        </div>
    `).join('');
}

export function eliminarDeGaleria(index) {
    imagenesGaleria.splice(index, 1);
    renderGalleryPreviews();
}

// ============================================
// PRODUCT CRUD
// ============================================

export async function loadProductosTable() {
    try {
        const q = query(collection(db, "productos"), orderBy("nombre", "asc"));
        const snap = await getDocs(q);
        productosData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const tbody = document.querySelector('#tablaProductosDash tbody');
        tbody.innerHTML = productosData.map(p => `
            <tr>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5;">
                    <img src="${p.imagenUrl || 'https://placehold.co/50x50'}" style="width: 45px; height: 45px; border-radius: 10px; object-fit: cover; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5;">
                    <div style="font-weight:700; color:var(--secondary);">${p.nombre}</div>
                    <div style="font-size: 0.7rem; color: #999;">ID: ${p.id.substring(0,6)}</div>
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5; font-weight:800; color:var(--primary); font-size: 1rem;">
                    $${p.precio.toLocaleString('es-AR')}
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5; font-weight: 500;">
                    ${p.stock > 0 ? `<span style="color:#333;">${p.stock}</span>` : '<span style="color:#aaa; font-style:italic;">Ilimitado</span>'}
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5;">
                    <span style="background:rgba(13, 43, 55, 0.05); color:var(--secondary); padding:4px 10px; border-radius:8px; font-size:0.7rem; font-weight:700; text-transform:uppercase;">${p.categoria || 'Sin Cat'}</span>
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5;">
                    ${p.activo !== false ? '<span style="color:var(--success); font-weight:700;"><span style="font-size:1.2rem; vertical-align:middle;">•</span> Activo</span>' : '<span style="color:#aaa; font-weight:700;"><span style="font-size:1.2rem; vertical-align:middle;">•</span> Oculto</span>'}
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <button class="btn-secondary" onclick="window.tiendaAdmin.editarProducto('${p.id}')" style="padding:6px 12px; font-size:0.75rem; font-weight:600; margin:0; width:auto;">Editar</button>
                    <button class="btn-secondary" onclick="window.tiendaAdmin.eliminarProducto('${p.id}')" style="padding:6px 12px; font-size:0.75rem; font-weight:600; color:var(--error); border-color:#ffebeb; margin:0; width:auto;">Borrar</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error("Error loading products:", err);
    }
}

export async function guardarProducto(e) {
    if (e) e.preventDefault();
    
    const id = document.getElementById('prod-id').value;
    const btn = document.getElementById('btn-save-producto');
    
    const productData = {
        nombre: document.getElementById('prod-nombre').value,
        descripcion: document.getElementById('prod-descripcion').value,
        descripcion_larga: document.getElementById('prod-descripcion-larga').value,
        precio: parseFloat(document.getElementById('prod-precio').value),
        stock: parseInt(document.getElementById('prod-stock').value) || 0,
        categoria: document.getElementById('prod-categoria').value,
        activo: document.getElementById('prod-activo').checked,
        imagenUrl: document.getElementById('prod-imagen-url').value,
        imagenes: imagenesGaleria,
        actualizadoEn: serverTimestamp()
    };

    btn.disabled = true;
    btn.innerText = "Guardando... ⏳";

    try {
        if (id) {
            await updateDoc(doc(db, "productos", id), productData);
        } else {
            productData.creadoEn = serverTimestamp();
            await addDoc(collection(db, "productos"), productData);
        }
        ocultarFormularioProducto();
        loadProductosTable();
        alert("¡Producto guardado!");
    } catch (err) {
        console.error(err);
        alert("Error al guardar producto");
    } finally {
        btn.disabled = false;
        btn.innerText = "Guardar Producto";
    }
}

export async function editarProducto(id) {
    const p = productosData.find(item => item.id === id);
    if (!p) return;

    await fetchCategoriasParaForm(); // Asegurar categorías actuales

    document.getElementById('form-producto-container').style.display = 'block';
    document.getElementById('form-producto-title').innerText = 'Editar Producto';
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-nombre').value = p.nombre;
    document.getElementById('prod-descripcion').value = p.descripcion || '';
    document.getElementById('prod-descripcion-larga').value = p.descripcion_larga || '';
    document.getElementById('prod-precio').value = p.precio;
    document.getElementById('prod-stock').value = p.stock || 0;
    document.getElementById('prod-categoria').value = p.categoria || '';
    document.getElementById('prod-activo').checked = p.activo !== false;
    document.getElementById('prod-imagen-url').value = p.imagenUrl || '';
    
    if (p.imagenUrl) {
        document.getElementById('prod-imagen-preview').src = p.imagenUrl;
        document.getElementById('prod-preview-container').style.display = 'block';
    }

    imagenesGaleria = p.imagenes || [];
    renderGalleryPreviews();

    document.getElementById('form-producto-container').scrollIntoView({ behavior: 'smooth' });
}

export async function eliminarProducto(id) {
    if (!confirm("¿Seguro que querés borrar este producto?")) return;
    try {
        await deleteDoc(doc(db, "productos", id));
        loadProductosTable();
    } catch (err) {
        console.error(err);
    }
}

// ============================================
// CATEGORIES MANAGEMENT
// ============================================

export async function loadCategoriasTable() {
    try {
        const q = query(collection(db, "categorias"), orderBy("nombre", "asc"));
        const snap = await getDocs(q);
        const cats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const tbody = document.getElementById('lista-categorias-body');
        if (tbody) {
            tbody.innerHTML = cats.map(c => `
            <tr>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-weight:700; color:var(--secondary);">${c.nombre}</span>
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5; color:#999; font-size:0.8rem; font-family:monospace;">
                    ${c.id}
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <button class="btn-secondary" onclick="window.tiendaAdmin.eliminarCategoria('${c.id}', '${c.nombre}')" style="padding:5px 12px; font-size:0.75rem; color:var(--error); border-color:#ffebeb; background:#fff5f5; margin:0; width:auto;">
                        🗑️ Eliminar
                    </button>
                </td>
            </tr>
        `).join('');
        }
    } catch (err) {
        console.error("Error loading categories:", err);
    }
}

export async function guardarCategoria() {
    const input = document.getElementById('cat-nombre');
    const nombre = input.value.trim();

    if (!nombre) return alert("Por favor, ingresá un nombre para la categoría.");

    const slug = nombre.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    try {
        await setDoc(doc(db, "categorias", slug), {
            nombre: nombre,
            creadoEn: serverTimestamp()
        });

        input.value = "";
        loadCategoriasTable();
        alert("✅ Categoría guardada!");
    } catch (err) {
        console.error(err);
        alert("Error al guardar!");
    }
}

export async function eliminarCategoria(id, nombre) {
    if (!confirm(`¿Estás seguro de eliminar "${nombre}"?`)) return;

    try {
        await deleteDoc(doc(db, "categorias", id));
        loadCategoriasTable();
    } catch (err) {
        console.error(err);
    }
}

// ============================================
// ORDERS LOGIC (Existing)
// ============================================

export async function loadOrdenesTable() {
    try {
        const q = query(collection(db, "ordenes"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        const ordenes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const tbody = document.querySelector('#tablaOrdenesDash tbody');
        if (!tbody) return;

        tbody.innerHTML = ordenes.map(o => {
            const date = o.timestamp?.toDate ? o.timestamp.toDate().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : (o.fecha?.toDate ? o.fecha.toDate().toLocaleString('es-AR') : '—');
            return `
                <tr>
                    <td style="padding: 15px; border-bottom: 1px solid #f5f5f5;">
                        <span style="font-weight:800; color:var(--panel-oscuro); font-family:monospace; font-size:13px;">#${o.id.substring(0,8).toUpperCase()}</span>
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid #f5f5f5; font-size:12px; color:#666;">
                        ${date}
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid #f5f5f5; font-weight:600; font-size:14px;">
                        ${o.cliente.nombre}
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid #f5f5f5; font-weight:800; color:var(--naranja-accent); font-size:14px;">
                        $${o.total.toLocaleString('es-AR')}
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid #f5f5f5;">
                        <select onchange="window.tiendaAdmin.cambiarEstadoOrden('${o.id}', this.value)" class="status-select status-${o.estado}" style="padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; border: none; cursor:pointer;">
                            <option value="pendiente_pago" ${o.estado === 'pendiente_pago' ? 'selected' : ''}>PENDIENTE PAGO</option>
                            <option value="pagado" ${o.estado === 'pagado' ? 'selected' : ''}>PAGADO</option>
                            <option value="en_preparacion" ${o.estado === 'en_preparacion' ? 'selected' : ''}>EN PREPARACIÓN</option>
                            <option value="listo" ${o.estado === 'listo' ? 'selected' : ''}>LISTO / PARA RETIRAR</option>
                            <option value="en_camino" ${o.estado === 'en_camino' ? 'selected' : ''}>EN CAMINO</option>
                            <option value="entregado" ${o.estado === 'entregado' ? 'selected' : ''}>ENTREGADO</option>
                            <option value="cancelado" ${o.estado === 'cancelado' ? 'selected' : ''}>CANCELADO</option>
                        </select>
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid #f5f5f5; text-align: right;">
                        <button class="btn-secondary" onclick="window.tiendaAdmin.verDetalleOrden('${o.id}')" style="padding:6px 15px; font-size:11px; font-weight:700; border-radius:8px; border:1px solid #ddd; background:white; cursor:pointer;">🔍 DETALLES</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error("Error loading orders:", err);
    }
}

export async function verDetalleOrden(id) {
    try {
        const docSnap = await getDoc(doc(db, "ordenes", id));
        if (!docSnap.exists()) return;
        const orden = docSnap.data();

        const modalHtml = `
            <div id="modal-detalle-orden" class="modal-overlay" style="display:flex; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9000; padding:20px;">
                <div class="card" style="width:100%; max-width:550px; position:relative; max-height:90vh; overflow-y:auto; padding:30px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3 style="margin:0; font-size:1.4rem;">Orden #${id.substring(0,6)}</h3>
                        <span class="badge-status status-${orden.estado}">${orden.estado.toUpperCase()}</span>
                    </div>

                    <div style="background:#fdfcf7; padding:20px; border-radius:16px; margin-bottom:20px; border:1px solid #eee;">
                        <p style="margin:0 0 10px; font-weight:700;">Cliente:</p>
                        <p style="margin:0; font-size:0.9rem;">
                            <b>${orden.cliente.nombre}</b><br>
                            ${orden.cliente.email}<br>
                            WhatsApp: ${orden.cliente.whatsapp}<br>
                            ${orden.cliente.direccion ? `Entrega: ${orden.cliente.direccion}` : ''}
                        </p>
                    </div>

                    <div style="background:var(--panel-oscuro); color:white; padding:15px 20px; border-radius:16px; margin-bottom:20px;">
                        <p style="margin:0; font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:1px; opacity:0.7;">PARA CUÁNDO LO QUIERE:</p>
                        <p style="margin:5px 0 0; font-size:1.1rem; font-weight:800; font-family:var(--font-accent); color:var(--naranja-accent);">${orden.horario || 'Lo antes posible'}</p>
                    </div>

                    <div style="margin-bottom:20px;">
                        <p style="font-weight:700; margin-bottom:10px;">Productos:</p>
                        ${orden.items.map(i => `
                            <div style="display:flex; justify-content:space-between; font-size:0.9rem; padding:8px 0; border-bottom:1px solid #f9f9f9;">
                                <span>${i.qty}x ${i.nombre}</span>
                                <span style="font-weight:700;">$${(i.precio * i.qty).toLocaleString('es-AR')}</span>
                            </div>
                        `).join('')}
                        <div style="display:flex; justify-content:space-between; margin-top:15px; font-size:1.1rem; font-weight:800; color:var(--primary);">
                            <span>TOTAL</span>
                            <span>$${orden.total.toLocaleString('es-AR')}</span>
                        </div>
                    </div>

                    <button onclick="window.tiendaAdmin.notificarWhatsApp('${id}')" class="btn-primary" style="width:100%; background:#25d366; margin-bottom:15px; border:none; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fab fa-whatsapp"></i> Notificar Cliente por WhatsApp
                    </button>

                    <button onclick="document.getElementById('modal-detalle-orden').remove()" class="btn-primary" style="width:100%;">Cerrar</button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        console.error(error);
    }
}

export async function notificarWhatsApp(id) {
    try {
        const docSnap = await getDoc(doc(db, "ordenes", id));
        if (!docSnap.exists()) return;
        const orden = docSnap.data();

        const statusTexts = {
            'pagado': '¡Recibimos tu pago correctamente! Ya estamos procesando tu pedido.',
            'en_preparacion': '¡Tu pedido ya está en preparación! ☕🔥',
            'listo': '¡Tu pedido ya está listo para retirar! Te esperamos en Córcega. 🏝️',
            'en_camino': '¡Tu pedido ya va en camino a tu domicilio! 🛵💨',
            'entregado': '¡Gracias por tu compra! Que disfrutes tu pedido. 😉'
        };

        const msg = statusTexts[orden.estado] || '¡Hola! Te escribimos por tu pedido en Córcega Café.';
        const text = encodeURIComponent(`Hola ${orden.cliente.nombre}! ${msg}\n\nPedido: #${id.substring(0,6)}`);
        const url = `https://wa.me/549${orden.cliente.whatsapp}?text=${text}`;
        window.open(url, '_blank');
    } catch (error) {
        console.error(error);
    }
export async function cambiarEstadoOrden(id, nuevoEstado) {
    try {
        await updateDoc(doc(db, "ordenes", id), {
            estado: nuevoEstado,
            actualizadoEn: serverTimestamp()
        });
        
        // Notificar por consola o feedback visual si se quiere
        console.log(`Orden ${id} cambiada a ${nuevoEstado}`);
        
        // Refrescar tabla para actualizar colores de los selects (opcional, pero ayuda)
        loadOrdenesTable();
    } catch (err) {
        console.error("Error al cambiar estado:", err);
        alert("No se pudo cambiar el estado de la orden.");
    }
}

// ============================================
// CONFIGURACION TIENDA
// ============================================

export async function loadConfigStore() {
    try {
        const snap = await getDoc(doc(db, "configuracion", "tienda"));
        if (snap.exists()) {
            const data = snap.data();
            
            // Delivery
            if (document.getElementById('conf-delivery-enabled'))
                document.getElementById('conf-delivery-enabled').checked = data.delivery?.habilitado || false;
            if (document.getElementById('conf-delivery-cost'))
                document.getElementById('conf-delivery-cost').value = data.delivery?.costo || 0;
            if (document.getElementById('conf-delivery-min'))
                document.getElementById('conf-delivery-min').value = data.delivery?.minimo || 0;
            
            // Pagos
            if (document.getElementById('conf-pay-mp'))
                document.getElementById('conf-pay-mp').checked = data.pagos?.mercadopago || false;
            if (document.getElementById('conf-pay-transfer'))
                document.getElementById('conf-pay-transfer').checked = data.pagos?.transferencia?.habilitado || false;
            if (document.getElementById('conf-pay-transfer-info'))
                document.getElementById('conf-pay-transfer-info').value = data.pagos?.transferencia?.info || "";
            if (document.getElementById('conf-pay-cash'))
                document.getElementById('conf-pay-cash').checked = data.pagos?.efectivo?.habilitado || false;
            if (document.getElementById('conf-pay-cash-info'))
                document.getElementById('conf-pay-cash-info').value = data.pagos?.efectivo?.info || "";
            
            // Contacto
            if (document.getElementById('conf-contact-wa'))
                document.getElementById('conf-contact-wa').value = data.contacto?.whatsapp || "";
            if (document.getElementById('conf-contact-ig'))
                document.getElementById('conf-contact-ig').value = data.contacto?.instagram || "";

            // Agenda
            if (document.getElementById('conf-agenda-min'))
                document.getElementById('conf-agenda-min').value = data.agenda?.minAnticipacion || 0;
            if (document.getElementById('conf-agenda-blocked'))
                document.getElementById('conf-agenda-blocked').value = (data.agenda?.fechasBloqueadas || []).join(", ");
            
            for (let i = 0; i <= 6; i++) {
                const el = document.getElementById(`conf-day-${i}`);
                if (el) el.checked = data.agenda?.diasSemana?.includes(i) ?? true;
            }
        }
    } catch (err) {
        console.error("Error loading config:", err);
    }
}

export async function guardarConfigStore() {
    const btn = event.currentTarget;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando... ⏳";

    const diasSemana = [];
    for (let i = 0; i <= 6; i++) {
        if (document.getElementById(`conf-day-${i}`)?.checked) diasSemana.push(i);
    }

    const configData = {
        delivery: {
            habilitado: document.getElementById('conf-delivery-enabled').checked,
            costo: parseFloat(document.getElementById('conf-delivery-cost').value) || 0,
            minimo: parseFloat(document.getElementById('conf-delivery-min').value) || 0
        },
        pagos: {
            mercadopago: document.getElementById('conf-pay-mp').checked,
            transferencia: {
                habilitado: document.getElementById('conf-pay-transfer').checked,
                info: document.getElementById('conf-pay-transfer-info').value.trim()
            },
            efectivo: {
                habilitado: document.getElementById('conf-pay-cash').checked,
                info: document.getElementById('conf-pay-cash-info').value.trim()
            }
        },
        contacto: {
            whatsapp: document.getElementById('conf-contact-wa').value.trim(),
            instagram: document.getElementById('conf-contact-ig').value.trim()
        },
        agenda: {
            minAnticipacion: parseInt(document.getElementById('conf-agenda-min').value) || 0,
            fechasBloqueadas: document.getElementById('conf-agenda-blocked').value.split(',').map(s => s.trim()).filter(s => s !== ""),
            diasSemana: diasSemana
        },
        actualizadoEn: serverTimestamp()
    };

    try {
        await setDoc(doc(db, "configuracion", "tienda"), configData);
        alert("¡Configuración guardada correctamente! ✅");
    } catch (err) {
        console.error("Error saving config:", err);
        alert("Error al guardar la configuración.");
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
