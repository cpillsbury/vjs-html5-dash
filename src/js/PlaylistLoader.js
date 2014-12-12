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

function createStreamLoaderForType(manifestController, mediaSource, mediaType) {
    var segmentLoader = new SegmentLoader(manifestController, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType);
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType);
}

function createStreamLoaders(manifestController, mediaSource) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return existy; }),
        streamLoaders = matchedTypes.map(function(mediaType) { return createStreamLoaderForType(manifestController, mediaSource, mediaType); });
    return streamLoaders;
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    var self = this;
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifestController, mediaSource);
    this.__streamLoaders.forEach(function(streamLoader) {
        /*tech.on('timeupdate', function(event) {
            console.log('Current Time: ' + event.target.currentTime);
        });*/
        loadInitialization(streamLoader.getSegmentLoader(), streamLoader.getSourceBufferDataQueue());
    });

    /*this.__downloadRateMgr.on(this.__downloadRateMgr.eventList.DOWNLOAD_RATE_CHANGED, function(event) {
        var self2 = self;
        console.log('Current Time: ' + tech.currentTime());
    });*/

    tech.on('seeked', function(event) {
        var hasData = false;
        console.log('Seeked Current Time: ' + tech.currentTime());
        self.__streamLoaders.forEach(function(streamLoader) {
            hasData = streamLoader.getSourceBufferDataQueue().hasBufferedDataForTime(tech.currentTime());
            console.log('Has Data @ Time? ' + hasData);
        });
    });

    tech.on('seeking', function(event) {
        var hasData = false;
        console.log('Seeking Current Time: ' + tech.currentTime());
        self.__streamLoaders.forEach(function(streamLoader) {
            hasData = streamLoader.getSourceBufferDataQueue().hasBufferedDataForTime(tech.currentTime());
            console.log('Has Data @ Time? ' + hasData);
        });
    });
}

module.exports = PlaylistLoader;