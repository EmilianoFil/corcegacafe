const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const db = admin.firestore();

exports.uploadMenuToGitHub = functions.https.onCall(async (data, context) => {
  const { fileBase64, comment } = data;

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Debés estar logueado.");
  }


  if (!fileBase64 || !comment || comment.length > 30) {
    throw new functions.https.HttpsError("invalid-argument", "Datos incompletos o comentario demasiado largo.");
  }

  const githubToken = functions.config().github.token;
  const repoOwner = "emilianofil"; // cambiá si usás otro usuario
  const repoName = "sandboxcafe";
  const filePath = "Menu_Corcega.pdf";
  const branch = "main";

  // Paso 1: Obtener el SHA del archivo actual
  const getUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;

  const getRes = await fetch(getUrl, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!getRes.ok) {
    throw new functions.https.HttpsError("not-found", "No se pudo obtener el SHA del archivo actual.");
  }

  const fileData = await getRes.json();
  const sha = fileData.sha;

  // Paso 2: Hacer commit nuevo con el archivo
  const uploadRes = await fetch(getUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      message: comment,
      content: fileBase64,
      branch: branch,
      sha: sha,
    }),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new functions.https.HttpsError("internal", `Error al subir: ${errText}`);
  }

  // Log a Firestore
  await db.collection("logs").add({
    usuario: context.auth.token.email || context.auth.uid,
    accion: "subida_menu",
    comentario: comment,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { status: "ok" };
});