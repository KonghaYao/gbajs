export class GameBoyAdvanceKeypad {
	KEYCODE_LEFT: number = 37;
	KEYCODE_UP: number = 38;
	KEYCODE_RIGHT: number = 39;
	KEYCODE_DOWN: number = 40;
	KEYCODE_START: number = 13;
	KEYCODE_SELECT: number = 220;
	KEYCODE_A: number = 90;
	KEYCODE_B: number = 88;
	KEYCODE_L: number = 65;
	KEYCODE_R: number = 83;

	GAMEPAD_LEFT: number = 14;
	GAMEPAD_UP: number = 12;
	GAMEPAD_RIGHT: number = 15;
	GAMEPAD_DOWN: number = 13;
	GAMEPAD_START: number = 9;
	GAMEPAD_SELECT: number = 8;
	GAMEPAD_A: number = 1;
	GAMEPAD_B: number = 0;
	GAMEPAD_L: number = 4;
	GAMEPAD_R: number = 5;
	GAMEPAD_THRESHOLD: number = 0.2;

	A: number = 0x0001;
	B: number = 0x0002;
	SELECT: number = 0x0004;
	START: number = 0x0008;
	RIGHT: number = 0x0010;
	LEFT: number = 0x0020;
	UP: number = 0x0040;
	DOWN: number = 0x0080;
	R: number = 0x0100;
	L: number = 0x0200;

	currentDown: number = 0x03FF;
	eatInput: boolean = false;
	core: any; // Set externally by GameBoyAdvance

	gamepads: Gamepad[] = [];

	keyboardHandler = (e: KeyboardEvent): void => {
		let toggle = 0;
		switch (e.keyCode) {
		case this.KEYCODE_START:
			toggle = this.START;
			break;
		case this.KEYCODE_SELECT:
			toggle = this.SELECT;
			break;
		case this.KEYCODE_A:
			toggle = this.A;
			break;
		case this.KEYCODE_B:
			toggle = this.B;
			break;
		case this.KEYCODE_L:
			toggle = this.L;
			break;
		case this.KEYCODE_R:
			toggle = this.R;
			break;
		case this.KEYCODE_UP:
			toggle = this.UP;
			break;
		case this.KEYCODE_RIGHT:
			toggle = this.RIGHT;
			break;
		case this.KEYCODE_DOWN:
			toggle = this.DOWN;
			break;
		case this.KEYCODE_LEFT:
			toggle = this.LEFT;
			break;
		default:
			return;
		}

		if (e.type === 'keydown') {
			this.currentDown &= ~toggle;
		} else {
			this.currentDown |= toggle;
		}

		if (this.eatInput) {
			e.preventDefault();
		}
	};

	gamepadHandler = (gamepad: Gamepad): void => {
		let value = 0;
		if (gamepad.buttons[this.GAMEPAD_LEFT] && gamepad.buttons[this.GAMEPAD_LEFT].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.LEFT;
		}
		if (gamepad.buttons[this.GAMEPAD_UP] && gamepad.buttons[this.GAMEPAD_UP].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.UP;
		}
		if (gamepad.buttons[this.GAMEPAD_RIGHT] && gamepad.buttons[this.GAMEPAD_RIGHT].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.RIGHT;
		}
		if (gamepad.buttons[this.GAMEPAD_DOWN] && gamepad.buttons[this.GAMEPAD_DOWN].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.DOWN;
		}
		if (gamepad.buttons[this.GAMEPAD_START] && gamepad.buttons[this.GAMEPAD_START].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.START;
		}
		if (gamepad.buttons[this.GAMEPAD_SELECT] && gamepad.buttons[this.GAMEPAD_SELECT].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.SELECT;
		}
		if (gamepad.buttons[this.GAMEPAD_A] && gamepad.buttons[this.GAMEPAD_A].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.A;
		}
		if (gamepad.buttons[this.GAMEPAD_B] && gamepad.buttons[this.GAMEPAD_B].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.B;
		}
		if (gamepad.buttons[this.GAMEPAD_L] && gamepad.buttons[this.GAMEPAD_L].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.L;
		}
		if (gamepad.buttons[this.GAMEPAD_R] && gamepad.buttons[this.GAMEPAD_R].value > this.GAMEPAD_THRESHOLD) {
			value |= 1 << this.R;
		}

		this.currentDown = ~value & 0x3FF;
	};

	gamepadConnectHandler = (gamepad: Gamepad): void => {
		this.gamepads.push(gamepad);
	};

	gamepadDisconnectHandler = (gamepad: Gamepad): void => {
		this.gamepads = this.gamepads.filter(function(other: Gamepad) { return other !== gamepad; });
	};

	pollGamepads = (): void => {
		let navigatorList: (Gamepad | null)[] = [];
		const nav = navigator as unknown as { getGamepads?: () => (Gamepad | null)[]; webkitGetGamepads?: () => (Gamepad | null)[] };
		if (nav.getGamepads) {
			navigatorList = nav.getGamepads();
		} else if (nav.webkitGetGamepads) {
			navigatorList = nav.webkitGetGamepads();
		}

		// Let's all give a shout out to Chrome for making us get the gamepads EVERY FRAME
		if (navigatorList.length) {
			this.gamepads = [];
		}
		for (let i = 0; i < navigatorList.length; ++i) {
			if (navigatorList[i]) {
				this.gamepads.push(navigatorList[i]!);
			}
		}
		if (this.gamepads.length > 0) {
			this.gamepadHandler(this.gamepads[0]);
		}
	};

	registerHandlers = (): void => {
		window.addEventListener('keydown', this.keyboardHandler, true);
		window.addEventListener('keyup', this.keyboardHandler, true);

		window.addEventListener('gamepadconnected', this.gamepadConnectHandler as unknown as EventListener, true);
		window.addEventListener('mozgamepadconnected', this.gamepadConnectHandler as unknown as EventListener, true);
		window.addEventListener('webkitgamepadconnected', this.gamepadConnectHandler as unknown as EventListener, true);

		window.addEventListener('gamepaddisconnected', this.gamepadDisconnectHandler as unknown as EventListener, true);
		window.addEventListener('mozgamepaddisconnected', this.gamepadDisconnectHandler as unknown as EventListener, true);
		window.addEventListener('webkitgamepaddisconnected', this.gamepadDisconnectHandler as unknown as EventListener, true);
	};
}
