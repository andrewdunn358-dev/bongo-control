FROM python:3.11-slim

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

# Placed as late as possible: Docker invalidates every layer AFTER the
# line it changes, not just the line itself. An env var like this has
# no business being above the expensive apt-get/pip install layers —
# putting it here means future changes to it (or to anything else this
# far down) never force a slow recompile of dbus-fast/pycryptodome again.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
