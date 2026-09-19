import { center, findByPatterns, gridCells } from './ui.js';
import { redFraction, shrink } from './png.js';
import { sleep, jitter, maybeCooldown } from '../../src/human.js';

/** Acima disso, o icone esta pintado de vermelho — ou seja, curtido/repostado. */
const RED_THRESHOLD = 0.12;

/** Celulas processadas por varredura antes de recarregar a grade. */
const BATCH = 9;

const KINDS = {
  likes: { label: 'curtidos', tab: 'likedTab' },
  reposts: { label: 'republicados', tab: 'repostTab' },
};

export class Session {
  constructor(adb, config, logger, patterns) {
    this.adb = adb;
    this.config = config;
    this.logger = logger;
    this.patterns = patterns;
    this.screen = null;
    this.pkg = '';
  }

  async pause(factor = 1) {
    await sleep(Math.round(jitter(this.config.delayMin, this.config.delayMax) * factor));
  }

  /** Abre o TikTok e descobre qual variante do app esta instalada. */
  async start() {
    this.screen = await this.adb.screenSize();
    this.logger.info(`Tela: ${this.screen.width}x${this.screen.height}`);

    const installed = await this.adb.installedPackages();
    this.pkg = this.patterns.packages.find((name) => installed.includes(name)) ?? '';

    if (!this.pkg) {
      throw new Error(
        `TikTok nao encontrado no aparelho (procurei: ${this.patterns.packages.join(', ')}).`,
      );
    }

    this.logger.info(`App: ${this.pkg}`);
    await this.adb.launch(this.pkg);
    await sleep(this.config.launchWaitMs ?? 4000);

    const current = await this.adb.currentPackage();
    if (current && current !== this.pkg) {
      this.logger.warn(`Em primeiro plano esta ${current}, nao o TikTok. Seguindo mesmo assim.`);
    }
  }

  async find(key, options) {
    return findByPatterns(await this.adb.dump(), this.patterns[key], options);
  }

  async tapNode(node) {
    const point = center(node);
    await this.adb.tap(point.x, point.y);
  }

  /** Fracao de vermelho no miolo do icone: e assim que lemos o estado. */
  async redness(bounds) {
    const shot = await this.adb.screenshot();
    // A captura pode vir em resolucao diferente da tela logica (densidade).
    const scaleX = shot.width / this.screen.width;
    const scaleY = shot.height / this.screen.height;
    const box = shrink(bounds, 0.55);

    return redFraction(shot, {
      x1: box.x1 * scaleX,
      y1: box.y1 * scaleY,
      x2: box.x2 * scaleX,
      y2: box.y2 * scaleY,
    });
  }

  async openProfile() {
    const tab = await this.find('profileTab', { clickable: false });
    if (!tab) {
      this.logger.error('Nao achei a aba "Perfil" na barra de baixo.');
      return false;
    }

    await this.tapNode(tab);
    await this.pause();
    return true;
  }

  async openTab(kind) {
    const { tab, label } = KINDS[kind];
    const node = await this.find(tab);

    if (!node) {
      this.logger.error(`Nao achei a aba de ${label} no perfil.`);
      return false;
    }

    await this.tapNode(node);
    await this.pause();
    return true;
  }

  async openProfileTab(kind) {
    if (!(await this.openProfile())) return false;
    return this.openTab(kind);
  }

  /** Puxa a grade para baixo para recarregar depois das remocoes. */
  async refreshGrid() {
    const x = Math.round(this.screen.width / 2);
    await this.adb.swipe(
      x,
      Math.round(this.screen.height * 0.35),
      x,
      Math.round(this.screen.height * 0.75),
      400,
    );
    await this.pause();
  }

  async scrollGrid() {
    const x = Math.round(this.screen.width / 2);
    await this.adb.swipe(
      x,
      Math.round(this.screen.height * 0.75),
      x,
      Math.round(this.screen.height * 0.35),
      300,
    );
    await sleep(jitter(700, 1300));
  }

  async cells() {
    return gridCells(await this.adb.dump(), this.screen);
  }

  /** Confirma que o toque abriu o player, e nao outra tela. */
  async inPlayer() {
    return Boolean(await this.find('playerMarker'));
  }

  /** Descurte o video aberto. Retorna 'removed' | 'already' | 'failed'. */
  async undoLike() {
    const like = await this.find('likeButton');
    if (!like) return 'failed';

    if ((await this.redness(like.bounds)) < RED_THRESHOLD) return 'already';

    await this.tapNode(like);
    await this.pause();

    if ((await this.redness(like.bounds)) >= RED_THRESHOLD) {
      await this.tapNode(like);
      await this.pause();
      if ((await this.redness(like.bounds)) >= RED_THRESHOLD) return 'failed';
    }

    return 'removed';
  }

  /**
   * Remove a republicacao do video aberto. Primeiro tenta o botao do painel
   * lateral; se ele nao existir nesta versao, vai pelo menu de compartilhar.
   */
  async undoRepost() {
    const button = await this.find('repostButton');

    if (button && (await this.redness(button.bounds)) >= RED_THRESHOLD) {
      await this.tapNode(button);
      await this.pause();
      return (await this.redness(button.bounds)) >= RED_THRESHOLD ? 'failed' : 'removed';
    }

    const share = await this.find('shareButton');
    if (!share) return 'failed';

    await this.tapNode(share);
    await this.pause();

    const remove = await this.find('removeRepost');
    if (!remove) {
      // Nada que diga "remover repostagem": nao mexe em nada e fecha o menu.
      await this.adb.back();
      await this.pause(0.5);
      return 'already';
    }

    await this.tapNode(remove);
    await this.pause();

    const confirm = await this.find('confirm', { clickable: true });
    if (confirm) {
      await this.tapNode(confirm);
      await this.pause();
    }

    return 'removed';
  }

  async undo(kind) {
    return kind === 'likes' ? this.undoLike() : this.undoRepost();
  }

  /** --dry-run: percorre a grade contando, sem tocar em nada. */
  async survey(kind) {
    const { label } = KINDS[kind];
    if (!(await this.openProfileTab(kind))) return { removed: 0, failed: 0 };

    const seen = new Set();
    let estimate = false;
    let idle = 0;

    for (let screenful = 0; screenful < 40 && idle < 2; screenful++) {
      const before = seen.size;

      for (const cell of await this.cells()) {
        const signature = `${cell.desc}|${cell.text}`.trim();
        if (signature === '|' || signature === '') {
          // Sem rotulo para identificar a celula: contagem vira estimativa.
          estimate = true;
          seen.add(`pos:${screenful}:${cell.bounds.x1},${cell.bounds.y1}`);
        } else {
          seen.add(signature);
        }
      }

      idle = seen.size === before ? idle + 1 : 0;
      await this.scrollGrid();
    }

    this.logger.ok(
      `[dry-run] ${seen.size}${estimate ? ' (estimado)' : ''} ${label} encontrados. ` +
        'Nada foi removido.',
    );
    return { removed: 0, failed: 0, found: seen.size, estimate };
  }

  /**
   * Limpa uma aba ate zerar. Cada varredura pega as celulas visiveis de um
   * unico dump — dentro da varredura os indices nao mudam — e so depois
   * recarrega a grade, quando os itens removidos somem de vez.
   */
  async cleanTab(kind, budget) {
    const { label } = KINDS[kind];
    this.logger.step(`Limpando ${label}`);

    if (this.config.dryRun) return this.survey(kind);

    let removed = 0;
    let failed = 0;

    for (let pass = 1; pass <= this.config.maxPasses; pass++) {
      if (budget.remaining() <= 0) {
        this.logger.warn(`Limite de ${this.config.limit} remocoes atingido.`);
        break;
      }

      if (!(await this.openProfileTab(kind))) break;

      if ((await this.cells()).length === 0) {
        this.logger.ok(`Nenhum ${label} restante. Aba zerada.`);
        break;
      }

      this.logger.info(`Varredura ${pass}`);
      let removedThisPass = 0;

      // Uma leitura de tela por item: dependendo da versao, a grade se
      // reorganiza assim que o video sai da lista, e coordenadas guardadas
      // de uma leitura anterior passariam a apontar para o vizinho.
      let index = 0;
      for (let step = 0; step < BATCH && budget.remaining() > 0; step++) {
        const cells = await this.cells();
        if (cells.length === 0 || index >= cells.length) break;

        await this.tapNode(cells[index]);
        await this.pause();

        if (!(await this.inPlayer())) {
          this.logger.warn('O toque nao abriu o video; pulando esta celula.');
          await this.adb.back();
          await this.pause(0.5);
          failed += 1;
          index += 1;
          continue;
        }

        const result = await this.undo(kind);
        await this.adb.back();
        await this.pause(0.5);

        if (result === 'removed') {
          removed += 1;
          removedThisPass += 1;
          budget.spend();
          this.logger.ok(`${label}: ${removed} removido(s)`);
          await maybeCooldown(this.config, removed, this.logger);
        } else {
          // Ja desfeito ou sem botao: o item continua na lista ate o
          // refresh, entao seguimos para o proximo da fila.
          if (result === 'failed') {
            failed += 1;
            this.logger.warn('Nao consegui desfazer este item.');
          }
          index += 1;
        }

        await this.pause();
      }

      await this.refreshGrid();

      if (removedThisPass === 0) {
        this.logger.warn(
          `Varredura sem nenhuma remocao: os ${cells.length} itens restantes nao ` +
            'respondem ao fluxo conhecido.',
        );
        this.logger.warn(
          'Se o app foi atualizado, rode "npm run android:inspect" e ajuste ' +
            'android/patterns.local.json.',
        );
        break;
      }
    }

    this.logger.info(`Resumo ${label}: ${removed} removido(s), ${failed} com falha.`);
    return { removed, failed };
  }

  async verifyEmpty(kind) {
    const { label } = KINDS[kind];
    if (!(await this.openProfileTab(kind))) return null;

    const nodes = await this.adb.dump();
    const cells = gridCells(nodes, this.screen);
    const empty = cells.length === 0 || Boolean(findByPatterns(nodes, this.patterns.emptyState));

    if (empty) this.logger.ok(`Verificado: 0 ${label} restantes (100% limpo).`);
    else this.logger.warn(`Verificado: ainda restam ${label} (${cells.length} visiveis).`);

    return empty;
  }
}
