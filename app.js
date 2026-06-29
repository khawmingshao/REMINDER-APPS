const STORAGE_KEY = "family-reminder-v1";
const SESSION_KEY = "family-reminder-session";

const state = {
  mode: "login",
  currentUser: null,
  reminders: [],
  dueTimers: [],
};

const els = {
  authPanel: document.querySelector("#authPanel"),
  dashboard: document.querySelector("#dashboard"),
  authForm: document.querySelector("#authForm"),
  loginTab: document.querySelector("#loginTab"),
  signupTab: document.querySelector("#signupTab"),
  authSubmit: document.querySelector("#authSubmit"),
  authMessage: document.querySelector("#authMessage"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  welcomeTitle: document.querySelector("#welcomeTitle"),
  logoutButton: document.querySelector("#logoutButton"),
  enableNotifications: document.querySelector("#enableNotifications"),
  reminderForm: document.querySelector("#reminderForm"),
  editingId: document.querySelector("#editingId"),
  reminderTitle: document.querySelector("#reminderTitle"),
  reminderDay: document.querySelector("#reminderDay"),
  reminderTime: document.querySelector("#reminderTime"),
  reminderNotes: document.querySelector("#reminderNotes"),
  saveReminder: document.querySelector("#saveReminder"),
  cancelEdit: document.querySelector("#cancelEdit"),
  sortMode: document.querySelector("#sortMode"),
  reminderCount: document.querySelector("#reminderCount"),
  emptyState: document.querySelector("#emptyState"),
  reminderList: document.querySelector("#reminderList"),
  template: document.querySelector("#reminderTemplate"),
};

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { users: [], reminders: [] };
  } catch {
    return { users: [], reminders: [] };
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function setMode(mode) {
  state.mode = mode;
  els.loginTab.classList.toggle("active", mode === "login");
  els.signupTab.classList.toggle("active", mode === "signup");
  els.authSubmit.textContent = mode === "login" ? "Log in" : "Create user";
  els.password.autocomplete = mode === "login" ? "current-password" : "new-password";
  els.authMessage.textContent = "";
}

async function handleAuth(event) {
  event.preventDefault();
  const username = normalizeUsername(els.username.value);
  const password = els.password.value;
  const store = loadStore();

  if (!username || !password) {
    els.authMessage.textContent = "Please enter username and password.";
    return;
  }

  if (state.mode === "signup") {
    if (store.users.some((user) => user.username === username)) {
      els.authMessage.textContent = "This username already exists.";
      return;
    }

    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(password, salt);
    store.users.push({ id: crypto.randomUUID(), username, salt, passwordHash, createdAt: new Date().toISOString() });
    saveStore(store);
    signIn(username);
    return;
  }

  const user = store.users.find((item) => item.username === username);
  if (!user) {
    els.authMessage.textContent = "User not found. Create the user first.";
    return;
  }

  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    els.authMessage.textContent = "Wrong password.";
    return;
  }

  signIn(username);
}

function signIn(username) {
  state.currentUser = username;
  sessionStorage.setItem(SESSION_KEY, username);
  els.password.value = "";
  renderApp();
}

function logout() {
  state.currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  clearDueTimers();
  renderApp();
}

function getUserReminders() {
  const store = loadStore();
  return store.reminders.filter((reminder) => reminder.username === state.currentUser);
}

function saveUserReminder(reminder) {
  const store = loadStore();
  const index = store.reminders.findIndex((item) => item.id === reminder.id && item.username === state.currentUser);

  if (index >= 0) {
    store.reminders[index] = reminder;
  } else {
    store.reminders.push(reminder);
  }

  saveStore(store);
}

function deleteReminder(id) {
  const store = loadStore();
  store.reminders = store.reminders.filter((item) => !(item.id === id && item.username === state.currentUser));
  saveStore(store);
  renderReminders();
}

function handleReminderSave(event) {
  event.preventDefault();
  const day = Number(els.reminderDay.value);
  const time = els.reminderTime.value;

  if (day < 1 || day > 31) {
    alert("Please choose a day from 1 to 31.");
    return;
  }

  const now = new Date().toISOString();
  const reminder = {
    id: els.editingId.value || crypto.randomUUID(),
    username: state.currentUser,
    title: els.reminderTitle.value.trim(),
    day,
    time,
    notes: els.reminderNotes.value.trim(),
    createdAt: now,
    updatedAt: now,
  };

  saveUserReminder(reminder);
  resetEditor();
  renderReminders();
}

function resetEditor() {
  els.editingId.value = "";
  els.reminderTitle.value = "";
  els.reminderDay.value = "";
  els.reminderTime.value = "15:00";
  els.reminderNotes.value = "";
  els.saveReminder.textContent = "Save reminder";
}

function editReminder(id) {
  const reminder = getUserReminders().find((item) => item.id === id);
  if (!reminder) return;

  els.editingId.value = reminder.id;
  els.reminderTitle.value = reminder.title;
  els.reminderDay.value = reminder.day;
  els.reminderTime.value = reminder.time;
  els.reminderNotes.value = reminder.notes || "";
  els.saveReminder.textContent = "Update reminder";
  els.reminderTitle.focus();
}

function getNextDue(reminder, fromDate = new Date()) {
  const [hour, minute] = reminder.time.split(":").map(Number);
  let year = fromDate.getFullYear();
  let month = fromDate.getMonth();

  for (let attempts = 0; attempts < 15; attempts += 1) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(reminder.day, lastDay);
    const candidate = new Date(year, month, day, hour, minute, 0, 0);

    if (candidate > fromDate) {
      return candidate;
    }

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return fromDate;
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, hour, minute));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(value);
}

function sortReminders(reminders) {
  const mode = els.sortMode.value;
  return [...reminders].sort((a, b) => {
    if (mode === "title") return a.title.localeCompare(b.title);
    if (mode === "date") return a.day - b.day || a.time.localeCompare(b.time);
    return getNextDue(a) - getNextDue(b);
  });
}

function renderApp() {
  const loggedIn = Boolean(state.currentUser);
  els.authPanel.classList.toggle("hidden", loggedIn);
  els.dashboard.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    els.welcomeTitle.textContent = `Hi, ${state.currentUser}`;
    renderReminders();
  }
}

function renderReminders() {
  const reminders = sortReminders(getUserReminders());
  state.reminders = reminders;
  els.reminderList.innerHTML = "";
  els.emptyState.classList.toggle("hidden", reminders.length > 0);
  els.reminderCount.textContent = reminders.length === 1 ? "1 reminder" : `${reminders.length} reminders`;

  reminders.forEach((reminder) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const nextDue = getNextDue(reminder);
    node.querySelector(".month-day").textContent = String(reminder.day).padStart(2, "0");
    node.querySelector(".time-label").textContent = formatTime(reminder.time);
    node.querySelector("h3").textContent = reminder.title;
    node.querySelector(".notes").textContent = reminder.notes || "No extra notes";
    node.querySelector(".next-due").textContent = `Next: ${formatDate(nextDue)}`;
    node.querySelector(".edit-btn").addEventListener("click", () => editReminder(reminder.id));
    node.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm(`Delete "${reminder.title}"?`)) deleteReminder(reminder.id);
    });
    node.querySelector(".export-btn").addEventListener("click", () => exportCalendar(reminder));
    els.reminderList.appendChild(node);
  });

  scheduleDueChecks();
}

function clearDueTimers() {
  state.dueTimers.forEach((timer) => clearTimeout(timer));
  state.dueTimers = [];
}

function scheduleDueChecks() {
  clearDueTimers();

  state.reminders.forEach((reminder) => {
    const dueAt = getNextDue(reminder);
    const delay = dueAt.getTime() - Date.now();
    const maxDelay = 2_147_483_647;

    if (delay >= 0 && delay <= maxDelay) {
      state.dueTimers.push(setTimeout(() => notifyReminder(reminder), delay));
    }
  });
}

async function notifyReminder(reminder) {
  if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then((registration) => {
      registration.showNotification(reminder.title, {
        body: reminder.notes || `Monthly reminder for day ${reminder.day} at ${formatTime(reminder.time)}`,
        icon: "./icon.svg",
        badge: "./icon.svg",
      });
    });
  } else {
    alert(`Reminder: ${reminder.title}`);
  }

  renderReminders();
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    alert("This browser does not support notifications.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    alert("Notifications enabled. Keep the app installed/opened often for best reliability.");
  }
}

function exportCalendar(reminder) {
  const nextDue = getNextDue(reminder);
  const [hour, minute] = reminder.time.split(":").map(Number);
  const start = new Date(nextDue.getFullYear(), nextDue.getMonth(), Math.min(reminder.day, 28), hour, minute, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const stamp = toIcsDate(new Date());
  const safeTitle = escapeIcs(reminder.title);
  const safeNotes = escapeIcs(reminder.notes || "Monthly reminder");
  const day = Math.min(reminder.day, 28);

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reminder Apps//Monthly Reminder//EN",
    "BEGIN:VEVENT",
    `UID:${reminder.id}@family-reminder`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
    `SUMMARY:${safeTitle}`,
    `DESCRIPTION:${safeNotes}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT0M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${safeTitle}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reminder.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "reminder"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function bindEvents() {
  els.loginTab.addEventListener("click", () => setMode("login"));
  els.signupTab.addEventListener("click", () => setMode("signup"));
  els.authForm.addEventListener("submit", handleAuth);
  els.logoutButton.addEventListener("click", logout);
  els.enableNotifications.addEventListener("click", requestNotifications);
  els.reminderForm.addEventListener("submit", handleReminderSave);
  els.cancelEdit.addEventListener("click", resetEditor);
  els.sortMode.addEventListener("change", renderReminders);
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch {
      // The app still works without offline caching.
    }
  }
}

function init() {
  bindEvents();
  setMode("login");
  state.currentUser = sessionStorage.getItem(SESSION_KEY);
  registerServiceWorker();
  renderApp();
}

init();
