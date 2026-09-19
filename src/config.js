import path from 'node:path';
import { ROOT, loadEnv, envInt } from './env.js';

const HELP = `
tiktok-cleaner - remove 100% dos republicados e/ou curtidos da SUA conta

Uso:
  node src/index.js [opcoes]

Alvos (escolha ao menos um):
  --likes             Curtidas
  --saved             Videos salvos + colecoes
  --reposts           Republicados
  --all               As quatro categorias de uma vez

  --videos-salvos     So os videos salvos (sem as colecoes)
  --collections       So as colecoes

Opcoes:
  --dry-run           Percorre tudo e mostra o que faria, sem remover nada
  --headless          Roda sem janela (nao recomendado: captcha fica invisivel)
  --limit <n>         Para depois de N remocoes (padrao: sem limite)
  --max-passes <n>    Maximo de varreduras por aba (padrao: 200)
  --slow <ms>         Sobrescreve o atraso minimo entre acoes
  --login-only        So faz login e salva a sessao, sem remover nada
  --inspect           Abre um video e lista os botoes encontrados (para
                      atualizar seletores quando o TikTok mudar o layout)
  --user <@nome>      Sobrescreve TIKTOK_USERNAME
  -h, --help          Mostra esta ajuda
`;

export function parseArgs(argv = process.argv.slice(2)) {
  loadEnv();

  const flags = new Set();
  const values = new Map();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') && arg !== '-h') continue;

    const key = arg.replace(/^--?/, '');
    if (['limit', 'max-passes', 'slow', 'user'].includes(key)) {
      values.set(key, argv[++i]);
    } else {
      flags.add(key);
    }
  }

  if (flags.has('help') || flags.has('h')) {
    console.log(HELP);
    process.exit(0);
  }

  const username = String(values.get('user') ?? process.env.TIKTOK_USERNAME ?? '')
    .trim()
    .replace(/^@/, '');

  const delayMin = values.has('slow')
    ? Number.parseInt(values.get('slow'), 10)
    : envInt('ACTION_DELAY_MIN', 1800);

  const config = {
    username,
    login: process.env.TIKTOK_LOGIN?.trim() || username,
    password: process.env.TIKTOK_PASSWORD ?? '',

    // --saved cobre as duas metades de "Favoritos": os videos e as pastas.
    reposts: flags.has('all') || flags.has('reposts'),
    saved: flags.has('all') || flags.has('saved') || flags.has('videos-salvos'),
    collections: flags.has('all') || flags.has('saved') || flags.has('collections'),
    likes: flags.has('all') || flags.has('likes'),

    dryRun: flags.has('dry-run'),
    headless: flags.has('headless'),
    loginOnly: flags.has('login-only'),
    inspect: flags.has('inspect'),

    limit: values.has('limit') ? Number.parseInt(values.get('limit'), 10) : Infinity,
    maxPasses: values.has('max-passes') ? Number.parseInt(values.get('max-passes'), 10) : 200,

    delayMin,
    delayMax: Math.max(delayMin + 500, envInt('ACTION_DELAY_MAX', 4200)),
    cooldownEvery: envInt('COOLDOWN_EVERY', 25),
    cooldownMs: envInt('COOLDOWN_MS', 45000),

    userDataDir: path.join(ROOT, 'user-data'),
    logsDir: path.join(ROOT, 'logs'),
    baseUrl: 'https://www.tiktok.com',
  };

  if (!config.username) {
    console.error('ERRO: defina TIKTOK_USERNAME no .env (ou use --user @seunome).');
    process.exit(1);
  }

  const temAlvo = config.reposts || config.saved || config.collections || config.likes;
  if (!temAlvo && !config.loginOnly && !config.inspect) {
    console.error('ERRO: escolha o que limpar: --likes, --saved, --reposts ou --all. Use --help.');
    process.exit(1);
  }

  return config;
}
