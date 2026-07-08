// netlify/functions/list-draft-campaigns.js
//
// Returns recent draft campaigns (status = 0) for the ad-insertion tool's
// search/browse list. GET /api/3/campaigns with filters + orders.

exports.handler = async (event) => {
  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;
  if (!baseUrl || !apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing AC_API_URL or AC_API_KEY' }) };
  }

  const search = (event.queryStringParameters?.search || '').toLowerCase();

  try {
    const url = `${baseUrl}/api/3/campaigns?filters[status]=0&orders[cdate]=DESC&limit=30`;
    const res = await fetch(url, { headers: { 'Api-Token': apiKey } });
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }
    const data = JSON.parse(text);
    let campaigns = (data.campaigns || []).map((c) => ({
      id: c.id,
      name: c.name,
      cdate: c.cdate,
    }));

    if (search) {
      campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(search));
    }

    return { statusCode: 200, body: JSON.stringify({ campaigns: campaigns.slice(0, 50) }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
