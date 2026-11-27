// Orden de los productos dentro de su categoría. Lo usan la tienda y el admin.
// Los que nunca se ordenaron van al final, del más nuevo al más viejo.
const posicion = p => Number.isFinite(p.orden) ? p.orden : Number.MAX_SAFE_INTEGER;
const creado = p => p.creadoEn?.toMillis?.() || 0;

export function ordenarProductos(lista) {
    return [...lista].sort((a, b) => posicion(a) - posicion(b) || creado(b) - creado(a));
}
