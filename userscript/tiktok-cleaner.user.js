// ==UserScript==
// @name         TikTok Cleaner
// @namespace    https://github.com/w3bray/tiktok
// @version      1.0.0
// @description  Remove 100% dos videos curtidos e republicados da sua propria conta, rodando so no celular
// @author       w3bray
// @match        https://www.tiktok.com/*
// @match        https://m.tiktok.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Roda dentro da propria pagina do TikTok, no navegador do celular.
 * Nao precisa de PC, de adb nem de APK: e o mesmo toque que voce daria,
 * so que sem parar.
 *
 * O estado fica no sessionStorage porque abrir um video pode recarregar a
 * pagina — o script precisa acordar do outro lado sabendo onde parou.
 */
(function () {
  'use strict';

  const STATE_KEY = 'tiktok-cleaner:state';

  const SEL = {
    likedTab: [
      '[data-e2e="like-tab"]',
      '[data-e2e="liked-tab"]',
      'p[role="tab"][aria-label*="urtid"]',
      '[role="tab"]:not([aria-label])',
    ],
    repostTab: ['[data-e2e="repost-tab"]', '[role="tab"][aria-label*="epost"]'],
    favoritesTab: [
      '[data-e2e="favorites-tab"]',
      '[data-e2e="favorite-tab"]',
      '[role="tab"][aria-label*="avorit"]',
    ],
    collectionsTab: [
      '[data-e2e="collection-tab"]',
      '[data-e2e="collections-tab"]',
      '[role="tab"][aria-label*="ole"]',
    ],
    gridLink: [
      '[data-e2e="user-post-item"] a[href*="/video/"]',
      '[data-e2e="user-liked-item"] a[href*="/video/"]',
      'a[href*="/video/"]',
    ],
    emptyState: ['[data-e2e="user-post-empty"]', '[data-e2e="empty-tips"]'],
    likeButton: [
      '[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]',
      'button[aria-label*="urtir"]',
      'button[aria-label*="ike"]',
    ],
    repostButton: [
      '[data-e2e="video-repost"]',
      '[data-e2e="browse-repost-icon"]',
      '[data-e2e="repost-icon"]',
      'button[aria-label*="epost"]',
    ],
    bookmarkButton: [
      '[data-e2e="browse-bookmark-icon"]',
      '[data-e2e="video-bookmark"]',
      '[data-e2e="bookmark-icon"]',
      'button[aria-label*="avorit"]',
      'button[aria-label*="alvar"]',
    ],
    collectionLink: ['[data-e2e="collection-item"] a', 'a[href*="/collection/"]'],
    collectionMenu: [
      '[data-e2e="collection-more"]',
      'button[aria-label*="ais opç"]',
      'button[aria-label*="ore option"]',
    ],
    collectionDelete: [
      'div[role="button"]',
      'li',
      'button',
    ],
    confirmDelete: ['button'],
  };

  /** Textos (sem acento) que identificam excluir/confirmar dentro do menu. */
  const TEXTO = {
    collectionDelete: ['excluir cole', 'apagar cole', 'delete collection', 'remover cole'],
    confirmDelete: ['excluir', 'remover', 'delete', 'confirmar', 'ok'],
  };

  const ROTULO = {
    likes: 'curtidos',
    saved: 'salvos',
    collections: 'coleções',
    reposts: 'republicados',
  };

  const BOTAO = { likes: 'likeButton', saved: 'bookmarkButton', reposts: 'repostButton' };

  // ---------------------------------------------------------------- estado

  const vazio = () => ({
    running: false,
    fila: [],
    modo: null,
    removidos: 0,
    falhas: 0,
    bloqueados: [],
    mensagem: 'Parado',
  });

  function lerEstado() {
    try {
      return { ...vazio(), ...JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}') };
    } catch {
      return vazio();
    }
  }

  function salvarEstado(estado) {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(estado));
    } catch {
      // Aba anonima com armazenamento bloqueado: segue so em memoria.
    }
    memoria = estado;
    pintar();
  }

  let memoria = lerEstado();
  const estado = () => memoria;

  function atualizar(mudancas) {
    salvarEstado({ ...estado(), ...mudancas });
  }

  // ------------------------------------------------------------ utilidades

  const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sorteio = (min, max) => Math.floor(min + Math.random() * (max - min));

  function achar(chave) {
    for (const seletor of SEL[chave]) {
      const elemento = document.querySelector(seletor);
      if (elemento) return elemento;
    }
    return null;
  }

  function acharTodos(chave) {
    for (const seletor of SEL[chave]) {
      const encontrados = document.querySelectorAll(seletor);
      if (encontrados.length) return [...encontrados];
    }
    return [];
  }

  /**
   * Icone aceso tem cor viva: vermelho em curtir/repostar, amarelo em salvar.
   * Apagado e branco ou cinza, entao "tem cor" separa os dois sem depender de
   * um RGB fixo.
   */
  function colorido(valor) {
    const achado = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(String(valor));
    if (!achado) return false;

    const [r, g, b] = [Number(achado[1]), Number(achado[2]), Number(achado[3])];
    const alfa = achado[4] === undefined ? 1 : Number(achado[4]);
    if (alfa < 0.3) return false;

    const maior = Math.max(r, g, b);
    return maior > 120 && maior - Math.min(r, g, b) > 60;
  }

  function estaAceso(elemento) {
    const alvo = elemento.closest('button') || elemento;
    for (const node of [alvo, ...alvo.querySelectorAll('*')]) {
      const estilo = getComputedStyle(node);
      if ([estilo.color, estilo.fill, estilo.stroke].some(colorido)) return true;
    }
    return false;
  }

  const semAcento = (texto) =>
    String(texto || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  /** Primeiro elemento visivel cujo texto casa com um dos rotulos. */
  function acharPorTexto(chave) {
    for (const seletor of SEL[chave]) {
      for (const elemento of document.querySelectorAll(seletor)) {
        const texto = semAcento(elemento.textContent).trim();
        if (!texto || texto.length > 60) continue;
        if (!elemento.offsetParent && elemento.offsetHeight === 0) continue;
        if (TEXTO[chave].some((alvo) => texto.includes(alvo))) return elemento;
      }
    }
    return null;
  }

  function idDoVideo(url = location.pathname) {
    const achado = /\/(?:video|photo)\/(\d+)/.exec(url);
    return achado ? achado[1] : null;
  }

  function idDaColecao(url = location.pathname) {
    const achado = /\/collection\/([\w-]+)/.exec(url);
    return achado ? achado[1] : null;
  }

  function ondeEstou() {
    if (idDoVideo()) return 'video';
    if (idDaColecao()) return 'colecao';
    if (/^\/@[^/]+\/?$/.test(location.pathname)) return 'perfil';
    return 'outro';
  }

  function tocar(elemento) {
    elemento.scrollIntoView({ block: 'center', behavior: 'instant' });
    elemento.click();
  }

  // --------------------------------------------------------------- painel

  let painel;
  let elRotulo;
  let elStatus;
  let elBotoes;

  function criarPainel() {
    painel = document.createElement('div');
    painel.id = 'tiktok-cleaner';
    painel.innerHTML = `
      <style>
        #tiktok-cleaner {
          position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
          width: 230px; padding: 12px; border-radius: 14px;
          background: #16181f; color: #f1f1f3;
          font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 8px 28px rgba(0,0,0,.45);
        }
        #tiktok-cleaner h1 { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .01em; }
        #tiktok-cleaner .status { margin: 0 0 10px; color: #a8abb4; min-height: 34px; }
        #tiktok-cleaner .status b { color: #f1f1f3; }
        #tiktok-cleaner button {
          width: 100%; margin-top: 6px; padding: 9px 10px; border: 0; border-radius: 9px;
          font: inherit; font-weight: 600; color: #fff; background: #2b2f3a; cursor: pointer;
        }
        #tiktok-cleaner button.primario { background: #fe2c55; }
        #tiktok-cleaner button.parar { background: #3a3f4c; }
        #tiktok-cleaner button:disabled { opacity: .5; }
        #tiktok-cleaner .dobrar {
          position: absolute; top: 8px; right: 10px; width: auto; margin: 0;
          padding: 2px 6px; background: none; color: #a8abb4; font-size: 15px;
        }
        #tiktok-cleaner.min .status, #tiktok-cleaner.min .acoes { display: none; }
        #tiktok-cleaner.min { width: 140px; }
      </style>
      <h1>TikTok Cleaner</h1>
      <button class="dobrar" type="button">–</button>
      <p class="status"></p>
      <div class="acoes"></div>
    `;

    document.body.appendChild(painel);
    elRotulo = painel.querySelector('h1');
    elStatus = painel.querySelector('.status');
    elBotoes = painel.querySelector('.acoes');

    painel.querySelector('.dobrar').addEventListener('click', () => painel.classList.toggle('min'));
    painel.addEventListener('click', (evento) => evento.stopPropagation());

    pintar();
  }

  function botao(texto, classe, aoTocar) {
    const elemento = document.createElement('button');
    elemento.type = 'button';
    elemento.className = classe;
    elemento.textContent = texto;
    elemento.addEventListener('click', aoTocar);
    return elemento;
  }

  function pintar() {
    if (!elStatus) return;

    const atual = estado();
    const alvo = atual.modo ? ROTULO[atual.modo] : '';

    elStatus.innerHTML = atual.running
      ? `<b>${alvo}</b><br>${atual.mensagem}<br>removidos: <b>${atual.removidos}</b>` +
        (atual.falhas ? ` · falhas: ${atual.falhas}` : '')
      : atual.mensagem;

    elBotoes.textContent = '';

    if (atual.running) {
      elBotoes.appendChild(botao('Parar', 'parar', () => parar('Parado por voce.')));
      return;
    }

    elBotoes.appendChild(
      botao('Limpar tudo', 'primario', () => comecar(['reposts', 'saved', 'collections', 'likes'])),
    );
    elBotoes.appendChild(botao('Curtidas', '', () => comecar(['likes'])));
    elBotoes.appendChild(botao('Salvos e coleções', '', () => comecar(['saved', 'collections'])));
    elBotoes.appendChild(botao('Republicados', '', () => comecar(['reposts'])));
  }

  // ------------------------------------------------------------- controle

  function comecar(fila) {
    if (!/^\/@/.test(location.pathname)) {
      atualizar({ mensagem: 'Abra o SEU perfil (toque em "Perfil") e tente de novo.' });
      return;
    }

    salvarEstado({
      ...vazio(),
      running: true,
      fila: fila.slice(1),
      modo: fila[0],
      mensagem: 'Começando...',
    });

    rodar();
  }

  function parar(mensagem) {
    const atual = estado();
    salvarEstado({
      ...vazio(),
      removidos: atual.removidos,
      falhas: atual.falhas,
      mensagem: `${mensagem} Removidos: ${atual.removidos}.`,
    });
  }

  function proximoModo() {
    const atual = estado();
    const [proximo, ...resto] = atual.fila;

    if (!proximo) {
      parar(`Fim. ${atual.falhas ? `${atual.falhas} item(ns) nao removido(s).` : '100% limpo.'}`);
      return;
    }

    atualizar({ modo: proximo, fila: resto, bloqueados: [], mensagem: 'Trocando de aba...' });
  }

  // --------------------------------------------------------------- passos

  const ABA = {
    likes: 'likedTab',
    reposts: 'repostTab',
    saved: 'favoritesTab',
    collections: 'favoritesTab',
  };

  /** Garante que a aba (e a sub-aba, no caso de coleções) está aberta. */
  function abrirAba() {
    const modo = estado().modo;
    const aba = achar(ABA[modo]);
    if (!aba) return false;

    const marcada = aba.closest('[aria-selected]') || aba;
    if (marcada.getAttribute('aria-selected') !== 'true') {
      tocar(aba);
      return false;
    }

    if (modo !== 'collections') return true;

    const sub = achar('collectionsTab');
    if (!sub) return false;

    const subMarcada = sub.closest('[aria-selected]') || sub;
    if (subMarcada.getAttribute('aria-selected') === 'true') return true;

    tocar(sub);
    return false;
  }

  async function passoNoPerfil() {
    if (!abrirAba()) {
      atualizar({ mensagem: 'Abrindo a aba...' });
      return;
    }

    const coleções = estado().modo === 'collections';
    const chave = coleções ? 'collectionLink' : 'gridLink';
    const identificar = coleções ? idDaColecao : idDoVideo;

    const bloqueados = new Set(estado().bloqueados);
    const todos = acharTodos(chave);
    const links = todos.filter((link) => {
      const id = identificar(link.getAttribute('href') || '');
      return id && !bloqueados.has(id);
    });

    if (links.length === 0) {
      if (todos.length > 0) {
        atualizar({
          mensagem: `${bloqueados.size} item(ns) nao puderam ser removidos.`,
          falhas: estado().falhas,
        });
      }

      proximoModo();
      return;
    }

    atualizar({ mensagem: `Abrindo ${coleções ? 'coleção' : 'vídeo'} (${links.length} na fila)...` });
    tocar(links[0]);
  }

  /** Exclui a coleção aberta: menu de opções, "excluir coleção", confirmar. */
  async function passoNaColecao() {
    const id = idDaColecao();

    let excluir = acharPorTexto('collectionDelete');

    if (!excluir) {
      const menu = achar('collectionMenu');
      if (!menu) {
        bloquear(id, true, 'Esta página não oferece excluir coleção. Use o app.');
        voltar();
        return;
      }

      tocar(menu);
      await dormir(sorteio(900, 1500));
      excluir = acharPorTexto('collectionDelete');
    }

    if (!excluir) {
      bloquear(id, true, 'Não achei "excluir coleção" no menu.');
      voltar();
      return;
    }

    atualizar({ mensagem: 'Excluindo coleção...' });
    tocar(excluir);
    await dormir(sorteio(900, 1500));

    const confirmar = acharPorTexto('confirmDelete');
    if (confirmar) {
      tocar(confirmar);
      await dormir(sorteio(1000, 1800));
    }

    atualizar({ removidos: estado().removidos + 1, mensagem: 'Coleção excluída.' });

    // A exclusão costuma devolver ao perfil sozinha.
    if (ondeEstou() === 'colecao') voltar();
  }

  async function passoNoVideo() {
    const id = idDoVideo();
    const botaoAcao = achar(BOTAO[estado().modo]);

    if (!botaoAcao) {
      bloquear(id, true, 'Botao nao encontrado neste video.');
      voltar();
      return;
    }

    if (!estaAceso(botaoAcao)) {
      bloquear(id, false, 'Ja estava desfeito.');
      voltar();
      return;
    }

    atualizar({ mensagem: 'Removendo...' });
    tocar(botaoAcao);
    await dormir(sorteio(900, 1600));

    if (estaAceso(botaoAcao)) {
      tocar(botaoAcao);
      await dormir(sorteio(900, 1600));
    }

    if (estaAceso(botaoAcao)) {
      bloquear(id, true, 'O toque nao pegou.');
    } else {
      atualizar({ removidos: estado().removidos + 1, mensagem: 'Removido.' });
    }

    voltar();
  }

  function bloquear(id, contarFalha, mensagem) {
    const atual = estado();
    atualizar({
      bloqueados: id ? [...new Set([...atual.bloqueados, id])] : atual.bloqueados,
      falhas: contarFalha ? atual.falhas + 1 : atual.falhas,
      mensagem,
    });
  }

  function voltar() {
    if (history.length > 1) history.back();
    else location.href = location.pathname.replace(/\/(video|photo|collection)\/[\w-]+.*$/, '');
  }

  // ----------------------------------------------------------------- laco

  let rodando = false;

  async function rodar() {
    if (rodando) return;
    rodando = true;

    try {
      while (estado().running) {
        const onde = ondeEstou();

        try {
          if (onde === 'video') await passoNoVideo();
          else if (onde === 'colecao') await passoNaColecao();
          else if (onde === 'perfil') await passoNoPerfil();
          else atualizar({ mensagem: 'Volte para o seu perfil.' });
        } catch (erro) {
          atualizar({ mensagem: `Erro: ${erro.message}` });
        }

        await dormir(sorteio(1100, 2400));
      }
    } finally {
      rodando = false;
    }
  }

  // ---------------------------------------------------------------- inicio

  function iniciar() {
    if (document.getElementById('tiktok-cleaner')) return;
    criarPainel();
    // Recarregou no meio da limpeza? Continua de onde parou.
    if (estado().running) rodar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
