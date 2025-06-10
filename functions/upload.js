const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cors = require("cors")({ origin: true });
const db = admin.firestore();

exports.uploadMenuToGitHub = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { fileBase64, comment } = req.body.data || {};

      if (!fileBase64 || !comment || comment.length > 30) {
        return res.status(400).json({ error: 'Datos incompletos o comentario demasiado largo.' });
      }

      const githubToken = functions.config().github.token;
      const repoOwner = "emilianofil";
      const repoName = "sandboxcafe";
      const filePath = "Menu_Corcega.pdf";
      const branch = "main";

      const getUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;

      const getRes = await fetch(getUrl, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!getRes.ok) {
        console.error("No se pudo obtener el SHA del archivo actual:", await getRes.text());
        return res.status(404).json({ error: 'No se pudo obtener el SHA del archivo actual.' });
      }

      const fileData = await getRes.json();
      const sha = fileData.sha;

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
        console.error("Error al subir a GitHub:", errText);
        return res.status(500).json({ error: 'Error al subir el menú.' });
      }

      await db.collection("logs").add({
        usuario: "usuario_desconocido",
        accion: "subida_menu",
        comentario: comment,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ data: { success: true } });
    } catch (err) {
      console.error("Error en uploadMenuToGitHub:", err);
      return res.status(500).json({ error: 'Error interno del servidor.' });
    }
  });
});