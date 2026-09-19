import zlib from 'node:zlib';

/**
 * Decodificador PNG minimo, so o suficiente para o que o `adb screencap -p`
 * produz: 8 bits por canal, RGB ou RGBA, sem entrelacamento. Existe para
 * evitar dependencia nativa (sharp/jimp) num projeto que roda tambem dentro
 * do Termux, onde compilar binario e sofrimento.
 */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Arquivo nao e um PNG valido.');
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks = [];

  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    pos += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`PNG nao suportado (bits=${bitDepth} cor=${colorType} entrelacado=${interlace}).`);
  }

  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++];
    const line = raw.subarray(read, read + stride);
    read += stride;

    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let value = line[i];

      switch (filter) {
        case 0:
          break;
        case 1:
          value += a;
          break;
        case 2:
          value += b;
          break;
        case 3:
          value += (a + b) >> 1;
          break;
        case 4:
          value += paeth(a, b, c);
          break;
        default:
          throw new Error(`Filtro PNG desconhecido: ${filter}`);
      }

      cur[i] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Vermelho da marca do TikTok (#FE2C55) e vizinhanca. */
export function isBrandRed(r, g, b) {
  return r > 120 && r > g * 1.5 && r > b * 1.25;
}

/** Amarelo do icone de salvar (#FFC107 e parentes). */
export function isBrandYellow(r, g, b) {
  return r > 150 && g > 100 && b < 120 && r > b * 1.6 && g > b * 1.4;
}

/** Qualquer cor de icone aceso: curtir/repostar (vermelho) ou salvar (amarelo). */
export function isAccent(r, g, b) {
  return isBrandRed(r, g, b) || isBrandYellow(r, g, b);
}

/**
 * Fracao de pixels vermelhos num retangulo. Fracao e mais confiavel que a
 * media: o coracao e um icone pequeno sobre fundo escuro, entao a media
 * dilui o vermelho ate sumir.
 */
export function redFraction(png, rect, predicate = isBrandRed) {
  const x1 = Math.max(0, Math.floor(rect.x1));
  const y1 = Math.max(0, Math.floor(rect.y1));
  const x2 = Math.min(png.width, Math.ceil(rect.x2));
  const y2 = Math.min(png.height, Math.ceil(rect.y2));

  let red = 0;
  let total = 0;

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const offset = (y * png.width + x) * png.channels;
      total += 1;
      if (predicate(png.data[offset], png.data[offset + 1], png.data[offset + 2])) red += 1;
    }
  }

  return total === 0 ? 0 : red / total;
}

/** Caixa central com `ratio` do tamanho original (evita bordas e sombras). */
export function shrink(bounds, ratio = 0.55) {
  const cx = (bounds.x1 + bounds.x2) / 2;
  const cy = (bounds.y1 + bounds.y2) / 2;
  const halfW = ((bounds.x2 - bounds.x1) * ratio) / 2;
  const halfH = ((bounds.y2 - bounds.y1) * ratio) / 2;
  return { x1: cx - halfW, y1: cy - halfH, x2: cx + halfW, y2: cy + halfH };
}
