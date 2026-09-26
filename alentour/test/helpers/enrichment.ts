/** Fixtures for the enrichment tests: fake images, fake model output, a fake web and model. */
import type { Extraction } from "../../src/enrichment/extract.ts";
import type { Fetcher, FetchedText } from "../../src/enrichment/net.ts";
import { FetchError } from "../../src/enrichment/net.ts";
import type { GeoCandidate, Geocoder } from "../../src/enrichment/geo.ts";

// ------------------------------------------------------------------ images

function seg(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A structurally valid JPEG whose EXIF carries an orientation, a camera model and a location. */
export function fakeJpeg(o: { orientation?: number; width?: number; height?: number } = {}): Buffer {
  const text = Buffer.from("iPhone 15 Pro\0GPSLatitude=45.5231N GPSLongitude=73.5817W\0", "latin1");
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4);
  tiff.write("MM", 0, "latin1"); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(2, 8);
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(o.orientation ?? 1, 18);
  tiff.writeUInt16BE(0x0110, 22); tiff.writeUInt16BE(2, 24); tiff.writeUInt32BE(text.length, 26); tiff.writeUInt32BE(tiff.length, 30);
  tiff.writeUInt32BE(0, 34);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, text]);
  const jfif = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(15);
  sof[0] = 8; sof.writeUInt16BE(o.height ?? 480, 1); sof.writeUInt16BE(o.width ?? 640, 3); sof[5] = 3;
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), seg(0xe0, jfif), seg(0xe1, exif), seg(0xfe, Buffer.from("taken at home")),
    seg(0xc0, sof), seg(0xda, sos), Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]), Buffer.from([0xff, 0xd9]),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, data, Buffer.alloc(4)]);
}

export function fakePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(640, 0); ihdr.writeUInt32BE(480, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr), pngChunk("tEXt", Buffer.from("Comment\0GPS 45.52,-73.58")),
    pngChunk("IDAT", Buffer.from([1, 2, 3])), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function riffChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

export function fakeWebp(): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08;                      // EXIF present
  vp8x.writeUIntLE(799, 4, 3); vp8x.writeUIntLE(599, 7, 3);
  const body = Buffer.concat([
    riffChunk("VP8X", vp8x), riffChunk("VP8 ", Buffer.alloc(12)), riffChunk("EXIF", Buffer.from("GPS 45.52 -73.58")),
  ]);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length + 4, 4); head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

// ------------------------------------------------------------------ model output

type ActivityOut = Extraction["activities"][number];

export function activity(over: Partial<ActivityOut>): ActivityOut {
  return {
    key: "bouldering",
    name: "Bouldering at Bloc Shop",
    label: { fr: "Escalade de bloc", en: "Bouldering" },
    one_liner: { fr: "Escalade de bloc pour tous les niveaux.", en: "Bouldering for every level." },
    kind: "place",
    primary_category: { value: "category.sports", confidence: 0.95, evidence: "Escalade de bloc" },
    secondary_categories: [],
    tags: [{ slug: "audience.beginners_welcome", confidence: 0.9, evidence: "pour tous les niveaux" }],
    price: null,
    duration_minutes: null,
    opening_hours: null,
    min_age: null,
    months_open: null,
    weather_dependency: null,
    physical_demand: null,
    skill_required: null,
    icebreaker_score: null,
    risk_tier: null,
    what_to_bring: null,
    accessibility_mentions: [],
    ...over,
  } as ActivityOut;
}

export function extraction(activities: ActivityOut[], over: Partial<Extraction> = {}): Extraction {
  return { is_activity_business: true, phone: null, activities, ...over } as Extraction;
}

// ------------------------------------------------------------------ fake model, web, geocoder

export interface StubOptions {
  extract?: (source: string) => Extraction;
  copy?: (facts: any) => any;
  triage?: () => any;
  fail?: boolean;
}

/** Answers like the SDK's messages.parse, routing on the system prompt. Records every request. */
export function stubClient(o: StubOptions) {
  const calls: any[] = [];
  const batches = new Map<string, any[]>();
  const usage = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0 };
  const client = {
    calls,
    messages: {
      parse: async (req: any) => {
        calls.push(req);
        if (o.fail) throw new Error("overloaded");
        const system: string = req.system[0].text;
        if (system.includes("You extract facts")) {
          const source = String(req.messages[0].content);
          return { parsed_output: o.extract!(source), usage };
        }
        if (system.includes("You write listing copy")) {
          const facts = JSON.parse(String(req.messages[0].content).replace(/^FACTS:\n/, "").split("\n\nYour previous")[0]!);
          return { parsed_output: o.copy ? o.copy(facts) : { activities: [] }, usage };
        }
        if (system.includes("You sort photos")) {
          return { parsed_output: o.triage ? o.triage() : { kind: "venue", quality: 0.8, has_faces: false, has_text_overlay: false, unsafe: false }, usage };
        }
        throw new Error("unexpected call");
      },
      batches: {
        create: async ({ requests }: any) => { const id = `msgbatch_${batches.size + 1}`; batches.set(id, requests); return { id }; },
        retrieve: async (id: string) => ({ id, processing_status: "ended", request_counts: {} }),
        results: async (id: string) => (async function* () {
          for (const r of batches.get(id) ?? []) {
            const source = String(r.params.messages[0].content);
            yield { custom_id: r.custom_id, result: { type: "succeeded", message: { content: [{ type: "text", text: JSON.stringify(o.extract!(source)) }], usage } } };
          }
        })(),
      },
    },
  };
  return client;
}

export class FakeFetcher implements Fetcher {
  pages: Record<string, { body: string; status?: number; type?: string }>;
  requested: string[] = [];
  constructor(pages: Record<string, { body: string; status?: number; type?: string }>) { this.pages = pages; }
  async get(url: string): Promise<FetchedText> {
    this.requested.push(url);
    const p = this.pages[url];
    if (!p) return { url, status: 404, contentType: "text/html", body: "" };
    if (p.status === -1) throw new FetchError("network", "connection refused");
    return { url, status: p.status ?? 200, contentType: p.type ?? "text/html; charset=utf-8", body: p.body };
  }
}

export class FakeGeocoder implements Geocoder {
  answer: GeoCandidate[];
  constructor(answer: GeoCandidate[]) { this.answer = answer; }
  async search(): Promise<GeoCandidate[]> { return this.answer; }
}
