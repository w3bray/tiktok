/**
 * Teste offline: sobe um "TikTok" falso via interceptacao de rede e verifica
 * que o bot zera a aba de curtidos de ponta a ponta. Nao toca na internet
 * nem em conta nenhuma.
 *
 *   node test/offline.test.mjs
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { cleanTab, verifyEmpty } from '../src/tasks/clean.js';

const TOTAL = 5;
const liked = new Set(Array.from({ length: TOTAL }, (_, i) => String(i + 1)));

const config = {
  baseUrl: 'https://www.tiktok.com',
  username: 'contateste',
  headless: true,
  dryRun: false,
  limit: Infinity,
  maxPasses: 20,
  delayMin: 10,
  delayMax: 40,
  cooldownEvery: 0,
  cooldownMs: 0,
  userDataDir: path.join(os.tmpdir(), `tiktok-cleaner-test-${Date.now()}`),
};

const silent = { info() {}, ok() {}, warn() {}, error() {}, step() {} };

function profileHtml() {
  const items = [...liked]
    .map(
      (id) =>
        `<div data-e2e="user-post-item">` +
        `<a href="https://www.tiktok.com/@contateste/video/${id}">video ${id}</a></div>`,
    )
    .join('');
  return `<html><body><div data-e2e="profile-icon"></div>
    <p role="tab" data-e2e="like-tab">Curtidos</p>
    <div id="grid">${items || '<p data-e2e="user-post-empty">Nada por aqui</p>'}</div>
  </body></html>`;
}

function videoHtml(id) {
  const isLiked = liked.has(id);
  return `<html><body><div data-e2e="profile-icon"></div>
    <button data-e2e="browse-like-icon">
      <svg style="fill: ${isLiked ? 'rgb(254, 44, 85)' : 'rgb(22, 24, 35)'}"><path/></svg>
    </button>
    <script>
      document.querySelector('button').addEventListener('click', async () => {
        const svg = document.querySelector('svg');
        const liked = svg.style.fill.includes('254');
        await fetch('/__toggle/${id}/' + (liked ? 'off' : 'on'));
        svg.style.fill = liked ? 'rgb(22, 24, 35)' : 'rgb(254, 44, 85)';
      });
    </script>
  </body></html>`;
}

const { context, page } = await launchBrowser(config);

await context.route('**://www.tiktok.com/**', async (route) => {
  const url = new URL(route.request().url());
  const toggle = url.pathname.match(/^\/__toggle\/(\d+)\/(on|off)$/);

  if (toggle) {
    if (toggle[2] === 'off') liked.delete(toggle[1]);
    else liked.add(toggle[1]);
    return route.fulfill({ status: 200, body: 'ok' });
  }

  const video = url.pathname.match(/\/video\/(\d+)$/);
  const body = video ? videoHtml(video[1]) : profileHtml();
  return route.fulfill({ status: 200, contentType: 'text/html', body });
});

try {
  const result = await cleanTab(page, config, silent, 'likes', {
    remaining: () => Infinity,
    spend: () => {},
  });

  assert.equal(result.removed, TOTAL, `esperava ${TOTAL} remocoes, veio ${result.removed}`);
  assert.equal(result.failed, 0, 'nenhuma falha esperada');
  assert.equal(liked.size, 0, 'o estado do servidor falso deveria estar vazio');
  assert.equal(await verifyEmpty(page, config, silent, 'likes'), true, 'aba deveria estar vazia');

  console.log(`OK: ${result.removed}/${TOTAL} curtidas removidas e aba verificada como vazia.`);
} finally {
  await context.close();
}
