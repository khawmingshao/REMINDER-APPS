# Reminder Apps

A small installable reminder web app for monthly fixed-date reminders.

Reminder types:

- Every month: repeat on the selected day of each month.
- Specific date: remind once on the selected calendar date.

## How family users work

Each family member creates a username and password on the device/browser. Reminders are stored separately per username in that browser, and each user chooses their own monthly reminder date and time.

This first version stores reminders in the current browser. Cloudflare push support can also sync reminders to a Worker so notifications can be sent even when the app is closed.

## iPhone alert notes

Browsers cannot directly create or control iPhone Clock alarms. This app supports:

- In-app/browser notifications when permission is enabled.
- Missed reminder checks when the app is opened again.
- Sticky all-day reminder notifications where the browser supports it. Due reminders re-notify every 5 minutes while the app is active, and deleting the reminder stops future notifications.
- Calendar export for each reminder, which can create a monthly iPhone Calendar alert.

For the strongest no-backend alert, use the `Calendar` button on a reminder and import the `.ics` file into iPhone Calendar. Website-only notifications may not fire if iPhone has stopped the web app in the background. Login is remembered in the same browser until the user taps logout or clears website data.

## Cloudflare push setup

The app includes a Cloudflare Worker backend in `worker/src/index.js`. It uses:

- Workers Cron Triggers to check reminders every minute.
- Workers KV to store reminders and phone push subscriptions.
- Web Push VAPID keys to send notifications to browsers/installed PWAs.

Setup:

```powershell
npm install
npx web-push generate-vapid-keys
npx wrangler kv namespace create REMINDER_KV
```

Copy the KV namespace id into `wrangler.toml`, replacing `replace_with_cloudflare_kv_namespace_id`.

Set Worker secrets:

```powershell
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

Use the generated public/private keys. For `VAPID_SUBJECT`, use an email-style value such as `mailto:you@example.com`.

Deploy:

```powershell
npm run deploy:worker
```

If the Worker is on a different domain from the static site, set this before loading `app.js`:

```html
<script>
  window.REMINDER_PUSH_API_BASE = "https://your-worker.your-subdomain.workers.dev";
</script>
```

If the Worker is routed on the same domain as the app, no extra browser config is needed.

## Run locally

Use any static server, for example:

```powershell
node .\dev-server.cjs
```

Then open `http://localhost:5173`.
