import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Matrix4, Vector3, Vector4 } from '../engine/math/index.js';

// The scene camera (unjittered) for the full-screen post passes: view rays and view depth from the
// reversed-Z depth buffer. (What remains of tidewater's Underwater module once the sea is gone.)
//
// WGSL (this.module, prefix `camRay`):
//   fn camRayViewZ( d: f32 ) -> f32            reversed-Z depth -> view Z (negative)
//   fn camRayViewRay( uv: vec2f ) -> vec3f     view-space ray (z = -1)
//   fn camRayWorldDir( uv: vec2f ) -> vec3f
// Uniforms: camRayParams { camWorld, camPos, lensDistance, proj (p00, p11, near, far) }.
export class CameraRays {

	constructor() {

		this.uniforms = new UniformBlock( 'CamRayParams', {
			camWorld: [ 'mat4x4f', new Matrix4() ],
			camPos: [ 'vec3f', new Vector3() ],
			lensDistance: [ 'f32', 0.1 ], // = camera.near
			proj: [ 'vec4f', new Vector4( 1, 1, 0.1, 1000 ) ], // p00, p11, near, far
		}, { label: 'camRay' } );
		const U = this.uniforms.fields;
		this.camPos = U.camPos;
		this.camWorld = U.camWorld;
		this.proj = U.proj;
		this.lensDistance = U.lensDistance;
		this.module = new ShaderModule( {
			name: 'camRay',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			uniformName: 'camRayParams',
			code: /* wgsl */`
fn camRayViewZ( d: f32 ) -> f32 {
	let n = camRayParams.proj.z; let f = camRayParams.proj.w;
	return n * f / ( ( n - f ) * d - n );
}

fn camRayViewRay( uv: vec2f ) -> vec3f {
	let ndc = vec2f( uv.x * 2.0 - 1.0, ( 1.0 - uv.y ) * 2.0 - 1.0 );
	return vec3f( ndc.x / camRayParams.proj.x, ndc.y / camRayParams.proj.y, -1.0 );
}

fn camRayWorldDir( uv: vec2f ) -> vec3f {
	return normalize( ( camRayParams.camWorld * vec4f( camRayViewRay( uv ), 0.0 ) ).xyz );
}
`,
		} );

	}

	updateCamera( camera ) {

		camera.updateMatrixWorld();
		this.camPos.value.setFromMatrixPosition( camera.matrixWorld );
		this.camWorld.value.copy( camera.matrixWorld );
		const e = camera.projectionMatrix.elements;
		this.proj.value.set( e[ 0 ], e[ 5 ], camera.near, camera.far );
		this.lensDistance.value = camera.near;

	}

}
