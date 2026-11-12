import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { TotersLokaliseApiError } from './client.js';
import type { TotersLokaliseClient } from './client.js';

const MAX_MCP_TEXT = 200_000;

const projectInput = {
  projectId: z.string().min(1).describe('TotersLokalise project ID'),
  environment: z
    .string()
    .min(1)
    .default('development')
    .describe('Environment slug, usually development or staging'),
};

function result(value: unknown) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_MCP_TEXT) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `The response is ${text.length} characters, above the safe MCP response limit. Narrow the languages, namespaces, keys, statuses, or item classification and try again.`,
        },
      ],
    };
  }
  return { content: [{ type: 'text' as const, text }] };
}

function failure(error: unknown) {
  const message =
    error instanceof TotersLokaliseApiError
      ? `TotersLokalise API ${error.status}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'Unexpected TotersLokalise MCP error';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function createTotersLokaliseMcpServer(client: TotersLokaliseClient) {
  const server = new McpServer({ name: 'toterslokalise', version: '0.1.0' });

  server.registerTool(
    'toterslokalise_list_projects',
    {
      description:
        'List active TotersLokalise projects visible to the scoped organization credential.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
      }),
    },
    async ({ limit, cursor }) => {
      try {
        return result(await client.get('projects', { limit, cursor }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'toterslokalise_export_translations',
    {
      description:
        'Read translations from one project/environment. Published translations are returned by default.',
      inputSchema: z.object({
        ...projectInput,
        languages: z.array(z.string().min(2)).max(50).optional(),
        namespaces: z.array(z.string().min(1)).max(100).optional(),
        keys: z.array(z.string().min(1)).max(500).optional(),
        tags: z.array(z.string().min(1)).max(50).optional(),
        statuses: z
          .array(z.enum(['draft', 'ready_for_review', 'reviewed', 'published']))
          .max(4)
          .optional(),
        format: z
          .enum(['json', 'apple-strings', 'android-xml'])
          .default('json'),
      }),
    },
    async ({ projectId, environment, ...filters }) => {
      try {
        return result(
          await client.get(
            `projects/${encodeURIComponent(projectId)}/translations`,
            {
              environment,
              languages: filters.languages,
              namespaces: filters.namespaces,
              keys: filters.keys,
              tags: filters.tags,
              status: filters.statuses,
              format: filters.format,
            },
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'toterslokalise_analyze_import',
    {
      description:
        'Analyze up to 20 localization files without changing translations. Review the returned session and conflicts before calling proceed.',
      inputSchema: z.object({
        ...projectInput,
        files: z
          .array(
            z
              .object({
                name: z.string().min(1).max(255),
                content: z
                  .string()
                  .max(8 * 1024 * 1024)
                  .optional()
                  .describe('UTF-8 file content'),
                contentBase64: z
                  .string()
                  .max(12 * 1024 * 1024)
                  .optional()
                  .describe('Base64 content for binary files such as XLSX'),
                mimeType: z.string().max(127).optional(),
                localeHint: z.string().min(2).optional(),
                namespace: z.string().min(1).optional(),
              })
              .refine(
                (file) =>
                  (file.content === undefined) !==
                  (file.contentBase64 === undefined),
                'Provide exactly one of content or contentBase64',
              ),
          )
          .min(1)
          .max(20),
        conflictPolicy: z
          .enum(['review', 'keep_existing', 'use_imported'])
          .default('review'),
        tags: z.array(z.string().min(1)).max(50).default([]),
      }),
    },
    async ({ projectId, environment, files, conflictPolicy, tags }) => {
      try {
        return result(
          await client.post(
            `projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}/import-sessions/analyze`,
            {
              conflictPolicy,
              tags,
              files: files.map(({ content, ...file }) => ({
                ...file,
                contentBase64:
                  file.contentBase64 ??
                  Buffer.from(content!, 'utf8').toString('base64'),
              })),
            },
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'toterslokalise_get_import_session',
    {
      description:
        'Poll a durable import analysis or import job and read its immutable hashes and counts.',
      inputSchema: z.object({
        ...projectInput,
        sessionId: z.string().min(1),
      }),
    },
    async ({ projectId, environment, sessionId }) => {
      try {
        return result(
          await client.get(
            `projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}/import-sessions/${encodeURIComponent(sessionId)}`,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'toterslokalise_list_import_items',
    {
      description:
        'Page through analyzed import items. Use classification=conflict to collect every decision required before proceeding.',
      inputSchema: z.object({
        ...projectInput,
        sessionId: z.string().min(1),
        classification: z
          .enum([
            'new',
            'updated',
            'unchanged',
            'conflict',
            'excluded',
            'missing',
          ])
          .optional(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().min(1).optional(),
      }),
    },
    async ({ projectId, environment, sessionId, ...query }) => {
      try {
        return result(
          await client.get(
            `projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}/import-sessions/${encodeURIComponent(sessionId)}/items`,
            query,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'toterslokalise_proceed_import',
    {
      description:
        'WRITE ACTION: apply one previously analyzed import snapshot. Every review-policy conflict must have an explicit resolution.',
      inputSchema: z.object({
        ...projectInput,
        sessionId: z.string().min(1),
        analysisHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        projectStateHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        conflicts: z
          .array(
            z.object({
              itemId: z.string().min(1),
              resolution: z.enum(['keep_existing', 'use_imported', 'exclude']),
            }),
          )
          .max(25_000)
          .default([]),
      }),
    },
    async ({ projectId, environment, sessionId, ...approval }) => {
      try {
        return result(
          await client.post(
            `projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}/import-sessions/${encodeURIComponent(sessionId)}/proceed`,
            approval,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'toterslokalise_cancel_import',
    {
      description:
        'Cancel an import session that has not completed. This never deletes translations already committed by another completed session.',
      inputSchema: z.object({
        ...projectInput,
        sessionId: z.string().min(1),
      }),
    },
    async ({ projectId, environment, sessionId }) => {
      try {
        return result(
          await client.post(
            `projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}/import-sessions/${encodeURIComponent(sessionId)}/cancel`,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
