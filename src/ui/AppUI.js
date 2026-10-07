import * as THREE from '../engine/index.js';
import { UI } from './UI.js';
import { G } from '../core/Globals.js';
import { GroundBounce } from '../materials/GroundBounce.js';

// Binds the Castelo UI (panel + HUD) to the running app.
export class AppUI {

	constructor( app, ui = new UI() ) {

		this.app = app;
		this.ui = ui;

		// ---- plain values the controls bind to; onChange pushes them into the simulation
		const s = this.s = {
			time: app.settings.timeOfDay,
			advance: app.settings.timeSpeed !== 0,
			timeSpeed: app.settings.timeSpeed || 0.05,
			clouds: app.clouds ? app.clouds.coverage.value : 0.45,
			cirrus: app.clouds && app.clouds.cirrus ? app.clouds.cirrus.value : 0.5,
			exposure: 0,
			fov: app.camera.fov,
			camMode: 'third',
			ao: app.post.params.aoStrength.value,
			bloom: app.post.params.bloom.value,
			flare: app.post.flare ? app.post.flare.strength.value : 1,
			vignette: app.post.params.vignette.value,
			saturation: app.post.params.saturation.value,
			contrast: app.post.params.contrast.value,
			grain: app.post.params.grain.value,
			renderScale: app.settings.renderScale,
			shadows: true,
		};

		// ---------------------------------------------------------------- Sky
		const sky = ui.addTab( 'sky', 'Sky', 'sky' );
		const sun = sky.addFolder( 'Sun', { icon: 'clock' } );
		sun.addTimeOfDay( { object: app.settings, key: 'timeOfDay' } );
		sun.addSlider( { label: 'Day of year', object: app.settings, key: 'dayOfYear', min: 1, max: 365, step: 1, format: dayLabel, tooltip: 'The season: the sun sets north of west in summer (over the Várzea from the west wall) and south of west in winter.' } );
		sun.addSlider( { label: 'Sun azimuth', object: app.settings, key: 'sunAzimuth', min: - 180, max: 180, step: 1, format: ( v ) => `${ Math.round( v ) }°`, tooltip: 'Turns the sun\'s path around the town (0 = the real path at Óbidos).' } );
		let speed = null;
		sun.addToggle( { label: 'Advance time', object: s, key: 'advance', onChange: ( v ) => {

			app.settings.timeSpeed = v ? s.timeSpeed : 0;
			speed.setVisible( v );

		} } );
		speed = sun.addSlider( { label: 'Time speed', object: s, key: 'timeSpeed', min: 0.002, max: 1, log: true, unit: 'h/s', onChange: ( v ) => { if ( s.advance ) app.settings.timeSpeed = v; } } ).setVisible( s.advance );
		const atmo = sky.addFolder( 'Atmosphere', { icon: 'cloud' } );
		if ( app.clouds ) atmo.addSlider( { label: 'Cloud cover', object: s, key: 'clouds', min: 0, max: 1, step: 0.01, format: ( v ) => `${ Math.round( v * 100 ) }%`, onChange: ( v ) => { app.clouds.coverage.value = v; } } );
		if ( app.clouds && app.clouds.cirrus ) atmo.addSlider( { label: 'Cirrus', object: s, key: 'cirrus', min: 0, max: 1, step: 0.01, format: ( v ) => `${ Math.round( v * 100 ) }%`, onChange: ( v ) => { app.clouds.cirrus.value = v; } } );
		if ( app.haze ) {

			s.haze = app.haze.density.value;
			s.shafts = app.haze.shafts.value;
			atmo.addSlider( { label: 'Haze', object: s, key: 'haze', min: 0, max: 4, step: 0.05, tooltip: 'Aerial perspective and haze density (1 = about 20 km visibility, 0 = clear air).', onChange: ( v ) => { app.haze.density.value = v; } } );
			atmo.addSlider( { label: 'Sun shafts', object: s, key: 'shafts', min: 0, max: 3, step: 0.05, tooltip: 'Volumetric light shafts and crepuscular rays in the haze (shadows of towers, walls, hills and clouds). 0 turns them off.', onChange: ( v ) => { app.haze.shafts.value = v; } } );

		}
		if ( app.airMotes ) {

			s.air = app.airMotes.intensity.value;
			atmo.addSlider( { label: 'Air particles', object: s, key: 'air', min: 0, max: 2, step: 0.01, tooltip: 'Dust, pollen, seed fluff and the odd gnat drifting in the air: they catch the light when backlit by the sun. 0 turns them off.', onChange: ( v ) => { app.airMotes.intensity.value = v; } } );

		}

		atmo.addSlider( { label: 'Exposure', object: s, key: 'exposure', min: - 3, max: 3, step: 0.1, unit: 'EV', onChange: ( v ) => { app.settings.exposure = 0.55 * Math.pow( 2, v ); } } );

		// ---------------------------------------------------------------- Camera
		const cam = ui.addTab( 'camera', 'Camera', 'camera' );
		const view = cam.addFolder( 'View', { icon: 'camera' } );
		view.addSlider( { label: 'Field of view', object: s, key: 'fov', min: 35, max: 100, step: 1, unit: '°', onChange: ( v ) => {

			app.camera.fov = v;
			app.camera.updateProjectionMatrix();

		} } );
		view.addButton( { label: 'Free camera (F)', icon: 'camera', onClick: () => app.setFreeCam( ! app.freeCam ) } );

		// ---------------------------------------------------------------- Effects
		const fx = ui.addTab( 'effects', 'Effects', 'effects' );
		const post = fx.addFolder( 'Post-processing', { icon: 'sparkles' } );
		const P = app.post.params;
		post.addSlider( { label: 'Ambient occlusion', object: s, key: 'ao', min: 0, max: 1.5, step: 0.01, onChange: ( v ) => { P.aoStrength.value = v; } } );
		s.bounce = GroundBounce.strength.value;
		post.addSlider( { label: 'Bounce light', object: s, key: 'bounce', min: 0, max: 2, step: 0.01, tooltip: 'Sunlight reflected off the ground onto undersides and shaded faces: eaves, arches, the shady side of a street. 0 = off.', onChange: ( v ) => { GroundBounce.strength.value = v; } } );
		s.sharpen = P.sharpen.value;
		post.addSlider( { label: 'Sharpen', object: s, key: 'sharpen', min: 0, max: 1, step: 0.01, tooltip: 'Contrast-adaptive sharpening after the temporal anti-aliasing.', onChange: ( v ) => { P.sharpen.value = v; } } );
		if ( app.post.motionBlur ) {

			const mb = app.post.motionBlur.shutter;
			s.motionBlur = mb.value;
			post.addSlider( { label: 'Motion blur', object: s, key: 'motionBlur', min: 0, max: 1, step: 0.05, format: ( v ) => v > 0 ? `${ Math.round( v * 360 ) }°` : 'Off', tooltip: 'Camera and object motion blur, as a shutter angle (180° = film look). 0 turns it off.', onChange: ( v ) => { mb.value = v; } } );

		}

		post.addSlider( { label: 'Bloom', object: s, key: 'bloom', min: 0, max: 0.3, step: 0.005, onChange: ( v ) => { P.bloom.value = v; } } );
		if ( app.post.flare ) post.addSlider( { label: 'Lens flare', object: s, key: 'flare', min: 0, max: 2, step: 0.05, onChange: ( v ) => { app.post.flare.strength.value = v; } } );
		post.addSlider( { label: 'Saturation', object: s, key: 'saturation', min: 0.5, max: 1.5, step: 0.01, onChange: ( v ) => { P.saturation.value = v; } } );
		post.addSlider( { label: 'Contrast', object: s, key: 'contrast', min: 0.8, max: 1.3, step: 0.01, onChange: ( v ) => { P.contrast.value = v; } } );
		post.addSlider( { label: 'Vignette', object: s, key: 'vignette', min: 0, max: 1, step: 0.01, onChange: ( v ) => { P.vignette.value = v; } } );
		post.addSlider( { label: 'Film grain', object: s, key: 'grain', min: 0, max: 0.06, step: 0.001, onChange: ( v ) => { P.grain.value = v; } } );

		// ---------------------------------------------------------------- Sound
		if ( app.audio ) {

			const A = app.audio, set = A.settings;
			const snd = ui.addTab( 'sound', 'Sound', 'sound' );
			const mix = snd.addFolder( 'Sound', { icon: 'volume' } );
			const pct = ( v ) => `${ Math.round( v * 100 ) }%`;
			mix.addToggle( { label: 'Mute (M)', object: set, key: 'muted', onChange: () => A.apply() } );
			mix.addSlider( { label: 'Volume', object: set, key: 'volume', min: 0, max: 1, step: 0.01, format: pct, onChange: () => A.apply() } );
			mix.addSlider( { label: 'Wind', object: set, key: 'wind', min: 0, max: 2, step: 0.01, format: pct, tooltip: 'The breeze: gusty on the walls and outside the town, quieter in the narrow streets.', onChange: () => A.apply() } );
			mix.addSlider( { label: 'Birds', object: set, key: 'birds', min: 0, max: 2, step: 0.01, format: pct, tooltip: 'Sparrows, blackbirds and the odd gull by day; swifts in summer. The dawn and dusk choruses are busier. Crickets at night.', onChange: () => A.apply() } );
			mix.addSlider( { label: 'Footsteps', object: set, key: 'steps', min: 0, max: 2, step: 0.01, format: pct, tooltip: 'Steps on stone, cobbles, gravel, earth and grass; jumps and landings.', onChange: () => A.apply() } );

		}

		// ---------------------------------------------------------------- Performance
		const perf = ui.addTab( 'performance', 'Performance', 'performance' );
		const live = perf.addFolder( 'Live', { icon: 'gauge' } );
		live.addInfo( { label: 'Frame rate', get: () => `${ ( app.fps || 0 ).toFixed( 0 ) } fps` } );
		live.addInfo( { label: 'CPU per frame', get: () => `${ ( app.cpuMs || 0 ).toFixed( 2 ) } ms` } );
		live.addInfo( { label: 'Render size', get: () => `${ app.sceneRenderer.width } × ${ app.sceneRenderer.height }` } );
		const quality = perf.addFolder( 'Quality', { icon: 'layers' } );
		quality.addSlider( { label: 'Render scale', object: s, key: 'renderScale', min: 0.5, max: 1, step: 0.05, format: ( v ) => `${ Math.round( v * 100 ) }%`, tooltip: 'Internal resolution; the temporal upscaler reconstructs the full output resolution.', onChange: ( v ) => app.setRenderScale( v ) } );
		// anti-aliasing: the TAA with 2..16 jitter positions averaged per pixel, or none
		s.aa = app.post.aaMode === 'none' ? 0 : app.post.taau.jitterPhaseOverride;
		quality.addSelect( { label: 'Anti-aliasing', object: s, key: 'aa', tooltip: 'Temporal anti-aliasing: each pixel averages this many sub-pixel sample positions over successive frames (it also smooths dithered fades and shadow noise). More samples cost nothing per frame but take a few more frames to settle.', options: [ { label: 'Off', value: 0 }, { label: '2x', value: 2 }, { label: '4x', value: 4 }, { label: '8x', value: 8 }, { label: '16x', value: 16 } ], onChange: ( v ) => {

			const n = Number( v );
			app.post.aaMode = n > 0 ? 'taa' : 'none';
			if ( n > 0 ) app.post.taau.jitterPhaseOverride = n;

		} } );
		quality.addToggle( { label: 'Shadows', object: s, key: 'shadows', onChange: ( v ) => { app.shadows.enabled = v; } } );
		this._t = 0;

	}

	// per-frame HUD
	update( dt ) {

		const app = this.app;
		const ui = this.ui;
		ui.setStats( { fps: app.fps, frameMs: dt * 1000 } );
		this.s.renderScale = app.post.scale;
		this.s.time = app.settings.timeOfDay;
		if ( app.freeCam ) {

			ui.setMode( 'Free camera' );
			ui.setPrompt( 'F', 'Walk' );
			return;

		}

		ui.setMode( app.player.onWall ? 'On the walls' : 'Walking' );
		if ( app.player.prompt ) ui.setPrompt( app.player.prompt.key, app.player.prompt.text );
		else ui.setPrompt( null );

	}

}

const MONTHS = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
const DAYS = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

function dayLabel( d ) {

	let day = Math.round( d ), m = 0;
	while ( m < 11 && day > DAYS[ m ] ) day -= DAYS[ m ++ ];
	return `${ day } ${ MONTHS[ m ] }`;

}
