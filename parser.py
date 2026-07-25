import re

TIME = r'(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?s?)'
# The scheme is optional on purpose: people type and paste "youtu.be/abc123"
# far more often than they type the full "https://youtu.be/abc123".
URL_RE = re.compile(
    r'((?:https?://)?(?:www\.|m\.)?'
    r'(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|live/|embed/))'
    r'[\w\-]{6,}(?:[?&][\w=%.\-]+)*)',
    re.IGNORECASE,
)
FULL_RE = re.compile(r'\b(full|whole|complete|entire|start to end)\b', re.IGNORECASE)
RANGE_RE = re.compile(
    r'(?:from\s+)?' + TIME + r'\s*(?:to|-|till|until|–|—)\s*' + TIME,
    re.IGNORECASE,
)
STOPWORDS = re.compile(
    r'\b(this|then|video|song|track|clip|from|to|use|take|the|a|an)\b',
    re.IGNORECASE,
)


def to_seconds(t: str) -> float:
    t = t.strip().rstrip('s')
    if ':' in t:
        parts = [float(p) for p in t.split(':')]
        sec = 0.0
        for p in parts:
            sec = sec * 60 + p
        return sec
    return float(t)


def split_segments(text: str):
    text = text.replace('\r', '\n')
    chunks = re.split(r'\n+', text)
    out = []
    for c in chunks:
        out.extend(re.split(r'(?<!\w)then(?!\w)', c, flags=re.IGNORECASE))
    return [s.strip(' ,.;') for s in out if s.strip(' ,.;')]


def parse_clip(segment: str, index: int):
    url_match = URL_RE.search(segment)
    raw_url = url_match.group(1) if url_match else None
    remainder = segment.replace(raw_url, '') if raw_url else segment

    # yt-dlp needs a scheme, otherwise it treats the whole thing as a search
    url = raw_url
    if url and not url.lower().startswith(('http://', 'https://')):
        url = 'https://' + url

    start, end = 0.0, None
    m = RANGE_RE.search(remainder)
    if m:
        start = to_seconds(m.group(1))
        end = to_seconds(m.group(2))
    elif FULL_RE.search(remainder):
        start, end = 0.0, None

    query = None
    if not url:
        q = RANGE_RE.sub('', remainder)
        q = FULL_RE.sub('', q)
        q = STOPWORDS.sub('', q)
        query = re.sub(r'\s+', ' ', q).strip(' ,.-')
        if not query:
            query = None

    return {
        'index': index,
        'raw': segment,
        'url': url,
        'query': query,
        'start': start,
        'end': end,
    }


def parse_text(text: str):
    segments = split_segments(text)
    return [parse_clip(s, i) for i, s in enumerate(segments)]
