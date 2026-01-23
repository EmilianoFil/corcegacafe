const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const cors = require("cors");
const corsHandler = cors({ origin: true });

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

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