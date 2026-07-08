// netlify/functions/preview-campaign.js
//
// Given a campaign ID, returns its message's raw HTML directly (as an
// actual HTML page, not JSON) so it can be embedded in an <iframe> or
// opened in a new tab for a real, live visual preview — since AC's own
// auto-generated screenshot only seems to populate for campaigns built
// through their UI, not ones created via the API.

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
    return { statusCode: 500, body: 'Missing AC_API_URL or AC_API_KEY' };
  }

  const campaignId = event.queryStringParameters?.campaignId;
  if (!campaignId) {
    return { statusCode: 400, body: 'Missing campaignId query parameter' };
  }

  try {
    const campaignData = await acGet(baseUrl, apiKey, `campaigns/${encodeURIComponent(campaignId)}`);
    const campaign = campaignData.campaign || campaignData;
    const messageId = campaign.message_id;

    if (!messageId) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: '<p>No message found for this campaign.</p>' };
    }

    const msgData = await acGet(baseUrl, apiKey, `messages/${messageId}`);
    const html = msgData.message?.html || '<p>No content found.</p>';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `<p>Could not load preview: ${err.message}</p>`,
    };
  }
};
