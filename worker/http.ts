// Response helpers. API responses set their own security headers, because
// public/_headers only covers static files.

const API_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export function jsonText(text: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { ...API_HEADERS, ...extra } });
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return jsonText(JSON.stringify(body), status, extra);
}

/** An error the visitor should see, with a plain-language message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  toResponse(): Response {
    return json({ error: this.code, message: this.message }, this.status);
  }
}

export const badRequest = () =>
  new ApiError(400, 'bad_request', "That request didn't look right. Refresh the page and try again.");

/** Only accept writes sent by our own pages. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) {
    throw new ApiError(403, 'forbidden', 'This can only be sent from the Tap Watch website.');
  }
}

/** Reads a small JSON body, refusing anything large or malformed. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw badRequest();
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > maxBytes) throw badRequest();
  const text = await request.text();
  if (text.length > maxBytes) throw badRequest();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest();
    return body as Record<string, unknown>;
  } catch {
    throw badRequest();
  }
}

export const isoTime = (ms: number) => new Date(ms).toISOString();
