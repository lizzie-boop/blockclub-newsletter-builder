// netlify/functions/get-template.js
//
// Diagnostic/dev tool: fetches a single template's raw HTML so we can see
// its actual structure (does it have a placeholder for content? a merge
// tag? a specific div?) before wiring up automatic content injection.
// GET /api/3/templates/:id — documented v3 endpoint.

exports.handler = async (event) => {
  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;

  if (!baseUrl || !apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing AC_API_URL or AC_API_KEY environment variable' }),
    };
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id query parameter' }) };
  }

  try {
    const res = await fetch(`${baseUrl}/api/3/templates/${encodeURIComponent(id)}`, {
      headers: { 'Api-Token': apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }
    const data = JSON.parse(text);
    return {
      statusCode: 200,
      body: JSON.stringify({
        id: data.template?.id,
        name: data.template?.name,
        content: data.template?.content || '(no content field returned)',
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
