# Implantação em produção — Módulo de Reconhecimento Facial

Passo a passo para levar o que foi testado localmente para a VPS. Seu ambiente: app gerenciado por **PM2**, **Docker já disponível** na VPS. Nenhuma rota nova precisa de configuração de nginx (o CompreFace nunca é exposto publicamente — fica só em `127.0.0.1`).

**Ordem importa.** O ponto mais crítico: os models (`Usuario.js`, etc.) já fazem referência às colunas novas. Se o código novo subir **antes** das migrations rodarem no banco de produção, **toda a aplicação quebra** (qualquer consulta a `tb_usuarios` vai falhar com "Unknown column"). Sempre migrations → depois código novo no ar.

## 0. Pré-checagens (uma vez, antes de tudo)

- **Node na VPS ≥ 18** (idealmente ≥ 20): `node --version`. O client do CompreFace usa `fetch`/`FormData` nativos — em Node mais antigo isso quebra silenciosamente só quando alguém usar o módulo (login, etc. continuam funcionando, mas reconhecimento facial vai dar erro "fetch is not defined").
- **RAM disponível na VPS**: `free -h`. O CompreFace sobe 5 containers; o `.env` oficial reserva até `-Xmx4g` para a API e `-Xmx1g` para o admin (Java). Numa VPS pequena (1–2 GB) isso pode não caber junto com o Node app + MySQL. Se a VPS for modesta, **reduza antes de subir**:
  ```
  # em docker/compreface/.env, na VPS
  compreface_api_java_options=-Xmx1g
  compreface_admin_java_options=-Xmx512m
  ```
- **Backup do banco**: `mysqldump -u <user> -p <banco> > backup_pre_facial_$(date +%Y%m%d).sql`
- **Backup do `.env` atual da VPS** (cópia simples, ele não vai para o git).

## 1. Enviar o código para a VPS

No seu computador (eu posso fazer isso por você, se confirmar):
```
git add -A
git commit -m "feat: módulo de reconhecimento facial (avatar self-service, CompreFace, presença em lote)"
git push origin main
```

Na VPS:
```
cd /caminho/da/aplicacao
git pull origin main
npm install   # não há dependência nova, mas roda por garantia (package-lock pode ter mudado)
```

## 2. Rodar as migrations no banco de PRODUÇÃO — antes de reiniciar o app

```
npm run migrate:facial-usuarios
npm run migrate:facial-fotos
```

São idempotentes (podem rodar de novo sem problema) e só **adicionam** colunas/tabelas — não tocam em dado existente. Se algo der errado, `npm run rollback:facial` desfaz (mais detalhes em `docs/seguranca_reconhecimento_facial.md`... na verdade no histórico da conversa onde criei o script).

Confirme que rodou certo (sem erro no terminal) antes de seguir.

## 3. Subir o CompreFace na VPS

```
cd docker/compreface
docker compose --env-file .env up -d
docker compose ps     # confirme os 5 serviços "Up"/"running"
```

Acesse `http://127.0.0.1:8000` **de dentro da própria VPS** (ex.: `curl http://127.0.0.1:8000` ou um túnel SSH `ssh -L 8000:127.0.0.1:8000 usuario@vps` e abrir no seu navegador local) — não tem como abrir direto pelo IP público, e não deve: a porta só está exposta em loopback, de propósito (ver `docs/seguranca_reconhecimento_facial.md`).

Repita os passos que fizemos local: criar conta admin, criar Application, criar serviço **Recognition**, copiar a API key. **É uma instância nova** — os subjects cadastrados no seu CompreFace local não existem aqui; a produção começa zerada (nenhum aluno terá avatar "lembrado" pelo CompreFace até reaprovar as fotos lá).

## 4. Configurar o `.env` da aplicação na VPS

Adicione (com a API key gerada no passo 3, que é diferente da local):
```
COMPREFACE_ENABLED=true
COMPREFACE_BASE_URL=http://127.0.0.1:8000
COMPREFACE_RECOGNITION_API_KEY=<api key gerada na VPS>
```

## 5. Reiniciar o app

```
pm2 restart <nome-do-processo>   # ex.: pm2 restart academia-v2
pm2 logs <nome-do-processo> --lines 50
```

Confirme nos logs que subiu sem erro (especialmente nenhum "Unknown column" — se aparecer, as migrations do passo 2 não rodaram contra o banco certo).

## 6. Smoke test em produção

- Logar normalmente (login, dashboard) — nada deve ter mudado visualmente.
- Menu do professor: "Avaliar fotos de perfil", "Reconhecimento facial" e (admin) "Adesão às fotos de perfil" devem abrir sem erro 500.
- Aprovar uma foto de avatar de teste → confirma que cadastrou no CompreFace da VPS (sem erro nos logs do PM2).
- Subir uma foto de turma pequena → confirma detecção (mesmo que ninguém seja reconhecido ainda, já que a base de subjects está zerada).

## 7. Se precisar reverter

- **App**: `git checkout <commit-anterior>` na VPS + `pm2 restart`, ou simplesmente `pm2 restart` apontando para a tag anterior se você usa tags de release.
- **Banco**: `npm run rollback:facial` (remove só o que este módulo adicionou).
- **CompreFace**: `docker compose down` (mantém os dados) ou `docker compose down -v` (remove tudo) dentro de `docker/compreface/`.

Como tudo aqui é aditivo (colunas/tabelas novas, nenhuma alterada/removida) e o CompreFace é um serviço isolado, reverter não afeta o restante do sistema em nenhum dos casos.
