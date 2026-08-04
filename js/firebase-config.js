import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Configuración del proyecto Firebase
export const firebaseConfig = {
  apiKey: "AIzaSyC-c_OMJBiPuCfh3bct7cpgSB9LernugRA",
  authDomain: "corcega-loyalty-club.firebaseapp.com",
  projectId: "corcega-loyalty-club",
  storageBucket: "corcega-loyalty-club.firebasestorage.app",
  messagingSenderId: "789184958568",
  appId: "1:789184958568:web:4990bf50335bec365f2bdd",
  measurementId: "G-NXMC00DZ81"
};

// Si querés seguir usando app y db desde este archivo, podés exportarlos también:
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Analytics y Auth dependen de IndexedDB/storage del browser. En Safari con
// modo privado (o ITP restrictivo) pueden no estar disponibles y tirar error
// al inicializar; sin este guard, ese error aborta la carga de todo el
// módulo y con eso también db, dejando páginas como carta.html colgadas.
let analytics = null;
isSupported()
    .then(supported => { if (supported) analytics = getAnalytics(app); })
    .catch(err => console.warn('Firebase Analytics no disponible:', err));

let auth;
try {
    auth = getAuth(app);
} catch (err) {
    console.warn('Firebase Auth no disponible:', err);
    auth = null;
}

export { app, db, storage, auth };
