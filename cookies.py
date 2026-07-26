"""Finding the cookie file, wherever the host lets you put one.

YouTube refuses most datacenter IPs outright: every download comes back as
"Sign in to confirm you're not a bot". No player client works around it, because
the block is on the address, not on the request. The only lever that reliably
helps is a cookie file exported from a browser signed in to a throwaway account.

Getting that file onto a free host is the awkward part. There is no shell and no
persistent disk, so it cannot be uploaded, and it must not be committed to the
repo. So four sources are accepted, in this order:

  1. YTDLP_COOKIEFILE   an explicit path, for a laptop or a host with a disk
  2. /etc/secrets/cookies.txt   where Render mounts a Secret File
  3. ./cookies.txt      sitting next to the code, for local development
  4. YTDLP_COOKIES_B64  the file, base64 encoded, as an environment variable
     (or YTDLP_COOKIES for the raw text)

Whatever is found is copied into the scratch directory before yt-dlp sees it.
That is not tidiness: yt-dlp writes the jar back when it finishes, and both a
secret mount and the image filesystem are read only, so handing it the original
path makes every download fail on the way out.

The copy is also repaired if needed. The Netscape format is tab separated, and
pasting it through a dashboard textarea turns the tabs into spaces, which yt-dlp
rejects as "does not look like a Netscape format cookies file". Base64 avoids the
problem entirely, which is why it is the recommended route.
"""

import base64
import os

from paths import BASE_DIR, DATA_ROOT

HEADER = '# Netscape HTTP Cookie File'
SECRET_PATH = '/etc/secrets/cookies.txt'      # Render's mount point for Docker
LOCAL_PATH = os.path.join(BASE_DIR, 'cookies.txt')
INSTALLED_PATH = os.path.join(DATA_ROOT, 'cookies.txt')

# Filled in by load(), reported at boot and on /api/health, so a deployment that
# is silently running without cookies is obvious rather than a mystery.
STATUS = 'none'


def _read(path: str):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            return fh.read()
    except OSError as e:
        print(f'[cookies] could not read {path}: {e}')
        return None


def _decode_b64(raw: str):
    """Tolerate the ways a base64 blob arrives: wrapped, quoted, unpadded."""
    packed = ''.join(raw.split())
    packed = packed.strip('"\'')
    packed += '=' * (-len(packed) % 4)
    try:
        return base64.b64decode(packed, validate=False).decode('utf-8', 'replace')
    except Exception as e:
        print(f'[cookies] YTDLP_COOKIES_B64 is not valid base64: {e}')
        return None


def _repair(text: str) -> str:
    """Put the tabs back if something ate them, and ensure the header line."""
    lines = []
    fixed = 0
    for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        if line.startswith('#') or not line.strip():
            lines.append(line)
            continue
        if '\t' in line:
            lines.append(line)
            continue
        # domain, include_subdomains, path, secure, expiry, name, value
        parts = line.split()
        if len(parts) >= 7:
            # the value is the remainder, since a value may itself contain spaces
            lines.append('\t'.join(parts[:6] + [' '.join(parts[6:])]))
            fixed += 1
        else:
            lines.append(line)

    if fixed:
        print(f'[cookies] restored tabs on {fixed} lines that arrived space separated')

    body = '\n'.join(lines).strip('\n')
    if not body.lstrip().startswith('#'):
        body = f'{HEADER}\n{body}'
    return body + '\n'


def _usable(text: str) -> bool:
    """Does this actually hold YouTube cookies, rather than an empty export?"""
    rows = [
        l for l in text.split('\n')
        if l.strip() and not l.lstrip().startswith('#') and 'youtube.com' in l
    ]
    if not rows:
        print('[cookies] the file has no youtube.com entries, ignoring it')
        return False
    return True


def _install(text: str, source: str):
    """Write our own writable copy, and only then call the cookies loaded."""
    global STATUS
    text = _repair(text)
    if not _usable(text):
        STATUS = f'invalid ({source})'
        return None
    try:
        with open(INSTALLED_PATH, 'w', encoding='utf-8') as fh:
            fh.write(text)
        os.chmod(INSTALLED_PATH, 0o600)
    except OSError as e:
        print(f'[cookies] could not write the working copy: {e}')
        STATUS = f'unwritable ({source})'
        return None

    count = sum(
        1 for l in text.split('\n')
        if l.strip() and not l.lstrip().startswith('#')
    )
    STATUS = f'{count} cookies from {source}'
    return INSTALLED_PATH


def load():
    """Return a writable cookie file path, or None if there are no cookies."""
    global STATUS

    explicit = os.environ.get('YTDLP_COOKIEFILE')
    if explicit:
        if not os.path.exists(explicit):
            print(f'[cookies] YTDLP_COOKIEFILE points at {explicit}, which does not exist')
            STATUS = 'missing (YTDLP_COOKIEFILE)'
            return None
        text = _read(explicit)
        if text:
            # read in full before installing, since the source may be the copy
            return _install(text, f'YTDLP_COOKIEFILE {explicit}')
        STATUS = 'unreadable (YTDLP_COOKIEFILE)'
        return None

    for path, label in ((SECRET_PATH, 'the Render secret file'), (LOCAL_PATH, './cookies.txt')):
        if os.path.exists(path):
            text = _read(path)
            if text:
                return _install(text, label)

    b64 = os.environ.get('YTDLP_COOKIES_B64')
    if b64 and b64.strip():
        text = _decode_b64(b64)
        if text:
            return _install(text, 'YTDLP_COOKIES_B64')
        STATUS = 'invalid (YTDLP_COOKIES_B64)'
        return None

    raw = os.environ.get('YTDLP_COOKIES')
    if raw and raw.strip():
        # a single line env var with literal backslash-n is a common paste
        if '\n' not in raw and '\\n' in raw:
            raw = raw.replace('\\n', '\n')
        return _install(raw, 'YTDLP_COOKIES')

    STATUS = 'none'
    return None
