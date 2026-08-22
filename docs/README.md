# Status da migração — marketplace-microservicos no k8s

Documento central de acompanhamento da migração deste repositório de "um app só" (`app-ts`) para os múltiplos microsserviços do `marketplace-microservicos`. Serve pra responder duas perguntas rápidas a qualquer momento: **onde estamos** (status de cada spec) e **por que as coisas estão do jeito que estão** (decisões já tomadas, e o que ainda falta revisitar). Convenções de processo e estrutura de pastas ficam no `CLAUDE.md` — aqui é só status e histórico de decisão, não repete o que já está lá.

Atualizar este arquivo sempre que: uma spec mudar de status, uma decisão nova for tomada, ou uma pendência da lista "o que ainda vai mudar" for resolvida.

## Status das specs

| # | Spec | Status | Observação |
|---|---|---|---|
| 01 | [Organização de pastas](specs/01-organizacao-pastas-multi-servico.md) | ✅ Implementada | Aplicada e commitada (`k8s/apps/<serviço>/`, `k8s-global/rbac/`). |
| 02 | [users-service — piloto](specs/02-users-service-deploy-piloto.md) | ✅ Implementada | Validada no cluster: pods `Ready`, `/health` 200, HPA coletando métricas. |
| 03 | [products-service](specs/03-products-service-deploy.md) | ✅ Implementada | Validada: pod `Ready`, `/health` 200. |
| 04 | [checkout-service](specs/04-checkout-service-deploy.md) | ✅ Implementada | Validada: `/health` 200 (banco + RabbitMQ), alcança `products-service` via DNS interno. |
| 05 | [payments-service](specs/05-payments-service-deploy.md) | ✅ Implementada | Validada: `/health` 200 (banco + RabbitMQ). |
| 06 | [api-gateway](specs/06-api-gateway-deploy.md) | ✅ Implementada | Validada: `/health/live` sempre OK, `/health/ready` reflete status dos 4 downstream — separação liveness/readiness funcionando. |
| 07 | [observability-stack](specs/07-observability-stack-deploy.md) | ✅ Implementada | Validada: Prometheus com 6/6 targets `up`, Grafana com os 2 dashboards provisionados. |
| 08 | [Namespace `marketplace`](specs/08-namespace-marketplace.md) | ✅ Implementada | Namespace criado, retrofit do `users-service` e do `jwt-secret` feito — saíram do `default` e foram reaplicados no `marketplace`. Specs 03-07 já nascem no namespace novo. |

Legenda: ⬜ não iniciada · 📝 spec escrita, aguardando implementação · 🚧 em implementação · ✅ implementada e validada no cluster.

> Ordem de implementação real: 01 → 02 → **08** → 03 → 04 → 05 → 06 → 07. A numeração da spec reflete a ordem em que foi escrita, não necessariamente a ordem de implementação.

**Todas as 8 specs estão implementadas e validadas no cluster (auditado em 2026-08-22).** Achados menores dessa auditoria, sem impacto funcional: sobraram `.gitkeep` em algumas pastas de serviço (removidos); o `Service` do `api-gateway` ficou nomeado `api-gateway-scv` (mantendo o sufixo do `app-ts`) em vez de `api-gateway` como os outros 4 serviços — inconsistente, mas inofensivo, já que nada chama o gateway via DNS interno.

## Decisões arquiteturais já tomadas

Cada uma tem o porquê, porque é isso que evita repetir a mesma discussão daqui a um mês.

### Postgres e RabbitMQ ficam fora do cluster por enquanto
**Decisão:** continuam via `docker-compose` no host, não como recurso k8s.
**Por quê:** o padrão correto pra isso é `StatefulSet`, que ainda não foi estudado. Rodar como `Deployment`+`PVC` funcionaria com 1 réplica, mas não é o jeito certo de tratar dado com estado — preferiu-se não fingir que é, e sim deixar de fora até chegar no módulo certo.
**Revisitar quando:** o estudo chegar em `StatefulSet`. Vira spec própria (ex.: "Postgres do users-service dentro do cluster").

### `JWT_SECRET` é um único Secret compartilhado, não duplicado por serviço
**Decisão:** `k8s/shared/jwt-secret.yaml`, criado uma vez, referenciado no `envFrom` de `users-service`, `checkout-service`, `payments-service` e `api-gateway`.
**Por quê:** os 4 serviços validam o mesmo token — duplicar o valor em 4 Secrets diferentes cria risco de divergência silenciosa (alguém atualiza um e esquece os outros três, e a validação de token quebra sem erro óbvio).
**Nota histórica:** a spec 02 original tratava isso como Secret por serviço; foi corrigida antes de virar padrão nas specs seguintes.

### `RABBITMQ_URL` sempre no Secret, nunca no ConfigMap
**Decisão:** em `checkout-service` e `payments-service`, a URL completa do RabbitMQ (`amqp://admin:admin@host.docker.internal:5672`) vai inteira no `Secret`.
**Por quê:** a URL embute usuário e senha. `RABBITMQ_QUEUE_PAYMENTS` e `RABBITMQ_EXCHANGE` (só nomes, sem credencial) continuam no ConfigMap.

### `livenessProbe` só existe na spec do api-gateway
**Decisão:** `users-service`, `products-service`, `checkout-service` e `payments-service` têm só `startupProbe`+`readinessProbe`, sem `livenessProbe`. O `api-gateway` tem os três.
**Por quê:** o único endpoint de saúde desses 4 serviços (`/health`) depende de infraestrutura externa (Postgres e, em dois casos, também RabbitMQ). Usar isso como liveness faria uma instabilidade passageira do banco/fila reiniciar o pod à toa — o pod devia só ficar `NotReady` (sem tráfego), não morrer. O `api-gateway` tem `/health/live`, que não depende de nada externo, então é o único onde o trio completo de probes faz sentido hoje.
**Revisitar quando:** algum desses 4 serviços ganhar um endpoint de liveness puro (padrão `/health/live` do gateway).

### Prometheus e Grafana entram no cluster sem PVC
**Decisão:** ao contrário de Postgres/RabbitMQ, Prometheus e Grafana (spec 07) rodam como `Deployment` normal, sem volume persistente, direto no cluster.
**Por quê:** não guardam dado de negócio — perder métricas/dashboards num restart é uma perda aceitável pra estudo. Diferente de Postgres/RabbitMQ, que guardam dado real (pedidos, pagamentos, mensagens) e por isso ficam de fora do cluster até existir um jeito correto (`StatefulSet`) de tratá-los.
**Forçado por:** o Prometheus externo (`docker-compose`) fazia scrape via `host.docker.internal:<porta>` — isso deixa de funcionar assim que os serviços viram pods `ClusterIP`. Não tem opção de manter como está.

### Comunicação entre serviços via DNS interno do cluster, não `localhost`
**Decisão:** a partir da spec 04 (`checkout-service` → `products-service`), variáveis como `PRODUCTS_SERVICE_URL` apontam pro nome do `Service` (`http://products-service`), não pra `localhost:<porta>`.
**Por quê:** é o mecanismo padrão do k8s pra service discovery — cada `Service` ganha um DNS interno automático. `localhost` só funciona quando tudo roda na mesma máquina.

### Cluster local = Kubernetes do Docker Desktop
**Decisão:** `kubectl config current-context` → `docker-desktop`. Implica duas coisas usadas em todas as specs: imagem buildada localmente já é visível ao cluster (sem registry), e um pod alcança o host via `host.docker.internal`.
**Revisitar quando:** decidir também simular em nuvem (EKS via `tf/`) — nesse caso essas duas premissas mudam (precisa de registry como ECR, e Postgres/RabbitMQ externos deixam de fazer sentido do jeito atual).

### ~~Sem Namespace dedicado~~ — superada pela spec 08
**Decisão original:** tudo no namespace `default`.
**Por que mudou:** com 5+ serviços do marketplace misturados no `default` junto com o `app-ts` (exemplo de referência) e o material de estudo de RBAC, ficou confuso de visualizar (inclusive no Lens). A spec 08 cria o namespace `marketplace`, só para os recursos do `marketplace-microservicos` — `app-ts` e o material de RBAC continuam no `default`, sem relação com o namespace novo.

### Sem Ingress, Kustomize ou Helm
**Decisão:** `Service` sempre `ClusterIP` (acesso via `port-forward`), manifests em YAML puro repetido por serviço.
**Por quê:** nenhum desses conceitos foi estudado ainda — a migração usa deliberadamente só o vocabulário que o `app-ts` já validava (`Deployment`/`Service`/`ConfigMap`/`Secret`/`HPA`/`PVC`/`Namespace`, este último desde a spec 08).
**Revisitar quando:** cada um for estudado. Kustomize/Helm em particular fazem mais sentido a partir da spec 03 em diante, já que os manifests dos serviços de aplicação são quase idênticos entre si — mas entrar nisso antes de aprender não vale a pena.

### Repositório de infra separado do repositório de aplicação
**Decisão:** código dos microsserviços vive em `marketplace-microservicos` (repo próprio, `github.com/DanielLevi22/marketplace-microservicos`). Este repositório (`kubernets-app`) só tem manifests e terraform. A cópia de `marketplace-microservicos/` aqui dentro é só leitura de referência (Dockerfile, portas, endpoints), ignorada pelo git — nunca é a fonte da verdade.

## O que ainda vai mudar (pendências conhecidas)

- **Postgres e RabbitMQ pra dentro do cluster**, via `StatefulSet`, quando esse módulo for estudado.
- **`livenessProbe`** nos 4 serviços que hoje não têm, quando existir endpoint de liveness que não dependa de infra externa.
- **Ingress** no lugar de `port-forward` pro `api-gateway`, quando estudado — é o único candidato a exposição externa real (os outros 4 continuam internos).
- **Kustomize ou Helm**, pra parar de copiar manualmente o mesmo Deployment/Service/HPA pra cada serviço — decisão em aberto entre os dois, ver a conversa que gerou este documento.
- **Simulação em nuvem via EKS** (`tf/` já tem VPC/EKS/IAM/SG prontos) — muda a resposta de "imagem local" (precisa de registry) e de "Postgres/RabbitMQ externo" (`host.docker.internal` não existe em EKS).
- **Réplicas dos 6 arquivos `.env`/segredos reais** — hoje os valores de `Secret` usados nas specs são os mesmos de desenvolvimento já usados localmente (`postgres`/`postgres`, `dev-secret-change-me`), comitados em claro nos manifests (mesmo padrão que o `app-ts` já usava). Vale revisitar gerenciamento de segredo mais sério (ex.: Sealed Secrets, External Secrets) quando isso virar tópico de estudo — hoje é aceitável por serem credenciais de curso, não de produção.
- **`ResourceQuota`/`LimitRange`/`NetworkPolicy`** no namespace `marketplace` (criado na spec 08) — não estudados ainda, fora de escopo por enquanto.
