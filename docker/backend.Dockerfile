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
#
# libportaudio2 is the runtime PortAudio library `sounddevice` loads
# dynamically via cffi at import time (its own wheel is pure Python -
# confirmed by inspecting it, no bundled .so) - the *runtime* library,
# not portaudio19-dev, since nothing here compiles against it, just
# calls into the already-built shared object. alsa-utils provides
# `arecord`/`aplay`, which voice_control_service.py shells out to for
# mic capture and speaker playback - same "shell out to a well-tested
# real CLI tool" pattern already used for ffmpeg/the camera, rather
# than adding another Python audio-IO dependency on top of sounddevice
# (which is only used for its live streaming callback, for the wake-
# word listener specifically).
# mpv - internet radio playback (internet_radio_service.py). Chosen
# over another aplay one-shot (the TTS/beep pattern above) because a
# radio stream is long-running, not a short clip: mpv stays resident
# with --idle, controlled via its JSON IPC socket (pause/resume/change
# station without restarting the process), and has built-in reconnect
# handling for a stream that drops on a flaky mobile connection - all
# things a subprocess-per-clip aplay call doesn't give you.
RUN apt-get update && apt-get install -y --no-install-recommends \
    network-manager \
    ffmpeg \
    libportaudio2 \
    alsa-utils \
    mpv \
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

# Vosk's published armv7 build of libvosk.so requests an executable
# stack via its ELF header (a stale build-toolchain artefact, common in
# scientific/numerical C++ - not something the library actually needs
# at runtime; multiple independent reports confirm clearing this flag
# doesn't break anything). Reported symptom this fixes: "cannot enable
# executable stack as shared object requires: Invalid argument" -
# glibc 2.41 changed dlopen()'s behaviour here from permissively
# granting an executable stack to hard-refusing and failing the load
# entirely (see glibc's own 2.41 release notes), which is what this
# base image now ships.
#
# patchelf --clear-execstack, NOT execstack - execstack was removed
# from Debian entirely as of trixie (confirmed: apt errors "Unable to
# locate package execstack" on this exact base image), so the fix that
# worked everywhere else needed a different tool here. patchelf is
# packaged for trixie and its --clear-execstack does the same job.
# Verified immediately after patching, in the same command, rather than
# trusted blindly - there's a real report elsewhere of patchelf
# corrupting a different .so under similar circumstances, so this
# actually dlopen()s the patched file via ctypes right here and fails
# the whole build loudly if that doesn't work, instead of silently
# shipping a broken library that only surfaces as a mystery failure
# later at runtime.
#
# Placed here deliberately, not right after the pip layer where it
# first landed - Docker invalidates every layer AFTER whichever one
# changes, and putting this ahead of the liblgpio1 compile above (the
# single slowest step in this whole build) meant every unrelated future
# deploy would re-trigger that compile for nothing. Same "cheap and
# change-prone stuff goes below expensive stuff" principle already
# followed throughout this file.
RUN apt-get update && apt-get install -y --no-install-recommends patchelf \
    && LIBVOSK="$(find /usr/local/lib -name libvosk.so)" \
    && patchelf --clear-execstack "$LIBVOSK" \
    && python3 -c "import ctypes; ctypes.CDLL('$LIBVOSK')" \
    && apt-get purge -y --auto-remove patchelf \
    && rm -rf /var/lib/apt/lists/*

COPY backend/app ./app

RUN mkdir -p /app/data

# Cheap and change-prone: keep last so it can never invalidate anything
# expensive above it.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
