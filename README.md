# BookGather — Avaliação Somativa N2 (Cloud Native no Amazon EKS)

Aplicação de catálogo e avaliação de livros composta por quatro microsserviços independentes,
implantada no **Amazon EKS**, com **Database per Service**, **REST**, **RabbitMQ**,
**Service Discovery**, **escalabilidade horizontal** e **NGINX Ingress Controller**.

Baseada nos laboratórios **Back L06 — Kubernetes na AWS EKS** e **Back L07 — Mensageria com RabbitMQ**.

## Arquitetura

```
                        CLIENTE / BROWSER
                               |
                    AWS Network Load Balancer
                               |
                    NGINX Ingress Controller
                     (bookgather-ingress)
          /books /instance /swagger-ui  |  /reviews  |  /notifications
                 |                      |                   |
                 v                      v                   v
        Service book-service   Service review-service   Service notification-service
                 |                      |                   ^
       +---------+---------+            |                   |
       v         v         v            |   REST (sync)     |
     Pod 1     Pod 2     Pod 3  <-------+  GET /books/{id}  |
       (Java / Spring Boot)             |                   |
                 |                 Pod review          Pod notification
                 v                 (Node.js)           (Python)
      Service mysql-bookgather          |                   ^
                 |                      v                   |
               MySQL         Service postgres-review        |
              (bookdb)                  |                   |
                                   PostgreSQL               |
                                   (reviewdb)               |
                                        |                   |
                                        +--> RabbitMQ ------+
                                     fila review.created (async)

   /shelves --> Service shelf-service --> Pod shelf (Python) --> Service mongo-shelf --> MongoDB
                        |                                                               (shelfdb)
                        +-- REST (sync) GET http://book-service:8080/books/{id}
```

### Fluxo integrado

1. `POST /reviews` chega pelo Ingress ao **review-service**.
2. O review-service chama **de forma síncrona** `GET http://book-service:8080/books/{id}`
   (nome do Service, sem IP de Pod) para validar o livro.
3. A avaliação é gravada no **PostgreSQL** do review-service.
4. O review-service publica o evento `REVIEW_CREATED` na fila **`review.created`** do RabbitMQ.
5. O **notification-service** consome o evento **de forma assíncrona**, simula o envio (1,5 s)
   e disponibiliza a notificação em `GET /notifications`.

Em paralelo, o **shelf-service** (estante de leitura) também consulta o book-service por REST
antes de adicionar um livro à estante de um usuário, e grava no seu próprio **MongoDB**.

## Microsserviços e responsáveis

| Microsserviço | Responsabilidade | Linguagem | Banco | Porta | Réplicas | Responsável |
|---|---|---|---|---|---|---|
| `book-service` | Catálogo de livros (CRUD) | Java 17 / Spring Boot | MySQL 8.4 | 8080 | **3** | Matheus De Bortoli Silva |
| `review-service` | Avaliações de livros; valida o livro via REST e publica eventos | Node.js 20 / Express | PostgreSQL 16 | 3000 | 1 | João Victor Saboya Ribeiro de Carvalho |
| `notification-service` | Consome eventos e gera notificações | Python 3.12 / Flask + pika | — (memória) | 5000 | 1 | Arthur de Oliveira Carvalho |
| `shelf-service` | Estante de leitura por usuário (quero ler / lendo / lido); valida o livro via REST | Python 3.12 / Flask + pymongo | MongoDB 7 | 5001 | 1 | Caio Lamoglia |

> Preencha a coluna **Responsável**: cada integrante apresenta o seu microsserviço.

### Endpoints

| Método | Caminho | Serviço |
|---|---|---|
| GET/POST | `/books` | book-service |
| GET/PUT/DELETE | `/books/{id}` | book-service |
| GET | `/instance` | book-service (retorna o Pod que respondeu) |
| GET | `/swagger-ui/index.html` | book-service |
| GET/POST | `/reviews` (`?bookId=1` para filtrar) | review-service |
| GET | `/reviews/{id}` | review-service |
| GET | `/reviews/balanceamento?n=20` | review-service chama `/instance` do book-service N vezes e conta os Pods |
| GET | `/reviews/instance` | review-service |
| GET | `/reviews/api-docs` | review-service (Swagger) |
| GET | `/notifications` | notification-service |
| GET/POST | `/shelves` (`?usuario=ana` para filtrar) | shelf-service |
| PUT/DELETE | `/shelves/{id}` (PUT altera o `status`) | shelf-service |

## Atendimento aos requisitos

| # | Requisito | Onde |
|---|---|---|
| 1 | Desenvolvimento individual | 4 microsserviços com responsabilidades distintas (tabela acima) |
| 2 | Diversidade tecnológica | Java, Node.js e Python; MySQL, PostgreSQL e MongoDB |
| 3 | Conteinerização | Um `Dockerfile` em cada pasta de microsserviço |
| 4 | Amazon EKS | `aws/eks-cluster-academy.yaml` + Deployments/Services em `k8s/` |
| 5 | Database per Service | `k8s/mysql.yaml` (só book-service) e `k8s/postgres.yaml` (só review-service), `k8s/mongo.yaml` (só shelf-service), Secrets separados |
| 6 | Comunicação síncrona | `review-service/src/bookClient.js` e `shelf-service/app.py` → `GET /books/{id}` |
| 7 | Comunicação assíncrona | `review-service/src/publisher.js` → fila `review.created` → `notification-service/app.py` |
| 8 | Service Discovery | `BOOK_SERVICE_URL=http://book-service:8080`, `DB_HOST=postgres-review`, `RABBITMQ_HOST=rabbitmq` |
| 9 | Escalabilidade horizontal | `book-service` com `replicas: 3`; `/instance` e `/reviews/balanceamento` |
| 10 | Ingress | `k8s/ingress.yaml` com regras por caminho para os 4 serviços |

## Estrutura

```
.
├── aws/eks-cluster-academy.yaml   # ClusterConfig do eksctl (infraestrutura)
├── book-service/                  # Java / Spring Boot / MySQL
├── review-service/                # Node.js / Express / PostgreSQL / RabbitMQ (producer)
├── notification-service/          # Python / Flask / RabbitMQ (consumer)
├── shelf-service/                 # Python / Flask / MongoDB
├── k8s/                           # Manifests Kubernetes (kubectl apply -k k8s)
├── docker-compose.yml             # Ambiente local de desenvolvimento
└── demo.http                      # Requisições do roteiro de demonstração
```

## Execução local (desenvolvimento)

Com o Docker Desktop em execução:

```powershell
docker compose up --build
```

- book-service: http://localhost:8080/swagger-ui/index.html
- review-service: http://localhost:3000/reviews
- notification-service: http://localhost:5000/notifications
- shelf-service: http://localhost:5001/shelves
- RabbitMQ Management: http://localhost:15672 (`bookgather` / `change-me-lab`)

## Implantação no Amazon EKS

Execute os comandos no PowerShell, a partir da raiz deste repositório.

### 1. Publicar as imagens no Docker Hub

O EKS não enxerga imagens locais (no Minikube usávamos `minikube image build`).
As imagens precisam estar em um registry público.

```powershell
docker login
$U = "SEU_USUARIO_DOCKERHUB"

docker build -t "$U/bookgather-book-service:1.0.0" ./book-service
docker build -t "$U/bookgather-review-service:1.0.0" ./review-service
docker build -t "$U/bookgather-notification-service:1.0.0" ./notification-service
docker build -t "$U/bookgather-shelf-service:1.0.0" ./shelf-service

docker push "$U/bookgather-book-service:1.0.0"
docker push "$U/bookgather-review-service:1.0.0"
docker push "$U/bookgather-notification-service:1.0.0"
docker push "$U/bookgather-shelf-service:1.0.0"
```

Depois, em `k8s/kustomization.yaml`, substitua `SEU_USUARIO_DOCKERHUB` pelo seu usuário.

### 2. Autenticar no AWS Academy

No Learner Lab: **Start Lab** → **AWS Details** → copie as credenciais temporárias.

```powershell
$env:AWS_ACCESS_KEY_ID="..."
$env:AWS_SECRET_ACCESS_KEY="..."
$env:AWS_SESSION_TOKEN="..."
$env:AWS_DEFAULT_REGION="us-east-1"

aws sts get-caller-identity
aws --version; kubectl version --client; eksctl version
```

> Nunca coloque as credenciais no Git.

### 3. Criar o cluster

Liste as roles do Academy e copie os ARNs para `aws/eks-cluster-academy.yaml`:

```powershell
aws iam list-roles --query "Roles[?contains(RoleName, 'LabEks')].[RoleName,Arn]" --output table
```

```powershell
eksctl create cluster -f aws/eks-cluster-academy.yaml --dry-run
eksctl create cluster -f aws/eks-cluster-academy.yaml
```

(Alternativa: criar pelo Console — cluster `bookgather` com `LabEksClusterRole` e node group
`bookgather-nodes` com `LabEksNodeRole`, 2 × t3.medium.)

```powershell
aws eks update-kubeconfig --region us-east-1 --name bookgather
kubectl get nodes
```

### 4. Instalar o NGINX Ingress Controller

```powershell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/aws/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=300s
kubectl get service ingress-nginx-controller -n ingress-nginx
```

Aguarde o `EXTERNAL-IP` (DNS do Load Balancer) aparecer.

### 5. Implantar a aplicação

```powershell
kubectl apply -k k8s

kubectl rollout status deployment/rabbitmq --timeout=300s
kubectl rollout status deployment/mysql-bookgather --timeout=300s
kubectl rollout status deployment/postgres-review --timeout=300s
kubectl rollout status deployment/book-service --timeout=300s
kubectl rollout status deployment/review-service --timeout=300s
kubectl rollout status deployment/notification-service --timeout=300s
kubectl rollout status deployment/mongo-shelf --timeout=300s
kubectl rollout status deployment/shelf-service --timeout=300s

kubectl get pods -o wide
kubectl get services
kubectl get ingress
```

> O `book-service` pode reiniciar algumas vezes enquanto o MySQL inicializa; isso é esperado.
> Os bancos e o RabbitMQ usam `emptyDir` porque o EKS do Learner Lab não tem o driver EBS CSI
> (um PVC ficaria `Pending`). Os dados existem enquanto o Pod existir.

## Roteiro de demonstração

Defina o endereço público:

```powershell
$H = (kubectl get service ingress-nginx-controller -n ingress-nginx -o jsonpath="{.status.loadBalancer.ingress[0].hostname}")
```

**1. Arquitetura em execução no EKS** — Pods distribuídos nos nodes EC2 (coluna `NODE`):

```powershell
kubectl get nodes
kubectl get deployments,pods,services,ingress -o wide
```

**2. Ingress / acesso externo** — abra `http://$H/swagger-ui/index.html`.

**3. Cadastrar um livro (book-service, MySQL)**:

```powershell
Invoke-RestMethod -Method Post -Uri "http://$H/books" -ContentType "application/json" `
  -Body '{"titulo":"O Nome do Vento","autor":"Patrick Rothfuss","isbn":"978-0756404079","anoPublicacao":2007}'
```

**4. Escalabilidade e balanceamento** — repita e observe Pods diferentes:

```powershell
1..10 | ForEach-Object { (Invoke-RestMethod "http://$H/instance").pod }
Invoke-RestMethod "http://$H/reviews/balanceamento?n=30"
```

O segundo comando mostra o balanceamento **interno**: o review-service chama o Service
`book-service` 30 vezes e conta quantas respostas vieram de cada Pod.

**5. Fluxo REST + RabbitMQ** — criar uma avaliação:

```powershell
Invoke-RestMethod -Method Post -Uri "http://$H/reviews" -ContentType "application/json" `
  -Body '{"bookId":1,"autor":"Ana","nota":5,"comentario":"Excelente"}'

kubectl logs deployment/review-service --tail=20
kubectl logs deployment/notification-service --tail=20
Invoke-RestMethod "http://$H/notifications"
```

Com `bookId` inexistente (ex.: 999) a resposta é **400**: prova de que a validação REST no book-service ocorre.

**5b. Estante de leitura (shelf-service, MongoDB)**:

```powershell
$item = Invoke-RestMethod -Method Post -Uri "http://$H/shelves" -ContentType "application/json" `
  -Body '{"usuario":"ana","bookId":1,"status":"LENDO"}'
Invoke-RestMethod -Method Put -Uri "http://$H/shelves/$($item.id)" -ContentType "application/json" -Body '{"status":"LIDO"}'
Invoke-RestMethod "http://$H/shelves?usuario=ana"
```

Adicionar o mesmo livro de novo retorna **409**; um livro inexistente retorna **400** (validação REST no book-service).

**6. Fila acumulando (assincronismo)**:

```powershell
kubectl scale deployment/notification-service --replicas=0
# crie 2 ou 3 avaliações; elas continuam retornando 201
kubectl port-forward svc/rabbitmq 15672:15672   # outro terminal; http://localhost:15672 → Queues → review.created
kubectl scale deployment/notification-service --replicas=1
```

**7. Service Discovery** — Pod temporário dentro do cluster:

```powershell
kubectl run teste --image=curlimages/curl -it --rm -- sh
# dentro do Pod:
curl http://book-service:8080/books
curl http://review-service:3000/reviews
curl http://notification-service:5000/notifications
curl http://shelf-service:5001/shelves
```

**8. Isolamento da persistência** — cada banco só contém os dados do seu serviço:

```powershell
kubectl exec -it deployment/mysql-bookgather -- mysql -uroot -plabbook123 -e "SHOW TABLES FROM bookdb;"
kubectl exec -it deployment/postgres-review -- psql -U review -d reviewdb -c "\dt"
kubectl exec -it deployment/mongo-shelf -- mongosh -u shelf -p labshelf123 --quiet --eval "db.getSiblingDB('shelfdb').getCollectionNames()"
```

**9. Autorrecuperação** (opcional):

```powershell
kubectl delete pod -l app=book-service --wait=false
kubectl get pods -w
```

## Remover o ambiente (controle de custos)

```powershell
kubectl delete -k k8s
kubectl delete -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/aws/deploy.yaml
eksctl delete cluster -f aws/eks-cluster-academy.yaml
aws eks list-clusters --region us-east-1
```

Remova o Ingress Controller **antes** do cluster para que o Load Balancer da AWS seja apagado.
