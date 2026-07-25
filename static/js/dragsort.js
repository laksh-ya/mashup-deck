/* Drag to reorder, by pointer or by keyboard.

   While a strip is held, the others slide out of the way instead of the list
   re-rendering under the cursor, so the drop lands where you expect. */

export function makeSortable(container, opts) {
  const { itemSelector, handleSelector, onReorder, onLift, onMoveStep } = opts;
  const DEAD_ZONE = 4;

  let items = [];
  let rects = [];
  let dragEl = null;
  let fromIndex = -1;
  let toIndex = -1;
  let startY = 0;
  let gap = 0;
  let active = false;
  let pointerId = null;

  function itemList() {
    return Array.from(container.querySelectorAll(itemSelector));
  }

  function onPointerDown(e) {
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    if (e.button != null && e.button !== 0) return;

    dragEl = handle.closest(itemSelector);
    if (!dragEl) return;

    items = itemList();
    if (items.length < 2) { dragEl = null; return; }

    fromIndex = items.indexOf(dragEl);
    toIndex = fromIndex;
    startY = e.clientY;
    pointerId = e.pointerId;
    active = false;

    rects = items.map((el) => el.getBoundingClientRect());
    gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;

    handle.setPointerCapture?.(e.pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragEl || e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;

    if (!active) {
      if (Math.abs(dy) < DEAD_ZONE) return;
      active = true;
      dragEl.classList.add('dragging');
      items.forEach((el) => el !== dragEl && el.classList.add('shifting'));
      onLift?.();
    }

    dragEl.style.transform = `translateY(${dy}px)`;

    // Where would it land? Compare the dragged centre to the others.
    const myCentre = rects[fromIndex].top + rects[fromIndex].height / 2 + dy;
    let target = fromIndex;
    for (let i = 0; i < rects.length; i++) {
      if (i === fromIndex) continue;
      const c = rects[i].top + rects[i].height / 2;
      if (i < fromIndex && myCentre < c) { target = Math.min(target, i); }
      if (i > fromIndex && myCentre > c) { target = Math.max(target, i); }
    }

    if (target !== toIndex) {
      toIndex = target;
      onMoveStep?.();
    }

    // Slide everyone between the old slot and the new one.
    const step = rects[fromIndex].height + gap;
    items.forEach((el, i) => {
      if (el === dragEl) return;
      let shift = 0;
      if (toIndex < fromIndex && i >= toIndex && i < fromIndex) shift = step;
      else if (toIndex > fromIndex && i > fromIndex && i <= toIndex) shift = -step;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function onPointerUp(e) {
    if (!dragEl) return;
    const handle = e.currentTarget;
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerUp);

    const wasActive = active;
    const from = fromIndex;
    const to = toIndex;

    items.forEach((el) => {
      el.classList.remove('dragging', 'shifting');
      el.style.transform = '';
    });

    dragEl = null;
    active = false;
    pointerId = null;

    if (wasActive && from !== to) onReorder(from, to);
  }

  function onKeyDown(e) {
    const handle = e.target.closest(handleSelector);
    if (!handle) return;
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const list = itemList();
    const i = list.indexOf(handle.closest(itemSelector));
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    onReorder(i, j, { refocus: j });
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('keydown', onKeyDown);
}
