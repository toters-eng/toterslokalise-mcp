import { describe, expect, it, vi } from 'vitest';
import { TotersLokaliseClient } from '../src/client.js';
import { createKeys, keysToCsv } from '../src/create-keys.js';

describe('create keys', () => {
  it('writes one CSV with a column per locale and quotes text safely', () => {
    expect(
      keysToCsv([
        { key: 'pay', namespace: 'checkout', values: { 'en-US': 'Pay, now', 'ar-LB': 'ادفع' } },
        { key: 'hi', description: 'Home "hero"', values: { 'en-US': 'Hi\nthere' } },
      ]),
    ).toBe(
      'key,namespace,description,tags,ar-LB,en-US\n' +
        'pay,checkout,,,ادفع,"Pay, now"\n' +
        'hi,default,"Home ""hero""",,,"Hi\nthere"\n',
    );
  });

  it('analyzes, resolves new namespaces and applies', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    let status = 'ready';
    const client = {
      post: vi.fn(async (path: string, body?: unknown) => {
        calls.push({ method: 'POST', path, body });
        if (path.endsWith('/proceed')) status = 'completed';
        return { id: 's1', status: 'uploaded' };
      }),
      get: vi.fn(async (path: string, query?: Record<string, unknown>) => {
        calls.push({ method: 'GET', path });
        if (path.endsWith('/items')) {
          return query?.classification === 'conflict'
            ? { items: [{ id: 'i1', key: 'pay', namespace: 'checkout', locale: 'en-US', classification: 'conflict', reasonCode: 'namespace_not_in_project', reasonDetail: null }] }
            : { items: [] };
        }
        // The real analysis does not count rows waiting for a new namespace as new.
        return { id: 's1', status, analysisHash: 'sha256:a', projectStateHash: 'sha256:b', newCount: 0 };
      }),
    } as unknown as TotersLokaliseClient;
    const result = await createKeys(
      client,
      { projectId: 'p', environment: 'development', keys: [{ key: 'pay', namespace: 'checkout', values: { 'en-US': 'Pay' } }], existingValues: 'keep', createNamespaces: true, tags: [], dryRun: false },
      { pollMs: 1 },
    );
    expect(result).toMatchObject({ status: 'completed', new: 1, conflicts: 0, newNamespaces: ['checkout'], skipped: [] });
    const proceed = calls.find((call) => call.path.endsWith('/proceed'))!;
    expect(proceed.body).toMatchObject({
      conflicts: [{ itemId: 'i1', resolution: 'use_imported' }],
      namespaces: [{ namespace: 'checkout', action: 'create' }],
    });
    expect((calls[0]!.body as { conflictPolicy: string }).conflictPolicy).toBe('keep_existing');
  });

  const fakeAnalysis = (items: object[], counts: object) =>
    ({
      post: vi.fn(async () => ({ id: 's1', status: 'uploaded' })),
      get: vi.fn(async (path: string, query?: Record<string, unknown>) =>
        path.endsWith('/items')
          ? { items: query?.classification === 'conflict' ? items : [] }
          : { id: 's1', status: 'ready', ...counts },
      ),
    }) as unknown as TotersLokaliseClient;
  const item = (key: string, reasonCode: string, namespace = 'checkout') => ({
    id: key, key, namespace, locale: 'en-US', classification: 'conflict', reasonCode, reasonDetail: null,
  });

  it('counts only real clashes with existing text as conflicts', async () => {
    // One differing value decided per row ("conflict") and one decided by the
    // session policy ("updated", counted in updatedCount).
    const client = fakeAnalysis(
      [item('pay', 'namespace_not_in_project', 'payments'), item('title', 'existing_value_differs')],
      { newCount: 2, updatedCount: 1, unchangedCount: 1 },
    );
    const base = { projectId: 'p', environment: 'development', keys: [], createNamespaces: true, tags: [], dryRun: true } as const;
    expect(await createKeys(client, { ...base, existingValues: 'keep' }, { pollMs: 1 })).toMatchObject({
      new: 3, updated: 0, unchanged: 1, conflicts: 2, existingText: 'kept', newNamespaces: ['payments'],
    });
    expect(await createKeys(client, { ...base, existingValues: 'overwrite' }, { pollMs: 1 })).toMatchObject({
      new: 3, updated: 2, conflicts: 2, existingText: 'overwritten',
    });
  });

  it('reports keys in a missing namespace as skipped when createNamespaces is false', async () => {
    const client = fakeAnalysis([item('pay', 'namespace_not_in_project', 'payments')], { newCount: 0 });
    const result = await createKeys(
      client,
      { projectId: 'p', environment: 'development', keys: [], existingValues: 'keep', createNamespaces: false, tags: [], dryRun: true },
      { pollMs: 1 },
    );
    expect(result).toMatchObject({ new: 0, conflicts: 0, newNamespaces: [] });
    expect(result).toHaveProperty('skipped', [expect.objectContaining({ key: 'pay', reason: expect.stringContaining('createNamespaces') })]);
  });

  it('dry run never proceeds', async () => {
    const post = vi.fn(async () => ({ id: 's1', status: 'uploaded' }));
    const client = {
      post,
      get: vi.fn(async (path: string) =>
        path.endsWith('/items') ? { items: [] } : { id: 's1', status: 'ready', newCount: 2 },
      ),
    } as unknown as TotersLokaliseClient;
    const result = await createKeys(
      client,
      { projectId: 'p', environment: 'development', keys: [{ key: 'a', values: { en: 'A' } }], existingValues: 'keep', createNamespaces: false, tags: [], dryRun: true },
      { pollMs: 1 },
    );
    expect(result).toMatchObject({ new: 2 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('single sign-on gateway', () => {
  const client = (response: Response) =>
    new TotersLokaliseClient({
      apiOrigin: 'https://arcade.example',
      accessKey: 'k',
      secret: 's',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

  it('reports an Okta redirect instead of returning a login page', async () => {
    await expect(
      client(new Response(null, { status: 302, headers: { location: 'https://toters.okta.com/login' } })).get('projects'),
    ).rejects.toThrow(/sign-in page \(toters\.okta\.com\).*Okta/u);
  });

  it('reports an HTML page served with 200', async () => {
    await expect(
      client(new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })).get('projects'),
    ).rejects.toThrow(/sign-in page/u);
  });
});
