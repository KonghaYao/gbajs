interface CPU {
  gprs: Int32Array;
  PC: number;
  LR: number;
  SP: number;
  mmu: {
    waitPrefetch(addr: number): void;
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
  cycles: number;
  mode: number;
  MODE_SYSTEM: number;
  hasSPSR(): boolean;
  unpackCPSR(spsr: number): void;
  switchMode(mode: number): void;
  switchExecMode(mode: number): void;
  irq: {
    swi(immediate: number): void;
  };
}

export class ARMCoreThumb {
  cpu: CPU;

  constructor(cpu: CPU) {
    this.cpu = cpu;
  }

  constructADC(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const m = (gprs[rm] >>> 0) + Number(cpu.cpsrC);
      const oldD = gprs[rd];
      const d = (oldD >>> 0) + m;
      const oldDn = oldD >> 31;
      const dn = d >> 31;
      const mn = m >> 31;
      cpu.cpsrN = dn;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = d > 0xFFFFFFFF ? 1 : 0;
      cpu.cpsrV = (oldDn == mn && oldDn != dn && mn != dn) ? 1 : 0;
      gprs[rd] = d;
    };
  }

  constructADD1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = (gprs[rn] >>> 0) + immediate;
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = d > 0xFFFFFFFF ? 1 : 0;
      cpu.cpsrV = (!(gprs[rn] >> 31) && ((gprs[rn] >> 31 ^ d) >> 31) && (d >> 31)) ? 1 : 0;
      gprs[rd] = d;
    };
  }

  constructADD2(rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = (gprs[rn] >>> 0) + immediate;
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = d > 0xFFFFFFFF ? 1 : 0;
      cpu.cpsrV = (!(gprs[rn] >> 31) && ((gprs[rn] ^ d) >> 31) && ((immediate ^ d) >> 31)) ? 1 : 0;
      gprs[rn] = d;
    };
  }

  constructADD3(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = (gprs[rn] >>> 0) + (gprs[rm] >>> 0);
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = d > 0xFFFFFFFF ? 1 : 0;
      cpu.cpsrV = (!((gprs[rn] ^ gprs[rm]) >> 31) && ((gprs[rn] ^ d) >> 31) && ((gprs[rm] ^ d) >> 31)) ? 1 : 0;
      gprs[rd] = d;
    };
  }

  constructADD4(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] += gprs[rm];
    };
  }

  constructADD5(rd: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = (gprs[cpu.PC] & 0xFFFFFFFC) + immediate;
    };
  }

  constructADD6(rd: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = gprs[cpu.SP] + immediate;
    };
  }

  constructADD7(immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[cpu.SP] += immediate;
    };
  }

  constructAND(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = gprs[rd] & gprs[rm];
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructASR1(rd: number, rm: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      if (immediate == 0) {
        cpu.cpsrC = gprs[rm] >> 31;
        if (cpu.cpsrC) {
          gprs[rd] = 0xFFFFFFFF;
        } else {
          gprs[rd] = 0;
        }
      } else {
        cpu.cpsrC = gprs[rm] & (1 << (immediate - 1));
        gprs[rd] = gprs[rm] >> immediate;
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructASR2(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const rs = gprs[rm] & 0xFF;
      if (rs) {
        if (rs < 32) {
          cpu.cpsrC = gprs[rd] & (1 << (rs - 1));
          gprs[rd] >>= rs;
        } else {
          cpu.cpsrC = gprs[rd] >> 31;
          if (cpu.cpsrC) {
            gprs[rd] = 0xFFFFFFFF;
          } else {
            gprs[rd] = 0;
          }
        }
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructB1(immediate: number, condOp: () => boolean): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      if (condOp()) {
        gprs[cpu.PC] += immediate;
      }
    };
  }

  constructB2(immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[cpu.PC] += immediate;
    };
  }

  constructBIC(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = gprs[rd] & ~gprs[rm];
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructBL1(immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[cpu.LR] = gprs[cpu.PC] + immediate;
    };
  }

  constructBL2(immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const pc = gprs[cpu.PC];
      gprs[cpu.PC] = gprs[cpu.LR] + (immediate << 1);
      gprs[cpu.LR] = pc - 1;
    };
  }

  constructBX(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      cpu.switchExecMode(gprs[rm] & 0x00000001);
      let misalign = 0;
      if (rm == 15) {
        misalign = gprs[rm] & 0x00000002;
      }
      gprs[cpu.PC] = gprs[rm] & 0xFFFFFFFE - misalign;
    };
  }

  constructCMN(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const aluOut = (gprs[rd] >>> 0) + (gprs[rm] >>> 0);
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = aluOut > 0xFFFFFFFF ? 1 : 0;
      cpu.cpsrV =
        ((gprs[rd] >> 31) == (gprs[rm] >> 31) &&
          (gprs[rd] >> 31) != (aluOut >> 31) &&
          (gprs[rm] >> 31) != (aluOut >> 31))
          ? 1
          : 0;
    };
  }

  constructCMP1(rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const aluOut = gprs[rn] - immediate;
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rn] >>> 0) >= immediate ? 1 : 0;
      cpu.cpsrV = ((gprs[rn] >> 31) && ((gprs[rn] ^ aluOut) >> 31)) ? 1 : 0;
    };
  }

  constructCMP2(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = gprs[rd];
      const m = gprs[rm];
      const aluOut = d - m;
      const an = aluOut >> 31;
      const dn = d >> 31;
      cpu.cpsrN = an;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (d >>> 0) >= (m >>> 0) ? 1 : 0;
      cpu.cpsrV = (dn != (m >> 31) && dn != an) ? 1 : 0;
    };
  }

  constructCMP3(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const aluOut = gprs[rd] - gprs[rm];
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rd] >>> 0) >= (gprs[rm] >>> 0) ? 1 : 0;
      cpu.cpsrV = (((gprs[rd] ^ gprs[rm]) >> 31) && ((gprs[rd] ^ aluOut) >> 31)) ? 1 : 0;
    };
  }

  constructEOR(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = gprs[rd] ^ gprs[rm];
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructLDMIA(rn: number, rs: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      let address = gprs[rn];
      let total = 0;
      let m, i;
      for (m = 0x01, i = 0; i < 8; m <<= 1, ++i) {
        if (rs & m) {
          gprs[i] = cpu.mmu.load32(address);
          address += 4;
          ++total;
        }
      }
      cpu.mmu.waitMulti32(address, total);
      if (!((1 << rn) & rs)) {
        gprs[rn] = address;
      }
    };
  }

  constructLDR1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const n = gprs[rn] + immediate;
      gprs[rd] = cpu.mmu.load32(n);
      cpu.mmu.wait32(n);
      ++cpu.cycles;
    };
  }

  constructLDR2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.load32(gprs[rn] + gprs[rm]);
      cpu.mmu.wait32(gprs[rn] + gprs[rm]);
      ++cpu.cycles;
    };
  }

  constructLDR3(rd: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.load32((gprs[cpu.PC] & 0xFFFFFFFC) + immediate);
      cpu.mmu.wait32(gprs[cpu.PC]);
      ++cpu.cycles;
    };
  }

  constructLDR4(rd: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.load32(gprs[cpu.SP] + immediate);
      cpu.mmu.wait32(gprs[cpu.SP] + immediate);
      ++cpu.cycles;
    };
  }

  constructLDRB1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      const n = gprs[rn] + immediate;
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.loadU8(n);
      cpu.mmu.wait(n);
      ++cpu.cycles;
    };
  }

  constructLDRB2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.loadU8(gprs[rn] + gprs[rm]);
      cpu.mmu.wait(gprs[rn] + gprs[rm]);
      ++cpu.cycles;
    };
  }

  constructLDRH1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      const n = gprs[rn] + immediate;
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.loadU16(n);
      cpu.mmu.wait(n);
      ++cpu.cycles;
    };
  }

  constructLDRH2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.loadU16(gprs[rn] + gprs[rm]);
      cpu.mmu.wait(gprs[rn] + gprs[rm]);
      ++cpu.cycles;
    };
  }

  constructLDRSB(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.load8(gprs[rn] + gprs[rm]);
      cpu.mmu.wait(gprs[rn] + gprs[rm]);
      ++cpu.cycles;
    };
  }

  constructLDRSH(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = cpu.mmu.load16(gprs[rn] + gprs[rm]);
      cpu.mmu.wait(gprs[rn] + gprs[rm]);
      ++cpu.cycles;
    };
  }

  constructLSL1(rd: number, rm: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      if (immediate == 0) {
        gprs[rd] = gprs[rm];
      } else {
        cpu.cpsrC = gprs[rm] & (1 << (32 - immediate));
        gprs[rd] = gprs[rm] << immediate;
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructLSL2(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const rs = gprs[rm] & 0xFF;
      if (rs) {
        if (rs < 32) {
          cpu.cpsrC = gprs[rd] & (1 << (32 - rs));
          gprs[rd] <<= rs;
        } else {
          if (rs > 32) {
            cpu.cpsrC = 0;
          } else {
            cpu.cpsrC = gprs[rd] & 0x00000001;
          }
          gprs[rd] = 0;
        }
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructLSR1(rd: number, rm: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      if (immediate == 0) {
        cpu.cpsrC = gprs[rm] >> 31;
        gprs[rd] = 0;
      } else {
        cpu.cpsrC = gprs[rm] & (1 << (immediate - 1));
        gprs[rd] = gprs[rm] >>> immediate;
      }
      cpu.cpsrN = 0;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructLSR2(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const rs = gprs[rm] & 0xFF;
      if (rs) {
        if (rs < 32) {
          cpu.cpsrC = gprs[rd] & (1 << (rs - 1));
          gprs[rd] >>>= rs;
        } else {
          if (rs > 32) {
            cpu.cpsrC = 0;
          } else {
            cpu.cpsrC = gprs[rd] >> 31;
          }
          gprs[rd] = 0;
        }
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructMOV1(rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rn] = immediate;
      cpu.cpsrN = immediate >> 31;
      cpu.cpsrZ = (immediate & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructMOV2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = gprs[rn];
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = 0;
      cpu.cpsrV = 0;
      gprs[rd] = d;
    };
  }

  constructMOV3(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = gprs[rm];
    };
  }

  constructMUL(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      cpu.mmu.waitMul(gprs[rm]);
      if ((gprs[rm] & 0xFFFF0000) && (gprs[rd] & 0xFFFF0000)) {
        // Our data type is a double--we'll lose bits if we do it all at once!
        const hi = ((gprs[rd] & 0xFFFF0000) * gprs[rm]) & 0xFFFFFFFF;
        const lo = ((gprs[rd] & 0x0000FFFF) * gprs[rm]) & 0xFFFFFFFF;
        gprs[rd] = (hi + lo) & 0xFFFFFFFF;
      } else {
        gprs[rd] *= gprs[rm];
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructMVN(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = ~gprs[rm];
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructNEG(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = -gprs[rm];
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = 0 >= (d >>> 0) ? 1 : 0;
      cpu.cpsrV = ((gprs[rm] >> 31) && (d >> 31)) ? 1 : 0;
      gprs[rd] = d;
    };
  }

  constructORR(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      gprs[rd] = gprs[rd] | gprs[rm];
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructPOP(rs: number, r: boolean): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      ++cpu.cycles;
      let address = gprs[cpu.SP];
      let total = 0;
      let m, i;
      for (m = 0x01, i = 0; i < 8; m <<= 1, ++i) {
        if (rs & m) {
          cpu.mmu.waitSeq32(address);
          gprs[i] = cpu.mmu.load32(address);
          address += 4;
          ++total;
        }
      }
      if (r) {
        gprs[cpu.PC] = cpu.mmu.load32(address) & 0xFFFFFFFE;
        address += 4;
        ++total;
      }
      cpu.mmu.waitMulti32(address, total);
      gprs[cpu.SP] = address;
    };
  }

  constructPUSH(rs: number, r: boolean): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      let address = gprs[cpu.SP] - 4;
      let total = 0;
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      if (r) {
        cpu.mmu.store32(address, gprs[cpu.LR]);
        address -= 4;
        ++total;
      }
      let m, i;
      for (m = 0x80, i = 7; m; m >>= 1, --i) {
        if (rs & m) {
          cpu.mmu.store32(address, gprs[i]);
          address -= 4;
          ++total;
          break;
        }
      }
      for (m >>= 1, --i; m; m >>= 1, --i) {
        if (rs & m) {
          cpu.mmu.store32(address, gprs[i]);
          address -= 4;
          ++total;
        }
      }
      cpu.mmu.waitMulti32(address, total);
      gprs[cpu.SP] = address + 4;
    };
  }

  constructROR(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const rs = gprs[rm] & 0xFF;
      if (rs) {
        const r4 = rs & 0x1F;
        if (r4 > 0) {
          cpu.cpsrC = gprs[rd] & (1 << (r4 - 1));
          gprs[rd] = (gprs[rd] >>> r4) | (gprs[rd] << (32 - r4));
        } else {
          cpu.cpsrC = gprs[rd] >> 31;
        }
      }
      cpu.cpsrN = gprs[rd] >> 31;
      cpu.cpsrZ = (gprs[rd] & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }

  constructSBC(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const m = (gprs[rm] >>> 0) + (cpu.cpsrC ? 0 : 1);
      const d = (gprs[rd] >>> 0) - m;
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rd] >>> 0) >= (d >>> 0) ? 1 : 0;
      cpu.cpsrV = (((gprs[rd] ^ m) >> 31) && ((gprs[rd] ^ d) >> 31)) ? 1 : 0;
      gprs[rd] = d;
    };
  }

  constructSTMIA(rn: number, rs: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.wait(gprs[cpu.PC]);
      let address = gprs[rn];
      let total = 0;
      let m, i;
      for (m = 0x01, i = 0; i < 8; m <<= 1, ++i) {
        if (rs & m) {
          cpu.mmu.store32(address, gprs[i]);
          address += 4;
          ++total;
          break;
        }
      }
      for (m <<= 1, ++i; i < 8; m <<= 1, ++i) {
        if (rs & m) {
          cpu.mmu.store32(address, gprs[i]);
          address += 4;
          ++total;
        }
      }
      cpu.mmu.waitMulti32(address, total);
      gprs[rn] = address;
    };
  }

  constructSTR1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      const n = gprs[rn] + immediate;
      cpu.mmu.store32(n, gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait32(n);
    };
  }

  constructSTR2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.store32(gprs[rn] + gprs[rm], gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait32(gprs[rn] + gprs[rm]);
    };
  }

  constructSTR3(rd: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.store32(gprs[cpu.SP] + immediate, gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait32(gprs[cpu.SP] + immediate);
    };
  }

  constructSTRB1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      const n = gprs[rn] + immediate;
      cpu.mmu.store8(n, gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait(n);
    };
  }

  constructSTRB2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.store8(gprs[rn] + gprs[rm], gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait(gprs[rn] + gprs[rm]);
    };
  }

  constructSTRH1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      const n = gprs[rn] + immediate;
      cpu.mmu.store16(n, gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait(n);
    };
  }

  constructSTRH2(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.store16(gprs[rn] + gprs[rm], gprs[rd]);
      cpu.mmu.wait(gprs[cpu.PC]);
      cpu.mmu.wait(gprs[rn] + gprs[rm]);
    };
  }

  constructSUB1(rd: number, rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = gprs[rn] - immediate;
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rn] >>> 0) >= immediate ? 1 : 0;
      cpu.cpsrV = ((gprs[rn] >> 31) && ((gprs[rn] ^ d) >> 31)) ? 1 : 0;
      gprs[rd] = d;
    };
  }

  constructSUB2(rn: number, immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = gprs[rn] - immediate;
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rn] >>> 0) >= immediate ? 1 : 0;
      cpu.cpsrV = ((gprs[rn] >> 31) && ((gprs[rn] ^ d) >> 31)) ? 1 : 0;
      gprs[rn] = d;
    };
  }

  constructSUB3(rd: number, rn: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const d = gprs[rn] - gprs[rm];
      cpu.cpsrN = d >> 31;
      cpu.cpsrZ = (d & 0xFFFFFFFF) === 0 ? 1 : 0;
      cpu.cpsrC = (gprs[rn] >>> 0) >= (gprs[rm] >>> 0) ? 1 : 0;
      cpu.cpsrV =
        ((gprs[rn] >> 31) != (gprs[rm] >> 31) &&
          (gprs[rn] >> 31) != (d >> 31))
          ? 1
          : 0;
      gprs[rd] = d;
    };
  }

  constructSWI(immediate: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.irq.swi(immediate);
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
    };
  }

  constructTST(rd: number, rm: number): () => void {
    const cpu = this.cpu;
    const gprs = cpu.gprs;
    return function () {
      cpu.mmu.waitPrefetch(gprs[cpu.PC]);
      const aluOut = gprs[rd] & gprs[rm];
      cpu.cpsrN = aluOut >> 31;
      cpu.cpsrZ = (aluOut & 0xFFFFFFFF) === 0 ? 1 : 0;
    };
  }
}
