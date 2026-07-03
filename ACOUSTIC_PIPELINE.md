# Acoustic Pipeline for Live Piano and Classical Music

This note describes the rules the visual system can use when the input comes from a live acoustic piano played into a laptop microphone.

## 1. The Acoustic Pipeline

When an acoustic piano plays, the microphone receives a mixed sound wave containing the note, harmonics, room noise, and echo. The app should separate overall loudness from the musical content before turning it into art.

```text
[Acoustic Instrument] -> [Microphone] -> [Fast Fourier Transform (FFT)] -> [Pitch & Volume] -> [Visuals]
```

The FFT is the core real-time step. It splits the incoming audio into a spectrum of frequencies so the app can estimate which notes are present and how strong the sound is at each moment.

## 2. Updated Strategy for Live Instruments

Microphones pick up room noise, background hum, and echoes, so the art system should rely on stable, simple signals instead of trying to read the signal as if it were a clean digital piano.

### Tracking the Vibe

Use overall loudness, usually RMS or a close energy estimate, as the main control signal.

- Soft acoustic notes -> low loudness -> thin, translucent, calm brush strokes.
- Loud or aggressive playing -> high loudness -> thicker, more opaque, faster brush strokes.

### Tracking the Pitch

Acoustic pianos create rich harmonics that make pitch tracking harder than with a clean synthesized tone. The current app uses an in-browser autocorrelation pitch estimate plus spectral texture scoring so it can stay lightweight and avoid an extra machine-learning dependency.

- Web browser option: Web Audio API analyser plus autocorrelation or a pitch model.
- Desktop option: Aubio or Librosa for live pitch extraction.

## 3. Simple Art Structure

The musical input should flow into the drawing logic continuously:

```text
mic level + pitch estimate -> visual mode choice -> draw live art
```

Suggested mapping for piano/classical visuals:

- Higher pitches -> brighter, warmer highlights.
- Lower pitches -> deeper, cooler tones.
- Louder passages -> larger splashes, stronger opacity, faster motion.
- Softer passages -> delicate watercolor-like motion and slower decay.

## 4. Chord Detection and Musical Texture

Dense piano chords are harder to classify than single notes, so the system should treat texture as a visual signal rather than trying to force perfect note naming.

- Clean single-note streams -> melody-focused or fugue-like visual mode.
- Chaotic or rapidly shifting frequency clusters -> chord-heavy or impressionistic visual mode.

That makes the app more expressive and more tolerant of real acoustic input.

## 5. Practical Rule Summary

- Use FFT to read live frequency energy.
- Use RMS or energy as the main loudness control.
- Use pitch information only as a guide, not a hard truth.
- Let attacks create bursts and sustained notes create trails.
- Let dense chords trigger richer, more blended visual states.
- Let pedal-like sustain stretch the decay of the art.

## 6. Relation To The Current App

The current Synesthesia app already uses microphone input, spectrum energy, attack, sustain, and a pedal-like decay state to generate art.

This document describes the more piano-specific version of that idea for future refinement, and the current app now follows this structure with live pitch, texture, and mode switching.