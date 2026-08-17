// ─────────────────────────────────────────────────────────────────────────────
// Generador de QR "estilizado" 100% local (sin CDN externa): usa
// qrcode-generator vendorizado para obtener la matriz de módulos y la
// dibuja a mano en un <canvas>, coloreando los ojos (patrones de esquina)
// distinto del resto y dejando un hueco cuadrado en el centro para un logo
// — el mismo look que el QR físico ya impreso, pero configurable.
// ─────────────────────────────────────────────────────────────────────────────

let _qrGenLibPromise = null;

function cargarQrGenerator() {
  if (window.qrcode) return Promise.resolve();
  if (_qrGenLibPromise) return _qrGenLibPromise;
  _qrGenLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/qrcode-generator.js', import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el generador de QR'));
    document.head.appendChild(script);
  });
  return _qrGenLibPromise;
}

function construirMatrizQr(texto) {
  // typeNumber 0 = que la librería elija el tamaño mínimo que entra el texto.
  // Nivel de corrección 'H' (máximo, ~30%) porque tapamos el centro con el logo.
  let typeNumber = 0;
  while (true) {
    try {
      const qr = window.qrcode(typeNumber, 'H');
      qr.addData(texto);
      qr.make();
      return qr;
    } catch (err) {
      typeNumber++;
      if (typeNumber > 40) throw err;
    }
  }
}

function cargarImagen(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function esOjo(fila, col, n) {
  const enBloque = (f, c) => f >= 0 && f < 7 && c >= 0 && c < 7;
  return enBloque(fila, col) || enBloque(fila, col - (n - 7)) || enBloque(fila - (n - 7), col);
}

function rectRedondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function dibujarQrEstilizado(canvas, {
  texto,
  tamano = 300,
  colorFondo = '#ffffff',
  colorPrincipal = '#2b1a12',
  colorAcento = '#d86634',
  logoUrl = null,
  logoProporcion = 0.26
}) {
  await cargarQrGenerator();
  const qr = construirMatrizQr(texto);
  const n = qr.getModuleCount();
  const margen = 2; // quiet zone, en módulos
  const totalModulos = n + margen * 2;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = tamano * dpr;
  canvas.height = tamano * dpr;
  canvas.style.width = tamano + 'px';
  canvas.style.height = tamano + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, tamano, tamano);

  const cell = tamano / totalModulos;

  ctx.fillStyle = colorFondo;
  ctx.fillRect(0, 0, tamano, tamano);

  let logoDesde = -1, logoHasta = -2;
  if (logoUrl) {
    const anchoLogoModulos = Math.round(n * logoProporcion);
    const centro = Math.floor(n / 2);
    logoDesde = centro - Math.floor(anchoLogoModulos / 2);
    logoHasta = logoDesde + anchoLogoModulos;
  }

  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (!qr.isDark(fila, col)) continue;

      const enZonaLogo = logoUrl && fila >= logoDesde && fila < logoHasta && col >= logoDesde && col < logoHasta;
      if (enZonaLogo) continue;

      const x = (col + margen) * cell;
      const y = (fila + margen) * cell;

      if (esOjo(fila, col, n)) {
        // Los "ojos" se dibujan sólidos (no como puntos) para no arriesgar
        // que el escáner del celular no los reconozca.
        ctx.fillStyle = colorAcento;
        ctx.fillRect(x, y, cell, cell);
      } else {
        ctx.fillStyle = colorPrincipal;
        const r = cell * 0.42;
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (logoUrl) {
    try {
      const img = await cargarImagen(logoUrl);
      const anchoLogoPx = (logoHasta - logoDesde) * cell;
      const cx = tamano / 2;
      const cy = tamano / 2;
      const padding = anchoLogoPx * 0.12;

      ctx.fillStyle = colorFondo;
      rectRedondeado(ctx, cx - anchoLogoPx / 2 - padding / 2, cy - anchoLogoPx / 2 - padding / 2, anchoLogoPx + padding, anchoLogoPx + padding, 8);
      ctx.fill();

      const escala = Math.min(anchoLogoPx / img.width, anchoLogoPx / img.height);
      const w = img.width * escala;
      const h = img.height * escala;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    } catch (err) {
      console.warn('No se pudo dibujar el logo en el QR:', err);
    }
  }
}
