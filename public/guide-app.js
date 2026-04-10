function toggleTheme(){var n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);document.getElementById('themeToggle').textContent=n==='dark'?'D':'L';localStorage.setItem('theme',n);}
(function(){var s=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',s);})();
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function() {}); }

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('themeToggle').addEventListener('click', function() { toggleTheme(); });
  document.querySelectorAll('.lang-btn[data-lang]').forEach(function(btn) {
    btn.addEventListener('click', function() { setLanguage(btn.dataset.lang); });
  });
});
