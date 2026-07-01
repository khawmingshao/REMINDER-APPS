import webpush from "web-push";

const REMINDER_PREFIX = "reminders:";
const SUBSCRIPTION_PREFIX = "subscriptions:";
const SENT_PREFIX = "sent:";
const TIME_ZONE = "Asia/Kuala_Lumpur";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/push/public-key") {
        return json({ publicKey: env.VAPID_PUBLIC_KEY });
      }

      if (request.method === "POST" && url.pathname === "/api/push/subscribe") {
        const body = await request.json();
        const username = normalizeUsername(body.username);
        if (!username || !body.subscription?.endpoint) return json({ error: "Invalid subscription" }, 400);

        const key = await subscriptionKey(username, body.subscription.endpoint);
        await env.REMINDER_KV.put(key, JSON.stringify(body.subscription));
        return json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/api/push/reminders") {
        const body = await request.json();
        const username = normalizeUsername(body.username);
        if (!username || !Array.isArray(body.reminders)) return json({ error: "Invalid reminders" }, 400);

        const reminders = body.reminders.map(cleanReminder).filter(Boolean);
        await env.REMINDER_KV.put(`${REMINDER_PREFIX}${username}`, JSON.stringify(reminders));
        return json({ ok: true, count: reminders.length });
      }

      if (request.method === "POST" && url.pathname === "/api/push/test") {
        const body = await request.json();
        const username = normalizeUsername(body.username);
        if (!username) return json({ error: "Invalid username" }, 400);

        const sent = await sendToUser(env, username, {
          title: "Reminder test",
          body: "Cloudflare push notification is working.",
          tag: "reminder-cloudflare-test",
          url: "./index.html",
          forceShow: true,
        });

        return json({ ok: true, sent });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || "Server error" }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkDueReminders(env));
  },
};

async function checkDueReminders(env) {
  const now = new Date();
  const reminderKeys = await listAllKeys(env.REMINDER_KV, REMINDER_PREFIX);

  for (const key of reminderKeys) {
    const username = key.name.slice(REMINDER_PREFIX.length);
    const reminders = await getJson(env.REMINDER_KV, key.name, []);

    for (const reminder of reminders) {
      const occurrence = getCurrentOccurrence(reminder, now);
      if (!occurrence) continue;

      const sentKey = `${SENT_PREFIX}${username}:${reminder.id}:${occurrence.key}`;
      if (await env.REMINDER_KV.get(sentKey)) continue;

      const sent = await sendToUser(env, username, {
        title: reminder.title,
        body: reminder.notes || `${getScheduleDescription(reminder)} at ${formatTime(reminder.time)}`,
        tag: `reminder-${reminder.id}`,
        reminderId: reminder.id,
        url: "./index.html",
      });

      if (sent > 0) {
        await env.REMINDER_KV.put(sentKey, now.toISOString(), { expirationTtl: 40 * 24 * 60 * 60 });
      }
    }
  }
}

async function sendToUser(env, username, payload) {
  configureWebPush(env);

  const keys = await listAllKeys(env.REMINDER_KV, `${SUBSCRIPTION_PREFIX}${username}:`);
  let sent = 0;

  for (const key of keys) {
    const subscription = await getJson(env.REMINDER_KV, key.name, null);
    if (!subscription) continue;

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 24 * 60 * 60 });
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await env.REMINDER_KV.delete(key.name);
      }
    }
  }

  return sent;
}

function configureWebPush(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error("Missing VAPID environment variables");
  }

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

async function listAllKeys(kv, prefix) {
  const keys = [];
  let cursor;

  do {
    const result = await kv.list({ prefix, cursor });
    keys.push(...result.keys);
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return keys;
}

async function getJson(kv, key, fallback) {
  const value = await kv.get(key);
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function subscriptionKey(username, endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${SUBSCRIPTION_PREFIX}${username}:${hash}`;
}

function cleanReminder(reminder) {
  if (!reminder?.id || !reminder?.title || !reminder?.time) return null;

  const type = reminder.type === "once" ? "once" : "monthly";
  if (type === "once" && !reminder.date) return null;
  if (type === "monthly" && (!Number(reminder.day) || Number(reminder.day) < 1 || Number(reminder.day) > 31)) return null;

  return {
    id: String(reminder.id),
    username: normalizeUsername(reminder.username),
    type,
    title: String(reminder.title).slice(0, 80),
    day: type === "monthly" ? Number(reminder.day) : null,
    date: type === "once" ? String(reminder.date) : null,
    time: String(reminder.time),
    notes: String(reminder.notes || "").slice(0, 240),
    createdAt: reminder.createdAt || new Date().toISOString(),
    updatedAt: reminder.updatedAt || new Date().toISOString(),
  };
}

function getCurrentOccurrence(reminder, now = new Date()) {
  const local = getLocalParts(now);
  const [hour, minute] = reminder.time.split(":").map(Number);
  const dueMinute = hour * 60 + minute;
  const currentMinute = local.hour * 60 + local.minute;
  if (currentMinute < dueMinute || currentMinute > dueMinute + 2) return null;

  if (reminder.type === "once") {
    const [year, month, day] = reminder.date.split("-").map(Number);
    if (local.year !== year || local.month !== month || local.day !== day) return null;
    return { key: `once:${reminder.date}` };
  }

  const lastDay = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
  const day = Math.min(reminder.day, lastDay);
  if (local.day !== day) return null;

  return { key: `monthly:${local.year}-${String(local.month).padStart(2, "0")}` };
}

function getLocalParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function getScheduleDescription(reminder) {
  return reminder.type === "once" ? `Specific date ${reminder.date}` : `Monthly reminder for day ${reminder.day}`;
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2026, 0, 1, hour - 8, minute)));
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
