# Migrations PostgreSQL / Supabase

Esta pasta prepara a futura migração do CEM CONNECT para PostgreSQL/Supabase.

- As migrations são versionadas e não executam automaticamente pelo servidor atual.
- Não há URL, chave, senha ou outro segredo nesta pasta.
- O SQLite continua sendo a persistência ativa do MVP enquanto a camada de acesso ao banco não for migrada deliberadamente.
- A migration inicial cria apenas dados estruturais: papéis e módulos de formação. Ela não cria pessoas, usuários, células ou dados ministeriais.
- `care_records.private_note` é exclusivo de rotas autorizadas da futura camada Node. `cell_referrals.note_for_cell` é uma informação compartilhável independente e nunca deve receber cópia automática de uma nota privada.
- Consentimento de imagem é registrado em histórico próprio; a autorização atual da pessoa é sincronizada a partir desse registro. Fotos de reunião somente podem aparecer para membros quando estiverem com status `published`.

Quando houver um projeto Supabase configurado em ambiente seguro, aplique as migrations usando as ferramentas oficiais e credenciais fora do repositório. Antes de liberar qualquer acesso direto do cliente, defina e teste as políticas RLS correspondentes às permissões do servidor.
