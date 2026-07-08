// netlify/functions/create-campaign.js
//
// Takes a campaign name + a list of resolved stories, and:
//   1. Builds the newsletter HTML — either our own default design, or (if a
//      templateId is provided) merges content into one of your custom
//      ActiveCampaign templates.
//   2. Creates a Message in ActiveCampaign (POST /api/3/messages) — v3, documented, stable.
//   3. Creates a draft Campaign attached to that message + your list, via
//      ActiveCampaign's v1 API (admin/api.php?api_action=campaign_create).
//
// Required environment variables (set in Netlify site settings):
//   AC_API_URL     e.g. https://youraccountname.api-us1.com
//   AC_API_KEY     Your ActiveCampaign API key
//   AC_LIST_ID     Fallback list ID if none is selected in the dropdown
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

function truncate(str = '', maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1).trim() + '…' : str;
}

// Server-side safety net: the frontend already sends sanitized HTML (only
// <b>, <strong>, <a href="http(s)...">, <br> survive its own sanitizer), but
// we re-enforce the same allowlist here in case this endpoint is ever hit
// directly instead of through the form.
function sanitizeIntroText(html = '') {
  if (!html) return '';
  let safe = html.replace(/<(?!\/?(b|strong|a|br)\b)[^>]*>/gi, '');
  safe = safe.replace(/<a\s+([^>]*)>/gi, (match, attrs) => {
    const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"/i);
    let href = hrefMatch ? hrefMatch[1] : '';
    if (!/^https?:\/\//i.test(href)) href = '';
    return href
      ? `<a href="${href}" target="_blank" rel="noopener">`
      : '<a>';
  });
  return safe;
}

// Plain-text fallback: links become "text (URL)" since plain text can't be clickable.
function stripHtmlToText(html = '') {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/?(b|strong)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// ---------- Default built-in design (used when no template is selected) ----------

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
  const safe = sanitizeIntroText(introText);
  return `
    <tr>
      <td style="padding-bottom:20px;">
        <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;margin:0 0 14px 0;">${safe}</p>
      </td>
    </tr>
  `;
}

function buildDefaultNewsletterHtml(campaignName, introText, stories) {
  const storyBlocksWithSlots = stories
    .map((story, i) => `<!-- AD-SLOT-${i}-START --><!-- AD-SLOT-${i}-END -->\n${buildStoryBlockHtml(story)}`)
    .join('\n');
  const finalSlot = `<!-- AD-SLOT-${stories.length}-START --><!-- AD-SLOT-${stories.length}-END -->`;
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
  const intro = introText ? `${stripHtmlToText(introText)}\n\n` : '';
  return `${campaignName}\n\n${intro}${lines.join('\n')}`;
}

// ---------- Template merge (used when a templateId is provided) ----------
//
// This is tailored to the specific Block Club "neighborhood newsletter"
// template structure we inspected: a lorem-ipsum intro paragraph, a
// repeated "NEIGHBORHOOD" story block (image + headline + subhed), and a
// separate SPONSORED ad block that we leave untouched.
//
// If your other templates have a different structure, this merge logic
// will need matching adjustments — the placeholder text it looks for is
// specific to this one template.

const TEMPLATE_INTRO_LOREM =
  "Introduction here.&nbsp;Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.<br><br>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum..<br><br>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

const TEMPLATE_FILLER_HEADLINE =
  '<a target="_blank" href="fakeblockclublink.com" style="color: #000000;">This Is a Filler Headline That We Should Apply The Style Of Heading 2 To</a>';

const TEMPLATE_FILLER_SUBHED =
  '<h3>This is a filler subhed that we should apply the style of Heading 3 to.&nbsp;This is a filler subhed that we should apply the style of Heading 3 to.</h3>';

const TEMPLATE_FILLER_IMAGE_REGEX =
  /<img class="adapt-img" src="[^"]*e9a7844f-1ae1-4e33-9a93-20f590679b28[^"]*"[\s\S]*?>/g;

function mergeIntoTemplate(templateHtml, templateCss, introText, stories) {
  let html = templateHtml;

  // 1. Intro / topper — replace the lorem ipsum body, keep greeting + sign-off.
  const introReplacement = introText ? sanitizeIntroText(introText) : '';
  html = html.split(TEMPLATE_INTRO_LOREM).join(introReplacement);

  // 2. Story slots — fill in sequentially. If there are more stories than
  //    slots, extras are silently dropped here; the caller reports this.
  let headlineIdx = 0;
  html = html.split(TEMPLATE_FILLER_HEADLINE).reduce((acc, segment, i, arr) => {
    if (i === arr.length - 1) return acc + segment; // last segment, no replacement after it
    const story = stories[headlineIdx];
    headlineIdx++;
    const replacement = story
      ? `<a target="_blank" href="${escapeHtml(story.link)}" style="color: #000000;">${escapeHtml(story.headline)}</a>`
      : TEMPLATE_FILLER_HEADLINE;
    return acc + segment + replacement;
  }, '');
  const headlineSlotCount = headlineIdx;

  let subhedIdx = 0;
  html = html.split(TEMPLATE_FILLER_SUBHED).reduce((acc, segment, i, arr) => {
    if (i === arr.length - 1) return acc + segment;
    const story = stories[subhedIdx];
    subhedIdx++;
    const replacement = story
      ? `<h3>${escapeHtml(truncate(story.excerpt || '', 140))}</h3>`
      : TEMPLATE_FILLER_SUBHED;
    return acc + segment + replacement;
  }, '');

  let imageIdx = 0;
  html = html.replace(TEMPLATE_FILLER_IMAGE_REGEX, (match) => {
    const story = stories[imageIdx];
    imageIdx++;
    if (!story || !story.image) return match;
    return `<img class="adapt-img" src="${escapeHtml(story.image)}" alt="${escapeHtml(story.headline)}" style="display:block;width:100%;max-width:245px;" width="245">`;
  });

  // 4. Wrap the template's existing "SPONSORED" house-ad block (currently a
  //    self-promotional ad linking to ads@blockclubchi.org) with paired
  //    markers, so the ad-insertion tool can find and replace it with a real
  //    paid ad. If no real ad is ever inserted, the house ad stays as-is.
  //    NOTE: this matches on the "mailto:ads@blockclubchi.org" link, which
  //    appears to be consistent across Block Club's templates — verify this
  //    holds if a template doesn't use that exact address.
  let templateAdIdx = 0;
  const TEMPLATE_AD_BLOCK_REGEX = /<a[^>]*href="mailto:ads@blockclubchi\.org"[^>]*>[\s\S]*?<\/a>/g;
  html = html.replace(TEMPLATE_AD_BLOCK_REGEX, (match) => {
    const wrapped = `<!-- AD-SLOT-TEMPLATE-${templateAdIdx}-START -->${match}<!-- AD-SLOT-TEMPLATE-${templateAdIdx}-END -->`;
    templateAdIdx++;
    return wrapped;
  });

  // 3. Inject the template's CSS into <head> so it actually applies.
  if (templateCss) {
    html = html.replace('</head>', `<style type="text/css">${templateCss}</style></head>`);
  }

  return { html, slotCount: headlineSlotCount };
}

// ---------- ActiveCampaign API helpers ----------

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

  let campaignName, introText, listId, templateId, stories;
  try {
    ({ campaignName, introText, listId, templateId, stories } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!campaignName || !Array.isArray(stories) || stories.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'campaignName and a non-empty stories array are required' }),
    };
  }

  listId = listId || process.env.AC_LIST_ID;
  if (!listId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No list selected and no AC_LIST_ID environment variable set' }) };
  }

  try {
    let html;
    let slotWarning = null;

    if (templateId) {
      const templateRes = await acRequest(`templates/${encodeURIComponent(templateId)}`);
      const rawContent = templateRes.template?.content;
      if (!rawContent) {
        throw new Error('Selected template has no content field to merge into');
      }
      const { html: templateHtml, css: templateCss } = JSON.parse(rawContent);
      const merged = mergeIntoTemplate(templateHtml, templateCss, introText, stories);
      html = merged.html;
      if (stories.length > merged.slotCount) {
        slotWarning = `This template has ${merged.slotCount} story slot${merged.slotCount === 1 ? '' : 's'}, but ${stories.length} stories were provided. Only the first ${merged.slotCount} were placed — the rest were not included.`;
      }
    } else {
      html = buildDefaultNewsletterHtml(campaignName, introText, stories);
    }

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
        campaign: campaignRes,
        slotWarning,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
