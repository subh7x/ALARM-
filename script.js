const STORAGE_KEY = "alarm_clock_v1";
const THEME_KEY = "alarm_clock_theme_v1";

let alarms = loadAlarms();
let editingId = null;
let ringingAlarm = null;
let ringTimer = null;
let deferredInstallPrompt = null;

const $ = (id) => document.getElementById(id);
const alarmList = $("alarmList");
const emptyState = $("emptyState");
const dialog = $("alarmDialog");
const form = $("alarmForm");

function loadAlarms() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveAlarms() { localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms)); }

function formatTime(time) {
  const [h,m] = time.split(":").map(Number);
  const d = new Date(); d.setHours(h,m,0,0);
  return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
function repeatLabel(value) {
  return ({once:"Once",daily:"Every day",weekdays:"Weekdays",weekends:"Weekends"})[value] || "Once";
}
function isTodayAllowed(repeat, day = new Date().getDay()) {
  if (repeat === "daily") return true;
  if (repeat === "weekdays") return day >= 1 && day <= 5;
  if (repeat === "weekends") return day === 0 || day === 6;
  return true;
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
function renderAlarms() {
  alarmList.innerHTML = "";
  $("alarmCount").textContent = `${alarms.length} alarm${alarms.length === 1 ? "" : "s"}`;
  emptyState.hidden = alarms.length !== 0;

  [...alarms].sort((a,b)=>a.time.localeCompare(b.time)).forEach(alarm => {
    const card = document.createElement("article");
    card.className = "alarm-card";
    card.innerHTML = `
      <div class="alarm-main">
        <div class="alarm-time">${formatTime(alarm.time)}</div>
        <div class="alarm-meta">
          <span class="badge">${repeatLabel(alarm.repeat)}</span>
          <span>${escapeHtml(alarm.label || "Alarm")}</span>
        </div>
      </div>
      <div class="alarm-actions">
        <button class="small-btn" data-action="edit" aria-label="Edit alarm">✎</button>
        <button class="small-btn delete" data-action="delete" aria-label="Delete alarm">×</button>
        <label class="switch" aria-label="Enable alarm">
          <input type="checkbox" ${alarm.enabled ? "checked" : ""} data-action="toggle">
          <span class="slider"></span>
        </label>
      </div>`;
    card.querySelector('[data-action="edit"]').onclick = () => openEdit(alarm.id);
    card.querySelector('[data-action="delete"]').onclick = () => deleteAlarm(alarm.id);
    card.querySelector('[data-action="toggle"]').onchange = e => {
      const item = alarms.find(x=>x.id===alarm.id);
      if (item) { item.enabled = e.target.checked; saveAlarms(); }
    };
    alarmList.appendChild(card);
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function openNew() {
  editingId = null;
  $("dialogTitle").textContent = "Add alarm";
  form.reset();
  document.querySelector('input[name="repeat"][value="once"]').checked = true;
  dialog.showModal();
}
function openEdit(id) {
  const a = alarms.find(x=>x.id===id); if (!a) return;
  editingId = id;
  $("dialogTitle").textContent = "Edit alarm";
  $("alarmTime").value = a.time;
  $("alarmLabel").value = a.label || "";
  const radio = document.querySelector(`input[name="repeat"][value="${a.repeat}"]`);
  if (radio) radio.checked = true;
  dialog.showModal();
}
function deleteAlarm(id) {
  if (!confirm("Delete this alarm?")) return;
  alarms = alarms.filter(a=>a.id!==id);
  saveAlarms(); renderAlarms();
}
form.addEventListener("submit", e => {
  e.preventDefault();
  const time = $("alarmTime").value;
  const label = $("alarmLabel").value.trim() || "Alarm";
  const repeat = document.querySelector('input[name="repeat"]:checked').value;
  if (!time) return;
  if (editingId) {
    const a = alarms.find(x=>x.id===editingId);
    Object.assign(a,{time,label,repeat});
  } else {
    alarms.push({id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), time,label,repeat,enabled:true,lastTriggered:null});
  }
  saveAlarms(); renderAlarms(); dialog.close();
});
$("addAlarmBtn").onclick = openNew;
$("closeDialog").onclick = () => dialog.close();
$("cancelBtn").onclick = () => dialog.close();

function updateClock() {
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2,"0");
  const s = String(now.getSeconds()).padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  $("clock").textContent = String(h).padStart(2,"0") + ":" + m;
  $("seconds").textContent = s;
  $("ampm").textContent = ampm;
  $("date").textContent = now.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric", year:"numeric"});
  const hour = now.getHours();
  $("greeting").textContent = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  checkAlarms(now);
}
function checkAlarms(now) {
  const hm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  alarms.forEach(a => {
    if (!a.enabled || a.time !== hm || now.getSeconds() !== 0 || !isTodayAllowed(a.repeat)) return;
    const key = `${todayKey()}-${hm}`;
    if (a.lastTriggered === key) return;
    a.lastTriggered = key;
    if (a.repeat === "once") a.enabled = false;
    saveAlarms(); renderAlarms(); ringAlarm(a);
  });
}
function ringAlarm(a) {
  ringingAlarm = a;
  $("ringTime").textContent = formatTime(a.time);
  $("ringLabel").textContent = a.label || "Alarm";
  $("alarmOverlay").hidden = false;
  startSound();
}
function startSound() {
  stopSound();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 880; gain.gain.value = .07;
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    ringTimer = setInterval(() => { osc.frequency.value = osc.frequency.value === 880 ? 660 : 880; }, 500);
    window.__alarmAudio = {ctx,osc,gain};
  } catch {}
}
function stopSound() {
  clearInterval(ringTimer);
  const a = window.__alarmAudio;
  if (a) { try { a.osc.stop(); a.ctx.close(); } catch {} window.__alarmAudio = null; }
}
$("stopBtn").onclick = () => {
  stopSound(); $("alarmOverlay").hidden = true; ringingAlarm = null;
};
$("snoozeBtn").onclick = () => {
  if (!ringingAlarm) return;
  stopSound(); $("alarmOverlay").hidden = true;
  const snooze = {...ringingAlarm, id:"snooze-"+Date.now(), time:new Date(Date.now()+5*60000).toTimeString().slice(0,5), repeat:"once", enabled:true, label:(ringingAlarm.label||"Alarm")+" (Snooze)", lastTriggered:null};
  alarms.push(snooze); saveAlarms(); renderAlarms();
};

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme==="dark");
  $("themeBtn").textContent = theme==="dark" ? "☀" : "☾";
  localStorage.setItem(THEME_KEY, theme);
}
$("themeBtn").onclick = () => applyTheme(document.body.classList.contains("dark") ? "light" : "dark");
applyTheme(localStorage.getItem(THEME_KEY) || "light");

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferredInstallPrompt = e; $("installCard").hidden = false;
});
$("installBtn").onclick = async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null; $("installCard").hidden = true;
};
window.addEventListener("appinstalled", () => { $("installCard").hidden = true; });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}

renderAlarms();
updateClock();
setInterval(updateClock, 1000);
