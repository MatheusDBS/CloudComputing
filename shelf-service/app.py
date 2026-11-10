import json
import os
import socket
import urllib.error
import urllib.request
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Flask, jsonify, request
from pymongo import MongoClient

POD = os.getenv("HOSTNAME", socket.gethostname())
STATUS_VALIDOS = {"QUERO_LER", "LENDO", "LIDO"}

# Service Discovery: o book-service e encontrado pelo nome do Service Kubernetes.
BOOK_SERVICE_URL = os.getenv("BOOK_SERVICE_URL", "http://localhost:8080")

mongo = MongoClient(
    host=os.getenv("MONGO_HOST", "localhost"),
    port=int(os.getenv("MONGO_PORT", "27017")),
    username=os.getenv("MONGO_USER", "shelf"),
    password=os.getenv("MONGO_PASSWORD", "shelf"),
    authSource="admin",
    serverSelectionTimeoutMS=5000,
)
estantes = mongo[os.getenv("MONGO_DB", "shelfdb")]["estantes"]

app = Flask(__name__)


def buscar_livro(book_id):
    """Comunicacao sincrona (REST): consulta o livro no book-service."""
    try:
        with urllib.request.urlopen(f"{BOOK_SERVICE_URL}/books/{book_id}", timeout=5) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise


def to_json(doc):
    doc["id"] = str(doc.pop("_id"))
    return doc


def buscar_por_id(item_id):
    try:
        return estantes.find_one({"_id": ObjectId(item_id)})
    except InvalidId:
        return None


@app.get("/shelves/health")
def health():
    return jsonify({"status": "UP", "pod": POD})


@app.get("/shelves")
def listar():
    filtro = {}
    if request.args.get("usuario"):
        filtro["usuario"] = request.args["usuario"]
    return jsonify([to_json(doc) for doc in estantes.find(filtro)])


@app.post("/shelves")
def adicionar():
    dados = request.get_json(silent=True) or {}
    usuario = dados.get("usuario")
    book_id = dados.get("bookId")
    status = dados.get("status", "QUERO_LER")

    if not usuario or not isinstance(book_id, int) or status not in STATUS_VALIDOS:
        return jsonify({"erro": f"Informe usuario, bookId inteiro e status em {sorted(STATUS_VALIDOS)}"}), 400

    try:
        livro = buscar_livro(book_id)
    except (urllib.error.URLError, TimeoutError) as err:
        return jsonify({"erro": f"book-service indisponivel: {err}"}), 502
    if livro is None:
        return jsonify({"erro": f"Livro {book_id} nao existe no book-service"}), 400

    # Um livro aparece uma unica vez na estante de cada usuario.
    if estantes.find_one({"usuario": usuario, "bookId": book_id}):
        return jsonify({"erro": "Livro ja esta na estante deste usuario"}), 409

    item = {
        "usuario": usuario,
        "bookId": book_id,
        "tituloLivro": livro.get("titulo"),
        "status": status,
        "adicionadoEm": datetime.now(timezone.utc).isoformat(),
    }
    estantes.insert_one(item)
    return jsonify(to_json(item)), 201


@app.put("/shelves/<item_id>")
def atualizar_status(item_id):
    status = (request.get_json(silent=True) or {}).get("status")
    if status not in STATUS_VALIDOS:
        return jsonify({"erro": f"status deve ser um de {sorted(STATUS_VALIDOS)}"}), 400
    item = buscar_por_id(item_id)
    if item is None:
        return jsonify({"erro": "Item nao encontrado"}), 404
    estantes.update_one({"_id": item["_id"]}, {"$set": {"status": status}})
    item["status"] = status
    return jsonify(to_json(item))


@app.delete("/shelves/<item_id>")
def remover(item_id):
    item = buscar_por_id(item_id)
    if item is None:
        return jsonify({"erro": "Item nao encontrado"}), 404
    estantes.delete_one({"_id": item["_id"]})
    return "", 204


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5001")))
