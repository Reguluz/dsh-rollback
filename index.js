/**
 * Host half of @local/dsh-rollback.
 *
 * Registers three local HTTP routes on the DSH web server so the settings
 * page can list DeepSeek Harness GitHub releases and download an older
 * version's source archive into a dedicated folder outside any session
 * workspace:
 *
 *   GET  /dsh-rollback/releases  -> { currentVersion, releases: [...] }
 *   POST /dsh-rollback/download  body { tag, url } -> { tag, state }
 *   GET  /dsh-rollback/status    -> { jobs: [...] }
 */

import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, rename, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'deepseek-ai/deepseek-harness';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
const ALLOWED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
]);

export const inject = ['webServer'];

export function apply(ctx) {
  const downloadDir = path.join(os.homedir(), 'dsh-rollback-versions');
  /** @type {Map<string, any>} tag -> job */
  const jobs = new Map();

  function readCurrentVersion() {
    const candidates = [];
    if (process.env.DSH_INSTALL_DIR) {
      candidates.push(path.join(process.env.DSH_INSTALL_DIR, 'package.json'));
    }
    // Electron Desktop fallback: <install>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));
    }
    for (const file of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8'));
        if (pkg?.name === '@deepseek-ai/dsh' && pkg.version) return pkg.version;
      } catch {
        /* try next anchor */
      }
    }
    return null;
  }

  function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(new Error('body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /** Same-origin guard: reject cross-site requests that carry an Origin header. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return true; // same-origin fetch/file load
    try {
      const host = req.headers.host || '';
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  async function listReleases() {
    const response = await fetch(RELEASES_API, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-rollback-plugin',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }
    const data = await response.json();
    const releases = data
      .filter((item) => !item.draft)
      .map((item) => ({
        tag: item.tag_name,
        name: item.name || item.tag_name,
        publishedAt: item.published_at,
        prerelease: item.prerelease,
        htmlUrl: item.html_url,
        zipballUrl: item.zipball_url,
        tarballUrl: item.tarball_url,
        assets: (item.assets || []).map((asset) => ({
          name: asset.name,
          size: asset.size,
          url: asset.browser_download_url,
        })),
      }));
    return releases;
  }

  async function startDownload(tag, url) {
    if (!tag || typeof tag !== 'string' || !/^[A-Za-z0-9._-]+$/.test(tag)) {
      throw new Error('invalid tag');
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('invalid url');
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new Error('url host not allowed');
    }
    const job = { tag, url, state: 'downloading', received: 0, total: 0, filePath: null, error: null };
    jobs.set(tag, job);

    const ext = url.includes('tarball') || url.endsWith('.tar.gz') ? '.tar.gz' : '.zip';
    const base = tag.startsWith('dsh-') ? tag : `dsh-${tag}`;
    const fileName = `${base}${ext}`;
    const target = path.join(downloadDir, fileName);
    const temp = path.join(downloadDir, `.${fileName}.part`);

    try {
      await mkdir(downloadDir, { recursive: true });
      const response = await fetch(url, {
        headers: { 'user-agent': 'dsh-rollback-plugin' },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
      job.total = Number(response.headers.get('content-length')) || 0;
      const body = Readable.fromWeb(response.body);
      body.on('data', (chunk) => {
        job.received += chunk.length;
      });
      await pipeline(body, createWriteStream(temp));
      await rm(target, { force: true });
      await rename(temp, target);
      job.filePath = target;
      job.state = 'done';
    } catch (error) {
      job.state = 'error';
      job.error = String(error?.message || error);
      await rm(temp, { force: true }).catch(() => {});
    }
    return job;
  }

  /** Reveal or open a local path with the OS file manager, detached from the host process. */
  function revealPath(target, select) {
    try {
      if (process.platform === 'win32') {
        spawn('explorer.exe', select ? [`/select,${target}`] : [target], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', select ? ['-R', target] : [target], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
      }
      return true;
    } catch {
      return false;
    }
  }

  const disposer = ctx.effect(() => {
    const dispose = [
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-rollback/releases',
        handler: async (req, res) => {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' });
          try {
            const releases = await listReleases();
            sendJson(res, 200, { currentVersion: readCurrentVersion(), downloadDir, releases });
          } catch (error) {
            sendJson(res, 502, { error: String(error?.message || error) });
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-rollback/download',
        handler: async (req, res) => {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' });
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' });
            return void res.end();
          }
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            // Do not await: long downloads run in the background; poll /status.
            startDownload(body.tag, body.url).catch(() => {});
            sendJson(res, 202, { tag: body.tag, state: 'downloading' });
          } catch (error) {
            sendJson(res, 400, { error: String(error?.message || error) });
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-rollback/status',
        handler: (req, res) => {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' });
          sendJson(res, 200, { jobs: [...jobs.values()] });
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-rollback/open',
        handler: (req, res) => {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' });
          let target = null;
          let select = false;
          try {
            const query = new URL(req.url, 'http://localhost').searchParams;
            if (query.get('folder') === '1') {
              target = downloadDir;
            } else {
              const job = jobs.get(query.get('tag') || '');
              // Only reveal files this plugin itself downloaded and finished.
              if (job?.state === 'done' && job.filePath) {
                target = job.filePath;
                select = true;
              }
            }
          } catch {
            target = null;
          }
          if (!target) return sendJson(res, 404, { error: 'nothing to open' });
          mkdir(downloadDir, { recursive: true }).catch(() => {});
          sendJson(res, 200, { opened: revealPath(target, select) });
        },
      }),
    ];
    return () => dispose.forEach((d) => d?.());
  });

  return disposer;
}
