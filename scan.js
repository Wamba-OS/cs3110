/* =============================================================
   scan.js — Card scanner page (Tesseract.js OCR + Scryfall)
   Supports single-card mode and binder grid mode.
   Depends on: utils.js, api.js, Tesseract (CDN)
   ============================================================= */
'use strict';

const SCRYFALL = 'https://api.scryfall.com';

// ---- State ----
let stream        = null;   // MediaStream from camera
let capturedImage = null;   // HTMLImageElement of captured/uploaded frame
let confirmedCard = null;   // Scryfall card object confirmed in single mode
let scanMode      = 'single';
let gridRows      = 3;
let gridCols      = 3;
let currentCell   = 0;
const gridResultsMap = new Map(); // cell index → matches[]

// ---- DOM refs ----
const video          = document.getElementById('scan-video');
const previewCanvas  = document.getElementById('scan-preview-canvas');
const guide          = document.getElementById('scan-guide');
const guideRect      = document.getElementById('scan-guide-rect');
const guideGrid      = document.getElementById('scan-guide-grid');
const btnStartCamera = document.getElementById('btn-start-camera');
const btnCapture     = document.getElementById('btn-capture');
const btnUpload      = document.getElementById('btn-upload');
const btnIdentify    = document.getElementById('btn-identify');
const fileInput      = document.getElementById('scan-file-input');
const progressEl     = document.getElementById('scan-progress');
const resultsSection = document.getElementById('scan-results-section');
const resultsGrid    = document.getElementById('scan-results-grid');
const addForm        = document.getElementById('scan-add-form');
const selectedName   = document.getElementById('scan-selected-name');
const scanQty        = document.getElementById('scan-qty');
const scanCondition  = document.getElementById('scan-condition');
const scanFoil       = document.getElementById('scan-foil');
const scanAddBtn     = document.getElementById('scan-add-btn');
const scanAgainBtn   = document.getElementById('scan-again-btn');

// Grid mode refs
const btnModeSingle      = document.getElementById('btn-mode-single');
const btnModeGrid        = document.getElementById('btn-mode-grid');
const gridSizeSelect     = document.getElementById('grid-size-select');
const scanGridOptions    = document.getElementById('scan-grid-options');
const gridSection        = document.getElementById('scan-grid-section');
const gridList           = document.getElementById('scan-grid-list');
const gridBulk           = document.getElementById('scan-grid-bulk');
const bulkCondition      = document.getElementById('bulk-condition');
const bulkFoil           = document.getElementById('bulk-foil');
const btnAddGridSelected = document.getElementById('btn-add-grid-selected');
const btnGridAgain       = document.getElementById('btn-grid-again');

// ---- Mode toggle ----
btnModeSingle.addEventListener('click', () => setMode('single'));
btnModeGrid.addEventListener('click',   () => setMode('grid'));

function setMode(mode) {
  scanMode = mode;
  btnModeSingle.classList.toggle('active', mode === 'single');
  btnModeGrid.classList.toggle('active',   mode === 'grid');
  scanGridOptions.classList.toggle('hidden', mode === 'single');
  guideRect.classList.toggle('hidden', mode === 'grid');
  guideGrid.classList.toggle('hidden', mode === 'single');
  btnIdentify.innerHTML = mode === 'grid'
    ? '&#9638; Identify Grid'
    : '&#128269; Identify Card';
  resetScan();
  if (mode === 'grid') updateGridGuide();
}

// ---- Grid size selector ----
gridSizeSelect.addEventListener('change', () => {
  const [r, c] = gridSizeSelect.value.split('x').map(Number);
  gridRows = r;
  gridCols = c;
  updateGridGuide();
});

function updateGridGuide() {
  guideGrid.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
  guideGrid.style.gridTemplateRows    = `repeat(${gridRows}, 1fr)`;
  guideGrid.innerHTML = '';
  for (let i = 0; i < gridRows * gridCols; i++) {
    const cell = document.createElement('div');
    cell.className = 'scan-guide-cell';
    guideGrid.appendChild(cell);
  }
}

// ---- Camera ----
btnStartCamera.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
    video.srcObject = stream;
    video.style.display = '';
    previewCanvas.style.display = 'none';
    guide.style.display = '';
    btnCapture.disabled = false;
    btnStartCamera.textContent = '&#9209; Stop Camera';
    btnStartCamera.removeEventListener('click', arguments.callee);
    btnStartCamera.addEventListener('click', stopCamera);
    setProgress('');
  } catch (e) {
    setProgress(`Camera unavailable: ${e.message}. Use Upload instead.`);
  }
});

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  video.style.display = 'none';
  btnCapture.disabled = true;
  btnStartCamera.textContent = '&#128247; Start Camera';
}

// ---- Capture from video ----
btnCapture.addEventListener('click', () => {
  const vW = video.videoWidth  || 640;
  const vH = video.videoHeight || 480;

  if (scanMode === 'grid') {
    // Grid mode: capture the full video frame
    previewCanvas.width  = vW;
    previewCanvas.height = vH;
    previewCanvas.getContext('2d').drawImage(video, 0, 0, vW, vH);
  } else {
    // Single mode: crop to the guide rectangle
    const cW = video.clientWidth;
    const cH = video.clientHeight;
    const scale   = Math.max(cW / vW, cH / vH);
    const offsetX = (cW - vW * scale) / 2;
    const offsetY = (cH - vH * scale) / 2;

    const guideW    = 0.58 * cW;
    const guideH    = guideW * (88 / 63);
    const guideLeft = (cW - guideW) / 2;
    const guideTop  = (cH - guideH) / 2;

    const cropX = (guideLeft - offsetX) / scale;
    const cropY = (guideTop  - offsetY) / scale;
    const cropW = guideW / scale;
    const cropH = guideH / scale;

    const outW = 630;
    const outH = Math.round(outW * (88 / 63));
    previewCanvas.width  = outW;
    previewCanvas.height = outH;
    previewCanvas.getContext('2d').drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  }

  previewCanvas.style.display = 'block';
  video.style.display = 'none';
  guide.style.display = 'none';

  capturedImage = canvasToImage(previewCanvas);
  btnIdentify.disabled = false;
  setProgress(scanMode === 'grid'
    ? `Grid captured (${gridRows}×${gridCols}). Press Identify Grid when ready.`
    : 'Image captured. Press Identify Card when ready.');
});

// ---- Upload fallback ----
btnUpload.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      previewCanvas.width  = img.naturalWidth;
      previewCanvas.height = img.naturalHeight;
      previewCanvas.style.display = 'block';
      video.style.display  = 'none';
      guide.style.display  = 'none';
      previewCanvas.getContext('2d').drawImage(img, 0, 0);
      capturedImage = img;
      btnIdentify.disabled = false;
      setProgress('Image loaded. Press Identify when ready.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// ---- Identify dispatcher ----
btnIdentify.addEventListener('click', async () => {
  if (!capturedImage) return;
  if (scanMode === 'grid') {
    await identifyGrid();
  } else {
    await identifySingle();
  }
});

// ================================================================
// SINGLE-CARD MODE
// ================================================================
async function identifySingle() {
  btnIdentify.disabled = true;
  resultsSection.style.display = 'none';
  resultsGrid.innerHTML = '';
  addForm.classList.add('hidden');
  confirmedCard = null;

  setProgress('Preparing image for identification...', true);
  try {
    const croppedCanvas = cropNameArea(capturedImage);

    setProgress('Loading OCR engine (first run may take a moment)...', true);

    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setProgress(`Deciphering runes: ${Math.round((m.progress ?? 0) * 100)}%`, true);
        }
      },
    });

    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,'-.",
    });

    const { data: { text } } = await worker.recognize(croppedCanvas);
    await worker.terminate();

    const cleaned    = cleanOcrText(text);
    const rawPreview = text.trim().slice(0, 60).replace(/\n/g, ' ↵ ');
    setProgress(`OCR raw: "${rawPreview}" → cleaned: "${cleaned}" — searching Scryfall...`, true);

    if (!cleaned) {
      setProgress('Could not read card name. Try better lighting or a clearer photo.');
      btnIdentify.disabled = false;
      return;
    }

    const matches = await searchScryfall(cleaned);
    if (!matches.length) {
      setProgress(`No cards found matching "${cleaned}". Try uploading a clearer image.`);
      btnIdentify.disabled = false;
      return;
    }

    setProgress(`Found ${matches.length} possible match${matches.length > 1 ? 'es' : ''}. Select the correct card below.`);
    renderSingleResults(matches);
  } catch (err) {
    setProgress(`Error: ${err.message}`, false);
    btnIdentify.disabled = false;
  }
}

// ================================================================
// GRID MODE
// ================================================================
async function identifyGrid() {
  btnIdentify.disabled = true;
  gridSection.style.display = '';
  gridList.innerHTML = '';
  gridBulk.classList.add('hidden');
  gridResultsMap.clear();

  const cells = splitIntoGridCells(previewCanvas, gridRows, gridCols);
  const total = cells.length;

  // Pre-render empty slots so the user sees progress live
  for (let i = 0; i < total; i++) appendGridSlot(i, cells[i]);

  setProgress('Loading OCR engine...', true);

  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        setProgress(
          `Card ${currentCell + 1}/${total}: ${Math.round((m.progress ?? 0) * 100)}%`,
          true
        );
      }
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: '7',
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,'-.",
  });

  let identified = 0;
  for (let i = 0; i < total; i++) {
    currentCell = i;
    setProgress(`Identifying card ${i + 1} of ${total}…`, true);

    const croppedCanvas = cropNameArea(cells[i]);
    const { data: { text } } = await worker.recognize(croppedCanvas);
    const cleaned = cleanOcrText(text);

    let matches = [];
    if (cleaned) matches = await searchScryfall(cleaned);

    gridResultsMap.set(i, matches);
    fillGridSlot(i, matches);
    if (matches.length) identified++;

    gridSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  await worker.terminate();
  setProgress(`Grid scan complete: ${identified} of ${total} cards identified.`);
  gridBulk.classList.remove('hidden');
}

function splitIntoGridCells(canvas, rows, cols) {
  const cellW = Math.floor(canvas.width  / cols);
  const cellH = Math.floor(canvas.height / rows);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('canvas');
      cell.width  = cellW;
      cell.height = cellH;
      cell.getContext('2d').drawImage(
        canvas,
        c * cellW, r * cellH, cellW, cellH,
        0, 0, cellW, cellH
      );
      cells.push(cell);
    }
  }
  return cells;
}

function appendGridSlot(index, cellCanvas) {
  const row = document.createElement('div');
  row.className = 'scan-grid-item';
  row.id = `grid-item-${index}`;

  // Draw cell thumbnail
  const thumb = document.createElement('canvas');
  thumb.className = 'scan-grid-thumb';
  const scale = 56 / cellCanvas.width;
  thumb.width  = 56;
  thumb.height = Math.round(cellCanvas.height * scale);
  thumb.getContext('2d').drawImage(cellCanvas, 0, 0, thumb.width, thumb.height);

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'scan-grid-thumb-wrap';
  thumbWrap.appendChild(thumb);

  const matchCol = document.createElement('div');
  matchCol.className = 'scan-grid-match-col';
  matchCol.innerHTML = `<div class="scan-grid-status scanning">Scanning&#8230;</div>`;

  const controls = document.createElement('div');
  controls.className = 'scan-grid-controls hidden';

  row.appendChild(thumbWrap);
  row.appendChild(matchCol);
  row.appendChild(controls);
  gridList.appendChild(row);
}

function fillGridSlot(index, matches) {
  const row      = document.getElementById(`grid-item-${index}`);
  if (!row) return;
  const matchCol = row.querySelector('.scan-grid-match-col');
  const controls = row.querySelector('.scan-grid-controls');

  if (!matches.length) {
    matchCol.innerHTML = `<div class="scan-grid-status failed">Not identified</div>`;
    controls.classList.remove('hidden');
    controls.innerHTML = `
      <label class="scan-grid-include" style="color:var(--text-dim)">
        <input type="checkbox" class="scan-grid-chk" data-index="${index}" disabled />
        Skip
      </label>`;
    row.classList.add('unidentified');
    return;
  }

  const altOptions = matches.map((m, i) =>
    `<option value="${i}">${escapeHtml(m.name)} · ${escapeHtml(m.set_name ?? m.set)}</option>`
  ).join('');

  const best   = matches[0];
  const imgUrl = best.image_uris?.small ?? best.card_faces?.[0]?.image_uris?.small ?? '';

  matchCol.innerHTML = `
    <img class="scan-grid-card-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(best.name)}" loading="lazy" />
    <div class="scan-grid-card-info">
      <div class="scan-grid-card-name">${escapeHtml(best.name)}</div>
      ${matches.length > 1
        ? `<select class="scan-grid-alt d2-select" data-index="${index}">${altOptions}</select>`
        : ''}
    </div>`;

  controls.classList.remove('hidden');
  controls.innerHTML = `
    <label class="scan-grid-include">
      <input type="checkbox" class="scan-grid-chk" data-index="${index}" checked />
      Add
    </label>`;
}

// ---- Batch add ----
btnAddGridSelected.addEventListener('click', async () => {
  const condition = bulkCondition.value;
  const foil      = bulkFoil.checked ? 1 : 0;

  const checked = [...document.querySelectorAll('.scan-grid-chk:checked:not(:disabled)')];
  if (!checked.length) { showFlash('No cards selected', 'error'); return; }

  let added = 0;
  for (const chk of checked) {
    const idx     = +chk.dataset.index;
    const matches = gridResultsMap.get(idx);
    if (!matches?.length) continue;

    const altSel   = document.querySelector(`.scan-grid-alt[data-index="${idx}"]`);
    const matchIdx = altSel ? +altSel.value : 0;
    const card     = matches[matchIdx];
    if (!card) continue;

    try {
      await VaultAPI.collection.add({
        scryfall_id: card.id,
        name:        card.name,
        set_code:    card.set,
        set_name:    card.set_name ?? '',
        rarity:      card.rarity,
        mana_cost:   getField(card, 'mana_cost'),
        type_line:   card.type_line ?? '',
        image_uri:   getImageUri(card),
        quantity:    1,
        foil,
        condition,
      });
      added++;
    } catch { /* skip individual failures */ }
  }

  showFlash(`${added} card${added !== 1 ? 's' : ''} added to My Vault`);
  resetScan();
});

btnGridAgain.addEventListener('click', resetScan);

// ================================================================
// SHARED HELPERS
// ================================================================

// ---- Crop the name band from the image ----
function cropNameArea(img) {
  const w = img.naturalWidth  || img.width  || previewCanvas.width;
  const h = img.naturalHeight || img.height || previewCanvas.height;

  const srcX = 0;
  const srcY = Math.floor(h * 0.02);
  const srcW = Math.floor(w * 0.70);
  const srcH = Math.floor(h * 0.11);

  const SCALE = 3;
  const c   = document.createElement('canvas');
  c.width   = srcW * SCALE;
  c.height  = srcH * SCALE;

  const ctx = c.getContext('2d');
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, c.width, c.height);

  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray    = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boosted = gray > 140 ? Math.min(255, gray * 1.35) : Math.max(0, gray * 0.65);
    d[i] = d[i + 1] = d[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

function canvasToImage(canvas) {
  const img  = new Image();
  img.src    = canvas.toDataURL('image/png');
  img.width  = canvas.width;
  img.height = canvas.height;
  return img;
}

// ---- Clean OCR output ----
function cleanOcrText(raw) {
  const lines = raw.split('\n')
    .map(l => l.replace(/[^a-zA-Z0-9 ',\-.]/g, '').trim())
    .filter(l => l.length > 1);
  if (!lines.length) return '';
  return lines.sort((a, b) => b.length - a.length)[0].trim();
}

// ---- Scryfall search ----
async function searchScryfall(text) {
  const seen    = new Set();
  const results = [];

  async function autocomplete(q) {
    if (!q || q.length < 2) return [];
    try {
      const res  = await fetch(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      return (res.ok && data.data) ? data.data : [];
    } catch { return []; }
  }

  async function fetchNamed(name) {
    if (seen.has(name)) return;
    seen.add(name);
    try {
      const res  = await fetch(`${SCRYFALL}/cards/named?exact=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (res.ok && data.object === 'card' && !seen.has(data.id)) {
        seen.add(data.id);
        results.push(data);
      }
    } catch { /* ok */ }
  }

  async function tryFuzzy(q) {
    if (!q) return;
    try {
      const res  = await fetch(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (res.ok && data.object === 'card' && !seen.has(data.id)) {
        seen.add(data.id);
        results.unshift(data);
      }
    } catch { /* ok */ }
  }

  await tryFuzzy(text);

  for (const name of (await autocomplete(text)).slice(0, 4)) {
    await fetchNamed(name);
    if (results.length >= 6) return results;
  }

  if (results.length < 3) {
    const words = text.split(/\s+/).filter(w => w.length >= 4);
    for (const word of words) {
      await tryFuzzy(word);
      for (const name of (await autocomplete(word)).slice(0, 3)) {
        await fetchNamed(name);
        if (results.length >= 6) return results;
      }
      if (results.length >= 4) break;
    }
  }

  if (results.length === 0 && text.length > 5) {
    for (let len = Math.floor(text.length * 0.8); len >= 4; len -= 2) {
      for (const name of (await autocomplete(text.slice(0, len))).slice(0, 3)) {
        await fetchNamed(name);
      }
      if (results.length > 0) break;
    }
  }

  return results.slice(0, 6);
}

// ---- Render single-mode match results ----
function renderSingleResults(cards) {
  resultsGrid.innerHTML = '';
  for (const card of cards) {
    const img = getImageUri(card);
    const el  = document.createElement('div');
    el.className = 'scan-result-card';
    el.innerHTML = `
      <img src="${escapeHtml(img)}" alt="${escapeHtml(card.name)}" loading="lazy" />
      <div class="scan-result-name">${escapeHtml(card.name)}</div>`;
    el.addEventListener('click', () => confirmCard(card));
    resultsGrid.appendChild(el);
  }
  resultsSection.style.display = '';
}

// ---- Confirm a card (single mode) ----
function confirmCard(card) {
  confirmedCard = card;
  selectedName.textContent = `${card.name} — ${card.set_name ?? card.set} (${card.rarity})`;
  scanQty.value       = 1;
  scanCondition.value = 'NM';
  scanFoil.checked    = false;
  addForm.classList.remove('hidden');
  addForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Add to vault (single mode) ----
scanAddBtn.addEventListener('click', async () => {
  if (!confirmedCard) return;
  const card = confirmedCard;
  try {
    await VaultAPI.collection.add({
      scryfall_id: card.id,
      name:        card.name,
      set_code:    card.set,
      set_name:    card.set_name ?? '',
      rarity:      card.rarity,
      mana_cost:   getField(card, 'mana_cost'),
      type_line:   card.type_line ?? '',
      image_uri:   getImageUri(card),
      quantity:    parseInt(scanQty.value, 10) || 1,
      foil:        scanFoil.checked ? 1 : 0,
      condition:   scanCondition.value,
    });
    showFlash(`${card.name} added to My Vault`);
    resetScan();
  } catch (e) { showFlash(e.message, 'error'); }
});

scanAgainBtn.addEventListener('click', resetScan);

// ---- Reset to scan-ready state ----
function resetScan() {
  capturedImage = null;
  confirmedCard = null;
  currentCell   = 0;
  gridResultsMap.clear();

  previewCanvas.style.display = 'none';
  previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  guide.style.display  = stream ? '' : 'none';
  if (stream) video.style.display = '';

  btnIdentify.disabled = true;
  btnCapture.disabled  = !stream;

  addForm.classList.add('hidden');
  resultsSection.style.display = 'none';
  resultsGrid.innerHTML = '';

  gridSection.style.display = 'none';
  gridList.innerHTML = '';
  gridBulk.classList.add('hidden');

  setProgress('');
}

// ---- Progress helper ----
function setProgress(msg, active = false) {
  progressEl.textContent = msg;
  progressEl.className   = `scan-progress${active ? ' active' : ''}`;
}
