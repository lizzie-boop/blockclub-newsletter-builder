// netlify/functions/list-pending-newsletters.js
//
// Returns all submitted newsletters — both "pending" (awaiting finalization)
// and "completed" (already turned into a real ActiveCampaign draft) — so the
// Finalize tab can populate its dropdown (pending only) and its small
// history list (completed).

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore({ name: 'pending-newsletters', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
    const { blobs } = await store.list();

    const items = [];
    for (const blob of blobs) {
      try {
        const data = await store.get(blob.key, { type: 'json' });
        if (data) {
          items.push({
            id: data.id,
            campaignName: data.campaignName,
            status: data.status,
            submittedBy: data.submittedBy,
            submittedAt: data.submittedAt,
            finalizedAt: data.finalizedAt || null,
            resultCampaignId: data.resultCampaignId || null,
            storyCount: Array.isArray(data.stories) ? data.stories.length : 0,
          });
        }
      } catch {
        // Skip anything unreadable rather than failing the whole list.
      }
    }

    items.sort((a, b) => b.submittedAt - a.submittedAt);

    return { statusCode: 200, body: JSON.stringify({ items }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
