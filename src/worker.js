import { EmailMessage } from "cloudflare:email";
// Anonyme Zählung: pro Tag und Ereignis nur eine Zahl. Keine IP, keine Kennung, keine Cookies.
const EREIGNISSE = new Set(["besuch", "besuch_mall", "check_offen", "check_start", "check_fertig", "fahrstunde_offen", "fahrstunde_fertig", "klick_online", "klick_plus", "klick_mall", "klick_termine", "klick_club", "mission_start", "checkin_gesendet", "teaser_antwort", "klick_termin", "klick_gutschein", "gutschein_bestellt", "gutschein_angezeigt"]);
const NAMEN = { besuch: "Seitenaufrufe", besuch_mall: "Seitenaufrufe Mall-Tablet", check_offen: "KI-Check geöffnet", check_start: "KI-Check: Blitzrunde begonnen", check_fertig: "KI-Check beendet", fahrstunde_offen: "Probe-Fahrstunde geöffnet", fahrstunde_fertig: "Probe-Fahrstunde ausgefüllt", klick_online: "Klick: Führerschein online", klick_plus: "Klick: Führerschein Plus", klick_mall: "Klick: Workshop (alt)", klick_termine: "Klick: Termine ansehen", klick_club: "Klick: Club", mission_start: "Mission begonnen", checkin_gesendet: "Auswertung angefordert", teaser_antwort: "Startseite: Frage beantwortet", klick_termin: "Klick: Workshop buchen (Lab-Termin)", klick_gutschein: "Klick: Gutschein kaufen", gutschein_bestellt: "Gutschein: weiter zu PayPal", gutschein_angezeigt: "Gutschein angezeigt" };
const heute = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

const SCHLUESSEL_HASH = "0964dc246aa45b1c7239dcb22ebdaff19c317a0d325331f189a0abad6161302b"; // SHA-256 des Zugangsschlüssels für /eingang (der Schlüssel selbst steht nicht im Code)
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kurz = (v, n) => String(v ?? "").slice(0, n);
async function sha256(t) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const TM_BILD = "https://static.wixstatic.com/media/ef51c2_9c42c80b072d496b959c9bed1048a5c5~mv2.jpg/v1/fill/w_960,h_720,al_c,q_85/ef51c2_9c42c80b072d496b959c9bed1048a5c5~mv2.jpg";
const ALTER = new Set(["8-10", "11-13", "14-16"]);

// Lab-Termine: werden von der Terminseite von Tomorrow Minds gelesen und 15 Minuten zwischengespeichert.
const TM_TERMINE = "https://www.tomorrowminds.de/events";
const HUB = /\blab\b/i; // Welche Termine als Lab-Termine gelten
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

// Kurze Meldung an Thomas bei jedem neuen KI-Check. Enthält bewusst keine Angaben des Kindes und keine Eltern-Adresse.
const MELDUNG_VON = "kiki@kifuehrerschein.jetzt", MELDUNG_AN = "thomas@tomorrowminds.de";
const jetzt = () => new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
async function melden(env, alter, mall) {
  return meldung(env, "Neuer KI-Check (" + alter + ")", `Ein neuer KI-Check ist eingegangen.\n\nAltersgruppe: ${alter}\nZeit: ${jetzt()} Uhr${mall ? "\nOrt: Mall-Tablet" : ""}\n\nDie Antworten stehen im Eingang (dein gespeicherter Link). Die Eltern erwarten die Auswertung innerhalb von 24 Stunden.\n`);
}
async function meldung(env, betreff, text) {
  if (!env.MELDUNG) return "keine Bindung MELDUNG";
  try {
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const roh = [`From: KI-Fuehrerschein <${MELDUNG_VON}>`, `To: ${MELDUNG_AN}`, `Subject: =?UTF-8?B?${b64(betreff)}?=`, `Message-ID: <${crypto.randomUUID()}@kifuehrerschein.jetzt>`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(text).replace(/(.{76})/g, "$1\r\n")].join("\r\n");
    await env.MELDUNG.send(new EmailMessage(MELDUNG_VON, MELDUNG_AN, roh));
    return "gesendet";
  } catch (e) { console.log("Meldung fehlgeschlagen: " + (e && e.message)); return "Fehler: " + (e && e.message); }
}

// ---------- Gutscheine ----------
// Ablauf: Bestellung legt einen Code an (Status "offen") → Zahlung über PayPal → PayPal meldet die Zahlung an /api/paypal-ipn
// → Status "bezahlt" → der Gutschein ist unter /?g=CODE druckbar. Fallback: Freischalten von Hand im Eingang.
const GS_PREIS = "39.00", GS_EMPFAENGER = "info@cuup.de", SEITE = "https://kifuehrerschein.jetzt";
const GS_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GS_CODE = /^KIKI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
function neuerCode() {
  const z = crypto.getRandomValues(new Uint8Array(8));
  const s = [...z].map(b => GS_ZEICHEN[b % 32]).join("");
  return "KIKI-" + s.slice(0, 4) + "-" + s.slice(4);
}
function paypalLink(code) {
  const p = new URLSearchParams({ cmd: "_xclick", business: GS_EMPFAENGER, currency_code: "EUR", amount: GS_PREIS, item_name: "Gutschein KI-Führerschein " + code, item_number: code, custom: code, invoice: code, no_shipping: "1", charset: "utf-8", lc: "DE", rm: "1", notify_url: SEITE + "/api/paypal-ipn", return: SEITE + "/?g=" + code, cancel_return: SEITE + "/?g=" + code });
  return "https://www.paypal.com/cgi-bin/webscr?" + p.toString();
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function gutscheinBestellen(request, env) {
  let d; try { d = await request.json(); } catch (e) { return json({ fehler: "ungültig" }, 400); }
  const mail = kurz(d.mail, 120).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return json({ fehler: "mail" }, 400);
  const jahr = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date()));
  let code;
  for (let i = 0; i < 5; i++) {
    code = neuerCode();
    const r = await env.DB.prepare("INSERT OR IGNORE INTO gutscheine (code, erstellt, fuer, von, gruss, kaeufer_email, status, gueltig_bis) VALUES (?1,?2,?3,?4,?5,?6,'offen',?7)")
      .bind(code, new Date().toISOString(), kurz(d.fuer, 30).trim(), kurz(d.von, 40).trim(), kurz(d.gruss, 160).trim(), mail, (jahr + 3) + "-12-31").run();
    if (r.meta.changes) return json({ code, paypal: paypalLink(code) });
  }
  return json({ fehler: "code" }, 500);
}

async function gutscheinAbrufen(code, env) {
  if (!GS_CODE.test(code)) return json({ status: "unbekannt" }, 404);
  const g = await env.DB.prepare("SELECT * FROM gutscheine WHERE code = ?1").bind(code).first();
  if (!g) return json({ status: "unbekannt" }, 404);
  if (g.status === "offen") return json({ status: "offen", paypal: paypalLink(code) });
  if (g.status === "storniert") return json({ status: "storniert" });
  return json({ status: g.status, code: g.code, fuer: g.fuer, von: g.von, gruss: g.gruss, gueltig_bis: g.gueltig_bis, eingeloest_am: g.eingeloest_am });
}

// PayPal Instant Payment Notification: Nachricht bei PayPal gegenprüfen, dann Betrag, Empfänger und Status prüfen.
async function paypalIpn(request, env, ctx) {
  const roh = await request.text();
  const check = await fetch(env.IPN_PRUEFUNG || "https://ipnpb.paypal.com/cgi-bin/webscr", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "kifuehrerschein-ipn" }, body: "cmd=_notify-validate&" + roh });
  const antwort = (await check.text()).trim();
  const p = new URLSearchParams(roh);
  const code = p.get("custom") || p.get("invoice") || "";
  const info = `Code: ${code || "(keiner)"}\nPayPal-Status: ${p.get("payment_status")}\nBetrag: ${p.get("mc_gross")} ${p.get("mc_currency")}\nEmpfänger: ${p.get("receiver_email") || p.get("business")}\nTransaktion: ${p.get("txn_id")}\nZeit: ${jetzt()} Uhr`;
  if (antwort !== "VERIFIED") { ctx.waitUntil(meldung(env, "Gutschein: unbestätigte PayPal-Nachricht", "PayPal hat eine Zahlungsnachricht nicht bestätigt. Bitte in PayPal nachsehen.\n\n" + info)); return new Response("ok"); }
  const g = GS_CODE.test(code) ? await env.DB.prepare("SELECT * FROM gutscheine WHERE code = ?1").bind(code).first() : null;
  const status = p.get("payment_status");
  if (g && ["Refunded", "Reversed", "Canceled_Reversal"].includes(status)) {
    await env.DB.prepare("UPDATE gutscheine SET status = 'storniert', notiz = ?2 WHERE code = ?1").bind(code, "PayPal: " + status).run();
    ctx.waitUntil(meldung(env, "Gutschein storniert: " + code, "Die Zahlung wurde zurückgebucht. Der Gutschein ist jetzt ungültig.\n\n" + info));
    return new Response("ok");
  }
  const empf = [p.get("receiver_email"), p.get("business")].filter(Boolean).map(x => x.toLowerCase());
  const passt = g && status === "Completed" && p.get("mc_gross") === GS_PREIS && p.get("mc_currency") === "EUR" && empf.includes(GS_EMPFAENGER);
  if (passt && g.status === "offen") {
    await env.DB.prepare("UPDATE gutscheine SET status = 'bezahlt', bezahlt_am = ?2, txn_id = ?3 WHERE code = ?1 AND status = 'offen'").bind(code, new Date().toISOString(), kurz(p.get("txn_id"), 40)).run();
    ctx.waitUntil(meldung(env, "Gutschein verkauft: " + code, "Ein Gutschein wurde bezahlt und ist freigeschaltet.\n\n" + info + "\n\nDer Käufer sieht ihn sofort unter " + SEITE + "/?g=" + code + "\n"));
  } else if (!(g && g.status !== "offen" && status === "Completed")) {
    ctx.waitUntil(meldung(env, "Gutschein: Zahlung bitte prüfen", "Eine PayPal-Zahlung passt nicht automatisch zu einem Gutschein (Betrag, Empfänger, Status oder Code). Bitte in PayPal prüfen und den Gutschein bei Bedarf im Eingang von Hand freischalten.\n\n" + info));
  }
  return new Response("ok");
}

async function gutscheinSetzen(request, env) {
  const f = await request.formData();
  const key = String(f.get("key") || "");
  if (await sha256(key) !== SCHLUESSEL_HASH) return new Response("Nicht gefunden", { status: 404 });
  const code = String(f.get("code") || ""), neu = String(f.get("status") || "");
  const erlaubt = { bezahlt: "offen", eingeloest: "bezahlt", bezahlt_zurueck: "eingeloest", storniert: null };
  if (GS_CODE.test(code) && neu in erlaubt) {
    if (neu === "bezahlt") await env.DB.prepare("UPDATE gutscheine SET status = 'bezahlt', bezahlt_am = ?2, notiz = 'von Hand freigeschaltet' WHERE code = ?1 AND status = 'offen'").bind(code, new Date().toISOString()).run();
    if (neu === "eingeloest") await env.DB.prepare("UPDATE gutscheine SET status = 'eingeloest', eingeloest_am = ?2 WHERE code = ?1 AND status = 'bezahlt'").bind(code, new Date().toISOString()).run();
    if (neu === "bezahlt_zurueck") await env.DB.prepare("UPDATE gutscheine SET status = 'bezahlt', eingeloest_am = NULL WHERE code = ?1 AND status = 'eingeloest'").bind(code).run();
    if (neu === "storniert") await env.DB.prepare("UPDATE gutscheine SET status = 'storniert', notiz = 'von Hand storniert' WHERE code = ?1").bind(code).run();
  }
  return new Response(null, { status: 303, headers: { location: "/eingang?key=" + encodeURIComponent(key) + "#gutscheine" } });
}

async function checkin(request, env, ctx) {
  let d; try { d = await request.json(); } catch (e) { return new Response("ungültig", { status: 400 }); }
  const mail = kurz(d.mail, 120).trim();
  if (d.ok !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || !ALTER.has(d.alter)) return new Response("ungültig", { status: 400 });
  const liste = (v, n) => JSON.stringify((Array.isArray(v) ? v : []).slice(0, n).map(x => typeof x === "boolean" ? x : kurz(x, 60)));
  await env.DB.prepare("INSERT INTO checkins (id, erstellt, spitzname, altersgruppe, interessen, ki_erfahrung, blitz, app_art, idee, app_name, auftrag, antwort, angetippt, eigenanteil, bemerkt, eltern_email, mall) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)")
    .bind(crypto.randomUUID(), new Date().toISOString(), kurz(d.name, 24), d.alter, liste(d.inter, 3), kurz(d.erf, 12), liste(d.blitz, 5), kurz(d.art, 40), kurz(d.idee, 400), kurz(d.app, 40), kurz(d.auftrag, 600), kurz(d.antwort, 600), liste(d.falsch, 3), kurz(d.eigen, 8), liste(d.bemerkt, 3), mail, d.mall ? 1 : 0).run();
  ctx.waitUntil(melden(env, d.alter, !!d.mall));
  return new Response(null, { status: 204 });
}

async function eingang(url, env) {
  if (await sha256(url.searchParams.get("key") || "") !== SCHLUESSEL_HASH) return new Response("Nicht gefunden", { status: 404 });
  if (url.searchParams.get("testmail")) return new Response("Testmail: " + await melden(env, "Test", false), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const { results } = await env.DB.prepare("SELECT * FROM checkins ORDER BY erstellt DESC LIMIT 200").all();
  const gs = (await env.DB.prepare("SELECT * FROM gutscheine ORDER BY erstellt DESC LIMIT 300").all()).results;
  const key = url.searchParams.get("key");
  const knopf = (code, status, text) => `<form method="post" action="/eingang/gutschein"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="code" value="${esc(code)}"><input type="hidden" name="status" value="${status}"><button>${text}</button></form>`;
  const STATUS = { offen: "offen – noch nicht bezahlt", bezahlt: "bezahlt – gültig", eingeloest: "eingelöst", storniert: "storniert" };
  const tag = v => v ? esc(new Date(v).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })) : "";
  const gsKarten = gs.map(g => `<article class="g ${esc(g.status)}"><h2>${esc(g.code)} · ${STATUS[g.status] || esc(g.status)}</h2><p class="s">bestellt ${tag(g.erstellt)}${g.bezahlt_am ? " · bezahlt " + tag(g.bezahlt_am) : ""}${g.eingeloest_am ? " · eingelöst " + tag(g.eingeloest_am) : ""} · gültig bis ${esc(g.gueltig_bis)}${g.notiz ? " · " + esc(g.notiz) : ""}</p>
<p><b>Für:</b> ${esc(g.fuer) || "–"} · <b>Von:</b> ${esc(g.von) || "–"}${g.gruss ? " · <b>Gruß:</b> " + esc(g.gruss) : ""}</p>
<p><b>Käufer:</b> <a href="mailto:${esc(g.kaeufer_email)}?subject=${encodeURIComponent("Ihr Gutschein für den KI-Führerschein (" + g.code + ")")}&body=${encodeURIComponent("Hallo,\n\nvielen Dank für Ihre Bestellung! Ihren Gutschein können Sie hier ansehen, ausdrucken oder als PDF speichern:\n" + SEITE + "/?g=" + g.code + "\n\nViele Grüße\nThomas Löbke\nTomorrow Minds")}">${esc(g.kaeufer_email)}</a> · <a href="/?g=${esc(g.code)}" target="_blank" rel="noopener">Gutschein ansehen</a></p>
<div class="k">${g.status === "offen" ? knopf(g.code, "bezahlt", "Zahlung ist da – freischalten") : ""}${g.status === "bezahlt" ? knopf(g.code, "eingeloest", "Als eingelöst markieren") : ""}${g.status === "eingeloest" ? knopf(g.code, "bezahlt_zurueck", "Einlösung zurücknehmen") : ""}${g.status !== "storniert" && g.status !== "eingeloest" ? knopf(g.code, "storniert", "Stornieren") : ""}</div></article>`).join("");
  const zeile = (k, v) => v ? `<p><b>${k}:</b> ${esc(v)}</p>` : "";
  const karten = results.map(r => `<article><h2>${esc(r.spitzname)} · ${esc(r.altersgruppe)} · „${esc(r.app_name)}“</h2><p class="s">${esc(r.erstellt.slice(0, 16).replace("T", " "))} UTC${r.mall ? " · Mall" : ""} · <a href="mailto:${esc(r.eltern_email)}?subject=${encodeURIComponent(r.spitzname + "s KI-Check: die Idee, zwei Stärken und ein nächster Schritt")}">${esc(r.eltern_email)}</a></p>
${zeile("Interessen", r.interessen)}${zeile("KI-Erfahrung", r.ki_erfahrung)}${zeile("Blitzrunde (Fahrrad, Hund, Pinguin, Stimme, Eis)", r.blitz)}${zeile("Art der Überraschung", r.app_art)}${zeile("Idee", r.idee)}${zeile("Auftrag an Kiki", r.auftrag)}${zeile("Antwort an Kiki", r.antwort)}${zeile("Angetippt (8–10)", r.angetippt)}${zeile("Eigenanteil", r.eigenanteil)}${zeile("Fallen selbst bemerkt", r.bemerkt)}</article>`).join("");
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Eingang – KI-Check</title>
<style>body{font-family:system-ui,sans-serif;margin:24px auto;max-width:820px;padding:0 16px;color:#1C1A3F;background:#FFF8EC}article{background:#fff;border-radius:14px;padding:16px 20px;margin:14px 0;border:2px solid #1C1A3F}h2{margin:0 0 4px;font-size:1.15rem}p{margin:.35em 0}.s{color:#4E4B6B;font-size:.9rem}.k{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.k form{margin:0}button{font:inherit;font-weight:700;padding:8px 14px;border-radius:10px;border:2px solid #1C1A3F;background:#FFD43B;cursor:pointer}article.g.offen{border-style:dashed}article.g.eingeloest,article.g.storniert{opacity:.6}nav a{margin-right:14px}</style></head><body>
<nav><a href="#gutscheine">Gutscheine (${gs.length})</a><a href="#checks">KI-Checks (${results.length})</a></nav>
<h1 id="gutscheine">Gutscheine (${gs.filter(g => g.status === "bezahlt").length} gültig, ${gs.filter(g => g.status === "offen").length} offen)</h1><p class="s">Zum Einlösen: Code mit Strg+F suchen und „Als eingelöst markieren“ klicken. „Offen“ heißt: bestellt, aber PayPal hat noch keine Zahlung gemeldet. Unbezahlte Bestellungen werden nach 30 Tagen gelöscht.</p>${gsKarten || "<p>Noch keine Gutscheine.</p>"}
<h1 id="checks">Eingang: KI-Checks (${results.length})</h1><p class="s">Enthält Angaben von Kindern und E-Mail-Adressen der Eltern. Bitte den Link nicht weitergeben. Einträge werden nach 90 Tagen gelöscht.</p>${karten || "<p>Noch keine Einträge.</p>"}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === "www.kifuehrerschein.jetzt") { url.hostname = "kifuehrerschein.jetzt"; return Response.redirect(url.toString(), 301); }
    if (url.pathname === "/api/e" && request.method === "POST") {
      const [ev, quelle] = (await request.text()).slice(0, 64).split("@");
      const ua = request.headers.get("user-agent") || "";
      if (EREIGNISSE.has(ev) && !/bot|crawl|spider|preview|monitor/i.test(ua)) {
        const zaehle = e => env.DB.prepare("INSERT INTO zahlen (tag, ereignis, anzahl) VALUES (?1, ?2, 1) ON CONFLICT(tag, ereignis) DO UPDATE SET anzahl = anzahl + 1").bind(heute(), e);
        const stmts = [zaehle(ev)];
        if (quelle && /^[a-z0-9-]{1,20}$/.test(quelle)) stmts.push(zaehle(ev + "@" + quelle));
        await env.DB.batch(stmts);
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/checkin" && request.method === "POST") return checkin(request, env, ctx);
    if (url.pathname === "/eingang") return eingang(url, env);
    if (url.pathname === "/eingang/gutschein" && request.method === "POST") return gutscheinSetzen(request, env);
    if (url.pathname === "/api/gutschein" && request.method === "POST") return gutscheinBestellen(request, env);
    if (url.pathname.startsWith("/api/gutschein/")) return gutscheinAbrufen(decodeURIComponent(url.pathname.slice(15)).toUpperCase(), env);
    if (url.pathname === "/api/paypal-ipn" && request.method === "POST") return paypalIpn(request, env, ctx);
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
      const QKEYS = ["besuch", "check_offen", "check_fertig", "checkin_gesendet", "klick_online", "klick_termin", "klick_gutschein", "gutschein_bestellt"];
      const mitQuelle = results.filter(r => r.ereignis.includes("@"));
      const quellen = [...new Set(mitQuelle.map(r => r.ereignis.split("@")[1]))].sort();
      const qsum = (q, e) => mitQuelle.filter(r => r.ereignis === e + "@" + q).reduce((a, r) => a + r.anzahl, 0);
      const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Zahlen – KI-Führerschein</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1C1A3F;background:#FFF8EC}h1{margin:0 0 4px}table{border-collapse:collapse;background:#fff;margin-top:16px}th,td{border:1px solid #ddd;padding:8px 10px;text-align:right;font-size:14px}th:first-child,td:first-child{text-align:left}thead th{background:#1C1A3F;color:#fff;font-weight:600}tfoot td{font-weight:700;background:#FFD43B}.w{overflow-x:auto}</style></head><body>
<h1>Zahlen der letzten 30 Tage</h1><p>Anonyme Zählung, je Tag und Ereignis. Ein Seitenaufruf ist kein eindeutiger Besucher: Wer die Seite zweimal lädt, zählt zweimal.</p>
<div class="w"><table><thead><tr><th>Tag</th>${keys.map(k => `<th>${NAMEN[k]}</th>`).join("")}</tr></thead>
<tbody>${tage.map(t => `<tr><td>${t}</td>${keys.map(k => `<td>${get(t, k)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${keys.length + 1}">Noch keine Zahlen.</td></tr>`}</tbody>
<tfoot><tr><td>Summe</td>${keys.map(k => `<td>${sum(k)}</td>`).join("")}</tr></tfoot></table></div>
<h2 style="margin-top:32px">Nach Quelle (letzte 30 Tage)</h2><p>Nur Besuche, die über eine Adresse mit <code>?q=…</code> kamen, z. B. <code>?q=meta-geschenk</code> aus einer Anzeige. Diese Zahlen stecken auch in der Tabelle oben.</p>
<div class="w"><table><thead><tr><th>Quelle</th>${QKEYS.map(k => `<th>${NAMEN[k]}</th>`).join("")}</tr></thead>
<tbody>${quellen.map(q => `<tr><td>${esc(q)}</td>${QKEYS.map(k => `<td>${qsum(q, k)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${QKEYS.length + 1}">Noch keine Besuche mit Quelle.</td></tr>`}</tbody></table></div></body></html>`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    return env.ASSETS.fetch(request);
  },
  // Täglich: KI-Checks nach 90 Tagen löschen, unbezahlte Gutschein-Bestellungen nach 30 Tagen, Gutscheine ein Jahr nach Ablauf.
  async scheduled(event, env) {
    await env.DB.prepare("DELETE FROM checkins WHERE erstellt < ?1").bind(new Date(Date.now() - 90 * 864e5).toISOString()).run();
    await env.DB.prepare("DELETE FROM gutscheine WHERE status = 'offen' AND erstellt < ?1").bind(new Date(Date.now() - 30 * 864e5).toISOString()).run();
    await env.DB.prepare("DELETE FROM gutscheine WHERE gueltig_bis < date('now', '-1 year')").run();
  }
};
