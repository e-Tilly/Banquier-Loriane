/**
 * Where photos live. Development writes to a local folder the API serves at /media; production
 * writes to Cloudflare R2 through its S3-compatible API ($0 egress — docs/alentour/10), signed
 * with AWS Signature V4 so no AWS SDK is needed.
 */
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Public URL for a stored key. */
  url(key: string): string;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;
function checkKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error(`Bad storage key: ${key}`);
}

export class LocalStorage implements Storage {
  dir: string;
  baseUrl: string;
  constructor(dir: string, baseUrl: string) { this.dir = dir; this.baseUrl = baseUrl.replace(/\/$/, ""); }
  async put(key: string, body: Buffer) {
    checkKey(key);
    const file = path.join(this.dir, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  async delete(key: string) { checkKey(key); rmSync(path.join(this.dir, key), { force: true }); }
  url(key: string) { return `${this.baseUrl}/${key}`; }
  /** For the dev /media route. */
  read(key: string): Buffer | null {
    try { checkKey(key); } catch { return null; }
    const file = path.join(this.dir, key);
    return existsSync(file) ? readFileSync(file) : null;
  }
}

export class MemoryStorage implements Storage {
  files = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) { checkKey(key); this.files.set(key, { body, contentType }); }
  async delete(key: string) { this.files.delete(key); }
  url(key: string) { return `https://media.test/${key}`; }
}

// ------------------------------------------------------------------ SigV4

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmacRaw = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>;     // must include host and x-amz-date
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** RFC 3986 encoding as SigV4 wants it (each path segment encoded, "/" kept). */
function encodePath(p: string): string {
  return p.split("/").map((s) => encodeURIComponent(decodeURIComponent(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export function signV4(s: SignInput): string {
  const amzDate = s.headers["x-amz-date"]!;
  const date = amzDate.slice(0, 8);
  const names = Object.keys(s.headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const query = [...s.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a! < b! ? -1 : a! > b! ? 1 : x! < y! ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [
    s.method, encodePath(s.url.pathname || "/"), query,
    names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), s.payloadHash,
  ].join("\n");
  const scope = `${date}/${s.region}/${s.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kDate = hmacRaw(`AWS4${s.secretAccessKey}`, date);
  const kSigning = hmacRaw(hmacRaw(hmacRaw(kDate, s.region), s.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

export interface R2Config {
  endpoint: string;          // https://<account>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;     // https://media.alentour.app
}

export class R2Storage implements Storage {
  cfg: R2Config;
  fetchImpl: typeof fetch;
  constructor(cfg: R2Config, fetchImpl: typeof fetch = fetch) { this.cfg = cfg; this.fetchImpl = fetchImpl; }

  private async send(method: "PUT" | "DELETE", key: string, body?: Buffer, contentType?: string) {
    checkKey(key);
    const url = new URL(`${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}/${key}`);
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const payloadHash = sha256(body ?? "");
    const headers: Record<string, string> = {
      host: url.host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash,
      ...(contentType ? { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" } : {}),
    };
    const authorization = signV4({
      method, url, headers, payloadHash, region: "auto", service: "s3",
      accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey,
    });
    const res = await this.fetchImpl(url, { method, headers: { ...headers, authorization }, body: body ? new Uint8Array(body) : undefined });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      throw new Error(`R2 ${method} ${key} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  }
  put(key: string, body: Buffer, contentType: string) { return this.send("PUT", key, body, contentType); }
  delete(key: string) { return this.send("DELETE", key); }
  url(key: string) { return `${this.cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`; }
}

export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.MEDIA_PUBLIC_URL) {
    return new R2Storage({
      endpoint: env.R2_ENDPOINT, bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY, publicBaseUrl: env.MEDIA_PUBLIC_URL,
    });
  }
  if (env.NODE_ENV === "production") throw new Error("R2_* and MEDIA_PUBLIC_URL must be set in production");
  const port = env.PORT ?? "8787";
  return new LocalStorage(path.resolve(env.MEDIA_DIR ?? "var/media"), env.MEDIA_PUBLIC_URL ?? `http://localhost:${port}/media`);
}
