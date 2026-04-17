# Contexto de Sesión — Córcega Café Tienda
> Generado al final de la sesión para continuar sin romper nada.

## Stack
- **Frontend**: HTML + CSS + vanilla JS (ES Modules)
- **Backend**: Firebase Firestore + Firebase Auth
- **Hosting**: GitHub → corcegacafe.com.ar
- **Pagos**: Mercado Pago (Cloud Function `crearPreferenciaMp`)
- **Analytics**: GA4 (`G-NXMC00DZ81`) + Microsoft Clarity (`wd8ekvw8tt`)

---

## Estructura de archivos clave

```
corcegacafe/
├── tienda.html               # Grilla de productos
├── producto.html             # Detalle de producto
├── checkout.html             # Checkout (Flatpickr, agenda)
├── success.html              # Confirmación de pedido
├── admin-new.html            # Panel admin (admin-tienda.js?v=14)
├── css/tienda/tienda.css     # Todos los estilos tienda
└── js/tienda/
    ├── tienda.js             # ?v=1.9  — grilla, carrito, picker variantes
    ├── producto-detalle.js   # ?v=1.5  — página de producto
    ├── checkout-v8.js        # ?v=2.1  — checkout, agenda, MP
    ├── admin-tienda.js       # ?v=14   — panel admin
    ├── header-component.js   # ?v=1.0  — header compartido
    ├── footer-component.js   # ?v=1.2  — footer compartido (nuevo)
    ├── cart-reservas.js      # (sin versión) — sistema de reservas Firestore
    └── firebase-config.js    # Config Firebase
```

---

## Firestore — Colecciones relevantes

| Colección | Acceso | Notas |
|-----------|--------|-------|
| `productos` | read: public, write: auth | `tieneVariantes`, `variantes{}`, `requiereAgenda`, `stockIlimitado` |
| `categorias` | read: public, write: auth | |
| `configuracion/tienda` | read: public, write: auth | Delivery, pagos, agenda, info, redes |
| `ordenes` | create: public, read/write: auth | `fechaISO`, `horario`, `estado` |
| `reservas` | read/write: public | Sistema de reserva de stock 10 min |
| `usuarios_tienda` | read: public, create: public, update/delete: auth | |

### Estructura `configuracion/tienda`:
```javascript
{
  delivery: { habilitado: bool, costo: number, minimo: number },
  pagos: {
    mercadopago: bool,
    transferencia: { habilitado: bool, info: string },
    efectivo: { habilitado: bool, info: string }
  },
  agenda: {
    minAnticipacion: number,
    diasSemana: [0-6],
    fechasBloqueadas: ["YYYY-MM-DD"],
    pedidosMaximosDia: number
  },
  info: { direccion: string, googleMapsUrl: string, whatsapp: string },
  redes: {
    instagram: { activo: bool, url: string },
    facebook: { activo: bool, url: string },
    tiktok: { activo: bool, url: string },
    twitter: { activo: bool, url: string }
  }
}
```

### Estructura `productos/{id}`:
```javascript
{
  nombre, descripcion, descripcion_larga, precio, categoria,
  activo: bool,
  stock: number,
  stockIlimitado: bool,
  avisoStock: number,           // umbral para mensaje "¡Solo quedan X!"
  imagenUrl: string,
  imagenes: [string],           // galería
  tieneVariantes: bool,
  atributosVariantes: [{ nombre, opciones: [string] }],
  variantes: {
    "Bordó|L": { stock: number, stockIlimitado: bool, precio: number|null, imagenUrl: string|null }
  },
  requiereAgenda: bool,
  diasAnticipacion: number,
  horarioCorte: "HH:MM",
  mensajeAgenda: string
}
```

### Estructura `reservas/{sessionId_productId_variantKey}`:
```javascript
{
  sessionId: string,    // UUID en localStorage 'corcega_session_id'
  productId: string,
  variantKey: string|null,
  qty: number,
  nombre: string,
  expiresAt: Timestamp  // now + 10 minutos
}
```

---

## Lo que se implementó en esta sesión

### 1. GA4 + Microsoft Clarity
- Snippets en los 4 HTML de tienda
- Clarity ID: `wd8ekvw8tt`
- GA4 ID: `G-NXMC00DZ81`
- Eventos: `view_item_list` (tienda), `view_item` (producto), `add_to_cart` (tienda+producto), `begin_checkout` (checkout), `purchase` (success)
- `purchase` event lee el carrito ANTES de hacer `localStorage.removeItem`

### 2. Stock ilimitado en variantes
- Checkbox `∞` en cada fila de la tabla de combinaciones (admin)
- Guarda `stockIlimitado: bool` por variante en Firestore
- tienda.js y producto-detalle.js respetan `v.stockIlimitado` en todos los checks
- `collectVariantesData()` incluye `stockIlimitado` al guardar

### 3. Sistema de reservas Firestore (`cart-reservas.js`)
- `getSessionId()` — UUID por browser en localStorage
- `writeReserva(productId, variantKey, qty, nombre)` — crea/actualiza reserva con `expiresAt = now + 10min`
- `deleteReserva()` / `deleteAllSessionReservas()`
- `fetchReservedByOthers()` — retorna mapa `{productId_variantKey: qty}` de reservas activas de OTRAS sesiones
- tienda.js: descuenta reservas ajenas del stock visible en la grilla
- Carrito muestra countdown `⏱ M:SS` por item con stock limitado
- Al expirar: item eliminado del carrito + toast rojo + deleteReserva
- checkout-v8.js: `deleteAllSessionReservas()` al confirmar el pedido

### 4. Mensajes contextuales de stock
- En tu sesión con X en carrito y Y disponible:
  - Si `inCart > 0 && stock > 0` → "🛒 Tenés **X** en el carrito · quedan **Y** más"
  - Si `inCart > 0 && stock === 0` → "🛒 Ya tenés **X** reservados en tu carrito"
- Implementado en tienda.js (picker) y producto-detalle.js (`showStockInfo` con param `inCart`)
- Qty picker (`changeQty`, `vpmAdjustQty`) también capea en `stock - inCart`

### 5. Fix agenda checkout
- Cambiado `Promise.all` → `Promise.allSettled` para que un producto faltante no cancele toda la verificación de agenda

### 6. Footer component
- **Archivo**: `js/tienda/footer-component.js`
- Lee `configuracion/tienda` de Firestore
- Muestra: brand (CóRCEGA / REBELDÍA CAFETERA), dirección + link Google Maps, iconos de redes activas
- Bottom strip: `© año Córcega Café · Hecho con ♥ por LENUAhub`
- Link LENUAhub → `https://wa.me/5491136053892`
- Fallback minimal si falla Firestore
- Agregado a los 4 HTML de tienda (`?v=1.2`)
- Admin panel: sección "🌐 Info & Redes Sociales" con campos `conf-direccion`, `conf-maps-url`, `conf-whatsapp`, toggles + URL para instagram/facebook/tiktok/twitter
- `loadConfigStore` y `guardarConfigStore` en admin-tienda.js ya guardan/cargan estos campos

---

## Firestore Rules actuales (completas)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /clientes/{docId} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if request.auth != null;
    }
    match /logs/{logId} {
      allow read: if false;
      allow write: if true;
    }
    match /productos/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
      match /movimientos_stock/{movId} {
        allow read, write: if request.auth != null;
      }
    }
    match /ordenes/{docId} {
      allow create: if true;
      allow read, write: if request.auth != null;
    }
    match /categorias/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /configuracion/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /reservas/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## Cosas pendientes / próximas sesiones

1. **Admin — tabla de variantes**: falta poder ordenar las columnas, y mejorar UX del ∞ checkbox visualmente cuando está activado (el input se ve grisáceo pero podría mostrar "∞" como texto)
2. **Cleanup de reservas expiradas**: actualmente las reservas viejas quedan en Firestore hasta que el mismo cliente las expire. Considerar una Cloud Function que limpie `reservas` con `expiresAt < now` periódicamente.
3. **Test con Mercado Pago en producción**: cambiar Access Token de test a producción en la Cloud Function `crearPreferenciaMp` cuando sea momento de salir.
4. **Footer — dirección en admin**: recordar cargar desde admin la dirección y el link de Maps: `https://maps.app.goo.gl/NRASkkE1AAD4FY3c7`

---

## Comandos útiles

```bash
# Ver últimos commits
cd /Users/emi/CorcegaProject/corcegacafe && git log --oneline -10

# Push rápido
git add -A && git commit -m "mensaje" && git push origin main
```

## Notas para no romper nada

- **Versiones de scripts**: si modificás un JS, bumpeá el `?v=X` en el HTML correspondiente para forzar cache bust
- **cart-reservas.js** es importado por tienda.js, producto-detalle.js y checkout-v8.js — cualquier cambio ahí afecta los tres
- **admin-tienda.js** usa `export function` y se importa en admin-new.html como `window.tiendaAdmin` — las funciones nuevas deben exportarse Y agregarse al objeto `window.tiendaAdmin` al final del archivo
- El carrito se guarda en `localStorage` como `corcega_cart` — estructura: `[{ id, nombre, precio, qty, stock, stockIlimitado, imagenUrl, variantKey?, variantLabel?, _cartKey?, reservadoEn? }]`
- `corcega_session_id` en localStorage = UUID para el sistema de reservas
