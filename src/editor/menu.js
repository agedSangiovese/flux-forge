/**
 * Context menu.
 *
 * `show(items, x, y)` where an item is either:
 *   '-'                          → separator
 *   { label, fn, hint, danger }  → entry
 *
 * Keyboard: ↑/↓ move, Enter/Space activate, Esc closes (also handled by the
 * shell through `editor.closeMenus()`).
 */

import { el, bind, clamp, isTyping } from './util.js';

export function createMenu(ctx) {
  const menu = ctx.els.ctxMenu;
  const cleanups = [];
  let current = null; // { items, buttons }

  function close() {
    if (!current) return;
    current = null;
    menu.classList.add('hidden');
    menu.textContent = '';
  }

  function run(fn) {
    close();
    // Let the menu disappear before the action paints, so overlays do not
    // flash underneath a freshly opened dialog.
    requestAnimationFrame(() => {
      try {
        fn();
      } catch (err) {
        console.error('[menu] action failed', err);
      }
    });
  }

  function show(items, x, y) {
    close();
    const buttons = [];
    for (const item of items) {
      if (item === '-' || item === 'sep') {
        menu.appendChild(el('div', 'menu-sep'));
        continue;
      }
      if (item && item.head) {
        menu.appendChild(el('div', 'menu-head', item.head));
        continue;
      }
      const spec = typeof item === 'string' ? { label: item } : item;
      if (!spec || !spec.label) continue;
      const b = el('button', `menu-item${spec.danger ? ' danger' : ''}`);
      b.type = 'button';
      if (spec.icon) b.appendChild(el('span', 'menu-ico', spec.icon));
      b.appendChild(el('span', 'menu-label', spec.label));
      if (spec.hint) b.appendChild(el('span', 'menu-hint', spec.hint));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof spec.fn === 'function') run(spec.fn);
      });
      b.addEventListener('pointerenter', () => focus(buttons.indexOf(b), false));
      menu.appendChild(b);
      buttons.push(b);
    }

    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    const left = clamp(x, 6, Math.max(6, window.innerWidth - r.width - 6));
    const top = clamp(y, 6, Math.max(6, window.innerHeight - r.height - 6));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    current = { items, buttons };
    focus(0, false);
  }

  let focused = -1;
  function focus(index, scroll = true) {
    if (!current || !current.buttons.length) return;
    focused = clamp(index, 0, current.buttons.length - 1);
    const b = current.buttons[focused];
    if (!b) return;
    b.focus({ preventScroll: true });
    if (scroll) b.scrollIntoView({ block: 'nearest' });
  }

  bind(
    menu,
    'keydown',
    (e) => {
      if (!current) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focus(focused + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focus(focused - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focus(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focus(current.buttons.length - 1);
      }
    },
    undefined,
    cleanups
  );

  // Click anywhere else dismisses.
  bind(
    document,
    'pointerdown',
    (e) => {
      if (!current) return;
      if (menu.contains(e.target)) return;
      close();
    },
    true,
    cleanups
  );

  bind(
    window,
    'blur',
    () => close(),
    undefined,
    cleanups
  );

  // Esc closes; keep the shell's global handler from acting on the page too.
  bind(
    document,
    'keydown',
    (e) => {
      if (!current) return;
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    },
    true,
    cleanups
  );

  return {
    show,
    close,
    isOpen: () => current !== null,
    destroy() {
      for (const fn of cleanups) fn();
      close();
    },
  };
}

export { isTyping };
