/**
 * Fetching a URL an owner typed in, safely.
 *
 * The server fetches websites on behalf of anyone who can sign in, which is a textbook
 * server-side request forgery surface: "my website is http://169.254.169.254/" would read cloud
 * metadata, "http://localhost:5432" would probe the database. So:
 *
 *  - http(s) only, default ports only, no credentials in the URL;
 *  - every address the hostname resolves to must be public — and the check happens inside the
 *    socket's own DNS lookup, so a hostname cannot resolve to a public address for the check and
 *    a private one for the connection (DNS rebinding);
 *  - redirects are followed by hand, re-validating each hop, at most 3;
 *  - responses are capped in size and time, and only text/html and text/plain are read.
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

export const USER_AGENT = "AlentourBot/1.0 (+https://alentour.app/bot)";

export interface FetchedText {
  url: string;          // final URL after redirects
  status: number;
  contentType: string;
  body: string;
}

export interface Fetcher {
  get(url: string, opts?: { accept?: string; maxBytes?: number }): Promise<FetchedText>;
}

export class FetchError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/** True for addresses a fetch on a user's behalf must never reach. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)          // carrier-grade NAT
      || (a === 169 && b === 254)                    // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));      // benchmarking
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
  }
  return true;
}

/** Syntactic checks; the address check happens at connect time. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchError("bad_url", `Not a URL: ${raw}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchError("bad_url", "Only http and https URLs");
  if (u.username || u.password) throw new FetchError("bad_url", "URLs with credentials are not allowed");
  if (u.port && u.port !== "80" && u.port !== "443") throw new FetchError("bad_url", "Non-standard ports are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) throw new FetchError("private_address", "That address is not public");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new FetchError("private_address", "That address is not public");
  }
  return u;
}

/** DNS lookup that refuses private answers. Used as the socket's lookup, which closes rebinding. */
function guardedLookup(hostname: string, options: dns.LookupOptions, cb: (...args: any[]) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return cb(new FetchError("private_address", `${hostname} resolves to a non-public address`));
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

export interface NodeFetcherOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only: allow loopback so a local fixture server can be used. */
  allowPrivate?: boolean;
}

export class NodeFetcher implements Fetcher {
  timeoutMs: number;
  maxRedirects: number;
  allowPrivate: boolean;

  constructor(opts: NodeFetcherOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRedirects = opts.maxRedirects ?? 3;
    this.allowPrivate = opts.allowPrivate ?? false;
  }

  async get(url: string, opts: { accept?: string; maxBytes?: number } = {}): Promise<FetchedText> {
    let current = url;
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const u = this.allowPrivate ? new URL(current) : checkUrl(current);
      const res = await this.once(u, opts.accept ?? "text/html,text/plain;q=0.9", opts.maxBytes ?? 1_500_000);
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, u).toString();
        continue;
      }
      return { url: u.toString(), status: res.status, contentType: res.contentType, body: res.body };
    }
    throw new FetchError("too_many_redirects", `More than ${this.maxRedirects} redirects`);
  }

  private once(u: URL, accept: string, maxBytes: number) {
    return new Promise<{ status: number; contentType: string; body: string; location?: string }>((resolve, reject) => {
      const mod = u.protocol === "https:" ? https : http;
      const req = mod.request(u, {
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "fr-CA,fr;q=0.9,en;q=0.8" },
        timeout: this.timeoutMs,
        ...(this.allowPrivate ? {} : { lookup: guardedLookup as unknown as typeof dns.lookup }),
      }, (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, contentType, body: "", location: res.headers.location });
        }
        if (status === 200 && !/^(text\/html|text\/plain|application\/xhtml\+xml)/.test(contentType)) {
          res.resume();
          return resolve({ status, contentType, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) { res.destroy(); return; }
          chunks.push(c);
        });
        res.on("close", () => resolve({ status, contentType, body: decode(Buffer.concat(chunks), contentType) }));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new FetchError("timeout", `Timed out fetching ${u.host}`)));
      req.on("error", (err) => reject(err instanceof FetchError ? err : new FetchError("network", err.message)));
      req.end();
    });
  }
}

function decode(buf: Buffer, contentType: string): string {
  const charset = contentType.match(/charset=([\w-]+)/)?.[1]?.toLowerCase();
  const label = charset === "iso-8859-1" || charset === "latin1" || charset === "windows-1252" ? "latin1" : "utf8";
  return buf.toString(label);
}
