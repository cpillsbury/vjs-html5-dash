'use strict';

var existy = require('./util/existy.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    DownloadRateManager = require('./rules/DownloadRateManager.js'),
    VideoReadyStateRule = require('./rules/downloadRate/VideoReadyStateRule.js'),
    StreamLoader = require('./StreamLoader.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    mediaTypes = require('./manifest/MediaTypes.js');

function loadInitialization(segmentLoader, sourceBufferDataQueue) {
    segmentLoader.one(segmentLoader.eventList.INITIALIZATION_LOADED, function(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            loadSegments(segmentLoader, sourceBufferDataQueue);
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });
    segmentLoader.loadInitialization();
}

function loadSegments(segmentLoader, sourceBufferDataQueue) {
    segmentLoader.on(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            var loading = segmentLoader.loadNextSegment();
            if (!loading) {
                segmentLoader.off(segmentLoader.eventList.SEGMENT_LOADED, segmentLoadedHandler);
            }
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    segmentLoader.loadNextSegment();
}

function createSourceBufferDataQueueByType(manifest, mediaSource, mediaType) {
    var sourceBufferType = manifest.getMediaSetByType(mediaType).getSourceBufferType(),
        // TODO: Try/catch block?
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);
    return new SourceBufferDataQueue(sourceBuffer);
}

function createStreamLoaderForType(manifest, mediaSource, mediaType) {
    var segmentLoader = new SegmentLoader(manifest, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifest, mediaSource, mediaType);
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType);
}

function createStreamLoaders(manifest, mediaSource) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifest.getMediaSetByType(mediaType));
            return existy; }),
        streamLoaders = matchedTypes.map(function(mediaType) { return createStreamLoaderForType(manifest, mediaSource, mediaType); });
    return streamLoaders;
}

function PlaylistLoader(manifest, mediaSource, tech) {
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifest, mediaSource);
    this.__streamLoaders.forEach(function(streamLoader) {
        loadInitialization(streamLoader.getSegmentLoader(), streamLoader.getSourceBufferDataQueue());
    });
}

module.exports = PlaylistLoader;