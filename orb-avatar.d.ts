// Type definitions for <orb-avatar> v2 (aphesist/orb2).

export type OrbBuiltInShape =
  | 'circle' | 'squircle' | 'triangle' | 'cloud' | 'soft' | 'tall' | 'wide'
  | 'bean' | 'drop' | 'ghost' | 'clover' | 'flower' | 'diamond' | 'hexagon' | 'star';

/** A built-in silhouette name, a name registered with `defineShape`, a `#id` selector, or any SVG `d` path / `<svg>` string. */
export type OrbBodyShape = OrbBuiltInShape | (string & {});

export type OrbBuiltInEyeShape =
  | 'pill' | 'tall' | 'circle' | 'wide' | 'squint' | 'square'
  | 'grid' | 'matrix' | 'bars' | 'stack' | 'arc' | 'rest'
  | 'chevron' | 'slant' | 'plus' | 'diamond' | 'heart';

/** A single eye shape (`"grid"`) or an asymmetric `"left right"` pair (`"circle wide"`). */
export type OrbEyeShape = OrbBuiltInEyeShape | (string & {});

export type OrbBuiltInReaction =
  | 'idle' | 'listening' | 'thinking' | 'compute' | 'working' | 'speaking'
  | 'happy' | 'done' | 'needs' | 'sleeping' | 'error' | 'wink'
  | 'skeptic' | 'love' | 'sad' | 'dizzy';

export type OrbReaction = OrbBuiltInReaction | (string & {});

export type OrbMode = 'drift' | 'follow' | 'wander' | 'fixed';

export type OrbPokeReaction = 'surprised' | 'giggle' | 'dizzy';

export type OrbBuiltInEmote =
  | 'shapeshift' | 'pixelate' | 'scan' | 'calibrate' | 'doubletake' | 'matrix'
  | 'equalize' | 'curious' | 'orbit' | 'glare' | 'winkswap' | 'slowblink' | 'twirl'
  | 'doze' | 'wake';

export type OrbSpinStyle = 'turntable' | 'tilt' | 'reverse';

export type OrbEmote = OrbBuiltInEmote | (string & {});

export type OrbPoint = [a: number, b: number];

export interface OrbCell {
  pts: OrbPoint[];
  c: OrbPoint;
  fill?: string;
  op?: number;
  noBlink?: boolean;
  key?: string;
}

export interface OrbFace {
  L: OrbCell[];
  R: OrbCell[];
  extras?: OrbCell[];
}

export interface OrbMotion {
  /** Eye gaze in radians, blended with the current mode by `w` (0 to 1). */
  eyaw?: number;
  epitch?: number;
  eroll?: number;
  /** Legacy aliases for `eyaw` and `epitch`. */
  yaw?: number;
  pitch?: number;
  w?: number;
  /** Body silhouette roll tilt in radians. */
  bodyRoll?: number;
  roll?: number;
  /** Fast additive yaw shake. */
  yawAdd?: number;
  /** Vertical offset in body radii (negative is up). */
  dy?: number;
  /** Uniform scale. */
  s?: number;
}

export interface OrbShapeOptions {
  label?: string;
  faceCenter?: [x: number, y: number];
  faceScale?: number;
  bevel?: number;
  slab?: number;
  camber?: number;
  /** `defineShape` only: keep the classic extruded coin instead of inflating the outline into a 3D body. */
  flat?: boolean;
}

export interface OrbReactionDef {
  label?: string;
  blink?: boolean;
  hidden?: boolean;
  face?: (t: number, e: number, eyeShape: OrbEyeShape) => OrbFace;
  motion?: ((t: number, e: number) => OrbMotion) | null;
  extra?: 'dots' | 'zzz' | 'sparkle' | 'heart' | 'orbit' | 'ring';
}

export interface OrbEmoteDef extends OrbReactionDef {
  duration?: number;
  weight?: number;
  kicks?: [time: number, strength: number][];
}

export type OrbSequenceStep =
  | OrbEyeShape
  | [left: OrbEyeShape, right: OrbEyeShape]
  | {
      eyes: OrbEyeShape | [left: OrbEyeShape, right: OrbEyeShape];
      /** `[yawDegrees, pitchDegrees, rollDegrees?]` */
      gaze?: [number, number, number?];
      hold?: number;
    };

export interface OrbSequenceOptions {
  stepDuration?: number;
  morphDuration?: number;
}

export interface OrbReactionChangeDetail { from: OrbReaction; to: OrbReaction; }
export interface OrbShapeChangeDetail { from: OrbBodyShape; to: OrbBodyShape; }
export interface OrbEyeShapeChangeDetail { from: OrbEyeShape; to: OrbEyeShape; }
export interface OrbPokeDetail { count: number; reaction: OrbPokeReaction; }
export interface OrbEmoteDetail { name: OrbEmote; }

export declare class OrbAvatar extends HTMLElement {
  reaction: OrbReaction;
  shape: OrbBodyShape;
  eyeShape: OrbEyeShape;
  mode: OrbMode;

  react(name: OrbReaction): this;
  setShape(shape: OrbBodyShape): this;
  morphEyes(eyeShape: OrbEyeShape): this;
  sequence(steps: OrbSequenceStep[], options?: OrbSequenceOptions): this;

  poke(force?: number, options?: { react?: boolean }): this;
  spin(style?: OrbSpinStyle): this;
  blink(): this;
  emote(name: OrbEmote): this;
  sleep(): this;
  wakeUp(): this;
  readonly asleep: boolean;
  lookAt(x?: number, y?: number): this;
  toSVG(options?: { size?: number }): string;

  static readonly reactions: OrbReaction[];
  static reactionLabel(name: OrbReaction): string;
  static defineReaction(name: string, def: OrbReactionDef): void;

  static readonly bodyShapes: OrbBodyShape[];
  static shapeLabel(name: OrbBodyShape): string;
  static defineShape(name: string, svgOrPath: string | OrbPoint[], options?: OrbShapeOptions): void;

  static readonly eyeShapes: OrbBuiltInEyeShape[];
  static defineEyeShape(name: string, builder: (side: -1 | 1, opts?: Record<string, unknown>) => OrbCell[]): void;

  static readonly emotes: OrbEmote[];
  static defineEmote(name: string, def: OrbEmoteDef): void;

  static quality: 'auto' | 0 | 1 | 2;
  static readonly qualityLevel: 0 | 1 | 2;
  static shapes: Record<string, unknown>;
}

declare global {
  interface Window { OrbAvatar: typeof OrbAvatar; }
  interface HTMLElementTagNameMap { 'orb-avatar': OrbAvatar; }
  interface HTMLElementEventMap {
    reactionchange: CustomEvent<OrbReactionChangeDetail>;
    shapechange: CustomEvent<OrbShapeChangeDetail>;
    eyeshapechange: CustomEvent<OrbEyeShapeChangeDetail>;
    poke: CustomEvent<OrbPokeDetail>;
    emote: CustomEvent<OrbEmoteDetail>;
  }
}
