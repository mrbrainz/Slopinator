// Chain view: interactive rack over master.py's real parameters, real
// waveform (window.slopinator.getPeaks) and playback (window.player), and
// the existing single-file master-run flow. "What you see is what runs" —
// every control here maps directly to a master.py CLI flag.

const chainTrackNameEl = document.getElementById('chain-track-name');
const chainTrackSubEl = document.getElementById('chain-track-sub');
const inputPathEl = document.getElementById('input-path');
const outputPathEl = document.getElementById('output-path');
const masterBtn = document.getElementById('master-btn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const waveformEl = document.getElementById('waveform');
const playBtn = document.getElementById('play-btn');
const rackEl = document.getElementById('module-rack');
const detailEl = document.getElementById('mod-detail');
const meterLufsEl = document.getElementById('meter-lufs');
const meterLadderEl = document.getElementById('meter-ladder');
const meterPeakLabelEl = document.getElementById('meter-peak-label');

let inputPath = null;
let outputPath = null;
let currentTrackId = null;
let waveformBars = [];

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
  row.className = 'slider-row';

  const label = document.createElement('label');
  label.textContent = 'BYPASS';

  const toggle = document.createElement('div');
  toggle.className = 'ab-toggle bypass-toggle';

  const onBtn = document.createElement('button');
  onBtn.textContent = 'On';
  const offBtn = document.createElement('button');
  offBtn.textContent = 'Off';

  const sync = () => {
    onBtn.classList.toggle('on', value);
    offBtn.classList.toggle('on', !value);
  };
  sync();

  onBtn.addEventListener('click', () => {
    value = true;
    sync();
    onChange(true);
  });
  offBtn.addEventListener('click', () => {
    value = false;
    sync();
    onChange(false);
  });

  toggle.append(onBtn, offBtn);
  row.append(label, toggle);
  return row;
}

function presetChipsRow() {
  const row = document.createElement('div');
  row.className = 'preset-row';
  Object.entries(PRESETS).forEach(([name, lufs]) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (params.target === lufs ? ' on' : '');
    chip.textContent = `${name} (${lufs} LUFS)`;
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
  }

  try {
    await window.player.load(path);
    playBtn.disabled = false;
  } catch {
    playBtn.disabled = true;
  }
}

playBtn.addEventListener('click', async () => {
  // The player is shared across views — another view (e.g. Compare) may
  // have loaded something else since we last called player.load(inputPath).
  if (window.player.getCurrentPath() !== inputPath) {
    await window.player.load(inputPath);
  }
  await window.player.toggle();
  playBtn.textContent = window.player.isPlaying() ? '❚❚ Pause' : '▶ Play';
});

window.player.onTimeUpdate((fraction) => {
  if (window.player.getCurrentPath() !== inputPath) return;
  const playedCount = Math.floor(fraction * waveformBars.length);
  waveformBars.forEach((bar, i) => bar.classList.toggle('played', i < playedCount));
});

window.player.onEnded(() => {
  if (window.player.getCurrentPath() !== inputPath) return;
  playBtn.textContent = '▶ Play';
});

// --- input/output selection ---

function updateMasterButton() {
  masterBtn.disabled = !(inputPath && outputPath);
}

function defaultOutputName(path) {
  const base = path.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot === -1 ? `${base}-mastered` : `${base.slice(0, dot)}-mastered${base.slice(dot)}`;
}

function selectChainInput(path, trackId = null) {
  inputPath = path;
  currentTrackId = trackId;
  inputPathEl.value = inputPath;
  chainTrackNameEl.textContent = path.split('/').pop();
  chainTrackSubEl.textContent = path;
  loadWaveform(path);
  updateMeters(null, null);
  updateMasterButton();
}

window.selectChainInputAndNavigate = (path, trackId) => {
  selectChainInput(path, trackId);
  activateTab('chain');
};

window.getCurrentChainTrack = () => ({ trackId: currentTrackId, path: inputPath });
window.getChainParams = () => ({ ...params });

document.getElementById('pick-input').addEventListener('click', async () => {
  const picked = await window.slopinator.pickInputFile();
  if (!picked) return;
  selectChainInput(picked);
});

document.getElementById('pick-output').addEventListener('click', async () => {
  const defaultName = inputPath ? defaultOutputName(inputPath) : 'mastered.wav';
  const picked = await window.slopinator.pickOutputPath(defaultName);
  if (!picked) return;
  outputPath = picked;
  outputPathEl.value = outputPath;
  updateMasterButton();
});

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

masterBtn.addEventListener('click', () => {
  statusEl.textContent = 'Mastering…';
  const trackIdAtRunStart = currentTrackId;
  const outputPathAtRunStart = outputPath;
  const presetAtRunStart = currentPresetName();
  const paramsAtRunStart = { ...params };

  runWithLogging(
    () => window.slopinator.runMaster({ inputPath, outputPath, params }),
    async (result) => {
      statusEl.textContent = result.success
        ? `Done: ${outputPath}`
        : `Failed (exit ${result.code}): ${result.stderr.trim() || 'unknown error'}`;

      if (result.success) {
        updateMeters(result.finalLufs, result.finalTruePeakDb);
      }

      if (result.success && trackIdAtRunStart) {
        await window.slopinator.libraryUpdate(trackIdAtRunStart, {
          status: 'mastered',
          masteredPreset: presetAtRunStart,
          masteredAt: new Date().toISOString(),
          masteredPath: outputPathAtRunStart,
          masteredLufs: result.finalLufs,
          masteredTruePeakDb: result.finalTruePeakDb,
          masteredParams: paramsAtRunStart,
        });
      }
    }
  );
});

const dropZone = document.getElementById('drop-zone');

['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  })
);

['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  })
);

dropZone.addEventListener('drop', async (e) => {
  const dropped = e.dataTransfer.files[0];
  if (!dropped) return;
  const droppedPath = dropped.path;

  const kind = await window.slopinator.classifyPath(droppedPath);
  if (kind === 'directory') {
    statusEl.textContent = `Mastering folder: ${droppedPath}…`;
    runWithLogging(
      () => window.slopinator.runMasterBatch({ dirPath: droppedPath, params }),
      (result) => {
        statusEl.textContent = result.success
          ? `Done: ${result.outdir}`
          : `Failed: ${result.stderr.trim() || 'unknown error'}`;
      }
    );
  } else if (kind === 'file') {
    selectChainInput(droppedPath);
  }
});

renderRack();
renderDetail();
updateMeters(null, null);
