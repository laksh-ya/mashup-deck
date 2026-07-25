"""Where the app keeps its scratch files.

Free hosts differ on what is writable: some run the container as a non-root user
who does not own the app directory. Rather than assume, pick the first location
we can actually write to and fall back to the system temp dir.

Override explicitly with DATA_DIR=/some/path if you want it somewhere specific.
"""

import os
import tempfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _writable(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        probe = os.path.join(path, '.write-probe')
        with open(probe, 'w') as fh:
            fh.write('ok')
        os.remove(probe)
        return True
    except OSError:
        return False


def _pick_root() -> str:
    candidates = []
    if os.environ.get('DATA_DIR'):
        candidates.append(os.environ['DATA_DIR'])
    candidates.append(BASE_DIR)
    home = os.path.expanduser('~')
    if home and home != '/':
        candidates.append(os.path.join(home, '.mashup-deck'))
    candidates.append(os.path.join(tempfile.gettempdir(), 'mashup-deck'))

    for c in candidates:
        if _writable(c):
            return c
    # Nothing worked; hand back temp and let the error surface naturally.
    return tempfile.gettempdir()


DATA_ROOT = _pick_root()
DOWNLOAD_DIR = os.path.join(DATA_ROOT, 'downloads')
OUTPUT_DIR = os.path.join(DATA_ROOT, 'outputs')

for _d in (DOWNLOAD_DIR, OUTPUT_DIR):
    try:
        os.makedirs(_d, exist_ok=True)
    except OSError:
        pass
