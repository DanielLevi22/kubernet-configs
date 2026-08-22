# Spec: Deploy do payments-service no cluster local

## Contexto

Com `users-service`, `products-service` e `checkout-service` já validados no cluster, esta spec traz o `payments-service` — o consumidor da mensageria assíncrona. Segundo o `README.md`, o `checkout-service` publica em `payment.order` (exchange `payments`) e o `payments-service` consome de `payment_queue` (prefetch 1), decidindo aprovação/rejeição via `FakePaymentGatewayService` (determinístico, sem chamada externa real).

O `payments-service` é NestJS + TypeORM, porta `3004`. `docker-compose.yaml` sobe Postgres (`payments-db`, database `payments_db`, `postgres`/`postgres`) em `localhost:5435`. Mesma situação do `checkout-service`: `GET /health` verifica Postgres e RabbitMQ (ambos externos, fora do cluster por decisão já alinhada).

## Objetivo

Colocar o `payments-service` rodando no cluster, consumindo do RabbitMQ externo e persistindo no Postgres externo, com os mesmos endereços internos dos outros serviços já configurados (ainda que a comunicação real com eles, nesta etapa, seja majoritariamente via fila, não HTTP).

## Requisitos Funcionais

### RF01 — Build da imagem local
Construir a imagem localmente a partir do `Dockerfile` do `payments-service`, tag `payments-service:local`.

### RF02 — ConfigMap com variáveis não sensíveis
Criar `k8s/apps/payments-service/configmap.yaml`: `PORT=3004`, `NODE_ENV=production`, `DB_HOST=host.docker.internal`, `DB_PORT=5435`, `DB_USERNAME=postgres`, `DB_DATABASE=payments_db`, `JWT_EXPIRES_IN=24h`, `RABBITMQ_QUEUE_PAYMENTS=payment-queue`, `RABBITMQ_EXCHANGE=payments`, `USERS_SERVICE_URL=http://users-service`, `PRODUCTS_SERVICE_URL=http://products-service`, `CHECKOUT_SERVICE_URL=http://checkout-service`, `PAYMENT_GATEWAY_URL=https://api.stripe.com/v1` (valor de estudo, o `FakePaymentGatewayService` não faz chamada real).

### RF03 — Secret com variáveis sensíveis do próprio serviço
Criar `k8s/apps/payments-service/secret.yaml` com `DB_PASSWORD` (base64), `RABBITMQ_URL` (base64, `amqp://admin:admin@host.docker.internal:5672`) e `PAYMENT_GATEWAY_API_KEY` (base64, valor de estudo).

### RF04 — Deployment
Criar `k8s/apps/payments-service/deployment.yaml`: mesmo padrão de rollout (3 réplicas, `RollingUpdate` `maxSurge: 2`/`maxUnavailable: 1`), container na porta `3004`, três `envFrom` (`configmap` RF02, `secret` RF03, `secret` compartilhado `jwt-secret`), mesmos `resources` de ponto de partida.

### RF05 — Probes
`startupProbe` e `readinessProbe` em `GET /health`. Sem `livenessProbe`, mesma justificativa das specs anteriores (Postgres + RabbitMQ externos).

### RF06 — Service
Criar `k8s/apps/payments-service/service.yaml`, `ClusterIP`, porta `80` → `3004`.

### RF07 — HPA
Criar `k8s/apps/payments-service/hpa.yaml`, mesmo padrão (CPU 75%, memória 80%, `minReplicas: 3`, `maxReplicas: 8`).

## Fluxo Esperado

```mermaid
flowchart TD
    A[docker build -t payments-service:local] --> B[docker compose up -d payments-db :5435]
    B --> C{RabbitMQ ja esta no ar? messaging-service}
    C -->|Nao| D[docker compose up -d no messaging-service]
    C -->|Sim, ja rodando desde a spec 04| E[kubectl apply -f k8s/apps/payments-service/]
    D --> E
    E --> F[Deployment cria os pods]
    F --> G[startupProbe + readinessProbe: GET /health]
    G -->|Postgres ok e RabbitMQ ok| H[Pod Ready]
    H --> I[Consumer prefetch 1 escuta payment_queue]
    I --> J[Mensagem publicada pelo checkout-service e processada]
```

## Fora de Escopo

- Trazer Postgres ou RabbitMQ para dentro do cluster.
- `livenessProbe`.
- Qualquer alteração no código do `payments-service`.
- Endpoints de DLQ (`/dlq/*`) — já existem no código, não são objeto desta spec de infra.
- Validação funcional completa do fluxo de pagamento — isso é `e2e-flow.sh`, fora do escopo de infra.
- `api-gateway` (spec 06).

## Critérios de Aceite

1. `docker build -t payments-service:local ./marketplace-microservicos/payments-service` roda sem erro.
2. `docker compose up -d` na pasta `payments-service` sobe o `payments-db`, acessível em `localhost:5435`.
3. RabbitMQ acessível em `localhost:5672` (subido na spec 04, ou via `docker compose up -d` no `messaging-service` se ainda não estiver no ar).
4. `kubectl apply -f k8s/apps/payments-service/` aplica todos os recursos sem erro.
5. `kubectl get pods` mostra os pods do `payments-service` em `Running`/`Ready` (`1/1`).
6. Publicar manualmente uma mensagem de teste em `payment_queue` (via management UI do RabbitMQ, `localhost:15672`) e confirmar nos logs do pod (`kubectl logs`) que o `payments-service` consumiu.
7. `kubectl get svc` mostra `ClusterIP` porta `80` → `3004`.

## Referências

- `docs/specs/02-users-service-deploy-piloto.md`, `docs/specs/04-checkout-service-deploy.md`.
- `marketplace-microservicos/README.md` — seção "Mensageria assíncrona (RabbitMQ)".
- `marketplace-microservicos/payments-service/docker-compose.yaml`, `.env` (real), `src/health/health.controller.ts`.
