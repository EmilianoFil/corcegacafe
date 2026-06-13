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

async function agregarAZohoCampaigns(email, nombre, dni, { clientId, clientSecret, refreshToken }) {
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  const contactinfo = JSON.stringify({ "Contact Email": email, "First Name": nombre, "DNI": dni });

  const res = await fetch("https://campaigns.zoho.com/api/v1.1/json/listsubscribe", {
    method: "POST",
    headers: {
      "Authorization": `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      listkey: LIST_KEY,
      contactinfo,
      source: "Firebase",
    }),
  });

  const data = await res.json();
  if (data.status !== "success") throw new Error(`Zoho Campaigns error: ${JSON.stringify(data)}`);
  return data;
}

module.exports = { agregarAZohoCampaigns };
