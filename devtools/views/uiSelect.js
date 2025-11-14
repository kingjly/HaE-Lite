export function createUiSelect(options, current, onBlur) {
  const wrap = document.createElement('div');
  wrap.className = 'ui-select';
  wrap.tabIndex = 0;
  const display = document.createElement('span');
  display.className = 'sel-display';
  const arrow = document.createElement('span');
  arrow.className = 'sel-arrow';
  const menu = document.createElement('ul');
  menu.className = 'sel-menu';
  const opts = Array.isArray(options) ? options : [];
  const init = current && opts.includes(current) ? current : opts[0] || '';
  wrap.value = init;
  display.textContent = init;
  opts.forEach((opt) => {
    const li = document.createElement('li');
    li.dataset.value = opt;
    li.textContent = opt;
    menu.appendChild(li);
  });
  wrap.append(display, arrow, menu);
  const open = () => wrap.classList.add('open');
  const close = (trigger) => {
    if (!wrap.classList.contains('open')) return;
    wrap.classList.remove('open');
    if (trigger && typeof onBlur === 'function') onBlur(wrap.value);
  };
  wrap.addEventListener('click', (e) => {
    wrap.classList.contains('open') ? close(false) : open();
    e.stopPropagation();
  });
  wrap.addEventListener('focusout', () => close(true));
  menu.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    wrap.value = li.dataset.value || '';
    display.textContent = wrap.value;
    wrap.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(false);
    else if (e.key === 'Enter') (wrap.classList.contains('open') ? close(true) : open());
  });
  return wrap;
}
