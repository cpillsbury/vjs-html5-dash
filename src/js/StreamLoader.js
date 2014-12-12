'use strict';

function StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__mediaType = mediaType;
}

StreamLoader.prototype.getMediaType = function() { return this.__mediaType; };

StreamLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

StreamLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

StreamLoader.prototype.getCurrentSegmentNumber = function() { return this.__segmentLoader.getCurrentSegmentNumber(); };

StreamLoader.prototype.getLastDownloadRoundTripTimeSpan = function() {
    return this.__segmentLoader.getLastDownloadStartTime();
};

module.exports = StreamLoader;