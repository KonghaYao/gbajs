// GPIO (General Purpose I/O) module for GBA.js emulator.
// Handles GPIO port access and the Real-Time Clock (RTC) device.

export class GameBoyAdvanceGPIO {
	// Set externally by MMU
	core!: { WARN: (msg: string) => void };

	// ROM view containing the GPIO register area
	rom!: { view: DataView };

	readWrite: number = 0;
	direction: number = 0;
	device: GameBoyAdvanceRTC;

	constructor(core: { WARN: (msg: string) => void }, rom: { view: DataView }) {
		this.core = core;
		this.rom = rom;

		this.device = new GameBoyAdvanceRTC(this); // TODO: Support more devices
	}

	store16(offset: number, value: number): void {
		switch (offset) {
		case 0xC4:
			this.device.setPins(value & 0xF);
			break;
		case 0xC6:
			this.direction = value & 0xF;
			this.device.setDirection(this.direction);
			break;
		case 0xC8:
			this.readWrite = value & 1;
			break;
		default:
			throw new Error('BUG: Bad offset passed to GPIO: ' + offset.toString(16));
		}
		if (this.readWrite) {
			const old = this.rom.view.getUint16(offset, true);
			const masked = old & ~this.direction;
			this.rom.view.setUint16(offset, masked | (value & this.direction), true);
		}
	}

	outputPins(nybble: number): void {
		if (this.readWrite) {
			const old = this.rom.view.getUint16(0xC4, true);
			const masked = old & this.direction;
			this.rom.view.setUint16(0xC4, masked | (nybble & ~this.direction & 0xF), true);
		}
	}
}

export class GameBoyAdvanceRTC {
	gpio: GameBoyAdvanceGPIO;

	// PINOUT: SCK | SIO | CS | -
	pins: number = 0;
	direction: number = 0;

	totalBytes: number[] = [
		0, // Force reset
		0, // Empty
		7, // Date/Time
		0, // Force IRQ
		1, // Control register
		0, // Empty
		3, // Time
		0, // Empty
	];
	bytesRemaining: number = 0;

	// Transfer sequence:
	// == Initiate
	// > HI | - | LO | -
	// > HI | - | HI | -
	// == Transfer bit (x8)
	// > LO | x | HI | -
	// > HI | - | HI | -
	// < ?? | x | ?? | -
	// == Terminate
	// >  - | - | LO | -
	transferStep: number = 0;

	reading: number = 0;
	bitsRead: number = 0;
	bits: number = 0;
	command: number = -1;

	control: number = 0x40;
	time: number[] = [
		0, // Year
		0, // Month
		0, // Day
		0, // Day of week
		0, // Hour
		0, // Minute
		0, // Second
	];

	constructor(gpio: GameBoyAdvanceGPIO) {
		this.gpio = gpio;
	}

	setPins(nybble: number): void {
		switch (this.transferStep) {
		case 0:
			if ((nybble & 5) == 1) {
				this.transferStep = 1;
			}
			break;
		case 1:
			if (nybble & 4) {
				this.transferStep = 2;
			}
			break;
		case 2:
			if (!(nybble & 1)) {
				this.bits &= ~(1 << this.bitsRead);
				this.bits |= ((nybble & 2) >> 1) << this.bitsRead;
			} else {
				if (nybble & 4) {
					// SIO direction should always != this.read
					if ((this.direction & 2) && !this.reading) {
						++this.bitsRead;
						if (this.bitsRead == 8) {
							this.processByte();
						}
					} else {
						this.gpio.outputPins(5 | (this.sioOutputPin() << 1));
						++this.bitsRead;
						if (this.bitsRead == 8) {
							--this.bytesRemaining;
							if (this.bytesRemaining <= 0) {
								this.command = -1;
							}
							this.bitsRead = 0;
						}
					}
				} else {
					this.bitsRead = 0;
					this.bytesRemaining = 0;
					this.command = -1;
					this.transferStep = 0;
				}
			}
			break;
		}

		this.pins = nybble & 7;
	}

	setDirection(direction: number): void {
		this.direction = direction;
	}

	processByte(): void {
		--this.bytesRemaining;
		switch (this.command) {
		case -1:
			if ((this.bits & 0x0F) == 0x06) {
				this.command = (this.bits >> 4) & 7;
				this.reading = this.bits & 0x80;

				this.bytesRemaining = this.totalBytes[this.command];
				switch (this.command) {
				case 0:
					this.control = 0;
					break;
				case 2:
				case 6:
					this.updateClock();
					break;
				}
			} else {
				this.gpio.core.WARN('Invalid RTC command byte: ' + this.bits.toString(16));
			}
			break;
		case 4:
			// Control
			this.control = this.bits & 0x40;
			break;
		}
		this.bits = 0;
		this.bitsRead = 0;
		if (!this.bytesRemaining) {
			this.command = -1;
		}
	}

	sioOutputPin(): number {
		let outputByte = 0;
		switch (this.command) {
		case 4:
			outputByte = this.control;
			break;
		case 2:
		case 6:
			outputByte = this.time[7 - this.bytesRemaining];
			break;
		}
		const output = (outputByte >> this.bitsRead) & 1;
		return output;
	}

	updateClock(): void {
		const date = new Date();
		this.time[0] = this.bcd(date.getFullYear());
		this.time[1] = this.bcd(date.getMonth() + 1);
		this.time[2] = this.bcd(date.getDate());
		this.time[3] = date.getDay() - 1;
		if (this.time[3] < 0) {
			this.time[3] = 6;
		}
		if (this.control & 0x40) {
			// 24 hour
			this.time[4] = this.bcd(date.getHours());
		} else {
			this.time[4] = this.bcd(date.getHours() % 2);
			if (date.getHours() >= 12) {
				this.time[4] |= 0x80;
			}
		}
		this.time[5] = this.bcd(date.getMinutes());
		this.time[6] = this.bcd(date.getSeconds());
	}

	bcd(binary: number): number {
		let counter = binary % 10;
		const divided = Math.floor(binary / 10);
		counter += (divided % 10) << 4;
		return counter;
	}
}
