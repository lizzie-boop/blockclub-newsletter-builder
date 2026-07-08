// netlify/functions/serve-image.js
//
// Retrieves an uploaded image from Netlify Blobs and serves it back with
// the correct Content-Type — this is the actual URL used as the <img src>
// in newsletters, wherever an uploaded (rather than pasted-URL) image was used.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const key = event.queryStringParameters?.key;
  if (!key) {
    return { statusCode: 400, body: 'Missing key query parameter' };
  }

  try {
    const store = getStore('ad-images');
    const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });

    if (!result) {
      return { statusCode: 404, body: 'Image not found (it may have expired after 120 days, or the key is wrong)' };
    }

    const { data, metadata } = result;
    const contentType = metadata?.contentType || 'application/octet-stream';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(data).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: `Error loading image: ${err.message}` };
  }
};
