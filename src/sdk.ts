/**
 * GBA.js SDK — clean, environment-agnostic entry point.
 *
 * Usage in Bun/Node (headless):
 * ```
 * import { GBA, MemorySaveBackend } from 'gbajs';
 * const gba = new GBA({ saveBackend: new MemorySaveBackend() });
 * gba.setBios(biosBuf);
 * gba.setRom(romBuf);
 * for (let i = 0; i < 1000; i++) gba.step();
 * ```
 *
 * Usage in browser (with UI):
 * ```
 * import { GBA } from 'gbajs';
 * import { main } from 'gbajs/browser';
 * main(new GBA());
 * ```
 */

// Re-export the main emulator class
export { GameBoyAdvance as GBA } from './gba.js';
export type { GBAConfig, CartInfo, FrostState } from './gba.js';

// Re-export persistence backends
export {
  SaveBackend,
  MemorySaveBackend,
  LocalStorageSaveBackend,
  IDBSaveBackend,
  FsSaveBackend,
  FileSystemSaveBackend,
  GameLibrary,
} from './save-backend.js';
export type { SavedataBuffer, SavestateBlob, GameEntry, GameIndex } from './save-backend.js';

// Re-export core sub-modules for advanced usage
export { ARMCore } from './core.js';
export { ARMCoreArm } from './arm.js';
export { ARMCoreThumb } from './thumb.js';
export { GameBoyAdvanceMMU } from './mmu.js';
export { GameBoyAdvanceIO } from './io.js';
export { GameBoyAdvanceInterruptHandler } from './irq.js';
export { GameBoyAdvanceAudio } from './audio.js';
export { GameBoyAdvanceVideo } from './video.js';
export {
  GameBoyAdvanceSoftwareRenderer,
  GameBoyAdvanceVRAM,
  GameBoyAdvanceOAM,
  GameBoyAdvancePalette,
  GameBoyAdvanceOBJ,
} from './video/software.js';
export { GameBoyAdvanceRenderProxy } from './video/proxy.js';
export { GameBoyAdvanceKeypad } from './keypad.js';
export { GameBoyAdvanceSIO } from './sio.js';
export { GameBoyAdvanceGPIO, GameBoyAdvanceRTC } from './gpio.js';
export { SRAMSavedata, FlashSavedata, EEPROMSavedata } from './savedata.js';

// Re-export utilities
export { hex, Serializer } from './util.js';
