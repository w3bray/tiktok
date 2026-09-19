/**
 * Teste ponta a ponta da versao Android contra um aparelho SIMULADO: um
 * dublê de adb que responde `uiautomator dump` e `screencap` conforme o
 * estado de uma tela falsa do TikTok. Cobre as quatro categorias — curtidos,
 * salvos, colecoes e republicados. Sem aparelho, sem internet, sem conta.
 *
 *   node test/android-flow.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Session } from '../android/src/flows.js';
import { parseDump } from '../android/src/ui.js';
import { decodePng } from '../android/src/png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patterns = JSON.parse(fs.readFileSync(path.join(ROOT, 'android/patterns.json'), 'utf8'));

const SCREEN = { width: 1080, height: 2400 };
const SHOT_SCALE = 0.5; // a captura vem menor que a tela logica, como num aparelho real

const BOX = {
  profileTab: { x1: 864, y1: 2250, x2: 1080, y2: 2400 },
  favoritesTab: { x1: 160, y1: 500, x2: 340, y2: 560 },
  repostTab: { x1: 380, y1: 500, x2: 560, y2: 560 },
  likedTab: { x1: 600, y1: 500, x2: 780, y2: 560 },
  collectionsTab: { x1: 160, y1: 580, x2: 340, y2: 640 },
  like: { x1: 960, y1: 1200, x2: 1050, y2: 1290 },
  bookmark: { x1: 960, y1: 1500, x2: 1050, y2: 1590 },
  collectionMenu: { x1: 980, y1: 200, x2: 1060, y2: 280 },
  collectionDelete: { x1: 200, y1: 1000, x2: 880, y2: 1080 },
  confirm: { x1: 500, y1: 1300, x2: 800, y2: 1380 },
};

const bounds = (b) => `[${b.x1},${b.y1}][${b.x2},${b.y2}]`;
const hits = (b, x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

/** Aparelho falso: mantem o estado e responde como o adb responderia. */
class FakeDevice {
  constructor(listas) {
    this.listas = structuredClone(listas);
    this.screen = 'home';
    this.tab = 'likes';
    this.current = null;
    this.menuOpen = false;
    this.dialogOpen = false;
    this.launched = false;
    this.backs = 0;
    this.refreshes = 0;
  }

  screenSize() {
    return Promise.resolve(SCREEN);
  }

  installedPackages() {
    return Promise.resolve(['com.android.settings', 'com.zhiliaoapp.musically']);
  }

  currentPackage() {
    return Promise.resolve('com.zhiliaoapp.musically');
  }

  launch() {
    this.launched = true;
    this.screen = 'home';
    return Promise.resolve();
  }

  back() {
    this.backs += 1;
    if (this.screen === 'player' || this.screen === 'collection') this.screen = 'profile';
    this.menuOpen = false;
    this.dialogOpen = false;
    return Promise.resolve();
  }

  swipe() {
    this.refreshes += 1;
    return Promise.resolve();
  }

  /** O que a grade mostra agora. Aqui ela reflete o estado na hora. */
  visibleIds() {
    return this.listas[this.tab] ?? [];
  }

  cells() {
    return this.visibleIds()
      .slice(0, 9)
      .map((id, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const box = {
          x1: column * 360,
          y1: 700 + row * 480,
          x2: column * 360 + 360,
          y2: 700 + row * 480 + 480,
        };
        return { id, box };
      });
  }

  async tap(x, y) {
    if (hits(BOX.profileTab, x, y)) {
      this.screen = 'profile';
      return;
    }

    if (this.screen === 'collection') {
      if (this.dialogOpen && hits(BOX.confirm, x, y)) {
        this.listas.collections = this.listas.collections.filter((id) => id !== this.current);
        this.screen = 'profile';
        this.menuOpen = false;
        this.dialogOpen = false;
        return;
      }
      if (this.menuOpen && hits(BOX.collectionDelete, x, y)) {
        this.dialogOpen = true;
        return;
      }
      if (hits(BOX.collectionMenu, x, y)) this.menuOpen = true;
      return;
    }

    if (this.screen === 'profile') {
      if (hits(BOX.likedTab, x, y)) this.tab = 'likes';
      else if (hits(BOX.repostTab, x, y)) this.tab = 'reposts';
      else if (hits(BOX.favoritesTab, x, y)) this.tab = 'saved';
      else if (hits(BOX.collectionsTab, x, y) && (this.tab === 'saved' || this.tab === 'collections')) {
        this.tab = 'collections';
      } else {
        const cell = this.cells().find((item) => hits(item.box, x, y));
        if (cell) {
          this.current = cell.id;
          this.screen = this.tab === 'collections' ? 'collection' : 'player';
        }
      }
      return;
    }

    if (this.screen === 'player') {
      // Alterna, exatamente como o botao real: um toque tira, outro devolve.
      const alterna = (lista) => {
        const atual = this.listas[lista];
        const posicao = atual.indexOf(this.current);
        if (posicao === -1) atual.push(this.current);
        else atual.splice(posicao, 1);
      };

      if (hits(BOX.like, x, y)) alterna('likes');
      else if (hits(BOX.bookmark, x, y)) alterna('saved');
    }
  }

  async dump() {
    const nav = `<node content-desc="Perfil" class="android.widget.Button" clickable="true" bounds="${bounds(
      BOX.profileTab,
    )}" />`;

    if (this.screen === 'collection') {
      const menu = `<node content-desc="Mais opções" clickable="true" bounds="${bounds(
        BOX.collectionMenu,
      )}" />`;
      const excluir = this.menuOpen
        ? `<node text="Excluir coleção" clickable="true" bounds="${bounds(BOX.collectionDelete)}" />`
        : '';
      const confirmar = this.dialogOpen
        ? `<node text="Excluir" clickable="true" bounds="${bounds(BOX.confirm)}" />`
        : '';
      return parseDump(`<hierarchy>${menu}${excluir}${confirmar}</hierarchy>`);
    }

    if (this.screen === 'player') {
      const curtido = this.listas.likes.includes(this.current);
      const salvo = this.listas.saved.includes(this.current);
      return parseDump(`<hierarchy>
        <node content-desc="${curtido ? 'Curtir' : 'Descurtir'} vídeo, 1.2M curtidas" clickable="true" bounds="${bounds(
          BOX.like,
        )}" />
        <node content-desc="${salvo ? 'Salvar' : 'Remover dos'} favoritos" clickable="true" bounds="${bounds(
          BOX.bookmark,
        )}" />
        <node content-desc="Comentar, 300 comentários" clickable="true" bounds="[960,1350][1050,1440]" />
      </hierarchy>`);
    }

    if (this.screen === 'profile') {
      const grade = this.cells()
        .map(
          (cell) =>
            `<node content-desc="item ${cell.id}" clickable="true" bounds="${bounds(cell.box)}" />`,
        )
        .join('');

      const sub =
        this.tab === 'saved' || this.tab === 'collections'
          ? `<node text="Coleções" clickable="true" bounds="${bounds(BOX.collectionsTab)}" />`
          : '';

      const vazio = this.visibleIds().length
        ? ''
        : '<node text="Nada por aqui" bounds="[100,900][980,960]" />';

      return parseDump(`<hierarchy>
        ${nav}
        <node text="Favoritos" clickable="true" bounds="${bounds(BOX.favoritesTab)}" />
        <node text="Repostagens" clickable="true" bounds="${bounds(BOX.repostTab)}" />
        <node text="Curtidos" clickable="true" bounds="${bounds(BOX.likedTab)}" />
        ${sub}${grade}${vazio}
      </hierarchy>`);
    }

    return parseDump(`<hierarchy>${nav}</hierarchy>`);
  }

  /** Captura reduzida, com cada icone na cor do seu estado. */
  async screenshot() {
    const width = Math.round(SCREEN.width * SHOT_SCALE);
    const height = Math.round(SCREEN.height * SHOT_SCALE);

    const aceso = {
      like: this.screen === 'player' && this.listas.likes.includes(this.current),
      bookmark: this.screen === 'player' && this.listas.saved.includes(this.current),
    };

    const area = (box) => ({
      x1: box.x1 * SHOT_SCALE,
      y1: box.y1 * SHOT_SCALE,
      x2: box.x2 * SHOT_SCALE,
      y2: box.y2 * SHOT_SCALE,
    });

    const dentro = (caixa, x, y) => x >= caixa.x1 && x < caixa.x2 && y >= caixa.y1 && y < caixa.y2;
    const like = area(BOX.like);
    const bookmark = area(BOX.bookmark);

    return decodePng(
      png(width, height, (x, y) => {
        if (dentro(like, x, y)) return aceso.like ? [254, 44, 85, 255] : [255, 255, 255, 255];
        if (dentro(bookmark, x, y)) return aceso.bookmark ? [255, 193, 7, 255] : [255, 255, 255, 255];
        return [18, 18, 20, 255];
      }),
    );
  }
}

function png(width, height, pixel) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * (stride + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const crc32 = (buffer) => {
    let crc = ~0;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc;
  };

  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const config = {
  dryRun: false,
  limit: Infinity,
  maxPasses: 20,
  delayMin: 1,
  delayMax: 5,
  cooldownEvery: 0,
  cooldownMs: 0,
  launchWaitMs: 0,
};

const silent = { info() {}, ok() {}, warn() {}, error() {}, step() {} };
const budget = () => ({ remaining: () => Infinity, spend: () => {} });

const LISTAS = {
  likes: [1, 2, 3, 4, 5, 6, 7],
  saved: [8, 9, 10],
  reposts: [],
  collections: [11, 12],
};

/** Variante em que a grade so muda no "puxar para atualizar". */
class LazyDevice extends FakeDevice {
  constructor(listas) {
    super(listas);
    this.visivel = structuredClone(this.listas);
  }

  visibleIds() {
    return this.visivel[this.tab] ?? [];
  }

  swipe(...args) {
    this.visivel = structuredClone(this.listas);
    return super.swipe(...args);
  }
}

// --- as quatro categorias, no aparelho que reordena a grade na hora --------

for (const [kind, total] of [
  ['likes', 7],
  ['saved', 3],
  ['collections', 2],
]) {
  const device = new FakeDevice(LISTAS);
  const session = new Session(device, config, silent, patterns);

  await session.start();
  const result = await session.cleanTab(kind, budget());

  assert.equal(result.removed, total, `${kind}: esperava ${total}, veio ${result.removed}`);
  assert.equal(result.failed, 0, `${kind}: nenhuma falha esperada`);
  assert.equal(device.listas[kind].length, 0, `${kind}: o aparelho falso ainda tem itens`);
  assert.equal(await session.verifyEmpty(kind), true, `${kind}: a aba deveria estar vazia`);

  console.log(`  ok ${kind}: ${result.removed}/${total} removidos e aba verificada vazia`);
}

// --- descurtir nao pode mexer nos salvos, e vice-versa ---------------------

{
  const device = new FakeDevice({ likes: [1, 2, 3], saved: [1, 2, 3], reposts: [], collections: [] });
  const session = new Session(device, config, silent, patterns);

  await session.start();
  await session.cleanTab('likes', budget());

  assert.deepEqual(device.listas.likes, [], 'as curtidas deveriam sumir');
  assert.deepEqual(device.listas.saved, [1, 2, 3], 'os salvos nao podem ser tocados');
  console.log('  ok limpar curtidas nao mexe nos videos salvos');
}

// --- grade preguicosa: so atualiza no refresh ------------------------------

{
  const device = new LazyDevice(LISTAS);
  const session = new Session(device, config, silent, patterns);

  await session.start();
  const result = await session.cleanTab('likes', budget());

  assert.equal(result.removed, 7, `grade preguicosa: veio ${result.removed}`);
  assert.equal(device.listas.likes.length, 0, 'deveria zerar mesmo sem reordenar na hora');
  console.log('  ok grade que so atualiza no refresh: 7/7 removidos');
}

// --- limite -----------------------------------------------------------------

{
  const device = new FakeDevice(LISTAS);
  const session = new Session(device, config, silent, patterns);
  let restante = 3;

  await session.start();
  const parcial = await session.cleanTab('likes', {
    remaining: () => restante,
    spend: () => (restante -= 1),
  });

  assert.equal(parcial.removed, 3, `--limit deveria parar em 3, parou em ${parcial.removed}`);
  assert.equal(device.listas.likes.length, 4, 'as outras 4 curtidas deveriam continuar la');
  console.log('  ok limite: parou em 3 remocoes e preservou as outras 4');
}

console.log('\nOK: as quatro categorias zeradas no aparelho simulado.');
