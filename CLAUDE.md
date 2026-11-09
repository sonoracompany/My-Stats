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
| `supabase/schema.sql` + `supabase/migrations/` | Tabelas (todas já aplicadas no Supabase do Galli até a 005) |
| `design/preview.html` | Prévia de design (base das propostas) |
| `.claude/skills/` | Skills de design instaladas: emil-design-eng, animate, mobile-native, design-taste-frontend, ui-ux-pro-max, mobile-design |

## Banco (Supabase)

- `lives` — uma linha por live (data, título em MAIÚSCULAS, duração, diamantes, recompensas, views, espectadores, pico, seguidores, presenteadores, comentários, compartilhamentos, curtidas…)
- `withdrawals` — saques: `date`, `amount_usd` (valor que sai do TikTok, antes da taxa), `rate_brl`, `method` (payoneer|pix), `bank` (inter|nubank)
- `reward_snapshots` — print de "Upcoming rewards": disponível, a receber, semana, diamantes da semana, % semanal, liga, dias de liga
- `settings` — último limite salvo (o limite agora é automático pelo ganho do mês anterior)
- `goals` — metas: `month = 'AAAA-MM'` (meta do mês) ou `month = 'total'` (meta do acumulado, ex.: 100 mi)
- `month_summaries` — resumo do mês vindo dos prints do Overview (`data` jsonb: totais, período, gênero, idade, países, "viewers from videos")

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
  meta do mês e meta do acumulado (com previsão), resumo do mês e "Seu público", "Vindos dos vídeos",
  estatísticas novas (melhor dia, duração ideal, calendário, títulos, 6 meses), saque Payoneer/Pix, relatório pro contador.
- **Em andamento (só na prévia, ainda NÃO aplicado no app):** redesign total da tela **Início** — tela
  "✦ Início · Redesign total" (`inicioX`) em `design/preview.html`: topo esmeralda de ponta a ponta com arco de meta animado
  (sobe do zero), diamantes em negrito, pílula de %, seletor de meta, métricas em blocos de vidro; folha clara com
  "O mês até agora", Carreira, Dólar, grade Outubro × Setembro com barrinhas e últimas lives.
  O Galli aprovou a direção e pediu ajustes até a versão atual. Próximos passos: confirmar com ele, aplicar no app
  (com dados reais) e depois redesenhar as outras telas no mesmo estilo.
