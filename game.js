/**
 * 筋肉間違い探し / Muscle Spot the Difference
 * MuscleLove - Pure HTML/CSS/JS Canvas Game
 */
(function () {
  'use strict';

  // ===== CONFIG =====
  const TOTAL_ROUNDS = 5;
  const ROUND_TIME = 60; // seconds
  const PENALTY_SEC = 5;
  const DIFF_COUNT_MIN = 3;
  const DIFF_COUNT_MAX = 5;
  const HIT_RADIUS = 35; // px tolerance for click detection (in canvas coords)

  // Images: pick 5 pairs from 10 images (each round uses a different image)
  const IMAGE_PATHS = [];
  for (let i = 1; i <= 10; i++) IMAGE_PATHS.push(`images/img${i}.png`);

  // ===== DOM =====
  const $ = (s) => document.querySelector(s);
  const screens = {
    title: $('#screen-title'),
    game: $('#screen-game'),
    roundClear: $('#screen-round-clear'),
    result: $('#screen-result'),
  };
  const canvasOrig = $('#canvas-original');
  const canvasMod = $('#canvas-modified');
  const ctxOrig = canvasOrig.getContext('2d');
  const ctxMod = canvasMod.getContext('2d');

  // ===== STATE =====
  let currentRound = 0;
  let roundOrder = []; // indices into IMAGE_PATHS
  let timer = 0;
  let timerInterval = null;
  let differences = []; // {x, y, radius, type, found}
  let foundCount = 0;
  let totalFound = 0;
  let totalDiffs = 0;
  let totalClicks = 0;
  let correctClicks = 0;
  let totalTimeLeft = 0;
  let gameActive = false;
  let currentImage = null;

  // ===== AUDIO (Web Audio API) =====
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, duration, type = 'sine', vol = 0.15) {
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  function sfxFound() {
    playTone(880, 0.15, 'sine', 0.2);
    setTimeout(() => playTone(1100, 0.2, 'sine', 0.2), 100);
  }

  function sfxWrong() {
    playTone(200, 0.25, 'sawtooth', 0.1);
  }

  function sfxComplete() {
    [0, 100, 200, 300, 400].forEach((d, i) => {
      setTimeout(() => playTone(523 + i * 100, 0.3, 'sine', 0.15), d);
    });
  }

  function sfxTimeUp() {
    playTone(300, 0.4, 'square', 0.1);
    setTimeout(() => playTone(200, 0.5, 'square', 0.1), 200);
  }

  // ===== SCREEN MANAGEMENT =====
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== DIFFERENCE GENERATION =====
  // Types of canvas modifications to create visible differences
  const diffTypes = [
    'hue_shift',
    'brightness',
    'color_circle',
    'emoji_overlay',
    'mirror_patch',
    'blur_region',
  ];

  function generateDifferences(imgWidth, imgHeight) {
    const count = DIFF_COUNT_MIN + Math.floor(Math.random() * (DIFF_COUNT_MAX - DIFF_COUNT_MIN + 1));
    const diffs = [];
    const margin = 40;
    const minDist = 60;

    for (let i = 0; i < count; i++) {
      let x, y, attempts = 0;
      do {
        x = margin + Math.random() * (imgWidth - margin * 2);
        y = margin + Math.random() * (imgHeight - margin * 2);
        attempts++;
      } while (
        attempts < 50 &&
        diffs.some((d) => Math.hypot(d.x - x, d.y - y) < minDist)
      );

      const type = diffTypes[Math.floor(Math.random() * diffTypes.length)];
      const radius = 20 + Math.random() * 15;
      diffs.push({ x, y, radius, type, found: false });
    }
    return diffs;
  }

  function applyDifference(ctx, diff, imgWidth, imgHeight) {
    const { x, y, radius, type } = diff;

    switch (type) {
      case 'hue_shift': {
        // Get pixel data in region and shift hue
        const r = Math.ceil(radius);
        const sx = Math.max(0, Math.floor(x - r));
        const sy = Math.max(0, Math.floor(y - r));
        const sw = Math.min(imgWidth - sx, r * 2);
        const sh = Math.min(imgHeight - sy, r * 2);
        if (sw <= 0 || sh <= 0) break;
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          // Shift red and blue channels
          const tmp = data[i];
          data[i] = data[i + 2]; // R <- B
          data[i + 2] = tmp;     // B <- R
        }
        ctx.putImageData(imageData, sx, sy);
        break;
      }

      case 'brightness': {
        const r = Math.ceil(radius);
        const sx = Math.max(0, Math.floor(x - r));
        const sy = Math.max(0, Math.floor(y - r));
        const sw = Math.min(imgWidth - sx, r * 2);
        const sh = Math.min(imgHeight - sy, r * 2);
        if (sw <= 0 || sh <= 0) break;
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, data[i] + 80);
          data[i + 1] = Math.min(255, data[i + 1] + 80);
          data[i + 2] = Math.min(255, data[i + 2] + 80);
        }
        ctx.putImageData(imageData, sx, sy);
        break;
      }

      case 'color_circle': {
        const colors = ['#ff2d78', '#00e5ff', '#ffd700', '#00ff88', '#ff6b00'];
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.globalAlpha = 0.6;
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }

      case 'emoji_overlay': {
        const emojis = ['💪', '🔥', '⭐', '❤️', '🏋️', '✨', '👊', '🌟'];
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        ctx.font = `${Math.floor(radius * 1.2)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, x, y);
        break;
      }

      case 'mirror_patch': {
        // Flip a small patch horizontally
        const r = Math.ceil(radius);
        const sx = Math.max(0, Math.floor(x - r));
        const sy = Math.max(0, Math.floor(y - r));
        const sw = Math.min(imgWidth - sx, r * 2);
        const sh = Math.min(imgHeight - sy, r * 2);
        if (sw <= 0 || sh <= 0) break;
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        const data = imageData.data;
        // Flip horizontally row by row
        for (let row = 0; row < sh; row++) {
          for (let col = 0; col < Math.floor(sw / 2); col++) {
            const left = (row * sw + col) * 4;
            const right = (row * sw + (sw - 1 - col)) * 4;
            for (let c = 0; c < 4; c++) {
              const tmp = data[left + c];
              data[left + c] = data[right + c];
              data[right + c] = tmp;
            }
          }
        }
        ctx.putImageData(imageData, sx, sy);
        break;
      }

      case 'blur_region': {
        // Simple box blur approximation
        const r = Math.ceil(radius);
        const sx = Math.max(0, Math.floor(x - r));
        const sy = Math.max(0, Math.floor(y - r));
        const sw = Math.min(imgWidth - sx, r * 2);
        const sh = Math.min(imgHeight - sy, r * 2);
        if (sw <= 0 || sh <= 0) break;
        // Draw semi-transparent overlay to simulate blur
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        const data = imageData.data;
        // Average nearby pixels (simple 3x3 blur, 2 passes)
        for (let pass = 0; pass < 3; pass++) {
          const copy = new Uint8ClampedArray(data);
          for (let py = 1; py < sh - 1; py++) {
            for (let px = 1; px < sw - 1; px++) {
              const idx = (py * sw + px) * 4;
              for (let c = 0; c < 3; c++) {
                data[idx + c] = (
                  copy[idx + c] +
                  copy[idx - 4 + c] + copy[idx + 4 + c] +
                  copy[idx - sw * 4 + c] + copy[idx + sw * 4 + c]
                ) / 5;
              }
            }
          }
        }
        ctx.putImageData(imageData, sx, sy);
        break;
      }
    }
  }

  // ===== GAME LOGIC =====
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame() {
    currentRound = 0;
    totalFound = 0;
    totalDiffs = 0;
    totalClicks = 0;
    correctClicks = 0;
    totalTimeLeft = 0;
    roundOrder = shuffleArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, TOTAL_ROUNDS);
    startRound();
  }

  function startRound() {
    showScreen('game');
    gameActive = false;
    foundCount = 0;
    timer = ROUND_TIME;

    // Clear any old markers
    const modWrapper = canvasMod.parentElement;
    modWrapper.querySelectorAll('.found-marker, .wrong-marker').forEach((m) => m.remove());

    updateHUD();
    loadRoundImage();
  }

  function loadRoundImage() {
    const imgIndex = roundOrder[currentRound];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      currentImage = img;

      // Set canvas sizes to match image
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      canvasOrig.width = w;
      canvasOrig.height = h;
      canvasMod.width = w;
      canvasMod.height = h;

      // Draw original
      ctxOrig.drawImage(img, 0, 0, w, h);

      // Draw modified with differences
      ctxMod.drawImage(img, 0, 0, w, h);
      differences = generateDifferences(w, h);
      differences.forEach((d) => applyDifference(ctxMod, d, w, h));

      totalDiffs += differences.length;
      updateHUD();

      // Start timer
      gameActive = true;
      startTimer();
    };
    img.onerror = function () {
      console.error('Failed to load image:', IMAGE_PATHS[imgIndex]);
      // Try next image or skip
      if (currentRound < TOTAL_ROUNDS - 1) {
        currentRound++;
        startRound();
      } else {
        showResults();
      }
    };
    img.src = IMAGE_PATHS[imgIndex];
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timer--;
      updateHUD();
      if (timer <= 0) {
        clearInterval(timerInterval);
        gameActive = false;
        sfxTimeUp();
        setTimeout(() => endRound(), 500);
      }
    }, 1000);
  }

  function updateHUD() {
    $('#hud-round').textContent = `${currentRound + 1}/${TOTAL_ROUNDS}`;
    $('#hud-timer').textContent = timer;
    $('#hud-found').textContent = `${foundCount}/${differences.length}`;

    const timerBox = $('.timer-box');
    timerBox.classList.remove('warning', 'danger');
    if (timer <= 10) timerBox.classList.add('danger');
    else if (timer <= 20) timerBox.classList.add('warning');
  }

  function handleCanvasClick(e) {
    if (!gameActive) return;

    const canvas = canvasMod;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get click position in canvas coordinates
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    totalClicks++;

    // Check if click is near any unfound difference
    let hit = null;
    for (const diff of differences) {
      if (diff.found) continue;
      const dist = Math.hypot(diff.x - clickX, diff.y - clickY);
      if (dist <= HIT_RADIUS) {
        hit = diff;
        break;
      }
    }

    if (hit) {
      hit.found = true;
      foundCount++;
      correctClicks++;
      totalFound++;
      sfxFound();
      showFoundMarker(hit, rect, scaleX, scaleY);
      showFeedback('found');
      updateHUD();

      // Check if all found
      if (foundCount === differences.length) {
        gameActive = false;
        clearInterval(timerInterval);
        sfxComplete();
        setTimeout(() => endRound(), 800);
      }
    } else {
      // Wrong click - penalty
      timer = Math.max(0, timer - PENALTY_SEC);
      updateHUD();
      sfxWrong();
      showWrongMarker(e.clientX - rect.left, e.clientY - rect.top, rect);
      showFeedback('wrong');
    }
  }

  function showFoundMarker(diff, rect, scaleX, scaleY) {
    const wrapper = canvasMod.parentElement;
    const marker = document.createElement('div');
    marker.className = 'found-marker';
    // Position in CSS pixels relative to canvas wrapper
    const px = diff.x / scaleX;
    const py = diff.y / scaleY;
    marker.style.left = px + 'px';
    marker.style.top = py + 'px';
    wrapper.appendChild(marker);
  }

  function showWrongMarker(cssX, cssY, rect) {
    const wrapper = canvasMod.parentElement;
    const marker = document.createElement('div');
    marker.className = 'wrong-marker';
    marker.textContent = '✕';
    marker.style.left = cssX + 'px';
    marker.style.top = cssY + 'px';
    wrapper.appendChild(marker);
    setTimeout(() => marker.remove(), 600);
  }

  function showFeedback(type) {
    const overlay = $('#feedback-overlay');
    overlay.className = 'feedback-overlay ' + type;
    overlay.textContent = type === 'found' ? 'Found! 発見！' : `Miss! -${PENALTY_SEC}s`;
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
    }, type === 'found' ? 800 : 600);
  }

  function endRound() {
    totalTimeLeft += timer;
    clearInterval(timerInterval);

    if (currentRound < TOTAL_ROUNDS - 1) {
      // Show round clear
      $('#rc-found').textContent = foundCount;
      $('#rc-total').textContent = differences.length;
      $('#rc-time').textContent = timer;
      showScreen('roundClear');
    } else {
      showResults();
    }
  }

  function nextRound() {
    currentRound++;
    startRound();
  }

  function showResults() {
    const accuracy = totalClicks > 0 ? Math.round((correctClicks / totalClicks) * 100) : 0;
    $('#result-found').textContent = `${totalFound}/${totalDiffs}`;
    $('#result-accuracy').textContent = `${accuracy}%`;
    $('#result-time').textContent = `${totalTimeLeft}s`;

    // Rank
    const ratio = totalDiffs > 0 ? totalFound / totalDiffs : 0;
    let rank = '';
    if (ratio >= 0.95 && accuracy >= 80) rank = '🏆 S 筋肉マスター / Muscle Master';
    else if (ratio >= 0.8) rank = '💪 A 筋肉の目 / Muscle Eye';
    else if (ratio >= 0.6) rank = '👀 B まあまあ / Not Bad';
    else if (ratio >= 0.4) rank = '😅 C もっと鍛えよう / Train More';
    else rank = '💤 D 筋トレ不足 / Need More Training';
    $('#result-rank').textContent = rank;

    showScreen('result');
  }

  // ===== SHARE =====
  function shareOnX() {
    const text = `【筋肉間違い探し】${TOTAL_ROUNDS}問中${totalFound}個発見！💪\n正確率: ${$('#result-accuracy').textContent}\n\n#MuscleLove #間違い探し`;
    const url = 'https://www.patreon.com/cw/MuscleLove';
    const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(shareUrl, '_blank', 'noopener');
  }

  // ===== EVENT LISTENERS =====
  $('#btn-start').addEventListener('click', () => {
    try { getAudio(); } catch (e) { /* init audio context on user gesture */ }
    startGame();
  });

  $('#btn-next-round').addEventListener('click', nextRound);
  $('#btn-retry').addEventListener('click', startGame);
  $('#btn-share').addEventListener('click', shareOnX);

  // Canvas click handler for modified image
  canvasMod.addEventListener('click', handleCanvasClick);

  // Touch support
  canvasMod.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      handleCanvasClick({
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    }
  }, { passive: false });

})();
