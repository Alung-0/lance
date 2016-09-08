"use strict";


const Point = require('../Point');
const Serializable = require('./Serializable');
const Serializer = require('./Serializer');
const MathUtils = require('../lib/MathUtils');

/**
 * Defines an objects which can move about in the game world
 */
class DynamicObject extends Serializable {

    static get netScheme() {
        return {
            id: { type: Serializer.TYPES.UINT8 },
            playerId: { type: Serializer.TYPES.UINT8 },
            x: { type: Serializer.TYPES.INT16 },
            y: { type: Serializer.TYPES.INT16 },
            velX: { type: Serializer.TYPES.FLOAT32 },
            velY: { type: Serializer.TYPES.FLOAT32 },
            angle: { type: Serializer.TYPES.INT16 }
        };
    }

    constructor(id, x, y) {
        super();
        this.id = id; // instance id
        this.playerId = 0;
        this.x = x;
        this.y = y;
        this.velX = 0;
        this.velY = 0;
        this.bendingX = 0;
        this.bendingY = 0;
        this.angle = 90;
        this.bendingAngle = 0;
        this.rotationSpeed = 2.5;
        this.acceleration = 0.1;
        this.deceleration = 0.99;
        this.maxSpeed = 5;

        // todo deal with what goes over the wire
        this.velocity = new Point();
        this.temp = {
            accelerationVector: new Point()
        };

    }

    // for debugging purposes mostly
    toString() {
        function round3(x) { return Math.round(x * 1000) / 1000; }
        function showVec(x, y, z) { return `(${round3(x)}, ${round3(y)}, ${round3(z)})`; }
        return `DynamicObject[${this.id}] position${showVec(this.x, this.y, this.z)} velocity${showVec(this.velX, this.velY, this.velZ)} angle${round3(this.angle)}`;
    }

    copyFrom(sourceObj) {
        this.id = sourceObj.id;
        this.playerId = sourceObj.playerId;
        this.isPlayerControlled = sourceObj.isPlayerControlled;

        this.x = sourceObj.x;
        this.y = sourceObj.y;
        this.velX = sourceObj.velX;
        this.velY = sourceObj.velY;
        this.bendingX = sourceObj.bendingX;
        this.bendingY = sourceObj.bendingY;
        this.bendingAngle = sourceObj.bendingAngle;
        this.velocity.set(sourceObj.velX, sourceObj.velY);
        this.angle = sourceObj.angle;
        this.rotationSpeed = sourceObj.rotationSpeed;
        this.acceleration = sourceObj.acceleration;
        this.deceleration = sourceObj.deceleration;
        this.maxSpeed = sourceObj.maxSpeed;
    }

    step(worldSettings) {
        if (this.isRotatingRight) { this.angle += this.rotationSpeed; }
        if (this.isRotatingLeft) { this.angle -= this.rotationSpeed; }
        this.angle += this.bendingAngle;

        if (this.angle >= 360) { this.angle -= 360; }
        if (this.angle < 0) { this.angle += 360; }

        if (this.isAccelerating) {
            this.temp.accelerationVector.set(
                Math.cos(this.angle * (Math.PI / 180)),
                Math.sin(this.angle * (Math.PI / 180))
            ).setMagnitude(this.acceleration);
        } else {
            this.temp.accelerationVector.set(0, 0);
        }

        // constant velocity, like a missile
        if (this.constantVelocity) {
            this.velocity.set(
                Math.cos(this.angle * (Math.PI / 180)),
                Math.sin(this.angle * (Math.PI / 180))
            ).setMagnitude(this.constantVelocity);
        } else {
            // acceleration
            Point.add(this.velocity, this.temp.accelerationVector, this.velocity);
            // this.velocity.multiply(this.deceleration, this.deceleration);
            this.velocity.x = Math.round(this.velocity.x * 100) / 100;
            this.velocity.y = Math.round(this.velocity.y * 100) / 100;
        }
        if (this.velocity.getMagnitude() > this.maxSpeed) this.velocity.setMagnitude(this.maxSpeed);

        this.velX = this.velocity.x;
        this.velY = this.velocity.y;

        this.isAccelerating = false;
        this.isRotatingLeft = false;
        this.isRotatingRight = false;
        this.x = this.x + this.velocity.x + this.bendingX;
        this.y = this.y + this.velocity.y + this.bendingY;

        if (this.x >= worldSettings.width) { this.x -= worldSettings.width; }
        if (this.y >= worldSettings.height) { this.y -= worldSettings.height; }
        if (this.x < 0) { this.x += worldSettings.width; }
        if (this.y < 0) { this.y += worldSettings.height; }
    }

    init(options) {
        Object.assign(this, options);
    }

    initRenderObject(renderer) {
        this.renderer = renderer;
        this.renderObject = this.renderer.addObject(this);
    }

    saveState() {
        this.savedCopy = (new this.constructor());
        this.savedCopy.copyFrom(this);
    }

    // TODO:
    // rather than pass worldSettings on each bend, they could
    // be passed in on the constructor just once.
    bendToSavedState(bending, worldSettings) {
        if (this.savedCopy) {
            this.bendTo(this.savedCopy, bending, worldSettings);
        }
        this.savedCopy = null;
    }

    syncTo(other) {
        ['x', 'y', 'velX', 'velY', 'angle']
            .forEach(attr => {
                this[attr] = other[attr];
            });
        this.velocity.x = this.velX;
        this.velocity.y = this.velY;

        // resent bending
        this.bendingX = 0;
        this.bendingY = 0;
        this.bendingAngle = 0;
    }

    bendTo(original, bending, worldSettings) {

        // TODO: wrap-around should not be the default behaviour of DynamicObject.
        // it should either be enabled by some option, or be transplanted into
        // another class called WrapAroundDynamicObject

        // TODO: turn this function inside out.  "this" should be the original,
        // and the function should receive an object called "other"

        // bend to position, velocity, and angle gradually
        this.bendingX = MathUtils.interpolateDeltaWithWrapping(original.x, this.x, bending, 0, worldSettings.width) / 10;
        this.bendingY = MathUtils.interpolateDeltaWithWrapping(original.y, this.y, bending, 0, worldSettings.height) / 10;
        this.bendingAngle = MathUtils.interpolateDeltaWithWrapping(original.angle, this.angle, bending, 0, 360) / 10;
        this.velX = MathUtils.interpolate(original.velX, this.velX, bending);
        this.velY = MathUtils.interpolate(original.velY, this.velY, bending);

        // revert to original
        this.x = original.x;
        this.y = original.y;
        this.angle = original.angle;

        // TODO: these next two lines are a side-effect of the fact
        // that velocity is stored both in attribute "velocity" and in velX/velY
        // which is redundant now that we can set a Point instance over the network
        this.velocity.x = this.velX;
        this.velocity.y = this.velY;
    }

    updateRenderObject() {
        this.renderObject.x = this.x;
        this.renderObject.y = this.y;
        this.renderObject.angle = this.angle;
    }

    interpolate(prevObj, nextObj, playPercentage) {

        // update other objects with interpolation
        // TODO refactor into general interpolation class
        // TODO: this interpolate function should not care about worldSettings.
        if (this.isPlayerControlled != true) {

            if (Math.abs(nextObj.x - prevObj.x) > this.renderer.worldSettings.height / 2) { // fix for world wraparound
                this.x = nextObj.x;
            } else {
                this.x = (nextObj.x - prevObj.x) * playPercentage + prevObj.x;
            }

            if (Math.abs(nextObj.y - prevObj.y) > this.renderer.worldSettings.height / 2) { // fix for world wraparound
                this.y = nextObj.y;
            } else {
                this.y = (nextObj.y - prevObj.y) * playPercentage + prevObj.y;
            }

            var shortestAngle = ((((nextObj.angle - prevObj.angle) % 360) + 540) % 360) - 180; // todo wrap this in a util
            this.angle = prevObj.angle + shortestAngle * playPercentage;

            if (this.renderObject) {
                this.updateRenderObject();
            }
        }
    }

    // release resources
    destroy() {
        console.log(`destroying object ${this.id}`);

        // destroy the renderObject
        if (this.renderObject) {
            this.renderer.removeObject(this.renderObject);
        }
    }
}

module.exports = DynamicObject;