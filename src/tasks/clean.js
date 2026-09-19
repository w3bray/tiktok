import { findFirst, exists, SELECTORS } from '../selectors.js';
import { sleep, jitter, pause, maybeCooldown, scrollFeed } from '../human.js';
import { handleCaptcha } from '../session.js';

export const KINDS = {
  reposts: { label: 'republicados', tab: 'repostTab', button: 'repostButton' },
  saved: { label: 'salvos', tab: 'favoritesTab', button: 'bookmarkButton' },
  collections: { label: 'coleções', tab: 'favoritesTab', button: null },
  likes: { label: 'curtidos', tab: 'likedTab', button: 'likeButton' },
};

/** Ordem de --all: as quatro categorias, uma de cada vez. */
export const ALL_KINDS = ['reposts', 'saved', 'collections', 'likes'];

/** Quantos links pegamos por varredura antes de recarregar a pagina. */
const BATCH = 30;

/**
 * Botao aceso: o TikTok pinta o icone ativo com uma cor viva — vermelho para
 * curtir/repostar, amarelo para salvar. Cinza e branco sao os estados
 * apagados, entao "tem cor" separa os dois melhor do que fixar um RGB, e
 * nao depende de nomes de classe, que o TikTok gera com hash.
 */
async function isActive(locator) {
  return locator
    .evaluate((el) => {
      const colorido = (valor) => {
        const achado = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(String(valor));
        if (!achado) return false;

        const [r, g, b] = [Number(achado[1]), Number(achado[2]), Number(achado[3])];
        const alfa = achado[4] === undefined ? 1 : Number(achado[4]);
        if (alfa < 0.3) return false;

        const maior = Math.max(r, g, b);
        const menor = Math.min(r, g, b);
        return maior > 120 && maior - menor > 60;
      };

      const target = el.closest('button') ?? el;
      const nodes = [target, ...target.querySelectorAll('*')];
      return nodes.some((node) => {
        const style = getComputedStyle(node);
        return [style.color, style.fill, style.stroke].some(colorido);
      });
    })
    .catch(() => null);
}

async function openProfileTab(page, config, logger, kind) {
  const { tab, label } = KINDS[kind];
  const url = `${config.baseUrl}/@${config.username}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(2000, 3500));
  if (!(await handleCaptcha(page, logger))) return false;

  const tabLocator = await findFirst(page, tab, { timeout: 12000 });
  if (!tabLocator) {
    logger.error(`Nao encontrei a aba de ${label} no perfil @${config.username}.`);
    return false;
  }

  await tabLocator.click();
  await sleep(jitter(2500, 4000));

  // Coleções são uma sub-aba dentro de Favoritos.
  if (kind === 'collections') {
    const sub = await findFirst(page, 'collectionsTab', { timeout: 8000 });
    if (!sub) {
      logger.warn('Não encontrei a sub-aba "Coleções" dentro de Favoritos.');
      return false;
    }
    await sub.click();
    await sleep(jitter(2000, 3200));
  }

  return true;
}

/** Rola a aba atual coletando URLs de video ate `max` (ou ate o fim). */
async function collectVideoLinks(page, { max = BATCH } = {}) {
  const found = new Set();
  let idleRounds = 0;

  while (found.size < max && idleRounds < 3) {
    const before = found.size;

    for (const selector of SELECTORS.gridItem) {
      const links = await page
        .locator(`${selector} a[href*="/video/"], ${selector} a[href*="/photo/"]`)
        .evaluateAll((nodes) => nodes.map((node) => node.href))
        .catch(() => []);
      for (const href of links) found.add(href);
      if (links.length) break;
    }

    if (found.size >= max) break;

    idleRounds = found.size === before ? idleRounds + 1 : 0;
    await scrollFeed(page, 2);
  }

  return [...found].slice(0, max);
}

/**
 * Abre o video e desfaz a acao (descurtir / remover republicacao).
 * Retorna 'removed' | 'already' | 'failed'.
 */
async function undoOnVideo(page, config, logger, kind, url) {
  const { button, label } = KINDS[kind];

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(1800, 3200));
  if (!(await handleCaptcha(page, logger))) return 'failed';

  let control = await findFirst(page, button, { timeout: 10000 });

  // Em alguns layouts o "Repostar" so existe dentro do menu de compartilhar.
  if (!control && kind === 'reposts') {
    const share = await findFirst(page, 'shareButton', { timeout: 4000 });
    if (share) {
      await share.click().catch(() => {});
      await sleep(jitter(900, 1600));
      control = await findFirst(page, 'shareMenuRepost', { timeout: 5000 });
    }
  }

  if (!control) {
    logger.warn(`Botao de ${label} nao encontrado em ${url}`);
    return 'failed';
  }

  const before = await isActive(control);
  if (before === false) return 'already';

  await control.click({ timeout: 10000 }).catch(() => {});
  await sleep(jitter(1200, 2200));

  const after = await isActive(control);

  // Clique invertido (o estado inicial foi lido errado): desfaz.
  if (after === true) {
    await control.click({ timeout: 10000 }).catch(() => {});
    await sleep(jitter(1200, 2200));
    if ((await isActive(control)) === true) {
      logger.warn(`Nao consegui remover: ${url}`);
      return 'failed';
    }
  }

  return 'removed';
}

/** Links das coleções (pastas) visíveis na sub-aba Coleções. */
async function collectCollectionLinks(page, { max = BATCH } = {}) {
  const found = new Set();
  let idleRounds = 0;

  while (found.size < max && idleRounds < 3) {
    const before = found.size;

    for (const selector of SELECTORS.collectionLink) {
      const links = await page
        .locator(selector)
        .evaluateAll((nodes) => nodes.map((node) => node.href))
        .catch(() => []);
      for (const href of links) found.add(href);
      if (links.length) break;
    }

    if (found.size >= max) break;
    idleRounds = found.size === before ? idleRounds + 1 : 0;
    await scrollFeed(page, 2);
  }

  return [...found].slice(0, max);
}

/**
 * Exclui uma coleção: abre a pasta, procura o menu e o item de excluir, e
 * confirma. O site nem sempre oferece isso — quando não oferece, devolve
 * 'unsupported' em vez de ficar tentando.
 */
async function deleteCollection(page, config, logger, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(1800, 3200));
  if (!(await handleCaptcha(page, logger))) return 'failed';

  let remove = await findFirst(page, 'collectionDelete', { timeout: 4000 });

  if (!remove) {
    const menu = await findFirst(page, 'collectionMenu', { timeout: 5000 });
    if (!menu) return 'unsupported';

    await menu.click().catch(() => {});
    await sleep(jitter(900, 1600));
    remove = await findFirst(page, 'collectionDelete', { timeout: 5000 });
  }

  if (!remove) return 'unsupported';

  await remove.click().catch(() => {});
  await sleep(jitter(900, 1600));

  const confirm = await findFirst(page, 'confirmDelete', { timeout: 5000 });
  if (confirm) {
    await confirm.click().catch(() => {});
    await sleep(jitter(1200, 2000));
  }

  return 'removed';
}

/** --dry-run: percorre a aba inteira e so conta, sem clicar em nada. */
async function survey(page, config, logger, kind) {
  const { label } = KINDS[kind];
  if (!(await openProfileTab(page, config, logger, kind))) return { removed: 0, failed: 0 };

  const links =
    kind === 'collections'
      ? await collectCollectionLinks(page, { max: Number.POSITIVE_INFINITY })
      : await collectVideoLinks(page, { max: Number.POSITIVE_INFINITY });
  logger.ok(`[dry-run] ${links.length} ${label} encontrados (nada foi removido).`);
  for (const link of links.slice(0, 10)) logger.info(`  ${link}`);
  if (links.length > 10) logger.info(`  ... e mais ${links.length - 10}`);

  return { removed: 0, failed: 0, found: links.length };
}

/**
 * Limpa uma aba ate zerar. A cada varredura a pagina e recarregada: o item
 * removido some da lista, entao o topo se renova sozinho e nao precisamos
 * paginar uma lista que muda embaixo de nos.
 */
export async function cleanTab(page, config, logger, kind, budget) {
  const { label } = KINDS[kind];
  logger.step(`Limpando ${label} de @${config.username}`);

  if (config.dryRun) return survey(page, config, logger, kind);

  let removed = 0;
  let failed = 0;
  let unsupported = false;
  const blocked = new Set();

  for (let pass = 1; pass <= config.maxPasses; pass++) {
    if (budget.remaining() <= 0) {
      logger.warn(`Limite de ${config.limit} remocoes atingido.`);
      break;
    }

    if (!(await openProfileTab(page, config, logger, kind))) break;

    const links =
      kind === 'collections'
        ? await collectCollectionLinks(page, { max: BATCH })
        : await collectVideoLinks(page, { max: BATCH });
    const pending = links.filter((link) => !blocked.has(link));

    if (links.length === 0) {
      logger.ok(`Nenhum ${label} restante. Aba zerada.`);
      break;
    }

    if (pending.length === 0) {
      logger.warn(
        `Restaram ${links.length} itens que nao consegui remover ` +
          `(video privado, removido ou botao indisponivel).`,
      );
      if (removed === 0) {
        logger.warn(
          'Nenhuma remocao nesta execucao: o layout do TikTok provavelmente mudou. ' +
            'Rode "npm run inspect" e atualize src/selectors.local.json.',
        );
      }
      break;
    }

    logger.info(`Varredura ${pass}: processando ${pending.length} de ${links.length} visiveis.`);

    for (const link of pending) {
      if (budget.remaining() <= 0) break;

      const result =
        kind === 'collections'
          ? await deleteCollection(page, config, logger, link)
          : await undoOnVideo(page, config, logger, kind, link);

      if (result === 'removed') {
        removed += 1;
        budget.spend();
        logger.ok(`${label}: ${removed} removido(s) — ${link}`);
        await maybeCooldown(config, removed, logger);
      } else if (result === 'already') {
        blocked.add(link);
        logger.info(`Ja estava desfeito: ${link}`);
      } else if (result === 'unsupported') {
        // O site nao expoe excluir colecao: parar aqui evita ficar em laco.
        logger.warn(
          'O site não oferece excluir coleções nesta conta. ' +
            'Use a versão Android (app ou adb), onde o menu existe.',
        );
        blocked.add(link);
        unsupported = true;
        break;
      } else {
        failed += 1;
        blocked.add(link);
      }

      await pause(config);
    }

    if (unsupported) break;
  }

  logger.info(`Resumo ${label}: ${removed} removido(s), ${failed} com falha.`);
  return { removed, failed, unsupported, blocked: [...blocked] };
}

/** Confere no final se a aba realmente ficou vazia. */
export async function verifyEmpty(page, config, logger, kind) {
  const { label } = KINDS[kind];
  if (!(await openProfileTab(page, config, logger, kind))) return null;

  const links =
    kind === 'collections'
      ? await collectCollectionLinks(page, { max: 5 })
      : await collectVideoLinks(page, { max: 5 });
  const empty = links.length === 0 || (await exists(page, 'emptyState'));

  if (empty) logger.ok(`Verificado: 0 ${label} restantes (100% limpo).`);
  else logger.warn(`Verificado: ainda restam ${label} na aba.`);

  return empty;
}
