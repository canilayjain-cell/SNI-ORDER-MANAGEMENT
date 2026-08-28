type Listener = (msg: string) => void;
let listener: Listener | null = null;

export function toast(msg: string) {
  if (listener) listener(msg);
}

export function _setToastListener(fn: Listener | null) {
  listener = fn;
}
