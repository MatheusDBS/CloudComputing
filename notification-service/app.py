import json
import os
import socket
import threading
import time
from collections import deque
from datetime import datetime, timezone

import pika
from flask import Flask, jsonify

QUEUE = "review.created"
POD = os.getenv("HOSTNAME", socket.gethostname())

# Notificacoes processadas ficam em memoria: o servico nao precisa de banco proprio.
notificacoes = deque(maxlen=200)
lock = threading.Lock()

app = Flask(__name__)


def log(msg):
    print(msg, flush=True)


def processar(ch, method, properties, body):
    try:
        evento = json.loads(body)
    except json.JSONDecodeError:
        log(f"[NOTIFICATION] Mensagem invalida descartada: {body!r}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        return
    log(f"[NOTIFICATION] Iniciando processamento: {evento}")
    time.sleep(1.5)  # simula o envio; nenhum e-mail real e enviado
    notificacao = {
        "mensagem": f"{evento.get('autor')} avaliou '{evento.get('tituloLivro')}' com nota {evento.get('nota')}",
        "evento": evento,
        "processadoPor": POD,
        "processadoEm": datetime.now(timezone.utc).isoformat(),
    }
    with lock:
        notificacoes.appendleft(notificacao)
    ch.basic_ack(delivery_tag=method.delivery_tag)
    log(f"[NOTIFICATION] Concluido: {notificacao['mensagem']}")


def consumir():
    credentials = pika.PlainCredentials(
        os.getenv("RABBITMQ_USER", "bookgather"),
        os.getenv("RABBITMQ_PASSWORD", "change-me-lab"),
    )
    params = pika.ConnectionParameters(
        host=os.getenv("RABBITMQ_HOST", "localhost"),
        port=int(os.getenv("RABBITMQ_PORT", "5672")),
        credentials=credentials,
        heartbeat=30,
    )
    while True:
        try:
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            channel.queue_declare(queue=QUEUE, durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=QUEUE, on_message_callback=processar)
            log(f"[NOTIFICATION] Aguardando mensagens na fila {QUEUE}")
            channel.start_consuming()
        except pika.exceptions.AMQPError as err:
            log(f"[NOTIFICATION] RabbitMQ indisponivel, nova tentativa em 3s: {err!r}")
            time.sleep(3)


@app.get("/notifications")
def listar():
    with lock:
        return jsonify(list(notificacoes))


@app.get("/notifications/health")
def health():
    return jsonify({"status": "UP", "pod": POD})


if __name__ == "__main__":
    threading.Thread(target=consumir, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
