/**
 * Teste ponta a ponta da versao Android contra um aparelho SIMULADO: um
 * dublê de adb que responde `uiautomator dump` e `screencap` conforme o
 * estado de uma tela falsa do TikTok. Sem aparelho, sem internet, sem conta.
 *
 *   node test/android-flow.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Session } from '../android/src/flows.js';
import { decodePng } from '../android/src/png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patterns = JSON.parse(fs.readFileSync(path.join(ROOT, 'android/patterns.json'), 'utf8'));

const SCREEN = { width: 1080, height: 2400 };
const SHOT_SCALE = 0.5; // a captura vem menor que a tela logica, como num aparelho real

const BOX = {
  profileTab: { x1: 864, y1: 2250, x2: 1080, y2: 2400 },
  likedTab: { x1: 600, y1: 500, x2: 780, y2: 560 },
  repostTab: { x1: 380, y1: 500, x2: 560, y2: 560 },
  like: { x1: 960, y1: 1200, x2: 1050, y2: 1290 },
};

const bounds = (b) => `[${b.x1},${b.y1}][${b.x2},${b.y2}]`;
const hits = (b, x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

/** Aparelho falso: mantem o estado e responde como o adb responderia. */
class FakeDevice {
  constructor(videos) {
    this.liked = [...videos];
    this.screen = 'home';
    this.current = null;
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
    if (this.screen === 'player') this.screen = 'profile';
    return Promise.resolve();
  }

  swipe() {
    this.refreshes += 1;
    return Promise.resolve();
  }

  async tap(x, y) {
    if (hits(BOX.profileTab, x, y)) {
      this.screen = 'profile';
      return;
    }

    if (this.screen === 'profile') {
      if (hits(BOX.likedTab, x, y)) return; // ja e a aba mostrada
      const cell = this.cells().find((item) => hits(item.box, x, y));
      if (cell) {
        this.screen = 'player';
        this.current = cell.id;
      }
      return;
    }

    if (this.screen === 'player' && hits(BOX.like, x, y)) {
      // Alterna, exatamente como o botao real: um toque tira, outro devolve.
      if (this.liked.includes(this.current)) {
        this.liked = this.liked.filter((id) => id !== this.current);
      } else {
        this.liked.push(this.current);
      }
    }
  }

  /** O que a grade mostra agora. Aqui ela reflete o estado na hora. */
  visibleIds() {
    return this.liked;
  }

  cells() {
    return this.visibleIds().slice(0, 9).map((id, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const box = {
        x1: column * 360,
        y1: 600 + row * 480,
        x2: column * 360 + 360,
        y2: 600 + row * 480 + 480,
      };
      return { id, box };
    });
  }

  async dump() {
    const nav = `<node content-desc="Perfil" class="android.widget.Button" clickable="true" bounds="${bounds(
      BOX.profileTab,
    )}" />`;

    if (this.screen === 'player') {
      const curtido = this.liked.includes(this.current);
      return parse(`<hierarchy>
        <node content-desc="${curtido ? 'Curtir' : 'Descurtir'} video, 1.2M curtidas" class="android.widget.ImageView" clickable="true" bounds="${bounds(
          BOX.like,
        )}" />
        <node content-desc="Comentar, 300 comentarios" class="android.widget.ImageView" clickable="true" bounds="[960,1350][1050,1440]" />
      </hierarchy>`);
    }

    if (this.screen === 'profile') {
      const grid = this.cells()
        .map(
          (cell) =>
            `<node content-desc="video ${cell.id}" class="android.widget.ImageView" clickable="true" bounds="${bounds(
              cell.box,
            )}" />`,
        )
        .join('');

      const vazio =
        this.visibleIds().length === 0
          ? '<node text="Nada por aqui" bounds="[100,900][980,960]" />'
          : '';

      return parse(`<hierarchy>
        ${nav}
        <node text="Repostagens" class="android.widget.TextView" clickable="true" bounds="${bounds(
          BOX.repostTab,
        )}" />
        <node text="Curtidos" class="android.widget.TextView" clickable="true" bounds="${bounds(
          BOX.likedTab,
        )}" />
        ${grid}${vazio}
      </hierarchy>`);
    }

    return parse(`<hierarchy>${nav}</hierarchy>`);
  }

  /** Captura em escala reduzida, com o coracao vermelho se o video esta curtido. */
  async screenshot() {
    const width = Math.round(SCREEN.width * SHOT_SCALE);
    const height = Math.round(SCREEN.height * SHOT_SCALE);
    const vermelho = this.screen === 'player' && this.liked.includes(this.current);

    const like = {
      x1: BOX.like.x1 * SHOT_SCALE,
      y1: BOX.like.y1 * SHOT_SCALE,
      x2: BOX.like.x2 * SHOT_SCALE,
      y2: BOX.like.y2 * SHOT_SCALE,
    };

    return decodePng(
      png(width, height, (x, y) => {
        const noCoracao = x >= like.x1 && x < like.x2 && y >= like.y1 && y < like.y2;
        if (noCoracao) return vermelho ? [254, 44, 85, 255] : [255, 255, 255, 255];
        return [18, 18, 20, 255];
      }),
    );
  }
}

async function parse(xml) {
  const { parseDump } = await import('../android/src/ui.js');
  return parseDump(xml);
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

/**
 * Variante em que a grade so muda no "puxar para atualizar" — como algumas
 * versoes do app se comportam. O video descurtido continua aparecendo ate o
 * refresh, entao o bot precisa passar para o proximo em vez de insistir.
 */
class LazyDevice extends FakeDevice {
  constructor(videos) {
    super(videos);
    this.visible = [...videos];
  }

  visibleIds() {
    return this.visible;
  }

  swipe(...args) {
    this.visible = [...this.liked];
    return super.swipe(...args);
  }
}

const budget = () => ({ remaining: () => Infinity, spend: () => {} });
const TOTAL = 7;
const videos = Array.from({ length: TOTAL }, (_, i) => i + 1);

for (const [nome, device] of [
  ['grade reordena na hora', new FakeDevice(videos)],
  ['grade so atualiza no refresh', new LazyDevice(videos)],
]) {
  const session = new Session(device, config, silent, patterns);

  await session.start();
  assert.equal(device.launched, true, `${nome}: o app deveria ter sido aberto`);

  const result = await session.cleanTab('likes', budget());

  assert.equal(result.removed, TOTAL, `${nome}: esperava ${TOTAL} remocoes, veio ${result.removed}`);
  assert.equal(result.failed, 0, `${nome}: nenhuma falha esperada`);
  assert.equal(device.liked.length, 0, `${nome}: o aparelho falso ainda tem curtidas`);
  assert.equal(await session.verifyEmpty('likes'), true, `${nome}: a aba deveria estar vazia`);
  assert.ok(device.backs >= TOTAL, `${nome}: deveria voltar do player apos cada video`);

  console.log(`OK (${nome}): ${result.removed}/${TOTAL} curtidas removidas e aba verificada vazia.`);
}

/** Com --limit, para no numero pedido e deixa o resto intacto. */
const limitado = new FakeDevice(videos);
const sessaoLimitada = new Session(limitado, config, silent, patterns);
let restante = 3;

await sessaoLimitada.start();
const parcial = await sessaoLimitada.cleanTab('likes', {
  remaining: () => restante,
  spend: () => (restante -= 1),
});

assert.equal(parcial.removed, 3, `--limit deveria parar em 3, parou em ${parcial.removed}`);
assert.equal(limitado.liked.length, TOTAL - 3, 'o resto das curtidas deveria continuar la');
console.log('OK (limite): parou em 3 remocoes e preservou as outras 4.');
