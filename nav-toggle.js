document.querySelectorAll('.nav-burger').forEach(function (btn) {
  var links = btn.parentElement.querySelector('.nav-links');
  if (!links) return;

  function close() {
    links.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = links.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  links.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') close();
  });

  document.addEventListener('click', function (e) {
    if (!links.classList.contains('open')) return;
    if (btn.contains(e.target) || links.contains(e.target)) return;
    close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
});

document.querySelectorAll('.sidebar-toggle').forEach(function (btn) {
  var links = document.getElementById(btn.getAttribute('aria-controls'));
  if (!links) return;

  btn.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
});
