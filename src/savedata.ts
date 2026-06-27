// Savedata types for GBA.js emulator
// MemoryView base class defined inline; will be replaced when mmu.ts is created.

export class MemoryView {
	buffer: ArrayBuffer;
	view: DataView;
	mask: number;
	mask8!: number;
	mask16!: number;
	mask32!: number;

	// Used by MemoryBlock/ROMView/BIOSView (subclasses in mmu)
	icache?: any[];
	ICACHE_PAGE_BITS: number = 0;
	PAGE_MASK: number = 0;

	constructor(memory: ArrayBuffer, offset?: number) {
		this.buffer = memory;
		this.view = new DataView(this.buffer, typeof offset === 'number' ? offset : 0);
		this.mask = memory.byteLength - 1;
		this.resetMask();
	}

	resetMask(): void {
		this.mask8 = this.mask & 0xFFFFFFFF;
		this.mask16 = this.mask & 0xFFFFFFFE;
		this.mask32 = this.mask & 0xFFFFFFFC;
	}

	load8(offset: number): number {
		return this.view.getInt8(offset & this.mask8);
	}

	load16(offset: number): number {
		return this.view.getInt16(offset & this.mask, true);
	}

	loadU8(offset: number): number {
		return this.view.getUint8(offset & this.mask8);
	}

	loadU16(offset: number): number {
		return this.view.getUint16(offset & this.mask, true);
	}

	load32(offset: number): number {
		const rotate = (offset & 3) << 3;
		const mem = this.view.getInt32(offset & this.mask32, true);
		return (mem >>> rotate) | (mem << (32 - rotate));
	}

	store8(offset: number, value: number): void {
		this.view.setInt8(offset & this.mask8, value);
	}

	store16(offset: number, value: number): void {
		this.view.setInt16(offset & this.mask16, value, true);
	}

	store32(offset: number, value: number): void {
		this.view.setInt32(offset & this.mask32, value, true);
	}

	invalidatePage(address: number): void {}

	replaceData(memory: ArrayBuffer, offset?: number): void {
		this.buffer = memory;
		this.view = new DataView(this.buffer, typeof offset === 'number' ? offset : 0);
		if (this.icache) {
			this.icache = new Array(this.icache.length);
		}
	}
}

export class SRAMSavedata extends MemoryView {
	writePending: boolean = false;

	constructor(size: number) {
		super(new ArrayBuffer(size), 0);
	}

	store8(offset: number, value: number): void {
		this.view.setInt8(offset, value);
		this.writePending = true;
	}

	store16(offset: number, value: number): void {
		this.view.setInt16(offset, value, true);
		this.writePending = true;
	}

	store32(offset: number, value: number): void {
		this.view.setInt32(offset, value, true);
		this.writePending = true;
	}
}

export class FlashSavedata extends MemoryView {
	readonly COMMAND_WIPE = 0x10;
	readonly COMMAND_ERASE_SECTOR = 0x30;
	readonly COMMAND_ERASE = 0x80;
	readonly COMMAND_ID = 0x90;
	readonly COMMAND_WRITE = 0xA0;
	readonly COMMAND_SWITCH_BANK = 0xB0;
	readonly COMMAND_TERMINATE_ID = 0xF0;

	readonly ID_PANASONIC = 0x1B32;
	readonly ID_SANYO = 0x1362;

	id: number;
	bank0: DataView;
	bank1: DataView | null;
	bank: DataView;

	idMode: boolean = false;
	writePending: boolean = false;

	first: number = 0;
	second: number = 0;
	command: number = 0;
	pendingCommand: number = 0;

	constructor(size: number) {
		super(new ArrayBuffer(size), 0);

		this.bank0 = new DataView(this.buffer, 0, 0x00010000);
		if (size > 0x00010000) {
			this.id = this.ID_SANYO;
			this.bank1 = new DataView(this.buffer, 0x00010000);
		} else {
			this.id = this.ID_PANASONIC;
			this.bank1 = null;
		}
		this.bank = this.bank0;
	}

	load8(offset: number): number {
		if (this.idMode && offset < 2) {
			return (this.id >> (offset << 3)) & 0xFF;
		} else if (offset < 0x10000) {
			return this.bank.getInt8(offset);
		} else {
			return 0;
		}
	}

	load16(offset: number): number {
		return (this.load8(offset) & 0xFF) | (this.load8(offset + 1) << 8);
	}

	load32(offset: number): number {
		return (this.load8(offset) & 0xFF) | (this.load8(offset + 1) << 8) | (this.load8(offset + 2) << 16) | (this.load8(offset + 3) << 24);
	}

	loadU8(offset: number): number {
		return this.load8(offset) & 0xFF;
	}

	loadU16(offset: number): number {
		return (this.loadU8(offset) & 0xFF) | (this.loadU8(offset + 1) << 8);
	}

	store8(offset: number, value: number): void {
		switch (this.command) {
		case 0:
			if (offset == 0x5555) {
				if (this.second == 0x55) {
					switch (value) {
					case this.COMMAND_ERASE:
						this.pendingCommand = value;
						break;
					case this.COMMAND_ID:
						this.idMode = true;
						break;
					case this.COMMAND_TERMINATE_ID:
						this.idMode = false;
						break;
					default:
						this.command = value;
						break;
					}
					this.second = 0;
					this.first = 0;
				} else {
					this.command = 0;
					this.first = value;
					this.idMode = false;
				}
			} else if (offset == 0x2AAA && this.first == 0xAA) {
				this.first = 0;
				if (this.pendingCommand) {
					this.command = this.pendingCommand;
				} else {
					this.second = value;
				}
			}
			break;
		case this.COMMAND_ERASE:
			switch (value) {
			case this.COMMAND_WIPE:
				if (offset == 0x5555) {
					for (let i = 0; i < this.view.byteLength; i += 4) {
						this.view.setInt32(i, -1);
					}
				}
				break;
			case this.COMMAND_ERASE_SECTOR:
				if ((offset & 0x0FFF) == 0) {
					for (let i = offset; i < offset + 0x1000; i += 4) {
						this.bank.setInt32(i, -1);
					}
				}
				break;
			}
			this.pendingCommand = 0;
			this.command = 0;
			break;
		case this.COMMAND_WRITE:
			this.bank.setInt8(offset, value);
			this.command = 0;

			this.writePending = true;
			break;
		case this.COMMAND_SWITCH_BANK:
			if (this.bank1 && offset == 0) {
				if (value == 1) {
					this.bank = this.bank1;
				} else {
					this.bank = this.bank0;
				}
			}
			this.command = 0;
			break;
		}
	}

	store16(offset: number, value: number): void {
		throw new Error('Unaligned save to flash!');
	}

	store32(offset: number, value: number): void {
		throw new Error('Unaligned save to flash!');
	}

	replaceData(memory: ArrayBuffer): void {
		const bank = this.view === this.bank1;
		super.replaceData(memory, 0);

		this.bank0 = new DataView(this.buffer, 0, 0x00010000);
		if (memory.byteLength > 0x00010000) {
			this.bank1 = new DataView(this.buffer, 0x00010000);
		} else {
			this.bank1 = null;
		}
		this.bank = (bank && this.bank1) ? this.bank1 : this.bank0;
	}
}

// DMA interface used by EEPROMSavedata
interface DMAInfo {
	enable: boolean;
	count: number;
}

interface MMUForEEPROM {
	core: {
		irq: {
			dma: DMAInfo[];
		};
	};
}

export class EEPROMSavedata extends MemoryView {
	writeAddress: number = 0;
	readBitsRemaining: number = 0;
	readAddress: number = 0;

	command: number = 0;
	commandBitsRemaining: number = 0;

	realSize: number = 0;
	addressBits: number = 0;
	writePending: boolean = false;

	dma: DMAInfo;

	readonly COMMAND_NULL = 0;
	readonly COMMAND_PENDING = 1;
	readonly COMMAND_WRITE = 2;
	readonly COMMAND_READ_PENDING = 3;
	readonly COMMAND_READ = 4;

	constructor(size: number, mmu: MMUForEEPROM) {
		super(new ArrayBuffer(size), 0);

		this.dma = mmu.core.irq.dma[3];
	}

	load8(offset: number): number {
		throw new Error('Unsupported 8-bit access!');
	}

	load16(offset: number): number {
		return this.loadU16(offset);
	}

	loadU8(offset: number): number {
		throw new Error('Unsupported 8-bit access!');
	}

	loadU16(offset: number): number {
		if (this.command != this.COMMAND_READ || !this.dma.enable) {
			return 1;
		}
		--this.readBitsRemaining;
		if (this.readBitsRemaining < 64) {
			const step = 63 - this.readBitsRemaining;
			const data = this.view.getUint8((this.readAddress + step) >> 3) >> (0x7 - (step & 0x7));
			if (!this.readBitsRemaining) {
				this.command = this.COMMAND_NULL;
			}
			return data & 0x1;
		}
		return 0;
	}

	load32(offset: number): number {
		throw new Error('Unsupported 32-bit access!');
	}

	store8(offset: number, value: number): void {
		throw new Error('Unsupported 8-bit access!');
	}

	store16(offset: number, value: number): void {
		switch (this.command) {
		// Read header
		case this.COMMAND_NULL:
		default:
			this.command = value & 0x1;
			break;
		case this.COMMAND_PENDING:
			this.command <<= 1;
			this.command |= value & 0x1;
			if (this.command == this.COMMAND_WRITE) {
				if (!this.realSize) {
					const bits = this.dma.count - 67;
					this.realSize = 8 << bits;
					this.addressBits = bits;
				}
				this.commandBitsRemaining = this.addressBits + 64 + 1;
				this.writeAddress = 0;
			} else {
				if (!this.realSize) {
					const bits = this.dma.count - 3;
					this.realSize = 8 << bits;
					this.addressBits = bits;
				}
				this.commandBitsRemaining = this.addressBits + 1;
				this.readAddress = 0;
			}
			break;
		// Do commands
		case this.COMMAND_WRITE:
			// Write
			if (--this.commandBitsRemaining > 64) {
				this.writeAddress <<= 1;
				this.writeAddress |= (value & 0x1) << 6;
			} else if (this.commandBitsRemaining <= 0) {
				this.command = this.COMMAND_NULL;
				this.writePending = true;
			} else {
				const current = this.view.getUint8(this.writeAddress >> 3);
				const mask = ~(1 << (0x7 - (this.writeAddress & 0x7)));
				const bit = (value & 0x1) << (0x7 - (this.writeAddress & 0x7));
				this.view.setUint8(this.writeAddress >> 3, (current & mask) | bit);
				++this.writeAddress;
			}
			break;
		case this.COMMAND_READ_PENDING:
			// Read
			if (--this.commandBitsRemaining > 0) {
				this.readAddress <<= 1;
				if (value & 0x1) {
					this.readAddress |= 0x40;
				}
			} else {
				this.readBitsRemaining = 68;
				this.command = this.COMMAND_READ;
			}
			break;
		}
	}

	store32(offset: number, value: number): void {
		throw new Error('Unsupported 32-bit access!');
	}

	replaceData(memory: ArrayBuffer): void {
		super.replaceData(memory, 0);
	}
}
