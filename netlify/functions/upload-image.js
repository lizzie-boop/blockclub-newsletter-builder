// netlify/functions/upload-image.js
//
// Accepts an image (as base64) from the browser and stores it in Netlify
// Blobs, tagged with an upload timestamp. Returns a URL that can be used
// directly as an <img src> — that URL points to serve-image.js, which
// retrieves and returns the stored bytes.
//
// Images are automatically deleted after 120 days by the scheduled
// cleanup-old-images.js function.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let filename, contentType, dataBase64;
  try {
    ({ filename, contentType, dataBase64 } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!dataBase64 || !contentType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'contentType and dataBase64 are required' }) };
  }

  // Basic sanity limit — reject anything absurdly large (roughly 8MB after
  // base64 expansion) rather than letting a huge upload through silently.
  if (dataBase64.length > 11_000_000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Image is too large (max ~8MB)' }) };
  }

  try {
    const store = getStore('ad-images');
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const buffer = Buffer.from(dataBase64, 'base64');

    await store.set(key, buffer, {
      metadata: {
        contentType,
        filename: filename || 'upload',
        uploadedAt: Date.now(),
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        key,
        url: `/.netlify/functions/serve-image?key=${encodeURIComponent(key)}`,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
