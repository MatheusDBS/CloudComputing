const express = require('express');
const os = require('os');
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
const db = require('./db');
const books = require('./bookClient');
const publisher = require('./publisher');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const POD = process.env.HOSTNAME || os.hostname();

// CONFIGURAÇÃO DO SWAGGER / OPENAPI
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Review Service API',
      version: '1.0.0',
      description: 'Documentação da API de Avaliações (Review Service) do projeto Cloud Computing',
    },
    // URL relativa: o "Try it out" usa o mesmo endereco em que o Swagger foi aberto
    // (localhost:3000 no compose ou o Load Balancer do Ingress no EKS).
    servers: [
      {
        url: '/',
        description: 'Mesmo host do Swagger (local ou Ingress)',
      },
    ],
  },
  apis: [__filename], // Lê a documentação JSDoc diretamente deste arquivo
};

const swaggerDocs = swaggerJSDoc(swaggerOptions);
// Fica sob /reviews para ser alcancado pela regra /reviews do Ingress.
app.use('/reviews/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// ROTAS DO MICROSSERVIÇO
const router = express.Router();

/**
 * @swagger
 * /reviews/health:
 *   get:
 *     summary: Verifica a saúde do microsserviço
 *     responses:
 *       200:
 *         description: Microsserviço operacional
 */
router.get('/health', (req, res) => res.json({ status: 'UP' }));

/**
 * @swagger
 * /reviews/instance:
 *   get:
 *     summary: Retorna o ID do Pod atual do review-service
 *     responses:
 *       200:
 *         description: Nome do host/pod respondendo à requisição
 */
router.get('/instance', (req, res) => res.json({ pod: POD }));

/**
 * @swagger
 * /reviews/balanceamento:
 *   get:
 *     summary: Testa o balanceamento de carga e Service Discovery chamando o book-service
 *     parameters:
 *       - in: query
 *         name: n
 *         schema:
 *           type: integer
 *         description: Número de chamadas a serem feitas (padrão 10, máx 100)
 *     responses:
 *       200:
 *         description: Estatísticas de distribuição entre os pods do book-service
 */
// Chama /instance do book-service N vezes pelo nome do Service e conta qual Pod
// respondeu cada chamada: evidencia o balanceamento entre as replicas.
router.get('/balanceamento', async (req, res, next) => {
  try {
    const total = Math.min(Number(req.query.n) || 10, 100);
    const pods = {};
    for (let i = 0; i < total; i++) {
      const { pod } = await books.instancia();
      pods[pod] = (pods[pod] || 0) + 1;
    }
    res.json({ service: books.BOOK_SERVICE_URL, chamadas: total, pods });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /reviews:
 *   get:
 *     summary: Lista todas as avaliações cadastradas
 *     parameters:
 *       - in: query
 *         name: bookId
 *         schema:
 *           type: integer
 *         description: Filtrar avaliações por ID do livro específico
 *     responses:
 *       200:
 *         description: Lista de avaliações retornada com sucesso
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(await db.listar(req.query.bookId));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /reviews/{id}:
 *   get:
 *     summary: Busca uma avaliação específica pelo ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da avaliação
 *     responses:
 *       200:
 *         description: Dados da avaliação encontrada
 *       404:
 *         description: Avaliação não encontrada
 */
router.get('/:id', async (req, res, next) => {
  try {
    const review = await db.buscar(req.params.id);
    if (!review) return res.status(404).json({ erro: 'Avaliacao nao encontrada' });
    res.json(review);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /reviews:
 *   post:
 *     summary: Cria uma nova avaliação de livro
 *     description: Valida o livro via REST no book-service, salva no PostgreSQL e publica evento no RabbitMQ.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookId
 *               - autor
 *               - nota
 *             properties:
 *               bookId:
 *                 type: integer
 *                 example: 1
 *               autor:
 *                 type: string
 *                 example: "João Victor"
 *               nota:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 5
 *               comentario:
 *                 type: string
 *                 example: "Excelente arquitetura cloud native!"
 *     responses:
 *       201:
 *         description: Avaliação criada com sucesso
 *       400:
 *         description: Dados inválidos ou livro inexistente
 */
router.post('/', async (req, res, next) => {
  try {
    const { bookId, autor, nota, comentario } = req.body || {};
    if (!bookId || !autor || !Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ erro: 'Informe bookId, autor e nota inteira de 1 a 5' });
    }

    // Comunicacao sincrona (REST): valida o livro no book-service.
    const livro = await books.buscarLivro(bookId);
    if (!livro) return res.status(400).json({ erro: `Livro ${bookId} nao existe no book-service` });

    const review = await db.salvar({ bookId, autor, nota, comentario });

    // Comunicacao assincrona: o notification-service processa o evento depois.
    await publisher.publicar({
      tipo: 'REVIEW_CREATED',
      reviewId: review.id,
      bookId: review.bookId,
      tituloLivro: livro.titulo,
      autor: review.autor,
      nota: review.nota,
      publicadoPor: POD,
      publicadoEm: new Date().toISOString(),
    });

    res.status(201).json({ ...review, livro: { id: livro.id, titulo: livro.titulo, autor: livro.autor } });
  } catch (err) {
    next(err);
  }
});

app.use('/reviews', router);

// Middleware global de tratamento de erros
app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message);
  res.status(502).json({ erro: err.message });
});

// Inicialização do Banco de Dados, RabbitMQ e Servidor HTTP
db.init().then(() => {
  publisher.getChannel();
  app.listen(PORT, () => console.log(`[REVIEW] Ouvindo na porta ${PORT} (pod ${POD})`));
});