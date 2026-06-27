interface CPU {
  gprs: Int32Array;
  PC: number;
  LR: number;
  SP: number;
  mmu: {
    waitPrefetch(addr: number): void;
    waitPrefetch32(addr: number): void;
    wait(addr: number): void;
    wait32(addr: number): void;
    waitMulti32(addr: number, total: number): void;
    waitSeq32(addr: number): void;
    waitMul(addr: number): void;
    load32(addr: number): number;
    loadU8(addr: number): number;
    loadU16(addr: number): number;
    load8(addr: number): number;
    load16(addr: number): number;
    store32(addr: number, value: number): void;
    store16(addr: number, value: number): void;
    store8(addr: number, value: number): void;
  };
  cpsrC: number | boolean;
  cpsrN: number | boolean;
  cpsrZ: number | boolean;
  cpsrV: number | boolean;
  cpsrI: number | boolean;
  cpsrF: number | boolean;
  cycles: number;
  shifterOperand: number;
  shifterCarryOut: number;
  mode: number;
  spsr: number;
  MODE_SYSTEM: number;
  MODE_USER: number;
  USER_MASK: number;
  PRIV_MASK: number;
  STATE_MASK: number;
  hasSPSR(): boolean;
  unpackCPSR(spsr: number): void;
  packCPSR(): number;
  switchMode(mode: number): void;
  switchExecMode(mode: number): void;
  irq: {
    swi32(immediate: number): void;
  };
}

/** Address function returned by addressing mode methods */
interface AddrFn {
  (writeInitial?: boolean): number;
  writesPC: boolean;
}

export class ARMCoreArm {
  cpu: CPU;

  addressingMode23Immediate: (((
    rn: number,
    offset: number,
    condOp: (() => boolean) | null
  ) => AddrFn) | null)[];

  addressingMode23Register: (((
    rn: number,
    rm: number,
    condOp: (() => boolean) | null
  ) => AddrFn) | null)[];

  addressingMode2RegisterShifted: (((
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ) => AddrFn) | null)[];

  constructor(cpu: CPU) {
    this.cpu = cpu;

    this.addressingMode23Immediate = [
      // 000x0
      function (rn, offset, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn];
          if (!condOp || condOp()) {
            gprs[rn] -= offset;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      // 000xW
      null,

      null,
      null,

      // 00Ux0
      function (rn, offset, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn];
          if (!condOp || condOp()) {
            gprs[rn] += offset;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      // 00UxW
      null,

      null,
      null,

      // 0P0x0
      function (rn, offset, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          return gprs[rn] - offset;
        } as AddrFn;
        address.writesPC = false;
        return address;
      },

      // 0P0xW
      function (rn, offset, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn] - offset;
          if (!condOp || condOp()) {
            gprs[rn] = addr;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      null,
      null,

      // 0PUx0
      function (rn, offset, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          return gprs[rn] + offset;
        } as AddrFn;
        address.writesPC = false;
        return address;
      },

      // 0PUxW
      function (rn, offset, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn] + offset;
          if (!condOp || condOp()) {
            gprs[rn] = addr;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      null,
      null,
    ];

    this.addressingMode23Register = [
      // I00x0
      function (rn, rm, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn];
          if (!condOp || condOp()) {
            gprs[rn] -= gprs[rm];
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      // I00xW
      null,

      null,
      null,

      // I0Ux0
      function (rn, rm, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn];
          if (!condOp || condOp()) {
            gprs[rn] += gprs[rm];
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      // I0UxW
      null,

      null,
      null,

      // IP0x0
      function (rn, rm, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          return gprs[rn] - gprs[rm];
        } as AddrFn;
        address.writesPC = false;
        return address;
      },

      // IP0xW
      function (rn, rm, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn] - gprs[rm];
          if (!condOp || condOp()) {
            gprs[rn] = addr;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      null,
      null,

      // IPUx0
      function (rn, rm, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn] + gprs[rm];
          return addr;
        } as AddrFn;
        address.writesPC = false;
        return address;
      },

      // IPUxW
      function (rn, rm, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn] + gprs[rm];
          if (!condOp || condOp()) {
            gprs[rn] = addr;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      null,
      null,
    ];

    this.addressingMode2RegisterShifted = [
      // I00x0
      function (rn, shiftOp, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn];
          if (!condOp || condOp()) {
            shiftOp();
            gprs[rn] -= cpu.shifterOperand;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      // I00xW
      null,

      null,
      null,

      // I0Ux0
      function (rn, shiftOp, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          const addr = gprs[rn];
          if (!condOp || condOp()) {
            shiftOp();
            gprs[rn] += cpu.shifterOperand;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },
      // I0UxW
      null,

      null,
      null,

      // IP0x0
      function (rn, shiftOp, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          shiftOp();
          return gprs[rn] - cpu.shifterOperand;
        } as AddrFn;
        address.writesPC = false;
        return address;
      },

      // IP0xW
      function (rn, shiftOp, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          shiftOp();
          const addr = gprs[rn] - cpu.shifterOperand;
          if (!condOp || condOp()) {
            gprs[rn] = addr;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      null,
      null,

      // IPUx0
      function (rn, shiftOp, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          shiftOp();
          return gprs[rn] + cpu.shifterOperand;
        } as AddrFn;
        address.writesPC = false;
        return address;
      },

      // IPUxW
      function (rn, shiftOp, condOp) {
        const gprs = cpu.gprs;
        const address = function () {
          shiftOp();
          const addr = gprs[rn] + cpu.shifterOperand;
          if (!condOp || condOp()) {
            gprs[rn] = addr;
          }
          return addr;
        } as AddrFn;
        address.writesPC = rn == cpu.PC;
        return address;
      },

      null,
      null,
    ];
  }

  constructAddressingMode1ASR(rs: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      ++cpu.cycles;
      let shift = gprs[rs];
      if (rs == cpu.PC) {
        shift += 4;
      }
      shift &= 0xFF;
      let shiftVal = gprs[rm];
      if (rm == cpu.PC) {
        shiftVal += 4;
      }
      if (shift == 0) {
        cpu.shifterOperand = shiftVal;
        cpu.shifterCarryOut = Number(cpu.cpsrC);
      } else if (shift < 32) {
        cpu.shifterOperand = shiftVal >> shift;
        cpu.shifterCarryOut = shiftVal & (1 << (shift - 1));
      } else if (gprs[rm] >> 31) {
        cpu.shifterOperand = 0xFFFFFFFF;
        cpu.shifterCarryOut = 0x80000000;
      } else {
        cpu.shifterOperand = 0;
        cpu.shifterCarryOut = 0;
      }
    };
  }

  constructAddressingMode1Immediate(immediate: number): () => void {
    const cpu = this.cpu;
    return function () {
      cpu.shifterOperand = immediate;
      cpu.shifterCarryOut = Number(cpu.cpsrC);
    };
  }

  constructAddressingMode1ImmediateRotate(immediate: number, rotate: number): () => void {
    const cpu = this.cpu;
    return function () {
      cpu.shifterOperand = (immediate >>> rotate) | (immediate << (32 - rotate));
      cpu.shifterCarryOut = cpu.shifterOperand >> 31;
    };
  }

  constructAddressingMode1LSL(rs: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      ++cpu.cycles;
      let shift = gprs[rs];
      if (rs == cpu.PC) {
        shift += 4;
      }
      shift &= 0xFF;
      let shiftVal = gprs[rm];
      if (rm == cpu.PC) {
        shiftVal += 4;
      }
      if (shift == 0) {
        cpu.shifterOperand = shiftVal;
        cpu.shifterCarryOut = Number(cpu.cpsrC);
      } else if (shift < 32) {
        cpu.shifterOperand = shiftVal << shift;
        cpu.shifterCarryOut = shiftVal & (1 << (32 - shift));
      } else if (shift == 32) {
        cpu.shifterOperand = 0;
        cpu.shifterCarryOut = shiftVal & 1;
      } else {
        cpu.shifterOperand = 0;
        cpu.shifterCarryOut = 0;
      }
    };
  }

  constructAddressingMode1LSR(rs: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      ++cpu.cycles;
      let shift = gprs[rs];
      if (rs == cpu.PC) {
        shift += 4;
      }
      shift &= 0xFF;
      let shiftVal = gprs[rm];
      if (rm == cpu.PC) {
        shiftVal += 4;
      }
      if (shift == 0) {
        cpu.shifterOperand = shiftVal;
        cpu.shifterCarryOut = Number(cpu.cpsrC);
      } else if (shift < 32) {
        cpu.shifterOperand = shiftVal >>> shift;
        cpu.shifterCarryOut = shiftVal & (1 << (shift - 1));
      } else if (shift == 32) {
        cpu.shifterOperand = 0;
        cpu.shifterCarryOut = shiftVal >> 31;
      } else {
        cpu.shifterOperand = 0;
        cpu.shifterCarryOut = 0;
      }
    };
  }

  constructAddressingMode1ROR(rs: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      ++cpu.cycles;
      let shift = gprs[rs];
      if (rs == cpu.PC) {
        shift += 4;
      }
      shift &= 0xFF;
      let shiftVal = gprs[rm];
      if (rm == cpu.PC) {
        shiftVal += 4;
      }
      const rotate = shift & 0x1F;
      if (shift == 0) {
        cpu.shifterOperand = shiftVal;
        cpu.shifterCarryOut = Number(cpu.cpsrC);
      } else if (rotate) {
        cpu.shifterOperand = (gprs[rm] >>> rotate) | (gprs[rm] << (32 - rotate));
        cpu.shifterCarryOut = shiftVal & (1 << (rotate - 1));
      } else {
        cpu.shifterOperand = shiftVal;
        cpu.shifterCarryOut = shiftVal >> 31;
      }
    };
  }

  constructAddressingMode23Immediate(
    instruction: number,
    immediate: number,
    condOp: (() => boolean) | null
  ): AddrFn {
    const rn = (instruction & 0x000F0000) >> 16;
    const fn = this.addressingMode23Immediate[(instruction & 0x01A00000) >> 21];
    return fn!(rn, immediate, condOp);
  }

  constructAddressingMode23Register(
    instruction: number,
    rm: number,
    condOp: (() => boolean) | null
  ): AddrFn {
    const rn = (instruction & 0x000F0000) >> 16;
    const fn = this.addressingMode23Register[(instruction & 0x01A00000) >> 21];
    return fn!(rn, rm, condOp);
  }

  constructAddressingMode2RegisterShifted(
    instruction: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): AddrFn {
    const rn = (instruction & 0x000F0000) >> 16;
    const fn = this.addressingMode2RegisterShifted[(instruction & 0x01A00000) >> 21];
    return fn!(rn, shiftOp, condOp);
  }

  constructAddressingMode4(immediate: number, rn: number): () => number {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      const addr = gprs[rn] + immediate;
      return addr;
    };
  }

  constructAddressingMode4Writeback(
    immediate: number,
    offset: number,
    rn: number,
    overlap: boolean
  ): (writeInitial?: boolean) => number {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function (writeInitial) {
      const addr = gprs[rn] + immediate;
      if (writeInitial && overlap) {
        cpu.mmu.store32(gprs[rn] + immediate - 4, gprs[rn]);
      }
      gprs[rn] += offset;
      return addr;
    };
  }

  constructADC(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const shifterOperand = (cpu.shifterOperand >>> 0) + Number(cpu.cpsrC);
      gprs[rd] = (gprs[rn] >>> 0) + shifterOperand;
    };
  }

  constructADCS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const shifterOperand = (cpu.shifterOperand >>> 0) + Number(cpu.cpsrC);
      const d = (gprs[rn] >>> 0) + shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = d >> 31;
        cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = d > 0xFFFFFFFF ? 1 : 0;
        cpu.cpsrV =
          (gprs[rn] >> 31) == (shifterOperand >> 31) &&
          (gprs[rn] >> 31) != (d >> 31) &&
          (shifterOperand >> 31) != (d >> 31) ? 1 : 0;
      }
      gprs[rd] = d;
    };
  }

  constructADD(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = (gprs[rn] >>> 0) + (cpu.shifterOperand >>> 0);
    };
  }

  constructADDS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const d = (gprs[rn] >>> 0) + (cpu.shifterOperand >>> 0);
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = d >> 31;
        cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = d > 0xFFFFFFFF ? 1 : 0;
        cpu.cpsrV =
          (gprs[rn] >> 31) == (cpu.shifterOperand >> 31) &&
          (gprs[rn] >> 31) != (d >> 31) &&
          (cpu.shifterOperand >> 31) != (d >> 31) ? 1 : 0;
      }
      gprs[rd] = d;
    };
  }

  constructAND(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] & cpu.shifterOperand;
    };
  }

  constructANDS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] & cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = gprs[rd] >> 31;
        cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = cpu.shifterCarryOut;
      }
    };
  }

  constructB(immediate: number, condOp: (() => boolean) | null): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      gprs[cpu.PC] += immediate;
    };
  }

  constructBIC(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] & ~cpu.shifterOperand;
    };
  }

  constructBICS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] & ~cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = gprs[rd] >> 31;
        cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = cpu.shifterCarryOut;
      }
    };
  }

  constructBL(immediate: number, condOp: (() => boolean) | null): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      gprs[cpu.LR] = gprs[cpu.PC] - 4;
      gprs[cpu.PC] += immediate;
    };
  }

  constructBX(rm: number, condOp: (() => boolean) | null): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      cpu.switchExecMode(gprs[rm] & 0x00000001);
      gprs[cpu.PC] = gprs[rm] & 0xFFFFFFFE;
    };
  }

  constructCMN(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const aluOut = (gprs[rn] >>> 0) + (cpu.shifterOperand >>> 0);
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = aluOut > 0xFFFFFFFF ? 1 : 0;
      cpu.cpsrV =
        (gprs[rn] >> 31) == (cpu.shifterOperand >> 31) &&
        (gprs[rn] >> 31) != (aluOut >> 31) &&
        (cpu.shifterOperand >> 31) != (aluOut >> 31) ? 1 : 0;
    };
  }

  constructCMP(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const aluOut = gprs[rn] - cpu.shifterOperand;
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rn] >>> 0) >= (cpu.shifterOperand >>> 0) ? 1 : 0;
      cpu.cpsrV =
        (gprs[rn] >> 31) != (cpu.shifterOperand >> 31) &&
        (gprs[rn] >> 31) != (aluOut >> 31) ? 1 : 0;
    };
  }

  constructEOR(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] ^ cpu.shifterOperand;
    };
  }

  constructEORS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] ^ cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = gprs[rd] >> 31;
        cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = cpu.shifterCarryOut;
      }
    };
  }

  constructLDM(
    rs: number,
    address: (writeInitial?: boolean) => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    const mmu = cpu.mmu;
    return function () {
      mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      let addr = address(false);
      let total = 0;
      let m, i;
      for (m = rs, i = 0; m; m >>= 1, ++i) {
        if (m & 1) {
          gprs[i] = mmu.load32(addr & 0xFFFFFFFC);
          addr += 4;
          ++total;
        }
      }
      mmu.waitMulti32(addr, total);
      ++cpu.cycles;
    };
  }

  constructLDMS(
    rs: number,
    address: (writeInitial?: boolean) => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    const mmu = cpu.mmu;
    return function () {
      mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      let addr = address(false);
      let total = 0;
      const mode = cpu.mode;
      cpu.switchMode(cpu.MODE_SYSTEM);
      let m, i;
      for (m = rs, i = 0; m; m >>= 1, ++i) {
        if (m & 1) {
          gprs[i] = mmu.load32(addr & 0xFFFFFFFC);
          addr += 4;
          ++total;
        }
      }
      cpu.switchMode(mode);
      mmu.waitMulti32(addr, total);
      ++cpu.cycles;
    };
  }

  constructLDR(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      const addr = address();
      gprs[rd] = cpu.mmu.load32(addr);
      cpu.mmu.wait32(addr);
      ++cpu.cycles;
    };
  }

  constructLDRB(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      const addr = address();
      gprs[rd] = cpu.mmu.loadU8(addr);
      cpu.mmu.wait(addr);
      ++cpu.cycles;
    };
  }

  constructLDRH(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      const addr = address();
      gprs[rd] = cpu.mmu.loadU16(addr);
      cpu.mmu.wait(addr);
      ++cpu.cycles;
    };
  }

  constructLDRSB(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      const addr = address();
      gprs[rd] = cpu.mmu.load8(addr);
      cpu.mmu.wait(addr);
      ++cpu.cycles;
    };
  }

  constructLDRSH(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      const addr = address();
      gprs[rd] = cpu.mmu.load16(addr);
      cpu.mmu.wait(addr);
      ++cpu.cycles;
    };
  }

  constructMLA(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      ++cpu.cycles;
      cpu.mmu.waitMul(rs);
      if ((gprs[rm] & 0xFFFF0000) && (gprs[rs] & 0xFFFF0000)) {
        // Our data type is a double--we'll lose bits if we do it all at once!
        const hi = ((gprs[rm] & 0xFFFF0000) * gprs[rs]) & 0xFFFFFFFF;
        const lo = ((gprs[rm] & 0x0000FFFF) * gprs[rs]) & 0xFFFFFFFF;
        gprs[rd] = (hi + lo + gprs[rn]) & 0xFFFFFFFF;
      } else {
        gprs[rd] = gprs[rm] * gprs[rs] + gprs[rn];
      }
    };
  }

  constructMLAS(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      ++cpu.cycles;
      cpu.mmu.waitMul(rs);
      if ((gprs[rm] & 0xFFFF0000) && (gprs[rs] & 0xFFFF0000)) {
        // Our data type is a double--we'll lose bits if we do it all at once!
        const hi = ((gprs[rm] & 0xFFFF0000) * gprs[rs]) & 0xFFFFFFFF;
        const lo = ((gprs[rm] & 0x0000FFFF) * gprs[rs]) & 0xFFFFFFFF;
        gprs[rd] = (hi + lo + gprs[rn]) & 0xFFFFFFFF;
      } else {
        gprs[rd] = gprs[rm] * gprs[rs] + gprs[rn];
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructMOV(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = cpu.shifterOperand;
    };
  }

  constructMOVS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = gprs[rd] >> 31;
        cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = cpu.shifterCarryOut;
      }
    };
  }

  constructMRS(rd: number, r: number, condOp: (() => boolean) | null): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      if (r) {
        gprs[rd] = cpu.spsr;
      } else {
        gprs[rd] = cpu.packCPSR();
      }
    };
  }

  constructMSR(
    rm: number,
    r: number,
    instruction: number,
    immediate: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    const c = instruction & 0x00010000;
    //const x = instruction & 0x00020000;
    //const s = instruction & 0x00040000;
    const f = instruction & 0x00080000;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      let operand: number;
      if (instruction & 0x02000000) {
        operand = immediate;
      } else {
        operand = gprs[rm];
      }
      const mask =
        (c ? 0x000000FF : 0x00000000) |
        //(x ? 0x0000FF00 : 0x00000000) | // Irrelevant on ARMv4T
        //(s ? 0x00FF0000 : 0x00000000) | // Irrelevant on ARMv4T
        (f ? 0xFF000000 : 0x00000000);

      if (r) {
        let privMask = mask & (cpu.USER_MASK | cpu.PRIV_MASK | cpu.STATE_MASK);
        cpu.spsr = (cpu.spsr & ~privMask) | (operand & privMask);
      } else {
        if (mask & cpu.USER_MASK) {
          cpu.cpsrN = operand >> 31;
          cpu.cpsrZ = operand & 0x40000000;
          cpu.cpsrC = operand & 0x20000000;
          cpu.cpsrV = operand & 0x10000000;
        }
        if (cpu.mode != cpu.MODE_USER && (mask & cpu.PRIV_MASK)) {
          cpu.switchMode((operand & 0x0000000F) | 0x00000010);
          cpu.cpsrI = operand & 0x00000080;
          cpu.cpsrF = operand & 0x00000040;
        }
      }
    };
  }

  constructMUL(
    rd: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.mmu.waitMul(gprs[rs]);
      if ((gprs[rm] & 0xFFFF0000) && (gprs[rs] & 0xFFFF0000)) {
        // Our data type is a double--we'll lose bits if we do it all at once!
        const hi = ((gprs[rm] & 0xFFFF0000) * gprs[rs]) | 0;
        const lo = ((gprs[rm] & 0x0000FFFF) * gprs[rs]) | 0;
        gprs[rd] = hi + lo;
      } else {
        gprs[rd] = gprs[rm] * gprs[rs];
      }
    };
  }

  constructMULS(
    rd: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.mmu.waitMul(gprs[rs]);
      if ((gprs[rm] & 0xFFFF0000) && (gprs[rs] & 0xFFFF0000)) {
        // Our data type is a double--we'll lose bits if we do it all at once!
        const hi = ((gprs[rm] & 0xFFFF0000) * gprs[rs]) | 0;
        const lo = ((gprs[rm] & 0x0000FFFF) * gprs[rs]) | 0;
        gprs[rd] = hi + lo;
      } else {
        gprs[rd] = gprs[rm] * gprs[rs];
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructMVN(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = ~cpu.shifterOperand;
    };
  }

  constructMVNS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = ~cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = gprs[rd] >> 31;
        cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = cpu.shifterCarryOut;
      }
    };
  }

  constructORR(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] | cpu.shifterOperand;
    };
  }

  constructORRS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] | cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = gprs[rd] >> 31;
        cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = cpu.shifterCarryOut;
      }
    };
  }

  constructRSB(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = cpu.shifterOperand - gprs[rn];
    };
  }

  constructRSBS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const d = cpu.shifterOperand - gprs[rn];
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = d >> 31;
        cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = (cpu.shifterOperand >>> 0) >= (gprs[rn] >>> 0) ? 1 : 0;
        cpu.cpsrV =
          (cpu.shifterOperand >> 31) != (gprs[rn] >> 31) &&
          (cpu.shifterOperand >> 31) != (d >> 31) ? 1 : 0;
      }
      gprs[rd] = d;
    };
  }

  constructRSC(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const n = (gprs[rn] >>> 0) + (cpu.cpsrC ? 0 : 1);
      gprs[rd] = (cpu.shifterOperand >>> 0) - n;
    };
  }

  constructRSCS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const n = (gprs[rn] >>> 0) + (cpu.cpsrC ? 0 : 1);
      const d = (cpu.shifterOperand >>> 0) - n;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = d >> 31;
        cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = (cpu.shifterOperand >>> 0) >= (d >>> 0) ? 1 : 0;
        cpu.cpsrV =
          (cpu.shifterOperand >> 31) != (n >> 31) &&
          (cpu.shifterOperand >> 31) != (d >> 31) ? 1 : 0;
      }
      gprs[rd] = d;
    };
  }

  constructSBC(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const shifterOperand = (cpu.shifterOperand >>> 0) + (cpu.cpsrC ? 0 : 1);
      gprs[rd] = (gprs[rn] >>> 0) - shifterOperand;
    };
  }

  constructSBCS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const shifterOperand = (cpu.shifterOperand >>> 0) + (cpu.cpsrC ? 0 : 1);
      const d = (gprs[rn] >>> 0) - shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = d >> 31;
        cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = (gprs[rn] >>> 0) >= (d >>> 0) ? 1 : 0;
        cpu.cpsrV =
          (gprs[rn] >> 31) != (shifterOperand >> 31) &&
          (gprs[rn] >> 31) != (d >> 31) ? 1 : 0;
      }
      gprs[rd] = d;
    };
  }

  constructSMLAL(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.cycles += 2;
      cpu.mmu.waitMul(rs);
      const hi = (gprs[rm] & 0xFFFF0000) * gprs[rs];
      const lo = (gprs[rm] & 0x0000FFFF) * gprs[rs];
      const carry = (gprs[rn] >>> 0) + hi + lo;
      gprs[rn] = carry;
      gprs[rd] += Math.floor(carry * SHIFT_32);
    };
  }

  constructSMLALS(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.cycles += 2;
      cpu.mmu.waitMul(rs);
      const hi = (gprs[rm] & 0xFFFF0000) * gprs[rs];
      const lo = (gprs[rm] & 0x0000FFFF) * gprs[rs];
      const carry = (gprs[rn] >>> 0) + hi + lo;
      gprs[rn] = carry;
      gprs[rd] += Math.floor(carry * SHIFT_32);
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (!(gprs[rd] & 0xFFFFFFFF) && !(gprs[rn] & 0xFFFFFFFF)) ? 1 : 0;
    };
  }

  constructSMULL(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      ++cpu.cycles;
      cpu.mmu.waitMul(gprs[rs]);
      const hi = ((gprs[rm] & 0xFFFF0000) >> 0) * (gprs[rs] >> 0);
      const lo = ((gprs[rm] & 0x0000FFFF) >> 0) * (gprs[rs] >> 0);
      gprs[rn] = ((hi & 0xFFFFFFFF) + (lo & 0xFFFFFFFF)) & 0xFFFFFFFF;
      gprs[rd] = Math.floor(hi * SHIFT_32 + lo * SHIFT_32);
    };
  }

  constructSMULLS(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      ++cpu.cycles;
      cpu.mmu.waitMul(gprs[rs]);
      const hi = ((gprs[rm] & 0xFFFF0000) >> 0) * (gprs[rs] >> 0);
      const lo = ((gprs[rm] & 0x0000FFFF) >> 0) * (gprs[rs] >> 0);
      gprs[rn] = ((hi & 0xFFFFFFFF) + (lo & 0xFFFFFFFF)) & 0xFFFFFFFF;
      gprs[rd] = Math.floor(hi * SHIFT_32 + lo * SHIFT_32);
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (!(gprs[rd] & 0xFFFFFFFF) && !(gprs[rn] & 0xFFFFFFFF)) ? 1 : 0;
    };
  }

  constructSTM(
    rs: number,
    address: (writeInitial?: boolean) => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    const mmu = cpu.mmu;
    return function () {
      if (condOp && !condOp()) {
        mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      mmu.wait32(gprs[cpu.PC]);
      let addr = address(true);
      let total = 0;
      let m, i;
      for (m = rs, i = 0; m; m >>= 1, ++i) {
        if (m & 1) {
          mmu.store32(addr, gprs[i]);
          addr += 4;
          ++total;
        }
      }
      mmu.waitMulti32(addr, total);
    };
  }

  constructSTMS(
    rs: number,
    address: (writeInitial?: boolean) => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    const mmu = cpu.mmu;
    return function () {
      if (condOp && !condOp()) {
        mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      mmu.wait32(gprs[cpu.PC]);
      const mode = cpu.mode;
      let addr = address(true);
      let total = 0;
      let m, i;
      cpu.switchMode(cpu.MODE_SYSTEM);
      for (m = rs, i = 0; m; m >>= 1, ++i) {
        if (m & 1) {
          mmu.store32(addr, gprs[i]);
          addr += 4;
          ++total;
        }
      }
      cpu.switchMode(mode);
      mmu.waitMulti32(addr, total);
    };
  }

  constructSTR(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      const addr = address();
      cpu.mmu.store32(addr, gprs[rd]);
      cpu.mmu.wait32(addr);
      cpu.mmu.wait32(gprs[cpu.PC]);
    };
  }

  constructSTRB(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      const addr = address();
      cpu.mmu.store8(addr, gprs[rd]);
      cpu.mmu.wait(addr);
      cpu.mmu.wait32(gprs[cpu.PC]);
    };
  }

  constructSTRH(
    rd: number,
    address: () => number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      const addr = address();
      cpu.mmu.store16(addr, gprs[rd]);
      cpu.mmu.wait(addr);
      cpu.mmu.wait32(gprs[cpu.PC]);
    };
  }

  constructSUB(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      gprs[rd] = gprs[rn] - cpu.shifterOperand;
    };
  }

  constructSUBS(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const d = gprs[rn] - cpu.shifterOperand;
      if (rd == cpu.PC && cpu.hasSPSR()) {
        cpu.unpackCPSR(cpu.spsr);
      } else {
        cpu.cpsrN = d >> 31;
        cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
        cpu.cpsrC = (gprs[rn] >>> 0) >= (cpu.shifterOperand >>> 0) ? 1 : 0;
        cpu.cpsrV =
          (gprs[rn] >> 31) != (cpu.shifterOperand >> 31) &&
          (gprs[rn] >> 31) != (d >> 31) ? 1 : 0;
      }
      gprs[rd] = d;
    };
  }

  constructSWI(immediate: number, condOp: (() => boolean) | null): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      if (condOp && !condOp()) {
        cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
        return;
      }
      cpu.irq.swi32(immediate);
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
    };
  }

  constructSWP(
    rd: number,
    rn: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.mmu.wait32(gprs[rn]);
      cpu.mmu.wait32(gprs[rn]);
      const d = cpu.mmu.load32(gprs[rn]);
      cpu.mmu.store32(gprs[rn], gprs[rm]);
      gprs[rd] = d;
      ++cpu.cycles;
    };
  }

  constructSWPB(
    rd: number,
    rn: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.mmu.wait(gprs[rn]);
      cpu.mmu.wait(gprs[rn]);
      const d = cpu.mmu.load8(gprs[rn]);
      cpu.mmu.store8(gprs[rn], gprs[rm]);
      gprs[rd] = d;
      ++cpu.cycles;
    };
  }

  constructTEQ(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const aluOut = gprs[rn] ^ cpu.shifterOperand;
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = cpu.shifterCarryOut;
    };
  }

  constructTST(
    rd: number,
    rn: number,
    shiftOp: () => void,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      shiftOp();
      const aluOut = gprs[rn] & cpu.shifterOperand;
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = cpu.shifterCarryOut;
    };
  }

  constructUMLAL(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.cycles += 2;
      cpu.mmu.waitMul(rs);
      const hi = ((gprs[rm] & 0xFFFF0000) >>> 0) * (gprs[rs] >>> 0);
      const lo = (gprs[rm] & 0x0000FFFF) * (gprs[rs] >>> 0);
      const carry = (gprs[rn] >>> 0) + hi + lo;
      gprs[rn] = carry;
      gprs[rd] += carry * SHIFT_32;
    };
  }

  constructUMLALS(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      cpu.cycles += 2;
      cpu.mmu.waitMul(rs);
      const hi = ((gprs[rm] & 0xFFFF0000) >>> 0) * (gprs[rs] >>> 0);
      const lo = (gprs[rm] & 0x0000FFFF) * (gprs[rs] >>> 0);
      const carry = (gprs[rn] >>> 0) + hi + lo;
      gprs[rn] = carry;
      gprs[rd] += carry * SHIFT_32;
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (!(gprs[rd] & 0xFFFFFFFF) && !(gprs[rn] & 0xFFFFFFFF)) ? 1 : 0;
    };
  }

  constructUMULL(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      ++cpu.cycles;
      cpu.mmu.waitMul(gprs[rs]);
      const hi = ((gprs[rm] & 0xFFFF0000) >>> 0) * (gprs[rs] >>> 0);
      const lo = ((gprs[rm] & 0x0000FFFF) >>> 0) * (gprs[rs] >>> 0);
      gprs[rn] = ((hi & 0xFFFFFFFF) + (lo & 0xFFFFFFFF)) & 0xFFFFFFFF;
      gprs[rd] = (hi * SHIFT_32 + lo * SHIFT_32) >>> 0;
    };
  }

  constructUMULLS(
    rd: number,
    rn: number,
    rs: number,
    rm: number,
    condOp: (() => boolean) | null
  ): () => void {
    const cpu = this.cpu;
    const SHIFT_32 = 1 / 0x100000000;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch32(gprs[cpu.PC]);
      if (condOp && !condOp()) {
        return;
      }
      ++cpu.cycles;
      cpu.mmu.waitMul(gprs[rs]);
      const hi = ((gprs[rm] & 0xFFFF0000) >>> 0) * (gprs[rs] >>> 0);
      const lo = ((gprs[rm] & 0x0000FFFF) >>> 0) * (gprs[rs] >>> 0);
      gprs[rn] = ((hi & 0xFFFFFFFF) + (lo & 0xFFFFFFFF)) & 0xFFFFFFFF;
      gprs[rd] = (hi * SHIFT_32 + lo * SHIFT_32) >>> 0;
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (!(gprs[rd] & 0xFFFFFFFF) && !(gprs[rn] & 0xFFFFFFFF)) ? 1 : 0;
    };
  }
}
