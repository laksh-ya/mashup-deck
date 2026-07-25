"""Keeps the scratch folders from growing forever.

Downloaded source audio and finished mixes are both throwaway. Without this the
`downloads/` folder grows with every song anyone ever asks for, which on a small
free host eventually fills the disk and takes the whole app down with it.

Three rules, all of them adjustable by environment variable:

  * a downloaded song is kept for DOWNLOAD_TTL_MIN so that going back and
    re-cutting the same mix stays instant, then it goes
  * a finished mix is kept for OUTPUT_TTL_MIN, long enough to play and save it
  * whatever the ages, the folders never exceed MAX_DOWNLOAD_MB / MAX_OUTPUT_MB;
    past that the oldest files are removed first
"""

import os
import time
import threading

from paths import DOWNLOAD_DIR, OUTPUT_DIR


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


DOWNLOAD_TTL = _num('DOWNLOAD_TTL_MIN', 30) * 60
OUTPUT_TTL = _num('OUTPUT_TTL_MIN', 90) * 60
MAX_DOWNLOAD_MB = _num('MAX_DOWNLOAD_MB', 400)
MAX_OUTPUT_MB = _num('MAX_OUTPUT_MB', 150)
SWEEP_EVERY = _num('SWEEP_EVERY_MIN', 5) * 60

_lock = threading.Lock()


def _files(folder: str):
    out = []
    try:
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            if not os.path.isfile(path) or name.startswith('.'):
                continue
            try:
                st = os.stat(path)
            except OSError:
                continue
            out.append((path, st.st_mtime, st.st_size))
    except OSError:
        pass
    return out


def _drop(path: str) -> int:
    try:
        size = os.path.getsize(path)
        os.remove(path)
        return size
    except OSError:
        return 0


def _clean(folder: str, ttl: float, max_bytes: float, keep: set) -> int:
    """Age out old files, then trim by size, oldest first. `keep` is spared."""
    freed = 0
    now = time.time()
    entries = [e for e in _files(folder) if e[0] not in keep]

    survivors = []
    for path, mtime, size in entries:
        if ttl > 0 and now - mtime > ttl:
            freed += _drop(path)
        else:
            survivors.append((path, mtime, size))

    total = sum(s for _, _, s in survivors)
    if max_bytes > 0 and total > max_bytes:
        survivors.sort(key=lambda e: e[1])          # oldest first
        for path, _, size in survivors:
            if total <= max_bytes:
                break
            freed += _drop(path)
            total -= size

    return freed


def sweep(jobs: dict | None = None) -> int:
    """Tidy both folders. Files belonging to a job still in progress are kept."""
    with _lock:
        keep = set()
        if jobs:
            for job in list(jobs.values()):
                if job.get('status') in ('queued', 'running') and job.get('output'):
                    keep.add(job['output'])

        freed = _clean(DOWNLOAD_DIR, DOWNLOAD_TTL, MAX_DOWNLOAD_MB * 1024 * 1024, keep)
        freed += _clean(OUTPUT_DIR, OUTPUT_TTL, MAX_OUTPUT_MB * 1024 * 1024, keep)

        # forget jobs whose file is no longer on disk, so JOBS cannot grow forever
        if jobs is not None:
            for job_id, job in list(jobs.items()):
                if job.get('status') in ('queued', 'running'):
                    continue
                out = job.get('output')
                if not out or not os.path.exists(out):
                    jobs.pop(job_id, None)

        return freed


def release(job: dict) -> int:
    """Throw away one finished mix and the sources it was cut from, now."""
    with _lock:
        freed = 0
        out = job.get('output')
        if out:
            freed += _drop(out)
        for vid in job.get('sources') or []:
            freed += _drop(os.path.join(DOWNLOAD_DIR, f'{vid}.mp3'))
        return freed


def start(jobs: dict) -> None:
    """Sweep on boot, then keep sweeping in the background."""
    def loop():
        while True:
            try:
                sweep(jobs)
            except Exception:
                pass
            time.sleep(SWEEP_EVERY)

    threading.Thread(target=loop, daemon=True).start()


def usage() -> dict:
    """What the folders are holding right now, for /api/health."""
    def mb(folder):
        return round(sum(s for _, _, s in _files(folder)) / (1024 * 1024), 1)
    return {'downloads_mb': mb(DOWNLOAD_DIR), 'outputs_mb': mb(OUTPUT_DIR)}
