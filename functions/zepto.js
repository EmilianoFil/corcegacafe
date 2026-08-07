const { SendMailClient } = require("zeptomail");

const ZEPTO_URL = "api.zeptomail.com/";

const FROM = {
  tienda: { address: "tienda@corcegacafe.com.ar", name: "Tienda | Córcega Café" },
  hola:   { address: "hola@corcegacafe.com.ar",   name: "Córcega Café" },
  club:   { address: "club@corcegacafe.com.ar",   name: "Club | Córcega Café" },
};

async function sendZeptoMail({ fromKey = "tienda", to, toName, subject, htmlbody, token }) {
  const client = new SendMailClient({ url: ZEPTO_URL, token });
  const recipients = Array.isArray(to)
    ? to.map((addr) => ({ email_address: { address: addr, name: toName || addr } }))
    : [{ email_address: { address: to, name: toName || to } }];
  return client.sendMail({
    from: FROM[fromKey],
    to: recipients,
    subject,
    htmlbody,
  });
}

module.exports = { sendZeptoMail, FROM };
