document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

function activateTab(screenName) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === screenName));
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${screenName}`));
  document.dispatchEvent(new CustomEvent('screen-activated', { detail: { screen: screenName } }));
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.screen));
});

// Lets a build be matched back to an exact commit at a glance instead of
// guessing whether a running/packaged app is stale — see
// scripts/generate-build-info.js.
const buildFooterEl = document.getElementById('build-footer');
if (buildFooterEl && window.slopinator && window.slopinator.getBuildInfo) {
  window.slopinator.getBuildInfo().then(({ buildNumber, commit }) => {
    buildFooterEl.textContent = `Build #${buildNumber} (${commit})`;
  });
}
