import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ServiceError extends Error {
  readonly code: string;
  readonly status: ContentfulStatusCode;
  readonly retryAfter?: number;

  public constructor({
    code,
    message,
    retryAfter,
    status,
  }: {
    code: string;
    message: string;
    retryAfter?: number;
    status: ContentfulStatusCode;
  }) {
    super(message);

    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = "ServiceError";
  }
}
