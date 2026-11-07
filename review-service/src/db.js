const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'reviewdb',
  user: process.env.DB_USER || 'review',
  password: process.env.DB_PASSWORD || 'review',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O Postgres pode demorar a subir no cluster: tenta criar a tabela ate conseguir.
async function init() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id SERIAL PRIMARY KEY,
          book_id BIGINT NOT NULL,
          autor VARCHAR(120) NOT NULL,
          nota INT NOT NULL CHECK (nota BETWEEN 1 AND 5),
          comentario TEXT,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      console.log('[DB] PostgreSQL pronto');
      return;
    } catch (err) {
      console.log(`[DB] Aguardando PostgreSQL (tentativa ${tentativa}): ${err.message}`);
      await sleep(3000);
    }
  }
}

function toReview(row) {
  return {
    id: row.id,
    bookId: Number(row.book_id),
    autor: row.autor,
    nota: row.nota,
    comentario: row.comentario,
    criadoEm: row.criado_em,
  };
}

async function listar(bookId) {
  const result = bookId
    ? await pool.query('SELECT * FROM reviews WHERE book_id = $1 ORDER BY id', [bookId])
    : await pool.query('SELECT * FROM reviews ORDER BY id');
  return result.rows.map(toReview);
}

async function buscar(id) {
  const result = await pool.query('SELECT * FROM reviews WHERE id = $1', [id]);
  return result.rows[0] ? toReview(result.rows[0]) : null;
}

async function salvar({ bookId, autor, nota, comentario }) {
  const result = await pool.query(
    'INSERT INTO reviews (book_id, autor, nota, comentario) VALUES ($1, $2, $3, $4) RETURNING *',
    [bookId, autor, nota, comentario]
  );
  return toReview(result.rows[0]);
}

module.exports = { init, listar, buscar, salvar };
