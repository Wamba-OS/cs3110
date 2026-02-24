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
  const w = video.videoWidth  || 640;
  const h = video.videoHeight || 480;
  previewCanvas.width  = w;
  previewCanvas.height = h;
  previewCanvas.style.display = '';
  video.style.display = 'none';
  guide.style.display = 'none';

  const ctx = previewCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);

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
      previewCanvas.style.display = '';
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
    // Crop to top ~20% of image (where the card name lives in MTG layout)
    const croppedCanvas = cropNameArea(capturedImage);

    setProgress('Loading OCR engine (first run may take a moment)...', true);

    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setProgress(`Deciphering runes: ${Math.round((m.progress ?? 0) * 100)}%`, true);
        }
      },
    });

    const { data: { text } } = await worker.recognize(croppedCanvas);
    await worker.terminate();

    const cleaned = cleanOcrText(text);
    setProgress(`OCR read: "${cleaned}" — searching Scryfall...`, true);

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

// ---- Crop top 20% of image as a canvas ----
function cropNameArea(img) {
  const w = img.naturalWidth  || img.width  || previewCanvas.width;
  const h = img.naturalHeight || img.height || previewCanvas.height;
  const cropH = Math.floor(h * 0.20);

  const c   = document.createElement('canvas');
  c.width   = w;
  c.height  = cropH;
  c.getContext('2d').drawImage(img, 0, 0, w, h, 0, 0, w, cropH);
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
  // Take first non-empty line, strip non-alpha-space characters
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  // The card name is usually the first recognizable line
  // Remove special characters but keep letters, numbers, spaces, hyphens, apostrophes
  return lines[0].replace(/[^a-zA-Z0-9 '\-,]/g, '').trim();
}

// ---- Scryfall search ----
async function searchScryfall(text) {
  const results = [];

  // 1. Fuzzy match — best single result
  try {
    const res  = await fetch(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(text)}`);
    const data = await res.json();
    if (res.ok && data.object === 'card') results.push(data);
  } catch { /* ok */ }

  // 2. Full-text search — up to 5 alternatives
  try {
    const res  = await fetch(`${SCRYFALL}/cards/search?q=name%3A${encodeURIComponent(text)}&order=name`);
    const data = await res.json();
    if (res.ok && data.data) {
      for (const c of data.data.slice(0, 5)) {
        if (!results.find(r => r.id === c.id)) results.push(c);
      }
    }
  } catch { /* ok */ }

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
