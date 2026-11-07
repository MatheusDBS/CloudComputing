const express = require('express');
const os = require('os');
const db = require('./db');
const books = require('./bookClient');
const publisher = require('./publisher');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const POD = process.env.HOSTNAME || os.hostname();

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'UP' }));

router.get('/instance', (req, res) => res.json({ pod: POD }));

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

router.get('/', async (req, res, next) => {
  try {
    res.json(await db.listar(req.query.bookId));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const review = await db.buscar(req.params.id);
    if (!review) return res.status(404).json({ erro: 'Avaliacao nao encontrada' });
    res.json(review);
  } catch (err) {
    next(err);
  }
});

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

app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message);
  res.status(502).json({ erro: err.message });
});

db.init().then(() => {
  publisher.getChannel();
  app.listen(PORT, () => console.log(`[REVIEW] Ouvindo na porta ${PORT} (pod ${POD})`));
});
