'use strict';

var SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    DownloadRateManager = require('./rules/DownloadRateManager.js'),
    VideoReadyStateRule = require('./rules/downloadRate/VideoReadyStateRule.js'),
    StreamLoader = require('./StreamLoader.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    streamTypes = ['video', 'audio'];

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
    //var segments = [];
    segmentLoader.on(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        //segments.push(event.data);
        //console.log('Current Segment Count: ' + segments.length);
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            var loading = segmentLoader.loadNextSegment();
            if (!loading) {
                segmentLoader.off(segmentLoader.eventList.SEGMENT_LOADED, segmentLoadedHandler);
                /*console.log();
                 console.log();
                 console.log();
                 console.log('Final Segment Count: ' + segments.length);*/
            }
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    segmentLoader.loadNextSegment();
}

// TODO: Move this elsewhere (Where?)
function getSourceBufferTypeFromRepresentation(representation) {
    var codecStr = representation.getCodecs();
    var typeStr = representation.getMimeType();

    //NOTE: LEADING ZEROS IN CODEC TYPE/SUBTYPE ARE TECHNICALLY NOT SPEC COMPLIANT, BUT GPAC & OTHER
    // DASH MPD GENERATORS PRODUCE THESE NON-COMPLIANT VALUES. HANDLING HERE FOR NOW.
    // See: RFC 6381 Sec. 3.4 (https://tools.ietf.org/html/rfc6381#section-3.4)
    var parsedCodec = codecStr.split('.').map(function(str) {
        return str.replace(/^0+(?!\.|$)/, '');
    });
    var processedCodecStr = parsedCodec.join('.');

    return (typeStr + ';codecs="' + processedCodecStr + '"');
}

function createSegmentLoaderByType(manifest, streamType) {
    var adaptationSet = getMpd(manifest).getPeriods()[0].getAdaptationSetByType(streamType);
    return adaptationSet ? new SegmentLoader(adaptationSet) : null;
}

function createSourceBufferDataQueueByType(manifest, mediaSource, streamType) {
    // NOTE: Since codecs of particular representations (stream variants) may vary slightly, need to get specific
    // representation to get type for source buffer.
    var representation = getMpd(manifest).getPeriods()[0].getAdaptationSetByType(streamType).getRepresentations()[0],
        sourceBufferType = getSourceBufferTypeFromRepresentation(representation),
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);

    return sourceBuffer ? new SourceBufferDataQueue(sourceBuffer) : null;
}

function createStreamLoaderForType(manifest, mediaSource, streamType) {
    var segmentLoader,
        sourceBufferDataQueue;

    segmentLoader = createSegmentLoaderByType(manifest, streamType);
    if (!segmentLoader) { return null; }
    sourceBufferDataQueue = createSourceBufferDataQueueByType(manifest, mediaSource, streamType);
    if (!sourceBufferDataQueue) { return null; }
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, streamType);
}

function createStreamLoadersForTypes(manifest, mediaSource, streamTypes) {
    var streamLoaders = [],
        currentStreamLoader;

    streamTypes.forEach(function(streamType) {
        currentStreamLoader = createStreamLoaderForType(manifest, mediaSource, streamType);
        if (currentStreamLoader) { streamLoaders.push(currentStreamLoader); }
    });

    return streamLoaders;
}

function createStreamLoaders(manifest, mediaSource) { return createStreamLoadersForTypes(manifest, mediaSource, streamTypes); }

function PlaylistLoader(manifest, mediaSource, tech) {
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifest, mediaSource);
    this.__streamLoaders.forEach(function(streamLoader) {
        loadInitialization(streamLoader.getSegmentLoader(), streamLoader.getSourceBufferDataQueue());
    });
}

module.exports = PlaylistLoader;