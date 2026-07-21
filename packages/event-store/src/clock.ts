/** Reloj inyectable — permite tiempo determinístico en pruebas (tiempo del conocimiento). */
export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** Reloj fijo/controlable para pruebas de reconstrucción temporal. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): string {
    return this.current.toISOString();
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(iso: string): void {
    this.current = new Date(iso);
  }
}
