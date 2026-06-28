// MMU (Memory Management Unit) for GBA.js emulator
// Handles memory mapping, DMA, save types, and wait states.

import { MemoryView, FlashSavedata, SRAMSavedata, EEPROMSavedata } from './savedata.js';
import { GameBoyAdvanceGPIO } from './gpio.js';
import { Serializer } from './util.js';
import type { DMAInfo, CartInfo, MemoryRegion } from './types.js';

// ---- Interfaces ----

/** A decoded instruction page in the icache. */
interface PageInfo {
	thumb: any[];
	arm: any[];
	invalid: boolean;
}

/** The part of the CPU that mmu.ts depends on. Set externally by gba.ts. */
interface CPU {
	gprs: Int32Array;
	PC: number;
	instructionWidth: number;
	execMode: number;
	MODE_ARM: number;
	cycles: number;
	irq: IRQ;
}

/** Interrupt request subsystem. */
interface IRQ {
	dma: DMAInfo[];
	audio: { scheduleFIFODma(number: number, info: DMAInfo): void };
	video: { scheduleVCaptureDma(dma: DMAInfo, info: DMAInfo): void };
}

/** The emulator core methods/types that mmu.ts depends on. Set externally. */
interface Core {
	io: {
		DMA0CNT_HI: number;
		DMA1CNT_HI: number;
		DMA2CNT_HI: number;
		DMA3CNT_HI: number;
	};
	WARN(msg: string): void;
}

/** The save object (FlashSavedata | SRAMSavedata | EEPROMSavedata). */
type SaveData = FlashSavedata | SRAMSavedata | EEPROMSavedata;

// ---- Classes ----

export class MemoryBlock extends MemoryView {
	ICACHE_PAGE_BITS: number;
	PAGE_MASK: number;
	icache: PageInfo[];

	constructor(size: number, cacheBits: number) {
		super(new ArrayBuffer(size));
		this.ICACHE_PAGE_BITS = cacheBits;
		this.PAGE_MASK = (2 << this.ICACHE_PAGE_BITS) - 1;
		this.icache = new Array(size >> (this.ICACHE_PAGE_BITS + 1));
	}

	invalidatePage(address: number): void {
		const page = this.icache[(address & this.mask) >> this.ICACHE_PAGE_BITS];
		if (page) {
			page.invalid = true;
		}
	}
}

export class ROMView extends MemoryView {
	ICACHE_PAGE_BITS: number;
	PAGE_MASK: number;
	icache: PageInfo[];
	gpio?: GameBoyAdvanceGPIO;
	mmu!: GameBoyAdvanceMMU; // Set externally by loadRom

	constructor(rom: ArrayBuffer, offset?: number) {
		super(rom, offset);
		this.ICACHE_PAGE_BITS = 10;
		this.PAGE_MASK = (2 << this.ICACHE_PAGE_BITS) - 1;
		this.icache = new Array(rom.byteLength >> (this.ICACHE_PAGE_BITS + 1));
		this.mask = 0x01FFFFFF;
		this.resetMask();
	}

	store8(offset: number, value: number): void {
		// ROM store8 is a no-op
	}

	store16(offset: number, value: number): void {
		if (offset < 0xCA && offset >= 0xC4) {
			if (!this.gpio) {
				this.gpio = this.mmu.allocGPIO(this);
			}
			this.gpio.store16(offset, value);
		}
	}

	store32(offset: number, value: number): void {
		if (offset < 0xCA && offset >= 0xC4) {
			if (!this.gpio) {
				this.gpio = this.mmu.allocGPIO(this);
			}
			// The original JS gpio.js has no store32; this path was
			// likely dead or a historical bug.  Kept for faithfulness.
			(this.gpio as unknown as { store32(o: number, v: number): void }).store32(offset, value);
		}
	}
}

export class BIOSView extends MemoryView {
	ICACHE_PAGE_BITS: number;
	PAGE_MASK: number;
	icache: PageInfo[];
	real: boolean = false;

	constructor(rom: ArrayBuffer, offset?: number) {
		super(rom, offset);
		this.ICACHE_PAGE_BITS = 16;
		this.PAGE_MASK = (2 << this.ICACHE_PAGE_BITS) - 1;
		this.icache = new Array(1);
	}

	load8(offset: number): number {
		if (offset >= this.buffer.byteLength) {
			return -1;
		}
		return this.view.getInt8(offset);
	}

	load16(offset: number): number {
		if (offset >= this.buffer.byteLength) {
			return -1;
		}
		return this.view.getInt16(offset, true);
	}

	loadU8(offset: number): number {
		if (offset >= this.buffer.byteLength) {
			return -1;
		}
		return this.view.getUint8(offset);
	}

	loadU16(offset: number): number {
		if (offset >= this.buffer.byteLength) {
			return -1;
		}
		return this.view.getUint16(offset, true);
	}

	load32(offset: number): number {
		if (offset >= this.buffer.byteLength) {
			return -1;
		}
		return this.view.getInt32(offset, true);
	}

	store8(offset: number, value: number): void {}
	store16(offset: number, value: number): void {}
	store32(offset: number, value: number): void {}
}

export class BadMemory {
	cpu: CPU;
	mmu: GameBoyAdvanceMMU;

	// Required by MemoryRegion interface (never accessed for BadMemory regions)
	ICACHE_PAGE_BITS: number = 0;
	PAGE_MASK: number = 0;
	icache: any[] = [];

	constructor(mmu: GameBoyAdvanceMMU, cpu: CPU) {
		this.cpu = cpu;
		this.mmu = mmu;
	}

	load8(offset: number): number {
		return this.mmu.load8(this.cpu.gprs[this.cpu.PC] - this.cpu.instructionWidth + (offset & 0x3));
	}

	load16(offset: number): number {
		return this.mmu.load16(this.cpu.gprs[this.cpu.PC] - this.cpu.instructionWidth + (offset & 0x2));
	}

	loadU8(offset: number): number {
		return this.mmu.loadU8(this.cpu.gprs[this.cpu.PC] - this.cpu.instructionWidth + (offset & 0x3));
	}

	loadU16(offset: number): number {
		return this.mmu.loadU16(this.cpu.gprs[this.cpu.PC] - this.cpu.instructionWidth + (offset & 0x2));
	}

	load32(offset: number): number {
		if (this.cpu.execMode === this.cpu.MODE_ARM) {
			// Original JS uses this.cpu.gprs.PC (typo for this.cpu.PC)
			return this.mmu.load32(this.cpu.gprs[this.cpu.PC] - this.cpu.instructionWidth);
		} else {
			const halfword = this.mmu.loadU16(this.cpu.gprs[this.cpu.PC] - this.cpu.instructionWidth);
			return halfword | (halfword << 16);
		}
	}

	store8(offset: number, value: number): void {}
	store16(offset: number, value: number): void {}
	store32(offset: number, value: number): void {}
	invalidatePage(address: number): void {}
}

export class GameBoyAdvanceMMU {
	// Region constants
	readonly REGION_BIOS = 0x0;
	readonly REGION_WORKING_RAM = 0x2;
	readonly REGION_WORKING_IRAM = 0x3;
	readonly REGION_IO = 0x4;
	readonly REGION_PALETTE_RAM = 0x5;
	readonly REGION_VRAM = 0x6;
	readonly REGION_OAM = 0x7;
	readonly REGION_CART0 = 0x8;
	readonly REGION_CART1 = 0xA;
	readonly REGION_CART2 = 0xC;
	readonly REGION_CART_SRAM = 0xE;

	readonly BASE_BIOS = 0x00000000;
	readonly BASE_WORKING_RAM = 0x02000000;
	readonly BASE_WORKING_IRAM = 0x03000000;
	readonly BASE_IO = 0x04000000;
	readonly BASE_PALETTE_RAM = 0x05000000;
	readonly BASE_VRAM = 0x06000000;
	readonly BASE_OAM = 0x07000000;
	readonly BASE_CART0 = 0x08000000;
	readonly BASE_CART1 = 0x0A000000;
	readonly BASE_CART2 = 0x0C000000;
	readonly BASE_CART_SRAM = 0x0E000000;

	readonly BASE_MASK = 0x0F000000;
	readonly BASE_OFFSET = 24;
	readonly OFFSET_MASK = 0x00FFFFFF;

	readonly SIZE_BIOS = 0x00004000;
	readonly SIZE_WORKING_RAM = 0x00040000;
	readonly SIZE_WORKING_IRAM = 0x00008000;
	readonly SIZE_IO = 0x00000400;
	readonly SIZE_PALETTE_RAM = 0x00000400;
	readonly SIZE_VRAM = 0x00018000;
	readonly SIZE_OAM = 0x00000400;
	readonly SIZE_CART0 = 0x02000000;
	readonly SIZE_CART1 = 0x02000000;
	readonly SIZE_CART2 = 0x02000000;
	readonly SIZE_CART_SRAM = 0x00008000;
	readonly SIZE_CART_FLASH512 = 0x00010000;
	readonly SIZE_CART_FLASH1M = 0x00020000;
	readonly SIZE_CART_EEPROM = 0x00002000;

	readonly DMA_TIMING_NOW = 0;
	readonly DMA_TIMING_VBLANK = 1;
	readonly DMA_TIMING_HBLANK = 2;
	readonly DMA_TIMING_CUSTOM = 3;

	readonly DMA_INCREMENT = 0;
	readonly DMA_DECREMENT = 1;
	readonly DMA_FIXED = 2;
	readonly DMA_INCREMENT_RELOAD = 3;

	readonly DMA_OFFSET = [1, -1, 0, 1];

	WAITSTATES: number[];
	WAITSTATES_32: number[];
	WAITSTATES_SEQ: number[];
	WAITSTATES_SEQ_32: number[];
	NULLWAIT: number[];

	ROM_WS = [4, 3, 2, 8];
	ROM_WS_SEQ = [
		[2, 1],
		[4, 1],
		[8, 1],
	];

	ICACHE_PAGE_BITS = 8;
	PAGE_MASK = (2 << this.ICACHE_PAGE_BITS) - 1;

	bios: BIOSView | null = null;
	badMemory!: BadMemory;
	memory: any[] = [];

	waitstates: number[] = [];
	waitstatesSeq: number[] = [];
	waitstates32: number[] = [];
	waitstatesSeq32: number[] = [];
	waitstatesPrefetch: number[] = [];
	waitstatesPrefetch32: number[] = [];

	cart: CartInfo | null = null;
	save!: SaveData;

	DMA_REGISTER: number[] = [];

	// Set externally by gba.ts
	cpu!: CPU;
	core!: Core;

	constructor() {
		this.WAITSTATES = [0, 0, 2, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4];
		this.WAITSTATES_32 = [0, 0, 5, 0, 0, 1, 0, 1, 7, 7, 9, 9, 13, 13, 8];
		this.WAITSTATES_SEQ = [0, 0, 2, 0, 0, 0, 0, 0, 2, 2, 4, 4, 8, 8, 4];
		this.WAITSTATES_SEQ_32 = [0, 0, 5, 0, 0, 1, 0, 1, 5, 5, 9, 9, 17, 17, 8];
		this.NULLWAIT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

		for (let i = 15; i < 256; ++i) {
			this.WAITSTATES[i] = 0;
			this.WAITSTATES_32[i] = 0;
			this.WAITSTATES_SEQ[i] = 0;
			this.WAITSTATES_SEQ_32[i] = 0;
			this.NULLWAIT[i] = 0;
		}
	}

	mmap(region: number, object: any): void {
		this.memory[region] = object;
	}

	clear(): void {
		this.badMemory = new BadMemory(this, this.cpu);
		this.memory = [
			this.bios!,
			this.badMemory, // Unused
			new MemoryBlock(this.SIZE_WORKING_RAM, 9),
			new MemoryBlock(this.SIZE_WORKING_IRAM, 7),
			null!, // This is owned by GameBoyAdvanceIO
			null!, // This is owned by GameBoyAdvancePalette
			null!, // This is owned by GameBoyAdvanceVRAM
			null!, // This is owned by GameBoyAdvanceOAM
			this.badMemory,
			this.badMemory,
			this.badMemory,
			this.badMemory,
			this.badMemory,
			this.badMemory,
			this.badMemory,
			this.badMemory, // Unused
		];
		for (let i = 16; i < 256; ++i) {
			this.memory[i] = this.badMemory;
		}

		this.waitstates = this.WAITSTATES.slice(0);
		this.waitstatesSeq = this.WAITSTATES_SEQ.slice(0);
		this.waitstates32 = this.WAITSTATES_32.slice(0);
		this.waitstatesSeq32 = this.WAITSTATES_SEQ_32.slice(0);
		this.waitstatesPrefetch = this.WAITSTATES_SEQ.slice(0);
		this.waitstatesPrefetch32 = this.WAITSTATES_SEQ_32.slice(0);

		this.cart = null;
		this.save = null!;

		this.DMA_REGISTER = [
			this.core.io.DMA0CNT_HI >> 1,
			this.core.io.DMA1CNT_HI >> 1,
			this.core.io.DMA2CNT_HI >> 1,
			this.core.io.DMA3CNT_HI >> 1,
		];
	}

	freeze(): { ram: Blob; iram: Blob } {
		return {
			ram: Serializer.prefix(this.memory[this.REGION_WORKING_RAM].buffer as unknown as string),
			iram: Serializer.prefix(this.memory[this.REGION_WORKING_IRAM].buffer as unknown as string),
		};
	}

	defrost(frost: { ram: ArrayBuffer; iram: ArrayBuffer }): void {
		this.memory[this.REGION_WORKING_RAM].replaceData!(frost.ram);
		this.memory[this.REGION_WORKING_IRAM].replaceData!(frost.iram);
	}

	loadBios(bios: ArrayBuffer, real?: boolean): void {
		this.bios = new BIOSView(bios);
		this.bios.real = !!real;
	}

	loadRom(rom: ArrayBuffer, process?: boolean): CartInfo | null {
		const cart: CartInfo = {
			title: null,
			code: null,
			maker: null,
			memory: rom,
			saveType: null,
		};

		const lo = new ROMView(rom);
		if (lo.view.getUint8(0xB2) !== 0x96) {
			// Not a valid ROM
			return null;
		}
		lo.mmu = this; // Needed for GPIO
		this.memory[this.REGION_CART0] = lo;
		this.memory[this.REGION_CART1] = lo;
		this.memory[this.REGION_CART2] = lo;

		if (rom.byteLength > 0x01000000) {
			const hi = new ROMView(rom, 0x01000000);
			this.memory[this.REGION_CART0 + 1] = hi;
			this.memory[this.REGION_CART1 + 1] = hi;
			this.memory[this.REGION_CART2 + 1] = hi;
		}

		if (process) {
			let name = '';
			for (let i = 0; i < 12; ++i) {
				const c = lo.loadU8(i + 0xA0);
				if (!c) {
					break;
				}
				name += String.fromCharCode(c);
			}
			cart.title = name;

			let code = '';
			for (let i = 0; i < 4; ++i) {
				const c = lo.loadU8(i + 0xAC);
				if (!c) {
					break;
				}
				code += String.fromCharCode(c);
			}
			cart.code = code;

			let maker = '';
			for (let i = 0; i < 2; ++i) {
				const c = lo.loadU8(i + 0xB0);
				if (!c) {
					break;
				}
				maker += String.fromCharCode(c);
			}
			cart.maker = maker;

			// Find savedata type
			let state = '';
			let terminal = false;
			for (let i = 0xE4; i < rom.byteLength && !terminal; ++i) {
				const next = String.fromCharCode(lo.loadU8(i));
				state += next;
				switch (state) {
					case 'F':
					case 'FL':
					case 'FLA':
					case 'FLAS':
					case 'FLASH':
					case 'FLASH_':
					case 'FLASH5':
					case 'FLASH51':
					case 'FLASH512':
					case 'FLASH512_':
					case 'FLASH1':
					case 'FLASH1M':
					case 'FLASH1M_':
					case 'S':
					case 'SR':
					case 'SRA':
					case 'SRAM':
					case 'SRAM_':
					case 'E':
					case 'EE':
					case 'EEP':
					case 'EEPR':
					case 'EEPRO':
					case 'EEPROM':
					case 'EEPROM_':
						break;
					case 'FLASH_V':
					case 'FLASH512_V':
					case 'FLASH1M_V':
					case 'SRAM_V':
					case 'EEPROM_V':
						terminal = true;
						break;
					default:
						state = next;
						break;
				}
			}
			if (terminal) {
				cart.saveType = state;
				switch (state) {
					case 'FLASH_V':
					case 'FLASH512_V':
						this.save = this.memory[this.REGION_CART_SRAM] = new FlashSavedata(
							this.SIZE_CART_FLASH512
						);
						break;
					case 'FLASH1M_V':
						this.save = this.memory[this.REGION_CART_SRAM] = new FlashSavedata(
							this.SIZE_CART_FLASH1M
						);
						break;
					case 'SRAM_V':
						this.save = this.memory[this.REGION_CART_SRAM] = new SRAMSavedata(
							this.SIZE_CART_SRAM
						);
						break;
					case 'EEPROM_V':
						this.save = this.memory[this.REGION_CART2 + 1] = new EEPROMSavedata(
							this.SIZE_CART_EEPROM,
							{ core: { irq: { dma: this.cpu.irq.dma } } }
						);
						break;
				}
			}
			if (!this.save) {
				// Assume we have SRAM
				this.save = this.memory[this.REGION_CART_SRAM] = new SRAMSavedata(
					this.SIZE_CART_SRAM
				);
			}
		}

		this.cart = cart;
		return cart;
	}

	loadSavedata(save: ArrayBuffer): void {
		this.save.replaceData(save);
	}

	load8(offset: number): number {
		return this.memory[offset >>> this.BASE_OFFSET].load8(offset & 0x00FFFFFF);
	}

	load16(offset: number): number {
		return this.memory[offset >>> this.BASE_OFFSET].load16(offset & 0x00FFFFFF);
	}

	load32(offset: number): number {
		return this.memory[offset >>> this.BASE_OFFSET].load32(offset & 0x00FFFFFF);
	}

	loadU8(offset: number): number {
		return this.memory[offset >>> this.BASE_OFFSET].loadU8(offset & 0x00FFFFFF);
	}

	loadU16(offset: number): number {
		return this.memory[offset >>> this.BASE_OFFSET].loadU16(offset & 0x00FFFFFF);
	}

	store8(offset: number, value: number): void {
		const maskedOffset = offset & 0x00FFFFFF;
		const memory = this.memory[offset >>> this.BASE_OFFSET];
		memory.store8(maskedOffset, value);
		memory.invalidatePage(maskedOffset);
	}

	store16(offset: number, value: number): void {
		const maskedOffset = offset & 0x00FFFFFE;
		const memory = this.memory[offset >>> this.BASE_OFFSET];
		memory.store16(maskedOffset, value);
		memory.invalidatePage(maskedOffset);
	}

	store32(offset: number, value: number): void {
		const maskedOffset = offset & 0x00FFFFFC;
		const memory = this.memory[offset >>> this.BASE_OFFSET];
		memory.store32(maskedOffset, value);
		memory.invalidatePage(maskedOffset);
		memory.invalidatePage(maskedOffset + 2);
	}

	waitPrefetch(memory: number): void {
		this.cpu.cycles += 1 + this.waitstatesPrefetch[memory >>> this.BASE_OFFSET];
	}

	waitPrefetch32(memory: number): void {
		this.cpu.cycles += 1 + this.waitstatesPrefetch32[memory >>> this.BASE_OFFSET];
	}

	wait(memory: number): void {
		this.cpu.cycles += 1 + this.waitstates[memory >>> this.BASE_OFFSET];
	}

	wait32(memory: number): void {
		this.cpu.cycles += 1 + this.waitstates32[memory >>> this.BASE_OFFSET];
	}

	waitSeq(memory: number): void {
		this.cpu.cycles += 1 + this.waitstatesSeq[memory >>> this.BASE_OFFSET];
	}

	waitSeq32(memory: number): void {
		this.cpu.cycles += 1 + this.waitstatesSeq32[memory >>> this.BASE_OFFSET];
	}

	waitMul(rs: number): void {
		if ((rs & 0xFFFFFF00) === 0xFFFFFF00 || !(rs & 0xFFFFFF00)) {
			this.cpu.cycles += 1;
		} else if ((rs & 0xFFFF0000) === 0xFFFF0000 || !(rs & 0xFFFF0000)) {
			this.cpu.cycles += 2;
		} else if ((rs & 0xFF000000) === 0xFF000000 || !(rs & 0xFF000000)) {
			this.cpu.cycles += 3;
		} else {
			this.cpu.cycles += 4;
		}
	}

	waitMulti32(memory: number, seq: number): void {
		this.cpu.cycles += 1 + this.waitstates32[memory >>> this.BASE_OFFSET];
		this.cpu.cycles += (1 + this.waitstatesSeq32[memory >>> this.BASE_OFFSET]) * (seq - 1);
	}

	addressToPage(region: number, address: number): number {
		return address >> this.memory[region].ICACHE_PAGE_BITS!;
	}

	accessPage(region: number, pageId: number): PageInfo {
		const memory = this.memory[region];
		let page = memory.icache![pageId];
		if (!page || page.invalid) {
			page = {
				thumb: new Array(1 << memory.ICACHE_PAGE_BITS!),
				arm: new Array(1 << (memory.ICACHE_PAGE_BITS! - 1)),
				invalid: false,
			};
			memory.icache![pageId] = page;
		}
		return page;
	}

	scheduleDma(number: number, info: DMAInfo): void {
		switch (info.timing) {
			case this.DMA_TIMING_NOW:
				this.serviceDma(number, info);
				break;
			case this.DMA_TIMING_HBLANK:
				// Handled implicitly
				break;
			case this.DMA_TIMING_VBLANK:
				// Handled implicitly
				break;
			case this.DMA_TIMING_CUSTOM:
				switch (number) {
					case 0:
						this.core.WARN('Discarding invalid DMA0 scheduling');
						break;
					case 1:
					case 2:
						this.cpu.irq.audio.scheduleFIFODma(number, info);
						break;
					case 3:
						this.cpu.irq.video.scheduleVCaptureDma(info, info);
						break;
				}
		}
	}

	runHblankDmas(): void {
		for (let i = 0; i < this.cpu.irq.dma.length; ++i) {
			const dma = this.cpu.irq.dma[i];
			if (dma.enable && dma.timing === this.DMA_TIMING_HBLANK) {
				this.serviceDma(i, dma);
			}
		}
	}

	runVblankDmas(): void {
		for (let i = 0; i < this.cpu.irq.dma.length; ++i) {
			const dma = this.cpu.irq.dma[i];
			if (dma.enable && dma.timing === this.DMA_TIMING_VBLANK) {
				this.serviceDma(i, dma);
			}
		}
	}

	serviceDma(number: number, info: DMAInfo): void {
		if (!info.enable) {
			// There was a DMA scheduled that got canceled
			return;
		}

		const width = info.width;
		const sourceOffset = this.DMA_OFFSET[info.srcControl] * width;
		const destOffset = this.DMA_OFFSET[info.dstControl] * width;
		let wordsRemaining = info.nextCount;
		let source = info.nextSource & this.OFFSET_MASK;
		let dest = info.nextDest & this.OFFSET_MASK;
		const sourceRegion = info.nextSource >>> this.BASE_OFFSET;
		const destRegion = info.nextDest >>> this.BASE_OFFSET;
		const sourceBlock = this.memory[sourceRegion];
		const destBlock = this.memory[destRegion];
		let sourceView: DataView | null = null;
		let destView: DataView | null = null;
		let sourceMask = 0xFFFFFFFF;
		let destMask = 0xFFFFFFFF;
		let word: number;

		if (destBlock.ICACHE_PAGE_BITS) {
			const endPage = (dest + wordsRemaining * width) >> destBlock.ICACHE_PAGE_BITS;
			for (let i = dest >> destBlock.ICACHE_PAGE_BITS; i <= endPage; ++i) {
				destBlock.invalidatePage(i << destBlock.ICACHE_PAGE_BITS);
			}
		}

		if (
			destRegion === this.REGION_WORKING_RAM ||
			destRegion === this.REGION_WORKING_IRAM
		) {
			destView = destBlock.view!;
			destMask = destBlock.mask!;
		}

		if (
			sourceRegion === this.REGION_WORKING_RAM ||
			sourceRegion === this.REGION_WORKING_IRAM ||
			sourceRegion === this.REGION_CART0 ||
			sourceRegion === this.REGION_CART1
		) {
			sourceView = sourceBlock.view!;
			sourceMask = sourceBlock.mask!;
		}

		if (sourceBlock && destBlock) {
			if (sourceView && destView) {
				if (width === 4) {
					source &= 0xFFFFFFFC;
					dest &= 0xFFFFFFFC;
					while (wordsRemaining--) {
						word = sourceView.getInt32(source & sourceMask);
						destView.setInt32(dest & destMask, word);
						source += sourceOffset;
						dest += destOffset;
					}
				} else {
					while (wordsRemaining--) {
						word = sourceView.getUint16(source & sourceMask);
						destView.setUint16(dest & destMask, word);
						source += sourceOffset;
						dest += destOffset;
					}
				}
			} else if (sourceView) {
				if (width === 4) {
					source &= 0xFFFFFFFC;
					dest &= 0xFFFFFFFC;
					while (wordsRemaining--) {
						word = sourceView.getInt32(source & sourceMask, true);
						destBlock.store32(dest, word);
						source += sourceOffset;
						dest += destOffset;
					}
				} else {
					while (wordsRemaining--) {
						word = sourceView.getUint16(source & sourceMask, true);
						destBlock.store16(dest, word);
						source += sourceOffset;
						dest += destOffset;
					}
				}
			} else {
				if (width === 4) {
					source &= 0xFFFFFFFC;
					dest &= 0xFFFFFFFC;
					while (wordsRemaining--) {
						word = sourceBlock.load32(source);
						destBlock.store32(dest, word);
						source += sourceOffset;
						dest += destOffset;
					}
				} else {
					while (wordsRemaining--) {
						word = sourceBlock.loadU16(source);
						destBlock.store16(dest, word);
						source += sourceOffset;
						dest += destOffset;
					}
				}
			}
		} else {
			this.core.WARN('Invalid DMA');
		}

		if (info.doIrq) {
			info.nextIRQ = this.cpu.cycles + 2;
			info.nextIRQ +=
				width === 4
					? this.waitstates32[sourceRegion] + this.waitstates32[destRegion]
					: this.waitstates[sourceRegion] + this.waitstates[destRegion];
			info.nextIRQ +=
				(info.count - 1) *
				(width === 4
					? this.waitstatesSeq32[sourceRegion] + this.waitstatesSeq32[destRegion]
					: this.waitstatesSeq[sourceRegion] + this.waitstatesSeq[destRegion]);
		}

		info.nextSource = source | (sourceRegion << this.BASE_OFFSET);
		info.nextDest = dest | (destRegion << this.BASE_OFFSET);
		info.nextCount = wordsRemaining;

		if (!info.repeat) {
			info.enable = false;

			// Clear the enable bit in memory
			const io = this.memory[this.REGION_IO];
			io.registers![this.DMA_REGISTER[number]] &= 0x7FE0;
		} else {
			info.nextCount = info.count;
			if (info.dstControl === this.DMA_INCREMENT_RELOAD) {
				info.nextDest = info.dest;
			}
			this.scheduleDma(number, info);
		}
	}

	adjustTimings(word: number): void {
		const sram = word & 0x0003;
		const ws0 = (word & 0x000C) >> 2;
		const ws0seq = (word & 0x0010) >> 4;
		const ws1 = (word & 0x0060) >> 5;
		const ws1seq = (word & 0x0080) >> 7;
		const ws2 = (word & 0x0300) >> 8;
		const ws2seq = (word & 0x0400) >> 10;
		const prefetch = word & 0x4000;

		this.waitstates[this.REGION_CART_SRAM] = this.ROM_WS[sram];
		this.waitstatesSeq[this.REGION_CART_SRAM] = this.ROM_WS[sram];
		this.waitstates32[this.REGION_CART_SRAM] = this.ROM_WS[sram];
		this.waitstatesSeq32[this.REGION_CART_SRAM] = this.ROM_WS[sram];

		this.waitstates[this.REGION_CART0] = this.waitstates[this.REGION_CART0 + 1] = this.ROM_WS[ws0];
		this.waitstates[this.REGION_CART1] = this.waitstates[this.REGION_CART1 + 1] = this.ROM_WS[ws1];
		this.waitstates[this.REGION_CART2] = this.waitstates[this.REGION_CART2 + 1] = this.ROM_WS[ws2];

		this.waitstatesSeq[this.REGION_CART0] = this.waitstatesSeq[this.REGION_CART0 + 1] =
			this.ROM_WS_SEQ[0][ws0seq];
		this.waitstatesSeq[this.REGION_CART1] = this.waitstatesSeq[this.REGION_CART1 + 1] =
			this.ROM_WS_SEQ[1][ws1seq];
		this.waitstatesSeq[this.REGION_CART2] = this.waitstatesSeq[this.REGION_CART2 + 1] =
			this.ROM_WS_SEQ[2][ws2seq];

		this.waitstates32[this.REGION_CART0] = this.waitstates32[this.REGION_CART0 + 1] =
			this.waitstates[this.REGION_CART0] + 1 + this.waitstatesSeq[this.REGION_CART0];
		this.waitstates32[this.REGION_CART1] = this.waitstates32[this.REGION_CART1 + 1] =
			this.waitstates[this.REGION_CART1] + 1 + this.waitstatesSeq[this.REGION_CART1];
		this.waitstates32[this.REGION_CART2] = this.waitstates32[this.REGION_CART2 + 1] =
			this.waitstates[this.REGION_CART2] + 1 + this.waitstatesSeq[this.REGION_CART2];

		this.waitstatesSeq32[this.REGION_CART0] = this.waitstatesSeq32[this.REGION_CART0 + 1] =
			2 * this.waitstatesSeq[this.REGION_CART0] + 1;
		this.waitstatesSeq32[this.REGION_CART1] = this.waitstatesSeq32[this.REGION_CART1 + 1] =
			2 * this.waitstatesSeq[this.REGION_CART1] + 1;
		this.waitstatesSeq32[this.REGION_CART2] = this.waitstatesSeq32[this.REGION_CART2 + 1] =
			2 * this.waitstatesSeq[this.REGION_CART2] + 1;

		if (prefetch) {
			this.waitstatesPrefetch[this.REGION_CART0] =
				this.waitstatesPrefetch[this.REGION_CART0 + 1] = 0;
			this.waitstatesPrefetch[this.REGION_CART1] =
				this.waitstatesPrefetch[this.REGION_CART1 + 1] = 0;
			this.waitstatesPrefetch[this.REGION_CART2] =
				this.waitstatesPrefetch[this.REGION_CART2 + 1] = 0;

			this.waitstatesPrefetch32[this.REGION_CART0] =
				this.waitstatesPrefetch32[this.REGION_CART0 + 1] = 0;
			this.waitstatesPrefetch32[this.REGION_CART1] =
				this.waitstatesPrefetch32[this.REGION_CART1 + 1] = 0;
			this.waitstatesPrefetch32[this.REGION_CART2] =
				this.waitstatesPrefetch32[this.REGION_CART2 + 1] = 0;
		} else {
			this.waitstatesPrefetch[this.REGION_CART0] =
				this.waitstatesPrefetch[this.REGION_CART0 + 1] =
					this.waitstatesSeq[this.REGION_CART0];
			this.waitstatesPrefetch[this.REGION_CART1] =
				this.waitstatesPrefetch[this.REGION_CART1 + 1] =
					this.waitstatesSeq[this.REGION_CART1];
			this.waitstatesPrefetch[this.REGION_CART2] =
				this.waitstatesPrefetch[this.REGION_CART2 + 1] =
					this.waitstatesSeq[this.REGION_CART2];

			this.waitstatesPrefetch32[this.REGION_CART0] =
				this.waitstatesPrefetch32[this.REGION_CART0 + 1] =
					this.waitstatesSeq32[this.REGION_CART0];
			this.waitstatesPrefetch32[this.REGION_CART1] =
				this.waitstatesPrefetch32[this.REGION_CART1 + 1] =
					this.waitstatesSeq32[this.REGION_CART1];
			this.waitstatesPrefetch32[this.REGION_CART2] =
				this.waitstatesPrefetch32[this.REGION_CART2 + 1] =
					this.waitstatesSeq32[this.REGION_CART2];
		}
	}

	saveNeedsFlush(): boolean {
		return this.save.writePending;
	}

	flushSave(): void {
		this.save.writePending = false;
	}

	allocGPIO(rom: ROMView): GameBoyAdvanceGPIO {
		return new GameBoyAdvanceGPIO(this.core, rom);
	}
}
