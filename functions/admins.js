// Administración de usuarios del panel. Se hace en el servidor porque listar y
// borrar cuentas de Auth no se puede desde el navegador.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Mismos emails que js/admin-guard.js: no se pueden quitar desde el panel
const ADMIN_EMAILS = ["emilianofilgueira@gmail.com", "lemacafesrl@gmail.com"];

async function buscarPorEmail(email) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") return null;
    throw e;
  }
}

async function listar(miUid) {
  const db = admin.firestore();
  const [nuevos, viejos, maestros] = await Promise.all([
    db.collection("admins").get(),
    db.collection("admin").get(),
    Promise.all(ADMIN_EMAILS.map(buscarPorEmail)),
  ]);
  const datos = new Map();
  [...viejos.docs, ...nuevos.docs].forEach((d) => datos.set(d.id, { ...datos.get(d.id), ...d.data() }));
  maestros.filter(Boolean).forEach((u) => datos.set(u.uid, datos.get(u.uid) || {}));

  const uids = [...datos.keys()];
  const cuentas = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    res.users.forEach((u) => cuentas.set(u.uid, u));
  }

  return uids.map((uid) => {
    const cuenta = cuentas.get(uid);
    const info = datos.get(uid);
    const email = cuenta?.email || info.email || "";
    return {
      uid,
      email,
      nombre: info.nombre || cuenta?.displayName || "",
      ultimoIngreso: cuenta?.metadata.lastSignInTime || null,
      sinCuenta: !cuenta,
      principal: ADMIN_EMAILS.includes(email),
      soyYo: uid === miUid,
    };
  }).sort((a, b) => a.email.localeCompare(b.email));
}

async function crear({ email, nombre, password }, creadoPor) {
  email = String(email || "").trim().toLowerCase();
  nombre = String(nombre || "").trim().slice(0, 80);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError("invalid-argument", "Email inválido.");

  let cuenta = await buscarPorEmail(email);
  const yaExistia = !!cuenta;
  if (!cuenta) {
    if (String(password || "").length < 8) {
      throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 8 caracteres.");
    }
    cuenta = await admin.auth().createUser({ email, password, displayName: nombre || undefined });
  }
  await admin.firestore().doc(`admins/${cuenta.uid}`).set({
    email,
    nombre,
    creadoPor,
    creado: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { yaExistia };
}

async function quitar(uid, miUid) {
  if (!uid || typeof uid !== "string" || uid.includes("/")) {
    throw new HttpsError("invalid-argument", "Usuario inválido.");
  }
  if (uid === miUid) throw new HttpsError("failed-precondition", "No podés quitarte a vos mismo.");

  const cuenta = await admin.auth().getUser(uid).catch((e) => {
    if (e.code === "auth/user-not-found") return null;
    throw e;
  });
  if (cuenta && ADMIN_EMAILS.includes(cuenta.email)) {
    throw new HttpsError("failed-precondition", "Es un administrador principal y no se puede quitar.");
  }

  const db = admin.firestore();
  const cliente = await db.doc(`usuarios_tienda/${uid}`).get();
  await Promise.all([db.doc(`admins/${uid}`).delete(), db.doc(`admin/${uid}`).delete()]);

  // Si además es cliente de la tienda o la carta, conserva su cuenta
  if (cuenta && !cliente.exists) {
    await admin.auth().deleteUser(uid);
    return { cuentaBorrada: true };
  }
  if (cuenta) await admin.auth().revokeRefreshTokens(uid);
  return { cuentaBorrada: false };
}

exports.gestionarAdmins = onCall({ region: "us-central1" }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Tenés que iniciar sesión.");
  // Solo los principales: las reglas de Firestore todavía dejan escribir en
  // "admins" a cualquier usuario logueado, así que no alcanza para autorizar.
  if (!ADMIN_EMAILS.includes(auth.token.email)) {
    throw new HttpsError("permission-denied", "Solo los administradores principales pueden gestionar usuarios.");
  }

  const quien = auth.token.email || auth.uid;
  if (data?.accion === "listar") return { usuarios: await listar(auth.uid) };
  if (data?.accion === "crear") {
    const res = await crear(data, quien);
    logger.info(`Admin agregado: ${data.email} (por ${quien})`);
    return res;
  }
  if (data?.accion === "quitar") {
    const res = await quitar(data.uid, auth.uid);
    logger.info(`Admin quitado: ${data.uid} (por ${quien})`);
    return res;
  }
  throw new HttpsError("invalid-argument", "Acción desconocida.");
});
