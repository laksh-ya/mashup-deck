import io
import math
import os
import statistics
import subprocess
import tempfile

from pydub import AudioSegment
from pydub.utils import mediainfo

from paths import OUTPUT_DIR

# What a finished mix can be saved as. m4a goes through ffmpeg's ipod muxer,
# which is what writes a .m4a that phones and iTunes are happy with.
FORMATS = {
    'mp3': {'format': 'mp3', 'codec': None, 'mime': 'audio/mpeg'},
    'm4a': {'format': 'ipod', 'codec': 'aac', 'mime': 'audio/mp4'},
    'wav': {'format': 'wav', 'codec': None, 'mime': 'audio/wav'},
}
BITRATES = ('128k', '192k', '256k', '320k')

# pydub has no limiter, so turning a clip up stops this far below full scale
PEAK_CEILING_DB = -1.0

# Past about ten percent faster or slower a voice stops sounding like itself, so
# a song further off than that from the first one is left at its own tempo.
MAX_STRETCH = 0.10


def _ffmpeg(*args):
    run = subprocess.run(
        [AudioSegment.converter, '-y', '-hide_banner', '-loglevel', 'error', *args],
        capture_output=True, text=True,
    )
    if run.returncode != 0:
        raise RuntimeError((run.stderr or 'ffmpeg failed').strip().splitlines()[-1][:200])


def trim(path: str, start: float, end):
    audio = AudioSegment.from_file(path)
    start_ms = max(0, int(start * 1000))
    end_ms = int(end * 1000) if end is not None else len(audio)
    end_ms = min(end_ms, len(audio))
    if start_ms >= end_ms:
        raise ValueError(f'Bad trim range: start={start}s end={end}s on a {len(audio)/1000:.1f}s clip')
    return audio[start_ms:end_ms]


def audio_seconds(path: str) -> float:
    """How long a file plays, read from its header by ffprobe."""
    return round(float(mediainfo(path).get('duration') or 0), 2)


def import_upload(src: str, dest: str) -> float:
    """Turn whatever someone uploaded into the same mp3 a download would be.

    ffmpeg does the reading, so a video file works as well as a song, and the
    file is never decoded into memory whole the way pydub would."""
    try:
        _ffmpeg('-i', src, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '44100',
                '-b:a', '192k', '-f', 'mp3', dest)
        seconds = float(mediainfo(dest).get('duration') or 0)
    except Exception:
        if os.path.exists(dest):
            os.remove(dest)
        raise
    if seconds < 0.5:
        os.remove(dest)
        raise ValueError('there is no audio in it to speak of')
    return round(seconds, 2)


def even_out(segments):
    """Bring every clip to the loudness of the typical one in the mix.

    Loudness here is the average level (RMS), which is what the ear goes by
    between two songs far more than the peaks. Quiet clips are only lifted as
    far as their loudest moment allows, so nothing is pushed into clipping."""
    levels = [s.dBFS for s in segments]
    heard = [l for l in levels if l != float('-inf')]
    if len(heard) < 2:
        return segments

    target = statistics.median(heard)
    out = []
    for seg, level in zip(segments, levels):
        if level == float('-inf'):
            out.append(seg)
            continue
        gain = target - level
        if gain > 0:
            gain = max(0.0, min(gain, PEAK_CEILING_DB - seg.max_dBFS))
        out.append(seg.apply_gain(gain) if abs(gain) >= 0.1 else seg)
    return out


def estimate_bpm(seg):
    """A rough tempo from the way the loudness pulses, or None if there is no
    clear beat. It looks at how often the level jumps, so it hears drums well
    and a slow ballad hardly at all, which is when None is the honest answer."""
    hop = 10                                     # ms per step of the envelope
    probe = seg[:60_000].set_channels(1)
    env = [probe[i:i + hop].rms for i in range(0, len(probe) - hop, hop)]
    if len(env) < 600:                           # under six seconds says too little
        return None

    logs = [math.log1p(e) for e in env]
    onset = [max(0.0, logs[i] - logs[i - 1]) for i in range(1, len(logs))]
    mean = sum(onset) / len(onset)
    onset = [o - mean for o in onset]

    steps_per_min = 60_000 / hop
    lo, hi = int(steps_per_min / 180), int(steps_per_min / 70)
    n = len(onset)
    score = {
        lag: sum(onset[i] * onset[i + lag] for i in range(n - lag)) / (n - lag)
        for lag in range(lo - 1, hi + 2)
    }
    best = max(range(lo, hi + 1), key=score.get)
    if score[best] <= 0:
        return None

    # the true period sits between steps, so read it off a parabola through the peak
    a, b, c = score[best - 1], score[best], score[best + 1]
    bend = a - 2 * b + c
    shift = 0.5 * (a - c) / bend if bend else 0.0
    return steps_per_min / (best + shift)


def tempo_ratio(reference, bpm):
    """How much faster to play a clip at `bpm` so it sits on `reference`.

    Half and double time count as the same groove, since a beat tracker often
    lands on either, so the ratio is folded to the nearest one first."""
    if not reference or not bpm:
        return None
    r = reference / bpm
    while r > 1.42:
        r /= 2
    while r < 0.71:
        r *= 2
    if abs(r - 1) < 0.01 or abs(r - 1) > MAX_STRETCH:
        return None
    return r


def change_tempo(seg, ratio: float):
    """Speed up or slow down without changing the pitch (ffmpeg's atempo)."""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, 'in.wav')
        dst = os.path.join(tmp, 'out.wav')
        seg.export(src, format='wav').close()
        _ffmpeg('-i', src, '-filter:a', f'atempo={ratio:.5f}', dst)
        with open(dst, 'rb') as fh:
            return AudioSegment.from_wav(io.BytesIO(fh.read()))


def match_tempo(segments):
    """Line every clip up with the first one that has a clear beat.

    Returns the clips and, for each, the ratio it was played at (None where it
    was left alone)."""
    tempos = [estimate_bpm(s) for s in segments]
    reference = next((t for t in tempos if t), None)
    ratios = [tempo_ratio(reference, t) for t in tempos]
    out = [change_tempo(s, r) if r else s for s, r in zip(segments, ratios)]
    return out, ratios


def merge_clips(segments, crossfades, job_id: str, fade_in_ms: int = 0,
                fade_out_ms: int = 0, fmt: str = 'mp3', bitrate: str = '192k'):
    """Join the clips and save the mix.

    `crossfades[i]` is the overlap leading into clip i, so each join can have its
    own. Returns the file, and where each clip landed in it in seconds: tempo
    changes and pydub's crossfade make that hard to work out from the trims."""
    final = None
    timeline = []
    for seg, want in zip(segments, crossfades):
        if final is None:
            final = seg
            timeline.append({'from': 0.0, 'to': round(len(seg) / 1000, 3), 'fade': 0.0})
            continue
        fade = min(max(0, int(want or 0)), len(final), len(seg))
        start = len(final) - fade
        final = final.append(seg, crossfade=fade) if fade > 0 else final + seg
        timeline.append({'from': round(start / 1000, 3), 'to': round(len(final) / 1000, 3),
                         'fade': round(fade / 1000, 3)})

    if fade_in_ms > 0:
        final = final.fade_in(min(int(fade_in_ms), len(final)))
    if fade_out_ms > 0:
        final = final.fade_out(min(int(fade_out_ms), len(final)))

    ext = fmt if fmt in FORMATS else 'mp3'
    spec = FORMATS[ext]
    options = {'format': spec['format']}
    if spec['codec']:
        options['codec'] = spec['codec']
    if ext != 'wav':
        options['bitrate'] = bitrate if bitrate in BITRATES else '192k'

    out_path = os.path.join(OUTPUT_DIR, f'{job_id}.{ext}')
    final.export(out_path, **options).close()
    return out_path, timeline
