# TikTok Cleaner — app Android (só o celular)

App que controla o **app nativo do TikTok** pelo **Serviço de Acessibilidade**
do Android: lê a tela, encontra os botões e toca neles até as abas zerarem.
Quatro opções: **Curtidas**, **Salvos e coleções**, **Republicados** e
**Limpar tudo**.

Sem PC, sem cabo, sem ADB e sem root. Só o celular.

---

## Como instalar sem ter computador

O APK é compilado pelo **GitHub Actions** a cada mudança no app e publicado
como Release. Baixe direto pelo celular:

**https://github.com/w3bray/tiktok/releases/latest/download/tiktok-cleaner.apk**

É o `.apk` puro: sem zip, sem precisar estar logado no GitHub e sem garimpar
no Actions. O link é fixo — aponta sempre para a última versão compilada da
`main`.

1. Abra o link no navegador do celular e baixe.
2. Toque no arquivo baixado. O Android vai pedir para permitir **instalar apps
   desconhecidos** para o navegador/app de arquivos — autorize.
3. Abra o **TikTok Cleaner** e siga os dois passos da tela:
   - **Ativar acessibilidade** → Configurações → Acessibilidade →
     *TikTok Cleaner* → ligar.
   - Voltar ao app e escolher **Limpar tudo**, **Curtidas**,
     **Salvos e coleções** ou **Republicados**.

<details>
<summary>Pelo Actions, se preferir (ou para pegar o APK de um branch)</summary>

Repositório → aba **Actions** → **APK Android** → run desejado → role até o
fim, caixa **Artifacts** → `tiktok-cleaner-apk`.

Esse caminho vem em `.zip` e **exige estar logado no GitHub**. No app do
GitHub para Android não dá para baixar direto: toque em **Artefatos ↗** no
resumo do run, que ele abre no navegador.

</details>

Se preferir compilar você mesmo (com PC):

```bash
cd androidapp
gradle :app:assembleDebug     # ou ./gradlew, se voce gerar o wrapper
# APK em app/build/outputs/apk/debug/
```

---

## O que ele faz

1. Abre o TikTok (detecta qual pacote está instalado: `musically`, `trill` ou
   `aweme`).
2. Vai ao **Perfil** e abre a aba alvo — *Curtidos*, *Favoritos*,
   *Repostagens*, e a sub-aba *Coleções* dentro de Favoritos —, encontrando os
   botões pela descrição de acessibilidade, em português ou inglês, **com ou
   sem acento** (os rótulos são normalizados antes da comparação).
3. Acha as células da grade **pela geometria**: a grade tem 3 colunas, então
   cada célula mede ~⅓ da largura da tela. Isso sobrevive a mudanças de layout
   muito melhor do que qualquer `resource-id`.
4. Abre o vídeo e lê o **estado real do ícone**: no Android 11+ o próprio
   serviço tira uma captura de tela e mede a fração de pixels na cor acesa —
   `#FE2C55` para curtir/repostar, `#FFC107` para salvar. Só toca se estiver
   aceso, e reconfere depois. Em versões mais antigas, cai para
   `isSelected`/`isChecked` e para a descrição ("Descurtir" = aceso).
   Coleções são pastas: abre, usa o menu de opções e confirma a exclusão.
5. Volta, recarrega a grade e repete até zerar, com verificação final que
   reporta `100% limpo` ou `Incompleto`.

A tela é relida **a cada item**, porque em algumas versões a grade se
reorganiza assim que o vídeo sai da lista — uma posição lida antes passaria a
apontar para o vizinho.

---

## Privacidade

O serviço declara `android:packageNames` com os três pacotes do TikTok: o
Android **só entrega a ele as telas desses apps**. Ele não lê seu banco, seu
WhatsApp nem qualquer outra tela, mesmo ligado. Nada sai do aparelho: não há
rede no app.

Desligue em Configurações → Acessibilidade quando terminar.

---

## Estrutura

```
androidapp/app/src/main/java/com/w3bray/tiktokcleaner/
  MainActivity.kt     tela única (UI em código, sem XML de layout)
  CleanerService.kt   o serviço de acessibilidade: navegação e remoção
  Geometry.kt         heurística da grade e vermelho da marca (Kotlin puro)
  Patterns.kt         rótulos PT/EN + normalização de acentos (Kotlin puro)
  Status.kt           estado compartilhado entre serviço e tela
```

`Geometry.kt` e `Patterns.kt` não importam nada do Android — é o que permite
testá-los na JVM, sem emulador:

```bash
cd androidapp && gradle :app:testDebugUnitTest
```

Os testes cobrem a heurística da grade (célula vs. botão vs. banner), a
ordenação e deduplicação das células, o `shrink`, a detecção das cores acesas
(vermelho e amarelo) e o casamento de rótulos — incluindo os casos perigosos:
"Remover repostagem" não pode casar com "Repostar" nem "Excluir coleção" com
"Criar coleção" (criariam o oposto do pedido), as abas das quatro categorias
não podem se confundir entre si, e a aba "Curtidos" do perfil não pode ser
tomada pelo player.

O workflow **APK Android** roda esses testes e compila o APK a cada push.

---

## Quando o app mudar

O TikTok renomeia botões entre versões. Todos os rótulos estão em
`Patterns.kt`, como listas de regex. Edite, recompile pelo Actions e reinstale.

Se quiser descobrir os rótulos atuais do **seu** aparelho sem PC, o caminho
mais rápido continua sendo o `--inspect` da versão ADB (veja
`android/README.md`), mas ele precisa de um computador.

---

## Avisos

- **Não testado em aparelho real por quem escreveu o código**: a lógica pura
  tem testes na JVM e o app compila no CI, mas a interação com o app do TikTok
  depende da versão instalada no seu celular. Comece com poucos itens e veja se
  o contador bate.
- Enquanto roda, o app controla a tela — não mexa no celular.
- Automação viola os Termos de Uso do TikTok; pode dar bloqueio temporário.
- **A remoção não tem desfazer.**
