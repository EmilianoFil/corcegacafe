// Lógica compartida de las páginas redirectoras de QR (qr1.html, qr.html, etc).
// El destino vive en Firestore (colección "qrs") para poder cambiarlo sin
// tocar el QR físico ya impreso. Si el doc no existe o falla la lectura,
// cae a un destino por defecto para no dejar al cliente colgado.

import { db } from './firebase-config.js';
import {
  doc, getDoc, collection, addDoc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function redirigirQr(slug, destinoPorDefecto) {
  let destino = destinoPorDefecto;

  try {
    const ref = doc(db, 'qrs', slug);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.activo !== false && data.destino) {
        destino = data.destino;
      }
      updateDoc(ref, { clicks: increment(1), ultimoClick: serverTimestamp() }).catch(() => {});
    }
  } catch (err) {
    console.warn('No se pudo leer el QR desde Firestore, uso destino por defecto:', err);
  }

  addDoc(collection(db, "logs"), {
    usuario: "Cliente",
    accion: "EscaneoQR",
    detalles: `Cliente escaneó QR "${slug}" → ${destino}`,
    timestamp: serverTimestamp()
  }).finally(() => {
    setTimeout(() => {
      window.location.href = destino + (destino.includes('?') ? '&' : '?') + 't=' + Date.now();
    }, 800);
  });
}
