/* =============================================================
   HarzScan – Admin-Seite: Anmelden, Galerie, Labeln, CSV-Export
   ============================================================= */
(() => {
"use strict";
const CFG = window.HARZSCAN_CONFIG || {};
const BUCKET = CFG.bucket || "harzscan";
const LABELS = { harz_frisch: "Harz frisch", harz_alt: "Harz alt", kein_harz: "Kein Harz", unsicher: "Unsicher" };
const SHOTS = { nah: "Nahaufnahme", uebersicht: "Übersicht aus Stehhöhe", schraeg: "Schräg gegen das Licht" };
const ORDER = ["nah", "uebersicht", "schraeg"];
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT;
function toast(m, ms = 2600) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms); }
function status(cls, txt) { $("#status").className = "status " + cls; $("#statusText").textContent = txt; }

if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) {
  status("warn", "Noch keine Cloud eingerichtet – trage supabaseUrl und supabaseAnonKey in config.js ein (siehe Anleitung).");
  return;
}
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
const S = { photos: [], labels: {}, entries: [], urls: {}, open: null };

/* ---------- Login ---------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  if (data.session) { showMain(); load(); } else showLogin();
}
function showLogin() { $("#login").classList.remove("hidden"); $("#main").classList.add("hidden"); status("", "Bitte anmelden."); }
function showMain() { $("#login").classList.add("hidden"); $("#main").classList.remove("hidden"); }
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#pw").value });
  if (error) { toast("Anmeldung fehlgeschlagen: " + error.message, 4000); return; }
  showMain(); load();
});
$("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

/* ---------- Daten laden ---------- */
async function load() {
  status("", "Lade Daten …");
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("photos").select("*").order("taken_at", { ascending: false }).range(from, from + 999);
    if (error) { status("err", "Fehler beim Laden: " + error.message); return; }
    all.push(...data); if (data.length < 1000) break;
  }
  const lab = await sb.from("labels").select("*");
  if (lab.error) { status("err", "Fehler beim Laden der Labels: " + lab.error.message); return; }
  S.photos = all; S.labels = Object.fromEntries(lab.data.map(l => [l.entry_id, l]));
  group(); fillFilters(); render();
  status("ok", `${S.entries.length} Flecken · ${S.photos.length} Fotos (inkl. ersetzter)`);
}
// pro Fleck (entry_id) je Aufnahmeart nur das neueste Foto
function group() {
  const by = {};
  for (const p of S.photos) {
    const e = by[p.entry_id] || (by[p.entry_id] = { id: p.entry_id, shots: {}, all: [], hall: p.hall, plate: p.plate, at: p.taken_at });
    e.all.push(p);
    if (!e.shots[p.shot] || e.shots[p.shot].taken_at < p.taken_at) e.shots[p.shot] = p;
    if (p.vorlabel && (!e.vorlabelAt || p.taken_at > e.vorlabelAt)) { e.vorlabel = p.vorlabel; e.vorlabelAt = p.taken_at; }   // neuestes Vorab-Label
    if (p.taken_at < e.at) e.at = p.taken_at;
  }
  S.entries = Object.values(by).sort((a, b) => b.at.localeCompare(a.at));
}
function fillFilters() {
  const set = (id, vals, first) => { const el = $(id), cur = el.value; el.innerHTML = `<option value="">${first}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(""); el.value = vals.includes(cur) ? cur : ""; };
  set("#fHall", [...new Set(S.entries.map(e => e.hall).filter(Boolean))].sort(), "Alle Hallen");
  set("#fPlate", [...new Set(S.entries.map(e => e.plate).filter(Boolean))].sort(), "Alle Platten");
}
function filtered() {
  const h = $("#fHall").value, p = $("#fPlate").value, l = $("#fLabel").value;
  return S.entries.filter(e => (!h || e.hall === h) && (!p || e.plate === p) &&
    (!l || (l === "_none" ? !(S.labels[e.id] && S.labels[e.id].label) : S.labels[e.id] && S.labels[e.id].label === l)));
}
["#fHall", "#fPlate", "#fLabel"].forEach(id => $(id).addEventListener("change", render));
$("#reload").addEventListener("click", load);

async function signed(paths) {
  const need = paths.filter(p => p && !S.urls[p]);
  for (let i = 0; i < need.length; i += 100) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
    if (!error && data) data.forEach(d => { if (d.signedUrl) S.urls[d.path] = d.signedUrl; });
  }
}
function badge(e) {
  const l = S.labels[e.id] && S.labels[e.id].label;
  const vor = e.vorlabel ? ` <span class="hint">Vorab: ${esc(LABELS[e.vorlabel] || e.vorlabel)}${l && l !== e.vorlabel ? " ≠" : ""}</span>` : "";
  return (l ? `<span class="badge b-${esc(l)}">${esc(LABELS[l] || l)}</span>` : `<span class="badge b-none">ohne Label</span>`) + vor;
}
const fmt = t => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const firstShot = e => e.shots[ORDER.find(k => e.shots[k])] || e.all[0];

async function render() {
  const list = filtered();
  const cnt = {}; list.forEach(e => { const l = (S.labels[e.id] && S.labels[e.id].label) || "none"; cnt[l] = (cnt[l] || 0) + 1; });
  $("#stats").innerHTML = `<span class="stat">${list.length} Flecken</span>` + Object.entries(cnt).map(([k, n]) => `<span class="stat badge b-${esc(k)}">${k === "none" ? "ohne Label" : esc(LABELS[k])}: ${n}</span>`).join("");
  $("#empty").classList.toggle("hidden", !!list.length);
  $("#empty").textContent = "Keine Einträge.";
  await signed(list.map(e => firstShot(e).thumb_path));
  $("#grid").innerHTML = list.map(e => {
    const f = firstShot(e), u = S.urls[f.thumb_path];
    return `<button class="item" data-id="${esc(e.id)}">${u ? `<img loading="lazy" src="${esc(u)}" alt="">` : `<img alt="">`}<div><b>${esc(e.plate || "–")} · ${esc(fmt(e.at))}</b>${esc(e.hall)}<br>${badge(e)} <span class="hint">${Object.keys(e.shots).length} Fotos</span></div></button>`;
  }).join("");
  document.querySelectorAll(".item").forEach(b => b.addEventListener("click", () => openEntry(b.dataset.id)));
}

/* ---------- Detail ---------- */
async function openEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  S.open = id;
  const shots = ORDER.filter(k => e.shots[k]).map(k => e.shots[k]);
  await signed(shots.map(p => p.storage_path));
  const L = S.labels[e.id] || {};
  const tiltTxt = t => !t ? "–" : `${t.offFlat}° von waagerecht, Kamera ${t.camDown}° zum Boden`;
  $("#sheet").innerHTML = `
    <div class="row"><h2 style="margin:0">${esc(e.plate || "–")} · ${esc(fmt(e.at))}</h2><button class="btn sec" id="close" style="flex:0 0 auto;width:auto;padding:8px 14px">Schließen</button></div>
    <h3>Label</h3>
    ${e.vorlabel ? `<p class="hint" style="margin:0 0 6px">Bei der Aufnahme angegeben: <b>${esc(LABELS[e.vorlabel] || e.vorlabel)}</b></p>` : ""}
    <div class="chips">${Object.entries(LABELS).map(([k, t]) => `<button class="chip l-${k}" data-label="${k}" aria-pressed="${L.label === k}">${t}</button>`).join("")}</div>
    <label class="f" for="note">Notiz</label><textarea id="note" maxlength="500">${esc(L.note || "")}</textarea>
    <dl class="kv"><dt>Halle</dt><dd>${esc(e.hall)}</dd><dt>Platte</dt><dd>${esc(e.plate || "–")}</dd><dt>Gerät</dt><dd>${esc(String(e.all[0].device_id || "").slice(0, 8))}</dd><dt>Eintrag</dt><dd style="font-size:12px">${esc(e.id)}</dd></dl>
    ${shots.map(p => `<h3 style="margin:16px 0 2px">${esc(SHOTS[p.shot] || p.shot)}</h3>
      <a href="${esc(S.urls[p.storage_path] || "#")}" target="_blank" rel="noopener"><img src="${esc(S.urls[p.storage_path] || "")}" alt=""></a>
      <p class="hint">${esc(p.width)}×${esc(p.height)} px · ${((p.bytes || 0) / 1048576).toFixed(1)} MB · ${esc(p.source)}${p.retake ? " · neu aufgenommen" : ""}<br>
      Neigung: ${esc(tiltTxt(p.tilt))} · Helligkeit ${esc(p.quality && p.quality.bright)} · überbelichtet ${esc(p.quality && p.quality.over)} % · Schärfe ${esc(p.quality && p.quality.sharp)}</p>`).join("")}
    ${e.all.length > shots.length ? `<p class="hint">${e.all.length - shots.length} ersetzte Foto(s) werden beim Löschen mit entfernt.</p>` : ""}
    <button class="btn danger" id="del" style="margin-top:14px">Fleck löschen</button>`;
  $("#modal").classList.add("open");
  $("#close").addEventListener("click", closeEntry);
  document.querySelectorAll("#sheet [data-label]").forEach(b => b.addEventListener("click", async () => {
    const cur = S.labels[e.id] && S.labels[e.id].label;
    const lab = cur === b.dataset.label ? null : b.dataset.label;
    await saveLabel(e.id, { label: lab });
    document.querySelectorAll("#sheet [data-label]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.label === lab)));
  }));
  $("#note").addEventListener("change", ev => saveLabel(e.id, { note: ev.target.value }));
  const del = $("#del");
  del.addEventListener("click", async () => {
    if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Wirklich endgültig löschen? Nochmal klicken"; return; }
    del.disabled = true;
    const paths = e.all.flatMap(p => [p.storage_path, p.thumb_path]).filter(Boolean);
    const r1 = await sb.storage.from(BUCKET).remove(paths);
    const r2 = await sb.from("photos").delete().eq("entry_id", e.id);
    await sb.from("labels").delete().eq("entry_id", e.id);
    if (r1.error || r2.error) { toast("Löschen teilweise fehlgeschlagen: " + ((r1.error || r2.error).message)); del.disabled = false; return; }
    toast("Gelöscht"); closeEntry(); load();
  });
}
async function saveLabel(entryId, patch) {
  const cur = S.labels[entryId] || { entry_id: entryId, label: null, note: null };
  const row = Object.assign({}, { entry_id: entryId, label: cur.label, note: cur.note }, patch, { labeled_at: new Date().toISOString() });
  const { error } = await sb.from("labels").upsert(row);
  if (error) { toast("Speichern fehlgeschlagen: " + error.message, 4000); return; }
  S.labels[entryId] = row; toast("Gespeichert ✓", 1200); render();
}
function closeEntry() { S.open = null; $("#modal").classList.remove("open"); }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeEntry(); });

/* ---------- CSV ---------- */
$("#csv").addEventListener("click", () => {
  const head = ["entry_id", "photo_id", "halle", "platte", "label", "vorlabel", "notiz", "aufnahme", "storage_path", "breite", "hoehe", "bytes", "quelle", "neigung_von_waagerecht", "kamera_zum_boden", "beta", "gamma", "helligkeit", "ueberbelichtet_pct", "schaerfe", "zeit", "geraet"];
  const q = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [head.join(";")];
  filtered().forEach(e => ORDER.filter(k => e.shots[k]).forEach(k => {
    const p = e.shots[k], L = S.labels[e.id] || {}, t = p.tilt || {}, qq = p.quality || {};
    rows.push([e.id, p.id, p.hall, p.plate, L.label, p.vorlabel, L.note, p.shot, p.storage_path, p.width, p.height, p.bytes, p.source, t.offFlat, t.camDown, t.beta, t.gamma, qq.bright, qq.over, qq.sharp, p.taken_at, p.device_id].map(q).join(";"));
  }));
  const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "harzscan_" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

boot();
})();
