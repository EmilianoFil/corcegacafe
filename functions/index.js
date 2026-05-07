const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

setGlobalOptions({ region: "us-central1" });

const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const cors = require("cors");
const corsHandler = cors({ origin: true });

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

exports.enviarMailRegistro = onRequest(
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
                 <img src="${imagenUrl}" alt="Flyer" style="display:block; width:100%; border-radius:8px;">
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
  </body>
</html>`,
            };

            try {
              await transporter.sendMail(mailOptions);

              if (campanaId) {
                await db.collection("clientes").doc(target.dni).set({
                  campanasRecibidas: {
                    [campanaId]: true
                  },
                  timestamp_campanas: {
                    [campanaId]: admin.firestore.FieldValue.serverTimestamp()
                  }
                }, { merge: true });
              }

              resultados.exitosos++;
            } catch (err) {
              resultados.fallidos++;
              resultados.errores.push({ email: target.email, error: err.message });
            }
          }));
        }

        await db.collection("logs").add({
          accion: "fin_campana_personalizada",
          detalles: `Resultados${campanaId ? ' (ID: ' + campanaId + ')' : ''} - Exitosos: ${resultados.exitosos}, Fallidos: ${resultados.fallidos}`,
          usuario: adminUser,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).send(resultados);
      } catch (error) {
        logger.error("Error en mail personalizado:", error);
        res.status(500).send({ error: error.message });
      }
    });
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
          items: items.map(item => ({
            id: item.id || "prod",
            title: item.nombre,
            quantity: item.qty,
            unit_price: Number(item.precio),
            currency_id: "ARS"
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
    secrets: [emailUser, emailPass],
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

                if (pData.tieneVariantes && item.variantKey) {
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

    // 3. Preparar Detalle de Pedido para el Mail
    const itemsHtml = orderData.items.map(item => {
        const masInfoRow = (item.masInfo?.activo && item.masInfo?.texto)
            ? `<tr><td colspan="2" style="padding:0 0 12px; border-bottom:1px solid #f0f0f0;"><span style="font-size:12px;color:#888;line-height:1.5;">${item.masInfo.texto}</span></td></tr>`
            : '';
        return `
        <tr>
            <td style="padding:12px 0 ${masInfoRow ? '4px' : '0'} 0; border-bottom:${masInfoRow ? 'none' : '1px solid #f0f0f0'};">
                <span style="font-weight:bold; color:#d86634;">${item.qty}x</span> ${item.nombre}
                ${item.variantLabel ? `<span style="font-size:11px;color:#999;"> (${item.variantLabel})</span>` : ''}
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
        bcc: "emilianofilgueira@gmail.com",
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
            </div>
          </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (err) {
        logger.error(`Error enviando mail inicial para #${orderNumber}:`, err);
    }
});

exports.onOrderUpdated = onDocumentUpdated(
  {
    document: "ordenes/{orderId}",
    region: "us-central1",
    secrets: [emailUser, emailPass],
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

      // 2. Enviar Mail de Notificación
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
        default: 
            statusMsg = `Tu pedido cambió al estado: ${nuevoEstado}`;
      }

      const subject = `${emoji} ${statusMsg} - #${afterData.orderNumber || orderId.substring(0,8)}`;
      
      const itemsHtml = afterData.items.map(item => `
          <tr>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0; font-size:14px;">
                  <span style="font-weight:bold; color:#d86634;">${item.qty}x</span> ${item.nombre}
              </td>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0; text-align:right; font-size:14px;">
                  $${(item.precio * item.qty).toLocaleString('es-AR')}
              </td>
          </tr>
      `).join('');

      const mailOptions = {
        from: `Córcega Café <${emailUser.value()}>`,
        to: afterData.cliente.email,
        bcc: "emilianofilgueira@gmail.com",
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
        timestamp: data.timestamp
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