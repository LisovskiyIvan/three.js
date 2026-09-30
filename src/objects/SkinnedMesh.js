import { Mesh } from './Mesh.js';
import { Box3 } from '../math/Box3.js';
import { Matrix4 } from '../math/Matrix4.js';
import { Sphere } from '../math/Sphere.js';
import { Vector3 } from '../math/Vector3.js';
import { Vector4 } from '../math/Vector4.js';
import { Ray } from '../math/Ray.js';
import { AttachedBindMode, DetachedBindMode } from '../constants.js';
import { warn } from '../utils.js';

const _baseVector = /*@__PURE__*/ new Vector4();

const _skinIndex = /*@__PURE__*/ new Vector4();
const _skinWeight = /*@__PURE__*/ new Vector4();

const _vector4 = /*@__PURE__*/ new Vector4();
const _matrix4 = /*@__PURE__*/ new Matrix4();
const _vertex = /*@__PURE__*/ new Vector3();

const _sphere = /*@__PURE__*/ new Sphere();
const _inverseMatrix = /*@__PURE__*/ new Matrix4();
const _ray = /*@__PURE__*/ new Ray();

/**
 * A mesh that has a {@link Skeleton} that can then be used to animate the
 * vertices of the geometry with skinning/skeleton animation.
 *
 * Next to a valid skeleton, the skinned mesh requires skin indices and weights
 * as buffer attributes in its geometry. These attribute define which bones affect a single
 * vertex to a certain extend.
 *
 * Typically skinned meshes are not created manually but loaders like {@link GLTFLoader}
 * or {@link FBXLoader } import respective models.
 *
 * @augments Mesh
 * @demo scenes/bones-browser.html
 */
class SkinnedMesh extends Mesh {

	/**
	 * Constructs a new skinned mesh.
	 *
	 * @param {BufferGeometry} [geometry] - The mesh geometry.
	 * @param {Material|Array<Material>} [material] - The mesh material.
	 */
	constructor( geometry, material ) {

		super( geometry, material );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isSkinnedMesh = true;

		this.type = 'SkinnedMesh';

		/**
		 * `AttachedBindMode` means the skinned mesh shares the same world space as the skeleton.
		 * This is not true when using `DetachedBindMode` which is useful when sharing a skeleton
		 * across multiple skinned meshes.
		 *
		 * @type {(AttachedBindMode|DetachedBindMode)}
		 * @default AttachedBindMode
		 */
		this.bindMode = AttachedBindMode;

		/**
		 * The base matrix that is used for the bound bone transforms.
		 *
		 * @type {Matrix4}
		 */
		this.bindMatrix = new Matrix4();

		/**
		 * The base matrix that is used for resetting the bound bone transforms.
		 *
		 * @type {Matrix4}
		 */
		this.bindMatrixInverse = new Matrix4();

		/**
		 * Snapshot of the matrix {@link SkinnedMesh#bindMatrixInverse} was last
		 * computed from (either `matrixWorld` or `bindMatrix`). Used by
		 * {@link SkinnedMesh#updateMatrixWorld} to skip the redundant inversion
		 * for static meshes.
		 *
		 * @type {Float64Array}
		 */
		this._bindMatrixInverseCache = new Float64Array( 16 );

		/**
		 * Forces recomputation of {@link SkinnedMesh#bindMatrixInverse} on the
		 * next {@link SkinnedMesh#updateMatrixWorld}. Set by methods that write
		 * `bindMatrixInverse` directly ({@link SkinnedMesh#bind},
		 * {@link SkinnedMesh#copy}).
		 *
		 * @type {boolean}
		 */
		this._bindMatrixInverseDirty = true;

		/**
		 * The bounding box of the skinned mesh. Can be computed via {@link SkinnedMesh#computeBoundingBox}.
		 *
		 * @type {?Box3}
		 * @default null
		 */
		this.boundingBox = null;

		/**
		 * The bounding sphere of the skinned mesh. Can be computed via {@link SkinnedMesh#computeBoundingSphere}.
		 *
		 * @type {?Sphere}
		 * @default null
		 */
		this.boundingSphere = null;

	}

	/**
	 * Computes the bounding box of the skinned mesh, and updates {@link SkinnedMesh#boundingBox}.
	 * The bounding box is not automatically computed by the engine; this method must be called by your app.
	 * If the skinned mesh is animated, the bounding box should be recomputed per frame in order to reflect
	 * the current animation state.
	 */
	computeBoundingBox() {

		const geometry = this.geometry;

		if ( this.boundingBox === null ) {

			this.boundingBox = new Box3();

		}

		this.boundingBox.makeEmpty();

		const positionAttribute = geometry.getAttribute( 'position' );

		for ( let i = 0; i < positionAttribute.count; i ++ ) {

			this.getVertexPosition( i, _vertex );
			this.boundingBox.expandByPoint( _vertex );

		}

	}

	/**
	 * Computes the bounding sphere of the skinned mesh, and updates {@link SkinnedMesh#boundingSphere}.
	 * The bounding sphere is automatically computed by the engine once when it is needed, e.g., for ray casting
	 * and view frustum culling. If the skinned mesh is animated, the bounding sphere should be recomputed
	 * per frame in order to reflect the current animation state.
	 */
	computeBoundingSphere() {

		const geometry = this.geometry;

		if ( this.boundingSphere === null ) {

			this.boundingSphere = new Sphere();

		}

		this.boundingSphere.makeEmpty();

		const positionAttribute = geometry.getAttribute( 'position' );

		for ( let i = 0; i < positionAttribute.count; i ++ ) {

			this.getVertexPosition( i, _vertex );
			this.boundingSphere.expandByPoint( _vertex );

		}

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.bindMode = source.bindMode;
		this.bindMatrix.copy( source.bindMatrix );
		this.bindMatrixInverse.copy( source.bindMatrixInverse );

		// copy() writes bindMatrixInverse directly: see bind() above.

		this._bindMatrixInverseDirty = true;

		this.skeleton = source.skeleton;

		this.boundingBox = source.boundingBox !== null ? source.boundingBox.clone() : null;
		this.boundingSphere = source.boundingSphere !== null ? source.boundingSphere.clone() : null;

		return this;

	}

	raycast( raycaster, intersects ) {

		const material = this.material;
		const matrixWorld = this.matrixWorld;

		if ( material === undefined ) return;

		// test with bounding sphere in world space

		if ( this.boundingSphere === null ) this.computeBoundingSphere();

		_sphere.copy( this.boundingSphere );
		_sphere.applyMatrix4( matrixWorld );

		if ( raycaster.ray.intersectsSphere( _sphere ) === false ) return;

		// convert ray to local space of skinned mesh

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		// test with bounding box in local space

		if ( this.boundingBox !== null ) {

			if ( _ray.intersectsBox( this.boundingBox ) === false ) return;

		}

		// test for intersections with geometry

		this._computeIntersections( raycaster, intersects, _ray );

	}

	getVertexPosition( index, target ) {

		super.getVertexPosition( index, target );

		this.applyBoneTransform( index, target );

		return target;

	}

	/**
	 * Binds the given skeleton to the skinned mesh.
	 *
	 * @param {Skeleton} skeleton - The skeleton to bind.
	 * @param {Matrix4} [bindMatrix] - The bind matrix. If no bind matrix is provided,
	 * the skinned mesh's world matrix will be used instead.
	 */
	bind( skeleton, bindMatrix ) {

		this.skeleton = skeleton;

		if ( bindMatrix === undefined ) {

			this.updateMatrixWorld( true );

			this.skeleton.calculateInverses();

			bindMatrix = this.matrixWorld;

		}

		this.bindMatrix.copy( bindMatrix );
		this.bindMatrixInverse.copy( bindMatrix ).invert();

		// bind() writes bindMatrixInverse directly: force recomputation on the
		// next updateMatrixWorld() to preserve the unconditional-invert behavior.

		this._bindMatrixInverseDirty = true;

	}

	/**
	 * This method sets the skinned mesh in the rest pose).
	 */
	pose() {

		this.skeleton.pose();

	}

	/**
	 * Normalizes the skin weights which are defined as a buffer attribute
	 * in the skinned mesh's geometry.
	 */
	normalizeSkinWeights() {

		const vector = new Vector4();

		const skinWeight = this.geometry.attributes.skinWeight;

		for ( let i = 0, l = skinWeight.count; i < l; i ++ ) {

			vector.fromBufferAttribute( skinWeight, i );

			const scale = 1.0 / vector.manhattanLength();

			if ( scale !== Infinity ) {

				vector.multiplyScalar( scale );

			} else {

				vector.set( 1, 0, 0, 0 ); // do something reasonable

			}

			skinWeight.setXYZW( i, vector.x, vector.y, vector.z, vector.w );

		}

	}

	updateMatrixWorld( force ) {

		super.updateMatrixWorld( force );

		if ( this.bindMode === AttachedBindMode ) {

			this._updateBindMatrixInverse( this.matrixWorld );

		} else if ( this.bindMode === DetachedBindMode ) {

			this._updateBindMatrixInverse( this.bindMatrix );

		} else {

			warn( 'SkinnedMesh: Unrecognized bindMode: ' + this.bindMode );

		}

	}

	// Recomputes bindMatrixInverse from the given input matrix, unless the
	// input is unchanged since the last computation (then the output would be
	// bit-identical) and no direct write happened in between.

	_updateBindMatrixInverse( input ) {

		const cache = this._bindMatrixInverseCache;
		const me = input.elements;

		if ( this._bindMatrixInverseDirty === false &&
			me[ 0 ] === cache[ 0 ] && me[ 1 ] === cache[ 1 ] && me[ 2 ] === cache[ 2 ] && me[ 3 ] === cache[ 3 ] &&
			me[ 4 ] === cache[ 4 ] && me[ 5 ] === cache[ 5 ] && me[ 6 ] === cache[ 6 ] && me[ 7 ] === cache[ 7 ] &&
			me[ 8 ] === cache[ 8 ] && me[ 9 ] === cache[ 9 ] && me[ 10 ] === cache[ 10 ] && me[ 11 ] === cache[ 11 ] &&
			me[ 12 ] === cache[ 12 ] && me[ 13 ] === cache[ 13 ] && me[ 14 ] === cache[ 14 ] && me[ 15 ] === cache[ 15 ] ) {

			return;

		}

		this.bindMatrixInverse.copy( input ).invert();

		for ( let i = 0; i < 16; i ++ ) {

			cache[ i ] = me[ i ];

		}

		this._bindMatrixInverseDirty = false;

	}

	/**
	 * Applies the bone transform associated with the given index to the given
	 * vector. Can be used to transform positions or direction vectors by providing
	 * a Vector4 with 1 or 0 in the w component respectively. Returns the updated vector.
	 *
	 * @param {number} index - The vertex index.
	 * @param {Vector3|Vector4} target - The target object that is used to store the method's result.
	 * @return {Vector3|Vector4} The updated vertex attribute data.
	 */
	applyBoneTransform( index, target ) {

		const skeleton = this.skeleton;
		const geometry = this.geometry;

		_skinIndex.fromBufferAttribute( geometry.attributes.skinIndex, index );
		_skinWeight.fromBufferAttribute( geometry.attributes.skinWeight, index );

		if ( target.isVector4 ) {

			_baseVector.copy( target );
			target.set( 0, 0, 0, 0 );

		} else {

			_baseVector.set( ...target, 1 );
			target.set( 0, 0, 0 );

		}

		_baseVector.applyMatrix4( this.bindMatrix );

		for ( let i = 0; i < 4; i ++ ) {

			const weight = _skinWeight.getComponent( i );

			if ( weight !== 0 ) {

				const boneIndex = _skinIndex.getComponent( i );

				_matrix4.multiplyMatrices( skeleton.bones[ boneIndex ].matrixWorld, skeleton.boneInverses[ boneIndex ] );

				target.addScaledVector( _vector4.copy( _baseVector ).applyMatrix4( _matrix4 ), weight );

			}

		}

		if ( target.isVector4 ) {

			// ensure the homogenous coordinate remains unchanged after vector operations
			target.w = _baseVector.w;

		}

		return target.applyMatrix4( this.bindMatrixInverse );

	}

}

export { SkinnedMesh };
