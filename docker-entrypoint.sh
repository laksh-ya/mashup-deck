#!/bin/sh
# Everything in requirements.txt is pinned, so a build today and a build in six
# months install the same thing. yt-dlp is the one exception that matters:
# YouTube changes how it serves audio every few weeks and an old yt-dlp simply
# stops downloading. So on each container start we fetch the current one.
#
# It goes into its own directory which is put at the front of PYTHONPATH, so the
# fresh copy wins over the pinned one deterministically. If there is no network,
# or PyPI is slow, the pinned version baked into the image is used and the app
# still starts normally. Set YTDLP_AUTO_UPDATE=0 to always use the pinned copy.

set -e

FRESH="${HOME:-/tmp}/.ytdlp"

if [ "${YTDLP_AUTO_UPDATE:-1}" = "1" ]; then
  echo "[boot] fetching the current yt-dlp..."
  if pip install --quiet --disable-pip-version-check --no-cache-dir \
       --timeout 25 --retries 1 --upgrade --target "$FRESH" yt-dlp 2>/dev/null; then
    # Only trust it once it has been imported. A fetched copy that needs a newer
    # Python than this image would otherwise take the whole app down at startup,
    # since it sits ahead of the pinned one on PYTHONPATH.
    if PYTHONPATH="$FRESH" python -c 'import yt_dlp' 2>/dev/null; then
      PYTHONPATH="$FRESH${PYTHONPATH:+:$PYTHONPATH}"
      export PYTHONPATH
      echo "[boot] using the freshly fetched yt-dlp"
    else
      echo "[boot] the fetched yt-dlp would not import, using the pinned one"
    fi
  else
    echo "[boot] could not reach PyPI, using the version built into the image"
  fi
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-7860}"
