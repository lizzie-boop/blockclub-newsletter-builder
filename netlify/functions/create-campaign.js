// netlify/functions/create-campaign.js
//
// Takes a campaign name + a list of resolved stories, and:
//   1. Builds an HTML email body (simple, stacked story-preview blocks)
//   2. Creates a Message in ActiveCampaign (POST /api/3/messages) — v3, documented, stable.
//   3. Creates a draft Campaign attached to that message + your list, via
//      ActiveCampaign's v1 API (admin/api.php?api_action=campaign_create).
//
//      Why v1 for this one step: AC's v3 endpoint (POST /api/3/campaign)
//      only accepts a small whitelist of fields on creation — testing showed
//      `type`/`name` are accepted but `status`, `public`, `sdate`, and the
//      list/message association keys are all rejected as "not allowed".
//      List/message attachment for campaign creation isn't documented on v3.
//      AC's v1 API is still fully supported and has official examples for
//      exactly this operation, so campaign creation goes through v1 while
//      message creation (cleanly documented on v3) stays on v3. Both use the
//      same API URL + API key.
//
// Required environment variables (set in Netlify site settings):
//   AC_API_URL     e.g. https://youraccountname.api-us1.com
//   AC_API_KEY     Your ActiveCampaign API key
//   AC_LIST_ID     The numeric ID of the list this newsletter sends to
//   AC_FROM_NAME   e.g. "Block Club Chicago"
//   AC_FROM_EMAIL  e.g. "newsletter@blockclubchicago.org"
//   AC_REPLY_TO    e.g. "newsletter@blockclubchicago.org"

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildStoryBlockHtml(story) {
  const headline = escapeHtml(story.headline);
  const imageTag = story.image
    ? `<img src="${escapeHtml(story.image)}" alt="${headline}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border-radius:4px;margin-bottom:12px;" />`
    : '';

  return `
    <tr>
      <td style="padding:0 0 32px 0;">
        <a href="${escapeHtml(story.link)}" style="text-decoration:none;color:inherit;">
          ${imageTag}
          <h2 style="font-family:Georgia,serif;font-size:22px;line-height:1.3;margin:0 0 8px 0;color:#111;">
            ${headline}
          </h2>
        </a>
        ${story.excerpt ? `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#444;margin:0 0 8px 0;">${escapeHtml(story.excerpt)}</p>` : ''}
        <a href="${escapeHtml(story.link)}" style="font-family:Arial,sans-serif;font-size:14px;color:#1a6ee0;text-decoration:none;">Read the full story &rarr;</a>
      </td>
    </tr>
    <tr><td style="border-bottom:1px solid #e5e5e5;padding-bottom:24px;"></td></tr>
  `;
}

function buildIntroHtml(introText) {
  if (!introText) return '';
  const paragraphs = introText
    .split(/\n\s*\n/)
    .map((p) => escapeHtml(p.trim()).replace(/\n/g, '<br>'))
    .filter(Boolean);

  const paragraphHtml = paragraphs
    .map(
      (p) =>
        `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;margin:0 0 14px 0;">${p}</p>`
    )
    .join('\n');

  return `
    <tr>
      <td style="padding-bottom:20px;">
        ${paragraphHtml}
      </td>
    </tr>
  `;
}

function buildNewsletterHtml(campaignName, introText, stories) {
  const storyBlocksWithSlots = stories
    .map((story, i) => `<!-- AD-SLOT-${i} -->\n${buildStoryBlockHtml(story)}`)
    .join('\n');
  const finalSlot = `<!-- AD-SLOT-${stories.length} -->`;
  const introHtml = buildIntroHtml(introText);

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px;">
          <tr>
            <td style="padding-bottom:24px;">
              <h1 style="font-family:Georgia,serif;font-size:20px;color:#111;margin:0;">${escapeHtml(campaignName)}</h1>
            </td>
          </tr>
          ${introHtml}
          ${storyBlocksWithSlots}
          ${finalSlot}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function buildNewsletterText(campaignName, introText, stories) {
  const lines = stories.map((s) => `${s.headline}\n${s.link}\n`);
  const intro = introText ? `${introText}\n\n` : '';
  return `${campaignName}\n\n${intro}${lines.join('\n')}`;
}

async function acRequest(path, { method = 'GET', body } = {}) {
  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Missing AC_API_URL or AC_API_KEY environment variable');
  }

  const headers = { 'Api-Token': apiKey };
  let payload = body;
  if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}/api/3/${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`ActiveCampaign API error (${res.status}) on ${path}: ${text}`);
  }
  return json;
}

async function acLegacyRequest(params) {
  const baseUrl = process.env.AC_API_URL;
  const apiKey = process.env.AC_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Missing AC_API_URL or AC_API_KEY environment variable');
  }

  const url = `${baseUrl}/admin/api.php?api_action=campaign_create&api_output=json&api_key=${encodeURIComponent(apiKey)}`;
  const formBody = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`ActiveCampaign v1 API error (${res.status}) on campaign_create: ${text}`);
  }
  if (json.result_code === 0) {
    throw new Error(`ActiveCampaign v1 campaign_create failed: ${text}`);
  }
  return json;
}

function formatSdate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let campaignName, introText, stories;
  try {
    ({ campaignName, introText, stories } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!campaignName || !Array.isArray(stories) || stories.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'campaignName and a non-empty stories array are required' }),
    };
  }

  const listId = process.env.AC_LIST_ID;
  if (!listId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing AC_LIST_ID environment variable' }) };
  }

  try {
    const html = buildNewsletterHtml(campaignName, introText, stories);
    const text = buildNewsletterText(campaignName, introText, stories);

    const messageRes = await acRequest('messages', {
      method: 'POST',
      body: {
        message: {
          fromname: process.env.AC_FROM_NAME,
          fromemail: process.env.AC_FROM_EMAIL,
          reply2: process.env.AC_REPLY_TO || process.env.AC_FROM_EMAIL,
          subject: campaignName,
          html,
          text,
        },
      },
    });

    const messageId = messageRes.message?.id;
    if (!messageId) {
      throw new Error('Message created but no id returned: ' + JSON.stringify(messageRes));
    }

    const campaignRes = await acLegacyRequest({
      type: 'single',
      name: campaignName,
      status: 0,
      segmentid: 0,
      sdate: formatSdate(new Date()),
      [`p[${listId}]`]: listId,
      [`m[${messageId}]`]: 100,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        campaignName,
        messageId,
        adSlotCount: stories.length + 1,
        campaign: campaignRes,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
