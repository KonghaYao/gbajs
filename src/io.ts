import { Serializer } from './util.js';

// ============================================================================
// Forward reference interfaces for modules set externally by GameBoyAdvance
// ============================================================================

interface IOCPU {
  cycles: number;
  mmu: {
    SIZE_IO: number;
    adjustTimings(value: number): void;
    badMemory: { loadU16(offset: number): number };
  };
  irq: {
    timerRead(timer: number): number;
    timerSetReload(timer: number, value: number): void;
    timerWriteControl(timer: number, v: number): void;
    dmaSetSourceAddress(dma: number, value: number): void;
    dmaSetDestAddress(dma: number, value: number): void;
    dmaSetWordCount(dma: number, v: number): void;
    dmaWriteControl(dma: number, v: number): void;
    setInterruptsEnabled(v: number): void;
    dismissIRQs(v: number): void;
    masterEnable(v: number): void;
    halt(): void;
  };
}

interface IOAudio {
  writeSquareChannelSweep(ch: number, v: number): void;
  writeSquareChannelDLE(ch: number, v: number): void;
  writeSquareChannelFC(ch: number, v: number): void;
  writeChannel3Lo(v: number): void;
  writeChannel3Hi(v: number): void;
  writeChannel3X(v: number): void;
  writeChannel4LE(v: number): void;
  writeChannel4FC(v: number): void;
  writeSoundControlLo(v: number): void;
  writeSoundControlHi(v: number): void;
  writeEnable(v: number): void;
  writeWaveData(offset: number, data: number, width: number): void;
  appendToFifoA(v: number): void;
  appendToFifoB(v: number): void;
}

interface IOVideo {
  DISPSTAT_MASK: number;
  renderPath: {
    writeDisplayControl(v: number): void;
    writeBackgroundControl(bg: number, v: number): void;
    writeBackgroundHOffset(bg: number, v: number): void;
    writeBackgroundVOffset(bg: number, v: number): void;
    writeBackgroundRefX(bg: number, v: number): void;
    writeBackgroundRefY(bg: number, v: number): void;
    writeBackgroundParamA(bg: number, v: number): void;
    writeBackgroundParamB(bg: number, v: number): void;
    writeBackgroundParamC(bg: number, v: number): void;
    writeBackgroundParamD(bg: number, v: number): void;
    writeWin0H(v: number): void;
    writeWin0V(v: number): void;
    writeWin1H(v: number): void;
    writeWin1V(v: number): void;
    writeWinIn(v: number): void;
    writeWinOut(v: number): void;
    writeBlendControl(v: number): void;
    writeBlendAlpha(v: number): void;
    writeBlendY(v: number): void;
    writeMosaic(v: number): void;
  };
  writeDisplayStat(v: number): void;
  readDisplayStat(): number;
  vcount: number;
}

interface IOKeypad {
  pollGamepads(): void;
  currentDown: number;
}

interface IOSIO {
  setMode(mode: number): void;
  writeRCNT(value: number): void;
  writeSIOCNT(value: number): void;
  readSIOCNT(): number;
  read(slot: number): number;
}

interface IOCore {
  STUB(msg: string): void;
  WARN(msg: string): void;
  mmu: { badMemory: { loadU16(offset: number): number } };
  irq: { halt(): void };
}

// ============================================================================
// GameBoyAdvanceIO
// ============================================================================

export class GameBoyAdvanceIO {
  // Video
  readonly DISPCNT = 0x000;
  readonly GREENSWP = 0x002;
  readonly DISPSTAT = 0x004;
  readonly VCOUNT = 0x006;
  readonly BG0CNT = 0x008;
  readonly BG1CNT = 0x00A;
  readonly BG2CNT = 0x00C;
  readonly BG3CNT = 0x00E;
  readonly BG0HOFS = 0x010;
  readonly BG0VOFS = 0x012;
  readonly BG1HOFS = 0x014;
  readonly BG1VOFS = 0x016;
  readonly BG2HOFS = 0x018;
  readonly BG2VOFS = 0x01A;
  readonly BG3HOFS = 0x01C;
  readonly BG3VOFS = 0x01E;
  readonly BG2PA = 0x020;
  readonly BG2PB = 0x022;
  readonly BG2PC = 0x024;
  readonly BG2PD = 0x026;
  readonly BG2X_LO = 0x028;
  readonly BG2X_HI = 0x02A;
  readonly BG2Y_LO = 0x02C;
  readonly BG2Y_HI = 0x02E;
  readonly BG3PA = 0x030;
  readonly BG3PB = 0x032;
  readonly BG3PC = 0x034;
  readonly BG3PD = 0x036;
  readonly BG3X_LO = 0x038;
  readonly BG3X_HI = 0x03A;
  readonly BG3Y_LO = 0x03C;
  readonly BG3Y_HI = 0x03E;
  readonly WIN0H = 0x040;
  readonly WIN1H = 0x042;
  readonly WIN0V = 0x044;
  readonly WIN1V = 0x046;
  readonly WININ = 0x048;
  readonly WINOUT = 0x04A;
  readonly MOSAIC = 0x04C;
  readonly BLDCNT = 0x050;
  readonly BLDALPHA = 0x052;
  readonly BLDY = 0x054;

  // Sound
  readonly SOUND1CNT_LO = 0x060;
  readonly SOUND1CNT_HI = 0x062;
  readonly SOUND1CNT_X = 0x064;
  readonly SOUND2CNT_LO = 0x068;
  readonly SOUND2CNT_HI = 0x06C;
  readonly SOUND3CNT_LO = 0x070;
  readonly SOUND3CNT_HI = 0x072;
  readonly SOUND3CNT_X = 0x074;
  readonly SOUND4CNT_LO = 0x078;
  readonly SOUND4CNT_HI = 0x07C;
  readonly SOUNDCNT_LO = 0x080;
  readonly SOUNDCNT_HI = 0x082;
  readonly SOUNDCNT_X = 0x084;
  readonly SOUNDBIAS = 0x088;
  readonly WAVE_RAM0_LO = 0x090;
  readonly WAVE_RAM0_HI = 0x092;
  readonly WAVE_RAM1_LO = 0x094;
  readonly WAVE_RAM1_HI = 0x096;
  readonly WAVE_RAM2_LO = 0x098;
  readonly WAVE_RAM2_HI = 0x09A;
  readonly WAVE_RAM3_LO = 0x09C;
  readonly WAVE_RAM3_HI = 0x09E;
  readonly FIFO_A_LO = 0x0A0;
  readonly FIFO_A_HI = 0x0A2;
  readonly FIFO_B_LO = 0x0A4;
  readonly FIFO_B_HI = 0x0A6;

  // DMA
  readonly DMA0SAD_LO = 0x0B0;
  readonly DMA0SAD_HI = 0x0B2;
  readonly DMA0DAD_LO = 0x0B4;
  readonly DMA0DAD_HI = 0x0B6;
  readonly DMA0CNT_LO = 0x0B8;
  readonly DMA0CNT_HI = 0x0BA;
  readonly DMA1SAD_LO = 0x0BC;
  readonly DMA1SAD_HI = 0x0BE;
  readonly DMA1DAD_LO = 0x0C0;
  readonly DMA1DAD_HI = 0x0C2;
  readonly DMA1CNT_LO = 0x0C4;
  readonly DMA1CNT_HI = 0x0C6;
  readonly DMA2SAD_LO = 0x0C8;
  readonly DMA2SAD_HI = 0x0CA;
  readonly DMA2DAD_LO = 0x0CC;
  readonly DMA2DAD_HI = 0x0CE;
  readonly DMA2CNT_LO = 0x0D0;
  readonly DMA2CNT_HI = 0x0D2;
  readonly DMA3SAD_LO = 0x0D4;
  readonly DMA3SAD_HI = 0x0D6;
  readonly DMA3DAD_LO = 0x0D8;
  readonly DMA3DAD_HI = 0x0DA;
  readonly DMA3CNT_LO = 0x0DC;
  readonly DMA3CNT_HI = 0x0DE;

  // Timers
  readonly TM0CNT_LO = 0x100;
  readonly TM0CNT_HI = 0x102;
  readonly TM1CNT_LO = 0x104;
  readonly TM1CNT_HI = 0x106;
  readonly TM2CNT_LO = 0x108;
  readonly TM2CNT_HI = 0x10A;
  readonly TM3CNT_LO = 0x10C;
  readonly TM3CNT_HI = 0x10E;

  // SIO (note: some of these are repeated)
  readonly SIODATA32_LO = 0x120;
  readonly SIOMULTI0 = 0x120;
  readonly SIODATA32_HI = 0x122;
  readonly SIOMULTI1 = 0x122;
  readonly SIOMULTI2 = 0x124;
  readonly SIOMULTI3 = 0x126;
  readonly SIOCNT = 0x128;
  readonly SIOMLT_SEND = 0x12A;
  readonly SIODATA8 = 0x12A;
  readonly RCNT = 0x134;
  readonly JOYCNT = 0x140;
  readonly JOY_RECV = 0x150;
  readonly JOY_TRANS = 0x154;
  readonly JOYSTAT = 0x158;

  // Keypad
  readonly KEYINPUT = 0x130;
  readonly KEYCNT = 0x132;

  // Interrupts, etc
  readonly IE = 0x200;
  readonly IF = 0x202;
  readonly WAITCNT = 0x204;
  readonly IME = 0x208;

  readonly POSTFLG = 0x300;
  readonly HALTCNT = 0x301;

  readonly DEFAULT_DISPCNT = 0x0080;
  readonly DEFAULT_SOUNDBIAS = 0x200;
  readonly DEFAULT_BGPA = 1;
  readonly DEFAULT_BGPD = 1;
  readonly DEFAULT_RCNT = 0x8000;

  registers!: Uint16Array;

  // Set externally by GameBoyAdvance
  cpu!: IOCPU;
  audio!: IOAudio;
  video!: IOVideo;
  keypad!: IOKeypad;
  sio!: IOSIO;
  core!: IOCore;

  clear(): void {
    this.registers = new Uint16Array(this.cpu.mmu.SIZE_IO);

    this.registers[this.DISPCNT >> 1] = this.DEFAULT_DISPCNT;
    this.registers[this.SOUNDBIAS >> 1] = this.DEFAULT_SOUNDBIAS;
    this.registers[this.BG2PA >> 1] = this.DEFAULT_BGPA;
    this.registers[this.BG2PD >> 1] = this.DEFAULT_BGPD;
    this.registers[this.BG3PA >> 1] = this.DEFAULT_BGPA;
    this.registers[this.BG3PD >> 1] = this.DEFAULT_BGPD;
    this.registers[this.RCNT >> 1] = this.DEFAULT_RCNT;
  }

  freeze(): { registers: Blob } {
    return {
      registers: new Blob(
        [Serializer.pack(this.registers.buffer.byteLength), this.registers.buffer as ArrayBuffer],
        { type: Serializer.TYPE }
      )
    };
  }

  defrost(frost: { registers: ArrayBuffer }): void {
    this.registers = new Uint16Array(frost.registers);
    // Video registers don't serialize themselves
    for (let i = 0; i <= this.BLDY; i += 2) {
      this.store16(i, this.registers[i >> 1]);
    }
  }

  load8(_offset: number): never {
    throw 'Unimplmeneted unaligned I/O access';
  }

  load16(offset: number): number {
    return (this.loadU16(offset) << 16) >> 16;
  }

  load32(offset: number): number {
    offset &= 0xFFFFFFFC;
    switch (offset) {
    case this.DMA0CNT_LO:
    case this.DMA1CNT_LO:
    case this.DMA2CNT_LO:
    case this.DMA3CNT_LO:
      return this.loadU16(offset | 2) << 16;
    case this.IME:
      return this.loadU16(offset) & 0xFFFF;
    case this.JOY_RECV:
    case this.JOY_TRANS:
      this.core.STUB('Unimplemented JOY register read: 0x' + offset.toString(16));
      return 0;
    }

    return this.loadU16(offset) | (this.loadU16(offset | 2) << 16);
  }

  loadU8(offset: number): number {
    const odd = offset & 0x0001;
    const value = this.loadU16(offset & 0xFFFE);
    return (value >>> (odd << 3)) & 0xFF;
  }

  loadU16(offset: number): number {
    switch (offset) {
    case this.DISPCNT:
    case this.BG0CNT:
    case this.BG1CNT:
    case this.BG2CNT:
    case this.BG3CNT:
    case this.WININ:
    case this.WINOUT:
    case this.SOUND1CNT_LO:
    case this.SOUND3CNT_LO:
    case this.SOUNDCNT_LO:
    case this.SOUNDCNT_HI:
    case this.SOUNDBIAS:
    case this.BLDCNT:
    case this.BLDALPHA:

    case this.TM0CNT_HI:
    case this.TM1CNT_HI:
    case this.TM2CNT_HI:
    case this.TM3CNT_HI:
    case this.DMA0CNT_HI:
    case this.DMA1CNT_HI:
    case this.DMA2CNT_HI:
    case this.DMA3CNT_HI:
    case this.RCNT:
    case this.WAITCNT:
    case this.IE:
    case this.IF:
    case this.IME:
    case this.POSTFLG:
      // Handled transparently by the written registers
      break;

    // Video
    case this.DISPSTAT:
      return this.registers[offset >> 1] | this.video.readDisplayStat();
    case this.VCOUNT:
      return this.video.vcount;

    // Sound
    case this.SOUND1CNT_HI:
    case this.SOUND2CNT_LO:
      return this.registers[offset >> 1] & 0xFFC0;
    case this.SOUND1CNT_X:
    case this.SOUND2CNT_HI:
    case this.SOUND3CNT_X:
      return this.registers[offset >> 1] & 0x4000;
    case this.SOUND3CNT_HI:
      return this.registers[offset >> 1] & 0xE000;
    case this.SOUND4CNT_LO:
      return this.registers[offset >> 1] & 0xFF00;
    case this.SOUND4CNT_HI:
      return this.registers[offset >> 1] & 0x40FF;
    case this.SOUNDCNT_X:
      this.core.STUB('Unimplemented sound register read: SOUNDCNT_X');
      return this.registers[offset >> 1] | 0x0000;

    // Timers
    case this.TM0CNT_LO:
      return this.cpu.irq.timerRead(0);
    case this.TM1CNT_LO:
      return this.cpu.irq.timerRead(1);
    case this.TM2CNT_LO:
      return this.cpu.irq.timerRead(2);
    case this.TM3CNT_LO:
      return this.cpu.irq.timerRead(3);

    // SIO
    case this.SIOCNT:
      return this.sio.readSIOCNT();

    case this.KEYINPUT:
      this.keypad.pollGamepads();
      return this.keypad.currentDown;
    case this.KEYCNT:
      this.core.STUB('Unimplemented I/O register read: KEYCNT');
      return 0;

    case this.BG0HOFS:
    case this.BG0VOFS:
    case this.BG1HOFS:
    case this.BG1VOFS:
    case this.BG2HOFS:
    case this.BG2VOFS:
    case this.BG3HOFS:
    case this.BG3VOFS:
    case this.BG2PA:
    case this.BG2PB:
    case this.BG2PC:
    case this.BG2PD:
    case this.BG3PA:
    case this.BG3PB:
    case this.BG3PC:
    case this.BG3PD:
    case this.BG2X_LO:
    case this.BG2X_HI:
    case this.BG2Y_LO:
    case this.BG2Y_HI:
    case this.BG3X_LO:
    case this.BG3X_HI:
    case this.BG3Y_LO:
    case this.BG3Y_HI:
    case this.WIN0H:
    case this.WIN1H:
    case this.WIN0V:
    case this.WIN1V:
    case this.BLDY:
    case this.DMA0SAD_LO:
    case this.DMA0SAD_HI:
    case this.DMA0DAD_LO:
    case this.DMA0DAD_HI:
    case this.DMA0CNT_LO:
    case this.DMA1SAD_LO:
    case this.DMA1SAD_HI:
    case this.DMA1DAD_LO:
    case this.DMA1DAD_HI:
    case this.DMA1CNT_LO:
    case this.DMA2SAD_LO:
    case this.DMA2SAD_HI:
    case this.DMA2DAD_LO:
    case this.DMA2DAD_HI:
    case this.DMA2CNT_LO:
    case this.DMA3SAD_LO:
    case this.DMA3SAD_HI:
    case this.DMA3DAD_LO:
    case this.DMA3DAD_HI:
    case this.DMA3CNT_LO:
    case this.FIFO_A_LO:
    case this.FIFO_A_HI:
    case this.FIFO_B_LO:
    case this.FIFO_B_HI:
      this.core.WARN('Read for write-only register: 0x' + offset.toString(16));
      return this.core.mmu.badMemory.loadU16(0);

    case this.MOSAIC:
      this.core.WARN('Read for write-only register: 0x' + offset.toString(16));
      return 0;

    case this.SIOMULTI0:
    case this.SIOMULTI1:
    case this.SIOMULTI2:
    case this.SIOMULTI3:
      return this.sio.read((offset - this.SIOMULTI0) >> 1);

    case this.SIODATA8:
      this.core.STUB('Unimplemented SIO register read: 0x' + offset.toString(16));
      return 0;
    case this.JOYCNT:
    case this.JOYSTAT:
      this.core.STUB('Unimplemented JOY register read: 0x' + offset.toString(16));
      return 0;

    default:
      this.core.WARN('Bad I/O register read: 0x' + offset.toString(16));
      return this.core.mmu.badMemory.loadU16(0);
    }
    return this.registers[offset >> 1];
  }

  store8(offset: number, value: number): void {
    switch (offset) {
    case this.WININ:
      value & 0x3F;
      break;
    case this.WININ | 1:
      value & 0x3F;
      break;
    case this.WINOUT:
      value & 0x3F;
      break;
    case this.WINOUT | 1:
      value & 0x3F;
      break;
    case this.SOUND1CNT_LO:
    case this.SOUND1CNT_LO | 1:
    case this.SOUND1CNT_HI:
    case this.SOUND1CNT_HI | 1:
    case this.SOUND1CNT_X:
    case this.SOUND1CNT_X | 1:
    case this.SOUND2CNT_LO:
    case this.SOUND2CNT_LO | 1:
    case this.SOUND2CNT_HI:
    case this.SOUND2CNT_HI | 1:
    case this.SOUND3CNT_LO:
    case this.SOUND3CNT_LO | 1:
    case this.SOUND3CNT_HI:
    case this.SOUND3CNT_HI | 1:
    case this.SOUND3CNT_X:
    case this.SOUND3CNT_X | 1:
    case this.SOUND4CNT_LO:
    case this.SOUND4CNT_LO | 1:
    case this.SOUND4CNT_HI:
    case this.SOUND4CNT_HI | 1:
    case this.SOUNDCNT_LO:
    case this.SOUNDCNT_LO | 1:
    case this.SOUNDCNT_X:
    case this.IF:
    case this.IME:
      break;
    case this.SOUNDBIAS | 1:
      this.STUB_REG('sound', offset);
      break;
    case this.HALTCNT:
      value &= 0x80;
      if (!value) {
        this.core.irq.halt();
      } else {
        this.core.STUB('Stop');
      }
      return;
    default:
      this.STUB_REG('8-bit I/O', offset);
      break;
    }

    if (offset & 1) {
      value <<= 8;
      value |= (this.registers[offset >> 1] & 0x00FF);
    } else {
      value &= 0x00FF;
      value |= (this.registers[offset >> 1] & 0xFF00);
    }
    this.store16(offset & 0xFFFFFFFE, value);
  }

  store16(offset: number, value: number): void {
    switch (offset) {
    // Video
    case this.DISPCNT:
      this.video.renderPath.writeDisplayControl(value);
      break;
    case this.DISPSTAT:
      value &= this.video.DISPSTAT_MASK;
      this.video.writeDisplayStat(value);
      break;
    case this.BG0CNT:
      this.video.renderPath.writeBackgroundControl(0, value);
      break;
    case this.BG1CNT:
      this.video.renderPath.writeBackgroundControl(1, value);
      break;
    case this.BG2CNT:
      this.video.renderPath.writeBackgroundControl(2, value);
      break;
    case this.BG3CNT:
      this.video.renderPath.writeBackgroundControl(3, value);
      break;
    case this.BG0HOFS:
      this.video.renderPath.writeBackgroundHOffset(0, value);
      break;
    case this.BG0VOFS:
      this.video.renderPath.writeBackgroundVOffset(0, value);
      break;
    case this.BG1HOFS:
      this.video.renderPath.writeBackgroundHOffset(1, value);
      break;
    case this.BG1VOFS:
      this.video.renderPath.writeBackgroundVOffset(1, value);
      break;
    case this.BG2HOFS:
      this.video.renderPath.writeBackgroundHOffset(2, value);
      break;
    case this.BG2VOFS:
      this.video.renderPath.writeBackgroundVOffset(2, value);
      break;
    case this.BG3HOFS:
      this.video.renderPath.writeBackgroundHOffset(3, value);
      break;
    case this.BG3VOFS:
      this.video.renderPath.writeBackgroundVOffset(3, value);
      break;
    case this.BG2X_LO:
      this.video.renderPath.writeBackgroundRefX(2, (this.registers[(offset >> 1) | 1] << 16) | value);
      break;
    case this.BG2X_HI:
      this.video.renderPath.writeBackgroundRefX(2, this.registers[(offset >> 1) ^ 1] | (value << 16));
      break;
    case this.BG2Y_LO:
      this.video.renderPath.writeBackgroundRefY(2, (this.registers[(offset >> 1) | 1] << 16) | value);
      break;
    case this.BG2Y_HI:
      this.video.renderPath.writeBackgroundRefY(2, this.registers[(offset >> 1) ^ 1] | (value << 16));
      break;
    case this.BG2PA:
      this.video.renderPath.writeBackgroundParamA(2, value);
      break;
    case this.BG2PB:
      this.video.renderPath.writeBackgroundParamB(2, value);
      break;
    case this.BG2PC:
      this.video.renderPath.writeBackgroundParamC(2, value);
      break;
    case this.BG2PD:
      this.video.renderPath.writeBackgroundParamD(2, value);
      break;
    case this.BG3X_LO:
      this.video.renderPath.writeBackgroundRefX(3, (this.registers[(offset >> 1) | 1] << 16) | value);
      break;
    case this.BG3X_HI:
      this.video.renderPath.writeBackgroundRefX(3, this.registers[(offset >> 1) ^ 1] | (value << 16));
      break;
    case this.BG3Y_LO:
      this.video.renderPath.writeBackgroundRefY(3, (this.registers[(offset >> 1) | 1] << 16) | value);
      break;
    case this.BG3Y_HI:
      this.video.renderPath.writeBackgroundRefY(3, this.registers[(offset >> 1) ^ 1] | (value << 16));
      break;
    case this.BG3PA:
      this.video.renderPath.writeBackgroundParamA(3, value);
      break;
    case this.BG3PB:
      this.video.renderPath.writeBackgroundParamB(3, value);
      break;
    case this.BG3PC:
      this.video.renderPath.writeBackgroundParamC(3, value);
      break;
    case this.BG3PD:
      this.video.renderPath.writeBackgroundParamD(3, value);
      break;
    case this.WIN0H:
      this.video.renderPath.writeWin0H(value);
      break;
    case this.WIN1H:
      this.video.renderPath.writeWin1H(value);
      break;
    case this.WIN0V:
      this.video.renderPath.writeWin0V(value);
      break;
    case this.WIN1V:
      this.video.renderPath.writeWin1V(value);
      break;
    case this.WININ:
      value &= 0x3F3F;
      this.video.renderPath.writeWinIn(value);
      break;
    case this.WINOUT:
      value &= 0x3F3F;
      this.video.renderPath.writeWinOut(value);
      break;
    case this.BLDCNT:
      value &= 0x7FFF;
      this.video.renderPath.writeBlendControl(value);
      break;
    case this.BLDALPHA:
      value &= 0x1F1F;
      this.video.renderPath.writeBlendAlpha(value);
      break;
    case this.BLDY:
      value &= 0x001F;
      this.video.renderPath.writeBlendY(value);
      break;
    case this.MOSAIC:
      this.video.renderPath.writeMosaic(value);
      break;

    // Sound
    case this.SOUND1CNT_LO:
      value &= 0x007F;
      this.audio.writeSquareChannelSweep(0, value);
      break;
    case this.SOUND1CNT_HI:
      this.audio.writeSquareChannelDLE(0, value);
      break;
    case this.SOUND1CNT_X:
      value &= 0xC7FF;
      this.audio.writeSquareChannelFC(0, value);
      value &= ~0x8000;
      break;
    case this.SOUND2CNT_LO:
      this.audio.writeSquareChannelDLE(1, value);
      break;
    case this.SOUND2CNT_HI:
      value &= 0xC7FF;
      this.audio.writeSquareChannelFC(1, value);
      value &= ~0x8000;
      break;
    case this.SOUND3CNT_LO:
      value &= 0x00E0;
      this.audio.writeChannel3Lo(value);
      break;
    case this.SOUND3CNT_HI:
      value &= 0xE0FF;
      this.audio.writeChannel3Hi(value);
      break;
    case this.SOUND3CNT_X:
      value &= 0xC7FF;
      this.audio.writeChannel3X(value);
      value &= ~0x8000;
      break;
    case this.SOUND4CNT_LO:
      value &= 0xFF3F;
      this.audio.writeChannel4LE(value);
      break;
    case this.SOUND4CNT_HI:
      value &= 0xC0FF;
      this.audio.writeChannel4FC(value);
      value &= ~0x8000;
      break;
    case this.SOUNDCNT_LO:
      value &= 0xFF77;
      this.audio.writeSoundControlLo(value);
      break;
    case this.SOUNDCNT_HI:
      value &= 0xFF0F;
      this.audio.writeSoundControlHi(value);
      break;
    case this.SOUNDCNT_X:
      value &= 0x0080;
      this.audio.writeEnable(value);
      break;
    case this.WAVE_RAM0_LO:
    case this.WAVE_RAM0_HI:
    case this.WAVE_RAM1_LO:
    case this.WAVE_RAM1_HI:
    case this.WAVE_RAM2_LO:
    case this.WAVE_RAM2_HI:
    case this.WAVE_RAM3_LO:
    case this.WAVE_RAM3_HI:
      this.audio.writeWaveData(offset - this.WAVE_RAM0_LO, value, 2);
      break;

    // DMA
    case this.DMA0SAD_LO:
    case this.DMA0DAD_LO:
    case this.DMA1SAD_LO:
    case this.DMA1DAD_LO:
    case this.DMA2SAD_LO:
    case this.DMA2DAD_LO:
    case this.DMA3SAD_LO:
    case this.DMA3DAD_LO:
      this.store32(offset, (this.registers[(offset >> 1) + 1] << 16) | value);
      return;

    case this.DMA0SAD_HI:
    case this.DMA0DAD_HI:
    case this.DMA1SAD_HI:
    case this.DMA1DAD_HI:
    case this.DMA2SAD_HI:
    case this.DMA2DAD_HI:
    case this.DMA3SAD_HI:
    case this.DMA3DAD_HI:
      this.store32(offset - 2, this.registers[(offset >> 1) - 1] | (value << 16));
      return;

    case this.DMA0CNT_LO:
      this.cpu.irq.dmaSetWordCount(0, value);
      break;
    case this.DMA0CNT_HI:
      // The DMA registers need to set the values before writing the control, as writing the
      // control can synchronously trigger a DMA transfer
      this.registers[offset >> 1] = value & 0xFFE0;
      this.cpu.irq.dmaWriteControl(0, value);
      return;
    case this.DMA1CNT_LO:
      this.cpu.irq.dmaSetWordCount(1, value);
      break;
    case this.DMA1CNT_HI:
      this.registers[offset >> 1] = value & 0xFFE0;
      this.cpu.irq.dmaWriteControl(1, value);
      return;
    case this.DMA2CNT_LO:
      this.cpu.irq.dmaSetWordCount(2, value);
      break;
    case this.DMA2CNT_HI:
      this.registers[offset >> 1] = value & 0xFFE0;
      this.cpu.irq.dmaWriteControl(2, value);
      return;
    case this.DMA3CNT_LO:
      this.cpu.irq.dmaSetWordCount(3, value);
      break;
    case this.DMA3CNT_HI:
      this.registers[offset >> 1] = value & 0xFFE0;
      this.cpu.irq.dmaWriteControl(3, value);
      return;

    // Timers
    case this.TM0CNT_LO:
      this.cpu.irq.timerSetReload(0, value);
      return;
    case this.TM1CNT_LO:
      this.cpu.irq.timerSetReload(1, value);
      return;
    case this.TM2CNT_LO:
      this.cpu.irq.timerSetReload(2, value);
      return;
    case this.TM3CNT_LO:
      this.cpu.irq.timerSetReload(3, value);
      return;

    case this.TM0CNT_HI:
      value &= 0x00C7;
      this.cpu.irq.timerWriteControl(0, value);
      break;
    case this.TM1CNT_HI:
      value &= 0x00C7;
      this.cpu.irq.timerWriteControl(1, value);
      break;
    case this.TM2CNT_HI:
      value &= 0x00C7;
      this.cpu.irq.timerWriteControl(2, value);
      break;
    case this.TM3CNT_HI:
      value &= 0x00C7;
      this.cpu.irq.timerWriteControl(3, value);
      break;

    // SIO
    case this.SIOMULTI0:
    case this.SIOMULTI1:
    case this.SIOMULTI2:
    case this.SIOMULTI3:
    case this.SIODATA8:
      this.STUB_REG('SIO', offset);
      break;
    case this.RCNT:
      this.sio.setMode(((value >> 12) & 0xC) | ((this.registers[this.SIOCNT >> 1] >> 12) & 0x3));
      this.sio.writeRCNT(value);
      break;
    case this.SIOCNT:
      this.sio.setMode(((value >> 12) & 0x3) | ((this.registers[this.RCNT >> 1] >> 12) & 0xC));
      this.sio.writeSIOCNT(value);
      return;
    case this.JOYCNT:
    case this.JOYSTAT:
      this.STUB_REG('JOY', offset);
      break;

    // Misc
    case this.IE:
      value &= 0x3FFF;
      this.cpu.irq.setInterruptsEnabled(value);
      break;
    case this.IF:
      this.cpu.irq.dismissIRQs(value);
      return;
    case this.WAITCNT:
      value &= 0xDFFF;
      this.cpu.mmu.adjustTimings(value);
      break;
    case this.IME:
      value &= 0x0001;
      this.cpu.irq.masterEnable(value);
      break;
    default:
      this.STUB_REG('I/O', offset);
    }
    this.registers[offset >> 1] = value;
  }

  store32(offset: number, value: number): void {
    switch (offset) {
    case this.BG2X_LO:
      value &= 0x0FFFFFFF;
      this.video.renderPath.writeBackgroundRefX(2, value);
      break;
    case this.BG2Y_LO:
      value &= 0x0FFFFFFF;
      this.video.renderPath.writeBackgroundRefY(2, value);
      break;
    case this.BG3X_LO:
      value &= 0x0FFFFFFF;
      this.video.renderPath.writeBackgroundRefX(3, value);
      break;
    case this.BG3Y_LO:
      value &= 0x0FFFFFFF;
      this.video.renderPath.writeBackgroundRefY(3, value);
      break;
    case this.DMA0SAD_LO:
      this.cpu.irq.dmaSetSourceAddress(0, value);
      break;
    case this.DMA0DAD_LO:
      this.cpu.irq.dmaSetDestAddress(0, value);
      break;
    case this.DMA1SAD_LO:
      this.cpu.irq.dmaSetSourceAddress(1, value);
      break;
    case this.DMA1DAD_LO:
      this.cpu.irq.dmaSetDestAddress(1, value);
      break;
    case this.DMA2SAD_LO:
      this.cpu.irq.dmaSetSourceAddress(2, value);
      break;
    case this.DMA2DAD_LO:
      this.cpu.irq.dmaSetDestAddress(2, value);
      break;
    case this.DMA3SAD_LO:
      this.cpu.irq.dmaSetSourceAddress(3, value);
      break;
    case this.DMA3DAD_LO:
      this.cpu.irq.dmaSetDestAddress(3, value);
      break;
    case this.FIFO_A_LO:
      this.audio.appendToFifoA(value);
      return;
    case this.FIFO_B_LO:
      this.audio.appendToFifoB(value);
      return;

    // High bits of this write should be ignored
    case this.IME:
      this.store16(offset, value & 0xFFFF);
      return;
    case this.JOY_RECV:
    case this.JOY_TRANS:
      this.STUB_REG('JOY', offset);
      return;
    default:
      this.store16(offset, value & 0xFFFF);
      this.store16(offset | 2, value >>> 16);
      return;
    }

    this.registers[offset >> 1] = value & 0xFFFF;
    this.registers[(offset >> 1) + 1] = value >>> 16;
  }

  invalidatePage(_address: number): void {}

  STUB_REG(type: string, offset: number): void {
    this.core.STUB('Unimplemented ' + type + ' register write: ' + offset.toString(16));
  }
}
