import base64
import os
import time
import random

import yt_dlp

from paths import BASE_DIR, DATA_ROOT, DOWNLOAD_DIR

# ─────────────────────────────────────────────────────────────────────────────
# Cookies
#
# YouTube throws "sign in to confirm you're not a bot" at datacenter IPs. From a
# home address that is rare and usually transient, so retrying across a few player
# clients gets through. From a cloud host it is permanent and no client helps,
# because the judgement is on the address. The only lever is a cookie file from a
# browser signed in to a throwaway account. Which is why running this on the
# machine of the person using it, as install.sh does, avoids the topic entirely.
#
# Supplying cookies to a free host is the awkward part: no shell, no persistent
# disk, and the file must never reach the repo. So four sources are accepted:
#
#   1. YTDLP_COOKIEFILE   an explicit path, for a laptop or a host with a disk
#   2. /etc/secrets/cookies.txt   where Render mounts a Secret File
#   3. ./cookies.txt      next to the code, for local use
#   4. YTDLP_COOKIES_B64  the file, base64 encoded, as an environment variable
#                         (or YTDLP_COOKIES for the raw text)
# ─────────────────────────────────────────────────────────────────────────────

_COOKIE_HEADER = '# Netscape HTTP Cookie File'
_SECRET_PATH = '/etc/secrets/cookies.txt'          # Render's mount point
_LOCAL_PATH = os.path.join(BASE_DIR, 'cookies.txt')
_WORKING_PATH = os.path.join(DATA_ROOT, 'cookies.txt')

# Reported at boot and on /api/health, so a server silently running without
# cookies is obvious rather than a mystery one failed export later.
COOKIE_STATUS = 'none'


def _repair_cookies(text: str) -> str:
    """Put the tabs back if something ate them, and ensure the header line.

    The Netscape format is tab separated, and pasting it through a dashboard
    textarea turns the tabs into spaces, which yt-dlp rejects outright. Base64 is
    the documented route because it cannot be mangled in the first place.
    """
    lines, fixed = [], 0
    for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        if line.startswith('#') or not line.strip() or '\t' in line:
            lines.append(line)
            continue
        # domain, include_subdomains, path, secure, expiry, name, value
        parts = line.split()
        if len(parts) >= 7:
            # the value is the remainder, since a value may contain spaces
            lines.append('\t'.join(parts[:6] + [' '.join(parts[6:])]))
            fixed += 1
        else:
            lines.append(line)

    if fixed:
        print(f'[cookies] restored tabs on {fixed} lines that arrived space separated')

    body = '\n'.join(lines).strip('\n')
    if not body.lstrip().startswith('#'):
        body = f'{_COOKIE_HEADER}\n{body}'
    return body + '\n'


def _install_cookies(text: str, source: str):
    """Write our own writable copy, and only then call the cookies loaded.

    The copy matters: yt-dlp writes the jar back when it finishes, and both a
    secret mount and a container filesystem are read only, so handing it the
    original path fails on the way out rather than on the way in.
    """
    global COOKIE_STATUS

    text = _repair_cookies(text)
    rows = [
        l for l in text.split('\n')
        if l.strip() and not l.lstrip().startswith('#')
    ]
    if not any('youtube.com' in l for l in rows):
        print('[cookies] the file has no youtube.com entries, ignoring it')
        COOKIE_STATUS = f'invalid ({source})'
        return None

    try:
        with open(_WORKING_PATH, 'w', encoding='utf-8') as fh:
            fh.write(text)
        os.chmod(_WORKING_PATH, 0o600)
    except OSError as e:
        print(f'[cookies] could not write the working copy: {e}')
        COOKIE_STATUS = f'unwritable ({source})'
        return None

    COOKIE_STATUS = f'{len(rows)} cookies from {source}'
    return _WORKING_PATH


def _read_text(path: str):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            return fh.read()
    except OSError as e:
        print(f'[cookies] could not read {path}: {e}')
        return None


def load_cookies():
    """Return a writable cookie file path, or None if there are no cookies."""
    global COOKIE_STATUS

    explicit = os.environ.get('YTDLP_COOKIEFILE')
    if explicit:
        if not os.path.exists(explicit):
            print(f'[cookies] YTDLP_COOKIEFILE points at {explicit}, which is not there')
            COOKIE_STATUS = 'missing (YTDLP_COOKIEFILE)'
            return None
        # read in full before installing, since the source may be the copy
        text = _read_text(explicit)
        return _install_cookies(text, f'YTDLP_COOKIEFILE {explicit}') if text else None

    for path, label in ((_SECRET_PATH, 'the Render secret file'),
                        (_LOCAL_PATH, './cookies.txt')):
        if os.path.exists(path):
            text = _read_text(path)
            if text:
                return _install_cookies(text, label)

    packed = os.environ.get('YTDLP_COOKIES_B64')
    if packed and packed.strip():
        # tolerate the ways a base64 blob arrives: wrapped, quoted, unpadded
        blob = ''.join(packed.split()).strip('"\'')
        blob += '=' * (-len(blob) % 4)
        try:
            return _install_cookies(
                base64.b64decode(blob, validate=False).decode('utf-8', 'replace'),
                'YTDLP_COOKIES_B64',
            )
        except Exception as e:
            print(f'[cookies] YTDLP_COOKIES_B64 is not valid base64: {e}')
            COOKIE_STATUS = 'invalid (YTDLP_COOKIES_B64)'
            return None

    raw = os.environ.get('YTDLP_COOKIES')
    if raw and raw.strip():
        # a single line env var with literal backslash-n is a common paste
        if '\n' not in raw and '\\n' in raw:
            raw = raw.replace('\\n', '\n')
        return _install_cookies(raw, 'YTDLP_COOKIES')

    return None


_COOKIEFILE = load_cookies()

# Tried in order. `None` means yt-dlp's own default, which usually has the most
# audio formats; the rest are fallbacks that are sometimes let through instead.
#
# The list depends on whether we have cookies, because the mobile app clients
# are the ones that get an account flagged when they are used with a signed in
# session. Without cookies there is no account to protect, so they are fair game
# as a last resort.
_CLIENTS_BARE = (None, 'web_safari', 'mweb', 'tv_simply', 'android')
_CLIENTS_COOKIED = (None, 'web_safari', 'web', 'mweb')
_CLIENTS = _CLIENTS_COOKIED if _COOKIEFILE else _CLIENTS_BARE

_BOT_HINTS = ('not a bot', 'sign in to confirm', 'too many requests', 'http error 429')

# Space out consecutive downloads a little; back to back hits are what trips it.
_MIN_GAP_SECONDS = 1.2
_last_download_at = 0.0


class Blocked(Exception):
    """YouTube refused this download rather than the video being unusable."""


def _base_opts() -> dict:
    opts = {
        'quiet': True,
        'no_warnings': True,
        # quiet does not cover the progress bar, and the launcher window belongs
        # to a person watching the app's own progress messages, not yt-dlp's
        'noprogress': True,
        'noplaylist': True,
        'retries': 3,
        'fragment_retries': 3,
        'socket_timeout': 30,
    }
    if _COOKIEFILE and os.path.exists(_COOKIEFILE):
        opts['cookiefile'] = _COOKIEFILE
    return opts


def status() -> dict:
    """What this process is set up with, for the boot log and /api/health."""
    return {'cookies': COOKIE_STATUS}


def _with_client(opts: dict, client) -> dict:
    out = dict(opts)
    if client:
        out['extractor_args'] = {'youtube': {'player_client': [client]}}
    return out


def _looks_blocked(err: str) -> bool:
    low = err.lower()
    return any(h in low for h in _BOT_HINTS)


# A YouTube search is the slowest part of picking a preset, and the answer for
# "Kala Chashma" does not change minute to minute. Remember it for the life of
# the process so the second person to pick a jukebox mix skips the wait.
_RESOLVE_CACHE: dict = {}
_RESOLVE_CACHE_MAX = 600


def _cache_key(q: str) -> str:
    return ' '.join(q.strip().lower().split())


def resolve_clip(query_or_url: str) -> dict:
    """Look up one clip's title, thumbnail and duration."""
    key = _cache_key(query_or_url)
    cached = _RESOLVE_CACHE.get(key)
    if cached:
        return dict(cached)

    base = {**_base_opts(), 'skip_download': True, 'default_search': 'ytsearch1'}

    last_err = None
    for client in _CLIENTS[:3]:
        try:
            with yt_dlp.YoutubeDL(_with_client(base, client)) as ydl:
                info = ydl.extract_info(query_or_url, download=False)
            if 'entries' in info:
                entries = [e for e in info['entries'] if e]
                if not entries:
                    raise ValueError(f'nothing on YouTube for "{query_or_url}"')
                info = entries[0]
            found = {
                'video_id': info['id'],
                'title': info.get('title') or info['id'],
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration'),
                'url': f"https://www.youtube.com/watch?v={info['id']}",
            }
            if len(_RESOLVE_CACHE) >= _RESOLVE_CACHE_MAX:
                _RESOLVE_CACHE.clear()
            _RESOLVE_CACHE[key] = found
            return dict(found)
        except ValueError:
            raise
        except Exception as e:
            last_err = str(e)
            if not _looks_blocked(last_err):
                break
            time.sleep(1.5 + random.random())

    raise RuntimeError(last_err or f'could not look up "{query_or_url}"')


def download_audio(video_id: str, progress_hook=None) -> str:
    """Fetch one video's audio as mp3, reusing the cached file when we have it."""
    global _last_download_at

    final_path = os.path.join(DOWNLOAD_DIR, f'{video_id}.mp3')
    if os.path.exists(final_path):
        return final_path

    gap = _MIN_GAP_SECONDS - (time.time() - _last_download_at)
    if gap > 0:
        time.sleep(gap)

    out_tmpl = os.path.join(DOWNLOAD_DIR, f'{video_id}.%(ext)s')
    base = {
        **_base_opts(),
        'format': 'bestaudio/best',
        'outtmpl': out_tmpl,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
    }
    if progress_hook:
        base['progress_hooks'] = [progress_hook]

    errors = []
    for attempt, client in enumerate(_CLIENTS):
        try:
            with yt_dlp.YoutubeDL(_with_client(base, client)) as ydl:
                ydl.download([f'https://www.youtube.com/watch?v={video_id}'])
            _last_download_at = time.time()
            if os.path.exists(final_path):
                return final_path
            errors.append('ffmpeg produced no mp3')
        except Exception as e:
            errors.append(str(e).replace('\n', ' ')[:200])

        # Ease off before trying the next client.
        time.sleep(1.6 * (attempt + 1) + random.random())

    _last_download_at = time.time()
    joined = ' | '.join(errors)
    if any(_looks_blocked(e) for e in errors):
        if _COOKIEFILE:
            raise Blocked('YouTube is rate limiting this download right now')
        # No cookies, on a host YouTube does not trust. This is the failure that
        # every cloud deploy hits, and it will not clear up by retrying.
        raise Blocked(
            'YouTube is blocking this server and no cookies are configured'
        )
    raise RuntimeError(f'could not download this one ({joined[:160]})')
