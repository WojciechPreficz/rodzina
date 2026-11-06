/* global window, document, URL */
(() => {
  'use strict';

  const menu = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#navigation');
  const setMenu = (open) => {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
    navigation.classList.toggle('is-open', open);
  };
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menu.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.header-inner')) setMenu(false);
  });
  const desktop = window.matchMedia('(min-width: 901px)');
  desktop.addEventListener('change', () => setMenu(false));

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const activateTab = (tab, focus = false) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        activateTab(tabs[next], true);
      }
    });
  }

  const tasks = [...document.querySelectorAll('[data-demo-task]')];
  for (const task of tasks) {
    task.addEventListener('change', () => {
      const done = tasks.filter((item) => item.checked).length;
      document.getElementById('task-progress').textContent = `${done} / ${tasks.length}`;
      document.getElementById('task-status').textContent = `Wykonane zadania: ${done} z ${tasks.length}.`;
    });
  }

  const ingredients = [
    ['Makaron', '400 g'],
    ['Pomidory', '500 g'],
    ['Bazylia', '1 pęczek'],
    ['Ziemniaki', '1 kg'],
    ['Marchew', '3 szt.'],
    ['Brokuł', '1 szt.'],
  ];
  const add = document.getElementById('add-ingredients');
  const list = document.getElementById('ingredient-list');
  const status = document.getElementById('meal-status');
  const count = document.getElementById('ingredient-count');
  let added = false;
  add.addEventListener('click', () => {
    if (added) return;
    added = true;
    for (const [name, quantity] of ingredients) {
      const row = document.createElement('li');
      for (const value of [name, quantity]) {
        const cell = document.createElement('span');
        cell.textContent = value;
        row.append(cell);
      }
      list.append(row);
    }
    count.textContent = '7 produktów';
    status.textContent = 'Gotowe! Dodano 6 składników. Mleko zostało na liście.';
    add.innerHTML = '<span aria-hidden="true">✓</span> Składniki są już na liście';
    add.setAttribute('aria-disabled', 'true');
    document.getElementById('meal-result').classList.add('is-added');
  });
  document.getElementById('reset-meals').addEventListener('click', () => {
    added = false;
    while (list.children.length > 1) list.lastElementChild.remove();
    count.textContent = '1 produkt';
    status.textContent = 'Wypróbuj przycisk — zobaczysz tutaj składniki.';
    add.innerHTML = '<span aria-hidden="true">＋</span> Dodaj składniki do zakupów <span aria-hidden="true">→</span>';
    add.removeAttribute('aria-disabled');
    document.getElementById('meal-result').classList.remove('is-added');
  });

  const dialog = document.getElementById('prototype-dialog');
  const closeDialog = () => dialog.close();
  dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
  dialog.querySelector('.dialog-confirm').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      closeDialog();
  });

  let applicationOrigin = null;
  try {
    const raw = window.APP_BASE_URL;
    const url = typeof raw === 'string' && raw.trim() ? new URL(raw.trim()) : null;
    if (url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      applicationOrigin = url.origin;
  } catch {
    // An unset or invalid origin keeps navigation inside the prototype.
  }
  for (const link of document.querySelectorAll('[data-app-path]')) {
    if (applicationOrigin) {
      link.href = new URL(link.dataset.appPath, applicationOrigin).href;
    } else {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        dialog.showModal();
      });
    }
  }
})();
