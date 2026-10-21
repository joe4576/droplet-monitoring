import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context";
import { getSessionCookie, getSessionToken } from "./cookies";
import { json, privateResponse, redirect } from "./http";
import { AuthService } from "./services/auth-service";
import { DashboardService } from "./services/dashboard-service";

export const requireHttps = createMiddleware<AppEnv>(async (c, next) => {
  const url = new URL(c.req.url);

  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return json({
        body: {
          code: "https_required",
          message: "Use HTTPS to sign in and access the dashboard.",
        },
        status: 400,
      });
    }

    url.protocol = "https:";

    return privateResponse(
      new Response(null, { headers: { Location: url.href }, status: 308 }),
    );
  }

  await next();
});

export const injectServices = createMiddleware<AppEnv>(async (c, next) => {
  c.set(
    "authService",
    new AuthService({ apiKey: c.env.AUTH_API_KEY, db: c.env.SESSIONS_DB }),
  );

  c.set(
    "dashboardService",
    new DashboardService({
      ids: c.env.DROPLET_IDS,
      origin: new URL(c.req.url).origin,
      token: c.env.DIGITALOCEAN_API_TOKEN,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    }),
  );

  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.get("authService");

  const request = c.req.raw;

  const url = new URL(request.url);

  if (!auth.isAuthConfigured()) {
    return url.pathname.startsWith("/api/")
      ? json({
          body: {
            code: "auth_not_configured",
            message: "Sign-in is not configured.",
          },
          status: 503,
        })
      : redirect({ cookie: getSessionCookie({ request }), location: "/login" });
  }

  const session = await auth.getSessionByToken(getSessionToken(request));

  if (!session) {
    const page =
      (request.method === "GET" || request.method === "HEAD") &&
      !url.pathname.startsWith("/api/") &&
      (request.headers.get("Accept")?.includes("text/html") ||
        !url.pathname.split("/").at(-1)?.includes("."));

    return page
      ? redirect({ cookie: getSessionCookie({ request }), location: "/login" })
      : json({
          body: { code: "unauthorized", message: "Sign in to continue." },
          headers: {
            "Set-Cookie": getSessionCookie({ request }),
          },
          status: 401,
        });
  }

  c.set("session", session);

  await next();
});
