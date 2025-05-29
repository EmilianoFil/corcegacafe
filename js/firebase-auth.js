import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { app } from './firebase-config.js';

const auth = getAuth(app);

export {
  auth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
};
