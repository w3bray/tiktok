import fs from 'node:fs';
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

/**
 * Contexto persistente: o login sobrevive entre execucoes, entao voce so
 * resolve captcha/2FA uma vez. Os cookies ficam em user-data/ (gitignored).
 */
export async function launchBrowser(config) {
  fs.mkdirSync(config.userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: config.headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    viewport: { width: 1366, height: 900 },
    locale: 'pt-BR',
    timezoneId: process.env.TZ || 'America/Sao_Paulo',
    userAgent: UA,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  // Remove o sinal mais obvio de automacao lido pelo JS da pagina.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(60000);

  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}
