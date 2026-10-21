const API = "https://api.digitalocean.com/v2";

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "UpstreamError";
  }
}

const upstreamMessage = (status: number): string => {
  if (status === 401) {
    return "DigitalOcean rejected the API token. Check the configured secret.";
  }

  if (status === 403) {
    return "The API token needs monitoring:read and droplet:read permissions.";
  }

  if (status === 404) {
    return "DigitalOcean could not find the configured Droplet.";
  }

  if (status === 429) {
    return "DigitalOcean rate limit reached. Try again in a minute.";
  }

  return "DigitalOcean is temporarily unavailable. Try again shortly.";
};

export const get = async ({
  path,
  token,
}: {
  path: string;
  token: string;
}): Promise<unknown> => {
  try {
    const response = await fetch(`${API}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();

      throw new UpstreamError(
        "DigitalOcean returned an unexpected redirect. The request was not followed.",
      );
    }

    if (!response.ok) {
      await response.body?.cancel();

      throw new UpstreamError(upstreamMessage(response.status));
    }

    if (!response.body) {
      throw new UpstreamError("DigitalOcean returned an empty response.");
    }

    // Limit response size before JSON parsing to protect the Worker memory budget.
    const reader = response.body.getReader();

    const chunks: Uint8Array[] = [];

    let size = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();

        throw new UpstreamError(
          "This metric response is too large. Select a shorter date range.",
        );
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(size);

    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);

      offset += chunk.length;
    }

    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }

    // Never pass through request URLs, credentials, or raw upstream error bodies.
    throw new UpstreamError(
      "Could not read DigitalOcean metrics. Try again shortly.",
    );
  }
};
