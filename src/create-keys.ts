import type { TotersLokaliseClient } from './client.js';

/**
 * Create translation keys with their values in one call (for example from a
 * Figma design read by another MCP server). Builds one CSV, runs the normal
 * import analysis, resolves only what the caller allowed, and applies it.
 */
export interface KeyInput {
  readonly key: string;
  readonly namespace?: string | undefined;
  readonly description?: string | undefined;
  readonly values: Readonly<Record<string, string>>;
}

export interface CreateKeysInput {
  readonly projectId: string;
  readonly environment: string;
  readonly keys: readonly KeyInput[];
  /** keep: never overwrite existing text; overwrite: replace it. */
  readonly existingValues: 'keep' | 'overwrite';
  /** Create namespaces that do not exist yet (otherwise those keys are skipped). */
  readonly createNamespaces: boolean;
  readonly tags: readonly string[];
  /** Analyze only: report what would change without applying it. */
  readonly dryRun: boolean;
}

interface Session {
  readonly id: string;
  readonly status: string;
  readonly analysisHash?: string | null;
  readonly projectStateHash?: string | null;
  readonly newCount?: number;
  readonly updatedCount?: number;
  readonly unchangedCount?: number;
  readonly conflictCount?: number;
  readonly excludedCount?: number;
  readonly failure?: unknown;
}

interface Item {
  readonly id: string;
  readonly key: string;
  readonly namespace: string;
  readonly locale: string | null;
  readonly classification: string;
  readonly reasonCode: string | null;
  readonly reasonDetail: string | null;
}

const csvCell = (value: string) =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function keysToCsv(keys: readonly KeyInput[]): string {
  const locales = [...new Set(keys.flatMap((key) => Object.keys(key.values)))].sort();
  const rows = [
    ['key', 'namespace', 'description', 'tags', ...locales],
    ...keys.map((key) => [
      key.key,
      key.namespace ?? 'default',
      key.description ?? '',
      '',
      ...locales.map((locale) => key.values[locale] ?? ''),
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createKeys(
  client: TotersLokaliseClient,
  input: CreateKeysInput,
  options: { readonly pollMs?: number; readonly timeoutMs?: number } = {},
) {
  const base = `projects/${encodeURIComponent(input.projectId)}/environments/${encodeURIComponent(input.environment)}/import-sessions`;
  const pollMs = options.pollMs ?? 1_000;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const poll = async (id: string, done: readonly string[]) => {
    for (;;) {
      const session = (await client.get(`${base}/${encodeURIComponent(id)}`)) as Session;
      if (done.includes(session.status) || session.status === 'failed' || session.status === 'cancelled') {
        return session;
      }
      if (Date.now() > deadline) {
        throw new Error(`Import session ${id} is still ${session.status}; check it later with toterslokalise_get_import_session.`);
      }
      await wait(pollMs);
    }
  };

  const analyzed = (await client.post(`${base}/analyze`, {
    conflictPolicy: input.existingValues === 'overwrite' ? 'use_imported' : 'keep_existing',
    tags: input.tags,
    files: [
      {
        name: 'keys.csv',
        mimeType: 'text/csv',
        contentBase64: Buffer.from(keysToCsv(input.keys), 'utf8').toString('base64'),
      },
    ],
  })) as Session;
  const session = await poll(analyzed.id, ['ready']);
  if (session.status !== 'ready') {
    return { sessionId: session.id, status: session.status, failure: session.failure };
  }

  // Every row that still needs a decision.
  const conflicts: Item[] = [];
  const excluded: Item[] = [];
  for (const classification of ['conflict', 'excluded'] as const) {
    let cursor: string | undefined;
    do {
      const page = (await client.get(`${base}/${encodeURIComponent(session.id)}/items`, {
        classification,
        limit: 500,
        cursor,
      })) as { items: Item[]; nextCursor?: string };
      (classification === 'conflict' ? conflicts : excluded).push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
  }
  // The analysis reports rows for a namespace the project does not have yet as
  // "conflicts" (they wait for a namespace decision). They are new keys, not
  // clashes with existing text, so count them separately.
  const isNewNamespace = (item: Item) => item.reasonCode === 'namespace_not_in_project';
  const newNamespaceItems = conflicts.filter(isNewNamespace);
  const valueConflicts = conflicts.filter((item) => !isNewNamespace(item));
  const newNamespaces = [...new Set(newNamespaceItems.map((item) => item.namespace))].sort();
  const resolutions = conflicts.map((item) => ({
    itemId: item.id,
    resolution:
      item.reasonCode === 'namespace_not_in_project'
        ? input.createNamespaces
          ? ('use_imported' as const)
          : ('exclude' as const)
        : input.existingValues === 'overwrite'
          ? ('use_imported' as const)
          : ('keep_existing' as const),
  }));
  const overwrite = input.existingValues === 'overwrite';
  // Values whose existing text differs from the one sent. The analysis calls
  // them "updated" (decided by the session policy) or "conflict" (decided per
  // row); either way they are only written when existingValues is overwrite.
  const differing = (session.updatedCount ?? 0) + valueConflicts.length;
  // Counts are per value (one key in one language).
  const summary = {
    sessionId: session.id,
    new: (session.newCount ?? 0) + (input.createNamespaces ? newNamespaceItems.length : 0),
    updated: overwrite ? differing : 0,
    unchanged: session.unchangedCount ?? 0,
    /** Values whose existing text differs from the one sent. */
    conflicts: differing,
    /** What happened to that existing text. */
    existingText: differing ? (overwrite ? 'overwritten' : 'kept') : undefined,
    newNamespaces: input.createNamespaces ? newNamespaces : [],
    skipped: [
      ...excluded.map((item) => ({
        key: item.key,
        namespace: item.namespace,
        locale: item.locale,
        reason: item.reasonDetail ?? item.reasonCode,
      })),
      ...(input.createNamespaces
        ? []
        : newNamespaceItems.map((item) => ({
            key: item.key,
            namespace: item.namespace,
            locale: item.locale,
            reason: `namespace "${item.namespace}" does not exist (set createNamespaces to create it)`,
          }))),
    ],
  };
  if (input.dryRun) return { ...summary, status: 'analyzed (dry run, nothing applied)' };

  await client.post(`${base}/${encodeURIComponent(session.id)}/proceed`, {
    analysisHash: session.analysisHash,
    projectStateHash: session.projectStateHash,
    conflicts: resolutions,
    ...(newNamespaces.length
      ? {
          namespaces: newNamespaces.map((namespace) => ({
            namespace,
            action: input.createNamespaces ? 'create' : 'use_default',
          })),
        }
      : {}),
  });
  const finished = await poll(session.id, ['completed']);
  return { ...summary, status: finished.status, failure: finished.failure ?? undefined };
}
