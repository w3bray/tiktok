# tiktok-cleaner

Bot que entra na **sua própria** conta do TikTok e remove **100% dos vídeos
republicados e dos vídeos curtidos**, um por um, até as duas abas do perfil
ficarem vazias — com verificação final para confirmar que zerou.

Feito com [Playwright](https://playwright.dev) (Chromium real, não é API
privada): o bot faz exatamente os mesmos cliques que você faria à mão, só que
sem parar.

## Quatro versões

| Versão | Precisa de | Como funciona |
|---|---|---|
| **[Userscript](userscript/README.md)** — só o celular | Firefox + Violentmonkey | Roda dentro da página do TikTok, no navegador do celular |
| **[App Android](androidapp/README.md)** — só o celular | Instalar o APK | Serviço de Acessibilidade controlando o app nativo |
| **[ADB](android/README.md)** — celular + PC (ou Termux) | `adb` | UiAutomator tocando na tela do aparelho |
| **Navegador** (este arquivo) — PC | Node + Playwright | Chromium real no site do TikTok |

**Sem computador?** Use o [userscript](userscript/README.md) (instala em ~3
minutos, sem compilar nada) ou o [app Android](androidapp/README.md) (o APK é
compilado pelo GitHub Actions e você baixa pelo próprio celular).

O restante deste arquivo descreve a versão de navegador.

---

## ⚠️ Leia antes de usar

- **Troque a sua senha se ela já foi enviada em texto puro** em algum chat,
  e-mail ou print. Considere-a comprometida.
- **A senha nunca fica no repositório.** Ela é lida do arquivo `.env`, que está
  no `.gitignore`. Você pode até deixar `TIKTOK_PASSWORD` vazio e digitar na
  janela do navegador — é a opção mais segura.
- **Automação viola os Termos de Uso do TikTok.** Existe risco de captcha,
  bloqueio temporário de ações ou suspensão. O bot usa ritmo humano e pausas
  para reduzir isso, mas o risco é seu.
- **A remoção não tem desfazer.** Rode primeiro com `--dry-run` para ver
  quantos itens serão afetados.

---

## Instalação

Precisa de [Node.js](https://nodejs.org) 18 ou superior.

```bash
git clone <este-repositorio>
cd tiktok
npm install
npx playwright install chromium
```

Configure as credenciais:

```bash
cp .env.example .env
```

Abra o `.env` e preencha:

```ini
TIKTOK_USERNAME=gutooo777
TIKTOK_LOGIN=gutooo777        # @, e-mail ou telefone da conta
TIKTOK_PASSWORD=              # deixe vazio para digitar na janela (recomendado)
```

---

## Uso

**1. Primeiro login** (abre a janela; resolva captcha/2FA se aparecer):

```bash
npm run login
```

A sessão fica salva em `user-data/`, então nas próximas vezes o login é
automático.

**2. Simulação** (não remove nada, só conta):

```bash
npm run dry-run
```

**3. Limpeza real:**

```bash
npm run clean       # republicados + curtidos
npm run reposts     # só os republicados
npm run likes       # só os curtidos
```

### Opções

| Opção | O que faz |
|---|---|
| `--all` / `--reposts` / `--likes` | escolhe o que limpar |
| `--dry-run` | percorre tudo e só relata, sem remover |
| `--limit 50` | para depois de 50 remoções (bom para testar) |
| `--slow 4000` | aumenta o atraso entre ações (mais lento, menos captcha) |
| `--headless` | roda sem janela (só depois de já ter sessão salva) |
| `--max-passes 200` | limite de varreduras por aba |
| `--inspect` | lista os seletores atuais da página |
| `--user @outro` | sobrescreve o usuário do `.env` |

Exemplo:

```bash
node src/index.js --all --slow 5000 --limit 200
```

---

## Como funciona

1. **Login** — usa um perfil persistente do Chromium (`user-data/`), então
   cookies e sessão sobrevivem entre execuções. Se aparecer captcha ou 2FA, o
   bot **pausa e espera** você resolver na janela (até 10 minutos).
2. **Varredura** — abre `tiktok.com/@voce`, clica na aba *Repostagens* ou
   *Curtidos* e coleta os links dos vídeos visíveis (rolando a página).
3. **Remoção** — abre cada vídeo, localiza o botão de curtir/repostar, confere
   se ele está **ativo** (o TikTok pinta o ícone de vermelho `rgb(254,44,85)`)
   e clica para desfazer. Depois reconfere o estado; se o clique não pegou,
   tenta uma vez mais.
4. **Repetição** — o item removido some da aba, então o bot recarrega e pega a
   próxima leva. Isso se repete **até a aba zerar** — daí o "100%". Não é
   preciso paginar uma lista que muda embaixo do processo.
5. **Verificação final** — reabre cada aba e confirma que está vazia. O
   resumo diz `100% limpo` ou `INCOMPLETO`.

Itens que não puderam ser removidos (vídeo privado, apagado, botão
indisponível) são registrados e reportados no fim, em vez de travar o bot em
loop.

### Ritmo e limites

Configuráveis no `.env`:

```ini
ACTION_DELAY_MIN=1800   # atraso mínimo entre ações (ms)
ACTION_DELAY_MAX=4200   # atraso máximo (a espera é aleatória entre os dois)
COOLDOWN_EVERY=25       # a cada 25 remoções...
COOLDOWN_MS=45000       # ...faz uma pausa de 45s
```

Rate limit do TikTok é por janela de tempo. Se começar a aparecer captcha com
frequência, aumente os valores e rode em partes com `--limit`.

---

## Quando parar de funcionar

O TikTok troca o HTML com frequência e os nomes de classe são gerados com
hash. Por isso todos os seletores ficam centralizados em `src/selectors.js`,
cada um como uma **lista de candidatos** testados em ordem.

Se o bot avisar que não encontrou um botão:

```bash
npm run inspect
```

Isso imprime uma tabela com os `data-e2e` e `aria-label` atuais da página.
Crie `src/selectors.local.json` com apenas o que mudou — sem tocar no código:

```json
{
  "likeButton": ["[data-e2e=novo-nome]", "[data-e2e=browse-like-icon]"],
  "repostTab": ["[data-e2e=nova-aba-repost]"]
}
```

Esse arquivo também está no `.gitignore`.

---

## Estrutura

```
src/
  index.js          CLI e orquestração
  config.js         flags + .env
  env.js            leitor de .env (sem dependências)
  browser.js        Chromium persistente
  session.js        login, captcha, 2FA
  selectors.js      seletores com fallback + overrides locais
  human.js          atrasos aleatórios, cooldown, rolagem
  logger.js         console colorido + logs/*.jsonl
  tasks/clean.js    varredura e remoção (curtidos e republicados)
  tasks/inspect.js  diagnóstico de seletores

android/
  patterns.json     rótulos do app (PT/EN) + overrides locais
  src/index.js      CLI da versão Android
  src/adb.js        wrapper do adb (toque, swipe, dump, screencap)
  src/ui.js         leitura da árvore de views do UiAutomator
  src/png.js        decodificador PNG mínimo + detecção do vermelho
  src/flows.js      navegação no app e remoção
```

Cada execução grava um log completo em `logs/run-<data>.jsonl` com todos os
links processados — dá para auditar exatamente o que foi removido.

## Teste

```bash
npm test                 # tudo
npm run test:web         # versão de navegador
npm run test:android     # versão ADB
npm run test:userscript  # userscript do celular
```

Os testes do app Android (Kotlin) rodam no CI: `cd androidapp && gradle :app:testDebugUnitTest`.

Nenhum teste usa internet, aparelho ou conta real:

- **Navegador** — sobe um "TikTok" falso (rotas interceptadas pelo Playwright)
  com 5 vídeos curtidos e confere que o bot zera a aba e que a verificação
  final acusa vazio.
- **Android (ADB)** — um aparelho simulado responde `uiautomator dump` e
  `screencap` conforme um estado interno, cobrindo os dois comportamentos de
  grade do app e o `--limit`, mais os testes unitários do PNG e do parser.
- **Userscript** — uma SPA que imita o site móvel (perfil, abas, grade, vídeo,
  navegação por `pushState`) com o script injetado como uma extensão faria.
- **App Android** — testes JVM da heurística da grade e do casamento de
  rótulos, sem emulador.

---

## Solução de problemas

| Problema | O que fazer |
|---|---|
| `Executable doesn't exist` | `npx playwright install chromium` |
| Chromium instalado em outro lugar | `CHROMIUM_PATH=/caminho/do/chrome npm run clean` |
| Captcha toda hora | aumente `--slow` e `COOLDOWN_MS`; rode em lotes com `--limit` |
| "Botão não encontrado" | `npm run inspect` e atualize `selectors.local.json` |
| Login não gruda | apague `user-data/` e rode `npm run login` de novo |
| Aba "Curtidos" vazia no site | ela só aparece para você mesmo, logado |
