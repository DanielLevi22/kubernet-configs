# Spec: Deploy do checkout-service no cluster local

## Contexto

Com `users-service` (spec 02) e `products-service` (spec 03) validados no cluster, esta spec traz o `checkout-service` — o primeiro serviço que **depende de outro serviço de aplicação em tempo de execução**, não só de banco. Segundo o `README.md` do `marketplace-microservicos`, o `checkout-service` faz uma chamada HTTP direta ao `products-service` para validar o produto no add-to-cart (`CK -->|HTTP direto, fora do gateway| PR`). É aqui que a diferença entre "rodar um container isolado" e "rodar um sistema" (que discutimos antes de começar a mexer nos manifests) vira configuração real: em vez de `PRODUCTS_SERVICE_URL=http://localhost:3001` (válido só na sua máquina), o `checkout-service` dentro do cluster vai apontar para `http://products-service` — o nome do `Service` criado na spec 03, resolvido pelo DNS interno do cluster.

O `checkout-service` é NestJS + TypeORM, porta `3003`. `docker-compose.yaml` sobe Postgres (`checkout-db`, database `checkout_db`, `postgres`/`postgres`) em `localhost:5436`. Ele também publica mensagens no RabbitMQ (`messaging-service`, container `marketplace-rabbitmq`, usuário/senha `admin`/`admin`, porta `5672`) — por decisão já alinhada, o RabbitMQ segue **fora do cluster** (via `docker-compose`), mesma lógica já aplicada ao Postgres: é peça com estado, `StatefulSet` ainda não foi estudado.

`GET /health` do `checkout-service` verifica **dois** recursos externos: Postgres (`TypeOrmHealthIndicator`) e RabbitMQ (`MicroserviceHealthIndicator`, fila `health_check_queue`) — reforça ainda mais o motivo de não usar esse endpoint como `livenessProbe` (agora são duas dependências externas que poderiam derrubar o pod à toa).

## Objetivo

Colocar o `checkout-service` rodando no cluster, conectando no Postgres e no RabbitMQ externos (ambos via `docker-compose` no host) e alcançando o `products-service` pelo nome do `Service` interno do cluster — validando pela primeira vez a comunicação serviço-a-serviço dentro do k8s.

## Requisitos Funcionais

### RF01 — Build da imagem local
Construir a imagem localmente a partir do `Dockerfile` do `checkout-service`, tag `checkout-service:local`.

### RF02 — ConfigMap com variáveis não sensíveis
Criar `k8s/apps/checkout-service/configmap.yaml`: `PORT=3003`, `NODE_ENV=production`, `DB_HOST=host.docker.internal`, `DB_PORT=5436`, `DB_USERNAME=postgres`, `DB_DATABASE=checkout_db`, `JWT_EXPIRES_IN=24h`, `RABBITMQ_QUEUE_PAYMENTS=payment-queue`, `RABBITMQ_EXCHANGE=payments`, e os endereços internos dos outros serviços: `USERS_SERVICE_URL=http://users-service`, `PRODUCTS_SERVICE_URL=http://products-service`, `PAYMENTS_SERVICE_URL=http://payments-service` (este último só resolve de fato depois da spec 05 — não impede o `checkout-service` de subir, só afeta uma chamada que dependa dele).

### RF03 — Secret com variáveis sensíveis do próprio serviço
Criar `k8s/apps/checkout-service/secret.yaml` com `DB_PASSWORD` (base64) e `RABBITMQ_URL` (base64, `amqp://admin:admin@host.docker.internal:5672`) — a URL completa vai no Secret, não no ConfigMap, porque embute credencial.

### RF04 — Deployment
Criar `k8s/apps/checkout-service/deployment.yaml`: mesmo padrão de rollout (3 réplicas, `RollingUpdate` `maxSurge: 2`/`maxUnavailable: 1`), container na porta `3003`, três `envFrom` (`configmap` RF02, `secret` RF03, `secret` compartilhado `jwt-secret` da spec 02), mesmos `resources` de ponto de partida.

### RF05 — Probes
`startupProbe` e `readinessProbe` em `GET /health`. Sem `livenessProbe` — agora com duas dependências externas (Postgres e RabbitMQ), o argumento da spec 02 vale ainda mais forte aqui.

### RF06 — Service
Criar `k8s/apps/checkout-service/service.yaml`, `ClusterIP`, porta `80` → `3003`.

### RF07 — HPA
Criar `k8s/apps/checkout-service/hpa.yaml`, mesmo padrão (CPU 75%, memória 80%, `minReplicas: 3`, `maxReplicas: 8`).

## Fluxo Esperado

```mermaid
flowchart TD
    A[docker build -t checkout-service:local] --> B[docker compose up -d checkout-db :5436]
    B --> C[messaging-service: docker compose up -d - rabbitmq :5672]
    C --> D[kubectl apply -f k8s/apps/checkout-service/]
    D --> E[Deployment cria os pods]
    E --> F[startupProbe + readinessProbe: GET /health]
    F -->|Postgres ok e RabbitMQ ok| G[Pod Ready]
    G --> H[Service ClusterIP :80 -> :3003]
    H --> I[checkout-service resolve http://products-service via DNS interno]
    I --> J[GET produto no products-service para validar add-to-cart]
```

## Fora de Escopo

- Trazer Postgres ou RabbitMQ para dentro do cluster.
- `livenessProbe`.
- Qualquer alteração no código do `checkout-service`.
- Validação funcional completa do fluxo de compra (isso é o `e2e-flow.sh` do `marketplace-microservicos`, fora do escopo de infra) — aqui valida-se só que o pod sobe, fica `Ready`, e resolve o DNS interno do `products-service`.
- `api-gateway` (spec 06) e `payments-service` (spec 05).

## Critérios de Aceite

1. `docker build -t checkout-service:local ./marketplace-microservicos/checkout-service` roda sem erro.
2. `docker compose up -d` na pasta `checkout-service` sobe o `checkout-db`, acessível em `localhost:5436`.
3. `docker compose up -d` na pasta `messaging-service` sobe o RabbitMQ, acessível em `localhost:5672` (management UI em `localhost:15672`).
4. `kubectl apply -f k8s/apps/checkout-service/` aplica todos os recursos sem erro.
5. `kubectl get pods` mostra os pods do `checkout-service` em `Running`/`Ready` (`1/1`) — isso já confirma que o `readinessProbe` validou Postgres **e** RabbitMQ externos.
6. `kubectl exec <pod-checkout> -- wget -qO- http://products-service/health` retorna `200 OK` — confirma resolução de DNS interno e alcance do `products-service` de dentro do `checkout-service`.
7. `kubectl get svc` mostra `ClusterIP` porta `80` → `3003`.

## Referências

- `docs/specs/02-users-service-deploy-piloto.md`, `docs/specs/03-products-service-deploy.md`.
- `marketplace-microservicos/README.md` — diagrama de arquitetura, chamada HTTP direta checkout → products.
- `marketplace-microservicos/checkout-service/docker-compose.yaml`, `.env` (real), `src/health/health.controller.ts`.
- `marketplace-microservicos/messaging-service/docker-compose.yml` — credenciais do RabbitMQ.
