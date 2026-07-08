// netlify/functions/save-pending-newsletter.js
//
// Saves a submitted-but-not-yet-created newsletter to Netlify Blobs, so a
// second person can later open it, edit the story details, and create the
// actual ActiveCampaign draft. This is step 1 of the submit → finalize flow.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let campaignName, introText, listId, templateId, stories, submittedBy;
  try {
    ({ campaignName, introText, listId, templateId, stories, submittedBy } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!campaignName || !Array.isArray(stories) || stories.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'campaignName and a non-empty stories array are required' }),
    };
  }

  try {
    const store = getStore('pending-newsletters');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await store.setJSON(id, {
      id,
      status: 'pending',
      campaignName,
      introText: introText || '',
      listId: listId || '',
      templateId: templateId || '',
      stories,
      submittedBy: submittedBy || '',
      submittedAt: Date.now(),
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
