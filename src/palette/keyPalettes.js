const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    Math.round(mix(a[0], b[0], t)),
    Math.round(mix(a[1], b[1], t)),
    Math.round(mix(a[2], b[2], t)),
  ];
}

function createPalette(base) {
  const white = base.white || [248, 248, 255];

  return {
    bgA: base.bgA,
    bgB: base.bgB,
    blues: [base.bgA, mixColor(base.bgA, base.low, 0.45), base.low],
    violets: [mixColor(base.low, base.mid, 0.25), base.mid, base.accent],
    cyans: [mixColor(base.high, white, 0.18), base.high, mixColor(base.high, white, 0.55)],
    magentas: [mixColor(base.accent, base.warm, 0.12), base.accent, mixColor(base.accent, white, 0.35)],
    warms: [base.warm, mixColor(base.warm, white, 0.35), white],
    white,
  };
}

const keyPaletteBase = {
  'C major': createPalette({ bgA: [8, 10, 18], bgB: [18, 31, 58], low: [28, 70, 160], mid: [96, 66, 170], accent: [218, 84, 184], high: [98, 226, 236], warm: [242, 168, 101] }),
  'C# major': createPalette({ bgA: [9, 9, 20], bgB: [28, 20, 58], low: [52, 74, 180], mid: [111, 62, 188], accent: [236, 93, 191], high: [120, 234, 246], warm: [255, 183, 122] }),
  'D major': createPalette({ bgA: [7, 11, 20], bgB: [18, 27, 52], low: [42, 88, 178], mid: [104, 88, 196], accent: [245, 114, 175], high: [145, 241, 247], warm: [255, 196, 121] }),
  'D# major': createPalette({ bgA: [9, 10, 19], bgB: [26, 23, 56], low: [60, 82, 182], mid: [118, 72, 198], accent: [245, 104, 154], high: [132, 246, 233], warm: [255, 187, 117] }),
  'E major': createPalette({ bgA: [7, 12, 19], bgB: [14, 30, 50], low: [30, 96, 164], mid: [116, 92, 198], accent: [228, 82, 145], high: [156, 245, 230], warm: [255, 194, 105] }),
  'F major': createPalette({ bgA: [8, 11, 17], bgB: [20, 27, 44], low: [32, 82, 154], mid: [110, 74, 187], accent: [211, 84, 168], high: [140, 228, 244], warm: [255, 196, 132] }),
  'F# major': createPalette({ bgA: [7, 9, 18], bgB: [20, 19, 54], low: [52, 92, 178], mid: [126, 76, 206], accent: [248, 102, 164], high: [130, 246, 240], warm: [255, 188, 118] }),
  'G major': createPalette({ bgA: [8, 12, 18], bgB: [17, 30, 49], low: [36, 92, 148], mid: [100, 84, 182], accent: [223, 96, 149], high: [150, 240, 226], warm: [255, 191, 112] }),
  'G# major': createPalette({ bgA: [9, 9, 19], bgB: [25, 20, 58], low: [56, 84, 176], mid: [122, 68, 204], accent: [244, 92, 171], high: [132, 238, 247], warm: [255, 184, 125] }),
  'A major': createPalette({ bgA: [7, 11, 17], bgB: [14, 26, 45], low: [28, 82, 142], mid: [106, 76, 182], accent: [226, 98, 138], high: [162, 244, 232], warm: [255, 199, 109] }),
  'A# major': createPalette({ bgA: [8, 10, 18], bgB: [24, 22, 51], low: [48, 84, 170], mid: [118, 72, 198], accent: [240, 104, 160], high: [134, 243, 248], warm: [255, 191, 128] }),
  'B major': createPalette({ bgA: [7, 12, 19], bgB: [15, 29, 54], low: [34, 94, 164], mid: [112, 82, 198], accent: [229, 92, 152], high: [154, 248, 238], warm: [255, 198, 114] }),
  'C minor': createPalette({ bgA: [9, 8, 20], bgB: [22, 18, 46], low: [27, 61, 152], mid: [86, 54, 156], accent: [194, 70, 182], high: [109, 220, 233], warm: [236, 147, 89] }),
  'C# minor': createPalette({ bgA: [10, 9, 19], bgB: [30, 17, 49], low: [40, 60, 166], mid: [102, 52, 168], accent: [206, 74, 186], high: [123, 226, 240], warm: [242, 155, 98] }),
  'D minor': createPalette({ bgA: [9, 8, 18], bgB: [23, 18, 44], low: [30, 68, 148], mid: [92, 54, 162], accent: [203, 72, 176], high: [118, 216, 229], warm: [232, 149, 92] }),
  'D# minor': createPalette({ bgA: [9, 8, 19], bgB: [28, 16, 48], low: [44, 66, 160], mid: [104, 54, 172], accent: [214, 76, 182], high: [132, 224, 236], warm: [238, 154, 98] }),
  'E minor': createPalette({ bgA: [8, 9, 18], bgB: [19, 20, 44], low: [26, 72, 144], mid: [88, 56, 164], accent: [200, 80, 178], high: [116, 220, 229], warm: [234, 152, 90] }),
  'F minor': createPalette({ bgA: [9, 8, 18], bgB: [24, 17, 43], low: [32, 66, 148], mid: [96, 52, 164], accent: [204, 72, 186], high: [126, 224, 236], warm: [238, 149, 95] }),
  'F# minor': createPalette({ bgA: [8, 8, 19], bgB: [25, 16, 48], low: [44, 66, 164], mid: [110, 52, 176], accent: [220, 78, 188], high: [136, 230, 242], warm: [242, 153, 100] }),
  'G minor': createPalette({ bgA: [9, 8, 18], bgB: [22, 18, 43], low: [28, 64, 146], mid: [92, 54, 160], accent: [200, 70, 178], high: [118, 218, 230], warm: [236, 145, 92] }),
  'G# minor': createPalette({ bgA: [10, 8, 19], bgB: [28, 16, 48], low: [44, 64, 160], mid: [104, 52, 172], accent: [214, 74, 184], high: [132, 224, 238], warm: [240, 150, 96] }),
  'A minor': createPalette({ bgA: [8, 8, 18], bgB: [20, 18, 44], low: [28, 66, 148], mid: [90, 54, 160], accent: [196, 74, 180], high: [116, 218, 230], warm: [234, 148, 92] }),
  'A# minor': createPalette({ bgA: [9, 8, 19], bgB: [25, 17, 47], low: [42, 64, 160], mid: [100, 54, 170], accent: [210, 76, 184], high: [126, 224, 236], warm: [238, 152, 98] }),
  'B minor': createPalette({ bgA: [8, 9, 18], bgB: [20, 20, 46], low: [32, 70, 152], mid: [94, 56, 166], accent: [204, 78, 180], high: [120, 220, 232], warm: [236, 151, 94] }),
};

export const DEFAULT_KEY_NAME = 'C major';
export const DEFAULT_KEY_PALETTE = keyPaletteBase[DEFAULT_KEY_NAME];

export function getKeyPalette(keyName) {
  return keyPaletteBase[keyName] || DEFAULT_KEY_PALETTE;
}

export function formatKeyName(tonicIndex, mode) {
  return `${NOTE_NAMES[((tonicIndex % 12) + 12) % 12]} ${mode}`;
}
