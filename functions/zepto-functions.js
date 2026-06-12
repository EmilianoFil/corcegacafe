const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { sendZeptoMail } = require("./zepto");

const zeptoToken = defineSecret("ZEPTO_TOKEN");

exports.zeptoToken = zeptoToken;

exports.testZeptoMail = onRequest(
  { region: "us-central1", secrets: [zeptoToken] },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const { fromKey, to, toName } = req.body;
    if (!to) { res.status(400).json({ error: "Falta destinatario" }); return; }

    const from = ["tienda", "hola", "club"].includes(fromKey) ? fromKey : "tienda";

    try {
      await sendZeptoMail({
        fromKey: from,
        to,
        toName: toName || to,
        subject: `[TEST ZeptoMail] desde ${from}@corcegacafe.com.ar`,
        htmlbody: `
          <div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:32px 24px;">
            <img src="https://emilianofil.github.io/corcegacafe/css/img/logo-corcega-color.png"
                 alt="Córcega Café" style="max-width:100px; margin-bottom:20px;">
            <h2 style="color:#2b2b2b; margin:0 0 12px;">✅ Test ZeptoMail OK</h2>
            <p style="color:#555; line-height:1.6;">
              Este mail fue enviado desde <strong>${from}@corcegacafe.com.ar</strong>
              vía <strong>ZeptoMail API</strong>.
            </p>
            <p style="color:#555; line-height:1.6;">Si lo estás viendo, la configuración es correcta.</p>
            <hr style="border:none; border-top:1px solid #eee; margin:24px 0;">
            <p style="font-size:11px; color:#aaa;">Córcega Café — test de infraestructura de mails</p>
          </div>
        `,
        token: zeptoToken.value(),
      });
      res.json({ ok: true, from: `${from}@corcegacafe.com.ar`, to });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);
