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
    const url = `${baseUrl}/api/3/campaigns?orders[id]=DESC&limit=50`;
    const res = await fetch(url, { headers: { 'Api-Token': apiKey } });
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }
    const data = JSON.parse(text);
    const rawCampaigns = data.campaigns || [];

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let campaigns = rawCampaigns
      .map((c) => ({
        id: c.id,
        name: c.name,
        cdate: c.cdate,
        status: c.status,
      }))
      .filter((c) => c.cdate && new Date(c.cdate) >= thirtyDaysAgo)
      .filter((c) => c.status !== '5');

    // TEMPORARY DEBUG INFO — remove once the filtering issue is sorted out.
    const debug = {
      totalRawCampaigns: rawCampaigns.length,
      sampleRaw: rawCampaigns.slice(0, 10).map((c) => ({
        name: c.name,
        status: c.status,
        cdate: c.cdate,
      })),
    };

    if (search) {
      campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(search));
    }

    return { statusCode: 200, body: JSON.stringify({ campaigns: campaigns.slice(0, 50), debug }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
