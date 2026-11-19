FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/archive-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/telegram-collector/archive_worker.py .
COPY services/archive-worker/main.py .
ENV PORT=10000 PYTHONUNBUFFERED=1
CMD ["sh","-c","uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
