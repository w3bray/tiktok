/** Pausas com variacao aleatoria, para nao parecer um robo de metronomo. */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(min, max) {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

export async function pause(config) {
  await sleep(jitter(config.delayMin, config.delayMax));
}

/**
 * Pausa longa a cada N acoes. Limites de taxa do TikTok sao por janela de
 * tempo: acumular respiro aqui e o que evita o captcha no meio da limpeza.
 */
export async function maybeCooldown(config, count, logger) {
  if (!config.cooldownEvery || count === 0 || count % config.cooldownEvery !== 0) return;
  logger.info(`Pausa de ${Math.round(config.cooldownMs / 1000)}s apos ${count} remocoes...`);
  await sleep(config.cooldownMs);
}

/** Rolagem gradual, do jeito que um humano faria. */
export async function scrollFeed(page, steps = 3) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, jitter(600, 1200));
    await sleep(jitter(400, 900));
  }
}
