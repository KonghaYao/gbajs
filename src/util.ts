export function hex(number: number, leading?: number, usePrefix?: boolean): string {
	if (typeof usePrefix === 'undefined') {
		usePrefix = true;
	}
	if (typeof leading === 'undefined') {
		leading = 8;
	}
	const string = (number >>> 0).toString(16).toUpperCase();
	leading -= string.length;
	if (leading < 0)
		return string;
	return (usePrefix ? '0x' : '') + new Array(leading + 1).join('0') + string;
}

type SerializableValue = number | string | boolean | Blob | { [key: string]: SerializableValue };

interface SerializableObject {
	[key: string]: SerializableValue;
}

interface DeserializeCallback {
	(result: SerializableObject): void;
}

interface SerializePNGCallback {
	(dataUrl: string): void;
}

export class SerializerPointer {
	index: number = 0;
	top: number = 0;
	stack: number[] = [];

	advance(amount: number): number {
		const index = this.index;
		this.index += amount;
		return index;
	}

	mark(): number {
		return this.index - this.top;
	}

	push(): void {
		this.stack.push(this.top);
		this.top = this.index;
	}

	pop(): void {
		this.top = this.stack.pop()!;
	}

	readString(view: DataView): string {
		const length = view.getUint32(this.advance(4), true);
		const bytes: string[] = [];
		for (let i = 0; i < length; ++i) {
			bytes.push(String.fromCharCode(view.getUint8(this.advance(1))));
		}
		return bytes.join('');
	}
}

export class Serializer {
	static TAG_INT: number = 1;
	static TAG_STRING: number = 2;
	static TAG_STRUCT: number = 3;
	static TAG_BLOB: number = 4;
	static TAG_BOOLEAN: number = 5;
	static TYPE: string = 'application/octet-stream';

	static pack(value: number): ArrayBuffer {
		const object = new DataView(new ArrayBuffer(4));
		object.setUint32(0, value, true);
		return object.buffer;
	}

	static pack8(value: number): ArrayBuffer {
		const object = new DataView(new ArrayBuffer(1));
		object.setUint8(0, value);
		return object.buffer;
	}

	static prefix(value: string | ArrayBuffer): Blob {
		const size = typeof value === 'string' ? value.length : value.byteLength;
		return new Blob([Serializer.pack(size), value], { type: Serializer.TYPE });
	}

	private static isSerializedBlob(val: unknown): val is Blob {
		return val instanceof Blob && val.type === Serializer.TYPE;
	}

	static serialize(stream: SerializableObject): Blob {
		const parts: BlobPart[] = [];
		let size = 4;
		for (const key of Object.keys(stream)) {
			const val = stream[key];
			let tag: number;
			const head = Serializer.prefix(key);
			let body: Blob | ArrayBuffer;
			switch (typeof val) {
			case 'number':
				tag = Serializer.TAG_INT;
				body = Serializer.pack(val);
				break;
			case 'string':
				tag = Serializer.TAG_STRING;
				body = Serializer.prefix(val);
				break;
			case 'object':
				if (Serializer.isSerializedBlob(val)) {
					tag = Serializer.TAG_BLOB;
					body = val;
				} else {
					tag = Serializer.TAG_STRUCT;
					body = Serializer.serialize(val as SerializableObject);
				}
				break;
			case 'boolean':
				tag = Serializer.TAG_BOOLEAN;
				body = Serializer.pack8(val ? 1 : 0);
				break;
			default:
				console.log(val);
				continue;
			}
			size += 1 + head.size + ('size' in body ? (body as Blob).size : (body as ArrayBuffer).byteLength);
			parts.push(Serializer.pack8(tag));
			parts.push(head);
			parts.push(body);
		}
		parts.unshift(Serializer.pack(size));
		return new Blob(parts);
	}

	static deserialize(blob: Blob, callback: DeserializeCallback): void {
		const reader = new FileReader();
		reader.onload = function(data: ProgressEvent<FileReader>) {
			callback(Serializer.deserializeStream(
				new DataView((data.target as FileReader).result as ArrayBuffer),
				new SerializerPointer()
			));
		};
		reader.readAsArrayBuffer(blob);
	}

	static deserializeStream(view: DataView, pointer: SerializerPointer): SerializableObject {
		pointer.push();
		const object: SerializableObject = {};
		const remaining = view.getUint32(pointer.advance(4), true);
		while (pointer.mark() < remaining) {
			const tag = view.getUint8(pointer.advance(1));
			const head = pointer.readString(view);
			let body: SerializableValue;
			switch (tag) {
			case Serializer.TAG_INT:
				body = view.getUint32(pointer.advance(4), true);
				break;
			case Serializer.TAG_STRING:
				body = pointer.readString(view);
				break;
			case Serializer.TAG_STRUCT:
				body = Serializer.deserializeStream(view, pointer);
				break;
			case Serializer.TAG_BLOB:
				{
					const blobSize = view.getUint32(pointer.advance(4), true);
					const slice = view.buffer.slice(pointer.advance(blobSize), pointer.advance(0));
					body = new Blob([slice as BlobPart], { type: Serializer.TYPE });
				}
				break;
			case Serializer.TAG_BOOLEAN:
				body = !!view.getUint8(pointer.advance(1));
				break;
			default:
				continue;
			}
			object[head] = body;
		}
		if (pointer.mark() > remaining) {
			throw 'Size of serialized data exceeded';
		}
		pointer.pop();
		return object;
	}

	static serializePNG(blob: Blob, base: HTMLCanvasElement, callback: SerializePNGCallback): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d')!;
		const baseContext = base.getContext('2d')!;
		const pixels = baseContext.getImageData(0, 0, base.width, base.height);
		let transparent = 0;
		for (let y = 0; y < base.height; ++y) {
			for (let x = 0; x < base.width; ++x) {
				if (!pixels.data[(x + y * base.width) * 4 + 3]) {
					++transparent;
				}
			}
		}
		const bytesInCanvas = transparent * 3 + (base.width * base.height - transparent);
		let multiplier = 1;
		for (multiplier = 1; (bytesInCanvas * multiplier * multiplier) < blob.size; ++multiplier);
		const edges = bytesInCanvas * multiplier * multiplier - blob.size;
		const padding = Math.ceil(edges / (base.width * multiplier));
		canvas.setAttribute('width', String(base.width * multiplier));
		canvas.setAttribute('height', String(base.height * multiplier + padding));

		const reader = new FileReader();
		reader.onload = function(data: ProgressEvent<FileReader>) {
			const view = new Uint8Array((data.target as FileReader).result as ArrayBuffer);
			let pointer = 0;
			let pixelPointer = 0;
			const newPixels = context.createImageData(canvas.width, canvas.height + padding);
			for (let y = 0; y < canvas.height; ++y) {
				for (let x = 0; x < canvas.width; ++x) {
					const oldY = (y / multiplier) | 0;
					const oldX = (x / multiplier) | 0;
					if (oldY > base.height || !pixels.data[(oldX + oldY * base.width) * 4 + 3]) {
						newPixels.data[pixelPointer++] = view[pointer++];
						newPixels.data[pixelPointer++] = view[pointer++];
						newPixels.data[pixelPointer++] = view[pointer++];
						newPixels.data[pixelPointer++] = 0;
					} else {
						const byte = view[pointer++];
						newPixels.data[pixelPointer++] = pixels.data[(oldX + oldY * base.width) * 4 + 0] | (byte & 7);
						newPixels.data[pixelPointer++] = pixels.data[(oldX + oldY * base.width) * 4 + 1] | ((byte >> 3) & 7);
						newPixels.data[pixelPointer++] = pixels.data[(oldX + oldY * base.width) * 4 + 2] | ((byte >> 6) & 7);
						newPixels.data[pixelPointer++] = pixels.data[(oldX + oldY * base.width) * 4 + 3];
					}
				}
			}
			context.putImageData(newPixels, 0, 0);
			callback(canvas.toDataURL('image/png'));
		};
		reader.readAsArrayBuffer(blob);
		return canvas;
	}

	static deserializePNG(blob: Blob, callback: DeserializeCallback): void {
		const reader = new FileReader();
		reader.onload = function(data: ProgressEvent<FileReader>) {
			const image = document.createElement('img');
			image.setAttribute('src', (data.target as FileReader).result as string);
			const canvas = document.createElement('canvas');
			canvas.setAttribute('height', String(image.height));
			canvas.setAttribute('width', String(image.width));
			const context = canvas.getContext('2d')!;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
			const resultData: number[] = [];
			for (let y = 0; y < canvas.height; ++y) {
				for (let x = 0; x < canvas.width; ++x) {
					if (!pixels.data[(x + y * canvas.width) * 4 + 3]) {
						resultData.push(pixels.data[(x + y * canvas.width) * 4 + 0]);
						resultData.push(pixels.data[(x + y * canvas.width) * 4 + 1]);
						resultData.push(pixels.data[(x + y * canvas.width) * 4 + 2]);
					} else {
						let byte = 0;
						byte |= pixels.data[(x + y * canvas.width) * 4 + 0] & 7;
						byte |= (pixels.data[(x + y * canvas.width) * 4 + 1] & 7) << 3;
						byte |= (pixels.data[(x + y * canvas.width) * 4 + 2] & 7) << 6;
						resultData.push(byte);
					}
				}
			}
			const newBlob = new Blob(resultData.map(function(byte: number) {
				const array = new Uint8Array(1);
				array[0] = byte;
				return array;
			}), { type: Serializer.TYPE });
			Serializer.deserialize(newBlob, callback);
		};
		reader.readAsDataURL(blob);
	}
}
