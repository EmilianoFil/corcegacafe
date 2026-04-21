'use strict';

/**
 * escpos.js — ESC/POS en JavaScript puro, sin dependencias nativas.
 * Genera el buffer de bytes que se envía directamente a la impresora.
 */

const ANCHO_DEFAULT = 48;

const CMD = {
    INIT:    Buffer.from([0x1B, 0x40]),
    BOLD_ON: Buffer.from([0x1B, 0x45, 0x01]),
    BOLD_OFF:Buffer.from([0x1B, 0x45, 0x00]),
    ALIGN_L: Buffer.from([0x1B, 0x61, 0x00]),
    ALIGN_C: Buffer.from([0x1B, 0x61, 0x01]),
    DBLH_ON: Buffer.from([0x1B, 0x21, 0x10]),
    DBLH_OFF:Buffer.from([0x1B, 0x21, 0x00]),
    CUT:     Buffer.from([0x1D, 0x56, 0x42, 0x00]),
    LF:      Buffer.from([0x0A]),
};

/** Normaliza tildes/ñ → ASCII básico para compatibilidad universal */
function norm(str) {
    return (str || '')
        .replace(/[áàâãä]/gi, 'a').replace(/[éèêë]/gi, 'e')
        .replace(/[íìîï]/gi,  'i').replace(/[óòôõö]/gi,'o')
        .replace(/[úùûü]/gi,  'u').replace(/ñ/gi,      'n')
        .replace(/[¿¡]/g, '');
}

/**
 * Genera el bloque ESC/POS para imprimir un QR code.
 * @param {string} url   — contenido del QR
 * @param {number} size  — tamaño módulo 3-8 (default 6)
 */
function qrCodeBuffer(url, size) {
    size = size || 6;
    const data = Buffer.from(url, 'latin1');
    const len  = data.length + 3;
    const pL   = len & 0xFF;
    const pH   = (len >> 8) & 0xFF;

    return Buffer.concat([
        CMD.ALIGN_C,
        // Modelo 2
        Buffer.from([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
        // Tamaño
        Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size]),
        // Corrección de errores nivel M
        Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30]),
        // Almacenar datos
        Buffer.from([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]),
        data,
        // Imprimir
        Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),
        CMD.LF,
    ]);
}

/** Builder ESC/POS — acumula buffers para enviar a la impresora */
function EscposBuilder(ancho) {
    ancho = ancho || ANCHO_DEFAULT;
    const parts = [CMD.INIT];
    const push = (...bufs) => bufs.forEach(b => parts.push(b));
    const txt  = (s) => push(Buffer.from(norm(s || ''), 'latin1'));
    const nl   = ()  => push(CMD.LF);

    return {
        centro(s)        { push(CMD.ALIGN_C); txt(s); nl(); },
        izquierda(s)     { push(CMD.ALIGN_L); txt(s); nl(); },
        boldLeft(label, value) { push(CMD.ALIGN_L, CMD.BOLD_ON); txt(label + ' '); push(CMD.BOLD_OFF); txt(value); nl(); },
        bold(s)          { push(CMD.ALIGN_L, CMD.BOLD_ON); txt(s); push(CMD.BOLD_OFF); nl(); },
        bigBold(s)       { push(CMD.ALIGN_C, CMD.DBLH_ON, CMD.BOLD_ON); txt(s); push(CMD.BOLD_OFF, CMD.DBLH_OFF); nl(); },
        linea()          { push(CMD.ALIGN_L); txt('-'.repeat(ancho)); nl(); },
        espacio()        { nl(); },
        fila(izq, der, bold) {
            const max  = ancho - der.length - 1;
            const text = izq.length > max ? izq.slice(0, max - 1) + '.' : izq;
            const pad  = ancho - text.length - der.length;
            const line = text + ' '.repeat(Math.max(1, pad)) + der;
            if (bold) push(CMD.BOLD_ON);
            push(CMD.ALIGN_L); txt(line); nl();
            if (bold) push(CMD.BOLD_OFF);
        },
        qr(url)          { push(qrCodeBuffer(url)); },
        cortar()         { push(CMD.CUT); },
        build()          { return Buffer.concat(parts); }
    };
}

/** Builder consola — renderiza el ticket como texto para preview en Mac */
function ConsoleBuilder(ancho) {
    ancho = ancho || ANCHO_DEFAULT;
    const lines = [];
    const n = (s) => norm(s || '');

    return {
        centro(s)        { lines.push(n(s).padStart(Math.floor((ancho + n(s).length) / 2)).padEnd(ancho)); },
        izquierda(s)     { lines.push(n(s)); },
        boldLeft(label, value) { lines.push(`**${n(label)}** ${n(value)}`); },
        bold(s)          { lines.push(`** ${n(s)} **`); },
        bigBold(s)       { lines.push(`>>> ${n(s).toUpperCase()} <<<`); },
        linea()          { lines.push('─'.repeat(ancho)); },
        espacio()        { lines.push(''); },
        fila(izq, der, b) {
            const max  = ancho - der.length - 1;
            const text = n(izq.length > max ? izq.slice(0, max - 1) + '.' : izq);
            const sp   = ancho - text.length - der.length;
            lines.push(text + ' '.repeat(Math.max(1, sp)) + der + (b ? ' ◄' : ''));
        },
        qr(url)          { lines.push(`[ QR → ${url} ]`); },
        cortar()         { lines.push('\n✂  - - - - - - - - - - - - - - - - - - -'); },
        render()         { return lines.join('\n'); }
    };
}

module.exports = { norm, EscposBuilder, ConsoleBuilder };
