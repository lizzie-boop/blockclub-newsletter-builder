// netlify/functions/fetch-story.js
//
// Given a story URL, return { headline, image, excerpt }.
//
// - Links on blockclubchicago.org: use the WordPress REST API (fast, structured).
// - Links on any other domain (e.g. a Sun-Times story): skip straight to
//   scraping og:title/og:image/<title> from the rendered page — querying
//   Block Club's WP API for a slug from a different site would never match.

const WP_BASE = process.env.WP_BASE_URL || 'https://blockclubchicago.org';
const WP_HOSTNAME = new URL(WP_BASE).hostname;

// Decode the HTML entities WordPress's REST API returns in title/excerpt
// fields (e.g. &#8217; for a curly apostrophe, &amp; for "&").
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

function decodeEntities(str = '') {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match);
}

function stripHtml(html) {
  return decodeEntities((html || '').replace(/<[^>]*>/g, '')).trim();
}

function isWpSite(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '') === WP_HOSTNAME.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function slugFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
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

function getMetaTag(html, prop) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return decodeEntities(match[1]);
  }
  return null;
}

async function tryOgScrape(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();

  const headline =
    getMetaTag(html, 'og:title') ||
    getMetaTag(html, 'twitter:title') ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] && decodeEntities(html.match(/<title[^>]*>([^<]+)<\/title>/i)[1]));

  const image = getMetaTag(html, 'og:image') || getMetaTag(html, 'twitter:image');
  const excerpt = getMetaTag(html, 'og:description') || getMetaTag(html, 'twitter:description');

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
    let result = null;
    if (isWpSite(url)) {
      result = await tryWpRestApi(url);
    }
    if (!result) {
      result = await tryOgScrape(url);
    }

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