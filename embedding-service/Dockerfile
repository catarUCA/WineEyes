FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    FlagEmbedding \
    numpy \
    requests \
    python-dotenv

COPY server.py .

ENV EMBED_MODEL=BAAI/bge-m3
ENV EMBED_PORT=8002

EXPOSE 8002

CMD ["python", "server.py"]
