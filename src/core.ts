import { ARMCoreArm } from './arm.js';
import { ARMCoreThumb } from './thumb.js';

// Forward reference - will be properly typed when mmu.ts and irq.ts are available
// These interfaces must be structurally compatible with arm.ts/thumb.ts CPU interface
interface DMAInfo {
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

interface MMUInterface {
  BASE_OFFSET: number;
  OFFSET_MASK: number;
  addressToPage(region: number, address: number): number;
  memory: MemoryView[];
  accessPage(region: number, pageId: number): Page;
  load32(address: number): number;
  load16(address: number): number;
  wait32(address: number): void;
  waitPrefetch32(address: number): void;
  wait(address: number): void;
  waitPrefetch(address: number): void;
  waitMulti32(address: number, total: number): void;
  waitSeq32(address: number): void;
  waitMul(address: number): void;
  loadU8(address: number): number;
  loadU16(address: number): number;
  load8(address: number): number;
  store32(address: number, value: number): void;
  store16(address: number, value: number): void;
  store8(address: number, value: number): void;
  // Properties used by IO/IRQ modules
  SIZE_IO: number;
  adjustTimings(value: number): void;
  badMemory: { loadU16(offset: number): number };
  scheduleDma(number: number, info: DMAInfo): void;
}

interface IRQInterface {
  clear(): void;
  updateTimers(): void;
  testIRQ(): void;
  FREQUENCY: number;
  swi32(immediate: number): void;
  swi(immediate: number): void;
  // Properties used by IO module
  timerRead(timer: number): number;
  timerSetReload(timer: number, v: number): void;
  timerWriteControl(timer: number, v: number): void;
  dmaSetSourceAddress(dma: number, value: number): void;
  dmaSetDestAddress(dma: number, value: number): void;
  dmaSetWordCount(dma: number, v: number): void;
  dmaWriteControl(dma: number, v: number): void;
  setInterruptsEnabled(v: number): void;
  dismissIRQs(v: number): void;
  masterEnable(v: number): void;
  halt(): void;
}

interface MemoryView {
  ICACHE_PAGE_BITS: number;
  PAGE_MASK: number;
  icache: Page[];
}

interface Page {
  thumb: (InstructionFn | null)[];
  arm: (InstructionFn | null)[];
  invalid: boolean;
}

// Matches the InstructionFn definition in arm.ts/thumb.ts for structural compatibility
interface InstructionFn {
  (): void;
  writesPC?: number | boolean;
  fixedJump?: boolean;
  next?: InstructionFn | null;
  page?: { invalid: boolean };
  address?: number;
  opcode?: number;
  execMode?: number;
}

interface FrostState {
  gprs: number[];
  mode: number;
  cpsrI: number;
  cpsrF: number;
  cpsrV: number;
  cpsrC: number;
  cpsrZ: number;
  cpsrN: number;
  bankedRegisters: number[][];
  spsr: number;
  bankedSPSRs: number[];
  cycles: number;
}

export class ARMCore {
  readonly SP = 13;
  readonly LR = 14;
  readonly PC = 15;

  readonly MODE_ARM = 0;
  readonly MODE_THUMB = 1;

  readonly MODE_USER = 0x10;
  readonly MODE_FIQ = 0x11;
  readonly MODE_IRQ = 0x12;
  readonly MODE_SUPERVISOR = 0x13;
  readonly MODE_ABORT = 0x17;
  readonly MODE_UNDEFINED = 0x1b;
  readonly MODE_SYSTEM = 0x1f;

  readonly BANK_NONE = 0;
  readonly BANK_FIQ = 1;
  readonly BANK_IRQ = 2;
  readonly BANK_SUPERVISOR = 3;
  readonly BANK_ABORT = 4;
  readonly BANK_UNDEFINED = 5;

  readonly UNALLOC_MASK = 0x0fffff00;
  readonly USER_MASK = 0xf0000000;
  readonly PRIV_MASK = 0x000000cf; // This is out of spec, but it seems to be what's done in other implementations
  readonly STATE_MASK = 0x00000020;

  readonly WORD_SIZE_ARM = 4;
  readonly WORD_SIZE_THUMB = 2;

  readonly BASE_RESET = 0x00000000;
  readonly BASE_UNDEF = 0x00000004;
  readonly BASE_SWI = 0x00000008;
  readonly BASE_PABT = 0x0000000c;
  readonly BASE_DABT = 0x00000010;
  readonly BASE_IRQ = 0x00000018;
  readonly BASE_FIQ = 0x0000001c;

  armCompiler!: ARMCoreArm;
  thumbCompiler!: ARMCoreThumb;

  gprs: Int32Array;

  // Set externally by GameBoyAdvance
  mmu!: MMUInterface;
  irq!: IRQInterface;

  // Initialized in resetCPU
  loadInstruction!: (address: number) => InstructionFn;
  execMode!: number;
  instructionWidth!: number;
  mode!: number;
  cpsrI!: number;
  cpsrF!: number;
  cpsrV!: number;
  cpsrC!: number;
  cpsrZ!: number;
  cpsrN!: number;
  bankedRegisters!: Int32Array[];
  spsr!: number;
  bankedSPSRs!: Int32Array;
  cycles!: number;
  shifterOperand!: number;
  shifterCarryOut!: number;
  page!: Page | null;
  pageId!: number;
  pageRegion!: number;
  instruction!: InstructionFn | null;
  step!: () => void;
  conditionPassed!: boolean;
  pageMask!: number;

  conds!: ((() => boolean) | null)[];

  constructor() {
    this.gprs = new Int32Array(16);

    this.armCompiler = new ARMCoreArm(this);
    this.thumbCompiler = new ARMCoreThumb(this);
    this.generateConds();
  }

  resetCPU(startOffset: number): void {
    for (var i = 0; i < this.PC; ++i) {
      this.gprs[i] = 0;
    }
    this.gprs[this.PC] = startOffset + this.WORD_SIZE_ARM;

    this.loadInstruction = this.loadInstructionArm;
    this.execMode = this.MODE_ARM;
    this.instructionWidth = this.WORD_SIZE_ARM;

    this.mode = this.MODE_SYSTEM;

    this.cpsrI = 0;
    this.cpsrF = 0;

    this.cpsrV = 0;
    this.cpsrC = 0;
    this.cpsrZ = 0;
    this.cpsrN = 0;

    this.bankedRegisters = [
      new Int32Array(7),
      new Int32Array(7),
      new Int32Array(2),
      new Int32Array(2),
      new Int32Array(2),
      new Int32Array(2),
    ];
    this.spsr = 0;
    this.bankedSPSRs = new Int32Array(6);

    this.cycles = 0;

    this.shifterOperand = 0;
    this.shifterCarryOut = 0;

    this.page = null;
    this.pageId = 0;
    this.pageRegion = -1;

    this.instruction = null;

    this.irq.clear();

    var gprs = this.gprs;
    var mmu = this.mmu;
    this.step = function () {
      var instruction =
        this.instruction ||
        (this.instruction = this.loadInstruction(
          gprs[this.PC] - this.instructionWidth
        ));
      gprs[this.PC] += this.instructionWidth;
      this.conditionPassed = true;
      instruction();

      if (!instruction.writesPC) {
        if (this.instruction != null) {
          // We might have gotten an interrupt from the instruction
          if (
            instruction.next == null ||
            instruction.next.page!.invalid
          ) {
            instruction.next = this.loadInstruction(
              gprs[this.PC] - this.instructionWidth
            );
          }
          this.instruction = instruction.next;
        }
      } else {
        if (this.conditionPassed) {
          var pc = (gprs[this.PC] &= 0xfffffffe);
          if (this.execMode == this.MODE_ARM) {
            mmu.wait32(pc);
            mmu.waitPrefetch32(pc);
          } else {
            mmu.wait(pc);
            mmu.waitPrefetch(pc);
          }
          gprs[this.PC] += this.instructionWidth;
          if (!instruction.fixedJump) {
            this.instruction = null;
          } else if (this.instruction != null) {
            if (
              instruction.next == null ||
              instruction.next.page!.invalid
            ) {
              instruction.next = this.loadInstruction(
                gprs[this.PC] - this.instructionWidth
              );
            }
            this.instruction = instruction.next;
          }
        } else {
          this.instruction = null;
        }
      }
      this.irq.updateTimers();
    };
  }

  freeze(): FrostState {
    return {
      gprs: [
        this.gprs[0],
        this.gprs[1],
        this.gprs[2],
        this.gprs[3],
        this.gprs[4],
        this.gprs[5],
        this.gprs[6],
        this.gprs[7],
        this.gprs[8],
        this.gprs[9],
        this.gprs[10],
        this.gprs[11],
        this.gprs[12],
        this.gprs[13],
        this.gprs[14],
        this.gprs[15],
      ],
      mode: this.mode,
      cpsrI: this.cpsrI,
      cpsrF: this.cpsrF,
      cpsrV: this.cpsrV,
      cpsrC: this.cpsrC,
      cpsrZ: this.cpsrZ,
      cpsrN: this.cpsrN,
      bankedRegisters: [
        [
          this.bankedRegisters[0][0],
          this.bankedRegisters[0][1],
          this.bankedRegisters[0][2],
          this.bankedRegisters[0][3],
          this.bankedRegisters[0][4],
          this.bankedRegisters[0][5],
          this.bankedRegisters[0][6],
        ],
        [
          this.bankedRegisters[1][0],
          this.bankedRegisters[1][1],
          this.bankedRegisters[1][2],
          this.bankedRegisters[1][3],
          this.bankedRegisters[1][4],
          this.bankedRegisters[1][5],
          this.bankedRegisters[1][6],
        ],
        [this.bankedRegisters[2][0], this.bankedRegisters[2][1]],
        [this.bankedRegisters[3][0], this.bankedRegisters[3][1]],
        [this.bankedRegisters[4][0], this.bankedRegisters[4][1]],
        [this.bankedRegisters[5][0], this.bankedRegisters[5][1]],
      ],
      spsr: this.spsr,
      bankedSPSRs: [
        this.bankedSPSRs[0],
        this.bankedSPSRs[1],
        this.bankedSPSRs[2],
        this.bankedSPSRs[3],
        this.bankedSPSRs[4],
        this.bankedSPSRs[5],
      ],
      cycles: this.cycles,
    };
  }

  defrost(frost: FrostState): void {
    this.instruction = null;

    this.page = null;
    this.pageId = 0;
    this.pageRegion = -1;

    this.gprs[0] = frost.gprs[0];
    this.gprs[1] = frost.gprs[1];
    this.gprs[2] = frost.gprs[2];
    this.gprs[3] = frost.gprs[3];
    this.gprs[4] = frost.gprs[4];
    this.gprs[5] = frost.gprs[5];
    this.gprs[6] = frost.gprs[6];
    this.gprs[7] = frost.gprs[7];
    this.gprs[8] = frost.gprs[8];
    this.gprs[9] = frost.gprs[9];
    this.gprs[10] = frost.gprs[10];
    this.gprs[11] = frost.gprs[11];
    this.gprs[12] = frost.gprs[12];
    this.gprs[13] = frost.gprs[13];
    this.gprs[14] = frost.gprs[14];
    this.gprs[15] = frost.gprs[15];

    this.mode = frost.mode;
    this.cpsrI = frost.cpsrI;
    this.cpsrF = frost.cpsrF;
    this.cpsrV = frost.cpsrV;
    this.cpsrC = frost.cpsrC;
    this.cpsrZ = frost.cpsrZ;
    this.cpsrN = frost.cpsrN;

    this.bankedRegisters[0][0] = frost.bankedRegisters[0][0];
    this.bankedRegisters[0][1] = frost.bankedRegisters[0][1];
    this.bankedRegisters[0][2] = frost.bankedRegisters[0][2];
    this.bankedRegisters[0][3] = frost.bankedRegisters[0][3];
    this.bankedRegisters[0][4] = frost.bankedRegisters[0][4];
    this.bankedRegisters[0][5] = frost.bankedRegisters[0][5];
    this.bankedRegisters[0][6] = frost.bankedRegisters[0][6];

    this.bankedRegisters[1][0] = frost.bankedRegisters[1][0];
    this.bankedRegisters[1][1] = frost.bankedRegisters[1][1];
    this.bankedRegisters[1][2] = frost.bankedRegisters[1][2];
    this.bankedRegisters[1][3] = frost.bankedRegisters[1][3];
    this.bankedRegisters[1][4] = frost.bankedRegisters[1][4];
    this.bankedRegisters[1][5] = frost.bankedRegisters[1][5];
    this.bankedRegisters[1][6] = frost.bankedRegisters[1][6];

    this.bankedRegisters[2][0] = frost.bankedRegisters[2][0];
    this.bankedRegisters[2][1] = frost.bankedRegisters[2][1];

    this.bankedRegisters[3][0] = frost.bankedRegisters[3][0];
    this.bankedRegisters[3][1] = frost.bankedRegisters[3][1];

    this.bankedRegisters[4][0] = frost.bankedRegisters[4][0];
    this.bankedRegisters[4][1] = frost.bankedRegisters[4][1];

    this.bankedRegisters[5][0] = frost.bankedRegisters[5][0];
    this.bankedRegisters[5][1] = frost.bankedRegisters[5][1];

    this.spsr = frost.spsr;
    this.bankedSPSRs[0] = frost.bankedSPSRs[0];
    this.bankedSPSRs[1] = frost.bankedSPSRs[1];
    this.bankedSPSRs[2] = frost.bankedSPSRs[2];
    this.bankedSPSRs[3] = frost.bankedSPSRs[3];
    this.bankedSPSRs[4] = frost.bankedSPSRs[4];
    this.bankedSPSRs[5] = frost.bankedSPSRs[5];

    this.cycles = frost.cycles;
  }

  fetchPage(address: number): void {
    var region = address >> this.mmu.BASE_OFFSET;
    var pageId = this.mmu.addressToPage(
      region,
      address & this.mmu.OFFSET_MASK
    );
    if (region == this.pageRegion) {
      if (pageId == this.pageId && !this.page!.invalid) {
        return;
      }
      this.pageId = pageId;
    } else {
      this.pageMask = this.mmu.memory[region].PAGE_MASK;
      this.pageRegion = region;
      this.pageId = pageId;
    }

    this.page = this.mmu.accessPage(region, pageId);
  }

  loadInstructionArm(address: number): InstructionFn {
    var next: InstructionFn | null = null;
    this.fetchPage(address);
    var offset = (address & this.pageMask) >> 2;
    next = this.page!.arm[offset];
    if (next) {
      return next;
    }
    var instruction = this.mmu.load32(address) >>> 0;
    next = this.compileArm(instruction);
    next.next = null;
    next.page = this.page!;
    next.address = address;
    next.opcode = instruction;
    this.page!.arm[offset] = next;
    return next;
  }

  loadInstructionThumb(address: number): InstructionFn {
    var next: InstructionFn | null = null;
    this.fetchPage(address);
    var offset = (address & this.pageMask) >> 1;
    next = this.page!.thumb[offset];
    if (next) {
      return next;
    }
    var instruction = this.mmu.load16(address);
    next = this.compileThumb(instruction);
    next.next = null;
    next.page = this.page!;
    next.address = address;
    next.opcode = instruction;
    this.page!.thumb[offset] = next;
    return next;
  }

  selectBank(mode: number): number {
    switch (mode) {
      case this.MODE_USER:
      case this.MODE_SYSTEM:
        // No banked registers
        return this.BANK_NONE;
      case this.MODE_FIQ:
        return this.BANK_FIQ;
      case this.MODE_IRQ:
        return this.BANK_IRQ;
      case this.MODE_SUPERVISOR:
        return this.BANK_SUPERVISOR;
      case this.MODE_ABORT:
        return this.BANK_ABORT;
      case this.MODE_UNDEFINED:
        return this.BANK_UNDEFINED;
      default:
        throw "Invalid user mode passed to selectBank";
    }
  }

  switchExecMode(newMode: number): void {
    if (this.execMode != newMode) {
      this.execMode = newMode;
      if (newMode == this.MODE_ARM) {
        this.instructionWidth = this.WORD_SIZE_ARM;
        this.loadInstruction = this.loadInstructionArm;
      } else {
        this.instructionWidth = this.WORD_SIZE_THUMB;
        this.loadInstruction = this.loadInstructionThumb;
      }
    }
  }

  switchMode(newMode: number): void {
    if (newMode == this.mode) {
      // Not switching modes after all
      return;
    }
    if (newMode != (this.MODE_USER as number) || newMode != (this.MODE_SYSTEM as number)) {
      // Switch banked registers
      var newBank = this.selectBank(newMode);
      var oldBank = this.selectBank(this.mode);
      if (newBank != oldBank) {
        // TODO: support FIQ
        if (newMode == this.MODE_FIQ || this.mode == this.MODE_FIQ) {
          var oldFiqBank = oldBank == this.BANK_FIQ ? 1 : 0;
          var newFiqBank = newBank == this.BANK_FIQ ? 1 : 0;
          this.bankedRegisters[oldFiqBank][2] = this.gprs[8];
          this.bankedRegisters[oldFiqBank][3] = this.gprs[9];
          this.bankedRegisters[oldFiqBank][4] = this.gprs[10];
          this.bankedRegisters[oldFiqBank][5] = this.gprs[11];
          this.bankedRegisters[oldFiqBank][6] = this.gprs[12];
          this.gprs[8] = this.bankedRegisters[newFiqBank][2];
          this.gprs[9] = this.bankedRegisters[newFiqBank][3];
          this.gprs[10] = this.bankedRegisters[newFiqBank][4];
          this.gprs[11] = this.bankedRegisters[newFiqBank][5];
          this.gprs[12] = this.bankedRegisters[newFiqBank][6];
        }
        this.bankedRegisters[oldBank][0] = this.gprs[this.SP];
        this.bankedRegisters[oldBank][1] = this.gprs[this.LR];
        this.gprs[this.SP] = this.bankedRegisters[newBank][0];
        this.gprs[this.LR] = this.bankedRegisters[newBank][1];

        this.bankedSPSRs[oldBank] = this.spsr;
        this.spsr = this.bankedSPSRs[newBank];
      }
    }
    this.mode = newMode;
  }

  packCPSR(): number {
    return (
      this.mode |
      (+!!this.execMode << 5) |
      (+!!this.cpsrF << 6) |
      (+!!this.cpsrI << 7) |
      (+this.cpsrN << 31) |
      (+this.cpsrZ << 30) |
      (+this.cpsrC << 29) |
      (+this.cpsrV << 28)
    );
  }

  unpackCPSR(spsr: number): void {
    this.switchMode(spsr & 0x0000001f);
    this.switchExecMode(spsr & 0x00000020 ? 1 : 0);
    this.cpsrF = spsr & 0x00000040;
    this.cpsrI = spsr & 0x00000080;
    this.cpsrN = spsr & 0x80000000;
    this.cpsrZ = spsr & 0x40000000;
    this.cpsrC = spsr & 0x20000000;
    this.cpsrV = spsr & 0x10000000;

    this.irq.testIRQ();
  }

  hasSPSR(): boolean {
    return this.mode != (this.MODE_SYSTEM as number) && this.mode != (this.MODE_USER as number);
  }

  raiseIRQ(): void {
    if (this.cpsrI) {
      return;
    }
    var cpsr = this.packCPSR();
    var instructionWidth = this.instructionWidth;
    this.switchMode(this.MODE_IRQ);
    this.spsr = cpsr;
    this.gprs[this.LR] = this.gprs[this.PC] - instructionWidth + 4;
    this.gprs[this.PC] = this.BASE_IRQ + this.WORD_SIZE_ARM;
    this.instruction = null;
    this.switchExecMode(this.MODE_ARM);
    this.cpsrI = 1;
  }

  raiseTrap(): void {
    var cpsr = this.packCPSR();
    var instructionWidth = this.instructionWidth;
    this.switchMode(this.MODE_SUPERVISOR);
    this.spsr = cpsr;
    this.gprs[this.LR] = this.gprs[this.PC] - instructionWidth;
    this.gprs[this.PC] = this.BASE_SWI + this.WORD_SIZE_ARM;
    this.instruction = null;
    this.switchExecMode(this.MODE_ARM);
    this.cpsrI = 1;
  }

  badOp(instruction: number): InstructionFn {
    var func: InstructionFn = function () {
      throw "Illegal instruction: 0x" + instruction.toString(16);
    };
    func.writesPC = true;
    func.fixedJump = false;
    return func;
  }

  generateConds(): void {
    var cpu = this;
    this.conds = [
      // EQ
      function () {
        return (cpu.conditionPassed = !!cpu.cpsrZ);
      },
      // NE
      function () {
        return (cpu.conditionPassed = !cpu.cpsrZ);
      },
      // CS
      function () {
        return (cpu.conditionPassed = !!cpu.cpsrC);
      },
      // CC
      function () {
        return (cpu.conditionPassed = !cpu.cpsrC);
      },
      // MI
      function () {
        return (cpu.conditionPassed = !!cpu.cpsrN);
      },
      // PL
      function () {
        return (cpu.conditionPassed = !cpu.cpsrN);
      },
      // VS
      function () {
        return (cpu.conditionPassed = !!cpu.cpsrV);
      },
      // VC
      function () {
        return (cpu.conditionPassed = !cpu.cpsrV);
      },
      // HI
      function () {
        return (cpu.conditionPassed = !!cpu.cpsrC && !cpu.cpsrZ);
      },
      // LS
      function () {
        return (cpu.conditionPassed = !cpu.cpsrC || !!cpu.cpsrZ);
      },
      // GE
      function () {
        return (cpu.conditionPassed = !cpu.cpsrN == !cpu.cpsrV);
      },
      // LT
      function () {
        return (cpu.conditionPassed = !cpu.cpsrN != !cpu.cpsrV);
      },
      // GT
      function () {
        return (
          cpu.conditionPassed = !cpu.cpsrZ && !cpu.cpsrN == !cpu.cpsrV
        );
      },
      // LE
      function () {
        return (
          cpu.conditionPassed = !!cpu.cpsrZ || !cpu.cpsrN != !cpu.cpsrV
        );
      },
      // AL
      null,
      null,
    ];
  }

  barrelShiftImmediate(
    shiftType: number,
    immediate: number,
    rm: number
  ): InstructionFn {
    var cpu = this;
    var gprs = this.gprs;
    var shiftOp: InstructionFn;
    switch (shiftType) {
      case 0x00000000:
        // LSL
        if (immediate) {
          shiftOp = function () {
            cpu.shifterOperand = gprs[rm] << immediate;
            cpu.shifterCarryOut = gprs[rm] & (1 << (32 - immediate));
          };
        } else {
          // This boils down to no shift
          shiftOp = function () {
            cpu.shifterOperand = gprs[rm];
            cpu.shifterCarryOut = cpu.cpsrC;
          };
        }
        break;
      case 0x00000020:
        // LSR
        if (immediate) {
          shiftOp = function () {
            cpu.shifterOperand = gprs[rm] >>> immediate;
            cpu.shifterCarryOut = gprs[rm] & (1 << (immediate - 1));
          };
        } else {
          shiftOp = function () {
            cpu.shifterOperand = 0;
            cpu.shifterCarryOut = gprs[rm] & 0x80000000;
          };
        }
        break;
      case 0x00000040:
        // ASR
        if (immediate) {
          shiftOp = function () {
            cpu.shifterOperand = gprs[rm] >> immediate;
            cpu.shifterCarryOut = gprs[rm] & (1 << (immediate - 1));
          };
        } else {
          shiftOp = function () {
            cpu.shifterCarryOut = gprs[rm] & 0x80000000;
            if (cpu.shifterCarryOut) {
              cpu.shifterOperand = 0xffffffff;
            } else {
              cpu.shifterOperand = 0;
            }
          };
        }
        break;
      case 0x00000060:
        // ROR
        if (immediate) {
          shiftOp = function () {
            cpu.shifterOperand =
              (gprs[rm] >>> immediate) | (gprs[rm] << (32 - immediate));
            cpu.shifterCarryOut = gprs[rm] & (1 << (immediate - 1));
          };
        } else {
          // RRX
          shiftOp = function () {
            cpu.shifterOperand =
              (+!!cpu.cpsrC << 31) | (gprs[rm] >>> 1);
            cpu.shifterCarryOut = gprs[rm] & 0x00000001;
          };
        }
        break;
      default:
        shiftOp = this.badOp(0);
        break;
    }
    return shiftOp;
  }

  compileArm(instruction: number): InstructionFn {
    var op = this.badOp(instruction);
    var i = instruction & 0x0e000000;
    var cpu = this;
    var gprs = this.gprs;
    var rn = 0;
    var rd = 0;
    var rm = 0;

    var condOp = this.conds[(instruction & 0xf0000000) >>> 28];
    if ((instruction & 0x0ffffff0) == 0x012fff10) {
      // BX
      var rm = instruction & 0xf;
      op = this.armCompiler.constructBX(rm, condOp);
      op.writesPC = true;
      op.fixedJump = false;
    } else if (
      !(instruction & 0x0c000000) &&
      (i == 0x02000000 || (instruction & 0x00000090) != 0x00000090)
    ) {
      var opcode = instruction & 0x01e00000;
      var s = instruction & 0x00100000;
      var shiftsRs = false;
      if ((opcode & 0x01800000) == 0x01000000 && !s) {
        var r = instruction & 0x00400000;
        if ((instruction & 0x00b0f000) == 0x0020f000) {
          // MSR
          var rm2 = instruction & 0x0000000f;
          var immediate = instruction & 0x000000ff;
          var rotateImm = (instruction & 0x00000f00) >> 7;
          immediate =
            (immediate >>> rotateImm) | (immediate << (32 - rotateImm));
          op = this.armCompiler.constructMSR(
            rm2,
            r,
            instruction,
            immediate,
            condOp
          );
          op.writesPC = false;
        } else if ((instruction & 0x00bf0000) == 0x000f0000) {
          // MRS
          var rd = (instruction & 0x0000f000) >> 12;
          op = this.armCompiler.constructMRS(rd, r, condOp);
          op.writesPC = rd == this.PC;
        }
      } else {
        // Data processing/FSR transfer
        var rn = (instruction & 0x000f0000) >> 16;
        var rd = (instruction & 0x0000f000) >> 12;

        // Parse shifter operand
        var shiftType = instruction & 0x00000060;
        var rm3 = instruction & 0x0000000f;
        var shiftOp: InstructionFn = function () {
          throw "BUG: invalid barrel shifter";
        };
        if (instruction & 0x02000000) {
          var immediate2 = instruction & 0x000000ff;
          var rotate = (instruction & 0x00000f00) >> 7;
          if (!rotate) {
            shiftOp =
              this.armCompiler.constructAddressingMode1Immediate(immediate2);
          } else {
            shiftOp =
              this.armCompiler.constructAddressingMode1ImmediateRotate(
                immediate2,
                rotate
              );
          }
        } else if (instruction & 0x00000010) {
          var rs = (instruction & 0x00000f00) >> 8;
          shiftsRs = true;
          switch (shiftType) {
            case 0x00000000:
              // LSL
              shiftOp = this.armCompiler.constructAddressingMode1LSL(rs, rm3);
              break;
            case 0x00000020:
              // LSR
              shiftOp = this.armCompiler.constructAddressingMode1LSR(rs, rm3);
              break;
            case 0x00000040:
              // ASR
              shiftOp = this.armCompiler.constructAddressingMode1ASR(rs, rm3);
              break;
            case 0x00000060:
              // ROR
              shiftOp = this.armCompiler.constructAddressingMode1ROR(rs, rm3);
              break;
          }
        } else {
          var immediate3 = (instruction & 0x00000f80) >> 7;
          shiftOp = this.barrelShiftImmediate(shiftType, immediate3, rm3);
        }

        switch (opcode) {
          case 0x00000000:
            // AND
            if (s) {
              op = this.armCompiler.constructANDS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructAND(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00200000:
            // EOR
            if (s) {
              op = this.armCompiler.constructEORS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructEOR(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00400000:
            // SUB
            if (s) {
              op = this.armCompiler.constructSUBS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructSUB(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00600000:
            // RSB
            if (s) {
              op = this.armCompiler.constructRSBS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructRSB(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00800000:
            // ADD
            if (s) {
              op = this.armCompiler.constructADDS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructADD(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00a00000:
            // ADC
            if (s) {
              op = this.armCompiler.constructADCS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructADC(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00c00000:
            // SBC
            if (s) {
              op = this.armCompiler.constructSBCS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructSBC(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x00e00000:
            // RSC
            if (s) {
              op = this.armCompiler.constructRSCS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructRSC(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x01000000:
            // TST
            op = this.armCompiler.constructTST(rd, rn, shiftOp, condOp);
            break;
          case 0x01200000:
            // TEQ
            op = this.armCompiler.constructTEQ(rd, rn, shiftOp, condOp);
            break;
          case 0x01400000:
            // CMP
            op = this.armCompiler.constructCMP(rd, rn, shiftOp, condOp);
            break;
          case 0x01600000:
            // CMN
            op = this.armCompiler.constructCMN(rd, rn, shiftOp, condOp);
            break;
          case 0x01800000:
            // ORR
            if (s) {
              op = this.armCompiler.constructORRS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructORR(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x01a00000:
            // MOV
            if (s) {
              op = this.armCompiler.constructMOVS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructMOV(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x01c00000:
            // BIC
            if (s) {
              op = this.armCompiler.constructBICS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructBIC(rd, rn, shiftOp, condOp);
            }
            break;
          case 0x01e00000:
            // MVN
            if (s) {
              op = this.armCompiler.constructMVNS(rd, rn, shiftOp, condOp);
            } else {
              op = this.armCompiler.constructMVN(rd, rn, shiftOp, condOp);
            }
            break;
        }
        op.writesPC = rd == this.PC;
      }
    } else if ((instruction & 0x0fb00ff0) == 0x01000090) {
      // Single data swap
      var rm4 = instruction & 0x0000000f;
      var rd2 = (instruction >> 12) & 0x0000000f;
      var rn2 = (instruction >> 16) & 0x0000000f;
      if (instruction & 0x00400000) {
        op = this.armCompiler.constructSWPB(rd2, rn2, rm4, condOp);
      } else {
        op = this.armCompiler.constructSWP(rd2, rn2, rm4, condOp);
      }
      op.writesPC = rd2 == this.PC;
    } else {
      switch (i) {
        case 0x00000000:
          if ((instruction & 0x010000f0) == 0x00000090) {
            // Multiplies
            var rd3 = (instruction & 0x000f0000) >> 16;
            var rn3 = (instruction & 0x0000f000) >> 12;
            var rs2 = (instruction & 0x00000f00) >> 8;
            var rm5 = instruction & 0x0000000f;
            switch (instruction & 0x00f00000) {
              case 0x00000000:
                // MUL
                op = this.armCompiler.constructMUL(rd3, rs2, rm5, condOp);
                break;
              case 0x00100000:
                // MULS
                op = this.armCompiler.constructMULS(rd3, rs2, rm5, condOp);
                break;
              case 0x00200000:
                // MLA
                op = this.armCompiler.constructMLA(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00300000:
                // MLAS
                op = this.armCompiler.constructMLAS(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00800000:
                // UMULL
                op = this.armCompiler.constructUMULL(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00900000:
                // UMULLS
                op = this.armCompiler.constructUMULLS(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00a00000:
                // UMLAL
                op = this.armCompiler.constructUMLAL(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00b00000:
                // UMLALS
                op = this.armCompiler.constructUMLALS(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00c00000:
                // SMULL
                op = this.armCompiler.constructSMULL(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00d00000:
                // SMULLS
                op = this.armCompiler.constructSMULLS(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00e00000:
                // SMLAL
                op = this.armCompiler.constructSMLAL(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
              case 0x00f00000:
                // SMLALS
                op = this.armCompiler.constructSMLALS(
                  rd3,
                  rn3,
                  rs2,
                  rm5,
                  condOp
                );
                break;
            }
            op.writesPC = rd3 == this.PC;
          } else {
            // Halfword and signed byte data transfer
            var load = instruction & 0x00100000;
            var rd4 = (instruction & 0x0000f000) >> 12;
            var hiOffset = (instruction & 0x00000f00) >> 4;
            var loOffset = (rm = instruction & 0x0000000f);
            var h = instruction & 0x00000020;
            var s2 = instruction & 0x00000040;
            var w = instruction & 0x00200000;
            var i2 = instruction & 0x00400000;

            var address;
            if (i2) {
              var immediate4 = loOffset | hiOffset;
              address =
                this.armCompiler.constructAddressingMode23Immediate(
                  instruction,
                  immediate4,
                  condOp
                );
            } else {
              address =
                this.armCompiler.constructAddressingMode23Register(
                  instruction,
                  rm,
                  condOp
                );
            }
            address.writesPC = !!w && rn == this.PC;

            if ((instruction & 0x00000090) == 0x00000090) {
              if (load) {
                // Load [signed] halfword/byte
                if (h) {
                  if (s2) {
                    // LDRSH
                    op = this.armCompiler.constructLDRSH(
                      rd4,
                      address,
                      condOp
                    );
                  } else {
                    // LDRH
                    op = this.armCompiler.constructLDRH(
                      rd4,
                      address,
                      condOp
                    );
                  }
                } else {
                  if (s2) {
                    // LDRSB
                    op = this.armCompiler.constructLDRSB(
                      rd4,
                      address,
                      condOp
                    );
                  }
                }
              } else if (!s2 && h) {
                // STRH
                op = this.armCompiler.constructSTRH(rd4, address, condOp);
              }
            }
            op.writesPC = rd4 == this.PC || address.writesPC;
          }
          break;
        case 0x04000000:
        case 0x06000000:
          // LDR/STR
          var rd5 = (instruction & 0x0000f000) >> 12;
          var load2 = instruction & 0x00100000;
          var b = instruction & 0x00400000;
          var i3 = instruction & 0x02000000;

          var address2: { (writeInitial?: boolean): number; writesPC?: number | boolean } = function () {
            throw (
              "Unimplemented memory access: 0x" + instruction.toString(16)
            );
          };
          if (~instruction & 0x01000000) {
            // Clear the W bit if the P bit is clear--we don't support memory translation, so these turn into regular accesses
            instruction &= 0xffdfffff;
          }
          if (i3) {
            // Register offset
            var rm7 = instruction & 0x0000000f;
            var shiftType2 = instruction & 0x00000060;
            var shiftImmediate = (instruction & 0x00000f80) >> 7;

            if (shiftType2 || shiftImmediate) {
              var shiftOp2 = this.barrelShiftImmediate(
                shiftType2,
                shiftImmediate,
                rm7
              );
              address2 =
                this.armCompiler.constructAddressingMode2RegisterShifted(
                  instruction,
                  shiftOp2,
                  condOp
                );
            } else {
              address2 =
                this.armCompiler.constructAddressingMode23Register(
                  instruction,
                  rm7,
                  condOp
                );
            }
          } else {
            // Immediate
            var offset = instruction & 0x00000fff;
            address2 =
              this.armCompiler.constructAddressingMode23Immediate(
                instruction,
                offset,
                condOp
              );
          }
          if (load2) {
            if (b) {
              // LDRB
              op = this.armCompiler.constructLDRB(rd5, address2, condOp);
            } else {
              // LDR
              op = this.armCompiler.constructLDR(rd5, address2, condOp);
            }
          } else {
            if (b) {
              // STRB
              op = this.armCompiler.constructSTRB(rd5, address2, condOp);
            } else {
              // STR
              op = this.armCompiler.constructSTR(rd5, address2, condOp);
            }
          }
          op.writesPC = rd5 == this.PC || address2.writesPC;
          break;
        case 0x08000000:
          // Block data transfer
          var load3 = instruction & 0x00100000;
          var w2 = instruction & 0x00200000;
          var user = instruction & 0x00400000;
          var u = instruction & 0x00800000;
          var p = instruction & 0x01000000;
          var rs3 = instruction & 0x0000ffff;
          var rn4 = (instruction & 0x000f0000) >> 16;

          var address3;
          var immediate5 = 0;
          var offset2 = 0;
          var overlap = false;
          if (u) {
            if (p) {
              immediate5 = 4;
            }
            for (var m = 0x01, ii = 0; ii < 16; m <<= 1, ++ii) {
              if (rs3 & m) {
                if (w2 && ii == rn4 && !offset2) {
                  rs3 &= ~m;
                  immediate5 += 4;
                  overlap = true;
                }
                offset2 += 4;
              }
            }
          } else {
            if (!p) {
              immediate5 = 4;
            }
            for (var m2 = 0x01, j = 0; j < 16; m2 <<= 1, ++j) {
              if (rs3 & m2) {
                if (w2 && j == rn4 && !offset2) {
                  rs3 &= ~m2;
                  immediate5 += 4;
                  overlap = true;
                }
                immediate5 -= 4;
                offset2 -= 4;
              }
            }
          }
          if (w2) {
            address3 =
              this.armCompiler.constructAddressingMode4Writeback(
                immediate5,
                offset2,
                rn4,
                overlap
              );
          } else {
            address3 = this.armCompiler.constructAddressingMode4(
              immediate5,
              rn4
            );
          }
          if (load3) {
            // LDM
            if (user) {
              op = this.armCompiler.constructLDMS(rs3, address3, condOp);
            } else {
              op = this.armCompiler.constructLDM(rs3, address3, condOp);
            }
            op.writesPC = !!(rs3 & (1 << 15));
          } else {
            // STM
            if (user) {
              op = this.armCompiler.constructSTMS(rs3, address3, condOp);
            } else {
              op = this.armCompiler.constructSTM(rs3, address3, condOp);
            }
            op.writesPC = false;
          }
          break;
        case 0x0a000000:
          // Branch
          var immediate6 = instruction & 0x00ffffff;
          if (immediate6 & 0x00800000) {
            immediate6 |= 0xff000000;
          }
          immediate6 <<= 2;
          var link = instruction & 0x01000000;
          if (link) {
            op = this.armCompiler.constructBL(immediate6, condOp);
          } else {
            op = this.armCompiler.constructB(immediate6, condOp);
          }
          op.writesPC = true;
          op.fixedJump = true;
          break;
        case 0x0c000000:
          // Coprocessor data transfer
          break;
        case 0x0e000000:
          // Coprocessor data operation/SWI
          if ((instruction & 0x0f000000) == 0x0f000000) {
            // SWI
            var immediate7 = instruction & 0x00ffffff;
            op = this.armCompiler.constructSWI(immediate7, condOp);
            op.writesPC = false;
          }
          break;
        default:
          throw "Bad opcode: 0x" + instruction.toString(16);
      }
    }

    op.execMode = this.MODE_ARM;
    op.fixedJump = op.fixedJump || false;
    return op;
  }

  compileThumb(instruction: number): InstructionFn {
    var op = this.badOp(instruction & 0xffff);
    var cpu = this;
    var gprs = this.gprs;
    if ((instruction & 0xfc00) == 0x4000) {
      // Data-processing register
      var rm = (instruction & 0x0038) >> 3;
      var rd = instruction & 0x0007;
      switch (instruction & 0x03c0) {
        case 0x0000:
          // AND
          op = this.thumbCompiler.constructAND(rd, rm);
          break;
        case 0x0040:
          // EOR
          op = this.thumbCompiler.constructEOR(rd, rm);
          break;
        case 0x0080:
          // LSL(2)
          op = this.thumbCompiler.constructLSL2(rd, rm);
          break;
        case 0x00c0:
          // LSR(2)
          op = this.thumbCompiler.constructLSR2(rd, rm);
          break;
        case 0x0100:
          // ASR(2)
          op = this.thumbCompiler.constructASR2(rd, rm);
          break;
        case 0x0140:
          // ADC
          op = this.thumbCompiler.constructADC(rd, rm);
          break;
        case 0x0180:
          // SBC
          op = this.thumbCompiler.constructSBC(rd, rm);
          break;
        case 0x01c0:
          // ROR
          op = this.thumbCompiler.constructROR(rd, rm);
          break;
        case 0x0200:
          // TST
          op = this.thumbCompiler.constructTST(rd, rm);
          break;
        case 0x0240:
          // NEG
          op = this.thumbCompiler.constructNEG(rd, rm);
          break;
        case 0x0280:
          // CMP(2)
          op = this.thumbCompiler.constructCMP2(rd, rm);
          break;
        case 0x02c0:
          // CMN
          op = this.thumbCompiler.constructCMN(rd, rm);
          break;
        case 0x0300:
          // ORR
          op = this.thumbCompiler.constructORR(rd, rm);
          break;
        case 0x0340:
          // MUL
          op = this.thumbCompiler.constructMUL(rd, rm);
          break;
        case 0x0380:
          // BIC
          op = this.thumbCompiler.constructBIC(rd, rm);
          break;
        case 0x03c0:
          // MVN
          op = this.thumbCompiler.constructMVN(rd, rm);
          break;
      }
      op.writesPC = false;
    } else if ((instruction & 0xfc00) == 0x4400) {
      // Special data processing / branch/exchange instruction set
      var rm2 = (instruction & 0x0078) >> 3;
      var rn = instruction & 0x0007;
      var h1 = instruction & 0x0080;
      var rd2 = rn | (h1 >> 4);
      switch (instruction & 0x0300) {
        case 0x0000:
          // ADD(4)
          op = this.thumbCompiler.constructADD4(rd2, rm2);
          op.writesPC = rd2 == this.PC;
          break;
        case 0x0100:
          // CMP(3)
          op = this.thumbCompiler.constructCMP3(rd2, rm2);
          op.writesPC = false;
          break;
        case 0x0200:
          // MOV(3)
          op = this.thumbCompiler.constructMOV3(rd2, rm2);
          op.writesPC = rd2 == this.PC;
          break;
        case 0x0300:
          // BX
          op = this.thumbCompiler.constructBX(rd2, rm2);
          op.writesPC = true;
          op.fixedJump = false;
          break;
      }
    } else if ((instruction & 0xf800) == 0x1800) {
      // Add/subtract
      var rm3 = (instruction & 0x01c0) >> 6;
      var rn2 = (instruction & 0x0038) >> 3;
      var rd3 = instruction & 0x0007;
      switch (instruction & 0x0600) {
        case 0x0000:
          // ADD(3)
          op = this.thumbCompiler.constructADD3(rd3, rn2, rm3);
          break;
        case 0x0200:
          // SUB(3)
          op = this.thumbCompiler.constructSUB3(rd3, rn2, rm3);
          break;
        case 0x0400:
          var immediate = (instruction & 0x01c0) >> 6;
          if (immediate) {
            // ADD(1)
            op = this.thumbCompiler.constructADD1(rd3, rn2, immediate);
          } else {
            // MOV(2)
            op = this.thumbCompiler.constructMOV2(rd3, rn2, rm3);
          }
          break;
        case 0x0600:
          // SUB(1)
          var immediate2 = (instruction & 0x01c0) >> 6;
          op = this.thumbCompiler.constructSUB1(rd3, rn2, immediate2);
          break;
      }
      op.writesPC = false;
    } else if (!(instruction & 0xe000)) {
      // Shift by immediate
      var rd4 = instruction & 0x0007;
      var rm4 = (instruction & 0x0038) >> 3;
      var immediate3 = (instruction & 0x07c0) >> 6;
      switch (instruction & 0x1800) {
        case 0x0000:
          // LSL(1)
          op = this.thumbCompiler.constructLSL1(rd4, rm4, immediate3);
          break;
        case 0x0800:
          // LSR(1)
          op = this.thumbCompiler.constructLSR1(rd4, rm4, immediate3);
          break;
        case 0x1000:
          // ASR(1)
          op = this.thumbCompiler.constructASR1(rd4, rm4, immediate3);
          break;
        case 0x1800:
          break;
      }
      op.writesPC = false;
    } else if ((instruction & 0xe000) == 0x2000) {
      // Add/subtract/compare/move immediate
      var immediate4 = instruction & 0x00ff;
      var rn3 = (instruction & 0x0700) >> 8;
      switch (instruction & 0x1800) {
        case 0x0000:
          // MOV(1)
          op = this.thumbCompiler.constructMOV1(rn3, immediate4);
          break;
        case 0x0800:
          // CMP(1)
          op = this.thumbCompiler.constructCMP1(rn3, immediate4);
          break;
        case 0x1000:
          // ADD(2)
          op = this.thumbCompiler.constructADD2(rn3, immediate4);
          break;
        case 0x1800:
          // SUB(2)
          op = this.thumbCompiler.constructSUB2(rn3, immediate4);
          break;
      }
      op.writesPC = false;
    } else if ((instruction & 0xf800) == 0x4800) {
      // LDR(3)
      var rd5 = (instruction & 0x0700) >> 8;
      var immediate5 = (instruction & 0x00ff) << 2;
      op = this.thumbCompiler.constructLDR3(rd5, immediate5);
      op.writesPC = false;
    } else if ((instruction & 0xf000) == 0x5000) {
      // Load and store with relative offset
      var rd6 = instruction & 0x0007;
      var rn4 = (instruction & 0x0038) >> 3;
      var rm5 = (instruction & 0x01c0) >> 6;
      var opcode = instruction & 0x0e00;
      switch (opcode) {
        case 0x0000:
          // STR(2)
          op = this.thumbCompiler.constructSTR2(rd6, rn4, rm5);
          break;
        case 0x0200:
          // STRH(2)
          op = this.thumbCompiler.constructSTRH2(rd6, rn4, rm5);
          break;
        case 0x0400:
          // STRB(2)
          op = this.thumbCompiler.constructSTRB2(rd6, rn4, rm5);
          break;
        case 0x0600:
          // LDRSB
          op = this.thumbCompiler.constructLDRSB(rd6, rn4, rm5);
          break;
        case 0x0800:
          // LDR(2)
          op = this.thumbCompiler.constructLDR2(rd6, rn4, rm5);
          break;
        case 0x0a00:
          // LDRH(2)
          op = this.thumbCompiler.constructLDRH2(rd6, rn4, rm5);
          break;
        case 0x0c00:
          // LDRB(2)
          op = this.thumbCompiler.constructLDRB2(rd6, rn4, rm5);
          break;
        case 0x0e00:
          // LDRSH
          op = this.thumbCompiler.constructLDRSH(rd6, rn4, rm5);
          break;
      }
      op.writesPC = false;
    } else if ((instruction & 0xe000) == 0x6000) {
      // Load and store with immediate offset
      var rd7 = instruction & 0x0007;
      var rn5 = (instruction & 0x0038) >> 3;
      var immediate6 = (instruction & 0x07c0) >> 4;
      var b2 = instruction & 0x1000;
      if (b2) {
        immediate6 >>= 2;
      }
      var load4 = instruction & 0x0800;
      if (load4) {
        if (b2) {
          // LDRB(1)
          op = this.thumbCompiler.constructLDRB1(rd7, rn5, immediate6);
        } else {
          // LDR(1)
          op = this.thumbCompiler.constructLDR1(rd7, rn5, immediate6);
        }
      } else {
        if (b2) {
          // STRB(1)
          op = this.thumbCompiler.constructSTRB1(rd7, rn5, immediate6);
        } else {
          // STR(1)
          op = this.thumbCompiler.constructSTR1(rd7, rn5, immediate6);
        }
      }
      op.writesPC = false;
    } else if ((instruction & 0xf600) == 0xb400) {
      // Push and pop registers
      var r2 = !!(instruction & 0x0100);
      var rs4 = instruction & 0x00ff;
      if (instruction & 0x0800) {
        // POP
        op = this.thumbCompiler.constructPOP(rs4, r2);
        op.writesPC = r2;
        op.fixedJump = false;
      } else {
        // PUSH
        op = this.thumbCompiler.constructPUSH(rs4, r2);
        op.writesPC = false;
      }
    } else if (instruction & 0x8000) {
      switch (instruction & 0x7000) {
        case 0x0000:
          // Load and store halfword
          var rd8 = instruction & 0x0007;
          var rn6 = (instruction & 0x0038) >> 3;
          var immediate7 = (instruction & 0x07c0) >> 5;
          if (instruction & 0x0800) {
            // LDRH(1)
            op = this.thumbCompiler.constructLDRH1(rd8, rn6, immediate7);
          } else {
            // STRH(1)
            op = this.thumbCompiler.constructSTRH1(rd8, rn6, immediate7);
          }
          op.writesPC = false;
          break;
        case 0x1000:
          // SP-relative load and store
          var rd9 = (instruction & 0x0700) >> 8;
          var immediate8 = (instruction & 0x00ff) << 2;
          var load5 = instruction & 0x0800;
          if (load5) {
            // LDR(4)
            op = this.thumbCompiler.constructLDR4(rd9, immediate8);
          } else {
            // STR(3)
            op = this.thumbCompiler.constructSTR3(rd9, immediate8);
          }
          op.writesPC = false;
          break;
        case 0x2000:
          // Load address
          var rd10 = (instruction & 0x0700) >> 8;
          var immediate9 = (instruction & 0x00ff) << 2;
          if (instruction & 0x0800) {
            // ADD(6)
            op = this.thumbCompiler.constructADD6(rd10, immediate9);
          } else {
            // ADD(5)
            op = this.thumbCompiler.constructADD5(rd10, immediate9);
          }
          op.writesPC = false;
          break;
        case 0x3000:
          // Miscellaneous
          if (!(instruction & 0x0f00)) {
            // Adjust stack pointer
            // ADD(7)/SUB(4)
            var b3 = instruction & 0x0080;
            var immediate10 = (instruction & 0x7f) << 2;
            if (b3) {
              immediate10 = -immediate10;
            }
            op = this.thumbCompiler.constructADD7(immediate10);
            op.writesPC = false;
          }
          break;
        case 0x4000:
          // Multiple load and store
          var rn7 = (instruction & 0x0700) >> 8;
          var rs5 = instruction & 0x00ff;
          if (instruction & 0x0800) {
            // LDMIA
            op = this.thumbCompiler.constructLDMIA(rn7, rs5);
          } else {
            // STMIA
            op = this.thumbCompiler.constructSTMIA(rn7, rs5);
          }
          op.writesPC = false;
          break;
        case 0x5000:
          // Conditional branch
          var cond = (instruction & 0x0f00) >> 8;
          var immediate11 = instruction & 0x00ff;
          if (cond == 0xf) {
            // SWI
            op = this.thumbCompiler.constructSWI(immediate11);
            op.writesPC = false;
          } else {
            // B(1)
            if (instruction & 0x0080) {
              immediate11 |= 0xffffff00;
            }
            immediate11 <<= 1;
            var condOp2 = this.conds[cond];
            op = this.thumbCompiler.constructB1(immediate11, condOp2 as () => boolean);
            op.writesPC = true;
            op.fixedJump = true;
          }
          break;
        case 0x6000:
        case 0x7000:
          // BL(X)
          var immediate12 = instruction & 0x07ff;
          var h2 = instruction & 0x1800;
          switch (h2) {
            case 0x0000:
              // B(2)
              if (immediate12 & 0x0400) {
                immediate12 |= 0xfffff800;
              }
              immediate12 <<= 1;
              op = this.thumbCompiler.constructB2(immediate12);
              op.writesPC = true;
              op.fixedJump = true;
              break;
            case 0x0800:
              // BLX (ARMv5T)
              /*op = function() {
                var pc = gprs[cpu.PC];
                gprs[cpu.PC] = (gprs[cpu.LR] + (immediate12 << 1)) & 0xFFFFFFFC;
                gprs[cpu.LR] = pc - 1;
                cpu.switchExecMode(cpu.MODE_ARM);
              }*/
              break;
            case 0x1000:
              // BL(1)
              if (immediate12 & 0x0400) {
                immediate12 |= 0xfffffc00;
              }
              immediate12 <<= 12;
              op = this.thumbCompiler.constructBL1(immediate12);
              op.writesPC = false;
              break;
            case 0x1800:
              // BL(2)
              op = this.thumbCompiler.constructBL2(immediate12);
              op.writesPC = true;
              op.fixedJump = false;
              break;
          }
          break;
        default:
          this.WARN(
            "Undefined instruction: 0x" + instruction.toString(16)
          );
      }
    } else {
      throw "Bad opcode: 0x" + instruction.toString(16);
    }

    op.execMode = this.MODE_THUMB;
    op.fixedJump = op.fixedJump || false;
    return op;
  }

  private WARN(msg: string): void {
    // Stub for warnings — actual logging is set up externally via inherit()
  }
}
