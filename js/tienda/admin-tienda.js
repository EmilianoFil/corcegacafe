import { db, storage } from '../firebase-config.js';
import {
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDoc, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

let productosData = [];
let imagenesGaleria = []; // Para manejar las fotos extra en el formulario

// ============================================
// UI FORMS
// ============================================

export function mostrarFormularioProducto() {
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
    
    // Scroll hacia el formulario
    document.getElementById('form-producto-container').scrollIntoView({ behavior: 'smooth' });
}

export function ocultarFormularioProducto() {
    document.getElementById('form-producto-container').style.display = 'none';
    document.getElementById('form-producto').reset();
}

export async function handleProductImageUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const btn = document.getElementById('btn-select-prod-img');
    const status = document.getElementById('prod-upload-status');
    const preview = document.getElementById('prod-imagen-preview');
    const previewContainer = document.getElementById('prod-preview-container');

    btn.disabled = true;
    status.innerText = "Subiendo imagen... ⏳";
    status.style.color = "var(--primary)";

    try {
        const fileName = `productos/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, fileName);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        document.getElementById('prod-imagen-url').value = url;

        status.innerText = "¡Imagen lista! ✅";
        status.style.color = "var(--success)";
        preview.src = url;
        previewContainer.style.display = "block";

    } catch (err) {
        console.error(err);
        alert("Error al subir imagen");
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
    if (!container) return;

    container.innerHTML = imagenesGaleria.map((url, index) => `
        <div style="position: relative;">
            <img src="${url}" style="width: 70px; height: 70px; object-fit: cover; border-radius: 8px;">
            <button type="button" onclick="window.tiendaAdmin.eliminarFotoGaleria(${index})" style="position: absolute; top: -5px; right: -5px; background: red; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 10px;">×</button>
        </div>
    `).join('');
}

export function eliminarFotoGaleria(index) {
    imagenesGaleria.splice(index, 1);
    renderGalleryPreviews();
}

// ============================================
// PRODUCTOS CRUD
// ============================================

export async function guardarProducto(event) {
    event.preventDefault();
    
    const id = document.getElementById('prod-id').value;
    const nombre = document.getElementById('prod-nombre').value.trim();
    const descripcion = document.getElementById('prod-descripcion').value.trim();
    const precio = parseFloat(document.getElementById('prod-precio').value);
    const stock = parseInt(document.getElementById('prod-stock').value) || 0;
    const controlarStock = document.getElementById('prod-controlar-stock').checked;
    const categoria = document.getElementById('prod-categoria').value;
    const activo = document.getElementById('prod-activo').checked;
    const imagenUrl = document.getElementById('prod-imagen-url').value;
    const descripcion_larga = document.getElementById('prod-descripcion-larga').value.trim();

    if (!nombre || !precio) {
        alert("Completa el nombre y el precio del producto.");
        return;
    }

    const btn = document.getElementById('btn-save-producto');
    btn.disabled = true;
    btn.innerText = "Guardando... ⏳";

    try {
        const productoData = {
            nombre,
            descripcion,
            descripcion_larga,
            precio,
            stock,
            controlarStock,
            categoria,
            activo,
            imagenUrl,
            imagenes: imagenesGaleria 
        };

        if (id) {
            // Update
            const docRef = doc(db, "productos", id);
            await updateDoc(docRef, {
                ...productoData,
                actualizadoEn: serverTimestamp()
            });
            alert("✅ ¡Producto actualizado con éxito!");
        } else {
            // Create
            await addDoc(collection(db, "productos"), {
                ...productoData,
                creadoEn: serverTimestamp()
            });
            alert("✅ ¡Producto creado con éxito!");
        }

        ocultarFormularioProducto();
        await loadProductosTable(); // Recargar la tabla
    } catch (error) {
        console.error("Error guardando producto:", error);
        alert("❌ Error al guardar el producto.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Guardar Producto";
    }
}

export function editarProducto(id) {
    const prod = productosData.find(p => p.id === id);
    if (!prod) return;

    mostrarFormularioProducto();
    document.getElementById('form-producto-title').innerText = 'Editar Producto';
    
    document.getElementById('prod-id').value = prod.id;
    document.getElementById('prod-nombre').value = prod.nombre || '';
    document.getElementById('prod-descripcion').value = prod.descripcion || '';
    document.getElementById('prod-precio').value = prod.precio || 0;
    document.getElementById('prod-stock').value = prod.stock || 0;
    document.getElementById('prod-controlar-stock').checked = prod.controlarStock || false;
    document.getElementById('prod-categoria').value = prod.categoria || 'otros';
    document.getElementById('prod-activo').checked = prod.activo ?? true;
    document.getElementById('prod-descripcion-larga').value = prod.descripcion_larga || '';
    
    document.getElementById('prod-imagen-url').value = prod.imagenUrl || '';
    if (prod.imagenUrl) {
        document.getElementById('prod-imagen-preview').src = prod.imagenUrl;
        document.getElementById('prod-preview-container').style.display = 'block';
    }

    // Cargar Galería
    imagenesGaleria = prod.imagenes || [];
    renderGalleryPreviews();
}

export async function eliminarProducto(id, nombre) {
    if (!confirm(`¿Estás seguro de que deseas eliminar el producto "${nombre}"?\nEsta acción no se puede deshacer.`)) {
        return;
    }

    try {
        await deleteDoc(doc(db, "productos", id));
        alert("✅ Producto eliminado exitosamente.");
        await loadProductosTable();
    } catch (error) {
        console.error("Error al eliminar:", error);
        alert("❌ Ocurrió un error al intentar eliminar el producto.");
    }
}

export async function loadProductosTable() {
    try {
        const q = query(collection(db, "productos"), orderBy("creadoEn", "desc"));
        const snap = await getDocs(q);
        
        productosData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if ($.fn.DataTable.isDataTable('#tablaProductosDash')) {
            $('#tablaProductosDash').DataTable().destroy();
        }

        $('#tablaProductosDash').DataTable({
            data: productosData,
            columns: [
                { 
                    data: 'imagenUrl',
                    render: function (data) {
                        return data ? `<img src="${data}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 8px;">` : '🛒';
                    }
                },
                { data: 'nombre' },
                { 
                    data: 'precio',
                    render: function(data) {
                        return `$${data.toLocaleString('es-AR')}`;
                    }
                },
                { 
                    data: 'stock',
                    render: function(data) {
                        return data > 0 ? `<span style="font-weight:bold;">${data}</span>` : '<span style="color:var(--text-muted); font-style:italic;">Ilimitado/Agotado</span>';
                    }
                },
                { 
                    data: 'categoria',
                    render: function(data) {
                        const cats = {
                            'cafe': 'Cafetería',
                            'pasteleria': 'Pastelería',
                            'merchandising': 'Merchandising',
                            'otros': 'Otros'
                        };
                        return `<span style="background: var(--bg-color); padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; border: 1px solid var(--border);">${cats[data] || data}</span>`;
                    }
                },
                { 
                    data: 'activo',
                    render: function(data) {
                        return data ? '<span style="color:var(--success); font-weight:bold;">● Activo</span>' : '<span style="color:var(--error); font-weight:bold;">○ Pausado</span>';
                    }
                },
                {
                    data: null,
                    render: function (data) {
                        return `
                            <button onclick="window.tiendaAdmin.editarProducto('${data.id}')" style="background:var(--bg-color); border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer;" title="Editar">✏️</button>
                            <button onclick="window.tiendaAdmin.eliminarProducto('${data.id}', '${data.nombre.replace(/'/g, "\\'")}')" style="background:#fff1f0; border:1px solid #ffccc7; border-radius:6px; padding:6px 10px; cursor:pointer;" title="Eliminar">🗑️</button>
                        `;
                    }
                }
            ],
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/es-ES.json'
            }
        });

    } catch (error) {
        console.error("Error loading products:", error);
    }
}

// ============================================
// ORDENES
// ============================================

export async function loadOrdenesTable() {
    console.log("Cargando órdenes desde Firestore... v2 🚀");
    try {
        const q = query(collection(db, "ordenes"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        const ordenesData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if ($.fn.DataTable.isDataTable('#tablaOrdenesDash')) {
            $('#tablaOrdenesDash').DataTable().destroy();
        }

        $('#tablaOrdenesDash').DataTable({
            data: ordenesData,
            order: [[1, 'desc']],
            columns: [
                { 
                    data: null,
                    render: function(data) {
                        const num = data.orderNumber ? `#${data.orderNumber}` : `#${data.id.substring(0,6)}...`;
                        return `<span style="font-family: monospace; font-size: 0.8rem; font-weight:bold; color:#d86634;">${num}</span>`;
                    }
                },
                { 
                    data: 'timestamp',
                    render: function(data, type) {
                        if (!data) return '-';
                        const date = data.toDate();
                        if (type === 'sort') return date.getTime();
                        return date.toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
                    }
                },
                { 
                    data: 'cliente',
                    render: function(data) {
                        return `<strong>${data.nombre}</strong><br><span style="font-size:0.8rem; color:var(--texto-muted)">${data.whatsapp}</span>`;
                    }
                },
                { 
                    data: 'total',
                    render: function(data) {
                        return `<strong>$${data.toLocaleString('es-AR')}</strong>`;
                    }
                },
                { 
                    data: 'estado',
                    render: function(data) {
                        const statusMap = {
                            'pendiente_pago': { label: '💳 Pendiente Pago', color: '#faad14', bg: '#fffbe6' },
                            'pagado': { label: '💰 Pagado', color: '#52c41a', bg: '#f6ffed' },
                            'en_preparacion': { label: '☕ En Preparación', color: '#13c2c2', bg: '#e6fffb' },
                            'listo': { label: '📦 Listo para Retirar', color: '#722ed1', bg: '#f9f0ff' },
                            'en_camino': { label: '🛵 En Camino', color: '#1890ff', bg: '#e6f7ff' },
                            'entregado': { label: '✅ Entregado', color: '#52c41a', bg: '#f6ffed' },
                            'cancelado': { label: '❌ Cancelado', color: '#ff4d4f', bg: '#fff1f0' }
                        };
                        const s = statusMap[data] || { label: data, color: '#000', bg: '#eee' };
                        return `<span style="background:${s.bg}; border:1px solid ${s.color}; color:${s.color}; padding:4px 10px; border-radius:12px; font-size:0.75rem; font-weight:bold; white-space:nowrap;">${s.label}</span>`;
                    }
                },
                {
                    data: null,
                    render: function (data) {
                        return `
                            <div style="display:flex; gap:5px;">
                                <button onclick="window.tiendaAdmin.verDetalleOrden('${data.id}')" style="background:var(--bg-color); border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer;" title="Ver Detalle">👁️</button>
                                
                                <select onchange="window.tiendaAdmin.cambiarEstadoOrden('${data.id}', this.value)" style="padding:4px; border-radius:6px; font-size:0.75rem; border:1px solid var(--border); background:white;">
                                    <option value="" disabled selected>Cambiar Estado...</option>
                                    <option value="pagado">💰 Pagado</option>
                                    <option value="en_preparacion">☕ En Preparación</option>
                                    <option value="listo">📦 Listo</option>
                                    <option value="en_camino">🛵 En Camino</option>
                                    <option value="entregado">✅ Entregado</option>
                                    <option value="cancelado">❌ Cancelado</option>
                                </select>

                                <button onclick="window.tiendaAdmin.notificarWhatsApp('${data.id}')" style="background:#e7f7ed; border:1px solid #25d366; border-radius:6px; padding:6px 10px; cursor:pointer;" title="Notificar por WhatsApp">
                                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" style="width:16px; height:16px;">
                                </button>
                            </div>
                        `;
                    }
                }
            ],
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/es-ES.json'
            }
        });

    } catch (error) {
        console.error("Error loading orders:", error);
    }
}

export async function cambiarEstadoOrden(id, nuevoEstado) {
    if (!confirm(`¿Deseas marcar la orden como ${nuevoEstado}?`)) return;

    try {
        await updateDoc(doc(db, "ordenes", id), {
            estado: nuevoEstado,
            actualizadoEn: serverTimestamp()
        });
        alert("✅ Estado actualizado.");
        await loadOrdenesTable();
    } catch (error) {
        console.error(error);
        alert("❌ Error al actualizar estado.");
    }
}

export async function verDetalleOrden(id) {
    // Buscamos la orden localmente o en firestore
    try {
        const docSnap = await getDoc(doc(db, "ordenes", id));
        if (!docSnap.exists()) return;
        const orden = docSnap.data();

        let itemsHtml = orden.items.map(item => `
            <div style="display:flex; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px;">
                <span>${item.qty}x ${item.nombre}</span>
                <span>$${(item.precio * item.qty).toLocaleString('es-AR')}</span>
            </div>
        `).join('');

        const modalHtml = `
            <div id="modal-detalle-orden" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999;">
                <div style="background:white; padding:30px; border-radius:20px; width:90%; max-width:500px; max-height: 80vh; overflow-y: auto;">
                    <h3 style="margin-top:0">Detalle de Orden #${id.substring(0,8)}</h3>
                    <p><strong>Cliente:</strong> ${orden.cliente.nombre}</p>
                    <p><strong>WhatsApp:</strong> ${orden.cliente.whatsapp}</p>
                    <p><strong>Entrega:</strong> ${orden.metodoEntrega === 'pickup' ? 'Retiro en Local' : 'Envio a Domicilio'}</p>
                    <p><strong>Horario:</strong> ${orden.horario}</p>
                    <p><strong>Notas:</strong> ${orden.notas || '-'}</p>
                    <hr>
                    <div style="margin:20px 0;">
                        ${itemsHtml}
                    </div>
                    <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.2rem;">
                        <span>TOTAL</span>
                        <span>$${orden.total.toLocaleString('es-AR')}</span>
                    </div>

                    ${orden.historial && orden.historial.length > 0 ? `
                        <div style="margin-top:25px; padding:15px; background:#f9f9f9; border-radius:15px; border: 1px solid #eee;">
                            <h4 style="margin:0 0 12px 0; font-size:0.85rem; color:#666; text-transform:uppercase; letter-spacing:1px;">Línea de Tiempo del Pedido</h4>
                            <div style="display:flex; flex-direction:column; gap:10px;">
                                ${orden.historial.map(h => {
                                    const date = h.fecha.toDate();
                                    const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second:'2-digit' });
                                    const dateStr = date.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' });
                                    return `
                                        <div style="display:flex; gap:12px; align-items:flex-start;">
                                            <div style="min-width:75px; text-align:right;">
                                                <div style="font-size:0.8rem; font-weight:700; color:var(--naranja-oscuro);">${timeStr}</div>
                                                <div style="font-size:0.65rem; color:#999;">${dateStr}</div>
                                            </div>
                                            <div style="width:2px; height:22px; background:#d86634; opacity:0.3; margin-top:4px;"></div>
                                            <div style="font-size:0.85rem; font-weight:600; color:#333; text-transform:capitalize;">${h.estado.replace(/_/g, ' ')}</div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <button id="btn-copy-mp-${id}" onclick="window.tiendaAdmin.copiarLinkPago('${id}')" class="btn-secondary" style="width:100%; margin-top:20px; font-size: 0.8rem; border-color: #009ee3; color: #009ee3; display: flex; align-items:center; justify-content:center; gap:8px;">
                        <span>🔗</span> Copiar Link de Pago (MP)
                    </button>

                    <button onclick="document.getElementById('modal-detalle-orden').remove()" class="btn-primary" style="width:100%; margin-top:10px;">Cerrar</button>
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
}

export async function copiarLinkPago(orderId) {
    const btn = document.getElementById(`btn-copy-mp-${orderId}`);
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = "Generando... ⏳";

    try {
        const response = await fetch('https://crearpreferenciamp-ioo4dzpz2a-uc.a.run.app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId })
        });

        const data = await response.json();
        
        if (data.init_point) {
            await navigator.clipboard.writeText(data.init_point);
            btn.innerHTML = "✅ ¡LINK COPIADO!";
            btn.style.background = "#e6f7ff";
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.background = "white";
            }, 3000);
        } else {
            alert("No se pudo generar el link.");
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert("Error al conectar con el servidor.");
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
