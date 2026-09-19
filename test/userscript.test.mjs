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
const AMARELO = 'rgb(255, 193, 7)';
const CINZA = 'rgb(22, 24, 35)';

/** SPA minima que imita o site movel do TikTok. */
const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>TikTok</title></head>
<body>
<div id="app"></div>
<script>
  window.__estado = {
    curtidos: [1, 2, 3, 4, 5, 6],
    salvos: [20, 21],
    colecoes: ['viagem', 'receitas'],
    republicados: [7, 8],
    aba: 'likes',
  };

  const LISTA = { likes: 'curtidos', saved: 'salvos', reposts: 'republicados', collections: 'colecoes' };

  function render() {
    const caminho = location.pathname;
    const video = /\\/video\\/(\\d+)/.exec(caminho);
    const colecao = /\\/collection\\/([\\w-]+)/.exec(caminho);
    const app = document.getElementById('app');

    if (video) {
      const id = Number(video[1]);
      const cor = (lista, aceso) => (window.__estado[lista].includes(id) ? aceso : '${CINZA}');

      app.innerHTML =
        '<button data-e2e="browse-like-icon" aria-label="Curtir video">' +
        '<svg style="fill: ' + cor('curtidos', '${VERMELHO}') + '"><path/></svg></button>' +
        '<button data-e2e="browse-bookmark-icon" aria-label="Favoritos">' +
        '<svg style="fill: ' + cor('salvos', '${AMARELO}') + '"><path/></svg></button>' +
        '<button data-e2e="video-repost" aria-label="Repostar">' +
        '<svg style="fill: ' + cor('republicados', '${VERMELHO}') + '"><path/></svg></button>';

      const liga = (seletor, lista) => {
        app.querySelector(seletor).onclick = () => {
          alterna(lista, id);
          render();
        };
      };

      liga('[data-e2e="browse-like-icon"]', 'curtidos');
      liga('[data-e2e="browse-bookmark-icon"]', 'salvos');
      liga('[data-e2e="video-repost"]', 'republicados');
      return;
    }

    if (colecao) {
      const nome = colecao[1];
      app.innerHTML =
        '<button data-e2e="collection-more" aria-label="Mais opções">···</button>' +
        '<div id="menu" style="display:none"><div role="button">Excluir coleção</div></div>' +
        '<div id="dialogo" style="display:none"><button>Excluir</button></div>';

      app.querySelector('[data-e2e="collection-more"]').onclick = () => {
        document.getElementById('menu').style.display = 'block';
      };
      app.querySelector('#menu div[role="button"]').onclick = () => {
        document.getElementById('dialogo').style.display = 'block';
      };
      app.querySelector('#dialogo button').onclick = () => {
        window.__estado.colecoes = window.__estado.colecoes.filter((item) => item !== nome);
        history.pushState({}, '', '/@conta');
        render();
      };
      return;
    }

    const aba = window.__estado.aba;
    const itens = window.__estado[LISTA[aba]];
    const favoritos = aba === 'saved' || aba === 'collections';

    const item = (valor) =>
      aba === 'collections'
        ? '<div data-e2e="collection-item"><a href="/@conta/collection/' + valor + '">' + valor + '</a></div>'
        : '<div data-e2e="user-post-item"><a href="/@conta/video/' + valor + '">v' + valor + '</a></div>';

    app.innerHTML =
      '<div role="tablist">' +
      '<p role="tab" data-e2e="repost-tab" aria-selected="' + (aba === 'reposts') + '">Repostagens</p>' +
      '<p role="tab" data-e2e="favorites-tab" aria-selected="' + favoritos + '">Favoritos</p>' +
      '<p role="tab" data-e2e="like-tab" aria-selected="' + (aba === 'likes') + '">Curtidos</p>' +
      '</div>' +
      (favoritos
        ? '<div role="tablist"><p role="tab" data-e2e="collection-tab" aria-selected="' +
          (aba === 'collections') + '">Coleções</p></div>'
        : '') +
      '<div id="grade">' +
      itens.map(item).join('') +
      (itens.length ? '' : '<p data-e2e="user-post-empty">Nada por aqui</p>') +
      '</div>';

    const destino = {
      'like-tab': 'likes',
      'repost-tab': 'reposts',
      'favorites-tab': 'saved',
      'collection-tab': 'collections',
    };

    for (const tab of app.querySelectorAll('[role="tab"]')) {
      tab.onclick = () => {
        window.__estado.aba = destino[tab.dataset.e2e];
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

  window.__totalRestante = () =>
    window.__estado.curtidos.length + window.__estado.salvos.length +
    window.__estado.colecoes.length + window.__estado.republicados.length;

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
  assert.equal(inicial.salvos.length, 2);
  assert.equal(inicial.colecoes.length, 2);
  assert.equal(inicial.republicados.length, 2);

  await painel.getByRole('button', { name: 'Limpar tudo' }).click();
  console.log('  ok "Limpar tudo" inicia a limpeza');

  await pagina.waitForFunction(() => window.__totalRestante() === 0, undefined, { timeout: 180000 });

  const final = await estado();
  assert.deepEqual(final.curtidos, [], 'deveria zerar os curtidos');
  assert.deepEqual(final.salvos, [], 'deveria zerar os salvos');
  assert.deepEqual(final.colecoes, [], 'deveria zerar as coleções');
  assert.deepEqual(final.republicados, [], 'deveria zerar os republicados');
  console.log('  ok zerou as quatro categorias');

  await pagina.waitForFunction(
    () => document.querySelector('#tiktok-cleaner .status')?.textContent?.includes('100% limpo'),
    undefined,
    { timeout: 30000 },
  );
  console.log('  ok painel reporta 100% limpo');

  const resumo = await painel.locator('.status').textContent();
  assert.match(resumo, /Removidos: 12/, `esperava 12 remocoes no resumo, veio: ${resumo}`);
  console.log('  ok resumo conta as 12 remocoes');

  // Nao pode recurtir nem resalvar nada depois de terminar.
  await pagina.waitForTimeout(4000);
  assert.equal(await pagina.evaluate(() => window.__totalRestante()), 0, 'nada pode voltar');
  console.log('  ok nao refaz nada depois de terminar');

  console.log('\nOK: userscript limpou 12/12 itens das quatro categorias e parou sozinho.');
} finally {
  await browser.close();
  fs.rmSync(path.join(os.tmpdir(), 'tiktok-cleaner-userscript'), { recursive: true, force: true });
}
