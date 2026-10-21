const getCookieName = (request: Request): string => {
  return new URL(request.url).protocol === "https:"
    ? "__Host-droplet_session"
    : "droplet_session";
};

export const getSessionToken = (request: Request): string | null => {
  const name = getCookieName(request);

  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));

  if (values.length !== 1) {
    return null;
  }

  return values[0].slice(name.length + 1);
};

export const getSessionCookie = ({
  maxAge = 0,
  request,
  token = "",
}: {
  maxAge?: number;
  request: Request;
  token?: string;
}): string => {
  return `${getCookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
};
