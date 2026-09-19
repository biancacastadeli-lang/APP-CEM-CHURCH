# CEM CONNECT

MVP visual e navegável para a CEM Church, centrado em pessoas, cuidado e conexão.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
pnpm install
pnpm dev
```

Abra `http://localhost:3000`.

## Verificação

```bash
pnpm run build
```

## Persistência local

O MVP usa SQLite nativo do Node.js. Ao iniciar o projeto, o arquivo `data/cem-connect.db` é criado vazio e fica fora do Git por conter dados locais de execução.

A navegação e os perfis de visualização continuam sendo demonstrativos; não há autenticação real ou integrações externas nesta etapa.

## Primeira administração

Uma instalação vazia não cria usuários, células ou senha padrão. Para inicializar exclusivamente o primeiro Administrador local, execute:

```bash
pnpm create-admin
```

O comando funciona somente quando ainda não existe um usuário com papel de Administrador e solicita os dados de forma interativa. Depois disso, novos administradores devem ser criados pela área Administração do sistema.

Em produção, defina `NODE_ENV=production` para que o cookie de sessão receba automaticamente o atributo `Secure`. O limite de tentativas de login é mantido em memória no MVP e deve ser complementado pela infraestrutura de produção.

## PostgreSQL

O PostgreSQL é a fonte de verdade para autenticação, sessões, perfil, identidade visual, Pessoas e Células. A conexão é usada exclusivamente pelo backend Node.

O SQLite permanece temporariamente apenas nos módulos operacionais que ainda aguardam migração, como o pré-cadastro público de visitantes e os fluxos legados de Boas-Vindas.

Para testar a conexão sem alterar dados, defina `DATABASE_URL` somente no ambiente do servidor (ou em um `.env` local ignorado pelo Git) e execute:

```bash
pnpm db:check
```

Sem `DATABASE_URL`, o diagnóstico não é executado. Use [.env.example](.env.example) apenas como referência de variáveis; nunca envie credenciais ao frontend ou ao Git.
