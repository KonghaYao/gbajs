// Web Audio API-based GBA audio.
// 4 PSG channels (2 square, 1 wave, 1 noise) + 2 FIFO DMA channels.

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    AudioContext?: typeof AudioContext;
  }
}

import type { DMAInfo } from './types.js';

interface AudioCPU {
  cycles: number;
  mmu: {
    BASE_IO: number;
    serviceDma(num: number, info: DMAInfo): void;
  };
  irq: {
    FREQUENCY: number;
    pollNextEvent(): void;
    dma: DMAInfo[];
    io: { FIFO_A_LO: number; FIFO_B_LO: number };
  };
}

interface AudioCore {
  irq: AudioCPU['irq'];
  STUB(msg: string): void;
  WARN(msg: string): void;
  encodeBase64(v: DataView): string;
  decodeBase64(str: string): ArrayBuffer;
}

interface SquareChannel {
  enabled: boolean;
  playing: boolean;
  sample: number;
  duty: number;
  increment: number;
  step: number;
  initialVolume: number;
  volume: number;
  frequency: number;
  interval: number;
  sweepSteps: number;
  sweepIncrement: number;
  sweepInterval: number;
  doSweep: boolean;
  raise: number;
  lower: number;
  nextStep: number;
  nextSweep: number;
  timed: boolean;
  length: number;
  end: number;
}

interface NoiseChannel {
  sample: number;
  lfsr: number;
  width: number;
  interval: number;
  increment: number;
  step: number;
  initialVolume: number;
  volume: number;
  nextStep: number;
  next: number;
  timed: boolean;
  length: number;
  end: number;
}

export class GameBoyAdvanceAudio {
  context: AudioContext | null;
  jsAudio!: ScriptProcessorNode;
  bufferSize: number = 0;
  maxSamples: number = 0;
  buffers: Float32Array[] | null = null;
  sampleMask: number = 0;

  masterEnable = true;
  masterVolume = 0x400; // full volume (normalization now prevents clipping)
  mutePsg = false;     // mute PSG channels (1-4: square, wave, noise)
  muteDma = false;     // DMA channels (A, B: PCM samples)

  SOUND_MAX = 0x400;
  FIFO_MAX = 0x200;
  PSG_MAX = 0x080;

  fifoA: number[] = [];
  fifoB: number[] = [];
  fifoASample = 0;
  fifoBSample = 0;

  enabled = false;
  enableChannel3 = false;
  enableChannel4 = false;
  enableChannelA = false;
  enableChannelB = false;
  enableRightChannelA = false;
  enableLeftChannelA = false;
  enableRightChannelB = false;
  enableLeftChannelB = false;
  playingChannel3 = false;
  playingChannel4 = false;

  volumeLeft = 0;
  volumeRight = 0;
  ratioChannelA = 1;
  ratioChannelB = 1;
  enabledLeft = 0;
  enabledRight = 0;

  dmaA = -1;
  dmaB = -1;
  soundTimerA = 0;
  soundTimerB = 0;

  soundRatio = 1;
  soundBias = 0x200;

  squareChannels: SquareChannel[] = [];

  waveData!: Uint8Array;
  channel3Dimension = 0;
  channel3Bank = 0;
  channel3Volume = 0;
  channel3Interval = 0;
  channel3Next = 0;
  channel3Length = 0;
  channel3Timed = false;
  channel3End = 0;
  channel3Pointer = 0;
  channel3Sample = 0;
  channel3Write = false;

  cpuFrequency!: number;

  channel4!: NoiseChannel;

  nextEvent = 0;
  nextSample = 0;
  outputPointer = 0;
  samplePointer = 0;
  backup = 0;
  totalSamples = 0;

  sampleRate = 32768;
  sampleInterval!: number;
  resampleRatio = 1;

  masterVolumeLeft = 0;
  masterVolumeRight = 0;

  cpu!: AudioCPU;
  core!: AudioCore;

  constructor() {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    if (window.AudioContext) {
      const self = this;
      this.context = new AudioContext();
      this.bufferSize = 0;
      this.bufferSize = 4096;
      this.maxSamples = this.bufferSize << 2;
      this.buffers = [new Float32Array(this.maxSamples), new Float32Array(this.maxSamples)];
      this.sampleMask = this.maxSamples - 1;
      if ((this.context as any).createScriptProcessor) {
        this.jsAudio = this.context.createScriptProcessor(this.bufferSize);
      } else {
        this.jsAudio = (this.context as any).createJavaScriptNode(this.bufferSize);
      }
      this.jsAudio.onaudioprocess = function (this: ScriptProcessorNode, e: AudioProcessingEvent) {
        self.audioProcess(e);
      };
    } else {
      this.context = null;
    }
  }

  clear(): void {
    this.fifoA = [];
    this.fifoB = [];
    this.fifoASample = 0;
    this.fifoBSample = 0;

    this.enabled = false;
    if (this.context) {
      try {
        this.jsAudio.disconnect(this.context.destination);
      } catch (e) {
      }
    }

    this.enableChannel3 = false;
    this.enableChannel4 = false;
    this.enableChannelA = false;
    this.enableChannelB = false;
    this.enableRightChannelA = false;
    this.enableLeftChannelA = false;
    this.enableRightChannelB = false;
    this.enableLeftChannelB = false;

    this.playingChannel3 = false;
    this.playingChannel4 = false;

    this.volumeLeft = 0;
    this.volumeRight = 0;
    this.ratioChannelA = 1;
    this.ratioChannelB = 1;
    this.enabledLeft = 0;
    this.enabledRight = 0;

    this.dmaA = -1;
    this.dmaB = -1;
    this.soundTimerA = 0;
    this.soundTimerB = 0;

    this.soundRatio = 1;
    this.soundBias = 0x200;

    this.squareChannels = [];
    for (let i = 0; i < 2; ++i) {
      this.squareChannels[i] = {
        enabled: false,
        playing: false,
        sample: 0,
        duty: 0.5,
        increment: 0,
        step: 0,
        initialVolume: 0,
        volume: 0,
        frequency: 0,
        interval: 0,
        sweepSteps: 0,
        sweepIncrement: 0,
        sweepInterval: 0,
        doSweep: false,
        raise: 0,
        lower: 0,
        nextStep: 0,
        nextSweep: 0,
        timed: false,
        length: 0,
        end: 0,
      };
    }

    this.waveData = new Uint8Array(32);
    this.channel3Dimension = 0;
    this.channel3Bank = 0;
    this.channel3Volume = 0;
    this.channel3Interval = 0;
    this.channel3Next = 0;
    this.channel3Length = 0;
    this.channel3Timed = false;
    this.channel3End = 0;
    this.channel3Pointer = 0;
    this.channel3Sample = 0;

    this.cpuFrequency = this.core.irq.FREQUENCY;

    this.channel4 = {
      sample: 0,
      lfsr: 0,
      width: 15,
      interval: this.cpuFrequency / 524288,
      increment: 0,
      step: 0,
      initialVolume: 0,
      volume: 0,
      nextStep: 0,
      next: 0,
      timed: false,
      length: 0,
      end: 0,
    };

    this.nextEvent = 0;

    this.nextSample = 0;
    this.outputPointer = 0;
    this.samplePointer = 0;

    this.backup = 0;
    this.totalSamples = 0;

    this.sampleRate = 32768;
    this.sampleInterval = this.cpuFrequency / this.sampleRate;
    this.resampleRatio = 1;
    if (this.context) {
      this.resampleRatio = this.sampleRate / this.context.sampleRate;
    }

    this.writeSquareChannelFC(0, 0);
    this.writeSquareChannelFC(1, 0);
    this.writeChannel4FC(0);
  }

  freeze(): { nextSample: number } {
    return {
      nextSample: this.nextSample,
    };
  }

  defrost(frost: { nextSample: number }): void {
    this.nextSample = frost.nextSample;
  }

  pause(paused: boolean): void {
    if (this.context) {
      if (paused) {
        try {
          this.jsAudio.disconnect(this.context.destination);
        } catch (e) {
          // Sigh
        }
      } else if (this.enabled) {
        this.jsAudio.connect(this.context.destination);
      }
    }
  }

  updateTimers(): void {
    const cycles = this.cpu.cycles;
    if (!this.enabled || (cycles < this.nextEvent && cycles < this.nextSample)) {
      return;
    }

    if (cycles >= this.nextEvent) {
      let channel = this.squareChannels[0];
      this.nextEvent = Infinity;
      if (channel.playing) {
        this.updateSquareChannel(channel, cycles);
      }

      channel = this.squareChannels[1];
      if (channel.playing) {
        this.updateSquareChannel(channel, cycles);
      }

      if (this.enableChannel3 && this.playingChannel3) {
        if (cycles >= this.channel3Next) {
          if (this.channel3Write) {
            const sample = this.waveData[this.channel3Pointer >> 1];
            this.channel3Sample = (((sample >> ((this.channel3Pointer & 1) << 2)) & 0xF) - 0x8) / 8;
            this.channel3Pointer = (this.channel3Pointer + 1);
            if (this.channel3Dimension && this.channel3Pointer >= 64) {
              this.channel3Pointer -= 64;
            } else if (!this.channel3Bank && this.channel3Pointer >= 32) {
              this.channel3Pointer -= 32;
            } else if (this.channel3Pointer >= 64) {
              this.channel3Pointer -= 32;
            }
          }
          this.channel3Next += this.channel3Interval;
          if (this.channel3Interval && this.nextEvent > this.channel3Next) {
            this.nextEvent = this.channel3Next;
          }
        }
        if (this.channel3Timed && cycles >= this.channel3End) {
          this.playingChannel3 = false;
        }
      }

      if (this.enableChannel4 && this.playingChannel4) {
        if (this.channel4.timed && cycles >= this.channel4.end) {
          this.playingChannel4 = false;
        } else {
          if (cycles >= this.channel4.next) {
            this.channel4.lfsr >>= 1;
            const sample = this.channel4.lfsr & 1;
            this.channel4.lfsr |= (((this.channel4.lfsr >> 1) & 1) ^ sample) << (this.channel4.width - 1);
            this.channel4.next += this.channel4.interval;
            this.channel4.sample = (sample - 0.5) * 2 * this.channel4.volume;
          }
          this.updateEnvelope(this.channel4, cycles);
          if (this.nextEvent > this.channel4.next) {
            this.nextEvent = this.channel4.next;
          }
          if (this.channel4.timed && this.nextEvent > this.channel4.end) {
            this.nextEvent = this.channel4.end;
          }
        }
      }
    }

    if (cycles >= this.nextSample) {
      this.sample();
      this.nextSample += this.sampleInterval;
    }

    this.nextEvent = Math.ceil(this.nextEvent);
    if ((this.nextEvent < cycles) || (this.nextSample < cycles)) {
      // STM instructions may take a long time
      this.updateTimers();
    }
  }

  writeEnable(value: number): void {
    this.enabled = !!value;
    this.nextEvent = this.cpu.cycles;
    this.nextSample = this.nextEvent;
    this.updateTimers();
    this.core.irq.pollNextEvent();
    if (this.context) {
      if (value) {
        this.jsAudio.connect(this.context.destination);
      } else {
        try {
          this.jsAudio.disconnect(this.context.destination);
        } catch (e) {
        }
      }
    }
  }

  writeSoundControlLo(value: number): void {
    this.masterVolumeLeft = value & 0x7;
    this.masterVolumeRight = (value >> 4) & 0x7;
    this.enabledLeft = (value >> 8) & 0xF;
    this.enabledRight = (value >> 12) & 0xF;

    this.setSquareChannelEnabled(this.squareChannels[0], (this.enabledLeft | this.enabledRight) & 0x1);
    this.setSquareChannelEnabled(this.squareChannels[1], (this.enabledLeft | this.enabledRight) & 0x2);
    this.enableChannel3 = !!((this.enabledLeft | this.enabledRight) & 0x4);
    this.setChannel4Enabled((this.enabledLeft | this.enabledRight) & 0x8);

    this.updateTimers();
    this.core.irq.pollNextEvent();
  }

  writeSoundControlHi(value: number): void {
    switch (value & 0x0003) {
      case 0:
        this.soundRatio = 0.25;
        break;
      case 1:
        this.soundRatio = 0.50;
        break;
      case 2:
        this.soundRatio = 1;
        break;
    }
    this.ratioChannelA = (((value & 0x0004) >> 2) + 1) * 0.5;
    this.ratioChannelB = (((value & 0x0008) >> 3) + 1) * 0.5;

    this.enableRightChannelA = !!(value & 0x0100);
    this.enableLeftChannelA = !!(value & 0x0200);
    this.enableChannelA = !!(value & 0x0300);
    this.soundTimerA = value & 0x0400;
    if (value & 0x0800) {
      this.fifoA = [];
    }
    this.enableRightChannelB = !!(value & 0x1000);
    this.enableLeftChannelB = !!(value & 0x2000);
    this.enableChannelB = !!(value & 0x3000);
    this.soundTimerB = value & 0x4000;
    if (value & 0x8000) {
      this.fifoB = [];
    }
  }

  resetSquareChannel(channel: SquareChannel): void {
    if (channel.step) {
      channel.nextStep = this.cpu.cycles + channel.step;
    }
    if (channel.enabled && !channel.playing) {
      channel.raise = this.cpu.cycles;
      channel.lower = channel.raise + channel.duty * channel.interval;
      channel.end = this.cpu.cycles + channel.length;
      this.nextEvent = this.cpu.cycles;
    }
    channel.playing = channel.enabled;
    this.updateTimers();
    this.core.irq.pollNextEvent();
  }

  setSquareChannelEnabled(channel: SquareChannel, enable: number): void {
    if (!(channel.enabled && channel.playing) && enable) {
      channel.enabled = !!enable;
      this.updateTimers();
      this.core.irq.pollNextEvent();
    } else {
      channel.enabled = !!enable;
    }
  }

  writeSquareChannelSweep(channelId: number, value: number): void {
    const channel = this.squareChannels[channelId];
    channel.sweepSteps = value & 0x07;
    channel.sweepIncrement = (value & 0x08) ? -1 : 1;
    channel.sweepInterval = ((value >> 4) & 0x7) * this.cpuFrequency / 128;
    channel.doSweep = !!channel.sweepInterval;
    channel.nextSweep = this.cpu.cycles + channel.sweepInterval;
    this.resetSquareChannel(channel);
  }

  writeSquareChannelDLE(channelId: number, value: number): void {
    const channel = this.squareChannels[channelId];
    const duty = (value >> 6) & 0x3;
    switch (duty) {
      case 0:
        channel.duty = 0.125;
        break;
      case 1:
        channel.duty = 0.25;
        break;
      case 2:
        channel.duty = 0.5;
        break;
      case 3:
        channel.duty = 0.75;
        break;
    }
    this.writeChannelLE(channel, value);
    this.resetSquareChannel(channel);
  }

  writeSquareChannelFC(channelId: number, value: number): void {
    const channel = this.squareChannels[channelId];
    const frequency = value & 2047;
    channel.frequency = frequency;
    channel.interval = this.cpuFrequency * (2048 - frequency) / 131072;
    channel.timed = !!(value & 0x4000);

    if (value & 0x8000) {
      this.resetSquareChannel(channel);
      channel.volume = channel.initialVolume;
    }
  }

  updateSquareChannel(channel: SquareChannel, cycles: number): void {
    if (channel.timed && cycles >= channel.end) {
      channel.playing = false;
      return;
    }

    if (channel.doSweep && cycles >= channel.nextSweep) {
      channel.frequency += channel.sweepIncrement * (channel.frequency >> channel.sweepSteps);
      if (channel.frequency < 0) {
        channel.frequency = 0;
      } else if (channel.frequency > 2047) {
        channel.frequency = 2047;
        channel.playing = false;
        return;
      }
      channel.interval = this.cpuFrequency * (2048 - channel.frequency) / 131072;
      channel.nextSweep += channel.sweepInterval;
    }

    if (cycles >= channel.raise) {
      channel.sample = channel.volume;
      channel.lower = channel.raise + channel.duty * channel.interval;
      channel.raise += channel.interval;
    } else if (cycles >= channel.lower) {
      channel.sample = -channel.volume;
      channel.lower += channel.interval;
    }

    this.updateEnvelope(channel, cycles);

    if (this.nextEvent > channel.raise) {
      this.nextEvent = channel.raise;
    }
    if (this.nextEvent > channel.lower) {
      this.nextEvent = channel.lower;
    }
    if (channel.timed && this.nextEvent > channel.end) {
      this.nextEvent = channel.end;
    }
    if (channel.doSweep && this.nextEvent > channel.nextSweep) {
      this.nextEvent = channel.nextSweep;
    }
  }

  writeChannel3Lo(value: number): void {
    this.channel3Dimension = value & 0x20;
    this.channel3Bank = value & 0x40;
    const enable = !!(value & 0x80);
    if (!this.channel3Write && enable) {
      this.channel3Write = enable;
      this.resetChannel3();
    } else {
      this.channel3Write = enable;
    }
  }

  writeChannel3Hi(value: number): void {
    this.channel3Length = this.cpuFrequency * (0x100 - (value & 0xFF)) / 256;
    const volume = (value >> 13) & 0x7;
    switch (volume) {
      case 0:
        this.channel3Volume = 0;
        break;
      case 1:
        this.channel3Volume = 1;
        break;
      case 2:
        this.channel3Volume = 0.5;
        break;
      case 3:
        this.channel3Volume = 0.25;
        break;
      default:
        this.channel3Volume = 0.75;
    }
  }

  writeChannel3X(value: number): void {
    this.channel3Interval = this.cpuFrequency * (2048 - (value & 0x7FF)) / 2097152;
    this.channel3Timed = !!(value & 0x4000);
    if (this.channel3Write) {
      this.resetChannel3();
    }
  }

  resetChannel3(): void {
    this.channel3Next = this.cpu.cycles;
    this.nextEvent = this.channel3Next;
    this.channel3End = this.cpu.cycles + this.channel3Length;
    this.playingChannel3 = this.channel3Write;
    this.updateTimers();
    this.core.irq.pollNextEvent();
  }

  writeWaveData(offset: number, data: number, width: number): void {
    if (!this.channel3Bank) {
      offset += 16;
    }
    if (width == 2) {
      this.waveData[offset] = data & 0xFF;
      data >>= 8;
      ++offset;
    }
    this.waveData[offset] = data & 0xFF;
  }

  setChannel4Enabled(enable: number): void {
    if (!this.enableChannel4 && enable) {
      this.channel4.next = this.cpu.cycles;
      this.channel4.end = this.cpu.cycles + this.channel4.length;
      this.enableChannel4 = true;
      this.playingChannel4 = true;
      this.nextEvent = this.cpu.cycles;
      this.updateEnvelope(this.channel4);
      this.updateTimers();
      this.core.irq.pollNextEvent();
    } else {
      this.enableChannel4 = !!enable;
    }
  }

  writeChannel4LE(value: number): void {
    this.writeChannelLE(this.channel4, value);
    this.resetChannel4();
  }

  writeChannel4FC(value: number): void {
    this.channel4.timed = !!(value & 0x4000);

    let r = value & 0x7;
    if (!r) {
      r = 0.5;
    }
    const s = (value >> 4) & 0xF;
    const interval = this.cpuFrequency * (r * (2 << s)) / 524288;
    if (interval != this.channel4.interval) {
      this.channel4.interval = interval;
      this.resetChannel4();
    }

    const width = (value & 0x8) ? 7 : 15;
    if (width != this.channel4.width) {
      this.channel4.width = width;
      this.resetChannel4();
    }

    if (value & 0x8000) {
      this.resetChannel4();
    }
  }

  resetChannel4(): void {
    if (this.channel4.width == 15) {
      this.channel4.lfsr = 0x4000;
    } else {
      this.channel4.lfsr = 0x40;
    }
    this.channel4.volume = this.channel4.initialVolume;
    if (this.channel4.step) {
      this.channel4.nextStep = this.cpu.cycles + this.channel4.step;
    }
    this.channel4.end = this.cpu.cycles + this.channel4.length;
    this.channel4.next = this.cpu.cycles;
    this.nextEvent = this.channel4.next;

    this.playingChannel4 = this.enableChannel4;
    this.updateTimers();
    this.core.irq.pollNextEvent();
  }

  writeChannelLE(channel: SquareChannel | NoiseChannel, value: number): void {
    channel.length = this.cpuFrequency * ((0x40 - (value & 0x3F)) / 256);

    if (value & 0x0800) {
      channel.increment = 1 / 16;
    } else {
      channel.increment = -1 / 16;
    }
    channel.initialVolume = ((value >> 12) & 0xF) / 16;

    channel.step = this.cpuFrequency * (((value >> 8) & 0x7) / 64);
  }

  updateEnvelope(channel: SquareChannel | NoiseChannel, cycles: number = 0): void {
    if (channel.step) {
      if (cycles >= channel.nextStep) {
        channel.volume += channel.increment;
        if (channel.volume > 1) {
          channel.volume = 1;
        } else if (channel.volume < 0) {
          channel.volume = 0;
        }
        channel.nextStep += channel.step;
      }

      if (this.nextEvent > channel.nextStep) {
        this.nextEvent = channel.nextStep;
      }
    }
  }

  appendToFifoA(value: number): void {
    let b: number;
    if (this.fifoA.length > 28) {
      this.fifoA = this.fifoA.slice(-28);
    }
    for (let i = 0; i < 4; ++i) {
      b = (value & 0xFF) << 24;
      value >>= 8;
      this.fifoA.push(b / 0x80000000);
    }
  }

  appendToFifoB(value: number): void {
    let b: number;
    if (this.fifoB.length > 28) {
      this.fifoB = this.fifoB.slice(-28);
    }
    for (let i = 0; i < 4; ++i) {
      b = (value & 0xFF) << 24;
      value >>= 8;
      this.fifoB.push(b / 0x80000000);
    }
  }

  sampleFifoA(): void {
    if (this.fifoA.length <= 16) {
      const dma = this.core.irq.dma[this.dmaA];
      dma.nextCount = 4;
      this.cpu.mmu.serviceDma(this.dmaA, dma);
    }
    this.fifoASample = this.fifoA.shift()!;
  }

  sampleFifoB(): void {
    if (this.fifoB.length <= 16) {
      const dma = this.core.irq.dma[this.dmaB];
      dma.nextCount = 4;
      this.cpu.mmu.serviceDma(this.dmaB, dma);
    }
    this.fifoBSample = this.fifoB.shift()!;
  }

  scheduleFIFODma(number: number, info: DMAInfo): void {
    switch (info.dest) {
      case this.cpu.mmu.BASE_IO | this.cpu.irq.io.FIFO_A_LO:
        // FIXME: is this needed or a hack?
        info.dstControl = 2;
        this.dmaA = number;
        break;
      case this.cpu.mmu.BASE_IO | this.cpu.irq.io.FIFO_B_LO:
        info.dstControl = 2;
        this.dmaB = number;
        break;
      default:
        this.core.WARN('Tried to schedule FIFO DMA for non-FIFO destination');
        break;
    }
  }

  sample(): void {
    let sampleLeft = 0;
    let sampleRight = 0;
    let sample: number;
    let channel: SquareChannel;

    channel = this.squareChannels[0];
    if (channel.playing && !this.mutePsg) {
      sample = channel.sample * this.soundRatio * this.PSG_MAX;
      if (this.enabledLeft & 0x1) {
        sampleLeft += sample;
      }
      if (this.enabledRight & 0x1) {
        sampleRight += sample;
      }
    }

    channel = this.squareChannels[1];
    if (channel.playing && !this.mutePsg) {
      sample = channel.sample * this.soundRatio * this.PSG_MAX;
      if (this.enabledLeft & 0x2) {
        sampleLeft += sample;
      }
      if (this.enabledRight & 0x2) {
        sampleRight += sample;
      }
    }

    if (this.playingChannel3 && !this.mutePsg) {
      sample = this.channel3Sample * this.soundRatio * this.channel3Volume * this.PSG_MAX;
      if (this.enabledLeft & 0x4) {
        sampleLeft += sample;
      }
      if (this.enabledRight & 0x4) {
        sampleRight += sample;
      }
    }

    if (this.playingChannel4 && !this.mutePsg) {
      sample = this.channel4.sample * this.soundRatio * this.PSG_MAX;
      if (this.enabledLeft & 0x8) {
        sampleLeft += sample;
      }
      if (this.enabledRight & 0x8) {
        sampleRight += sample;
      }
    }

    if (this.enableChannelA && !this.muteDma) {
      sample = this.fifoASample * this.FIFO_MAX * this.ratioChannelA;
      if (this.enableLeftChannelA) {
        sampleLeft += sample;
      }
      if (this.enableRightChannelA) {
        sampleRight += sample;
      }
    }

    if (this.enableChannelB && !this.muteDma) {
      sample = this.fifoBSample * this.FIFO_MAX * this.ratioChannelB;
      if (this.enableLeftChannelB) {
        sampleLeft += sample;
      }
      if (this.enableRightChannelB) {
        sampleRight += sample;
      }
    }

    const samplePointer = this.samplePointer;
    // Normalize (max 4 PSG + 2 DMA ≈ 1536) then apply volume
    sampleLeft = sampleLeft / 0x600 * (this.masterVolume / 0x400);
    sampleLeft = Math.max(Math.min(sampleLeft, 1), -1);
    sampleRight = sampleRight / 0x600 * (this.masterVolume / 0x400);
    sampleRight = Math.max(Math.min(sampleRight, 1), -1);
    if (this.buffers) {
      this.buffers[0][samplePointer] = sampleLeft;
      this.buffers[1][samplePointer] = sampleRight;
    }
    this.samplePointer = (samplePointer + 1) & this.sampleMask;
  }

  audioProcess(audioProcessingEvent: AudioProcessingEvent): void {
    const left = audioProcessingEvent.outputBuffer.getChannelData(0);
    const right = audioProcessingEvent.outputBuffer.getChannelData(1);
    if (this.masterEnable) {
      let i: number;
      let o = this.outputPointer;
      for (i = 0; i < this.bufferSize; ++i, o += this.resampleRatio) {
        if (o >= this.maxSamples) {
          o -= this.maxSamples;
        }
        if ((o | 0) == this.samplePointer) {
          ++this.backup;
          break;
        }
        left[i] = this.buffers![0][o | 0];
        right[i] = this.buffers![1][o | 0];
      }
      for (; i < this.bufferSize; ++i) {
        left[i] = 0;
        right[i] = 0;
      }
      this.outputPointer = o;
      ++this.totalSamples;
    } else {
      for (let i = 0; i < this.bufferSize; ++i) {
        left[i] = 0;
        right[i] = 0;
      }
    }
  }
}
