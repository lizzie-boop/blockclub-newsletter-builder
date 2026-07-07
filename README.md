# Newsletter Builder

Staff paste a list of Block Club story links and a campaign name. The tool:

1. Looks up each story's published headline + lead image via the WordPress REST API
   (falls back to scraping `og:title`/`og:image` if a link doesn't resolve that way).
2. Builds a simple HTML newsletter body, stacking each story as a preview block
   (image, headline, short excerpt, "Read the full story" link).
3. Creates a **draft** campaign in ActiveCampaign — nothing is sent. Staff review
   and send it from inside ActiveCampaign as usual.

## Setup

### 1. Environment variables (Netlify site settings → Environment variables)

| Variable | Description |
|---|---|
| `AC_API_URL` | Your ActiveCampaign API base URL, e.g. `https://blockclubchicago.api-us1.com` |
| `AC_API_KEY` | ActiveCampaign API key (Settings → Developer in AC) |
| `AC_LIST_ID` | Numeric ID of the list this newsletter sends to |
| `AC_FROM_NAME` | e.g. `Block Club Chicago` |
| `AC_FROM_EMAIL` | e.g. `newsletter@blockclubchicago.org` |
| `AC_REPLY_TO` | Optional, defaults to `AC_FROM_EMAIL` |
| `WP_BASE_URL` | Optional, defaults to `https://blockclubchicago.org` |

### 2. Deploy

Same pattern as the ad reports tool — connect this repo to Netlify, it picks up
`netlify.toml` automatically. No build step; functions run as-is.

## A known rough edge — please test before relying on this

ActiveCampaign's current v3 API docs cleanly cover creating a **message**
(`POST /api/3/messages`), but attaching that message to a **list** and saving
it as a **draft campaign** isn't documented in the current v3 reference.
The working approach — confirmed via ActiveCampaign's own legacy (v1) examples
and long-running community threads, not the current official docs — is that
`POST /api/3/campaigns` still expects old-style array params:

```
type=single
name=<campaign name>
status=0        // 0 = draft, not sent
public=1
sdate=<timestamp, required even for drafts>
list[<LIST_ID>]=<LIST_ID>
p[<LIST_ID>]=<LIST_ID>
m[<MESSAGE_ID>]=100
```

This is implemented in `netlify/functions/create-campaign.js`. **Before rolling
this out to the team, run it once against a test list** (or a list with just
you on it) and confirm in the ActiveCampaign UI that:
- the draft appears under Campaigns,
- it's attached to the right list,
- the message content renders as expected.

If ActiveCampaign has changed this behavior since, the error message returned
by the function will include AC's actual response — that's the fastest way to
diagnose what changed.

## Files

- `index.html` — the staff-facing page
- `netlify/functions/fetch-story.js` — resolves headline/image per link
- `netlify/functions/create-campaign.js` — builds HTML + creates the AC draft
