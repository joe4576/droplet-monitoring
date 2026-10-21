export const privateResponse = (response: Response): Response => {
  if (response.status === 101) {
    return response;
  }

  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");

  const vary = new Set(
    (headers.get("Vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  vary.add("Cookie");

  headers.set("Vary", [...vary].join(", "));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export const json = ({
  body,
  headers,
  status = 200,
}: {
  body: unknown;
  headers?: HeadersInit;
  status?: number;
}): Response => {
  return privateResponse(Response.json(body, { headers, status }));
};

export const redirect = ({
  cookie,
  location,
}: {
  cookie?: string;
  location: string;
}): Response => {
  const headers = new Headers({ Location: location });

  if (cookie) {
    headers.set("Set-Cookie", cookie);
  }

  return privateResponse(new Response(null, { headers, status: 303 }));
};

export const methodNotAllowed = (allow: string): Response => {
  return json({
    body: { code: "method_not_allowed", message: "Method not allowed." },
    headers: { Allow: allow },
    status: 405,
  });
};

export const sameOrigin = (request: Request): boolean => {
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
};
