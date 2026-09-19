# tiktok-cleaner — versão Android

Remove **100% dos vídeos republicados e curtidos** controlando o **app do
TikTok direto no celular**, via `adb` + UiAutomator: o bot lê a tela, encontra
os botões e toca neles, exatamente como você faria com o dedo — só que sem
parar.

Não instala nada no celular, não faz root e não mexe em APK. É o mesmo ADB que
o Android Studio usa.

> A versão de navegador (raiz do repositório) usa Playwright, que **não roda em
> Android**. Por isso esta versão existe.

---

## Duas formas de rodar

### A) Do computador, com o celular no cabo (mais simples)

1. No celular: **Configurações → Sobre o telefone → toque 7× em "Número da
   compilação"** para liberar as Opções do desenvolvedor.
2. **Opções do desenvolvedor → Depuração USB: ligada.**
3. Conecte o cabo e aceite o aviso *"Permitir depuração USB?"* na tela do
   celular.
4. No computador, instale o `adb` ([platform-tools](https://developer.android.com/tools/releases/platform-tools))
   e confira:

```bash
adb devices      # deve listar seu aparelho como "device"
```

5. Rode o bot:

```bash
npm run android:dry-run    # só conta, não remove
npm run android            # remove republicados + curtidos
```

### B) No próprio celular, sem computador (Termux)

Android 11+ tem **depuração sem fio**, e o próprio aparelho pode se conectar a
si mesmo.

```bash
pkg install nodejs android-tools git
git clone <este-repositorio> && cd tiktok
```

No celular: **Opções do desenvolvedor → Depuração sem fio → Parear dispositivo
com código**. Com os dados da tela:

```bash
adb pair localhost:<porta-de-pareamento>     # digite o código de 6 dígitos
adb connect localhost:<porta-da-depuracao>   # a porta muda, veja na tela
adb devices                                   # confirme "device"

node android/src/index.js --all
```

Mantenha o Termux rodando em segundo plano (`termux-wake-lock` ajuda) e não
mexa no celular enquanto o bot trabalha — ele controla a tela.

---

## Comandos

```bash
npm run android              # republicados + curtidos
npm run android:likes        # só curtidos
npm run android:reposts      # só republicados
npm run android:dry-run      # conta sem remover
npm run android:inspect      # mostra os rótulos da tela atual
```

| Opção | O que faz |
|---|---|
| `--all` / `--likes` / `--reposts` | escolhe o que limpar |
| `--dry-run` | percorre e conta, sem tocar em nada |
| `--limit 50` | para depois de 50 remoções |
| `--slow 4000` | mais devagar (menos chance de captcha/limite) |
| `--device <serial>` | escolhe o aparelho quando há mais de um |
| `--adb <caminho>` | binário do `adb` fora do PATH |
| `--max-passes <n>` | limite de varreduras por aba |
| `--inspect` | diagnóstico de rótulos da tela |

Os tempos entre ações saem do mesmo `.env` da versão de navegador
(`ACTION_DELAY_MIN`, `ACTION_DELAY_MAX`, `COOLDOWN_EVERY`, `COOLDOWN_MS`).
Aqui **não há login**: o bot usa a conta que já está logada no app.

---

## Como funciona

1. **Abre o app** — detecta qual pacote do TikTok está instalado
   (`com.zhiliaoapp.musically`, `trill` ou `aweme`) e o inicia.
2. **Vai ao perfil** e abre a aba *Curtidos* ou *Repostagens*, localizadas pelo
   texto/descrição da view.
3. **Acha as células da grade** pela geometria: a grade do TikTok tem 3
   colunas, então cada célula mede ~⅓ da largura da tela. Isso sobrevive a
   mudanças de layout muito melhor do que qualquer `resource-id`.
4. **Abre o vídeo e desfaz** — tira um `screencap`, mede a **fração de pixels
   vermelhos** (`#FE2C55`) no miolo do ícone e só toca se ele estiver aceso.
   Depois reconfere; se o toque não pegou, tenta mais uma vez.
   Para republicações, usa o botão do painel lateral ou, se não existir nessa
   versão, o menu *Compartilhar → Remover repostagem*.
5. **Volta, recarrega e repete** até a aba zerar — daí o "100%".
6. **Verificação final** reabre cada aba e reporta `100% limpo` ou
   `INCOMPLETO`.

A tela é relida **a cada item**, porque dependendo da versão a grade se
reorganiza assim que o vídeo sai da lista: coordenadas guardadas de uma leitura
anterior apontariam para o vizinho. Quando a lista só atualiza no refresh, o
bot percebe que o item já está desfeito e passa para o próximo.

---

## Quando o app mudar

O TikTok renomeia botões entre versões e idiomas. Todos os rótulos estão em
`android/patterns.json`, como listas de regex casadas contra o `content-desc` e
o `text` de cada view.

Com a tela problemática aberta no celular:

```bash
npm run android:inspect
```

Isso imprime uma tabela com descrição, texto, id e coordenadas de cada view.
Crie `android/patterns.local.json` só com o que mudou (o arquivo está no
`.gitignore`):

```json
{
  "likedTab": ["favoritos", "curtid"],
  "removeRepost": ["tirar repostagem"]
}
```

---

## Testes

```bash
npm run test:android
```

Três arquivos, todos **sem aparelho e sem internet**:

- `test/android.test.mjs` — decodificador PNG, detecção do vermelho da marca,
  parsing do dump do UiAutomator e a heurística da grade (14 verificações).
- `test/android-adb.test.mjs` — wrapper do `adb` contra um binário falso:
  parsing das saídas reais e ordem dos argumentos (7 verificações).
- `test/android-flow.test.mjs` — um **aparelho simulado** que responde
  `uiautomator dump` e `screencap` conforme um estado interno. Cobre os dois
  comportamentos reais de grade (reordena na hora / só no refresh) e o
  `--limit`.

---

## Problemas comuns

| Problema | O que fazer |
|---|---|
| `Nenhum aparelho conectado` | `adb devices`; ligue a Depuração USB e troque o cabo/porta |
| `nao autorizado` | aceite o aviso RSA na tela do celular e rode de novo |
| `TikTok nao encontrado` | app de outra região: adicione o pacote em `patterns.local.json` |
| `Nao achei a aba "Perfil"` | deixe o app na tela inicial, em português ou inglês, e rode `--inspect` |
| Tela apaga no meio | ative *Permanecer ativo* nas Opções do desenvolvedor |
| Nada é removido | o app mudou os rótulos: `--inspect` + `patterns.local.json` |

---

## Avisos

- Automação viola os Termos de Uso do TikTok; existe risco de captcha ou
  bloqueio temporário de ações. Os atrasos e o cooldown reduzem, não eliminam.
- A remoção **não tem desfazer**. Rode `--dry-run` antes.
- Enquanto roda, o bot controla a tela do aparelho — não use o celular ao mesmo
  tempo.
