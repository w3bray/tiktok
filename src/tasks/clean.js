import { findFirst, exists, SELECTORS } from '../selectors.js';
import { sleep, jitter, pause, maybeCooldown, scrollFeed } from '../human.js';
import { handleCaptcha } from '../session.js';

const KINDS = {
  reposts: { label: 'republicados', tab: 'repostTab', button: 'repostButton' },
  likes: { label: 'curtidos', tab: 'likedTab', button: 'likeButton' },
};

/** Quantos links pegamos por varredura antes de recarregar a pagina. */
const BATCH = 30;

/**
 * Botao "ativo" (curtido / repostado) e desenhado no vermelho da marca.
 * Comparar a cor computada e mais estavel que depender de nomes de classe,
 * que o TikTok gera com hash e troca a cada deploy.
 */
async function isActive(locator) {
  return locator
    .evaluate((el) => {
      const target = el.closest('button') ?? el;
      const nodes = [target, ...target.querySelectorAll('*')];
      return nodes.some((node) => {
        const style = getComputedStyle(node);
        return [style.color, style.fill, style.stroke]
          .map((value) => String(value).replace(/\s+/g, ''))
          .some((value) => value.includes('rgb(254,44,85)') || value.includes('rgba(254,44,85'));
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

/** --dry-run: percorre a aba inteira e so conta, sem clicar em nada. */
async function survey(page, config, logger, kind) {
  const { label } = KINDS[kind];
  if (!(await openProfileTab(page, config, logger, kind))) return { removed: 0, failed: 0 };

  const links = await collectVideoLinks(page, { max: Number.POSITIVE_INFINITY });
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
  const blocked = new Set();

  for (let pass = 1; pass <= config.maxPasses; pass++) {
    if (budget.remaining() <= 0) {
      logger.warn(`Limite de ${config.limit} remocoes atingido.`);
      break;
    }

    if (!(await openProfileTab(page, config, logger, kind))) break;

    const links = await collectVideoLinks(page, { max: BATCH });
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

      const result = await undoOnVideo(page, config, logger, kind, link);

      if (result === 'removed') {
        removed += 1;
        budget.spend();
        logger.ok(`${label}: ${removed} removido(s) — ${link}`);
        await maybeCooldown(config, removed, logger);
      } else if (result === 'already') {
        blocked.add(link);
        logger.info(`Ja estava desfeito: ${link}`);
      } else {
        failed += 1;
        blocked.add(link);
      }

      await pause(config);
    }
  }

  logger.info(`Resumo ${label}: ${removed} removido(s), ${failed} com falha.`);
  return { removed, failed, blocked: [...blocked] };
}

/** Confere no final se a aba realmente ficou vazia. */
export async function verifyEmpty(page, config, logger, kind) {
  const { label } = KINDS[kind];
  if (!(await openProfileTab(page, config, logger, kind))) return null;

  const links = await collectVideoLinks(page, { max: 5 });
  const empty = links.length === 0 || (await exists(page, 'emptyState'));

  if (empty) logger.ok(`Verificado: 0 ${label} restantes (100% limpo).`);
  else logger.warn(`Verificado: ainda restam ${label} na aba.`);

  return empty;
}
