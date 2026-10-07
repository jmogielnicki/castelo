// Ambient sound, all synthesised with Web Audio (no sound files): the breeze, the birds of the town and
// the Várzea, crickets and owls at night, and the walker's footsteps.
//
//   - Wind: looped pink noise through a few filters whose levels and cut-offs follow a slowly gusting
//     wind. It is louder and brighter where you are exposed (on the walls, outside the town, up in the free
//     camera) than in the sheltered streets. A narrow resonant band whistles through the crenels in gusts,
//     and a high band rustles like leaves.
//   - Birds: short synthesised calls at random places around the listener (3D, HRTF panned): sparrows in
//     the town, a blackbird singing from a rooftop, collared doves, a distant gull, and screaming swifts
//     sweeping past in summer. How many depends on the light (a dawn chorus, a busier dusk) and the season.
//   - Night: crickets, and now and then a scops owl (spring and summer) or a tawny owl.
//   - Footsteps: a short burst per step, shaped by the surface: stone (walls, stairs, cobbles), gravel,
//     earth or grass. Jumps scuff, and landings thud with the fall speed.
//
// The AudioContext can only start after a user gesture: resume() is called from the start overlay's click.

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};
const rand = ( a, b ) => a + Math.random() * ( b - a );
const pick = ( arr ) => arr[ Math.floor( Math.random() * arr.length ) ];

const STORE = 'castelo.sound';

export class Ambience {

	constructor() {

		this.ctx = null;
		this.settings = { volume: 0.8, wind: 1, birds: 1, steps: 1, muted: false };
		try {

			Object.assign( this.settings, JSON.parse( localStorage.getItem( STORE ) || '{}' ) );

		} catch ( e ) { /* private mode: defaults */ }

		this._t = 0;
		this._gust = 0.5;
		this._gustTarget = 0.5;
		this._gustNext = 0;
		this._exposure = 0.5;
		this._owl = null; // current owl bout
		this._listener = { x: 0, y: 0, z: 0, fx: 0, fz: - 1 };

	}

	get started() {

		return !! this.ctx;

	}

	// first call builds the graph (inside a user gesture), later calls wake it after a suspend
	resume() {

		if ( ! this.ctx ) this._build();
		if ( this.ctx.state !== 'running' ) this.ctx.resume().catch( () => {} );

	}

	save() {

		try {

			localStorage.setItem( STORE, JSON.stringify( this.settings ) );

		} catch ( e ) { /* ignore */ }

	}

	// push the volume settings into the graph
	apply() {

		this.save();
		if ( ! this.ctx ) return;
		const s = this.settings, now = this.ctx.currentTime;
		this.master.gain.setTargetAtTime( s.muted ? 0 : s.volume, now, 0.08 );
		this.windBus.gain.setTargetAtTime( s.wind * 0.25, now, 0.08 );
		this.birdBus.gain.setTargetAtTime( s.birds, now, 0.08 );
		this.stepBus.gain.setTargetAtTime( s.steps * 0.03, now, 0.08 );

	}

	toggleMute() {

		this.settings.muted = ! this.settings.muted;
		this.apply();
		return ! this.settings.muted;

	}

	_build() {

		const ctx = this.ctx = new ( window.AudioContext || window.webkitAudioContext )();

		// buses → a gentle limiter → out
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = - 10;
		limiter.knee.value = 8;
		limiter.ratio.value = 6;
		limiter.attack.value = 0.005;
		limiter.release.value = 0.25;
		limiter.connect( ctx.destination );
		this.master = ctx.createGain();
		this.master.gain.value = 0;
		this.master.connect( limiter );
		const bus = () => {

			const g = ctx.createGain();
			g.connect( this.master );
			return g;

		};

		this.windBus = bus();
		this.birdBus = bus();
		this.nightBus = bus();
		this.stepBus = bus();

		// ---- noise
		this.white = this._noiseBuffer( 2, 1, 'white' );
		const pink = this._noiseBuffer( 8, 2, 'pink' );

		// ---- wind: three bands of one looped stereo pink noise, and a rustle band from another offset
		const src = ctx.createBufferSource();
		src.buffer = pink;
		src.loop = true;
		const filt = ( type, f, q ) => {

			const b = ctx.createBiquadFilter();
			b.type = type;
			b.frequency.value = f;
			b.Q.value = q;
			return b;

		};

		const gain = ( v ) => {

			const g = ctx.createGain();
			g.gain.value = v;
			return g;

		};

		this.wLow = { f: filt( 'lowpass', 300, 0.6 ), g: gain( 0 ) };
		this.wBody = { f: filt( 'bandpass', 600, 0.9 ), g: gain( 0 ) };
		this.wWhistle = { f: filt( 'bandpass', 820, 14 ), g: gain( 0 ) };
		for ( const b of [ this.wLow, this.wBody, this.wWhistle ] ) {

			src.connect( b.f );
			b.f.connect( b.g );
			b.g.connect( this.windBus );

		}

		const rsrc = ctx.createBufferSource();
		rsrc.buffer = pink;
		rsrc.loop = true;
		rsrc.playbackRate.value = 1.13;
		this.wRustle = { f: filt( 'highpass', 2600, 0.5 ), g: gain( 0 ) };
		const rLow = filt( 'lowpass', 8000, 0.5 );
		rsrc.connect( this.wRustle.f );
		this.wRustle.f.connect( rLow );
		rLow.connect( this.wRustle.g );
		this.wRustle.g.connect( this.windBus );
		src.start( 0, Math.random() * 8 );
		rsrc.start( 0, Math.random() * 8 );

		// ---- crickets: a few looped, slightly detuned chirp trains spread across the stereo field
		const crick = this._cricketBuffer();
		this.crickets = gain( 0 );
		this.crickets.connect( this.nightBus );
		for ( let i = 0; i < 4; i ++ ) {

			const c = ctx.createBufferSource();
			c.buffer = crick;
			c.loop = true;
			c.playbackRate.value = rand( 0.9, 1.08 );
			const p = ctx.createStereoPanner();
			p.pan.value = [ - 0.7, - 0.2, 0.3, 0.8 ][ i ];
			const g = gain( rand( 0.5, 1 ) );
			c.connect( g );
			g.connect( p );
			p.connect( this.crickets );
			c.start( 0, rand( 0, crick.duration ) );

		}

		// the page going to the background suspends the sound (and the frame loop stops anyway)
		document.addEventListener( 'visibilitychange', () => {

			if ( document.visibilityState === 'hidden' ) ctx.suspend().catch( () => {} );
			else ctx.resume().catch( () => {} );

		} );

		this.apply();

	}

	_noiseBuffer( seconds, channels, kind ) {

		const ctx = this.ctx;
		const n = Math.floor( seconds * ctx.sampleRate ), x = 4096;
		const buf = ctx.createBuffer( channels, n, ctx.sampleRate );
		const d = new Float32Array( n + x );
		for ( let c = 0; c < channels; c ++ ) {

			let b0 = 0, b1 = 0, b2 = 0, peak = 0;
			for ( let i = 0; i < n + x; i ++ ) {

				const w = Math.random() * 2 - 1;
				if ( kind === 'pink' ) {

					// Paul Kellet's economy pink filter
					b0 = 0.99765 * b0 + w * 0.0990460;
					b1 = 0.96300 * b1 + w * 0.2965164;
					b2 = 0.57000 * b2 + w * 1.0526913;
					d[ i ] = b0 + b1 + b2 + w * 0.1848;

				} else d[ i ] = w;
				peak = Math.max( peak, Math.abs( d[ i ] ) );

			}

			// a seamless loop: fade the samples after the end into the start
			for ( let i = 0; i < x; i ++ ) {

				const t = i / x;
				d[ i ] = d[ i ] * t + d[ n + i ] * ( 1 - t );

			}

			const out = buf.getChannelData( c );
			for ( let i = 0; i < n; i ++ ) out[ i ] = d[ i ] * 0.9 / peak;

		}

		return buf;

	}

	// 4 s of a field cricket: chirps of 3-4 pulses at ~4.6 kHz, about three chirps a second
	_cricketBuffer() {

		const ctx = this.ctx, sr = ctx.sampleRate;
		const n = Math.floor( 4 * sr );
		const buf = ctx.createBuffer( 1, n, sr );
		const d = buf.getChannelData( 0 );
		const f = rand( 4400, 4800 );
		let t = rand( 0, 0.1 );
		while ( t < 3.8 ) {

			const pulses = 3 + ( Math.random() < 0.4 ? 1 : 0 );
			for ( let k = 0; k < pulses; k ++ ) {

				const t0 = t + k * 0.034, len = 0.02;
				const i0 = Math.floor( t0 * sr ), i1 = Math.min( n, Math.floor( ( t0 + len ) * sr ) );
				for ( let i = i0; i < i1; i ++ ) {

					const u = ( i - i0 ) / ( i1 - i0 );
					d[ i ] += Math.sin( 2 * Math.PI * f * i / sr ) * Math.sin( Math.PI * u ) * 0.5;

				}

			}

			t += rand( 0.3, 0.38 );

		}

		return buf;

	}

	// ---------------------------------------------------------------- per frame

	// env: { camera, sunY (sun direction y), hours (solar time), day (of year), exposure (0 sheltered
	// street .. 1 open wall / field), aloft (0 on the ground .. 1 high up in the free camera) }
	update( dt, env ) {

		if ( ! this.ctx || this.ctx.state !== 'running' ) return;
		dt = Math.min( dt, 0.1 );
		const ctx = this.ctx, now = ctx.currentTime;
		this._t += dt;
		this._setListener( env.camera );

		const sunY = env.sunY;
		const day = smooth( - 0.03, 0.12, sunY ); // daylight
		const night = 1 - smooth( - 0.12, - 0.01, sunY );
		const low = Math.exp( - ( ( ( sunY - 0.03 ) / 0.09 ) ** 2 ) ); // sun near the horizon: dawn and dusk
		const morning = env.hours < 12;
		const doy = env.day;
		const spring = smooth( 40, 80, doy ) * ( 1 - smooth( 170, 210, doy ) ); // song season
		const warm = smooth( 90, 140, doy ) * ( 1 - smooth( 260, 310, doy ) ); // crickets, scops owls

		// ---- wind: gusts every few seconds over a slow swell
		if ( this._t > this._gustNext ) {

			this._gustTarget = Math.random() ** 1.6;
			this._gustNext = this._t + rand( 2.5, 9 );

		}

		this._gust += ( this._gustTarget - this._gust ) * ( 1 - Math.exp( - dt / 1.8 ) );
		const swell = 0.5 + 0.3 * Math.sin( this._t * 0.071 ) + 0.2 * Math.sin( this._t * 0.23 + 1.3 );
		const g = Math.min( 1.2, 0.25 + 0.5 * this._gust + 0.35 * swell ) * ( 0.75 + 0.25 * day );
		this._exposure += ( env.exposure - this._exposure ) * ( 1 - Math.exp( - dt / 0.8 ) );
		const ex = this._exposure, up = env.aloft || 0;
		const T = 0.25;
		// compress the wind's range: the calmest wind (a sheltered street at night) keeps its level, the
		// strongest gust on an exposed wall comes out at half, and everything between is scaled linearly
		const drive = g * ( 0.3 + 0.7 * ex + 0.6 * up );
		const D_MIN = 0.1875 * ( 0.3 + 0.7 * 0.35 ), D_MAX = 1.1;
		const level = drive > D_MIN ? D_MIN + ( drive - D_MIN ) * ( 0.5 * D_MAX - D_MIN ) / ( D_MAX - D_MIN ) : drive;
		const m = drive > 0 ? level / drive : 1;
		this.wLow.g.gain.setTargetAtTime( m * 0.42 * drive, now, T );
		this.wLow.f.frequency.setTargetAtTime( 180 + 260 * g * ( 0.6 + 0.4 * ex ), now, T );
		this.wBody.g.gain.setTargetAtTime( m * 0.2 * g * g * ( 0.15 + 0.85 * ex + 0.6 * up ), now, T );
		this.wBody.f.frequency.setTargetAtTime( 350 + 700 * g * ( 0.5 + 0.5 * ex ), now, T );
		const whistle = smooth( 0.65, 1.0, g ) * ex;
		this.wWhistle.g.gain.setTargetAtTime( m * 0.5 * whistle, now, 0.6 );
		this.wWhistle.f.frequency.setTargetAtTime( 700 + 260 * g + 40 * Math.sin( this._t * 0.9 ), now, 0.4 );
		// leaves and grass: flutters with the gusts, quieter in the streets
		const flutter = 0.55 + 0.45 * Math.random();
		this.wRustle.g.gain.setTargetAtTime( m * 0.07 * smooth( 0.2, 0.9, g ) * flutter * ( 0.35 + 0.65 * ex ) * ( 1 - up ), now, 0.09 );

		// ---- night
		this.crickets.gain.setTargetAtTime( 0.05 * night * ( 0.35 + 0.65 * warm ) * ( 0.5 + 0.5 * ex ) * ( 1 - up ), now, 1.5 );
		this._updateOwl( dt, night, warm );

		// ---- birds (calls per second)
		const song = 0.6 + 0.8 * spring;
		const chorus = 1 + ( morning ? 2.2 : 1.2 ) * low;
		const inTown = 1 - ex * 0.6;
		const ground = 1 - up;
		const rates = [
			[ 'sparrow', 0.22 * day * chorus * ( 0.4 + inTown ) * ground ],
			[ 'blackbird', 0.035 * song * ( day + 2.5 * low * day ) * ground ],
			[ 'dove', 0.025 * day * ( 0.6 + 0.4 * spring ) * ground ],
			[ 'gull', 0.01 * day ],
			[ 'swifts', 0.05 * day * smooth( 105, 120, doy ) * ( 1 - smooth( 215, 225, doy ) ) * ( 1 + 2 * low ) ],
		];
		for ( const [ kind, r ] of rates ) if ( Math.random() < r * dt ) this[ '_' + kind ]();

	}

	_setListener( camera ) {

		const L = this.ctx.listener, now = this.ctx.currentTime;
		const p = camera.position, { x, y, z, w } = camera.quaternion;
		// the camera's -z (forward) and +y (up) axes
		const fx = - 2 * ( x * z + w * y ), fy = - 2 * ( y * z - w * x ), fz = - ( 1 - 2 * ( x * x + y * y ) );
		const ux = 2 * ( x * y - w * z ), uy = 1 - 2 * ( x * x + z * z ), uz = 2 * ( y * z + w * x );
		this._listener.x = p.x;
		this._listener.y = p.y;
		this._listener.z = p.z;
		const fl = Math.hypot( fx, fz ) || 1;
		this._listener.fx = fx / fl;
		this._listener.fz = fz / fl;
		if ( L.positionX ) {

			L.positionX.setValueAtTime( p.x, now );
			L.positionY.setValueAtTime( p.y, now );
			L.positionZ.setValueAtTime( p.z, now );
			L.forwardX.setValueAtTime( fx, now );
			L.forwardY.setValueAtTime( fy, now );
			L.forwardZ.setValueAtTime( fz, now );
			L.upX.setValueAtTime( ux, now );
			L.upY.setValueAtTime( uy, now );
			L.upZ.setValueAtTime( uz, now );

		} else {

			L.setPosition( p.x, p.y, p.z );
			L.setOrientation( fx, fy, fz, ux, uy, uz );

		}

	}

	// a point around the listener: dist metres away (horizontal), up metres above the ear
	_around( dist, up ) {

		const a = Math.random() * Math.PI * 2, l = this._listener;
		return { x: l.x + Math.cos( a ) * dist, y: l.y + up, z: l.z + Math.sin( a ) * dist };

	}

	// a 3D voice at pos: returns its input; everything is disconnected when `until` has passed
	_voice( pos, until, bus = this.birdBus, ref = 8 ) {

		const ctx = this.ctx;
		const p = ctx.createPanner();
		p.panningModel = 'HRTF';
		p.distanceModel = 'inverse';
		p.refDistance = ref;
		p.rolloffFactor = 1;
		if ( p.positionX ) {

			p.positionX.value = pos.x;
			p.positionY.value = pos.y;
			p.positionZ.value = pos.z;

		} else p.setPosition( pos.x, pos.y, pos.z );
		p.connect( bus );
		const g = ctx.createGain();
		g.gain.value = 0;
		g.connect( p );
		setTimeout( () => {

			g.disconnect();
			p.disconnect();

		}, ( until - ctx.currentTime + 0.3 ) * 1000 );
		return { g, p };

	}

	_osc( type, t0, t1, dest ) {

		const o = this.ctx.createOscillator();
		o.type = type;
		if ( dest ) o.connect( dest );
		o.start( t0 );
		o.stop( t1 );
		return o;

	}

	// note envelope on a gain param: quick attack, exponential tail
	_env( param, t, dur, peak, attack = 0.006 ) {

		param.setValueAtTime( 0, t );
		param.linearRampToValueAtTime( peak, t + attack );
		param.setTargetAtTime( 0, t + Math.max( attack, dur * 0.55 ), dur * 0.18 );

	}

	// house sparrow: a few buzzy "chirrup" notes from the eaves
	_sparrow() {

		const t = this.ctx.currentTime + 0.02;
		const n = 2 + Math.floor( Math.random() * 4 );
		const base = rand( 3000, 4200 );
		let tt = t;
		const notes = [];
		for ( let k = 0; k < n; k ++ ) {

			const dur = rand( 0.05, 0.1 );
			notes.push( [ tt, dur, base * rand( 0.9, 1.1 ) ] );
			tt += dur + rand( 0.05, 0.16 );

		}

		const { g } = this._voice( this._around( rand( 6, 30 ), rand( 4, 10 ) ), tt + 0.1 );
		const o = this._osc( 'sine', t, tt + 0.1, g );
		// a little FM for the buzz
		const m = this._osc( 'sine', t, tt + 0.1, null );
		m.frequency.value = rand( 180, 320 );
		const md = this.ctx.createGain();
		md.gain.value = rand( 300, 600 );
		m.connect( md );
		md.connect( o.frequency );
		for ( const [ s, d, f ] of notes ) {

			o.frequency.setValueAtTime( f * 0.82, s );
			o.frequency.linearRampToValueAtTime( f * 1.2, s + d * 0.35 );
			o.frequency.exponentialRampToValueAtTime( f * 0.9, s + d );
			this._env( g.gain, s, d, 0.35 );

		}

	}

	// blackbird: a fluting phrase from a rooftop or a garden tree, ending in a high twitter
	_blackbird() {

		const t = this.ctx.currentTime + 0.02;
		const n = 4 + Math.floor( Math.random() * 5 );
		let tt = t, f = rand( 1500, 2300 );
		const notes = [];
		for ( let k = 0; k < n; k ++ ) {

			const dur = rand( 0.08, 0.26 );
			const f1 = Math.min( 3200, Math.max( 1300, f * rand( 0.8, 1.25 ) ) );
			notes.push( [ tt, dur, f, f1, 0.22 ] );
			f = f1;
			tt += dur + rand( 0.02, 0.08 );

		}

		if ( Math.random() < 0.7 ) for ( let k = 0; k < 3 + Math.floor( Math.random() * 4 ); k ++ ) {

			const f0 = rand( 4500, 6500 );
			notes.push( [ tt, 0.035, f0, f0 * 0.8, 0.08 ] );
			tt += 0.05;

		}

		const { g } = this._voice( this._around( rand( 15, 45 ), rand( 6, 14 ) ), tt + 0.2 );
		const o = this._osc( 'sine', t, tt + 0.2, g );
		const vib = this._osc( 'sine', t, tt + 0.2, null );
		vib.frequency.value = rand( 20, 30 );
		const vd = this.ctx.createGain();
		vd.gain.value = 25;
		vib.connect( vd );
		vd.connect( o.frequency );
		for ( const [ s, d, f0, f1, a ] of notes ) {

			o.frequency.setValueAtTime( f0, s );
			o.frequency.exponentialRampToValueAtTime( f1, s + d );
			this._env( g.gain, s, d, a, 0.015 );

		}

	}

	// collared dove: "coo-COOO-coo", twice or three times, soft and low
	_dove() {

		const t = this.ctx.currentTime + 0.02;
		const f = rand( 480, 560 );
		const reps = 2 + Math.floor( Math.random() * 2 );
		const notes = [];
		let tt = t;
		for ( let r = 0; r < reps; r ++ ) {

			notes.push( [ tt, 0.22, f * 1.02 ], [ tt + 0.3, 0.5, f * 1.08 ], [ tt + 0.95, 0.32, f * 0.94 ] );
			tt += 1.3 + rand( 0.4, 0.8 );

		}

		const { g } = this._voice( this._around( rand( 15, 40 ), rand( 5, 12 ) ), tt );
		const lp = this.ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 900;
		lp.connect( g );
		const o = this._osc( 'triangle', t, tt, lp );
		for ( const [ s, d, fr ] of notes ) {

			o.frequency.setValueAtTime( fr, s );
			o.frequency.linearRampToValueAtTime( fr * 0.96, s + d );
			this._env( g.gain, s, d, 0.3, 0.05 );

		}

	}

	// yellow-legged gull, far off over the Várzea (the coast is 10 km away)
	_gull() {

		const t = this.ctx.currentTime + 0.02;
		const n = 2 + Math.floor( Math.random() * 3 );
		const { g } = this._voice( this._around( rand( 80, 200 ), rand( 30, 60 ) ), t + n * 0.45 + 0.2, this.birdBus, 40 );
		const bp = this.ctx.createBiquadFilter();
		bp.type = 'bandpass';
		bp.frequency.value = 1500;
		bp.Q.value = 2;
		bp.connect( g );
		const o = this._osc( 'sawtooth', t, t + n * 0.45 + 0.2, bp );
		for ( let k = 0; k < n; k ++ ) {

			const s = t + k * rand( 0.38, 0.48 ), f = rand( 1100, 1400 );
			o.frequency.setValueAtTime( f, s );
			o.frequency.linearRampToValueAtTime( f * 1.3, s + 0.08 );
			o.frequency.exponentialRampToValueAtTime( f * 0.75, s + 0.32 );
			this._env( g.gain, s, 0.32, 0.25, 0.02 );

		}

	}

	// common swifts, a screaming party sweeping past over the roofs (late April to early August)
	_swifts() {

		const ctx = this.ctx;
		const birds = 2 + Math.floor( Math.random() * 4 );
		const a = Math.random() * Math.PI * 2, l = this._listener;
		const dist = rand( 10, 40 ), len = rand( 60, 120 ), h = rand( 6, 25 );
		const cx = l.x + Math.cos( a ) * dist, cz = l.z + Math.sin( a ) * dist;
		const dx = - Math.sin( a ) * len / 2, dz = Math.cos( a ) * len / 2;
		const T = rand( 2.2, 3.5 );
		for ( let b = 0; b < birds; b ++ ) {

			const t = ctx.currentTime + 0.02 + b * rand( 0.05, 0.3 );
			const { g, p } = this._voice( { x: cx - dx, y: l.y + h, z: cz - dz }, t + T, this.birdBus, 10 );
			if ( p.positionX ) {

				p.positionX.setValueAtTime( cx - dx, t );
				p.positionZ.setValueAtTime( cz - dz, t );
				p.positionX.linearRampToValueAtTime( cx + dx, t + T );
				p.positionZ.linearRampToValueAtTime( cz + dz, t + T );

			}

			const bp = ctx.createBiquadFilter();
			bp.type = 'bandpass';
			bp.frequency.value = rand( 6000, 7500 );
			bp.Q.value = 3;
			const am = ctx.createGain();
			am.gain.value = 0.5;
			bp.connect( am );
			am.connect( g );
			const o = this._osc( 'sawtooth', t, t + T, bp );
			o.frequency.value = rand( 3200, 3800 );
			// the trilled scream: a fast square tremolo (gain 0.5 ± 0.5)
			const depth = ctx.createGain();
			depth.gain.value = 0.5;
			depth.connect( am.gain );
			const trem = this._osc( 'square', t, t + T, depth );
			trem.frequency.value = rand( 35, 55 );
			// a few screams along the pass
			let s = t + rand( 0, 0.4 );
			while ( s < t + T - 0.5 ) {

				const d = rand( 0.3, 0.7 );
				o.frequency.setValueAtTime( rand( 3600, 4200 ), s );
				o.frequency.linearRampToValueAtTime( rand( 2900, 3300 ), s + d );
				this._env( g.gain, s, d, 0.18, 0.03 );
				s += d + rand( 0.1, 0.5 );

			}

		}

	}

	// owls: bouts of calls from one place at night (scops in the warm months, tawny all year)
	_updateOwl( dt, night, warm ) {

		const ctx = this.ctx;
		if ( ! this._owl ) {

			if ( night > 0.8 && Math.random() < 0.012 * dt ) {

				const scops = Math.random() < warm;
				this._owl = { scops, pos: this._around( rand( 40, 140 ), rand( 5, 20 ) ), left: scops ? 6 + Math.floor( Math.random() * 14 ) : 2 + Math.floor( Math.random() * 3 ), next: 0 };

			}

			return;

		}

		const o = this._owl;
		o.next -= dt;
		if ( o.next > 0 ) return;
		if ( night < 0.5 || o.left -- <= 0 ) {

			this._owl = null;
			return;

		}

		const t = ctx.currentTime + 0.02;
		if ( o.scops ) {

			// a single soft "tyoo" every couple of seconds
			const { g } = this._voice( o.pos, t + 0.4, this.nightBus, 25 );
			const osc = this._osc( 'sine', t, t + 0.4, g );
			osc.frequency.setValueAtTime( 1260, t );
			osc.frequency.linearRampToValueAtTime( 1180, t + 0.2 );
			this._env( g.gain, t, 0.2, 0.3, 0.03 );
			o.next = rand( 2.3, 2.8 );

		} else {

			// "hoo ... hu-hoooo"
			const { g } = this._voice( o.pos, t + 2.4, this.nightBus, 25 );
			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = 1200;
			lp.connect( g );
			const osc = this._osc( 'triangle', t, t + 2.4, lp );
			const notes = [ [ t, 0.45, 640, 600 ], [ t + 1.05, 0.12, 560, 600 ], [ t + 1.3, 0.9, 640, 590 ] ];
			for ( const [ s, d, f0, f1 ] of notes ) {

				osc.frequency.setValueAtTime( f0, s );
				osc.frequency.linearRampToValueAtTime( f1, s + d );
				this._env( g.gain, s, d, 0.3, 0.05 );

			}

			o.next = rand( 8, 20 );

		}

	}

	// ---------------------------------------------------------------- footsteps

	// one footfall: surface 'stone' | 'gravel' | 'earth' | 'grass'; gait { sprint, crouch } or a level
	footstep( surface, gait = {} ) {

		if ( ! this.ctx || this.ctx.state !== 'running' ) return;
		let level = 0.55 * rand( 0.85, 1.15 );
		if ( gait.sprint ) level *= 1.45;
		if ( gait.crouch ) level *= 0.4;
		this._step( surface, level, 1 );

	}

	jump( surface ) {

		if ( this.ctx && this.ctx.state === 'running' ) this._step( surface, 0.4, 0.7 );

	}

	// landing after a fall: louder and heavier with the impact speed (m/s)
	land( surface, speed ) {

		if ( ! this.ctx || this.ctx.state !== 'running' ) return;
		const k = smooth( 2, 9, speed );
		this._step( surface, 0.7 + 0.8 * k, 1.4 + k );
		this._step( surface, 0.5 + 0.5 * k, 1.2, 0.045 );

	}

	_step( surface, level, weight, delay = 0 ) {

		const ctx = this.ctx;
		const t = ctx.currentTime + 0.005 + delay;
		const S = {
			// [ band centre, Q, decay (s), grit, thump ]
			stone: [ 2200, 1.1, 0.045, 0.2, 0.9 ],
			gravel: [ 1600, 0.6, 0.11, 0.9, 0.5 ],
			earth: [ 700, 0.7, 0.07, 0.35, 0.8 ],
			grass: [ 2600, 0.4, 0.13, 0.7, 0.35 ],
		}[ surface ] || [ 1200, 0.7, 0.07, 0.4, 0.6 ];
		const [ fc, q, decay, grit, thump ] = S;
		const pitch = rand( 0.88, 1.12 );
		const out = ctx.createGain();
		out.gain.value = level;
		out.connect( this.stepBus );

		// heel, then toe: two bursts of noise through the surface's band
		for ( const [ dt, a ] of [ [ 0, 1 ], [ rand( 0.03, 0.06 ), rand( 0.35, 0.6 ) ] ] ) {

			const n = ctx.createBufferSource();
			n.buffer = this.white;
			n.playbackRate.value = pitch;
			const bp = ctx.createBiquadFilter();
			bp.type = 'bandpass';
			bp.frequency.value = fc * pitch;
			bp.Q.value = q;
			const g = ctx.createGain();
			const s = t + dt, d = decay * ( surface === 'grass' || surface === 'gravel' ? rand( 0.8, 1.3 ) : 1 );
			g.gain.setValueAtTime( 0, s );
			g.gain.linearRampToValueAtTime( a * 0.9, s + 0.003 );
			if ( grit > 0.5 ) {

				// crunch: a ragged envelope of small grains
				let u = s + 0.003;
				while ( u < s + d ) {

					g.gain.setValueAtTime( a * rand( 0.15, 0.9 ) * ( 1 - ( u - s ) / d ), u );
					u += rand( 0.004, 0.012 );

				}

				g.gain.setValueAtTime( 0, s + d );

			} else g.gain.setTargetAtTime( 0, s + 0.004, d / 3 );
			n.connect( bp );
			bp.connect( g );
			g.connect( out );
			n.start( s, Math.random() * 1.8, d + 0.05 );

		}

		// the body of the step: a short low thump
		if ( thump > 0 ) {

			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.setValueAtTime( 140 * pitch, t );
			o.frequency.exponentialRampToValueAtTime( 60, t + 0.06 );
			const g = ctx.createGain();
			g.gain.setValueAtTime( 0, t );
			g.gain.linearRampToValueAtTime( 0.5 * thump * Math.min( 2, weight ), t + 0.004 );
			g.gain.setTargetAtTime( 0, t + 0.01, 0.025 * weight );
			o.connect( g );
			g.connect( out );
			o.start( t );
			o.stop( t + 0.25 );

		}

		setTimeout( () => out.disconnect(), ( delay + 0.6 ) * 1000 );

	}

}
