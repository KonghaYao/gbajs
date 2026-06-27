import { describe, expect, test } from 'bun:test';
import { hex, Serializer, SerializerPointer } from './util.js';

describe('hex', () => {
  test('formats zero', () => {
    expect(hex(0)).toBe('0x00000000');
  });

  test('formats with custom leading', () => {
    expect(hex(255, 4)).toBe('0x00FF');
  });

  test('formats without prefix', () => {
    expect(hex(255, 4, false)).toBe('00FF');
  });

  test('formats negative numbers as unsigned', () => {
    expect(hex(-1)).toBe('0xFFFFFFFF');
  });

  test('formats 0xDEADBEEF', () => {
    expect(hex(0xDEADBEEF)).toBe('0xDEADBEEF');
  });
});

describe('SerializerPointer', () => {
  test('creates with initial state', () => {
    const p = new SerializerPointer();
    expect(p.index).toBe(0);
    expect(p.top).toBe(0);
  });
});

describe('Serializer', () => {
  test('TAG constants exist', () => {
    expect(Serializer.TAG_INT).toBeDefined();
    expect(Serializer.TAG_STRING).toBeDefined();
    expect(Serializer.TAG_STRUCT).toBeDefined();
    expect(Serializer.TAG_BLOB).toBeDefined();
    expect(Serializer.TAG_BOOLEAN).toBeDefined();
  });

  test('pack8 puts a byte', () => {
    const result = Serializer.pack8(0x42);
    const view = new DataView(result);
    expect(view.getUint8(0)).toBe(0x42);
    expect(result.byteLength).toBe(1);
  });

  test('prefix wraps string with size header', () => {
    const result = Serializer.prefix('test');
    expect(result.type).toBe(Serializer.TYPE);
    // The blob should contain a 4-byte size + 4-byte string content
    expect(result.size).toBe(8);
  });
});
