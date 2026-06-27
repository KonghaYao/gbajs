/**
 * GBA.js browser entry point.
 * Creates the GameBoyAdvance instance and sets up UI bindings.
 */
import { GameBoyAdvance } from './gba.js';
import { loadRom } from './xhr.js';
import { FileSystemSaveBackend, GameLibrary, GameEntry } from './save-backend.js';

declare global {
  interface Window {
    gba: GameBoyAdvance | null;
  }
}

const gba = new GameBoyAdvance();
window.gba = gba;

let debug: Window | null = null;
let fsSaveDirName = '';
let fsBackend: FileSystemSaveBackend | null = null;
let gameLibrary: GameLibrary | null = null;

gba.keypad.eatInput = true;

// ── Save notification ──
gba.onSave = function () {
  const toast = document.getElementById('save-toast')!;
  toast.style.opacity = '1';
  setTimeout(function () { toast.style.opacity = '0'; }, 2000);
};

// ── Hash utility ──
async function hashBuffer(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Logger / crash handler ──
gba.setLogger(function (_level: number, error: string) {
  console.error('GBA crash:', error);
  gba.pause();
  const crash = document.getElementById('crash-overlay')!;
  crash.style.display = 'flex';
});

// ── Persistence: folder selection ──
function updateFolderIndicator(): void {
  const el = document.getElementById('save-dir-indicator');
  if (el) {
    el.textContent = fsSaveDirName ? fsSaveDirName : '';
    el.style.display = fsSaveDirName ? 'block' : 'none';
  }
}

async function setupGameLibrary(): Promise<void> {
  if (!fsBackend) return;
  gameLibrary = new GameLibrary(fsBackend);
  const idx = await gameLibrary.load();
  renderGameList(await gameLibrary.listGames());
}

async function tryRestoreSaveFolder(): Promise<void> {
  if (!FileSystemSaveBackend.isSupported()) return;
  const handle = await FileSystemSaveBackend.tryRestore();
  if (handle) {
    fsBackend = new FileSystemSaveBackend(handle);
    fsSaveDirName = handle.name;
    updateFolderIndicator();
    await setupGameLibrary();
  }
}

(window as any).selectSaveFolder = async function (): Promise<void> {
  if (!FileSystemSaveBackend.isSupported()) {
    alert('This browser does not support local folder access.\nPlease use Chrome or Edge.');
    return;
  }
  try {
    const handle = await FileSystemSaveBackend.requestDirectory();
    if (handle) {
      fsBackend = new FileSystemSaveBackend(handle);
      fsSaveDirName = handle.name;
      updateFolderIndicator();
      await setupGameLibrary();
    }
  } catch (err) {
    console.error('Folder selection failed:', err);
  }
};

// ── Game list rendering ──
function renderGameList(games: GameEntry[]): void {
  const listEl = document.getElementById('game-list')!;
  const emptyEl = document.getElementById('game-list-empty')!;
  const container = document.getElementById('game-list-container')!;

  if (games.length === 0) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    container.style.display = 'block';
    return;
  }

  container.style.display = 'block';
  emptyEl.style.display = 'none';
  listEl.innerHTML = games.map(function (g) {
    const date = new Date(g.lastPlayed).toLocaleDateString();
    return '<div class="game-item" data-hash="' + g.hash + '" onclick="launchGame(\'' + g.hash + '\')">' +
      '<span class="game-title">' + escapeHtml(g.title || g.code) + '</span>' +
      '<span class="game-code">' + escapeHtml(g.code) + '</span>' +
      '<span class="game-date">' + date + '</span>' +
      '</div>';
  }).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── ROM loading ──
(window as any).launchGame = async function (hash: string): Promise<void> {
  if (!fsBackend || !gameLibrary) {
    alert('No save folder selected.');
    return;
  }
  const entry = gameLibrary.getEntry(hash);
  if (!entry) return;

  const romPath = hash + '/' + 'game.gba';
  const romData = await fsBackend.readFile(romPath);
  if (!romData) {
    alert('ROM file not found in folder.');
    return;
  }

  gba.gameHash = hash;
  gba.saveBackend = fsBackend;
  const romBlob = new Blob([romData]);
  gba.loadRomFromFile(romBlob as any, async function (result: boolean) {
    if (result) {
      await gameLibrary!.markPlayed(hash);
      await gba.retrieveSavedata();
      startGame();
    } else {
      alert('Failed to load ROM.');
    }
  });
};

(window as any).run = async function (file: File): Promise<void> {
  const loader = document.getElementById('loader') as HTMLInputElement;
  loader.value = '';

  if (!fsBackend) {
    // No folder selected — load directly without persistence
    loadRomDirect(file);
    return;
  }

  const romBuffer = await file.arrayBuffer();
  const hash = await hashBuffer(romBuffer);

  if (!gameLibrary) await setupGameLibrary();

  // Check if this ROM is already imported
  const existing = gameLibrary!.getEntry(hash);
  if (existing) {
    gba.gameHash = hash;
    gba.saveBackend = fsBackend;
    gba.loadRomFromFile(file, async function (result: boolean) {
      if (result) {
        await gameLibrary!.markPlayed(hash);
        await gba.retrieveSavedata();
        startGame();
      } else {
        alert('Failed to load ROM.');
      }
    });
    return;
  }

  // First import: copy ROM to {hash}/game.gba
  try {
    await fsBackend.writeFile(hash + '/' + 'game.gba', romBuffer);
  } catch (e) {
    console.error('Failed to copy ROM to folder:', e);
    alert('Failed to write ROM to folder. Check permissions.');
    return;
  }

  gba.gameHash = hash;
  gba.saveBackend = fsBackend;

  gba.loadRomFromFile(file, async function (result: boolean) {
    if (result) {
      // Add to library
      const title = gba.mmu.cart?.title || file.name.replace(/\.\w+$/, '');
      const code = gba.mmu.cart?.code || 'UNKNOWN';
      await gameLibrary!.addGame(hash, title, code, romBuffer.byteLength);
      await gba.retrieveSavedata();
      startGame();
    } else {
      alert('Failed to load ROM.');
    }
  });
};

function loadRomDirect(file: File): void {
  gba.gameHash = null;
  gba.saveBackend = (window as any)._memBackend;
  gba.loadRomFromFile(file, function (result: boolean) {
    if (result) {
      startGame();
    } else {
      alert('Failed to load ROM. Is this a valid GBA file?');
    }
  });
}

function startGame(): void {
  document.getElementById('overlay')!.classList.add('hidden');
  document.getElementById('touch-controls')!.classList.add('active');
  window.addEventListener('beforeunload', blockUnload);
  if (gba.audio.context && gba.audio.context.state === 'suspended') {
    gba.audio.context.resume();
  }
  gba.runStable();
}

// ── In-game controls ──
(window as any).togglePause = function (): void {
  const btn = document.getElementById('btn-pause')!;
  if (gba.paused) {
    gba.runStable();
    btn.textContent = 'PAUSE';
  } else {
    gba.pause();
    btn.textContent = 'UNPAUSE';
  }
};

// ── Block refresh while game running ──
function blockUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = '';
}

(window as any).resetGame = function (): void {
  gba.pause();
  gba.reset();
  gba.gameHash = null;
  window.removeEventListener('beforeunload', blockUnload);
  const crash = document.getElementById('crash-overlay')!;
  crash.style.display = 'none';
  const toolbar = document.getElementById('toolbar')!;
  toolbar.classList.remove('visible');
  document.getElementById('touch-controls')!.classList.remove('active');
  document.getElementById('overlay')!.classList.remove('hidden');
};

(window as any).screenshot = function (): void {
  const canvas = gba.indirectCanvas!;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'gba-screenshot.png';
  a.click();
};

// ── Manual save ──
(window as any).forceSave = async function (): Promise<void> {
  if (!gba.mmu.save) {
    alert('No save data. Save in-game first.');
    return;
  }
  gba.mmu.flushSave();
  await gba.storeSavedata();
};

// ── Key guide ──
(window as any).toggleKeyGuide = function (): void {
  document.getElementById('key-guide')!.classList.toggle('show');
};

// ── Touch controls ──
const TOUCH_MASKS: Record<string, number> = {
  up:     0x0040,
  down:   0x0080,
  left:   0x0020,
  right:  0x0010,
  a:      0x0001,
  b:      0x0002,
  select: 0x0004,
  start:  0x0008,
  l:      0x0200,
  r:      0x0100,
};

function pressBtn(btn: string): void {
  const mask = TOUCH_MASKS[btn];
  if (mask) gba.keypad.currentDown &= ~mask;
}
function releaseBtn(btn: string): void {
  const mask = TOUCH_MASKS[btn];
  if (mask) gba.keypad.currentDown |= mask;
}

document.querySelectorAll('.touch-btn').forEach(function (btn) {
  const el = btn as HTMLElement;
  const name = el.dataset.btn!;

  el.addEventListener('pointerdown', function (e: PointerEvent) {
    e.preventDefault();
    el.classList.add('pressed');
    pressBtn(name);
  });
  el.addEventListener('pointerup', function () {
    el.classList.remove('pressed');
    releaseBtn(name);
  });
  el.addEventListener('pointerleave', function () {
    el.classList.remove('pressed');
    releaseBtn(name);
  });
  el.addEventListener('pointercancel', function () {
    el.classList.remove('pressed');
    releaseBtn(name);
  });
  // Prevent double-tap zoom etc.
  el.addEventListener('touchstart', function (e) { e.preventDefault(); });
});

// ── Settings panel ──
let muted = false;
let savedVolume = 0x400;

(window as any).toggleSettings = function (): void {
  document.getElementById('settings-panel')!.classList.toggle('show');
};

(window as any).closeSettings = function (): void {
  document.getElementById('settings-panel')!.classList.remove('show');
};

(window as any).updateVolume = function (value: string): void {
  const vol = Math.pow(2, parseFloat(value));
  gba.audio.masterVolume = Math.round(vol * 0x400);
  muted = false;
  const muteBtn = document.getElementById('mute-btn')!;
  muteBtn.textContent = 'MUTE ALL';
  muteBtn.classList.remove('muted');
  const label = document.getElementById('vol-label')!;
  label.textContent = Math.round(vol * 100) + '%';
};

(window as any).toggleMute = function (): void {
  const muteBtn = document.getElementById('mute-btn')!;
  if (muted) {
    gba.audio.masterVolume = savedVolume || 0x200;
    muted = false;
    muteBtn.textContent = 'MUTE ALL';
    muteBtn.classList.remove('muted');
  } else {
    savedVolume = gba.audio.masterVolume;
    gba.audio.masterVolume = 0;
    muted = true;
    muteBtn.textContent = 'UNMUTE';
    muteBtn.classList.add('muted');
  }
};

// PSG: square 1/2 + wave + noise (melody, bass, percussion)
(window as any).togglePsg = function (): void {
  gba.audio.mutePsg = !gba.audio.mutePsg;
  const btn = document.getElementById('psg-btn')!;
  btn.textContent = gba.audio.mutePsg ? 'PSG OFF' : 'PSG ON';
};

// DMA: PCM sample channels (voice, sfx)
(window as any).toggleDma = function (): void {
  gba.audio.muteDma = !gba.audio.muteDma;
  const btn = document.getElementById('dma-btn')!;
  btn.textContent = gba.audio.muteDma ? 'DMA OFF' : 'DMA ON';
};

// Speed control
const SPEED_PRESETS: Record<string, number> = { '0.5': 32, '1': 16, '2': 8, '4': 4, '0': 0 };
const SPEED_KEY = 'gba-speed';

(window as any).setSpeed = function (multiplier: string | number): void {
  const key = String(multiplier);
  const delay = SPEED_PRESETS[key] ?? 16;
  gba.throttle = delay;
  localStorage.setItem(SPEED_KEY, key);
  // Highlight active speed
  document.querySelectorAll('#settings-panel [id^="spd-"]').forEach(function (b) {
    (b as HTMLElement).style.color = '';
  });
  const active = document.getElementById('spd-' + key);
  if (active) (active as HTMLElement).style.color = '#7c3aed';
};

// ── Volume (legacy, for debugger.html) ──
(window as any).setVolume = function (value: string): void {
  gba.audio.masterVolume = Math.round(Math.pow(2, parseFloat(value)) * 0x400);
};

// ── Debugger ──
(window as any).enableDebug = function (): void {
  window.onmessage = function (message: MessageEvent) {
    if (message.origin !== document.domain && (message.origin !== 'file://' || document.domain)) return;
    switch (message.data) {
      case 'connect':
        if (message.source === debug) debug!.postMessage('connect', document.domain || '*');
        break;
      case 'disconnect':
        if (message.source === debug) debug = null;
        break;
    }
  };
  window.onunload = function () {
    if (debug && debug.postMessage) debug.postMessage('disconnect', document.domain || '*');
  };
  if (!debug || !debug.postMessage) {
    debug = window.open('debugger.html', 'debug');
  } else {
    debug.postMessage('connect', document.domain || '*');
  }
};

// ── Init ──
window.onload = function () {
  if (!gba || typeof FileReader === 'undefined') {
    document.body.textContent = 'This browser is not supported.';
    return;
  }

  tryRestoreSaveFolder();

  // Keep a reference to the memory backend for non-folder usage
  (window as any)._memBackend = gba.saveBackend;
  const savedSpeed = localStorage.getItem(SPEED_KEY);
  if (savedSpeed) {
    gba.throttle = SPEED_PRESETS[savedSpeed] ?? 16;
    // Update button highlight once DOM is ready
    const active = document.getElementById('spd-' + savedSpeed);
    if (active) (active as HTMLElement).style.color = '#7c3aed';
  }

  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  gba.setCanvas(canvas);
  gba.logLevel = gba.LOG_ERROR;

  loadRom('resources/bios.bin', function (bios: ArrayBuffer) {
    gba.setBios(bios);
  });
};

// ── Keyboard shortcuts ──
document.addEventListener('keydown', function (e: KeyboardEvent) {
  if (e.key === 'Escape') {
    const toolbar = document.getElementById('toolbar')!;
    toolbar.classList.toggle('visible');
  }
  if (e.key === 'm' || e.key === 'M') {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      (window as any).toggleSettings();
    }
  }
});

// ── Fullscreen ──
function onFullscreenChange(): void {
  const container = document.getElementById('game-container')!;
  const isFull = !!(document as any).fullscreenElement || !!(document as any).webkitFullscreenElement;
  if (isFull) {
    container.style.width = '100vw';
    container.style.height = '100vh';
  } else {
    container.style.width = '';
    container.style.height = '';
  }
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// ── Close panels on backdrop click ──
document.getElementById('key-guide')!.addEventListener('click', function (e) {
  if ((e.target as HTMLElement).id === 'key-guide') {
    (window as any).toggleKeyGuide();
  }
});
document.getElementById('settings-panel')!.addEventListener('click', function (e) {
  if ((e.target as HTMLElement).id === 'settings-panel') {
    (window as any).closeSettings();
  }
});
