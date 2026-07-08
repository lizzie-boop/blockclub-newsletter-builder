// netlify/functions/get-campaign-ad-slots.js
//
// Given a campaign ID, finds its message and detects all ad slots marked
// with paired <!-- AD-SLOT-X-START/END --> comments, returning each slot's
// ID and a short description of what's currently in it (empty, or the
// existing house ad, etc.) so the ad tool can show a meaningful list.

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

function describeSlotContent(inner) {
  const trimmed = inner.trim();
  if (!trimmed) return 'Empty';
  if (/mailto:ads@blockclubchi\.org/i.test(trimmed) || /cbc69502-35fb-4e20-83c2-c5ab9e010862/i.test(trimmed)) {
    return 'Currently: Block Club house ad';
  }
  const advertiserMatch = trimmed.match(/<!--\s*AD-ADVERTISER:\s*(.*?)\s*-->/i);
  if (advertiserMatch) return `Currently: ad for ${advertiserMatch[1]}`;
  return 'Currently: existing content';
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
    const campaign = campaignData.campaign || campaignData;
    const messageId = campaign.message_id;

    // ActiveCampaign auto-generates a screenshot of the campaign's actual
    // rendered content. The field is sometimes a protocol-relative URL
    // (starting with "//"), so normalize it to a proper https:// URL.
    let screenshot = campaign.screenshot || null;
    if (screenshot && screenshot.startsWith('//')) {
      screenshot = `https:${screenshot}`;
    }

    if (!messageId) {
      return { statusCode: 200, body: JSON.stringify({ campaignName: campaign.name, messageId: null, slots: [], screenshot }) };
    }

    const msgData = await acGet(baseUrl, apiKey, `messages/${messageId}`);
    const html = msgData.message?.html || '';

    const slotRegex = /<!--\s*AD-SLOT-([\w-]+)-START\s*-->([\s\S]*?)<!--\s*AD-SLOT-\1-END\s*-->/g;
    const slots = [];
    let match;
    while ((match = slotRegex.exec(html)) !== null) {
      slots.push({
        slotId: match[1],
        description: describeSlotContent(match[2]),
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        campaignName: campaign.name,
        messageId,
        slots,
        screenshot,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
