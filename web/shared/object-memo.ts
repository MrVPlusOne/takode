/**
 * One cached value per object, kept on the object itself under a private, non-enumerable symbol.
 *
 * Use it instead of a WeakMap for caches over many long-lived objects, such as every message of
 * every session's history. The server's collector (JavaScriptCore, under Bun) revisits every
 * WeakMap entry in each collection, so hundreds of thousands of entries make every collection
 * several times dearer: on a copy of the live server, the per-message caches roughly tripled the
 * collector's work. A property costs the collector nothing extra and goes away with its object,
 * as a WeakMap entry would. JSON, spreads, `Object.keys` and `structuredClone` don't see it. An
 * object that can't take new properties (a frozen one) is simply not cached.
 */
export class ObjectMemo<T> {
  private readonly slot: symbol;

  constructor(name: string) {
    this.slot = Symbol(name);
  }

  get(target: object): T | undefined {
    return (target as Record<symbol, T | undefined>)[this.slot];
  }

  set(target: object, value: T): void {
    if (Object.hasOwn(target, this.slot)) {
      (target as Record<symbol, T>)[this.slot] = value;
    } else if (Object.isExtensible(target)) {
      Object.defineProperty(target, this.slot, { value, writable: true, configurable: true, enumerable: false });
    }
  }
}
