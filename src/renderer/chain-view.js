// Chain view: interactive rack over master.py's real parameters, real
// waveform (window.slopinator.getPeaks) and playback (window.player), and
// the existing single-file master-run flow. "What you see is what runs" —
// every control here maps directly to a master.py CLI flag.

const chainTrackNameEl = document.getElementById('chain-track-name');
const chainTrackSubEl = document.getElementById('chain-track-sub');
const masterBtn = document.getElementById('master-btn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const waveformEl = document.getElementById('waveform');
const waveTimeEl = document.getElementById('wave-time');
const playBtn = document.getElementById('play-btn');
const rackEl = document.getElementById('module-rack');
const detailEl = document.getElementById('mod-detail');
const meterLufsEl = document.getElementById('meter-lufs');
const meterLadderEl = document.getElementById('meter-ladder');
const meterPeakLabelEl = document.getElementById('meter-peak-label');

let inputPath = null;
let currentTrackId = null;
let waveformBars = [];
let inputMissing = false;
let waveDurationSec = 0;

function formatChainTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function updateChainWaveTime(currentSec) {
  waveTimeEl.textContent = `${formatChainTime(currentSec)} / ${formatChainTime(waveDurationSec)}`;
}

const PRESETS = { streaming: -14, soundcloud: -11, club: -8 };

const params = {
  eq: true,
  monoBass: true,
  crossover: 120,
  saturation: true,
  saturationAmount: 0.05,
  target: -14,
  ceiling: -1.0,
};

function currentPresetName() {
  return Object.keys(PRESETS).find((name) => PRESETS[name] === params.target) || null;
}

// --- small DOM builders for the module detail panels ---

function sliderRow(labelText, value, min, max, step, formatFn, onChange) {
  const row = document.createElement('div');
  row.className = 'slider-row';

  const label = document.createElement('label');
  label.textContent = labelText;

  const track = document.createElement('div');
  track.className = 'slider-track-wrap';

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'slider-input';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const num = document.createElement('div');
  num.className = 'slider-num';
  num.textContent = formatFn(value);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    num.textContent = formatFn(v);
    onChange(v);
  });

  track.appendChild(input);
  row.append(label, track, num);
  return row;
}

function bypassToggleRow(value, onChange) {
  const row = document.createElement('div');
  row.className = 'bypass-row';

  const label = document.createElement('label');
  label.className = 'bypass-label';
  label.textContent = 'BYPASS';

  const control = document.createElement('div');
  control.className = 'bypass-control';

  const powerBtn = document.createElement('button');
  powerBtn.className = 'bypass-power-btn';
  powerBtn.setAttribute('aria-label', 'Toggle bypass');
  powerBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>';

  const statusText = document.createElement('span');
  statusText.className = 'bypass-status-text';

  const sync = () => {
    powerBtn.classList.toggle('on', value);
    statusText.classList.toggle('on', value);
    statusText.textContent = value ? 'Processing on' : 'Bypassed';
  };
  sync();

  powerBtn.addEventListener('click', () => {
    value = !value;
    sync();
    onChange(value);
  });

  control.append(powerBtn, statusText);
  row.append(label, control);
  return row;
}

function presetChipsRow() {
  const row = document.createElement('div');
  row.className = 'preset-row';
  Object.entries(PRESETS).forEach(([name, lufs]) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (params.target === lufs ? ' on' : '');
    chip.textContent = `${name[0].toUpperCase()}${name.slice(1)} (${lufs} LUFS)`;
    chip.addEventListener('click', () => {
      params.target = lufs;
      renderRack();
      renderDetail();
    });
    row.appendChild(chip);
  });
  return row;
}

// --- module definitions: maps 1:1 to master.py CLI flags ---

const MODULES = [
  {
    id: 'eq',
    name: 'EQ',
    enabled: () => params.eq,
    valueText: () => '−1.0 / −0.5 / +0.5dB',
    renderDetail: (container) => {
      container.appendChild(
        bypassToggleRow(params.eq, (v) => {
          params.eq = v;
          renderRack();
        })
      );
    },
  },
  {
    id: 'monobass',
    name: 'Mono bass',
    enabled: () => params.monoBass,
    valueText: () => (params.monoBass ? `below ${params.crossover}Hz` : 'bypassed'),
    renderDetail: (container) => {
      container.appendChild(
        sliderRow('CROSSOVER', params.crossover, 40, 300, 1, (v) => `${Math.round(v)} Hz`, (v) => {
          params.crossover = Math.round(v);
          renderRack();
        })
      );
      container.appendChild(
        bypassToggleRow(params.monoBass, (v) => {
          params.monoBass = v;
          renderRack();
        })
      );
    },
  },
  {
    id: 'saturation',
    name: 'Saturation',
    enabled: () => params.saturation,
    valueText: () => (params.saturation ? `${Math.round(params.saturationAmount * 100)}% drive` : 'bypassed'),
    renderDetail: (container) => {
      container.appendChild(
        sliderRow('DRIVE', params.saturationAmount, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => {
          params.saturationAmount = v;
          renderRack();
        })
      );
      container.appendChild(
        bypassToggleRow(params.saturation, (v) => {
          params.saturation = v;
          renderRack();
        })
      );
    },
  },
  {
    id: 'loudness',
    name: 'Loudness',
    enabled: () => true,
    valueText: () => `target ${params.target} LUFS`,
    renderDetail: (container) => {
      container.appendChild(
        sliderRow('TARGET', params.target, -20, -6, 0.5, (v) => `${v} LUFS`, (v) => {
          params.target = v;
          renderRack();
          renderDetail();
        })
      );
      container.appendChild(presetChipsRow());
    },
  },
  {
    id: 'limiter',
    name: 'Limiter',
    enabled: () => true,
    valueText: () => `ceiling ${params.ceiling.toFixed(1)}dBTP`,
    renderDetail: (container) => {
      container.appendChild(
        sliderRow('CEILING', params.ceiling, -3, -0.1, 0.1, (v) => `${v.toFixed(1)} dBTP`, (v) => {
          params.ceiling = Math.round(v * 10) / 10;
          renderRack();
        })
      );
    },
  },
];

let selectedModuleId = 'eq';

function renderRack() {
  rackEl.innerHTML = '';
  MODULES.forEach((mod) => {
    const el = document.createElement('div');
    el.className = 'module' + (mod.id === selectedModuleId ? ' active' : '');

    const led = document.createElement('div');
    led.className = 'mod-led' + (mod.enabled() ? '' : ' off');

    const name = document.createElement('div');
    name.className = 'mod-name';
    name.textContent = mod.name;

    const val = document.createElement('div');
    val.className = 'mod-val';
    val.textContent = mod.valueText();

    el.append(led, name, val);
    el.addEventListener('click', () => {
      selectedModuleId = mod.id;
      renderRack();
      renderDetail();
    });
    rackEl.appendChild(el);
  });
}

function renderDetail() {
  const mod = MODULES.find((m) => m.id === selectedModuleId);
  detailEl.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = `${mod.name} — currently selected module`;
  detailEl.appendChild(heading);
  mod.renderDetail(detailEl);
}

// --- meter sidebar: shows the *final* measured values from the last
// completed run, parsed from master.py's own "Done. Final: ..." line, not
// true real-time metering during processing. ---

const LADDER_RUNGS = 10;
const LADDER_RANGE_DB = 20; // rungs span -20dBTP (bottom) to 0dBTP (top)

function renderLadder(truePeakDb) {
  meterLadderEl.innerHTML = '';
  const litCount =
    truePeakDb == null
      ? 0
      : Math.max(0, Math.min(LADDER_RUNGS, Math.round(((truePeakDb + LADDER_RANGE_DB) / LADDER_RANGE_DB) * LADDER_RUNGS)));

  for (let i = 0; i < LADDER_RUNGS; i++) {
    const rung = document.createElement('div');
    rung.className = 'rung';
    if (i < litCount) {
      if (i >= LADDER_RUNGS - 1) rung.classList.add('lit-red'); // top rung: 0 to -2dBTP
      else if (i >= LADDER_RUNGS - 3) rung.classList.add('lit-amber'); // next 2: -2 to -6dBTP
      else rung.classList.add('lit-teal');
    }
    meterLadderEl.appendChild(rung);
  }
}

function updateMeters(lufs, truePeakDb) {
  meterLufsEl.innerHTML = (lufs == null ? '—' : lufs.toFixed(1)) + '<small> LUFS</small>';
  meterPeakLabelEl.textContent = `True peak: ${truePeakDb == null ? '—' : `${truePeakDb.toFixed(2)} dBTP`}`;
  renderLadder(truePeakDb);
}

// --- waveform + playback ---

async function loadWaveform(path) {
  waveformEl.innerHTML = '';
  waveformBars = [];
  waveDurationSec = 0;
  playBtn.disabled = true;
  playBtn.textContent = '▶ Play';

  const result = await window.slopinator.getPeaks(path, 90);
  if (result.success) {
    result.data.peaks.forEach((peak) => {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${6 + peak * 74}px`;
      waveformEl.appendChild(bar);
    });
    waveformBars = Array.from(waveformEl.children);
    waveDurationSec = result.data.duration_sec;
  }
  updateChainWaveTime(0);

  try {
    await window.player.load(path);
    playBtn.disabled = false;
  } catch {
    playBtn.disabled = true;
  }
}

playBtn.addEventListener('click', async () => {
  window.player.setOwner('chain');
  // The player is shared across views — another view (e.g. Compare) may
  // have loaded something else since we last called player.load(inputPath).
  if (window.player.getCurrentPath() !== inputPath) {
    await window.player.load(inputPath);
  }
  await window.player.toggle();
  playBtn.textContent = window.player.isPlaying() ? '❚❚ Pause' : '▶ Play';
});

window.player.onTimeUpdate((fraction) => {
  // Chain view's inputPath and Compare's originalPath are frequently the
  // exact same source file — the owner check is what stops playback
  // started from Compare (or vice versa) from also driving this screen's
  // progress UI. See player.js's currentOwner comment.
  if (window.player.getCurrentOwner() !== 'chain' || window.player.getCurrentPath() !== inputPath) return;
  const playedCount = Math.floor(fraction * waveformBars.length);
  waveformBars.forEach((bar, i) => bar.classList.toggle('played', i < playedCount));
  updateChainWaveTime(window.player.getCurrentTime());
});

window.player.onEnded(() => {
  if (window.player.getCurrentOwner() !== 'chain' || window.player.getCurrentPath() !== inputPath) return;
  playBtn.textContent = '▶ Play';
});

waveformEl.addEventListener('click', async (e) => {
  if (!inputPath || inputMissing || !waveformBars.length) return;
  const rect = waveformEl.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  window.player.setOwner('chain');
  if (window.player.getCurrentPath() !== inputPath) {
    try {
      await window.player.load(inputPath);
    } catch {
      return;
    }
    playBtn.disabled = false;
  }

  window.player.seekToFraction(fraction);
  updateChainWaveTime(fraction * waveDurationSec);
  const playedCount = Math.floor(fraction * waveformBars.length);
  waveformBars.forEach((bar, i) => bar.classList.toggle('played', i < playedCount));
});

// --- input selection ---
// No output-path picker here — Master renders to an app-managed preview
// slot (one file per track, see window.slopinator.getPreviewPath) rather
// than asking where to save. Writing to a real, user-chosen destination
// is Export's job alone now — see docs/context.md's "Preview vs export"
// section for why splitting these two removed the duplicate-file problem
// the two write paths used to cause.

function updateMasterButton() {
  masterBtn.disabled = !inputPath || inputMissing;
}

async function selectChainInput(path, trackId = null) {
  inputPath = path;
  currentTrackId = trackId;
  chainTrackNameEl.textContent = path.split('/').pop();
  updateMeters(null, null);

  const [missingKind, tracks] = await Promise.all([
    window.slopinator.classifyPath(path),
    trackId ? window.slopinator.libraryList() : Promise.resolve(null),
  ]);
  inputMissing = missingKind === null;
  // A track selected while we were checking may already be stale.
  if (inputPath !== path) return;

  // Reopening a track that was already mastered here should pick up
  // where it left off — both the settings that produced that result and
  // the reading itself — instead of showing a blank meter next to
  // whatever another track happened to leave dialed into the rack.
  const track = trackId && tracks ? tracks.find((t) => t.id === trackId) : null;
  if (track && track.previewParams) {
    Object.assign(params, track.previewParams);
    renderRack();
    renderDetail();
  }
  if (track && track.previewLufs != null) {
    updateMeters(track.previewLufs, track.previewTruePeakDb);
  }

  chainTrackSubEl.classList.toggle('missing', inputMissing);
  if (inputMissing) {
    chainTrackSubEl.textContent = `File not found — it may have been moved or deleted: ${path}`;
    waveformEl.innerHTML = '';
    waveformBars = [];
    waveDurationSec = 0;
    updateChainWaveTime(0);
    playBtn.disabled = true;
    playBtn.textContent = '▶ Play';
  } else {
    chainTrackSubEl.textContent = path;
    loadWaveform(path);
  }
  updateMasterButton();
}

window.selectChainInputAndNavigate = (path, trackId) => {
  selectChainInput(path, trackId);
  activateTab('chain');
};

window.getCurrentChainTrack = () => ({ trackId: currentTrackId, path: inputPath });

// --- mastering ---

async function runWithLogging(runFn, onDone) {
  masterBtn.disabled = true;
  logEl.textContent = '';

  const unsubscribe = window.slopinator.onMasterLog(({ text }) => {
    logEl.textContent += text;
    logEl.scrollTop = logEl.scrollHeight;
  });

  const result = await runFn();
  unsubscribe();
  await onDone(result);
  updateMasterButton();
}

masterBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Mastering…';
  const trackIdAtRunStart = currentTrackId;
  const presetAtRunStart = currentPresetName();
  const paramsAtRunStart = { ...params };
  const previewPath = await window.slopinator.getPreviewPath(trackIdAtRunStart);

  runWithLogging(
    () => window.slopinator.runMaster({ inputPath, outputPath: previewPath, params }),
    async (result) => {
      statusEl.textContent = result.success
        ? 'Done — preview ready. Check it against the original in Compare.'
        : `Failed (exit ${result.code}): ${result.stderr.trim() || 'unknown error'}`;

      if (result.success) {
        updateMeters(result.finalLufs, result.finalTruePeakDb);
      }

      if (result.success && trackIdAtRunStart) {
        await window.slopinator.libraryUpdate(trackIdAtRunStart, {
          status: 'mastered',
          previewPreset: presetAtRunStart,
          previewedAt: new Date().toISOString(),
          previewPath,
          previewLufs: result.finalLufs,
          previewTruePeakDb: result.finalTruePeakDb,
          previewParams: paramsAtRunStart,
        });
      }
    }
  );
});

// --- named chain presets ---
// The mockup put "Save presets used" on the Export screen, but the rack
// params live here — Export already re-uses each track's previewParams,
// so saving/applying named chains belongs where the chain is edited.

const presetSelectEl = document.getElementById('preset-select');
const presetNameEl = document.getElementById('preset-name');
const presetSaveBtn = document.getElementById('preset-save-btn');
const presetDeleteBtn = document.getElementById('preset-delete-btn');

function renderPresetOptions(presets, selectedName = '') {
  presetSelectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Apply preset…';
  presetSelectEl.appendChild(placeholder);

  presets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.name;
    option.textContent = preset.name;
    presetSelectEl.appendChild(option);
  });

  presetSelectEl.value = selectedName;
  presetDeleteBtn.disabled = !selectedName;
}

function applyPresetParams(presetParams) {
  Object.assign(params, presetParams);
  renderRack();
  renderDetail();
}

// Defaults to "Club" on every launch (not the last-used selection) — see
// docs/todos.md's Chain view redesign notes.
async function refreshPresets(selectedName = 'Club') {
  const presets = await window.slopinator.presetsList();
  const selected = presets.find((p) => p.name === selectedName);
  renderPresetOptions(presets, selected ? selectedName : '');
  if (selected) applyPresetParams(selected.params);
}

presetSelectEl.addEventListener('change', async () => {
  const name = presetSelectEl.value;
  presetDeleteBtn.disabled = !name;
  if (!name) return;
  const preset = (await window.slopinator.presetsList()).find((p) => p.name === name);
  if (!preset) return;
  applyPresetParams(preset.params);
});

presetSaveBtn.addEventListener('click', async () => {
  const name = presetNameEl.value.trim();
  if (!name) {
    presetNameEl.focus();
    return;
  }
  const presets = await window.slopinator.presetsSave(name, { ...params });
  presetNameEl.value = '';
  renderPresetOptions(presets, name);
});

presetDeleteBtn.addEventListener('click', async () => {
  const name = presetSelectEl.value;
  if (!name) return;
  const presets = await window.slopinator.presetsDelete(name);
  renderPresetOptions(presets, '');
});

renderRack();
renderDetail();
updateMeters(null, null);
refreshPresets();
