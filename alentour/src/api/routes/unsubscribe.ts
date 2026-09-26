/**
 * /u/:token — the CASL unsubscribe. No sign-in, no questions, permanent, and it keeps working
 * as long as the token exists (CASL asks for at least 60 days). GET shows a confirmation
 * button, so link scanners that prefetch URLs can't unsubscribe anyone by accident; POST does
 * it, which also serves RFC 8058 one-click requests from mail providers.
 */
import { Hono } from "hono";
import { html } from "hono/html";
import type { AppEnv, Deps } from "../context.ts";
import { unsubscribe } from "../../outreach/send.ts";

const PAGE = (body: unknown) => html`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Alentour</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#151A18;background:#F4F6F3}
button{background:#1F5F4B;color:#fff;border:0;border-radius:8px;padding:.7rem 1.2rem;font:inherit;font-weight:600;cursor:pointer}
.en{color:#6B746F}</style></head><body>${body}</body></html>`;

export function unsubscribeRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  const ok = (t: string) => /^[0-9a-f]{32}$/.test(t);

  app.get("/:token", (c) => {
    const t = c.req.param("token");
    if (!ok(t)) return c.html(PAGE(html`<p>Lien invalide.</p><p class="en">Invalid link.</p>`), 404);
    return c.html(PAGE(html`
      <h1>Se désabonner</h1>
      <p>Vous ne recevrez plus aucun courriel d'Alentour à cette adresse, ni à votre entreprise.</p>
      <p class="en">You won't receive any more emails from Alentour at this address or your business.</p>
      <form method="post" action="/u/${t}"><button>Me désabonner / Unsubscribe</button></form>`));
  });

  app.post("/:token", async (c) => {
    const t = c.req.param("token");
    if (!ok(t) || !(await unsubscribe(d.pool, t))) return c.html(PAGE(html`<p>Lien invalide.</p><p class="en">Invalid link.</p>`), 404);
    return c.html(PAGE(html`<h1>C'est fait.</h1><p>Vous êtes désabonné, de façon permanente.</p>
      <p class="en">Done. You're unsubscribed, permanently.</p>`));
  });
  return app;
}
