/**
 * Teste offline da versao de navegador: sobe um "TikTok" falso via
 * interceptacao de rede e verifica que o bot zera as quatro categorias —
 * curtidos, salvos, colecoes e republicados. Nao toca na internet nem em
 * conta nenhuma.
 *
 *   node test/offline.test.mjs
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { cleanTab, verifyEmpty } from '../src/tasks/clean.js';

const VERMELHO = 'rgb(254, 44, 85)';
const AMARELO = 'rgb(255, 193, 7)';
const CINZA = 'rgb(22, 24, 35)';

const estado = {
  likes: [1, 2, 3, 4, 5],
  saved: [6, 7, 8],
  reposts: [9, 10],
  collections: [11, 12],
};

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
const budget = () => ({ remaining: () => Infinity, spend: () => {} });

/** Perfil com as tres abas; a grade troca no clique, como no site. */
function profileHtml() {
  const grade = (lista, tipo) =>
    lista
      .map(
        (id) =>
          `<div data-e2e="user-post-item"><a href="https://www.tiktok.com/@contateste/${tipo}/${id}">${tipo} ${id}</a></div>`,
      )
      .join('') || '<p data-e2e="user-post-empty">Nada por aqui</p>';

  return `<html><body>
    <div data-e2e="profile-icon"></div>
    <div role="tablist">
      <p role="tab" data-e2e="repost-tab">Repostagens</p>
      <p role="tab" data-e2e="favorites-tab">Favoritos</p>
      <p role="tab" data-e2e="like-tab">Curtidos</p>
    </div>
    <div id="sub" style="display:none">
      <p role="tab" data-e2e="collection-tab">Coleções</p>
    </div>
    <div id="grade">${grade(estado.likes, 'video')}</div>
    <script>
      const dados = ${JSON.stringify(estado)};
      const grade = (lista, tipo) => lista.map((id) =>
        '<div data-e2e="user-post-item"><a href="https://www.tiktok.com/@contateste/' +
        tipo + '/' + id + '">' + tipo + ' ' + id + '</a></div>').join('') ||
        '<p data-e2e="user-post-empty">Nada por aqui</p>';

      const mostrar = (lista, tipo) => {
        document.getElementById('grade').innerHTML = grade(lista, tipo);
      };

      document.querySelector('[data-e2e="like-tab"]').onclick = () => {
        document.getElementById('sub').style.display = 'none';
        mostrar(dados.likes, 'video');
      };
      document.querySelector('[data-e2e="repost-tab"]').onclick = () => {
        document.getElementById('sub').style.display = 'none';
        mostrar(dados.reposts, 'video');
      };
      document.querySelector('[data-e2e="favorites-tab"]').onclick = () => {
        document.getElementById('sub').style.display = 'block';
        mostrar(dados.saved, 'video');
      };
      document.querySelector('[data-e2e="collection-tab"]').onclick = () => {
        mostrar(dados.collections, 'collection');
      };
    </script>
  </body></html>`;
}

function videoHtml(id) {
  const cor = (lista) => (lista.includes(id) ? (lista === estado.saved ? AMARELO : VERMELHO) : CINZA);

  return `<html><body>
    <div data-e2e="profile-icon"></div>
    <button data-e2e="browse-like-icon"><svg style="fill: ${cor(estado.likes)}"><path/></svg></button>
    <button data-e2e="browse-bookmark-icon"><svg style="fill: ${cor(estado.saved)}"><path/></svg></button>
    <button data-e2e="video-repost"><svg style="fill: ${cor(estado.reposts)}"><path/></svg></button>
    <script>
      const toca = (lista) => fetch('/__toggle/' + lista + '/${id}');
      document.querySelector('[data-e2e="browse-like-icon"]').onclick = (e) => {
        toca('likes'); e.currentTarget.querySelector('svg').style.fill = '${CINZA}';
      };
      document.querySelector('[data-e2e="browse-bookmark-icon"]').onclick = (e) => {
        toca('saved'); e.currentTarget.querySelector('svg').style.fill = '${CINZA}';
      };
      document.querySelector('[data-e2e="video-repost"]').onclick = (e) => {
        toca('reposts'); e.currentTarget.querySelector('svg').style.fill = '${CINZA}';
      };
    </script>
  </body></html>`;
}

function collectionHtml(id) {
  return `<html><body>
    <div data-e2e="profile-icon"></div>
    <button data-e2e="collection-more">Mais opções</button>
    <div id="menu" style="display:none">
      <div role="button" id="excluir">Excluir coleção</div>
    </div>
    <div id="dialogo" style="display:none"><button id="confirmar">Excluir</button></div>
    <script>
      document.querySelector('[data-e2e="collection-more"]').onclick = () => {
        document.getElementById('menu').style.display = 'block';
      };
      document.getElementById('excluir').onclick = () => {
        document.getElementById('dialogo').style.display = 'block';
      };
      document.getElementById('confirmar').onclick = () => {
        fetch('/__toggle/collections/${id}');
      };
    </script>
  </body></html>`;
}

const { context, page } = await launchBrowser(config);

await context.route('**://www.tiktok.com/**', async (route) => {
  const url = new URL(route.request().url());
  const toggle = url.pathname.match(/^\/__toggle\/(\w+)\/(\d+)$/);

  if (toggle) {
    const [, lista, id] = toggle;
    estado[lista] = estado[lista].filter((item) => item !== Number(id));
    return route.fulfill({ status: 200, body: 'ok' });
  }

  const video = url.pathname.match(/\/video\/(\d+)$/);
  const collection = url.pathname.match(/\/collection\/(\d+)$/);

  const body = video
    ? videoHtml(Number(video[1]))
    : collection
      ? collectionHtml(Number(collection[1]))
      : profileHtml();

  return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
});

try {
  const alvos = [
    ['likes', 5],
    ['saved', 3],
    ['reposts', 2],
    ['collections', 2],
  ];

  for (const [kind, total] of alvos) {
    const result = await cleanTab(page, config, silent, kind, budget());

    assert.equal(result.removed, total, `${kind}: esperava ${total}, veio ${result.removed}`);
    assert.equal(result.failed, 0, `${kind}: nenhuma falha esperada`);
    assert.equal(estado[kind].length, 0, `${kind}: o estado do servidor falso deveria zerar`);
    assert.equal(await verifyEmpty(page, config, silent, kind), true, `${kind}: deveria estar vazio`);

    console.log(`  ok ${kind}: ${result.removed}/${total} removidos e aba verificada vazia`);
  }

  console.log('\nOK: as quatro categorias zeradas pela versao de navegador.');
} finally {
  await context.close();
}
