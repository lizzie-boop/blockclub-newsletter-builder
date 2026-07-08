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
    // Fetch without a status filter, then exclude only sent campaigns
    // (status 5, confirmed from real data) client-side. A strict
    // filters[status]=0 missed manually-created drafts in ActiveCampaign's
    // own UI, which appear to sit at a different in-progress status while
    // still being built, not exactly 0.
    const url = `${baseUrl}/api/3/campaigns?orders[cdate]=DESC&limit=50`;
    const res = await fetch(url, { headers: { 'Api-Token': apiKey } });
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }
    const data = JSON.parse(text);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let campaigns = (data.campaigns || [])
      .map((c) => ({
        id: c.id,
        name: c.name,
        cdate: c.cdate,
        status: c.status,
      }))
      .filter((c) => c.cdate && new Date(c.cdate) >= thirtyDaysAgo)
      .filter((c) => c.status !== '5');

    if (search) {
      campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(search));
    }

    return { statusCode: 200, body: JSON.stringify({ campaigns: campaigns.slice(0, 50) }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
