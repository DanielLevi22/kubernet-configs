# kubernets-app

Repositório de estudo de Kubernetes. Contém os manifests de infraestrutura (`k8s/`,
`k8s-global/`) e o terraform de provisionamento (`tf/`) usados para rodar, em cluster, o
projeto de aplicação [`marketplace-microservicos`](https://github.com/DanielLevi22/marketplace-microservicos)
— um marketplace em microsserviços NestJS que vive em repositório próprio (código e specs
de aplicação ficam lá, não aqui).

Este repositório evolui por specs incrementais, documentadas em [`docs/specs/`](docs/specs/):
cada spec migra um serviço (ou um pedaço de infra) do `docker-compose` local para o cluster,
um de cada vez, sempre validado antes de passar para o próximo.

## O que está rodando no cluster hoje

| Spec | Recurso | Descrição |
|---|---|---|
| [01](docs/specs/01-organizacao-pastas-multi-servico.md) | — | Organização de pastas para multi-serviço |
| [02](docs/specs/02-users-service-deploy-piloto.md) | `users-service` | Piloto da migração (autenticação/usuários) |
| [03](docs/specs/03-products-service-deploy.md) | `products-service` | Catálogo de produtos |
| [04](docs/specs/04-checkout-service-deploy.md) | `checkout-service` | Carrinho/checkout — primeiro serviço a chamar outro via DNS interno |
| [05](docs/specs/05-payments-service-deploy.md) | `payments-service` | Consumidor de fila (RabbitMQ), processa pagamentos |
| [06](docs/specs/06-api-gateway-deploy.md) | `api-gateway` | Porta de entrada única, roteia para os 4 serviços acima |
| [07](docs/specs/07-observability-stack-deploy.md) | `observability-stack` | Prometheus + Grafana, dentro do cluster |
| [08](docs/specs/08-namespace-marketplace.md) | `namespace: marketplace` | Todo o `marketplace-microservicos` isolado em namespace próprio |

`app-ts` (em `k8s/apps/app-ts/`) é um serviço de exemplo/referência, sem relação com o
marketplace — continua no namespace `default`. O mesmo vale para o material de estudo de
RBAC em `k8s-global/rbac/`.

## Estrutura

- `k8s/apps/<serviço>/` — manifests de cada aplicação do marketplace.
- `k8s/shared/` — recursos compartilhados entre os serviços do marketplace (`jwt-secret`).
- `k8s-global/` — recursos de escopo de cluster, sem relação com nenhum app específico
  (`metrics-server`, `storageclass`, `persistent-volume`, `rbac/`).
- `tf/` — terraform do cluster EKS (uso apenas quando a atividade for de provisionamento).
- `docs/specs/` — spec de cada atividade (o quê e o porquê, não o como).
- `marketplace-microservicos/` — cópia local **só de leitura/referência** (Dockerfile,
  docker-compose, endpoints de health), ignorada pelo git. Para rodar de verdade, use o
  clone real do [repositório da aplicação](https://github.com/DanielLevi22/marketplace-microservicos).

## Como subir o projeto inteiro localmente

Pré-requisitos: Docker rodando, um cluster Kubernetes local (ex.: Docker Desktop) com
`kubectl` apontando pra ele, e o repositório `marketplace-microservicos` clonado ao lado
deste repositório (os comandos abaixo assumem essa posição):

```bash
git clone https://github.com/DanielLevi22/marketplace-microservicos.git
```

### 0. Recursos de cluster (uma vez só)

O `HorizontalPodAutoscaler` de cada serviço depende do `metrics-server`:

```bash
kubectl apply -f k8s-global/metrics-server.yaml
```

### 1. Bancos de dados e mensageria (fora do cluster, via docker-compose)

Cada serviço com estado continua fora do cluster (decisão do repositório —
`StatefulSet` ainda não foi estudado). Suba o Postgres de cada serviço e o RabbitMQ:

```bash
cd marketplace-microservicos/users-service      && docker compose up -d   # :5433
cd ../products-service                          && docker compose up -d   # :5434
cd ../payments-service                          && docker compose up -d   # :5435
cd ../checkout-service                          && docker compose up -d   # :5436
cd ../messaging-service                         && docker compose up -d   # RabbitMQ :5672, UI :15672 (admin/admin)
```

### 2. Build das imagens

```bash
cd marketplace-microservicos
docker build -t users-service:local    ./users-service
docker build -t products-service:local ./products-service
docker build -t checkout-service:local ./checkout-service
docker build -t payments-service:local ./payments-service
docker build -t api-gateway:local      ./api-gateway
```

### 3. Namespace e Secret compartilhado

```bash
cd kubernets-app
kubectl apply -f k8s/apps/namespace.yaml
kubectl apply -f k8s/shared/jwt-secret.yaml
```

### 4. Aplicar os serviços, na ordem das specs

Cada serviço assume que os anteriores já estão de pé (o `checkout-service` chama o
`products-service` via DNS interno; o `api-gateway` só fica `Ready` quando os 4 serviços de
aplicação respondem):

```bash
kubectl apply -f k8s/apps/users-service/
kubectl apply -f k8s/apps/products-service/
kubectl apply -f k8s/apps/checkout-service/
kubectl apply -f k8s/apps/payments-service/
kubectl apply -f k8s/apps/api-gateway/
kubectl apply -f k8s/apps/observability-stack/
```

Acompanhe cada etapa antes de seguir para a próxima:

```bash
kubectl get pods -n marketplace
```

### 5. Acessar de fora do cluster

Nenhum serviço usa Ingress ou `LoadBalancer` — tudo é `ClusterIP`, acessado via
`kubectl port-forward`:

```bash
kubectl port-forward svc/api-gateway-scv 3005:80 -n marketplace   # API: http://localhost:3005
kubectl port-forward svc/prometheus 9090:9090 -n marketplace      # Prometheus: http://localhost:9090
kubectl port-forward svc/grafana-scv 3010:80 -n marketplace       # Grafana: http://localhost:3010 (admin/admin)
```

Validação rápida:

```bash
curl http://localhost:3005/health/ready   # status agregado dos 4 serviços downstream
```

No Grafana, a pasta "Marketplace" já vem com os dashboards `Marketplace Overview` e
`Service Details` provisionados automaticamente.

### Conveniência (opcional, não versionada)

Para não digitar `-n marketplace` em todo comando:

```bash
kubectl config set-context --current --namespace=marketplace
```

## Convenções

Ver [`CLAUDE.md`](CLAUDE.md) para as convenções seguidas na escrita dos manifests
(probes, `Secret` compartilhado, namespace explícito, recursos ainda fora de escopo).
