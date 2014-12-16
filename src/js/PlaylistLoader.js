'use strict';

var existy = require('./util/existy.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    StreamLoader = require('./StreamLoader.js'),
    mediaTypes = require('./manifest/MediaTypes.js');

// TODO: Migrate methods below to a factory.
function createSourceBufferDataQueueByType(manifest, mediaSource, mediaType) {
    var sourceBufferType = manifest.getMediaSetByType(mediaType).getSourceBufferType(),
        // TODO: Try/catch block?
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);
    return new SourceBufferDataQueue(sourceBuffer);
}

function createStreamLoaderForType(manifestController, mediaSource, mediaType, tech) {
    var segmentLoader = new SegmentLoader(manifestController, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType);
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType, tech);
}

function createStreamLoaders(manifestController, mediaSource, tech) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return exists; }),
        streamLoaders = matchedTypes.map(function(mediaType) { return createStreamLoaderForType(manifestController, mediaSource, mediaType, tech); });
    return streamLoaders;
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    var self = this;
    this.__tech = tech;
    this.__streamLoaders = createStreamLoaders(manifestController, mediaSource, tech);
    this.__streamLoaders.forEach(function(streamLoader) {
        streamLoader.startLoadingSegments();
    });

    var changePlaybackRateEvents = ['seeking', 'canplay', 'canplaythrough'];
    changePlaybackRateEvents.forEach(function(eventType) {
        tech.on(eventType, function(event) {
            var readyState = tech.el().readyState,
                playbackRate = (readyState === 4) ? 1 : 0;
            tech.setPlaybackRate(playbackRate);
        });
    });
}

module.exports = PlaylistLoader;