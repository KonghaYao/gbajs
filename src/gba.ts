import { ARMCore } from './core.js';
import { GameBoyAdvanceMMU } from './mmu.js';
import { GameBoyAdvanceIO } from './io.js';
import { GameBoyAdvanceInterruptHandler } from './irq.js';
import { GameBoyAdvanceAudio } from './audio.js';
import { GameBoyAdvanceVideo } from './video.js';
import { GameBoyAdvanceKeypad } from './keypad.js';
import { GameBoyAdvanceSIO } from './sio.js';
import { SaveBackend, MemorySaveBackend, IDBSaveBackend } from './save-backend.js';

declare global {
  interface Window {
    queueFrame: (f: () => void) => void;
    webkitURL?: typeof URL;
  }
}

export interface GBAConfig {
  /** Persistence backend for savedata and savestates. Defaults to MemorySaveBackend in non-browser, LocalStorageSaveBackend in browser. */
  saveBackend?: SaveBackend;
  /** Custom frame scheduler. Defaults to window.queueFrame (rAF-based) in browser, or setImmediate fallback. */
  scheduler?: (fn: () => void) => void;
  /** Throttle delay in ms between frames. Default 16 (~60fps). */
  throttle?: number;
}

export interface CartInfo {
  title: string | null;
  code: string | null;
  maker: string | null;
  memory: ArrayBuffer;
  saveType: string | null;
}

export interface FrostState {
  cpu: ReturnType<ARMCore['freeze']>;
  mmu: ReturnType<GameBoyAdvanceMMU['freeze']>;
  irq: ReturnType<GameBoyAdvanceInterruptHandler['freeze']>;
  io: ReturnType<GameBoyAdvanceIO['freeze']>;
  audio: ReturnType<GameBoyAdvanceAudio['freeze']>;
  video: ReturnType<GameBoyAdvanceVideo['freeze']>;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export class GameBoyAdvance {
  LOG_ERROR = 1;
  LOG_WARN = 2;
  LOG_STUB = 4;
  LOG_INFO = 8;
  LOG_DEBUG = 16;

  SYS_ID = 'com.endrift.gbajs';

  logLevel = this.LOG_ERROR | this.LOG_WARN;

  rom: CartInfo | null = null;

  cpu: ARMCore;
  mmu: GameBoyAdvanceMMU;
  irq: GameBoyAdvanceInterruptHandler;
  io: GameBoyAdvanceIO;
  audio: GameBoyAdvanceAudio;
  video: GameBoyAdvanceVideo;
  keypad: GameBoyAdvanceKeypad;
  sio: GameBoyAdvanceSIO;

  /** Persistence backend. Defaults to MemorySaveBackend — must call setSaveFolder() for persistence. */
  saveBackend: SaveBackend;

  /** Hash of currently loaded ROM — used as subfolder for saves. */
  gameHash: string | null = null;

  /** Called after successful save persistence */
  onSave: (() => void) | null = null;

  /** Frame scheduler function. */
  private scheduler: (fn: () => void) => void;

  context!: CanvasRenderingContext2D;
  indirectCanvas: HTMLCanvasElement | null = null;
  targetCanvas: HTMLCanvasElement | null = null;

  doStep: () => boolean;
  paused = false;
  seenFrame = false;
  seenSave = false;
  lastVblank = 0;

  queue: number | null = null;
  reportFPS: ((fps: number) => void) | null = null;
  throttle = 16;

  interval: number | undefined;

  constructor(config?: GBAConfig) {
    this.cpu = new ARMCore();
    this.mmu = new GameBoyAdvanceMMU();
    this.irq = new GameBoyAdvanceInterruptHandler();
    this.io = new GameBoyAdvanceIO();
    this.audio = new GameBoyAdvanceAudio();
    this.video = new GameBoyAdvanceVideo();
    this.keypad = new GameBoyAdvanceKeypad();
    this.sio = new GameBoyAdvanceSIO();

    // Persistence backend — defaults to in-memory (no persistence until folder selected)
    if (config?.saveBackend) {
      this.saveBackend = config.saveBackend;
    } else {
      this.saveBackend = new MemorySaveBackend();
    }

    // Frame scheduler
    if (config?.scheduler) {
      this.scheduler = config.scheduler;
    } else if (isBrowser()) {
      const self = this;
      window.queueFrame = function (f: () => void) {
        self.queue = window.setTimeout(f, self.throttle);
      };
      this.scheduler = (fn) => window.queueFrame(fn);
    } else {
      // Bun/Node: use setImmediate-like scheduling
      this.scheduler = (fn) => {
        this.queue = +setTimeout(fn, this.throttle);
      };
    }

    if (config?.throttle !== undefined) {
      this.throttle = config.throttle;
    }

    // Wire up the dependency graph
    (this.cpu as any).mmu = this.mmu;
    (this.cpu as any).irq = this.irq;

    (this.mmu as any).cpu = this.cpu;
    (this.mmu as any).core = this;

    (this.irq as any).cpu = this.cpu;
    (this.irq as any).io = this.io;
    (this.irq as any).audio = this.audio;
    (this.irq as any).video = this.video;
    (this.irq as any).core = this;

    (this.io as any).cpu = this.cpu;
    (this.io as any).audio = this.audio;
    (this.io as any).video = this.video;
    (this.io as any).keypad = this.keypad;
    (this.io as any).sio = this.sio;
    (this.io as any).core = this;

    (this.audio as any).cpu = this.cpu;
    (this.audio as any).core = this;

    (this.video as any).cpu = this.cpu;
    (this.video as any).core = this;

    (this.keypad as any).core = this;
    (this.sio as any).core = this;

    this.keypad.registerHandlers();
    this.doStep = this.waitFrame.bind(this);
    this.paused = false;

    this.seenFrame = false;
    this.seenSave = false;
    this.lastVblank = 0;

    this.queue = null;
    this.reportFPS = null;
    this.throttle = config?.throttle ?? 16;

    if (isBrowser()) {
      window.URL = window.URL || window.webkitURL!;
    }

    const self = this;
    this.video.vblankCallback = function () {
      self.seenFrame = true;
    };
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    const self = this;
    if (canvas.offsetWidth !== 240 || canvas.offsetHeight !== 160) {
      this.indirectCanvas = document.createElement('canvas');
      this.indirectCanvas.setAttribute('height', '160');
      this.indirectCanvas.setAttribute('width', '240');
      this.targetCanvas = canvas;
      this.setCanvasDirect(this.indirectCanvas);
      const targetContext = canvas.getContext('2d')!;
      this.video.drawCallback = function () {
        targetContext.drawImage(self.indirectCanvas!, 0, 0, canvas.width, canvas.height);
      };
    } else {
      this.setCanvasDirect(canvas);
    }
  }

  setCanvasDirect(canvas: HTMLCanvasElement): void {
    this.context = canvas.getContext('2d')!;
    this.video.setBacking(this.context);
  }

  setBios(bios: ArrayBuffer, real?: boolean): void {
    this.mmu.loadBios(bios, real);
  }

  setRom(rom: ArrayBuffer): boolean {
    this.reset();

    this.rom = this.mmu.loadRom(rom, true);
    if (!this.rom) {
      return false;
    }
    this.retrieveSavedataSync();
    return true;
  }

  /** Load ROM asynchronously (uses save backend for savedata retrieval). */
  async setRomAsync(rom: ArrayBuffer): Promise<boolean> {
    this.reset();

    this.rom = this.mmu.loadRom(rom, true);
    if (!this.rom) {
      return false;
    }
    await this.retrieveSavedata();
    return true;
  }

  hasRom(): boolean {
    return !!this.rom;
  }

  loadRomFromFile(romFile: File, callback?: (result: boolean) => void): void {
    const reader = new FileReader();
    const self = this;
    reader.onload = function (e: ProgressEvent<FileReader>) {
      const result = self.setRom(e.target!.result as ArrayBuffer);
      if (callback) {
        callback(result);
      }
    };
    reader.readAsArrayBuffer(romFile);
  }

  reset(): void {
    this.audio.pause(true);

    this.mmu.clear();
    this.io.clear();
    this.audio.clear();
    this.video.clear();
    this.sio.clear();

    this.mmu.mmap(this.mmu.REGION_IO, this.io);
    this.mmu.mmap(this.mmu.REGION_PALETTE_RAM, this.video.renderPath.palette);
    this.mmu.mmap(this.mmu.REGION_VRAM, this.video.renderPath.vram);
    this.mmu.mmap(this.mmu.REGION_OAM, this.video.renderPath.oam);

    this.cpu.resetCPU(0);
  }

  step(): void {
    while (this.doStep()) {
      this.cpu.step();
    }
  }

  waitFrame(): boolean {
    const seen = this.seenFrame;
    this.seenFrame = false;
    return !seen;
  }

  pause(): void {
    this.paused = true;
    this.audio.pause(true);
    if (this.queue) {
      clearTimeout(this.queue);
      this.queue = null;
    }
  }

  advanceFrame(): void {
    this.step();
    if (this.seenSave) {
      if (!this.mmu.saveNeedsFlush()) {
        this.storeSavedata().catch(function (e) {
          // 静默失败，已在 storeSavedata 内 Warn
        });
        this.seenSave = false;
      } else {
        this.mmu.flushSave();
      }
    } else if (this.mmu.saveNeedsFlush()) {
      this.seenSave = true;
      this.mmu.flushSave();
    }
  }

  runStable(): void {
    if (this.interval) {
      return; // Already running
    }
    const self = this;
    let timer = 0;
    let frames = 0;
    let runFunc: () => void;
    let start = Date.now();
    this.paused = false;
    this.audio.pause(false);

    if (this.reportFPS) {
      runFunc = function () {
        try {
          timer += Date.now() - start;
          if (self.paused) {
            return;
          } else {
            self.scheduler(runFunc);
          }
          start = Date.now();
          self.advanceFrame();
          ++frames;
          if (frames === 60) {
            self.reportFPS!((frames * 1000) / timer);
            frames = 0;
            timer = 0;
          }
        } catch (exception) {
          self.ERROR(exception as string);
          if ((exception as Error).stack) {
            self.logStackTrace((exception as Error).stack!.split('\n'));
          }
          throw exception;
        }
      };
    } else {
      runFunc = function () {
        try {
          if (self.paused) {
            return;
          } else {
            self.scheduler(runFunc);
          }
          self.advanceFrame();
        } catch (exception) {
          self.ERROR(exception as string);
          if ((exception as Error).stack) {
            self.logStackTrace((exception as Error).stack!.split('\n'));
          }
          throw exception;
        }
      };
    }
    this.scheduler(runFunc);
  }

  setSavedata(data: ArrayBuffer): void {
    this.mmu.loadSavedata(data);
  }

  loadSavedataFromFile(saveFile: File): void {
    const reader = new FileReader();
    const self = this;
    reader.onload = function (e: ProgressEvent<FileReader>) {
      self.setSavedata(e.target!.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(saveFile);
  }

  decodeSavedata(string: string): void {
    this.setSavedata(this.decodeBase64(string));
  }

  decodeBase64(string: string): ArrayBuffer {
    let length = (string.length * 3) / 4;
    if (string[string.length - 2] === '=') {
      length -= 2;
    } else if (string[string.length - 1] === '=') {
      length -= 1;
    }
    const buffer = new ArrayBuffer(length);
    const view = new Uint8Array(buffer);
    const bits = string.match(/..../g);
    let i = 0;
    for (i = 0; i + 2 < length; i += 3) {
      const s = atob(bits!.shift()!);
      view[i] = s.charCodeAt(0);
      view[i + 1] = s.charCodeAt(1);
      view[i + 2] = s.charCodeAt(2);
    }
    if (i < length) {
      const s = atob(bits!.shift()!);
      view[i++] = s.charCodeAt(0);
      if (s.length > 1) {
        view[i++] = s.charCodeAt(1);
      }
    }

    return buffer;
  }

  encodeBase64(view: DataView): string {
    const data: string[] = [];
    let b: number;
    const wordstring: string[] = [];
    let triplet: string[];
    for (let i = 0; i < view.byteLength; ++i) {
      b = view.getUint8(i);
      wordstring.push(String.fromCharCode(b));
      while (wordstring.length >= 3) {
        triplet = wordstring.splice(0, 3);
        data.push(btoa(triplet.join('')));
      }
    }
    if (wordstring.length) {
      data.push(btoa(wordstring.join('')));
    }
    return data.join('');
  }

  downloadSavedata(): void {
    const sram = this.mmu.save;
    if (!sram) {
      this.WARN('No save data available');
      return;
    }
    if (isBrowser() && window.URL) {
      const url = window.URL.createObjectURL(
        new Blob([sram.buffer], { type: 'application/octet-stream' })
      );
      window.open(url!);
    } else {
      const data = this.encodeBase64(sram.view);
      if (isBrowser()) {
        window.open('data:application/octet-stream;base64,' + data, this.rom!.code + '.sav');
      }
    }
  }

  async storeSavedata(): Promise<void> {
    const sram = this.mmu.save;
    if (!sram) return;
    const prefix = this.gameHash ? this.gameHash + '/' : '';
    const key = prefix + this.SYS_ID + '.' + this.mmu.cart!.code;
    try {
      await this.saveBackend.storeSavedata(key, sram.buffer.slice(0));
      if (this.onSave) this.onSave();
    } catch (e) {
      this.WARN('Could not store savedata! ' + e);
    }
  }

  /** Synchronous fallback for backward compat. IDBSaveBackend is async, so this may be a no-op. */
  private retrieveSavedataSync(): void {
    // For the default IDBSaveBackend, the synchronous path won't work.
    // The async retrieveSavedata() should be called from setRomAsync() instead.
    if (this.saveBackend instanceof IDBSaveBackend) return;

    // Legacy localStorage sync path:
    const prefix = this.gameHash ? this.gameHash + '/' : '';
    const key = prefix + this.SYS_ID + '.' + this.mmu.cart!.code;
    if (isBrowser()) {
      const data = localStorage.getItem(key);
      if (data) {
        this.decodeSavedata(data);
      }
    }
  }

  /** Asynchronously retrieve savedata from backend. */
  async retrieveSavedata(): Promise<boolean> {
    const prefix = this.gameHash ? this.gameHash + '/' : '';
    const key = prefix + this.SYS_ID + '.' + this.mmu.cart!.code;
    try {
      const data = await this.saveBackend.loadSavedata(key);
      if (data) {
        this.setSavedata(data);
        return true;
      }
    } catch (e) {
      this.WARN('Could not retrieve savedata! ' + e);
    }
    return false;
  }

  freeze(): object {
    return {
      cpu: this.cpu.freeze(),
      mmu: this.mmu.freeze(),
      irq: this.irq.freeze(),
      io: this.io.freeze(),
      audio: this.audio.freeze(),
      video: this.video.freeze(),
    };
  }

  defrost(frost: Record<string, any>): void {
    this.cpu.defrost(frost['cpu']);
    this.mmu.defrost(frost['mmu']);
    this.audio.defrost(frost['audio']);
    this.video.defrost(frost['video']);
    this.irq.defrost(frost['irq']);
    this.io.defrost(frost['io']);
  }

  log(level: number, message: string): void {}

  setLogger(logger: (level: number, message: string) => void): void {
    this.log = logger;
  }

  logStackTrace(stack: string[]): void {
    const overflow = stack.length - 32;
    this.ERROR('Stack trace follows:');
    if (overflow > 0) {
      this.log(-1, '> (Too many frames)');
    }
    for (let i = Math.max(overflow, 0); i < stack.length; ++i) {
      this.log(-1, '> ' + stack[i]);
    }
  }

  ERROR(error: string): void {
    if (this.logLevel & this.LOG_ERROR) {
      this.log(this.LOG_ERROR, error);
    }
  }

  WARN(warn: string): void {
    if (this.logLevel & this.LOG_WARN) {
      this.log(this.LOG_WARN, warn);
    }
  }

  STUB(func: string): void {
    if (this.logLevel & this.LOG_STUB) {
      this.log(this.LOG_STUB, func);
    }
  }

  INFO(info: string): void {
    if (this.logLevel & this.LOG_INFO) {
      this.log(this.LOG_INFO, info);
    }
  }

  DEBUG(info: string): void {
    if (this.logLevel & this.LOG_DEBUG) {
      this.log(this.LOG_DEBUG, info);
    }
  }

  ASSERT_UNREACHED(err: string): never {
    throw new Error('Should be unreached: ' + err);
  }

  ASSERT(test: boolean, err: string): void {
    if (!test) {
      throw new Error('Assertion failed: ' + err);
    }
  }
}
