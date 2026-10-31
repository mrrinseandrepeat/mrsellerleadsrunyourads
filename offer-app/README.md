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

## Part 1: Get your SignNow API credentials

The template lives in your production SignNow account (app.signnow.com). That means the app needs **production** credentials. A sandbox (developer) account can't see your real templates, so don't use one.

1. Log in at **https://app.signnow.com** with the account that owns the "Team Wholesale Documents" folder.
2. Open the **API** section. Depending on your SignNow version, it's either in the left sidebar or under your profile menu → **API** (sometimes labeled "API Dashboard" or "Integrations → API").
3. If there's no application yet, click **Add API application** (any name, like "Offer Sender").
4. Open the application and copy the **Basic Authorization Token**. It's a long string ending in `=`.
5. You'll also need the SignNow **login email and password** for that same account. The app uses them to get short-lived access tokens.

**Plan check:** SignNow controls which plans can use the production API. If the API page only offers sandbox/test keys, or production calls fail with a plan or permission error, contact SignNow support or sales and ask for "production REST API access for my account". Mention that you use document group templates and embedded signing. I couldn't confirm the exact plan requirements from here, so treat their answer as final.

**If you use Google sign-in or SSO for SignNow:** the password login above may not work. Ask SignNow how to get an API key or access token for your account instead. Add it in Render under Environment as `SIGNNOW_API_KEY`, and leave the three password settings empty.

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
   | `SIGNNOW_BASIC_TOKEN` | The Basic Authorization Token from Part 1 |
   | `SIGNNOW_USERNAME` | Your SignNow login email |
   | `SIGNNOW_PASSWORD` | Your SignNow password |

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
ACCESS_PINS=Me:1234 SIGNNOW_BASIC_TOKEN=... SIGNNOW_USERNAME=... SIGNNOW_PASSWORD=... npm start
```

| File | Purpose |
|---|---|
| `server.js` | Routes, PIN sessions, rate limits, activity log |
| `lib/signnow.js` | SignNow REST calls (`/v2/document-group-templates/{id}/document-group`, `/v2/documents/{id}/prefill-texts`, `/document/{id}`, `/v2/document-groups/{id}/embedded-invites[/{invite}/link]`) |
| `lib/offers.js` | Create → fill → verify → invite, regenerate, status |
| `templates/` | One config per document type |
| `public/` | The phone page |

Data lives in `DATA_DIR`: `offers.json` holds the history and `activity.log` holds the log, one JSON line per event.
