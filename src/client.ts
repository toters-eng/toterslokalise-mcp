export interface TotersLokaliseClientOptions {
  readonly apiOrigin: string;
  readonly accessKey: string;
  readonly secret: string;
  readonly fetch?: typeof fetch;
}

export class TotersLokaliseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TotersLokaliseApiError';
  }
}

export class TotersLokaliseClient {
  private readonly apiOrigin: string;
  private readonly authorization: string;
  private readonly request: typeof fetch;

  constructor(options: TotersLokaliseClientOptions) {
    this.apiOrigin = options.apiOrigin.replace(/\/+$/u, '');
    this.authorization = `Basic ${Buffer.from(
      `${options.accessKey}:${options.secret}`,
      'utf8',
    ).toString('base64')}`;
    this.request = options.fetch ?? fetch;
  }

  async get(path: string, query: Record<string, unknown> = {}) {
    const url = this.url(path, query);
    return this.send(url, { method: 'GET' });
  }

  async post(path: string, body?: unknown) {
    return this.send(this.url(path), {
      method: 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
  }

  private url(path: string, query: Record<string, unknown> = {}): URL {
    // The API origin may carry a path (Arcade: …/toters-lokalise), so append
    // instead of resolving an absolute path that would drop it.
    const url = new URL(
      `${this.apiOrigin}/api/v1/${path.replace(/^\/+|\/+$/gu, '')}`,
    );
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(
        name,
        Array.isArray(value) ? value.join(',') : String(value),
      );
    }
    return url;
  }

  private async send(url: URL, init: RequestInit) {
    const response = await this.request(url, {
      ...init,
      headers: {
        authorization: this.authorization,
        accept: 'application/json, text/plain;q=0.9, application/xml;q=0.8',
        ...init.headers,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      let message =
        text || `TotersLokalise API request failed (${response.status})`;
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {
        // Keep the bounded raw response when an upstream proxy returns text.
      }
      throw new TotersLokaliseApiError(response.status, message.slice(0, 2_000));
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('json') && text ? JSON.parse(text) : text;
  }
}
