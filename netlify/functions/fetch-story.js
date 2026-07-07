// netlify/functions/fetch-story.js
//
// Given a Block Club Chicago story URL, return { headline, image, excerpt }.
// Primary path: WordPress REST API (fast, structured, reliable).
// Fallback path: scrape og:title / og:image from the rendered page, in case
// the REST API is disabled, cached oddly, or the URL doesn't map to a slug
// cleanly (e.g. it's been redirected).

const WP_BASE = process.env.WP_BASE_URL || 'https://blockclubchicago.org';

function slugFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    // Block Club permalinks are typically /YYYY/MM/DD/slug/ or /slug/
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

async function tryWpRestApi(url) {
  const slug = slugFromUrl(url);
  if (!slug) return null;

  const endpoint = `${WP_BASE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=1`;
  const res = await fetch(endpoint, { headers: { 'User-Agent': 'BlockClub-Newsletter-Builder/1.0' } });
  if (!res.ok) return null;

  const posts = await res.json();
  if (!Array.isArray(posts) || posts.length === 0) return null;

  const post = posts[0];
  const headline = stripHtml(post.title?.rendered) || null;
  const excerpt = stripHtml(post.excerpt?.rendered) || null;

  let image = null;
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  if (media) {
    image =
      media.media_details?.sizes?.large?.source_url ||
      media.media_details?.sizes?.medium_large?.source_url ||
      media.source_url ||
      null;
  }

  if (!headline) return null;

  return { headline, image, excerpt, link: post.link || url, source: 'wp-rest-api' };
}

async function tryOgScrape(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'BlockClub-Newsletter-Builder/1.0' } });
  if (!res.ok) return null;
  const html = await res.text();

  const getMeta = (prop) => {
    const re = new RegExp(
      `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      'i'
    );
    const match = html.match(re);
    if (match) return match[1];
    // Some sites put content before property
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`,
      'i'
    );
    const match2 = html.match(re2);
    return match2 ? match2[1] : null;
  };

  const headline = getMeta('og:title');
  const image = getMeta('og:image');
  const excerpt = getMeta('og:description');

  if (!headline) return null;

  return { headline, image, excerpt, link: url, source: 'og-scrape' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let url;
  try {
    ({ url } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!url || typeof url !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };
  }

  try {
    let result = await tryWpRestApi(url);
    if (!result) result = await tryOgScrape(url);

    if (!result) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          url,
          found: false,
          error: 'Could not resolve headline/image for this link',
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url, found: true, ...result }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ url, found: false, error: err.message }),
    };
  }
};
