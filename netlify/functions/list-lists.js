// netlify/functions/list-lists.js
//
// Returns the ActiveCampaign lists in this account, for the "Send to" dropdown.
// GET /api/3/lists — documented, stable v3 endpoint.

exports.handler = async () => {
  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;

  if (!baseUrl || !apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing AC_API_URL or AC_API_KEY environment variable' }),
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/3/lists?limit=100`, {
      headers: { 'Api-Token': apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }
    const data = JSON.parse(text);
    const lists = (data.lists || []).map((l) => ({ id: l.id, name: l.name }));
    return { statusCode: 200, body: JSON.stringify({ lists }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
