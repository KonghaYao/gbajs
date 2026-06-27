/**
 * SaveBackend — pluggable persistence for GBA savedata and savestates.
 *
 * All implementations are environment-agnostic.
 * The backend is injected into GameBoyAdvance at construction time.
 */

// Augment global types for File System Access API (not yet in default DOM lib)
declare global {
  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
  interface DirectoryPickerOptions {
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }
  interface FileSystemDirectoryHandle {
    name: string;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle>;
    removeEntry(name: string): Promise<void>;
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  }
  interface FileSystemFileHandle {
    name: string;
    createWritable(): Promise<FileSystemWritableFileStream>;
    getFile(): Promise<File>;
  }
  interface FileSystemGetFileOptions {
    create?: boolean;
  }
  interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    seek(position: number): Promise<void>;
    truncate(size: number): Promise<void>;
    close(): Promise<void>;
  }
}

/** A raw savedata buffer (SRAM, Flash, or EEPROM content). */
export type SavedataBuffer = ArrayBuffer;

/** A serialized savestate blob (freeze output). */
export type SavestateBlob = Blob;

/**
 * Persistence backend interface.
 *
 * Two independent concerns:
 * - Savedata: the game's in-cartridge save memory (SRAM/Flash/EEPROM).
 *   Typically small (8KB–128KB), written infrequently.
 * - Savestate: a full emulator freeze snapshot. Can be megabytes (includes
 *   VRAM, palette, working RAM, etc.), written on user demand.
 */
export interface SaveBackend {
  /** Load savedata for the given key. Returns null if no data exists. */
  loadSavedata(key: string): Promise<SavedataBuffer | null>;

  /** Store savedata. Called after each write to SRAM/Flash/EEPROM. */
  storeSavedata(key: string, data: SavedataBuffer): Promise<void>;

  /**
   * Load a savestate blob. Returns null if no state exists.
   * The blob format is Serializer.serialize() output.
   */
  loadSavestate(key: string): Promise<SavestateBlob | null>;

  /** Store a savestate blob. */
  storeSavestate(key: string, data: SavestateBlob): Promise<void>;

  /** List all savedata keys (for management UIs). */
  listKeys(prefix?: string): Promise<string[]>;

  /** Delete savedata for a key. */
  deleteKey(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory backend — default for non-persistent usage (testing, headless)
// ---------------------------------------------------------------------------

export class MemorySaveBackend implements SaveBackend {
  private savedataStore = new Map<string, SavedataBuffer>();
  private savestateStore = new Map<string, SavestateBlob>();

  async loadSavedata(key: string): Promise<SavedataBuffer | null> {
    return this.savedataStore.get(key) ?? null;
  }

  async storeSavedata(key: string, data: SavedataBuffer): Promise<void> {
    this.savedataStore.set(key, data);
  }

  async loadSavestate(key: string): Promise<SavestateBlob | null> {
    return this.savestateStore.get(key) ?? null;
  }

  async storeSavestate(key: string, data: SavestateBlob): Promise<void> {
    this.savestateStore.set(key, data);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const all = [...this.savedataStore.keys(), ...this.savestateStore.keys()];
    if (!prefix) return all;
    return all.filter((k) => k.startsWith(prefix));
  }

  async deleteKey(key: string): Promise<void> {
    this.savedataStore.delete(key);
    this.savestateStore.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Browser localStorage backend — current default for web usage
// ---------------------------------------------------------------------------

export class LocalStorageSaveBackend implements SaveBackend {
  private storage: Storage;

  constructor(storage?: Storage) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null!);
    if (!this.storage) {
      throw new Error('LocalStorageSaveBackend: no Storage available (not in browser?)');
    }
  }

  async loadSavedata(key: string): Promise<SavedataBuffer | null> {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    return this.decodeBase64(raw);
  }

  async storeSavedata(key: string, data: SavedataBuffer): Promise<void> {
    const encoded = this.encodeBase64(data);
    this.storage.setItem(key, encoded);
  }

  async loadSavestate(_key: string): Promise<SavestateBlob | null> {
    // Savestates are too large for localStorage — return null.
    // Use IDBSaveBackend for savestates in the browser.
    return null;
  }

  async storeSavestate(_key: string, _data: SavestateBlob): Promise<void> {
    // Savestates not supported in localStorage.
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && (!prefix || key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    return keys;
  }

  async deleteKey(key: string): Promise<void> {
    this.storage.removeItem(key);
  }

  private encodeBase64(buffer: ArrayBuffer): string {
    const view = new Uint8Array(buffer);
    const data: string[] = [];
    const wordstring: string[] = [];
    for (let i = 0; i < view.byteLength; ++i) {
      const b = view[i];
      wordstring.push(String.fromCharCode(b));
      while (wordstring.length >= 3) {
        const triplet = wordstring.splice(0, 3);
        data.push(btoa(triplet.join('')));
      }
    }
    if (wordstring.length) {
      data.push(btoa(wordstring.join('')));
    }
    return data.join('');
  }

  private decodeBase64(string: string): ArrayBuffer {
    let length = (string.length * 3) / 4;
    if (string[string.length - 2] === '=') {
      length -= 2;
    } else if (string[string.length - 1] === '=') {
      length -= 1;
    }
    const buffer = new ArrayBuffer(length);
    const view = new Uint8Array(buffer);
    const bits = string.match(/..../g);
    let i = 0;
    for (i = 0; i + 2 < length; i += 3) {
      const s = atob(bits!.shift()!);
      view[i] = s.charCodeAt(0);
      view[i + 1] = s.charCodeAt(1);
      view[i + 2] = s.charCodeAt(2);
    }
    if (i < length) {
      const s = atob(bits!.shift()!);
      view[i++] = s.charCodeAt(0);
      if (s.length > 1) {
        view[i++] = s.charCodeAt(1);
      }
    }
    return buffer;
  }
}

// ---------------------------------------------------------------------------
// Browser IndexedDB backend — for large savestates
// ---------------------------------------------------------------------------

export class IDBSaveBackend implements SaveBackend {
  private dbName: string;
  private db: IDBDatabase | null = null;

  constructor(dbName = 'gbajs-saves') {
    this.dbName = dbName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('savedata')) {
          db.createObjectStore('savedata');
        }
        if (!db.objectStoreNames.contains('savestate')) {
          db.createObjectStore('savestate');
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async idbOp<T>(
    storeName: string,
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = op(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async loadSavedata(key: string): Promise<SavedataBuffer | null> {
    return this.idbOp('savedata', 'readonly', (s) => s.get(key));
  }

  async storeSavedata(key: string, data: SavedataBuffer): Promise<void> {
    await this.idbOp('savedata', 'readwrite', (s) => s.put(data, key));
  }

  async loadSavestate(key: string): Promise<SavestateBlob | null> {
    return this.idbOp('savestate', 'readonly', (s) => s.get(key));
  }

  async storeSavestate(key: string, data: SavestateBlob): Promise<void> {
    await this.idbOp('savestate', 'readwrite', (s) => s.put(data, key));
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const db = await this.getDB();
    const keys: string[] = [];
    const gather = (storeName: string) =>
      new Promise<void>((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAllKeys();
        request.onsuccess = () => {
          for (const k of request.result as IDBValidKey[]) {
            const key = String(k);
            if (!prefix || key.startsWith(prefix)) {
              keys.push(key);
            }
          }
          resolve();
        };
        request.onerror = () => resolve();
      });
    await Promise.all([gather('savedata'), gather('savestate')]);
    return keys;
  }

  async deleteKey(key: string): Promise<void> {
    const db = await this.getDB();
    await Promise.all([
      this.idbOp('savedata', 'readwrite', (s) => s.delete(key)),
      this.idbOp('savestate', 'readwrite', (s) => s.delete(key)),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Browser File System Access API backend — local folder persistence
// ---------------------------------------------------------------------------

/**
 * FileSystemDirectoryHandle 持久化后端。
 *
 * 使用浏览器最新的 File System Access API，允许用户选择一个本地文件夹，
 * 存档和状态快照将直接以文件形式写入该文件夹。
 *
 * 流程：
 * 1. 用户点击"选择文件夹" → 调用 showDirectoryPicker()
 * 2. 拿到 FileSystemDirectoryHandle → 存入 IndexedDB
 * 3. 后续每次打开页面，自动从 IndexedDB 恢复 handle
 * 4. 读写操作直接操作本地文件系统
 *
 * 兼容性：Chrome 86+, Edge 86+, Opera 72+
 * 不支持此 API 的浏览器请使用 IDBSaveBackend 或 LocalStorageSaveBackend。
 */
export class FileSystemSaveBackend implements SaveBackend {
  private static readonly IDB_DB_NAME = 'gbajs-fs-handle';
  private static readonly IDB_KEY = 'directory-handle';

  private dirHandle: FileSystemDirectoryHandle | null = null;

  /** 页面加载时自动尝试恢复之前的目录权限。返回 true 表示成功恢复。 */
  static async tryRestore(): Promise<FileSystemDirectoryHandle | null> {
    if (!('showDirectoryPicker' in window)) return null;

    try {
      return new Promise((resolve) => {
        const request = indexedDB.open(FileSystemSaveBackend.IDB_DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('handles');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('handles', 'readonly');
          const store = tx.objectStore('handles');
          const getReq = store.get(FileSystemSaveBackend.IDB_KEY);
          getReq.onsuccess = async () => {
            const handle = getReq.result as FileSystemDirectoryHandle | undefined;
            if (!handle) {
              db.close();
              resolve(null);
              return;
            }
            // 验证权限是否仍然有效
            const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
            const permission = await handle.queryPermission(opts);
            if (permission === 'granted') {
              db.close();
              resolve(handle);
            } else {
              // 尝试重新请求
              const newPermission = await handle.requestPermission(opts);
              db.close();
              resolve(newPermission === 'granted' ? handle : null);
            }
          };
          getReq.onerror = () => { db.close(); resolve(null); };
        };
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /** 打开目录选择器，请求用户选择一个本地文件夹用于持久化存档。 */
  static async requestDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!('showDirectoryPicker' in window)) return null;

    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });

      // 保存 handle 到 IndexedDB 以便后续恢复
      await FileSystemSaveBackend.persistHandle(handle);
      return handle;
    } catch (err) {
      // 用户取消选择
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
  }

  private static async persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FileSystemSaveBackend.IDB_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('handles');
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, FileSystemSaveBackend.IDB_KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** 检查 API 是否可用 */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  constructor(handle: FileSystemDirectoryHandle) {
    this.dirHandle = handle;
  }

  /** 遍历路径获取文件句柄，支持子目录 (e.g. "abc/game.gba") */
  private async getFileHandle(path: string, create = true): Promise<FileSystemFileHandle | null> {
    if (!this.dirHandle) return null;
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let dir: FileSystemDirectoryHandle = this.dirHandle;

    for (const part of parts) {
      if (!part) continue;
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }

    try {
      return await dir.getFileHandle(fileName, { create });
    } catch {
      return null;
    }
  }

  /** 写入任意文件（自动创建父目录） */
  async writeFile(path: string, data: ArrayBuffer): Promise<void> {
    const handle = await this.getFileHandle(path);
    if (!handle) throw new Error('Cannot create file: ' + path);
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  /** 读取任意文件 */
  async readFile(path: string): Promise<ArrayBuffer | null> {
    const handle = await this.getFileHandle(path, false);
    if (!handle) return null;
    try {
      const file = await handle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  private keyToFilename(key: string): string {
    return key.replace(/[^a-zA-Z0-9._\/-]/g, '_');
  }

  async loadSavedata(key: string): Promise<SavedataBuffer | null> {
    const handle = await this.getFileHandle(this.keyToFilename(key), false);
    if (!handle) return null;
    try {
      const file = await handle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async storeSavedata(key: string, data: SavedataBuffer): Promise<void> {
    const handle = await this.getFileHandle(this.keyToFilename(key));
    if (!handle) return;
    try {
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch {
      // 权限可能过期，静默失败
    }
  }

  async loadSavestate(key: string): Promise<SavestateBlob | null> {
    const handle = await this.getFileHandle(this.keyToFilename(key), false);
    if (!handle) return null;
    try {
      const file = await handle.getFile();
      return new Blob([await file.arrayBuffer()]);
    } catch {
      return null;
    }
  }

  async storeSavestate(key: string, data: SavestateBlob): Promise<void> {
    const handle = await this.getFileHandle(this.keyToFilename(key));
    if (!handle) return;
    try {
      const writable = await handle.createWritable();
      const buf = await data.arrayBuffer();
      await writable.write(buf);
      await writable.close();
    } catch {
      // 同上
    }
  }

  async listKeys(prefix?: string): Promise<string[]> {
    if (!this.dirHandle) return [];
    const keys: string[] = [];
    try {
      for await (const [name] of this.dirHandle.entries()) {
        const key = name as string;
        if (!prefix || key.startsWith(prefix)) {
          keys.push(key);
        }
      }
    } catch {
      // 权限问题
    }
    return keys;
  }

  async deleteKey(key: string): Promise<void> {
    try {
      await this.dirHandle?.removeEntry(this.keyToFilename(key));
    } catch {
      // 文件不存在或权限问题
    }
  }

  /** 当前关联的目录名（用于 UI 显示） */
  get directoryName(): string {
    return this.dirHandle?.name ?? 'unknown';
  }
}

// ============================================================================
// GameLibrary — manages index.json and ROM subfolders
// ============================================================================

export interface GameEntry {
  hash: string;
  title: string;
  code: string;
  added: number;
  lastPlayed: number;
  size: number;
}

export interface GameIndex {
  version: 1;
  games: Record<string, GameEntry>;
  lastPlayed: string | null;
}

export class GameLibrary {
  private fs: FileSystemSaveBackend;
  private index: GameIndex | null = null;
  static readonly INDEX_PATH = 'index.json';

  constructor(fs: FileSystemSaveBackend) {
    this.fs = fs;
  }

  async load(): Promise<GameIndex> {
    if (this.index) return this.index;
    try {
      const raw = await this.fs.readFile(GameLibrary.INDEX_PATH);
      if (raw) {
        this.index = JSON.parse(new TextDecoder().decode(raw)) as GameIndex;
        return this.index!;
      }
    } catch { /* 文件不存在或损坏 */ }
    
    this.index = { version: 1, games: {}, lastPlayed: null };
    return this.index;
  }

  async save(): Promise<void> {
    if (!this.index) return;
    const json = JSON.stringify(this.index, null, 2);
    await this.fs.writeFile(GameLibrary.INDEX_PATH, new TextEncoder().encode(json).buffer);
  }

  getEntry(hash: string): GameEntry | null {
    return this.index?.games[hash] ?? null;
  }

  async addGame(hash: string, title: string, code: string, size: number): Promise<GameEntry> {
    const idx = await this.load();
    const existing = idx.games[hash];
    const entry: GameEntry = {
      hash,
      title,
      code,
      size,
      added: existing?.added ?? Date.now(),
      lastPlayed: Date.now(),
    };
    idx.games[hash] = entry;
    idx.lastPlayed = hash;
    await this.save();
    return entry;
  }

  async markPlayed(hash: string): Promise<void> {
    const idx = await this.load();
    const entry = idx.games[hash];
    if (entry) {
      entry.lastPlayed = Date.now();
      idx.lastPlayed = hash;
      await this.save();
    }
  }

  /** 列出所有游戏，按最后游玩时间倒序 */
  async listGames(): Promise<GameEntry[]> {
    const idx = await this.load();
    return Object.values(idx.games).sort((a, b) => b.lastPlayed - a.lastPlayed);
  }
}

export class FsSaveBackend implements SaveBackend {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private keyToPath(key: string): string {
    // Sanitize key to a safe filename
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${this.dir}/${safe}`;
  }

  async loadSavedata(key: string): Promise<SavedataBuffer | null> {
    try {
      const file = Bun.file(this.keyToPath(key));
      if (!(await file.exists())) return null;
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async storeSavedata(key: string, data: SavedataBuffer): Promise<void> {
    const path = this.keyToPath(key);
    await Bun.write(path, data);
  }

  async loadSavestate(key: string): Promise<SavestateBlob | null> {
    try {
      const file = Bun.file(this.keyToPath(key));
      if (!(await file.exists())) return null;
      return new Blob([await file.arrayBuffer()]);
    } catch {
      return null;
    }
  }

  async storeSavestate(key: string, data: SavestateBlob): Promise<void> {
    const path = this.keyToPath(key);
    await Bun.write(path, await data.arrayBuffer());
  }

  async listKeys(prefix?: string): Promise<string[]> {
    // Use fs module for directory listing
    const { readdir } = await import('node:fs/promises');
    try {
      const files = await readdir(this.dir);
      return prefix ? files.filter((f) => f.startsWith(prefix)) : files;
    } catch {
      return [];
    }
  }

  async deleteKey(key: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    try {
      await unlink(this.keyToPath(key));
    } catch {
      // File doesn't exist — ignore
    }
  }
}
