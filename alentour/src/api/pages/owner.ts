/**
 * Owner web pages: sign in, claim a venue, edit your listings.
 *
 * Deliberately a server-rendered web form, not part of the app (docs/alentour/02-scope-and-
 * roadmap.md, Stage 3): owners are on a laptop at the front desk, and a form needs no release.
 *
 * Security for cookie-authenticated forms:
 *  - session cookie is HttpOnly, SameSite=Lax, Secure in production, scoped to /owner;
 *  - every POST must come from this origin (Origin/Referer check);
 *  - every signed-in POST carries a per-session HMAC token (CSRF).
 * hono/html escapes every interpolated value, so owner-entered text cannot inject markup.
 */
import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Deps, SessionUser } from "../context.ts";
import { sessionUser, startEmailSignIn, verifyEmailCode, revokeSession } from "../auth.ts";
import { hmac, safeEqual } from "../crypto.ts";
import { startClaim, verifyClaimCode } from "../../claims/claims.ts";
import { applyOwnerEdit, confirmStillAccurate, ownerListings, type OwnerPatch } from "../../claims/edits.ts";
import { loadTaxonomy } from "../../taxonomy/load.ts";

const COOKIE = "alentour_owner";
type L = "fr" | "en";

const T = {
  title: { fr: "Alentour pour les entreprises", en: "Alentour for businesses" },
  signIn: { fr: "Connexion", en: "Sign in" },
  email: { fr: "Courriel", en: "Email" },
  sendCode: { fr: "Recevoir un code", en: "Send me a code" },
  code: { fr: "Code reçu par courriel", en: "Code from your email" },
  verify: { fr: "Se connecter", en: "Sign in" },
  signOut: { fr: "Se déconnecter", en: "Sign out" },
  listings: { fr: "Vos fiches", en: "Your listings" },
  noListings: { fr: "Aucune fiche pour l'instant. Réclamez votre établissement pour la gérer.", en: "No listings yet. Claim your venue to manage it." },
  claim: { fr: "Réclamer un établissement", en: "Claim a venue" },
  search: { fr: "Nom de l'établissement", en: "Venue name" },
  find: { fr: "Chercher", en: "Search" },
  businessName: { fr: "Nom de l'entreprise", en: "Business name" },
  role: { fr: "Votre rôle", en: "Your role" },
  contactEmail: { fr: "Courriel professionnel", en: "Work email" },
  contactHint: { fr: "Une adresse au domaine de votre site web permet une vérification immédiate.", en: "An address at your website's domain verifies instantly." },
  phone: { fr: "Téléphone (facultatif)", en: "Phone (optional)" },
  message: { fr: "Message (facultatif)", en: "Message (optional)" },
  submitClaim: { fr: "Envoyer la demande", en: "Submit claim" },
  claimCodeSent: { fr: "Un code a été envoyé à cette adresse. Entrez-le pour confirmer.", en: "We sent a code to that address. Enter it to confirm." },
  claimManual: { fr: "Merci ! On vérifie votre demande et on vous écrit sous peu.", en: "Thanks! We'll review your claim and write back shortly." },
  claimDone: { fr: "C'est confirmé : vous gérez maintenant cette fiche.", en: "Confirmed: you now manage this listing." },
  claims: { fr: "Vos demandes", en: "Your claims" },
  edit: { fr: "Modifier", en: "Edit" },
  save: { fr: "Enregistrer", en: "Save" },
  saved: { fr: "Enregistré. Merci de garder la fiche à jour !", en: "Saved. Thanks for keeping it current!" },
  stillAccurate: { fr: "Tout est encore exact", en: "Everything is still accurate" },
  lastVerified: { fr: "Dernière vérification", en: "Last verified" },
  never: { fr: "jamais", en: "never" },
  titleF: { fr: "Titre", en: "Title" },
  summary: { fr: "Résumé (une ligne)", en: "Summary (one line)" },
  description: { fr: "Description", en: "Description" },
  bring: { fr: "Quoi apporter", en: "What to bring" },
  free: { fr: "Gratuit", en: "Free" },
  priceMin: { fr: "Prix à partir de ($)", en: "Price from ($)" },
  priceMax: { fr: "Jusqu'à ($)", en: "Up to ($)" },
  duration: { fr: "Durée typique (minutes)", en: "Typical duration (minutes)" },
  hours: { fr: "Heures d'ouverture", en: "Opening hours" },
  hoursHint: { fr: "Format : Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off", en: "Format: Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off" },
  a11y: { fr: "Accessibilité", en: "Accessibility" },
  a11yHint: { fr: "Répondez seulement ce que vous savez. « Je ne sais pas » est une réponse honnête et utile.", en: "Only answer what you know. \"I don't know\" is an honest, useful answer." },
  yes: { fr: "Oui", en: "Yes" },
  no: { fr: "Non", en: "No" },
  unknown: { fr: "Je ne sais pas", en: "I don't know" },
  tags: { fr: "Ambiance et pratique", en: "Vibe and practicalities" },
  errors: { fr: "À corriger :", en: "Please fix:" },
  back: { fr: "← Retour", en: "← Back" },
  badCode: { fr: "Code incorrect ou expiré.", en: "Wrong or expired code." },
  status_pending: { fr: "en attente", en: "pending" },
  status_verified: { fr: "confirmée", en: "confirmed" },
  status_rejected: { fr: "refusée", en: "declined" },
  status_withdrawn: { fr: "retirée", en: "withdrawn" },
} as const;

const EDITABLE_FACETS = ["vibe", "audience", "logistics", "group", "booking", "weather"];

export function ownerPages(d: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => (d.now ? d.now() : new Date());
  const csrfFor = (u: SessionUser) => hmac(d.config.secret, `csrf:${u.sessionId}`);

  const lang = (c: Context<AppEnv>): L => {
    const q = c.req.query("lang");
    if (q === "en" || q === "fr") { setCookie(c, "alentour_lang", q, { path: "/owner", sameSite: "Lax" }); return q; }
    return getCookie(c, "alentour_lang") === "en" ? "en" : "fr";
  };
  const t = (l: L) => (k: keyof typeof T) => T[k][l];

  const owner = async (c: Context<AppEnv>) => {
    const token = getCookie(c, COOKIE);
    return token ? sessionUser(d, token) : null;
  };

  /** Reject cross-site POSTs outright; then, when signed in, require the session's CSRF token. */
  app.use("*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const origin = c.req.header("origin") ?? c.req.header("referer") ?? "";
    const self = new URL(c.req.url);
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === self.host; } catch { sameOrigin = false; }
    if (!sameOrigin) return c.text("Cross-site request refused.", 403);
    const u = await owner(c);
    if (u) {
      const body = await c.req.parseBody();
      const sent = typeof body._csrf === "string" ? body._csrf : "";
      if (!safeEqual(sent, csrfFor(u))) return c.text("Invalid form token. Reload the page and try again.", 403);
    }
    return next();
  });

  // ---------------------------------------------------------------- sign in
  app.get("/", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) {
      return c.html(page(l, tr("signIn"), html`
        <form method="post" action="/owner/login" class="card">
          <label>${tr("email")}<input name="email" type="email" required autocomplete="email"></label>
          <button>${tr("sendCode")}</button>
        </form>`));
    }
    const [listings, claims] = await Promise.all([
      ownerListings(d.pool, u.id),
      d.pool.query(`SELECT c.status, c.created_at, v.name FROM claims c JOIN venues v ON v.id = c.venue_id
                     WHERE c.claimant_id = $1 ORDER BY c.created_at DESC`, [u.id]),
    ]);
    const title = (x: any) => x.content?.[l === "fr" ? "fr-CA" : "en-CA"]?.title ?? x.content?.["fr-CA"]?.title ?? x.slug;
    return c.html(page(l, tr("listings"), html`
      <p class="muted">${u.email}</p>
      <section class="card">
        <h2>${tr("listings")}</h2>
        ${listings.length ? html`<ul class="list">${listings.map((x: any) => html`
          <li><a href="/owner/activities/${x.id}">${title(x)}</a>
            <span class="muted"> · ${x.venue_name} · ${tr("lastVerified")} ${x.last_verified_at ? fmtDate(x.last_verified_at, l) : tr("never")}</span></li>`)}
        </ul>` : html`<p class="muted">${tr("noListings")}</p>`}
        <p><a class="button" href="/owner/claim">${tr("claim")}</a></p>
      </section>
      ${claims.rows.length ? html`<section class="card"><h2>${tr("claims")}</h2><ul class="list">
        ${claims.rows.map((c: any) => html`<li>${c.name} — ${tr(`status_${c.status}` as keyof typeof T)}</li>`)}
      </ul></section>` : ""}
      ${logoutForm(l, csrfFor(u))}`));
  });

  app.post("/login", async (c) => {
    const l = lang(c), tr = t(l);
    const body = await c.req.parseBody();
    const email = String(body.email ?? "");
    await startEmailSignIn(d, email, l, hmac(d.config.secret, c.get("ip")));
    return c.html(page(l, tr("signIn"), html`
      <form method="post" action="/owner/login/verify" class="card">
        <input type="hidden" name="email" value="${email}">
        <label>${tr("code")}<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
        <button>${tr("verify")}</button>
      </form>`));
  });

  app.post("/login/verify", async (c) => {
    const l = lang(c), tr = t(l);
    const body = await c.req.parseBody();
    const r = await verifyEmailCode(d, String(body.email ?? ""), String(body.code ?? ""), c.req.header("user-agent"));
    if (!r.ok) {
      return c.html(page(l, tr("signIn"), html`<p class="error">${tr("badCode")}</p><p><a href="/owner">${tr("back")}</a></p>`), 400);
    }
    setCookie(c, COOKIE, r.token, {
      path: "/owner", httpOnly: true, sameSite: "Lax", secure: d.config.production, maxAge: 30 * 86_400,
    });
    return c.redirect("/owner");
  });

  app.post("/logout", async (c) => {
    const u = await owner(c);
    if (u) await revokeSession(d, u.sessionId);
    deleteCookie(c, COOKIE, { path: "/owner" });
    return c.redirect("/owner");
  });

  // ---------------------------------------------------------------- claims
  app.get("/claim", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const q = (c.req.query("q") ?? "").trim();
    const venues = q.length >= 2 ? (await d.pool.query(
      `SELECT id, name, neighbourhood, provider_id IS NOT NULL AS claimed FROM venues
        WHERE name ILIKE $1 OR similarity(name, $2) > 0.3 ORDER BY similarity(name, $2) DESC LIMIT 8`,
      [`%${q}%`, q])).rows : [];
    const csrf = csrfFor(u);
    return c.html(page(l, tr("claim"), html`
      <form method="get" action="/owner/claim" class="card row">
        <input name="q" value="${q}" placeholder="${tr("search")}" required minlength="2">
        <button>${tr("find")}</button>
      </form>
      ${venues.map((v: any) => html`
        <form method="post" action="/owner/claim" class="card">
          <h2>${v.name}</h2><p class="muted">${v.neighbourhood ?? ""}</p>
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="venueId" value="${v.id}">
          <label>${tr("businessName")}<input name="businessName" value="${v.name}" required></label>
          <label>${tr("role")}<input name="role" placeholder="${l === "fr" ? "Propriétaire" : "Owner"}" required></label>
          <label>${tr("contactEmail")}<input name="contactEmail" type="email" required>
            <small class="muted">${tr("contactHint")}</small></label>
          <label>${tr("phone")}<input name="contactPhone" type="tel"></label>
          <label>${tr("message")}<textarea name="message" rows="2"></textarea></label>
          <button>${tr("submitClaim")}</button>
        </form>`)}
      <p><a href="/owner">${tr("back")}</a></p>`));
  });

  app.post("/claim", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const b = await c.req.parseBody();
    const r = await startClaim(d, {
      userId: u.id, venueId: String(b.venueId ?? ""), businessName: String(b.businessName ?? ""),
      role: String(b.role ?? ""), contactEmail: String(b.contactEmail ?? ""),
      contactPhone: String(b.contactPhone ?? "") || null, message: String(b.message ?? "") || null, lang: l,
    });
    if (!r.ok) return c.html(page(l, tr("claim"), html`<p class="error">${r.error}</p><p><a href="/owner/claim">${tr("back")}</a></p>`), 400);
    if (r.method === "manual") return c.html(page(l, tr("claim"), html`<p class="card">${tr("claimManual")}</p><p><a href="/owner">${tr("back")}</a></p>`));
    return c.html(page(l, tr("claim"), html`
      <form method="post" action="/owner/claim/${r.claimId}/verify" class="card">
        <p>${tr("claimCodeSent")}</p>
        <input type="hidden" name="_csrf" value="${csrfFor(u)}">
        <label>${tr("code")}<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label>
        <button>${tr("verify")}</button>
      </form>`));
  });

  app.post("/claim/:id/verify", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const b = await c.req.parseBody();
    const r = await verifyClaimCode(d, c.req.param("id"), u.id, String(b.code ?? ""));
    if (!r.ok) return c.html(page(l, tr("claim"), html`<p class="error">${tr("badCode")}</p><p><a href="/owner">${tr("back")}</a></p>`), 400);
    return c.html(page(l, tr("claim"), html`<p class="card ok">${tr("claimDone")}</p><p><a href="/owner">${tr("listings")} →</a></p>`));
  });

  // ---------------------------------------------------------------- editing
  app.get("/activities/:id", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const x = (await ownerListings(d.pool, u.id)).find((r: any) => r.id === c.req.param("id"));
    if (!x) return c.text("Not found", 404);
    return c.html(editPage(l, x, csrfFor(u), c.req.query("saved") === "1" ? "saved" : null, []));
  });

  app.post("/activities/:id", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const id = c.req.param("id");
    const current = (await ownerListings(d.pool, u.id)).find((r: any) => r.id === id);
    if (!current) return c.text("Not found", 404);
    const b = await c.req.parseBody();
    const r = await applyOwnerEdit(d.pool, u.id, id, formToPatch(b, current), now());
    if (!r.ok) return c.html(editPage(l, current, csrfFor(u), null, r.issues ?? [r.error]), 400);
    return c.redirect(`/owner/activities/${id}?saved=1`);
  });

  app.post("/activities/:id/confirm", async (c) => {
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    await confirmStillAccurate(d.pool, u.id, c.req.param("id"), now());
    return c.redirect(`/owner/activities/${c.req.param("id")}?saved=1`);
  });

  return app;
}

// -------------------------------------------------------------------- rendering

function editPage(l: L, x: any, csrf: string, notice: "saved" | null, errors: string[]) {
  const tr = (k: keyof typeof T) => T[k][l];
  const tax = loadTaxonomy();
  const lbl = (tag: { fr: string; en: string }) => (l === "fr" ? tag.fr : tag.en);
  const a11y = tax.facets.find((f) => f.key === "accessibility")?.tags ?? [];
  const facets = tax.facets.filter((f) => EDITABLE_FACETS.includes(f.key));
  const tags = new Set<string>(x.tags ?? []);
  const content = (loc: string) => x.content?.[loc] ?? {};
  const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));

  return page(l, content(l === "fr" ? "fr-CA" : "en-CA").title ?? x.slug, html`
    <p><a href="/owner">${tr("back")}</a> · <span class="muted">${x.venue_name}</span></p>
    ${notice ? html`<p class="card ok">${tr("saved")}</p>` : ""}
    ${errors.length ? html`<div class="card error"><strong>${tr("errors")}</strong><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
    <form method="post" action="/owner/activities/${x.id}/confirm" class="inline">
      <input type="hidden" name="_csrf" value="${csrf}">
      <button class="secondary">✓ ${tr("stillAccurate")}</button>
      <span class="muted">${tr("lastVerified")} : ${x.last_verified_at ? fmtDate(x.last_verified_at, l) : tr("never")}</span>
    </form>
    <form method="post" action="/owner/activities/${x.id}">
      <input type="hidden" name="_csrf" value="${csrf}">
      ${["fr-CA", "en-CA"].map((loc) => html`
        <fieldset class="card"><legend>${loc === "fr-CA" ? "Français" : "English"}</legend>
          <label>${tr("titleF")}<input name="title_${loc}" value="${content(loc).title ?? ""}" maxlength="90" ${loc === "fr-CA" ? "required" : ""}></label>
          <label>${tr("summary")}<input name="summary_${loc}" value="${content(loc).summary ?? ""}" maxlength="160"></label>
          <label>${tr("description")}<textarea name="description_${loc}" rows="4" maxlength="2000">${content(loc).description ?? ""}</textarea></label>
          <label>${tr("bring")}<input name="whatToBring_${loc}" value="${content(loc).whatToBring ?? ""}" maxlength="300"></label>
        </fieldset>`)}
      <fieldset class="card"><legend>${tr("priceMin").split(" ")[0]}</legend>
        <label class="check"><input type="checkbox" name="isFree" ${x.is_free ? "checked" : ""}> ${tr("free")}</label>
        <div class="row">
          <label>${tr("priceMin")}<input name="priceMin" type="number" min="0" step="0.5" value="${dollars(x.price_min_cents)}"></label>
          <label>${tr("priceMax")}<input name="priceMax" type="number" min="0" step="0.5" value="${dollars(x.price_max_cents)}"></label>
        </div>
        <label>${tr("duration")}<input name="duration" type="number" min="5" max="1440" value="${x.typical_duration_minutes ?? ""}"></label>
        <label>${tr("hours")}<input name="openingHours" value="${x.opening_hours ?? ""}" placeholder="Mo-Fr 09:00-17:00">
          <small class="muted">${tr("hoursHint")}</small></label>
      </fieldset>
      <fieldset class="card"><legend>${tr("a11y")}</legend>
        <p class="muted">${tr("a11yHint")}</p>
        ${a11y.map((tag) => {
          const v = x.a11y?.[tag.slug];
          const val = v === true ? "yes" : v === false ? "no" : "unknown";
          return html`<div class="tri"><span>${lbl(tag)}</span>
            ${(["yes", "no", "unknown"] as const).map((o) => html`<label class="check"><input type="radio" name="a11y_${tag.slug}" value="${o}" ${val === o ? "checked" : ""}> ${tr(o)}</label>`)}
          </div>`;
        })}
      </fieldset>
      <fieldset class="card"><legend>${tr("tags")}</legend>
        ${facets.map((f) => html`<div class="facet"><strong>${f.key}</strong>
          ${(f.tags ?? []).map((tag) => html`<label class="check"><input type="checkbox" name="tag" value="${tag.slug}" ${tags.has(tag.slug) ? "checked" : ""}> ${lbl(tag)}</label>`)}
        </div>`)}
      </fieldset>
      <button>${tr("save")}</button>
    </form>`);
}

/** Map the flat form fields back onto an OwnerPatch. Only differences become tag changes. */
export function formToPatch(b: Record<string, unknown>, current: any): OwnerPatch {
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const cents = (k: string) => (str(k) === "" ? null : Math.round(Number(str(k)) * 100));
  const content: NonNullable<OwnerPatch["content"]> = {};
  for (const loc of ["fr-CA", "en-CA"] as const) {
    const title = str(`title_${loc}`);
    if (!title) continue;
    content[loc] = {
      title,
      ...(str(`summary_${loc}`) ? { summary: str(`summary_${loc}`) } : {}),
      ...(str(`description_${loc}`) ? { description: str(`description_${loc}`) } : {}),
      ...(str(`whatToBring_${loc}`) ? { whatToBring: str(`whatToBring_${loc}`) } : {}),
    };
  }
  const a11y: Record<string, boolean | null> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!k.startsWith("a11y_")) continue;
    const slug = k.slice(5);
    const next = v === "yes" ? true : v === "no" ? false : null;
    const prev = current.a11y?.[slug] ?? null;
    if (next !== prev) a11y[slug] = next;
  }
  const raw = b.tag;
  const wanted = new Set(Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : []);
  const had = new Set<string>(current.tags ?? []);
  const editable = new Set(loadTaxonomy().facets.filter((f) => EDITABLE_FACETS.includes(f.key)).flatMap((f) => (f.tags ?? []).map((t) => t.slug)));
  const duration = str("duration");
  return {
    ...(Object.keys(content).length ? { content } : {}),
    isFree: b.isFree === "on",
    priceMinCents: cents("priceMin"),
    priceMaxCents: cents("priceMax"),
    typicalDurationMinutes: duration ? Number(duration) : null,
    openingHours: str("openingHours") || null,
    ...(Object.keys(a11y).length ? { a11y } : {}),
    tagsAdd: [...wanted].filter((s) => !had.has(s) && editable.has(s)),
    tagsRemove: [...had].filter((s) => !wanted.has(s) && editable.has(s)),
  };
}

function logoutForm(l: L, csrf: string) {
  return html`<form method="post" action="/owner/logout"><input type="hidden" name="_csrf" value="${csrf}"><button class="secondary">${T.signOut[l]}</button></form>`;
}

function fmtDate(d: Date | string, l: L) {
  return new Date(d).toLocaleDateString(l === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function page(l: L, title: string, body: unknown) {
  return html`<!doctype html>
<html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Alentour</title>
<style>${raw(CSS)}</style></head>
<body><header><strong>Alentour</strong> <span class="muted">${T.title[l]}</span>
<nav><a href="?lang=${l === "fr" ? "en" : "fr"}">${l === "fr" ? "English" : "Français"}</a></nav></header>
<main><h1>${title}</h1>${body}</main></body></html>`;
}

const CSS = `
:root{--ink:#151A18;--ink3:#6B746F;--bg:#F4F6F3;--surface:#fff;--rule:#DCE2DD;--accent:#1F5F4B;--soft:#E2EEE8;--danger:#93372A}
@media (prefers-color-scheme:dark){:root{--ink:#E9EDEA;--ink3:#8E9791;--bg:#121614;--surface:#1A201D;--rule:#2D3532;--accent:#79C3A6;--soft:#17302A;--danger:#D98B7A}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;gap:.75rem;align-items:baseline;padding:1rem 1.25rem;border-bottom:1px solid var(--rule)}header nav{margin-left:auto}
main{max-width:720px;margin:0 auto;padding:1.25rem}h1{font-size:1.6rem;margin:.25rem 0 1rem}h2{font-size:1.1rem;margin:0 0 .5rem}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:1rem;margin:0 0 1rem}
fieldset.card legend{font-weight:600;padding:0 .25rem}
label{display:block;margin:.5rem 0;font-size:.9rem}label.check{display:inline-flex;gap:.35rem;align-items:center;margin:.2rem .9rem .2rem 0}
input:not([type=checkbox]):not([type=radio]),textarea{display:block;width:100%;margin-top:.25rem;padding:.6rem .7rem;border:1px solid var(--rule);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button,.button{display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:.65rem 1.1rem;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary{background:var(--soft);color:var(--accent)}a{color:var(--accent)}.muted{color:var(--ink3)}
.row{display:flex;gap:.75rem}.row>*{flex:1}.row button{flex:0}.inline{display:flex;gap:.75rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap}
.tri{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem;padding:.35rem 0;border-bottom:1px solid var(--rule)}.tri>span{flex:1 1 14rem}
.facet{margin:.5rem 0}.facet strong{display:block;text-transform:capitalize;font-size:.85rem;color:var(--ink3)}
.list{padding-left:1.1rem}.list li{margin:.35rem 0}.error{color:var(--danger)}.ok{border-color:var(--accent);color:var(--accent);font-weight:600}
`;
