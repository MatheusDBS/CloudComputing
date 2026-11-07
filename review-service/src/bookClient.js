const http = require('http');

// Service Discovery: o endereco e o nome do Service Kubernetes, nunca o IP de um Pod.
const BOOK_SERVICE_URL = process.env.BOOK_SERVICE_URL || 'http://localhost:8080';

// agent: false abre uma conexao nova por requisicao, permitindo que o Service
// distribua cada chamada para um Pod diferente do book-service.
function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(new URL(path, BOOK_SERVICE_URL), { agent: false, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`book-service respondeu ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ao chamar book-service')));
    req.on('error', reject);
  });
}

const buscarLivro = (id) => getJson(`/books/${encodeURIComponent(id)}`);
const instancia = () => getJson('/instance');

module.exports = { BOOK_SERVICE_URL, buscarLivro, instancia };
