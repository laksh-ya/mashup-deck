import os
import re
import uuid
import threading
import traceback
from typing import List, Optional

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import janitor
import paths
from parser import parse_text
from youtube import resolve_clip, download_audio
from audio import trim, merge_clips

app = FastAPI(title="Mashup Deck")

JOBS: dict = {}


@app.get('/api/health')
def api_health():
    """Cheap endpoint the page pings on load so a sleeping host wakes early."""
    return {'ok': True, 'jobs': len(JOBS), **versions(), **janitor.usage()}


class ParseRequest(BaseModel):
    text: str


class ClipIn(BaseModel):
    video_id: Optional[str] = None
    url: Optional[str] = None
    query: Optional[str] = None
    title: Optional[str] = None
    start: float = 0
    end: Optional[float] = None


class ResolveRequest(BaseModel):
    clips: List[ClipIn]


class ExportRequest(BaseModel):
    clips: List[ClipIn]
    crossfade_ms: int = 0


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
            end = c.end if c.end is not None else info['duration']
            resolved.append({**info, 'start': c.start, 'end': end})
        except Exception as e:
            resolved.append({'error': str(e), 'query': target})
    return {'clips': resolved}


def run_export(job_id: str, clips: List[ClipIn], crossfade_ms: int):
    """Build the mashup, skipping any clip YouTube refuses rather than losing
    the whole mix. Skipped titles are reported back so the UI can say so."""
    try:
        JOBS[job_id]['status'] = 'running'
        segments = []
        skipped = []
        sources = []
        total = len(clips)

        for i, c in enumerate(clips):
            label = c.title or c.video_id or f'clip {i+1}'
            JOBS[job_id]['step'] = f'Downloading "{label}" ({i + 1}/{total})'
            try:
                path = download_audio(c.video_id)
                sources.append(c.video_id)
                JOBS[job_id]['step'] = f'Trimming "{label}" ({i + 1}/{total})'
                segments.append(trim(path, c.start, c.end))
            except Exception as e:
                skipped.append({'title': label, 'why': str(e)[:160]})
                JOBS[job_id]['skipped'] = skipped
                traceback.print_exc()

        if not segments:
            reasons = '; '.join(s['why'] for s in skipped) or 'nothing could be downloaded'
            raise RuntimeError(reasons)

        JOBS[job_id]['step'] = 'Merging into final mashup...'
        out_path = merge_clips(segments, crossfade_ms, job_id)

        # Fill in the details before flipping to done, so a poll that lands on
        # this instant never sees a finished job with missing metadata.
        JOBS[job_id]['output'] = out_path
        JOBS[job_id]['sources'] = sources
        JOBS[job_id]['used'] = len(segments)
        JOBS[job_id]['skipped'] = skipped
        JOBS[job_id]['step'] = 'Done'
        JOBS[job_id]['status'] = 'done'
    except Exception as e:
        JOBS[job_id]['status'] = 'error'
        JOBS[job_id]['step'] = f'Error: {e}'
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
    t = threading.Thread(target=run_export, args=(job_id, req.clips, req.crossfade_ms), daemon=True)
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
    return FileResponse(job['output'], filename=f'{stem}.mp3', media_type='audio/mpeg')


def versions() -> dict:
    """What this process is actually running, so nothing has to be guessed."""
    import shutil
    import sys

    try:
        import yt_dlp
        ytdlp = yt_dlp.version.__version__
    except Exception:
        ytdlp = 'missing'

    return {
        'python': sys.version.split()[0],
        'yt_dlp': ytdlp,
        'ffmpeg': 'ok' if shutil.which('ffmpeg') else 'MISSING',
        'scratch': paths.DATA_ROOT,
    }


@app.on_event('startup')
def _boot():
    v = versions()
    print(f"[boot] python {v['python']} | yt-dlp {v['yt_dlp']} | ffmpeg {v['ffmpeg']}")
    print(f"[boot] scratch dir {v['scratch']}")
    if v['ffmpeg'] == 'MISSING':
        print('[boot] WARNING: ffmpeg is not on PATH, trimming and merging will fail')
    # clear out whatever a previous run left behind, then sweep on a timer
    janitor.start(JOBS)


static_dir = os.path.join(os.path.dirname(__file__), 'static')
app.mount('/', StaticFiles(directory=static_dir, html=True), name='static')
