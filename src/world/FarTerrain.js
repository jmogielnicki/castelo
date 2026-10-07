import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Mesh } from '../engine/index.js';
import { standard } from '../materials/Materials.js';
import { terrainShadingModule, srgb } from './terrain/TerrainShading.js';
import { groundShadingModule } from './terrain/GroundShading.js';
import { sampleGrid, sampleGridLinear } from './obidos/Geo.js';

const N = 360; // vertices per side
const R = 24000; // m: half extent
const C = 3600; // spacing law x = sign(u) (C |u| + (R - C) |u|^3): ~20 m at the centre, ~360 m at the rim
const SEA = 0.8; // m: at or below this the DEM is sea / lagoon

// The land beyond the 2 km heightmap: one static mesh over 48 km of the Copernicus DEM with spacing
// that grows with the distance from the town (the near terrain covers the middle; vertices under it
// are pushed down so it always wins). The horizon from the walls: the Várzea and the low hills
// around it to the east and south, Serra d'El-Rei to the north-west, and the Atlantic and the
// Lagoa de Óbidos to the west and north-west (flat, glossy water at sea level).
//
// Per-vertex data (landData): x = slope, y = water, z = farmland, w = scrub. The surface reuses the
// near terrain's field patchwork and scrub (GroundShading), at the distances it is seen from.
export class FarTerrain {

	constructor( { scene, dem, nearHalf = 1024 } ) {

		const map = ( u ) => Math.sign( u ) * ( C * Math.abs( u ) + ( R - C ) * Math.abs( u ) ** 3 );
		const xs = new Float64Array( N );
		for ( let i = 0; i < N; i ++ ) xs[ i ] = map( - 1 + 2 * i / ( N - 1 ) );
		const h = ( x, z ) => ( Math.abs( x ) < dem.near.half - 30 && Math.abs( z ) < dem.near.half - 30 ) ? sampleGrid( dem.near, x, z ) : sampleGridLinear( dem.far, x, z );

		const pos = new Float32Array( N * N * 3 ), nrm = new Float32Array( N * N * 3 ), land = new Float32Array( N * N * 4 );
		const hs = new Float32Array( N * N );
		for ( let j = 0; j < N; j ++ ) for ( let i = 0; i < N; i ++ ) hs[ j * N + i ] = h( xs[ i ], xs[ j ] );
		const inner = nearHalf - 6;
		for ( let j = 0; j < N; j ++ ) for ( let i = 0; i < N; i ++ ) {

			const k = j * N + i;
			const x = xs[ i ], z = xs[ j ];
			let y = hs[ k ];
			const water = y <= SEA ? 1 : 0;
			if ( water ) y = 0;
			// under the near terrain: tucked away below it
			if ( Math.abs( x ) < inner && Math.abs( z ) < inner ) y -= 6;
			pos[ k * 3 ] = x; pos[ k * 3 + 1 ] = y; pos[ k * 3 + 2 ] = z;
			const i0 = Math.max( 0, i - 1 ), i1 = Math.min( N - 1, i + 1 ), j0 = Math.max( 0, j - 1 ), j1 = Math.min( N - 1, j + 1 );
			const gx = ( hs[ j * N + i1 ] - hs[ j * N + i0 ] ) / ( xs[ i1 ] - xs[ i0 ] );
			const gz = ( hs[ j1 * N + i ] - hs[ j0 * N + i ] ) / ( xs[ j1 ] - xs[ j0 ] );
			const il = 1 / Math.hypot( gx, 1, gz );
			nrm[ k * 3 ] = water ? 0 : - gx * il; nrm[ k * 3 + 1 ] = water ? 1 : il; nrm[ k * 3 + 2 ] = water ? 0 : - gz * il;
			const slope = Math.hypot( gx, gz );
			// cultivated: the flat lowland; scrub and pine woods: the slopes and the higher hills
			const farm = clamp01( ( 0.14 - slope ) / 0.08 ) * clamp01( ( 140 - y ) / 60 );
			const scrub = clamp01( ( slope - 0.1 ) / 0.12 + ( y - 120 ) / 120 );
			land[ k * 4 ] = slope; land[ k * 4 + 1 ] = water; land[ k * 4 + 2 ] = farm; land[ k * 4 + 3 ] = scrub;

		}

		// cells entirely inside the near terrain are skipped
		const idx = [];
		for ( let j = 0; j < N - 1; j ++ ) for ( let i = 0; i < N - 1; i ++ ) {

			const x0 = xs[ i ], x1 = xs[ i + 1 ], z0 = xs[ j ], z1 = xs[ j + 1 ];
			if ( x0 > - inner && x1 < inner && z0 > - inner && z1 < inner ) continue;
			const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
			idx.push( a, c, b, b, c, d );

		}

		const g = new BufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
		g.setAttribute( 'normal', new Float32BufferAttribute( nrm, 3 ) );
		g.setAttribute( 'landData', new Float32BufferAttribute( land, 4 ) );
		g.setIndex( new Uint32BufferAttribute( new Uint32Array( idx ), 1 ) );
		g.computeBoundingBox();
		g.computeBoundingSphere();

		const mat = this.material = standard( {
			name: 'FarTerrain',
			roughness: 0.92, metalness: 0,
			attributes: { landData: 'vec4f' },
			varyings: { vLand: 'vec4f' },
			vertex: 'o.vLand = v.landData;',
		} );
		mat.modules = [ terrainShadingModule(), groundShadingModule() ];
		mat.surface = FAR_SURFACE;
		mat.localLightsCheap = true;

		this.mesh = new Mesh( g, mat );
		this.mesh.name = 'FarTerrain';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.staticVelocity = true;
		scene.add( this.mesh );
		this.triangles = idx.length / 3;

	}

	update() {}

}

const clamp01 = ( v ) => v < 0 ? 0 : v > 1 ? 1 : v;

const S = srgb;

const FAR_SURFACE = /* wgsl */`
	let p = in.P;
	let xz = p.xz;
	let L = in.vs.vLand;
	let dpx = dpdx( p ); let dpy = dpdy( p );
	let px = max( length( dpx ), length( dpy ) );
	let mA = textureSampleLevel( terrainDetailTex, smpLinearRepeat, xz / 1730.0, 0.0 ).w;
	let mB = textureSampleLevel( terrainDetailTex, smpLinearRepeat, xz / 470.0 + 0.3, 0.0 ).w;
	let mcr = mA * 0.6 + mB * 0.4;
	groundNdV = sat( dot( in.N, normalize( frame.cameraPos - p ) ) );
	var col = groundDryGrass( mcr, mB, L.x );
	let farmW = smoothstep( 0.3, 0.7, L.z + ( mB - 0.5 ) * 0.4 );
	if ( farmW > 0.0 ) {
		col = mix( col, groundFarm( xz, px, mcr ).rgb, farmW );
	}
	let scrubW = smoothstep( 0.3, 0.7, L.w + ( mA - 0.5 ) * 0.5 );
	if ( scrubW > 0.0 ) {
		// pine and eucalyptus woods on the hills: darker than the scrub near town
		let sc = groundScrub( xz * 0.25, px, mcr, mB ).rgb;
		col = mix( col, sc * 0.8, scrubW );
	}
	var rough = 0.92;
	var N = in.N;
	// sea and lagoon: dark water, glossy (the environment and the sun give the glint)
	let water = smoothstep( 0.4, 0.9, L.y );
	col = mix( col, ${ S( 0.05, 0.08, 0.1 ) }, water );
	rough = mix( rough, 0.06, water );
	N = normalize( mix( N, vec3f( 0.0, 1.0, 0.0 ), water ) );
	s.albedo = col;
	s.roughness = rough;
	s.normal = N;
	s.ao = 1.0;
`;
