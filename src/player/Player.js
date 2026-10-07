import * as THREE from '../engine/index.js';
import { WORLD } from '../world/WorldLayout.js';

const EYE = 1.62;
const CROUCH_EYE = 1.05;
const RADIUS = 0.3;
const HEIGHT = 1.75;
const STEP = 0.42; // highest ledge (a stair, a kerb) stepped up onto

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _e = new THREE.Euler( 0, 0, 0, 'YXZ' );

// First-person walker: a capsule on the terrain and the walkable colliders (wall walks, stairs,
// steps), pushed out of the solid ones (houses, towers, merlons). There is no railing on the
// town side of the walls: walk off the edge and you drop into the street.
export class Player {

	constructor( { camera, input, terrain, colliders, audio = null } ) {

		this.camera = camera;
		this.input = input;
		this.terrain = terrain;
		this.colliders = colliders;
		this.audio = audio;

		this.mode = 'walk';
		const start = WORLD.start;
		this.position = new THREE.Vector3().copy( start.position );
		this.position.y = this.groundAt( this.position.x, this.position.z, this.position.y + 50 );
		this.velocity = new THREE.Vector3();
		this.yaw = start.yaw;
		this.pitch = start.pitch ?? - 0.03;
		this.grounded = false;
		this.crouch = 0; // 0 standing .. 1 crouched (eased)
		this.bob = 0;
		this.stepDist = 0;
		// eye height easing (critically damped offset): stairs and drops don't jolt the view
		this.camOff = 0;
		this.camOffV = 0;
		this._camY = null;
		this.prompt = null;
		this.surface = 'stone';

	}

	getViewDir( out ) {

		return out.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );

	}

	groundAt( x, z, maxY ) {

		const g = this.terrain.heightAt( x, z );
		const c = this.colliders.groundHeightAt( x, z, maxY );
		return c > g ? c : g;

	}

	// put the walker at a world position (feet), e.g. leaving the free camera
	placeAt( x, y, z, yaw, pitch ) {

		this.position.set( x, Math.max( y, this.groundAt( x, z, y + 0.5 ) ), z );
		this.velocity.set( 0, 0, 0 );
		this.grounded = false;
		if ( yaw !== undefined ) this.yaw = yaw;
		if ( pitch !== undefined ) this.pitch = THREE.MathUtils.clamp( pitch, - 1.5, 1.5 );

	}

	update( dt ) {

		const inp = this.input;
		this.prompt = null;
		const look = inp.consumeLook();
		this.yaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );

		const prevY = this.position.y;
		this.updateWalk( dt );

		const crouching = inp.down( 'KeyC' ) || inp.down( 'ControlLeft' );
		this.crouch += ( ( crouching ? 1 : 0 ) - this.crouch ) * ( 1 - Math.exp( - dt * 10 ) );
		const eye = this.position.clone();
		eye.y += THREE.MathUtils.lerp( EYE, CROUCH_EYE, this.crouch ) + Math.sin( this.bob ) * 0.035;
		if ( this._camY === null || this.camera.position.y !== this._camY ) {

			// something else drove the camera since our last frame (the free camera): start fresh
			this.camOff = 0;
			this.camOffV = 0;

		} else if ( this.grounded && Math.abs( this.position.y - prevY ) > 0.05 && Math.abs( this.position.y - prevY ) < STEP + 0.05 ) {

			// stepped up or down a stair: the view follows smoothly
			this.camOff -= this.position.y - prevY;

		}

		const w = 14, e = Math.exp( - w * dt ), j = ( this.camOffV + w * this.camOff ) * dt;
		this.camOff = ( this.camOff + j ) * e;
		this.camOffV = ( this.camOffV - w * j ) * e;
		eye.y += this.camOff;
		this.camera.position.copy( eye );
		this._camY = this.camera.position.y;
		this.camera.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, 0 ) );

	}

	updateWalk( dt ) {

		const inp = this.input;
		_fwd.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
		_right.set( - _fwd.z, 0, _fwd.x );
		const wish = new THREE.Vector3();
		if ( inp.down( 'KeyW' ) ) wish.add( _fwd );
		if ( inp.down( 'KeyS' ) ) wish.sub( _fwd );
		if ( inp.down( 'KeyD' ) ) wish.add( _right );
		if ( inp.down( 'KeyA' ) ) wish.sub( _right );
		if ( wish.lengthSq() > 0 ) wish.normalize();

		const sprint = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' );
		const speed = ( sprint ? 6.2 : 3.0 ) * THREE.MathUtils.lerp( 1, 0.45, this.crouch );
		const accel = this.grounded ? 14 : 2.5;
		const k = 1 - Math.exp( - accel * dt );
		this.velocity.x += ( wish.x * speed - this.velocity.x ) * k;
		this.velocity.z += ( wish.z * speed - this.velocity.z ) * k;

		if ( this.grounded && inp.hit( 'Space' ) ) {

			this.velocity.y = 4.6;
			this.grounded = false;

		}

		this.velocity.y -= 9.81 * dt;

		const p = this.position;
		const old = p.clone();
		p.addScaledVector( this.velocity, dt );
		this.colliders.resolveCapsule( p, RADIUS, HEIGHT, STEP );
		const g = this.groundAt( p.x, p.z, p.y + STEP + 0.05 );
		if ( p.y <= g ) {

			p.y = g;
			if ( this.velocity.y < 0 ) this.velocity.y = 0;
			this.grounded = true;

		} else {

			// stick to the ground walking down stairs and slopes (a small drop is a step, not a fall)
			const drop = p.y - g;
			if ( this.grounded && this.velocity.y <= 0 && drop < STEP ) p.y = g;
			else this.grounded = drop < 0.06;

		}

		// head bob + footsteps
		const moved = Math.hypot( p.x - old.x, p.z - old.z );
		if ( this.grounded ) {

			this.bob += moved * 2.4;
			this.stepDist += moved;
			const stride = sprint ? 0.9 : 0.62;
			if ( this.stepDist > stride ) {

				this.stepDist = 0;
				if ( this.audio && this.audio.footstep ) this.audio.footstep( this.surface );

			}

		}

	}

}
