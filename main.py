import os
import re
import sys
import time
import uuid
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from typing import List, Optional

try:
    from fastapi import FastAPI, Request
    from fastapi.concurrency import run_in_threadpool
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse, JSONResponse
    from pydantic import BaseModel
except ModuleNotFoundError as missing:
    # Running this without setting anything up first is the most likely mistake,
    # so say what to do instead of printing a traceback about fastapi.
    raise SystemExit(
        f'\n  {missing.name} is not installed, so the dependencies are missing.\n\n'
        '  Set it up once:\n\n'
        '      python3 -m venv .venv\n'
        '      source .venv/bin/activate        (Windows: .venv\\Scripts\\activate)\n'
        '      pip install -r requirements.txt\n\n'
        '  then:\n\n'
        '      python3 main.py\n'
    )

import janitor
import paths
from parser import parse_text
from youtube import resolve_clip, download_audio, source_path, UPLOAD_TAG
from audio import trim, merge_clips, even_out, match_tempo, import_upload, audio_seconds, FORMATS

@asynccontextmanager
async def lifespan(_app):
    """Startup work. A lifespan rather than @app.on_event, which is deprecated
    and prints a warning into the window a friend is looking at."""
    _boot()
    yield


app = FastAPI(title="Mashup Deck", lifespan=lifespan)

JOBS: dict = {}


@app.get('/api/health')
def api_health():
    """Cheap endpoint the page pings on load so a sleeping host wakes early."""
    return {'ok': True, 'jobs': len(JOBS), **versions(), **janitor.usage()}


@app.get('/api/install')
def api_install():
    """Whether this copy is installed, and where its uninstaller is.

    The installers put the app in <root>/app and write the uninstaller into
    <root> only in install mode, never for a try-once run, so the file being
    there is the signal. Reading the real path also covers custom install
    locations (MASHUP_HOME)."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    windows = sys.platform.startswith('win')
    path = os.path.join(root, 'uninstall.ps1' if windows else 'uninstall.sh')
    installed = os.path.isfile(path)
    system = 'windows' if windows else 'mac' if sys.platform == 'darwin' else 'linux'
    return {'installed': installed, 'os': system, 'uninstaller': path if installed else None}


class ParseRequest(BaseModel):
    text: str


class ClipIn(BaseModel):
    video_id: Optional[str] = None
    url: Optional[str] = None
    query: Optional[str] = None
    title: Optional[str] = None
    start: float = 0
    end: Optional[float] = None
    # this clip's own level, on top of evening out, in dB
    gain_db: float = 0
    # the overlap leading into this clip; None takes the mix's crossfade
    crossfade_ms: Optional[int] = None


class ResolveRequest(BaseModel):
    clips: List[ClipIn]


class ExportRequest(BaseModel):
    clips: List[ClipIn]
    crossfade_ms: int = 0
    fade_in_ms: int = 0
    fade_out_ms: int = 0
    normalize: bool = False
    match_tempo: bool = False
    format: str = 'mp3'
    bitrate: str = '192k'


@app.post('/api/parse')
def api_parse(req: ParseRequest):
    return {'clips': parse_text(req.text)}


@app.post('/api/resolve')
def api_resolve(req: ResolveRequest):
    resolved = []
    for c in req.clips:
        target = c.url or c.query
        if not target:
            resolved.append({'error': 'nothing to search for', 'raw': c.title or ''})
            continue
        try:
            info = resolve_clip(target)
            if info.get('duration') is None and info.get('source') != 'youtube':
                # Instagram rarely says how long a reel is. Reels are short, so
                # fetch it now and measure; the cut reuses the same file.
                try:
                    info['duration'] = audio_seconds(download_audio(info['video_id'], info['url']))
                except Exception:
                    traceback.print_exc()
            end = c.end if c.end is not None else info['duration']
            resolved.append({**info, 'start': c.start, 'end': end})
        except Exception as e:
            resolved.append({'error': str(e), 'query': target})
    return {'clips': resolved}


# Downloads that run at once. Each is mostly waiting on the network, so a few in
# parallel cut a long mix's wait a lot; more than this is what YouTube notices.
DOWNLOAD_WORKERS = 3


def _clamp(value, low, high):
    return max(low, min(high, value))


def _fetch_sources(job: dict, clips: List[ClipIn]) -> dict:
    """Download every distinct source, a few at a time. Returns id -> path, or
    id -> the exception that stopped it."""
    wanted = {}
    for c in clips:
        if c.video_id:
            wanted.setdefault(c.video_id, c.url)
    # claimed up front, so a sweep while this job runs leaves its files alone
    job['sources'] = list(wanted)

    n = len(wanted)
    results = {}
    job['step'] = f'Downloading clips (1/{n})'
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        running = {pool.submit(download_audio, vid, url): vid for vid, url in wanted.items()}
        for done, future in enumerate(as_completed(running), start=1):
            vid = running[future]
            try:
                results[vid] = future.result()
            except Exception as e:
                results[vid] = e
                traceback.print_exc()
            job['step'] = f'Downloading clips ({min(done + 1, n)}/{n})'
    return results


def run_export(job_id: str, req: ExportRequest):
    """Build the mashup, skipping any clip that cannot be fetched rather than
    losing the whole mix. Skipped titles are reported back so the UI can say so."""
    job = JOBS[job_id]
    try:
        job['status'] = 'running'
        clips = req.clips
        total = len(clips)
        fetched = _fetch_sources(job, clips)

        segments, used, skipped = [], [], []
        for i, c in enumerate(clips):
            label = c.title or c.video_id or f'clip {i+1}'
            job['step'] = f'Trimming "{label}" ({i + 1}/{total})'
            try:
                path = fetched.get(c.video_id) if c.video_id else RuntimeError('nothing to download')
                if isinstance(path, Exception):
                    raise path
                segments.append(trim(path, c.start, c.end))
                used.append((i, label, c))
            except Exception as e:
                skipped.append({'title': label, 'why': str(e)[:160]})
                job['skipped'] = skipped
                traceback.print_exc()

        if not segments:
            # the same reason for every clip reads better said once
            reasons = '; '.join(dict.fromkeys(s['why'] for s in skipped)) or 'nothing could be downloaded'
            raise RuntimeError(reasons)

        tempo = []
        if req.match_tempo and len(segments) > 1:
            job['step'] = 'Matching tempo...'
            segments, ratios = match_tempo(segments)
            tempo = [{'title': u[1], 'ratio': round(r, 3)} for u, r in zip(used, ratios) if r]
        if req.normalize:
            job['step'] = 'Evening out the volume...'
            segments = even_out(segments)
        # each clip's own level goes on last, so it is a change from the evened out one
        segments = [
            s.apply_gain(_clamp(c.gain_db, -24, 24)) if c.gain_db else s
            for s, (_, _, c) in zip(segments, used)
        ]

        job['step'] = 'Merging into final mashup...'
        crossfades = [
            _clamp(c.crossfade_ms if c.crossfade_ms is not None else req.crossfade_ms, 0, 12000)
            for _, _, c in used
        ]
        fmt = req.format if req.format in FORMATS else 'mp3'
        out_path, timeline = merge_clips(
            segments, crossfades, job_id,
            fade_in_ms=_clamp(req.fade_in_ms, 0, 20000),
            fade_out_ms=_clamp(req.fade_out_ms, 0, 20000),
            fmt=fmt, bitrate=req.bitrate,
        )

        # Fill in the details before flipping to done, so a poll that lands on
        # this instant never sees a finished job with missing metadata.
        job['output'] = out_path
        job['ext'] = fmt
        job['mime'] = FORMATS[fmt]['mime']
        job['sources'] = [c.video_id for _, _, c in used]
        job['used'] = len(segments)
        job['skipped'] = skipped
        job['tempo'] = tempo
        job['timeline'] = [
            {**spot, 'index': i, 'title': label}
            for spot, (i, label, _) in zip(timeline, used)
        ]
        job['ended'] = time.time()
        job['step'] = 'Done'
        job['status'] = 'done'
    except Exception as e:
        # the time lets the sweep keep a failed job long enough for the page to
        # read why, since it has no file on disk to be judged by
        job['ended'] = time.time()
        job['status'] = 'error'
        job['step'] = f'Error: {e}'
        traceback.print_exc()
    finally:
        # a finished job is a good moment to take the bins out
        try:
            janitor.sweep(JOBS)
        except Exception:
            traceback.print_exc()


@app.post('/api/export')
def api_export(req: ExportRequest):
    job_id = str(uuid.uuid4())[:8]
    JOBS[job_id] = {'status': 'queued', 'step': 'Queued'}
    t = threading.Thread(target=run_export, args=(job_id, req), daemon=True)
    t.start()
    return {'job_id': job_id}


@app.get('/api/export/{job_id}/status')
def api_status(job_id: str):
    return JOBS.get(job_id, {'status': 'not_found'})


def safe_filename(name: str, fallback: str) -> str:
    """Keep letters, numbers, spaces and dashes; everything else goes."""
    cleaned = re.sub(r'[^\w\s-]', '', name or '', flags=re.UNICODE).strip()
    cleaned = re.sub(r'\s+', '-', cleaned)[:48].strip('-')
    return cleaned or fallback


@app.post('/api/export/{job_id}/release')
def api_release(job_id: str):
    """Called when someone starts a fresh mix: bin that tape and its sources
    straight away rather than waiting for the sweep to age them out."""
    job = JOBS.pop(job_id, None)
    if not job:
        return {'released': False}
    freed = janitor.release(job)
    return {'released': True, 'freed_mb': round(freed / (1024 * 1024), 2)}


@app.get('/api/export/{job_id}/download')
def api_download(job_id: str, name: str = ''):
    job = JOBS.get(job_id)
    if not job or job.get('status') != 'done':
        return JSONResponse({'error': 'not ready'}, status_code=400)
    # The browser honours the server's Content-Disposition over the anchor's
    # download attribute, so whatever the cassette is labelled has to come
    # through here or the saved file ends up named after the job id.
    stem = safe_filename(name, f'mashup-{job_id}')
    ext = job.get('ext', 'mp3')
    return FileResponse(job['output'], filename=f'{stem}.{ext}',
                        media_type=job.get('mime', 'audio/mpeg'))


# Generous for a song, and for a phone video someone wants the sound of. A long
# DJ set in WAV is the kind of file that hits it.
MAX_UPLOAD_MB = float(os.environ.get('MAX_UPLOAD_MB') or 300)


@app.post('/api/upload')
async def api_upload(request: Request, name: str = ''):
    """A file from this computer, sent as the raw request body.

    It becomes an mp3 in the downloads folder under an `up.` id, after which the
    rest of the app treats it like any downloaded song: trimmed, levelled, swept
    away by the janitor once it has not been used for a while."""
    upload_id = f'{UPLOAD_TAG}{uuid.uuid4().hex[:16]}'
    final = source_path(upload_id)
    part = final[:-len('.mp3')] + '.part'
    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with open(part, 'wb') as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    return JSONResponse({'error': f'that file is over {MAX_UPLOAD_MB:g} MB'},
                                        status_code=413)
                fh.write(chunk)
        if not size:
            return JSONResponse({'error': 'that file is empty'}, status_code=400)
        duration = await run_in_threadpool(import_upload, part, final)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'error': f'could not read that as audio ({str(e)[:120]})'},
                            status_code=400)
    finally:
        try:
            os.remove(part)
        except OSError:
            pass

    title = os.path.splitext(os.path.basename(name or ''))[0].strip()[:120] or 'my file'
    return {'video_id': upload_id, 'source': 'upload', 'url': None, 'title': title,
            'thumbnail': None, 'duration': duration, 'start': 0, 'end': duration}


@app.get('/api/source/{video_id}/audio')
def api_source_audio(video_id: str, url: str = ''):
    """A clip's audio, for previewing anything that is not on YouTube.

    YouTube previews play in YouTube's own player. An upload or a reel has no
    such player, so the page plays the file this deck would cut from."""
    try:
        path = download_audio(video_id, url or None)
    except Exception as e:
        return JSONResponse({'error': str(e)[:200]}, status_code=404)
    return FileResponse(path, media_type='audio/mpeg')


def versions() -> dict:
    """What this process is actually running, so nothing has to be guessed."""
    import shutil
    import sys

    try:
        import yt_dlp
        ytdlp = yt_dlp.version.__version__
    except Exception:
        ytdlp = 'missing'

    from youtube import status as yt_status

    return {
        'python': sys.version.split()[0],
        'yt_dlp': ytdlp,
        'ffmpeg': 'ok' if shutil.which('ffmpeg') else 'MISSING',
        'scratch': paths.DATA_ROOT,
        **yt_status(),
    }


def _on_a_host() -> bool:
    """Are we deployed somewhere, rather than on someone's own machine?

    Every host that runs containers tells the app which port to listen on, and
    most of them also announce themselves. A laptop does neither.
    """
    return any(
        os.environ.get(name)
        for name in ('PORT', 'RENDER', 'RENDER_SERVICE_ID', 'DYNO',
                     'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'SPACE_ID', 'K_SERVICE')
    )


def _boot():
    v = versions()
    print(f"[boot] python {v['python']} | yt-dlp {v['yt_dlp']} | ffmpeg {v['ffmpeg']}")
    print(f"[boot] scratch dir {v['scratch']}")
    print(f"[boot] cookies: {v['cookies']}")
    if v['ffmpeg'] == 'MISSING':
        print('[boot] WARNING: ffmpeg is not on PATH, trimming and merging will fail')
    # Only worth saying on a server. On someone's own machine the address is
    # residential, YouTube does not object, and cookies are genuinely not needed,
    # so the warning there is noise: in a friend's launcher window, or in your
    # terminal every time you restart.
    if v['cookies'] == 'none' and _on_a_host():
        print('[boot] WARNING: no cookie file. A cloud host will be refused by '
              'YouTube with "sign in to confirm you\'re not a bot". '
              'See the cookies section in youtube.py')
    # clear out whatever a previous run left behind, then sweep on a timer
    janitor.start(JOBS)


static_dir = os.path.join(os.path.dirname(__file__), 'static')
app.mount('/', StaticFiles(directory=static_dir, html=True), name='static')


# ─────────────────────────────────────────────────────────────────────────────
# Running it: `python main.py`
#
# This is here rather than in a separate launcher script so there is one way to
# start the app, whether that is you on a laptop or the Desktop launcher a friend
# double-clicks. `uvicorn main:app` still works and is better while editing,
# because it can reload.
# ─────────────────────────────────────────────────────────────────────────────

# Loopback only by default, on purpose: a server listening on every interface is
# what makes macOS ask whether to accept incoming connections and makes Windows
# Firewall pop a permission dialog. Neither says anything about 127.0.0.1.
# MASHUP_LAN=1 opts in, which is how a phone on the same wifi reaches a laptop.
LAN = os.environ.get('MASHUP_LAN') == '1' or '--lan' in sys.argv
PREFERRED_PORT = int(os.environ.get('PORT') or 8765)


def _free_port() -> int:
    """The preferred port if it is free, otherwise whatever the OS hands out."""
    import socket

    for candidate in list(range(PREFERRED_PORT, PREFERRED_PORT + 20)) + [0]:
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', candidate))
            except OSError:
                continue
            return s.getsockname()[1]
    return PREFERRED_PORT


def _lan_addresses() -> list:
    """This machine's addresses on the local network, best guess first.

    The usual trick of asking which interface would reach the internet is not
    enough: with a VPN connected it answers with the VPN's address, and a phone on
    the wifi cannot reach that. So candidates are collected from the routing
    table, from the hostname, and from the OS's own listing, then ranked by which
    private range they are in. Home wifi is almost always 192.168.x.x, VPNs and
    virtual adapters are usually 10.x or 172.16-31.x, so that ordering puts the
    address a phone can actually open first.
    """
    import re
    import socket
    import subprocess

    found = []

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(('8.8.8.8', 53))       # nothing is sent
            found.append(s.getsockname()[0])
        except OSError:
            pass

    try:
        found += socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        pass

    listing = {'darwin': ['ifconfig'], 'win32': ['ipconfig']}.get(
        sys.platform, ['ip', '-4', 'addr'])
    try:
        out = subprocess.run(listing, capture_output=True, text=True, timeout=4).stdout
        found += re.findall(r'\b(?:inet |IPv4 Address[^:]*:\s*)(\d+\.\d+\.\d+\.\d+)', out)
    except (OSError, subprocess.SubprocessError):
        pass

    def rank(ip: str) -> int:
        if ip.startswith('192.168.'):
            return 0
        if ip.startswith('10.'):
            return 1
        if re.match(r'172\.(1[6-9]|2\d|3[01])\.', ip):
            return 2
        return 3

    private = []
    for ip in found:
        if ip.startswith('127.') or ip.startswith('169.254.'):
            continue
        if rank(ip) < 3 and ip not in private:
            private.append(ip)

    return sorted(private, key=rank)


def _announce(port: int) -> None:
    """Wait until the server answers, then open the browser and say the URL."""
    import time
    import urllib.request
    import webbrowser

    url = f'http://127.0.0.1:{port}'
    for _ in range(120):
        try:
            with urllib.request.urlopen(f'{url}/api/health', timeout=1):
                break
        except Exception:
            time.sleep(0.5)
    else:
        print('  It did not come up. The output above says why.')
        return

    print(f'\n  Mashup Deck is ready:  {url}')
    if LAN:
        addresses = _lan_addresses()
        if addresses:
            print(f'  Open this on your phone:  http://{addresses[0]}:{port}')
            # more than one private address means a VPN or virtual adapter is up
            # and the guess above might be the wrong one, so offer the others
            for other in addresses[1:]:
                print(f'                or:       http://{other}:{port}')
        else:
            print('  No network address found, so a phone cannot reach this.')
    print('\n  Everything happens on this computer. Close this window when done.\n')

    if os.environ.get('MASHUP_NO_BROWSER') != '1':
        try:
            webbrowser.open(url)
        except Exception:
            pass


def serve() -> None:
    import uvicorn

    port = _free_port()
    threading.Thread(target=_announce, args=(port,), daemon=True).start()
    uvicorn.run(
        app,
        host='0.0.0.0' if LAN else '127.0.0.1',
        port=port,
        log_level=os.environ.get('MASHUP_LOG_LEVEL', 'warning'),
    )


if __name__ == '__main__':
    serve()
