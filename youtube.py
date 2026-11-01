import base64
import os
import re
import time
import random
import threading

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
    if not any(site in l for l in rows for site in ('youtube.com', 'instagram.com')):
        print('[cookies] the file has no youtube.com or instagram.com entries, ignoring it')
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

# Space out the starts of downloads a little; back to back hits are what trips
# it. Several downloads run at once now, so this hands out start slots under a
# lock rather than remembering when the last one finished.
_MIN_GAP_SECONDS = 1.2
_next_slot = 0.0
_slot_lock = threading.Lock()

# One download per source at a time, so the same song twice in a mix, or in two
# mixes cut at once, is fetched once and the second caller gets the file.
_source_locks: dict = {}
_source_locks_guard = threading.Lock()

# A clip id ends up in a file name, so it is checked before it gets near a path.
# YouTube ids are bare. Anything else carries a short tag and a dot, which a
# YouTube id never contains: "ig.C8xYz12AbCd" for a reel, "up.3f9a..." for a file
# someone uploaded.
_ID_RE = re.compile(r'^(?:[a-z]{2,10}\.)?[\w-]{1,64}$')
UPLOAD_TAG = 'up.'


class Blocked(Exception):
    """YouTube refused this download rather than the video being unusable."""


def _wait_turn():
    global _next_slot
    with _slot_lock:
        now = time.time()
        at = max(now, _next_slot)
        _next_slot = at + _MIN_GAP_SECONDS
    if at > now:
        time.sleep(at - now)


def _source_lock(video_id: str) -> threading.Lock:
    with _source_locks_guard:
        return _source_locks.setdefault(video_id, threading.Lock())


def _touch(path: str):
    """Reuse counts as use, so the janitor ages a file from when it was last needed."""
    try:
        os.utime(path, None)
    except OSError:
        pass


def is_youtube_id(video_id: str) -> bool:
    return '.' not in (video_id or '')


def source_path(video_id: str) -> str:
    """Where a clip's audio lives on disk, once the id has been checked."""
    if not _ID_RE.match(video_id or ''):
        raise ValueError('that is not a clip this deck knows about')
    return os.path.join(DOWNLOAD_DIR, f'{video_id}.mp3')


def _source_tag(extractor: str) -> str:
    name = re.sub(r'[^a-z]', '', (extractor or '').lower())
    return {'instagram': 'ig'}.get(name, name[:10] if len(name) >= 2 else 'web')


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
            extractor = info.get('extractor_key') or info.get('ie_key') or 'Youtube'
            raw_id = re.sub(r'[^\w-]', '', str(info['id']))[:64]
            if extractor.lower().startswith('youtube'):
                found = {
                    'video_id': raw_id,
                    'source': 'youtube',
                    'url': f'https://www.youtube.com/watch?v={raw_id}',
                }
            else:
                # a reel is cut from the link it came from, not a watch page
                tag = _source_tag(extractor)
                found = {
                    'video_id': f'{tag}.{raw_id}',
                    'source': 'instagram' if tag == 'ig' else tag,
                    'url': info.get('webpage_url') or query_or_url,
                }
            found.update({
                'title': info.get('title') or (info.get('description') or '')[:80] or raw_id,
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration'),
            })
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


def download_audio(video_id: str, url: str = None, progress_hook=None) -> str:
    """Fetch one clip's audio as mp3, reusing the cached file when we have it.

    A bare id is a YouTube video and `url` is ignored, so a caller cannot point
    a YouTube id at some other address. A tagged id needs the link it came from,
    except an upload, which only ever exists as the file on disk.
    """
    final_path = source_path(video_id)

    with _source_lock(video_id):
        if os.path.exists(final_path):
            _touch(final_path)
            return final_path

        if video_id.startswith(UPLOAD_TAG):
            raise RuntimeError('this uploaded file has been cleared off the deck, add it again')
        if is_youtube_id(video_id):
            return _download(video_id, f'https://www.youtube.com/watch?v={video_id}',
                             final_path, _CLIENTS, progress_hook)
        if not url:
            raise RuntimeError('no link to fetch this one from')
        # the player clients are a YouTube thing, so other sites get one go
        return _download(video_id, url, final_path, (None,), progress_hook)


def _download(video_id: str, target: str, final_path: str, clients, progress_hook) -> str:
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
    for attempt, client in enumerate(clients):
        _wait_turn()
        try:
            with yt_dlp.YoutubeDL(_with_client(base, client)) as ydl:
                ydl.download([target])
            if os.path.exists(final_path):
                return final_path
            errors.append('ffmpeg produced no mp3')
        except Exception as e:
            errors.append(str(e).replace('\n', ' ')[:200])

        # Ease off before trying the next client.
        if attempt + 1 < len(clients):
            time.sleep(1.6 * (attempt + 1) + random.random())

    joined = ' | '.join(errors)
    if 'instagram.com' in target and 'login' in joined.lower():
        # Instagram hides most reels from anyone not signed in
        raise Blocked('Instagram wants a signed in session for this reel. '
                      'A cookies.txt with instagram.com cookies fixes that')
    if any(_looks_blocked(e) for e in errors):
        if _COOKIEFILE:
            raise Blocked('YouTube is rate limiting this download right now')
        # No cookies, on a host YouTube does not trust. This is the failure that
        # every cloud deploy hits, and it will not clear up by retrying.
        raise Blocked(
            'YouTube is blocking this server and no cookies are configured'
        )
    raise RuntimeError(f'could not download this one ({joined[:160]})')
