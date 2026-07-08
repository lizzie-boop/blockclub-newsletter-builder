// netlify/functions/get-pending-newsletter.js
//
// Returns the full stored data for a single submitted newsletter (all story
// fields, topper, list/template selection) so the Finalize tab can populate
// its editable form.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id query parameter' }) };
  }

  try {
    const store = getStore('pending-newsletters');
    const data = await store.get(id, { type: 'json' });

    if (!data) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
