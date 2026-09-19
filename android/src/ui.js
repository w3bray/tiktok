/**
 * Leitura da arvore de views do Android (saida do `uiautomator dump`).
 * O TikTok nao expoe resource-ids estaveis entre versoes, entao tudo aqui
 * casa por content-desc/text (com regex configuravel) e por geometria.
 */

const NODE_RE = /<node\b([^>]*?)\/?>/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;
const BOUNDS_RE = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

function unescapeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

export function parseDump(xml) {
  const end = xml.lastIndexOf('</hierarchy>');
  const body = end === -1 ? xml : xml.slice(0, end);
  const nodes = [];

  for (const match of body.matchAll(NODE_RE)) {
    const attrs = {};
    for (const attr of match[1].matchAll(ATTR_RE)) {
      attrs[attr[1]] = unescapeXml(attr[2]);
    }

    const bounds = parseBounds(attrs.bounds);
    if (!bounds) continue;

    nodes.push({
      attrs,
      bounds,
      desc: attrs['content-desc'] ?? '',
      text: attrs.text ?? '',
      id: attrs['resource-id'] ?? '',
      clickable: attrs.clickable === 'true',
    });
  }

  return nodes;
}

function parseBounds(value) {
  const match = BOUNDS_RE.exec(value ?? '');
  if (!match) return null;
  return {
    x1: Number(match[1]),
    y1: Number(match[2]),
    x2: Number(match[3]),
    y2: Number(match[4]),
  };
}

export function center(node) {
  const { x1, y1, x2, y2 } = node.bounds ?? node;
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

export function area(node) {
  const { x1, y1, x2, y2 } = node.bounds ?? node;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/**
 * Tira os acentos antes de comparar: o app mostra "Curtir vídeo" e os padroes
 * sao escritos sem acento, entao sem isso nada casaria.
 */
function semAcento(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Casa content-desc OU text contra uma lista de regex (string, sem flags). */
export function matches(node, patterns) {
  const haystack = semAcento(`${node.desc} ${node.text}`.trim());
  if (!haystack) return false;
  return patterns.some((pattern) => new RegExp(pattern, 'i').test(haystack));
}

/**
 * Menor no que casa: em listas o pai costuma repetir o texto do filho, e o
 * menor e o que realmente corresponde ao botao.
 */
export function findByPatterns(nodes, patterns, { clickable = false } = {}) {
  const hits = nodes.filter((node) => matches(node, patterns) && (!clickable || node.clickable));
  if (hits.length === 0) return null;
  return hits.sort((a, b) => area(a) - area(b))[0];
}

export function findAllByPatterns(nodes, patterns) {
  return nodes.filter((node) => matches(node, patterns));
}

/**
 * Celulas da grade do perfil. O TikTok usa 3 colunas, entao a largura de cada
 * celula fica em torno de 1/3 da tela — criterio que sobrevive a troca de
 * layout melhor do que qualquer resource-id.
 */
export function gridCells(nodes, screen) {
  const candidates = nodes.filter((node) => {
    const width = node.bounds.x2 - node.bounds.x1;
    const height = node.bounds.y2 - node.bounds.y1;
    return (
      width > screen.width * 0.27 &&
      width < screen.width * 0.38 &&
      height > width * 0.8 &&
      height < screen.height * 0.6 &&
      node.bounds.y1 > screen.height * 0.12
    );
  });

  // Container e filho podem ter a mesma caixa: mantem so uma por posicao.
  const seen = new Set();
  const cells = [];

  for (const node of candidates.sort(
    (a, b) => a.bounds.y1 - b.bounds.y1 || a.bounds.x1 - b.bounds.x1,
  )) {
    const key = `${node.bounds.x1},${node.bounds.y1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(node);
  }

  return cells;
}
