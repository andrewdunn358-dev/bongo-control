FROM python:3.11-slim

# Unbuffered stdout/stderr - without this, `docker compose logs -f` shows
# nothing until Python's internal buffer fills or the process exits,
# which makes live debugging (e.g. watching a plugin start up) useless.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Fallback for any dependency without a prebuilt wheel for this
# architecture (notably pycryptodome, a transitive dep of victron-ble,
# on 32-bit ARM/armv7 — Raspberry Pi 2/3). Most dependencies do have
# prebuilt wheels and won't need this, but when one doesn't, failing to
# compile it at all (no C compiler) is worse than the extra ~60s this
# install costs on every fresh build.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
