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
            <img src="https://emilianofil.github.io/corcegacafe/img/tarjeta-vacia.png" alt="Tarjeta de cafecitos" style="max-width:100%; margin:20px 0; border-radius:16px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">
            <a href="https://emilianofil.github.io/corcegacafe/estado.html?dni=${dni}" style="display:inline-block; padding:12px 24px; background-color:#d86634; color:white; text-decoration:none; font-weight:bold; border-radius:8px;">
              Ver mi estado
            </a>
            <p style="margin-top:30px;">Nos vemos pronto en la barra 🐎</p>
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