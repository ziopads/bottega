// The parts of a work that cards hang on (REQUIREMENTS W-5), copied into a
// project when its workflow starts and editable there.
//
// Music follows the zones of the Sirsinate Live template
// (docs/ableton-session-template.md): tracks grouped by what a part does in
// the music. STRUCTURE and BUS are not track zones; they hold the work that
// belongs to no single part (a drop, a transition, the master chain).
//
// One default per kind for now; a template per account comes later, so that
// other artists can bring their own (decided 11 October 2026).

export type TemplateElement = { name: string; children?: string[] };

export const ELEMENT_TEMPLATES: Record<string, TemplateElement[]> = {
  music: [
    { name: 'TACTUS', children: ['Kick', 'Snare and clap', 'Hats', 'Percussion'] },
    { name: 'BASS', children: ['Sub', 'Bass'] },
    { name: 'BACKGROUND', children: ['Pads', 'Chords'] },
    { name: 'LEADS', children: ['Lead', 'Arpeggio'] },
    { name: 'TEXTURE', children: ['Atmosphere', 'Noise', 'Granular'] },
    { name: 'VOX', children: ['Vocal', 'Voice samples'] },
    { name: 'STRUCTURE', children: ['Intro', 'Build', 'Drop', 'Breakdown', 'Transitions'] },
    { name: 'BUS', children: ['Parallel returns', 'Reverb and delay', 'Master chain'] },
  ],
  collection: [
    { name: 'Tracks' },
    { name: 'Running order' },
    { name: 'Mastering' },
    { name: 'Artwork' },
    { name: 'Release' },
  ],
};
