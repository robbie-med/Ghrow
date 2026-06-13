(function () {
  'use strict';

  var KEY = 'growthCurvePlotter:theme';

  function current() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function refreshButtons(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      btn.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
    });
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    refreshButtons(theme);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  // The inline <head> snippet already set the initial theme; just wire the toggle.
  refreshButtons(current());
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      apply(next);
    });
  });
}());
