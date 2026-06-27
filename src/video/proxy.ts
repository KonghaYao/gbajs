// Video render proxy - communicates with a Web Worker for rendering
import { Serializer } from '../util.js';

// Forward reference to MemoryView - will be provided at runtime from mmu
interface MemoryViewLike {
  buffer: ArrayBuffer;
  load8(offset: number): number;
  load16(offset: number): number;
  loadU8(offset: number): number;
  loadU16(offset: number): number;
  load32(offset: number): number;
  store8(offset: number, value: number): void;
  store16(offset: number, value: number): void;
  store32(offset: number, value: number): void;
  invalidatePage(address: number): void;
}

export class MemoryProxy {
  owner: GameBoyAdvanceRenderProxy;
  blocks: MemoryViewLike[];
  blockSize: number;
  mask: number;
  size: number;

  constructor(owner: GameBoyAdvanceRenderProxy, size: number, blockSize: number) {
    this.owner = owner;
    this.blocks = [];
    this.blockSize = blockSize;
    this.mask = (1 << blockSize) - 1;
    this.size = size;
    if (blockSize) {
      for (let i = 0; i < (size >> blockSize); ++i) {
        // MemoryView is created from mmu - use a compatible instance
        this.blocks.push(new (window as any).MemoryView(new ArrayBuffer(1 << blockSize)));
      }
    } else {
      this.blockSize = 31;
      this.mask = -1;
      this.blocks[0] = new (window as any).MemoryView(new ArrayBuffer(size));
    }
  }

  combine(): ArrayBuffer {
    if (this.blocks.length > 1) {
      const combined = new Uint8Array(this.size);
      for (let i = 0; i < this.blocks.length; ++i) {
        combined.set(new Uint8Array(this.blocks[i].buffer), i << this.blockSize);
      }
      return combined.buffer;
    } else {
      return this.blocks[0].buffer;
    }
  }

  replace(buffer: ArrayBuffer): void {
    for (let i = 0; i < this.blocks.length; ++i) {
      this.blocks[i] = new (window as any).MemoryView(
        buffer.slice(i << this.blockSize, (i << this.blockSize) + this.blocks[i].buffer.byteLength)
      );
    }
  }

  load8(offset: number): number {
    return this.blocks[offset >> this.blockSize].load8(offset & this.mask);
  }

  load16(offset: number): number {
    return this.blocks[offset >> this.blockSize].load16(offset & this.mask);
  }

  loadU8(offset: number): number {
    return this.blocks[offset >> this.blockSize].loadU8(offset & this.mask);
  }

  loadU16(offset: number): number {
    return this.blocks[offset >> this.blockSize].loadU16(offset & this.mask);
  }

  load32(offset: number): number {
    return this.blocks[offset >> this.blockSize].load32(offset & this.mask);
  }

  store8(offset: number, value: number): void {
    if (offset >= this.size) {
      return;
    }
    this.owner.memoryDirtied(this, offset >> this.blockSize);
    this.blocks[offset >> this.blockSize].store8(offset & this.mask, value);
    this.blocks[offset >> this.blockSize].store8((offset & this.mask) ^ 1, value);
  }

  store16(offset: number, value: number): void {
    if (offset >= this.size) {
      return;
    }
    this.owner.memoryDirtied(this, offset >> this.blockSize);
    return this.blocks[offset >> this.blockSize].store16(offset & this.mask, value);
  }

  store32(offset: number, value: number): void {
    if (offset >= this.size) {
      return;
    }
    this.owner.memoryDirtied(this, offset >> this.blockSize);
    return this.blocks[offset >> this.blockSize].store32(offset & this.mask, value);
  }

  invalidatePage(_address: number): void {}
}

interface DirtyState {
  DISPCNT?: number;
  BGCNT?: number[];
  BGHOFS?: number[];
  BGVOFS?: number[];
  BGX?: number[];
  BGY?: number[];
  BGPA?: number[];
  BGPB?: number[];
  BGPC?: number[];
  BGPD?: number[];
  WIN0H?: number;
  WIN1H?: number;
  WIN0V?: number;
  WIN1V?: number;
  WININ?: number;
  WINOUT?: number;
  BLDCNT?: number;
  BLDALPHA?: number;
  BLDY?: number;
  MOSAIC?: number;
  memory?: {
    palette?: ArrayBuffer;
    oam?: ArrayBuffer;
    vram?: ArrayBuffer[];
  };
}

interface ScanlineEntry {
  y: number;
  dirty: DirtyState;
}

export class GameBoyAdvanceRenderProxy {
  worker: Worker;
  currentFrame = 0;
  delay = 0;
  skipFrame = false;
  dirty: DirtyState | null = null;
  backing: ImageData | null = null;
  caller!: { finishDraw(backing: ImageData): void };

  palette!: MemoryProxy;
  vram!: MemoryProxy;
  oam!: MemoryProxy;

  scanlineQueue: ScanlineEntry[] = [];

  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const self = this;
    const handlers: Record<string, (data: any) => void> = {
      finish(data: any) {
        self.backing = data.backing;
        self.caller.finishDraw(self.backing!);
        --self.delay;
      },
    };
    this.worker.onmessage = function (message: MessageEvent) {
      handlers[message.data['type']](message.data);
    };
  }

  memoryDirtied(mem: MemoryProxy, block: number): void {
    this.dirty = this.dirty || {};
    this.dirty.memory = this.dirty.memory || {};
    if (mem === this.palette) {
      this.dirty.memory.palette = mem.blocks[0].buffer;
    }
    if (mem === this.oam) {
      this.dirty.memory.oam = mem.blocks[0].buffer;
    }
    if (mem === this.vram) {
      this.dirty.memory.vram = this.dirty.memory.vram || [];
      this.dirty.memory.vram[block] = mem.blocks[block].buffer;
    }
  }

  clear(mmu: any): void {
    this.palette = new MemoryProxy(this, mmu.SIZE_PALETTE_RAM, 0);
    this.vram = new MemoryProxy(this, mmu.SIZE_VRAM, 13);
    this.oam = new MemoryProxy(this, mmu.SIZE_OAM, 0);

    this.dirty = null;
    this.scanlineQueue = [];

    this.worker.postMessage({ type: 'clear', SIZE_VRAM: mmu.SIZE_VRAM, SIZE_OAM: mmu.SIZE_OAM });
  }

  freeze(): object {
    return {
      'palette': Serializer.prefix(this.palette.combine()),
      'vram': Serializer.prefix(this.vram.combine()),
      'oam': Serializer.prefix(this.oam.combine()),
    };
  }

  defrost(frost: any): void {
    this.palette.replace(frost.palette);
    this.memoryDirtied(this.palette, 0);
    this.vram.replace(frost.vram);
    for (let i = 0; i < this.vram.blocks.length; ++i) {
      this.memoryDirtied(this.vram, i);
    }
    this.oam.replace(frost.oam);
    this.memoryDirtied(this.oam, 0);
  }

  writeDisplayControl(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.DISPCNT = value;
  }

  writeBackgroundControl(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGCNT = this.dirty.BGCNT || [];
    this.dirty.BGCNT[bg] = value;
  }

  writeBackgroundHOffset(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGHOFS = this.dirty.BGHOFS || [];
    this.dirty.BGHOFS[bg] = value;
  }

  writeBackgroundVOffset(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGVOFS = this.dirty.BGVOFS || [];
    this.dirty.BGVOFS[bg] = value;
  }

  writeBackgroundRefX(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGX = this.dirty.BGX || [];
    this.dirty.BGX[bg] = value;
  }

  writeBackgroundRefY(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGY = this.dirty.BGY || [];
    this.dirty.BGY[bg] = value;
  }

  writeBackgroundParamA(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGPA = this.dirty.BGPA || [];
    this.dirty.BGPA[bg] = value;
  }

  writeBackgroundParamB(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGPB = this.dirty.BGPB || [];
    this.dirty.BGPB[bg] = value;
  }

  writeBackgroundParamC(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGPC = this.dirty.BGPC || [];
    this.dirty.BGPC[bg] = value;
  }

  writeBackgroundParamD(bg: number, value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BGPD = this.dirty.BGPD || [];
    this.dirty.BGPD[bg] = value;
  }

  writeWin0H(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.WIN0H = value;
  }

  writeWin1H(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.WIN1H = value;
  }

  writeWin0V(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.WIN0V = value;
  }

  writeWin1V(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.WIN1V = value;
  }

  writeWinIn(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.WININ = value;
  }

  writeWinOut(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.WINOUT = value;
  }

  writeBlendControl(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BLDCNT = value;
  }

  writeBlendAlpha(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BLDALPHA = value;
  }

  writeBlendY(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.BLDY = value;
  }

  writeMosaic(value: number): void {
    this.dirty = this.dirty || {};
    this.dirty.MOSAIC = value;
  }

  clearSubsets(mmu: any, regions: number): void {
    this.dirty = this.dirty || {};
    if (regions & 0x04) {
      this.palette = new MemoryProxy(this, mmu.SIZE_PALETTE_RAM, 0);
      mmu.mmap(mmu.REGION_PALETTE_RAM, this.palette);
      this.memoryDirtied(this.palette, 0);
    }
    if (regions & 0x08) {
      this.vram = new MemoryProxy(this, mmu.SIZE_VRAM, 13);
      mmu.mmap(mmu.REGION_VRAM, this.vram);
      for (let i = 0; i < this.vram.blocks.length; ++i) {
        this.memoryDirtied(this.vram, i);
      }
    }
    if (regions & 0x10) {
      this.oam = new MemoryProxy(this, mmu.SIZE_OAM, 0);
      mmu.mmap(mmu.REGION_OAM, this.oam);
      this.memoryDirtied(this.oam, 0);
    }
  }

  setBacking(backing: ImageData): void {
    this.backing = backing;
    this.worker.postMessage({ type: 'start', backing: this.backing });
  }

  drawScanline(y: number): void {
    if (!this.skipFrame) {
      if (this.dirty) {
        if (this.dirty.memory) {
          if (this.dirty.memory.palette) {
            this.dirty.memory.palette = this.dirty.memory.palette.slice(0);
          }
          if (this.dirty.memory.oam) {
            this.dirty.memory.oam = this.dirty.memory.oam.slice(0);
          }
          if (this.dirty.memory.vram) {
            for (let i = 0; i < 12; ++i) {
              if (this.dirty.memory.vram[i]) {
                this.dirty.memory.vram[i] = this.dirty.memory.vram[i]!.slice(0);
              }
            }
          }
        }
        this.scanlineQueue.push({ y: y, dirty: this.dirty });
        this.dirty = null;
      }
    }
  }

  startDraw(): void {
    ++this.currentFrame;
    if (this.delay <= 0) {
      this.skipFrame = false;
    }
    if (!this.skipFrame) {
      ++this.delay;
    }
  }

  finishDraw(caller: { finishDraw(backing: ImageData): void }): void {
    this.caller = caller;
    if (!this.skipFrame) {
      this.worker.postMessage({ type: 'finish', scanlines: this.scanlineQueue, frame: this.currentFrame });
      this.scanlineQueue = [];
      if (this.delay > 2) {
        this.skipFrame = true;
      }
    }
  }
}
