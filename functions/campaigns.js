const LIST_KEY = "3z135620534b882fe1903ff1abc6c81fdd954ad79e244657fbb4ce76a752123c54";

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

function formatTimestamp(val) {
  if (!val) return "";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`; // MM/DD/YYYY — formato requerido por Zoho Date fields
  } catch {
    return "";
  }
}

function buildContactInfo(contacto) {
  return {
    "Contact Email": contacto.email,
    "First Name": contacto.nombre || "",
    "Phone": contacto.whatsapp || contacto.telefono || "",
    "DNI": String(contacto.dni || ""),
    "Sellos Actuales": Number(contacto.cafes || 0),
    "Cafes Acumulados Total": Number(contacto.cafes_acumulados_total || 0),
    "Ultimo Cafe": formatTimestamp(contacto.ultimo_cafe),
  };
}

async function suscribirContacto(contacto, accessToken) {
  const res = await fetch("https://campaigns.zoho.com/api/v1.1/json/listsubscribe", {
    method: "POST",
    headers: {
      "Authorization": `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      listkey: LIST_KEY,
      contactinfo: JSON.stringify(buildContactInfo(contacto)),
      source: "Firebase",
    }),
  });
  const data = await res.json();
  if (data.status !== "success") throw new Error(JSON.stringify(data));
  return data;
}

async function agregarAZohoCampaigns(contacto, credentials) {
  const { clientId, clientSecret, refreshToken } = credentials;
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  return suscribirContacto(contacto, accessToken);
}

async function sincronizarTodosAZohoCampaigns(contactos, credentials) {
  const { clientId, clientSecret, refreshToken } = credentials;
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  let ok = 0, errores = 0, sinEmail = 0;

  for (const contacto of contactos) {
    if (!contacto.email) { sinEmail++; continue; }
    try {
      await suscribirContacto(contacto, accessToken);
      ok++;
    } catch (e) {
      errores++;
    }
    // pequeña pausa para no saturar la API
    await new Promise(r => setTimeout(r, 100));
  }

  return { total: contactos.length, ok, errores, sinEmail };
}

module.exports = { agregarAZohoCampaigns, sincronizarTodosAZohoCampaigns };
