// Anonyme Zählung: pro Tag und Ereignis nur eine Zahl. Keine IP, keine Kennung, keine Cookies.
const EREIGNISSE = new Set(["besuch", "besuch_mall", "check_offen", "check_start", "check_fertig", "fahrstunde_offen", "fahrstunde_fertig", "klick_online", "klick_plus", "klick_mall", "klick_termine", "klick_club", "mission_start", "checkin_gesendet", "teaser_antwort", "klick_termin"]);
const NAMEN = { besuch: "Seitenaufrufe", besuch_mall: "Seitenaufrufe Mall-Tablet", check_offen: "KI-Check geöffnet", check_start: "KI-Check: Blitzrunde begonnen", check_fertig: "KI-Check beendet", fahrstunde_offen: "Probe-Fahrstunde geöffnet", fahrstunde_fertig: "Probe-Fahrstunde ausgefüllt", klick_online: "Klick: Führerschein online", klick_plus: "Klick: Führerschein Plus", klick_mall: "Klick: Workshop (alt)", klick_termine: "Klick: Termine ansehen", klick_club: "Klick: Club", mission_start: "Mission begonnen", checkin_gesendet: "Auswertung angefordert", teaser_antwort: "Startseite: Frage beantwortet", klick_termin: "Klick: Platz buchen (Hub-Termin)" };
const heute = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

const SCHLUESSEL_HASH = "0964dc246aa45b1c7239dcb22ebdaff19c317a0d325331f189a0abad6161302b"; // SHA-256 des Zugangsschlüssels für /eingang (der Schlüssel selbst steht nicht im Code)
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kurz = (v, n) => String(v ?? "").slice(0, n);
async function sha256(t) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const TM_BILD = "https://static.wixstatic.com/media/ef51c2_9c42c80b072d496b959c9bed1048a5c5~mv2.jpg/v1/fill/w_960,h_720,al_c,q_85/ef51c2_9c42c80b072d496b959c9bed1048a5c5~mv2.jpg";
const ALTER = new Set(["8-10", "11-13", "14-16"]);

// Hub-Termine: werden von der Terminseite von Tomorrow Minds gelesen und 15 Minuten zwischengespeichert.
const TM_TERMINE = "https://www.tomorrowminds.de/events";
const HUB = /\b(lab|hub)\b/i; // Welche Termine als Hub-Termine gelten
const entities = s => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
async function termine() {
  const kopf = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=900" };
  try {
    const r = await fetch(TM_TERMINE, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (!r.ok) throw new Error("Status " + r.status);
    const html = await r.text();
    const liste = (html.match(/<a href="\/events\/[^"]+"[\s\S]*?<\/a>/g) || []).map(b => {
      const url = "https://www.tomorrowminds.de" + b.match(/href="([^"]+)"/)[1];
      const t = b.replace(/<img[^>]*>/g, "").split(/<[^>]+>/).map(x => entities(x).trim()).filter(Boolean);
      return { datum: t[0] || "", titel: t[1] || "", ort: t[2] || "", preis: (t[3] || "").replace(/^·\s*/, ""), url };
    }).filter(t => t.titel && HUB.test(t.titel));
    return new Response(JSON.stringify({ termine: liste }), { headers: kopf });
  } catch (e) {
    return new Response(JSON.stringify({ termine: [], fehler: true }), { status: 502, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}

async function checkin(request, env) {
  let d; try { d = await request.json(); } catch (e) { return new Response("ungültig", { status: 400 }); }
  const mail = kurz(d.mail, 120).trim();
  if (d.ok !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || !ALTER.has(d.alter)) return new Response("ungültig", { status: 400 });
  const liste = (v, n) => JSON.stringify((Array.isArray(v) ? v : []).slice(0, n).map(x => typeof x === "boolean" ? x : kurz(x, 60)));
  await env.DB.prepare("INSERT INTO checkins (id, erstellt, spitzname, altersgruppe, interessen, ki_erfahrung, blitz, app_art, idee, app_name, auftrag, antwort, angetippt, eigenanteil, bemerkt, eltern_email, mall) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)")
    .bind(crypto.randomUUID(), new Date().toISOString(), kurz(d.name, 24), d.alter, liste(d.inter, 3), kurz(d.erf, 12), liste(d.blitz, 5), kurz(d.art, 40), kurz(d.idee, 400), kurz(d.app, 40), kurz(d.auftrag, 600), kurz(d.antwort, 600), liste(d.falsch, 3), kurz(d.eigen, 8), liste(d.bemerkt, 3), mail, d.mall ? 1 : 0).run();
  return new Response(null, { status: 204 });
}

async function eingang(url, env) {
  if (await sha256(url.searchParams.get("key") || "") !== SCHLUESSEL_HASH) return new Response("Nicht gefunden", { status: 404 });
  const { results } = await env.DB.prepare("SELECT * FROM checkins ORDER BY erstellt DESC LIMIT 200").all();
  const zeile = (k, v) => v ? `<p><b>${k}:</b> ${esc(v)}</p>` : "";
  const karten = results.map(r => `<article><h2>${esc(r.spitzname)} · ${esc(r.altersgruppe)} · „${esc(r.app_name)}“</h2><p class="s">${esc(r.erstellt.slice(0, 16).replace("T", " "))} UTC${r.mall ? " · Mall" : ""} · <a href="mailto:${esc(r.eltern_email)}?subject=${encodeURIComponent(r.spitzname + "s KI-Check: die Idee, zwei Stärken und ein nächster Schritt")}">${esc(r.eltern_email)}</a></p>
${zeile("Interessen", r.interessen)}${zeile("KI-Erfahrung", r.ki_erfahrung)}${zeile("Blitzrunde (Fahrrad, Hund, Pinguin, Stimme, Eis)", r.blitz)}${zeile("Art der Überraschung", r.app_art)}${zeile("Idee", r.idee)}${zeile("Auftrag an Kiki", r.auftrag)}${zeile("Antwort an Kiki", r.antwort)}${zeile("Angetippt (8–10)", r.angetippt)}${zeile("Eigenanteil", r.eigenanteil)}${zeile("Fallen selbst bemerkt", r.bemerkt)}</article>`).join("");
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Eingang – KI-Check</title>
<style>body{font-family:system-ui,sans-serif;margin:24px auto;max-width:820px;padding:0 16px;color:#1C1A3F;background:#FFF8EC}article{background:#fff;border-radius:14px;padding:16px 20px;margin:14px 0;border:2px solid #1C1A3F}h2{margin:0 0 4px;font-size:1.15rem}p{margin:.35em 0}.s{color:#4E4B6B;font-size:.9rem}</style></head><body>
<h1>Eingang: KI-Checks (${results.length})</h1><p class="s">Enthält Angaben von Kindern und E-Mail-Adressen der Eltern. Bitte den Link nicht weitergeben. Einträge werden nach 90 Tagen gelöscht.</p>${karten || "<p>Noch keine Einträge.</p>"}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.kifuehrerschein.jetzt") { url.hostname = "kifuehrerschein.jetzt"; return Response.redirect(url.toString(), 301); }
    if (url.pathname === "/api/e" && request.method === "POST") {
      const ev = (await request.text()).slice(0, 40);
      const ua = request.headers.get("user-agent") || "";
      if (EREIGNISSE.has(ev) && !/bot|crawl|spider|preview|monitor/i.test(ua)) {
        await env.DB.prepare("INSERT INTO zahlen (tag, ereignis, anzahl) VALUES (?1, ?2, 1) ON CONFLICT(tag, ereignis) DO UPDATE SET anzahl = anzahl + 1").bind(heute(), ev).run();
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/checkin" && request.method === "POST") return checkin(request, env);
    if (url.pathname === "/eingang") return eingang(url, env);
    if (url.pathname === "/api/termine") return termine();
    if (url.pathname === "/bild/tomorrow-minds.jpg") {
      // Bild von der Tomorrow-Minds-Website, über die eigene Adresse ausgeliefert (Besucher kontaktieren keinen fremden Server).
      const r = await fetch(TM_BILD, { cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!r.ok) return new Response("Bild nicht verfügbar", { status: 502 });
      return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "public, max-age=86400" } });
    }
    if (url.pathname === "/zahlen") {
      const { results } = await env.DB.prepare("SELECT tag, ereignis, anzahl FROM zahlen WHERE tag >= date('now', '-30 day') ORDER BY tag DESC").all();
      const tage = [...new Set(results.map(r => r.tag))];
      const get = (t, e) => (results.find(r => r.tag === t && r.ereignis === e) || {}).anzahl || 0;
      const keys = [...EREIGNISSE];
      const sum = e => results.filter(r => r.ereignis === e).reduce((a, r) => a + r.anzahl, 0);
      const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Zahlen – KI-Führerschein</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1C1A3F;background:#FFF8EC}h1{margin:0 0 4px}table{border-collapse:collapse;background:#fff;margin-top:16px}th,td{border:1px solid #ddd;padding:8px 10px;text-align:right;font-size:14px}th:first-child,td:first-child{text-align:left}thead th{background:#1C1A3F;color:#fff;font-weight:600}tfoot td{font-weight:700;background:#FFD43B}.w{overflow-x:auto}</style></head><body>
<h1>Zahlen der letzten 30 Tage</h1><p>Anonyme Zählung, je Tag und Ereignis. Ein Seitenaufruf ist kein eindeutiger Besucher: Wer die Seite zweimal lädt, zählt zweimal.</p>
<div class="w"><table><thead><tr><th>Tag</th>${keys.map(k => `<th>${NAMEN[k]}</th>`).join("")}</tr></thead>
<tbody>${tage.map(t => `<tr><td>${t}</td>${keys.map(k => `<td>${get(t, k)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${keys.length + 1}">Noch keine Zahlen.</td></tr>`}</tbody>
<tfoot><tr><td>Summe</td>${keys.map(k => `<td>${sum(k)}</td>`).join("")}</tr></tfoot></table></div></body></html>`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    return env.ASSETS.fetch(request);
  },
  // Täglich: Einträge löschen, die älter als 90 Tage sind.
  async scheduled(event, env) {
    await env.DB.prepare("DELETE FROM checkins WHERE erstellt < ?1").bind(new Date(Date.now() - 90 * 864e5).toISOString()).run();
  }
};
