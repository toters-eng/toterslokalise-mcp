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

  /**
   * POST that returns a file (the export API). Errors and sign-in pages are
   * reported the same way as JSON requests.
   */
  async postFile(path: string, body: unknown) {
    const url = this.url(path);
    const response = await this.request(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        authorization: this.authorization,
        accept: '*/*',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('text/html')) {
      // Reuse the JSON path for its sign-in detection and error messages.
      await this.raise(url, response, contentType);
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
    const plain = /filename="([^"]+)"/iu.exec(disposition)?.[1];
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
      fileName: encoded ? decodeURIComponent(encoded) : (plain ?? 'export'),
      warnings: decodeURIComponent(response.headers.get('x-export-warnings') ?? ''),
    };
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
      // A redirect means a single sign-on gateway (Okta) answered instead of
      // the API; following it would return a login page as if it were data.
      redirect: 'manual',
      headers: {
        authorization: this.authorization,
        accept: 'application/json, text/plain;q=0.9, application/xml;q=0.8',
        ...init.headers,
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    await this.raise(url, response, contentType);
    const text = await response.text();
    return contentType.includes('json') && text ? JSON.parse(text) : text;
  }

  /** Throw for sign-in pages and failed responses; return for usable ones. */
  private async raise(url: URL, response: Response, contentType: string): Promise<void> {
    if (
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400) ||
      (contentType.includes('text/html') &&
        (response.ok || response.status === 401 || response.status === 403))
    ) {
      const location = response.headers.get('location') ?? '';
      throw new TotersLokaliseApiError(
        response.status || 302,
        `The request to ${url.origin} was answered by a sign-in page${
          location ? ` (${new URL(location, url).host})` : ''
        }, not the TotersLokalise API. The API path /api/v1/* must be reachable without single sign-on (Okta); ask the platform team to exempt it, or check TOTERSLOKALISE_API_ORIGIN.`,
      );
    }
    if (!response.ok) {
      const text = await response.text();
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
  }
}
