# Reminder Apps

A small installable reminder web app for monthly fixed-date reminders.

## How family users work

Each family member creates a username and password on the device/browser. Reminders are stored separately per username in that browser, and each user chooses their own monthly reminder date and time.

This first version does not sync between phones. To share reminders across many devices, add a backend such as Supabase or Firebase.

## iPhone alert notes

Browsers cannot directly create or control iPhone Clock alarms. This app supports:

- In-app/browser notifications when permission is enabled.
- Calendar export for each reminder, which can create a monthly iPhone Calendar alert.

For the strongest alert, use the `Calendar` button on a reminder and import the `.ics` file into iPhone Calendar.

## Run locally

Use any static server, for example:

```powershell
node .\dev-server.cjs
```

Then open `http://localhost:5173`.
