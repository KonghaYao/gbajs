/**
 * GBA.js Debug Console
 * Provides Console, Memory, PaletteViewer, and TileViewer classes
 * for the debug console HTML page.
 */
import { hex } from './util.js';

// ---- Interfaces for GBA subsystem types used by Console ----

interface CPULike {
	gprs: Int32Array;
	readonly PC: number;
	readonly MODE_USER: number;
	readonly MODE_IRQ: number;
	readonly MODE_FIQ: number;
	readonly MODE_SUPERVISOR: number;
	readonly MODE_ABORT: number;
	readonly MODE_UNDEFINED: number;
	readonly MODE_SYSTEM: number;
	mode: number;
	cpsrN: number | boolean;
	cpsrZ: number | boolean;
	cpsrC: number | boolean;
	cpsrV: number | boolean;
	cpsrI: number | boolean;
	execMode: number;
	step(): void;
}

interface MMULike {
	loadU8(address: number): number;
}

interface PaletteLike {
	loadU16(offset: number): number;
}

interface VRamLike {
	load32(offset: number): number;
}

interface RenderPathLike {
	palette: PaletteLike;
	vram: VRamLike;
}

interface VideoLike {
	renderPath: RenderPathLike;
}

export interface GBALike {
	cpu: CPULike;
	mmu: MMULike;
	video: VideoLike;
	LOG_ERROR: number;
	LOG_WARN: number;
	LOG_STUB: number;
	LOG_INFO: number;
	LOG_DEBUG: number;
	setLogger(logger: (level: number, message: string) => void): void;
	doStep: () => boolean;
	waitFrame(): boolean;
	runStable(): void;
	pause(): void;
	step(): void;
}

// ---- Console ----

export class Console {
	cpu: CPULike;
	gba: GBALike;
	ul: HTMLElement;
	gprs: HTMLElement;
	memory: Memory;
	breakpoints: boolean[];
	logQueue: string[];
	activeView: PaletteViewer | TileViewer | null;
	paletteView: PaletteViewer;
	tileView: TileViewer;
	stillRunning: boolean = false;

	constructor(gba: GBALike) {
		this.cpu = gba.cpu;
		this.gba = gba;
		this.ul = document.getElementById('console')!;
		this.gprs = document.getElementById('gprs')!;
		this.memory = new Memory(gba.mmu);
		this.breakpoints = [];
		this.logQueue = [];

		this.activeView = null;
		this.paletteView = new PaletteViewer(gba.video.renderPath.palette);
		this.tileView = new TileViewer(gba.video.renderPath.vram, gba.video.renderPath.palette);
		this.update();

		const self = this;
		gba.setLogger(function (level: number, message: string) { self.log(level, message); });
		this.gba.doStep = function () { return self.testBreakpoints(); };
	}

	updateGPRs(): void {
		for (let i = 0; i < 16; ++i) {
			(this.gprs.children[i] as HTMLElement).textContent = hex(this.cpu.gprs[i]);
		}
	}

	updateCPSR(): void {
		const cpu = this.cpu;
		const bit = function (psr: string, member: string) {
			const element = document.getElementById(psr)!;
			if ((cpu as any)[member]) {
				element.removeAttribute('class');
			} else {
				element.setAttribute('class', 'disabled');
			}
		};
		bit('cpsrN', 'cpsrN');
		bit('cpsrZ', 'cpsrZ');
		bit('cpsrC', 'cpsrC');
		bit('cpsrV', 'cpsrV');
		bit('cpsrI', 'cpsrI');
		bit('cpsrT', 'execMode');

		const mode = document.getElementById('mode')!;
		switch (cpu.mode) {
		case cpu.MODE_USER:
			mode.textContent = 'USER';
			break;
		case cpu.MODE_IRQ:
			mode.textContent = 'IRQ';
			break;
		case cpu.MODE_FIQ:
			mode.textContent = 'FIQ';
			break;
		case cpu.MODE_SUPERVISOR:
			mode.textContent = 'SVC';
			break;
		case cpu.MODE_ABORT:
			mode.textContent = 'ABORT';
			break;
		case cpu.MODE_UNDEFINED:
			mode.textContent = 'UNDEFINED';
			break;
		case cpu.MODE_SYSTEM:
			mode.textContent = 'SYSTEM';
			break;
		default:
			mode.textContent = '???';
			break;
		}
	}

	log(level: number, message: string): void {
		switch (level) {
		case this.gba.LOG_ERROR:
			message = '[ERROR] ' + message;
			break;
		case this.gba.LOG_WARN:
			message = '[WARN] ' + message;
			break;
		case this.gba.LOG_STUB:
			message = '[STUB] ' + message;
			break;
		case this.gba.LOG_INFO:
			message = '[INFO] ' + message;
			break;
		case this.gba.LOG_DEBUG:
			message = '[DEBUG] ' + message;
			break;
		}
		this.logQueue.push(message);
		if (level === this.gba.LOG_ERROR) {
			this.pause();
		}
		if (!this.stillRunning) {
			this.flushLog();
		}
	}

	flushLog(): void {
		const doScroll = this.ul.scrollTop === this.ul.scrollHeight - this.ul.offsetHeight;
		while (this.logQueue.length) {
			const entry = document.createElement('li');
			entry.textContent = this.logQueue.shift()!;
			this.ul.appendChild(entry);
		}
		if (doScroll) {
			const ul = this.ul;
			let last = ul.scrollTop;
			const scrollUp = function () {
				if (ul.scrollTop === last) {
					ul.scrollTop = (ul.scrollHeight - ul.offsetHeight) * 0.2 + last * 0.8;
					last = ul.scrollTop;
					if (last !== ul.scrollHeight - ul.offsetHeight) {
						setTimeout(scrollUp, 25);
					}
				}
			};
			setTimeout(scrollUp, 25);
		}
	}

	update(): void {
		this.updateGPRs();
		this.updateCPSR();
		this.memory.refreshAll();
		if (this.activeView) {
			this.activeView.redraw();
		}
	}

	setView(view: PaletteViewer | TileViewer | null): void {
		const container = document.getElementById('debugViewer')!;
		while (container.hasChildNodes()) {
			container.removeChild(container.lastChild!);
		}
		if (view) {
			view.insertChildren(container);
			view.redraw();
		}
		this.activeView = view;
	}

	step(): void {
		try {
			this.cpu.step();
			this.update();
		} catch (exception) {
			this.log(this.gba.LOG_DEBUG, String(exception));
			throw exception;
		}
	}

	runVisible(): void {
		if (this.stillRunning) {
			return;
		}

		this.stillRunning = true;
		const self = this;
		const run = function () {
			if (self.stillRunning) {
				try {
					self.step();
					if (self.breakpoints.length && self.breakpoints[self.cpu.gprs[self.cpu.PC]]) {
						self.breakpointHit();
						return;
					}
					self.flushLog();
					setTimeout(run, 0);
				} catch (exception) {
					self.log(self.gba.LOG_DEBUG, String(exception));
					self.pause();
					throw exception;
				}
			}
		};
		setTimeout(run, 0);
	}

	run(): void {
		if (this.stillRunning) {
			return;
		}

		this.stillRunning = true;
		const regs = document.getElementById('registers')!;
		const mem = document.getElementById('memory')!;
		regs.setAttribute('class', 'disabled');
		mem.setAttribute('class', 'disabled');
		this.gba.runStable();
	}

	runFrame(): void {
		if (this.stillRunning) {
			return;
		}

		this.stillRunning = true;
		const regs = document.getElementById('registers')!;
		const mem = document.getElementById('memory')!;
		regs.setAttribute('class', 'disabled');
		mem.setAttribute('class', 'disabled');
		const self = this;
		const run = function () {
			self.gba.step();
			self.pause();
		};
		setTimeout(run, 0);
	}

	pause(): void {
		this.stillRunning = false;
		this.gba.pause();
		const regs = document.getElementById('registers')!;
		const mem = document.getElementById('memory')!;
		mem.removeAttribute('class');
		regs.removeAttribute('class');
		this.update();
		this.flushLog();
	}

	breakpointHit(): void {
		this.pause();
		this.log(this.gba.LOG_DEBUG, 'Hit breakpoint at ' + hex(this.cpu.gprs[this.cpu.PC]));
	}

	addBreakpoint(addr: number): void {
		this.breakpoints[addr] = true;
		let bpLi = document.getElementById('bp' + addr);
		if (!bpLi) {
			bpLi = document.createElement('li');
			(bpLi as any).address = addr;
			const cb = document.createElement('input');
			cb.setAttribute('type', 'checkbox');
			cb.setAttribute('checked', 'checked');
			const self = this;
			cb.addEventListener('click', function () {
				self.breakpoints[addr] = cb.checked;
			}, false);
			bpLi.appendChild(cb);
			bpLi.appendChild(document.createTextNode(hex(addr)));
			document.getElementById('breakpointView')!.appendChild(bpLi);
		}
	}

	testBreakpoints(): boolean {
		if (this.breakpoints.length && this.breakpoints[this.cpu.gprs[this.cpu.PC]]) {
			this.breakpointHit();
			return false;
		}
		return this.gba.waitFrame();
	}
}

// ---- Memory ----

interface MemoryRow extends HTMLLIElement {
	offset: number;
	oldOffset: number;
}

export class Memory {
	mmu: MMULike;
	ul: HTMLElement;
	rowHeight: number;
	numberRows: number;
	scrollTop: number;

	constructor(mmu: MMULike) {
		this.mmu = mmu;
		this.ul = document.getElementById('memoryView')!;
		const row = this.createRow(0);
		this.ul.appendChild(row);
		this.rowHeight = row.offsetHeight;
		this.numberRows = Math.floor((this.ul.parentNode as HTMLElement).offsetHeight / this.rowHeight) + 2;
		this.ul.removeChild(row);
		this.scrollTop = 50 - (this.ul.parentElement!.firstElementChild as HTMLElement).offsetHeight;

		for (let i = 0; i < this.numberRows; ++i) {
			this.ul.appendChild(this.createRow(i << 4));
		}
		this.ul.parentElement!.scrollTop = this.scrollTop;

		const self = this;
		this.ul.parentElement!.addEventListener('scroll', function (e: Event) { self.scroll(e); }, true);
		window.addEventListener('resize', function () { self.resize(); }, true);
	}

	scroll(e: Event): void {
		while ((this.ul.parentElement!.scrollTop - this.scrollTop) < this.rowHeight) {
			if ((this.ul.firstChild as MemoryRow).offset === 0) {
				break;
			}
			const victim = this.ul.lastChild as MemoryRow;
			this.ul.removeChild(victim);
			victim.offset = (this.ul.firstChild as MemoryRow).offset - 16;
			this.refresh(victim);
			this.ul.insertBefore(victim, this.ul.firstChild);
			this.ul.parentElement!.scrollTop += this.rowHeight;
		}
		while ((this.ul.parentElement!.scrollTop - this.scrollTop) > this.rowHeight * 2) {
			const victim = this.ul.firstChild as MemoryRow;
			this.ul.removeChild(victim);
			victim.offset = (this.ul.lastChild as MemoryRow).offset + 16;
			this.refresh(victim);
			this.ul.appendChild(victim);
			this.ul.parentElement!.scrollTop -= this.rowHeight;
		}
		if (this.ul.parentElement!.scrollTop < this.scrollTop) {
			this.ul.parentElement!.scrollTop = this.scrollTop;
			e.preventDefault();
		}
	}

	resize(): void {
		this.numberRows = Math.floor((this.ul.parentNode as HTMLElement).offsetHeight / this.rowHeight) + 2;
		if (this.numberRows > this.ul.children.length) {
			let offset = (this.ul.lastChild as MemoryRow).offset + 16;
			for (let i = 0; i < this.numberRows - this.ul.children.length; ++i) {
				const row = this.createRow(offset);
				this.refresh(row);
				this.ul.appendChild(row);
				offset += 16;
			}
		} else {
			for (let i = 0; i < this.ul.children.length - this.numberRows; ++i) {
				this.ul.removeChild(this.ul.lastChild!);
			}
		}
	}

	refresh(row: MemoryRow): void {
		let showChanged: boolean;
		let newValue: number;
		let child: Element;
		row.firstChild!.textContent = hex(row.offset);
		if (row.oldOffset === row.offset) {
			showChanged = true;
		} else {
			row.oldOffset = row.offset;
			showChanged = false;
		}
		for (let i = 0; i < 16; ++i) {
			child = row.children[i + 1];
			try {
				newValue = this.mmu.loadU8(row.offset + i);
				if (newValue >= 0) {
					const hexValue = hex(newValue, 2, false);
					if (child.textContent === hexValue) {
						child.setAttribute('class', 'memoryCell');
					} else if (showChanged) {
						child.setAttribute('class', 'memoryCell changed');
						child.textContent = hexValue;
					} else {
						child.setAttribute('class', 'memoryCell');
						child.textContent = hexValue;
					}
				} else {
					child.setAttribute('class', 'memoryCell');
					child.textContent = '--';
				}
			} catch (_exception) {
				child.setAttribute('class', 'memoryCell');
				child.textContent = '--';
			}
		}
	}

	refreshAll(): void {
		for (let i = 0; i < this.ul.children.length; ++i) {
			this.refresh(this.ul.children[i] as MemoryRow);
		}
	}

	createRow(startOffset: number): MemoryRow {
		const li = document.createElement('li') as MemoryRow;
		const offset = document.createElement('span');
		offset.setAttribute('class', 'memoryOffset');
		offset.textContent = hex(startOffset);
		li.appendChild(offset);

		for (let i = 0; i < 16; ++i) {
			const b = document.createElement('span');
			b.textContent = '00';
			b.setAttribute('class', 'memoryCell');
			li.appendChild(b);
		}
		li.offset = startOffset;
		li.oldOffset = startOffset;
		return li;
	}

	scrollTo(offset: number): void {
		offset &= 0xFFFFFFF0;
		if (offset) {
			for (let i = 0; i < this.ul.children.length; ++i) {
				const child = this.ul.children[i] as MemoryRow;
				child.offset = offset + (i - 1) * 16;
				this.refresh(child);
			}
			this.ul.parentElement!.scrollTop = this.scrollTop + this.rowHeight;
		} else {
			for (let i = 0; i < this.ul.children.length; ++i) {
				const child = this.ul.children[i] as MemoryRow;
				child.offset = offset + i * 16;
				this.refresh(child);
			}
			this.ul.parentElement!.scrollTop = this.scrollTop;
		}
	}
}

// ---- PaletteViewer ----

export class PaletteViewer {
	palette: PaletteLike;
	view: HTMLCanvasElement;

	constructor(palette: PaletteLike) {
		this.palette = palette;
		this.view = document.createElement('canvas');
		this.view.setAttribute('class', 'paletteView');
		this.view.setAttribute('width', '240');
		this.view.setAttribute('height', '500');
	}

	insertChildren(container: HTMLElement): void {
		container.appendChild(this.view);
	}

	redraw(): void {
		const context = this.view.getContext('2d')!;
		context.clearRect(0, 0, this.view.width, this.view.height);
		for (let p = 0; p < 2; ++p) {
			for (let y = 0; y < 16; ++y) {
				for (let x = 0; x < 16; ++x) {
					const color = this.palette.loadU16((p * 256 + y * 16 + x) * 2);
					const r = (color & 0x001F) << 3;
					const g = (color & 0x03E0) >> 2;
					const b = (color & 0x7C00) >> 7;
					context.fillStyle = '#' + hex(r, 2, false) + hex(g, 2, false) + hex(b, 2, false);
					context.fillRect(x * 15 + 1, y * 15 + p * 255 + 1, 13, 13);
				}
			}
		}
	}
}

// ---- TileViewer ----

export class TileViewer {
	readonly BG_MAP_WIDTH = 256;
	vram: VRamLike;
	palette: PaletteLike;
	view: HTMLCanvasElement;
	activePalette: number;

	constructor(vram: VRamLike, palette: PaletteLike) {
		this.vram = vram;
		this.palette = palette;

		this.view = document.createElement('canvas');
		this.view.setAttribute('class', 'tileView');
		this.view.setAttribute('width', '256');
		this.view.setAttribute('height', '512');

		this.activePalette = 0;
	}

	insertChildren(container: HTMLElement): void {
		container.appendChild(this.view);
	}

	redraw(): void {
		const context = this.view.getContext('2d')!;
		const data = context.createImageData(this.BG_MAP_WIDTH, 512);
		let t = 0;
		for (let y = 0; y < 512; y += 8) {
			for (let x = 0; x < this.BG_MAP_WIDTH; x += 8) {
				this.drawTile(data.data, t, this.activePalette, x + y * this.BG_MAP_WIDTH, this.BG_MAP_WIDTH);
				++t;
			}
		}
		context.putImageData(data, 0, 0);
	}

	drawTile(data: Uint8ClampedArray, tile: number, palette: number, offset: number, stride: number): void {
		for (let j = 0; j < 8; ++j) {
			let memOffset = tile << 5;
			memOffset |= j << 2;

			const row = this.vram.load32(memOffset);
			for (let i = 0; i < 8; ++i) {
				const index = (row >> (i << 2)) & 0xF;
				const color = this.palette.loadU16((index << 1) + (palette << 5));
				const r = (color & 0x001F) << 3;
				const g = (color & 0x03E0) >> 2;
				const b = (color & 0x7C00) >> 7;
				data[(offset + i + stride * j) * 4 + 0] = r;
				data[(offset + i + stride * j) * 4 + 1] = g;
				data[(offset + i + stride * j) * 4 + 2] = b;
				data[(offset + i + stride * j) * 4 + 3] = 255;
			}
		}
	}
}
