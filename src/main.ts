/**
 * GBA.js browser entry point.
 * This module creates the GameBoyAdvance instance and sets up all UI bindings.
 */
import { GameBoyAdvance } from './gba.js';
import { loadRom } from './xhr.js';
import { FileSystemSaveBackend, IDBSaveBackend } from './save-backend.js';

// Make gba available globally for console/debugger access
declare global {
  interface Window {
    gba: GameBoyAdvance | null;
  }
}

const gba = new GameBoyAdvance();
window.gba = gba;

const runCommands: (() => void)[] = [];
let debug: Window | null = null;

gba.keypad.eatInput = true;
gba.setLogger(function (level: number, error: string) {
  console.log(error);
  gba.pause();
  const screen = document.getElementById('screen');
  if (screen?.getAttribute('class') === 'dead') {
    console.log('We appear to have crashed multiple times without reseting.');
    return;
  }
  const crash = document.createElement('img');
  crash.setAttribute('id', 'crash');
  crash.setAttribute('src', 'resources/crash.png');
  screen?.parentElement?.insertBefore(crash, screen!);
  screen?.setAttribute('class', 'dead');
});

// ── 持久化文件夹选择 ──
let fsSaveDirName = '';

/** 自动尝试恢复上次选择的本地文件夹 */
async function tryRestoreSaveFolder(): Promise<void> {
  if (!FileSystemSaveBackend.isSupported()) return;
  const handle = await FileSystemSaveBackend.tryRestore();
  if (handle) {
    gba.saveBackend = new FileSystemSaveBackend(handle);
    fsSaveDirName = handle.name;
    updateFolderIndicator();
  }
}

/** 用户主动选择本地文件夹 */
(window as any).selectSaveFolder = async function (): Promise<void> {
  if (!FileSystemSaveBackend.isSupported()) {
    alert('Your browser does not support local folder access.\nPlease use Chrome or Edge.');
    return;
  }
  try {
    const handle = await FileSystemSaveBackend.requestDirectory();
    if (handle) {
      gba.saveBackend = new FileSystemSaveBackend(handle);
      fsSaveDirName = handle.name;
      updateFolderIndicator();
      // 如果已经加载了 ROM，重新加载存档
      if (gba.hasRom()) {
        await gba.retrieveSavedata();
      }
    }
  } catch (err) {
    console.error('Failed to select folder:', err);
  }
};

/** 更新 UI 中的文件夹指示器 */
function updateFolderIndicator(): void {
  const indicator = document.getElementById('save-dir-indicator');
  if (indicator) {
    indicator.textContent = fsSaveDirName ? `📁 ${fsSaveDirName}` : '';
    indicator.style.display = fsSaveDirName ? 'inline' : 'none';
  }
}

/** 获取当前持久化后端的信息 */
(window as any).getSaveBackendInfo = function (): string {
  const backend = gba.saveBackend;
  if (backend instanceof FileSystemSaveBackend) {
    return '本地文件夹: ' + fsSaveDirName;
  }
  if (backend instanceof IDBSaveBackend) {
    return '浏览器 IndexedDB';
  }
  return '内存 (无持久化)';
};

window.onload = function () {
  if (gba && typeof FileReader !== 'undefined') {
    // 尝试恢复本地文件夹持久化
    tryRestoreSaveFolder();

    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    gba.setCanvas(canvas);

    gba.logLevel = gba.LOG_ERROR;

    loadRom('resources/bios.bin', function (bios: ArrayBuffer) {
      gba.setBios(bios);
    });

    if (!gba.audio.context) {
      const soundbox = document.getElementById('sound');
      soundbox?.parentElement?.removeChild(soundbox);
    }

    if (window.navigator.appName === 'Microsoft Internet Explorer') {
      const pixelatedBox = document.getElementById('pixelated');
      pixelatedBox?.parentElement?.removeChild(pixelatedBox);
    }
  } else {
    const dead = document.getElementById('controls');
    dead?.parentElement?.removeChild(dead);
  }
};

// Expose global functions used by HTML onclick handlers
(window as any).run = function (file: File): void {
  const dead = document.getElementById('loader') as HTMLInputElement;
  dead.value = '';
  const load = document.getElementById('select')!;
  load.textContent = 'Loading...';
  load.removeAttribute('onclick');
  const pause = document.getElementById('pause')!;
  pause.textContent = 'PAUSE';
  gba.loadRomFromFile(file, function (result: boolean) {
    if (result) {
      for (let i = 0; i < runCommands.length; ++i) {
        runCommands[i]();
      }
      runCommands.length = 0;
      fadeOut('preload', 'ingame');
      fadeOut('instructions', null, true);
      gba.runStable();
    } else {
      load.textContent = 'FAILED';
      setTimeout(function () {
        load.textContent = 'SELECT';
        (load as HTMLElement).onclick = function () {
          (document.getElementById('loader') as HTMLInputElement).click();
        };
      }, 3000);
    }
  });
};

(window as any).reset = function (): void {
  gba.pause();
  gba.reset();
  const load = document.getElementById('select')!;
  load.textContent = 'SELECT';
  const crash = document.getElementById('crash');
  if (crash) {
    const context = (gba.targetCanvas as HTMLCanvasElement).getContext('2d')!;
    context.clearRect(0, 0, 480, 320);
    gba.video.drawCallback();
    crash.parentElement!.removeChild(crash);
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    canvas.removeAttribute('class');
  } else {
    lcdFade(gba.context, (gba.targetCanvas as HTMLCanvasElement).getContext('2d')!, gba.video.drawCallback);
  }
  (load as HTMLElement).onclick = function () {
    (document.getElementById('loader') as HTMLInputElement).click();
  };
  fadeOut('ingame', 'preload');
};

(window as any).uploadSavedataPending = function (file: File): void {
  runCommands.push(function () {
    gba.loadSavedataFromFile(file);
  });
};

(window as any).togglePause = function (): void {
  const e = document.getElementById('pause')!;
  if (gba.paused) {
    if (debug && (debug as any).gbaCon) {
      (debug as any).gbaCon.run();
    } else {
      gba.runStable();
    }
    e.textContent = 'PAUSE';
  } else {
    if (debug && (debug as any).gbaCon) {
      (debug as any).gbaCon.pause();
    } else {
      gba.pause();
    }
    e.textContent = 'UNPAUSE';
  }
};

(window as any).screenshot = function (): void {
  const canvas = gba.indirectCanvas!;
  window.open(canvas.toDataURL('image/png'), 'screenshot');
};

(window as any).setVolume = function (value: string): void {
  gba.audio.masterVolume = Math.pow(2, parseFloat(value)) - 1;
};

(window as any).setPixelated = function (pixelated: boolean): void {
  const screen = document.getElementById('screen') as HTMLCanvasElement;
  const context = screen.getContext('2d')!;
  if ((context as any).webkitImageSmoothingEnabled !== undefined) {
    (context as any).webkitImageSmoothingEnabled = !pixelated;
  } else if ((context as any).mozImageSmoothingEnabled !== undefined) {
    (context as any).mozImageSmoothingEnabled = !pixelated;
  } else if (window.navigator.appName !== 'Microsoft Internet Explorer') {
    if (pixelated) {
      screen.setAttribute('width', '240');
      screen.setAttribute('height', '160');
    } else {
      screen.setAttribute('width', '480');
      screen.setAttribute('height', '320');
    }
    if (window.navigator.appName === 'Opera') {
      if (pixelated) {
        screen.style.marginTop = '0';
        screen.style.marginBottom = '-325px';
      } else {
        screen.style.marginTop = '';
        screen.style.marginBottom = '';
      }
    }
  }
};

(window as any).enableDebug = function (): void {
  window.onmessage = function (message: MessageEvent) {
    if (
      message.origin !== document.domain &&
      (message.origin !== 'file://' || document.domain)
    ) {
      console.log('Failed XSS');
      return;
    }
    switch (message.data) {
      case 'connect':
        if (message.source === debug) {
          debug?.postMessage('connect', document.domain || '*');
        }
        break;
      case 'connected':
        break;
      case 'disconnect':
        if (message.source === debug) {
          debug = null;
        }
    }
  };
  window.onunload = function () {
    if (debug && debug.postMessage) {
      debug.postMessage('disconnect', document.domain || '*');
    }
  };
  if (!debug || !debug.postMessage) {
    debug = window.open('debugger.html', 'debug');
  } else {
    debug.postMessage('connect', document.domain || '*');
  }
};

// Helper functions
function fadeOut(
  id: string,
  nextId: string | null,
  kill?: boolean
): void {
  const e = document.getElementById(id);
  const e2 = nextId ? document.getElementById(nextId) : null;
  if (!e) {
    return;
  }
  const removeSelf = function () {
    if (kill) {
      e.parentElement!.removeChild(e);
    } else {
      e.setAttribute('class', 'dead');
      e.removeEventListener('webkitTransitionEnd', removeSelf);
      e.removeEventListener('oTransitionEnd', removeSelf);
      e.removeEventListener('transitionend', removeSelf);
    }
    if (e2) {
      e2.setAttribute('class', 'hidden');
      setTimeout(function () {
        e2.removeAttribute('class');
      }, 0);
    }
  };

  e.addEventListener('webkitTransitionEnd', removeSelf, false);
  e.addEventListener('oTransitionEnd', removeSelf, false);
  e.addEventListener('transitionend', removeSelf, false);
  e.setAttribute('class', 'hidden');
}

function lcdFade(
  context: CanvasRenderingContext2D,
  target: CanvasRenderingContext2D,
  callback: () => void
): void {
  let i = 0;
  const drawInterval = setInterval(function () {
    i++;
    const pixelData = context.getImageData(0, 0, 240, 160);
    for (let y = 0; y < 160; ++y) {
      for (let x = 0; x < 240; ++x) {
        const xDiff = Math.abs(x - 120);
        const yDiff = Math.abs(y - 80) * 0.8;
        const xFactor = (120 - i - xDiff) / 120;
        const yFactor =
          (80 - i - ((y & 1) * 10) - yDiff + Math.pow(xDiff, 1 / 2)) / 80;
        pixelData.data[(x + y * 240) * 4 + 3] *=
          Math.pow(xFactor, 1 / 3) * Math.pow(yFactor, 1 / 2);
      }
    }
    context.putImageData(pixelData, 0, 0);
    target.clearRect(0, 0, 480, 320);
    if (i > 40) {
      clearInterval(drawInterval);
    } else {
      callback();
    }
  }, 50);
}

// Fullscreen handler
document.addEventListener(
  'webkitfullscreenchange',
  function () {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    if ((document as any).webkitIsFullScreen) {
      canvas.setAttribute('height', String(document.body.offsetHeight));
      canvas.setAttribute(
        'width',
        String((document.body.offsetHeight / 2) * 3)
      );
      canvas.setAttribute('style', 'margin: 0');
    } else {
      canvas.setAttribute('height', '320');
      canvas.setAttribute('width', '480');
      canvas.removeAttribute('style');
    }
  },
  false
);
