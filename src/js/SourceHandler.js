'use strict';

var MediaSource = require('./window.js').MediaSource,
    xmlfun = require('./xmlfun.js'),
    //URL = require('./window.js').URL,
    loadManifest = require('./manifest/loadManifest.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    getSegmentListForRepresentation = require('./dash/segments/getSegmentListForRepresentation.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js');

// TODO: Move this elsewhere (Where?)
function getSourceBufferTypeFromRepresentation(representationXml) {
    if (!representationXml) { return null; }
    var codecStr = representationXml.getAttribute('codecs');
    var typeStr = xmlfun.getInheritableAttribute('mimeType')(representationXml);

    //NOTE: LEADING ZEROS IN CODEC TYPE/SUBTYPE ARE TECHNICALLY NOT SPEC COMPLIANT, BUT GPAC & OTHER
    // DASH MPD GENERATORS PRODUCE THESE NON-COMPLIANT VALUES. HANDLING HERE FOR NOW.
    // See: RFC 6381 Sec. 3.4 (https://tools.ietf.org/html/rfc6381#section-3.4)
    var parsedCodec = codecStr.split('.').map(function(str) {
        return str.replace(/^0+(?!\.|$)/, '');
    });
    var processedCodecStr = parsedCodec.join('.');

    return (typeStr + ';codecs="' + processedCodecStr + '"');
}

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

function load(manifestXml, tech) {
    console.log('START');

    var mediaSource = new MediaSource(),
        openListener = function(event) {
            mediaSource.removeEventListener('sourceopen', openListener, false);
            kickoffSegmentLoading('video', manifestXml, mediaSource);
            kickoffSegmentLoading('audio', manifestXml, mediaSource);
        };

    mediaSource.addEventListener('sourceopen', openListener, false);

    // TODO: Handle close.
    //mediaSource.addEventListener('webkitsourceclose', closed, false);
    //mediaSource.addEventListener('sourceclose', closed, false);

    //mediaSourceExtensions.videoElementUtils.attachMediaSource(mediaSource, tech);
    tech.setSrc(URL.createObjectURL(mediaSource));
}

function kickoffSegmentLoading(segmentListType, manifestXml, mediaSource) {
    var adaptationSet = getMpd(manifestXml).getPeriods()[0].getAdaptationSetByType(segmentListType),
        segmentLoader = new SegmentLoader(adaptationSet),
        mimeType = getSourceBufferTypeFromRepresentation(segmentLoader.getCurrentRepresentation().xml),
        sourceBuffer = mediaSource.addSourceBuffer(mimeType),
        sourceBufferDataQueue = new SourceBufferDataQueue(sourceBuffer);

    var segmentList = getSegmentListForRepresentation(adaptationSet.getRepresentations()[0]);
    // NOTE: FOR VERIFICATION PURPOSES ONLY
    console.log('Type: ' + segmentListType);
    console.log('Total Duration: ' + segmentList.getTotalDuration());
    console.log('Segment Duration: ' + segmentList.getSegmentDuration());
    console.log('Total Segment Count: ' + segmentList.getTotalSegmentCount());
    console.log('Start Number: ' + segmentList.getStartNumber());
    console.log('End Number: ' + segmentList.getEndNumber());
    //console.log('MediaSource duration: ' + mediaSource.setDuration(segmentList.getTotalDuration()));

    loadInitialization(segmentLoader, sourceBufferDataQueue);
}

function SourceHandler(source, tech) {
    loadManifest(source.src, function(data) {
        load(data.manifestXml, tech);
    });
}

module.exports = SourceHandler;