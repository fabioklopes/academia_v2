# CompreFace (self-hosted) — infraestrutura local

Stack oficial do [CompreFace](https://github.com/exadel-inc/CompreFace) (Exadel), baixada
diretamente do repositório oficial em 2026-06-30 e adaptada apenas para amarrar a porta
exposta em `127.0.0.1` (nunca `0.0.0.0`) — ver `docs/seguranca_reconhecimento_facial.md`.

## Subir o serviço

```
cd docker/compreface
docker compose --env-file .env up -d
```

Aguarde todos os containers ficarem saudáveis (a primeira subida baixa várias imagens —
pode levar alguns minutos e alguns GB de download). Acompanhe com:

```
docker compose ps
docker compose logs -f compreface-core
```

## Criar a aplicação e obter a API key

1. Abra `http://127.0.0.1:8000` no navegador (só funciona na própria máquina onde o Docker está rodando).
2. Crie a conta de administrador do CompreFace (é local, não tem relação com o login da academia).
3. Crie uma **Application** (ex.: "academia-v2").
4. Dentro da Application, crie um serviço do tipo **Recognition** (ex.: "reconhecimento-turmas").
5. Copie a **API key** gerada para esse serviço — ela vai para o `.env` da aplicação principal:

```
COMPREFACE_ENABLED=true
COMPREFACE_BASE_URL=http://127.0.0.1:8000
COMPREFACE_RECOGNITION_API_KEY=<cole a API key aqui>
```

## Parar / remover

```
docker compose down        # para os containers, mantém os dados (postgres-data)
docker compose down -v     # para e apaga também os dados (todos os subjects cadastrados)
```

## Notas de segurança

- A porta `8000` só é exposta em `127.0.0.1` — não é acessível por outras máquinas da rede,
  e muito menos pela internet.
- O Postgres do CompreFace não expõe porta nenhuma para o host — só é alcançável de dentro
  da rede interna do Docker Compose.
- As credenciais padrão do Postgres (`postgres`/`postgres`) vêm do template oficial do
  CompreFace. Como o banco não está exposto ao host, o risco é baixo, mas se este stack for
  rodar em produção, troque `postgres_password` no `.env` antes de subir.
