// netlify/functions/list-templates.js
//
// Returns the "basic" (API-readable) templates in this ActiveCampaign
// account. Note: AC's drag-and-drop "Designer" templates are NOT readable
// via the API at all (per AC's own docs), so if your custom templates were
// built in the Designer, this list may come back empty even though you can
// see them in the AC dashboard. If that happens, that's the answer to the
// Designer-vs-basic question — not a bug in this function.

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
    const res = await fetch(`${baseUrl}/api/3/templates?limit=100`, {
      headers: { 'Api-Token': apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }
    const data = JSON.parse(text);
    const templates = (data.templates || []).map((t) => ({ id: t.id, name: t.name }));
    return { statusCode: 200, body: JSON.stringify({ templates }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
