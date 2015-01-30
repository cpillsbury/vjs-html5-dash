'use strict';

var existy = require('./util/existy.js'),
    isFunction = require('./util/isFunction.js'),
    extendObject = require('./util/extendObject.js'),
    EventDispatcherMixin = require('./events/EventDispatcherMixin.js'),
    // TODO: Determine appropriate default size (or base on segment n x size/duration?)
    // Must consider ABR Switching & Viewing experience of already-buffered segments.
    MIN_DESIRED_BUFFER_SIZE = 20,
    MAX_DESIRED_BUFFER_SIZE = 40;

var waitTimeToRecheckLive = function(currentTime, bufferedTimeRanges, segmentList) {
    var currentRange = findTimeRangeEdge(currentTime, bufferedTimeRanges),
        nextSegment,
        safeLiveEdge,
        timePastSafeLiveEdge;

    if (!existy(currentRange)) { return 0; }

    nextSegment = segmentList.getSegmentByTime(currentRange.getEnd());
    safeLiveEdge = (Date.now() - (segmentList.getSegmentDuration() * 1000));
    timePastSafeLiveEdge = nextSegment.getUTCWallClockStartTime() - safeLiveEdge;

    if (timePastSafeLiveEdge < 0.003) { return 0; }

    return timePastSafeLiveEdge;
};

var nextSegmentToLoad = function(currentTime, bufferedTimeRanges, segmentList) {
    var currentRange = findTimeRangeEdge(currentTime, bufferedTimeRanges),
        segmentToLoad;

    if (existy(currentRange)) {
        segmentToLoad = segmentList.getSegmentByTime(currentRange.getEnd());
    } else if (segmentList.getIsLive()) {
        segmentToLoad = segmentList.getSegmentByUTCWallClockTime(Date.now() - (segmentList.getSegmentDuration() * 1000));
    } else {
        // Otherwise (i.e. if VOD/static streams, get the segment @ currentTime).
        segmentToLoad = segmentList.getSegmentByTime(currentTime);
    }

    return segmentToLoad;
};

var findTimeRangeEdge = function(currentTime, bufferedTimeRanges) {
    var currentRange = bufferedTimeRanges.getTimeRangeByTime(currentTime),
        i,
        length,
        timeRangeToCheck;

    if (!existy(currentRange)) { return currentRange; }

    i = currentRange.getIndex() + 1;
    length = bufferedTimeRanges.getLength();

    for (;i<length;i++) {
        timeRangeToCheck = bufferedTimeRanges.getTimeRangeByIndex(i);
        if((timeRangeToCheck.getStart() - currentRange.getEnd()) > 0.003) { break; }
        currentRange = timeRangeToCheck;
    }

    return currentRange;
};

/**
 *
 * MediaTypeLoader coordinates between segment downloading and adding segments to the MSE source buffer for a given media type (e.g. 'audio' or 'video').
 *
 * @param segmentLoader {SegmentLoader}                 object instance that handles downloading segments for the media set
 * @param sourceBufferDataQueue {SourceBufferDataQueue} object instance that handles adding segments to MSE SourceBuffer
 * @param mediaType {string}                            string representing the media type (e.g. 'audio' or 'video') for the media set
 * @param tech {object}                                 video.js Html5 tech instance.
 * @constructor
 */
function MediaTypeLoader(segmentLoader, sourceBufferDataQueue, mediaType, tech) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__mediaType = mediaType;
    this.__tech = tech;
}

/**
 * Enumeration of events instances of this object will dispatch.
 */
MediaTypeLoader.prototype.eventList = {
    RECHECK_SEGMENT_LOADING: 'recheckSegmentLoading',
    RECHECK_CURRENT_SEGMENT_LIST: 'recheckCurrentSegmentList'
};

MediaTypeLoader.prototype.getMediaType = function() { return this.__mediaType; };

MediaTypeLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

MediaTypeLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

/**
 * Kicks off segment loading for the media set
 */
MediaTypeLoader.prototype.startLoadingSegments = function() {

    var self = this,
        nowUTC;

    // Event listener for rechecking segment loading. This event is fired whenever a segment has been successfully
    // downloaded and added to the buffer or, if not currently loading segments (because the buffer is sufficiently full
    // relative to the current playback time), whenever some amount of time has elapsed and we should check on the buffer
    // state again.
    // NOTE: Store a reference to the event handler to potentially remove it later.
    this.__recheckSegmentLoadingHandler = function(event) {
        self.trigger({ type:self.eventList.RECHECK_CURRENT_SEGMENT_LIST, target:self });
        self.__checkSegmentLoading(self.__tech.currentTime(), MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
    };

    this.on(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);
    this.__tech.on('seeking', this.__recheckSegmentLoadingHandler);

    if (this.__segmentLoader.getCurrentSegmentList().getIsLive()) {
        nowUTC = Date.now();
        this.one(this.eventList.RECHECK_SEGMENT_LOADING, function(event) {
            var seg = self.__segmentLoader.getCurrentSegmentList().getSegmentByUTCWallClockTime(nowUTC),
                segUTCStartTime = seg.getUTCWallClockStartTime(),
                timeOffset = (nowUTC - segUTCStartTime)/1000,
                seekToTime = self.__sourceBufferDataQueue.getBufferedTimeRangeListAlignedToSegmentDuration(seg.getDuration()).getTimeRangeByIndex(0).getStart() + timeOffset;
            self.__tech.setCurrentTime(seekToTime);
        });
    }

    // Manually check on loading segments the first time around.
    this.__checkSegmentLoading(this.__tech.currentTime(), MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
};

MediaTypeLoader.prototype.stopLoadingSegments = function() {
    if (!existy(this.__recheckSegmentLoadingHandler)) { return; }

    this.off(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);
    this.__tech.off('seeking', this.__recheckSegmentLoadingHandler);
    this.__recheckSegmentLoadingHandler = undefined;
    if (existy(this.__waitTimerId)) {
        clearTimeout(this.__waitTimerId);
    }
    this.__waitTimerId = undefined;
};

var waitTimeToRecheckStatic = function(currentTime,
                                 bufferedTimeRanges,
                                 segmentDuration,
                                 lastDownloadRoundTripTime,
                                 minDesiredBufferSize,
                                 maxDesiredBufferSize) {
    var currentRange = findTimeRangeEdge(currentTime, bufferedTimeRanges),
        bufferSize;

    if (!existy(currentRange)) { return 0; }

    bufferSize = currentRange.getEnd() - currentTime;

    if (bufferSize < minDesiredBufferSize) { return 0; }
    else if (bufferSize < maxDesiredBufferSize) { return (segmentDuration - lastDownloadRoundTripTime) * 1000; }

    return Math.floor(Math.min(segmentDuration, 2) * 1000);
};

MediaTypeLoader.prototype.__checkSegmentLoading = function(currentTime, minDesiredBufferSize, maxDesiredBufferSize) {
    var lastDownloadRoundTripTime = this.__segmentLoader.getLastDownloadRoundTripTimeSpan(),
        segmentList = this.__segmentLoader.getCurrentSegmentList(),
        segmentDuration = segmentList.getSegmentDuration(),
        bufferedTimeRanges = this.__sourceBufferDataQueue.getBufferedTimeRangeListAlignedToSegmentDuration(segmentDuration),
        isLive = segmentList.getIsLive(),
        waitTime,
        segmentToDownload,
        self = this;

    if (existy(this.__waitTimerId)) { clearTimeout(this.__waitTimerId); }

    function waitFunction() {
        self.__checkSegmentLoading(self.__tech.currentTime(), minDesiredBufferSize, maxDesiredBufferSize);
        self.__waitTimerId = undefined;
    }

    if (isLive) {
        waitTime = waitTimeToRecheckLive(currentTime, bufferedTimeRanges, segmentList);
    } else {
        waitTime = waitTimeToRecheckStatic(currentTime, bufferedTimeRanges, segmentDuration, lastDownloadRoundTripTime, minDesiredBufferSize, maxDesiredBufferSize);
    }

    // If wait time was less than 50ms, assume we should simply load now.
    if (waitTime > 50) {
        this.__waitTimerId = setTimeout(waitFunction, waitTime);
    } else {
        segmentToDownload = nextSegmentToLoad(currentTime, bufferedTimeRanges, segmentList);
        if (existy(segmentToDownload)) {
            this.__loadSegment(segmentToDownload);
        } else {
            // Apparently no segment to load, so go into a holding pattern.
            this.waitTimerId = setTimeout(waitFunction, 2000);
        }
    }
};

/**
 * Download a segment from the current segment list corresponding to the stipulated media presentation time and add it
 * to the source buffer.
 *
 * @param presentationTime {number} The media presentation time for which we want to download and buffer a segment
 * @returns {boolean}               Whether or not the there are subsequent segments in the segment list, relative to the
 *                                  media presentation time requested.
 * @private
 */
MediaTypeLoader.prototype.__loadSegment = function loadSegment(segment) {
    var self = this,
        segmentLoader = self.__segmentLoader,
        sourceBufferDataQueue = self.__sourceBufferDataQueue,
        hasNextSegment = segmentLoader.loadSegmentAtTime(segment.getStartTime());

    if (!hasNextSegment) { return hasNextSegment; }

    segmentLoader.one(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            // Once we've completed downloading and buffering the segment, dispatch event to notify that we should recheck
            // whether or not we should load another segment and, if so, which. (See: __checkSegmentLoading() method, above)
            self.trigger({ type:self.eventList.RECHECK_SEGMENT_LOADING, target:self });
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    return hasNextSegment;
};

// Add event dispatcher functionality to prototype.
extendObject(MediaTypeLoader.prototype, EventDispatcherMixin);

module.exports = MediaTypeLoader;