import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

window.verificarLogin = async function () {
  const usuario = document.getElementById("usuario").value.trim().toLowerCase();
  const clave = document.getElementById("clave").value.trim();

  if (!usuario || !clave) {
    mostrarError("Completá todos los campos.");
    return;
  }

  try {
    const db = getFirestore();
    const q = query(collection(db, "admin"), where("usuario", "==", usuario), where("clave", "==", clave));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      mostrarError("Usuario o clave incorrectos.");
    } else {
      localStorage.setItem("admin", "true");
      localStorage.setItem("usuario", usuario);
      window.location.href = "admin.html";
    }
  } catch (e) {
    console.error(e);
    mostrarError("Error al intentar iniciar sesión.");
  }
};

function mostrarError(msg) {
  const div = document.getElementById("respuesta");
  div.className = "mensaje error";
  div.innerText = `❌ ${msg}`;
}
