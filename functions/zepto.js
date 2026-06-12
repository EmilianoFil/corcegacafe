const { SendMailClient } = require("zeptomail");

const ZEPTO_URL = "api.zeptomail.com/";

const FROM = {
  tienda: { address: "tienda@corcegacafe.com.ar", name: "Tienda | Córcega Café" },
  hola:   { address: "hola@corcegacafe.com.ar",   name: "Córcega Café" },
};

async function sendZeptoMail({ fromKey = "tienda", to, toName, subject, htmlbody, token }) {
  const client = new SendMailClient({ url: ZEPTO_URL, token });
  return client.sendMail({
    from: FROM[fromKey],
    to: [{ email_address: { address: to, name: toName || to } }],
    subject,
    htmlbody,
  });
}

module.exports = { sendZeptoMail, FROM };
