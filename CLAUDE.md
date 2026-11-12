# My Stats — contexto do projeto

App pessoal (PWA instalado na tela de início do iPhone) do **Galli**, criador de TikTok LIVE (canta nas lives).
Mostra diamantes, recompensas, saques, estatísticas e metas. Fala sempre em **português do Brasil**, de forma simples
(o Galli não é programador).

- Repositório: `sonoracompany/My-Stats` · branch padrão `main` (transferido de `andregustavooficial/My-Stats` em nov/2026)
- App publicado: https://sonoracompany.github.io/My-Stats/ (o endereço antigo `andregustavooficial.github.io/My-Stats` deixou de
  valer com a transferência; o app precisa ser adicionado de novo à tela de início pelo endereço novo)
- Hospedagem: GitHub Pages, publicado pelo workflow `.github/workflows/pages.yml` a cada push em `main` que mexa em `app/`
  (o passo "Stamp version" troca `__V__` pelo commit, para o iPhone não usar arquivos antigos).
- Banco: Supabase (URL e chave anon pública em `app/app.js`; os dados são protegidos por RLS "owner" em cada tabela).

## Como o Galli gosta de trabalhar

1. **Mudança visual:** primeiro uma prévia em HTML (Artifact) para ele ver; só aplica no app quando ele aprovar.
   A prévia de design está em `design/preview.html` (página única com todas as telas e botões para trocar tema/tela).
2. **Publicar:** quando ele disser "pode publicar"/"pode aplicar": commit → PR da branch de trabalho para `main` → merge.
   O GitHub Pages atualiza em ~2 minutos; o app tem atualização automática (`checkUpdate()` em `app.js`).
3. Antes de publicar, testar as telas com dados de exemplo (Playwright com um Supabase falso) e conferir prints.
4. Mudanças no banco: escrever o SQL em `supabase/migrations/NNN_*.sql` e mandar o comando pronto para ele colar no
   SQL Editor do Supabase. O app deve continuar funcionando se a tabela ainda não existir (`optional: true` em `ENTITIES`).
5. Ele é direto: se não gostar, diz "outra proposta". Não copiar referências "na cara dura"; nada de branco estourado
   nem preto chapado; fonte do iPhone (SF Pro, SF Mono nos números).

## Arquivos

| Arquivo | O que tem |
|---|---|
| `app/index.html` | Casca do PWA (meta tags, theme-color, manifest) |
| `app/app.js` | Tudo da interface: login, telas (Início, Lives, Estatísticas, Recompensas), janelas (prints, live, meta, relatório), animações |
| `app/style.css` | Visual (tema **Esmeralda**). Regras novas vão no fim do arquivo e sobrescrevem as antigas |
| `app/tiktok.js` | Leitura do texto dos prints: `parseTikTok` (live), `parseWeekly` (Upcoming rewards), `isMonthPrint`/`parseMonth`/`fixMonth` (resumo do mês e Viewer insights) |
| `app/ocr.js` | Leitura das imagens no próprio iPhone com Tesseract.js 5.1.1 (contraste por faixas, linhas remontadas pela posição, ponto decimal, bolinhas laranjas da liga) |
| `app/rewards.js` | Regras de pagamento e contas: `ledger` (saldo), `monthEarned`, `limitFor`, `LIMIT_TIERS`, `LIFETIME` (acumulado desde nov/2023) |
| `supabase/schema.sql` + `supabase/migrations/` | Tabelas (todas já aplicadas no Supabase do Galli até a 006) |
| `design/preview.html` | Prévia de design (base das propostas) |
| `.claude/skills/` | Skills de design instaladas: emil-design-eng, animate, mobile-native, design-taste-frontend, ui-ux-pro-max, mobile-design |

## Banco (Supabase)

- `lives` — uma linha por live (data, título em MAIÚSCULAS, duração, diamantes, recompensas, views, espectadores, pico, seguidores, presenteadores, comentários, compartilhamentos, curtidas…)
- `withdrawals` — saques: `date`, `amount_usd` (valor que sai do TikTok, antes da taxa), `rate_brl`, `method` (payoneer|pix), `bank` (inter|nubank)
- `reward_snapshots` — print de "Upcoming rewards": disponível, a receber, semana, diamantes da semana, % semanal, liga, dias de liga
- `settings` — último limite salvo (o limite agora é automático pelo ganho do mês anterior)
- `goals` — metas: `month = 'AAAA-MM'` (meta do mês) ou `month = 'total'` (meta do acumulado, ex.: 100 mi)
- `month_summaries` — resumo do mês vindo dos prints do Overview (`data` jsonb: totais, período, gênero, idade, países, "viewers from videos")
- `video_posts` — quantos vídeos foram postados em cada dia (`date`, `count`; gravar de novo substitui) — migração 006

## Regras de pagamento do TikTok (usadas no app)

- 1 diamante = US$ 0,01. Por live até 40% (20/30/35/38% por duração + 2% com 5 novos seguidores).
- Semanal de 6% a 13% (dias válidos 6/8%, fãs ativos 1/1,5/2%, liga 1% ou 3%). Cenário comum: 40% + 11% = 51%.
- Semana de segunda a domingo; vira na **segunda à 1h** (o semanal cai no saldo nessa hora).
- Saque: taxa US$ 3 (Payoneer e Pix), mínimo US$ 9. Recebido = (sacado − 3) × cotação.
- Limite diário de saque = tabela `LIMIT_TIERS` aplicada ao ganho do mês anterior.
- Cotação: AwesomeAPI (reserva: PTAX do Banco Central); dólar de saque = o do último saque (sem saque: comercial − R$ 0,18).

## Cuidados conhecidos

- **Leitura dos prints (OCR):** o leitor erra de jeitos previsíveis — perde o ponto ("4.1K" → "41K"), troca letras por números ("S3h", "O0m41s"),
  transforma a foto do perfil em lixo antes do título. Já há correções em `tiktok.js` (`fixMonth`, `cleanTitle`, `pctOk`…).
  Para depurar, reproduza o pré-processamento de `ocr.js` + a função `rows()` com tesseract.js no Node antes de mexer.
- Uma live do mesmo dia do print de Upcoming rewards não soma de novo no saldo (o print já inclui).
- Mês em andamento compara com o mês anterior só até o mesmo dia.
- Respeitar `prefers-reduced-motion` em toda animação; área de toque ≥ 44px.

## Onde paramos

- No app (publicado): tema Esmeralda, barra de abas presa ao rodapé com destaque verde-limão que desliza,
  resumo do mês e "Seu público", "Vindos dos vídeos", estatísticas novas (melhor dia, duração ideal, calendário,
  títulos, 6 meses), saque Payoneer/Pix, relatório pro contador.
- **Início redesenhado (nov/2026, aprovado e publicado):** `renderHome` em `app.js`, estilos no fim de `style.css`
  (classes `lx-*`, `nx-*`, `nb-*`, `cx-*`). Topo esmeralda de ponta a ponta (sem o cabeçalho de sempre: `body.luxe`,
  `theme-color` muda para `#0f7558`), arco da meta que sobe do zero (`lxAnim`), faixa de vidro com saldo/lives/horas,
  folha clara com "O mês até agora", atalho da carreira, dólar, comparativos em blocos 2×2 e últimas lives em cartões
  (etiqueta "melhor do mês" = live com mais diamantes no mês; recorde da carreira não existe, faltam dados).
- **Tela Carreira** (`renderCareer`, rota `career`, abre pelo cartão do Início): total desde nov/2023, trilha de marcos até
  a meta do acumulado, ritmo e previsão, mês a mês, marcos e melhores meses. Ano a ano e datas dos marcos antigos não
  aparecem porque não há histórico mês a mês antes do app (só o total em `LIFETIME`).
- **Lives redesenhada (opção "A Calendário", aprovada):** `renderLives` com topo esmeralda (troca de mês, total, calendário
  do mês com o melhor dia em cobre, faixa por live/por hora/ao vivo), comparativo em lista, cartão da melhor live do mês e
  lista agrupada por semana (ordenar por data/diamantes/por hora). Tocar numa live abre a folha de edição; só o cartão da
  melhor do mês abre a **página da live** (`renderLive`, rota `live`, `state.liveId`).
- **Estatísticas redesenhada (opção "A Abas", aprovada):** `renderStats` com topo esmeralda (projeção do mês que conta
  do zero, barra do mês, faixa dólares/reais/limite), cartão da sequência com o foguinho colorido (`FLAME`), e abas
  Público / Engajamento / Ritmo (`statsPane`; `state.stab`). Calendário e últimos 6 meses saíram (estão na Lives e na Carreira).
- **Seus vídeos** (`renderVideos`, rota `videos`, abre pelo cartão abaixo da sequência na Estatísticas): registrar vídeos
  (seletor de data + quantidade + Gravar, que substitui o número do dia e volta a zero), últimos 14 dias, vindos dos vídeos
  comparando **por dia**, "a quantidade influencia?" (lives com vídeo no dia ou na véspera × sem, desde o 1º registro),
  vídeos × diamantes por semana e mês a mês. "Vindos dos vídeos" saiu da aba Público.
- **Animação ao rolar** (`reveal`/`REVEAL`): cada cartão aparece com fade em cascata; as linhas de dentro entram uma por uma
  (`--r`) e os gráficos só se formam quando o cartão aparece (`.reveal.in`). Rolada rápida não deixa nada escondido.
- **Pílula flutuante de voltar** (`backPill`, `BACK`): só nas páginas extras (Carreira → Início, página da live → Lives);
  aparece quando o botão do topo sai da tela.
- **Barra de status:** `black-translucent` + faixa esmeralda fixa atrás do relógio (`#app::before`, altura do safe-area).
  Cuidado: a classe `top` é do cabeçalho antigo e fica escondida nas telas novas (`body.luxe .top`); não usar esse nome.
- **Números grandes com K e M no app inteiro** (`compact`, `mil1`, `goalLabel`, `usdK`): 1,96M, 59,6K, US$ 7,8K.
- Prévia: `design/preview.html` (telas "✦ Início · Redesign total", "✦ Carreira · tela nova", "✦ Lives · A/B/C", "✦ Lives · Página da live", "✦ Estatísticas · A/B/C", "✦ Estatísticas · Seus vídeos").
- **Próximo passo:** redesenhar Recompensas no mesmo estilo, sempre com prévia antes.
