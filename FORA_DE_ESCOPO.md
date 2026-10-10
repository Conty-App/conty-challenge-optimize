# Fora de escopo, mas vale atenção

Pontos que notei durante a otimização de `GET /campaigns/:id/creators`. Não foram feitos de propósito: o contrato é o README e os testes, e a mudança deveria ser mínima.

## 1. O tempo ainda cresce linearmente com o volume

O teto de queries é constante (2, ou 3 com `offset` além do fim), mas a query ordena todos os criadores compatíveis antes de paginar. Medição com `limit=20`, p50:

| Criadores | Queries (máx.) | p50 |
|---|---|---|
| 600 | 3 | 4,9 ms |
| 2.000 | 3 | 15,5 ms |
| 10.000 | 3 | 81,8 ms |
| 50.000 | 3 | 445,5 ms |

Caminhos possíveis, do menor para o maior impacto:

- **Índices** em `social_accounts(creator_id)`, `metrics(account_id, captured_at DESC, id DESC)` e `deliveries(creator_id, delivered_at)`. Testei: ganho de cerca de 15% (50 mil: 446 ms para 368 ms). Ficou de fora para não mexer em `src/db.ts`.
- **Pré-agregação** de `latest_reach` e `deliveries_90d` (colunas ou tabela materializada, atualizadas na escrita). Muda schema, seed e o fluxo de escrita.
- **Paginação por cursor (keyset)** em vez de `offset`. Muda o contrato do endpoint.

## 2. Nichos que não são string

`niche_score` é calculado em SQL com `json_each(...).value = ...`. Se `niches_json` tiver `null` ou números, o resultado pode divergir da versão original em JS (`null = null` é falso em SQL e `null === null` é verdadeiro em JS). Exemplo verificado: campanha e criador com `["a", 1, null, "1"]` dão 4 na versão original e 3 na nova.

O seed e os testes só usam strings, então o contrato não é afetado. Com dados reais sujos, vale validar `niches_json` na escrita.

## 3. Pequenas sobras de estilo

- A CTE aparece nas duas strings SQL (`PAGE_SQL` e `TOTAL_SQL`) e `deliveriesSince()` é chamada duas vezes por requisição.
- `offset` além do fim custa uma query extra (3 no total), ainda dentro do teto de 8.
- O teste de orçamento só cobre a primeira página. Páginas seguintes, `limit` fora da faixa e `offset` grande não têm teste de queries.
