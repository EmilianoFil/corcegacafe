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
      const { nombre, email, dni } = req.body;

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
                  Ver mi estado
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

exports.enviarMailFelicitaciones = onRequest(
  { region: "us-central1", secrets: [emailUser, emailPass] },
  (req, res) => {
    corsHandler(req, res, async () => {
      const { nombre, email, dni } = req.body;

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

      // Solo ejecutar para este DNI de prueba
      if (dni !== "32531743") continue;

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

        const mailOptions = {
          from: `Córcega Café <${emailUser.value()}>`,
          to: email,
          subject: "¡Feliz cumpleaños! 🎂 Te regalamos un sello",
          html: `
            <div style="font-family:sans-serif; max-width:500px; margin:auto; text-align:center; color:#2b2b2b;">
              <h2>¡Feliz cumple, ${nombre}! 🎉</h2>
              <p>Hoy es tu día, y queremos regalarte un sello especial en tu tarjeta de cafecitos.</p>
              <p>Ya está activo, y se va a usar automáticamente la próxima vez que pases por el café.</p>
              <img src="https://emilianofil.github.io/corcegacafe/css/img/sello_cumpleanos.png" alt="Sello de cumpleaños" style="max-width:100px; margin:20px auto; border-radius:50%; box-shadow:0 2px 10px rgba(0,0,0,0.1);">
              <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
                Ver mi tarjeta
              </a>
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
exports.uploadMenuToGitHub = require('./upload').uploadMenuToGitHub;