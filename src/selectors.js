import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

/**
 * O TikTok muda o HTML com frequencia. Cada campo aqui e uma LISTA de
 * candidatos, tentados na ordem. Para corrigir sem mexer no codigo, crie
 * src/selectors.local.json com as chaves que quiser sobrescrever:
 *
 *   { "likeButton": ["button.minha-classe-nova", "[data-e2e=browse-like-icon]"] }
 *
 * Use `npm run inspect` para descobrir os seletores atuais.
 */
const DEFAULTS = {
  // Login
  loginUseAccount: [
    '[data-e2e="channel-item"]:has-text("telefone")',
    '[data-e2e="channel-item"]:has-text("phone")',
    'div:has-text("Usar telefone / e-mail / nome de usuário")',
    'div:has-text("Use phone / email / username")',
  ],
  loginEmailTab: [
    'a:has-text("Fazer login com e-mail ou nome de usuário")',
    'a:has-text("Log in with email or username")',
  ],
  loginUserInput: ['input[name="username"]', 'input[placeholder*="mail"]', 'input[type="text"]'],
  loginPassInput: ['input[type="password"]'],
  loginSubmit: ['button[data-e2e="login-button"]', 'button[type="submit"]'],

  // Sinais de sessao ativa
  loggedIn: [
    '[data-e2e="profile-icon"]',
    '[data-e2e="nav-profile"]',
    'a[href*="/profile"]',
    '[data-e2e="upload-icon"]',
  ],

  // Abas do perfil
  repostTab: [
    '[data-e2e="repost-tab"]',
    'p[role="tab"]:has-text("Repostagens")',
    'p[role="tab"]:has-text("Reposts")',
  ],
  likedTab: [
    '[data-e2e="like-tab"]',
    'p[role="tab"]:has-text("Curtidos")',
    'p[role="tab"]:has-text("Liked")',
  ],

  // Grade de videos
  gridItem: ['[data-e2e="user-post-item"]', '[data-e2e="user-liked-item"]', 'div[class*="DivItemContainer"]'],
  gridLink: ['a[href*="/video/"]', 'a[href*="/photo/"]'],
  emptyState: [
    '[data-e2e="user-post-empty"]',
    '[data-e2e="empty-tips"]',
    'p:has-text("Nada por aqui")',
    'p:has-text("No content")',
  ],

  // Pagina do video
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
    'button[aria-label*="ompartilhamento"]',
  ],
  shareButton: ['[data-e2e="browse-share"]', '[data-e2e="share-icon"]', 'button[aria-label*="ompartilhar"]'],
  shareMenuRepost: [
    'div[role="button"]:has-text("Repostar")',
    'div[role="button"]:has-text("Repost")',
    'li:has-text("Repostar")',
    'li:has-text("Repost")',
  ],

  // Captcha / verificacoes
  captcha: [
    '#captcha-verify-container',
    '.captcha_verify_container',
    'div[class*="captcha"]',
    'iframe[src*="captcha"]',
  ],
};

function loadOverrides() {
  const file = path.join(ROOT, 'src', 'selectors.local.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`Aviso: selectors.local.json invalido, ignorando (${error.message}).`);
    return {};
  }
}

export const SELECTORS = { ...DEFAULTS, ...loadOverrides() };

/** Primeiro candidato que existir e estiver visivel, ou null. */
export async function findFirst(scope, key, { timeout = 8000 } = {}) {
  const candidates = SELECTORS[key];
  if (!candidates) throw new Error(`Seletor desconhecido: ${key}`);

  const perCandidate = Math.max(400, Math.floor(timeout / candidates.length));

  for (const candidate of candidates) {
    const locator = scope.locator(candidate).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: perCandidate });
      return locator;
    } catch {
      // tenta o proximo candidato
    }
  }
  return null;
}

/** true se qualquer candidato estiver presente no DOM (sem esperar). */
export async function exists(scope, key) {
  for (const candidate of SELECTORS[key] ?? []) {
    if ((await scope.locator(candidate).count()) > 0) return true;
  }
  return false;
}
