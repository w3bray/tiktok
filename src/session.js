import { findFirst, exists } from './selectors.js';
import { sleep, jitter } from './human.js';

const LOGIN_URL = 'https://www.tiktok.com/login/phone-or-email/email';

export async function isLoggedIn(page) {
  return exists(page, 'loggedIn');
}

/**
 * Espera o humano concluir algo na janela (captcha, 2FA, login manual).
 * Sai assim que a sessao ficar valida.
 */
export async function waitForHuman(page, logger, { minutes = 10, reason = 'verificacao' } = {}) {
  logger.warn(`Acao manual necessaria (${reason}). Resolva na janela do navegador.`);
  logger.info(`Aguardando ate ${minutes} minutos...`);

  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (await isLoggedIn(page)) {
      logger.ok('Sessao ativa.');
      return true;
    }
  }
  return false;
}

export async function ensureLogin(page, config, logger) {
  logger.step('Verificando sessao');
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(1500, 3000));

  if (await isLoggedIn(page)) {
    logger.ok('Ja logado (sessao salva em user-data/).');
    return true;
  }

  if (config.headless) {
    logger.error(
      'Sem sessao salva e rodando --headless. Rode uma vez com janela ' +
        '(npm run login) para logar e salvar os cookies.',
    );
    return false;
  }

  logger.info('Sem sessao. Abrindo a tela de login...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(1500, 3000));

  const emailTab = await findFirst(page, 'loginEmailTab', { timeout: 4000 });
  if (emailTab) {
    await emailTab.click().catch(() => {});
    await sleep(jitter(800, 1600));
  }

  if (config.password) {
    const userInput = await findFirst(page, 'loginUserInput', { timeout: 8000 });
    const passInput = await findFirst(page, 'loginPassInput', { timeout: 8000 });

    if (userInput && passInput) {
      // Digitacao com atraso: preenchimento instantaneo e um sinal de bot.
      await userInput.click();
      await userInput.type(config.login, { delay: jitter(60, 140) });
      await sleep(jitter(400, 900));
      await passInput.click();
      await passInput.type(config.password, { delay: jitter(60, 140) });
      await sleep(jitter(500, 1200));

      const submit = await findFirst(page, 'loginSubmit', { timeout: 5000 });
      if (submit) await submit.click().catch(() => {});
      logger.info('Credenciais enviadas.');
    } else {
      logger.warn('Nao encontrei os campos de login. Faca o login manualmente.');
    }
  } else {
    logger.info('Sem TIKTOK_PASSWORD no .env: digite usuario e senha na janela.');
  }

  await sleep(jitter(3000, 5000));

  if (await exists(page, 'captcha')) {
    logger.warn('Captcha detectado.');
  }

  if (await isLoggedIn(page)) {
    logger.ok('Login concluido.');
    return true;
  }

  return waitForHuman(page, logger, { minutes: 10, reason: 'captcha / 2FA / login' });
}

/** Se um captcha aparecer no meio da limpeza, para tudo e espera o humano. */
export async function handleCaptcha(page, logger) {
  if (!(await exists(page, 'captcha'))) return true;

  logger.warn('Captcha no meio da execucao. Pausando.');
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (!(await exists(page, 'captcha'))) {
      logger.ok('Captcha resolvido, continuando.');
      await sleep(jitter(2000, 4000));
      return true;
    }
  }
  logger.error('Captcha nao resolvido em 10 minutos.');
  return false;
}
