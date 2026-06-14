const LIST_KEY = "3zcc33c3deabb1a59c426e38d5d16aa916fceaf17c7b01f847657597ab5eaca8e7";

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
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Argentina/Buenos_Aires",
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }).format(d); // MM/DD/YYYY en timezone Argentina
  } catch {
    return "";
  }
}

function formatDateTime(val) {
  if (!val) return "";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hh}:${min}`; // MM/DD/YYYY HH:MM
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
    "Cafecitos Invitados": Number(contacto.cafecitos_invitados || 0),
    ...(contacto.cumple_dia ? { "Cumple Dia": Number(contacto.cumple_dia) } : {}),
    ...(contacto.cumple_mes ? { "Cumple Mes": Number(contacto.cumple_mes) } : {}),
    "Cafe Disponible": contacto.cafe_disponible ? "true" : "false",
    ...(contacto.creado ? { "Creado": formatTimestamp(contacto.creado) } : {}),
  };
}

async function suscribirContacto(contacto, accessToken) {
  const contactInfo = buildContactInfo(contacto);
  console.log("[Zoho payload]", JSON.stringify(contactInfo));
  const res = await fetch("https://campaigns.zoho.com/api/v1.1/json/listsubscribe", {
    method: "POST",
    headers: {
      "Authorization": `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      listkey: LIST_KEY,
      contactinfo: JSON.stringify(contactInfo),
      source: "Firebase",
    }),
  });
  const text = await res.text();
  console.log(`[Zoho API] status=${res.status} body=${text.slice(0, 400)}`);
  // Zoho devuelve XML con <status>error</status> aun con HTTP 200
  if (text.includes("<status>error</status>")) throw new Error(text.slice(0, 300));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    const data = JSON.parse(text);
    if (data.status !== "success") throw new Error(JSON.stringify(data));
    return data;
  } catch {
    return { status: "success" };
  }
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
  const listaErrores = [], listaSinEmail = [];

  for (const contacto of contactos) {
    if (!contacto.email) {
      sinEmail++;
      listaSinEmail.push(`DNI ${contacto.dni}`);
      continue;
    }
    try {
      await suscribirContacto(contacto, accessToken);
      ok++;
    } catch (e) {
      errores++;
      listaErrores.push({ email: contacto.email, error: e.message.slice(0, 120) });
    }
    await new Promise(r => setTimeout(r, 100));
  }

  return { total: contactos.length, ok, errores, sinEmail, listaErrores, listaSinEmail };
}

module.exports = { agregarAZohoCampaigns, sincronizarTodosAZohoCampaigns };
