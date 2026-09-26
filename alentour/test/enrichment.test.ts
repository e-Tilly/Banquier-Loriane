/** Stage 4 units: the parts of the enrichment pipeline that need no database or network. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkUrl, isPrivateAddress } from "../src/enrichment/net.ts";
import { isAllowed, parseRobots } from "../src/enrichment/robots.ts";
import { businessFacts, htmlToText, interestingLinks, parsePage } from "../src/enrichment/html.ts";
import { evidenceFound, gate, normalize, numbersIn, isHighConfidence } from "../src/enrichment/gate.ts";
import { checkCopy, allowedNumbers } from "../src/enrichment/copy.ts";
import { processImage, readOrientation, sniff } from "../src/enrichment/images.ts";
import { signV4 } from "../src/enrichment/storage.ts";
import { pickHero, safetyFor } from "../src/enrichment/triage.ts";
import { extractionSchema, systemPrompt } from "../src/enrichment/extract.ts";
import { toCatalogActivity } from "../src/catalog/export.ts";
import { fakeJpeg, fakePng, fakeWebp, extraction, activity } from "./helpers/enrichment.ts";

describe("fetching owner-supplied URLs", () => {
  test("private, loopback, link-local and metadata addresses are refused", () => {
    for (const ip of ["127.0.0.1", "10.0.0.8", "172.20.1.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700::6810:84e5"]) assert.equal(isPrivateAddress(ip), false, ip);
  });

  test("URLs are checked before any connection", () => {
    assert.throws(() => checkUrl("file:///etc/passwd"), /http and https/);
    assert.throws(() => checkUrl("http://user:pw@example.com/"), /credentials/);
    assert.throws(() => checkUrl("http://example.com:5432/"), /ports/);
    assert.throws(() => checkUrl("http://localhost/"), /not public/);
    assert.throws(() => checkUrl("http://169.254.169.254/latest/meta-data"), /not public/);
    assert.throws(() => checkUrl("http://[::1]/"), /not public/);
    assert.equal(checkUrl("https://allezup.com/fr").hostname, "allezup.com");
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(`
User-agent: *
Disallow: /admin
Disallow: /*.pdf$
Allow: /admin/public

User-agent: AlentourBot
Disallow: /tarifs-internes
`);
  test("our own group wins over *", () => {
    assert.equal(isAllowed(rules, "/tarifs-internes"), false);
    assert.equal(isAllowed(rules, "/admin"), true, "the * group no longer applies once ours exists");
  });
  test("longest match wins, Allow wins ties, wildcards work", () => {
    const star = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /*.pdf$");
    assert.equal(isAllowed(star, "/admin/x"), false);
    assert.equal(isAllowed(star, "/admin/public/page"), true);
    assert.equal(isAllowed(star, "/menu.pdf"), false);
    assert.equal(isAllowed(star, "/menu.pdf?x=1"), true, "$ anchors the end");
    assert.equal(isAllowed(parseRobots(""), "/anything"), true);
    assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow: /"), "/"), false);
  });
});

describe("reading a page", () => {
  const html = `<!doctype html><html lang="fr-CA"><head><title>Céramic Café &amp; Studio</title>
    <meta name="description" content="Peinture sur céramique, Plateau">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Céramic Café","telephone":"+1 514-555-0100","openingHours":"Mo-Su 11:00-22:00","priceRange":"$$"}</script>
    <style>.x{color:red}</style></head>
    <body><nav><a href="/fr/a-propos">À propos</a><a href="/fr/tarifs">Tarifs</a><a href="https://other.example/tarifs">ext</a>
      <a href="https://www.instagram.com/ceramiccafe/">IG</a><a href="tel:514-555-0100">Appeler</a><a href="mailto:allo@ceramiccafe.ca">Écrire</a></nav>
    <main><h1>Peignez votre tasse</h1><p>Frais de studio 12,50&nbsp;$ par personne.</p><script>track()</script></main></body></html>`;
  const page = parsePage(html, "https://ceramiccafe.ca/fr");

  test("metadata, structured data, contact points and socials", () => {
    assert.equal(page.title, "Céramic Café & Studio");
    assert.equal(page.description, "Peinture sur céramique, Plateau");
    assert.equal(page.lang, "fr-CA");
    assert.equal(businessFacts(page.jsonLd).openingHours, "Mo-Su 11:00-22:00");
    assert.deepEqual(page.phones, ["5145550100"]);
    assert.deepEqual(page.emails, ["allo@ceramiccafe.ca"]);
    assert.equal(page.socials.instagram, "https://www.instagram.com/ceramiccafe/");
  });
  test("visible text only, entities decoded", () => {
    assert.ok(page.text.includes("Frais de studio 12,50 $ par personne."));
    assert.ok(!page.text.includes("track()") && !page.text.includes("color:red"));
    assert.equal(htmlToText("<p>a</p><p>a</p><p>b</p>"), "a\nb", "repeated lines collapse");
  });
  test("only same-site pages about hours, prices or activities are followed", () => {
    assert.deepEqual(interestingLinks(page, "https://ceramiccafe.ca/fr"),
      ["https://ceramiccafe.ca/fr/a-propos", "https://ceramiccafe.ca/fr/tarifs"]);
  });
});

describe("the confidence gate", () => {
  const source = `[OWNER] Business name: Bloc Shop
[PAGE https://blocshop.ca] Escalade de bloc pour tous les niveaux. Entrée : 22,50 $ par personne, location de souliers 5 $.
Ouvert du lundi au vendredi de 6 h à 23 h. Cours d'initiation de 90 minutes. Ambiance conviviale, on jase entre les essais.
Nos murs sont au rez-de-chaussée, entrée de plain-pied.`;

  test("quotes must be in the source, numbers must be in their quote", () => {
    const { activities, dropped } = gate({ source, extraction: extraction([activity({
      price: { is_free: false, min_dollars: 22.5, max_dollars: null, unit: "per_person", confidence: 0.95, evidence: "Entrée : 22,50 $ par personne" },
      duration_minutes: { value: 90, confidence: 0.9, evidence: "Cours d'initiation de 90 minutes" },
      opening_hours: { value: "Mo-Fr 06:00-23:00", confidence: 0.9, evidence: "Ouvert du lundi au vendredi de 6 h à 23 h" },
      tags: [
        { slug: "audience.beginners_welcome", confidence: 0.9, evidence: "pour tous les niveaux" },
        { slug: "logistics.lockers", confidence: 0.9, evidence: "casiers gratuits" },            // not in the source
        { slug: "group.conversation_friendly", confidence: 0.4, evidence: "on jase entre les essais" }, // too unsure
      ],
      min_age: { value: 16, confidence: 0.9, evidence: "pour tous les niveaux" },                // number not in quote
    })]) });
    const a = activities[0]!;
    assert.deepEqual(a.price?.value, { isFree: false, minCents: 2250, maxCents: null, unit: "per_person" });
    assert.equal(a.durationMinutes?.value, 90);
    assert.equal(a.openingHours?.value, "Mo-Fr 06:00-23:00");
    assert.deepEqual(a.tags.map((t) => t.slug), ["audience.beginners_welcome"]);
    assert.equal(a.minAge, null);
    const reasons = Object.fromEntries(dropped.map((d) => [d.field, d.reason]));
    assert.match(reasons["activities[0].tags.logistics.lockers"]!, /evidence not found/);
    assert.match(reasons["activities[0].tags.group.conversation_friendly"]!, /low confidence/);
    assert.match(reasons["activities[0].min_age"]!, /age not in its quote/);
  });

  test("an invented price, a price without a quote, and free without saying so are all dropped", () => {
    for (const price of [
      { is_free: false, min_dollars: 25, max_dollars: null, unit: null, confidence: 0.95, evidence: "Entrée : 22,50 $ par personne" },
      { is_free: true, min_dollars: null, max_dollars: null, unit: null, confidence: 0.95, evidence: "Escalade de bloc pour tous les niveaux" },
      { is_free: false, min_dollars: 5, max_dollars: 2, unit: null, confidence: 0.95, evidence: "location de souliers 5 $" },
    ]) {
      const { activities } = gate({ source, extraction: extraction([activity({ price })]) });
      assert.equal(activities[0]!.price, null, JSON.stringify(price));
    }
  });

  test("hours must parse; scales must be in range; at most three vibes", () => {
    const { activities } = gate({ source, extraction: extraction([activity({
      opening_hours: { value: "weekdays 6 to 11", confidence: 0.9, evidence: "Ouvert du lundi au vendredi" },
      physical_demand: { value: 7, confidence: 0.9, evidence: "Escalade de bloc" },
      icebreaker_score: { value: 2, confidence: 0.9, evidence: "on jase entre les essais" },
      tags: ["vibe.social", "vibe.get_moving", "vibe.chill", "vibe.silly"].map((slug, i) => ({ slug, confidence: 0.9 - i * 0.05, evidence: "Ambiance conviviale" })),
    })]) });
    const a = activities[0]!;
    assert.equal(a.openingHours, null);
    assert.equal(a.physicalDemand, null);
    assert.equal(a.icebreakerScore?.value, 2);
    assert.deepEqual(a.tags.map((t) => t.slug), ["vibe.social", "vibe.get_moving", "vibe.chill"]);
  });

  test("accessibility is only ever a mention with a real quote, never a value", () => {
    const { activities } = gate({ source, extraction: extraction([activity({
      accessibility_mentions: [
        { slug: "a11y.step_free_entry", says: "yes", evidence: "entrée de plain-pied" },
        { slug: "a11y.accessible_washroom", says: "yes", evidence: "toilettes adaptées" },   // invented
      ],
    })]) });
    const a = activities[0]!;
    assert.deepEqual(a.a11yMentions.map((m) => m.slug), ["a11y.step_free_entry"]);
    assert.ok(!a.tags.some((t) => t.slug.startsWith("a11y.")));
  });

  test("the schema offers accessibility only as a mention, and never price bands", () => {
    const json = JSON.stringify(extractionSchema());
    const tagEnum = JSON.stringify((extractionSchema().shape.activities.element.shape.tags.element.shape.slug as any).options);
    assert.ok(!tagEnum.includes("a11y."), "a11y slugs must not be assertable tags");
    assert.ok(!tagEnum.includes("price."), "price bands are derived, not extracted");
    assert.ok(json.length > 0 && systemPrompt().includes("MENTION ONLY"));
  });

  test("labels with numbers the source doesn't contain fall back to the name", () => {
    const { activities } = gate({ source, extraction: extraction([activity({
      label: { fr: "Bloc à 15 $", en: "Bouldering" }, one_liner: { fr: "Entrée 22,50 $.", en: "Over 500 routes." },
    })]) });
    assert.equal(activities[0]!.copy["fr-CA"]!.title, "Bouldering at Bloc Shop");
    assert.equal(activities[0]!.copy["fr-CA"]!.summary, "Entrée 22,50 $.");
    assert.equal(activities[0]!.copy["en-CA"]!.summary, undefined);
  });

  test("evidence matching ignores case, accents, punctuation and ellipses", () => {
    const src = normalize(source);
    assert.equal(evidenceFound("ESCALADE DE BLOC pour tous les niveaux!", src), true);
    assert.equal(evidenceFound("Escalade de bloc … entree de plain-pied", src), true);
    assert.equal(evidenceFound("", src), false);
    assert.equal(evidenceFound("ab", src), false, "too short to mean anything");
    assert.deepEqual(numbersIn("22,50 $ ou 5$, 90 minutes"), [22.5, 5, 90]);
  });

  test("high confidence means category, tags and price all clear the bar", () => {
    const { activities } = gate({ source, extraction: extraction([activity({})]) });
    assert.equal(isHighConfidence(activities[0]!), true);
    const low = gate({ source, extraction: extraction([activity({ primary_category: { value: "category.sports", confidence: 0.7, evidence: "Escalade de bloc" } })]) });
    assert.equal(isHighConfidence(low.activities[0]!), false);
  });
});

describe("copy checks", () => {
  test("numbers must come from the facts; hype is refused", () => {
    const { activities } = gate({
      source: "[PAGE x] Entrée 22,50 $. Séance de 2 heures.",
      extraction: extraction([activity({
        price: { is_free: false, min_dollars: 22.5, max_dollars: null, unit: null, confidence: 0.9, evidence: "Entrée 22,50 $" },
        duration_minutes: { value: 120, confidence: 0.9, evidence: "Séance de 2 heures" },
        primary_category: null, tags: [],
      })]),
    });
    const allowed = allowedNumbers(activities[0]!);
    assert.deepEqual(checkCopy("Comptez 22,50 $ pour une séance de 120 minutes.", allowed), []);
    assert.match(checkCopy("Plus de 300 voies à essayer.", allowed)[0]!, /300/);
    assert.match(checkCopy("Le meilleur bloc en ville.", allowed)[0]!, /hype/);
    assert.match(checkCopy("The best climbing gym.", allowed)[0]!, /hype/);
  });
});

describe("photos", () => {
  test("JPEG: GPS and camera EXIF are removed, orientation survives, dimensions are read", () => {
    const input = fakeJpeg({ orientation: 6, width: 4032, height: 3024 });
    assert.ok(input.includes(Buffer.from("GPSLatitude")), "fixture carries location data");
    const out = processImage(input);
    assert.equal(out.type, "image/jpeg");
    assert.equal(out.width, 4032);
    assert.equal(out.height, 3024);
    assert.ok(!out.bytes.includes(Buffer.from("GPSLatitude")), "location must be stripped");
    assert.ok(!out.bytes.includes(Buffer.from("iPhone")), "camera details must be stripped");
    const app1 = out.bytes.indexOf(Buffer.from("Exif\0\0", "latin1"));
    assert.ok(app1 > 0);
    assert.equal(readOrientation(out.bytes.subarray(app1 + 6)), 6, "phones rely on orientation; it must be kept");
    assert.ok(out.bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9])));
  });

  test("PNG text chunks and WebP EXIF are removed", () => {
    const png = processImage(fakePng());
    assert.equal(png.width, 640);
    assert.ok(!png.bytes.includes(Buffer.from("GPS")));
    const webp = processImage(fakeWebp());
    assert.equal(webp.width, 800);
    assert.equal(webp.height, 600);
    assert.ok(!webp.bytes.includes(Buffer.from("GPS")));
    assert.equal(webp.bytes.readUInt32LE(4), webp.bytes.length - 8, "RIFF size is rewritten");
    assert.equal(webp.bytes[20]! & 0x0c, 0, "EXIF/XMP flags cleared");
  });

  test("format comes from the bytes, not the name", () => {
    assert.equal(sniff(Buffer.from("<svg onload=alert(1)>")), null);
    assert.throws(() => processImage(Buffer.from("GIF89a....")), /unsupported_format/);
    assert.throws(() => processImage(Buffer.alloc(9 * 1024 * 1024)), /too_large/);
  });

  test("triage decides safety and the hero", () => {
    const t = (kind: any, extra = {}) => ({ kind, quality: 0.8, has_faces: false, has_text_overlay: false, unsafe: false, ...extra });
    assert.equal(safetyFor(null), "pending", "no model means a human looks first");
    assert.equal(safetyFor(t("venue")), "approved");
    assert.equal(safetyFor(t("activity_in_progress", { has_faces: true })), "pending", "people did not sign up for a catalog");
    assert.equal(safetyFor(t("screenshot")), "rejected");
    assert.equal(safetyFor(t("venue", { unsafe: true })), "rejected");
    const items = [t("food"), t("activity_in_progress"), t("venue")].map((triage) => ({ triage, safety: safetyFor(triage) }));
    assert.equal(pickHero(items), 1);
  });
});

test("SigV4 matches the AWS test suite (get-vanilla)", () => {
  const auth = signV4({
    method: "GET", url: new URL("https://example.amazonaws.com/"),
    headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    region: "us-east-1", service: "service",
    accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  });
  assert.equal(auth, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
    "SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
});

test("listings unconfirmed for a year sink in ranking at export", () => {
  const row = { id: "x", slug: "x", kind: "place", title: "X", primary_category: "category.arts", primary_venue_id: "v", lat: 45.5, lon: -73.6, quality_score: 0.8 };
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(toCatalogActivity({ ...row, last_verified_at: "2026-06-01T00:00:00Z" }, now).quality, 0.8);
  assert.equal(toCatalogActivity({ ...row, last_verified_at: "2025-06-01T00:00:00Z" }, now).quality, 0.4);
});
