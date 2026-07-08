// netlify/functions/update-campaign-ad.js
//
// Given a campaign's message ID, a slot ID, and ad content (image, link,
// caption, advertiser name), replaces the content between that slot's
// paired <!-- AD-SLOT-X-START/END --> markers with a real ad, then saves
// the updated message back to ActiveCampaign via PUT /api/3/messages/:id.
//
// The advertiser name is stored as an HTML comment (not visible to readers)
// so it's recorded in the message source for record-keeping.

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

async function acPut(baseUrl, apiKey, path, body) {
  const res = await fetch(`${baseUrl}/api/3/${path}`, {
    method: 'PUT',
    headers: { 'Api-Token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

function buildAdBlockHtml({ image, link, captionText, advertiserName }) {
  const safeLink = /^https?:\/\//i.test(link) ? link : '#';
  return `<!-- AD-ADVERTISER: ${escapeHtml(advertiserName || 'Unknown')} -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;">
  <tr>
    <td align="center" style="padding:10px 20px;">
      <a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(captionText || advertiserName || 'Advertisement')}" style="display:block;width:100%;max-width:510px;height:auto;margin:0 auto;">
      </a>
      ${captionText ? `<p style="font-family:Arial,sans-serif;font-size:13px;color:#444;margin:8px 0 0;">${escapeHtml(captionText)}</p>` : ''}
    </td>
  </tr>
</table>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;
  if (!baseUrl || !apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing AC_API_URL or AC_API_KEY' }) };
  }

  let messageId, slotId, image, link, captionText, advertiserName;
  try {
    ({ messageId, slotId, image, link, captionText, advertiserName } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!messageId || !slotId || !image || !link) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'messageId, slotId, image, and link are required' }),
    };
  }

  try {
    const msgData = await acGet(baseUrl, apiKey, `messages/${messageId}`);
    const currentHtml = msgData.message?.html || '';

    const startMarker = `<!-- AD-SLOT-${slotId}-START -->`;
    const endMarker = `<!-- AD-SLOT-${slotId}-END -->`;
    const startIdx = currentHtml.indexOf(startMarker);
    const endIdx = currentHtml.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
      throw new Error(`Could not find slot markers for slot "${slotId}" in this message`);
    }

    const adHtml = buildAdBlockHtml({ image, link, captionText, advertiserName });
    const before = currentHtml.slice(0, startIdx + startMarker.length);
    const after = currentHtml.slice(endIdx);
    const updatedHtml = `${before}${adHtml}${after}`;

    await acPut(baseUrl, apiKey, `messages/${messageId}`, {
      message: {
        html: updatedHtml,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
