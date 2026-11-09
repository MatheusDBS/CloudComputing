const amqp = require('amqplib');

const QUEUE = 'review.created';

const url = () => {
  const user = encodeURIComponent(process.env.RABBITMQ_USER || 'bookgather');
  const pass = encodeURIComponent(process.env.RABBITMQ_PASSWORD || 'change-me-lab');
  const host = process.env.RABBITMQ_HOST || 'localhost';
  const port = process.env.RABBITMQ_PORT || 5672;
  // RabbitMQ 4.1 exige frame_max >= 8192; o padrao do amqplib (4096) e recusado.
  return `amqp://${user}:${pass}@${host}:${port}?frameMax=131072`;
};

let channel = null;
let connecting = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const connection = await amqp.connect(url());
      connection.on('close', () => {
        console.log('[RABBITMQ] Conexao encerrada, reconectando...');
        channel = null;
        getChannel();
      });
      connection.on('error', (err) => console.log(`[RABBITMQ] Erro: ${err.message}`));
      const ch = await connection.createChannel();
      await ch.assertQueue(QUEUE, { durable: true });
      console.log('[RABBITMQ] Conectado, fila', QUEUE, 'declarada');
      return ch;
    } catch (err) {
      console.log(`[RABBITMQ] Aguardando broker (tentativa ${tentativa}): ${err.message}`);
      await sleep(3000);
    }
  }
}

function getChannel() {
  if (channel) return Promise.resolve(channel);
  if (!connecting) {
    connecting = connect().then((ch) => {
      channel = ch;
      connecting = null;
      return ch;
    });
  }
  return connecting;
}

async function publicar(evento) {
  const ch = await getChannel();
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(evento)), {
    persistent: true,
    contentType: 'application/json',
  });
  console.log('[RABBITMQ] Publicado', evento.tipo, 'review', evento.reviewId);
}

module.exports = { getChannel, publicar };
