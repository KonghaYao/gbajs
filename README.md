GBA.js
======

**GBA.js** is a Game Boy Advance emulator written in TypeScript that uses HTML5 Canvas and Web Audio for rendering and sound. It requires no plugins and runs in modern browsers.

> **Original work by Jeffrey Pfau** — [endrift/gbajs](https://github.com/endrift/gbajs).  
> This fork (v2.x) modernizes the codebase: strict TypeScript, ES modules, pluggable persistence, and an SDK for headless usage.

## Quick Start

### Browser

```bash
npm install && npm run build && npm run dev
```

Open `http://localhost:8080`, select a GBA ROM. The BIOS is loaded automatically.

### SDK (Bun / Node headless)

```ts
import { GBA, MemorySaveBackend } from 'gbajs';

const gba = new GBA();
gba.setBios(biosBuffer);
gba.setRom(romBuffer);

for (let i = 0; i < 1000; i++) gba.step();
```

### SDK with persistence

```ts
import { GBA, FsSaveBackend } from 'gbajs';

const gba = new GBA({
  saveBackend: new FsSaveBackend('./saves'),
});
gba.setBios(biosBuf);
await gba.setRomAsync(romBuf); // loads existing savedata automatically

gba.advanceFrame();
gba.storeSavedata(); // written to ./saves/ every VBlank
```

## Persistence Backends

| Backend | Storage | Environment | Use Case |
|---------|---------|-------------|----------|
| `IDBSaveBackend` *(default)* | IndexedDB | Browser | Large saves, savestates |
| `FileSystemSaveBackend` | Local folder | Chrome/Edge | Direct file access |
| `LocalStorageSaveBackend` | localStorage | Browser | Lightweight fallback |
| `FsSaveBackend` | Filesystem | Bun/Node | Server-side / CLI |
| `MemorySaveBackend` | In-memory | Any | Testing, ephemeral |

The default browser backend is **IndexedDB** — no localStorage size limits.  
To use a local folder, click **"Select Save Folder"** in the UI (supports Chrome 86+).

## Architecture

```
src/
├── sdk.ts              # Clean SDK entry
├── gba.ts              # GameBoyAdvance orchestrator (config injection)
├── save-backend.ts     # Persistence interface + 5 implementations
├── core.ts / arm.ts / thumb.ts   # CPU / ARM / Thumb
├── mmu.ts / io.ts / irq.ts       # Memory / I/O / Interrupts
├── audio.ts / video.ts / video/  # Audio / Video rendering
├── keypad.ts / sio.ts            # Input / Serial I/O
├── savedata.ts / gpio.ts         # SRAM/Flash/EEPROM / RTC
├── console.ts                    # Debugger tools
├── main.ts                       # Browser entry point (UI bindings)
└── *.test.ts                     # Unit tests (Bun)
```

## Scripts

```bash
npm run dev         # Start dev server (bun serve dist)
npm run build       # Compile TypeScript (tsc)
npm test            # Run tests (bun test)
npm run typecheck   # Type-only check (tsc --noEmit)
```

## Browser Compatibility

Modern browsers with Canvas, Web Audio, File API, and ES modules:

- Chrome 86+
- Edge 86+
- Safari 15+
- Firefox 90+

> File System Access API (`showDirectoryPicker`) is supported in Chromium-based browsers (Chrome/Edge/Opera) for local folder persistence.

## Features

- Full GBA hardware emulation (CPU, PPU, APU, DMA, timers, interrupts)
- ARM and Thumb instruction sets
- Software and Web Worker rendering
- Savegame download / upload / auto-persist
- Savestate freeze / defrost with PNG stealth export
- Screenshots
- RTC support (Pokémon Ruby/Sapphire/Emerald)
- Gamepad support
- Fullscreen
- Remappable controls (via keypad.ts)
- Debugger with memory/palette/tile viewers

## License

### Original work

Copyright © 2012 – 2013, Jeffrey Pfau. All rights reserved.

### Modifications (v2.x)

This fork is a substantial rewrite:

- Vanilla JS → strict TypeScript with ES modules
- Global variables → dependency injection (`GBAConfig`)
- Prototype inheritance → ES6 classes
- Browser-only → SDK for headless Bun/Node usage
- localStorage → pluggable persistence (IDB, File System API, filesystem)
- Zero tests → unit tests (Bun runner)

All modifications are released under the same 2-clause BSD license.

### License text

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
