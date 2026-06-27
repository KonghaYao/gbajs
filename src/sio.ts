import { hex } from './util.js';

/** Minimal interface for the GameBoyAdvance core. Set externally by GameBoyAdvance. */
interface GameBoyAdvanceCore {
	INFO(msg: string): void;
	STUB(msg: string): void;
	WARN(msg: string): void;
}

interface SIOGamepadButton {
	value: number;
}

export class GameBoyAdvanceSIO {
	SIO_NORMAL_8: number = 0;
	SIO_NORMAL_32: number = 1;
	SIO_MULTI: number = 2;
	SIO_UART: number = 3;
	SIO_GPIO: number = 8;
	SIO_JOYBUS: number = 12;

	BAUD: number[] = [9600, 38400, 57600, 115200];

	// Set externally by GameBoyAdvance
	core!: GameBoyAdvanceCore;

	mode: number = 0;
	sd: boolean = false;
	irq: boolean = false;
	multiplayer: {
		baud: number;
		si: number;
		id: number;
		error: number;
		busy: number;
		states: number[];
	} = {
		baud: 0,
		si: 0,
		id: 0,
		error: 0,
		busy: 0,
		states: [0xffff, 0xffff, 0xffff, 0xffff],
	};

	linkLayer: {
		setBaud(baud: number): void;
		startMultiplayerTransfer(): void;
	} | null = null;

	clear(): void {
		this.mode = this.SIO_GPIO;
		this.sd = false;

		this.irq = false;
		this.multiplayer = {
			baud: 0,
			si: 0,
			id: 0,
			error: 0,
			busy: 0,
			states: [0xffff, 0xffff, 0xffff, 0xffff],
		};

		this.linkLayer = null;
	}

	setMode(mode: number): void {
		if (mode & 0x8) {
			mode &= 0xc;
		} else {
			mode &= 0x3;
		}
		this.mode = mode;

		this.core.INFO('Setting SIO mode to ' + hex(mode, 1));
	}

	writeRCNT(_value: number): void {
		if (this.mode !== this.SIO_GPIO) {
			return;
		}

		this.core.STUB('General purpose serial not supported');
	}

	writeSIOCNT(value: number): void {
		switch (this.mode) {
		case this.SIO_NORMAL_8:
			this.core.STUB('8-bit transfer unsupported');
			break;
		case this.SIO_NORMAL_32:
			this.core.STUB('32-bit transfer unsupported');
			break;
		case this.SIO_MULTI:
			this.multiplayer.baud = value & 0x0003;
			if (this.linkLayer) {
				this.linkLayer.setBaud(this.BAUD[this.multiplayer.baud]);
			}

			if (!this.multiplayer.si) {
				this.multiplayer.busy = value & 0x0080;
				if (this.linkLayer && this.multiplayer.busy) {
					this.linkLayer.startMultiplayerTransfer();
				}
			}
			this.irq = !!(value & 0x4000);
			break;
		case this.SIO_UART:
			this.core.STUB('UART unsupported');
			break;
		case this.SIO_GPIO:
			// This register isn't used in general-purpose mode
			break;
		case this.SIO_JOYBUS:
			this.core.STUB('JOY BUS unsupported');
			break;
		}
	}

	readSIOCNT(): number {
		let value = (this.mode << 12) & 0xffff;
		switch (this.mode) {
		case this.SIO_NORMAL_8:
			this.core.STUB('8-bit transfer unsupported');
			break;
		case this.SIO_NORMAL_32:
			this.core.STUB('32-bit transfer unsupported');
			break;
		case this.SIO_MULTI:
			value |= this.multiplayer.baud;
			value |= this.multiplayer.si;
			value |= (this.sd ? 1 : 0) << 3;
			value |= this.multiplayer.id << 4;
			value |= this.multiplayer.error;
			value |= this.multiplayer.busy;
			value |= (this.irq ? 1 : 0) << 14;
			break;
		case this.SIO_UART:
			this.core.STUB('UART unsupported');
			break;
		case this.SIO_GPIO:
			// This register isn't used in general-purpose mode
			break;
		case this.SIO_JOYBUS:
			this.core.STUB('JOY BUS unsupported');
			break;
		}
		return value;
	}

	read(slot: number): number {
		switch (this.mode) {
		case this.SIO_NORMAL_32:
			this.core.STUB('32-bit transfer unsupported');
			break;
		case this.SIO_MULTI:
			return this.multiplayer.states[slot];
		case this.SIO_UART:
			this.core.STUB('UART unsupported');
			break;
		default:
			this.core.WARN('Reading from transfer register in unsupported mode');
			break;
		}
		return 0;
	}
}
