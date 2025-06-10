const admin = require("firebase-admin");

const serviceAccount = require("/Users/emi/.secrets/serviceAccount.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uid = "RZIzXw3gsGSmEHf3oG7jxpWh9RF3"; // reemplazá por el UID real
const rol = "dueño"; // o 'empleado', etc.

admin.auth().setCustomUserClaims(uid, { rol })
  .then(() => {
    console.log(`✅ Se asignó el rol "${rol}" al usuario ${uid}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error al asignar el rol:", error);
    process.exit(1);
  });