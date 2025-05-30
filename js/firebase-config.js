// Import the functions from Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, db };
