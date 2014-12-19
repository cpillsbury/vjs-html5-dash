'use strict';

var existy = require('./util/existy.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    MediaTypeLoader = require('./MediaTypeLoader.js'),
    selectSegmentList = require('./selectSegmentList.js'),
    mediaTypes = require('./manifest/MediaTypes.js');

// TODO: Migrate methods below to a factory.
function createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType) {
    var sourceBufferType = manifestController.getMediaSetByType(mediaType).getSourceBufferType(),
        // TODO: Try/catch block?
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);
    return new SourceBufferDataQueue(sourceBuffer);
}

function createMediaTypeLoaderForType(manifestController, mediaSource, mediaType, tech) {
    var segmentLoader = new SegmentLoader(manifestController, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType);
    return new MediaTypeLoader(segmentLoader, sourceBufferDataQueue, mediaType, tech);
}

function createMediaTypeLoaders(manifestController, mediaSource, tech) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return exists; }),
        mediaTypeLoaders = matchedTypes.map(function(mediaType) { return createMediaTypeLoaderForType(manifestController, mediaSource, mediaType, tech); });
    return mediaTypeLoaders;
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    this.__tech = tech;
    this.__mediaTypeLoaders = createMediaTypeLoaders(manifestController, mediaSource, tech);

    this.__mediaTypeLoaders.forEach(function(mediaTypeLoader) {
        // MediaSet-specific variables
        var segmentLoader = mediaTypeLoader.getSegmentLoader(),
            downloadRateRatio = 1.0,
            currentSegmentListBandwidth = segmentLoader.getCurrentSegmentList().getBandwidth(),
            mediaType = mediaTypeLoader.getMediaType();

        // TODO: Currently an event add order dependency. Refactor MediaTypeLoader & PlaylistLoader to change this?
        mediaTypeLoader.on(mediaTypeLoader.eventList.RECHECK_SEGMENT_LOADING, function(event) {
            var mediaSet = manifestController.getMediaSetByType(mediaType),
                isFullscreen = tech.player().isFullscreen(),
                data = {},
                selectedSegmentList;

            data.downloadRateRatio = downloadRateRatio;
            data.currentSegmentListBandwidth = currentSegmentListBandwidth;
            data.width = isFullscreen ? window.screen.width : tech.player().width();
            data.height = isFullscreen ? window.screen.height : tech.player().height();

            selectedSegmentList = selectSegmentList(mediaSet, data);

            // TODO: Should we refactor to set based on segmentList instead?
            segmentLoader.setCurrentBandwidth(selectedSegmentList.getBandwidth());
        });

        segmentLoader.on(segmentLoader.eventList.DOWNLOAD_DATA_UPDATE, function(event) {
            downloadRateRatio = event.data.playbackTime / event.data.rtt;
            currentSegmentListBandwidth = event.data.bandwidth;
        });

        mediaTypeLoader.startLoadingSegments();
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