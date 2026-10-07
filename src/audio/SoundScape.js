// Sound for Óbidos: real field recordings only (public/audio, sources and licences in
// public/audio/CREDITS.md). Nothing is synthesised. Ported from Tidewater's SoundScape (the island's
// land sounds: wind, trees, crickets, birds, footsteps); the sea, boat, whale and fishing are gone.
// Files are fetched and decoded after the first user gesture (resume()).
//
//   - Wind in gusts, louder where you are exposed (the walls, the fields outside, up in the free
//     camera) than in the narrow streets; trees rustling in the gusts.
//   - Birds: songbirds and doves sing short bouts from random perches on the roofs and in the trees
//     around the listener, by the sun: a dawn chorus (plus a diffuse chorus bed), a midday lull, sparse
//     at dusk, silent at night. Now and then a gull, far off (the coast is 10 km away).
//   - Crickets at night.
//   - Footsteps on stone (walls, steps, cobbles), loose ground (earth, gravel tracks) or grass; landings.
//
// Signal flow
//   wind → wind LP ─┬→ windBus ┐
//   trees ──────────┘          │
//   birds, chorus bed, gulls, crickets → birdBus (birds: per event HRTF panner + air absorption)
//   footsteps → stepBus ───────┤
//   master (volume², mute) → safety limiter → destination
//
// Levels: every sound has a target loudness (LUFS, momentary) for its reference situation in MIX below;
// the gain is target minus the file's measured loudness (soundBank.js).

import { BANK } from './soundBank.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

const dB = ( d ) => Math.pow( 10, d / 20 );
const MONO = dB( - 3 ); // a mono file plays on both channels: +3 dB against its (mono) measured loudness

// Target loudness (LUFS, momentary) of each sound in its reference situation (as in Tidewater).
export const MIX = {
	wind: - 36, // 7 m/s, at the top of a gust (gusts come and go; lulls are near silent)
	trees: - 39, // among the trees in a gust
	crickets: - 33, // out in the fields at night
	step: - 56, // footsteps
	gull: - 21, // at 10 m (they call from far off here)
	bird: - 31, // a songbird on a roof or in a tree, at 10 m (they sing from 10-80 m)
	dove: - 34, // a dove cooing, at 10 m
	birdChorus: - 35, // dawn chorus bed at its peak
};

// forest bird sprite: slices per source recording (a singer sings from one of them)
const FOREST = [ [ 0, 1, 2, 3, 4, 5, 6 ], [ 7, 8, 9, 10, 11, 12 ] ];

// footsteps: recording and trim (dB) per surface
const STEP = {
	stone: [ 'step_rock', 1 ], gravel: [ 'step_sand', 0 ], earth: [ 'step_sand', - 1 ], grass: [ 'step_grass', 2 ],
};

// max simultaneous one-shot voices per category (oldest is faded out beyond this)
const LIMITS = { step: 3, gull: 2, bird: 4 };

// loaded at resume(); the rest on first use
const CORE = [ 'wind', 'palms', 'step_rock', 'step_sand', 'step_grass', 'bird_forest' ];

const STORE = 'castelo.sound';

export class SoundScape {

	// Does not touch Web Audio: the context is created on the first resume() (autoplay policy).
	constructor( { baseUrl = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'audio/' } = {} ) {

		this.baseUrl = baseUrl;
		this.ctx = null;
		this._failed = false;
		// volume (0..1, perceptual taper), and the wind / birds / footsteps levels (0..2)
		this.settings = { volume: 0.8, wind: 1, birds: 1, steps: 1, muted: false };
		try {

			Object.assign( this.settings, JSON.parse( localStorage.getItem( STORE ) || '{}' ) );

		} catch ( e ) { /* private mode: defaults */ }

		this._buffers = new Map(); // name -> AudioBuffer
		this._loading = new Map(); // name -> Promise
		this._beds = new Map(); // name -> { src, gain, trim }
		this._voices = {}; // category -> [ { src, gain, end } ]
		this._last = {}; // bank -> last slice index
		this._acc = 0;
		this._gullT = 20;
		this._birdT = 2;
		this._singers = [];
		this._gust = { v: 0.4, target: 0.6, t: 0 };
		this._warned = new Set();
		this.env = { lx: 0, ly: 0, lz: 0, sunY: 1, hour: 12, exposure: 0.5, trees: 0.5, aloft: 0, ground: 0 };

	}

	// ------------------------------------------------------------------ public API

	// Call from a user gesture: creates the context and graph, starts loading the core sounds.
	async resume() {

		if ( this._failed ) return false;
		if ( ! this.ctx ) {

			const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
			if ( typeof AC !== 'function' ) {

				this._failed = true;
				return false;

			}

			try {

				this.ctx = new AC( { latencyHint: 'balanced' } );
				this._build();

			} catch ( e ) {

				this._warn( e );
				this._failed = true;
				return false;

			}

			for ( const n of CORE ) this._want( n );
			// the page going to the background suspends the sound (the frame loop stops anyway)
			document.addEventListener( 'visibilitychange', () => {

				if ( ! this.ctx ) return;
				if ( document.visibilityState === 'hidden' ) this.ctx.suspend().catch( () => {} );
				else this.ctx.resume().catch( () => {} );

			} );

		}

		try {

			if ( this.ctx.state === 'suspended' ) await Promise.race( [ this.ctx.resume(), new Promise( ( r ) => setTimeout( r, 1500 ) ) ] );

		} catch ( e ) {

			this._warn( e );

		}

		return this.enabled;

	}

	get enabled() {

		return !! this.ctx && ! this._failed && this.ctx.state === 'running';

	}

	toggleMute() {

		this.settings.muted = ! this.settings.muted;
		this.apply();
		return ! this.settings.muted;

	}

	// push the volume settings into the graph (and remember them)
	apply() {

		try {

			localStorage.setItem( STORE, JSON.stringify( this.settings ) );

		} catch ( e ) { /* ignore */ }

		if ( ! this.master ) return;
		const s = this.settings;
		this._ramp( this.master.gain, s.muted ? 0 : s.volume * s.volume, 0.05 );
		this._ramp( this.windBus.gain, s.wind, 0.05 );
		this._ramp( this.birdBus.gain, s.birds, 0.05 );
		this._ramp( this.stepBus.gain, s.steps, 0.05 );

	}

	// Per frame. state: { camera, sunY (sun direction y), hour (solar time), exposure (0 sheltered street ..
	// 1 open wall / field), trees (0..1 trees around), aloft (0 on the ground .. 1 high in the free camera),
	// ground (terrain height under the listener) }
	update( dt, state ) {

		if ( ! this.ctx || this._failed ) return;
		try {

			const e = this.env, cam = state.camera;
			e.lx = cam.position.x;
			e.ly = cam.position.y;
			e.lz = cam.position.z;
			e.sunY = state.sunY;
			e.hour = ( ( state.hour % 24 ) + 24 ) % 24;
			e.exposure = state.exposure;
			e.trees = state.trees;
			e.aloft = state.aloft || 0;
			e.ground = state.ground;
			if ( this.ctx.state !== 'running' ) return;
			this._acc += clamp( dt || 1 / 60, 0, 0.25 );
			if ( this._acc < 1 / 30 ) return;
			const step = Math.min( this._acc, 0.25 );
			this._acc = 0;
			const now = this.ctx.currentTime;
			this._placeListener( cam );
			this._mix( now, step );
			this._gulls( step );
			this._birds( now, step );

		} catch ( e ) {

			this._warn( e );

		}

	}

	// surface 'stone' | 'gravel' | 'earth' | 'grass'; gait { sprint, crouch }
	footstep( surface, gait = {} ) {

		const [ bank, trim ] = STEP[ surface ] || STEP.stone;
		const g = ( gait.sprint ? 2 : 0 ) - ( gait.crouch ? 8 : 0 );
		this._shot( bank, 'step', this.stepBus, MIX.step + trim + g + ( Math.random() - 0.5 ) * 3, 0.94 + Math.random() * 0.12 );

	}

	jump( surface ) {

		const [ bank, trim ] = STEP[ surface ] || STEP.stone;
		this._shot( bank, 'step', this.stepBus, MIX.step + trim - 4, 1.05 + Math.random() * 0.08 );

	}

	// landing after a fall: louder and heavier with the impact speed (m/s)
	land( surface, speed ) {

		const [ bank, trim ] = STEP[ surface ] || STEP.stone;
		const k = smooth( 2, 9, speed );
		this._shot( bank, 'step', this.stepBus, MIX.step + trim + 3 + 7 * k, 0.88 - 0.1 * k );

	}

	// ------------------------------------------------------------------ graph

	_build() {

		const c = this.ctx;
		const gain = ( v, dest ) => {

			const g = c.createGain();
			g.gain.value = v;
			if ( dest ) g.connect( dest );
			return g;

		};

		this._panner = ( dest, ref, rolloff ) => {

			const p = c.createPanner();
			p.panningModel = 'HRTF';
			p.distanceModel = 'inverse';
			p.refDistance = ref;
			p.rolloffFactor = rolloff;
			p.maxDistance = 10000;
			p.connect( dest );
			return p;

		};

		this.limiter = c.createDynamicsCompressor();
		this.limiter.threshold.value = - 4;
		this.limiter.knee.value = 4;
		this.limiter.ratio.value = 16;
		this.limiter.attack.value = 0.003;
		this.limiter.release.value = 0.25;
		this.limiter.connect( c.destination );
		this.master = gain( 0, this.limiter );
		this.windBus = gain( 1, this.master );
		this.birdBus = gain( 1, this.master );
		this.stepBus = gain( 1, this.master );
		this.windLP = c.createBiquadFilter();
		this.windLP.type = 'lowpass';
		this.windLP.frequency.value = 1400;
		this.windLP.Q.value = 0.5;
		this.windLP.connect( this.windBus );
		this._dest = { wind: this.windLP, palms: this.windBus, crickets: this.birdBus, birds_dawn: this.birdBus };
		this.apply();

	}

	// ------------------------------------------------------------------ loading

	// the buffer if decoded; otherwise starts loading it (once) and returns null
	_want( name ) {

		const b = this._buffers.get( name );
		if ( b ) return b;
		if ( ! this._loading.has( name ) && BANK[ name ] && this.ctx ) {

			const p = fetch( this.baseUrl + BANK[ name ].file )
				.then( ( r ) => {

					if ( ! r.ok ) throw new Error( `audio ${ name }: HTTP ${ r.status }` );
					return r.arrayBuffer();

				} )
				.then( ( a ) => this.ctx.decodeAudioData( a ) )
				.then( ( buf ) => {

					this._buffers.set( name, buf );
					return buf;

				} )
				.catch( ( e ) => this._warn( e ) );
			this._loading.set( name, p );

		}

		return null;

	}

	// ------------------------------------------------------------------ beds

	// sets a looping bed's gain (linear) and playback rate; starts it (random offset) when first audible
	_bed( name, g, now, tau = 0.25, rate = 1 ) {

		let bed = this._beds.get( name );
		if ( ! bed ) {

			if ( g < 1e-4 ) return;
			const buf = this._want( name );
			if ( ! buf ) return;
			const c = this.ctx;
			const src = c.createBufferSource();
			src.buffer = buf;
			src.loop = true;
			src.playbackRate.value = rate;
			const gn = c.createGain();
			gn.gain.value = 0;
			src.connect( gn ).connect( this._dest[ name ] );
			src.start( now + 0.02, Math.random() * buf.duration );
			bed = { src, gain: gn, trim: buf.numberOfChannels === 1 ? MONO : 1 };
			this._beds.set( name, bed );
			tau = Math.max( tau, 0.8 ); // fade in on first start

		}

		this._ramp( bed.gain.gain, g * bed.trim, tau );
		this._ramp( bed.src.playbackRate, rate, 0.15 );

	}

	// ------------------------------------------------------------------ one-shots

	// plays a random slice of a sprite bank (never the same one twice in a row) at a target loudness;
	// `at`: context time (default now); `pick`: slice index (default random)
	_shot( bank, cat, dest, targetLufs, rate = 1, at = 0, pick = - 1 ) {

		if ( ! this.enabled || ! dest ) return null;
		const info = BANK[ bank ];
		const buf = this._want( bank );
		if ( ! buf || ! info ) return null;
		const n = info.slices.length;
		let i = pick >= 0 && pick < n ? pick : Math.floor( Math.random() * n );
		if ( pick < 0 && n > 1 && i === this._last[ bank ] ) i = ( i + 1 + Math.floor( Math.random() * ( n - 1 ) ) ) % n;
		this._last[ bank ] = i;
		const [ start, dur ] = info.slices[ i ];
		const c = this.ctx, t = Math.max( c.currentTime + 0.005, at );
		const src = c.createBufferSource();
		src.buffer = buf;
		src.playbackRate.value = rate;
		const g = c.createGain();
		g.gain.value = dB( clamp( targetLufs - info.lufs[ i ], - 80, 24 ) ) * ( buf.numberOfChannels === 1 ? MONO : 1 );
		src.connect( g ).connect( dest );
		src.start( t, start, dur );

		const list = this._voices[ cat ] || ( this._voices[ cat ] = [] );
		const v = { src, gain: g, end: t + dur / rate, extra: null };
		list.push( v );
		src.onended = () => {

			const k = list.indexOf( v );
			if ( k >= 0 ) list.splice( k, 1 );
			g.disconnect();
			if ( v.extra ) for ( const x of v.extra ) x.disconnect();

		};

		while ( list.length > ( LIMITS[ cat ] || 3 ) ) {

			const old = list.shift();
			old.gain.gain.setTargetAtTime( 0, c.currentTime, 0.05 );
			try {

				old.src.stop( c.currentTime + 0.3 );

			} catch ( e ) { /* already stopped */ }

		}

		return v;

	}

	// a one-shot placed in the world: HRTF panner at (x, y, z) + air absorption with distance
	_shotAt( bank, cat, x, y, z, targetLufs, rate, at, ref, rolloff = 1, pick = - 1 ) {

		if ( ! this.enabled || ! this._want( bank ) ) return null;
		const c = this.ctx, e = this.env;
		const d = Math.hypot( x - e.lx, y - e.ly, z - e.lz );
		const p = this._panner( this.birdBus, ref, rolloff );
		p.positionX.value = x;
		p.positionY.value = y;
		p.positionZ.value = z;
		const air = c.createBiquadFilter();
		air.type = 'lowpass';
		air.frequency.value = clamp( 18000 / ( 1 + d / 45 ), 1500, 18000 );
		air.connect( p );
		const v = this._shot( bank, cat, air, targetLufs, rate, at, pick );
		if ( ! v ) {

			air.disconnect();
			p.disconnect();
			return null;

		}

		v.extra = [ air, p ];
		return v;

	}

	// ------------------------------------------------------------------ per frame

	_placeListener( cam ) {

		const L = this.ctx.listener, e = this.env;
		const { x, y, z, w } = cam.quaternion;
		// the camera's -z (forward) and +y (up) axes
		const fx = - 2 * ( x * z + w * y ), fy = - 2 * ( y * z - w * x ), fz = - ( 1 - 2 * ( x * x + y * y ) );
		const ux = 2 * ( x * y - w * z ), uy = 1 - 2 * ( x * x + z * z ), uz = 2 * ( y * z + w * x );
		if ( L.positionX ) {

			this._ramp( L.positionX, e.lx, 0.03 );
			this._ramp( L.positionY, e.ly, 0.03 );
			this._ramp( L.positionZ, e.lz, 0.03 );
			this._ramp( L.forwardX, fx, 0.02 );
			this._ramp( L.forwardY, fy, 0.02 );
			this._ramp( L.forwardZ, fz, 0.02 );
			this._ramp( L.upX, ux, 0.02 );
			this._ramp( L.upY, uy, 0.02 );
			this._ramp( L.upZ, uz, 0.02 );

		} else {

			L.setPosition( e.lx, e.ly, e.lz );
			L.setOrientation( fx, fy, fz, ux, uy, uz );

		}

	}

	_mix( now, dt ) {

		const e = this.env;
		const day = smooth( - 0.1, 0.05, e.sunY );

		// wind in gusts: a random target every 2-8 s (lulls near silent), eased towards. The wind speed
		// at the listener: a 7 m/s breeze on the walls and in the open, much less in the streets, more aloft.
		const g = this._gust;
		g.t -= dt;
		if ( g.t <= 0 ) {

			g.target = Math.random() < 0.35 ? 0.03 + Math.random() * 0.12 : 0.3 + Math.random() * 0.7;
			g.t = 2 + Math.random() * 6;

		}

		g.v += ( g.target - g.v ) * ( 1 - Math.exp( - dt / 1.4 ) );
		const w = 7 * ( 0.35 + 0.65 * e.exposure ) * ( 1 + 0.8 * e.aloft );
		this._bed( 'wind', dB( MIX.wind ) * clamp( w / 7, 0, 2.5 ) * g.v / dB( BANK.wind.lufs ), now, 0.3 );
		this._ramp( this.windLP.frequency, 400 + ( 80 + 60 * g.v ) * w, 0.4 );

		// trees rustle in the gusts; crickets at night, louder out in the fields
		const veg = e.trees * ( 1 - e.aloft );
		this._bed( 'palms', dB( MIX.trees ) * veg * clamp( w / 7, 0.2, 1.8 ) * g.v * ( 0.3 + 0.7 * day ) / dB( BANK.palms.lufs ), now, 0.5 );
		const night = 1 - smooth( - 0.12, - 0.02, e.sunY );
		this._bed( 'crickets', dB( MIX.crickets ) * night * ( 0.35 + 0.65 * e.trees ) * ( 1 - e.aloft ) / dB( BANK.crickets.lufs ), now, 1 );

	}

	// a gull now and then, far off and high, by day
	_gulls( dt ) {

		const e = this.env;
		if ( e.sunY < 0.05 ) return;
		this._gullT -= dt;
		if ( this._gullT > 0 ) return;
		this._gullT = 25 + Math.random() * 60;
		if ( ! this._want( 'gull' ) ) return;
		const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 100;
		this._shotAt( 'gull', 'gull', e.lx + Math.cos( a ) * d, e.ly + 20 + Math.random() * 30, e.lz + Math.sin( a ) * d,
			MIX.gull + ( Math.random() - 0.5 ) * 4, 0.93 + Math.random() * 0.14, 0, 10 );

	}

	// ------------------------------------------------------------------ songbirds

	// songbird activity by the sun: { act: singers relative to a normal morning, chorus: dawn chorus 0..1, lull }
	_birdActivity() {

		const e = this.env, h = e.hour, morning = h < 12;
		const on = smooth( - 0.1, - 0.03, e.sunY ); // awake: first light to dusk
		const chorus = morning ? smooth( - 0.1, - 0.03, e.sunY ) * ( 1 - smooth( 0.12, 0.3, e.sunY ) ) : 0;
		const lull = smooth( 10.5, 12, h ) * ( 1 - smooth( 14.5, 16, h ) ); // the heat of the day
		const dusk = morning ? 0 : 1 - smooth( 0.02, 0.2, e.sunY );
		return { act: on * Math.max( 0, 1 + 2.5 * chorus - 0.6 * lull - 0.55 * dusk ), chorus: on * chorus, lull };

	}

	// a perch on a roof or in a tree near the listener: 10-80 m away, 3-12 m above the ground
	_perch() {

		const e = this.env;
		const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 70;
		return { x: e.lx + Math.cos( a ) * r, y: e.ground + 3 + Math.random() * 9, z: e.lz + Math.sin( a ) * r };

	}

	// songbirds and doves: a new singer every few seconds (at dawn often, at midday rarely, at night
	// never), each a bout of 1-4 phrases from one perch - a different slice of one recording each time
	_birds( now, dt ) {

		const e = this.env, { act, chorus, lull } = this._birdActivity();
		const hab = 1 - e.aloft;

		// the dawn chorus: many birds at once, diffuse
		this._bed( 'birds_dawn', dB( MIX.birdChorus ) * chorus * ( 0.5 + 0.5 * e.trees ) * hab / dB( BANK.birds_dawn.lufs ), now, 2 );

		this._birdT -= dt;
		const rate = act * hab;
		if ( this._birdT <= 0 ) {

			this._birdT = rate > 0.02 ? ( 4 + Math.random() * 20 ) / rate : 3;
			if ( rate > 0.02 && this._singers.length < 3 ) {

				const p = this._perch();
				const dove = Math.random() < 0.15 + 0.25 * lull;
				const bank = dove ? 'bird_dove' : 'bird_forest';
				this._want( bank );
				p.bank = bank;
				p.group = dove ? null : FOREST[ Math.floor( Math.random() * FOREST.length ) ];
				p.n = 1 + Math.floor( Math.random() * ( dove ? 2 : 4 ) );
				p.t = Math.random() * 0.5;
				p.rate = 0.93 + Math.random() * 0.14;
				p.lvl = ( dove ? MIX.dove : MIX.bird ) + ( Math.random() - 0.5 ) * 6;
				this._singers.push( p );

			}

		}

		for ( let i = this._singers.length - 1; i >= 0; i -- ) {

			const s = this._singers[ i ];
			s.t -= dt;
			if ( s.t > 0 ) continue;
			if ( s.n <= 0 || act < 0.01 ) {

				this._singers.splice( i, 1 );
				continue;

			}

			const info = BANK[ s.bank ];
			if ( ! this._want( s.bank ) ) {

				s.t = 1; // still loading
				continue;

			}

			let k = - 1;
			if ( s.group ) {

				k = s.group[ Math.floor( Math.random() * s.group.length ) ];
				if ( k === this._last[ s.bank ] ) k = s.group[ ( s.group.indexOf( k ) + 1 ) % s.group.length ];

			}

			const v = this._shotAt( s.bank, 'bird', s.x, s.y, s.z, s.lvl + ( Math.random() - 0.5 ) * 2, s.rate * ( 0.98 + Math.random() * 0.04 ), 0, 10, 1, k );
			const d = v ? info.slices[ this._last[ s.bank ] ][ 1 ] / s.rate : 0;
			s.n --;
			s.t = d + 0.8 + Math.random() * 4.5;

		}

	}

	// ------------------------------------------------------------------ helpers

	// smooth parameter ramp; skips negligible changes to keep the automation timeline short
	_ramp( param, v, tau ) {

		if ( ! Number.isFinite( v ) ) return;
		const last = param._t;
		if ( last !== undefined && Math.abs( v - last ) <= Math.abs( last ) * 0.004 + 1e-6 ) return;
		param._t = v;
		param.setTargetAtTime( v, this.ctx.currentTime, tau );

	}

	_warn( e ) {

		const msg = ( e && e.message ) || String( e );
		if ( this._warned.has( msg ) || this._warned.size > 20 ) return;
		this._warned.add( msg );
		console.warn( '[SoundScape]', e );

	}

}
