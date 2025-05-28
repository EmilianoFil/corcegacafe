// Import the functions from Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// Configuración del proyecto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyC-c_OMJBiPuCfh3bct7cpgSB9LernugRA",
  authDomain: "corcega-loyalty-club.firebaseapp.com",
  projectId: "corcega-loyalty-club",
  storageBucket: "corcega-loyalty-club.firebasestorage.app",
  messagingSenderId: "789184958568",
  appId: "1:789184958568:web:4990bf50335bec365f2bdd",
  measurementId: "G-NXMC00DZ81"
};

// Inicializar Firebase y Analytics
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// 👇 ESTA LÍNEA ES FUNDAMENTAL
export { app, db };
