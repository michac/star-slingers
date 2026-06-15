// mock.js — the ONLY script shared by mock variants. Toggles annotation labels.
const scene = document.getElementById('scene');
const toggle = document.getElementById('toggle');
toggle.addEventListener('click', () => {
  scene.classList.toggle('labels-off');
  toggle.textContent = scene.classList.contains('labels-off') ? 'Show labels' : 'Hide labels';
});
