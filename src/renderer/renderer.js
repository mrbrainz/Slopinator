document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

function activateTab(screenName) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === screenName));
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${screenName}`));
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.screen));
});
