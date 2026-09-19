/**
 * Testa o userscript dentro de um "TikTok" falso: uma SPA com perfil, abas,
 * grade e pagina de video, navegacao por history.pushState e botoes que se
 * comportam como os de verdade. O script e injetado do jeito que uma
 * extensao injetaria. Sem internet, sem conta.
 *
 *   node test/userscript.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'userscript/tiktok-cleaner.user.js'), 'utf8');

const VERMELHO = 'rgb(254, 44, 85)';
const CINZA = 'rgb(22, 24, 35)';

/** SPA minima que imita o site movel do TikTok. */
const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>TikTok</title></head>
<body>
<div id="app"></div>
<script>
  window.__estado = {
    curtidos: [1, 2, 3, 4, 5, 6],
    republicados: [7, 8],
    aba: 'likes',
  };

  function render() {
    const caminho = location.pathname;
    const video = /\\/video\\/(\\d+)/.exec(caminho);
    const app = document.getElementById('app');

    if (video) {
      const id = Number(video[1]);
      const curtido = window.__estado.curtidos.includes(id);
      const repostado = window.__estado.republicados.includes(id);
      app.innerHTML =
        '<button data-e2e="browse-like-icon" aria-label="Curtir video">' +
        '<svg style="fill: ' + (curtido ? '${VERMELHO}' : '${CINZA}') + '"><path/></svg></button>' +
        '<button data-e2e="video-repost" aria-label="Repostar">' +
        '<svg style="fill: ' + (repostado ? '${VERMELHO}' : '${CINZA}') + '"><path/></svg></button>';

      app.querySelector('[data-e2e="browse-like-icon"]').onclick = () => {
        alterna('curtidos', id);
        render();
      };
      app.querySelector('[data-e2e="video-repost"]').onclick = () => {
        alterna('republicados', id);
        render();
      };
      return;
    }

    const aba = window.__estado.aba;
    const itens = aba === 'likes' ? window.__estado.curtidos : window.__estado.republicados;

    app.innerHTML =
      '<div role="tablist">' +
      '<p role="tab" data-e2e="repost-tab" aria-selected="' + (aba === 'reposts') + '">Repostagens</p>' +
      '<p role="tab" data-e2e="like-tab" aria-selected="' + (aba === 'likes') + '">Curtidos</p>' +
      '</div><div id="grade">' +
      itens
        .map(
          (id) =>
            '<div data-e2e="user-post-item"><a href="/@conta/video/' + id + '">v' + id + '</a></div>',
        )
        .join('') +
      (itens.length ? '' : '<p data-e2e="user-post-empty">Nada por aqui</p>') +
      '</div>';

    for (const tab of app.querySelectorAll('[role="tab"]')) {
      tab.onclick = () => {
        window.__estado.aba = tab.dataset.e2e === 'like-tab' ? 'likes' : 'reposts';
        render();
      };
    }

    for (const link of app.querySelectorAll('a')) {
      link.onclick = (evento) => {
        evento.preventDefault();
        history.pushState({}, '', link.getAttribute('href'));
        render();
      };
    }
  }

  function alterna(lista, id) {
    const atual = window.__estado[lista];
    const posicao = atual.indexOf(id);
    if (posicao === -1) atual.push(id);
    else atual.splice(posicao, 1);
  }

  window.onpopstate = render;
  history.replaceState({}, '', '/@conta');
  render();
</script>
</body></html>`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const contexto = await browser.newContext({
  viewport: { width: 390, height: 844 }, // tela de celular
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/131.0.0.0 Mobile Safari/537.36',
});

// Como uma extensao de userscript faria: injeta em toda navegacao.
await contexto.addInitScript(SCRIPT);
await contexto.route('**://www.tiktok.com/**', (rota) =>
  rota.fulfill({ status: 200, contentType: 'text/html', body: PAGINA }),
);

const pagina = await contexto.newPage();
await pagina.goto('https://www.tiktok.com/@conta');

const estado = () => pagina.evaluate(() => window.__estado);
const painel = pagina.locator('#tiktok-cleaner');

try {
  await painel.waitFor({ state: 'visible', timeout: 10000 });
  console.log('  ok painel aparece na pagina');

  const inicial = await estado();
  assert.equal(inicial.curtidos.length, 6);
  assert.equal(inicial.republicados.length, 2);

  await painel.getByRole('button', { name: 'Limpar tudo' }).click();
  console.log('  ok "Limpar tudo" inicia a limpeza');

  await pagina.waitForFunction(
    () => window.__estado.curtidos.length === 0 && window.__estado.republicados.length === 0,
    undefined,
    { timeout: 120000 },
  );

  const final = await estado();
  assert.deepEqual(final.curtidos, [], 'deveria zerar os curtidos');
  assert.deepEqual(final.republicados, [], 'deveria zerar os republicados');
  console.log('  ok zerou curtidos e republicados');

  await pagina.waitForFunction(
    () => document.querySelector('#tiktok-cleaner .status')?.textContent?.includes('100% limpo'),
    undefined,
    { timeout: 30000 },
  );
  console.log('  ok painel reporta 100% limpo');

  const resumo = await painel.locator('.status').textContent();
  assert.match(resumo, /Removidos: 8/, `esperava 8 remocoes no resumo, veio: ${resumo}`);
  console.log('  ok resumo conta as 8 remocoes');

  // Nao pode recurtir nada depois de terminar.
  await pagina.waitForTimeout(4000);
  const depois = await estado();
  assert.deepEqual(depois.curtidos, [], 'nao pode voltar a curtir depois de parar');
  assert.deepEqual(depois.republicados, [], 'nao pode voltar a repostar depois de parar');
  console.log('  ok nao recurte nada depois de terminar');

  console.log('\nOK: userscript limpou 8/8 itens e parou sozinho.');
} finally {
  await browser.close();
  fs.rmSync(path.join(os.tmpdir(), 'tiktok-cleaner-userscript'), { recursive: true, force: true });
}
