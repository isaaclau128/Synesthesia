# Art Generation Rules

This document describes how the current Synesthesia app turns incoming audio into art.

## Input It Listens To

- The app listens to the computer microphone through the Web Audio API analyser.
- Audio is sampled into frequency data and time-domain data.
- The analyser uses an FFT size of 2048 and a smoothing time constant of 0.84.

## Core Audio Metrics

The app converts raw frequency data into a few internal metrics:

- `energy`: the average level across the spectrum.
- `bass`: the low-frequency band, approximately the first 8% of bins.
- `mid`: the middle band, approximately 8% to 33% of bins.
- `treble`: the upper band, the remaining bins.
- `attack`: how much energy rose compared with the previous frame.
- `sustain`: the current energy with attack reduced so longer notes feel smoother.
- `pedal`: a slow-decaying sustain state used to mimic piano sustain pedal behavior.

## How Those Metrics Are Derived

- `energy` is calculated as the mean of all frequency bins.
- `attack` is the positive increase from the previous frame to the current frame.
- `sustain` is derived from current energy minus part of the attack spike.
- `pedal` follows sustain and attack, then decays slowly over time when the input softens.
- If audio is idle, the metrics decay gradually instead of resetting immediately.

## Visual Rules

### Background

- The background uses a radial gradient.
- The gradient center shifts based on `mid` and `treble`.
- Brightness or bloom increases from `sustain`, `attack`, and `pedal`.
- The color cast shifts using `bass` and `treble`.
- Stars in the background twinkle more when `sustain`, `attack`, or `pedal` increases.

### Wave Rings

- The canvas draws three concentric waveform rings.
- Ring radius grows with `sustain`, `attack`, and `pedal`.
- Each frequency bin nudges the ring shape outward.
- The `sensitivity` slider increases the wobble of those rings.
- Ring glow gets stronger when `sustain` or `pedal` is higher.

### Particles

- Particles spawn mainly on note attacks.
- Stronger `attack` produces a larger burst.
- Longer `sustain` can add smaller follow-up particles.
- Particle size, speed, glow, and lifetime are influenced by `sustain`, `pedal`, and the burst intensity.
- Particle gravity is reduced slightly when `pedal` is high, so held notes drift more gently.

### Orbiting Accents

- A ring of accent dots orbits around the center.
- Their movement responds to `sustain`, `attack`, and `pedal`.
- Their size increases with `mid`, `attack`, and `pedal`.

## User Controls That Affect Art

- `Sensitivity` scales how strongly frequency data affects ring wobble and intensity.
- `Enable microphone` switches to live mic input.
- `Use demo audio` generates synthetic input so the art keeps moving without a mic.

## Current Behavior Summary For Piano And Classical Music

- Soft passages tend to create slower background motion and gentler rings.
- Sharp piano attacks create clearer bursts of particles.
- Sustained chords and pedaled passages leave longer trails and a more continuous glow.
- High notes tend to brighten the upper color range more than low notes.

## Important Note

These rules describe the current implementation, not a fixed artistic theory.
If the render logic changes, this document should be updated to match the code.