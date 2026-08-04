const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const cors = require("cors");
const corsHandler = cors({ origin: true });
const admin = require("firebase-admin");
const { VertexAI } = require("@google-cloud/vertexai");

const PROJECT_ID = "corcega-loyalty-club";
const LOCATION   = "us-central1";
const MODEL_ID   = "gemini-2.5-flash";

// Mismo criterio que firestore.rules para carta_platos/carta_secciones:
// cualquier usuario autenticado puede escribir la carta.
async function _verificarAuth(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: "No autorizado." }); return false; }
  try {
    await admin.auth().verifyIdToken(token);
    return true;
  } catch (e) {
    res.status(403).json({ error: "Token inválido o expirado." });
    return false;
  }
}

function _prompt(nombre, descripcion) {
  return `Sos traductor especializado en cartas de café/restaurante. Traducí este plato de una cafetería argentina a inglés (en), portugués de Brasil (pt) y coreano (ko).

Reglas:
- Traducción natural y apetitosa, no literal palabra por palabra.
- Nombres de preparaciones típicas sin equivalente conocido (ej: "medialuna", "alfajor", "submarino") se mantienen tal cual, opcionalmente con una breve aclaración entre paréntesis.
- Si la descripción está vacía, devolvé descripción vacía en los 3 idiomas.
- Respondé ÚNICAMENTE con un JSON válido, sin texto adicional, sin markdown, con esta forma exacta:
{"en":{"nombre":"...","descripcion":"..."},"pt":{"nombre":"...","descripcion":"..."},"ko":{"nombre":"...","descripcion":"..."}}

Nombre: ${nombre}
Descripción: ${descripcion || "(sin descripción)"}`;
}

let _vertexClient = null;
function _getModel() {
  if (!_vertexClient) _vertexClient = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return _vertexClient.getGenerativeModel({ model: MODEL_ID });
}

// Genera nombre/descripción en, pt, ko para un plato. La llama el admin desde
// el botón "Generar en idiomas" del form de carta (admin-new.html). Requiere
// que la Vertex AI API esté habilitada y el service account de la función
// tenga el rol "Vertex AI User" en el proyecto de GCP.
exports.generarTraduccionesPlato = onRequest({ region: LOCATION }, (req, res) => {
  corsHandler(req, res, async () => {
    if (!(await _verificarAuth(req, res))) return;

    const { nombre, descripcion } = req.body || {};
    if (!nombre || typeof nombre !== "string") {
      res.status(400).json({ error: "Falta el nombre del plato." });
      return;
    }

    try {
      const model  = _getModel();
      const result = await model.generateContent(_prompt(nombre, descripcion || ""));
      const text   = result.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const match  = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("La IA no devolvió JSON válido.");

      const parsed = JSON.parse(match[0]);
      for (const lang of ["en", "pt", "ko"]) {
        if (!parsed[lang]?.nombre) throw new Error(`Falta traducción a "${lang}" en la respuesta.`);
      }
      res.json(parsed);
    } catch (e) {
      logger.error("generarTraduccionesPlato:", e);
      res.status(500).json({ error: "No se pudo generar la traducción: " + e.message });
    }
  });
});
