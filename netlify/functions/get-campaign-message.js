// netlify/functions/get-campaign-message.js
//
// Diagnostic tool: given a campaign ID, find its associated message(s) and
// return their raw HTML. Used to compare a normally-sent campaign's stored
// content against what we get back from the /templates/:id endpoint, to
// figure out whether the template endpoint gives an incomplete export.

async function acGet(baseUrl, apiKey, path) {
  const res = await fetch(`${baseUrl}/api/3/${path}`, {
    headers: { 'Api-Token': apiKey },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`AC API error (${res.status}) on ${path}: ${text}`);
  }
  return json;
}

exports.handler = async (event) => {
  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;
  if (!baseUrl || !apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing AC_API_URL or AC_API_KEY' }) };
  }

  const campaignId = event.queryStringParameters?.campaignId;
  if (!campaignId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing campaignId query parameter' }) };
  }

  try {
    const campaignData = await acGet(baseUrl, apiKey, `campaigns/${encodeURIComponent(campaignId)}`);

    let messagesData = null;
    let messagesError = null;
    try {
      messagesData = await acGet(baseUrl, apiKey, `campaigns/${encodeURIComponent(campaignId)}/messages`);
    } catch (err) {
      messagesError = err.message;
    }

    let fullMessages = [];
    if (messagesData?.campaignMessages) {
      for (const cm of messagesData.campaignMessages) {
        const msgId = cm.messageid || cm.message?.id;
        if (msgId) {
          try {
            const msgData = await acGet(baseUrl, apiKey, `messages/${msgId}`);
            fullMessages.push({ id: msgId, html: msgData.message?.html, text: msgData.message?.text });
          } catch (err) {
            fullMessages.push({ id: msgId, error: err.message });
          }
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        campaign: campaignData.campaign || campaignData,
        messagesRelationship: messagesData,
        messagesRelationshipError: messagesError,
        fullMessages,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
