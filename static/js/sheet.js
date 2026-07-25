/* The boxes version of the cue card.

   Same pipeline underneath: the rows are turned back into the plain text the
   parser already understands, so nothing downstream has to know this exists.
   Leaving both time fields empty means the whole track. */

/* The blanks carry the same worked example the pad shows, so the form teaches
   itself: a plain name, a link, and one with no times meaning the whole song. */
const EXAMPLES = [
  { song: 'Kesariya', from: '0:45', to: '1:10' },
  { song: 'youtu.be/4_eEgJhsBMo', from: '0:20', to: '0:52' },
  // times left blank on purpose: that is what keeps a whole song
  { song: 'Levitating', from: '', to: '' },
];

const TMPL = (n) => {
  const eg = EXAMPLES[(n - 1) % EXAMPLES.length];
  return `
  <div class="sheet-row" data-row="${n}">
    <span class="s-n" aria-hidden="true">${n}</span>
    <label class="s-field s-wide">
      <input class="s-song" type="text" placeholder="${eg.song}"
             aria-label="Song ${n}" autocomplete="off" spellcheck="false" />
    </label>
    <label class="s-field s-time">
      <input class="s-in mono" type="text" inputmode="numeric" placeholder="${eg.from}" aria-label="Start of song ${n}" />
    </label>
    <label class="s-field s-time">
      <input class="s-out mono" type="text" inputmode="numeric" placeholder="${eg.to}" aria-label="End of song ${n}" />
    </label>
    <button class="s-drop" type="button" aria-label="Remove song ${n}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12"/></svg>
    </button>
  </div>`;
};

export function mountSheet(root, opts = {}) {
  const rows = root.querySelector('#sheet-rows');
  const addBtn = root.querySelector('#sheet-add');
  const onChange = opts.onChange || (() => {});
  const onSubmit = opts.onSubmit || (() => {});

  function count() {
    return rows.querySelectorAll('.sheet-row').length;
  }

  function renumber() {
    rows.querySelectorAll('.sheet-row').forEach((r, i) => {
      r.dataset.row = i + 1;
      r.querySelector('.s-n').textContent = i + 1;
      r.querySelector('.s-song').setAttribute('aria-label', `Song ${i + 1}`);
    });
    // one row must always remain, or there is nothing to type into
    rows.querySelectorAll('.s-drop').forEach((b) => { b.disabled = count() < 2; });
  }

  function addRow(focus = true) {
    rows.insertAdjacentHTML('beforeend', TMPL(count() + 1));
    const row = rows.lastElementChild;
    row.classList.add('landing');
    row.addEventListener('animationend', () => row.classList.remove('landing'), { once: true });

    row.querySelector('.s-drop').addEventListener('click', () => {
      if (count() < 2) return;
      row.classList.add('leaving');
      setTimeout(() => { row.remove(); renumber(); onChange(); }, 200);
      opts.onDrop?.();
    });

    row.querySelectorAll('input').forEach((el) => {
      el.addEventListener('input', onChange);
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        // enter on the last row adds another, otherwise it sends the sheet
        if (row === rows.lastElementChild && el.classList.contains('s-out')) addRow();
        else onSubmit();
      });
    });

    renumber();
    if (focus) row.querySelector('.s-song').focus();
    onChange();
    return row;
  }

  addBtn.addEventListener('click', () => { addRow(); opts.onAdd?.(); });

  /* Rows out, cue text in. */
  function toText() {
    const lines = [];
    rows.querySelectorAll('.sheet-row').forEach((r) => {
      const song = r.querySelector('.s-song').value.trim();
      if (!song) return;
      const a = r.querySelector('.s-in').value.trim();
      const b = r.querySelector('.s-out').value.trim();
      if (a && b) lines.push(`${song} from ${a} to ${b}`);
      else lines.push(`${song} full`);
    });
    return lines.join('\nthen ');
  }

  /* Cue text in, rows out, so switching modes keeps what you already wrote. */
  function fromText(text) {
    rows.innerHTML = '';
    const chunks = String(text || '')
      .split(/\n+|(?<!\w)then(?!\w)/i)
      .map((s) => s.trim().replace(/^[,.;\s]+|[,.;\s]+$/g, ''))
      .filter(Boolean);

    if (!chunks.length) { addRow(false); addRow(false); addRow(false); return; }

    chunks.forEach((chunk) => {
      const row = addRow(false);
      const range = chunk.match(
        /(?:from\s+)?(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?s?)\s*(?:to|-|till|until|–)\s*(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?s?)/i
      );
      let name = chunk;
      if (range) {
        row.querySelector('.s-in').value = range[1];
        row.querySelector('.s-out').value = range[2];
        name = chunk.replace(range[0], '');
      }
      name = name.replace(/\b(full|whole|complete|entire)\b/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/^[,.\-\s]+|[,.\-\s]+$/g, '');
      row.querySelector('.s-song').value = name;
    });
    renumber();
  }

  function filled() {
    return [...rows.querySelectorAll('.s-song')].some((el) => el.value.trim());
  }

  // three blanks to begin with, mirroring the three lines the pad shows
  addRow(false);
  addRow(false);
  addRow(false);

  return { toText, fromText, addRow, filled, focus: () => rows.querySelector('.s-song')?.focus() };
}
