// Anonyme Zählung: pro Tag und Ereignis nur eine Zahl. Keine IP, keine Kennung, keine Cookies.
const EREIGNISSE = new Set(["besuch", "besuch_mall", "check_offen", "check_start", "check_fertig", "fahrstunde_offen", "fahrstunde_fertig", "klick_online", "klick_plus", "klick_mall", "klick_termine", "klick_club"]);
const NAMEN = { besuch: "Seitenaufrufe", besuch_mall: "Seitenaufrufe Mall-Tablet", check_offen: "KI-Check geöffnet", check_start: "KI-Check begonnen", check_fertig: "KI-Check beendet", fahrstunde_offen: "Probe-Fahrstunde geöffnet", fahrstunde_fertig: "Probe-Fahrstunde ausgefüllt", klick_online: "Klick: Führerschein online", klick_plus: "Klick: Führerschein Plus", klick_mall: "Klick: Mall-Workshop", klick_termine: "Klick: Termine", klick_club: "Klick: Club" };
const heute = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/e" && request.method === "POST") {
      const ev = (await request.text()).slice(0, 40);
      const ua = request.headers.get("user-agent") || "";
      if (EREIGNISSE.has(ev) && !/bot|crawl|spider|preview|monitor/i.test(ua)) {
        await env.DB.prepare("INSERT INTO zahlen (tag, ereignis, anzahl) VALUES (?1, ?2, 1) ON CONFLICT(tag, ereignis) DO UPDATE SET anzahl = anzahl + 1").bind(heute(), ev).run();
      }
      return new Response(null, { status: 204 });
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
  }
};
