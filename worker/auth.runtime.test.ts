import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import {
  Miniflare,
  Response as RuntimeResponse,
  convertV4MiniflareOptions,
} from "miniflare";
import { getRuntimeModule } from "./testing/runtime";
import { sessionResponseSchema } from "../shared/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const key = "a-long-random-fixture-dashboard-key";

const origin = "https://monitor.test";

let mf: Miniflare;

let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;

let assetRequests = 0;

let upstreamRequests = 0;

const request = ({
  init = {},
  path,
}: {
  init?: Parameters<Miniflare["dispatchFetch"]>[1];
  path: string;
}) => mf.dispatchFetch(`${origin}${path}`, { ...init, redirect: "manual" });

const signIn = ({
  apiKey = key,
  extraHeaders = {},
}: {
  apiKey?: string;
  extraHeaders?: Record<string, string>;
} = {}) => {
  return request({
    init: {
      body: JSON.stringify({ apiKey }),
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...extraHeaders,
      },
      method: "POST",
    },
    path: "/api/auth/login",
  });
};

const cookieOf = (response: {
  headers: {
    get(name: string): string | null;
  };
}) => response.headers.get("Set-Cookie")?.split(";")[0] ?? "";

beforeAll(async () => {
  const modules = [
    await getRuntimeModule({
      entry: new NodeURL("./index.ts", import.meta.url),
    }),
  ];

  mf = new Miniflare(
    convertV4MiniflareOptions({
      bindings: {
        AUTH_API_KEY: key,
        DIGITALOCEAN_API_TOKEN: "fixture-digitalocean-token",
        DROPLET_IDS: "123456789,987654321",
      },
      compatibilityDate: "2026-10-19",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["SESSIONS_DB"],
      modules,
      name: "auth-runtime-test",
      outboundService: (req) => {
        upstreamRequests++;

        const url = new URL(req.url);

        if (url.pathname.includes("/droplets/")) {
          return RuntimeResponse.json({
            droplet: {
              disk: 80,
              memory: 4096,
              name: "production",
              region: { slug: "lon1" },
              status: "active",
              vcpus: 2,
            },
          });
        }

        const name = url.pathname.split("/").at(-1);

        const end = Number(url.searchParams.get("end"));

        const series = ({
          labels = {},
          value,
        }: {
          labels?: Record<string, string>;
          value: number;
        }) => ({
          metric: labels,
          values: [
            [end - 60, value],
            [end, value],
          ],
        });

        const result =
          name === "cpu"
            ? [
                {
                  metric: { mode: "idle" },
                  values: [
                    [end - 60, 800],
                    [end, 890],
                  ],
                },
                {
                  metric: { mode: "user" },
                  values: [
                    [end - 60, 200],
                    [end, 230],
                  ],
                },
              ]
            : [
                series({
                  labels: { device: "/dev/vda1", mountpoint: "/" },
                  value:
                    name?.endsWith("total") || name?.endsWith("size")
                      ? 1000
                      : 100,
                }),
              ];

        return RuntimeResponse.json({ data: { result }, status: "success" });
      },
      serviceBindings: {
        ASSETS: () => {
          assetRequests++;

          return new RuntimeResponse("<h1>Protected dashboard</h1>", {
            headers: {
              "Cache-Control": "public, max-age=31536000",
              "Content-Type": "text/html",
            },
          });
        },
      },
    }),
  );

  db = await mf.getD1Database("SESSIONS_DB");

  const schema = await readFile(
    new NodeURL("../migrations/0001_auth.sql", import.meta.url),
    "utf8",
  );

  for (const statement of schema
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await db.prepare(statement).run();
  }
}, 15000);

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM login_attempts"),
  ]);

  assetRequests = 0;

  upstreamRequests = 0;
});

afterAll(async () => {
  await mf?.dispose();
});

describe("authentication boundary", () => {
  it.each([
    ["null", 400],
    ["[]", 400],
    ["{}", 400],
    ['{"apiKey":42}', 400],
    ['{"apiKey":""}', 400],
    [JSON.stringify({ apiKey: "x".repeat(1025) }), 400],
    ['{"apiKey":', 400],
  ])("rejects an invalid JSON login payload %s", async (body, status) => {
    const response = await request({
      init: {
        body,
        headers: { "Content-Type": "application/json", Origin: origin },
        method: "POST",
      },
      path: "/api/auth/login",
    });

    expect(response.status).toBe(status);

    expect(await response.json()).toMatchObject({ code: "login_failed" });

    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM sessions").first("count"),
    ).toBe(0);

    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM login_attempts")
        .first("count"),
    ).toBe(0);
  });

  it("rejects unsupported login content types", async () => {
    const response = await request({
      init: {
        body: key,
        headers: { "Content-Type": "text/plain", Origin: origin },
        method: "POST",
      },
      path: "/api/auth/login",
    });

    expect(response.status).toBe(415);

    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("serves HEAD login requests without a body", async () => {
    const response = await request({
      init: { method: "HEAD" },
      path: "/login",
    });

    expect(response.status).toBe(200);

    expect(await response.text()).toBe("");

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(assetRequests).toBe(0);
  });

  it.each([
    ["/login", "PUT", "GET, HEAD, POST"],
    ["/api/auth/login", "GET", "POST"],
    ["/api/auth/logout", "GET", "POST"],
    ["/api/auth/session", "POST", "GET"],
    ["/api/auth/session", "HEAD", "GET"],
    ["/api/metrics", "POST", "GET"],
    ["/api/metrics", "HEAD", "GET"],
  ])("rejects %s requests with method %s", async (path, method, allow) => {
    const cookie = cookieOf(await signIn());

    const response = await request({
      init: {
        headers: { Cookie: cookie },
        method,
      },
      path,
    });

    expect(response.status).toBe(405);

    expect(response.headers.get("Allow")).toBe(allow);

    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(assetRequests).toBe(0);

    expect(upstreamRequests).toBe(0);
  });

  it("replaces the previous session when signing in again", async () => {
    const previous = cookieOf(await signIn());

    const response = await signIn({
      apiKey: key,
      extraHeaders: { Cookie: previous },
    });

    const current = cookieOf(response);

    expect(current).not.toBe(previous);

    expect(
      sessionResponseSchema.parse(await response.json()).authenticated,
    ).toBe(true);

    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM sessions").first("count"),
    ).toBe(1);

    expect(
      (
        await request({
          init: { headers: { Cookie: previous } },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(401);

    expect(
      (
        await request({
          init: { headers: { Cookie: current } },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(200);
  });

  it("fails closed when the session database is unavailable", async () => {
    const cookie = cookieOf(await signIn());

    await db
      .prepare("ALTER TABLE sessions RENAME TO sessions_unavailable")
      .run();

    try {
      const response = await request({
        init: {
          headers: { Cookie: cookie },
        },
        path: "/assets/index.js",
      });

      expect(response.status).toBe(503);

      expect(assetRequests).toBe(0);

      expect(upstreamRequests).toBe(0);
    } finally {
      await db
        .prepare("ALTER TABLE sessions_unavailable RENAME TO sessions")
        .run();
    }
  });

  it("uses a localhost cookie for local HTTP development and requires HTTPS elsewhere", async () => {
    const response = await mf.dispatchFetch("http://localhost/api/auth/login", {
      body: JSON.stringify({ apiKey: key }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      method: "POST",
      redirect: "manual",
    });

    expect(response.status).toBe(200);

    expect(cookieOf(response)).toMatch(/^droplet_session=[a-f0-9]{64}$/);

    expect(response.headers.get("Set-Cookie")).not.toContain("; Secure");

    expect(
      (await mf.dispatchFetch("http://monitor.test/", { redirect: "manual" }))
        .status,
    ).toBe(308);

    expect(
      (
        await mf.dispatchFetch("http://monitor.test/login", {
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(400);
  });

  it("serves a self-contained login page without exposing any dashboard asset", async () => {
    const response = await request({ path: "/login" });

    const html = await response.text();

    expect(response.status).toBe(200);

    expect(html).toContain("Welcome back");

    expect(html).not.toContain("<script");

    expect(html).not.toContain(key);

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(assetRequests).toBe(0);
  });

  it.each(["/", "/insights", "/?demo=1", "/__metrics-cache/fake/1h/123"])(
    "redirects an anonymous page request for %s to login",
    async (path) => {
      const response = await request({ path });

      expect(response.status).toBe(303);

      expect(response.headers.get("Location")).toBe("/login");

      expect(assetRequests).toBe(0);

      expect(upstreamRequests).toBe(0);
    },
  );

  it.each([
    "/api/metrics?range=1h",
    "/api/auth/session",
    "/api/unknown",
    "/assets/index.js",
    "/favicon.svg",
  ])("blocks anonymous requests for %s", async (path) => {
    expect((await request({ path })).status).toBe(401);

    expect(assetRequests).toBe(0);

    expect(upstreamRequests).toBe(0);
  });

  it("rejects incorrect keys without creating a session", async () => {
    expect((await signIn({ apiKey: "wrong" })).status).toBe(401);

    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM sessions").first("count"),
    ).toBe(0);
  });

  it("issues a random secure cookie, stores only its hash, and protects cached assets", async () => {
    const login = await signIn();

    const cookie = cookieOf(login);

    expect(login.status).toBe(200);

    expect(cookie).toMatch(/^__Host-droplet_session=[a-f0-9]{64}$/);

    for (const flag of [
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=43200",
    ]) {
      expect(login.headers.get("Set-Cookie")).toContain(flag);
    }

    const body = await login.text();

    expect(body).not.toContain(key);

    expect(body).not.toContain(cookie.split("=")[1]);

    const row = await db
      .prepare("SELECT token_hash, key_hash FROM sessions")
      .first<{
        key_hash: string;
        token_hash: string;
      }>();

    expect(row?.token_hash).toHaveLength(64);

    expect(row?.token_hash).not.toBe(cookie.split("=")[1]);

    expect(row?.key_hash).not.toBe(key);

    const response = await request({
      init: {
        headers: { Cookie: cookie },
      },
      path: "/assets/index.js",
    });

    expect(response.status).toBe(200);

    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(response.headers.get("Vary")).toContain("Cookie");

    expect(assetRequests).toBe(1);
  });

  it("allows authenticated metrics, then refuses the cached result without a session", async () => {
    const cookie = cookieOf(await signIn());

    const response = await request({
      init: {
        headers: { Cookie: cookie },
      },
      path: "/api/metrics",
    });

    expect(response.status).toBe(200);

    expect(await response.text()).toContain('"current":25');

    const count = upstreamRequests;

    expect(count).toBe(14);

    expect((await request({ path: "/api/metrics" })).status).toBe(401);

    expect(upstreamRequests).toBe(count);
  });

  it("accepts the login form and redirects without putting credentials in the URL", async () => {
    const response = await request({
      init: {
        body: new URLSearchParams({ apiKey: key }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: origin,
        },
        method: "POST",
      },
      path: "/login",
    });

    expect(response.status).toBe(303);

    expect(response.headers.get("Location")).toBe("/");

    expect(cookieOf(response)).toContain("__Host-droplet_session=");
  });

  it("revokes the session on logout and rejects replay of its cookie", async () => {
    const cookie = cookieOf(await signIn());

    const response = await request({
      init: {
        headers: { Cookie: cookie, Origin: origin },
        method: "POST",
      },
      path: "/api/auth/logout",
    });

    expect(response.status).toBe(303);

    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");

    expect(
      (
        await request({
          init: { headers: { Cookie: cookie } },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(401);
  });

  it("rejects expired, forged, duplicate, and revoked sessions", async () => {
    const cookie = cookieOf(await signIn());

    expect(
      (
        await request({
          init: {
            headers: { Cookie: `${cookie}; ${cookie}` },
          },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(401);

    expect(
      (
        await request({
          init: {
            headers: { Cookie: `__Host-droplet_session=${"f".repeat(64)}` },
          },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(401);

    await db
      .prepare("UPDATE sessions SET created_at = 0, expires_at = 1")
      .run();

    expect(
      (
        await request({
          init: { headers: { Cookie: cookie } },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(401);
  });

  it("rejects sessions associated with an old login key", async () => {
    const cookie = cookieOf(await signIn());

    await db.prepare("UPDATE sessions SET key_hash = 'old-key-hash'").run();

    expect(
      (
        await request({
          init: { headers: { Cookie: cookie } },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(401);
  });

  it("rejects cross-origin login and logout attempts", async () => {
    expect(
      (
        await signIn({
          apiKey: key,
          extraHeaders: { Origin: "https://other.test" },
        })
      ).status,
    ).toBe(403);

    const cookie = cookieOf(await signIn());

    expect(
      (
        await request({
          init: {
            headers: { Cookie: cookie, Origin: "https://other.test" },
            method: "POST",
          },
          path: "/api/auth/logout",
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await request({
          init: { headers: { Cookie: cookie } },
          path: "/api/auth/session",
        })
      ).status,
    ).toBe(200);
  });

  it("rate limits repeated sign-in attempts in D1", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await signIn({ apiKey: "wrong" })).status).toBe(401);
    }

    const response = await signIn();

    expect(response.status).toBe(429);

    expect(response.headers.get("Retry-After")).toBe("600");
  });

  it("rejects oversized sign-in bodies", async () => {
    const response = await request({
      init: {
        body: JSON.stringify({ apiKey: "x".repeat(5000) }),
        headers: { "Content-Type": "application/json", Origin: origin },
        method: "POST",
      },
      path: "/api/auth/login",
    });

    expect(response.status).toBe(413);
  });
});
