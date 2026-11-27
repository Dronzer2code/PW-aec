/** Type declarations for the landing page ES modules in public/js (plain JavaScript, no build step). */

declare module '*/public/js/landing.js' {
  export interface TabsController {
    select(index: number, options?: { focus?: boolean }): void;
    show(key: string): void;
    play(): void;
    pause(): void;
    readonly index: number;
    readonly key: string;
    readonly playing: boolean;
    destroy(): void;
  }
  export interface HeroController {
    update(): void;
    measure(): void;
    readonly condensed: boolean;
    destroy(): void;
  }
  export const DEFAULT_INTERVAL: number;
  export function heroHeight(scrollY: number, full: number, min: number): number;
  export function heroProgress(scrollY: number, full: number, min: number): number;
  export function syncNav(nav: Element, key: string | undefined): void;
  export function initTabs(
    root: HTMLElement,
    options?: { interval?: number; reducedMotion?: boolean; onChange?: (key: string, index: number) => void },
  ): TabsController | null;
  export function initHero(
    slot: HTMLElement,
    options?: { win?: Window; reducedMotion?: boolean; onCondense?: (condensed: boolean) => void },
  ): HeroController | null;
  export function initReveal(
    elements: Element[],
    options?: { win?: Window; reducedMotion?: boolean },
  ): IntersectionObserver | null;
  export function initLanding(
    doc?: Document,
    win?: Window,
    options?: { mount?: (canvas: HTMLCanvasElement, options: { scene?: string; reducedMotion?: boolean }) => () => void },
  ): {
    tabs: TabsController | null;
    hero: HeroController | null;
    reducedMotion: boolean;
    destroy(): void;
  };
}

declare module '*/public/js/clouds.js' {
  export function parseColor(value: string): number[];
  export function mountClouds(canvas: HTMLCanvasElement, options?: Record<string, unknown>): () => void;
}
