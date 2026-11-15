#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { TotersLokaliseClient } from './client.js';
import { resolveApiOrigin } from './config.js';
import { createTotersLokaliseMcpServer } from './server.js';

const accessKey = process.env.TOTERSLOKALISE_ACCESS_KEY;
const secret = process.env.TOTERSLOKALISE_SECRET;

if (!accessKey || !secret) {
  console.error(
    'TOTERSLOKALISE_ACCESS_KEY and TOTERSLOKALISE_SECRET are required. Create one in Lingo Rider under Workspace administration → API credentials.',
  );
  process.exitCode = 1;
} else {
  try {
    const client = new TotersLokaliseClient({
      apiOrigin: resolveApiOrigin(),
      accessKey,
      secret,
    });
    const handle = serveStdio(() => createTotersLokaliseMcpServer(client));
    process.on('SIGINT', () => {
      void handle.close();
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
