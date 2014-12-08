'use strict';

var SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    DownloadRateManager = require('./rules/DownloadRateManager.js'),
    VideoReadyStateRule = require('./rules/downloadRate/VideoReadyStateRule.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    streamTypes = ['video', 'audio'];

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
    var representation = getMpd(manifest).getPeriods()[0].getAdaptationSetByType(streamType).getRepResentations()[0],
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
    return {
        segmentLoader: segmentLoader,
        sourceBufferDataQueue: sourceBufferDataQueue
    };
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

function StreamLoader(segmentLoader, sourceBufferDataQueue, streamType) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__streamType = streamType;
}

StreamLoader.prototype.getStreamType = function() { return this.__streamType; };

StreamLoader.prototype.getSegmentLoaderLoader = function() { return this.__segmentLoader; };

StreamLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

StreamLoader.prototype.getCurrentSegmentNumber = function() { return this.__segmentLoader.getCurrentIndex(); };

function createStreamLoaders(manifest, mediaSource) { return createStreamLoadersForTypes(manifest, mediaSource, streamTypes); }

function PlaylistLoader(manifest, mediaSource, tech) {
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifest, mediaSource);
}

module.exports = PlaylistLoader;