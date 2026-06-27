export function loadRom(url: string, callback: (response: ArrayBuffer) => void): void {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.responseType = 'arraybuffer';

  xhr.onload = function () {
    callback(xhr.response);
  };
  xhr.send();
}
