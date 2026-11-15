import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { TotersLokaliseApiError } from './client.js';
import type { TotersLokaliseClient } from './client.js';
import { createKeys } from './create-keys.js';
import { writeExport } from './export-files.js';

const MAX_MCP_TEXT = 200_000;

const projectInput = {
  projectId: z.string().min(1).describe('Lingo Rider project ID'),
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
  const server = new McpServer({ name: 'toterslokalise', version: '0.3.0' });

  server.registerTool(
    'toterslokalise_list_projects',
    {
      description:
        'List active Lingo Rider projects visible to the scoped organization credential.',
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
    'toterslokalise_export_files',
    {
      description:
        'Download app-ready translation files, the same as the Export screen: iOS .strings/.stringsdict, Android strings.xml, PHP, JSON, xcstrings, CSV or Excel, with {0} placeholders converted (%@ on iOS, %s on Android) and every language in one go. With outputDir the files are written (ZIPs unpacked) into that folder of the current project, e.g. "ios/Resources"; without it, text files are returned for review.',
      inputSchema: z.object({
        projectId: z.string().min(1).describe('Project ID'),
        environment: z.string().min(1).default('production').describe('Environment slug; production by default'),
        format: z.enum(['apple-strings', 'android-xml', 'php', 'json', 'xcstrings', 'csv', 'xlsx']),
        locales: z.array(z.string().min(2)).max(50).optional().describe('Languages, e.g. ["en-US","ar-LB"]; all by default'),
        namespaces: z.array(z.string().min(1)).max(1_000).optional().describe('Namespace names; all by default'),
        tags: z.array(z.string().min(1)).max(50).optional(),
        keyContains: z.string().max(200).optional().describe('Only keys whose name contains this text'),
        statuses: z
          .array(z.enum(['draft', 'in_review', 'approved', 'published']))
          .max(4)
          .optional()
          .describe('Published only by default'),
        fileName: z
          .string()
          .max(200)
          .optional()
          .describe('File name pattern with {locale} {locale_} {lang} {android} {values} {namespace} {project} {env}, e.g. "{locale}.lproj/Localizable.strings"'),
        placeholders: z.enum(['platform', 'keep']).optional(),
        argumentStyle: z.enum(['auto', 'numbered', 'simple']).optional(),
        missing: z.enum(['skip', 'source', 'empty', 'null']).optional().describe('Missing translations: leave out (default), use source text, empty, or null (PHP/JSON)'),
        keyCase: z.enum(['preserve', 'lower', 'upper', 'proper']).optional(),
        keyQuotes: z.enum(['quoted', 'none']).optional(),
        keyDetails: z.boolean().optional().describe('Add tags and descriptions'),
        outputDir: z
          .string()
          .min(1)
          .optional()
          .describe('Folder (relative to the current project) to write the files into; existing files with the same names are replaced'),
      }),
    },
    async ({ projectId, outputDir, namespaces, ...options }) => {
      try {
        const file = await client.postFile(`projects/${encodeURIComponent(projectId)}/exports`, {
          ...options,
          ...(namespaces ? { namespaces } : {}),
        });
        return result(await writeExport(file, outputDir));
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
    'toterslokalise_create_keys',
    {
      description:
        'WRITE ACTION: create translation keys with their text, e.g. keys and strings read from a Figma design. Values are keyed by locale (use the project languages, e.g. en-US, ar-LB). Existing text is kept unless existingValues is "overwrite". New translations land as drafts in the chosen environment. Use dryRun first to preview. Writing source-language (English) text needs a credential with the source:write scope.',
      inputSchema: z.object({
        ...projectInput,
        keys: z
          .array(
            z.object({
              key: z.string().min(1).max(190).describe('Key name, e.g. checkout.pay_button'),
              namespace: z.string().min(1).max(80).optional().describe('Namespace; default "default"'),
              description: z.string().max(500).optional().describe('Context for translators, e.g. the Figma frame'),
              values: z
                .record(z.string().min(2).max(35), z.string().max(10_000))
                .refine((values) => Object.keys(values).length > 0, 'Give at least one value')
                .describe('Text per locale, e.g. { "en-US": "Pay now" }'),
            }),
          )
          .min(1)
          .max(2_000),
        existingValues: z.enum(['keep', 'overwrite']).default('keep'),
        createNamespaces: z.boolean().default(false),
        tags: z.array(z.string().min(1)).max(50).default([]),
        dryRun: z.boolean().default(false),
      }),
    },
    async (input) => {
      try {
        return result(await createKeys(client, input));
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
