import { Vector3 } from '../engine/math/index.js';

// Named review cameras used to check every change from the same set of angles.
// window.__view( name ) jumps there; window.__views lists them.
// p[1] is metres above the ground (terrain or a wall walk) when agl is set.
export const VIEWS = {
	gate: { p: [ - 49.5, 1.65, 214 ], agl: true, yaw: - 0.1, pitch: - 0.02, time: 17.6 },
	street: { p: [ - 30, 1.65, 60 ], agl: true, yaw: - 0.05, pitch: 0.02, time: 15.5 },
	westWall: { p: [ - 66, 1.65, - 60 ], agl: true, yaw: Math.PI * 0.5, pitch: - 0.05, time: 17.9 },
	westWallN: { p: [ - 64, 1.65, - 60 ], agl: true, yaw: 0.05, pitch: - 0.08, time: 17.9 },
	castle: { p: [ - 20, 1.65, - 140 ], agl: true, yaw: - 0.3, pitch: 0.12, time: 16.5 },
	aerial: { p: [ - 380, 230, 520 ], yaw: - 0.62, pitch: - 0.38, time: 16.0 },
	aerialEast: { p: [ 520, 260, - 60 ], yaw: Math.PI * 0.5, pitch: - 0.42, time: 15.0 },
	plain: { p: [ - 620, 1.8, - 40 ], agl: true, yaw: - Math.PI * 0.5, pitch: 0.06, time: 17.2 },
	sunset: { p: [ - 66, 1.65, - 60 ], agl: true, yaw: 1.75, pitch: 0.02, time: 18.15 },
	noon: { p: [ - 380, 230, 520 ], yaw: - 0.62, pitch: - 0.38, time: 12.5 },
};

export function installDebugViews( app ) {

	window.__views = Object.keys( VIEWS );
	// the current camera as a VIEWS entry (paste it back as a named view): __pose()
	window.__pose = () => {

		const c = app.camera, e = new Vector3().setFromMatrixColumn( c.matrixWorld, 2 ).negate();
		const r = ( v ) => Math.round( v * 100 ) / 100;
		return JSON.stringify( { p: [ r( c.position.x ), r( c.position.y ), r( c.position.z ) ], yaw: r( Math.atan2( - e.x, - e.z ) ), pitch: r( Math.asin( e.y ) ), time: r( app.settings.timeOfDay ) } );

	};
	window.__view = ( name ) => {

		const v = VIEWS[ name ];
		if ( ! v ) return 'unknown view';
		if ( v.time !== undefined ) app.settings.timeOfDay = v.time;
		if ( app.setFreeCam ) app.setFreeCam( true );
		app.fly.setPose( viewPosition( app, v ), v.yaw, v.pitch );
		app.fly.velocity.set( 0, 0, 0 );
		return name;

	};

}

// a view's camera position (agl views: above the ground or the walls there)
export function viewPosition( app, v ) {

	const p = new Vector3( ...v.p );
	if ( v.agl ) {

		const g = app.player ? app.player.groundAt( p.x, p.z, 1e4 ) : app.terrainData.heightAt( p.x, p.z );
		p.y += g;

	}

	return p;

}
