/**
 * GBA.js shared type definitions.
 *
 * These types are the source of truth for cross-module contracts.
 * All modules should import from here instead of defining their own copies.
 */

/** DMA channel configuration state. Shared by MMU, IRQ, Audio, and save subsystems. */
export interface DMAInfo {
  source: number;
  dest: number;
  count: number;
  nextSource: number;
  nextDest: number;
  nextCount: number;
  srcControl: number;
  dstControl: number;
  repeat: boolean;
  width: number;
  drq: boolean;
  timing: number;
  doIrq: boolean;
  enable: boolean;
  nextIRQ: number;
}

/** Frozen emulator state for save states, derived from each subsystem's freeze() return type. */
export interface FrostState {
  cpu: ReturnType<import('./core.js').ARMCore['freeze']>;
  mmu: ReturnType<import('./mmu.js').GameBoyAdvanceMMU['freeze']>;
  irq: ReturnType<import('./irq.js').GameBoyAdvanceInterruptHandler['freeze']>;
  io: ReturnType<import('./io.js').GameBoyAdvanceIO['freeze']>;
  audio: ReturnType<import('./audio.js').GameBoyAdvanceAudio['freeze']>;
  video: ReturnType<import('./video.js').GameBoyAdvanceVideo['freeze']>;
}

/** ROM cartridge metadata returned by loadRom. */
export interface CartInfo {
  title: string | null;
  code: string | null;
  maker: string | null;
  memory: ArrayBuffer;
  saveType: string | null;
}

/** Every entry in the MMU region table conforms to this interface. */
export interface MemoryRegion {
  load8(offset: number): number;
  load16(offset: number): number;
  load32(offset: number): number;
  loadU8(offset: number): number;
  loadU16(offset: number): number;
  store8(offset: number, value: number): void;
  store16(offset: number, value: number): void;
  store32(offset: number, value: number): void;
  invalidatePage(address: number): void;
  replaceData?(memory: ArrayBuffer, offset?: number): void;
  ICACHE_PAGE_BITS: number;
  PAGE_MASK: number;
  icache: any[];
  buffer?: ArrayBuffer;
  view?: DataView;
  mask?: number;
  registers?: Int16Array | Uint16Array;
}
