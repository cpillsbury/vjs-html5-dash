'use strict';

var existy = require('./util/existy.js'),
    isNumber = require('./util/isNumber.js'),
    extendObject = require('./util/extendObject.js'),
    EventDispatcherMixin = require('./events/EventDispatcherMixin.js'),
    loadSegment = require('./segments/loadSegment.js'),
    // TODO: Determine appropriate default size (or base on segment n x size/duration?)
    // Must consider ABR Switching & Viewing experience of already-buffered segments.
    MIN_DESIRED_BUFFER_SIZE = 20,
    MAX_DESIRED_BUFFER_SIZE = 40,
    DEFAULT_RETRY_COUNT = 3,
    DEFAULT_RETRY_INTERVAL = 250;

function waitTimeToRecheckStatic(currentTime,
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
}

function waitTimeToRecheckLive(currentTime, bufferedTimeRanges, segmentList) {
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
}

function nextSegmentToLoad(currentTime, bufferedTimeRanges, segmentList) {
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
}

function findTimeRangeEdge(currentTime, bufferedTimeRanges) {
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
}

/**
 *
 * MediaTypeLoader coordinates between segment downloading and adding segments to the MSE source buffer for a given media type (e.g. 'audio' or 'video').
 *
 * @param sourceBufferDataQueue {SourceBufferDataQueue} object instance that handles adding segments to MSE SourceBuffer
 * @param mediaType {string}                            string representing the media type (e.g. 'audio' or 'video') for the media set
 * @param tech {object}                                 video.js Html5 tech instance.
 * @constructor
 */
function MediaTypeLoader(manifestController, mediaType, sourceBufferDataQueue, tech) {
    if (!existy(manifestController)) { throw new Error('MediaTypeLoader must be initialized with a manifestController!'); }
    if (!existy(mediaType)) { throw new Error('MediaTypeLoader must be initialized with a mediaType!'); }
    // NOTE: Rather than passing in a reference to the MediaSet instance for a media type, we pass in a reference to the
    // controller & the mediaType so that the MediaTypeLoader doesn't need to be aware of state changes/updates to
    // the manifest data (say, if the playlist is dynamic/'live').
    this.__manifestController = manifestController;
    this.__mediaType = mediaType;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__tech = tech;
    // Currently, set the default bandwidth to the 0th index of the available bandwidths. Can changed to whatever seems
    // appropriate (CJP).
    this.setCurrentBandwidth(this.getAvailableBandwidths()[0]);
}

/**
 * Enumeration of events instances of this object will dispatch.
 */
MediaTypeLoader.prototype.eventList = {
    RECHECK_SEGMENT_LOADING: 'recheckSegmentLoading',
    RECHECK_CURRENT_SEGMENT_LIST: 'recheckCurrentSegmentList',
    DOWNLOAD_DATA_UPDATE: 'downloadDataUpdate'
};

MediaTypeLoader.prototype.getMediaType = function() { return this.getMediaSet().getMediaType(); };

MediaTypeLoader.prototype.getMediaSet = function() { return this.__manifestController.getMediaSetByType(this.__mediaType); };

MediaTypeLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

MediaTypeLoader.prototype.getCurrentSegmentList = function getCurrentSegmentList() {
    return this.getMediaSet().getSegmentListByBandwidth(this.getCurrentBandwidth());
};

MediaTypeLoader.prototype.getCurrentBandwidth = function getCurrentBandwidth() { return this.__currentBandwidth; };

/**
 * Sets the current bandwidth, which corresponds to the currently selected segment list (i.e. the segment list in the
 * media set from which we should be downloading segments).
 * @param bandwidth {number}
 */
MediaTypeLoader.prototype.setCurrentBandwidth = function setCurrentBandwidth(bandwidth) {
    if (!isNumber(bandwidth)) {
        throw new Error('MediaTypeLoader::setCurrentBandwidth() expects a numeric value for bandwidth!');
    }
    var availableBandwidths = this.getAvailableBandwidths();
    if (availableBandwidths.indexOf(bandwidth) < 0) {
        throw new Error('MediaTypeLoader::setCurrentBandwidth() must be set to one of the following values: ' + availableBandwidths.join(', '));
    }
    if (bandwidth === this.__currentBandwidth) { return; }
    // Track when we've switch bandwidths, since we'll need to (re)load the initialization segment for the segment list
    // whenever we switch between segment lists. This allows MediaTypeLoader instances to automatically do this, hiding those
    // details from the outside.
    this.__currentBandwidthChanged = true;
    this.__currentBandwidth = bandwidth;
};

MediaTypeLoader.prototype.getAvailableBandwidths = function() { return this.getMediaSet().getAvailableBandwidths(); };

MediaTypeLoader.prototype.getLastDownloadRoundTripTimeSpan = function() { return this.__lastDownloadRoundTripTimeSpan || 0; };

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

    if (this.getCurrentSegmentList().getIsLive()) {
        nowUTC = Date.now();
        this.one(this.eventList.RECHECK_SEGMENT_LOADING, function(event) {
            var seg = self.getCurrentSegmentList().getSegmentByUTCWallClockTime(nowUTC),
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
        this.__waitTimerId = undefined;
    }
};

MediaTypeLoader.prototype.__checkSegmentLoading = function(currentTime, minDesiredBufferSize, maxDesiredBufferSize) {
    var lastDownloadRoundTripTime = this.getLastDownloadRoundTripTimeSpan(),
        loadInitialization = this.__currentBandwidthChanged,
        segmentList = this.getCurrentSegmentList(),
        segmentDuration = segmentList.getSegmentDuration(),
        bufferedTimeRanges = this.__sourceBufferDataQueue.getBufferedTimeRangeListAlignedToSegmentDuration(segmentDuration),
        isLive = segmentList.getIsLive(),
        waitTime,
        segmentToDownload,
        self = this;

    // If we're here but there's a waitTimerId, we should clear it out so we don't do
    // an additional recheck unnecessarily.
    if (existy(this.__waitTimerId)) {
        clearTimeout(this.__waitTimerId);
        this.__waitTimerId = undefined;
    }

    function waitFunction() {
        self.__checkSegmentLoading(self.__tech.currentTime(), minDesiredBufferSize, maxDesiredBufferSize);
        self.__waitTimerId = undefined;
    }

    if (isLive) {
        waitTime = waitTimeToRecheckLive(currentTime, bufferedTimeRanges, segmentList);
    } else {
        waitTime = waitTimeToRecheckStatic(currentTime, bufferedTimeRanges, segmentDuration, lastDownloadRoundTripTime, minDesiredBufferSize, maxDesiredBufferSize);
    }

    if (waitTime > 50) {
        // If wait time was > 50ms, re-check in waitTime ms.
        this.__waitTimerId = setTimeout(waitFunction, waitTime);
    } else {
        // Otherwise, start loading now.
        segmentToDownload = nextSegmentToLoad(currentTime, bufferedTimeRanges, segmentList);
        if (existy(segmentToDownload)) {
            // If we're here but there's a segmentLoadXhr request, we've kicked off a recheck in the middle of a segment
            // download. However, unless we're loading a new segment (ie not waiting), there's no reason to abort the current
            // request, so only cancel here (CJP).
            if (existy(this.__segmentLoadXhr)) {
                this.__segmentLoadXhr.abort();
                this.__segmentLoadXhr = undefined;
            }

            this.__loadAndBufferSegment(segmentToDownload, segmentList, loadInitialization);
        } else {
            // Apparently no segment to load, so go into a holding pattern.
            this.__waitTimerId = setTimeout(waitFunction, 2000);
        }
    }
};

MediaTypeLoader.prototype.__loadAndBufferSegment = function loadAndBufferSegment(segment, segmentList, loadInitialization) {

    var self = this,
        retryCount = DEFAULT_RETRY_COUNT,
        retryInterval = DEFAULT_RETRY_INTERVAL,
        segmentsToBuffer = [],
        requestStartTimeSeconds;

    function successInitialization(data) {
        segmentsToBuffer.push(data.response);
        requestStartTimeSeconds = new Date().getTime()/1000;
        self.__currentBandwidthChanged = false;
        self.__segmentLoadXhr = loadSegment(segment, success, fail, self);
    }

    function success(data) {
        var sourceBufferDataQueue = self.__sourceBufferDataQueue;

        self.__lastDownloadRoundTripTimeSpan = ((new Date().getTime())/1000) - requestStartTimeSeconds;
        segmentsToBuffer.push(data.response);
        self.__segmentLoadXhr = undefined;

        self.trigger(
            {
                type:self.eventList.DOWNLOAD_DATA_UPDATE,
                target: self,
                data: {
                    rtt: self.__lastDownloadRoundTripTimeSpan,
                    playbackTime: segment.getDuration(),
                    bandwidth: segmentList.getBandwidth()
                }
            }
        );

        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            // Once we've completed downloading and buffering the segment, dispatch event to notify that we should recheck
            // whether or not we should load another segment and, if so, which. (See: __checkSegmentLoading() method, above)
            self.trigger({ type:self.eventList.RECHECK_SEGMENT_LOADING, target:self });
        });

        sourceBufferDataQueue.addToQueue(segmentsToBuffer);
    }

    function fail(data) {
        if (--retryCount <= 0) { return; }
        console.log('Failed to load segment @ ' + segment.getUrl() + '. Request Status: ' + data.status);
        setTimeout(function() {
            requestStartTimeSeconds = (new Date().getTime())/1000;
            self.__segmentLoadXhr = loadSegment(data.requestedSegment, success, fail, self);
        }, retryInterval);
    }

    if (loadInitialization) {
        self.__segmentLoadXhr = loadSegment(segmentList.getInitialization(), successInitialization, fail, self);
    } else {
        requestStartTimeSeconds = new Date().getTime()/1000;
        self.__segmentLoadXhr = loadSegment(segment, success, fail, self);
    }
};

// Add event dispatcher functionality to prototype.
extendObject(MediaTypeLoader.prototype, EventDispatcherMixin);

module.exports = MediaTypeLoader;