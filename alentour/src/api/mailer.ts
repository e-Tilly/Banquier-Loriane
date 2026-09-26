/**
 * Transactional email. Resend's free tier (3,000/month) covers a side project's sign-in codes
 * at $0; anything with the same `send` shape can replace it.
 */
export interface Mail { to: string; subject: string; text: string; replyTo?: string; headers?: Record<string, string> }
export interface Mailer { send(mail: Mail): Promise<void> }

/** Development: prints the code to the server log. */
export class ConsoleMailer implements Mailer {
  async send(m: Mail): Promise<void> {
    console.log(`\n✉  to ${m.to}\n   ${m.subject}\n   ${m.text.replace(/\n/g, "\n   ")}\n`);
  }
}

/** Tests: keeps everything in memory so a test can read the code back. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(m: Mail): Promise<void> { this.sent.push(m); }
  last(to: string): Mail | undefined { return [...this.sent].reverse().find((m) => m.to === to); }
}

export class ResendMailer implements Mailer {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;
  constructor(apiKey: string, from: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }
  async send(m: Mail): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from, to: [m.to], subject: m.subject, text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}), ...(m.headers ? { headers: m.headers } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  if (env.RESEND_API_KEY) {
    return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM ?? "Alentour <allo@alentour.app>");
  }
  if (env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is required in production");
  return new ConsoleMailer();
}
