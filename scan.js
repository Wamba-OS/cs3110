/* =============================================================
   scan.js — Card scanner page (Tesseract.js OCR + Scryfall)
   Depends on: utils.js, api.js, Tesseract (CDN)
   ============================================================= */
'use strict';

const SCRYFALL = 'https://api.scryfall.com';

// ---- DOM refs ----
const video          = document.getElementById('scan-video');
const previewCanvas  = document.getElementById('scan-preview-canvas');
const guide          = document.getElementById('scan-guide');
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

let stream        = null;   // MediaStream from camera
let capturedImage = null;   // HTMLImageElement of captured/uploaded frame
let confirmedCard = null;   // Scryfall card object the user picked

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

  // The video element uses object-fit:cover inside the viewport box.
  // We need to map the guide rectangle (in CSS/viewport pixels) back to
  // the actual video pixel coordinates so the crop matches the guide box.
  const cW = video.clientWidth;
  const cH = video.clientHeight;

  // Scale used by object-fit:cover — the larger of the two ratios
  const scale   = Math.max(cW / vW, cH / vH);
  // How far the rendered video overflows the viewport (may be negative = cropped)
  const offsetX = (cW - vW * scale) / 2;
  const offsetY = (cH - vH * scale) / 2;

  // Guide rectangle dimensions in viewport space (mirrors the CSS)
  const guideW    = 0.58 * cW;
  const guideH    = guideW * (88 / 63);          // MTG card aspect ratio
  const guideLeft = (cW - guideW) / 2;
  const guideTop  = (cH - guideH) / 2;

  // Convert guide rect to video pixel coordinates
  const cropX = (guideLeft - offsetX) / scale;
  const cropY = (guideTop  - offsetY) / scale;
  const cropW = guideW / scale;
  const cropH = guideH / scale;

  // Output at a fixed card-sized resolution
  const outW = 630;
  const outH = Math.round(outW * (88 / 63));

  previewCanvas.width  = outW;
  previewCanvas.height = outH;
  previewCanvas.style.display = 'block';
  video.style.display = 'none';
  guide.style.display = 'none';

  previewCanvas.getContext('2d').drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  capturedImage = canvasToImage(previewCanvas);
  btnIdentify.disabled = false;
  setProgress('Image captured. Press Identify Card when ready.');
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
      setProgress('Image loaded. Press Identify Card when ready.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// ---- OCR identification ----
btnIdentify.addEventListener('click', async () => {
  if (!capturedImage) return;
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

    // Single-line mode + restrict to card-name characters for accuracy
    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,'-.",
    });

    const { data: { text } } = await worker.recognize(croppedCanvas);
    await worker.terminate();

    const cleaned = cleanOcrText(text);
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
    renderResults(matches);
  } catch (err) {
    setProgress(`Error: ${err.message}`, false);
    btnIdentify.disabled = false;
  }
});

// ---- Crop the name band from the image ----
// MTG card name sits in a thin strip very near the top (~2–13%).
// We use the left 70% to avoid the mana cost icon on the right.
// Upscale 3× and boost contrast to help Tesseract accuracy.
function cropNameArea(img) {
  const w = img.naturalWidth  || img.width  || previewCanvas.width;
  const h = img.naturalHeight || img.height || previewCanvas.height;

  const srcX = 0;
  const srcY = Math.floor(h * 0.02);   // start just below the card border
  const srcW = Math.floor(w * 0.70);   // left 70% — avoid mana cost
  const srcH = Math.floor(h * 0.11);   // name band height

  const SCALE = 3;
  const c   = document.createElement('canvas');
  c.width   = srcW * SCALE;
  c.height  = srcH * SCALE;

  const ctx = c.getContext('2d');
  // Correct crop: source region → upscaled destination
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, c.width, c.height);

  // Pre-process: grayscale + contrast boost for better OCR
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boosted = gray > 140 ? Math.min(255, gray * 1.35) : Math.max(0, gray * 0.65);
    d[i] = d[i + 1] = d[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);

  return c;
}

function canvasToImage(canvas) {
  const img = new Image();
  img.src   = canvas.toDataURL('image/png');
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
  // Prefer the longest line — it's most likely to be the full card name
  return lines.sort((a, b) => b.length - a.length)[0].trim();
}

// ---- Scryfall search ----
// Strategy: autocomplete handles partial/mangled OCR text far better than
// fuzzy or search endpoints — it's the same engine Scryfall's own search box uses.
async function searchScryfall(text) {
  const seen    = new Set();
  const results = [];

  // Returns up to 20 card name suggestions for partial/fuzzy input
  async function autocomplete(q) {
    if (!q || q.length < 2) return [];
    try {
      const res  = await fetch(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      return (res.ok && data.data) ? data.data : [];
    } catch { return []; }
  }

  // Fetch a full card object by exact name
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

  // Also try fuzzy — if OCR was close it may nail it outright
  async function tryFuzzy(q) {
    if (!q) return;
    try {
      const res  = await fetch(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (res.ok && data.object === 'card' && !seen.has(data.id)) {
        seen.add(data.id);
        results.unshift(data); // fuzzy hit is probably the best match — put it first
      }
    } catch { /* ok */ }
  }

  // 1. Fuzzy on full text (lucky path)
  await tryFuzzy(text);

  // 2. Autocomplete on full text
  for (const name of (await autocomplete(text)).slice(0, 4)) {
    await fetchNamed(name);
    if (results.length >= 6) return results;
  }

  // 3. Autocomplete + fuzzy on each significant word
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

  // 4. Progressive prefix truncation — handles OCR cutting off the end
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

// ---- Render match results ----
function renderResults(cards) {
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

// ---- Confirm a card ----
function confirmCard(card) {
  confirmedCard = card;
  selectedName.textContent = `${card.name} — ${card.set_name ?? card.set} (${card.rarity})`;
  scanQty.value       = 1;
  scanCondition.value = 'NM';
  scanFoil.checked    = false;
  addForm.classList.remove('hidden');
  addForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Add to vault ----
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
  previewCanvas.style.display = 'none';
  previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  guide.style.display = stream ? '' : 'none';
  if (stream) { video.style.display = ''; }
  btnIdentify.disabled = true;
  btnCapture.disabled  = !stream;
  addForm.classList.add('hidden');
  resultsSection.style.display = 'none';
  resultsGrid.innerHTML = '';
  setProgress('');
}

// ---- Helpers ----
function setProgress(msg, active = false) {
  progressEl.textContent = msg;
  progressEl.className   = `scan-progress${active ? ' active' : ''}`;
}
