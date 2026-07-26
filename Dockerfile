# Exact Python, exact Debian. Nothing here drifts between builds.
FROM python:3.11.9-slim-bookworm

# ffmpeg cannot come from pip, and pydub is only a wrapper around it. Needing an
# apt package is the whole reason this is a Docker deploy and not one of the
# native Python runtimes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Render and most free hosts run containers as a non-root user. Creating one, and
# owning the app directory, keeps the scratch folders writable.
#
# The gid is pinned to 1000 on purpose, not left for useradd to choose: Render
# mounts secret files as root:1000 with no world read, so a process outside that
# group gets "Permission denied" on /etc/secrets/cookies.txt, which is where the
# YouTube cookie file lives on a deploy.
# (the `|| true` covers a base image that already has a group 1000 under another
# name; useradd --gid 1000 then simply joins the existing one)
RUN groupadd --gid 1000 deck 2>/dev/null || true \
 && useradd --create-home --uid 1000 --gid 1000 deck

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/deck \
    PATH=/home/deck/.local/bin:$PATH

WORKDIR /home/deck/app

# requirements first, so editing app code does not reinstall the dependencies
COPY --chown=deck:deck requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=deck:deck . .

# Scratch space for downloaded audio and finished mixes. janitor.py keeps both
# bounded; paths.py falls back to a temp dir if they are ever not writable.
RUN mkdir -p downloads outputs \
 && chmod +x docker-entrypoint.sh \
 && chown -R deck:deck /home/deck

USER deck

# Render and Railway inject $PORT. Hugging Face Spaces expects 7860. The
# entrypoint reads whichever is set, so this image needs no per-host edits.
EXPOSE 7860
ENTRYPOINT ["./docker-entrypoint.sh"]
