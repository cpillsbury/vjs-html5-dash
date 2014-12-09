'use strict';

function StreamLoader(segmentLoader, sourceBufferDataQueue, streamType) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__streamType = streamType;
}

StreamLoader.prototype.getStreamType = function() { return this.__streamType; };

StreamLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

StreamLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

StreamLoader.prototype.getCurrentSegmentNumber = function() { return this.__segmentLoader.getCurrentIndex(); };

module.exports = StreamLoader;