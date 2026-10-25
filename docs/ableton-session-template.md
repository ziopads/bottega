# Ableton Live Session Template — Sirsinate Sound Labs

Status: designed in conversation, not yet saved as a Live set (`User Library/Templates` is empty as of 2026-10-11). This file records the decisions that were settled. Anything listed under "Not yet specified" was never decided and should be worked out before building the set.

The zones below are also the top level of the element tree that workflow cards hang on in Bottega (REQUIREMENTS W-5, `lib/elementTemplate.ts`). Bottega adds two elements that are not track zones: STRUCTURE (sections and transitions) and BUS (returns and the master chain).

## Organizing principle

Tracks are grouped by compositional role (what a part does in the music) instead of by signal routing or by instrument. The reasoning: grouping by role keeps the arrangement legible while composing, and routing decisions sit underneath that structure.

## Zones

Six zones, in this order:

| Zone | Prefix | Role (plain reading of the name) |
|---|---|---|
| TACTUS | `TAC` | Pulse layer: drums and percussion that carry the beat |
| BASS | `BAS` | Low end |
| BACKGROUND | `BKG` | Supporting harmonic and pad material |
| LEADS | `LDS` | Foreground melodic parts |
| TEXTURE | `TEX` | Noise, atmosphere, degraded and granular material |
| VOX | `VOX` | Vocals and voice material |

The role descriptions are glosses of the zone names; only the names themselves were recorded.

## Decided 11 October 2026

**Track names start with the zone prefix** (`TAC Kick`, `BAS Sub`). When Bottega's analysis reads an `.als` file (REQUIREMENTS A-1), it can match each track to its element without asking.

**A print track per hardware zone.** An audio track in each zone fed by hardware (MicroFreak, Terra, MPC Live 2 and the rest), for recording takes. A session reopened after a month then plays without rebuilding the rig or its clock.

**A reference track** outside the zones, routed to the cue output so it never reaches the master, for comparing the mix against a reference while working. Bottega keeps the session's references beside its mixes.

**LFO Tool on the BASS and BACKGROUND groups by default**, synced to tempo, since ducking is done with LFO Tool.

**Two drum groups** in TACTUS for now (kit and percussion), and so two parallel-compression returns.

**One colour per zone**, so a zone reads the same in Live and on Bottega's Workflow tab. The colours themselves are still to be chosen.

## Routing decisions

**Parallel compression on drums.** Each drum group gets its own dedicated return track carrying the parallel compressor. The wet/dry blend is set with the return fader. Plugin mix knobs are left at 100% wet on the return.

**Ducking.** LFO Tool handles ducking. Sidechain compression is not used for this, because LFO Tool gives cleaner results and matches the established workflow.

## Context the template assumes

- Interface: Universal Audio Apollo x8.
- MIDI clock: iConnectivity mioXL, distributing System Real-Time messages only on DIN ports 9–12.
- Hardware sources likely to feed the zones: SOMA Terra, Arturia MicroFreak, Akai MPC Live 2 (the core instruments), plus SOMA Lyra-8, SOMA Cosmos, Yamaha CS-80, Korg MS-20, Radical Technologies Spectralis 2, Strymon BigSky.
- Plugins in use: UAD (Distressor, API 2500), Arturia FX Collection (Comp FET-76, Comp VCA-65, Fragments), LFO Tool, iZotope Ozone (Standard or Advanced) for mastering.
- Tuning: just intonation is under serious consideration for this music. If adopted, saturation and distortion supply the grit that detuning would otherwise provide, and a Live tuning file would belong in the template.

## Not yet specified

- Individual tracks within each zone beyond the print tracks (names, MIDI vs audio, which hardware feeds which track)
- Other return tracks (reverb, delay, hardware sends through the Yamaha mixer or BigSky)
- The colour for each zone
- Default devices on tracks, groups, and the master, beyond LFO Tool
- Input/output assignments on the Apollo
- Tempo, time signature, and default tuning
