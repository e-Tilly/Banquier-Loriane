import type { MiddlewareHandler } from "hono";
import type { AppEnv, Deps } from "./context.ts";
import { sessionUser } from "./auth.ts";

/** Resolve the caller's IP and session (if any) for every request. */
export function identify(d: Deps, trustProxy: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const fwd = trustProxy ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
    const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
      ?.incoming?.socket?.remoteAddress;
    c.set("ip", fwd || socket || "unknown");

    const auth = c.req.header("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    c.set("user", token ? await sessionUser(d, token) : null);
    await next();
  };
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
  await next();
};
