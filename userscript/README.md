# TikTok Cleaner — userscript (só o celular)

Remove **100% dos vídeos curtidos e republicados** rodando **dentro da própria
página do TikTok**, no navegador do celular.

Sem PC. Sem cabo. Sem ADB. Sem APK. Sem senha — usa a sessão que já está
logada no navegador.

---

## Instalação (~3 minutos)

1. Instale o **Firefox** pela Play Store (o Chrome para Android não aceita
   extensões).
2. No Firefox: menu **⋮ → Extensões** (ou *Add-ons*) → procure
   **Violentmonkey** (ou *Tampermonkey*) → **Adicionar**.
3. Abra este link no Firefox — a extensão oferece instalar o script:

   ```
   https://raw.githubusercontent.com/w3bray/tiktok/main/userscript/tiktok-cleaner.user.js
   ```

   Toque em **Instalar**.
4. Abra `tiktok.com` no Firefox e faça login na sua conta.
5. Toque no seu **perfil** (a página tem que ser `tiktok.com/@seunome`).
6. Um painel escuro aparece no canto inferior direito. Escolha:

   - **Limpar tudo** — republicados e depois curtidos
   - **Só curtidos**
   - **Só republicados**

Enquanto roda, o painel mostra o que está fazendo e quantos já foram
removidos. **Parar** interrompe na hora.

> Se preferir Kiwi Browser ou Firefox Beta, funciona igual — o que importa é
> ter Violentmonkey/Tampermonkey.

---

## Como funciona

O script vive dentro da página e faz o que você faria com o dedo:

1. Abre a aba **Curtidos** ou **Repostagens** do seu perfil e confere pelo
   `aria-selected` que a aba certa ficou ativa.
2. Abre o primeiro vídeo da grade.
3. Olha a cor do ícone: o TikTok pinta o botão aceso com o vermelho da marca
   (`rgb(254,44,85)`). **Só toca se estiver aceso** — assim nunca curte nada
   por engano. Depois reconfere; se o toque não pegou, tenta mais uma vez.
4. Volta para a grade e repete, **até a aba zerar**. Daí o "100%".
5. Termina mostrando `100% limpo` ou quantos itens não deram.

Vídeos que não podem ser desfeitos (privados, apagados, sem o botão) entram
numa lista de bloqueados e são pulados, em vez de travar o script em laço.

O estado fica no `sessionStorage`: se a página recarregar no meio, o script
acorda do outro lado e continua de onde parou.

Entre uma ação e outra há pausas aleatórias de 1 a 2,4 segundos — não é
pressa, é para não parecer robô.

---

## Limites honestos

- Funciona no **site** do TikTok, não no app. Se você abrir o link e o celular
  jogar para o app, volte ao Firefox e continue lá.
- A aba **Curtidos** só aparece para você mesmo, logado.
- O site móvel às vezes insiste em "Abrir no app". Feche o aviso e siga.
- Se o TikTok mudar os atributos `data-e2e`, o script avisa que não achou o
  botão. Os seletores estão todos no topo do arquivo, na constante `SEL`.
- Automação viola os Termos de Uso do TikTok; pode aparecer captcha ou
  bloqueio temporário de ações.
- **A remoção não tem desfazer.**

---

## Teste

```bash
npm run test:userscript
```

Sobe um "TikTok" falso (SPA com perfil, abas, grade, página de vídeo e
navegação por `history.pushState`), injeta o userscript como uma extensão
faria, toca em **Limpar tudo** e confere que os 8 itens somem, que o painel
reporta `100% limpo` e que nada é recurtido depois de terminar. Roda numa
viewport de celular, sem internet e sem conta.
