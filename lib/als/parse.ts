// Reads a Live set's XML into an AlsSet (lib/als/types.ts). Pure: the caller
// ungzips the file (the browser with DecompressionStream, Node with zlib).
// Built against Live 12.2 sets; Live 11 names the main track MasterTrack,
// which is read too.

import { all, find, parseXml, val, type XNode } from './xml';
import {
  PARSER_VERSION,
  ZONE_PREFIX,
  ZONES,
  scaleName,
  type AlsDevice,
  type AlsSample,
  type AlsSet,
  type AlsTrack,
  type SampleWhere,
  type Zone,
} from './types';

// Live's internal device names, as the browser shows them. Anything else is
// spelled out from its tag ("GlueCompressor" → "Glue Compressor").
const NATIVE: Record<string, string> = {
  Eq8: 'EQ Eight',
  Compressor2: 'Compressor',
  AutoFilter2: 'Auto Filter',
  AutoFilter: 'Auto Filter',
  StereoGain: 'Utility',
  DrumGroupDevice: 'Drum Rack',
  InstrumentGroupDevice: 'Instrument Rack',
  AudioEffectGroupDevice: 'Audio Effect Rack',
  MidiEffectGroupDevice: 'MIDI Effect Rack',
  OriginalSimpler: 'Simpler',
  MultiSampler: 'Sampler',
  InstrumentVector: 'Wavetable',
  UltraAnalog: 'Analog',
  LoungeLizard: 'Electric',
  StringStudio: 'Tension',
  Redux2: 'Redux',
  ChannelEq: 'Channel EQ',
  FilterEQ3: 'EQ Three',
  GlueCompressor: 'Glue Compressor',
  DrumBuss: 'Drum Buss',
  Hybrid: 'Hybrid Reverb',
  MidiArpeggiator: 'Arpeggiator',
  MidiChord: 'Chord',
  MidiNoteLength: 'Note Length',
  MidiPitcher: 'Pitch',
  MidiRandom: 'Random',
  MidiScale: 'Scale',
  MidiVelocity: 'Velocity',
  CrossDelay: 'Simple Delay',
  FilterDelay: 'Filter Delay',
  PingPongDelay: 'Ping Pong Delay',
  Vinyl: 'Vinyl Distortion',
  Tuner: 'Tuner',
  MxDeviceAudioEffect: 'Max Audio Effect',
  MxDeviceInstrument: 'Max Instrument',
  MxDeviceMidiEffect: 'Max MIDI Effect',
};

const TRACK_KIND: Record<string, AlsTrack['kind']> = {
  MidiTrack: 'midi',
  AudioTrack: 'audio',
  GroupTrack: 'group',
  ReturnTrack: 'return',
};

function spell(tag: string): string {
  return NATIVE[tag] ?? tag.replace(/\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string | undefined, fallback = true): boolean {
  return v === undefined ? fallback : v === 'true';
}

function deviceOf(node: XNode, inRack: boolean): AlsDevice | null {
  const on = bool(val(node, 'On/Manual'));
  if (node.t === 'PluginDevice' || node.t === 'AuPluginDevice') {
    const desc = find(node, 'PluginDesc')?.c[0];
    if (!desc) return { name: 'Unknown plugin', kind: 'plugin', on, inRack };
    const name = val(desc, 'Name') || val(desc, 'PlugName') || 'Unknown plugin';
    const format = desc.t === 'Vst3PluginInfo' ? 'vst3' : desc.t === 'AuPluginInfo' ? 'au' : 'vst';
    const vendor = val(desc, 'Manufacturer') || undefined;
    return { name, kind: 'plugin', format, vendor, on, inRack };
  }
  // Max for Live devices name themselves by their patch.
  if (node.t.startsWith('MxDevice')) {
    const patch = val(node, 'PatchSlot/Value/MxPatchRef/FileRef/RelativePath') || val(node, 'UserName');
    if (patch) return { name: patch.split('/').pop()!.replace(/\.amxd$/, ''), kind: 'native', on, inRack };
  }
  return { name: spell(node.t), kind: 'native', on, inRack };
}

// Every device in a chain, including those inside racks: any child of a
// <Devices> element. inRack marks the ones below the track's own chain.
function devicesIn(chain: XNode | undefined, inRack: boolean, out: AlsDevice[]): AlsDevice[] {
  const devices = find(chain, 'Devices');
  for (const d of devices?.c ?? []) {
    const dev = deviceOf(d, inRack);
    if (dev) out.push(dev);
    for (const sub of all(d, 'Devices')) {
      for (const inner of sub.c) {
        const x = deviceOf(inner, true);
        if (x) out.push(x);
      }
    }
  }
  return out;
}

function merge(spans: [number, number][]): [number, number][] {
  const sorted = spans.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function zoneOfName(name: string): Zone | null {
  const bare = name.replace(/^\d+-\s*/, '').trim();
  const m = bare.match(/^([A-Za-z]{3})\b/);
  if (m && ZONE_PREFIX[m[1].toUpperCase()]) return ZONE_PREFIX[m[1].toUpperCase()];
  const upper = bare.toUpperCase();
  return (ZONES as readonly string[]).find((z) => upper === z || upper.startsWith(`${z} `)) as Zone | undefined ?? null;
}

const LIBRARY = /\/(Core Library|Factory Packs|User Library|Packs)\//;

function whereOf(ref: XNode): { where: SampleWhere; pack: string | null } {
  const type = val(ref, 'RelativePathType');
  const pack = val(ref, 'LivePackName') || null;
  const path = val(ref, 'Path') ?? '';
  if (type === '3') return { where: 'project', pack: null };
  if (pack || type === '5' || type === '6' || LIBRARY.test(path)) return { where: 'library', pack };
  return { where: 'external', pack: null };
}

export function parseSet(xml: string): AlsSet {
  const doc = parseXml(xml);
  const ableton = find(doc, 'Ableton');
  const set = find(ableton, 'LiveSet');
  if (!ableton || !set) throw new Error('This file is not an Ableton Live set.');

  const samples: AlsSample[] = [];
  const sampleIndex = new Map<string, number>();
  function addSample(ref: XNode, trackId: string): number | null {
    const path = val(ref, 'Path') ?? '';
    const relativePath = val(ref, 'RelativePath') ?? '';
    if (!path && !relativePath) return null;
    const key = `${path}|${relativePath}`;
    let idx = sampleIndex.get(key);
    if (idx === undefined) {
      const { where, pack } = whereOf(ref);
      idx = samples.length;
      samples.push({ path, relativePath, where, pack, bytes: num(val(ref, 'OriginalFileSize')) || null, tracks: [] });
      sampleIndex.set(key, idx);
    }
    if (!samples[idx].tracks.includes(trackId)) samples[idx].tracks.push(trackId);
    return idx;
  }

  function readTrack(node: XNode, kind: AlsTrack['kind']): AlsTrack {
    const id = node.a.Id ?? (kind === 'main' ? 'main' : '');
    const name = val(node, 'Name/EffectiveName') || val(node, 'Name/UserName') || (kind === 'main' ? 'Main' : '');
    const group = val(node, 'TrackGroupId');
    const chain = find(node, 'DeviceChain');
    const seq = find(chain, 'MainSequencer');

    const clipNodes = [
      ...(find(seq, 'ClipTimeable/ArrangerAutomation/Events')?.c ?? []),
      ...(find(seq, 'Sample/ArrangerAutomation/Events')?.c ?? []),
    ];
    const spans: [number, number][] = [];
    for (const c of clipNodes) {
      const s = num(val(c, 'CurrentStart'));
      const e = num(val(c, 'CurrentEnd'));
      if (s !== null && e !== null && !bool(val(c, 'Disabled'), false)) spans.push([s, e]);
    }
    const merged = merge(spans);

    let sessionClips = 0;
    for (const slot of find(seq, 'ClipSlotList')?.c ?? []) {
      if ((find(slot, 'ClipSlot/Value')?.c.length ?? 0) > 0) sessionClips++;
    }

    const refs = new Set<number>();
    for (const sr of all(node, 'SampleRef')) {
      const fr = find(sr, 'FileRef');
      if (!fr) continue;
      const idx = addSample(fr, id);
      if (idx !== null) refs.add(idx);
    }

    return {
      id,
      kind,
      name,
      groupId: group && group !== '-1' ? group : null,
      zone: zoneOfName(name),
      on: bool(val(chain, 'Mixer/Speaker/Manual')),
      frozen: bool(val(node, 'Freeze'), false),
      devices: devicesIn(find(chain, 'DeviceChain'), false, []),
      clips: clipNodes.length,
      sessionClips,
      spans: merged.slice(0, 400),
      coveredBeats: merged.reduce((sum, [s, e]) => sum + (e - s), 0),
      automation: find(node, 'AutomationEnvelopes/Envelopes')?.c.length ?? 0,
      samples: Array.from(refs),
    };
  }

  const tracks: AlsTrack[] = [];
  for (const t of find(set, 'Tracks')?.c ?? []) {
    const kind = TRACK_KIND[t.t];
    if (kind) tracks.push(readTrack(t, kind));
  }
  const main = find(set, 'MainTrack') ?? find(set, 'MasterTrack');
  if (main) tracks.push(readTrack(main, 'main'));

  // A track without a zone of its own takes its group's.
  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const t of tracks) {
    let g = t.groupId ? byId.get(t.groupId) : undefined;
    while (!t.zone && g) {
      t.zone = g.zone;
      g = g.groupId ? byId.get(g.groupId) : undefined;
    }
  }

  const locators = (find(set, 'Locators/Locators')?.c ?? [])
    .map((l) => ({ name: val(l, 'Name') ?? '', beat: num(val(l, 'Time')) ?? 0 }))
    .sort((a, b) => a.beat - b.beat);

  // Live 12 keeps the set's scale beside its tracks, the scale as a number
  // (Root Value="0", Name Value="0" is C Major); Live 11 clips name the root
  // RootNote, which is read too in case a set carries it that way.
  const scale = find(set, 'ScaleInformation');
  const root = scale ? num(val(scale, 'Root') ?? val(scale, 'RootNote')) : null;
  const inKey = val(set, 'InKey');

  return {
    parserVersion: PARSER_VERSION,
    live: ableton.a.Creator ?? '',
    tempo: num(val(main, 'DeviceChain/Mixer/Tempo/Manual')),
    key: scale && root !== null
      ? { root: ((root % 12) + 12) % 12, scale: scaleName(val(scale, 'Name') ?? ''), inKey: inKey === undefined ? null : inKey === 'true' }
      : null,
    lengthBeats: tracks.reduce((m, t) => Math.max(m, t.spans.length ? t.spans[t.spans.length - 1][1] : 0), 0),
    locators,
    tracks,
    samples,
  };
}
