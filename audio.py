import os
from pydub import AudioSegment

from paths import OUTPUT_DIR


def trim(path: str, start: float, end):
    audio = AudioSegment.from_file(path)
    start_ms = max(0, int(start * 1000))
    end_ms = int(end * 1000) if end is not None else len(audio)
    end_ms = min(end_ms, len(audio))
    if start_ms >= end_ms:
        raise ValueError(f'Bad trim range: start={start}s end={end}s on a {len(audio)/1000:.1f}s clip')
    return audio[start_ms:end_ms]


def merge_clips(segments, crossfade_ms: int, job_id: str) -> str:
    final = None
    for seg in segments:
        if final is None:
            final = seg
            continue
        fade = min(crossfade_ms, len(final), len(seg)) if crossfade_ms > 0 else 0
        final = final.append(seg, crossfade=fade) if fade > 0 else final + seg

    out_path = os.path.join(OUTPUT_DIR, f'{job_id}.mp3')
    final.export(out_path, format='mp3', bitrate='192k')
    return out_path
