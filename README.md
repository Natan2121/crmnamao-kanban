# CRMnaMao Kanban

Dashboard App externo para o Chatwoot, criado para operar os funis importados do Kommo em cima das conversas reais dos canais.

## O que ele faz

- Le os funis e etapas do arquivo `kommo-structure-*.json`
- Busca conversas do Chatwoot e agrupa por `kommo_pipeline` e `kommo_stage`
- Exibe quadro kanban por funil
- Permite arrastar cards entre etapas
- Persiste a nova etapa no `custom_attributes` da conversa
- Abre a conversa original do Chatwoot com um clique

## Variaveis

Copie `.env.example` para `.env.local` e preencha:

```bash
CHATWOOT_BASE_URL=https://chat.crmnamao.cloud
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_API_TOKEN=seu_token_de_acesso
APP_ACCESS_KEY=uma_chave_longa_e_aleatoria
```

Opcional:

```bash
KOMMO_STRUCTURE_PATH=../../backups/kommo-structure-2026-03-08.json
```

Se `KOMMO_STRUCTURE_PATH` nao for informado, o app procura automaticamente o arquivo mais recente em `../../backups/kommo-structure-*.json`.

## Rodar local

```bash
npm install
npm run dev
```

Ou para validar build de producao:

```bash
npm run check
npm run start
```

## Deploy no Coolify

- Repositorio: este projeto
- Base directory: `apps/chatwoot-kanban`
- Build pack: `nixpacks` ou `dockerfile` automatico do Node
- Port: `3000`
- Variaveis: as do `.env.local`

Depois do deploy, registre no Chatwoot em `Configuracoes -> Integracoes -> Dashboard Apps`:

- `Title`: `CRMnaMao Kanban`
- `Type`: `Frame`
- `URL`: URL publica do app com hash, por exemplo `https://kanban.seudominio.com/#appKey=SUA_CHAVE`
- `Show on sidebar`: desligado

Com isso o app aparece como pagina dedicada dentro do Chatwoot.

## Seguranca

- Use apenas `#appKey=...` no hash da URL. Nao use query string para nao registrar a chave em logs e historico.
- Gere uma `APP_ACCESS_KEY` longa e aleatoria.
- O app aceita apenas chamadas autenticadas nas rotas `/api/board` e `/api/board/move`.
