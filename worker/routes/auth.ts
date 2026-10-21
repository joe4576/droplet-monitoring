import { Hono, type Context } from "hono";
import { z } from "zod";
import { loginSchema } from "../../shared/schemas";
import type { Login, SessionResponse } from "../../shared/types";
import type { AppEnv } from "../context";
import { getSessionCookie, getSessionToken } from "../cookies";
import { json, methodNotAllowed, redirect, sameOrigin } from "../http";
import { loginPage } from "../login";
import { SESSION_SECONDS } from "../services/auth-service";
import { ServiceError } from "../services/errors";

const loginContentTypeSchema = z.enum([
  "application/json",
  "application/x-www-form-urlencoded",
]);

const getLoginInput = async (request: Request): Promise<Login> => {
  const parsedType = loginContentTypeSchema.safeParse(
    request.headers.get("Content-Type")?.split(";")[0].trim(),
  );

  if (!parsedType.success) {
    throw new ServiceError({
      code: "login_failed",
      message: "Submit the API key as JSON or a form.",
      status: 415,
    });
  }

  if (!request.body) {
    throw new ServiceError({
      code: "login_failed",
      message: "Enter your dashboard API key.",
      status: 400,
    });
  }

  const reader = request.body.getReader();

  const decoder = new TextDecoder();

  let text = "";

  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytes += value.byteLength;

    if (bytes > 4096) {
      await reader.cancel();

      throw new ServiceError({
        code: "login_failed",
        message: "The sign-in request is too large.",
        status: 413,
      });
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();

  let body: unknown;

  if (parsedType.data === "application/json") {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceError({
        code: "login_failed",
        message: "The sign-in request is invalid.",
        status: 400,
      });
    }
  } else {
    body = { apiKey: new URLSearchParams(text).get("apiKey") };
  }

  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    throw new ServiceError({
      code: "login_failed",
      message: "Enter your dashboard API key.",
      status: 400,
    });
  }

  return parsed.data;
};

const createSession = async (c: Context<AppEnv>): Promise<Response> => {
  const request = c.req.raw;

  const form = c.req.path === "/login";

  const auth = c.get("authService");

  const failure = ({
    message,
    status,
  }: {
    message: string;
    status: number;
  }): Response =>
    form
      ? loginPage({ message, status })
      : json({ body: { code: "login_failed", message }, status });

  if (!sameOrigin(request)) {
    return failure({
      message: "Sign in from this site to continue.",
      status: 403,
    });
  }

  if (!auth.isAuthConfigured()) {
    return failure({
      message:
        "Sign-in is not configured. Add AUTH_API_KEY to the Worker secrets.",
      status: 503,
    });
  }

  try {
    const input = await getLoginInput(request);

    const session = await auth.createSession({
      clientIp: c.req.header("CF-Connecting-IP") ?? "local",
      key: input.apiKey,
      previousToken: getSessionToken(request),
    });

    const cookie = getSessionCookie({
      maxAge: SESSION_SECONDS,
      request,
      token: session.token,
    });

    const body: SessionResponse = {
      authenticated: true,
      expiresAt: session.expiresAt,
    };

    return form
      ? redirect({ cookie, location: "/" })
      : json({ body, headers: { "Set-Cookie": cookie }, status: 200 });
  } catch (error) {
    if (error instanceof ServiceError) {
      const response = failure({
        message: error.message,
        status: error.status,
      });

      if (error.retryAfter !== undefined) {
        response.headers.set("Retry-After", String(error.retryAfter));
      }

      return response;
    }

    console.error(JSON.stringify({ event: "login_storage_failed" }));

    return failure({
      message:
        "Sign-in is temporarily unavailable. Check the session database migrations and try again.",
      status: 503,
    });
  }
};

export const publicAuthRoutes = new Hono<AppEnv>()
  .post("/login", createSession)
  .get("/login", async (c) => {
    const auth = c.get("authService");

    const request = c.req.raw;

    if (
      auth.isAuthConfigured() &&
      (await auth.getSessionByToken(getSessionToken(request)))
    ) {
      return redirect({ location: "/" });
    }

    const response = auth.isAuthConfigured()
      ? loginPage()
      : loginPage({
          disabled: true,
          message:
            "Sign-in is not configured. Add AUTH_API_KEY to the Worker secrets.",
          status: 503,
        });

    response.headers.set("Set-Cookie", getSessionCookie({ request }));

    return response;
  })
  .all("/login", () => methodNotAllowed("GET, HEAD, POST"))
  .post("/api/auth/login", createSession)
  .all("/api/auth/login", () => methodNotAllowed("POST"));

export const protectedAuthRoutes = new Hono<AppEnv>()
  .post("/api/auth/logout", async (c) => {
    if (!sameOrigin(c.req.raw)) {
      return json({
        body: {
          code: "forbidden",
          message: "Sign out from this site to continue.",
        },
        status: 403,
      });
    }

    await c
      .get("authService")
      .deleteSessionByTokenHash(c.get("session").tokenHash);

    return redirect({
      cookie: getSessionCookie({ request: c.req.raw }),
      location: "/login",
    });
  })
  .all("/api/auth/logout", () => methodNotAllowed("POST"))
  .get("/api/auth/session", (c) => {
    if (c.req.method !== "GET") {
      return methodNotAllowed("GET");
    }

    const body: SessionResponse = {
      authenticated: true,
      expiresAt: c.get("session").expiresAt,
    };

    return json({ body });
  })
  .all("/api/auth/session", () => methodNotAllowed("GET"));
