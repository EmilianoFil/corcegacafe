const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

setGlobalOptions({ region: "us-central1" });

const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const cors = require("cors");
const corsHandler = cors({ origin: true });
const https = require("https");
const querystring = require("querystring");

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// Verifica que el request tenga un token de admin válido
const verificarAuthAdmin = async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "No autorizado." });
    return false;
  }
  try {
    await admin.auth().verifyIdToken(token);
    return true;
  } catch (e) {
    res.status(403).json({ error: "Token inválido o expirado." });
    return false;
  }
};

// --- HELPERS VISUALES ---
const renderStepperHtml = (estadoActual) => {
    const pasos = [
        { id: 'recibido', label: 'Pedido recibido', icon: '📝' },
        { id: 'pagado', label: 'Pago confirmado', icon: '💳' },
        { id: 'en_preparacion', label: 'Preparando', icon: '☕' },
        { id: 'listo', label: 'Listo para retirar', icon: '🎁' },
        { id: 'finalizado', label: 'Entregado', icon: '✨' }
    ];

    if (estadoActual === 'cancelado') {
        return `
        <div style="margin: 30px 0; padding: 20px; background: #fff5f5; border-radius: 20px; border: 1px solid #ffd7d7; text-align: center; color: #a33; font-size: 15px; font-weight: 700;">
            ↩️ Pedido cancelado
        </div>`;
    }

    if (estadoActual === 'pendiente_devolucion') {
        return `
        <div style="margin: 30px 0; padding: 20px; background: #fff8e1; border-radius: 20px; border: 1px solid #ffe082; text-align: center; color: #7a5000; font-size: 15px; font-weight: 700;">
            📦 Devolución pendiente — esperando recepción del producto en el local
        </div>`;
    }

    let indexActual = pasos.findIndex(p => p.id === estadoActual);
    if (estadoActual === 'pendiente_pago' || estadoActual === 'transferencia') indexActual = 0;
    if (indexActual === -1) indexActual = 0;

    return `
        <div style="margin: 30px 0; padding: 20px; background: #fdfcf7; border-radius: 20px; border: 1px solid #f0eee4;">
            <div style="text-align: left; display: inline-block; width: 100%;">
                ${pasos.map((paso, idx) => {
                    const esCompletado = idx <= indexActual;
                    const esUltimo = idx === pasos.length - 1;
                    const colorPaso = esCompletado ? '#d86634' : '#cccccc';
                    
                    return `
                        <div style="display: flex; align-items: center; margin-bottom: ${esUltimo ? '0' : '15px'};">
                            <div style="min-width: 30px; font-size: 20px; text-align: center; color: ${colorPaso};">
                                ${paso.icon}
                            </div>
                            <div style="margin-left: 15px; font-size: 14px; font-weight: ${idx === indexActual ? 'bold' : 'normal'}; color: ${esCompletado ? '#2b2b2b' : '#999'};">
                                ${paso.label}
                            </div>
                            ${idx === indexActual ? `
                                <span style="margin-left: 10px; font-size: 9px; background: #d86634; color: white; padding: 2px 8px; border-radius: 10px; font-weight: 800; display: inline-block; vertical-align: middle; line-height: 14px; height: 14px;">
                                    AHORA
                                </span>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
};

const emailUser = defineSecret("EMAIL_USER");
const emailPass = defineSecret("EMAIL_PASS");
const STOCKOS_API_KEY = defineSecret("STOCKOS_API_KEY");
const CLARUS_API_KEY = defineSecret("CLARUS_API_KEY");
const CLARUS_ENDPOINT = defineSecret("CLARUS_ENDPOINT");
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const MAILERLITE_API_KEY = defineSecret("MAILERLITE_API_KEY");
const ZOHO_CAMPAIGNS_REFRESH_TOKEN = defineSecret("ZOHO_CAMPAIGNS_REFRESH_TOKEN");
const ZOHO_CAMPAIGNS_CLIENT_ID = defineSecret("ZOHO_CAMPAIGNS_CLIENT_ID");
const ZOHO_CAMPAIGNS_CLIENT_SECRET = defineSecret("ZOHO_CAMPAIGNS_CLIENT_SECRET");

const { agregarAZohoCampaigns } = require("./campaigns");

const agregarASuscriptores = async (email, nombre, dni) => {
  try {
    await agregarAZohoCampaigns(
      { email, nombre, dni },
      {
        clientId: ZOHO_CAMPAIGNS_CLIENT_ID.value(),
        clientSecret: ZOHO_CAMPAIGNS_CLIENT_SECRET.value(),
        refreshToken: ZOHO_CAMPAIGNS_REFRESH_TOKEN.value(),
      }
    );
  } catch (e) {
    logger.warn("Error agregando a Zoho Campaigns:", e.message);
  }
};
const TELEGRAM_CHAT_ID = "4755184";
const TELEGRAM_GROUP_ID = "-5218118104";
const TELEGRAM_CHAT_IDS = [TELEGRAM_CHAT_ID, TELEGRAM_GROUP_ID];

exports.enviarMailRegistro = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass, ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { nombre, mail, dni } = req.body;
      const email = mail;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: email,
        subject: "¡Bienvenido/a al Club de Recompensas!",
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b;">
            <h2>¡Bienvenido/a al Club de Cafecitos de Córcega! ☕</h2>
            <p>Hola <strong>${nombre}</strong>, ya estás registrado con el DNI <strong>${dni}</strong>.</p>
            <p>Esta es tu tarjeta, hay que empezar a llenarla:</p>
            <img src="https://emilianofil.github.io/corcegacafe/css/img/tarjeta-vacia.png" alt="Tarjeta de cafecitos" style="max-width:100%; margin:20px 0; border-radius:16px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">

            <div style="margin-bottom: 30px;">
              <div style="margin-bottom: 12px;">
                <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Logo Córcega" style="display: block; margin: 0 auto; max-width: 120px;">
              </div>
              <div>
                <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
                  Ver mi tarjeta
                </a>
              </div>
            </div>

            <p style="margin-top:30px;">Nos vemos pronto en la isla 🏝️.</p>
            <hr style="margin:30px auto; max-width:80%; border:none; border-top:1px solid #ccc;" />
            <p style="margin: 0;">Seguinos en Instagram</p>
            <a href="https://www.instagram.com/corcegacafe" target="_blank" style="display:inline-flex; align-items:center; color:#d86634; font-weight:bold; text-decoration:none; margin-top:5px;">
              <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram" width="20" height="20" style="margin-right:8px;">
              @corcegacafe
            </a>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        await agregarASuscriptores(email, nombre, dni);
        const logRef = await db.collection("logs").add({
          accion: "enviar_mail_bienvenida",
          detalles: `DNI: ${dni} - ${nombre} - ${email}`,
          usuario: "Correo_Bienvenida",
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        logger.info("Log creado con ID: " + logRef.id);
        logger.info("Correo enviado a " + email);
        res.status(200).send("Correo enviado");
      } catch (error) {
        logger.error("Error al enviar correo:", error);
        res.status(500).send("Error al enviar correo");
      }
    });
  }
);

exports.enviarMailRegistroTA = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass, ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { nombre, mail, dni } = req.body;
      const email = mail;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: email,
        subject: "¡Bienvenido/a al Club de Recompensas!",
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b;">
            <h2>¡Bienvenido/a al Club de Cafecitos de Córcega! ☕</h2>
            <p>Hola <strong>${nombre}</strong>, ya estás registrado con el DNI <strong>${dni}</strong>.</p>
            <p>Esta es tu tarjeta, hay que empezar a llenarla:</p>
            <img src="https://emilianofil.github.io/corcegacafe/css/img/tarjeta-vacia-TA.png" alt="Tarjeta de cafecitos" style="max-width:100%; margin:20px 0; border-radius:16px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">

            <div style="margin-bottom: 30px;">
              <div style="margin-bottom: 12px;">
                <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Logo Córcega" style="display: block; margin: 0 auto; max-width: 120px;">
              </div>
              <div>
                <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
                  Ver mi tarjeta
                </a>
              </div>
            </div>

            <p style="margin-top:30px;">Nos vemos pronto en la isla 🏝️.</p>
            <hr style="margin:30px auto; max-width:80%; border:none; border-top:1px solid #ccc;" />
            <p style="margin: 0;">Seguinos en Instagram</p>
            <a href="https://www.instagram.com/corcegacafe" target="_blank" style="display:inline-flex; align-items:center; color:#d86634; font-weight:bold; text-decoration:none; margin-top:5px;">
              <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram" width="20" height="20" style="margin-right:8px;">
              @corcegacafe
            </a>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        await agregarASuscriptores(email, nombre, dni);
        const logRef = await db.collection("logs").add({
          accion: "enviar_mail_bienvenida_ig",
          detalles: `DNI: ${dni} - ${nombre} - ${email}`,
          usuario: "Correo_Bienvenida_ig",
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        logger.info("Log creado con ID: " + logRef.id);
        logger.info("Correo enviado a " + email);
        res.status(200).send("Correo enviado");
      } catch (error) {
        logger.error("Error al enviar correo:", error);
        res.status(500).send("Error al enviar correo");
      }
    });
  }
);

exports.enviarMailRegistroIG = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass, ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { nombre, mail, dni } = req.body;
      const email = mail;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: email,
        subject: "¡Bienvenido/a al Club de Recompensas!",
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b;">
            <h2>¡Bienvenido/a al Club de Cafecitos de Córcega! ☕</h2>
            <p>Hola <strong>${nombre}</strong>, ya estás registrado con el DNI <strong>${dni}</strong>.</p>
            <p>Esta es tu tarjeta, hay que empezar a llenarla:</p>
            <img src="https://emilianofil.github.io/corcegacafe/css/img/tarjeta-vacia-IG.png" alt="Tarjeta de cafecitos" style="max-width:100%; margin:20px 0; border-radius:16px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">

            <div style="margin-bottom: 30px;">
              <div style="margin-bottom: 12px;">
                <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Logo Córcega" style="display: block; margin: 0 auto; max-width: 120px;">
              </div>
              <div>
                <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
                  Ver mi tarjeta
                </a>
              </div>
            </div>

            <p style="margin-top:30px;">Nos vemos pronto en la isla 🏝️.</p>
            <hr style="margin:30px auto; max-width:80%; border:none; border-top:1px solid #ccc;" />
            <p style="margin: 0;">Seguinos en Instagram</p>
            <a href="https://www.instagram.com/corcegacafe" target="_blank" style="display:inline-flex; align-items:center; color:#d86634; font-weight:bold; text-decoration:none; margin-top:5px;">
              <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram" width="20" height="20" style="margin-right:8px;">
              @corcegacafe
            </a>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        await agregarASuscriptores(email, nombre, dni);
        const logRef = await db.collection("logs").add({
          accion: "enviar_mail_bienvenida_ig",
          detalles: `DNI: ${dni} - ${nombre} - ${email}`,
          usuario: "Correo_Bienvenida_ig",
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        logger.info("Log creado con ID: " + logRef.id);
        logger.info("Correo enviado a " + email);
        res.status(200).send("Correo enviado");
      } catch (error) {
        logger.error("Error al enviar correo:", error);
        res.status(500).send("Error al enviar correo");
      }
    });
  }
);

exports.enviarMailFelicitaciones = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { nombre, mail, dni } = req.body;
      const email = mail;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: email,
        subject: "¡Felicitaciones, juntaste todos los sellos! 🎉",
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b;">
            <h2>¡Felicitaciones, ${nombre}! 🎉</h2>
            <p>Completaste tu tarjeta de cafecitos con el DNI <strong>${dni}</strong>.</p>
            <p>Así se ve ahora tu tarjeta:</p>
            <img src="https://emilianofil.github.io/corcegacafe/css/img/tarjeta-llena.png" alt="Tarjeta completa" style="max-width:100%; margin:20px 0; border-radius:16px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">
            <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
              Ver mi estado
            </a>
            <p style="margin-top:30px;">Pasá a buscar tu cafecito por la isla 🏝️.</p>
            <hr style="margin:30px auto; max-width:80%; border:none; border-top:1px solid #ccc;" />
            <p style="margin: 0;">Seguinos en Instagram</p>
            <a href="https://www.instagram.com/corcegacafe" target="_blank" style="display:inline-flex; align-items:center; color:#d86634; font-weight:bold; text-decoration:none; margin-top:5px;">
              <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram" width="20" height="20" style="margin-right:8px;">
              @corcegacafe
            </a>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        const logRef = await db.collection("logs").add({
          accion: "enviar_mail_felicitaciones",
          detalles: `DNI: ${dni} - ${nombre} - ${email}`,
          usuario: "Correo_Felicitacion",
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        logger.info("Log de felicitación creado: " + logRef.id);
        res.status(200).send("Correo de felicitación enviado");
      } catch (error) {
        logger.error("Error al enviar correo de felicitación:", error);
        res.status(500).send("Error al enviar correo de felicitación");
      }
    });
  }
);

exports.selloCumpleaniosDiario = onSchedule(
  {
    schedule: "0 8 * * *", // todos los días a las 8:00
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: [emailUser, emailPass],
  },
  async (event) => {
    const snapshot = await db.collection("clientes").get();
    const hoy = new Date();
    const dia = hoy.getDate();
    const mes = hoy.getMonth() + 1;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: emailUser.value(),
        pass: emailPass.value(),
      },
    });

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const { nombre, email, dni, cumple_dia, cumple_mes, sello_cumpleanios_activo } = data;

      if (
        cumple_dia === dia &&
        cumple_mes === mes &&
        !sello_cumpleanios_activo &&
        email
      ) {
        await db.collection("clientes").doc(doc.id).update({
          sello_cumpleanios_activo: true,
          sello_cumpleanios_ultimo: hoy.getFullYear(),
        });
        // Sumar un café adicional por cumpleaños
        await db.collection("clientes").doc(doc.id).update({
          cafes: admin.firestore.FieldValue.increment(1),
          cafes_acumulados_total: admin.firestore.FieldValue.increment(1),
        });

        const mailOptions = {
          from: `Córcega Café <${emailUser.value()}>`,
          to: email,
          subject: "¡Feliz cumpleaños! 🎂 Te regalamos un sello",
          html: `
            <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b;">
  <h2>¡Feliz cumple, ${nombre}! 🎉</h2>
  <p>Hoy es tu día, y queremos regalarte un sello especial en tu tarjeta de cafecitos.</p>
  <p>Ya está activo, y se va a usar automáticamente la próxima vez que pases por el café.</p>

  <div style="margin-bottom: 30px;">
    <div style="margin-bottom: 12px;">
      <img src="https://emilianofil.github.io/corcegacafe/css/img/sello_cumpleanos.png" alt="Sello de cumpleaños" style="max-width:140px; margin:0 auto 16px; border-radius:50%; box-shadow:0 2px 10px rgba(0,0,0,0.1); display:block;">
    </div>
    <div>
      <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
        Ver mi tarjeta
      </a>
    </div>
  </div>

  <p style="margin-top:30px;">Te esperamos para festejarlo como se debe 🐎.</p>
  <hr style="margin:30px auto; max-width:80%; border:none; border-top:1px solid #ccc;" />
  <p style="margin: 0;">Seguinos en Instagram</p>
  <a href="https://www.instagram.com/corcegacafe" target="_blank" style="display:inline-flex; align-items:center; color:#d86634; font-weight:bold; text-decoration:none; margin-top:5px;">
    <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram" width="20" height="20" style="margin-right:8px;">
    @corcegacafe
  </a>
</div>
          `,
        };

        try {
          await transporter.sendMail(mailOptions);
          await db.collection("logs").add({
            accion: "sello_cumpleanios_auto",
            detalles: `DNI: ${dni} - ${nombre} - ${email}`,
            usuario: "Cron_Cumpleaños",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          logger.info(`✅ Cumpleaños activado y correo enviado a ${email}`);
        } catch (error) {
          logger.error("❌ Error al enviar mail de cumpleaños:", error);
        }
      }
    }
  }
);

exports.enviarMailAnioNuevo = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass], timeoutSeconds: 540, memory: "512MiB" },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!await verificarAuthAdmin(req, res)) return;
      const { destinatarios, esMasivo, dniPrueba } = req.body;
      const adminUser = "Admin_Panel";

      const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, // Usamos pool para reutilizar conexiones y ser más rápidos
        maxConnections: 5,
        maxMessages: 100,
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      let listaEnvio = [];

      const normalizar = (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
      const obtenerNombreAmigable = (nombreCompleto) => {
        if (!nombreCompleto || nombreCompleto.toLowerCase() === "cliente") return "Cliente";
        const palabras = nombreCompleto.trim().split(/\s+/);
        const nombresCompuestos = ["juan", "maria", "jose", "ana", "luis"];
        if (palabras.length > 1 && nombresCompuestos.includes(palabras[0].toLowerCase())) {
          return normalizar(palabras[0]) + " " + normalizar(palabras[1]);
        }
        return normalizar(palabras[0]);
      };

      try {
        if (dniPrueba) {
          const docRef = db.collection("clientes").doc(dniPrueba.toString());
          const snap = await docRef.get();
          if (snap.exists) {
            const data = snap.data();
            listaEnvio.push({
              email: (data.email || data.mail || "").trim(),
              nombre: obtenerNombreAmigable(data.nombre || "Cliente")
            });
          } else {
            return res.status(404).send({ error: "DNI no encontrado." });
          }
        } else if (esMasivo) {
          const snapshot = await db.collection("clientes").get();
          const emialUnicos = new Set();
          snapshot.forEach(doc => {
            const data = doc.data();
            const email = (data.email || data.mail || "").trim().toLowerCase();
            if (email && email.includes("@") && !emialUnicos.has(email)) {
              emialUnicos.add(email);
              listaEnvio.push({
                email: email,
                nombre: obtenerNombreAmigable(data.nombre || "Cliente")
              });
            }
          });
        } else if (destinatarios && Array.isArray(destinatarios)) {
          listaEnvio = destinatarios.map(e => ({ email: e.trim(), nombre: "Prueba" }));
        }

        if (listaEnvio.length === 0) {
          return res.status(400).send({ error: "No hay destinatarios válidos." });
        }

        const resultados = { exitosos: 0, fallidos: 0, errores: [] };

        // Log inicial
        await db.collection("logs").add({
          accion: "inicio_campana_anio_nuevo",
          detalles: `Iniciando envío a ${listaEnvio.length} destinatarios.`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Enviamos en lotes (chunks) para no saturar pero ser rápidos
        const chunkSize = 15;
        for (let i = 0; i < listaEnvio.length; i += chunkSize) {
          const chunk = listaEnvio.slice(i, i + chunkSize);

          await Promise.all(chunk.map(async (target) => {
            const mailOptions = {
              from: `Córcega Café <${emailUser.value()}>`,
              to: target.email,
              subject: "¡Feliz Año Nuevo! 🥂✨ - Córcega Café",
              html: `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <!--[if mso]>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
    <title>Córcega — Gracias 2025</title>
    <style>
      :root { color-scheme: light only; supported-color-schemes: light only; }
      html, body { background-color: #eb6f53 !important; }
      
      /* Hack definitivo para forzar texto oscuro en Dark Mode */
      @media (prefers-color-scheme: dark) {
        .body-bg { background-color: #eb6f53 !important; }
        .card-container { background-color: #ffffff !important; }
        .festive-box { background-color: #eb6f53 !important; }
        .beige-box { background-color: #e8d8cc !important; }
        
        .force-dark-text { color: #01323f !important; }
        .force-white-text { color: #ffffff !important; }
        .force-light-blue { color: rgba(1,50,63,0.75) !important; }
      }

      /* Fix específico para Gmail App */
      u + .body .card-container { background-color: #ffffff !important; }
      u + .body .force-dark-text { color: #01323f !important; }
    </style>
  </head>

  <body style="margin:0; padding:0; background-color:#eb6f53;">
    <div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">
      Gracias por acompañarnos en 2025. En 2026, más encuentros como en casa.
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="body-bg" style="background-color:#eb6f53;">
      <tr>
        <td align="center" style="padding:26px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; border-collapse:collapse;">
            <!-- Logo area -->
            <tr>
              <td align="center" style="padding:18px 18px 14px 18px;">
                <img
                  src="https://corcegacafe.com.ar/css/img/Corcega_Logo_Letras_Blanco.png"
                  width="220"
                  alt="Córcega"
                  style="display:block; width:220px; max-width:80%; height:auto; border:0; outline:none; text-decoration:none;"
                />
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td class="card-container" style="background-color:#ffffff; border-radius:18px; overflow:hidden; border:1px solid rgba(1,50,63,0.10);">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:22px 22px 16px 22px;">
                      <div class="force-light-blue" style="font-family:Arial, sans-serif; font-size:13px; letter-spacing:0.10em; text-transform:uppercase; color:rgba(1,50,63,0.75) !important;">
                        Gracias por este 2025
                      </div>

                      <div class="force-dark-text" style="font-family:Arial, sans-serif; font-size:30px; line-height:1.18; color:#01323f !important; font-weight:800; margin-top:8px;">
                        Por cada cafecito compartido, gracias 🧡
                      </div>

                      <div class="force-dark-text" style="font-family:Arial, sans-serif; font-size:16px; line-height:1.7; color:#01323f !important; margin-top:10px;">
                        ${target.nombre}, en Córcega lo que más nos gusta no es “sólo servir café rico”, sino <strong>hacerte sentir que estás tomando un café en casa</strong>.
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- Orange highlight box -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:0 22px 18px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td class="festive-box" style="background-color:#eb6f53; border-radius:16px; padding:16px 16px;">
                            <div class="force-white-text" style="font-family:Arial, sans-serif; font-size:15px; line-height:1.65; color:#ffffff !important;">
                              <strong>En 2026 vamos por más:</strong> encuentros, cafecitos y momentos únicos.
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Details section -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:0 22px 22px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td class="beige-box" style="padding:14px 14px; background-color:#e8d8cc; border-radius:14px; border:1px solid rgba(1,50,63,0.10);">
                            <div class="force-dark-text" style="font-family:Arial, sans-serif; font-size:14px; color:#01323f !important; line-height:1.55;">
                              <span style="color:#008ba4; font-weight:800;">•</span> Más momentos tranquilos (aunque el día venga a mil).<br/>
                              <span style="color:#008ba4; font-weight:800;">•</span> Más cositas ricas para acompañar.<br/>
                              <span style="color:#008ba4; font-weight:800;">•</span> Y el mismo espíritu de siempre: <strong>rebeldía cafetera</strong>.
                            </div>
                          </td>
                        </tr>
                      </table>

                      <div class="force-dark-text" style="font-family:Arial, sans-serif; font-size:16px; line-height:1.7; color:#01323f !important; margin-top:10px;">
                        ¡Hola 2026! Nos vemos en la isla 🏝️.<br />
                        <strong>Equipo Córcega 🐎</strong> <span style="color:#eb6f53; font-weight:800;">☕</span>
                      </div>

                      <div style="height:1px; background-color:rgba(1,50,63,0.10); margin:18px 0;"></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:14px 0 0 0;">
                <span class="force-white-text" style="font-family:Arial, sans-serif; font-size:12px; color:rgba(255,255,255,0.90) !important;">
                  Córcega · #eb6f53
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
            };

            try {
              await transporter.sendMail(mailOptions);
              resultados.exitosos++;
            } catch (err) {
              resultados.fallidos++;
              resultados.errores.push({ email: target.email, error: err.message });
            }
          }));

          // Log parcial cada lote para no perder rastro
          logger.info(`Progreso: ${i + chunk.length}/${listaEnvio.length}`);
        }

        if (resultados.fallidos > 0) {
          await db.collection("logs").add({
            accion: "mail_anio_nuevo_fallidos",
            detalles: `Emails fallidos (${resultados.fallidos}): ` + resultados.errores.map(e => `${e.email} (${e.error})`).join(", ").substring(0, 1500),
            usuario: adminUser,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        await db.collection("logs").add({
          accion: esMasivo ? "mail_anio_nuevo_masivo_finalizado" : "mail_anio_nuevo_prueba",
          detalles: `FIN CAMPANA. Exitosos: ${resultados.exitosos}, Fallidos: ${resultados.fallidos}. Total: ${listaEnvio.length}`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).send(resultados);
      } catch (error) {
        logger.error("Error en proceso masivo:", error);
        res.status(500).send({ error: error.message });
      }
    });
  }
);

exports.enviarMailAniversario = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass], timeoutSeconds: 540, memory: "512MiB" },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!await verificarAuthAdmin(req, res)) return;
      const { dnisPrueba, esMasivo } = req.body;
      const adminUser = "Admin_Panel";

      const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      let listaEnvio = [];

      try {
        if (dnisPrueba && Array.isArray(dnisPrueba) && dnisPrueba.length > 0) {
          // Modo prueba: enviar solo a DNIs específicos
          for (const dni of dnisPrueba) {
            const docRef = db.collection("clientes").doc(dni.toString().trim());
            const snap = await docRef.get();
            if (snap.exists) {
              const data = snap.data();
              const email = (data.email || data.mail || "").trim();
              if (email && email.includes("@")) {
                listaEnvio.push({
                  dni: dni.toString().trim(),
                  email: email,
                  nombre: data.nombre || "Cliente",
                  yaEnviado: data.mailaniversario === true
                });
              }
            }
          }
        } else if (esMasivo) {
          // Modo masivo: todos los clientes que NO tienen mailaniversario = true
          const snapshot = await db.collection("clientes").get();
          snapshot.forEach(doc => {
            const data = doc.data();
            const email = (data.email || data.mail || "").trim().toLowerCase();
            // Solo agregar si tiene email válido Y no se le envió antes
            if (email && email.includes("@") && data.mailaniversario !== true) {
              listaEnvio.push({
                dni: doc.id,
                email: email,
                nombre: data.nombre || "Cliente",
                yaEnviado: false
              });
            }
          });
        }

        if (listaEnvio.length === 0) {
          return res.status(400).send({ error: "No hay destinatarios válidos o todos ya recibieron el mail." });
        }

        const resultados = { exitosos: 0, fallidos: 0, yaEnviados: 0, errores: [] };

        // Log inicial
        await db.collection("logs").add({
          accion: "inicio_campana_aniversario",
          detalles: `Iniciando envío a ${listaEnvio.length} destinatarios.`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Enviamos en lotes (chunks) para no saturar
        const chunkSize = 15;
        for (let i = 0; i < listaEnvio.length; i += chunkSize) {
          const chunk = listaEnvio.slice(i, i + chunkSize);

          await Promise.all(chunk.map(async (target) => {
            // Si ya fue enviado (solo aplica en modo prueba), saltear
            if (target.yaEnviado) {
              resultados.yaEnviados++;
              logger.info(`⚠️ ${target.email} ya recibió el mail anteriormente (DNI: ${target.dni})`);
              return;
            }

            const mailOptions = {
              from: `Córcega Café <${emailUser.value()}>`,
              to: target.email,
              subject: "¡Aniversario Córcega 24/01!",
              html: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>Aniversario Córcega</title>
    <style>
      :root { color-scheme: light only; }
      html, body { background-color: #fdfcf7 !important; margin: 0; padding: 0; }
      
      @media (prefers-color-scheme: dark) {
        .body-bg { background-color: #fdfcf7 !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#fdfcf7;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fdfcf7;">
      <tr>
        <td align="center" style="padding:20px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
            <tr>
              <td align="center" style="padding:0;">
                <img
                  src="https://emilianofil.github.io/corcegacafe/css/img/FlyerAniversario.jpg"
                  alt="Aniversario Córcega"
                  style="display:block; width:100%; max-width:600px; height:auto; border:0;"
                />
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 0;">
                <p style="font-family:Arial, sans-serif; font-size:14px; color:#2b2b2b; margin:0;">
                  Nos vemos en la isla 🏝️<br/>
                  <strong>Equipo Córcega 🐎</strong>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
            };

            try {
              await transporter.sendMail(mailOptions);

              // Marcar el usuario como que ya recibió el mail
              await db.collection("clientes").doc(target.dni).update({
                mailaniversario: true
              });

              resultados.exitosos++;
              logger.info(`✅ Mail enviado y marcado: ${target.email} (DNI: ${target.dni})`);
            } catch (err) {
              resultados.fallidos++;
              resultados.errores.push({ dni: target.dni, email: target.email, error: err.message });
              logger.error(`❌ Error enviando a ${target.email}:`, err);
            }
          }));

          // Log parcial cada lote
          logger.info(`Progreso: ${Math.min(i + chunk.length, listaEnvio.length)}/${listaEnvio.length}`);
        }

        if (resultados.fallidos > 0) {
          await db.collection("logs").add({
            accion: "mail_aniversario_fallidos",
            detalles: `Emails fallidos (${resultados.fallidos}): ` + resultados.errores.map(e => `${e.dni} - ${e.email} (${e.error})`).join(", ").substring(0, 1500),
            usuario: adminUser,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        await db.collection("logs").add({
          accion: esMasivo ? "mail_aniversario_masivo_finalizado" : "mail_aniversario_prueba",
          detalles: `FIN CAMPAÑA ANIVERSARIO. Exitosos: ${resultados.exitosos}, Ya enviados: ${resultados.yaEnviados}, Fallidos: ${resultados.fallidos}. Total procesados: ${listaEnvio.length}`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).send(resultados);
      } catch (error) {
        logger.error("Error en proceso masivo de aniversario:", error);
        res.status(500).send({ error: error.message });
      }
    });
  }
);

exports.uploadMenuToGitHub = require('./upload').uploadMenuToGitHub;

exports.enviarMailCampana = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass], timeoutSeconds: 540, memory: "512MiB" },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!await verificarAuthAdmin(req, res)) return;
      const { asunto, cuerpo, imagenUrl, dnisPrueba, esMasivo, campanaId } = req.body;
      const adminUser = "Admin_Panel";

      if (!asunto || !imagenUrl) {
        return res.status(400).send({ error: "Asunto e imagen son requeridos." });
      }

      const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      let listaEnvio = [];

      try {
        if (dnisPrueba && Array.isArray(dnisPrueba) && dnisPrueba.length > 0) {
          for (const dni of dnisPrueba) {
            const snap = await db.collection("clientes").doc(dni.toString().trim()).get();
            if (snap.exists) {
              const data = snap.data();
              const email = (data.email || data.mail || "").trim();
              const noMailing = data.noMailing === true;
              if (email && email.includes("@") && !noMailing) {
                listaEnvio.push({
                  dni: snap.id,
                  email,
                  nombre: data.nombre || "Cliente",
                  yaEnviado: campanaId && data.campanasRecibidas ? data.campanasRecibidas[campanaId] === true : false
                });
              }
            }
          }
        } else if (esMasivo) {
          const snapshot = await db.collection("clientes").get();
          const emailsUnicos = new Set();
          snapshot.forEach(doc => {
            const data = doc.data();
            const email = (data.email || data.mail || "").trim().toLowerCase();
            const yaEnviado = campanaId && data.campanasRecibidas ? data.campanasRecibidas[campanaId] === true : false;
            const noMailing = data.noMailing === true;

            if (email && email.includes("@") && !emailsUnicos.has(email) && !yaEnviado && !noMailing) {
              emailsUnicos.add(email);
              listaEnvio.push({ dni: doc.id, email, nombre: data.nombre || "Cliente", yaEnviado: false });
            }
          });
        }

        if (listaEnvio.length === 0) {
          return res.status(400).send({ error: "No hay destinatarios válidos, ya recibieron esta campaña o tienen deshabilitado el envío." });
        }

        const resultados = { exitosos: 0, fallidos: 0, yaEnviados: 0, errores: [] };

        await db.collection("logs").add({
          accion: "inicio_campana_personalizada",
          detalles: `Campana: ${asunto}${campanaId ? ' (ID: ' + campanaId + ')' : ''}. Destinatarios: ${listaEnvio.length}`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        const chunkSize = 15;
        for (let i = 0; i < listaEnvio.length; i += chunkSize) {
          const chunk = listaEnvio.slice(i, i + chunkSize);

          await Promise.all(chunk.map(async (target) => {
            if (target.yaEnviado) {
              resultados.yaEnviados++;
              return;
            }

            const token = Buffer.from(target.dni).toString("base64");
            const unsubscribeUrl = `https://emilianofil.github.io/corcegacafe/cancelar.html?id=${token}`;

            // URLs de tracking
            const pixelUrl = campanaId
              ? `https://trackopen-ioo4dzpz2a-uc.a.run.app?c=${campanaId}&u=${encodeURIComponent(target.dni)}`
              : null;
            const clickUrl = campanaId
              ? `https://trackclick-ioo4dzpz2a-uc.a.run.app?c=${campanaId}&u=${encodeURIComponent(target.dni)}&dest=${encodeURIComponent('https://corcegacafe.com.ar')}`
              : imagenUrl;

            const mailOptions = {
              from: `Córcega Café <${emailUser.value()}>`,
              to: target.email,
              subject: asunto,
              html: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${asunto}</title>
    <style>
      :root { color-scheme: light only; }
      html, body { background-color: #fdfcf7 !important; margin: 0; padding: 0; }
      @media (prefers-color-scheme: dark) { .body-bg { background-color: #fdfcf7 !important; } }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#fdfcf7; font-family: Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fdfcf7;">
      <tr>
        <td align="center" style="padding:20px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e0e0e0;">
            <tr>
              <td align="center" style="padding:30px 20px;">
                 ${cuerpo ? `<div style="font-size:16px; line-height:1.6; color:#2b2b2b; text-align:left; margin-bottom:25px;">${cuerpo.replace(/\n/g, "<br>")}</div>` : ""}
                 <a href="${clickUrl}" style="display:block;">
                   <img src="${imagenUrl}" alt="Flyer" style="display:block; width:100%; border-radius:8px;">
                 </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px; background-color:#f9f9f9;">
                <p style="font-size:14px; color:#666; margin:0;">
                  Gracias por ser parte del Club Córcega 🏝️<br/>
                  <strong>Equipo Córcega 🐎</strong>
                </p>
                <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Córcega" width="60" style="margin-top:15px; opacity:0.8;">
                <div style="margin-top:25px; padding-top:15px; border-top:1px solid #eee;">
                  <p style="font-size:11px; color:#999; line-height:1.4;">
                    Recibís este correo por ser cliente de Córcega Café.<br>
                    Si no deseás recibir más promociones o novedades por este medio, podés
                    <a href="${unsubscribeUrl}" style="color:#d86634; text-decoration:underline;">gestionar tus preferencias aquí</a>.
                  </p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" border="0" style="display:none;" alt="">` : ''}
  </body>
</html>`,
            };

            try {
              await transporter.sendMail(mailOptions);

              if (campanaId) {
                // Marcar en cliente (comportamiento previo)
                await db.collection("clientes").doc(target.dni).set({
                  campanasRecibidas: { [campanaId]: true },
                  timestamp_campanas: { [campanaId]: admin.firestore.FieldValue.serverTimestamp() }
                }, { merge: true });

                // Guardar destinatario con tracking
                await db.collection("campanas").doc(campanaId)
                  .collection("destinatarios").doc(target.dni).set({
                    email: target.email,
                    nombre: target.nombre,
                    estado: 'enviado',
                    abierto: false,
                    abiertaEn: null,
                    clickeo: false,
                    clickeadoEn: null,
                    enviadoEn: admin.firestore.FieldValue.serverTimestamp()
                  });
              }

              resultados.exitosos++;
            } catch (err) {
              resultados.fallidos++;
              resultados.errores.push({ email: target.email, error: err.message });

              if (campanaId) {
                await db.collection("campanas").doc(campanaId)
                  .collection("destinatarios").doc(target.dni).set({
                    email: target.email,
                    nombre: target.nombre,
                    estado: 'error',
                    errorMsg: err.message,
                    abierto: false,
                    clickeo: false,
                    enviadoEn: admin.firestore.FieldValue.serverTimestamp()
                  });
              }
            }
          }));
        }

        await db.collection("logs").add({
          accion: "fin_campana_personalizada",
          detalles: `Resultados${campanaId ? ' (ID: ' + campanaId + ')' : ''} - Exitosos: ${resultados.exitosos}, Fallidos: ${resultados.fallidos}`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Guardar resumen de envío en el documento de campaña
        if (campanaId) {
          await db.collection("campanas").doc(campanaId).update({
            status: 'sent',
            totalEnviados: resultados.exitosos,
            totalErrores: resultados.fallidos,
            enviadaEn: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        res.status(200).send(resultados);
      } catch (error) {
        logger.error("Error en mail personalizado:", error);
        res.status(500).send({ error: error.message });
      }
    });
  }
);

// ─── TRACKING: Pixel de apertura ───────────────────────────────────────────
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
);

exports.trackOpen = onRequest(
  { region: "us-central1", invoker: "public" },
  async (req, res) => {
    const { c: campanaId, u: clientDni } = req.query;
    if (campanaId && clientDni) {
      try {
        const ref = db.collection("campanas").doc(campanaId)
                      .collection("destinatarios").doc(clientDni);
        const snap = await ref.get();
        if (snap.exists && !snap.data().abierto) {
          await ref.update({
            abierto: true,
            abiertaEn: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (e) { /* silencioso */ }
    }
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(TRANSPARENT_GIF);
  }
);

// ─── TRACKING: Click en links ───────────────────────────────────────────────
exports.trackClick = onRequest(
  { region: "us-central1", invoker: "public" },
  async (req, res) => {
    const { c: campanaId, u: clientDni, dest } = req.query;
    if (campanaId && clientDni) {
      try {
        const ref = db.collection("campanas").doc(campanaId)
                      .collection("destinatarios").doc(clientDni);
        const snap = await ref.get();
        if (snap.exists && !snap.data().clickeo) {
          await ref.update({
            clickeo: true,
            clickeadoEn: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (e) { /* silencioso */ }
    }
    const destUrl = dest ? decodeURIComponent(dest) : 'https://corcegacafe.com.ar';
    res.redirect(302, destUrl);
  }
);

const { MercadoPagoConfig, Preference } = require("mercadopago");
const mpAccessToken = defineSecret("MP_ACCESS_TOKEN");

exports.crearPreferenciaMP = onRequest(
  { region: "us-central1", secrets: [mpAccessToken] },
  (req, res) => {
    corsHandler(req, res, async () => {
      try {
        let { items, orderId, successUrl, backUrl } = req.body;

        if (!orderId) {
          return res.status(400).send("Falta orderId");
        }

        // Si no vienen items, los buscamos en Firestore
        if (!items) {
          const orderDoc = await admin.firestore().collection("ordenes").doc(orderId).get();
          if (!orderDoc.exists) {
            return res.status(404).send("Orden no encontrada");
          }
          items = orderDoc.data().items;
        }

        if (!items || items.length === 0) {
          return res.status(400).send("No hay items para esta orden");
        }

        const client = new MercadoPagoConfig({ accessToken: mpAccessToken.value() });
        const preference = new Preference(client);

        const body = {
          items: items.length > 1
            ? [{
                id: "pedido",
                title: "Pedido Córcega Café",
                quantity: 1,
                unit_price: items.reduce((s, i) => s + Number(i.precio) * i.qty, 0),
                currency_id: "ARS",
                picture_url: "https://corcegacafe.com.ar/css/img/logo-corcega-color.png"
              }]
            : items.map(item => ({
                id: item.id || "prod",
                title: item.nombre,
                quantity: item.qty,
                unit_price: Number(item.precio),
                currency_id: "ARS",
                ...(item.imagenUrl && { picture_url: item.imagenUrl })
              })),
          external_reference: orderId,
          back_urls: {
            success: successUrl || "https://corcegacafe.com.ar/success.html",
            failure: backUrl || "https://corcegacafe.com.ar/checkout.html",
            pending: backUrl || "https://corcegacafe.com.ar/checkout.html"
          },
          auto_return: "approved",
          notification_url: `https://us-central1-corcega-loyalty-club.cloudfunctions.net/webhookMP`
        };

        const result = await preference.create({ body });
        
        res.status(200).json({ 
          id: result.id,
          init_point: result.init_point 
        });
      } catch (error) {
        logger.error("Error creando preferencia MP:", error);
        res.status(500).json({ error: error.message });
      }
    });
  }
);

exports.webhookMP = onRequest(
  { region: "us-central1", secrets: [mpAccessToken] },
  (req, res) => {
    // MP envía un POST con el 'id' del pago o la notificación
    corsHandler(req, res, async () => {
      try {
        const { query } = req;
        const topic = query.topic || query.type;
        const id = query.id || (req.body.data && req.body.data.id);

        if (topic === 'payment' && id) {
          logger.info(`Webhook MP: Recibido pago ID ${id}`);

          // Consultar el estado del pago en Mercado Pago
          const client = new MercadoPagoConfig({ accessToken: mpAccessToken.value() });
          const payment = new (require("mercadopago").Payment)(client);
          
          const paymentData = await payment.get({ id });
          const orderId = paymentData.external_reference;
          const status = paymentData.status;

          logger.info(`Pedido ${orderId} - Estado MP: ${status}`);

          if (orderId && (status === 'approved' || status === 'authorized')) {
            // Idempotencia: verificar si el pago ya fue procesado
            const ordenRef = db.collection("ordenes").doc(orderId);
            const ordenDoc = await ordenRef.get();
            if (ordenDoc.exists && ordenDoc.data().mp_payment_id) {
              logger.info(`Webhook duplicado ignorado para orden ${orderId} (pago ${id} ya procesado).`);
            } else {
              await ordenRef.update({
                  estado: 'pagado',
                  mp_payment_id: String(id),
                  pago_detalles: {
                      metodo: paymentData.payment_method_id,
                      tipo: paymentData.payment_type_id,
                      monto: paymentData.transaction_amount,
                      fecha_aprobado: paymentData.date_approved
                  }
              });
              logger.info(`Orden ${orderId} marcada como PAGADA.`);
            }
          }
        }

        res.status(200).send("OK");
      } catch (error) {
        logger.error("Error en webhook MP:", error);
        res.status(200).send("OK con error"); // Siempre 200 para que MP no reintente
      }
    });
  }
);

// --- TRIGGERS PARA HISTORIAL Y MAILS DE ÓRDENES ---

exports.onOrderCreated = onDocumentCreated({
    document: "ordenes/{orderId}",
    region: "us-central1",
    secrets: [emailUser, emailPass, TELEGRAM_BOT_TOKEN],
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const orderData = snapshot.data();
    const orderId = event.params.orderId;
    
    // 1. Obtener número de orden correlativo usando una transacción
    const counterRef = db.collection("metadata").doc("ordenes");
    let orderNumber = "0000";

    try {
        orderNumber = await db.runTransaction(async (t) => {
            const doc = await t.get(counterRef);
            let nextNum = 1;
            if (doc.exists) {
                nextNum = (doc.data().lastNumber || 0) + 1;
            }
            t.set(counterRef, { lastNumber: nextNum }, { merge: true });
            return nextNum.toString().padStart(4, '0');
        });
    } catch (e) {
        logger.error("Error en transacción de número de orden:", e);
        orderNumber = orderId.substring(0, 6).toUpperCase();
    }

    // 2. Descontar Stock si corresponde
    try {
        const batch = db.batch();
        for (const item of orderData.items) {
            const productRef = db.collection("productos").doc(item.id);
            const productDoc = await productRef.get();

            if (productDoc.exists) {
                const pData = productDoc.data();

                if (pData.esCombo && Array.isArray(pData.componentIds) && pData.componentIds.length > 0) {
                    // Combo: descontar stock de cada componente
                    for (const compId of pData.componentIds) {
                        const compRef = db.collection("productos").doc(compId);
                        const compDoc = await compRef.get();
                        if (!compDoc.exists) continue;
                        const compData = compDoc.data();

                        if (compData.tieneVariantes) {
                            // Descontar la variante seleccionada por el cliente
                            const selectedKey = item.comboVariantSelections?.[compId];
                            if (!selectedKey) continue;
                            const varData = compData.variantes?.[selectedKey] || {};
                            if (varData.stockIlimitado === true) continue;
                            const currentStock = varData.stock || 0;
                            const newStock = Math.max(0, currentStock - item.qty);
                            batch.update(compRef, {
                                [`variantes.${selectedKey}.stock`]: newStock,
                                actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
                            });
                            const movRef = compRef.collection("movimientos_stock").doc();
                            batch.set(movRef, {
                                cantidad: item.qty,
                                tipo: 'salida_venta',
                                motivo: `Pedido #${orderNumber} (${orderId}) - Combo: ${item.nombre} (var: ${selectedKey})`,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });
                            logger.info(`Stock variante combo ${compId}/${selectedKey}: ${currentStock} -> ${newStock}`);
                        } else {
                            if (compData.stockIlimitado === true) continue;
                            const currentStock = compData.stock || 0;
                            const newStock = Math.max(0, currentStock - item.qty);
                            batch.update(compRef, {
                                stock: newStock,
                                actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
                            });
                            const movRef = compRef.collection("movimientos_stock").doc();
                            batch.set(movRef, {
                                cantidad: item.qty,
                                tipo: 'salida_venta',
                                motivo: `Pedido #${orderNumber} (${orderId}) - Combo: ${item.nombre}`,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });
                            logger.info(`Stock componente combo ${compId}: ${currentStock} -> ${newStock}`);
                        }
                    }
                } else if (pData.tieneVariantes && item.variantKey) {
                    // Descontar stock de la variante específica
                    const varData = pData.variantes?.[item.variantKey] || {};
                    const currentStock = varData.stock || 0;
                    const newStock = Math.max(0, currentStock - item.qty);
                    batch.update(productRef, {
                        [`variantes.${item.variantKey}.stock`]: newStock,
                        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
                    });
                    const movimientoRef = productRef.collection("movimientos_stock").doc();
                    batch.set(movimientoRef, {
                        cantidad: item.qty,
                        tipo: 'salida_venta',
                        motivo: `Pedido #${orderNumber} (${orderId}) - Variante: ${item.variantKey}`,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                    logger.info(`Stock variante ${item.variantKey} actualizado: ${currentStock} -> ${newStock}`);
                } else if (pData.stockIlimitado !== true) {
                    // Stock global (sin variantes)
                    const currentStock = pData.stock || 0;
                    const newStock = Math.max(0, currentStock - item.qty);
                    batch.update(productRef, {
                        stock: newStock,
                        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
                    });
                    const movimientoRef = productRef.collection("movimientos_stock").doc();
                    batch.set(movimientoRef, {
                        cantidad: item.qty,
                        tipo: 'salida_venta',
                        motivo: `Pedido #${orderNumber} (${orderId})`,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                    logger.info(`Stock actualizado para ${item.nombre}: ${currentStock} -> ${newStock}`);
                }
            }
        }
        await batch.commit();
    } catch (err) {
        logger.error("Error descontando stock:", err);
    }

    // 3. Inicializar historial y asignar número humano
    await snapshot.ref.update({
        orderNumber: orderNumber,
        historial: [{
            estado: orderData.estado || "recibido",
            fecha: admin.firestore.Timestamp.now()
        }]
    });
    logger.info(`Orden #${orderNumber} inicializada.`);

    // 4. Notificación Telegram
    try {
        const itemsTexto = (orderData.items || [])
            .map(i => `  • ${i.qty}x ${i.nombre}${i.variantLabel ? ` (${i.variantLabel})` : ''}`)
            .join('\n');
        const metodoPago = orderData.metodoPago === 'transferencia' ? '🏦 Transferencia' : '💳 MercadoPago';
        const entrega = orderData.metodoEntrega === 'delivery' ? '🛵 Delivery' : '🏠 Retiro en local';
        const total = (orderData.total || 0).toLocaleString('es-AR');
        const horarioLinea = orderData.horario ? `\n📅 Retiro: ${orderData.horario}` : '';
        const tgMsg = `🛒 *Nuevo pedido #${orderNumber}*\n👤 ${orderData.cliente?.nombre || 'Sin nombre'}\n\n${itemsTexto}\n\n💰 $${total}\n${metodoPago} · ${entrega}${horarioLinea}`;

        await Promise.all(TELEGRAM_CHAT_IDS.map(chatId =>
            fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN.value()}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: tgMsg, parse_mode: 'Markdown' })
            })
        ));
    } catch (tgErr) {
        logger.warn("Telegram notification failed:", tgErr.message);
    }

    // 5. Preparar detalle de pedido para el Mail
    const itemsHtml = orderData.items.map(item => {
        const masInfoRow = (item.masInfo?.activo && item.masInfo?.texto)
            ? `<tr><td colspan="2" style="padding:0 0 12px; border-bottom:1px solid #f0f0f0;"><span style="font-size:12px;color:#888;line-height:1.5;">${item.masInfo.texto}</span></td></tr>`
            : '';
        return `
        <tr>
            <td style="padding:12px 0 ${masInfoRow ? '4px' : '0'} 0; border-bottom:${masInfoRow ? 'none' : '1px solid #f0f0f0'};">
                <span style="font-weight:bold; color:#d86634;">${item.qty}x</span> ${item.nombre}
                ${item.variantLabel ? `<span style="font-size:11px;color:#999;"> (${item.variantLabel})</span>` : ''}
                ${item.comboVariantLabel ? `<span style="font-size:11px;color:#999;display:block;margin-top:2px;">🎁 ${item.comboVariantLabel}</span>` : ''}
            </td>
            <td style="padding:12px 0 ${masInfoRow ? '4px' : '0'} 0; border-bottom:${masInfoRow ? 'none' : '1px solid #f0f0f0'}; text-align:right;">
                $${(item.precio * item.qty).toLocaleString('es-AR')}
            </td>
        </tr>
        ${masInfoRow}`;
    }).join('');

    // 4. Obtener Configuración de la Tienda para el Mail
    let config = {};
    try {
        const confSnap = await db.collection("configuracion").doc("tienda").get();
        if (confSnap.exists) config = confSnap.data();
    } catch(err) {
        logger.error("Error al leer config para mail:", err);
    }

    // Bloque de Transferencia (si aplica)
    let extraInfoBlock = "";
    if (orderData.metodoPago === 'transferencia' && config.pagos?.transferencia?.habilitado !== false) {
        const transferInfo = config.pagos?.transferencia?.info || "Alias: corcega.cafe.mp\nCBU: 0000003100030588661793\nTitular: Córcega Café";
        const waNumber = config.contacto?.whatsapp || "1136053892";
        const waMsg = encodeURIComponent(`Hola Córcega! Realicé el pedido #${orderNumber}. Te adjunto el comprobante.`);
        
        extraInfoBlock = `
            <div style="background:#f0f7f4; padding:25px; border-radius:18px; margin:25px 0; border:1px solid #cceadd; text-align:left;">
                <h3 style="color:#1e4634; margin:0 0 15px 0; font-size:16px;">💳 Datos para Transferencia</h3>
                <p style="font-size:14px; margin:5px 0; color:#1e4634; white-space: pre-wrap;">${transferInfo}</p>
                
                <a href="https://wa.me/54${waNumber}?text=${waMsg}" target="_blank" style="display:inline-flex; align-items:center; gap:10px; padding:14px 22px; background-color:#25d366; color:white; text-decoration:none; font-weight:bold; border-radius:12px; margin-top:20px; font-size:14px;">
                   <img src="https://emilianofil.github.io/corcegacafe/icons/whatsapp-white.svg" width="20" height="20" style="vertical-align:middle; margin-right:8px;">
                   ENVIAR COMPROBANTE
                </a>
            </div>
        `;
    } else if (orderData.metodoPago === 'efectivo') {
        const cashInfo = config.pagos?.efectivo?.info || "Pagás al retirar en el local.";
        extraInfoBlock = `
            <div style="background:#fffaf0; padding:25px; border-radius:18px; margin:25px 0; border:1px solid #f2e9d0; text-align:left;">
                <h3 style="color:#4d4430; margin:0 0 15px 0; font-size:16px;">💵 Pago en Efectivo</h3>
                <p style="font-size:14px; margin:5px 0; color:#4d4430; white-space: pre-wrap;">${cashInfo}</p>
            </div>
        `;
    }

    // 5. Enviar Mail
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
    });

    const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: orderData.cliente.email,
        subject: `🐎 ¡Pedido Recibido! #${orderNumber}`,
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b; padding:30px; border:1px solid #eee; border-radius:24px;">
            <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Logo Córcega" style="max-width:140px; margin-bottom:30px;">
            
            <h2 style="color:#d86634; margin:0 0 10px 0; font-size:24px;">¡Gracias por tu compra!</h2>
            <p style="font-size:16px; color:#666;">Hola <strong>${orderData.cliente.nombre}</strong>, recibimos tu pedido <strong>#${orderNumber}</strong>.</p>
            
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:25px 0; border-top:2px solid #f0f0f0;">
                ${itemsHtml}
                <tr>
                    <td style="padding:20px 0; font-size:18px; font-weight:800;">TOTAL</td>
                    <td style="padding:20px 0; font-size:18px; font-weight:800; text-align:right; color:#d86634;">$${orderData.total.toLocaleString('es-AR')}</td>
                </tr>
            </table>

            ${renderStepperHtml(orderData.estado || 'recibido')}

            ${extraInfoBlock}

            <div style="margin:30px 0;">
                <a href="https://corcegacafe.com.ar/success.html?orderId=${orderId}" style="display:inline-block; padding:18px 36px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:14px; box-shadow:0 6px 15px rgba(216,102,52,0.2); font-size:16px;">
                   SEGUIR MI PEDIDO
                </a>
            </div>

            <div style="margin-top:50px; padding-top:25px; border-top:1px solid #eee;">
               <p style="font-size:12px; color:#999; margin:0; line-height:1.5;">Nos vemos pronto en la isla.<br><strong>Córcega Café</strong></p>
               <p style="font-size:11px; color:#ccc; margin:16px 0 0 0;">
                 ¿Querés cancelar esta compra? <a href="https://corcegacafe.com.ar/arrepentimiento.html?orden=${orderNumber}" style="color:#d86634; text-decoration:none;">Botón de Arrepentimiento</a> (Ley 24.240)
               </p>
            </div>
          </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (err) {
        logger.error(`Error enviando mail inicial para #${orderNumber}:`, err);
    }

    // 6. Mail interno de nuevo pedido
    try {
        const metodoPagoTxt = orderData.metodoPago === 'transferencia' ? '🏦 Transferencia' : '💳 MercadoPago';
        const entregaTxt = orderData.metodoEntrega === 'delivery' ? '🛵 Delivery' : '🏠 Retiro en local';
        const itemsAdminHtml = (orderData.items || []).map(i => `
            <tr>
                <td style="padding:6px 0; border-bottom:1px solid #f0f0f0; font-size:14px;"><strong style="color:#d86634;">${i.qty}x</strong> ${i.nombre}${i.variantLabel ? ` (${i.variantLabel})` : ''}</td>
                <td style="padding:6px 0; border-bottom:1px solid #f0f0f0; text-align:right; font-size:14px;">$${((i.precio||0)*(i.qty||1)).toLocaleString('es-AR')}</td>
            </tr>`).join('');
        await transporter.sendMail({
            from: `Córcega Café <${emailUser.value()}>`,
            to: "emilianofilgueira@gmail.com, lemacafesrl@gmail.com",
            subject: `🛒 Nuevo pedido #${orderNumber} — ${orderData.cliente?.nombre || 'Sin nombre'} ($${(orderData.total||0).toLocaleString('es-AR')})`,
            html: `
              <div style="font-family:sans-serif; max-width:500px; margin:auto; padding:24px; border:1px solid #eee; border-radius:16px;">
                <h2 style="color:#d86634; margin:0 0 16px 0;">🛒 Nuevo pedido #${orderNumber}</h2>
                <table style="width:100%; font-size:14px; border-collapse:collapse;">
                  <tr><td style="padding:6px 0; color:#666; width:40%;">Cliente</td><td><strong>${orderData.cliente?.nombre || 'Sin nombre'}</strong></td></tr>
                  <tr><td style="padding:6px 0; color:#666;">Email</td><td>${orderData.cliente?.email || '—'}</td></tr>
                  <tr><td style="padding:6px 0; color:#666;">Teléfono</td><td>${orderData.cliente?.telefono || '—'}</td></tr>
                  <tr><td style="padding:6px 0; color:#666;">Pago</td><td>${metodoPagoTxt}</td></tr>
                  <tr><td style="padding:6px 0; color:#666;">Entrega</td><td>${entregaTxt}</td></tr>
                  ${orderData.horario ? `<tr><td style="padding:6px 0; color:#666;">Retiro</td><td>${orderData.horario}</td></tr>` : ''}
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px; border-top:2px solid #f0f0f0;">
                  ${itemsAdminHtml}
                  <tr>
                    <td style="padding:12px 0; font-size:16px; font-weight:800;">TOTAL</td>
                    <td style="padding:12px 0; font-size:16px; font-weight:800; text-align:right; color:#d86634;">$${(orderData.total||0).toLocaleString('es-AR')}</td>
                  </tr>
                </table>
              </div>
            `,
        });
    } catch (err) {
        logger.error(`Error enviando mail interno de nuevo pedido #${orderNumber}:`, err);
    }
});

exports.onOrderUpdated = onDocumentUpdated(
  {
    document: "ordenes/{orderId}",
    region: "us-central1",
    secrets: [emailUser, emailPass, CLARUS_API_KEY, CLARUS_ENDPOINT],
  },
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const orderId = event.params.orderId;

    // Solo si el estado cambió
    if (beforeData.estado !== afterData.estado) {
      const nuevoEstado = afterData.estado;

      // 1. Actualizar historial en Firestore
      await event.data.after.ref.update({
        historial: admin.firestore.FieldValue.arrayUnion({
          estado: nuevoEstado,
          fecha: admin.firestore.Timestamp.now()
        })
      });

      // 2. ClarusHub — registrar/revertir ingreso (fire-and-forget para no bloquear mail)
      if (nuevoEstado === 'pagado') {
        const orderRef = event.data.after.ref;
        await orderRef.update({ clarusStatus: 'pending' });
        const updatedSnap = await orderRef.get();
        notifyClarusHub(orderId, updatedSnap.data())
          .then(() => orderRef.update({ clarusStatus: 'synced', clarusError: null }))
          .catch(e => {
            logger.warn('ClarusHub notifyClarusHub falló:', e.message);
            return orderRef.update({ clarusStatus: 'failed', clarusError: e.message });
          });
      } else if (nuevoEstado === 'cancelado') {
        const wasPaid = (afterData.historial || []).some(h => h.estado === 'pagado');
        if (wasPaid) {
          const orderRef = event.data.after.ref;
          reverseClarusHub(orderId, afterData)
            .then(() => orderRef.update({ clarusStatus: 'reversed', clarusError: null }))
            .catch(e => {
              logger.warn('ClarusHub reverseClarusHub falló:', e.message);
              return orderRef.update({ clarusStatus: 'reversal_failed', clarusError: e.message });
            });
        }
      }

      // 3. Enviar Mail de Notificación
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser.value(),
          pass: emailPass.value(),
        },
      });

      let statusMsg = "";
      let emoji = "☕";
      let color = "#d86634";

      switch (nuevoEstado) {
        case 'pagado': 
            statusMsg = "¡Recibimos tu pago!"; 
            emoji = "✅"; 
            break;
        case 'en_preparacion': 
            statusMsg = "¡Estamos preparando tu pedido!"; 
            emoji = "☕"; 
            break;
        case 'listo': 
            statusMsg = "¡Tu pedido está listo para retirar!"; 
            emoji = "🎁"; 
            color = "#25d366";
            break;
        case 'finalizado': 
            statusMsg = "¡Pedido entregado! Gracias por elegirnos."; 
            emoji = "✨"; 
            break;
        case 'rechazado':
            statusMsg = "Hubo un problema con tu pago";
            emoji = "❌";
            color = "#e74c3c";
            break;
        case 'cancelado':
            statusMsg = "Tu pedido fue cancelado";
            emoji = "↩️";
            color = "#888";
            break;
        case 'pendiente_devolucion':
            statusMsg = "Solicitud de cancelación en proceso";
            emoji = "📦";
            color = "#e67e22";
            break;
        default:
            statusMsg = `Tu pedido cambió al estado: ${nuevoEstado}`;
      }

      const subject = `${emoji} ${statusMsg} - #${afterData.orderNumber || orderId.substring(0,8)}`;
      
      const itemsHtml = afterData.items.map(item => `
          <tr>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0; font-size:14px;">
                  <span style="font-weight:bold; color:#d86634;">${item.qty}x</span> ${item.nombre}
                  ${item.comboVariantLabel ? `<span style="font-size:11px;color:#999;display:block;margin-top:2px;">🎁 ${item.comboVariantLabel}</span>` : ''}
              </td>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0; text-align:right; font-size:14px;">
                  $${(item.precio * item.qty).toLocaleString('es-AR')}
              </td>
          </tr>
      `).join('');

      const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: afterData.cliente.email,
        subject: subject,
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b; padding:30px; border:1px solid #eee; border-radius:24px;">
            <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Logo Córcega" style="max-width:140px; margin-bottom:30px;">
            
            <h2 style="color:${color}; margin:0 0 10px 0; font-size:24px;">${statusMsg}</h2>
            <p style="font-size:16px; color:#666;">Hola <strong>${afterData.cliente.nombre}</strong>, tu pedido <strong>#${afterData.orderNumber || orderId.substring(0,8)}</strong> acaba de dar un paso más.</p>
            
            ${renderStepperHtml(nuevoEstado)}

            <div style="background:#fdfcf7; padding:20px; border-radius:18px; margin:25px 0; border:1px solid #f0eee4;">
                <h4 style="margin:0 0 15px 0; font-size:12px; color:#999; text-transform:uppercase; letter-spacing:1px; text-align:left;">Resumen actualizado</h4>
                <table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;">
                    ${itemsHtml}
                    <tr>
                        <td style="padding:15px 0; font-size:16px; font-weight:800;">TOTAL</td>
                        <td style="padding:15px 0; font-size:16px; font-weight:800; text-align:right; color:#d86634;">$${afterData.total.toLocaleString('es-AR')}</td>
                    </tr>
                </table>
            </div>

            <div style="margin:30px 0;">
                <a href="https://corcegacafe.com.ar/success.html?orderId=${orderId}" style="display:inline-block; padding:18px 36px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:14px; box-shadow:0 6px 15px rgba(216,102,52,0.2); font-size:16px;">
                   VER MI PEDIDO
                </a>
            </div>

            <div style="margin-top:50px; padding-top:25px; border-top:1px solid #eee;">
               <p style="font-size:12px; color:#999; margin:0; line-height:1.5;">Nos vemos pronto en la isla.<br><strong>Córcega Café</strong></p>
            </div>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        logger.info(`Mail enviado por cambio de estado: ${nuevoEstado}`);
      } catch (err) {
        logger.error("Error enviando mail de estado:", err);
      }
    }
  }
);

/**
 * Obtener estado público de una orden (vía OrderID)
 * Devuelve solo datos no sensibles para el tracking sin login.
 */
exports.getPublicOrder = onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).send({ error: "Falta orderId" });
    }

    try {
      const doc = await admin.firestore().collection("ordenes").doc(orderId).get();
      if (!doc.exists) {
        return res.status(404).send({ error: "Pedido no encontrado" });
      }

      const data = doc.data();

      // Filtramos solo data pública segura (PII OMITTED)
      const publicData = {
        id: doc.id,
        orderNumber: data.orderNumber || doc.id.substring(0, 8),
        estado: data.estado,
        items: data.items.map(i => ({ nombre: i.nombre, qty: i.qty, precio: i.precio })),
        total: data.total,
        metodoEntrega: data.metodoEntrega,
        metodoPago: data.metodoPago,
        timestamp: data.timestamp,
        horario: data.horario || null,
        historial: (data.historial || []).map(h => ({
          estado: h.estado,
          fecha: h.fecha ? { seconds: h.fecha._seconds || h.fecha.seconds, nanoseconds: 0 } : null
        }))
      };

      res.status(200).send(publicData);
    } catch (error) {
      console.error(error);
      res.status(500).send({ error: "Error interno" });
    }
  });
});

exports.enviarMailRecupero = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { email } = req.body;
      if (!email) return res.status(400).send({ error: "Email requerido" });

      try {
        // --- VALIDACIÓN DE EXISTENCIA ---
        const userSnap = await admin.firestore().collection("usuarios_tienda").where("email", "==", email).limit(1).get();
        
        if (userSnap.empty) {
            return res.status(404).send({ error: "usuario_no_encontrado" });
        }

        // 1. Generar el link de reseteo oficial de Firebase
        const actionCodeSettings = {
          url: 'https://corcegacafe.com.ar/tienda-cuenta.html',
        };
        const firebaseLink = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);
        
        // Extraer el código secreto y armar nuestro propio link custom
        const urlObj = new URL(firebaseLink);
        const oobCode = urlObj.searchParams.get('oobCode');
        const customResetLink = `https://corcegacafe.com.ar/recuperar.html?oobCode=${oobCode}`;

        // 2. Enviar el mail con nuestro diseño
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: emailUser.value(),
            pass: emailPass.value(),
          },
        });

        const mailOptions = {
          from: `Córcega Café <${emailUser.value()}>`,
          to: email,
          subject: "☕ Recuperar tu contraseña - Córcega Café",
          html: `
            <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b; padding:40px; border:1px solid #eee; border-radius:30px;">
              <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Logo Córcega" style="max-width:120px; margin-bottom:30px;">
              
              <h2 style="color:#d86634; margin:0 0 15px 0; font-size:22px;">¿Te olvidaste la clave?</h2>
              <p style="font-size:16px; color:#666; line-height:1.5;">No te preocupes, a todos nos pasa. Hacé clic en el siguiente botón para crear una nueva contraseña y volver a disfrutar de tu café favorito.</p>
              
              <div style="margin:40px 0;">
                  <a href="${customResetLink}" style="display:inline-block; padding:18px 36px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:16px; box-shadow:0 6px 15px rgba(216,102,52,0.2); font-size:16px;">
                     RESETEAR CONTRASEÑA
                  </a>
              </div>

              <p style="font-size:12px; color:#999; margin-top:30px;">Si no solicitaste este cambio, podés ignorar este mail tranquilamente.</p>
              
              <div style="margin-top:40px; padding-top:20px; border-top:1px solid #eee;">
                 <p style="font-size:11px; color:#999;">Nos vemos pronto en la isla.<br><strong>Equipo Córcega Café</strong></p>
              </div>
            </div>
          `,
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send({ success: true });

      } catch (error) {
        console.error("Error en mail de recupero:", error);
        res.status(500).send({ error: error.message });
      }
    });
  }
);

// ─── BOTÓN DE ARREPENTIMIENTO (Ley 24.240) ───────────────────────────────────

exports.solicitarArrepentimiento = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass, mpAccessToken] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { nombre, email, numeroOrden, telefono, motivo } = req.body;

      if (!nombre || !email || !numeroOrden) {
        return res.status(400).json({ error: "campos_requeridos", message: "Faltan campos obligatorios." });
      }

      // Buscar la orden por número (orderNumber) — soporta con o sin ceros
      const ordenPad = numeroOrden.toString().replace(/\D/g, '').padStart(4, '0');
      const snap = await db.collection("ordenes")
        .where("orderNumber", "==", ordenPad)
        .limit(1)
        .get();

      if (snap.empty) {
        return res.status(404).json({ error: "orden_no_encontrada" });
      }

      const orderDoc = snap.docs[0];
      const order = orderDoc.data();
      const orderId = orderDoc.id;

      // Verificar email
      if ((order.cliente?.email || "").toLowerCase() !== email.toLowerCase()) {
        return res.status(403).json({ error: "email_no_coincide" });
      }

      // Verificar que ya no esté cancelado o en proceso de devolución
      if (order.estado === 'cancelado') {
        return res.status(400).json({ error: "ya_cancelado" });
      }
      if (order.estado === 'pendiente_devolucion') {
        return res.status(400).json({ error: "ya_en_devolucion" });
      }

      // Verificar plazo de 10 días
      const orderDate = order.timestamp?.toDate ? order.timestamp.toDate() : new Date(0);
      const daysDiff = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 10) {
        return res.status(400).json({ error: "plazo_vencido" });
      }

      // Si no fue pagado aún, siempre se puede cancelar sin excepciones
      const sinPago = ['pendiente_pago', 'recibido'].includes(order.estado);
      const conPago = ['pagado', 'en_preparacion'].includes(order.estado);

      if (!sinPago && !conPago) {
        return res.status(400).json({ error: "estado_no_cancelable", estado: order.estado });
      }

      // Excepción de producto a pedido solo aplica si ya se cobró el pago
      if (conPago && order.fechaEntrega) {
        return res.status(400).json({ error: "producto_a_pedido" });
      }

      // Generar código de seguimiento
      const codigo = 'ARREP-' + Date.now().toString(36).toUpperCase().slice(-4) +
                     Math.random().toString(36).substring(2, 4).toUpperCase();

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: emailUser.value(), pass: emailPass.value() }
      });

      // ══════════════════════════════════════════════════════════════════
      // CAMINO A: SIN PAGO — cancelar directamente, sin devolución física
      // ══════════════════════════════════════════════════════════════════
      if (sinPago) {
        await db.collection("arrepentimientos").add({
          codigo,
          orderId,
          orderNumber: order.orderNumber,
          clienteNombre: nombre,
          clienteEmail: email,
          clienteTelefono: telefono || null,
          motivo: motivo || null,
          metodoPago: order.metodoPago,
          total: order.total,
          mp_payment_id: null,
          estado: 'cancelado_sin_pago',
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        await db.collection("ordenes").doc(orderId).update({
          estado: 'cancelado',
          canceladoEn: admin.firestore.FieldValue.serverTimestamp(),
          motivoCancelacion: `Arrepentimiento ${codigo} (sin pago)`
        });

        // Mail al cliente
        await transporter.sendMail({
          from: `Córcega Café <${emailUser.value()}>`,
          to: email,
          subject: `✅ Cancelación confirmada - ${codigo}`,
          html: `
            <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b; padding:30px; border:1px solid #eee; border-radius:24px;">
              <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Córcega Café" style="max-width:120px; margin-bottom:24px;">
              <h2 style="color:#d86634; margin:0 0 8px 0;">Pedido cancelado</h2>
              <p style="color:#666; font-size:15px;">Hola <strong>${nombre}</strong>, cancelamos tu pedido <strong>#${order.orderNumber}</strong>.</p>
              <div style="background:#f0f7ff; border:1.5px solid #cce0ff; border-radius:14px; padding:16px; margin:20px 0; display:inline-block;">
                <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Código de gestión</div>
                <div style="font-size:1.3rem; font-weight:900; color:#1a4a8a; letter-spacing:0.08em;">${codigo}</div>
              </div>
              <div style="background:#f9f7f2; border-radius:14px; padding:16px; text-align:left; font-size:14px; color:#555; margin-bottom:20px;">
                <p style="margin:0;">Tu pedido fue cancelado. No realizaste ningún pago, así que no hay reembolso pendiente.</p>
              </div>
              <p style="font-size:12px; color:#999; border-top:1px solid #eee; padding-top:20px; margin-top:10px;">
                Conforme Ley 24.240 Art. 34 — Derecho de Revocación<br>
                <strong>Córcega Café</strong>
              </p>
            </div>
          `
        }).catch(err => logger.error("Error mail arrepentimiento sin pago:", err));

        // Mail al admin
        await transporter.sendMail({
          from: `Córcega Café <${emailUser.value()}>`,
          to: "emilianofilgueira@gmail.com, lemacafesrl@gmail.com",
          subject: `↩️ Cancelación sin pago ${codigo} — Pedido #${order.orderNumber}`,
          html: `
            <div style="font-family:sans-serif; max-width:500px; margin:auto; padding:24px; border:1px solid #eee; border-radius:16px;">
              <h2 style="color:#888;">Cancelación sin pago</h2>
              <table style="width:100%; font-size:14px; border-collapse:collapse;">
                <tr><td style="padding:6px 0; color:#666; width:40%;">Código</td><td><strong>${codigo}</strong></td></tr>
                <tr><td style="padding:6px 0; color:#666;">Pedido</td><td><strong>#${order.orderNumber}</strong></td></tr>
                <tr><td style="padding:6px 0; color:#666;">Cliente</td><td>${nombre}</td></tr>
                <tr><td style="padding:6px 0; color:#666;">Email</td><td>${email}</td></tr>
                <tr><td style="padding:6px 0; color:#666;">Motivo</td><td>${motivo || '—'}</td></tr>
              </table>
              <p style="margin-top:16px; font-size:12px; color:#999;">El pedido no tenía pago registrado, fue cancelado directamente.</p>
            </div>
          `
        }).catch(err => logger.error("Error mail admin sin pago:", err));

        await db.collection("logs").add({
          accion: "arrepentimiento_sin_pago",
          detalles: `Código: ${codigo} — Orden #${order.orderNumber}`,
          usuario: email,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, codigo, reembolso: 'sin_pago' });
      }

      // ══════════════════════════════════════════════════════════════════
      // CAMINO B: CON PAGO — registrar y esperar devolución física
      // El reembolso se procesa DESPUÉS cuando el admin confirma la recepción
      // ══════════════════════════════════════════════════════════════════
      await db.collection("arrepentimientos").add({
        codigo,
        orderId,
        orderNumber: order.orderNumber,
        clienteNombre: nombre,
        clienteEmail: email,
        clienteTelefono: telefono || null,
        motivo: motivo || null,
        metodoPago: order.metodoPago,
        total: order.total,
        mp_payment_id: order.mp_payment_id || null,
        estado: 'pendiente_devolucion',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      await db.collection("ordenes").doc(orderId).update({
        estado: 'pendiente_devolucion',
        arrepentimientoSolicitadoEn: admin.firestore.FieldValue.serverTimestamp(),
        motivoCancelacion: `Arrepentimiento ${codigo}`
      });

      // Mail al cliente — instrucciones de devolución
      await transporter.sendMail({
        from: `Córcega Café <${emailUser.value()}>`,
        to: email,
        subject: `📦 Solicitud registrada — necesitamos que devuelvas el producto (${codigo})`,
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b; padding:30px; border:1px solid #eee; border-radius:24px;">
            <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Córcega Café" style="max-width:120px; margin-bottom:24px;">
            <h2 style="color:#d86634; margin:0 0 8px 0;">Solicitud recibida</h2>
            <p style="color:#666; font-size:15px;">Hola <strong>${nombre}</strong>, registramos tu solicitud de cancelación del pedido <strong>#${order.orderNumber}</strong>.</p>
            <div style="background:#f0f7ff; border:1.5px solid #cce0ff; border-radius:14px; padding:16px; margin:20px 0; display:inline-block;">
              <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Código de gestión</div>
              <div style="font-size:1.3rem; font-weight:900; color:#1a4a8a; letter-spacing:0.08em;">${codigo}</div>
            </div>
            <div style="background:#fff8e1; border:1px solid #ffe082; border-radius:14px; padding:20px; text-align:left; font-size:14px; color:#5a4000; margin-bottom:20px;">
              <p style="margin:0 0 12px 0; font-weight:700; font-size:15px;">📦 Próximo paso: devolver el producto</p>
              <p style="margin:0 0 10px 0;">Para completar la cancelación necesitamos que <strong>devuelvas el producto al local</strong>.</p>
              <p style="margin:0; font-size:12px; color:#888; line-height:1.6;">Una vez que lo recibamos, procesaremos el reembolso de <strong>$${(order.total||0).toLocaleString('es-AR')}</strong> y te avisamos por este mail en 3 a 15 días hábiles.</p>
            </div>
            <p style="font-size:12px; color:#999; border-top:1px solid #eee; padding-top:20px; margin-top:10px;">
              Conforme Ley 24.240 Art. 34 — Derecho de Revocación<br>
              <strong>Córcega Café</strong>
            </p>
          </div>
        `
      }).catch(err => logger.error("Error mail arrepentimiento con pago — cliente:", err));

      // Mail al admin — acción requerida
      await transporter.sendMail({
        from: `Córcega Café <${emailUser.value()}>`,
        to: "emilianofilgueira@gmail.com, lemacafesrl@gmail.com",
        subject: `⚠️ Arrepentimiento pendiente — ${codigo} — Pedido #${order.orderNumber} ($${order.total?.toLocaleString('es-AR')})`,
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; padding:24px; border:1px solid #eee; border-radius:16px;">
            <h2 style="color:#e67e22;">🚨 Arrepentimiento — Devolución pendiente</h2>
            <p style="color:#555; font-size:14px;">El cliente solicita cancelar su pedido. <strong>Esperá la devolución física del producto antes de reembolsar.</strong></p>
            <table style="width:100%; font-size:14px; border-collapse:collapse; margin-top:16px;">
              <tr><td style="padding:6px 0; color:#666; width:40%;">Código</td><td><strong>${codigo}</strong></td></tr>
              <tr><td style="padding:6px 0; color:#666;">Pedido</td><td><strong>#${order.orderNumber}</strong></td></tr>
              <tr><td style="padding:6px 0; color:#666;">Cliente</td><td>${nombre}</td></tr>
              <tr><td style="padding:6px 0; color:#666;">Email</td><td>${email}</td></tr>
              <tr><td style="padding:6px 0; color:#666;">Teléfono</td><td>${telefono || '—'}</td></tr>
              <tr><td style="padding:6px 0; color:#666;">Total</td><td><strong>$${order.total?.toLocaleString('es-AR')}</strong></td></tr>
              <tr><td style="padding:6px 0; color:#666;">Método de pago</td><td>${order.metodoPago}</td></tr>
              <tr><td style="padding:6px 0; color:#666;">Motivo</td><td>${motivo || '—'}</td></tr>
            </table>
            <div style="margin-top:20px; padding:14px; background:#fff8e1; border-radius:12px; border:1px solid #ffe082; font-size:13px; color:#7a5000;">
              <strong>Acción requerida:</strong> Cuando el cliente traiga el producto al local, confirmá la devolución desde el panel de administración para procesar el reembolso.
            </div>
          </div>
        `
      }).catch(err => logger.error("Error mail admin con pago:", err));

      await db.collection("logs").add({
        accion: "arrepentimiento_pendiente_devolucion",
        detalles: `Código: ${codigo} — Orden #${order.orderNumber} — Pago: ${order.metodoPago}`,
        usuario: email,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ success: true, codigo, reembolso: 'pendiente_devolucion' });
    });
  }
);

// ─── PROCESAR DEVOLUCIÓN (admin confirma recepción del producto y dispara reembolso) ─────
exports.procesarDevolucion = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass, mpAccessToken] },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!await verificarAuthAdmin(req, res)) return;

      const { arrepentimientoId } = req.body;
      if (!arrepentimientoId) {
        return res.status(400).json({ error: "Falta arrepentimientoId" });
      }

      const arrepDoc = await db.collection("arrepentimientos").doc(arrepentimientoId).get();
      if (!arrepDoc.exists) {
        return res.status(404).json({ error: "arrepentimiento_no_encontrado" });
      }

      const arrep = arrepDoc.data();

      if (arrep.estado !== 'pendiente_devolucion') {
        return res.status(400).json({ error: "estado_invalido", estado: arrep.estado });
      }

      const { orderId, mp_payment_id, metodoPago, codigo, orderNumber,
              clienteNombre, clienteEmail, total } = arrep;

      // Procesar reembolso MP si aplica
      let reembolsoEstado = 'sin_pago';
      if (metodoPago === 'mercadopago' && mp_payment_id) {
        try {
          const { MercadoPagoConfig, PaymentRefund } = require("mercadopago");
          const mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken.value() });
          const refundClient = new PaymentRefund(mpClient);
          await refundClient.create({ payment_id: String(mp_payment_id), body: {} });
          reembolsoEstado = 'procesado';
          logger.info(`Reembolso MP procesado — arrepentimiento ${codigo} (pago ${mp_payment_id})`);
        } catch (mpErr) {
          logger.error(`Error reembolso MP — arrepentimiento ${codigo}:`, mpErr);
          return res.status(500).json({ error: "reembolso_fallido", message: mpErr.message });
        }
      } else if (metodoPago === 'transferencia') {
        reembolsoEstado = 'manual';
      }

      // Cancelar la orden
      await db.collection("ordenes").doc(orderId).update({
        estado: 'cancelado',
        canceladoEn: admin.firestore.FieldValue.serverTimestamp()
      });

      // Actualizar el arrepentimiento
      const nuevoEstadoArrep = reembolsoEstado === 'procesado'
        ? 'reembolso_procesado'
        : reembolsoEstado === 'manual'
        ? 'reembolso_manual_pendiente'
        : 'cancelado_sin_pago';

      await arrepDoc.ref.update({
        estado: nuevoEstadoArrep,
        procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
        reembolso_mp: reembolsoEstado === 'procesado'
      });

      // Mail de confirmación al cliente
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: emailUser.value(), pass: emailPass.value() }
      });

      const reembolsoMsgCliente = reembolsoEstado === 'procesado'
        ? `<p style="margin:0;">💳 El <strong>reembolso fue procesado</strong> en Mercado Pago. El dinero aparece en tu cuenta en 3 a 15 días hábiles según tu banco o billetera virtual.</p>`
        : reembolsoEstado === 'manual'
        ? `<p style="margin:0;">🏦 Pagaste por transferencia. Nos comunicaremos con vos dentro de las 24 hs para coordinar la devolución del dinero.</p>`
        : `<p style="margin:0;">Tu pedido fue cancelado. Si tenés dudas, contactanos por WhatsApp.</p>`;

      await transporter.sendMail({
        from: `Córcega Café <${emailUser.value()}>`,
        to: clienteEmail,
        subject: `✅ Devolución confirmada — ${codigo}`,
        html: `
          <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b; padding:30px; border:1px solid #eee; border-radius:24px;">
            <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png" alt="Córcega Café" style="max-width:120px; margin-bottom:24px;">
            <h2 style="color:#25a244; margin:0 0 8px 0;">¡Devolución recibida!</h2>
            <p style="color:#666; font-size:15px;">Hola <strong>${clienteNombre}</strong>, recibimos el producto del pedido <strong>#${orderNumber}</strong>.</p>
            <div style="background:#f0f7ff; border:1.5px solid #cce0ff; border-radius:14px; padding:16px; margin:20px 0; display:inline-block;">
              <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Código de gestión</div>
              <div style="font-size:1.3rem; font-weight:900; color:#1a4a8a; letter-spacing:0.08em;">${codigo}</div>
            </div>
            <div style="background:#f0fff4; border:1px solid #b7f5c5; border-radius:14px; padding:16px; text-align:left; font-size:14px; color:#1a4d2e; margin-bottom:20px;">
              ${reembolsoMsgCliente}
            </div>
            <p style="font-size:12px; color:#999; border-top:1px solid #eee; padding-top:20px; margin-top:10px;">
              Conforme Ley 24.240 Art. 34 — Derecho de Revocación<br>
              <strong>Córcega Café</strong>
            </p>
          </div>
        `
      }).catch(err => logger.error("Error mail confirmación devolución:", err));

      await db.collection("logs").add({
        accion: "devolucion_procesada",
        detalles: `Código: ${codigo} — Orden #${orderNumber} — Reembolso: ${reembolsoEstado}`,
        usuario: "admin",
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ success: true, reembolso: reembolsoEstado });
    });
  }
);

// ─── CLARUS HUB — helpers de integración ─────────────────────────────────────

async function notifyClarusHub(orderId, orderData) {
  const endpoint = CLARUS_ENDPOINT.value();
  const apiKey = CLARUS_API_KEY.value();
  if (!endpoint || !apiKey) {
    logger.warn('ClarusHub: no configurado (CLARUS_ENDPOINT / CLARUS_API_KEY vacíos)');
    return;
  }

  const [configSnap, categoriasSnap] = await Promise.all([
    db.collection('configuracion').doc('clarus-integration').get(),
    db.collection('categorias').get(),
  ]);

  const config = configSnap.data() || {};
  const categorias = {};
  categoriasSnap.docs.forEach(d => { categorias[d.id] = d.data(); });

  const metodoPago = orderData.metodoPago || 'mercadopago';
  const accountId = config.pagos?.[metodoPago]?.clarusAccountId;
  if (!accountId) {
    logger.warn(`ClarusHub: sin cuenta mapeada para metodoPago "${metodoPago}"`);
    return;
  }

  // Fecha de pago confirmada desde el historial
  const pagadoEntry = (orderData.historial || []).find(h => h.estado === 'pagado');
  const paymentDate = pagadoEntry?.fecha?.toDate
    ? pagadoEntry.fecha.toDate().toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const items = [];
  for (const item of (orderData.items || [])) {
    const categoriaId = item.categoria || '';
    const catDoc = categorias[categoriaId];
    const clarusCategoryId = catDoc?.clarusCategoryId;
    if (!clarusCategoryId) {
      logger.warn(`ClarusHub: sin categoría mapeada para "${categoriaId}" (ítem: ${item.nombre})`);
      continue;
    }
    items.push({
      amount: (item.precio || 0) * (item.qty || 1),
      categoryId: clarusCategoryId,
      description: `Tienda #${orderData.orderNumber} — ${item.nombre} (${orderData.cliente?.nombre || ''})`,
      externalRef: `${orderId}_${item._cartKey || item.id || item.nombre}`,
    });
  }

  if (!items.length) {
    logger.warn(`ClarusHub: ningún ítem con categoría mapeada para orden ${orderId}`);
    return;
  }

  const resp = await fetch(`${endpoint}/receiveExternalIncome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      items,
      accountId,
      date: paymentDate,
      orderId,
      orderNumber: orderData.orderNumber || '',
      clientName: orderData.cliente?.nombre || '',
    }),
  });

  const result = await resp.json();
  if (!result.success) throw new Error(result.error || 'ClarusHub receiveExternalIncome falló');
  logger.info(`ClarusHub: ${result.transactionIds?.length || 0} transacciones creadas para orden ${orderId}`);
}

async function reverseClarusHub(orderId, orderData) {
  const endpoint = CLARUS_ENDPOINT.value();
  const apiKey = CLARUS_API_KEY.value();
  if (!endpoint || !apiKey) return;

  const resp = await fetch(`${endpoint}/reverseExternalIncome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      orderId,
      reason: `Cancelación pedido #${orderData.orderNumber || orderId}`,
    }),
  });

  const result = await resp.json();
  logger.info(`ClarusHub: ${result.reversedCount || 0} reversales para orden ${orderId}`);
}

// Proxy para el panel admin — llama a getClarusConfig de ClarusHub sin exponer la key al browser
exports.getClarusConfigProxy = onRequest(
  { region: 'us-central1', secrets: [CLARUS_API_KEY, CLARUS_ENDPOINT] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const authed = await verificarAuthAdmin(req, res);
      if (!authed) return;

      const endpoint = CLARUS_ENDPOINT.value();
      const apiKey = CLARUS_API_KEY.value();
      if (!endpoint || !apiKey) {
        return res.status(503).json({ error: 'ClarusHub no configurado' });
      }

      try {
        const r = await fetch(`${endpoint}/getClarusConfig`, {
          headers: { 'x-api-key': apiKey },
        });
        if (!r.ok) return res.status(502).json({ error: 'ClarusHub no respondió' });
        res.json(await r.json());
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }
);

// Reenvío manual de una orden a ClarusHub (o de todas las no sincronizadas)
exports.reenviarAClarusHub = onRequest(
  { region: 'us-central1', secrets: [CLARUS_API_KEY, CLARUS_ENDPOINT] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const authed = await verificarAuthAdmin(req, res);
      if (!authed) return;

      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: 'orderId requerido' });

      const orderRef = db.collection('ordenes').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return res.status(404).json({ error: 'Orden no encontrada' });

      const orderData = orderSnap.data();
      // Permitir reenvío si la orden alguna vez estuvo pagada (puede estar en entregado, etc.)
      const fuePagado = orderData.estado === 'pagado' ||
        (orderData.historial || []).some(h => h.estado === 'pagado');
      if (!fuePagado) {
        return res.status(400).json({ error: 'La orden nunca fue pagada' });
      }

      try {
        await orderRef.update({ clarusStatus: 'pending', clarusError: null });
        await notifyClarusHub(orderId, orderData);
        await orderRef.update({ clarusStatus: 'synced', clarusError: null });
        res.json({ ok: true });
      } catch (e) {
        await orderRef.update({ clarusStatus: 'failed', clarusError: e.message });
        res.status(500).json({ error: e.message });
      }
    });
  }
);

// ─── STOCKOS — proxy para no exponer la API key en el frontend ───────────────
exports.getStockosPrice = onRequest(
  { region: "us-central1", secrets: [STOCKOS_API_KEY] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const authed = await verificarAuthAdmin(req, res);
      if (!authed) return;

      const recipeId = req.query.recipeId || req.body?.recipeId || null;
      const tipo     = req.query.tipo     || null; // 'final' | 'promo' | 'all'
      const apiKey   = STOCKOS_API_KEY.value();

      try {
        if (recipeId) {
          const r = await fetch(
            `https://apigetrecipe-pw75n3yyma-uc.a.run.app?id=${encodeURIComponent(recipeId)}`,
            { headers: { "x-api-key": apiKey } }
          );
          if (!r.ok) { res.status(502).json({ ok: false, error: "StockOS no respondió." }); return; }
          res.json(await r.json());
        } else {
          const stockosUrl = new URL("https://apigetrecipes-pw75n3yyma-uc.a.run.app");
          if (tipo) stockosUrl.searchParams.set('tipo', tipo);
          const r = await fetch(stockosUrl.toString(), { headers: { "x-api-key": apiKey } });
          if (!r.ok) { res.status(502).json({ ok: false, error: "StockOS no respondió." }); return; }
          res.json(await r.json());
        }
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  }
);

// Sincronización masiva de todos los socios a Zoho Campaigns
exports.sincronizarSociosZoho = onRequest(
  { region: "us-central1", secrets: [ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET, TELEGRAM_BOT_TOKEN], timeoutSeconds: 540 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const autorizado = await verificarAuthAdmin(req, res);
    if (!autorizado) return;

    logger.info("Zoho sync: auth ok, leyendo clientes...");
    const { emailPrueba, loteIndex = 0, loteSize = 100 } = req.body;
    const snapshot = await db.collection("clientes").get();
    let contactos = snapshot.docs.map(doc => ({ dni: doc.id, ...doc.data() }));
    if (emailPrueba) {
      contactos = contactos.filter(c => c.email === emailPrueba);
      logger.info(`Zoho sync: modo prueba para ${emailPrueba}`);
    }
    const totalGlobal = contactos.length;
    const lote = contactos.slice(loteIndex * loteSize, (loteIndex + 1) * loteSize);
    const hasMore = (loteIndex + 1) * loteSize < totalGlobal;
    logger.info(`Zoho sync: lote ${loteIndex} — ${lote.length} de ${totalGlobal} clientes`);

    const { sincronizarTodosAZohoCampaigns } = require("./campaigns");
    const resultado = await sincronizarTodosAZohoCampaigns(lote, {
      clientId: ZOHO_CAMPAIGNS_CLIENT_ID.value(),
      clientSecret: ZOHO_CAMPAIGNS_CLIENT_SECRET.value(),
      refreshToken: ZOHO_CAMPAIGNS_REFRESH_TOKEN.value(),
    });

    logger.info("Zoho sync lote resultado:", JSON.stringify(resultado));

    const desde = loteIndex * loteSize + 1;
    const hasta = Math.min((loteIndex + 1) * loteSize, totalGlobal);
    let msg = `📣 Zoho sync lote ${loteIndex + 1}\n${desde}-${hasta} de ${totalGlobal}\n✅ ${resultado.ok} ok · ❌ ${resultado.errores} errores · ⚠️ ${resultado.sinEmail} sin email`;
    if (resultado.listaErrores?.length) {
      msg += `\n\nErrores:\n` + resultado.listaErrores.map(e => `• ${e.email}`).join('\n');
    }
    if (resultado.listaSinEmail?.length) {
      msg += `\n\nSin email:\n` + resultado.listaSinEmail.join(', ');
    }
    if (!hasMore) msg += '\n\n🏁 Sync completo!';
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN.value()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
      });
    } catch (tgErr) {
      logger.warn("Telegram notify failed:", tgErr.message);
    }

    res.json({ ...resultado, totalGlobal, loteIndex, hasMore });
  }
);

// Sync automático a Zoho Campaigns cuando se actualiza un cliente
exports.onClienteCreated = onDocumentCreated(
  { document: "clientes/{dni}", secrets: [ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET] },
  async (event) => {
    const data = event.data.data();
    if (!data.email) return;
    logger.info(`Zoho sync (nuevo cliente): ${data.email} (DNI ${event.params.dni})`);
    try {
      await agregarAZohoCampaigns(
        { ...data, dni: event.params.dni },
        {
          clientId: ZOHO_CAMPAIGNS_CLIENT_ID.value(),
          clientSecret: ZOHO_CAMPAIGNS_CLIENT_SECRET.value(),
          refreshToken: ZOHO_CAMPAIGNS_REFRESH_TOKEN.value(),
        }
      );
      logger.info(`Zoho sync ok (nuevo): ${data.email}`);
    } catch (e) {
      logger.warn("Zoho sync on create error:", e.message);
    }
  }
);

exports.onClienteUpdated = onDocumentUpdated(
  { document: "clientes/{dni}", secrets: [ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET] },
  async (event) => {
    const data = event.data.after.data();
    if (!data.email) return;
    logger.info(`Zoho sync trigger: ${data.email} (DNI ${event.params.dni})`);
    try {
      await agregarAZohoCampaigns(
        { ...data, dni: event.params.dni },
        {
          clientId: ZOHO_CAMPAIGNS_CLIENT_ID.value(),
          clientSecret: ZOHO_CAMPAIGNS_CLIENT_SECRET.value(),
          refreshToken: ZOHO_CAMPAIGNS_REFRESH_TOKEN.value(),
        }
      );
      logger.info(`Zoho sync ok: ${data.email}`);
    } catch (e) {
      logger.warn("Zoho sync on update error:", e.message);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// REVIEWS GOOGLE — AGENTE IA (Claude)
// Fase 2: generación de respuestas con manual de marca + análisis de reviews.
// Fase 3 conectará la colección "google_reviews" con la Business Profile API.
// ═══════════════════════════════════════════════════════════════════════════

const Anthropic = require("@anthropic-ai/sdk");
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GBP_CLIENT_ID = defineSecret("GBP_CLIENT_ID");
const GBP_CLIENT_SECRET = defineSecret("GBP_CLIENT_SECRET");
const GBP_REFRESH_TOKEN = defineSecret("GBP_REFRESH_TOKEN");

const REVIEWS_MODEL = "claude-opus-4-8";
const REVIEWS_NOTIFY = ["emilianofilgueira@gmail.com", "lemacafesrl@gmail.com"];

// Identidad verbal extraída del manual de marca de Córcega.
// Puede sobreescribirse sin deploy editando el doc Firestore config/manual_marca (campo "texto").
const MANUAL_MARCA_DEFAULT = `IDENTIDAD DE MARCA — CÓRCEGA, REBELDÍA CAFETERA
Córcega es una cafetería de especialidad inspirada en una isla salvaje y paradisíaca.
Su símbolo es el caballo corso que corre por costas vírgenes hacia un norte claro: la libertad.
Promesa: café de especialidad cuidadosamente seleccionado y tostado, pastelería fresca y casera,
brunch y almuerzos, servido por un equipo cálido, conversador, presente y atento.
Tagline: "Rebeldía Cafetera" — somos rebeldes con una gran causa: la cafetera.

VOZ DE MARCA: desinhibida, espontánea y alegre. Habla SIEMPRE en primera persona del plural
(nosotros), representando a un colectivo que busca contagiar su rebeldía cafetera.
TONO: de bienvenida y de arenga, aguerrido y valiente, buscando adhesión entre los futuros fieles.
ATRIBUTOS: sociable, curiosa, despreocupada, cálida, botánica.
LÉXICO DE MARCA (usar con naturalidad, nunca forzado): rebeldía cafetera, reglas propias,
bandera, conquista, valentía, honestidad, caballo corso, libertad, mar, isla, costa, orilla.
REGISTRO: español rioplatense (vos / ustedes).`;

const REGLAS_RESPUESTA = `
REGLAS PARA RESPONDER RESEÑAS DE GOOGLE:
1. Saludá a la persona por su primer nombre.
2. Reseñas positivas (4-5 estrellas): agradecé con alegría, mencioná algo ESPECÍFICO de su reseña,
   invitala a volver. Podés usar 0 a 2 emojis.
3. Reseñas neutras (3 estrellas): agradecé y reconocé el punto de mejora con honestidad.
4. Reseñas negativas (1-2 estrellas): tono sobrio y empático, SIN emojis festivos.
   Disculpas honestas y sin excusas, reconociendo el problema puntual. Invitá a seguir la
   conversación por mensaje directo de Instagram @corcegacafe.
   NUNCA prometas reembolsos, regalos ni compensaciones.
5. Nunca discutas con el cliente ni culpes al equipo o a otros clientes.
6. Nunca inventes datos (horarios, precios, promociones, direcciones).
7. Máximo 60 palabras.
Respondé ÚNICAMENTE con el texto de la respuesta, sin comillas ni explicaciones.`;

const getManualMarca = async () => {
  try {
    const snap = await db.doc("config/manual_marca").get();
    if (snap.exists && snap.data().texto) return snap.data().texto;
  } catch (e) {
    logger.warn("No se pudo leer config/manual_marca, uso default:", e.message);
  }
  return MANUAL_MARCA_DEFAULT;
};

const generarBorradorReview = async (apiKey, manual, review, previas = []) => {
  const client = new Anthropic({ apiKey });
  let pedido = `Escribí la respuesta oficial de Córcega a esta reseña de Google:\n` +
    `Autor: ${review.autor}\nEstrellas: ${review.rating} de 5\nReseña: "${review.texto}"`;
  if (previas.length) {
    pedido += `\n\nYa se generaron estas versiones; escribí una alternativa DISTINTA en enfoque o tono:\n` +
      previas.map((p, i) => `${i + 1}. ${p}`).join("\n");
  }
  const response = await client.messages.create({
    model: REVIEWS_MODEL,
    max_tokens: 600,
    system: manual + "\n" + REGLAS_RESPUESTA,
    messages: [{ role: "user", content: pedido }],
  });
  const texto = response.content.find((b) => b.type === "text")?.text?.trim();
  if (!texto) throw new Error("Claude no devolvió texto");
  return texto;
};

// Genera (o regenera) la respuesta sugerida para una review. La llama el admin.
exports.generarRespuestaReview = onRequest(
  { region: "us-central1", secrets: [ANTHROPIC_API_KEY] },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!(await verificarAuthAdmin(req, res))) return;
      const { autor, rating, texto, previas } = req.body || {};
      if (!autor || !rating || !texto) {
        res.status(400).json({ error: "Faltan datos de la review (autor, rating, texto)." });
        return;
      }
      try {
        const manual = await getManualMarca();
        const respuesta = await generarBorradorReview(
          ANTHROPIC_API_KEY.value(), manual,
          { autor, rating, texto },
          Array.isArray(previas) ? previas.slice(0, 5) : []
        );
        res.json({ respuesta });
      } catch (e) {
        logger.error("generarRespuestaReview:", e);
        res.status(500).json({ error: "No se pudo generar la respuesta." });
      }
    });
  }
);

// Analiza un lote de reviews: ventajas, desventajas y citas. La llama el admin
// (Fase 2 le manda las reviews; en Fase 3 podrá leer "google_reviews" si no recibe lote).
exports.analizarReviews = onRequest(
  { region: "us-central1", secrets: [ANTHROPIC_API_KEY] },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!(await verificarAuthAdmin(req, res))) return;
      let reviews = Array.isArray(req.body?.reviews) ? req.body.reviews : null;
      if (!reviews) {
        const snap = await db.collection("google_reviews").orderBy("fecha", "desc").limit(200).get();
        reviews = snap.docs.map((d) => d.data());
      }
      if (!reviews.length) {
        res.status(400).json({ error: "No hay reviews para analizar." });
        return;
      }
      try {
        const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
        const itemSchema = {
          type: "object",
          properties: {
            tema: { type: "string" },
            menciones: { type: "integer" },
            cita: { type: "string", description: "Cita textual breve de una reseña que ilustra el tema" },
          },
          required: ["tema", "menciones", "cita"],
          additionalProperties: false,
        };
        const response = await client.messages.create({
          model: REVIEWS_MODEL,
          max_tokens: 4000,
          thinking: { type: "adaptive" },
          system: "Sos un analista de experiencia de cliente para Córcega Café (cafetería de especialidad). " +
            "Analizá las reseñas de Google y extraé los temas recurrentes, positivos y negativos, " +
            "ordenados por cantidad de menciones. Escribí los temas en español rioplatense.",
          messages: [{
            role: "user",
            content: "Reseñas a analizar (JSON):\n" + JSON.stringify(
              reviews.map((r) => ({ rating: r.rating, texto: r.texto, fecha: r.fecha }))
            ),
          }],
          output_config: {
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  ventajas: { type: "array", items: itemSchema },
                  desventajas: { type: "array", items: itemSchema },
                },
                required: ["ventajas", "desventajas"],
                additionalProperties: false,
              },
            },
          },
        });
        const texto = response.content.find((b) => b.type === "text")?.text;
        const analisis = JSON.parse(texto);
        await db.doc("config/reviews_insights").set({
          ...analisis,
          totalReviews: reviews.length,
          generadoEl: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json(analisis);
      } catch (e) {
        logger.error("analizarReviews:", e);
        res.status(500).json({ error: "No se pudo analizar las reviews." });
      }
    });
  }
);

// Agente programado: cada 6 horas busca reviews sin responder y sin borrador,
// genera la respuesta sugerida y avisa por mail. Hasta que la Fase 3 sincronice
// "google_reviews" desde la Business Profile API, la colección estará vacía y sale sin hacer nada.
exports.agenteReviews = onSchedule(
  { schedule: "every 6 hours", region: "us-central1", secrets: [ANTHROPIC_API_KEY, emailUser, emailPass] },
  async () => {
    const snap = await db.collection("google_reviews")
      .where("respondida", "==", false).limit(50).get();
    const pendientes = snap.docs.filter((d) => !d.data().borrador);
    if (!pendientes.length) {
      logger.info("agenteReviews: sin reviews pendientes de borrador.");
      return;
    }

    const manual = await getManualMarca();
    const generadas = [];
    for (const doc of pendientes.slice(0, 10)) {
      const r = doc.data();
      try {
        const borrador = await generarBorradorReview(ANTHROPIC_API_KEY.value(), manual, r);
        await doc.ref.update({
          borrador,
          borradorGeneradoEl: admin.firestore.FieldValue.serverTimestamp(),
        });
        generadas.push({ ...r, borrador });
      } catch (e) {
        logger.error(`agenteReviews: falló review ${doc.id}:`, e.message);
      }
    }
    if (!generadas.length) return;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser.value(), pass: emailPass.value() },
    });
    const filas = generadas.map((g) =>
      `<li style="margin-bottom:14px;"><strong>${g.autor}</strong> (${g.rating}★): "${(g.texto || "").slice(0, 120)}..."<br>
       <em style="color:#2d6a4f;">Respuesta sugerida: ${g.borrador}</em></li>`).join("");
    await transporter.sendMail({
      from: `Agente de Reviews Córcega <${emailUser.value()}>`,
      to: REVIEWS_NOTIFY.join(","),
      subject: `🤖 ${generadas.length} respuesta(s) de reviews listas para aprobar`,
      html: `<div style="font-family:sans-serif; max-width:560px; margin:auto; color:#2b2b2b;">
        <h2>☕ El agente preparó ${generadas.length} respuesta(s)</h2>
        <ul style="padding-left:18px;">${filas}</ul>
        <p><a href="https://corcegacafe.com.ar/admin-new.html#reviews" style="display:inline-block; padding:12px 24px; background:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">Revisar y publicar</a></p>
      </div>`,
    });
    logger.info(`agenteReviews: ${generadas.length} borradores generados y notificados.`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GBP REVIEWS — Sincronización y publicación de respuestas
// ─────────────────────────────────────────────────────────────────────────────

const getGbpAccessToken = (clientId, clientSecret, refreshToken) =>
  new Promise((resolve, reject) => {
    const body = querystring.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error("GBP token error: " + JSON.stringify(json)));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

const gbpGet = (hostname, path, token) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

const gbpPut = (hostname, path, token, payload) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname,
        path,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

// Lee el locationName de Firestore config o lo descubre automáticamente desde la API
const getLocationName = async (token) => {
  const cfgSnap = await db.doc("config/gbp_config").get();
  if (cfgSnap.exists && cfgSnap.data().locationName) return cfgSnap.data().locationName;

  const acctRes = await gbpGet("mybusinessaccountmanagement.googleapis.com", "/v1/accounts", token);
  if (!acctRes.body.accounts?.length) throw new Error("No GBP accounts found");
  const accountName = acctRes.body.accounts[0].name;

  const locRes = await gbpGet(
    "mybusinessbusinessinformation.googleapis.com",
    `/v1/${accountName}/locations?readMask=name,title&pageSize=100`,
    token
  );
  const locations = locRes.body.locations || [];
  if (!locations.length) throw new Error("No GBP locations found");
  const corcega = locations.find((l) => l.title && /c[oó]rcega/i.test(l.title)) || locations[0];
  const locationName = corcega.name;
  await db.doc("config/gbp_config").set({ accountName, locationName, title: corcega.title || "" }, { merge: true });
  logger.info(`GBP location descubierta: ${locationName}`);
  return locationName;
};

const STAR_MAP = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

const mapReview = (rev) => ({
  reviewId: rev.name.split("/").pop(),
  reviewName: rev.name,
  autor: rev.reviewer?.displayName || "Anónimo",
  rating: STAR_MAP[rev.starRating] ?? 0,
  texto: rev.comment || "",
  fecha: rev.createTime ? rev.createTime.split("T")[0] : "",
  updateTime: rev.updateTime || rev.createTime || "",
  respondida: !!rev.reviewReply?.comment,
  respuesta: rev.reviewReply?.comment || null,
  sincronizadoEl: admin.firestore.FieldValue.serverTimestamp(),
});

// Sincroniza reviews GBP → Firestore (llamado manual desde el admin)
exports.sincronizarReviews = onRequest(
  { region: "us-central1", secrets: [GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN] },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!(await verificarAuthAdmin(req, res))) return;
      try {
        const token = await getGbpAccessToken(
          GBP_CLIENT_ID.value(), GBP_CLIENT_SECRET.value(), GBP_REFRESH_TOKEN.value()
        );
        const locationName = await getLocationName(token);
        const revRes = await gbpGet(
          "mybusinessreviews.googleapis.com",
          `/v1/${locationName}/reviews?pageSize=50&orderBy=updateTime+desc`,
          token
        );
        const reviews = revRes.body.reviews || [];
        logger.info(`sincronizarReviews: ${reviews.length} reviews traídas`);

        const batch = db.batch();
        let nuevas = 0;
        for (const rev of reviews) {
          const data = mapReview(rev);
          const docRef = db.collection("google_reviews").doc(data.reviewId);
          const existe = await docRef.get();
          if (!existe.exists) nuevas++;
          batch.set(docRef, data, { merge: true });
        }
        await batch.commit();
        res.json({ ok: true, total: reviews.length, nuevas });
      } catch (e) {
        logger.error("sincronizarReviews:", e);
        res.status(500).json({ error: e.message });
      }
    });
  }
);

// Sincronización programada cada 2 horas
exports.sincronizarReviewsScheduled = onSchedule(
  { schedule: "every 2 hours", region: "us-central1", secrets: [GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN] },
  async () => {
    try {
      const token = await getGbpAccessToken(
        GBP_CLIENT_ID.value(), GBP_CLIENT_SECRET.value(), GBP_REFRESH_TOKEN.value()
      );
      const locationName = await getLocationName(token);
      const revRes = await gbpGet(
        "mybusinessreviews.googleapis.com",
        `/v1/${locationName}/reviews?pageSize=50&orderBy=updateTime+desc`,
        token
      );
      const reviews = revRes.body.reviews || [];
      const batch = db.batch();
      let nuevas = 0;
      for (const rev of reviews) {
        const data = mapReview(rev);
        const docRef = db.collection("google_reviews").doc(data.reviewId);
        const existe = await docRef.get();
        if (!existe.exists) nuevas++;
        batch.set(docRef, data, { merge: true });
      }
      await batch.commit();
      logger.info(`sincronizarReviewsScheduled: ${reviews.length} reviews, ${nuevas} nuevas`);
    } catch (e) {
      logger.error("sincronizarReviewsScheduled:", e);
    }
  }
);

// Publica una respuesta en Google Business Profile y actualiza Firestore
exports.publicarRespuesta = onRequest(
  { region: "us-central1", secrets: [GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN] },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (!(await verificarAuthAdmin(req, res))) return;
      const { reviewId, texto } = req.body || {};
      if (!reviewId || !texto?.trim()) {
        res.status(400).json({ error: "Faltan reviewId o texto" });
        return;
      }
      try {
        const token = await getGbpAccessToken(
          GBP_CLIENT_ID.value(), GBP_CLIENT_SECRET.value(), GBP_REFRESH_TOKEN.value()
        );
        const docRef = db.collection("google_reviews").doc(reviewId);
        const snap = await docRef.get();
        if (!snap.exists) { res.status(404).json({ error: "Review no encontrada" }); return; }

        const gbpRes = await gbpPut(
          "mybusinessreviews.googleapis.com",
          `/v1/${snap.data().reviewName}/reply`,
          token,
          { comment: texto.trim() }
        );
        if (gbpRes.status !== 200) {
          logger.error("publicarRespuesta GBP error:", gbpRes.body);
          res.status(502).json({ error: "GBP API error", detail: gbpRes.body });
          return;
        }
        await docRef.update({
          respondida: true,
          respuesta: texto.trim(),
          respondidaEl: admin.firestore.FieldValue.serverTimestamp(),
          borrador: admin.firestore.FieldValue.delete(),
        });
        res.json({ ok: true });
      } catch (e) {
        logger.error("publicarRespuesta:", e);
        res.status(500).json({ error: e.message });
      }
    });
  }
);

// Sitemap dinámico — genera XML con todos los productos activos de Firestore
exports.sitemapXml = onRequest({ region: "us-central1" }, async (req, res) => {
  const snap = await db.collection("productos").where("activo", "==", true).get();
  const base = "https://corcegacafe.com.ar";
  const hoy = new Date().toISOString().split("T")[0];
  const urls = [
    `  <url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${base}/tienda.html</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...snap.docs.map((d) => `  <url><loc>${base}/producto.html?id=${d.id}</loc><lastmod>${hoy}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
  ];
  res.set("Content-Type", "application/xml");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
});

// ZeptoMail — infraestructura nueva (no reemplaza Gmail todavía)
const zeptoFunctions = require("./zepto-functions");
exports.testZeptoMail = zeptoFunctions.testZeptoMail;
