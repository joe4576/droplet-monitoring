import { Hono } from "hono";
import type { AppEnv } from "./context";
import { json, methodNotAllowed, privateResponse } from "./http";
import { loginPage } from "./login";
import { injectServices, requireHttps, requireSession } from "./middleware";
import { protectedAuthRoutes, publicAuthRoutes } from "./routes/auth";
import { metricsRoutes } from "./routes/metrics";
import { ServiceError } from "./services/errors";

const app = new Hono<AppEnv>();

app.use("*", requireHttps, injectServices);

app.route("/", publicAuthRoutes);

app.use("*", requireSession);

app.route("/", protectedAuthRoutes);

app.route("/", metricsRoutes);

app.all("/api/*", (c) => {
  if (c.req.method !== "GET") {
    return methodNotAllowed("GET");
  }

  return json({
    body: { code: "not_found", message: "API route not found." },
    status: 404,
  });
});

app.all("*", async (c) => privateResponse(await c.env.ASSETS.fetch(c.req.raw)));

app.onError((error, c) => {
  if (error instanceof ServiceError) {
    return json({
      body: { code: error.code, message: error.message },
      status: error.status,
    });
  }

  console.error(JSON.stringify({ event: "request_failed" }));

  return c.req.path === "/login"
    ? loginPage({
        disabled: true,
        message:
          "Sign-in is temporarily unavailable. Check the session database migrations and try again.",
        status: 503,
      })
    : json({
        body: {
          code: "service_unavailable",
          message:
            "The request could not be completed. Check the session database and try again.",
        },
        status: 503,
      });
});

export default app satisfies ExportedHandler<Env>;
