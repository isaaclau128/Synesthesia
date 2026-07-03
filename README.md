# Synesthesia

Real-time generative art driven by your computer microphone.

## What it does

- Listens to live mic input with the Web Audio API.
- Turns frequency energy into glowing rings, particles, and color blooms.
- Includes a demo mode so the canvas still animates without microphone access.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints in your browser and allow microphone access.

## Build

```bash
npm run build
```

## Docs

- [Art generation rules](ART_RULES.md)
- [Acoustic pipeline and piano/classical strategy](ACOUSTIC_PIPELINE.md)
