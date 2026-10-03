# Minha Carteira

PWA pessoal para acompanhar investimentos (ações, FIIs, cripto, Tesouro Direto e outros), feito para usar no celular.

- **Dados 100% locais**: lançamentos, cotações e configurações ficam no IndexedDB do aparelho. Backup e restauração por arquivo JSON.
- **Funciona offline**: o app fica em cache (service worker) e mostra as últimas cotações salvas.
- **Entrada de dados**: planilhas de Negociação e Movimentação da Área do Investidor da B3 (reimportar não duplica), planilha de Eventos (proventos a receber) e lançamento manual.
- **Pendências**: tela que lista o que precisa de ação manual (valor de resgate de CDB, ativo sem cotação, posição vendida, backup atrasado).
- **Cotações uma vez por dia**: na primeira abertura do dia e no botão Atualizar, para poupar os limites gratuitos das APIs.
- **Cotações**: só os códigos dos ativos saem do aparelho.

| Fonte | Uso | Observação |
|---|---|---|
| [brapi.dev](https://brapi.dev) | ações, FIIs, ETFs em tempo quase real | token gratuito, informado em Ajustes (fica só no aparelho) |
| [CoinGecko](https://www.coingecko.com/en/api) | cripto | chave Demo opcional |
| [BCB SGS](https://dadosabertos.bcb.gov.br) | CDI (12), IPCA (433), Selic (432) | consultado direto do celular |
| B3 COTAHIST | fechamento mensal de todos os ativos, para o histórico | gerado pelo GitHub Actions em `public/data/b3/` |
| Tesouro Transparente | preço dos títulos do Tesouro Direto | gerado pelo GitHub Actions (o site não aceita chamadas do navegador) |
| Mercado Bitcoin | histórico mensal de BTC/ETH | gerado pelo GitHub Actions |

Os arquivos em `public/data/` contêm apenas cotações públicas de mercado. **Nenhum dado pessoal vai para o repositório** (o `.gitignore` bloqueia planilhas e backups).

## Desenvolvimento

```bash
npm install
npm run dev        # servidor local
npm test           # testes (parser da B3, cálculos, rentabilidade, dados públicos)
npm run typecheck
npm run data       # regenera public/data (baixa ~90 MB por ano da B3 que faltar)
npm run build
```

## Publicação

A cada push na `main` (e duas vezes por dia, para atualizar as cotações públicas), o workflow
`.github/workflows/deploy.yml` roda os testes, gera `public/data`, faz o build e publica no GitHub Pages.
Em *Settings → Pages*, a fonte deve ser **GitHub Actions**.

## Estrutura

```
src/core/      tipos, leitura das planilhas da B3, posição/preço médio, rentabilidade por período
src/data/      IndexedDB e backup
src/quotes/    cotações ao vivo (brapi, CoinGecko, BCB) e histórico público
src/ui/        telas e gráficos SVG
scripts/       gerador dos dados públicos (B3, Tesouro, cripto)
tests/         testes Vitest
```

## Limitações conhecidas

- Compras e vendas na bolsa vêm só da planilha de **Negociação**; a de Movimentação traz proventos, Tesouro e eventos.
- Mudança de código de ativo (incorporações, cisões) não é tratada automaticamente: ajuste com lançamentos manuais.
- Empréstimo de ações é ignorado (as ações continuam suas); o reembolso de proventos entra como provento. A taxa recebida pelo aluguel não vem na planilha.
- CDB/LCI/LCA aparecem pelo valor aplicado; o vencimento sem valor vira uma pendência para informar quanto foi recebido.
- Venda maior que a posição (venda a descoberto) abre posição vendida, fechada pela recompra seguinte.
- Direitos de subscrição não exercidos ou cedidos são ignorados; se exercer, lance a compra.
- O histórico usa o fechamento do último pregão de cada mês; o mês atual usa as cotações do momento.
- Taxas de corretagem não entram no custo (a planilha da B3 não as traz).
