// about-app.js — Externalized from about.html inline script for CSP compliance
(function() {
  'use strict';

  // Theme
  var savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  var themeBtn = document.getElementById('themeToggleAbout');
  if (themeBtn) {
    themeBtn.innerHTML = savedTheme === 'dark' ? '&#9774;' : '&#9728;';
    themeBtn.addEventListener('click', function() {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      themeBtn.innerHTML = next === 'dark' ? '&#9774;' : '&#9728;';
    });
  }

  // Language selector
  document.querySelectorAll('.lang-btn[data-lang]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (typeof setLanguage === 'function') setLanguage(this.dataset.lang);
      document.querySelectorAll('.lang-btn').forEach(function(b) { b.setAttribute('aria-pressed', 'false'); });
      this.setAttribute('aria-pressed', 'true');
    });
  });

  // FAQ accordion with keyboard accessibility
  document.querySelectorAll('.faq-q').forEach(function(q) {
    // Add accessibility attributes
    q.setAttribute('role', 'button');
    q.setAttribute('tabindex', '0');
    q.setAttribute('aria-expanded', 'false');

    function toggle() {
      var isOpen = q.classList.toggle('open');
      q.nextElementSibling.classList.toggle('open');
      q.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    q.addEventListener('click', toggle);
    q.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
})();
