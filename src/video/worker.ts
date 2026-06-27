// Web Worker for GBA.js video rendering
// Runs the SoftwareRenderer in a separate thread
import { GameBoyAdvanceSoftwareRenderer } from './software.js';

const video = new GameBoyAdvanceSoftwareRenderer();
let proxyBacking: ImageData | null = null;
let currentFrame = 0;

(self as any).finishDraw = function (pixelData: ImageData) {
  self.postMessage({ type: 'finish', backing: pixelData, frame: currentFrame });
};

interface WorkerMessage {
  type: string;
  SIZE_VRAM?: number;
  SIZE_OAM?: number;
  backing?: ImageData;
  y?: number;
  dirty?: any;
  frame?: number;
  scanlines?: { y: number; dirty: any }[];
}

function receiveDirty(dirty: any): void {
  for (const type in dirty) {
    if (type === 'DISPCNT') {
      video.writeDisplayControl(dirty[type]);
    } else if (type === 'BGCNT') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundControl(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGHOFS') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundHOffset(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGVOFS') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundVOffset(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGX') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundRefX(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGY') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundRefY(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGPA') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundParamA(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGPB') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundParamB(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGPC') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundParamC(+i, dirty[type][i]);
        }
      }
    } else if (type === 'BGPD') {
      for (const i in dirty[type]) {
        if (typeof dirty[type][i] === 'number') {
          video.writeBackgroundParamD(+i, dirty[type][i]);
        }
      }
    } else if (type === 'WIN0H') {
      video.writeWin0H(dirty[type]);
    } else if (type === 'WIN1H') {
      video.writeWin1H(dirty[type]);
    } else if (type === 'WIN0V') {
      video.writeWin0V(dirty[type]);
    } else if (type === 'WIN1V') {
      video.writeWin1V(dirty[type]);
    } else if (type === 'WININ') {
      video.writeWinIn(dirty[type]);
    } else if (type === 'WINOUT') {
      video.writeWinOut(dirty[type]);
    } else if (type === 'BLDCNT') {
      video.writeBlendControl(dirty[type]);
    } else if (type === 'BLDALPHA') {
      video.writeBlendAlpha(dirty[type]);
    } else if (type === 'BLDY') {
      video.writeBlendY(dirty[type]);
    } else if (type === 'MOSAIC') {
      video.writeMosaic(dirty[type]);
    } else if (type === 'memory') {
      receiveMemory(dirty.memory);
    }
  }
}

function receiveMemory(memory: any): void {
  if (memory.palette) {
    video.palette.overwrite(new Uint16Array(memory.palette));
  }
  if (memory.oam) {
    video.oam.overwrite(new Uint16Array(memory.oam));
  }
  if (memory.vram) {
    for (let i = 0; i < 12; ++i) {
      if (memory.vram[i]) {
        video.vram.insert(i << 12, new Uint16Array(memory.vram[i]));
      }
    }
  }
}

const handlers: Record<string, (data: WorkerMessage) => void> = {
  clear(data: WorkerMessage) {
    video.clear(data);
  },

  scanline(data: WorkerMessage) {
    receiveDirty(data.dirty);
    video.drawScanline(data.y!);
  },

  start(data: WorkerMessage) {
    proxyBacking = data.backing!;
    video.setBacking(data.backing!);
  },

  finish(data: WorkerMessage) {
    currentFrame = data.frame!;
    let scanline = 0;
    for (let i = 0; i < data.scanlines!.length; ++i) {
      for (let y = scanline; y < data.scanlines![i].y; ++y) {
        video.drawScanline(y);
      }
      scanline = data.scanlines![i].y + 1;
      receiveDirty(data.scanlines![i].dirty);
      video.drawScanline(data.scanlines![i].y);
    }
    for (let y = scanline; y < 160; ++y) {
      video.drawScanline(y);
    }
    video.finishDraw(self as any);
  },
};

self.onmessage = function (message: MessageEvent) {
  handlers[message.data['type']](message.data);
};
