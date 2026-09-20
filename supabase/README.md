# Migrations PostgreSQL / Supabase

Esta pasta prepara a futura migração do CEM CONNECT para PostgreSQL/Supabase.

- As migrations são versionadas e não executam automaticamente pelo servidor atual.
- Não há URL, chave, senha ou outro segredo nesta pasta.
- O SQLite continua sendo a persistência ativa do MVP enquanto a camada de acesso ao banco não for migrada deliberadamente.
- A migration inicial cria apenas dados estruturais: papéis e módulos de formação. Ela não cria pessoas, usuários, células ou dados ministeriais.
- `care_records.private_note` é exclusivo de rotas autorizadas da futura camada Node. `cell_referrals.note_for_cell` é uma informação compartilhável independente e nunca deve receber cópia automática de uma nota privada.
- Consentimento de imagem é registrado em histórico próprio; a autorização atual da pessoa é sincronizada a partir desse registro. Fotos de reunião somente podem aparecer para membros quando estiverem com status `published`.

Quando houver um projeto Supabase configurado em ambiente seguro, aplique as migrations usando as ferramentas oficiais e credenciais fora do repositório. Antes de liberar qualquer acesso direto do cliente, defina e teste as políticas RLS correspondentes às permissões do servidor.

## Assets da identidade visual

A migration `20260919150000_add_branding_storage.sql` prepara o bucket público
`church-branding-assets` exclusivamente para logo e banner anual. Ele aceita
somente PNG, JPEG e WebP de até 5 MB. Não há policy de escrita para o cliente:
o backend Node autenticado executa uploads e remoções com `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` definidos apenas no ambiente do servidor. Nunca
publique essa chave no frontend ou no Git.

## Fotos pessoais privadas

A migration `20260919170000_add_person_access_and_private_photos.sql` depende
das migrations anteriores e cria o bucket privado `person-profile-photos`.
Esse bucket não possui leitura ou escrita pública: o backend Node autorizado
faz o upload, a leitura autenticada e a remoção. A tabela `people` guarda
somente bucket e caminho; não há imagens em base64 no PostgreSQL.

Ordem de aplicação para este conjunto pendente: `20260919150000`,
`20260919160000` e, por último, `20260919170000`. Nenhuma dessas migrations
deve ser aplicada automaticamente pelo aplicativo.
