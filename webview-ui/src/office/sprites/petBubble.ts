// Adapted from Pixel Agents v1.5.0 (MIT); see THIRD_PARTY_NOTICES.md.
import {
  PET_BUBBLE_BORDER_COLOR,
  PET_BUBBLE_FILL_COLOR,
  PET_BUBBLE_HEART_COLOR,
} from '../../constants.js';
import type { SpriteData } from '../types.js';

const PIXELS = [
  '_BBBBBBBBB_',
  'BFFFFFFFFFB',
  'BFFHHFFHHFB',
  'BFHHHHHHHFB',
  'BFHHHHHHHFB',
  'BFHHHHHHHFB',
  'BFFHHHHHFFB',
  'BFFFHHHFFFB',
  'BFFFFHFFFFB',
  '_BBBBBBBBB_',
  '____BB_____',
  '_____B_____',
  '___________',
];

const COLORS: Record<string, string> = {
  B: PET_BUBBLE_BORDER_COLOR,
  F: PET_BUBBLE_FILL_COLOR,
  H: PET_BUBBLE_HEART_COLOR,
};

export const PET_HEART_BUBBLE: SpriteData = PIXELS.map((row) =>
  [...row].map((pixel) => COLORS[pixel] ?? ''),
);
