import { parseArgs } from './config.js';
import { Logger } from './logger.js';
import { launchBrowser } from './browser.js';
import { ensureLogin } from './session.js';
import { cleanTab, verifyEmpty, KINDS, ALL_KINDS } from './tasks/clean.js';
import { inspect } from './tasks/inspect.js';

async function main() {
  const config = parseArgs();
  const logger = new Logger(config.logsDir);

  logger.info(`Conta: @${config.username}`);
  logger.info(`Modo: ${config.dryRun ? 'DRY-RUN (nao remove nada)' : 'REMOCAO REAL'}`);
  logger.info(`Log desta execucao: ${logger.file}`);

  let context;
  let page;
  try {
    ({ context, page } = await launchBrowser(config));
  } catch (error) {
    logger.error(`Nao consegui abrir o Chromium: ${error.message}`);
    logger.info('Instale o navegador com: npx playwright install chromium');
    logger.info('Ou aponte para um Chrome existente: CHROMIUM_PATH=/caminho/do/chrome');
    process.exitCode = 1;
    return;
  }

  // Orcamento compartilhado entre as abas, para --limit valer no total.
  let left = config.limit;
  const budget = { remaining: () => left, spend: () => (left -= 1) };

  const summary = {};

  try {
    if (!(await ensureLogin(page, config, logger))) {
      logger.error('Nao foi possivel autenticar. Abortando.');
      process.exitCode = 1;
      return;
    }

    if (config.loginOnly) {
      logger.ok('Sessao salva em user-data/. Nas proximas execucoes o login e automatico.');
      return;
    }

    if (config.inspect) {
      await inspect(page, config, logger);
      return;
    }

    const alvos = ALL_KINDS.filter((kind) => config[kind]);

    for (const kind of alvos) {
      summary[kind] = await cleanTab(page, config, logger, kind, budget);
    }

    if (!config.dryRun) {
      logger.step('Verificacao final');
      for (const kind of alvos) {
        summary[kind].empty = await verifyEmpty(page, config, logger, kind);
      }
    }

    logger.step('Resultado');
    for (const [kind, result] of Object.entries(summary)) {
      const status = result.unsupported
        ? 'NAO SUPORTADO NO SITE'
        : result.empty === true
          ? '100% limpo'
          : result.empty === false
            ? 'INCOMPLETO'
            : '-';
      logger.info(
        `${KINDS[kind].label}: removidos=${result.removed} falhas=${result.failed} ${status}`,
        result,
      );
    }
  } catch (error) {
    logger.error(`Erro inesperado: ${error.message}`, { stack: error.stack });
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
