/**
 * Testes offline da versao Android: decodificador PNG, leitura da arvore de
 * views e a heuristica da grade. Nao precisa de aparelho nem de internet.
 *
 *   node test/android.test.mjs
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, redFraction, shrink, isBrandRed } from '../android/src/png.js';
import { parseDump, center, matches, findByPatterns, gridCells } from '../android/src/ui.js';

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

/** Monta um PNG RGBA 8 bits de verdade, para o decodificador ter o que ler. */
function makePng(width, height, pixel) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * (stride + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

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
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc;
}

const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
    <node index="1" text="" content-desc="Perfil" resource-id="com.zhiliaoapp.musically:id/tab" class="android.widget.Button" clickable="true" bounds="[864,2250][1080,2400]" />
    <node index="2" text="Curtidos" content-desc="" class="android.widget.TextView" clickable="true" bounds="[600,500][780,560]" />
    <node index="3" content-desc="Curtir video, 1.2M curtidas" class="android.widget.ImageView" clickable="true" bounds="[960,1200][1050,1290]" />
    <node index="4" content-desc="Gato dan&#231;ando &amp; pulando" class="android.widget.ImageView" clickable="true" bounds="[0,600][360,1080]" />
    <node index="5" content-desc="Outro video" class="android.widget.ImageView" clickable="true" bounds="[360,600][720,1080]" />
    <node index="6" content-desc="Terceiro" class="android.widget.ImageView" clickable="true" bounds="[720,600][1080,1080]" />
  </node>
</hierarchy>
UI hierchary dumped to: /dev/tty`;

console.log('PNG');

check('decodifica um PNG RGBA solido', () => {
  const png = decodePng(makePng(8, 4, () => [254, 44, 85, 255]));
  assert.equal(png.width, 8);
  assert.equal(png.height, 4);
  assert.equal(png.channels, 4);
  assert.deepEqual([...png.data.subarray(0, 4)], [254, 44, 85, 255]);
});

check('rejeita arquivo que nao e PNG', () => {
  assert.throws(() => decodePng(Buffer.from('nao sou png')), /nao e um PNG/i);
});

check('reconhece o vermelho da marca e recusa cinza/branco', () => {
  assert.equal(isBrandRed(254, 44, 85), true);
  assert.equal(isBrandRed(255, 255, 255), false);
  assert.equal(isBrandRed(22, 24, 35), false);
});

check('redFraction separa coracao curtido de nao curtido', () => {
  const curtido = decodePng(makePng(20, 20, () => [254, 44, 85, 255]));
  const cinza = decodePng(makePng(20, 20, () => [255, 255, 255, 255]));
  const caixa = { x1: 0, y1: 0, x2: 20, y2: 20 };

  assert.equal(redFraction(curtido, caixa), 1);
  assert.equal(redFraction(cinza, caixa), 0);
});

check('distingue coracao curtido e nao curtido dentro do botao', () => {
  // Icone de 8x8 no centro de um "botao" 10..30, sobre fundo escuro.
  const tela = (cor) =>
    decodePng(
      makePng(40, 40, (x, y) =>
        x >= 16 && x < 24 && y >= 16 && y < 24 ? cor : [18, 18, 20, 255],
      ),
    );

  const miolo = shrink({ x1: 10, y1: 10, x2: 30, y2: 30 }, 0.55);
  const curtido = redFraction(tela([254, 44, 85, 255]), miolo);
  const naoCurtido = redFraction(tela([255, 255, 255, 255]), miolo);

  // 0.12 e o limiar usado em flows.js para decidir o estado.
  assert.ok(curtido > 0.12, `curtido deveria passar do limiar, veio ${curtido}`);
  assert.equal(naoCurtido, 0);
  assert.equal(redFraction(tela([254, 44, 85, 255]), { x1: 0, y1: 0, x2: 10, y2: 10 }), 0);
});

check('shrink mantem o centro', () => {
  const box = shrink({ x1: 0, y1: 0, x2: 100, y2: 100 }, 0.5);
  assert.deepEqual(box, { x1: 25, y1: 25, x2: 75, y2: 75 });
});

console.log('UiAutomator');

const nodes = parseDump(DUMP);

check('le todas as views com bounds', () => {
  assert.equal(nodes.length, 7);
});

check('decodifica entidades XML no content-desc', () => {
  const cell = nodes.find((node) => node.desc.startsWith('Gato'));
  assert.equal(cell.desc, 'Gato dançando & pulando');
});

check('calcula o centro da view', () => {
  const like = nodes.find((node) => node.desc.startsWith('Curtir video'));
  assert.deepEqual(center(like), { x: 1005, y: 1245 });
});

check('casa padroes em content-desc e em text', () => {
  const like = nodes.find((node) => node.desc.startsWith('Curtir video'));
  const tab = nodes.find((node) => node.text === 'Curtidos');

  assert.equal(matches(like, ['curtir', '\\blike\\b']), true);
  assert.equal(matches(tab, ['curtid']), true);
  assert.equal(matches(tab, ['repost']), false);
});

check('findByPatterns prefere a menor view que casa', () => {
  const found = findByPatterns(nodes, ['perfil'], { clickable: true });
  assert.equal(found.desc, 'Perfil');
});

check('findByPatterns devolve null quando nada casa', () => {
  assert.equal(findByPatterns(nodes, ['inexistente']), null);
});

check('gridCells acha as 3 colunas e ignora botoes', () => {
  const cells = gridCells(nodes, { width: 1080, height: 2400 });
  assert.equal(cells.length, 3);
  assert.deepEqual(
    cells.map((cell) => cell.desc),
    ['Gato dançando & pulando', 'Outro video', 'Terceiro'],
  );
});

check('gridCells nao confunde o botao de curtir com celula', () => {
  const cells = gridCells(nodes, { width: 1080, height: 2400 });
  assert.equal(
    cells.some((cell) => cell.desc.startsWith('Curtir')),
    false,
  );
});

console.log(`\nOK: ${checks} verificacoes passaram.`);
