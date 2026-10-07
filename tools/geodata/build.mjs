// Converts the raw geodata (tools/geodata/fetch.sh) into the game's local frame:
//   public/data/dem-near.bin   Int16 decimetres, NEAR_N x NEAR_N samples, NEAR_STEP m apart, centred on the origin
//   public/data/dem-far.bin    Int16 decimetres, FAR_N x FAR_N samples, FAR_STEP m apart (box-filtered)
//   src/world/obidos/osm.json  walls, towers, gates, buildings, streets, landuse, trees as local polylines
// Local frame (WorldLayout): x east, z south (north = -z), metres from ORIGIN (the centre of the walls'
// bounding box). Heights are the Copernicus DSM (surface model: it includes roofs and tree tops).
//   node tools/geodata/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';

const HERE = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT = path.resolve( HERE, '../..' );
const RAW = path.join( HERE, 'raw' );

export const ORIGIN = { lat: 39.3615849, lon: - 9.1572126 };
const NEAR_STEP = 10, NEAR_HALF = 1300; // m
const FAR_STEP = 60, FAR_HALF = 24000; // m

// metres per degree at the origin (WGS84 series)
const phi = ORIGIN.lat * Math.PI / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos( 2 * phi ) + 1.175 * Math.cos( 4 * phi );
const M_LON = 111412.84 * Math.cos( phi ) - 93.5 * Math.cos( 3 * phi );
const toLocal = ( lat, lon ) => [ ( lon - ORIGIN.lon ) * M_LON, - ( lat - ORIGIN.lat ) * M_LAT ];
const toGeo = ( x, z ) => [ ORIGIN.lat - z / M_LAT, ORIGIN.lon + x / M_LON ];

// ---------------------------------------------------------------- DEM

async function loadTiles() {

	const tiles = [];
	for ( const f of fs.readdirSync( RAW ).filter( ( f ) => f.startsWith( 'cop30_' ) && f.endsWith( '.tif' ) ) ) {

		const img = await ( await fromFile( path.join( RAW, f ) ) ).getImage();
		const [ x0, y0, x1, y1 ] = img.getBoundingBox();
		const data = ( await img.readRasters() )[ 0 ];
		tiles.push( { x0, y0, x1, y1, w: img.getWidth(), h: img.getHeight(), data } );

	}

	return tiles;

}

function makeSampler( tiles ) {

	// pixel-is-area grid: centre of pixel (i, j) at x0 + (i + 0.5) / w * (x1 - x0)
	const at = ( lat, lon ) => {

		for ( const t of tiles ) {

			if ( lon < t.x0 || lon >= t.x1 || lat < t.y0 || lat >= t.y1 ) continue;
			const fx = ( lon - t.x0 ) / ( t.x1 - t.x0 ) * t.w - 0.5;
			const fy = ( t.y1 - lat ) / ( t.y1 - t.y0 ) * t.h - 0.5;
			return { t, fx, fy };

		}

		return null;

	};

	const px = ( t, i, j ) => t.data[ Math.min( t.h - 1, Math.max( 0, j ) ) * t.w + Math.min( t.w - 1, Math.max( 0, i ) ) ];
	// Catmull-Rom bicubic
	const cr = ( p0, p1, p2, p3, t ) => p1 + 0.5 * t * ( p2 - p0 + t * ( 2 * p0 - 5 * p1 + 4 * p2 - p3 + t * ( 3 * ( p1 - p2 ) + p3 - p0 ) ) );
	return ( lat, lon ) => {

		const s = at( lat, lon );
		if ( ! s ) return 0;
		const { t, fx, fy } = s;
		const i = Math.floor( fx ), j = Math.floor( fy ), tx = fx - i, ty = fy - j;
		const row = ( jj ) => cr( px( t, i - 1, jj ), px( t, i, jj ), px( t, i + 1, jj ), px( t, i + 2, jj ), tx );
		return cr( row( j - 1 ), row( j ), row( j + 1 ), row( j + 2 ), ty );

	};

}

function writeGrid( file, n, step, fn ) {

	const out = new Int16Array( n * n );
	const half = ( n - 1 ) / 2 * step;
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		const h = fn( - half + i * step, - half + j * step );
		out[ j * n + i ] = Math.max( - 32000, Math.min( 32000, Math.round( h * 10 ) ) );

	}

	fs.writeFileSync( file, Buffer.from( out.buffer ) );
	return out;

}

// ---------------------------------------------------------------- OSM

function convertOSM() {

	const osm = JSON.parse( fs.readFileSync( path.join( RAW, 'obidos-osm.json' ) ) );
	const nodes = new Map(), ways = new Map();
	for ( const e of osm.elements ) {

		if ( e.type === 'node' ) nodes.set( e.id, e );
		else if ( e.type === 'way' ) ways.set( e.id, e );

	}

	const r1 = ( v ) => Math.round( v * 10 ) / 10;
	const pts = ( w ) => w.nodes.map( ( id ) => nodes.get( id ) ).filter( Boolean ).map( ( n ) => toLocal( n.lat, n.lon ).map( r1 ) );
	const pick = ( t, keys ) => {

		const o = {};
		for ( const k of keys ) if ( t[ k ] !== undefined ) o[ k ] = t[ k ];
		return o;

	};

	const out = { origin: ORIGIN, walls: [], towers: [], gates: [], buildings: [], streets: [], landuse: [], barriers: [], trees: [], pois: [] };
	const TAGS = [ 'name', 'building', 'building:levels', 'roof:shape', 'roof:levels', 'amenity', 'historic', 'man_made', 'tower:type', 'height', 'denomination', 'shop', 'tourism' ];
	for ( const w of ways.values() ) {

		const t = w.tags;
		if ( ! t ) continue;
		const p = pts( w );
		if ( p.length < 2 ) continue;
		const closed = w.nodes[ 0 ] === w.nodes[ w.nodes.length - 1 ];
		if ( t.barrier === 'city_wall' ) out.walls.push( { id: w.id, closed, pts: p, ...pick( t, [ 'name', 'defensive_works', 'two_sided' ] ) } );
		else if ( t.man_made === 'tower' && t[ 'tower:type' ] === 'defensive' ) out.towers.push( { id: w.id, pts: p, ...pick( t, TAGS ) } );
		else if ( t.historic === 'city_gate' ) out.gates.push( { id: w.id, pts: p, ...pick( t, TAGS ) } );
		else if ( t.building ) out.buildings.push( { id: w.id, pts: p, ...pick( t, TAGS ) } );
		else if ( t.highway ) out.streets.push( { id: w.id, pts: p, highway: t.highway, ...pick( t, [ 'name', 'surface', 'width', 'tunnel', 'layer', 'incline', 'step_count' ] ) } );
		else if ( t.landuse || t.natural || t.leisure ) out.landuse.push( { id: w.id, closed, pts: p, kind: t.landuse || t.natural || t.leisure } );
		else if ( t.barrier ) out.barriers.push( { id: w.id, pts: p, kind: t.barrier } );

	}

	for ( const n of nodes.values() ) {

		const t = n.tags;
		if ( ! t ) continue;
		const [ x, z ] = toLocal( n.lat, n.lon ).map( r1 );
		if ( t.natural === 'tree' ) out.trees.push( [ x, z ] );
		else if ( t.historic || t.amenity ) out.pois.push( { x, z, ...pick( t, [ 'name', 'historic', 'amenity' ] ) } );

	}

	return out;

}

// ---------------------------------------------------------------- main

const tiles = await loadTiles();
const sample = makeSampler( tiles );
const at = ( x, z ) => sample( ...toGeo( x, z ) );

const nearN = Math.round( 2 * NEAR_HALF / NEAR_STEP ) + 1;
writeGrid( path.join( ROOT, 'public/data/dem-near.bin' ), nearN, NEAR_STEP, at );

// far grid: box filter over the sample footprint (5 x 5 taps of the 30 m DEM per 60 m cell)
const farN = Math.round( 2 * FAR_HALF / FAR_STEP ) + 1;
writeGrid( path.join( ROOT, 'public/data/dem-far.bin' ), farN, FAR_STEP, ( x, z ) => {

	let s = 0;
	for ( let b = - 2; b <= 2; b ++ ) for ( let a = - 2; a <= 2; a ++ ) s += at( x + a * FAR_STEP / 5, z + b * FAR_STEP / 5 );
	return s / 25;

} );

const osm = convertOSM();
fs.mkdirSync( path.join( ROOT, 'src/world/obidos' ), { recursive: true } );
fs.writeFileSync( path.join( ROOT, 'src/world/obidos/osm.json' ), JSON.stringify( osm ) );
fs.writeFileSync( path.join( ROOT, 'public/data/dem.json' ), JSON.stringify( {
	origin: ORIGIN,
	near: { n: nearN, step: NEAR_STEP, file: 'dem-near.bin' },
	far: { n: farN, step: FAR_STEP, file: 'dem-far.bin' },
	units: 'int16 decimetres, row-major, row 0 = north (z = -half), column 0 = west (x = -half)',
}, null, '\t' ) );
console.log( `near ${ nearN }^2, far ${ farN }^2; osm: ${ Object.entries( osm ).filter( ( [ , v ] ) => Array.isArray( v ) ).map( ( [ k, v ] ) => `${ k } ${ v.length }` ).join( ', ' ) }` );
