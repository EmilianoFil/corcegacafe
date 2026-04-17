# Contexto de Sesión — Córcega Café Tienda
> Actualizado al final de la sesión. Leer ANTES de tocar cualquier cosa.

## Stack
- **Frontend**: HTML + CSS + vanilla JS (ES Modules)
- **Backend**: Firebase Firestore + Firebase Auth
- **Hosting**: GitHub → corcegacafe.com.ar
- **Pagos**: Mercado Pago (Cloud Function `crearPreferenciaMp`)
- **Analytics**: GA4 (`G-NXMC00DZ81`) + Microsoft Clarity (`wd8ekvw8tt`)

---

## Versiones actuales de archivos (MUY IMPORTANTE para cache bust)

```
corcegacafe/
├── tienda.html               # tienda.css?v=2.0 | tienda.js?v=1.9 | footer-component.js?v=1.2
├── producto.html             # tienda.css?v=2.0 | producto-detalle.js?v=1.5 | footer-component.js?v=1.2
├── checkout.html             # tienda.css?v=2.0 | checkout-v8.js?v=2.1 | footer-component.js?v=1.2
├── success.html              # tienda.css?v=2.0 | footer-component.js?v=1.2
├── admin-new.html            # admin-tienda.js?v=14
├── css/tienda/tienda.css     # v=2.0 — incluye estilos footer + media queries mobile
└── js/tienda/
    ├── tienda.js             # grilla, carrito, picker variantes, reservas, timer
    ├── producto-detalle.js   # página de producto, stock contextual
    ├── checkout-v8.js        # checkout, agenda/flatpickr, MP
    ├── admin-tienda.js       # panel admin
    ├── header-component.js   # header compartido (todas las páginas tienda)
    ├── footer-component.js   # footer compartido (todas las páginas tienda)
    ├── cart-reservas.js      # sistema de reservas Firestore (sin versión en HTML)
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
    facebook:  { activo: bool, url: string },
    tiktok:    { activo: bool, url: string },
    twitter:   { activo: bool, url: string }
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

## Todo lo implementado (sesión completa)

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
- `getSessionId()` — UUID por browser en `localStorage('corcega_session_id')`
- `writeReserva(productId, variantKey, qty, nombre)` — upsert con `expiresAt = now + 10min`
- `deleteReserva()` / `deleteAllSessionReservas()`
- `fetchReservedByOthers()` — retorna mapa `{productId_variantKey: qty}` de reservas activas de OTRAS sesiones
- tienda.js: descuenta reservas ajenas del stock visible en la grilla al cargar productos
- Carrito muestra countdown `⏱ M:SS` (naranja) por item con stock limitado; rojo al < 2min
- Al expirar: item eliminado del carrito + toast rojo + `deleteReserva`
- checkout-v8.js: `deleteAllSessionReservas()` al confirmar el pedido (antes del redirect)

### 4. Mensajes contextuales de stock
- En tu sesión con X en carrito y Y disponible:
  - `inCart > 0 && stock > 0` → "🛒 Tenés **X** en el carrito · quedan **Y** más" (naranja)
  - `inCart > 0 && stock === 0` → "🛒 Ya tenés **X** reservados en tu carrito" (verde)
  - `inCart === 0 && stock bajo` → "⚡ ¡Solo quedan **X**, no te quedes sin el tuyo!" (naranja)
  - `inCart === 0 && sin stock` → "⚠️ Sin stock" (rojo)
- Implementado en `tienda.js` (picker modal `vpmSelectOption`) y `producto-detalle.js` (`showStockInfo(el, stock, avisoStock, inCart)`)
- Qty picker (`changeQty`, `vpmAdjustQty`) capea en `rawStock - reservedByOthers - inCart`

### 5. Fix agenda checkout (`checkout-v8.js`)
- `Promise.all` → `Promise.allSettled` al fetchear productos para chequeo de agenda
- Así un producto faltante/fallido no cancela la verificación de los demás

### 6. Footer component (`footer-component.js`)
- Lee `configuracion/tienda` de Firestore (`info` y `redes`)
- Muestra: brand, dirección + link Google Maps, iconos sociales activos (Instagram, Facebook, TikTok, X, WhatsApp)
- Bottom strip: `© año Córcega Café · Hecho con ♥ (naranja #ed7053) por LENUAhub`
- Link LENUAhub → `https://wa.me/5491136053892`
- Fallback minimal si falla Firestore
- Agregado a los 4 HTML de tienda con `?v=1.2`
- Admin panel: sección "🌐 Info & Redes Sociales" — `conf-direccion`, `conf-maps-url`, `conf-whatsapp`, toggles + URL para cada red
- `loadConfigStore` y `guardarConfigStore` en admin-tienda.js guardan/cargan estos campos

### 7. Mobile header fix
- `@media (max-width: 600px)` en tienda.css:
  - `#header-user-greeting { display: none !important }` — oculta "¡HOLA, EMILIANO!" en mobile
  - Header: 70px alto, padding 16px, logo 36px, gap 14px entre acciones
  - Brand: font-size reducido
- **NO afecta desktop** (solo ≤ 600px)

### 8. Sincronización CSS
- Todos los HTML ahora en `tienda.css?v=2.0` (antes cada uno tenía versión distinta → footer roto en success.html)

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

1. **Cleanup de reservas expiradas en Firestore**: las reservas viejas quedan en la colección hasta que el mismo cliente las expire client-side. Considerar una Cloud Function con `pubsub` schedule que borre docs con `expiresAt < now`.
2. **Test MP en producción**: cambiar Access Token de test → producción en la Cloud Function `crearPreferenciaMp` cuando salgan al aire.
3. **Admin — UX ∞ en variantes**: cuando el checkbox ∞ está activo, el input de stock se ve grisáceo. Mejorar visualmente (mostrar texto "∞" en lugar del input).
4. **Limpiar footer en el index**: el footer del index (`index.html`) es diferente (marca de LENUAhub hardcodeada). Si quieren unificarlo, usar el mismo `footer-component.js`.

---

## Comandos útiles

```bash
# Ver últimos commits
cd /Users/emi/CorcegaProject/corcegacafe && git log --oneline -10

# Push rápido
git add -A && git commit -m "mensaje" && git push origin main
```

---

## Notas críticas para no romper nada

- **Versiones de scripts/CSS**: si modificás un JS o CSS, bumpeá el `?v=X` en TODOS los HTML que lo usan. Todos los HTML deben tener la misma versión de `tienda.css` (actualmente `v=2.0`).
- **cart-reservas.js** es importado por `tienda.js`, `producto-detalle.js` y `checkout-v8.js` — cualquier cambio ahí afecta los tres simultáneamente.
- **admin-tienda.js** usa `export function` y se importa en `admin-new.html` como `window.tiendaAdmin` — las funciones nuevas deben exportarse Y agregarse al objeto `window.tiendaAdmin` al final del archivo.
- **Cart localStorage** key: `corcega_cart` — estructura de cada item:
  ```javascript
  { id, nombre, precio, qty, stock, stockIlimitado, imagenUrl,
    variantKey?, variantLabel?, _cartKey?, reservadoEn? }
  ```
- **Session ID**: `localStorage('corcega_session_id')` = UUID para el sistema de reservas. No borrarlo manualmente.
- **Media query mobile**: está en `tienda.css` al final, `@media (max-width: 600px)`. Solo afecta tienda pages, no admin.
- **Footer corazón**: color hardcodeado `#ed7053` (no usar `var(--naranja-accent)` que no resuelve bien en ese contexto).
