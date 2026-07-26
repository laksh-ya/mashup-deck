import os
import time
import random

import yt_dlp

import cookies
from paths import DOWNLOAD_DIR

# YouTube throws "sign in to confirm you're not a bot" at datacenter IPs, and
# sometimes at home ones if you hammer it. From a home address it is usually
# transient, so retrying across a few player clients gets through. From a cloud
# host it is not transient at all and no client works, which is what cookies.py
# is for. See its docstring for the four ways to supply a cookie file.
_COOKIEFILE = cookies.load()

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
    return {'cookies': cookies.STATUS}


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
            'YouTube is blocking this server and there are no cookies configured '
            '(see cookies.py)'
        )
    raise RuntimeError(f'could not download this one ({joined[:160]})')
