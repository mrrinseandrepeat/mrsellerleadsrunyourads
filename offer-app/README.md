# Offer Sender

A private, phone-friendly web page for the acquisition team. Your assistant enters a PIN, fills out a short form, and taps **Create signing link**. The server then:

1. Creates a new document from the SignNow **Offer To Purchase Agreement** template group.
2. Fills all 26 per-deal fields. Every field gets a real value, an `X`, or a single space, and never a `-`.
3. Reads every field back from SignNow and compares it to what it meant to write. If anything is wrong, it shows an error and does **not** create a link.
4. Creates an embedded signing link: role `Recipient 1`, action `sign`, no authentication, delivered as a link. The seller doesn't need a SignNow account.
5. Shows the link with **Copy** and **Open in Messages** buttons.

The **History** tab lists recent offers with live status and a **Regenerate link** button. The **Log** tab is for admins only and records every login, failed PIN, offer, and error, with who did it and when.

Your SignNow keys stay on the server. The browser never sees them, the template ID, or the SignNow document IDs. Signing links are never saved to disk.

---

## Part 1: Get your SignNow API key

1. Log in at **https://app.signnow.com** with the account that owns the "Team Wholesale Documents" folder, and open the **SignNow API** dashboard.
2. Click **Apps and Keys** in the left menu and copy your **API key**. Treat it like a password: it can create and send documents as you.

**Development mode = watermarked documents.** A green banner at the top saying "Enjoying the signNow API in Development mode?" means your API account is still on the free development tier. In that tier, documents sent through the API carry a test watermark, so they're not fit for real sellers. To remove the watermark, click **Start Free Trial** (250 watermark-free invites) or **Upgrade**, or ask **Contact Sales** for API pricing. **Plan Usage** shows where you stand. Your regular SignNow subscription and the Claude connector don't change this; the API has its own plan.

Do your first test (Part 3) while still in Development mode. The test confirms everything works, and the watermark is expected. Go live once you've upgraded.

**Fallback:** if the API key ever doesn't work, the app can log in a different way. Leave `SIGNNOW_API_KEY` empty and set `SIGNNOW_BASIC_TOKEN` (shown on your app under Apps and Keys), `SIGNNOW_USERNAME` (your login email) and `SIGNNOW_PASSWORD`.

## Part 2: Deploy on Render

Render costs about **$7.25/month**: the Starter web service plus a 1 GB disk that keeps your history and log. Its free plan works for a quick try, but it forgets history whenever it restarts and takes about 30 seconds to wake up. That's too slow for a seller waiting on the phone.

1. Go to **https://render.com** and sign up with your GitHub account.
2. Click **New +** → **Blueprint**.
3. Pick the repository `mrsellerleadsrunyourads`. Render finds `render.yaml` and shows a service called **offer-sender**.
4. Render asks for the secret values:

   | Setting | What to enter |
   |---|---|
   | `ACCESS_PINS` | One PIN per person, as `Name:PIN`, separated by commas. Example: `Matt:482913,Mike:118822`. Use 6+ digits. |
   | `ADMIN_USERS` | Names (from ACCESS_PINS) allowed to see the Log tab. Example: `Matt` |
   | `SIGNNOW_API_KEY` | The API key from Part 1 |
   | `SIGNNOW_BASIC_TOKEN`, `SIGNNOW_USERNAME`, `SIGNNOW_PASSWORD` | Leave empty (fallback only, see Part 1) |

5. Click **Apply**. The first deploy takes a few minutes. When it's live, Render shows a URL like `https://offer-sender-xxxx.onrender.com`.
6. Open that URL on your phone and enter your PIN.

**To change a PIN later:** in Render, open **offer-sender** → **Environment**, edit `ACCESS_PINS`, and click **Save Changes**. Render restarts the app in about a minute. Removing a name logs that person out right away.

**Add it to the assistant's home screen:** open the URL in Safari, tap Share → **Add to Home Screen**. On Android in Chrome, tap ⋮ → **Add to Home screen**.

## Part 3: Test before using it on a real call

1. Optional, read-only: in Render, open **offer-sender** → **Shell** and run `npm run check-template`. It confirms every mapped field name still exists in the SignNow template and that no new field is missing from the map. It creates nothing.
2. Fill out the form with a dummy seller. Use your own second email address, *not* the email of the SignNow account that owns the template. Put `TEST - DO NOT SIGN` in Additional terms line 1.
3. Open the link on your phone and check the document. Sign it if you want to confirm the whole flow.
4. Delete the test document in SignNow (Documents folder).

## Day-to-day notes

- **Links expire in about 45 minutes.** If the seller opens it late, go to History → **Regenerate link**. The filled document stays the same.
- **If you see "did not fill correctly":** nothing was sent. The message lists which fields were wrong. This usually means someone renamed or added a field in the SignNow template. Fix the template or the field map, then try again. The half-made document shows in History as "Failed field check"; delete it in SignNow.
- **If the seller's email belongs to a SignNow user,** SignNow may ask them to log in.
- **Documents land in your SignNow Documents folder** (not the team folder). Move them by hand if you want.
- **Limits:** 5 wrong PINs from one device locks it out for 15 minutes. Each person can create 30 offers per hour (change with `OFFERS_PER_HOUR`).

## Adding another document type later

Each document type is one file in `templates/`. To add, for example, the Mortgage Takeover Purchase Contract:

1. Copy `templates/offer-to-purchase.js` to `templates/mortgage-takeover.js`.
2. Change `id`, `name`, `templateId`, the `formFields` list (what the assistant types), and `buildFields` (form → SignNow field names).
3. Add it to the list in `templates/index.js`.

The document-type picker at the top of the form shows it automatically. All the safety steps (fill, read back, block the link on any mismatch) apply to it without extra work.

## For developers

```
npm install
npm test              # unit + HTTP tests against a fake SignNow
npm run check-template
ACCESS_PINS=Me:1234 SIGNNOW_API_KEY=... npm start
```

| File | Purpose |
|---|---|
| `server.js` | Routes, PIN sessions, rate limits, activity log |
| `lib/signnow.js` | SignNow REST calls (`/v2/document-group-templates/{id}/document-group`, `/v2/documents/{id}/prefill-texts`, `/document/{id}`, `/v2/document-groups/{id}/embedded-invites[/{invite}/link]`) |
| `lib/offers.js` | Create → fill → verify → invite, regenerate, status |
| `templates/` | One config per document type |
| `public/` | The phone page |

Data lives in `DATA_DIR`: `offers.json` holds the history and `activity.log` holds the log, one JSON line per event.
