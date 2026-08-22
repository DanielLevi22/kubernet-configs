# kubernets-app

Repositório de estudo de Kubernetes. Contém os manifests de infraestrutura (`k8s/`, `k8s-global/`) e o terraform de provisionamento (`tf/`) usados para rodar, em cluster, o projeto de aplicação `marketplace-microservicos` — um marketplace em microsserviços NestJS que vive em **repositório próprio** (`github.com/DanielLevi22/marketplace-microservicos`, código e specs de aplicação ficam lá, não aqui).

Por ser projeto de estudo, os manifests devem usar só o que já foi estudado até o momento — hoje isso é `Deployment`, `Service`, `ConfigMap`, `Secret`, `HorizontalPodAutoscaler` e `PersistentVolumeClaim`. Não introduzir `StatefulSet`, `Ingress`, `Namespace` dedicado, Kustomize ou Helm antes de terem sido estudados e combinados explicitamente — a spec de cada atividade deve declarar isso em "Fora de Escopo" quando relevante.

## Estrutura

- `k8s/apps/<serviço>/` — manifests de cada aplicação (`app-ts` é o exemplo original/validado; `users-service`, `products-service`, `checkout-service`, `payments-service`, `api-gateway` são os alvos da migração, um de cada vez).
- `k8s-global/` — recursos de escopo de cluster, não ligados a nenhum app específico (`metrics-server`, `storageclass`, `persistent-volume`, e `rbac/` com manifests de estudo de RBAC/ServiceAccount).
- `tf/` — terraform do cluster EKS (VPC, IAM, SG, módulo de SQS/EventBridge/Karpenter). Alterar só quando a atividade for especificamente de provisionamento de infra.
- `docs/specs/` — specs deste repositório (migração dos manifests, decisões de estrutura), numeradas sequencialmente (`01-nome.md`, `02-nome.md`...).
- `marketplace-microservicos/` — cópia local **só de leitura/referência** (Dockerfile, portas, endpoints de health de cada serviço), ignorada pelo git. Nunca é a fonte da verdade; o código real está no repositório próprio.

## Fluxo de trabalho

Mesma disciplina do projeto de aplicação, adaptada para manifests de infra:

1. **Spec** — documento de requisitos (o quê e o porquê, não o como), salvo em `docs/specs/NN-nome-da-atividade.md`, com diagrama mermaid do resultado esperado (ex.: estrutura de pastas antes/depois, ou fluxo de tráfego entre os recursos).
2. **Validação de escopo** — spec revisada e alinhada antes de qualquer manifest ser escrito.
3. **Aplicação incremental** — implementar exatamente o que a spec descreve, um serviço/recurso por vez. Validar cada etapa (`kubectl apply`, `kubectl get pods`, checar readiness/health) antes de passar pra próxima spec.
4. **Não pular etapas** — não escrever manifest sem spec, não considerar a atividade pronta sem validar no cluster.

## Convenções

- Nomes de pasta por serviço seguem exatamente os nomes usados no `marketplace-microservicos` (`users-service`, `products-service`, etc.).
- Probes de `Deployment` reaproveitam os endpoints que cada serviço NestJS já expõe (`/health`, `/health/live`), no mesmo padrão de `startupProbe`/`readinessProbe`/`livenessProbe` já usado no `app-ts`.
- `JWT_SECRET` é compartilhado entre os serviços de aplicação (`api-gateway`, `users-service`, `checkout-service`, `payments-service`) — um único `Secret`, referenciado no `envFrom` de cada `Deployment`, não duplicado por serviço.
- Sem namespace dedicado por enquanto — tudo no namespace `default`, igual ao `app-ts` hoje.
