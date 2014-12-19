'use strict';

var existy = require('./util/existy.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    MediaTypeLoader = require('./MediaTypeLoader.js'),
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

function sortSegmentListsByBandwidthAscending(segmentListA, segmentListB) {
    var bandwidthA = segmentListA.getBandwidth(),
        bandwidthB = segmentListB.getBandwidth();
    return bandwidthA - bandwidthB;
}

function sortSegmentListsByResolutionAscending(segmentListA, segmentListB) {
    var widthA = segmentListA.getWidth() || 0,
        widthB = segmentListB.getWidth() || 0;
    return widthA - widthB;
}

function sortSegmentListsByResolutionThenBandwidthAscending(segmentListA, segmentListB) {
    var resolutionCompare = sortSegmentListsByResolutionAscending(segmentListA, segmentListB);
    return (resolutionCompare !== 0) ? resolutionCompare : sortSegmentListsByBandwidthAscending(segmentListA, segmentListB);
}

function filterSegmentListsByResolution(segmentList, maxWidth, maxHeight) {
    var width = segmentList.getWidth() || 0,
        height = segmentList.getHeight() || 0;
    return ((width <= maxWidth) && (height <= maxHeight));
}

function filterSegmentListsByDownloadRate(segmentList, currentSegmentList, downloadRateRatio) {
    var segmentListBandwidth = segmentList.getBandwidth(),
        currentSegmentListBandwidth = currentSegmentList.getBandwidth(),
        segmentBandwidthRatio = segmentListBandwidth / currentSegmentListBandwidth;
    return (downloadRateRatio >= segmentBandwidthRatio);
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    var self = this;
    //this.__downloadRateMonitor = {};
    this.__tech = tech;
    this.__mediaTypeLoaders = createMediaTypeLoaders(manifestController, mediaSource, tech);

    tech.player().on('fullscreenchange', function(event) {
        console.log('Player width x height: ' + tech.player().width() + 'x' + tech.player().height());
        console.log('Screen width x height: ' + window.screen.width + 'x' + window.screen.height);
    });

    this.__mediaTypeLoaders.forEach(function(mediaTypeLoader) {
        var player = tech.player(),
            segmentLoader = mediaTypeLoader.getSegmentLoader(),
            mediaType = mediaTypeLoader.getMediaType(),
            downloadRateRatio = 1.0,
            currentSegmentList = segmentLoader.getCurrentSegmentList();

        mediaTypeLoader.on(mediaTypeLoader.eventList.RECHECK_SEGMENT_LOADING, function(event) {
            var sortedByBandwidth = manifestController.getMediaSetByType(mediaType).getSegmentLists().sort(sortSegmentListsByBandwidthAscending),
                sortedByResolutionThenBandwidth = manifestController.getMediaSetByType(mediaType).getSegmentLists().sort(sortSegmentListsByResolutionThenBandwidthAscending),
                filteredByDownloadRate = sortedByBandwidth.filter(function(segmentList) { return filterSegmentListsByDownloadRate(segmentList, currentSegmentList, downloadRateRatio); }),
                filteredByResolution = sortedByResolutionThenBandwidth.filter(
                    function(segmentList) {
                        var width = player.isFullscreen() ? screen.width : player.width(),
                            height = player.isFullscreen() ? screen.height : player.height();
                        return filterSegmentListsByResolution(segmentList, width, height);
                    }
                ),
                proposedSegmentList,
                proposedBandwidth;

            proposedSegmentList = filteredByResolution[filteredByResolution.length - 1] || filteredByDownloadRate[filteredByDownloadRate.length - 1] || sortedByBandwidth[0];
            proposedBandwidth = proposedSegmentList.getBandwidth();

            console.log('Proposed Bandwidth for mediaType ' + mediaType + ': ' + proposedBandwidth);

            segmentLoader.setCurrentBandwidth(proposedBandwidth);
        });

        segmentLoader.on(segmentLoader.eventList.DOWNLOAD_DATA_UPDATE, function(event) {
            downloadRateRatio = event.data.playbackTime / event.data.rtt;
            currentSegmentList = manifestController.getMediaSetByType(mediaType).getSegmentListByBandwidth(event.data.bandwidth);
        });
        mediaTypeLoader.startLoadingSegments();
    });

    var changePlaybackRateEvents = ['seeking', 'canplay', 'canplaythrough'];
    changePlaybackRateEvents.forEach(function(eventType) {
        tech.on(eventType, function(event) {
            var readyState = tech.el().readyState,
                playbackRate = (readyState === 4) ? 1 : 0;
            console.log('Playback rate: ' + playbackRate);
            tech.setPlaybackRate(playbackRate);
        });
    });
}

module.exports = PlaylistLoader;