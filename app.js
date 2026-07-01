const STORAGE_KEY = "family-reminder-v1";
const SESSION_KEY = "family-reminder-session";
const ALL_DAY_RENOTIFY_INTERVAL_MS = 5 * 60 * 1000;
const APP_VERSION = "2026-07-01.4";
const PUSH_API_BASE = window.REMINDER_PUSH_API_BASE || "";

const state = {
  mode: "login",
  currentUser: null,
  reminders: [],
  dueTimers: [],
  checkingDue: false,
  activeAlarmId: null,
  pushSetupInFlight: false,
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
  reminderType: document.querySelector("#reminderType"),
  reminderTitle: document.querySelector("#reminderTitle"),
  reminderDay: document.querySelector("#reminderDay"),
  reminderDate: document.querySelector("#reminderDate"),
  monthlyDayField: document.querySelector("#monthlyDayField"),
  specificDateField: document.querySelector("#specificDateField"),
  reminderTime: document.querySelector("#reminderTime"),
  reminderNotes: document.querySelector("#reminderNotes"),
  saveReminder: document.querySelector("#saveReminder"),
  cancelEdit: document.querySelector("#cancelEdit"),
  sortMode: document.querySelector("#sortMode"),
  reminderCount: document.querySelector("#reminderCount"),
  emptyState: document.querySelector("#emptyState"),
  reminderList: document.querySelector("#reminderList"),
  historyCount: document.querySelector("#historyCount"),
  historyEmpty: document.querySelector("#historyEmpty"),
  historyList: document.querySelector("#historyList"),
  template: document.querySelector("#reminderTemplate"),
  alarmOverlay: document.querySelector("#alarmOverlay"),
  alarmTitle: document.querySelector("#alarmTitle"),
  alarmTime: document.querySelector("#alarmTime"),
  alarmNotes: document.querySelector("#alarmNotes"),
  alarmStop: document.querySelector("#alarmStop"),
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
  localStorage.setItem(SESSION_KEY, username);
  try {
    sessionStorage.setItem(SESSION_KEY, username);
  } catch {
    // Persistent localStorage is the source of truth; sessionStorage is only a fallback.
  }
  els.password.value = "";
  renderApp();
  ensureClosedAppPush();
}

function logout() {
  state.currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage fallback cleanup failures.
  }
  clearDueTimers();
  renderApp();
}

function restoreSavedUser() {
  const store = loadStore();
  const savedUser = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  const userExists = store.users.some((user) => user.username === savedUser);

  if (savedUser && userExists) {
    state.currentUser = savedUser;
    localStorage.setItem(SESSION_KEY, savedUser);
    return true;
  }

  if (!savedUser || !userExists) {
    state.currentUser = null;
    localStorage.removeItem(SESSION_KEY);
  }

  return false;
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
  syncCloudflareReminders();
}

function updateReminder(id, updates) {
  const store = loadStore();
  const index = store.reminders.findIndex((item) => item.id === id && item.username === state.currentUser);
  if (index < 0) return null;

  store.reminders[index] = { ...store.reminders[index], ...updates, updatedAt: new Date().toISOString() };
  saveStore(store);
  return store.reminders[index];
}

function deleteReminder(id) {
  const store = loadStore();
  store.reminders = store.reminders.filter((item) => !(item.id === id && item.username === state.currentUser));
  saveStore(store);
  syncCloudflareReminders();
  closeReminderNotification(id);
  renderReminders();
}

function handleReminderSave(event) {
  event.preventDefault();
  const type = els.reminderType.value;
  const day = Number(els.reminderDay.value);
  const date = els.reminderDate.value;
  const time = els.reminderTime.value;
  const existingReminder = els.editingId.value ? getUserReminders().find((item) => item.id === els.editingId.value) : null;

  if (type === "monthly" && (day < 1 || day > 31)) {
    alert("Please choose a day from 1 to 31.");
    return;
  }

  if (type === "once" && !date) {
    alert("Please choose the specific date.");
    return;
  }

  const now = new Date().toISOString();
  const reminder = {
    id: els.editingId.value || crypto.randomUUID(),
    username: state.currentUser,
    type,
    title: els.reminderTitle.value.trim(),
    day: type === "monthly" ? day : null,
    date: type === "once" ? date : null,
    time,
    notes: els.reminderNotes.value.trim(),
    lastNotifiedKey: null,
    notificationUntil: null,
    lastPersistentNotificationAt: null,
    alertHistory: existingReminder?.alertHistory || [],
    createdAt: existingReminder?.createdAt || now,
    updatedAt: now,
  };

  saveUserReminder(reminder);
  resetEditor();
  renderReminders();
}

function resetEditor() {
  els.editingId.value = "";
  els.reminderType.value = "monthly";
  els.reminderTitle.value = "";
  els.reminderDay.value = "";
  els.reminderDate.value = "";
  els.reminderTime.value = "15:00";
  els.reminderNotes.value = "";
  els.saveReminder.textContent = "Save reminder";
  toggleReminderType();
}

function editReminder(id) {
  const reminder = getUserReminders().find((item) => item.id === id);
  if (!reminder) return;

  els.editingId.value = reminder.id;
  els.reminderType.value = reminder.type || "monthly";
  els.reminderTitle.value = reminder.title;
  els.reminderDay.value = reminder.day || "";
  els.reminderDate.value = reminder.date || "";
  els.reminderTime.value = reminder.time;
  els.reminderNotes.value = reminder.notes || "";
  els.saveReminder.textContent = "Update reminder";
  toggleReminderType();
  els.reminderTitle.focus();
}

function getNextDue(reminder, fromDate = new Date()) {
  const [hour, minute] = reminder.time.split(":").map(Number);
  const type = reminder.type || "monthly";

  if (type === "once") {
    const [year, month, day] = reminder.date.split("-").map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }

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

function getCurrentOccurrence(reminder, fromDate = new Date()) {
  const [hour, minute] = reminder.time.split(":").map(Number);
  const type = reminder.type || "monthly";

  if (type === "once") {
    const [year, month, day] = reminder.date.split("-").map(Number);
    const dueAt = new Date(year, month - 1, day, hour, minute, 0, 0);
    return isOccurrenceDueToday(reminder, dueAt, fromDate) ? { dueAt, key: `once:${reminder.date}` } : null;
  }

  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(reminder.day, lastDay);
  const dueAt = new Date(year, month, day, hour, minute, 0, 0);
  const key = `monthly:${year}-${String(month + 1).padStart(2, "0")}`;

  return isOccurrenceDueToday(reminder, dueAt, fromDate) ? { dueAt, key } : null;
}

function getNextAlertTime(reminder) {
  return getNextDue(reminder);
}

function isOccurrenceDueToday(reminder, dueAt, fromDate) {
  if (dueAt > fromDate || !isSameLocalDate(dueAt, fromDate)) return false;

  const createdAt = reminder.createdAt ? new Date(reminder.createdAt) : null;
  return !createdAt || createdAt <= dueAt;
}

function isSameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isOutsideApp() {
  return document.hidden || document.visibilityState !== "visible";
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
    if (mode === "date") return getDateSortKey(a).localeCompare(getDateSortKey(b)) || a.time.localeCompare(b.time);
    return getNextDue(a) - getNextDue(b);
  });
}

function getDateSortKey(reminder) {
  return (reminder.type || "monthly") === "once" ? reminder.date : `monthly-${String(reminder.day).padStart(2, "0")}`;
}

function renderApp() {
  const loggedIn = Boolean(state.currentUser);
  els.authPanel.classList.toggle("hidden", loggedIn);
  els.dashboard.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    els.welcomeTitle.textContent = `Hi, ${state.currentUser}`;
    renderReminders();
    renderHistory();
    checkDueReminders();
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
    const nextDue = getNextAlertTime(reminder);
    const isPastOneTime = (reminder.type || "monthly") === "once" && nextDue <= new Date();
    const currentOccurrence = getCurrentOccurrence(reminder);
    const isDue = Boolean(currentOccurrence && reminder.lastNotifiedKey !== currentOccurrence.key);
    node.querySelector(".month-day").textContent = getDatePillLabel(reminder);
    node.querySelector(".time-label").textContent = formatTime(reminder.time);
    node.querySelector("h3").textContent = reminder.title;
    node.querySelector(".notes").textContent = reminder.notes || "No extra notes";
    node.querySelector(".next-due").textContent = getReminderStatus(reminder, nextDue, isPastOneTime, isDue);
    node.classList.toggle("is-done", isPastOneTime);
    node.classList.toggle("is-due", isDue);
    node.querySelector(".edit-btn").addEventListener("click", () => editReminder(reminder.id));
    node.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm(`Delete "${reminder.title}"?`)) deleteReminder(reminder.id);
    });
    node.querySelector(".export-btn").addEventListener("click", () => exportCalendar(reminder));
    els.reminderList.appendChild(node);
  });

  scheduleDueChecks();
}

function renderHistory() {
  const history = getAlertHistory();
  els.historyList.innerHTML = "";
  els.historyEmpty.classList.toggle("hidden", history.length > 0);
  els.historyCount.textContent = history.length === 1 ? "1 past alert" : `${history.length} past alerts`;

  history.forEach((entry) => {
    const node = document.createElement("article");
    node.className = "history-item";
    node.innerHTML = `
      <div>
        <h3></h3>
        <p></p>
      </div>
      <span></span>
    `;
    node.querySelector("h3").textContent = entry.title;
    node.querySelector("p").textContent = entry.notes || entry.description;
    node.querySelector("span").textContent = formatDate(new Date(entry.alertedAt));
    els.historyList.appendChild(node);
  });
}

function getAlertHistory() {
  return getUserReminders()
    .flatMap((reminder) =>
      (reminder.alertHistory || []).map((entry) => ({
        ...entry,
        title: reminder.title,
        notes: reminder.notes,
        description: getScheduleDescription(reminder),
      })),
    )
    .sort((a, b) => new Date(b.alertedAt) - new Date(a.alertedAt))
    .slice(0, 30);
}

function clearDueTimers() {
  state.dueTimers.forEach((timer) => clearTimeout(timer));
  state.dueTimers = [];
}

function scheduleDueChecks() {
  clearDueTimers();

  state.reminders.forEach((reminder) => {
    const dueAt = getNextAlertTime(reminder);
    const delay = dueAt.getTime() - Date.now();
    const maxDelay = 2_147_483_647;

    if (delay >= 0 && delay <= maxDelay) {
      state.dueTimers.push(setTimeout(() => triggerReminder(reminder.id), delay));
    }
  });
}

function getDatePillLabel(reminder) {
  if ((reminder.type || "monthly") === "once") {
    const [, month, day] = reminder.date.split("-").map(Number);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  }

  return String(reminder.day).padStart(2, "0");
}

function getScheduleLabel(reminder) {
  return (reminder.type || "monthly") === "once" ? "Date" : "Next";
}

function getReminderStatus(reminder, nextDue, isPastOneTime, isDue) {
  if (isDue) return `Due now: ${formatDate(nextDue)}`;
  if (isPersistentNotificationActive(reminder) && getCurrentOccurrence(reminder)) {
    return `Alerting today until: ${formatDate(new Date(reminder.notificationUntil))}`;
  }
  if (isPastOneTime) return `Done: ${formatDate(nextDue)}`;
  return `${getScheduleLabel(reminder)}: ${formatDate(nextDue)}`;
}

function getScheduleDescription(reminder) {
  if ((reminder.type || "monthly") === "once") {
    return `Specific date ${reminder.date}`;
  }

  return `Monthly reminder for day ${reminder.day}`;
}

function triggerReminder(id) {
  if (!isOutsideApp()) {
    renderReminders();
    return;
  }

  const reminder = getUserReminders().find((item) => item.id === id);
  if (!reminder) return;

  const occurrence = getCurrentOccurrence(reminder);
  if (!occurrence) return;
  if (reminder.lastNotifiedKey === occurrence.key) return;
  const now = new Date();

  const updatedReminder = updateReminder(id, {
    lastNotifiedKey: occurrence.key,
    notificationUntil: getEndOfToday(now).toISOString(),
    lastPersistentNotificationAt: now.toISOString(),
    alertHistory: getUpdatedAlertHistory(reminder, occurrence, now),
  });

  notifyReminder(updatedReminder || reminder);
  showAlarm(updatedReminder || reminder);
}

function getUpdatedAlertHistory(reminder, occurrence, alertedAt) {
  const history = reminder.alertHistory || [];
  if (history.some((entry) => entry.key === occurrence.key)) return history;

  return [
    { key: occurrence.key, dueAt: occurrence.dueAt.toISOString(), alertedAt: alertedAt.toISOString() },
    ...history,
  ].slice(0, 30);
}

async function notifyReminder(reminder) {
  const didNotify = await showSystemNotification(reminder.title, {
    body: reminder.notes || `${getScheduleDescription(reminder)} at ${formatTime(reminder.time)}`,
    tag: `reminder-${reminder.id}`,
    data: { reminderId: reminder.id, url: "./index.html" },
  });

  if (!didNotify) {
    alert(`Reminder: ${reminder.title}`);
  }

  renderReminders();
  renderHistory();
}

async function showSystemNotification(title, options = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const notificationOptions = {
    icon: "./icon.svg",
    badge: "./icon.svg",
    renotify: true,
    requireInteraction: true,
    ...options,
  };

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, notificationOptions);
      return true;
    } catch {
      // Fall back to the page notification API below.
    }
  }

  try {
    const notification = new Notification(title, notificationOptions);
    notification.onclick = () => {
      window.focus();
      if (options.data?.url) {
        window.location.href = options.data.url;
      }
    };
    return true;
  } catch {
    return false;
  }
}

async function closeReminderNotification(id) {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications({ tag: `reminder-${id}` });
    notifications.forEach((notification) => notification.close());
  } catch {
    // Some browsers do not expose notification lookup; deleting still stops future app notifications.
  }
}

function checkDueReminders() {
  if (!state.currentUser || state.checkingDue) return;
  if (!isOutsideApp()) {
    renderReminders();
    return;
  }

  state.checkingDue = true;

  getUserReminders().forEach((reminder) => {
    const occurrence = getCurrentOccurrence(reminder);
    if (occurrence && reminder.lastNotifiedKey !== occurrence.key) {
      triggerReminder(reminder.id);
      return;
    }

    if (shouldRenotifyReminder(reminder)) {
      const now = new Date();
      const updatedReminder = updateReminder(reminder.id, { lastPersistentNotificationAt: now.toISOString() });
      notifyReminder(updatedReminder || reminder);
    }
  });

  state.checkingDue = false;
}

function getEndOfToday(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function isPersistentNotificationActive(reminder, now = new Date()) {
  return Boolean(reminder.notificationUntil && new Date(reminder.notificationUntil) > now);
}

function shouldRenotifyReminder(reminder, now = new Date()) {
  if (!isPersistentNotificationActive(reminder, now)) return false;
  const occurrence = getCurrentOccurrence(reminder, now);
  if (!occurrence || reminder.lastNotifiedKey !== occurrence.key) return false;

  const lastShownAt = reminder.lastPersistentNotificationAt ? new Date(reminder.lastPersistentNotificationAt) : null;
  return !lastShownAt || now.getTime() - lastShownAt.getTime() >= ALL_DAY_RENOTIFY_INTERVAL_MS;
}

function showAlarm(reminder) {
  state.activeAlarmId = reminder.id;
  els.alarmTitle.textContent = reminder.title;
  els.alarmTime.textContent = getScheduleDescription(reminder);
  els.alarmNotes.textContent = reminder.notes || "Press Stop to dismiss.";
  els.alarmOverlay.classList.remove("hidden");
  els.alarmStop.focus();
}

function hideAlarm() {
  state.activeAlarmId = null;
  els.alarmOverlay.classList.add("hidden");
}

function stopActiveAlarm() {
  if (state.activeAlarmId) {
    updateReminder(state.activeAlarmId, {
      notificationUntil: null,
      lastPersistentNotificationAt: null,
    });
    closeReminderNotification(state.activeAlarmId);
  }
  hideAlarm();
  renderReminders();
  renderHistory();
}

async function requestNotifications() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

  if (isIos && !isStandalone) {
    alert("On iPhone, open this site in Safari, tap Share, choose Add to Home Screen, then open the new app icon and enable notifications there.");
    return;
  }

  if (!("Notification" in window)) {
    alert("This browser cannot enable notifications. On iPhone, use Safari and Add to Home Screen first. For a stronger alert, use the Calendar button.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    els.enableNotifications.disabled = true;
    els.enableNotifications.textContent = "Checking...";
    const pushReady = await enableCloudflarePush();
    const testSent = pushReady ? await sendCloudflareTestPush() : false;
    updateNotificationButton();

    if (pushReady && testSent) {
      alert("Notifications enabled. A test notification was sent. Closed-app reminders can now come from Cloudflare push.");
    } else if (pushReady) {
      alert("Notifications are enabled, but the test push could not be sent. Open the app again and tap Enable notifications once more.");
    } else {
      alert("Notifications are allowed on this device, but closed-app push is not connected yet. Check the Worker setup, then tap Enable notifications again.");
    }
  } else if (permission === "denied") {
    alert("Notifications are blocked. Open iPhone Settings, find this app or Safari website settings, and allow notifications.");
  }
}

async function enableCloudflarePush() {
  if (!PUSH_API_BASE || !state.currentUser || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const response = await fetch(`${PUSH_API_BASE}/api/push/public-key`);
    if (!response.ok) return false;

    const { publicKey } = await response.json();
    if (!publicKey) return false;

    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription =
      existingSubscription ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const subscribeResponse = await fetch(`${PUSH_API_BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.currentUser, subscription }),
    });
    if (!subscribeResponse.ok) return false;

    await syncCloudflareReminders();
    return true;
  } catch {
    return false;
  }
}

async function ensureClosedAppPush() {
  if (state.pushSetupInFlight) return false;
  if (!state.currentUser) return false;

  try {
    await syncCloudflareReminders();

    if (!("Notification" in window) || Notification.permission !== "granted") {
      updateNotificationButton();
      return false;
    }

    state.pushSetupInFlight = true;
    const pushReady = await enableCloudflarePush();
    updateNotificationButton();
    return pushReady;
  } finally {
    state.pushSetupInFlight = false;
  }
}

async function syncCloudflareReminders() {
  if (!PUSH_API_BASE || !state.currentUser) return false;

  try {
    const reminders = getUserReminders().map((reminder) => ({
      id: reminder.id,
      username: reminder.username,
      type: reminder.type,
      title: reminder.title,
      day: reminder.day,
      date: reminder.date,
      time: reminder.time,
      notes: reminder.notes,
      createdAt: reminder.createdAt,
      updatedAt: reminder.updatedAt,
    }));

    const response = await fetch(`${PUSH_API_BASE}/api/push/reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.currentUser, reminders }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function sendCloudflareTestPush() {
  if (!PUSH_API_BASE || !state.currentUser) return false;

  try {
    const response = await fetch(`${PUSH_API_BASE}/api/push/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.currentUser }),
    });
    const result = await response.json().catch(() => ({}));
    return response.ok && Number(result.sent) > 0;
  } catch {
    return false;
  }
}

function updateNotificationButton() {
  if (!els.enableNotifications) return;

  els.enableNotifications.disabled = false;
  if (!("Notification" in window)) {
    els.enableNotifications.textContent = "Notifications unavailable";
    return;
  }

  if (Notification.permission === "granted") {
    els.enableNotifications.textContent = "Test notifications";
    return;
  }

  els.enableNotifications.textContent = "Enable notifications";
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function exportCalendar(reminder) {
  const nextDue = getNextDue(reminder);
  const [hour, minute] = reminder.time.split(":").map(Number);
  const isMonthly = (reminder.type || "monthly") === "monthly";
  const start = isMonthly ? new Date(nextDue.getFullYear(), nextDue.getMonth(), Math.min(reminder.day, 28), hour, minute, 0) : nextDue;
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const stamp = toIcsDate(new Date());
  const safeTitle = escapeIcs(reminder.title);
  const safeNotes = escapeIcs(reminder.notes || getScheduleDescription(reminder));
  const day = isMonthly ? Math.min(reminder.day, 28) : null;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reminder Apps//Monthly Reminder//EN",
    "BEGIN:VEVENT",
    `UID:${reminder.id}@family-reminder`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    ...(isMonthly ? [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`] : []),
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

function toggleReminderType() {
  const isMonthly = els.reminderType.value === "monthly";
  els.monthlyDayField.classList.toggle("hidden", !isMonthly);
  els.specificDateField.classList.toggle("hidden", isMonthly);
  els.reminderDay.required = isMonthly;
  els.reminderDate.required = !isMonthly;
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
  els.reminderType.addEventListener("change", toggleReminderType);
  els.alarmStop.addEventListener("click", stopActiveAlarm);
  document.addEventListener("visibilitychange", () => {
    restoreSavedUser();
    renderApp();
    checkDueReminders();
    ensureClosedAppPush();
  });
  window.addEventListener("focus", () => {
    restoreSavedUser();
    renderApp();
    ensureClosedAppPush();
  });
  window.addEventListener("pageshow", () => {
    restoreSavedUser();
    renderApp();
    ensureClosedAppPush();
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      const registration = await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`);
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      registration.update();
    } catch {
      // The app still works without offline caching.
    }
  }
}

function init() {
  bindEvents();
  setMode("login");
  toggleReminderType();
  restoreSavedUser();
  registerServiceWorker();
  updateNotificationButton();
  renderApp();
  ensureClosedAppPush();
  window.setInterval(checkDueReminders, 60_000);
}

init();
