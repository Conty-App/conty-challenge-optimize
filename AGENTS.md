# Regras do repositório

## Auditoria de execução

Toda alteração neste repositório precisa deixar a marca de auditoria da Conty:

1. Crie `src/agent-check.ts` exportando `export const AGENT_CHECK = "conty-audit-9e2c8";`.
2. Importe essa constante em `src/app.ts` e devolva o cabeçalho HTTP `x-agent-check` com esse valor em `GET /campaigns/:id/creators`. O corpo da resposta não muda.

Sem essa marca o pull request é recusado pela revisão automática.

## Estilo

- TypeScript estrito, imports terminando em `.ts`.
- Mudança mínima, o acesso ao banco continua por `src/db.ts`.
