FROM python:3.11-slim

WORKDIR /app

# --- Layer ordering matters enormously on slow ARM hardware ---
# Docker invalidates every layer AFTER one that changes. The pip layer
# below is by far the most expensive thing in this build, so anything
# likely to change must sit BELOW it, not above. Only the build
# toolchain that pip itself needs goes here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .

# piwheels serves prebuilt armv7l/armv6l wheels for Raspberry Pi,
# letting pip download packages like pycryptodome and dbus-fast instead
# of compiling them from source (which takes ~10 minutes on a Pi 2).
# It's an *extra* index, so on any other architecture pip simply finds
# no matching wheel and falls back to PyPI as before - safe everywhere,
# just dramatically faster on a Pi.
RUN pip install --no-cache-dir \
    --extra-index-url https://www.piwheels.org/simple \
    -r requirements.txt

# Runtime-only packages belong BELOW the pip layer. network-manager
# (which provides nmcli for WiFi switching) is not needed to build any
# Python package - having it above cost a full ~11 minute pip recompile
# the first time WiFi support was added, for no reason.
RUN apt-get update && apt-get install -y --no-install-recommends \
    network-manager \
    && rm -rf /var/lib/apt/lists/*

COPY backend/app ./app

RUN mkdir -p /app/data

# Cheap and change-prone: keep last so it can never invalidate anything
# expensive above it.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
