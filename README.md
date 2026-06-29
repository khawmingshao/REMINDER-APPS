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
- Snooze for 10 minutes from the reminder card.
- Calendar export for each reminder, which can create a monthly iPhone Calendar alert.

For the strongest alert, use the `Calendar` button on a reminder and import the `.ics` file into iPhone Calendar. Website notifications may not fire if iPhone has stopped the web app in the background.

## Run locally

Use any static server, for example:

```powershell
node .\dev-server.cjs
```

Then open `http://localhost:5173`.
