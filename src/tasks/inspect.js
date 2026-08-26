import { sleep, jitter } from '../human.js';

/**
 * Despeja os botoes e data-e2e da pagina atual. Quando o TikTok muda o
 * layout e os seletores param de funcionar, rode isto e copie os valores
 * novos para src/selectors.local.json.
 */
export async function inspect(page, config, logger) {
  const url = `${config.baseUrl}/@${config.username}`;
  logger.step('Modo inspecao');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(2500, 4000));

  const tabs = await page
    .locator('[role="tab"], [data-e2e*="tab"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        e2e: node.getAttribute('data-e2e'),
        text: node.textContent?.trim().slice(0, 40),
      })),
    )
    .catch(() => []);
  logger.info('Abas do perfil:');
  console.table(tabs);

  const firstVideo = await page
    .locator('a[href*="/video/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);

  if (!firstVideo) {
    logger.warn('Nenhum video encontrado no perfil para inspecionar.');
    return;
  }

  await page.goto(firstVideo, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(2500, 4000));

  const controls = await page
    .locator('button, [role="button"], [data-e2e]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          tag: node.tagName.toLowerCase(),
          e2e: node.getAttribute('data-e2e'),
          aria: node.getAttribute('aria-label'),
          text: node.textContent?.trim().slice(0, 30),
        }))
        .filter((item) => item.e2e || item.aria)
        .slice(0, 80),
    )
    .catch(() => []);

  logger.info(`Controles em ${firstVideo}:`);
  console.table(controls);
  logger.info('Copie os data-e2e relevantes para src/selectors.local.json.');
}
