# Reminder Apps

A small installable reminder web app for monthly fixed-date reminders.

Reminder types:

- Every month: repeat on the selected day of each month.
- Specific date: remind once on the selected calendar date.

## How family users work

Each family member creates a username and password on the device/browser. Reminders are stored separately per username in that browser, and each user chooses their own monthly reminder date and time.

This first version does not sync between phones. To share reminders across many devices, add a backend such as Supabase or Firebase.

## iPhone alert notes

Browsers cannot directly create or control iPhone Clock alarms. This app supports:

- In-app/browser notifications when permission is enabled.
- Missed reminder checks when the app is opened again.
- Sticky all-day reminder notifications where the browser supports it. Due reminders re-notify every 5 minutes while the app is active, and deleting the reminder stops future notifications.
- Calendar export for each reminder, which can create a monthly iPhone Calendar alert.

For the strongest alert, use the `Calendar` button on a reminder and import the `.ics` file into iPhone Calendar. Website notifications may not fire if iPhone has stopped the web app in the background. Login is remembered in the same browser until the user taps logout or clears website data.

## Run locally

Use any static server, for example:

```powershell
node .\dev-server.cjs
```

Then open `http://localhost:5173`.
