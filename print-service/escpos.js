'use strict';

/**
 * escpos.js — ESC/POS en JavaScript puro, sin dependencias nativas.
 * Genera el buffer de bytes que se envía directamente a la impresora.
 */

const ANCHO_DEFAULT = 48;

// Comandos ESC/POS estándar
const CMD = {
    INIT:       Buffer.from([0x1B, 0x40]),             // Inicializar
    BOLD_ON:    Buffer.from([0x1B, 0x45, 0x01]),
    BOLD_OFF:   Buffer.from([0x1B, 0x45, 0x00]),
    ALIGN_L:    Buffer.from([0x1B, 0x61, 0x00]),
    ALIGN_C:    Buffer.from([0x1B, 0x61, 0x01]),
    ALIGN_R:    Buffer.from([0x1B, 0x61, 0x02]),
    DBLH_ON:    Buffer.from([0x1B, 0x21, 0x10]),       // Doble altura
    DBLH_OFF:   Buffer.from([0x1B, 0x21, 0x00]),
    CUT:        Buffer.from([0x1D, 0x56, 0x42, 0x00]), // Corte parcial
    LF:         Buffer.from([0x0A]),                    // Salto de línea
};

/** Normaliza tildes/ñ a ASCII básico para compatibilidad universal */
function norm(str) {
    return (str || '')
        .replace(/[áàâãä]/gi, 'a')
        .replace(/[éèêë]/gi,  'e')
        .replace(/[íìîï]/gi,  'i')
        .replace(/[óòôõö]/gi, 'o')
        .replace(/[úùûü]/gi,  'u')
        .replace(/ñ/gi,       'n')
        .replace(/[¿¡]/g,     '');
}

/** Builder que acumula buffers ESC/POS */
function EscposBuilder(ancho) {
    ancho = ancho || ANCHO_DEFAULT;
    const parts = [CMD.INIT];

    const push = (...bufs) => bufs.forEach(b => parts.push(b));
    const txt  = (s) => push(Buffer.from(norm(s || ''), 'ascii'));
    const nl   = ()  => push(CMD.LF);

    return {
        centro(s)            { push(CMD.ALIGN_C); txt(s); nl(); },
        izquierda(s)         { push(CMD.ALIGN_L); txt(s); nl(); },
        bold(s)              { push(CMD.ALIGN_L, CMD.BOLD_ON); txt(s); push(CMD.BOLD_OFF); nl(); },
        bigBold(s)           { push(CMD.ALIGN_C, CMD.DBLH_ON, CMD.BOLD_ON); txt(s); push(CMD.BOLD_OFF, CMD.DBLH_OFF); nl(); },
        linea()              { push(CMD.ALIGN_L); txt('-'.repeat(ancho)); nl(); },
        espacio()            { nl(); },

        /** Fila con texto a izquierda y precio a derecha, opcionalmente bold */
        fila(izq, der, bold) {
            const max  = ancho - der.length - 1;
            const text = izq.length > max ? izq.slice(0, max - 1) + '.' : izq;
            const pad  = ancho - text.length - der.length;
            const line = text + ' '.repeat(Math.max(1, pad)) + der;
            if (bold) push(CMD.BOLD_ON);
            push(CMD.ALIGN_L); txt(line); nl();
            if (bold) push(CMD.BOLD_OFF);
        },

        cortar() { push(CMD.CUT); },

        /** Devuelve el Buffer final para enviar a la impresora */
        build() { return Buffer.concat(parts); }
    };
}

/** Builder que renderiza el ticket como texto en consola (para preview) */
function ConsoleBuilder(ancho) {
    ancho = ancho || ANCHO_DEFAULT;
    const lines = [];

    const pad = (s, w) => {
        const v = norm(s || '');
        return v.length < w ? v + ' '.repeat(w - v.length) : v;
    };

    return {
        centro(s)           { lines.push(norm(s || '').padStart(Math.floor((ancho + norm(s).length) / 2)).padEnd(ancho)); },
        izquierda(s)        { lines.push(norm(s || '')); },
        bold(s)             { lines.push(`** ${norm(s || '')} **`); },
        bigBold(s)          { lines.push(`>>> ${norm(s || '').toUpperCase()} <<<`); },
        linea()             { lines.push('─'.repeat(ancho)); },
        espacio()           { lines.push(''); },
        fila(izq, der, b)   {
            const max  = ancho - der.length - 1;
            const text = norm(izq.length > max ? izq.slice(0, max - 1) + '.' : izq);
            const sp   = ancho - text.length - der.length;
            lines.push(text + ' '.repeat(Math.max(1, sp)) + der + (b ? ' ◄' : ''));
        },
        cortar()            { lines.push('✂  - - - - - - - - - - - - - - - - - - -\n'); },
        render()            { return lines.join('\n'); }
    };
}

module.exports = { norm, EscposBuilder, ConsoleBuilder };
