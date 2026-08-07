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
# the first time WiFi support was added, for no reason. ffmpeg is here
# for the same reason - needed only at runtime, to capture MJPEG from
# a USB webcam (see app/services/camera_service.py).
RUN apt-get update && apt-get install -y --no-install-recommends \
    network-manager \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# liblgpio.so.1 - the native C library the `lgpio` pip package is only
# a wrapper around. Built from source deliberately: it is NOT packaged
# in Debian (the 2021 ITP for liblgpio1 never landed in a release), so
# `apt-get install liblgpio1` fails with "Unable to locate package".
# Without this library gpiozero falls through every pin factory in turn
# and reports the unhelpfully generic "Unable to load any default pin
# factory!", even with /dev/gpiochip0 correctly passed through.
#
# Small and quick to compile. build-essential is already present from
# the layer above. Downloaded with Python's own urllib rather than
# curl/wget - neither is present in python:*-slim, but Python
# obviously is.
RUN python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/joan2937/lg/archive/refs/heads/master.tar.gz', '/tmp/lg.tar.gz')" \
    && mkdir -p /tmp/lg && tar -xzf /tmp/lg.tar.gz -C /tmp/lg --strip-components=1 \
    && make -C /tmp/lg \
    && make -C /tmp/lg install \
    && ldconfig \
    && rm -rf /tmp/lg /tmp/lg.tar.gz

COPY backend/app ./app

RUN mkdir -p /app/data

# Cheap and change-prone: keep last so it can never invalidate anything
# expensive above it.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
