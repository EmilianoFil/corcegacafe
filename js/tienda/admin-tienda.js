import { db, storage } from '../firebase-config.js';
import {
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDoc, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

let productosData = [];

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
    document.getElementById('prod-upload-status').innerText = 'No se eligió archivo';
    document.getElementById('prod-upload-status').style.color = 'var(--text-muted)';
    
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
        status.innerText = "Error al subir imagen ❌";
        status.style.color = "var(--error)";
    } finally {
        btn.disabled = false;
    }
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
    const categoria = document.getElementById('prod-categoria').value;
    const activo = document.getElementById('prod-activo').checked;
    const imagenUrl = document.getElementById('prod-imagen-url').value;

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
            precio,
            stock,
            categoria,
            activo,
            imagenUrl,
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
    document.getElementById('prod-categoria').value = prod.categoria || 'otros';
    document.getElementById('prod-activo').checked = prod.activo ?? true;
    
    document.getElementById('prod-imagen-url').value = prod.imagenUrl || '';
    
    if (prod.imagenUrl) {
        document.getElementById('prod-imagen-preview').src = prod.imagenUrl;
        document.getElementById('prod-preview-container').style.display = 'block';
        document.getElementById('prod-upload-status').innerText = 'Imagen cargada ✅';
        document.getElementById('prod-upload-status').style.color = 'var(--success)';
    } else {
        document.getElementById('prod-preview-container').style.display = 'none';
        document.getElementById('prod-upload-status').innerText = 'Sin imagen';
        document.getElementById('prod-upload-status').style.color = 'var(--text-muted)';
    }
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
    console.log("Loading ordenes...");
    // A implementar luego, una vez esté integrado Mercado Pago / Frontend
}
