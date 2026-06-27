// Video memory types and software renderer

export class MemoryAligned16 {
  buffer: Uint16Array;

  constructor(size: number) {
    this.buffer = new Uint16Array(size >> 1);
  }

  load8(offset: number): number {
    return (this.loadU8(offset) << 24) >> 24;
  }

  load16(offset: number): number {
    return (this.loadU16(offset) << 16) >> 16;
  }

  loadU8(offset: number): number {
    const index = offset >> 1;
    if (offset & 1) {
      return (this.buffer[index] & 0xFF00) >>> 8;
    } else {
      return this.buffer[index] & 0x00FF;
    }
  }

  loadU16(offset: number): number {
    return this.buffer[offset >> 1];
  }

  load32(offset: number): number {
    return this.buffer[(offset >> 1) & ~1] | (this.buffer[(offset >> 1) | 1] << 16);
  }

  store8(offset: number, value: number): void {
    this.store16(offset, (value << 8) | value);
  }

  store16(offset: number, value: number): void {
    this.buffer[offset >> 1] = value;
  }

  store32(offset: number, value: number): void {
    const index = offset >> 1;
    this.store16(offset, this.buffer[index] = value & 0xFFFF);
    this.store16(offset + 2, this.buffer[index + 1] = value >>> 16);
  }

  insert(start: number, data: Uint16Array): void {
    this.buffer.set(data, start);
  }

  invalidatePage(_address: number): void {}
}

export class GameBoyAdvanceVRAM extends MemoryAligned16 {
  vram: Uint16Array;

  constructor(size: number) {
    super(size);
    this.vram = this.buffer;
  }
}

export interface Scalerot {
  a: number;
  b: number;
  c: number;
  d: number;
}

export class GameBoyAdvanceOAM extends MemoryAligned16 {
  oam: Uint16Array;
  objs: GameBoyAdvanceOBJ[];
  scalerot: Scalerot[];
  video!: GameBoyAdvanceSoftwareRenderer;

  constructor(size: number) {
    super(size);
    this.oam = this.buffer;
    this.objs = new Array(128);
    for (let i = 0; i < 128; ++i) {
      this.objs[i] = new GameBoyAdvanceOBJ(this, i);
    }
    this.scalerot = new Array(32);
    for (let i = 0; i < 32; ++i) {
      this.scalerot[i] = {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
      };
    }
  }

  overwrite(memory: Uint16Array): void {
    for (let i = 0; i < (this.buffer.byteLength >> 1); ++i) {
      this.store16(i << 1, memory[i]);
    }
  }

  store16(offset: number, value: number): void {
    const index = (offset & 0x3F8) >> 3;
    const obj = this.objs[index];
    const scalerot = this.scalerot[index >> 2];
    switch (offset & 0x00000006) {
      case 0:
        // Attribute 0
        obj.y = value & 0x00FF;
        const wasScalerot = obj.scalerot;
        obj.scalerot = !!(value & 0x0100);
        if (obj.scalerot) {
          obj.scalerotOam = this.scalerot[obj.scalerotParam];
          obj.doublesize = !!(value & 0x0200);
          obj.disable = 0;
          obj.hflip = 0;
          obj.vflip = 0;
        } else {
          obj.doublesize = false;
          obj.disable = value & 0x0200;
          if (wasScalerot) {
            obj.hflip = obj.scalerotParam & 0x0008;
            obj.vflip = obj.scalerotParam & 0x0010;
          }
        }
        obj.mode = (value & 0x0C00) >> 6;
        obj.mosaic = !!(value & 0x1000);
        obj.multipalette = !!(value & 0x2000);
        obj.shape = (value & 0xC000) >> 14;
        obj.recalcSize();
        break;
      case 2:
        // Attribute 1
        obj.x = value & 0x01FF;
        if (obj.scalerot) {
          obj.scalerotParam = (value & 0x3E00) >> 9;
          obj.scalerotOam = this.scalerot[obj.scalerotParam];
          obj.hflip = 0;
          obj.vflip = 0;
          obj.drawScanline = obj.drawScanlineAffine;
        } else {
          obj.hflip = value & 0x1000;
          obj.vflip = value & 0x2000;
          obj.drawScanline = obj.drawScanlineNormal;
        }
        obj.size = (value & 0xC000) >> 14;
        obj.recalcSize();
        break;
      case 4:
        // Attribute 2
        obj.tileBase = value & 0x03FF;
        obj.priority = (value & 0x0C00) >> 10;
        obj.palette = (value & 0xF000) >> 8;
        break;
      case 6:
        // Scaling/rotation parameter
        switch (index & 0x3) {
          case 0:
            scalerot.a = (value << 16) / 0x1000000;
            break;
          case 1:
            scalerot.b = (value << 16) / 0x1000000;
            break;
          case 2:
            scalerot.c = (value << 16) / 0x1000000;
            break;
          case 3:
            scalerot.d = (value << 16) / 0x1000000;
            break;
        }
        break;
    }
    super.store16(offset, value);
  }
}

export class GameBoyAdvancePalette {
  colors: [number[], number[]];
  adjustedColors: [number[], number[]];
  passthroughColors: number[][];
  blendY: number;
  adjustColor: (color: number) => number;
  adjustColorDark: (color: number) => number;
  adjustColorBright: (color: number) => number;

  constructor() {
    this.colors = [new Array(0x100), new Array(0x100)];
    this.adjustedColors = [new Array(0x100), new Array(0x100)];
    this.passthroughColors = [
      this.colors[0], // BG0
      this.colors[0], // BG1
      this.colors[0], // BG2
      this.colors[0], // BG3
      this.colors[1], // OBJ
      this.colors[0], // Backdrop
    ];
    this.blendY = 1;
    this.adjustColorDark = (color: number): number => {
      let r = (color & 0x001F);
      let g = (color & 0x03E0) >> 5;
      let b = (color & 0x7C00) >> 10;
      r = r - (r * this.blendY);
      g = g - (g * this.blendY);
      b = b - (b * this.blendY);
      return r | (g << 5) | (b << 10);
    };
    this.adjustColorBright = (color: number): number => {
      let r = (color & 0x001F);
      let g = (color & 0x03E0) >> 5;
      let b = (color & 0x7C00) >> 10;
      r = r + ((31 - r) * this.blendY);
      g = g + ((31 - g) * this.blendY);
      b = b + ((31 - b) * this.blendY);
      return r | (g << 5) | (b << 10);
    };
    this.adjustColor = this.adjustColorBright;
  }

  overwrite(memory: Uint16Array): void {
    for (let i = 0; i < 512; ++i) {
      this.store16(i << 1, memory[i]);
    }
  }

  loadU8(offset: number): number {
    return (this.loadU16(offset) >> (8 * (offset & 1))) & 0xFF;
  }

  loadU16(offset: number): number {
    return this.colors[(offset & 0x200) >> 9][(offset & 0x1FF) >> 1];
  }

  load16(offset: number): number {
    return (this.loadU16(offset) << 16) >> 16;
  }

  load32(offset: number): number {
    return this.loadU16(offset) | (this.loadU16(offset + 2) << 16);
  }

  store16(offset: number, value: number): void {
    const type = (offset & 0x200) >> 9;
    const index = (offset & 0x1FF) >> 1;
    this.colors[type][index] = value;
    this.adjustedColors[type][index] = this.adjustColor(value);
  }

  store32(offset: number, value: number): void {
    this.store16(offset, value & 0xFFFF);
    this.store16(offset + 2, value >> 16);
  }

  invalidatePage(_address: number): void {}

  convert16To32(value: number, input: number[]): void {
    const r = (value & 0x001F) << 3;
    const g = (value & 0x03E0) >> 2;
    const b = (value & 0x7C00) >> 7;
    input[0] = r;
    input[1] = g;
    input[2] = b;
  }

  mix(aWeight: number, aColor: number, bWeight: number, bColor: number): number {
    const ar = (aColor & 0x001F);
    const ag = (aColor & 0x03E0) >> 5;
    const ab = (aColor & 0x7C00) >> 10;
    const br = (bColor & 0x001F);
    const bg = (bColor & 0x03E0) >> 5;
    const bb = (bColor & 0x7C00) >> 10;
    const r = Math.min(aWeight * ar + bWeight * br, 0x1F);
    const g = Math.min(aWeight * ag + bWeight * bg, 0x1F);
    const b = Math.min(aWeight * ab + bWeight * bb, 0x1F);
    return r | (g << 5) | (b << 10);
  }

  makeDarkPalettes(layers: number): void {
    if (this.adjustColor !== this.adjustColorDark) {
      this.adjustColor = this.adjustColorDark;
      this.resetPalettes();
    }
    this.resetPaletteLayers(layers);
  }

  makeBrightPalettes(layers: number): void {
    if (this.adjustColor !== this.adjustColorBright) {
      this.adjustColor = this.adjustColorBright;
      this.resetPalettes();
    }
    this.resetPaletteLayers(layers);
  }

  makeNormalPalettes(): void {
    this.passthroughColors[0] = this.colors[0];
    this.passthroughColors[1] = this.colors[0];
    this.passthroughColors[2] = this.colors[0];
    this.passthroughColors[3] = this.colors[0];
    this.passthroughColors[4] = this.colors[1];
    this.passthroughColors[5] = this.colors[0];
  }

  makeSpecialPalette(layer: number): void {
    this.passthroughColors[layer] = this.adjustedColors[layer === 4 ? 1 : 0];
  }

  makeNormalPalette(layer: number): void {
    this.passthroughColors[layer] = this.colors[layer === 4 ? 1 : 0];
  }

  resetPaletteLayers(layers: number): void {
    if (layers & 0x01) {
      this.passthroughColors[0] = this.adjustedColors[0];
    } else {
      this.passthroughColors[0] = this.colors[0];
    }
    if (layers & 0x02) {
      this.passthroughColors[1] = this.adjustedColors[0];
    } else {
      this.passthroughColors[1] = this.colors[0];
    }
    if (layers & 0x04) {
      this.passthroughColors[2] = this.adjustedColors[0];
    } else {
      this.passthroughColors[2] = this.colors[0];
    }
    if (layers & 0x08) {
      this.passthroughColors[3] = this.adjustedColors[0];
    } else {
      this.passthroughColors[3] = this.colors[0];
    }
    if (layers & 0x10) {
      this.passthroughColors[4] = this.adjustedColors[1];
    } else {
      this.passthroughColors[4] = this.colors[1];
    }
    if (layers & 0x20) {
      this.passthroughColors[5] = this.adjustedColors[0];
    } else {
      this.passthroughColors[5] = this.colors[0];
    }
  }

  resetPalettes(): void {
    let outPalette = this.adjustedColors[0];
    let inPalette = this.colors[0];
    for (let i = 0; i < 256; ++i) {
      outPalette[i] = this.adjustColor(inPalette[i]);
    }
    outPalette = this.adjustedColors[1];
    inPalette = this.colors[1];
    for (let i = 0; i < 256; ++i) {
      outPalette[i] = this.adjustColor(inPalette[i]);
    }
  }

  accessColor(layer: number, index: number): number {
    return this.passthroughColors[layer][index];
  }

  setBlendY(y: number): void {
    if (this.blendY !== y) {
      this.blendY = y;
      this.resetPalettes();
    }
  }
}

export class GameBoyAdvanceOBJ {
  TILE_OFFSET = 0x10000;
  oam: GameBoyAdvanceOAM;
  index: number;
  x = 0;
  y = 0;
  scalerot = false;
  doublesize = false;
  disable = 1;
  mode = 0;
  mosaic = false;
  multipalette = false;
  shape = 0;
  scalerotParam = 0;
  hflip = 0;
  vflip = 0;
  tileBase = 0;
  priority = 0;
  palette = 0;
  scalerotOam: Scalerot | null = null;
  size = 0;
  drawScanline: (backing: any, y: number, yOff: number, start: number, end: number) => void;
  pushPixel!: (layer: number, map: any, video: GameBoyAdvanceSoftwareRenderer, row: number, x: number, offset: number, backing: any, mask: number, raw: boolean) => void;
  cachedWidth = 8;
  cachedHeight = 8;

  constructor(oam: GameBoyAdvanceOAM, index: number) {
    this.oam = oam;
    this.index = index;
    this.drawScanline = this.drawScanlineNormal;
    this.pushPixel = GameBoyAdvanceSoftwareRenderer.pushPixel;
  }

  drawScanlineNormal(backing: any, y: number, yOff: number, start: number, end: number): void {
    const video = this.oam.video;
    let underflow: number;
    let offset: number;
    let mask = this.mode | video.target2[video.LAYER_OBJ] | (this.priority << 1);
    if (this.mode === 0x10) {
      mask |= video.TARGET1_MASK;
    }
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[video.LAYER_OBJ];
    }

    let totalWidth = this.cachedWidth;
    if (this.x < video.HORIZONTAL_PIXELS) {
      if (this.x < start) {
        underflow = start - this.x;
        offset = start;
      } else {
        underflow = 0;
        offset = this.x;
      }
      if (end < this.cachedWidth + this.x) {
        totalWidth = end - this.x;
      }
    } else {
      underflow = start + 512 - this.x;
      offset = start;
      if (end < this.cachedWidth - underflow) {
        totalWidth = end;
      }
    }

    let localX: number;
    let localY: number;
    if (!this.vflip) {
      localY = y - yOff;
    } else {
      localY = this.cachedHeight - y + yOff - 1;
    }
    const localYLo = localY & 0x7;
    let mosaicX: number;
    let tileOffset: number;

    const paletteShift: 0 | 1 = this.multipalette ? 1 : 0;

    if (video.objCharacterMapping) {
      tileOffset = ((localY & 0x01F8) * this.cachedWidth) >> 6;
    } else {
      tileOffset = (localY & 0x01F8) << (2 - paletteShift);
    }

    if (this.mosaic) {
      mosaicX = video.objMosaicX - 1 - (video.objMosaicX + offset - 1) % video.objMosaicX;
      offset += mosaicX;
      underflow += mosaicX;
    }
    if (!this.hflip) {
      localX = underflow;
    } else {
      localX = this.cachedWidth - underflow - 1;
    }

    let tileRow = video.accessTile(this.TILE_OFFSET + (localX & 0x4) * paletteShift,
      this.tileBase + (tileOffset << paletteShift) + ((localX & 0x01F8) >> (3 - paletteShift)),
      localYLo << paletteShift);
    for (let x = underflow; x < totalWidth; ++x) {
      mosaicX = this.mosaic ? offset % video.objMosaicX : 0;
      if (!this.hflip) {
        localX = x - mosaicX;
      } else {
        localX = this.cachedWidth - (x - mosaicX) - 1;
      }
      if (!paletteShift) {
        if (!(x & 0x7) || (this.mosaic && !mosaicX)) {
          tileRow = video.accessTile(this.TILE_OFFSET, this.tileBase + tileOffset + (localX >> 3), localYLo);
        }
      } else {
        if (!(x & 0x3) || (this.mosaic && !mosaicX)) {
          tileRow = video.accessTile(this.TILE_OFFSET + (localX & 0x4), this.tileBase + (tileOffset << 1) + ((localX & 0x01F8) >> 2), localYLo << 1);
        }
      }
      this.pushPixel(video.LAYER_OBJ, this, video, tileRow, localX & 0x7, offset, backing, mask, false);
      offset++;
    }
  }

  drawScanlineAffine(backing: any, y: number, yOff: number, start: number, end: number): void {
    const video = this.oam.video;
    let underflow: number;
    let offset: number;
    let mask = this.mode | video.target2[video.LAYER_OBJ] | (this.priority << 1);
    if (this.mode === 0x10) {
      mask |= video.TARGET1_MASK;
    }
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[video.LAYER_OBJ];
    }

    let localX: number;
    let localY: number;
    const yDiff = y - yOff;
    let tileRow: number;

    const paletteShift: 0 | 1 = this.multipalette ? 1 : 0;
    const totalWidth = this.cachedWidth << (this.doublesize ? 1 : 0);
    const totalHeight = this.cachedHeight << (this.doublesize ? 1 : 0);
    let drawWidth = totalWidth;
    if (drawWidth > video.HORIZONTAL_PIXELS) {
      drawWidth = video.HORIZONTAL_PIXELS;
    }

    if (this.x < video.HORIZONTAL_PIXELS) {
      if (this.x < start) {
        underflow = start - this.x;
        offset = start;
      } else {
        underflow = 0;
        offset = this.x;
      }
      if (end < drawWidth + this.x) {
        drawWidth = end - this.x;
      }
    } else {
      underflow = start + 512 - this.x;
      offset = start;
      if (end < drawWidth - underflow) {
        drawWidth = end;
      }
    }

    for (let x = underflow; x < drawWidth; ++x) {
      localX = this.scalerotOam!.a * (x - (totalWidth >> 1)) + this.scalerotOam!.b * (yDiff - (totalHeight >> 1)) + (this.cachedWidth >> 1);
      localY = this.scalerotOam!.c * (x - (totalWidth >> 1)) + this.scalerotOam!.d * (yDiff - (totalHeight >> 1)) + (this.cachedHeight >> 1);
      if (this.mosaic) {
        localX -= (x % video.objMosaicX) * this.scalerotOam!.a + (y % video.objMosaicY) * this.scalerotOam!.b;
        localY -= (x % video.objMosaicX) * this.scalerotOam!.c + (y % video.objMosaicY) * this.scalerotOam!.d;
      }

      if (localX < 0 || localX >= this.cachedWidth || localY < 0 || localY >= this.cachedHeight) {
        offset++;
        continue;
      }

      if (video.objCharacterMapping) {
        const tileOffset2 = ((localY & 0x01F8) * this.cachedWidth) >> 6;
        tileRow = video.accessTile(this.TILE_OFFSET + (localX & 0x4) * paletteShift,
          this.tileBase + (tileOffset2 << paletteShift) + ((localX & 0x01F8) >> (3 - paletteShift)),
          (localY & 0x7) << paletteShift);
      } else {
        const tileOffset3 = (localY & 0x01F8) << (2 - paletteShift);
        tileRow = video.accessTile(this.TILE_OFFSET + (localX & 0x4) * paletteShift,
          this.tileBase + (tileOffset3 << paletteShift) + ((localX & 0x01F8) >> (3 - paletteShift)),
          (localY & 0x7) << paletteShift);
      }
      this.pushPixel(video.LAYER_OBJ, this, video, tileRow, localX & 0x7, offset, backing, mask, false);
      offset++;
    }
  }

  recalcSize(): void {
    switch (this.shape) {
      case 0:
        this.cachedHeight = this.cachedWidth = 8 << this.size;
        break;
      case 1:
        switch (this.size) {
          case 0: this.cachedHeight = 8; this.cachedWidth = 16; break;
          case 1: this.cachedHeight = 8; this.cachedWidth = 32; break;
          case 2: this.cachedHeight = 16; this.cachedWidth = 32; break;
          case 3: this.cachedHeight = 32; this.cachedWidth = 64; break;
        }
        break;
      case 2:
        switch (this.size) {
          case 0: this.cachedHeight = 16; this.cachedWidth = 8; break;
          case 1: this.cachedHeight = 32; this.cachedWidth = 8; break;
          case 2: this.cachedHeight = 32; this.cachedWidth = 16; break;
          case 3: this.cachedHeight = 64; this.cachedWidth = 32; break;
        }
        break;
    }
  }
}

export class GameBoyAdvanceOBJLayer {
  video: GameBoyAdvanceSoftwareRenderer;
  bg = false;
  index: number;
  priority: number;
  enabled = false;
  objwin = 0;

  constructor(video: GameBoyAdvanceSoftwareRenderer, index: number) {
    this.video = video;
    this.index = video.LAYER_OBJ;
    this.priority = index;
  }

  drawScanline(backing: any, _layer: any, start: number, end: number): void {
    const y = this.video.vcount;
    let wrappedY: number;
    let mosaicY: number;
    if (start >= end) {
      return;
    }
    const objs = this.video.oam.objs;
    for (let i = 0; i < objs.length; ++i) {
      const obj = objs[i];
      if (obj.disable) {
        continue;
      }
      if ((obj.mode & this.video.OBJWIN_MASK) !== this.objwin) {
        continue;
      }
      if (!(obj.mode & this.video.OBJWIN_MASK) && this.priority !== obj.priority) {
        continue;
      }
      if (obj.y < this.video.VERTICAL_PIXELS) {
        wrappedY = obj.y;
      } else {
        wrappedY = obj.y - 256;
      }
      let totalHeight: number;
      if (!obj.scalerot) {
        totalHeight = obj.cachedHeight;
      } else {
        totalHeight = obj.cachedHeight << (obj.doublesize ? 1 : 0);
      }
      if (!obj.mosaic) {
        mosaicY = y;
      } else {
        mosaicY = y - y % this.video.objMosaicY;
      }
      if (wrappedY <= y && (wrappedY + totalHeight) > y) {
        obj.drawScanline(backing, mosaicY, wrappedY, start, end);
      }
    }
  }
}

export class GameBoyAdvanceSoftwareRenderer {
  LAYER_BG0 = 0;
  LAYER_BG1 = 1;
  LAYER_BG2 = 2;
  LAYER_BG3 = 3;
  LAYER_OBJ = 4;
  LAYER_BACKDROP = 5;

  HORIZONTAL_PIXELS = 240;
  VERTICAL_PIXELS = 160;

  LAYER_MASK = 0x06;
  BACKGROUND_MASK = 0x01;
  TARGET2_MASK = 0x08;
  TARGET1_MASK = 0x10;
  OBJWIN_MASK = 0x20;
  WRITTEN_MASK = 0x80;

  PRIORITY_MASK = this.LAYER_MASK | this.BACKGROUND_MASK;

  drawBackdrop: any;

  palette!: GameBoyAdvancePalette;
  vram!: GameBoyAdvanceVRAM;
  oam!: GameBoyAdvanceOAM;
  objLayers: GameBoyAdvanceOBJLayer[] = [];
  objwinLayer!: GameBoyAdvanceOBJLayer;

  backgroundMode = 0;
  displayFrameSelect = 0;
  hblankIntervalFree = 0;
  objCharacterMapping = 0;
  forcedBlank = 1;
  win0 = 0;
  win1 = 0;
  objwin = 0;

  vcount = -1;

  win0Left = 0;
  win0Right = 240;
  win1Left = 0;
  win1Right = 240;
  win0Top = 0;
  win0Bottom = 160;
  win1Top = 0;
  win1Bottom = 160;

  windows: { enabled: boolean[]; special: number }[] = [];

  target1: number[] = [];
  target2: number[] = [];
  blendMode = 0;
  blendA = 0;
  blendB = 0;
  blendY = 0;

  bgMosaicX = 1;
  bgMosaicY = 1;
  objMosaicX = 1;
  objMosaicY = 1;

  lastHblank = 0;
  nextHblank = 1006; // HDRAW_LENGTH
  nextEvent = this.nextHblank;
  nextHblankIRQ = 0;
  nextVblankIRQ = 0;
  nextVcounterIRQ = 0;

  bg: any[] = [];
  bgModes: ((backing: any, bg: any, start: number, end: number) => void)[] = [];

  drawLayers: any[] = [];

  objwinActive = false;
  alphaEnabled = false;

  scanline!: { color: Uint16Array; stencil: Uint8Array };
  sharedColor = [0, 0, 0];
  sharedMap = { tile: 0, hflip: false, vflip: false, palette: 0 };
  pixelData!: ImageData;

  static pushPixel(
    layer: number,
    map: any,
    video: GameBoyAdvanceSoftwareRenderer,
    row: number,
    x: number,
    offset: number,
    backing: any,
    mask: number,
    raw: boolean,
  ): void {
    let index: number;
    if (!raw) {
      if (map.multipalette) {
        index = (row >> (x << 3)) & 0xFF;
      } else {
        index = (row >> (x << 2)) & 0xF;
      }
      if (!index) {
        return;
      } else if (!map.multipalette) {
        index |= map.palette;
      }
    }

    let stencil = video.WRITTEN_MASK;
    const oldStencil = backing.stencil[offset];
    const blend = video.blendMode;
    if (video.objwinActive) {
      if (oldStencil & video.OBJWIN_MASK) {
        if (video.windows[3].enabled[layer]) {
          video.setBlendEnabled(layer, video.windows[3].special !== 0 && !!video.target1[layer], blend);
          if (video.windows[3].special && video.alphaEnabled) {
            mask |= video.target1[layer];
          }
          stencil |= video.OBJWIN_MASK;
        } else {
          return;
        }
      } else if (video.windows[2].enabled[layer]) {
        video.setBlendEnabled(layer, video.windows[2].special !== 0 && !!video.target1[layer], blend);
        if (video.windows[2].special && video.alphaEnabled) {
          mask |= video.target1[layer];
        }
      } else {
        return;
      }
    }

    if ((mask & video.TARGET1_MASK) && (oldStencil & video.TARGET2_MASK)) {
      video.setBlendEnabled(layer, true, 1);
    }

    let pixel: number;
    if (raw) {
      pixel = row;
    } else {
      pixel = video.palette.accessColor(layer, index!);
    }

    if (mask & video.TARGET1_MASK) {
      video.setBlendEnabled(layer, !!blend, blend);
    }
    let highPriority = (mask & video.PRIORITY_MASK) < (oldStencil & video.PRIORITY_MASK);
    if ((mask & video.PRIORITY_MASK) === (oldStencil & video.PRIORITY_MASK)) {
      highPriority = !!(mask & video.BACKGROUND_MASK);
    }

    if (!(oldStencil & video.WRITTEN_MASK)) {
      stencil |= mask;
    } else if (highPriority) {
      if (mask & video.TARGET1_MASK && oldStencil & video.TARGET2_MASK) {
        pixel = video.palette.mix(video.blendA, pixel, video.blendB, backing.color[offset]);
      }
      stencil |= mask & ~video.TARGET1_MASK;
    } else if ((mask & video.PRIORITY_MASK) > (oldStencil & video.PRIORITY_MASK)) {
      stencil = oldStencil & ~(video.TARGET1_MASK | video.TARGET2_MASK);
      if (mask & video.TARGET2_MASK && oldStencil & video.TARGET1_MASK) {
        pixel = video.palette.mix(video.blendB, pixel, video.blendA, backing.color[offset]);
      } else {
        return;
      }
    } else {
      return;
    }

    if (mask & video.OBJWIN_MASK) {
      backing.stencil[offset] |= video.OBJWIN_MASK;
      return;
    }
    backing.color[offset] = pixel;
    backing.stencil[offset] = stencil;
  }

  constructor() {
    const video = this;
    this.drawBackdrop = {
      bg: true,
      priority: -1,
      index: video.LAYER_BACKDROP,
      enabled: true,
      drawScanline(backing: any, _layer: any, start: number, end: number) {
        for (let x = start; x < end; ++x) {
          if (!(backing.stencil[x] & video.WRITTEN_MASK)) {
            backing.color[x] = video.palette.accessColor(this.index, 0);
            backing.stencil[x] = video.WRITTEN_MASK;
          } else if (backing.stencil[x] & video.TARGET1_MASK) {
            backing.color[x] = video.palette.mix(video.blendB, video.palette.accessColor(this.index, 0), video.blendA, backing.color[x]);
            backing.stencil[x] = video.WRITTEN_MASK;
          }
        }
      },
    };

    this.windows = [];
    for (let i = 0; i < 4; ++i) {
      this.windows.push({
        enabled: [false, false, false, false, false, true],
        special: 0,
      });
    }

    this.bg = [];
    for (let i = 0; i < 4; ++i) {
      this.bg.push({
        bg: true,
        index: i,
        enabled: false,
        video: this,
        vram: this.vram,
        priority: 0,
        charBase: 0,
        mosaic: false,
        multipalette: false,
        screenBase: 0,
        overflow: 0,
        size: 0,
        x: 0,
        y: 0,
        refx: 0,
        refy: 0,
        dx: 1,
        dmx: 0,
        dy: 0,
        dmy: 1,
        sx: 0,
        sy: 0,
        pushPixel: GameBoyAdvanceSoftwareRenderer.pushPixel,
        drawScanline: this.drawScanlineBGMode0.bind(this) as any,
      });
    }

    this.bgModes = [
      this.drawScanlineBGMode0.bind(this),
      this.drawScanlineBGMode2.bind(this),
      this.drawScanlineBGMode2.bind(this),
      this.drawScanlineBGMode3.bind(this),
      this.drawScanlineBGMode4.bind(this),
      this.drawScanlineBGMode5.bind(this),
    ];

    this.drawLayers = [];
    this.target1 = new Array(5);
    this.target2 = new Array(5);
    this.blendMode = 0;
    this.blendA = 0;
    this.blendB = 0;
    this.blendY = 0;
  }

  clear(mmu: any): void {
    this.palette = new GameBoyAdvancePalette();
    this.vram = new GameBoyAdvanceVRAM(mmu.SIZE_VRAM);
    this.oam = new GameBoyAdvanceOAM(mmu.SIZE_OAM);
    this.oam.video = this;
    this.objLayers = [
      new GameBoyAdvanceOBJLayer(this, 0),
      new GameBoyAdvanceOBJLayer(this, 1),
      new GameBoyAdvanceOBJLayer(this, 2),
      new GameBoyAdvanceOBJLayer(this, 3),
    ];
    this.objwinLayer = new GameBoyAdvanceOBJLayer(this, 4);
    this.objwinLayer.objwin = this.OBJWIN_MASK;

    this.backgroundMode = 0;
    this.displayFrameSelect = 0;
    this.hblankIntervalFree = 0;
    this.objCharacterMapping = 0;
    this.forcedBlank = 1;
    this.win0 = 0;
    this.win1 = 0;
    this.objwin = 0;

    this.vcount = -1;

    this.win0Left = 0;
    this.win0Right = 240;
    this.win1Left = 0;
    this.win1Right = 240;
    this.win0Top = 0;
    this.win0Bottom = 160;
    this.win1Top = 0;
    this.win1Bottom = 160;

    this.windows = [];
    for (let i = 0; i < 4; ++i) {
      this.windows.push({
        enabled: [false, false, false, false, false, true],
        special: 0,
      });
    }

    this.target1 = new Array(5);
    this.target2 = new Array(5);
    this.blendMode = 0;

    this.blendA = 0;
    this.blendB = 0;
    this.blendY = 0;

    this.bgMosaicX = 1;
    this.bgMosaicY = 1;
    this.objMosaicX = 1;
    this.objMosaicY = 1;

    this.lastHblank = 0;
    this.nextHblank = 1006;
    this.nextEvent = this.nextHblank;
    this.nextHblankIRQ = 0;
    this.nextVblankIRQ = 0;
    this.nextVcounterIRQ = 0;

    this.bg = [];
    for (let i = 0; i < 4; ++i) {
      this.bg.push({
        bg: true,
        index: i,
        enabled: false,
        video: this,
        vram: this.vram,
        priority: 0,
        charBase: 0,
        mosaic: false,
        multipalette: false,
        screenBase: 0,
        overflow: 0,
        size: 0,
        x: 0,
        y: 0,
        refx: 0,
        refy: 0,
        dx: 1,
        dmx: 0,
        dy: 0,
        dmy: 1,
        sx: 0,
        sy: 0,
        pushPixel: GameBoyAdvanceSoftwareRenderer.pushPixel,
        drawScanline: this.drawScanlineBGMode0.bind(this),
      });
    }

    this.bgModes = [
      this.drawScanlineBGMode0.bind(this),
      this.drawScanlineBGMode2.bind(this),
      this.drawScanlineBGMode2.bind(this),
      this.drawScanlineBGMode3.bind(this),
      this.drawScanlineBGMode4.bind(this),
      this.drawScanlineBGMode5.bind(this),
    ];

    this.drawLayers = [
      this.bg[0],
      this.bg[1],
      this.bg[2],
      this.bg[3],
      this.objLayers[0],
      this.objLayers[1],
      this.objLayers[2],
      this.objLayers[3],
      this.objwinLayer,
      this.drawBackdrop,
    ];

    this.objwinActive = false;
    this.alphaEnabled = false;

    this.scanline = {
      color: new Uint16Array(this.HORIZONTAL_PIXELS),
      stencil: new Uint8Array(this.HORIZONTAL_PIXELS),
    };
    this.sharedColor = [0, 0, 0];
    this.sharedMap = {
      tile: 0,
      hflip: false,
      vflip: false,
      palette: 0,
    };
  }

  clearSubsets(mmu: any, regions: number): void {
    if (regions & 0x04) {
      this.palette.overwrite(new Uint16Array(mmu.SIZE_PALETTE >> 1));
    }
    if (regions & 0x08) {
      this.vram.insert(0, new Uint16Array(mmu.SIZE_VRAM >> 1));
    }
    if (regions & 0x10) {
      this.oam.overwrite(new Uint16Array(mmu.SIZE_OAM >> 1));
      this.oam.video = this;
    }
  }

  freeze(_encode?: (v: DataView) => string): object {
    return {};
  }

  defrost(_frost: any, _decode?: (str: string) => ArrayBuffer): void {}

  setBacking(backing: ImageData): void {
    this.pixelData = backing;
    for (let offset = 0; offset < this.HORIZONTAL_PIXELS * this.VERTICAL_PIXELS * 4;) {
      this.pixelData.data[offset++] = 0xFF;
      this.pixelData.data[offset++] = 0xFF;
      this.pixelData.data[offset++] = 0xFF;
      this.pixelData.data[offset++] = 0xFF;
    }
  }

  writeDisplayControl(value: number): void {
    this.backgroundMode = value & 0x0007;
    this.displayFrameSelect = value & 0x0010;
    this.hblankIntervalFree = value & 0x0020;
    this.objCharacterMapping = value & 0x0040;
    this.forcedBlank = value & 0x0080;
    this.bg[0].enabled = !!(value & 0x0100);
    this.bg[1].enabled = !!(value & 0x0200);
    this.bg[2].enabled = !!(value & 0x0400);
    this.bg[3].enabled = !!(value & 0x0800);
    this.objLayers[0].enabled = !!(value & 0x1000);
    this.objLayers[1].enabled = !!(value & 0x1000);
    this.objLayers[2].enabled = !!(value & 0x1000);
    this.objLayers[3].enabled = !!(value & 0x1000);
    this.win0 = value & 0x2000;
    this.win1 = value & 0x4000;
    this.objwin = value & 0x8000;
    this.objwinLayer.enabled = !!(value & 0x1000) && !!(value & 0x8000);

    this.bg[2].multipalette &= ~0x0001;
    this.bg[3].multipalette &= ~0x0001;
    if (this.backgroundMode > 0) {
      this.bg[2].multipalette |= 0x0001;
    }
    if (this.backgroundMode === 2) {
      this.bg[3].multipalette |= 0x0001;
    }

    this.resetLayers();
  }

  writeBackgroundControl(bg: number, value: number): void {
    const bgData = this.bg[bg];
    bgData.priority = value & 0x0003;
    bgData.charBase = (value & 0x000C) << 12;
    bgData.mosaic = !!(value & 0x0040);
    bgData.multipalette &= ~0x0080;
    if (bg < 2 || this.backgroundMode === 0) {
      bgData.multipalette |= value & 0x0080;
    }
    bgData.screenBase = (value & 0x1F00) << 3;
    bgData.overflow = !!(value & 0x2000);
    bgData.size = (value & 0xC000) >> 14;
    this.drawLayers.sort(this.layerComparator);
  }

  writeBackgroundHOffset(bg: number, value: number): void {
    this.bg[bg].x = value & 0x1FF;
  }

  writeBackgroundVOffset(bg: number, value: number): void {
    this.bg[bg].y = value & 0x1FF;
  }

  writeBackgroundRefX(bg: number, value: number): void {
    this.bg[bg].refx = (value << 4) / 0x1000;
    this.bg[bg].sx = this.bg[bg].refx;
  }

  writeBackgroundRefY(bg: number, value: number): void {
    this.bg[bg].refy = (value << 4) / 0x1000;
    this.bg[bg].sy = this.bg[bg].refy;
  }

  writeBackgroundParamA(bg: number, value: number): void {
    this.bg[bg].dx = (value << 16) / 0x1000000;
  }

  writeBackgroundParamB(bg: number, value: number): void {
    this.bg[bg].dmx = (value << 16) / 0x1000000;
  }

  writeBackgroundParamC(bg: number, value: number): void {
    this.bg[bg].dy = (value << 16) / 0x1000000;
  }

  writeBackgroundParamD(bg: number, value: number): void {
    this.bg[bg].dmy = (value << 16) / 0x1000000;
  }

  writeWin0H(value: number): void {
    this.win0Left = (value & 0xFF00) >> 8;
    this.win0Right = Math.min(this.HORIZONTAL_PIXELS, value & 0x00FF);
    if (this.win0Left > this.win0Right) {
      this.win0Right = this.HORIZONTAL_PIXELS;
    }
  }

  writeWin1H(value: number): void {
    this.win1Left = (value & 0xFF00) >> 8;
    this.win1Right = Math.min(this.HORIZONTAL_PIXELS, value & 0x00FF);
    if (this.win1Left > this.win1Right) {
      this.win1Right = this.HORIZONTAL_PIXELS;
    }
  }

  writeWin0V(value: number): void {
    this.win0Top = (value & 0xFF00) >> 8;
    this.win0Bottom = Math.min(this.VERTICAL_PIXELS, value & 0x00FF);
    if (this.win0Top > this.win0Bottom) {
      this.win0Bottom = this.VERTICAL_PIXELS;
    }
  }

  writeWin1V(value: number): void {
    this.win1Top = (value & 0xFF00) >> 8;
    this.win1Bottom = Math.min(this.VERTICAL_PIXELS, value & 0x00FF);
    if (this.win1Top > this.win1Bottom) {
      this.win1Bottom = this.VERTICAL_PIXELS;
    }
  }

  writeWindow(index: number, value: number): void {
    const window = this.windows[index];
    window.enabled[0] = !!(value & 0x01);
    window.enabled[1] = !!(value & 0x02);
    window.enabled[2] = !!(value & 0x04);
    window.enabled[3] = !!(value & 0x08);
    window.enabled[4] = !!(value & 0x10);
    window.special = value & 0x20;
  }

  writeWinIn(value: number): void {
    this.writeWindow(0, value);
    this.writeWindow(1, value >> 8);
  }

  writeWinOut(value: number): void {
    this.writeWindow(2, value);
    this.writeWindow(3, value >> 8);
  }

  writeBlendControl(value: number): void {
    this.target1[0] = +!!(value & 0x0001) * this.TARGET1_MASK;
    this.target1[1] = +!!(value & 0x0002) * this.TARGET1_MASK;
    this.target1[2] = +!!(value & 0x0004) * this.TARGET1_MASK;
    this.target1[3] = +!!(value & 0x0008) * this.TARGET1_MASK;
    this.target1[4] = +!!(value & 0x0010) * this.TARGET1_MASK;
    this.target1[5] = +!!(value & 0x0020) * this.TARGET1_MASK;
    this.target2[0] = +!!(value & 0x0100) * this.TARGET2_MASK;
    this.target2[1] = +!!(value & 0x0200) * this.TARGET2_MASK;
    this.target2[2] = +!!(value & 0x0400) * this.TARGET2_MASK;
    this.target2[3] = +!!(value & 0x0800) * this.TARGET2_MASK;
    this.target2[4] = +!!(value & 0x1000) * this.TARGET2_MASK;
    this.target2[5] = +!!(value & 0x2000) * this.TARGET2_MASK;
    this.blendMode = (value & 0x00C0) >> 6;

    switch (this.blendMode) {
      case 1:
      case 0:
        this.palette.makeNormalPalettes();
        break;
      case 2:
        this.palette.makeBrightPalettes(value & 0x3F);
        break;
      case 3:
        this.palette.makeDarkPalettes(value & 0x3F);
        break;
    }
  }

  setBlendEnabled(layer: number, enabled: boolean, override: number): void {
    this.alphaEnabled = enabled && override === 1;
    if (enabled) {
      switch (override) {
        case 1:
        case 0:
          this.palette.makeNormalPalette(layer);
          break;
        case 2:
        case 3:
          this.palette.makeSpecialPalette(layer);
          break;
      }
    } else {
      this.palette.makeNormalPalette(layer);
    }
  }

  writeBlendAlpha(value: number): void {
    this.blendA = (value & 0x001F) / 16;
    if (this.blendA > 1) {
      this.blendA = 1;
    }
    this.blendB = ((value & 0x1F00) >> 8) / 16;
    if (this.blendB > 1) {
      this.blendB = 1;
    }
  }

  writeBlendY(value: number): void {
    this.blendY = value;
    this.palette.setBlendY(value >= 16 ? 1 : (value / 16));
  }

  writeMosaic(value: number): void {
    this.bgMosaicX = (value & 0xF) + 1;
    this.bgMosaicY = ((value >> 4) & 0xF) + 1;
    this.objMosaicX = ((value >> 8) & 0xF) + 1;
    this.objMosaicY = ((value >> 12) & 0xF) + 1;
  }

  resetLayers(): void {
    if (this.backgroundMode > 1) {
      this.bg[0].enabled = false;
      this.bg[1].enabled = false;
    }
    if (this.bg[2].enabled) {
      this.bg[2].drawScanline = this.bgModes[this.backgroundMode];
    }
    if ((this.backgroundMode === 0 || this.backgroundMode === 2)) {
      if (this.bg[3].enabled) {
        this.bg[3].drawScanline = this.bgModes[this.backgroundMode];
      }
    } else {
      this.bg[3].enabled = false;
    }
    this.drawLayers.sort(this.layerComparator);
  }

  layerComparator(a: any, b: any): number {
    const diff = b.priority - a.priority;
    if (!diff) {
      if (a.bg && !b.bg) {
        return -1;
      } else if (!a.bg && b.bg) {
        return 1;
      }
      return b.index - a.index;
    }
    return diff;
  }

  accessMapMode0(base: number, size: number, x: number, yBase: number, out: { tile: number; hflip: boolean; vflip: boolean; palette: number }): void {
    let offset = base + ((x >> 2) & 0x3E) + yBase;
    if (size & 1) {
      offset += (x & 0x100) << 3;
    }
    const mem = this.vram.loadU16(offset);
    out.tile = mem & 0x03FF;
    out.hflip = !!(mem & 0x0400);
    out.vflip = !!(mem & 0x0800);
    out.palette = (mem & 0xF000) >> 8;
  }

  accessMapMode1(base: number, _size: number, x: number, yBase: number, out: { tile: number }): void {
    const offset = base + (x >> 3) + yBase;
    out.tile = this.vram.loadU8(offset);
  }

  accessTile(base: number, tile: number, y: number): number {
    let offset = base + (tile << 5);
    offset |= y << 2;
    return this.vram.load32(offset);
  }

  identity(x: number): number {
    return x;
  }

  drawScanlineBlank(backing: { color: Uint16Array; stencil: Uint8Array }): void {
    for (let x = 0; x < this.HORIZONTAL_PIXELS; ++x) {
      backing.color[x] = 0xFFFF;
      backing.stencil[x] = 0;
    }
  }

  prepareScanline(backing: { color: Uint16Array; stencil: Uint8Array }): void {
    for (let x = 0; x < this.HORIZONTAL_PIXELS; ++x) {
      backing.stencil[x] = this.target2[this.LAYER_BACKDROP];
    }
  }

  drawScanlineBGMode0(backing: any, bg: any, start: number, end: number): void {
    const video = bg.video as GameBoyAdvanceSoftwareRenderer;
    const y = video.vcount;
    let offset = start;
    const xOff = bg.x;
    const yOff = bg.y;
    let localY = y + yOff;
    if (bg.mosaic) {
      localY -= y % video.bgMosaicY;
    }
    const localYLo = localY & 0x7;
    const screenBase = bg.screenBase;
    const charBase = bg.charBase;
    const size: number = bg.size;
    const index = bg.index;
    const map = video.sharedMap;
    const paletteShift: 0 | 1 = bg.multipalette ? 1 : 0;
    let mask = video.target2[index] | (bg.priority << 1) | video.BACKGROUND_MASK;
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[index];
    }

    let yBase = (localY << 3) & 0x7C0;
    if (size === 2) {
      yBase += (localY << 3) & 0x800;
    } else if (size === 3) {
      yBase += (localY << 4) & 0x1000;
    }

    const xMask = size & 1 ? 0x1FF : 0xFF;

    video.accessMapMode0(screenBase, size, (start + xOff) & xMask, yBase, map);
    let tileRow = video.accessTile(charBase, map.tile << paletteShift, (!map.vflip ? localYLo : 7 - localYLo) << paletteShift);
    for (let x = start; x < end; ++x) {
      let localX = (x + xOff) & xMask;
      const mosaicX = bg.mosaic ? offset % video.bgMosaicX : 0;
      localX -= mosaicX;
      let localXLo = localX & 0x7;
      if (!paletteShift) {
        if (!localXLo || (bg.mosaic && !mosaicX)) {
          video.accessMapMode0(screenBase, size, localX, yBase, map);
          tileRow = video.accessTile(charBase, map.tile, !map.vflip ? localYLo : 7 - localYLo);
          if (!tileRow && !localXLo) {
            x += 7;
            offset += 8;
            continue;
          }
        }
      } else {
        if (!localXLo || (bg.mosaic && !mosaicX)) {
          video.accessMapMode0(screenBase, size, localX, yBase, map);
        }
        if (!(localXLo & 0x3) || (bg.mosaic && !mosaicX)) {
          tileRow = video.accessTile(charBase + (!!(localX & 0x4) === !map.hflip ? 4 : 0), map.tile << 1, (!map.vflip ? localYLo : 7 - localYLo) << 1);
          if (!tileRow && !(localXLo & 0x3)) {
            x += 3;
            offset += 4;
            continue;
          }
        }
      }
      if (map.hflip) {
        localXLo = 7 - localXLo;
      }
      bg.pushPixel(index, map, video, tileRow, localXLo, offset, backing, mask, false);
      offset++;
    }
  }

  drawScanlineBGMode2(backing: any, bg: any, start: number, end: number): void {
    const video = bg.video as GameBoyAdvanceSoftwareRenderer;
    const y = video.vcount;
    let offset = start;
    const screenBase = bg.screenBase;
    const charBase = bg.charBase;
    const size: number = bg.size;
    const sizeAdjusted = 128 << size;
    const index = bg.index;
    const map = video.sharedMap;
    let mask = video.target2[index] | (bg.priority << 1) | video.BACKGROUND_MASK;
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[index];
    }

    for (let x = start; x < end; ++x) {
      let localX = bg.dx * x + bg.sx;
      let localY = bg.dy * x + bg.sy;
      if (bg.mosaic) {
        localX -= (x % video.bgMosaicX) * bg.dx + (y % video.bgMosaicY) * bg.dmx;
        localY -= (x % video.bgMosaicX) * bg.dy + (y % video.bgMosaicY) * bg.dmy;
      }
      if (bg.overflow) {
        localX &= sizeAdjusted - 1;
        if (localX < 0) {
          localX += sizeAdjusted;
        }
        localY &= sizeAdjusted - 1;
        if (localY < 0) {
          localY += sizeAdjusted;
        }
      } else if (localX < 0 || localY < 0 || localX >= sizeAdjusted || localY >= sizeAdjusted) {
        offset++;
        continue;
      }
      const yBase = ((localY << 1) & 0x7F0) << size;
      video.accessMapMode1(screenBase, size, localX, yBase, map);
      const color = video.vram.loadU8(charBase + (map.tile << 6) + ((localY & 0x7) << 3) + (localX & 0x7));
      bg.pushPixel(index, map, video, color, 0, offset, backing, mask, false);
      offset++;
    }
  }

  drawScanlineBGMode3(backing: any, bg: any, start: number, end: number): void {
    const video = bg.video as GameBoyAdvanceSoftwareRenderer;
    const y = video.vcount;
    let offset = start;
    const index = bg.index;
    const map = video.sharedMap;
    let mask = video.target2[index] | (bg.priority << 1) | video.BACKGROUND_MASK;
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[index];
    }

    for (let x = start; x < end; ++x) {
      let localX = bg.dx * x + bg.sx;
      let localY = bg.dy * x + bg.sy;
      if (bg.mosaic) {
        localX -= (x % video.bgMosaicX) * bg.dx + (y % video.bgMosaicY) * bg.dmx;
        localY -= (x % video.bgMosaicX) * bg.dy + (y % video.bgMosaicY) * bg.dmy;
      }
      if (localX < 0 || localY < 0 || localX >= video.HORIZONTAL_PIXELS || localY >= video.VERTICAL_PIXELS) {
        offset++;
        continue;
      }
      const color = video.vram.loadU16(((localY * video.HORIZONTAL_PIXELS) + localX) << 1);
      bg.pushPixel(index, map, video, color, 0, offset, backing, mask, true);
      offset++;
    }
  }

  drawScanlineBGMode4(backing: any, bg: any, start: number, end: number): void {
    const video = bg.video as GameBoyAdvanceSoftwareRenderer;
    const y = video.vcount;
    let offset = start;
    let charBase = 0;
    if (video.displayFrameSelect) {
      charBase += 0xA000;
    }
    const index = bg.index;
    const map = video.sharedMap;
    let mask = video.target2[index] | (bg.priority << 1) | video.BACKGROUND_MASK;
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[index];
    }

    for (let x = start; x < end; ++x) {
      let localX = bg.dx * x + bg.sx;
      let localY = 0 | bg.dy * x + bg.sy;
      if (bg.mosaic) {
        localX -= (x % video.bgMosaicX) * bg.dx + (y % video.bgMosaicY) * bg.dmx;
        localY -= (x % video.bgMosaicX) * bg.dy + (y % video.bgMosaicY) * bg.dmy;
      }
      if (localX < 0 || localY < 0 || localX >= video.HORIZONTAL_PIXELS || localY >= video.VERTICAL_PIXELS) {
        offset++;
        continue;
      }
      const color = video.vram.loadU8(charBase + (localY * video.HORIZONTAL_PIXELS) + localX);
      bg.pushPixel(index, map, video, color, 0, offset, backing, mask, false);
      offset++;
    }
  }

  drawScanlineBGMode5(backing: any, bg: any, start: number, end: number): void {
    const video = bg.video as GameBoyAdvanceSoftwareRenderer;
    const y = video.vcount;
    let offset = start;
    let charBase = 0;
    if (video.displayFrameSelect) {
      charBase += 0xA000;
    }
    const index = bg.index;
    const map = video.sharedMap;
    let mask = video.target2[index] | (bg.priority << 1) | video.BACKGROUND_MASK;
    if (video.blendMode === 1 && video.alphaEnabled) {
      mask |= video.target1[index];
    }

    for (let x = start; x < end; ++x) {
      let localX = bg.dx * x + bg.sx;
      let localY = bg.dy * x + bg.sy;
      if (bg.mosaic) {
        localX -= (x % video.bgMosaicX) * bg.dx + (y % video.bgMosaicY) * bg.dmx;
        localY -= (x % video.bgMosaicX) * bg.dy + (y % video.bgMosaicY) * bg.dmy;
      }
      if (localX < 0 || localY < 0 || localX >= 160 || localY >= 128) {
        offset++;
        continue;
      }
      const color = video.vram.loadU16(charBase + ((localY * 160) + localX) << 1);
      bg.pushPixel(index, map, video, color, 0, offset, backing, mask, true);
      offset++;
    }
  }

  drawScanline(y: number): void {
    const backing = this.scanline;
    if (this.forcedBlank) {
      this.drawScanlineBlank(backing);
      return;
    }
    this.prepareScanline(backing);
    this.vcount = y;

    for (let i = 0; i < this.drawLayers.length; ++i) {
      const layer = this.drawLayers[i];
      if (!layer.enabled) {
        continue;
      }
      this.objwinActive = false;
      if (!(this.win0 || this.win1 || this.objwin)) {
        this.setBlendEnabled(layer.index, !!this.target1[layer.index], this.blendMode);
        layer.drawScanline(backing, layer, 0, this.HORIZONTAL_PIXELS);
      } else {
        let firstStart = 0;
        let firstEnd = this.HORIZONTAL_PIXELS;
        let lastStart = 0;
        let lastEnd = this.HORIZONTAL_PIXELS;
        if (this.win0 && y >= this.win0Top && y < this.win0Bottom) {
          if (this.windows[0].enabled[layer.index]) {
            this.setBlendEnabled(layer.index, !!(this.windows[0].special && this.target1[layer.index]), this.blendMode);
            layer.drawScanline(backing, layer, this.win0Left, this.win0Right);
          }
          firstStart = Math.max(firstStart, this.win0Left);
          firstEnd = Math.min(firstEnd, this.win0Left);
          lastStart = Math.max(lastStart, this.win0Right);
          lastEnd = Math.min(lastEnd, this.win0Right);
        }
        if (this.win1 && y >= this.win1Top && y < this.win1Bottom) {
          if (this.windows[1].enabled[layer.index]) {
            this.setBlendEnabled(layer.index, !!(this.windows[1].special && this.target1[layer.index]), this.blendMode);
            if (!this.windows[0].enabled[layer.index] && (this.win1Left < firstStart || this.win1Right < lastStart)) {
              layer.drawScanline(backing, layer, this.win1Left, firstStart);
              layer.drawScanline(backing, layer, lastEnd, this.win1Right);
            } else {
              layer.drawScanline(backing, layer, this.win1Left, this.win1Right);
            }
          }
          firstStart = Math.max(firstStart, this.win1Left);
          firstEnd = Math.min(firstEnd, this.win1Left);
          lastStart = Math.max(lastStart, this.win1Right);
          lastEnd = Math.min(lastEnd, this.win1Right);
        }
        if (this.windows[2].enabled[layer.index] || (this.objwin && this.windows[3].enabled[layer.index])) {
          this.objwinActive = !!this.objwin;
          this.setBlendEnabled(layer.index, !!(this.windows[2].special && this.target1[layer.index]), this.blendMode);
          if (firstEnd > lastStart) {
            layer.drawScanline(backing, layer, 0, this.HORIZONTAL_PIXELS);
          } else {
            if (firstEnd) {
              layer.drawScanline(backing, layer, 0, firstEnd);
            }
            if (lastStart < this.HORIZONTAL_PIXELS) {
              layer.drawScanline(backing, layer, lastStart, this.HORIZONTAL_PIXELS);
            }
            if (lastEnd < firstStart) {
              layer.drawScanline(backing, layer, lastEnd, firstStart);
            }
          }
        }
        this.setBlendEnabled(this.LAYER_BACKDROP, !!(this.target1[this.LAYER_BACKDROP] && this.windows[2].special), this.blendMode);
      }
      if (layer.bg) {
        layer.sx += layer.dmx;
        layer.sy += layer.dmy;
      }
    }

    this.finishScanline(backing);
  }

  finishScanline(backing: { color: Uint16Array; stencil: Uint8Array }): void {
    const bd = this.palette.accessColor(this.LAYER_BACKDROP, 0);
    let xx = this.vcount * this.HORIZONTAL_PIXELS * 4;
    const isTarget2 = this.target2[this.LAYER_BACKDROP];
    for (let x = 0; x < this.HORIZONTAL_PIXELS; ++x) {
      if (backing.stencil[x] & this.WRITTEN_MASK) {
        let color = backing.color[x];
        if (isTarget2 && backing.stencil[x] & this.TARGET1_MASK) {
          color = this.palette.mix(this.blendA, color, this.blendB, bd);
        }
        this.palette.convert16To32(color, this.sharedColor);
      } else {
        this.palette.convert16To32(bd, this.sharedColor);
      }
      this.pixelData.data[xx++] = this.sharedColor[0];
      this.pixelData.data[xx++] = this.sharedColor[1];
      this.pixelData.data[xx++] = this.sharedColor[2];
      xx++;
    }
  }

  startDraw(): void {
    // Nothing to do
  }

  finishDraw(caller: { finishDraw(pixelData: ImageData): void }): void {
    this.bg[2].sx = this.bg[2].refx;
    this.bg[2].sy = this.bg[2].refy;
    this.bg[3].sx = this.bg[3].refx;
    this.bg[3].sy = this.bg[3].refy;
    caller.finishDraw(this.pixelData);
  }
}
