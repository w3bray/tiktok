import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv, envInt } from '../../src/env.js';
import { Logger } from '../../src/logger.js';
import { Adb } from './adb.js';
import { Session } from './flows.js';
import { center } from './ui.js';

const ANDROID_DIR = path.join(ROOT, 'android');

const HELP = `
tiktok-cleaner (Android) - remove 100% dos republicados e/ou curtidos
dirigindo o APP do TikTok no aparelho, via adb/UiAutomator.

Uso:
  node android/src/index.js [opcoes]

Alvos (escolha ao menos um):
  --all               Limpa republicados E curtidos
  --reposts           Limpa apenas os republicados
  --likes             Limpa apenas os curtidos

Opcoes:
  --dry-run           Percorre e conta, sem remover nada
  --limit <n>         Para depois de N remocoes
  --max-passes <n>    Maximo de varreduras por aba (padrao: 300)
  --slow <ms>         Atraso minimo entre acoes
  --device <serial>   Aparelho especifico (veja: adb devices)
  --adb <caminho>     Binario do adb, se nao estiver no PATH
  --inspect           Mostra os textos/ids da tela atual do app
  -h, --help          Esta ajuda
`;

function parseArgs(argv = process.argv.slice(2)) {
  loadEnv();

  const flags = new Set();
  const values = new Map();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') && arg !== '-h') continue;

    const key = arg.replace(/^--?/, '');
    if (['limit', 'max-passes', 'slow', 'device', 'adb'].includes(key)) {
      values.set(key, argv[++i]);
    } else {
      flags.add(key);
    }
  }

  if (flags.has('help') || flags.has('h')) {
    console.log(HELP);
    process.exit(0);
  }

  const delayMin = values.has('slow')
    ? Number.parseInt(values.get('slow'), 10)
    : envInt('ACTION_DELAY_MIN', 1800);

  const config = {
    reposts: flags.has('all') || flags.has('reposts'),
    likes: flags.has('all') || flags.has('likes'),
    dryRun: flags.has('dry-run'),
    inspect: flags.has('inspect'),

    serial: values.get('device') ?? process.env.ANDROID_SERIAL ?? '',
    adbBinary: values.get('adb') ?? process.env.ADB_PATH ?? 'adb',

    limit: values.has('limit') ? Number.parseInt(values.get('limit'), 10) : Infinity,
    maxPasses: values.has('max-passes') ? Number.parseInt(values.get('max-passes'), 10) : 300,

    delayMin,
    delayMax: Math.max(delayMin + 500, envInt('ACTION_DELAY_MAX', 4200)),
    cooldownEvery: envInt('COOLDOWN_EVERY', 25),
    cooldownMs: envInt('COOLDOWN_MS', 45000),

    logsDir: path.join(ROOT, 'logs'),
  };

  if (!config.reposts && !config.likes && !config.inspect) {
    console.error('ERRO: escolha o que limpar: --all, --reposts ou --likes. Use --help.');
    process.exit(1);
  }

  return config;
}

/** patterns.json + sobrescritas opcionais de patterns.local.json. */
function loadPatterns(logger) {
  const base = JSON.parse(fs.readFileSync(path.join(ANDROID_DIR, 'patterns.json'), 'utf8'));
  const localFile = path.join(ANDROID_DIR, 'patterns.local.json');

  if (!fs.existsSync(localFile)) return base;

  try {
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    logger.info(`Padroes locais aplicados: ${Object.keys(local).join(', ')}`);
    return { ...base, ...local };
  } catch (error) {
    logger.warn(`patterns.local.json invalido, ignorando (${error.message}).`);
    return base;
  }
}

async function requireDevice(adb, config, logger) {
  let devices;
  try {
    devices = await adb.devices();
  } catch (error) {
    logger.error(`Nao consegui executar o adb: ${error.message}`);
    logger.info('Instale o platform-tools ou aponte o binario com --adb /caminho/adb');
    return false;
  }

  const usable = devices.filter((device) => device.state === 'device');
  const unauthorized = devices.filter((device) => device.state === 'unauthorized');

  if (unauthorized.length) {
    logger.error('Aparelho conectado mas nao autorizado.');
    logger.info('Aceite o aviso "Permitir depuracao USB" na tela do celular e rode de novo.');
    return false;
  }

  if (usable.length === 0) {
    logger.error('Nenhum aparelho conectado.');
    logger.info('Ative Opcoes do desenvolvedor > Depuracao USB e conecte o cabo.');
    logger.info('Sem fio: adb pair <ip:porta> e depois adb connect <ip:porta>.');
    return false;
  }

  if (usable.length > 1 && !config.serial) {
    logger.error(`Mais de um aparelho: ${usable.map((d) => d.serial).join(', ')}`);
    logger.info('Escolha um com --device <serial>.');
    return false;
  }

  logger.ok(`Aparelho: ${config.serial || usable[0].serial}`);
  return true;
}

/** Despeja a tela atual para descobrir os rotulos desta versao do app. */
async function inspect(adb, logger) {
  logger.step('Inspecao da tela atual');

  const nodes = await adb.dump();
  const rows = nodes
    .filter((node) => node.desc || node.text || node.id)
    .slice(0, 120)
    .map((node) => ({
      desc: node.desc.slice(0, 34),
      text: node.text.slice(0, 26),
      id: node.id.split('/').pop()?.slice(0, 26) ?? '',
      clicavel: node.clickable ? 'sim' : '',
      centro: `${center(node).x},${center(node).y}`,
    }));

  console.table(rows);
  logger.info(`${nodes.length} views na tela. Copie os rotulos para android/patterns.local.json.`);
}

async function main() {
  const config = parseArgs();
  const logger = new Logger(config.logsDir);
  const patterns = loadPatterns(logger);
  const adb = new Adb({ binary: config.adbBinary, serial: config.serial });

  logger.info(`Modo: ${config.dryRun ? 'DRY-RUN (nao remove nada)' : 'REMOCAO REAL'}`);
  logger.info(`Log desta execucao: ${logger.file}`);

  if (!(await requireDevice(adb, config, logger))) {
    process.exitCode = 1;
    return;
  }

  if (config.inspect) {
    await inspect(adb, logger);
    return;
  }

  let left = config.limit;
  const budget = { remaining: () => left, spend: () => (left -= 1) };
  const session = new Session(adb, config, logger, patterns);
  const summary = {};

  try {
    await session.start();

    if (config.reposts) summary.reposts = await session.cleanTab('reposts', budget);
    if (config.likes) summary.likes = await session.cleanTab('likes', budget);

    if (!config.dryRun) {
      logger.step('Verificacao final');
      if (config.reposts) summary.reposts.empty = await session.verifyEmpty('reposts');
      if (config.likes) summary.likes.empty = await session.verifyEmpty('likes');
    }

    logger.step('Resultado');
    for (const [kind, result] of Object.entries(summary)) {
      const status =
        result.empty === true ? '100% limpo' : result.empty === false ? 'INCOMPLETO' : '-';
      logger.info(`${kind}: removidos=${result.removed} falhas=${result.failed} ${status}`, result);
    }
  } catch (error) {
    logger.error(`Erro inesperado: ${error.message}`, { stack: error.stack });
    process.exitCode = 1;
  }
}

main();
