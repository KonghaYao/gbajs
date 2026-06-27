import { describe, expect, test } from 'bun:test';
import { GameBoyAdvanceKeypad } from './keypad.js';

describe('GameBoyAdvanceKeypad', () => {
  test('initializes with all buttons released (0x03FF)', () => {
    const kp = new GameBoyAdvanceKeypad();
    expect(kp.currentDown).toBe(0x03FF);
  });

  test('KEYCODE constants are correct', () => {
    const kp = new GameBoyAdvanceKeypad();
    expect(kp.KEYCODE_A).toBe(90); // Z
    expect(kp.KEYCODE_B).toBe(88); // X
    expect(kp.KEYCODE_START).toBe(13); // Enter
    expect(kp.KEYCODE_SELECT).toBe(220); // Backslash
    expect(kp.KEYCODE_LEFT).toBe(37);
    expect(kp.KEYCODE_UP).toBe(38);
    expect(kp.KEYCODE_RIGHT).toBe(39);
    expect(kp.KEYCODE_DOWN).toBe(40);
    expect(kp.KEYCODE_L).toBe(65); // A
    expect(kp.KEYCODE_R).toBe(83); // S
  });

  test('A button mask is 0x0001', () => {
    const kp = new GameBoyAdvanceKeypad();
    expect(kp.A).toBe(0x0001);
  });

  test('B button mask is 0x0002', () => {
    const kp = new GameBoyAdvanceKeypad();
    expect(kp.B).toBe(0x0002);
  });

  test('pollGamepads works without gamepads', () => {
    const kp = new GameBoyAdvanceKeypad();
    // Should not throw
    expect(() => kp.pollGamepads()).not.toThrow();
  });

  test('keyboardHandler for keydown updates currentDown', () => {
    const kp = new GameBoyAdvanceKeypad();
    const initial = kp.currentDown;
    kp.keyboardHandler({ type: 'keydown', keyCode: 90, preventDefault: () => {} } as KeyboardEvent);
    // Pressing A should clear bit 0
    expect(kp.currentDown & 0x0001).toBe(0);
  });

  test('keyboardHandler for keyup restores button', () => {
    const kp = new GameBoyAdvanceKeypad();
    // Press then release
    kp.keyboardHandler({ type: 'keydown', keyCode: 90, preventDefault: () => {} } as KeyboardEvent);
    kp.keyboardHandler({ type: 'keyup', keyCode: 90, preventDefault: () => {} } as KeyboardEvent);
    // Should be back to all released
    expect(kp.currentDown & 0x0001).toBe(0x0001);
  });
});
