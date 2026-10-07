// Recorded sounds served from public/audio (sources + licences in public/audio/CREDITS.md), from Tidewater's
// audio build. Loops are crossfaded at the wrap and loudness-normalised to about -23 LUFS. One-shot sprites
// hold peak-normalised slices [start s, duration s]. `lufs`: measured loudness at unity gain (loops: median
// momentary loudness; sprites: each slice's maximum momentary loudness) - the mixer turns its target
// levels into gains with it.
export const BANK = {
	wind: { file: 'wind.ogg', loop: true, lufs: -23.6 },
	palms: { file: 'palms.ogg', loop: true, lufs: -23.3 },
	crickets: { file: 'crickets.ogg', loop: true, lufs: -23 },
	birds_dawn: { file: 'birds_dawn.ogg', loop: true, lufs: -23.3 },
	step_sand: { file: 'step_sand.ogg', slices: [ [ 0.08, 0.191 ], [ 0.351, 0.3153 ], [ 0.7463, 0.2237 ], [ 1.05, 0.516 ], [ 1.646, 0.436 ] ], lufs: [ -25, -25.4, -27, -22.5, -19.8 ] },
	step_grass: { file: 'step_grass.ogg', slices: [ [ 0.08, 0.304 ], [ 0.464, 0.3553 ], [ 0.8993, 0.284 ], [ 1.2633, 0.254 ], [ 1.5973, 0.2473 ] ], lufs: [ -20.7, -18, -19.3, -19.5, -18.6 ] },
	step_rock: { file: 'step_rock.ogg', slices: [ [ 0.08, 0.504 ], [ 0.664, 0.504 ], [ 1.248, 0.504 ], [ 1.832, 0.504 ], [ 2.416, 0.504 ] ], lufs: [ -27.1, -24.8, -24.7, -24.8, -25.6 ] },
	gull: { file: 'gull.ogg', slices: [ [ 0.08, 1.001 ], [ 1.161, 1.404 ], [ 2.645, 0.904 ], [ 3.629, 1.114 ], [ 4.823, 1.044 ], [ 5.947, 0.5267 ] ], lufs: [ -15.9, -16.2, -18.1, -11.8, -12.8, -12.8 ] },
	bird_forest: { file: 'bird_forest.ogg', slices: [ [ 0.08, 1.47 ], [ 1.63, 1.45 ], [ 3.16, 1.23 ], [ 4.47, 1.59 ], [ 6.14, 1.55 ], [ 7.77, 1.38 ], [ 9.23, 1.16 ], [ 10.47, 1.3 ], [ 11.85, 1.12 ], [ 13.05, 1.45 ], [ 14.58, 1.99 ], [ 16.65, 1.2 ], [ 17.93, 1.06 ] ], lufs: [ -12.8, -12, -10.9, -11.8, -12, -11.3, -11.9, -13.4, -13.7, -11.9, -7.7, -12.1, -11 ] },
	bird_dove: { file: 'bird_dove.ogg', slices: [ [ 0.08, 3.12 ], [ 3.28, 3.18 ], [ 6.54, 3.13 ], [ 9.75, 3.36 ], [ 13.19, 3.31 ] ], lufs: [ -7.7, -7.3, -7.2, -7.4, -7.6 ] },
};
