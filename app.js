/* =============================================================
   HarzScan – Helfer-App
   Ablauf: Einrichten → "Fotos aufnehmen" → Live-Kamera mit
   Wasserwaage → 3 Fotos → Warteschlange (IndexedDB) → Upload
   zu Supabase (oder Demo-Modus ohne Upload).
   ============================================================= */
(() => {
"use strict";

const APP_VERSION = "web-1.0";
const CFG = window.HARZSCAN_CONFIG || {};
const DEMO = !CFG.supabaseUrl || !CFG.supabaseAnonKey;
const BUCKET = CFG.bucket || "harzscan";
let sb = null;
try {
  if (!DEMO && window.supabase) sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: false } });
} catch (e) { console.error(e); }

const STEPS = [
  { k: "nah",        t: "Nah",       req: true,  target: "flat",  line: "Handy ca. 30 cm über den Fleck, waagerecht – Fleck und Platte füllen den Rahmen" },
  { k: "uebersicht", t: "Übersicht", req: true,  target: "flat",  line: "Aufrecht stehen, Handy auf Brusthöhe waagerecht nach unten – Fleck und Platte im Bild" },
  { k: "schraeg",    t: "Schräg",    req: false, target: "oblique", line: "1 m zurücktreten, flach gegen das Hallenlicht (ca. 30° zum Boden) – Platte im Bild" }
];

/* ---------- kleine Helfer ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem("hs_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hs_" + k, JSON.stringify(v)); } catch {} }
};
let toastT;
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms); }

const S = {
  hall: store.get("hall", ""), plate: store.get("plate", ""), consent: store.get("consent", false),
  device: store.get("device", null),
  cur: null, last: null, stream: null, sysMode: false, ori: null, oriAsked: false,
  queue: [], uploading: false, lastError: null, uploadedCount: store.get("uploaded", 0)
};
if (!S.device) { S.device = uuid(); store.set("device", S.device); }
if (CFG.projectName) $("#projName").textContent = CFG.projectName;
if (CFG.contact) $("#privacy").textContent += " Verantwortlich: " + CFG.contact + ".";

/* ---------- IndexedDB-Warteschlange (Fotos überleben Neuladen & Funklöcher) ---------- */
const idb = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("harzscan", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("queue", { keyPath: "id" });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("queue", mode); const st = t.objectStore("queue"); const out = fn(st); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  return {
    put: item => tx("readwrite", st => st.put(item)),
    del: id => tx("readwrite", st => st.delete(id)),
    all: () => tx("readonly", st => st.getAll())
  };
})();

/* ---------- Status ---------- */
function updateStatus() {
  const el = $("#status"), tx = $("#statusText"); el.className = "status";
  const n = S.queue.length;
  if (DEMO) { el.classList.add("warn"); tx.textContent = `Demo-Modus: Fotos bleiben auf diesem Handy (${n} gespeichert). Für den Upload config.js ausfüllen.`; return; }
  if (!sb) { el.classList.add("err"); tx.textContent = "Cloud-Bibliothek konnte nicht geladen werden – Internetverbindung prüfen und neu laden."; return; }
  if (n && S.lastError) { el.classList.add("warn"); tx.textContent = `${n} Foto(s) warten auf Upload – ${S.lastError}`; return; }
  if (n) { el.classList.add("ok"); tx.textContent = `Lade hoch … noch ${n} Foto(s)`; return; }
  el.classList.add("ok"); tx.textContent = `Bereit · ${S.uploadedCount} Fotos von diesem Handy hochgeladen`;
}
function renderQueue() {
  const c = $("#queueCard"); const n = S.queue.length;
  if (!n) { c.classList.add("hidden"); return; }
  c.classList.remove("hidden");
  c.innerHTML = DEMO
    ? `<h2>Auf dem Handy gespeichert: ${n} Foto(s)</h2><p class="hint">Im Demo-Modus wird nichts hochgeladen. Sobald die Cloud eingerichtet ist, werden diese Fotos automatisch nachgeladen.</p>`
    : `<h2>Warteschlange: ${n} Foto(s)</h2><p class="hint">${S.lastError ? "Letzter Fehler: " + esc(S.lastError) : "Wird gerade hochgeladen …"}</p><button class="btn sec" id="retry" style="margin-top:8px">Jetzt erneut versuchen</button>`;
  const r = $("#retry"); if (r) r.addEventListener("click", () => { S.lastError = null; pump(); });
}

/* ---------- Bildanalyse ---------- */
function analyse(src, W, H) {
  const sc = 384 / Math.max(W, H), w = Math.max(8, Math.round(W * sc)), h = Math.max(8, Math.round(H * sc));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, n = w * h, Y = new Float32Array(n);
  let sum = 0, clip = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) { const y = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]; Y[i] = y; sum += y; if (y > 250) clip++; }
  let s1 = 0, s2 = 0, m = 0;
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx, L = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w]; s1 += L; s2 += L * L; m++; }
  const mean = s1 / m;
  return { bright: Math.round(sum / n), over: Math.round(clip / n * 1000) / 10, sharp: Math.round(s2 / m - mean * mean) };
}
function hints(q, W, H) {
  const o = [];
  if (q.bright < 55) o.push("eher dunkel");
  if (q.over > 3) o.push("Glanzstellen überbelichtet");
  if (q.sharp < 6) o.push("evtl. unscharf");
  if (Math.max(W, H) < 2500) o.push("geringe Auflösung (" + W + "×" + H + ")");
  return o;
}
function toBlob(canvas, q) { return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("Bild konnte nicht erzeugt werden")), "image/jpeg", q)); }
async function thumbOf(src, W, H) {
  const sc = 400 / Math.max(W, H), c = document.createElement("canvas");
  c.width = Math.round(W * sc); c.height = Math.round(H * sc);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return toBlob(c, 0.75);
}

/* ---------- Neigung (Wasserwaage) ---------- */
function onOri(e) { if (e.beta == null) return; S.ori = { beta: e.beta, gamma: e.gamma, alpha: e.alpha }; drawLevel(); }
async function enableOrientation() {
  if (S.oriAsked) return; S.oriAsked = true;
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== "granted") { toast("Ohne Bewegungssensor keine Wasserwaage – Fotos gehen trotzdem."); return; }
    }
    window.addEventListener("deviceorientation", onOri);
  } catch { /* kein Sensor */ }
}
function tiltInfo() {
  if (!S.ori) return null;
  const { beta, gamma } = S.ori;
  const off = Math.round(Math.sqrt(beta * beta + gamma * gamma));   // Abweichung von waagerecht
  const down = Math.round(90 - beta);                                  // Kamera-Winkel unter der Horizontalen (Hochformat)
  return { beta: Math.round(beta * 10) / 10, gamma: Math.round(gamma * 10) / 10, offFlat: off, camDown: down };
}
function drawLevel() {
  if (!S.cur || $("#cam").classList.contains("hidden")) return;
  const st = STEPS[S.cur.step] || STEPS[0], lv = $("#level"), b = $("#bubble"), tx = $("#levtxt");
  const t = tiltInfo();
  if (!t) { tx.textContent = "Neigung –"; lv.classList.remove("good"); b.style.transform = ""; return; }
  if (st.target === "flat") {
    const cl = v => Math.max(-1, Math.min(1, v / 15)) * 26;
    b.style.transform = `translate(${cl(S.ori.gamma)}px, ${cl(S.ori.beta)}px)`;
    const good = t.offFlat <= 4;
    lv.classList.toggle("good", good);
    tx.textContent = good ? "waagerecht ✓" : `${t.offFlat}° schief`;
  } else {
    const good = t.camDown >= 20 && t.camDown <= 40;
    b.style.transform = `translate(0px, ${Math.max(-1, Math.min(1, (t.camDown - 30) / 30)) * 26}px)`;
    lv.classList.toggle("good", good);
    tx.textContent = `${t.camDown}° zum Boden` + (good ? " ✓" : "");
  }
}

/* ---------- Kamera ---------- */
async function startStream() {
  if (S.stream) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 } } });
    const v = $("#video"); v.srcObject = S.stream; await v.play().catch(() => {});
    return true;
  } catch (e) { console.warn(e); return false; }
}
function stopStream() { if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } $("#video").srcObject = null; }

async function openCamera() {
  await enableOrientation();               // muss direkt im Klick passieren (iOS)
  if (!S.cur) S.cur = { entryId: uuid(), step: 0, slots: {}, at: Date.now() };
  $("#cam").classList.remove("hidden"); document.body.style.overflow = "hidden"; document.body.classList.add("camopen");
  renderCam();
  if (!S.sysMode) {
    const ok = await startStream();
    if (!ok) { S.sysMode = true; toast("Live-Kamera nicht verfügbar – nutze die Systemkamera."); renderCam(); }
  }
}
function closeCamera() {
  stopStream(); $("#cam").classList.add("hidden"); document.body.style.overflow = ""; document.body.classList.remove("camopen");
  if (S.cur && Object.keys(S.cur.slots).length) S.last = S.cur;
  S.cur = null; renderHome();
}
function renderCam() {
  const E = S.cur; if (!E) return;
  const st = STEPS[Math.min(E.step, 2)];
  $("#cStep").textContent = `Foto ${Math.min(E.step, 2) + 1} von 3` + (st.req ? "" : " · optional");
  $("#cTitle").textContent = st.t; $("#cLine").textContent = st.line;
  $("#skip").classList.toggle("hidden", st.req);
  $("#sysCam").textContent = S.sysMode ? "Live-Kamera" : "Systemkamera";
  $("#video").classList.toggle("hidden", S.sysMode);
  $(".frame").classList.toggle("hidden", S.sysMode);
  const v = $("#video");
  $("#res").textContent = S.sysMode ? "Systemkamera: volle Auflösung, öffnet sich beim Auslösen" : (v.videoWidth ? `Live-Kamera ${v.videoWidth}×${v.videoHeight}` : "");
  $("#strip").innerHTML = STEPS.map((s, i) => {
    const sl = E.slots[s.k];
    return `<button class="slot ${i === E.step ? "cur" : ""}" data-i="${i}">${sl && sl.url ? `<img src="${sl.url}" alt="">` : ""}<span>${i + 1} ${s.t}${sl ? (sl.skipped ? " –" : " ✓") : ""}</span></button>`;
  }).join("");
  document.querySelectorAll("#strip .slot").forEach(b => b.addEventListener("click", () => { E.step = +b.dataset.i; renderCam(); drawLevel(); }));
  drawLevel();
}
$("#video").addEventListener("loadedmetadata", renderCam);

async function captureLive() {
  const v = $("#video");
  for (let i = 0; i < 20 && !(v.videoWidth && v.readyState >= 2); i++) await sleep(100);   // Kamera noch nicht bereit? kurz warten
  const W = v.videoWidth, H = v.videoHeight;
  if (!W) { toast("Kamera startet noch … bitte nochmal auslösen"); return; }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  c.getContext("2d").drawImage(v, 0, 0, W, H);
  flash();
  const tilt = tiltInfo();
  const blob = await toBlob(c, 0.92);
  await saveShot({ blob, src: c, W, H, tilt, source: "live" });
}
async function captureFile(file) {
  const tilt = tiltInfo();
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Bild nicht lesbar")); im.src = URL.createObjectURL(file); }); }
  const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
  let blob = file;
  if (file.type !== "image/jpeg" || file.size > 19.5 * 1048576) {
    const s = Math.min(1, Math.sqrt(16e6 / (W * H))), c = document.createElement("canvas");
    c.width = Math.round(W * s); c.height = Math.round(H * s); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    blob = await toBlob(c, 0.92);
  }
  await saveShot({ blob, src: bmp, W, H, tilt, source: "system" });
}
function flash() { const f = $("#flash"); f.classList.add("on"); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove("on"))); }

async function saveShot({ blob, src, W, H, tilt, source }) {
  const E = S.cur; if (!E) return;
  const st = STEPS[E.step];
  const q = analyse(src, W, H);
  const thumb = await thumbOf(src, W, H);
  // gleiche Aufnahme ersetzt? alten, noch nicht hochgeladenen Eintrag verwerfen
  const old = E.slots[st.k];
  if (old && old.photoId && S.queue.some(x => x.id === old.photoId)) { await idb.del(old.photoId).catch(() => {}); }
  const photoId = uuid();
  const item = {
    id: photoId, entryId: E.entryId, shot: st.k, blob, thumb,
    meta: { hall: S.hall, plate: S.plate, device_id: S.device, taken_at: new Date().toISOString(), width: W, height: H, bytes: blob.size, source, quality: q, tilt, app_version: APP_VERSION, retake: !!old }
  };
  await idb.put(item);
  E.slots[st.k] = { photoId, url: URL.createObjectURL(thumb), hints: hints(q, W, H) };
  const h = E.slots[st.k].hints;
  toast(h.length ? "Gespeichert – Hinweis: " + h.join(", ") : `${st.t} gespeichert ✓`, h.length ? 3500 : 1500);
  // nächster offener Schritt
  const next = STEPS.findIndex(s => !E.slots[s.k]);
  if (next === -1) { S.last = E; S.cur = null; closeCamera(); toast("Fleck fertig ✓ – danke!"); }
  else { E.step = next; renderCam(); }
  await loadQueue(); pump();
}

$("#shutter").addEventListener("click", () => {
  if (S.sysMode) { const f = $("#fileCam"); f.value = ""; f.click(); }
  else captureLive().catch(e => toast("Fehler: " + e.message));
});
$("#fileCam").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f) captureFile(f).catch(err => toast("Fehler: " + err.message)); });
$("#skip").addEventListener("click", () => {
  const E = S.cur; const st = STEPS[E.step]; if (st.req) return;
  E.slots[st.k] = { skipped: true };
  const next = STEPS.findIndex(s => !E.slots[s.k]);
  if (next === -1) { S.last = E; closeCamera(); toast("Fleck fertig ✓ – danke!"); } else { E.step = next; renderCam(); }
});
$("#sysCam").addEventListener("click", async () => {
  S.sysMode = !S.sysMode;
  if (S.sysMode) stopStream(); else if (!(await startStream())) { S.sysMode = true; toast("Live-Kamera nicht verfügbar."); }
  renderCam();
});
$("#cClose").addEventListener("click", () => {
  const E = S.cur;
  if (E && STEPS.some(s => s.req && !E.slots[s.k]) && Object.keys(E.slots).length) toast("Fleck unvollständig gespeichert");
  closeCamera();
});

/* ---------- Upload ---------- */
async function loadQueue() {
  try { S.queue = (await idb.all()).sort((a, b) => a.meta.taken_at.localeCompare(b.meta.taken_at)); } catch { S.queue = []; }
  updateStatus(); renderQueue(); renderLast();
}
function isExists(err) { return err && (String(err.statusCode) === "409" || /exist|duplicate/i.test(err.message || "")); }
async function uploadOne(it) {
  const base = `${it.entryId}/${it.shot}-${it.id}`;
  const up1 = await sb.storage.from(BUCKET).upload(base + ".jpg", it.blob, { contentType: "image/jpeg", upsert: false });
  if (up1.error && !isExists(up1.error)) throw up1.error;
  const up2 = await sb.storage.from(BUCKET).upload(base + "_thumb.jpg", it.thumb, { contentType: "image/jpeg", upsert: false });
  if (up2.error && !isExists(up2.error)) throw up2.error;
  const row = Object.assign({ id: it.id, entry_id: it.entryId, shot: it.shot, storage_path: base + ".jpg", thumb_path: base + "_thumb.jpg" }, it.meta);
  const ins = await sb.from("photos").insert(row);
  if (ins.error && ins.error.code !== "23505") throw ins.error;
}
async function pump() {
  if (DEMO || !sb || S.uploading) return;
  S.uploading = true;
  try {
    while (true) {
      await loadQueue();
      const it = S.queue[0]; if (!it) { S.lastError = null; break; }
      if (!navigator.onLine) { S.lastError = "kein Internet"; break; }
      try {
        await uploadOne(it);
        await idb.del(it.id);
        S.uploadedCount++; store.set("uploaded", S.uploadedCount); S.lastError = null;
      } catch (e) {
        console.warn(e);
        S.lastError = (e && e.message) ? e.message : "Upload fehlgeschlagen";
        break;
      }
    }
  } finally {
    S.uploading = false; await loadQueue();
    if (S.queue.length) setTimeout(pump, 20000);
  }
}
window.addEventListener("online", () => { S.lastError = null; pump(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) pump(); });

/* ---------- Startseite ---------- */
function renderLast() {
  const L = S.last, el = $("#last"); if (!el) return;
  if (!L) { el.innerHTML = ""; return; }
  const pending = id => S.queue.some(x => x.id === id);
  el.innerHTML = `<h3>Letzter Fleck <span class="hint">– antippen zum Neu-Aufnehmen</span></h3><div class="thumbs">${STEPS.map((s, i) => {
    const sl = L.slots[s.k];
    const ov = !sl ? "" : sl.skipped ? "–" : pending(sl.photoId) ? (DEMO ? "📱" : '<span class="spin"></span>') : '<span style="color:var(--ok)">✓</span>';
    return `<button class="th" data-i="${i}"><div class="im">${sl && sl.url ? `<img src="${sl.url}" alt="">` : (i + 1)}${ov ? `<span class="ov">${ov}</span>` : ""}</div><div class="t">${s.t}</div></button>`;
  }).join("")}</div>${STEPS.map(s => L.slots[s.k]).filter(sl => sl && sl.hints && sl.hints.length).map(sl => `<div class="q"><span class="w">⚠︎ ${esc(sl.hints.join(", "))}</span></div>`).join("")}`;
  el.querySelectorAll(".th").forEach(b => b.addEventListener("click", () => { S.cur = L; L.step = +b.dataset.i; openCamera(); }));
}
function renderHome() {
  const ready = S.hall && S.consent;
  $("#setup").classList.toggle("hidden", !!ready);
  $("#home").classList.toggle("hidden", !ready);
  if (!ready) { $("#hall").value = S.hall; $("#plate").value = S.plate; $("#consent").checked = !!S.consent; return; }
  $("#hHall").textContent = S.hall; $("#hPlate").textContent = S.plate || "–";
  renderLast(); renderQueue(); updateStatus();
}
$("#saveSetup").addEventListener("click", () => {
  const h = $("#hall").value.trim(); if (!h) { toast("Bitte die Halle eintragen."); return; }
  if (!$("#consent").checked) { toast("Bitte die Hinweise bestätigen."); return; }
  S.hall = h.slice(0, 80); S.plate = $("#plate").value.trim().toUpperCase().slice(0, 12); S.consent = true;
  store.set("hall", S.hall); store.set("plate", S.plate); store.set("consent", true); renderHome();
});
$("#editSetup").addEventListener("click", () => { S.consent = false; renderHome(); });
$("#start").addEventListener("click", () => { S.cur = null; openCamera(); });

renderHome();
loadQueue().then(pump);
})();
