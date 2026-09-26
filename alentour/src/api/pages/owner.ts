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
import { applyOwnerEdit, canEdit, confirmStillAccurate, ownerListings, type OwnerPatch } from "../../claims/edits.ts";
import { facet, loadTaxonomy } from "../../taxonomy/load.ts";
import { UUID_RE } from "../http.ts";
import { checkUrl } from "../../enrichment/net.ts";
import { findDuplicateVenues, type DuplicateVenue } from "../../enrichment/geo.ts";
import { createJob, jobAllowance } from "../../enrichment/pipeline.ts";
import { deletePhoto, publishOnboarding, storePhotos, type Review } from "../../enrichment/listing.ts";
import type { Draft, DraftActivity } from "../../enrichment/types.ts";
import { createCheckout, createPortal, entitlementsFor, providerEntitlements } from "../../billing/stripe.ts";
import { createVenueSession } from "../../outings/outings.ts";
import { fromLocal } from "../../outings/time.ts";

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
  practical: { fr: "Prix, durée, heures", en: "Price, duration, hours" },
  minAge: { fr: "Âge minimum", en: "Minimum age" },
  weatherF: { fr: "Intérieur ou extérieur", en: "Indoor or outdoor" },
  w_indoor: { fr: "Intérieur", en: "Indoor" },
  w_covered: { fr: "Couvert", en: "Covered" },
  w_outdoor: { fr: "Extérieur", en: "Outdoor" },
  w_either: { fr: "Les deux", en: "Either" },
  confHigh: { fr: "confiance élevée", en: "high confidence" },
  confMedium: { fr: "à vérifier", en: "please check" },
  fromSite: { fr: "Tiré de votre site :", en: "From your website:" },
  siteSays: { fr: "Votre site dit :", en: "Your website says:" },
  pleaseConfirm: { fr: "confirmez vous-même", en: "please confirm yourself" },
  photos: { fr: "Photos", en: "Photos" },
  noPhotos: { fr: "Aucune photo pour l'instant.", en: "No photos yet." },
  hero: { fr: "principale", en: "main" },
  ph_approved: { fr: "en ligne", en: "live" },
  ph_pending: { fr: "en vérification", en: "being reviewed" },
  ph_rejected: { fr: "refusée", en: "declined" },
  remove: { fr: "Retirer", en: "Remove" },
  upload: { fr: "Ajouter les photos", en: "Add photos" },
  licence: { fr: "J'accorde à Alentour une licence non exclusive d'afficher ces photos et je confirme avoir le droit de l'accorder.", en: "I grant Alentour a non-exclusive licence to display these photos and confirm I have the right to grant it." },
  licenceRequired: { fr: "Cochez la licence pour ajouter des photos.", en: "Tick the licence box to add photos." },
  photoRules: { fr: "JPEG, PNG ou WebP, 8 Mo max, 8 photos max. On retire la localisation GPS des photos. Les photos où l'on voit des gens sont vérifiées avant d'être publiées.", en: "JPEG, PNG or WebP, 8 MB max, 8 photos max. We remove GPS location from photos. Photos showing people are checked before they go live." },
  err_too_large: { fr: "fichier trop lourd (8 Mo max)", en: "file too large (8 MB max)" },
  err_unsupported_format: { fr: "format non pris en charge (JPEG, PNG, WebP)", en: "unsupported format (JPEG, PNG, WebP)" },
  err_too_many: { fr: "limite de photos atteinte (6 en gratuit, 30 avec Pro)", en: "photo limit reached (6 free, 30 with Pro)" },
  awaitingReview: { fr: "en attente de vérification", en: "awaiting review" },
  addBusiness: { fr: "Ajouter mon entreprise", en: "Add my business" },
  newTitle: { fr: "Ajouter votre entreprise", en: "Add your business" },
  newIntro: { fr: "Donnez-nous votre site web : on prépare votre fiche, vous la vérifiez. Environ cinq minutes.", en: "Give us your website: we draft your listing, you check it. About five minutes." },
  nameF: { fr: "Nom de l'entreprise", en: "Business name" },
  websiteF: { fr: "Site web (facultatif, mais ça aide beaucoup)", en: "Website (optional, but it helps a lot)" },
  addressF: { fr: "Adresse à Montréal", en: "Address in Montréal" },
  pitchF: { fr: "Ce que vous faites, en une phrase", en: "What you do, in one sentence" },
  draftIt: { fr: "Préparer ma fiche", en: "Draft my listing" },
  errName: { fr: "Le nom est requis.", en: "The name is required." },
  errAddress: { fr: "L'adresse est requise.", en: "The address is required." },
  errWebsite: { fr: "Ce site web n'est pas une adresse valide.", en: "That website is not a valid address." },
  errNotFound: { fr: "On ne trouve pas cette adresse à Montréal. Vérifiez-la (numéro, rue).", en: "We can't find that address in Montréal. Check it (number, street)." },
  errLimit: { fr: "Limite quotidienne atteinte. Réessayez demain.", en: "Daily limit reached. Try again tomorrow." },
  dupTitle: { fr: "Vous êtes peut-être déjà sur Alentour", en: "You might already be on Alentour" },
  dupIntro: { fr: "Ces fiches ressemblent à votre entreprise. Si c'est vous, réclamez-la plutôt que d'en créer une deuxième.", en: "These listings look like your business. If one is yours, claim it instead of creating a second one." },
  claimThis: { fr: "C'est moi — réclamer", en: "That's me — claim it" },
  notMe: { fr: "Aucune de celles-ci : continuer", en: "None of these: continue" },
  working: { fr: "On prépare votre fiche…", en: "Drafting your listing…" },
  step_fetching: { fr: "Lecture de votre site web", en: "Reading your website" },
  step_extracting: { fr: "Repérage des faits (prix, heures, activités)", en: "Finding the facts (prices, hours, activities)" },
  step_writing: { fr: "Rédaction en français et en anglais", en: "Writing in French and English" },
  failed: { fr: "Quelque chose a échoué. Vous pouvez remplir la fiche vous-même.", en: "Something failed. You can fill in the listing yourself." },
  reviewTitle: { fr: "Vérifiez votre fiche", en: "Check your listing" },
  reviewIntro: { fr: "On a rédigé ceci à partir de votre site. Tout est modifiable. Les champs marqués ✦ viennent de votre site — vérifiez-les. Un champ vide vaut mieux qu'un champ faux.", en: "We drafted this from your website. Everything is editable. Fields marked ✦ come from your site — check them. A blank field beats a wrong one." },
  note_no_ai: { fr: "La rédaction automatique n'est pas disponible : remplissez les champs vous-même.", en: "Automatic drafting isn't available: fill in the fields yourself." },
  note_ai_failed: { fr: "La rédaction automatique a échoué : remplissez les champs vous-même.", en: "Automatic drafting failed: fill in the fields yourself." },
  note_website_unreadable: { fr: "On n'a pas pu lire votre site web; la fiche est plus vide que d'habitude.", en: "We couldn't read your website, so the draft is emptier than usual." },
  note_website_robots: { fr: "Votre site demande aux robots de ne pas le lire; on a respecté ça.", en: "Your website asks robots not to read it; we respected that." },
  note_website_invalid: { fr: "L'adresse du site web n'est pas utilisable.", en: "The website address can't be used." },
  include: { fr: "Inclure cette activité", en: "Include this activity" },
  kindF: { fr: "Type", en: "Type" },
  k_place: { fr: "Lieu (on y va quand c'est ouvert)", en: "Place (go when it's open)" },
  k_recurring_program: { fr: "Cours ou soirée récurrente", en: "Recurring class or night" },
  k_scheduled_event: { fr: "Événement à date fixe", en: "One-off event" },
  k_self_guided: { fr: "Autonome (parcours, sentier)", en: "Self-guided (trail, route)" },
  k_seasonal: { fr: "Saisonnier", en: "Seasonal" },
  categoryF: { fr: "Catégorie", en: "Category" },
  chooseCategory: { fr: "— choisir —", en: "— choose —" },
  phoneF: { fr: "Téléphone", en: "Phone" },
  confirmPrice: { fr: "J'ai vérifié les prix (ou je les ai laissés vides).", en: "I checked the prices (or left them blank)." },
  confirmA11y: { fr: "J'ai répondu aux questions d'accessibilité seulement avec ce que je sais.", en: "I answered the accessibility questions only with what I know." },
  consent: { fr: "Alentour peut m'écrire au sujet de ma fiche et de l'intérêt qu'elle suscite (désabonnement en un clic).", en: "Alentour may email me about my listing and the interest it gets (one-click unsubscribe)." },
  publish: { fr: "Publier", en: "Publish" },
  discard: { fr: "Abandonner ce brouillon", en: "Discard this draft" },
  drafts: { fr: "Brouillons", en: "Drafts" },
  continueDraft: { fr: "Continuer", en: "Continue" },
  publishedNow: { fr: "Publié ! Votre fiche sera dans l'app à la prochaine mise à jour du catalogue.", en: "Published! Your listing will be in the app with the next catalog update." },
  publishedPending: { fr: "Merci ! On vérifie que l'entreprise est bien à vous, puis on publie. Pour une vérification immédiate, connectez-vous avec une adresse au domaine de votre site.", en: "Thanks! We'll check the business is yours, then publish. To verify instantly, sign in with an address at your website's domain." },
  location: { fr: "Emplacement", en: "Location" },
  billing: { fr: "Abonnement", en: "Subscription" },
  stats: { fr: "Statistiques", en: "Statistics" },
  tierFree: { fr: "Gratuit", en: "Free" },
  tierPro: { fr: "Pro", en: "Pro" },
  proPitch: { fr: "Pro : photos illimitées, vos propres séances publiées dans l'app, un bouton « Réserver », et les statistiques complètes. 29 $/mois ou 290 $/an, taxes en sus, annulable en tout temps.", en: "Pro: unlimited photos, your own sessions published in the app, a Book button, and full statistics. $29/month or $290/year plus tax, cancel any time." },
  upgradeMonthly: { fr: "Passer à Pro — 29 $/mois", en: "Go Pro — $29/month" },
  upgradeYearly: { fr: "290 $/an (2 mois gratuits)", en: "$290/year (2 months free)" },
  manage: { fr: "Gérer l'abonnement et les factures", en: "Manage subscription and invoices" },
  billingDone: { fr: "Merci ! Votre abonnement sera actif dans quelques secondes.", en: "Thanks! Your subscription will be active in a few seconds." },
  billingOff: { fr: "L'abonnement Pro n'est pas encore offert.", en: "Pro isn't available yet." },
  proUntil: { fr: "Actif jusqu'au", en: "Active until" },
  proOnly: { fr: "Réservé à Pro", en: "Pro only" },
  bookingUrl: { fr: "Lien de réservation (https://…)", en: "Booking link (https://…)" },
  sessions: { fr: "Vos séances dans l'app", en: "Your sessions in the app" },
  sessionsHint: { fr: "Publiez une séance (soirée débutants, atelier…) : les gens d'Alentour peuvent s'y joindre en petit groupe, 8 max.", en: "Publish a session (beginner night, workshop…): Alentour users can join as a small group, 8 max." },
  sessionWhen: { fr: "Date et heure (heure de Montréal)", en: "Date and time (Montréal time)" },
  sessionCap: { fr: "Places pour les gens d'Alentour", en: "Spots for Alentour users" },
  addSession: { fr: "Publier la séance", en: "Publish session" },
  noSessions: { fr: "Aucune séance à venir.", en: "No upcoming sessions." },
  going: { fr: "inscrits", en: "going" },
  savesLabel: { fr: "enregistrements (30 jours)", en: "saves (30 days)" },
  joinsLabel: { fr: "personnes venues en sortie (30 jours)", en: "people who came on an outing (30 days)" },
  weekly: { fr: "Enregistrements par semaine", en: "Saves per week" },
  statsUpsell: { fr: "Le détail par semaine fait partie de Pro.", en: "The weekly breakdown is part of Pro." },
} as const;

const EDITABLE_FACETS = ["vibe", "audience", "logistics", "group", "booking", "weather"];
const FACET_LABELS: Record<string, { fr: string; en: string }> = {
  vibe: { fr: "Ambiance", en: "Vibe" }, audience: { fr: "Pour qui", en: "Who it's for" },
  logistics: { fr: "Sur place", en: "On site" }, group: { fr: "En groupe", en: "Groups" },
  booking: { fr: "Réservation", en: "Booking" }, weather: { fr: "Météo", en: "Weather" },
};

export function ownerPages(d: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => (d.now ? d.now() : new Date());
  const csrfFor = (u: SessionUser) => hmac(d.config.secret, `csrf:${u.sessionId}`);
  const mediaUrl = (key: string) => (d.enrich ? d.enrich.storage.url(key) : key);

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
    const [listings, claims, drafts] = await Promise.all([
      ownerListings(d.pool, u.id),
      d.pool.query(`SELECT c.status, c.created_at, v.name FROM claims c JOIN venues v ON v.id = c.venue_id
                     WHERE c.claimant_id = $1 ORDER BY c.created_at DESC`, [u.id]),
      d.pool.query(`SELECT id, input->>'name' AS name, status FROM enrichment_jobs
                     WHERE requested_by = $1 AND origin = 'onboarding' AND status NOT IN ('published', 'discarded')
                     ORDER BY created_at DESC`, [u.id]),
    ]);
    const title = (x: any) => x.content?.[l === "fr" ? "fr-CA" : "en-CA"]?.title ?? x.content?.["fr-CA"]?.title ?? x.slug;
    const published = c.req.query("published");
    return c.html(page(l, tr("listings"), html`
      <p class="muted">${u.email}</p>
      ${published === "published" ? html`<p class="card ok">${tr("publishedNow")}</p>` : ""}
      ${published === "pending_review" ? html`<p class="card ok">${tr("publishedPending")}</p>` : ""}
      ${drafts.rows.length ? html`<section class="card"><h2>${tr("drafts")}</h2><ul class="list">
        ${drafts.rows.map((j: any) => html`<li>${j.name} — <a href="/owner/drafts/${j.id}">${tr("continueDraft")}</a></li>`)}
      </ul></section>` : ""}
      <section class="card">
        <h2>${tr("listings")}</h2>
        ${listings.length ? html`<ul class="list">${listings.map((x: any) => html`
          <li><a href="/owner/activities/${x.id}">${title(x)}</a>
            ${x.status === "pending_review" ? html` <span class="badge">${tr("awaitingReview")}</span>` : ""}
            <span class="muted"> · ${x.venue_name} · ${tr("lastVerified")} ${x.last_verified_at ? fmtDate(x.last_verified_at, l) : tr("never")}</span></li>`)}
        </ul>` : html`<p class="muted">${tr("noListings")}</p>`}
        <p class="inline"><a class="button" href="/owner/new">${tr("addBusiness")}</a> <a class="button secondary" href="/owner/claim">${tr("claim")}</a></p>
        ${listings.length ? html`<p class="inline"><a href="/owner/stats">${tr("stats")} →</a> <a href="/owner/billing">${tr("billing")} →</a></p>` : ""}
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
    x.sessions = await upcomingSessions(x.id);
    return c.html(editPage(l, x, csrfFor(u), c.req.query("saved") === "1" ? "saved" : null, [], mediaUrl));
  });

  app.post("/activities/:id", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const id = c.req.param("id");
    const current = (await ownerListings(d.pool, u.id)).find((r: any) => r.id === id);
    if (!current) return c.text("Not found", 404);
    // all: true — the tag checkboxes repeat one field name, and without it only the last survives.
    const b = await c.req.parseBody({ all: true });
    const r = await applyOwnerEdit(d.pool, u.id, id, formToPatch(b, current), now());
    if (!r.ok) return c.html(editPage(l, current, csrfFor(u), null, r.issues ?? [r.error], mediaUrl), 400);
    return c.redirect(`/owner/activities/${id}?saved=1`);
  });

  app.post("/activities/:id/confirm", async (c) => {
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    await confirmStillAccurate(d.pool, u.id, c.req.param("id"), now());
    return c.redirect(`/owner/activities/${c.req.param("id")}?saved=1`);
  });

  // ---------------------------------------------------------------- photos on a listing
  app.post("/activities/:id/photos", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const id = c.req.param("id");
    const current = (await ownerListings(d.pool, u.id)).find((r: any) => r.id === id);
    if (!current || !d.enrich) return c.text("Not found", 404);
    const b = await c.req.parseBody({ all: true });
    if (b.licence !== "on") return c.html(editPage(l, current, csrfFor(u), null, [T.licenceRequired[l]], mediaUrl), 400);
    const limit = (await providerEntitlements(d.pool, current.provider_id)).maxPhotos;
    const results = await storePhotos(d.pool, d.enrich, { type: "activity", id }, u.id, await filesOf(b.photos), now(), limit);
    const failed = results.filter((r) => r.safety === "error").map((r) => `${r.name}: ${T[`err_${r.error}` as keyof typeof T]?.[l] ?? r.error}`);
    if (failed.length) {
      const fresh = (await ownerListings(d.pool, u.id)).find((r: any) => r.id === id);
      return c.html(editPage(l, fresh, csrfFor(u), null, failed, mediaUrl), 400);
    }
    return c.redirect(`/owner/activities/${id}?saved=1`);
  });

  app.post("/activities/:id/photos/:mid/delete", async (c) => {
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const id = c.req.param("id");
    if (!d.enrich || !(await canEdit(d.pool, u.id, id))) return c.text("Not found", 404);
    await deletePhoto(d.pool, d.enrich, c.req.param("mid"), id);
    return c.redirect(`/owner/activities/${id}`);
  });

  // ---------------------------------------------------------------- self-serve onboarding
  app.get("/new", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    return c.html(newBusinessPage(l, csrfFor(u), {}, []));
  });

  app.post("/new", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    if (!d.enrich) return c.text("Onboarding is not configured on this server.", 503);
    const b = await c.req.parseBody();
    const form = {
      name: String(b.name ?? "").trim().slice(0, 120),
      website: String(b.website ?? "").trim().slice(0, 300),
      address: String(b.address ?? "").trim().slice(0, 200),
      pitch: String(b.pitch ?? "").trim().slice(0, 300),
    };
    const errors: string[] = [];
    if (form.name.length < 2) errors.push(tr("errName"));
    if (form.address.length < 5) errors.push(tr("errAddress"));
    let website: string | null = null;
    if (form.website) {
      try { website = checkUrl(form.website.includes("://") ? form.website : `https://${form.website}`).toString(); }
      catch { errors.push(tr("errWebsite")); }
    }
    if (errors.length) return c.html(newBusinessPage(l, csrfFor(u), form, errors), 400);

    let place;
    try { place = (await d.enrich.geocoder.search(`${form.address}, Montréal, QC`))[0]; } catch { place = undefined; }
    if (!place) return c.html(newBusinessPage(l, csrfFor(u), form, [tr("errNotFound")]), 400);

    if (b.notDuplicate !== "1") {
      const dups = await findDuplicateVenues(d.pool, { name: form.name, lat: place.lat, lon: place.lon, website });
      if (dups.length) return c.html(duplicatePage(l, csrfFor(u), form, dups));
    }
    if (!(await jobAllowance(d.pool, d.enrich, u.id, now()))) {
      return c.html(newBusinessPage(l, csrfFor(u), form, [tr("errLimit")]), 429);
    }
    const jobId = await createJob(d.pool, "onboarding", {
      name: form.name, pitch: form.pitch || null, website, address: place.line1 || form.address,
      lat: place.lat, lon: place.lon, neighbourhood: place.neighbourhood,
    }, u.id);
    d.enrich.kick?.();
    return c.redirect(`/owner/drafts/${jobId}`);
  });

  const ownJob = async (userId: string, id: string) => {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await d.pool.query(`SELECT * FROM enrichment_jobs WHERE id = $1 AND requested_by = $2 AND origin = 'onboarding'`, [id, userId]);
    return rows[0] ?? null;
  };

  app.get("/drafts/:id", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const job = await ownJob(u.id, c.req.param("id"));
    if (!job) return c.text("Not found", 404);
    if (job.status === "published") return c.redirect("/owner");
    if (job.status !== "ready") return c.html(progressPage(l, job, csrfFor(u)));
    const photos = (await d.pool.query(
      `SELECT id, storage_key AS key, safety_status AS status, is_hero AS hero FROM media
        WHERE owner_type = 'job' AND owner_id = $1 ORDER BY sort_order`, [job.id])).rows;
    return c.html(reviewPage(l, job, csrfFor(u), [], null, photos, mediaUrl));
  });

  app.post("/drafts/:id", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const job = await ownJob(u.id, c.req.param("id"));
    if (!job || job.status !== "ready" || !d.enrich) return c.text("Not found", 404);
    const b = await c.req.parseBody({ all: true });

    const errors: string[] = [];
    const files = await filesOf(b.photos);
    if (files.length) {
      if (b.licence !== "on") errors.push(tr("licenceRequired"));
      else {
        const results = await storePhotos(d.pool, d.enrich, { type: "job", id: job.id }, u.id, files, now());
        for (const r of results) if (r.safety === "error") errors.push(`${r.name}: ${T[`err_${r.error}` as keyof typeof T]?.[l] ?? r.error}`);
      }
    }
    const review = formToReview(b, job.draft);
    if (!errors.length) {
      const r = await publishOnboarding(d.pool, job, { id: u.id, email: u.email }, review, now());
      if (r.ok) return c.redirect(`/owner?published=${r.status}`);
      errors.push(...r.errors);
    }
    const photos = (await d.pool.query(
      `SELECT id, storage_key AS key, safety_status AS status, is_hero AS hero FROM media
        WHERE owner_type = 'job' AND owner_id = $1 ORDER BY sort_order`, [job.id])).rows;
    return c.html(reviewPage(l, job, csrfFor(u), errors, b, photos, mediaUrl), 400);
  });

  app.post("/drafts/:id/discard", async (c) => {
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const job = await ownJob(u.id, c.req.param("id"));
    if (job && job.status !== "published") {
      await d.pool.query(`UPDATE enrichment_jobs SET status = 'discarded', updated_at = $2 WHERE id = $1`, [job.id, now()]);
    }
    return c.redirect("/owner");
  });

  // ---------------------------------------------------------------- Business Pro
  const upcomingSessions = async (activityId: string) => (await d.pool.query(
    `SELECT o.id, o.starts_at, o.capacity_max,
            (SELECT count(*)::int FROM outing_participants p WHERE p.outing_id = o.id AND p.status = 'going') AS going
       FROM outings o WHERE o.activity_id = $1 AND o.mode = 'venue_session' AND o.organizer = 'venue'
        AND o.host_provider_id IS NOT NULL AND o.status = 'confirmed' AND o.starts_at > $2 ORDER BY o.starts_at LIMIT 20`,
    [activityId, now()])).rows;

  app.post("/activities/:id/sessions", async (c) => {
    const l = lang(c);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const id = c.req.param("id");
    const x = (await ownerListings(d.pool, u.id)).find((r: any) => r.id === id);
    if (!x) return c.text("Not found", 404);
    x.sessions = await upcomingSessions(id);
    if (!(await providerEntitlements(d.pool, x.provider_id)).hostSessions) {
      return c.html(editPage(l, x, csrfFor(u), null, [T.proOnly[l]], mediaUrl), 402);
    }
    const b = await c.req.parseBody();
    const m = String(b.startsAt ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return c.html(editPage(l, x, csrfFor(u), null, [T.sessionWhen[l]], mediaUrl), 400);
    const startsAt = fromLocal(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, "America/Toronto");
    const r = await createVenueSession(d.pool, x.provider_id, id, startsAt, Number(b.capacity ?? 8), now());
    if (!r.ok) return c.html(editPage(l, x, csrfFor(u), null, ["detail" in r && r.detail ? r.detail : r.error], mediaUrl), 400);
    return c.redirect(`/owner/activities/${id}?saved=1`);
  });

  const myProviders = async (userId: string) => (await d.pool.query(
    `SELECT p.* FROM providers p JOIN provider_members m ON m.provider_id = p.id AND m.user_id = $1
      WHERE m.role IN ('owner', 'manager') ORDER BY p.display_name`, [userId])).rows;

  app.get("/billing", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const providers = await myProviders(u.id);
    const csrf = csrfFor(u);
    return c.html(page(l, tr("billing"), html`
      ${c.req.query("done") ? html`<p class="card ok">${tr("billingDone")}</p>` : ""}
      <p class="muted">${tr("proPitch")}</p>
      ${providers.map((p: any) => html`<section class="card">
        <h2>${p.display_name} <span class="badge">${p.subscription_tier === "pro" ? tr("tierPro") : tr("tierFree")}</span></h2>
        ${p.subscription_tier === "pro" && p.pro_until ? html`<p class="muted">${tr("proUntil")} ${fmtDate(p.pro_until, l)}</p>` : ""}
        ${!d.stripe ? html`<p class="muted">${tr("billingOff")}</p>` : p.subscription_tier !== "pro" ? html`
          <form method="post" action="/owner/billing/checkout" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="provider" value="${p.id}">
            <button name="plan" value="monthly">${tr("upgradeMonthly")}</button>
            <button name="plan" value="yearly" class="secondary">${tr("upgradeYearly")}</button>
          </form>` : ""}
        ${d.stripe && p.stripe_customer_id ? html`
          <form method="post" action="/owner/billing/portal"><input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="provider" value="${p.id}"><button class="secondary">${tr("manage")}</button></form>` : ""}
      </section>`)}
      <p><a href="/owner">${tr("back")}</a></p>`));
  });

  app.post("/billing/checkout", async (c) => {
    const u = await owner(c);
    if (!u || !d.stripe) return c.redirect("/owner/billing");
    const b = await c.req.parseBody();
    const p = (await myProviders(u.id)).find((x: any) => x.id === b.provider);
    if (!p) return c.text("Not found", 404);
    const url = await createCheckout(d.stripe, { id: p.id, stripeCustomerId: p.stripe_customer_id }, u.email,
      b.plan === "yearly" ? "yearly" : "monthly", d.fetch ?? fetch);
    return c.redirect(url, 303);
  });

  app.post("/billing/portal", async (c) => {
    const u = await owner(c);
    if (!u || !d.stripe) return c.redirect("/owner/billing");
    const b = await c.req.parseBody();
    const p = (await myProviders(u.id)).find((x: any) => x.id === b.provider);
    if (!p?.stripe_customer_id) return c.text("Not found", 404);
    return c.redirect(await createPortal(d.stripe, p.stripe_customer_id, d.fetch ?? fetch), 303);
  });

  /** The attribution numbers Pro sells on: people who saved you, people who came. */
  app.get("/stats", async (c) => {
    const l = lang(c), tr = t(l);
    const u = await owner(c);
    if (!u) return c.redirect("/owner");
    const since = new Date(now().getTime() - 30 * 86_400_000);
    const { rows } = await d.pool.query(
      `SELECT a.id, pr.subscription_tier AS tier,
              COALESCE((SELECT title FROM activity_content c WHERE c.activity_id = a.id AND c.locale = $3),
                       (SELECT title FROM activity_content c WHERE c.activity_id = a.id AND c.locale = 'fr-CA')) AS title,
              (SELECT count(*)::int FROM saves s WHERE s.activity_id = a.id AND s.created_at > $2) AS saves,
              (SELECT count(*)::int FROM outing_participants p JOIN outings o ON o.id = p.outing_id
                WHERE o.activity_id = a.id AND p.status = 'going' AND o.starts_at > $2 AND o.starts_at < $4) AS joins,
              (SELECT array_agg(n ORDER BY w) FROM (
                 SELECT gs.w, (SELECT count(*)::int FROM saves s WHERE s.activity_id = a.id
                                 AND s.created_at >= $4::timestamptz - (gs.w + 1) * interval '7 days'
                                 AND s.created_at <  $4::timestamptz - gs.w * interval '7 days') AS n
                   FROM generate_series(0, 7) AS gs(w)) x) AS weekly
         FROM activities a JOIN provider_members m ON m.provider_id = a.provider_id AND m.user_id = $1
         JOIN providers pr ON pr.id = a.provider_id
        ORDER BY saves DESC`, [u.id, since, l === "fr" ? "fr-CA" : "en-CA", now()]);
    return c.html(page(l, tr("stats"), html`
      ${rows.map((r: any) => {
        const e = entitlementsFor(r.tier);
        const weeks = [...(r.weekly ?? [])].reverse();
        const max = Math.max(1, ...weeks);
        return html`<section class="card"><h2>${r.title}</h2>
          <p><strong>${r.saves}</strong> ${tr("savesLabel")} · <strong>${r.joins}</strong> ${tr("joinsLabel")}</p>
          ${e.fullStats ? html`<p class="muted">${tr("weekly")}</p><div class="bars">${weeks.map((n: number) =>
            html`<span title="${n}" style="height:${Math.round((n / max) * 60) + 2}px"></span>`)}</div>`
            : html`<p class="muted">${tr("statsUpsell")} <a href="/owner/billing">${tr("billing")} →</a></p>`}
        </section>`;
      })}
      <p><a href="/owner">${tr("back")}</a></p>`));
  });

  return app;
}

// -------------------------------------------------------------------- rendering

type Hint = { confidence: number; evidence: string } | null | undefined;
export interface Hints {
  price?: Hint; duration?: Hint; hours?: Hint; minAge?: Hint; weather?: Hint; bring?: Hint;
  tags?: Record<string, { confidence: number; evidence: string }>;
  a11y?: { slug: string; says: "yes" | "no"; evidence: string }[];
}

function hintLine(l: L, h: Hint) {
  if (!h) return "";
  const level = h.confidence >= 0.85 ? T.confHigh[l] : T.confMedium[l];
  return html`<small class="hint">✦ ${T.fromSite[l]} « ${h.evidence} » · ${level}</small>`;
}

/** The listing fields shared by the edit page and the onboarding review (prefixed per activity). */
function listingFields(l: L, x: any, prefix = "", hints: Hints = {}) {
  const tr = (k: keyof typeof T) => T[k][l];
  const tax = loadTaxonomy();
  const lbl = (tag: { fr: string; en: string }) => (l === "fr" ? tag.fr : tag.en);
  const a11y = tax.facets.find((f) => f.key === "accessibility")?.tags ?? [];
  const facets = tax.facets.filter((f) => EDITABLE_FACETS.includes(f.key));
  const tags = new Set<string>(x.tags ?? []);
  const content = (loc: string) => x.content?.[loc] ?? {};
  const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));
  const n = (k: string) => `${prefix}${k}`;
  const weather = ["indoor", "covered", "outdoor", "either"] as const;
  return html`
      ${["fr-CA", "en-CA"].map((loc) => html`
        <fieldset class="card"><legend>${loc === "fr-CA" ? "Français" : "English"}</legend>
          <label>${tr("titleF")}<input name="${n(`title_${loc}`)}" value="${content(loc).title ?? ""}" maxlength="90" ${loc === "fr-CA" ? "required" : ""}></label>
          <label>${tr("summary")}<input name="${n(`summary_${loc}`)}" value="${content(loc).summary ?? ""}" maxlength="160"></label>
          <label>${tr("description")}<textarea name="${n(`description_${loc}`)}" rows="4" maxlength="2000">${content(loc).description ?? ""}</textarea></label>
          <label>${tr("bring")}<input name="${n(`whatToBring_${loc}`)}" value="${content(loc).whatToBring ?? ""}" maxlength="300"></label>
        </fieldset>`)}
      <fieldset class="card"><legend>${tr("practical")}</legend>
        <label class="check"><input type="checkbox" name="${n("isFree")}" ${x.is_free ? "checked" : ""}> ${tr("free")}</label>
        <div class="row">
          <label>${tr("priceMin")}<input name="${n("priceMin")}" type="number" min="0" step="0.5" value="${dollars(x.price_min_cents)}"></label>
          <label>${tr("priceMax")}<input name="${n("priceMax")}" type="number" min="0" step="0.5" value="${dollars(x.price_max_cents)}"></label>
        </div>
        ${hintLine(l, hints.price)}
        <label>${tr("duration")}<input name="${n("duration")}" type="number" min="5" max="1440" value="${x.typical_duration_minutes ?? ""}"></label>
        ${hintLine(l, hints.duration)}
        <label>${tr("hours")}<input name="${n("openingHours")}" value="${x.opening_hours ?? ""}" placeholder="Mo-Fr 09:00-17:00">
          <small class="muted">${tr("hoursHint")}</small></label>
        ${hintLine(l, hints.hours)}
        <div class="row">
          <label>${tr("minAge")}<input name="${n("minAge")}" type="number" min="0" max="99" value="${x.min_age ?? ""}"></label>
          <label>${tr("weatherF")}<select name="${n("weather")}">
            <option value="">—</option>
            ${weather.map((w) => html`<option value="${w}" ${x.weather_dependency === w ? "selected" : ""}>${tr(`w_${w}` as keyof typeof T)}</option>`)}
          </select></label>
        </div>
        ${hintLine(l, hints.minAge)}
        ${x.tier === "pro" ? html`<label>${tr("bookingUrl")}<input name="${n("bookingUrl")}" type="url" value="${x.booking_url ?? ""}" placeholder="https://" maxlength="300"></label>`
          : x.tier ? html`<p class="muted small">${tr("bookingUrl")} — ${tr("proOnly")} · <a href="/owner/billing">${tr("billing")} →</a></p>` : ""}
      </fieldset>
      <fieldset class="card"><legend>${tr("a11y")}</legend>
        <p class="muted">${tr("a11yHint")}</p>
        ${a11y.map((tag) => {
          const v = x.a11y?.[tag.slug];
          const val = v === true ? "yes" : v === false ? "no" : "unknown";
          const mention = hints.a11y?.find((m) => m.slug === tag.slug);
          return html`<div class="tri"><span>${lbl(tag)}${mention ? html`<small class="hint">✦ ${T.siteSays[l]} « ${mention.evidence} » — ${T.pleaseConfirm[l]}</small>` : ""}</span>
            ${(["yes", "no", "unknown"] as const).map((o) => html`<label class="check"><input type="radio" name="${n(`a11y_${tag.slug}`)}" value="${o}" ${val === o ? "checked" : ""}> ${tr(o)}</label>`)}
          </div>`;
        })}
      </fieldset>
      <fieldset class="card"><legend>${tr("tags")}</legend>
        ${facets.map((f) => html`<div class="facet"><strong>${FACET_LABELS[f.key]?.[l] ?? f.key}</strong>
          ${(f.tags ?? []).map((tag) => {
            const h = hints.tags?.[tag.slug];
            return html`<label class="check" ${h ? html`title="${h.evidence}"` : ""}><input type="checkbox" name="${n("tag")}" value="${tag.slug}" ${tags.has(tag.slug) ? "checked" : ""}> ${lbl(tag)}${h ? " ✦" : ""}</label>`;
          })}
        </div>`)}
      </fieldset>`;
}

function photoSection(l: L, x: any, csrf: string, mediaUrl: (key: string) => string) {
  const photos: any[] = x.photos ?? [];
  return html`
    <section class="card"><h2>${T.photos[l]}</h2>
      ${photos.length ? html`<div class="photos">${photos.map((p) => html`
        <figure>${p.status === "rejected" ? html`<div class="ph-none"></div>` : html`<img src="${mediaUrl(p.key)}" alt="" loading="lazy">`}
          <figcaption>${p.hero ? `★ ${T.hero[l]} · ` : ""}${T[`ph_${p.status}` as keyof typeof T][l]}</figcaption>
          <form method="post" action="/owner/activities/${x.id}/photos/${p.id}/delete"><input type="hidden" name="_csrf" value="${csrf}"><button class="link">${T.remove[l]}</button></form>
        </figure>`)}</div>` : html`<p class="muted">${T.noPhotos[l]}</p>`}
      <form method="post" action="/owner/activities/${x.id}/photos" enctype="multipart/form-data">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple>
        <label class="check"><input type="checkbox" name="licence" required> ${T.licence[l]}</label>
        <p class="muted small">${T.photoRules[l]}</p>
        <button class="secondary">${T.upload[l]}</button>
      </form>
    </section>`;
}

function sessionSection(l: L, x: any, csrf: string) {
  const tr = (k: keyof typeof T) => T[k][l];
  const sessions: any[] = x.sessions ?? [];
  return html`<section class="card"><h2>${tr("sessions")}</h2>
    <p class="muted small">${tr("sessionsHint")}</p>
    ${sessions.length ? html`<ul class="list">${sessions.map((o) => html`<li>${new Date(o.starts_at).toLocaleString(l === "fr" ? "fr-CA" : "en-CA",
      { timeZone: "America/Toronto", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} — ${o.going}/${o.capacity_max} ${tr("going")}</li>`)}</ul>`
      : html`<p class="muted">${tr("noSessions")}</p>`}
    ${x.tier === "pro" ? html`<form method="post" action="/owner/activities/${x.id}/sessions" class="row">
        <input type="hidden" name="_csrf" value="${csrf}">
        <label>${tr("sessionWhen")}<input type="datetime-local" name="startsAt" required></label>
        <label>${tr("sessionCap")}<input type="number" name="capacity" min="3" max="8" value="8"></label>
        <button>${tr("addSession")}</button></form>`
      : html`<p class="muted small">${tr("proOnly")} · <a href="/owner/billing">${tr("billing")} →</a></p>`}
  </section>`;
}

function editPage(l: L, x: any, csrf: string, notice: "saved" | null, errors: string[], mediaUrl: (key: string) => string) {
  const tr = (k: keyof typeof T) => T[k][l];
  const content = (loc: string) => x.content?.[loc] ?? {};
  return page(l, content(l === "fr" ? "fr-CA" : "en-CA").title ?? x.slug, html`
    <p><a href="/owner">${tr("back")}</a> · <span class="muted">${x.venue_name}</span>
      ${x.status === "pending_review" ? html` · <span class="badge">${tr("awaitingReview")}</span>` : ""}</p>
    ${notice ? html`<p class="card ok">${tr("saved")}</p>` : ""}
    ${errors.length ? html`<div class="card error"><strong>${tr("errors")}</strong><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
    <form method="post" action="/owner/activities/${x.id}/confirm" class="inline">
      <input type="hidden" name="_csrf" value="${csrf}">
      <button class="secondary">✓ ${tr("stillAccurate")}</button>
      <span class="muted">${tr("lastVerified")} : ${x.last_verified_at ? fmtDate(x.last_verified_at, l) : tr("never")}</span>
    </form>
    ${photoSection(l, x, csrf, mediaUrl)}
    ${sessionSection(l, x, csrf)}
    <form method="post" action="/owner/activities/${x.id}">
      <input type="hidden" name="_csrf" value="${csrf}">
      ${listingFields(l, x)}
      <button>${tr("save")}</button>
    </form>`);
}

/** Map the flat form fields back onto an OwnerPatch. Only differences become tag changes. */
export function formToPatch(b: Record<string, unknown>, current: any, prefix = ""): OwnerPatch {
  const str = (k: string) => (typeof b[prefix + k] === "string" ? (b[prefix + k] as string).trim() : "");
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
    if (!k.startsWith(`${prefix}a11y_`)) continue;
    const slug = k.slice(prefix.length + 5);
    const next = v === "yes" ? true : v === "no" ? false : null;
    const prev = current.a11y?.[slug] ?? null;
    if (next !== prev) a11y[slug] = next;
  }
  const raw = b[`${prefix}tag`];
  const wanted = new Set(Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : []);
  const had = new Set<string>(current.tags ?? []);
  const editable = new Set(loadTaxonomy().facets.filter((f) => EDITABLE_FACETS.includes(f.key)).flatMap((f) => (f.tags ?? []).map((t) => t.slug)));
  const duration = str("duration");
  const minAge = str("minAge");
  const weather = str("weather");
  return {
    ...(Object.keys(content).length ? { content } : {}),
    isFree: b[`${prefix}isFree`] === "on",
    priceMinCents: cents("priceMin"),
    priceMaxCents: cents("priceMax"),
    typicalDurationMinutes: duration ? Number(duration) : null,
    openingHours: str("openingHours") || null,
    minAge: minAge ? Number(minAge) : null,
    weather: (["indoor", "covered", "outdoor", "either"].includes(weather) ? weather : null) as OwnerPatch["weather"],
    ...(typeof b[`${prefix}bookingUrl`] === "string" ? { bookingUrl: str("bookingUrl") || null } : {}),
    ...(Object.keys(a11y).length ? { a11y } : {}),
    tagsAdd: [...wanted].filter((s) => !had.has(s) && editable.has(s)),
    tagsRemove: [...had].filter((s) => !wanted.has(s) && editable.has(s)),
  };
}

// -------------------------------------------------------------------- onboarding pages

async function filesOf(v: unknown): Promise<{ name: string; bytes: Buffer }[]> {
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const out: { name: string; bytes: Buffer }[] = [];
  for (const f of list) {
    if (f instanceof File && f.size > 0) out.push({ name: f.name.slice(0, 80), bytes: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

function newBusinessPage(l: L, csrf: string, form: Record<string, string>, errors: string[]) {
  const tr = (k: keyof typeof T) => T[k][l];
  return page(l, tr("newTitle"), html`
    <p class="muted">${tr("newIntro")}</p>
    ${errors.length ? html`<div class="card error"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
    <form method="post" action="/owner/new" class="card">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label>${tr("nameF")}<input name="name" value="${form.name ?? ""}" required minlength="2" maxlength="120"></label>
      <label>${tr("websiteF")}<input name="website" value="${form.website ?? ""}" inputmode="url" placeholder="https://" maxlength="300"></label>
      <label>${tr("addressF")}<input name="address" value="${form.address ?? ""}" required minlength="5" maxlength="200" autocomplete="street-address"></label>
      <label>${tr("pitchF")}<input name="pitch" value="${form.pitch ?? ""}" maxlength="300"></label>
      <button>${tr("draftIt")}</button>
    </form>
    <p><a href="/owner">${tr("back")}</a></p>`);
}

function duplicatePage(l: L, csrf: string, form: Record<string, string>, dups: DuplicateVenue[]) {
  const tr = (k: keyof typeof T) => T[k][l];
  return page(l, tr("dupTitle"), html`
    <p>${tr("dupIntro")}</p>
    ${dups.map((v) => html`<div class="card"><h2>${v.name}</h2><p class="muted">${v.address ?? ""}</p>
      <a class="button" href="/owner/claim?q=${encodeURIComponent(v.name)}">${tr("claimThis")}</a></div>`)}
    <form method="post" action="/owner/new">
      <input type="hidden" name="_csrf" value="${csrf}">
      ${Object.entries(form).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
      <input type="hidden" name="notDuplicate" value="1">
      <button class="secondary">${tr("notMe")}</button>
    </form>`);
}

function progressPage(l: L, job: any, csrf: string) {
  const tr = (k: keyof typeof T) => T[k][l];
  if (job.status === "failed" || job.status === "discarded") {
    return page(l, tr("newTitle"), html`<p class="card error">${tr("failed")}</p><p><a href="/owner">${tr("back")}</a></p>`);
  }
  const steps = job.input.website ? ["fetching", "extracting", "writing"] : ["extracting", "writing"];
  const at = Math.max(0, steps.indexOf(job.status));
  return page(l, tr("working"), html`
    <ol class="steps">${steps.map((st, i) => html`<li class="${i < at ? "done" : i === at ? "now" : ""}">${tr(`step_${st}` as keyof typeof T)}</li>`)}</ol>
    <form method="post" action="/owner/drafts/${job.id}/discard"><input type="hidden" name="_csrf" value="${csrf}"><button class="link">${tr("discard")}</button></form>`,
    raw(`<meta http-equiv="refresh" content="2">`));
}

/** Form state for one draft activity: what the owner sees pre-filled. */
function draftState(a: DraftActivity) {
  const copy = { ...a.copy } as any;
  if (a.whatToBring && copy["fr-CA"] && !copy["fr-CA"].whatToBring) copy["fr-CA"] = { ...copy["fr-CA"], whatToBring: a.whatToBring.value };
  return {
    content: copy,
    is_free: a.price?.value.isFree ?? false,
    price_min_cents: a.price?.value.minCents ?? null,
    price_max_cents: a.price?.value.maxCents ?? null,
    typical_duration_minutes: a.durationMinutes?.value ?? null,
    opening_hours: a.openingHours?.value ?? null,
    min_age: a.minAge?.value ?? null,
    weather_dependency: a.weather?.value ?? null,
    a11y: {},                                          // never pre-filled: only the owner answers
    tags: a.tags.map((t) => t.slug),
  };
}

/** Form state rebuilt from a submitted form, so a failed publish shows what the owner typed. */
function submittedState(p: OwnerPatch) {
  return {
    content: p.content ?? {}, is_free: p.isFree ?? false, price_min_cents: p.priceMinCents ?? null,
    price_max_cents: p.priceMaxCents ?? null, typical_duration_minutes: p.typicalDurationMinutes ?? null,
    opening_hours: p.openingHours ?? null, min_age: p.minAge ?? null, weather_dependency: p.weather ?? null,
    a11y: p.a11y ?? {}, tags: p.tagsAdd ?? [],
  };
}

const KIND_KEYS = ["place", "recurring_program", "scheduled_event", "self_guided", "seasonal"] as const;

export function formToReview(b: Record<string, unknown>, draft: Draft): Review {
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const activities: Review["activities"] = [];
  draft.activities.forEach((a, i) => {
    const p = `a${i}_`;
    if (b[`${p}include`] !== "on") return;
    activities.push({
      key: a.key,
      kind: (KIND_KEYS as readonly string[]).includes(str(`${p}kind`)) ? (str(`${p}kind`) as Review["activities"][number]["kind"]) : "place",
      primaryCategory: str(`${p}category`),
      patch: formToPatch(b, { tags: [], a11y: {} }, p),
    });
  });
  return {
    activities,
    phone: str("phone") || null,
    confirmPrice: b.confirmPrice === "on",
    confirmA11y: b.confirmA11y === "on",
    expressConsent: b.consent === "on",
  };
}

function reviewPage(l: L, job: any, csrf: string, errors: string[], submitted: Record<string, unknown> | null, photos: any[], mediaUrl: (k: string) => string) {
  const tr = (k: keyof typeof T) => T[k][l];
  const draft = job.draft as Draft;
  const lbl = (tag: { fr: string; en: string }) => (l === "fr" ? tag.fr : tag.en);
  const categories = facet(loadTaxonomy(), "category").tags ?? [];
  const review = submitted ? formToReview(submitted, draft) : null;
  const note = draft.note ? T[`note_${draft.note}` as keyof typeof T]?.[l] : null;

  return page(l, tr("reviewTitle"), html`
    <p class="muted">${tr("reviewIntro")}</p>
    ${note ? html`<p class="card">${note}</p>` : ""}
    ${errors.length ? html`<div class="card error"><strong>${tr("errors")}</strong><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
    <p class="muted">${tr("location")} : ${job.input.address ?? ""} ${job.input.neighbourhood ? `· ${job.input.neighbourhood}` : ""}
      · <a href="https://www.openstreetmap.org/?mlat=${job.input.lat}&mlon=${job.input.lon}#map=18/${job.input.lat}/${job.input.lon}" target="_blank" rel="noopener">OSM ↗</a></p>
    <form method="post" action="/owner/drafts/${job.id}" enctype="multipart/form-data">
      <input type="hidden" name="_csrf" value="${csrf}">
      ${draft.activities.map((a, i) => {
        const p = `a${i}_`;
        const r = review?.activities.find((x) => x.key === a.key);
        const included = submitted ? submitted[`${p}include`] === "on" : true;
        const state = r ? submittedState(r.patch) : draftState(a);
        const kind = r?.kind ?? a.kind;
        const category = r?.primaryCategory ?? a.primaryCategory?.value ?? "";
        const hints = {
          price: a.price, duration: a.durationMinutes, hours: a.openingHours, minAge: a.minAge, weather: a.weather,
          tags: Object.fromEntries(a.tags.map((t) => [t.slug, t])), a11y: a.a11yMentions,
        };
        return html`<section class="activity">
          <h2>${a.name}</h2>
          <label class="check"><input type="checkbox" name="${p}include" ${included ? "checked" : ""}> ${tr("include")}</label>
          <div class="card">
            <div class="row">
              <label>${tr("kindF")}<select name="${p}kind">${KIND_KEYS.map((k) => html`<option value="${k}" ${kind === k ? "selected" : ""}>${tr(`k_${k}` as keyof typeof T)}</option>`)}</select></label>
              <label>${tr("categoryF")}<select name="${p}category"><option value="">${tr("chooseCategory")}</option>
                ${categories.map((c) => html`<option value="${c.slug}" ${category === c.slug ? "selected" : ""}>${lbl(c)}</option>`)}</select></label>
            </div>
            ${a.primaryCategory ? hintLine(l, a.primaryCategory) : ""}
          </div>
          ${listingFields(l, state, p, hints)}
        </section>`;
      })}
      <fieldset class="card"><legend>${tr("photos")}</legend>
        ${photos.length ? html`<div class="photos">${photos.map((ph) => html`<figure>${ph.status === "rejected" ? html`<div class="ph-none"></div>` : html`<img src="${mediaUrl(ph.key)}" alt="">`}<figcaption>${tr(`ph_${ph.status}` as keyof typeof T)}</figcaption></figure>`)}</div>` : ""}
        <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple>
        <label class="check"><input type="checkbox" name="licence" ${submitted?.licence === "on" ? "checked" : ""}> ${tr("licence")}</label>
        <p class="muted small">${tr("photoRules")}</p>
      </fieldset>
      <fieldset class="card">
        <label>${tr("phoneF")}<input name="phone" type="tel" value="${(submitted?.phone as string) ?? draft.phone ?? ""}"></label>
        <label class="check"><input type="checkbox" name="confirmPrice" required ${submitted?.confirmPrice === "on" ? "checked" : ""}> ${tr("confirmPrice")}</label>
        <label class="check"><input type="checkbox" name="confirmA11y" required ${submitted?.confirmA11y === "on" ? "checked" : ""}> ${tr("confirmA11y")}</label>
        <label class="check"><input type="checkbox" name="consent" ${submitted?.consent === "on" ? "checked" : ""}> ${tr("consent")}</label>
      </fieldset>
      <button>${tr("publish")}</button>
    </form>
    <form method="post" action="/owner/drafts/${job.id}/discard"><input type="hidden" name="_csrf" value="${csrf}"><button class="link">${tr("discard")}</button></form>`);
}

function logoutForm(l: L, csrf: string) {
  return html`<form method="post" action="/owner/logout"><input type="hidden" name="_csrf" value="${csrf}"><button class="secondary">${T.signOut[l]}</button></form>`;
}

function fmtDate(d: Date | string, l: L) {
  return new Date(d).toLocaleDateString(l === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function page(l: L, title: string, body: unknown, head: unknown = "") {
  return html`<!doctype html>
<html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Alentour</title>${head}
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
.list{padding-left:1.1rem}.list li{margin:.35rem 0}
select{display:block;width:100%;margin-top:.25rem;padding:.55rem .6rem;border:1px solid var(--rule);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
.hint{display:block;color:var(--accent);font-size:.8rem;margin:-.2rem 0 .4rem}.small{font-size:.8rem}
.badge{display:inline-block;background:var(--soft);color:var(--accent);border-radius:99px;padding:.05rem .55rem;font-size:.8rem}
button.link{background:none;color:var(--ink3);padding:.2rem 0;font-weight:400;text-decoration:underline}
.photos{display:flex;flex-wrap:wrap;gap:.75rem;margin-bottom:.75rem}.photos figure{margin:0;width:140px}
.photos img,.ph-none{width:140px;height:105px;object-fit:cover;border-radius:8px;background:var(--rule);display:block}
.photos figcaption{font-size:.8rem;color:var(--ink3)}
.bars{display:flex;align-items:flex-end;gap:6px;height:64px}.bars span{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-width:8px}
.activity{border-top:2px solid var(--rule);padding-top:1rem;margin-top:1rem}
.steps li{margin:.4rem 0;color:var(--ink3)}.steps li.done{color:var(--accent)}.steps li.done::after{content:" ✓"}.steps li.now{color:var(--ink);font-weight:600}.steps li.now::after{content:" …"}.error{color:var(--danger)}.ok{border-color:var(--accent);color:var(--accent);font-weight:600}
`;
