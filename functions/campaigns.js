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
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`; // MM/DD/YYYY — formato requerido por Zoho Date fields
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
    "Cafe Disponible": contacto.cafe_disponible ? "true" : "false",
    "Cafecitos Invitados": Number(contacto.cafecitos_invitados || 0),
    "Creado": formatDateTime(contacto.creado),
    "Cumple Dia": Number(contacto.cumple_dia || 0),
    "Cumple Mes": Number(contacto.cumple_mes || 0),
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
  const text = await res.text();
  // Zoho a veces devuelve XML en vez de JSON — si el HTTP status es 200 lo tratamos como ok
  if (res.ok) return { status: "success" };
  try {
    const data = JSON.parse(text);
    if (data.status !== "success") throw new Error(JSON.stringify(data));
    return data;
  } catch {
    throw new Error(text.slice(0, 200));
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

  for (const contacto of contactos) {
    if (!contacto.email) { sinEmail++; continue; }
    try {
      await suscribirContacto(contacto, accessToken);
      ok++;
    } catch (e) {
      if (errores === 0) console.error("Primer error Zoho:", e.message);
      errores++;
    }
    // pequeña pausa para no saturar la API
    await new Promise(r => setTimeout(r, 100));
  }

  return { total: contactos.length, ok, errores, sinEmail };
}

module.exports = { agregarAZohoCampaigns, sincronizarTodosAZohoCampaigns };
