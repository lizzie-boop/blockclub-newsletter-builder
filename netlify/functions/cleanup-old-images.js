// netlify/functions/cleanup-old-images.js
//
// Runs daily (scheduled via netlify.toml) and deletes any uploaded ad image
// older than 120 days, so storage doesn't grow unbounded. Images are only
// ever created by upload-image.js, each tagged with an uploadedAt timestamp
// at upload time.

const { getStore } = require('@netlify/blobs');

const RETENTION_DAYS = 120;

exports.handler = async () => {
  try {
    const store = getStore({ name: 'ad-images', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
    const { blobs } = await store.list();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    let deleted = 0;
    for (const blob of blobs) {
      try {
        const { metadata } = await store.getMetadata(blob.key);
        if (metadata?.uploadedAt && metadata.uploadedAt < cutoff) {
          await store.delete(blob.key);
          deleted++;
        }
      } catch {
        // Skip any individual blob that errors reading metadata, rather
        // than failing the whole cleanup run.
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, checked: blobs.length, deleted }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
