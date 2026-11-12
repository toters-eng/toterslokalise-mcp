import { describe, expect, it, vi } from 'vitest';
import { TotersLokaliseClient } from '../src/client.js';
import type { TotersLokaliseApiError } from '../src/client.js';

describe('TotersLokalise MCP API client', () => {
  it('uses scoped Basic authentication and preserves pagination filters', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new TotersLokaliseClient({
      apiOrigin: 'https://example.test/',
      accessKey: 'gl_live_access',
      secret: 'gl_secret_value',
      fetch: request,
    });
    await client.get('projects', { limit: 25, cursor: 'next key' });

    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://example.test/api/v1/projects?limit=25&cursor=next+key',
    );
    expect(init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('gl_live_access:gl_secret_value').toString('base64')}`,
    });
  });

  it('returns bounded API errors without exposing response internals', async () => {
    const client = new TotersLokaliseClient({
      apiOrigin: 'https://example.test',
      accessKey: 'gl_live_access',
      secret: 'gl_secret_value',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Credential lacks scope' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });
    await expect(client.get('projects')).rejects.toEqual(
      expect.objectContaining<Partial<TotersLokaliseApiError>>({
        status: 403,
        message: 'Credential lacks scope',
      }),
    );
  });
});
