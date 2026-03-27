#!/usr/bin/env node
/**
 * delete-projectmaps.js
 *
 * Standalone script — no npm install required. Uses only Node.js built-ins.
 * Deletes all project maps for a Uniform project.
 *
 * Required environment variables:
 *   UNIFORM_API_KEY
 *   UNIFORM_HOST
 *   UNIFORM_PROJECT_ID
 *
 * Azure DevOps example (pipeline variables set as secret env vars):
 *   - script: node delete-projectmaps.js
 *     env:
 *       UNIFORM_API_KEY:    $(UNIFORM_API_KEY)
 *       UNIFORM_HOST:       $(UNIFORM_HOST)
 *       UNIFORM_PROJECT_ID: $(UNIFORM_PROJECT_ID)
 */

'use strict';

const https = require('https');

function arg(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return value;
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body || '';
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          ...(opts.headers || {}),
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Uniform API calls ──────────────────────────────────────────────────────────

async function getProjectMaps(host, projectId, authHeaders) {
  const res = await httpRequest(`${host}/api/v1/project-map?projectId=${projectId}`, {
    method: 'GET',
    headers: authHeaders,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`getProjectMaps failed (${res.status}): ${res.body}`);
  }
  const parsed = JSON.parse(res.body);
  return parsed.projectMaps ?? parsed;
}

async function deleteProjectMap(host, projectId, projectMapId, authHeaders) {
  const res = await httpRequest(`${host}/api/v1/project-map`, {
    method: 'DELETE',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, projectMapId }),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`deleteProjectMap failed (${res.status}): ${res.body}`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  const host      = new URL(arg('UNIFORM_HOST')).origin;
  const projectId = arg('UNIFORM_PROJECT_ID');
  const authHeaders = { 'uniform-api-key': arg('UNIFORM_API_KEY') };

  const maps = await getProjectMaps(host, projectId, authHeaders);
  if (maps.length === 0) {
    console.log('No project maps found.');
    return;
  }
  console.log(`Deleting ${maps.length} project map(s)...`);
  for (const map of maps) {
    await deleteProjectMap(host, projectId, map.id, authHeaders);
    console.log(`  Deleted: ${map.id}${map.name ? ` (${map.name})` : ''}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
