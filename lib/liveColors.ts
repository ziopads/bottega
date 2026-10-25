// Ableton Live's colour palette (REQUIREMENTS W-25, decided 25 October 2026):
// element colours are Live's own, so a zone looks the same in Bottega and in
// the Live template. Live offers 70 colours in a grid of 14 columns and 5
// rows; a set stores a track's colour as its place in the grid, counted
// along each row from the top left (0) to the bottom right (69).
//
// The values were colour-picked from Live's palette by others
// (github.com/danhemerlein/ableton-colors), so they are close to Live's, not
// exact; the grid order is Live's. A plain module for server and
// client; db/031 holds the same hex list.

export type LiveColor = { index: number; hex: string; row: number; column: number };

const RAW: [number, string][] = [
  [0, '#fd95a7'],
  [1, '#fda43a'],
  [2, '#cb9834'],
  [3, '#f7f384'],
  [4, '#c0f932'],
  [5, '#32fd42'],
  [6, '#39fdaa'],
  [7, '#65fee8'],
  [8, '#8dc6fd'],
  [9, '#5682e1'],
  [10, '#93a9fc'],
  [11, '#d670e2'],
  [12, '#e3569f'],
  [13, '#ffffff'],
  [14, '#fc393d'],
  [15, '#f46c20'],
  [16, '#98714e'],
  [17, '#feee4a'],
  [18, '#8bfd70'],
  [19, '#44c121'],
  [20, '#1ebeaf'],
  [21, '#31e9fd'],
  [22, '#22a5eb'],
  [23, '#127ebe'],
  [24, '#8870e1'],
  [25, '#b579c4'],
  [26, '#fd42d2'],
  [27, '#d0d0d0'],
  [28, '#e0685d'],
  [29, '#fda378'],
  [30, '#d2ac75'],
  [31, '#edfeb2'],
  [32, '#d2e39c'],
  [33, '#bacf79'],
  [34, '#9cc38f'],
  [35, '#d5fde2'],
  [36, '#cef1f8'],
  [37, '#b9c2e2'],
  [38, '#cdbce3'],
  [39, '#ae9ae3'],
  [40, '#e5dce1'],
  [41, '#a9a9a9'],
  [42, '#c5928c'],
  [43, '#b68259'],
  [44, '#98836b'],
  [45, '#bfb96e'],
  [46, '#a6bc25'],
  [47, '#7eaf52'],
  [48, '#8ac2ba'],
  [49, '#9cb3c3'],
  [50, '#86a5c1'],
  [51, '#8494ca'],
  [52, '#a596b4'],
  [53, '#bea0bd'],
  [54, '#bb7296'],
  [55, '#7b7b7b'],
  [56, '#ad3436'],
  [57, '#a75135'],
  [58, '#714f42'],
  [59, '#dac229'],
  [60, '#85952b'],
  [61, '#559e38'],
  [62, '#1b9b8e'],
  [63, '#266383'],
  [64, '#1b3393'],
  [65, '#3154a0'],
  [66, '#624eab'],
  [67, '#a24eab'],
  [68, '#ca326e'],
  [69, '#3c3c3c'],
];

export const LIVE_COLORS: LiveColor[] = RAW.map(([index, hex]) => ({ index, hex, row: Math.floor(index / 14) + 1, column: (index % 14) + 1 }));

/** "Live colour, row 2, column 10": how the picker names a swatch. */
export function describeLive(c: LiveColor): string {
  return `Live colour, row ${c.row}, column ${c.column}`;
}

/** Eight Live colours that stay apart for colour-blind readers when each sits
 *  next to the one before it in this order (checked with the dataviz
 *  validator on light and dark grounds). Live's palette has no eight that
 *  stay apart all at once; names always go with colours. */
export const SUGGESTED = [23, 14, 54, 60, 9, 28, 25, 57];

const BY_HEX = new Map(LIVE_COLORS.map((c) => [c.hex, c]));

export function liveColorOfHex(hex: string | null | undefined): LiveColor | null {
  return hex ? (BY_HEX.get(hex.toLowerCase()) ?? null) : null;
}

export function liveColorOfIndex(index: number | null | undefined): LiveColor | null {
  return index === null || index === undefined ? null : (LIVE_COLORS[index] ?? null);
}
