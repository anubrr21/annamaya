const lastValues = new Map();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function countUp(root) {
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count) || 0;
    const key = el.dataset.countKey || el.dataset.count;
    const from = lastValues.has(key) ? lastValues.get(key) : 0;
    lastValues.set(key, to);
    if (from === to || reduced()) continue;
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - (1 - k) ** 3;
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString('en-IN');
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = Math.round(from).toLocaleString('en-IN');
    requestAnimationFrame(step);
  }
}

export function haptic(pattern = 10) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

export function stamp(text = 'Logged') {
  if (reduced()) return;
  const el = Object.assign(document.createElement('div'), { className: 'big-stamp', textContent: text });
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1600);
}
