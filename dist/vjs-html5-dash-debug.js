(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
if (typeof window !== "undefined") {
    module.exports = window;
} else if (typeof global !== "undefined") {
    module.exports = global;
} else if (typeof self !== "undefined"){
    module.exports = self;
} else {
    module.exports = {};
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],2:[function(require,module,exports){
'use strict';

var existy = require('./util/existy.js'),
    getMediaTypeFromMimeType = require('./util/getMediaTypeFromMimeType.js'),
    getSegmentListForRepresentation = require('./dash/segments/getSegmentListForRepresentation.js'),
    findElementInArray = require('./util/findElementInArray.js'),
    mediaTypes = require('./manifest/MediaTypes.js');

/**
 *
 * Primary data view for representing the set of segment lists and other general information for a give media type
 * (e.g. 'audio' or 'video').
 *
 * @param adaptationSet The MPEG-DASH correlate for a given media set, containing some way of representating segment lists
 *                      and a set of representations for each stream variant.
 * @constructor
 */
function MediaSet(adaptationSet) {
    // TODO: Additional checks & Error Throwing
    this.__adaptationSet = adaptationSet;
}

MediaSet.prototype.getMediaType = function getMediaType() {
    var type = getMediaTypeFromMimeType(this.getMimeType(), mediaTypes);
    return type;
};

MediaSet.prototype.getMimeType = function getMimeType() {
    var mimeType = this.__adaptationSet.getMimeType();
    return mimeType;
};

MediaSet.prototype.getSourceBufferType = function getSourceBufferType() {
    // NOTE: Currently assuming the codecs associated with each stream variant/representation
    // will be similar enough that you won't have to re-create the source-buffer when switching
    // between them.

    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation);
    return segmentList.getType();
};

MediaSet.prototype.getTotalDuration = function getTotalDuration() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation),
        totalDuration = segmentList.getTotalDuration();
    return totalDuration;
};

MediaSet.prototype.getUTCWallClockStartTime = function() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation),
        wallClockTime = segmentList.getUTCWallClockStartTime();
    return wallClockTime;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getTotalSegmentCount = function getTotalSegmentCount() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation),
        totalSegmentCount = segmentList.getTotalSegmentCount();
    return totalSegmentCount;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case in actual practice, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getSegmentDuration = function getSegmentDuration() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation),
        segmentDuration = segmentList.getSegmentDuration();
    return segmentDuration;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case in actual practice, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getSegmentListStartNumber = function getSegmentListStartNumber() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation),
        segmentListStartNumber = segmentList.getStartNumber();
    return segmentListStartNumber;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case in actual practice, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getSegmentListEndNumber = function getSegmentListEndNumber() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        segmentList = getSegmentListForRepresentation(representation),
        segmentListEndNumber = segmentList.getEndNumber();
    return segmentListEndNumber;
};


MediaSet.prototype.getSegmentLists = function getSegmentLists() {
    var representations = this.__adaptationSet.getRepresentations(),
        segmentLists = representations.map(getSegmentListForRepresentation);
    return segmentLists;
};

MediaSet.prototype.getSegmentListByBandwidth = function getSegmentListByBandwidth(bandwidth) {
    var representations = this.__adaptationSet.getRepresentations(),
        representationWithBandwidthMatch = findElementInArray(representations, function(representation) {
            var representationBandwidth = representation.getBandwidth();
            return (Number(representationBandwidth) === Number(bandwidth));
        }),
        segmentList = getSegmentListForRepresentation(representationWithBandwidthMatch);
    return segmentList;
};

MediaSet.prototype.getAvailableBandwidths = function getAvailableBandwidths() {
    return this.__adaptationSet.getRepresentations().map(
        function(representation) {
            return Number(representation.getBandwidth());
        }).filter(
        function(bandwidth) {
            return existy(bandwidth);
        }
    );
};

module.exports = MediaSet;
},{"./dash/segments/getSegmentListForRepresentation.js":9,"./manifest/MediaTypes.js":16,"./util/existy.js":20,"./util/findElementInArray.js":22,"./util/getMediaTypeFromMimeType.js":23}],3:[function(require,module,exports){
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
},{"./events/EventDispatcherMixin.js":11,"./segments/loadSegment.js":18,"./util/existy.js":20,"./util/extendObject.js":21,"./util/isNumber.js":26}],4:[function(require,module,exports){
'use strict';

var existy = require('./util/existy.js'),
    SourceBufferDataQueue = require('./SourceBufferDataQueue.js'),
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
    var sourceBufferDataQueue = createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType);
    return new MediaTypeLoader(manifestController, mediaType, sourceBufferDataQueue, tech);
}

/**
 *
 * Factory-style function for creating a set of MediaTypeLoaders based on what's defined in the manifest and what media types are supported.
 *
 * @param manifestController {ManifestController}   controller that provides data views for the ABR playlist manifest data
 * @param mediaSource {MediaSource}                 MSE MediaSource instance corresponding to the current ABR playlist
 * @param tech {object}                             video.js Html5 tech object instance
 * @returns {Array.<MediaTypeLoader>}               Set of MediaTypeLoaders for loading segments for a given media type (e.g. audio or video)
 */
function createMediaTypeLoaders(manifestController, mediaSource, tech) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return exists; }),
        mediaTypeLoaders = matchedTypes.map(function(mediaType) { return createMediaTypeLoaderForType(manifestController, mediaSource, mediaType, tech); });
    return mediaTypeLoaders;
}

/**
 *
 * PlaylistLoader handles the top-level loading and playback of segments for all media types (e.g. both audio and video).
 * This includes checking if it should switch segment lists, updating/retrieving data relevant to these decision for
 * each media type. It also includes changing the playback rate of the video based on data available in the source buffer.
 *
 * @param manifestController {ManifestController}   controller that provides data views for the ABR playlist manifest data
 * @param mediaSource {MediaSource}                 MSE MediaSource instance corresponding to the current ABR playlist
 * @param tech {object}                             video.js Html5 tech object instance
 * @constructor
 */
function PlaylistLoader(manifestController, mediaSource, tech) {
    this.__tech = tech;
    this.__mediaTypeLoaders = createMediaTypeLoaders(manifestController, mediaSource, tech);

    var i;

    function kickoffMediaTypeLoader(mediaTypeLoader) {
        // MediaSet-specific variables
        var downloadRateRatio = 1.0,
            currentSegmentListBandwidth = mediaTypeLoader.getCurrentBandwidth(),
            mediaType = mediaTypeLoader.getMediaType();

        // Listen for event telling us to recheck which segment list the segments should be loaded from.
        mediaTypeLoader.on(mediaTypeLoader.eventList.RECHECK_CURRENT_SEGMENT_LIST, function(event) {
            var mediaSet = manifestController.getMediaSetByType(mediaType),
                isFullscreen = tech.player().isFullscreen(),
                data = {},
                selectedSegmentList;

            data.downloadRateRatio = downloadRateRatio;
            data.currentSegmentListBandwidth = currentSegmentListBandwidth;

            // Rather than monitoring events/updating state, simply get relevant video viewport dims on the fly as needed.
            data.width = isFullscreen ? window.screen.width : tech.player().width();
            data.height = isFullscreen ? window.screen.height : tech.player().height();

            selectedSegmentList = selectSegmentList(mediaSet, data);

            // TODO: Should we refactor to set based on segmentList instead?
            // (Potentially) update which segment list the segments should be loaded from (based on segment list's bandwidth/bitrate)
            mediaTypeLoader.setCurrentBandwidth(selectedSegmentList.getBandwidth());
        });

        // Update the download rate (round trip time to download a segment of a given average bandwidth/bitrate) to use
        // with choosing which stream variant to load segments from.
        mediaTypeLoader.on(mediaTypeLoader.eventList.DOWNLOAD_DATA_UPDATE, function(event) {
            downloadRateRatio = event.data.playbackTime / event.data.rtt;
            currentSegmentListBandwidth = event.data.bandwidth;
        });

        // Kickoff segment loading for the media type.
        mediaTypeLoader.startLoadingSegments();
    }

    // For each of the media types (e.g. 'audio' & 'video') in the ABR manifest...
    for (i=0; i<this.__mediaTypeLoaders.length; i++) {
        kickoffMediaTypeLoader(this.__mediaTypeLoaders[i]);
    }

    // NOTE: This code block handles pseudo-'pausing'/'unpausing' (changing the playbackRate) based on whether or not
    // there is data available in the buffer, but indirectly, by listening to a few events and using the video element's
    // ready state.
    var changePlaybackRateEvents = ['seeking', 'canplay', 'canplaythrough'],
        eventType;

    function changePlaybackRateEventsHandler(event) {
        var readyState = tech.el().readyState,
            playbackRate = (readyState === 4) ? 1 : 0;
        tech.setPlaybackRate(playbackRate);
    }

    for(i=0; i<changePlaybackRateEvents.length; i++) {
        eventType = changePlaybackRateEvents[i];
        tech.on(eventType, changePlaybackRateEventsHandler);
    }
}

module.exports = PlaylistLoader;
},{"./MediaTypeLoader.js":3,"./SourceBufferDataQueue.js":5,"./manifest/MediaTypes.js":16,"./selectSegmentList.js":19,"./util/existy.js":20}],5:[function(require,module,exports){
'use strict';

var isFunction = require('./util/isFunction.js'),
    isArray = require('./util/isArray.js'),
    isNumber = require('./util/isNumber.js'),
    existy = require('./util/existy.js'),
    extendObject = require('./util/extendObject.js'),
    EventDispatcherMixin = require('./events/EventDispatcherMixin.js');

function createTimeRangeObject(sourceBuffer, index, transformFn) {
    if (!isFunction(transformFn)) {
        transformFn = function(time) { return time; };
    }

    return {
        getStart: function() { return transformFn(sourceBuffer.buffered.start(index)); },
        getEnd: function() { return transformFn(sourceBuffer.buffered.end(index)); },
        getIndex: function() { return index; }
    };
}

function createBufferedTimeRangeList(sourceBuffer, transformFn) {
    return {
        getLength: function() { return sourceBuffer.buffered.length; },
        getTimeRangeByIndex: function(index) { return createTimeRangeObject(sourceBuffer, index, transformFn); },
        getTimeRangeByTime: function(time, tolerance) {
            if (!isNumber(tolerance)) { tolerance = 0.15; }
            var timeRangeObj,
                i,
                length = sourceBuffer.buffered.length;

            for (i=0; i<length; i++) {
                timeRangeObj = createTimeRangeObject(sourceBuffer, i, transformFn);
                if ((timeRangeObj.getStart() - tolerance) > time) { return null; }
                if ((timeRangeObj.getEnd() + tolerance) > time) { return timeRangeObj; }
            }

            return null;
        }
    };
}

function createAlignedBufferedTimeRangeList(sourceBuffer, segmentDuration) {
    function timeAlignTransformFn(time) {
        return Math.round(time / segmentDuration) * segmentDuration;
    }

    return createBufferedTimeRangeList(sourceBuffer, timeAlignTransformFn);
}

/**
 * SourceBufferDataQueue adds/queues segments to the corresponding MSE SourceBuffer (NOTE: There should be one per media type/media set)
 *
 * @param sourceBuffer {SourceBuffer}   MSE SourceBuffer instance
 * @constructor
 */
function SourceBufferDataQueue(sourceBuffer) {
    // TODO: Check type?
    if (!sourceBuffer) { throw new Error( 'The sourceBuffer constructor argument cannot be null.' ); }

    var self = this,
        dataQueue = [];
    // TODO: figure out how we want to respond to other event states (updateend? error? abort?) (retry? remove?)
    sourceBuffer.addEventListener('updateend', function(event) {
        // The SourceBuffer instance's updating property should always be false if this event was dispatched,
        // but just in case...
        if (event.target.updating) { return; }

        self.trigger({ type:self.eventList.SEGMENT_ADDED_TO_BUFFER, target:self });

        if (self.__dataQueue.length <= 0) {
            self.trigger({ type:self.eventList.QUEUE_EMPTY, target:self });
            return;
        }

        self.__sourceBuffer.appendBuffer(self.__dataQueue.shift());
    });

    this.__dataQueue = dataQueue;
    this.__sourceBuffer = sourceBuffer;
}

/**
 * Enumeration of events instances of this object will dispatch.
 */
SourceBufferDataQueue.prototype.eventList = {
    QUEUE_EMPTY: 'queueEmpty',
    SEGMENT_ADDED_TO_BUFFER: 'segmentAddedToBuffer'
};

SourceBufferDataQueue.prototype.addToQueue = function(data) {
    var dataToAddImmediately;
    if (!existy(data) || (isArray(data) && data.length <= 0)) { return; }
    // Treat all data as arrays to make subsequent functionality generic.
    if (!isArray(data)) { data = [data]; }
    // If nothing is in the queue, go ahead and immediately append the first data to the source buffer.
    if ((this.__dataQueue.length === 0) && (!this.__sourceBuffer.updating)) { dataToAddImmediately = data.shift(); }
    // If any other data (still) exists, push the rest onto the dataQueue.
    this.__dataQueue = this.__dataQueue.concat(data);
    if (existy(dataToAddImmediately)) { this.__sourceBuffer.appendBuffer(dataToAddImmediately); }
};

SourceBufferDataQueue.prototype.clearQueue = function() {
    this.__dataQueue = [];
};

SourceBufferDataQueue.prototype.getBufferedTimeRangeList = function() {
    return createBufferedTimeRangeList(this.__sourceBuffer);
};

SourceBufferDataQueue.prototype.getBufferedTimeRangeListAlignedToSegmentDuration = function(segmentDuration) {
    return createAlignedBufferedTimeRangeList(this.__sourceBuffer, segmentDuration);
};

// Add event dispatcher functionality to prototype.
extendObject(SourceBufferDataQueue.prototype, EventDispatcherMixin);

module.exports = SourceBufferDataQueue;
},{"./events/EventDispatcherMixin.js":11,"./util/existy.js":20,"./util/extendObject.js":21,"./util/isArray.js":24,"./util/isFunction.js":25,"./util/isNumber.js":26}],6:[function(require,module,exports){
'use strict';

var MediaSource = require('global/window').MediaSource,
    ManifestController = require('./manifest/ManifestController.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

// TODO: DISPOSE METHOD
/**
 *
 * Class that defines the root context for handling a specific MPEG-DASH media source.
 *
 * @param source    video.js source object providing information about the source, such as the uri (src) and the type (type)
 * @param tech      video.js Html5 tech object providing the point of interaction between the SourceHandler instance and
 *                  the video.js library (including e.g. the video element)
 * @constructor
 */
function SourceHandler(source, tech) {
    var self = this,
        manifestController = new ManifestController(source.src, false);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        var mediaSource = new MediaSource(),
            openListener = function(event) {
                mediaSource.removeEventListener('sourceopen', openListener, false);
                self.__playlistLoader = new PlaylistLoader(manifestController, mediaSource, tech);
            };

        mediaSource.addEventListener('sourceopen', openListener, false);

        // TODO: Handle close.
        //mediaSource.addEventListener('webkitsourceclose', closed, false);
        //mediaSource.addEventListener('sourceclose', closed, false);

        tech.setSrc(URL.createObjectURL(mediaSource));
    });

    manifestController.load();
}

module.exports = SourceHandler;

},{"./PlaylistLoader.js":4,"./manifest/ManifestController.js":15,"global/window":1}],7:[function(require,module,exports){
'use strict';

var parseRootUrl,
    // TODO: Should presentationDuration parsing be in util or somewhere else?
    parseMediaPresentationDuration,
    parseDateTime,
    SECONDS_IN_YEAR = 365 * 24 * 60 * 60,
    SECONDS_IN_MONTH = 30 * 24 * 60 * 60, // not precise!
    SECONDS_IN_DAY = 24 * 60 * 60,
    SECONDS_IN_HOUR = 60 * 60,
    SECONDS_IN_MIN = 60,
    MINUTES_IN_HOUR = 60,
    MILLISECONDS_IN_SECONDS = 1000,
    durationRegex = /^P(([\d.]*)Y)?(([\d.]*)M)?(([\d.]*)D)?T?(([\d.]*)H)?(([\d.]*)M)?(([\d.]*)S)?/,
    dateTimeRegex = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]*)(\.[0-9]*)?)?(?:([+-])([0-9]{2})([0-9]{2}))?/;

parseRootUrl = function(url) {
    if (typeof url !== 'string') {
        return '';
    }

    if (url.indexOf('/') === -1) {
        return '';
    }

    if (url.indexOf('?') !== -1) {
        url = url.substring(0, url.indexOf('?'));
    }

    return url.substring(0, url.lastIndexOf('/') + 1);
};

// TODO: Should presentationDuration parsing be in util or somewhere else?
parseMediaPresentationDuration = function (str) {
    //str = "P10Y10M10DT10H10M10.1S";
    if (!str) { return Number.NaN; }
    var match = durationRegex.exec(str);
    if (!match) { return Number.NaN; }
    return (parseFloat(match[2] || 0) * SECONDS_IN_YEAR +
        parseFloat(match[4] || 0) * SECONDS_IN_MONTH +
        parseFloat(match[6] || 0) * SECONDS_IN_DAY +
        parseFloat(match[8] || 0) * SECONDS_IN_HOUR +
        parseFloat(match[10] || 0) * SECONDS_IN_MIN +
        parseFloat(match[12] || 0));
};

/**
 * Parser for formatted datetime strings conforming to the ISO 8601 standard.
 * General Format:  YYYY-MM-DDTHH:MM:SSZ (UTC) or YYYY-MM-DDTHH:MM:SS+HH:MM (time zone localization)
 * Ex String:       2014-12-17T14:09:58Z (UTC) or 2014-12-17T14:15:58+06:00 (time zone localization) / 2014-12-17T14:03:58-06:00 (time zone localization)
 *
 * @param str {string}  ISO 8601-compliant datetime string.
 * @returns {number} UTC Unix time.
 */
parseDateTime = function(str) {
    var match = dateTimeRegex.exec(str),
        utcDate;

    // If the string does not contain a timezone offset different browsers can interpret it either
    // as UTC or as a local time so we have to parse the string manually to normalize the given date value for
    // all browsers
    utcDate = Date.UTC(
        parseInt(match[1], 10),
        parseInt(match[2], 10)-1, // months start from zero
        parseInt(match[3], 10),
        parseInt(match[4], 10),
        parseInt(match[5], 10),
        (match[6] && parseInt(match[6], 10) || 0),
        (match[7] && parseFloat(match[7]) * MILLISECONDS_IN_SECONDS) || 0);
    // If the date has timezone offset take it into account as well
    if (match[9] && match[10]) {
        var timezoneOffset = parseInt(match[9], 10) * MINUTES_IN_HOUR + parseInt(match[10], 10);
        utcDate += (match[8] === '+' ? -1 : +1) * timezoneOffset * SECONDS_IN_MIN * MILLISECONDS_IN_SECONDS;
    }

    return utcDate;
};

var dashUtil = {
    parseRootUrl: parseRootUrl,
    parseMediaPresentationDuration: parseMediaPresentationDuration,
    parseDateTime: parseDateTime
};

module.exports = function getDashUtil() { return dashUtil; };
},{}],8:[function(require,module,exports){
'use strict';

var getXmlFun = require('../../getXmlFun.js'),
    xmlFun = getXmlFun(),
    getDashUtil = require('./getDashUtil.js'),
    dashUtil = getDashUtil(),
    isArray = require('../../util/isArray.js'),
    isFunction = require('../../util/isFunction.js'),
    isString = require('../../util/isString.js'),
    parseRootUrl = dashUtil.parseRootUrl,
    createMpdObject,
    createPeriodObject,
    createAdaptationSetObject,
    createRepresentationObject,
    createSegmentTemplate,
    getMpd,
    getAdaptationSetByType,
    getDescendantObjectsArrayByName,
    getAncestorObjectByName;

// TODO: Should this exist on mpd dataview or at a higher level?
// TODO: Refactor. Could be more efficient (Recursive fn? Use element.getElementsByName('BaseUrl')[0]?).
// TODO: Currently assuming *EITHER* <BaseURL> nodes will provide an absolute base url (ie resolve to 'http://' etc)
// TODO: *OR* we should use the base url of the host of the MPD manifest.
var buildBaseUrl = function(xmlNode) {
    var elemHierarchy = [xmlNode].concat(xmlFun.getAncestors(xmlNode)),
        foundLocalBaseUrl = false;
    var baseUrls = elemHierarchy.map(function(elem) {
        if (foundLocalBaseUrl) { return ''; }
        if (!elem.hasChildNodes()) { return ''; }
        var child;
        for (var i=0; i<elem.childNodes.length; i++) {
            child = elem.childNodes.item(i);
            if (child.nodeName === 'BaseURL') {
                var textElem = child.childNodes.item(0);
                var textValue = textElem.wholeText.trim();
                if (textValue.indexOf('http://') === 0) { foundLocalBaseUrl = true; }
                return textElem.wholeText.trim();
            }
        }

        return '';
    });

    var baseUrl = baseUrls.reverse().join('');
    if (!baseUrl) { return parseRootUrl(xmlNode.baseURI); }
    return baseUrl;
};

var elemsWithCommonProperties = [
    'AdaptationSet',
    'Representation',
    'SubRepresentation'
];

var hasCommonProperties = function(elem) {
    return elemsWithCommonProperties.indexOf(elem.nodeName) >= 0;
};

var doesntHaveCommonProperties = function(elem) {
    return !hasCommonProperties(elem);
};

// Common Attrs
var getWidth = xmlFun.getInheritableAttribute('width'),
    getHeight = xmlFun.getInheritableAttribute('height'),
    getFrameRate = xmlFun.getInheritableAttribute('frameRate'),
    getMimeType = xmlFun.getInheritableAttribute('mimeType'),
    getCodecs = xmlFun.getInheritableAttribute('codecs');

var getSegmentTemplateXmlList = xmlFun.getMultiLevelElementList('SegmentTemplate');

// MPD Attr fns
var getMediaPresentationDuration = xmlFun.getAttrFn('mediaPresentationDuration'),
    getType = xmlFun.getAttrFn('type'),
    getMinimumUpdatePeriod = xmlFun.getAttrFn('minimumUpdatePeriod'),
    getAvailabilityStartTime = xmlFun.getAttrFn('availabilityStartTime'),
    getSuggestedPresentationDelay = xmlFun.getAttrFn('suggestedPresentationDelay'),
    getTimeShiftBufferDepth = xmlFun.getAttrFn('timeShiftBufferDepth');

// Representation Attr fns
var getId = xmlFun.getAttrFn('id'),
    getBandwidth = xmlFun.getAttrFn('bandwidth');

// SegmentTemplate Attr fns
var getInitialization = xmlFun.getAttrFn('initialization'),
    getMedia = xmlFun.getAttrFn('media'),
    getDuration = xmlFun.getAttrFn('duration'),
    getTimescale = xmlFun.getAttrFn('timescale'),
    getPresentationTimeOffset = xmlFun.getAttrFn('presentationTimeOffset'),
    getStartNumber = xmlFun.getAttrFn('startNumber');

// TODO: Repeat code. Abstract away (Prototypal Inheritance/OO Model? Object composer fn?)
createMpdObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getPeriods: xmlFun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'Period', createPeriodObject),
        getMediaPresentationDuration: xmlFun.preApplyArgsFn(getMediaPresentationDuration, xmlNode),
        getType: xmlFun.preApplyArgsFn(getType, xmlNode),
        getMinimumUpdatePeriod: xmlFun.preApplyArgsFn(getMinimumUpdatePeriod, xmlNode),
        getAvailabilityStartTime: xmlFun.preApplyArgsFn(getAvailabilityStartTime, xmlNode),
        getSuggestedPresentationDelay: xmlFun.preApplyArgsFn(getSuggestedPresentationDelay, xmlNode),
        getTimeShiftBufferDepth: xmlFun.preApplyArgsFn(getTimeShiftBufferDepth, xmlNode)
    };
};

createPeriodObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getAdaptationSets: xmlFun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getAdaptationSetByType: function(type) {
            return getAdaptationSetByType(type, xmlNode);
        },
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject)
    };
};

createAdaptationSetObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getRepresentations: xmlFun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'Representation', createRepresentationObject),
        getSegmentTemplate: function() {
            return createSegmentTemplate(getSegmentTemplateXmlList(xmlNode));
        },
        getPeriod: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getMimeType: xmlFun.preApplyArgsFn(getMimeType, xmlNode)
    };
};

createRepresentationObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getSegmentTemplate: function() {
            return createSegmentTemplate(getSegmentTemplateXmlList(xmlNode));
        },
        getAdaptationSet: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getId: xmlFun.preApplyArgsFn(getId, xmlNode),
        getWidth: xmlFun.preApplyArgsFn(getWidth, xmlNode),
        getHeight: xmlFun.preApplyArgsFn(getHeight, xmlNode),
        getFrameRate: xmlFun.preApplyArgsFn(getFrameRate, xmlNode),
        getBandwidth: xmlFun.preApplyArgsFn(getBandwidth, xmlNode),
        getCodecs: xmlFun.preApplyArgsFn(getCodecs, xmlNode),
        getBaseUrl: xmlFun.preApplyArgsFn(buildBaseUrl, xmlNode),
        getMimeType: xmlFun.preApplyArgsFn(getMimeType, xmlNode)
    };
};

createSegmentTemplate = function(xmlArray) {
    // Effectively a find function + a map function.
    function getAttrFromXmlArray(attrGetterFn, xmlArray) {
        if (!isArray(xmlArray)) { return undefined; }
        if (!isFunction(attrGetterFn)) { return undefined; }

        var i,
            length = xmlArray.length,
            currentAttrValue;

        for (i=0; i<xmlArray.length; i++) {
            currentAttrValue = attrGetterFn(xmlArray[i]);
            if (isString(currentAttrValue) && currentAttrValue !== '') { return currentAttrValue; }
        }

        return undefined;
    }

    return {
        xml: xmlArray,
        // Descendants, Ancestors, & Siblings
        getAdaptationSet: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'Period', createPeriodObject),
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'MPD', createMpdObject),
        // Attrs
        getInitialization: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getInitialization, xmlArray),
        getMedia: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getMedia, xmlArray),
        getDuration: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getDuration, xmlArray),
        getTimescale: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getTimescale, xmlArray),
        getPresentationTimeOffset: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getPresentationTimeOffset, xmlArray),
        getStartNumber: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getStartNumber, xmlArray)
    };
};

// TODO: Change this api to return a list of all matching adaptation sets to allow for greater flexibility.
getAdaptationSetByType = function(type, periodXml) {
    var adaptationSets = periodXml.getElementsByTagName('AdaptationSet'),
        adaptationSet,
        representation,
        mimeType;

    for (var i=0; i<adaptationSets.length; i++) {
        adaptationSet = adaptationSets.item(i);
        // Since the mimeType can be defined on the AdaptationSet or on its Representation child nodes,
        // check for mimetype on one of its Representation children using getMimeType(), which assumes the
        // mimeType can be inherited and will check itself and its ancestors for the attr.
        representation = adaptationSet.getElementsByTagName('Representation')[0];
        // Need to check the representation instead of the adaptation set, since the mimeType may not be specified
        // on the adaptation set at all and may be specified for each of the representations instead.
        mimeType = getMimeType(representation);
        if (!!mimeType && mimeType.indexOf(type) >= 0) { return createAdaptationSetObject(adaptationSet); }
    }

    return null;
};

getMpd = function(manifestXml) {
    return getDescendantObjectsArrayByName(manifestXml, 'MPD', createMpdObject)[0];
};

// TODO: Move to xmlFun or own module.
getDescendantObjectsArrayByName = function(parentXml, tagName, mapFn) {
    var descendantsXmlArray = Array.prototype.slice.call(parentXml.getElementsByTagName(tagName));
    /*if (typeof mapFn === 'function') { return descendantsXmlArray.map(mapFn); }*/
    if (typeof mapFn === 'function') {
        var mappedElem = descendantsXmlArray.map(mapFn);
        return  mappedElem;
    }
    return descendantsXmlArray;
};

// TODO: Move to xmlFun or own module.
getAncestorObjectByName = function getAncestorObjectByName(xmlNode, tagName, mapFn) {
    if (!tagName || !xmlNode || !xmlNode.parentNode) { return null; }
    if (!xmlNode.parentNode.nodeName) { return null; }

    if (xmlNode.parentNode.nodeName === tagName) {
        return isFunction(mapFn) ? mapFn(xmlNode.parentNode) : xmlNode.parentNode;
    }
    return getAncestorObjectByName(xmlNode.parentNode, tagName, mapFn);
};

module.exports = getMpd;
},{"../../getXmlFun.js":13,"../../util/isArray.js":24,"../../util/isFunction.js":25,"../../util/isString.js":27,"./getDashUtil.js":7}],9:[function(require,module,exports){
'use strict';

var existy = require('../../util/existy.js'),
    getXmlFun = require('../../getXmlFun.js'),
    xmlFun = getXmlFun(),
    getDashUtil = require('../mpd/getDashUtil.js'),
    dashUtil = getDashUtil(),
    parseMediaPresentationDuration = dashUtil.parseMediaPresentationDuration,
    parseDateTime = dashUtil.parseDateTime,
    getSegmentTemplate = require('./getSegmentTemplate'),
    segmentTemplate = getSegmentTemplate(),
    createSegmentListFromTemplate,
    createSegmentFromTemplateByNumber,
    createSegmentFromTemplateByTime,
    createSegmentFromTemplateByUTCWallClockTime,
    getType,
    getIsLive,
    getBandwidth,
    getWidth,
    getHeight,
    getTotalDurationFromTemplate,
    getUTCWallClockStartTimeFromTemplate,
    getTimeShiftBufferDepth,
    getSegmentDurationFromTemplate,
    getTotalSegmentCountFromTemplate,
    getStartNumberFromTemplate,
    getEndNumberFromTemplate;


/**
 *
 * Function used to get the 'type' of a DASH Representation in a format expected by the MSE SourceBuffer. Used to
 * create SourceBuffer instances that correspond to a given MediaSet (e.g. set of audio stream variants, video stream
 * variants, etc.).
 *
 * @param representation    POJO DASH MPD Representation
 * @returns {string}        The Representation's 'type' in a format expected by the MSE SourceBuffer
 */
getType = function(representation) {
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
};

getIsLive = function(representation) {
    return (representation.getMpd().getType() === 'dynamic');
};

getBandwidth = function(representation) {
    var bandwidth = representation.getBandwidth();
    return existy(bandwidth) ? Number(bandwidth) : undefined;
};

getWidth = function(representation) {
    var width = representation.getWidth();
    return existy(width) ? Number(width) : undefined;
};

getHeight = function(representation) {
    var height = representation.getHeight();
    return existy(height) ? Number(height) : undefined;
};

getTotalDurationFromTemplate = function(representation) {
    // TODO: Support period-relative presentation time
    var mediaPresentationDuration = representation.getMpd().getMediaPresentationDuration(),
        parsedMediaPresentationDuration = existy(mediaPresentationDuration) ? parseMediaPresentationDuration(mediaPresentationDuration) : Number.NaN,
        presentationTimeOffset = Number(representation.getSegmentTemplate().getPresentationTimeOffset()) || 0;
    return existy(parsedMediaPresentationDuration) ? Number(parsedMediaPresentationDuration - presentationTimeOffset) : Number.NaN;
};

getUTCWallClockStartTimeFromTemplate = function(representation) {
    var wallClockTimeStr = representation.getMpd().getAvailabilityStartTime(),
        wallClockUnixTimeUtc = parseDateTime(wallClockTimeStr);
    return wallClockUnixTimeUtc;
};

getTimeShiftBufferDepth = function(representation) {
    var timeShiftBufferDepthStr = representation.getMpd().getTimeShiftBufferDepth(),
        parsedTimeShiftBufferDepth = parseMediaPresentationDuration(timeShiftBufferDepthStr);
    return parsedTimeShiftBufferDepth;
};

getSegmentDurationFromTemplate = function(representation) {
    var segmentTemplate = representation.getSegmentTemplate();
    return Number(segmentTemplate.getDuration()) / Number(segmentTemplate.getTimescale());
};

getTotalSegmentCountFromTemplate = function(representation) {
    return Math.ceil(getTotalDurationFromTemplate(representation) / getSegmentDurationFromTemplate(representation));
};

getStartNumberFromTemplate = function(representation) {
    return Number(representation.getSegmentTemplate().getStartNumber());
};

getEndNumberFromTemplate = function(representation) {
    return getTotalSegmentCountFromTemplate(representation) + getStartNumberFromTemplate(representation) - 1;
};

createSegmentListFromTemplate = function(representationXml) {
    return {
        getType: xmlFun.preApplyArgsFn(getType, representationXml),
        getIsLive: xmlFun.preApplyArgsFn(getIsLive, representationXml),
        getBandwidth: xmlFun.preApplyArgsFn(getBandwidth, representationXml),
        getHeight: xmlFun.preApplyArgsFn(getHeight, representationXml),
        getWidth: xmlFun.preApplyArgsFn(getWidth, representationXml),
        getTotalDuration: xmlFun.preApplyArgsFn(getTotalDurationFromTemplate, representationXml),
        getSegmentDuration: xmlFun.preApplyArgsFn(getSegmentDurationFromTemplate, representationXml),
        getUTCWallClockStartTime: xmlFun.preApplyArgsFn(getUTCWallClockStartTimeFromTemplate, representationXml),
        getTimeShiftBufferDepth: xmlFun.preApplyArgsFn(getTimeShiftBufferDepth, representationXml),
        getTotalSegmentCount: xmlFun.preApplyArgsFn(getTotalSegmentCountFromTemplate, representationXml),
        getStartNumber: xmlFun.preApplyArgsFn(getStartNumberFromTemplate, representationXml),
        getEndNumber: xmlFun.preApplyArgsFn(getEndNumberFromTemplate, representationXml),
        // TODO: Externalize
        getInitialization: function() {
            var initialization = {};
            initialization.getUrl = function() {
                var baseUrl = representationXml.getBaseUrl(),
                    representationId = representationXml.getId(),
                    initializationRelativeUrlTemplate = representationXml.getSegmentTemplate().getInitialization(),
                    initializationRelativeUrl = segmentTemplate.replaceIDForTemplate(initializationRelativeUrlTemplate, representationId);

                initializationRelativeUrl = segmentTemplate.replaceTokenForTemplate(initializationRelativeUrl, 'Bandwidth', representationXml.getBandwidth());
                return baseUrl + initializationRelativeUrl;
            };
            return initialization;
        },
        getSegmentByNumber: function(number) { return createSegmentFromTemplateByNumber(representationXml, number); },
        getSegmentByTime: function(seconds) { return createSegmentFromTemplateByTime(representationXml, seconds); },
        getSegmentByUTCWallClockTime: function(utcMilliseconds) { return createSegmentFromTemplateByUTCWallClockTime(representationXml, utcMilliseconds); }
    };
};

createSegmentFromTemplateByNumber = function(representation, number) {
    var segment = {};
    segment.getUrl = function() {
        var baseUrl = representation.getBaseUrl(),
            segmentRelativeUrlTemplate = representation.getSegmentTemplate().getMedia(),
            replacedIdUrl = segmentTemplate.replaceIDForTemplate(segmentRelativeUrlTemplate, representation.getId()),
            replacedTokensUrl;
            // TODO: Since $Time$-templated segment URLs should only exist in conjunction w/a <SegmentTimeline>,
            // TODO: can currently assume a $Number$-based templated url.
            // TODO: Enforce min/max number range (based on segmentList startNumber & endNumber)
        replacedTokensUrl = segmentTemplate.replaceTokenForTemplate(replacedIdUrl, 'Number', number);
        replacedTokensUrl = segmentTemplate.replaceTokenForTemplate(replacedTokensUrl, 'Bandwidth', representation.getBandwidth());

        return baseUrl + replacedTokensUrl;
    };
    segment.getStartTime = function() {
        return (number - getStartNumberFromTemplate(representation)) * getSegmentDurationFromTemplate(representation);
    };
    segment.getUTCWallClockStartTime = function() {
        return getUTCWallClockStartTimeFromTemplate(representation) + Math.round(((number - getStartNumberFromTemplate(representation)) * getSegmentDurationFromTemplate(representation)) * 1000);
    };
    segment.getDuration = function() {
        // TODO: Verify
        var standardSegmentDuration = getSegmentDurationFromTemplate(representation),
            duration,
            mediaPresentationTime,
            precisionMultiplier;

        if (getEndNumberFromTemplate(representation) === number) {
            mediaPresentationTime = Number(getTotalDurationFromTemplate(representation));
            // Handle floating point precision issue
            precisionMultiplier = 1000;
            duration = (((mediaPresentationTime * precisionMultiplier) % (standardSegmentDuration * precisionMultiplier)) / precisionMultiplier );
        } else {
            duration = standardSegmentDuration;
        }
        return duration;
    };
    segment.getNumber = function() { return number; };
    return segment;
};

createSegmentFromTemplateByTime = function(representation, seconds) {
    var segmentDuration = getSegmentDurationFromTemplate(representation),
        startNumber = getStartNumberFromTemplate(representation) || 0,
        number = Math.floor(seconds / segmentDuration) + startNumber,
        segment = createSegmentFromTemplateByNumber(representation, number);

    // If we're really close to the end time of the current segment (start time + duration),
    // this means we're really close to the start time of the next segment.
    // Therefore, assume this is a floating-point precision issue where we were trying to grab a segment
    // by its start time and return the next segment instead.
    if (((segment.getStartTime() + segment.getDuration()) - seconds) <= 0.003 ) {
        return createSegmentFromTemplateByNumber(representation, number + 1);
    }

    return segment;
};

createSegmentFromTemplateByUTCWallClockTime = function(representation, unixTimeUtcMilliseconds) {
    var wallClockStartTime = getUTCWallClockStartTimeFromTemplate(representation),
        presentationTime;
    if (isNaN(wallClockStartTime)) { return null; }
    presentationTime = (unixTimeUtcMilliseconds - wallClockStartTime)/1000;
    if (isNaN(presentationTime)) { return null; }
    return createSegmentFromTemplateByTime(representation, presentationTime);
};

function getSegmentListForRepresentation(representation) {
    if (!representation) { return undefined; }
    if (representation.getSegmentTemplate()) { return createSegmentListFromTemplate(representation); }
    return undefined;
}

module.exports = getSegmentListForRepresentation;

},{"../../getXmlFun.js":13,"../../util/existy.js":20,"../mpd/getDashUtil.js":7,"./getSegmentTemplate":10}],10:[function(require,module,exports){
'use strict';

var segmentTemplate,
    zeroPadToLength,
    replaceTokenForTemplate,
    unescapeDollarsInTemplate,
    replaceIDForTemplate;

zeroPadToLength = function (numStr, minStrLength) {
    while (numStr.length < minStrLength) {
        numStr = '0' + numStr;
    }

    return numStr;
};

replaceTokenForTemplate = function (templateStr, token, value) {

    var startPos = 0,
        endPos = 0,
        tokenLen = token.length,
        formatTag = '%0',
        formatTagLen = formatTag.length,
        formatTagPos,
        specifier,
        width,
        paddedValue;

    // keep looping round until all instances of <token> have been
    // replaced. once that has happened, startPos below will be -1
    // and the completed url will be returned.
    while (true) {

        // check if there is a valid $<token>...$ identifier
        // if not, return the url as is.
        startPos = templateStr.indexOf('$' + token);
        if (startPos < 0) {
            return templateStr;
        }

        // the next '$' must be the end of the identifer
        // if there isn't one, return the url as is.
        endPos = templateStr.indexOf('$', startPos + tokenLen);
        if (endPos < 0) {
            return templateStr;
        }

        // now see if there is an additional format tag suffixed to
        // the identifier within the enclosing '$' characters
        formatTagPos = templateStr.indexOf(formatTag, startPos + tokenLen);
        if (formatTagPos > startPos && formatTagPos < endPos) {

            specifier = templateStr.charAt(endPos - 1);
            width = parseInt(templateStr.substring(formatTagPos + formatTagLen, endPos - 1), 10);

            // support the minimum specifiers required by IEEE 1003.1
            // (d, i , o, u, x, and X) for completeness
            switch (specifier) {
                // treat all int types as uint,
                // hence deliberate fallthrough
                case 'd':
                case 'i':
                case 'u':
                    paddedValue = zeroPadToLength(value.toString(), width);
                    break;
                case 'x':
                    paddedValue = zeroPadToLength(value.toString(16), width);
                    break;
                case 'X':
                    paddedValue = zeroPadToLength(value.toString(16), width).toUpperCase();
                    break;
                case 'o':
                    paddedValue = zeroPadToLength(value.toString(8), width);
                    break;
                default:
                    console.log('Unsupported/invalid IEEE 1003.1 format identifier string in URL');
                    return templateStr;
            }
        } else {
            paddedValue = value;
        }

        templateStr = templateStr.substring(0, startPos) + paddedValue + templateStr.substring(endPos + 1);
    }
};

unescapeDollarsInTemplate = function (templateStr) {
    return templateStr.split('$$').join('$');
};

replaceIDForTemplate = function (templateStr, value) {
    if (value === null || templateStr.indexOf('$RepresentationID$') === -1) { return templateStr; }
    var v = value.toString();
    return templateStr.split('$RepresentationID$').join(v);
};

segmentTemplate = {
    zeroPadToLength: zeroPadToLength,
    replaceTokenForTemplate: replaceTokenForTemplate,
    unescapeDollarsInTemplate: unescapeDollarsInTemplate,
    replaceIDForTemplate: replaceIDForTemplate
};

module.exports = function getSegmentTemplate() { return segmentTemplate; };
},{}],11:[function(require,module,exports){
'use strict';

var eventMgr = require('./eventManager.js'),
    eventDispatcherMixin = {
        trigger: function(eventObject) { eventMgr.trigger(this, eventObject); },
        one: function(type, listenerFn) { eventMgr.one(this, type, listenerFn); },
        on: function(type, listenerFn) { eventMgr.on(this, type, listenerFn); },
        off: function(type, listenerFn) { eventMgr.off(this, type, listenerFn); }
    };

module.exports = eventDispatcherMixin;
},{"./eventManager.js":12}],12:[function(require,module,exports){
'use strict';

var videojs = require('global/window').videojs,
    eventManager = {
        trigger: videojs.trigger,
        one: videojs.one,
        on: videojs.on,
        off: videojs.off
    };

module.exports = eventManager;

},{"global/window":1}],13:[function(require,module,exports){
'use strict';

// TODO: Refactor to separate js files & modules & remove from here.

var existy = require('./util/existy.js'),
    isFunction = require('./util/isFunction.js'),
    isString = require('./util/isString.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

function preApplyArgsFn(fun /*, args */) {
    var preAppliedArgs = Array.prototype.slice.call(arguments, 1);
    // NOTE: the *this* reference will refer to the closure's context unless
    // the returned function is itself called via .call() or .apply(). If you
    // *need* to refer to instance-level properties, do something like the following:
    //
    // MyType.prototype.someFn = function(argC) { preApplyArgsFn(someOtherFn, argA, argB, ... argN).call(this); };
    //
    // Otherwise, you should be able to just call:
    //
    // MyType.prototype.someFn = preApplyArgsFn(someOtherFn, argA, argB, ... argN);
    //
    // Where possible, functions and methods should not be reaching out to global scope anyway, so...
    return function() { return fun.apply(this, preAppliedArgs); };
}

// Higher-order XML functions

// Takes function(s) as arguments
var getAncestors = function(elem, shouldStopPred) {
    var ancestors = [];
    if (!isFunction(shouldStopPred)) { shouldStopPred = function() { return false; }; }
    (function getAncestorsRecurse(elem) {
        if (shouldStopPred(elem, ancestors)) { return; }
        if (existy(elem) && existy(elem.parentNode)) {
            ancestors.push(elem.parentNode);
            getAncestorsRecurse(elem.parentNode);
        }
        return;
    })(elem);
    return ancestors;
};

// Returns function
var getNodeListByName = function(name) {
    return function(xmlObj) {
        return xmlObj.getElementsByTagName(name);
    };
};

// Returns function
var hasMatchingAttribute = function(attrName, value) {
    if ((typeof attrName !== 'string') || attrName === '') { return undefined; }
    return function(elem) {
        if (!existy(elem) || !existy(elem.hasAttribute) || !existy(elem.getAttribute)) { return false; }
        if (!existy(value)) { return elem.hasAttribute(attrName); }
        return (elem.getAttribute(attrName) === value);
    };
};

// Returns function
var getAttrFn = function(attrName) {
    if (!isString(attrName)) { return undefined; }
    return function(elem) {
        if (!existy(elem) || !isFunction(elem.getAttribute)) { return undefined; }
        return elem.getAttribute(attrName);
    };
};

// Returns function
// TODO: Add shouldStopPred (should function similarly to shouldStopPred in getInheritableElement, below)
var getInheritableAttribute = function(attrName) {
    if ((!isString(attrName)) || attrName === '') { return undefined; }
    return function recurseCheckAncestorAttr(elem) {
        if (!existy(elem) || !existy(elem.hasAttribute) || !existy(elem.getAttribute)) { return undefined; }
        if (elem.hasAttribute(attrName)) { return elem.getAttribute(attrName); }
        if (!existy(elem.parentNode)) { return undefined; }
        return recurseCheckAncestorAttr(elem.parentNode);
    };
};

// Takes function(s) as arguments; Returns function
var getInheritableElement = function(nodeName, shouldStopPred) {
    if ((!isString(nodeName)) || nodeName === '') { return undefined; }
    if (!isFunction(shouldStopPred)) { shouldStopPred = function() { return false; }; }
    return function getInheritableElementRecurse(elem) {
        if (!existy(elem) || !existy(elem.getElementsByTagName)) { return undefined; }
        if (shouldStopPred(elem)) { return undefined; }
        var matchingElemList = elem.getElementsByTagName(nodeName);
        if (existy(matchingElemList) && matchingElemList.length > 0) { return matchingElemList[0]; }
        if (!existy(elem.parentNode)) { return undefined; }
        return getInheritableElementRecurse(elem.parentNode);
    };
};

var getChildElementByNodeName = function(nodeName) {
    if ((!isString(nodeName)) || nodeName === '') { return undefined; }
    return function(elem) {
        if (!existy(elem) || !isFunction(elem.getElementsByTagName)) { return undefined; }
        var initialMatches = elem.getElementsByTagName(nodeName),
            currentElem;
        if (!existy(initialMatches) || initialMatches.length <= 0) { return undefined; }
        currentElem = initialMatches[0];
        return (currentElem.parentNode === elem) ? currentElem : undefined;
    };
};

var getMultiLevelElementList = function(nodeName, shouldStopPred) {
    if ((!isString(nodeName)) || nodeName === '') { return undefined; }
    if (!isFunction(shouldStopPred)) { shouldStopPred = function() { return false; }; }
    var getMatchingChildNodeFn = getChildElementByNodeName(nodeName);
    return function(elem) {
        var currentElem = elem,
            multiLevelElemList = [],
            matchingElem;
        // TODO: Replace w/recursive fn?
        while (existy(currentElem) && !shouldStopPred(currentElem)) {
            matchingElem = getMatchingChildNodeFn(currentElem);
            if (existy(matchingElem)) { multiLevelElemList.push(matchingElem); }
            currentElem = currentElem.parentNode;
        }

        return multiLevelElemList.length > 0 ? multiLevelElemList : undefined;
    };
};

// Publish External API:
var xmlFun = {};
xmlFun.existy = existy;
xmlFun.truthy = truthy;

xmlFun.getNodeListByName = getNodeListByName;
xmlFun.hasMatchingAttribute = hasMatchingAttribute;
xmlFun.getInheritableAttribute = getInheritableAttribute;
xmlFun.getAncestors = getAncestors;
xmlFun.getAttrFn = getAttrFn;
xmlFun.preApplyArgsFn = preApplyArgsFn;
xmlFun.getInheritableElement = getInheritableElement;
xmlFun.getMultiLevelElementList = getMultiLevelElementList;

module.exports = function getXmlFun() { return xmlFun; };
},{"./util/existy.js":20,"./util/isFunction.js":25,"./util/isString.js":27}],14:[function(require,module,exports){
/**
 *
 * main source for packaged code. Auto-bootstraps the source handling functionality by registering the source handler
 * with video.js on initial script load via IIFE. (NOTE: This places an order dependency on the video.js library, which
 * must already be loaded before this script auto-executes.)
 *
 */
;(function() {
    'use strict';

    var root = require('global/window'),
        videojs = root.videojs,
        SourceHandler = require('./SourceHandler'),
        CanHandleSourceEnum = {
            DOESNT_HANDLE_SOURCE: '',
            MAYBE_HANDLE_SOURCE: 'maybe'
        };

    if (!videojs) {
        throw new Error('The video.js library must be included to use this MPEG-DASH source handler.');
    }

    /**
     *
     * Used by a video.js tech instance to verify whether or not a specific media source can be handled by this
     * source handler. In this case, should return 'maybe' if the source is MPEG-DASH, otherwise '' (representing no).
     *
     * @param {object} source           video.js source object providing source uri and type information
     * @returns {CanHandleSourceEnum}   string representation of whether or not particular source can be handled by this
     *                                  source handler.
     */
    function canHandleSource(source) {
        // Requires Media Source Extensions
        if (!(root.MediaSource)) {
            return CanHandleSourceEnum.DOESNT_HANDLE_SOURCE;
        }

        // Check if the type is supported
        if (/application\/dash\+xml/.test(source.type)) {
            return CanHandleSourceEnum.MAYBE_HANDLE_SOURCE;
        }

        // Check if the file extension matches
        if (/\.mpd$/i.test(source.src)) {
            return CanHandleSourceEnum.MAYBE_HANDLE_SOURCE;
        }

        return CanHandleSourceEnum.DOESNT_HANDLE_SOURCE;
    }

    /**
     *
     * Called by a video.js tech instance to handle a specific media source, returning an object instance that provides
     * the context for handling said source.
     *
     * @param source            video.js source object providing source uri and type information
     * @param tech              video.js tech object (in this case, should be Html5 tech) providing point of interaction
     *                          between the source handler and the video.js library (including, e.g., the video element)
     * @returns {SourceHandler} An object that defines context for handling a particular MPEG-DASH source.
     */
    function handleSource(source, tech) {
        return new SourceHandler(source, tech);
    }

    // Register the source handler to the Html5 tech instance.
    videojs.Html5.registerSourceHandler({
        canHandleSource: canHandleSource,
        handleSource: handleSource
    }, 0);

}.call(this));

},{"./SourceHandler":6,"global/window":1}],15:[function(require,module,exports){
'use strict';

var existy = require('../util/existy.js'),
    truthy = require('../util/truthy.js'),
    isString = require('../util/isString.js'),
    isFunction = require('../util/isFunction.js'),
    isArray = require('../util/isArray.js'),
    findElementInArray = require('../util/findElementInArray.js'),
    getMediaTypeFromMimeType = require('../util/getMediaTypeFromMimeType.js'),
    loadManifest = require('./loadManifest.js'),
    extendObject = require('../util/extendObject.js'),
    getDashUtil = require('../dash/mpd/getDashUtil.js'),
    dashUtil = getDashUtil(),
    parseMediaPresentationDuration = dashUtil.parseMediaPresentationDuration,
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    getMpd = require('../dash/mpd/getMpd.js'),
    MediaSet = require('../MediaSet.js'),
    mediaTypes = require('./MediaTypes.js');

/**
 *
 * The ManifestController loads, stores, and provides data views for the MPD manifest that represents the
 * MPEG-DASH media source being handled.
 *
 * @param sourceUri {string}
 * @param autoLoad  {boolean}
 * @constructor
 */
function ManifestController(sourceUri, autoLoad) {
    this.__autoLoad = truthy(autoLoad);
    this.setSourceUri(sourceUri);
}

/**
 * Enumeration of events instances of this object will dispatch.
 */
ManifestController.prototype.eventList = {
    MANIFEST_LOADED: 'manifestLoaded'
};

ManifestController.prototype.getSourceUri = function() {
    return this.__sourceUri;
};

ManifestController.prototype.setSourceUri = function setSourceUri(sourceUri) {
    // TODO: 'existy()' check for both?
    if (sourceUri === this.__sourceUri) { return; }

    // TODO: isString() check? 'existy()' check?
    if (!sourceUri) {
        this.__clearSourceUri();
        return;
    }

    // Need to potentially remove update interval for re-requesting the MPD manifest (in case it is a dynamic MPD)
    this.__clearCurrentUpdateInterval();
    this.__sourceUri = sourceUri;
    // If we should automatically load the MPD, go ahead and kick off loading it.
    if (this.__autoLoad) {
        // TODO: Impl any cleanup functionality appropriate before load.
        this.load();
    }
};

ManifestController.prototype.__clearSourceUri = function clearSourceUri() {
    this.__sourceUri = null;
    // Need to potentially remove update interval for re-requesting the MPD manifest (in case it is a dynamic MPD)
    this.__clearCurrentUpdateInterval();
    // TODO: impl any other cleanup functionality
};

/**
 * Kick off loading the DASH MPD Manifest (served @ the ManifestController instance's __sourceUri)
 */
ManifestController.prototype.load = function load() {
    // TODO: Currently clearing & re-setting update interval after every request. Either use setTimeout() or only setup interval once
    var self = this;
    loadManifest(self.__sourceUri, function(data) {
        self.__manifest = data.manifestXml;
        // (Potentially) setup the update interval for re-requesting the MPD (in case the manifest is dynamic)
        self.__setupUpdateInterval();
        // Dispatch event to notify that the manifest has loaded.
        self.trigger({ type:self.eventList.MANIFEST_LOADED, target:self, data:self.__manifest});
    });
};

/**
 * 'Private' method that removes the update interval (if it exists), so the ManifestController instance will no longer
 * periodically re-request the manifest (if it's dynamic).
 */
ManifestController.prototype.__clearCurrentUpdateInterval = function clearCurrentUpdateInterval() {
    if (!existy(this.__updateInterval)) { return; }
    clearInterval(this.__updateInterval);
};

/**
 * Sets up an interval to re-request the manifest (if it's dynamic)
 */
ManifestController.prototype.__setupUpdateInterval = function setupUpdateInterval() {
    // If there's already an updateInterval function, remove it.
    if (this.__updateInterval) { this.__clearCurrentUpdateInterval(); }
    // If we shouldn't update, just bail.
    if (!this.getShouldUpdate()) { return; }
    var self = this,
        minUpdateRate = 2,
        updateRate = Math.max(this.getUpdateRate(), minUpdateRate);
    // Setup the update interval based on the update rate (determined from the manifest) or the minimum update rate
    // (whichever's larger).
    // NOTE: Must store ref to created interval to potentially clear/remove it later
    this.__updateInterval = setInterval(function() {
        self.load();
    }, updateRate * 1000);
};

/**
 * Gets the type of playlist ('static' or 'dynamic', which nearly invariably corresponds to live vs. vod) defined in the
 * manifest.
 *
 * @returns {string}    the playlist type (either 'static' or 'dynamic')
 */
ManifestController.prototype.getPlaylistType = function getPlaylistType() {
    var playlistType = getMpd(this.__manifest).getType();
    return playlistType;
};

ManifestController.prototype.getUpdateRate = function getUpdateRate() {
    var minimumUpdatePeriodStr = getMpd(this.__manifest).getMinimumUpdatePeriod(),
        minimumUpdatePeriod = parseMediaPresentationDuration(minimumUpdatePeriodStr);
    return minimumUpdatePeriod || 0;
};

ManifestController.prototype.getShouldUpdate = function getShouldUpdate() {
    var isDynamic = (this.getPlaylistType() === 'dynamic'),
        hasValidUpdateRate = (this.getUpdateRate() > 0);
    return (isDynamic && hasValidUpdateRate);
};

ManifestController.prototype.getMpd = function() {
    return getMpd(this.__manifest);
};

/**
 *
 * @param type
 * @returns {MediaSet}
 */
ManifestController.prototype.getMediaSetByType = function getMediaSetByType(type) {
    if (mediaTypes.indexOf(type) < 0) { throw new Error('Invalid type. Value must be one of: ' + mediaTypes.join(', ')); }
    var adaptationSets = getMpd(this.__manifest).getPeriods()[0].getAdaptationSets(),
        adaptationSetWithTypeMatch = findElementInArray(adaptationSets, function(adaptationSet) {
            return (getMediaTypeFromMimeType(adaptationSet.getMimeType(), mediaTypes) === type);
        });
    if (!existy(adaptationSetWithTypeMatch)) { return null; }
    return new MediaSet(adaptationSetWithTypeMatch);
};

/**
 *
 * @returns {Array.<MediaSet>}
 */
ManifestController.prototype.getMediaSets = function getMediaSets() {
    var adaptationSets = getMpd(this.__manifest).getPeriods()[0].getAdaptationSets(),
        mediaSets = adaptationSets.map(function(adaptationSet) { return new MediaSet(adaptationSet); });
    return mediaSets;
};

// Mixin event handling for the ManifestController object type definition.
extendObject(ManifestController.prototype, EventDispatcherMixin);

module.exports = ManifestController;
},{"../MediaSet.js":2,"../dash/mpd/getDashUtil.js":7,"../dash/mpd/getMpd.js":8,"../events/EventDispatcherMixin.js":11,"../util/existy.js":20,"../util/extendObject.js":21,"../util/findElementInArray.js":22,"../util/getMediaTypeFromMimeType.js":23,"../util/isArray.js":24,"../util/isFunction.js":25,"../util/isString.js":27,"../util/truthy.js":28,"./MediaTypes.js":16,"./loadManifest.js":17}],16:[function(require,module,exports){
module.exports = ['video', 'audio'];
},{}],17:[function(require,module,exports){
'use strict';

var getDashUtil = require('../dash/mpd/getDashUtil.js'),
    dashUtil = getDashUtil(),
    parseRootUrl = dashUtil.parseRootUrl;

function loadManifest(url, callback) {
    var actualUrl = parseRootUrl(url),
        request = new XMLHttpRequest(),
        onload;

    onload = function () {
        if (request.status < 200 || request.status > 299) { return; }

        if (typeof callback === 'function') { callback({manifestXml: request.responseXML }); }
    };

    try {
        request.onload = onload;
        request.open('GET', url, true);
        request.send();
    } catch(e) {
        request.onerror();
    }
}

module.exports = loadManifest;
},{"../dash/mpd/getDashUtil.js":7}],18:[function(require,module,exports){
'use strict';

var isFunction = require('../util/isFunction.js');

/**
 * Generic function for loading MPEG-DASH segments (including initialization segments)
 * @param segment {object}       data view representing a segment (and relevant data for that segment)
 * @param successFn {function}  function called on successful response
 * @param failFn {function}     function called on failed response
 * @param thisArg {object}      object used as the this context for successFn and failFn
 */
function loadSegment(segment, successFn, failFn, thisArg) {
    var request = new XMLHttpRequest(),
        url = segment.getUrl();

    function onload() {
        // If the load status was outside of the 200s range, consider it a failed request.
        if (request.status < 200 || request.status > 299) {
            if (isFunction(failFn)) {
                failFn.call(thisArg,  {
                    requestedSegment: segment,
                    response: request.response,
                    status: request.status
                });
            }
        } else {
            if (isFunction(successFn)) {
                successFn.call(thisArg, {
                    requestedSegment: segment,
                    response: request.response,
                    status: request.status
                });
            }
        }
    }

    function onerror() {
        if (isFunction(failFn)) {
            failFn.call(thisArg,  {
                requestedSegment: segment,
                response: request.response,
                status: request.status
            });
        }
    }

    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = onload;
    request.onerror = onerror;
    request.send();

    return request;
}

module.exports = loadSegment;
},{"../util/isFunction.js":25}],19:[function(require,module,exports){
'use strict';

function compareSegmentListsByBandwidthAscending(segmentListA, segmentListB) {
    var bandwidthA = segmentListA.getBandwidth(),
        bandwidthB = segmentListB.getBandwidth();
    return bandwidthA - bandwidthB;
}

function compareSegmentListsByWidthAscending(segmentListA, segmentListB) {
    var widthA = segmentListA.getWidth() || 0,
        widthB = segmentListB.getWidth() || 0;
    return widthA - widthB;
}

function compareSegmentListsByWidthThenBandwidthAscending(segmentListA, segmentListB) {
    var resolutionCompare = compareSegmentListsByWidthAscending(segmentListA, segmentListB);
    return (resolutionCompare !== 0) ? resolutionCompare : compareSegmentListsByBandwidthAscending(segmentListA, segmentListB);
}

function filterSegmentListsByResolution(segmentList, maxWidth, maxHeight) {
    var width = segmentList.getWidth() || 0,
        height = segmentList.getHeight() || 0;
    return ((width <= maxWidth) && (height <= maxHeight));
}

function filterSegmentListsByDownloadRate(segmentList, currentSegmentListBandwidth, downloadRateRatio) {
    var segmentListBandwidth = segmentList.getBandwidth(),
        segmentBandwidthRatio = segmentListBandwidth / currentSegmentListBandwidth;
    downloadRateRatio = downloadRateRatio || Number.MAX_VALUE;
    return (downloadRateRatio >= segmentBandwidthRatio);
}

// NOTE: Passing in mediaSet instead of mediaSet's SegmentList Array since sort is destructive and don't want to clone.
//      Also allows for greater flexibility of fn.
function selectSegmentList(mediaSet, data) {
    var downloadRateRatio = data.downloadRateRatio,
        currentSegmentListBandwidth = data.currentSegmentListBandwidth,
        width = data.width,
        height = data.height,
        sortedByBandwidth = mediaSet.getSegmentLists().sort(compareSegmentListsByBandwidthAscending),
        filteredByDownloadRate,
        filteredByResolution,
        proposedSegmentList;

    function filterByResolution(segmentList) {
        return filterSegmentListsByResolution(segmentList, width, height);
    }

    function filterByDownloadRate(segmentList) {
        return filterSegmentListsByDownloadRate(segmentList, currentSegmentListBandwidth, downloadRateRatio);
    }

    filteredByDownloadRate = sortedByBandwidth.filter(filterByDownloadRate);
    filteredByResolution = filteredByDownloadRate.sort(compareSegmentListsByWidthThenBandwidthAscending).filter(filterByResolution);

    proposedSegmentList = filteredByResolution[filteredByResolution.length - 1] || sortedByBandwidth[0];

    return proposedSegmentList;
}

module.exports = selectSegmentList;
},{}],20:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],21:[function(require,module,exports){
'use strict';

// Extend a given object with all the properties (and their values) found in the passed-in object(s).
var extendObject = function(obj /*, extendObject1, extendObject2, ..., extendObjectN */) {
    var extendObjectsArray = Array.prototype.slice.call(arguments, 1),
        i,
        length = extendObjectsArray.length,
        extendObject;

    for(i=0; i<length; i++) {
        extendObject = extendObjectsArray[i];
        if (extendObject) {
            for (var prop in extendObject) {
                obj[prop] = extendObject[prop];
            }
        }
    }

    return obj;
};

module.exports = extendObject;
},{}],22:[function(require,module,exports){
'use strict';

var isArray = require('./isArray.js'),
    isFunction = require('./isFunction.js'),
    findElementInArray;

findElementInArray = function(array, predicateFn) {
    if (!isArray(array) || !isFunction(predicateFn)) { return undefined; }
    var i,
        length = array.length,
        elem;

    for (i=0; i<length; i++) {
        elem = array[i];
        if (predicateFn(elem, i, array)) { return elem; }
    }

    return undefined;
};

module.exports = findElementInArray;
},{"./isArray.js":24,"./isFunction.js":25}],23:[function(require,module,exports){
'use strict';

var existy = require('./existy.js'),
    isString = require('./isString.js'),
    findElementInArray = require('./findElementInArray.js'),
    getMediaTypeFromMimeType;

/**
 *
 * Function used to get the media type based on the mime type. Used to determine the media type of Adaptation Sets
 * or corresponding data representations.
 *
 * @param mimeType {string} mime type for a DASH MPD Adaptation Set (specified as an attribute string)
 * @param types {string}    supported media types (e.g. 'video,' 'audio,')
 * @returns {string}        the media type that corresponds to the mime type.
 */
getMediaTypeFromMimeType = function(mimeType, types) {
    if (!isString(mimeType)) { return null; }   // TODO: Throw error?
    var matchedType = findElementInArray(types, function(type) {
        return (!!mimeType && mimeType.indexOf(type) >= 0);
    });

    return matchedType;
};

module.exports = getMediaTypeFromMimeType;
},{"./existy.js":20,"./findElementInArray.js":22,"./isString.js":27}],24:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],25:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isFunction = function isFunction(value) {
    return typeof value === 'function';
};
// fallback for older versions of Chrome and Safari
if (isFunction(/x/)) {
    isFunction = function(value) {
        return typeof value === 'function' && objectRef.toString.call(value) === '[object Function]';
    };
}

module.exports = isFunction;
},{}],26:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isNumber(value) {
    return typeof value === 'number' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object Number]' || false;
}

module.exports = isNumber;
},{}],27:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object String]' || false;
};

module.exports = isString;
},{}],28:[function(require,module,exports){
'use strict';

var existy = require('./existy.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

module.exports = truthy;
},{"./existy.js":20}]},{},[14])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVNldC5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL1NvdXJjZUhhbmRsZXIuanMiLCJzcmMvanMvZGFzaC9tcGQvZ2V0RGFzaFV0aWwuanMiLCJzcmMvanMvZGFzaC9tcGQvZ2V0TXBkLmpzIiwic3JjL2pzL2Rhc2gvc2VnbWVudHMvZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbi5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRUZW1wbGF0ZS5qcyIsInNyYy9qcy9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMiLCJzcmMvanMvZXZlbnRzL2V2ZW50TWFuYWdlci5qcyIsInNyYy9qcy9nZXRYbWxGdW4uanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvbG9hZFNlZ21lbnQuanMiLCJzcmMvanMvc2VsZWN0U2VnbWVudExpc3QuanMiLCJzcmMvanMvdXRpbC9leGlzdHkuanMiLCJzcmMvanMvdXRpbC9leHRlbmRPYmplY3QuanMiLCJzcmMvanMvdXRpbC9maW5kRWxlbWVudEluQXJyYXkuanMiLCJzcmMvanMvdXRpbC9nZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUuanMiLCJzcmMvanMvdXRpbC9pc0FycmF5LmpzIiwic3JjL2pzL3V0aWwvaXNGdW5jdGlvbi5qcyIsInNyYy9qcy91dGlsL2lzTnVtYmVyLmpzIiwic3JjL2pzL3V0aWwvaXNTdHJpbmcuanMiLCJzcmMvanMvdXRpbC90cnV0aHkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9UQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsImlmICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSB3aW5kb3c7XG59IGVsc2UgaWYgKHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGdsb2JhbDtcbn0gZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIpe1xuICAgIG1vZHVsZS5leHBvcnRzID0gc2VsZjtcbn0gZWxzZSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSB7fTtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUgPSByZXF1aXJlKCcuL3V0aWwvZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlLmpzJyksXG4gICAgZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbiA9IHJlcXVpcmUoJy4vZGFzaC9zZWdtZW50cy9nZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uLmpzJyksXG4gICAgZmluZEVsZW1lbnRJbkFycmF5ID0gcmVxdWlyZSgnLi91dGlsL2ZpbmRFbGVtZW50SW5BcnJheS5qcycpLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL21hbmlmZXN0L01lZGlhVHlwZXMuanMnKTtcblxuLyoqXG4gKlxuICogUHJpbWFyeSBkYXRhIHZpZXcgZm9yIHJlcHJlc2VudGluZyB0aGUgc2V0IG9mIHNlZ21lbnQgbGlzdHMgYW5kIG90aGVyIGdlbmVyYWwgaW5mb3JtYXRpb24gZm9yIGEgZ2l2ZSBtZWRpYSB0eXBlXG4gKiAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpLlxuICpcbiAqIEBwYXJhbSBhZGFwdGF0aW9uU2V0IFRoZSBNUEVHLURBU0ggY29ycmVsYXRlIGZvciBhIGdpdmVuIG1lZGlhIHNldCwgY29udGFpbmluZyBzb21lIHdheSBvZiByZXByZXNlbnRhdGluZyBzZWdtZW50IGxpc3RzXG4gKiAgICAgICAgICAgICAgICAgICAgICBhbmQgYSBzZXQgb2YgcmVwcmVzZW50YXRpb25zIGZvciBlYWNoIHN0cmVhbSB2YXJpYW50LlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpIHtcbiAgICAvLyBUT0RPOiBBZGRpdGlvbmFsIGNoZWNrcyAmIEVycm9yIFRocm93aW5nXG4gICAgdGhpcy5fX2FkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0O1xufVxuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0TWVkaWFUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFUeXBlKCkge1xuICAgIHZhciB0eXBlID0gZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKHRoaXMuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcyk7XG4gICAgcmV0dXJuIHR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0TWltZVR5cGUgPSBmdW5jdGlvbiBnZXRNaW1lVHlwZSgpIHtcbiAgICB2YXIgbWltZVR5cGUgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpO1xuICAgIHJldHVybiBtaW1lVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJUeXBlID0gZnVuY3Rpb24gZ2V0U291cmNlQnVmZmVyVHlwZSgpIHtcbiAgICAvLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlIGNvZGVjcyBhc3NvY2lhdGVkIHdpdGggZWFjaCBzdHJlYW0gdmFyaWFudC9yZXByZXNlbnRhdGlvblxuICAgIC8vIHdpbGwgYmUgc2ltaWxhciBlbm91Z2ggdGhhdCB5b3Ugd29uJ3QgaGF2ZSB0byByZS1jcmVhdGUgdGhlIHNvdXJjZS1idWZmZXIgd2hlbiBzd2l0Y2hpbmdcbiAgICAvLyBiZXR3ZWVuIHRoZW0uXG5cbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0VHlwZSgpO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsRHVyYXRpb24gPSBmdW5jdGlvbiBnZXRUb3RhbER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpO1xuICAgIHJldHVybiB0b3RhbER1cmF0aW9uO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB3YWxsQ2xvY2tUaW1lID0gc2VnbWVudExpc3QuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lKCk7XG4gICAgcmV0dXJuIHdhbGxDbG9ja1RpbWU7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbFNlZ21lbnRDb3VudCA9IGZ1bmN0aW9uIGdldFRvdGFsU2VnbWVudENvdW50KCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbFNlZ21lbnRDb3VudCA9IHNlZ21lbnRMaXN0LmdldFRvdGFsU2VnbWVudENvdW50KCk7XG4gICAgcmV0dXJuIHRvdGFsU2VnbWVudENvdW50O1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnREdXJhdGlvbiA9IGZ1bmN0aW9uIGdldFNlZ21lbnREdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudER1cmF0aW9uID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCk7XG4gICAgcmV0dXJuIHNlZ21lbnREdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RTdGFydE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudExpc3RTdGFydE51bWJlciA9IHNlZ21lbnRMaXN0LmdldFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0U3RhcnROdW1iZXI7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdEVuZE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudExpc3RFbmROdW1iZXIgPSBzZWdtZW50TGlzdC5nZXRFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RFbmROdW1iZXI7XG59O1xuXG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdHMgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdHMoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICBzZWdtZW50TGlzdHMgPSByZXByZXNlbnRhdGlvbnMubWFwKGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzZWdtZW50TGlzdHM7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICByZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCA9IGZpbmRFbGVtZW50SW5BcnJheShyZXByZXNlbnRhdGlvbnMsIGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICB2YXIgcmVwcmVzZW50YXRpb25CYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICAgICAgICAgIHJldHVybiAoTnVtYmVyKHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoKSA9PT0gTnVtYmVyKGJhbmR3aWR0aCkpO1xuICAgICAgICB9KSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uIGdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLm1hcChcbiAgICAgICAgZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuICAgICAgICB9KS5maWx0ZXIoXG4gICAgICAgIGZ1bmN0aW9uKGJhbmR3aWR0aCkge1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0eShiYW5kd2lkdGgpO1xuICAgICAgICB9XG4gICAgKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gTWVkaWFTZXQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGlzTnVtYmVyID0gcmVxdWlyZSgnLi91dGlsL2lzTnVtYmVyLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBsb2FkU2VnbWVudCA9IHJlcXVpcmUoJy4vc2VnbWVudHMvbG9hZFNlZ21lbnQuanMnKSxcbiAgICAvLyBUT0RPOiBEZXRlcm1pbmUgYXBwcm9wcmlhdGUgZGVmYXVsdCBzaXplIChvciBiYXNlIG9uIHNlZ21lbnQgbiB4IHNpemUvZHVyYXRpb24/KVxuICAgIC8vIE11c3QgY29uc2lkZXIgQUJSIFN3aXRjaGluZyAmIFZpZXdpbmcgZXhwZXJpZW5jZSBvZiBhbHJlYWR5LWJ1ZmZlcmVkIHNlZ21lbnRzLlxuICAgIE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFID0gMjAsXG4gICAgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUgPSA0MCxcbiAgICBERUZBVUxUX1JFVFJZX0NPVU5UID0gMyxcbiAgICBERUZBVUxUX1JFVFJZX0lOVEVSVkFMID0gMjUwO1xuXG5mdW5jdGlvbiB3YWl0VGltZVRvUmVjaGVja1N0YXRpYyhjdXJyZW50VGltZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJ1ZmZlcmVkVGltZVJhbmdlcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlZ21lbnREdXJhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhc3REb3dubG9hZFJvdW5kVHJpcFRpbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtaW5EZXNpcmVkQnVmZmVyU2l6ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heERlc2lyZWRCdWZmZXJTaXplKSB7XG4gICAgdmFyIGN1cnJlbnRSYW5nZSA9IGZpbmRUaW1lUmFuZ2VFZGdlKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMpLFxuICAgICAgICBidWZmZXJTaXplO1xuXG4gICAgaWYgKCFleGlzdHkoY3VycmVudFJhbmdlKSkgeyByZXR1cm4gMDsgfVxuXG4gICAgYnVmZmVyU2l6ZSA9IGN1cnJlbnRSYW5nZS5nZXRFbmQoKSAtIGN1cnJlbnRUaW1lO1xuXG4gICAgaWYgKGJ1ZmZlclNpemUgPCBtaW5EZXNpcmVkQnVmZmVyU2l6ZSkgeyByZXR1cm4gMDsgfVxuICAgIGVsc2UgaWYgKGJ1ZmZlclNpemUgPCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkgeyByZXR1cm4gKHNlZ21lbnREdXJhdGlvbiAtIGxhc3REb3dubG9hZFJvdW5kVHJpcFRpbWUpICogMTAwMDsgfVxuXG4gICAgcmV0dXJuIE1hdGguZmxvb3IoTWF0aC5taW4oc2VnbWVudER1cmF0aW9uLCAyKSAqIDEwMDApO1xufVxuXG5mdW5jdGlvbiB3YWl0VGltZVRvUmVjaGVja0xpdmUoY3VycmVudFRpbWUsIGJ1ZmZlcmVkVGltZVJhbmdlcywgc2VnbWVudExpc3QpIHtcbiAgICB2YXIgY3VycmVudFJhbmdlID0gZmluZFRpbWVSYW5nZUVkZ2UoY3VycmVudFRpbWUsIGJ1ZmZlcmVkVGltZVJhbmdlcyksXG4gICAgICAgIG5leHRTZWdtZW50LFxuICAgICAgICBzYWZlTGl2ZUVkZ2UsXG4gICAgICAgIHRpbWVQYXN0U2FmZUxpdmVFZGdlO1xuXG4gICAgaWYgKCFleGlzdHkoY3VycmVudFJhbmdlKSkgeyByZXR1cm4gMDsgfVxuXG4gICAgbmV4dFNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKGN1cnJlbnRSYW5nZS5nZXRFbmQoKSk7XG4gICAgc2FmZUxpdmVFZGdlID0gKERhdGUubm93KCkgLSAoc2VnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCkgKiAxMDAwKSk7XG4gICAgdGltZVBhc3RTYWZlTGl2ZUVkZ2UgPSBuZXh0U2VnbWVudC5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUoKSAtIHNhZmVMaXZlRWRnZTtcblxuICAgIGlmICh0aW1lUGFzdFNhZmVMaXZlRWRnZSA8IDAuMDAzKSB7IHJldHVybiAwOyB9XG5cbiAgICByZXR1cm4gdGltZVBhc3RTYWZlTGl2ZUVkZ2U7XG59XG5cbmZ1bmN0aW9uIG5leHRTZWdtZW50VG9Mb2FkKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMsIHNlZ21lbnRMaXN0KSB7XG4gICAgdmFyIGN1cnJlbnRSYW5nZSA9IGZpbmRUaW1lUmFuZ2VFZGdlKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMpLFxuICAgICAgICBzZWdtZW50VG9Mb2FkO1xuXG4gICAgaWYgKGV4aXN0eShjdXJyZW50UmFuZ2UpKSB7XG4gICAgICAgIHNlZ21lbnRUb0xvYWQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKGN1cnJlbnRSYW5nZS5nZXRFbmQoKSk7XG4gICAgfSBlbHNlIGlmIChzZWdtZW50TGlzdC5nZXRJc0xpdmUoKSkge1xuICAgICAgICBzZWdtZW50VG9Mb2FkID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VVRDV2FsbENsb2NrVGltZShEYXRlLm5vdygpIC0gKHNlZ21lbnRMaXN0LmdldFNlZ21lbnREdXJhdGlvbigpICogMTAwMCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE90aGVyd2lzZSAoaS5lLiBpZiBWT0Qvc3RhdGljIHN0cmVhbXMsIGdldCB0aGUgc2VnbWVudCBAIGN1cnJlbnRUaW1lKS5cbiAgICAgICAgc2VnbWVudFRvTG9hZCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVRpbWUoY3VycmVudFRpbWUpO1xuICAgIH1cblxuICAgIHJldHVybiBzZWdtZW50VG9Mb2FkO1xufVxuXG5mdW5jdGlvbiBmaW5kVGltZVJhbmdlRWRnZShjdXJyZW50VGltZSwgYnVmZmVyZWRUaW1lUmFuZ2VzKSB7XG4gICAgdmFyIGN1cnJlbnRSYW5nZSA9IGJ1ZmZlcmVkVGltZVJhbmdlcy5nZXRUaW1lUmFuZ2VCeVRpbWUoY3VycmVudFRpbWUpLFxuICAgICAgICBpLFxuICAgICAgICBsZW5ndGgsXG4gICAgICAgIHRpbWVSYW5nZVRvQ2hlY2s7XG5cbiAgICBpZiAoIWV4aXN0eShjdXJyZW50UmFuZ2UpKSB7IHJldHVybiBjdXJyZW50UmFuZ2U7IH1cblxuICAgIGkgPSBjdXJyZW50UmFuZ2UuZ2V0SW5kZXgoKSArIDE7XG4gICAgbGVuZ3RoID0gYnVmZmVyZWRUaW1lUmFuZ2VzLmdldExlbmd0aCgpO1xuXG4gICAgZm9yICg7aTxsZW5ndGg7aSsrKSB7XG4gICAgICAgIHRpbWVSYW5nZVRvQ2hlY2sgPSBidWZmZXJlZFRpbWVSYW5nZXMuZ2V0VGltZVJhbmdlQnlJbmRleChpKTtcbiAgICAgICAgaWYoKHRpbWVSYW5nZVRvQ2hlY2suZ2V0U3RhcnQoKSAtIGN1cnJlbnRSYW5nZS5nZXRFbmQoKSkgPiAwLjAwMykgeyBicmVhazsgfVxuICAgICAgICBjdXJyZW50UmFuZ2UgPSB0aW1lUmFuZ2VUb0NoZWNrO1xuICAgIH1cblxuICAgIHJldHVybiBjdXJyZW50UmFuZ2U7XG59XG5cbi8qKlxuICpcbiAqIE1lZGlhVHlwZUxvYWRlciBjb29yZGluYXRlcyBiZXR3ZWVuIHNlZ21lbnQgZG93bmxvYWRpbmcgYW5kIGFkZGluZyBzZWdtZW50cyB0byB0aGUgTVNFIHNvdXJjZSBidWZmZXIgZm9yIGEgZ2l2ZW4gbWVkaWEgdHlwZSAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpLlxuICpcbiAqIEBwYXJhbSBzb3VyY2VCdWZmZXJEYXRhUXVldWUge1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZX0gb2JqZWN0IGluc3RhbmNlIHRoYXQgaGFuZGxlcyBhZGRpbmcgc2VnbWVudHMgdG8gTVNFIFNvdXJjZUJ1ZmZlclxuICogQHBhcmFtIG1lZGlhVHlwZSB7c3RyaW5nfSAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBtZWRpYSB0eXBlIChlLmcuICdhdWRpbycgb3IgJ3ZpZGVvJykgZm9yIHRoZSBtZWRpYSBzZXRcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBpbnN0YW5jZS5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNZWRpYVR5cGVMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgdGVjaCkge1xuICAgIGlmICghZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlcikpIHsgdGhyb3cgbmV3IEVycm9yKCdNZWRpYVR5cGVMb2FkZXIgbXVzdCBiZSBpbml0aWFsaXplZCB3aXRoIGEgbWFuaWZlc3RDb250cm9sbGVyIScpOyB9XG4gICAgaWYgKCFleGlzdHkobWVkaWFUeXBlKSkgeyB0aHJvdyBuZXcgRXJyb3IoJ01lZGlhVHlwZUxvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtZWRpYVR5cGUhJyk7IH1cbiAgICAvLyBOT1RFOiBSYXRoZXIgdGhhbiBwYXNzaW5nIGluIGEgcmVmZXJlbmNlIHRvIHRoZSBNZWRpYVNldCBpbnN0YW5jZSBmb3IgYSBtZWRpYSB0eXBlLCB3ZSBwYXNzIGluIGEgcmVmZXJlbmNlIHRvIHRoZVxuICAgIC8vIGNvbnRyb2xsZXIgJiB0aGUgbWVkaWFUeXBlIHNvIHRoYXQgdGhlIE1lZGlhVHlwZUxvYWRlciBkb2Vzbid0IG5lZWQgdG8gYmUgYXdhcmUgb2Ygc3RhdGUgY2hhbmdlcy91cGRhdGVzIHRvXG4gICAgLy8gdGhlIG1hbmlmZXN0IGRhdGEgKHNheSwgaWYgdGhlIHBsYXlsaXN0IGlzIGR5bmFtaWMvJ2xpdmUnKS5cbiAgICB0aGlzLl9fbWFuaWZlc3RDb250cm9sbGVyID0gbWFuaWZlc3RDb250cm9sbGVyO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgLy8gQ3VycmVudGx5LCBzZXQgdGhlIGRlZmF1bHQgYmFuZHdpZHRoIHRvIHRoZSAwdGggaW5kZXggb2YgdGhlIGF2YWlsYWJsZSBiYW5kd2lkdGhzLiBDYW4gY2hhbmdlZCB0byB3aGF0ZXZlciBzZWVtc1xuICAgIC8vIGFwcHJvcHJpYXRlIChDSlApLlxuICAgIHRoaXMuc2V0Q3VycmVudEJhbmR3aWR0aCh0aGlzLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKVswXSk7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBSRUNIRUNLX1NFR01FTlRfTE9BRElORzogJ3JlY2hlY2tTZWdtZW50TG9hZGluZycsXG4gICAgUkVDSEVDS19DVVJSRU5UX1NFR01FTlRfTElTVDogJ3JlY2hlY2tDdXJyZW50U2VnbWVudExpc3QnLFxuICAgIERPV05MT0FEX0RBVEFfVVBEQVRFOiAnZG93bmxvYWREYXRhVXBkYXRlJ1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuZ2V0TWVkaWFTZXQoKS5nZXRNZWRpYVR5cGUoKTsgfTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVNldCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX21hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZSh0aGlzLl9fbWVkaWFUeXBlKTsgfTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWU7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkge1xuICAgIHJldHVybiB0aGlzLmdldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCh0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKSk7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRDdXJyZW50QmFuZHdpZHRoKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGg7IH07XG5cbi8qKlxuICogU2V0cyB0aGUgY3VycmVudCBiYW5kd2lkdGgsIHdoaWNoIGNvcnJlc3BvbmRzIHRvIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0IChpLmUuIHRoZSBzZWdtZW50IGxpc3QgaW4gdGhlXG4gKiBtZWRpYSBzZXQgZnJvbSB3aGljaCB3ZSBzaG91bGQgYmUgZG93bmxvYWRpbmcgc2VnbWVudHMpLlxuICogQHBhcmFtIGJhbmR3aWR0aCB7bnVtYmVyfVxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLnNldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBzZXRDdXJyZW50QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIGlmICghaXNOdW1iZXIoYmFuZHdpZHRoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01lZGlhVHlwZUxvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIGV4cGVjdHMgYSBudW1lcmljIHZhbHVlIGZvciBiYW5kd2lkdGghJyk7XG4gICAgfVxuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgaWYgKGF2YWlsYWJsZUJhbmR3aWR0aHMuaW5kZXhPZihiYW5kd2lkdGgpIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01lZGlhVHlwZUxvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIG11c3QgYmUgc2V0IHRvIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlczogJyArIGF2YWlsYWJsZUJhbmR3aWR0aHMuam9pbignLCAnKSk7XG4gICAgfVxuICAgIGlmIChiYW5kd2lkdGggPT09IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoKSB7IHJldHVybjsgfVxuICAgIC8vIFRyYWNrIHdoZW4gd2UndmUgc3dpdGNoIGJhbmR3aWR0aHMsIHNpbmNlIHdlJ2xsIG5lZWQgdG8gKHJlKWxvYWQgdGhlIGluaXRpYWxpemF0aW9uIHNlZ21lbnQgZm9yIHRoZSBzZWdtZW50IGxpc3RcbiAgICAvLyB3aGVuZXZlciB3ZSBzd2l0Y2ggYmV0d2VlbiBzZWdtZW50IGxpc3RzLiBUaGlzIGFsbG93cyBNZWRpYVR5cGVMb2FkZXIgaW5zdGFuY2VzIHRvIGF1dG9tYXRpY2FsbHkgZG8gdGhpcywgaGlkaW5nIHRob3NlXG4gICAgLy8gZGV0YWlscyBmcm9tIHRoZSBvdXRzaWRlLlxuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSBiYW5kd2lkdGg7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuZ2V0TWVkaWFTZXQoKS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4gPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19sYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiB8fCAwOyB9O1xuXG4vKipcbiAqIEtpY2tzIG9mZiBzZWdtZW50IGxvYWRpbmcgZm9yIHRoZSBtZWRpYSBzZXRcbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdGFydExvYWRpbmdTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBub3dVVEM7XG5cbiAgICAvLyBFdmVudCBsaXN0ZW5lciBmb3IgcmVjaGVja2luZyBzZWdtZW50IGxvYWRpbmcuIFRoaXMgZXZlbnQgaXMgZmlyZWQgd2hlbmV2ZXIgYSBzZWdtZW50IGhhcyBiZWVuIHN1Y2Nlc3NmdWxseVxuICAgIC8vIGRvd25sb2FkZWQgYW5kIGFkZGVkIHRvIHRoZSBidWZmZXIgb3IsIGlmIG5vdCBjdXJyZW50bHkgbG9hZGluZyBzZWdtZW50cyAoYmVjYXVzZSB0aGUgYnVmZmVyIGlzIHN1ZmZpY2llbnRseSBmdWxsXG4gICAgLy8gcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcGxheWJhY2sgdGltZSksIHdoZW5ldmVyIHNvbWUgYW1vdW50IG9mIHRpbWUgaGFzIGVsYXBzZWQgYW5kIHdlIHNob3VsZCBjaGVjayBvbiB0aGUgYnVmZmVyXG4gICAgLy8gc3RhdGUgYWdhaW4uXG4gICAgLy8gTk9URTogU3RvcmUgYSByZWZlcmVuY2UgdG8gdGhlIGV2ZW50IGhhbmRsZXIgdG8gcG90ZW50aWFsbHkgcmVtb3ZlIGl0IGxhdGVyLlxuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgc2VsZi5fX2NoZWNrU2VnbWVudExvYWRpbmcoc2VsZi5fX3RlY2guY3VycmVudFRpbWUoKSwgTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUsIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFKTtcbiAgICB9O1xuXG4gICAgdGhpcy5vbih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuICAgIHRoaXMuX190ZWNoLm9uKCdzZWVraW5nJywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuXG4gICAgaWYgKHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0SXNMaXZlKCkpIHtcbiAgICAgICAgbm93VVRDID0gRGF0ZS5ub3coKTtcbiAgICAgICAgdGhpcy5vbmUodGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgc2VnID0gc2VsZi5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRTZWdtZW50QnlVVENXYWxsQ2xvY2tUaW1lKG5vd1VUQyksXG4gICAgICAgICAgICAgICAgc2VnVVRDU3RhcnRUaW1lID0gc2VnLmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSgpLFxuICAgICAgICAgICAgICAgIHRpbWVPZmZzZXQgPSAobm93VVRDIC0gc2VnVVRDU3RhcnRUaW1lKS8xMDAwLFxuICAgICAgICAgICAgICAgIHNlZWtUb1RpbWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdEFsaWduZWRUb1NlZ21lbnREdXJhdGlvbihzZWcuZ2V0RHVyYXRpb24oKSkuZ2V0VGltZVJhbmdlQnlJbmRleCgwKS5nZXRTdGFydCgpICsgdGltZU9mZnNldDtcbiAgICAgICAgICAgIHNlbGYuX190ZWNoLnNldEN1cnJlbnRUaW1lKHNlZWtUb1RpbWUpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBNYW51YWxseSBjaGVjayBvbiBsb2FkaW5nIHNlZ21lbnRzIHRoZSBmaXJzdCB0aW1lIGFyb3VuZC5cbiAgICB0aGlzLl9fY2hlY2tTZWdtZW50TG9hZGluZyh0aGlzLl9fdGVjaC5jdXJyZW50VGltZSgpLCBNSU5fREVTSVJFRF9CVUZGRVJfU0laRSwgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUpO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdG9wTG9hZGluZ1NlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpKSB7IHJldHVybjsgfVxuXG4gICAgdGhpcy5vZmYodGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcbiAgICB0aGlzLl9fdGVjaC5vZmYoJ3NlZWtpbmcnLCB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcik7XG4gICAgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIgPSB1bmRlZmluZWQ7XG4gICAgaWYgKGV4aXN0eSh0aGlzLl9fd2FpdFRpbWVySWQpKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9fd2FpdFRpbWVySWQpO1xuICAgICAgICB0aGlzLl9fd2FpdFRpbWVySWQgPSB1bmRlZmluZWQ7XG4gICAgfVxufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5fX2NoZWNrU2VnbWVudExvYWRpbmcgPSBmdW5jdGlvbihjdXJyZW50VGltZSwgbWluRGVzaXJlZEJ1ZmZlclNpemUsIG1heERlc2lyZWRCdWZmZXJTaXplKSB7XG4gICAgdmFyIGxhc3REb3dubG9hZFJvdW5kVHJpcFRpbWUgPSB0aGlzLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgIGxvYWRJbml0aWFsaXphdGlvbiA9IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKSxcbiAgICAgICAgYnVmZmVyZWRUaW1lUmFuZ2VzID0gdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5nZXRCdWZmZXJlZFRpbWVSYW5nZUxpc3RBbGlnbmVkVG9TZWdtZW50RHVyYXRpb24oc2VnbWVudER1cmF0aW9uKSxcbiAgICAgICAgaXNMaXZlID0gc2VnbWVudExpc3QuZ2V0SXNMaXZlKCksXG4gICAgICAgIHdhaXRUaW1lLFxuICAgICAgICBzZWdtZW50VG9Eb3dubG9hZCxcbiAgICAgICAgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBJZiB3ZSdyZSBoZXJlIGJ1dCB0aGVyZSdzIGEgd2FpdFRpbWVySWQsIHdlIHNob3VsZCBjbGVhciBpdCBvdXQgc28gd2UgZG9uJ3QgZG9cbiAgICAvLyBhbiBhZGRpdGlvbmFsIHJlY2hlY2sgdW5uZWNlc3NhcmlseS5cbiAgICBpZiAoZXhpc3R5KHRoaXMuX193YWl0VGltZXJJZCkpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX193YWl0VGltZXJJZCk7XG4gICAgICAgIHRoaXMuX193YWl0VGltZXJJZCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3YWl0RnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYuX19jaGVja1NlZ21lbnRMb2FkaW5nKHNlbGYuX190ZWNoLmN1cnJlbnRUaW1lKCksIG1pbkRlc2lyZWRCdWZmZXJTaXplLCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSk7XG4gICAgICAgIHNlbGYuX193YWl0VGltZXJJZCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBpZiAoaXNMaXZlKSB7XG4gICAgICAgIHdhaXRUaW1lID0gd2FpdFRpbWVUb1JlY2hlY2tMaXZlKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMsIHNlZ21lbnRMaXN0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB3YWl0VGltZSA9IHdhaXRUaW1lVG9SZWNoZWNrU3RhdGljKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMsIHNlZ21lbnREdXJhdGlvbiwgbGFzdERvd25sb2FkUm91bmRUcmlwVGltZSwgbWluRGVzaXJlZEJ1ZmZlclNpemUsIG1heERlc2lyZWRCdWZmZXJTaXplKTtcbiAgICB9XG5cbiAgICBpZiAod2FpdFRpbWUgPiA1MCkge1xuICAgICAgICAvLyBJZiB3YWl0IHRpbWUgd2FzID4gNTBtcywgcmUtY2hlY2sgaW4gd2FpdFRpbWUgbXMuXG4gICAgICAgIHRoaXMuX193YWl0VGltZXJJZCA9IHNldFRpbWVvdXQod2FpdEZ1bmN0aW9uLCB3YWl0VGltZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gT3RoZXJ3aXNlLCBzdGFydCBsb2FkaW5nIG5vdy5cbiAgICAgICAgc2VnbWVudFRvRG93bmxvYWQgPSBuZXh0U2VnbWVudFRvTG9hZChjdXJyZW50VGltZSwgYnVmZmVyZWRUaW1lUmFuZ2VzLCBzZWdtZW50TGlzdCk7XG4gICAgICAgIGlmIChleGlzdHkoc2VnbWVudFRvRG93bmxvYWQpKSB7XG4gICAgICAgICAgICAvLyBJZiB3ZSdyZSBoZXJlIGJ1dCB0aGVyZSdzIGEgc2VnbWVudExvYWRYaHIgcmVxdWVzdCwgd2UndmUga2lja2VkIG9mZiBhIHJlY2hlY2sgaW4gdGhlIG1pZGRsZSBvZiBhIHNlZ21lbnRcbiAgICAgICAgICAgIC8vIGRvd25sb2FkLiBIb3dldmVyLCB1bmxlc3Mgd2UncmUgbG9hZGluZyBhIG5ldyBzZWdtZW50IChpZSBub3Qgd2FpdGluZyksIHRoZXJlJ3Mgbm8gcmVhc29uIHRvIGFib3J0IHRoZSBjdXJyZW50XG4gICAgICAgICAgICAvLyByZXF1ZXN0LCBzbyBvbmx5IGNhbmNlbCBoZXJlIChDSlApLlxuICAgICAgICAgICAgaWYgKGV4aXN0eSh0aGlzLl9fc2VnbWVudExvYWRYaHIpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fX3NlZ21lbnRMb2FkWGhyLmFib3J0KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fX3NlZ21lbnRMb2FkWGhyID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLl9fbG9hZEFuZEJ1ZmZlclNlZ21lbnQoc2VnbWVudFRvRG93bmxvYWQsIHNlZ21lbnRMaXN0LCBsb2FkSW5pdGlhbGl6YXRpb24pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQXBwYXJlbnRseSBubyBzZWdtZW50IHRvIGxvYWQsIHNvIGdvIGludG8gYSBob2xkaW5nIHBhdHRlcm4uXG4gICAgICAgICAgICB0aGlzLl9fd2FpdFRpbWVySWQgPSBzZXRUaW1lb3V0KHdhaXRGdW5jdGlvbiwgMjAwMCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fbG9hZEFuZEJ1ZmZlclNlZ21lbnQgPSBmdW5jdGlvbiBsb2FkQW5kQnVmZmVyU2VnbWVudChzZWdtZW50LCBzZWdtZW50TGlzdCwgbG9hZEluaXRpYWxpemF0aW9uKSB7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHJldHJ5Q291bnQgPSBERUZBVUxUX1JFVFJZX0NPVU5ULFxuICAgICAgICByZXRyeUludGVydmFsID0gREVGQVVMVF9SRVRSWV9JTlRFUlZBTCxcbiAgICAgICAgc2VnbWVudHNUb0J1ZmZlciA9IFtdLFxuICAgICAgICByZXF1ZXN0U3RhcnRUaW1lU2Vjb25kcztcblxuICAgIGZ1bmN0aW9uIHN1Y2Nlc3NJbml0aWFsaXphdGlvbihkYXRhKSB7XG4gICAgICAgIHNlZ21lbnRzVG9CdWZmZXIucHVzaChkYXRhLnJlc3BvbnNlKTtcbiAgICAgICAgcmVxdWVzdFN0YXJ0VGltZVNlY29uZHMgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKS8xMDAwO1xuICAgICAgICBzZWxmLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSBmYWxzZTtcbiAgICAgICAgc2VsZi5fX3NlZ21lbnRMb2FkWGhyID0gbG9hZFNlZ21lbnQoc2VnbWVudCwgc3VjY2VzcywgZmFpbCwgc2VsZik7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICAgIHZhciBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuXG4gICAgICAgIHNlbGYuX19sYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiA9ICgobmV3IERhdGUoKS5nZXRUaW1lKCkpLzEwMDApIC0gcmVxdWVzdFN0YXJ0VGltZVNlY29uZHM7XG4gICAgICAgIHNlZ21lbnRzVG9CdWZmZXIucHVzaChkYXRhLnJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi5fX3NlZ21lbnRMb2FkWGhyID0gdW5kZWZpbmVkO1xuXG4gICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX0RBVEFfVVBEQVRFLFxuICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgIHJ0dDogc2VsZi5fX2xhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuLFxuICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgYmFuZHdpZHRoOiBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUub25lKHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5ldmVudExpc3QuUVVFVUVfRU1QVFksIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAvLyBPbmNlIHdlJ3ZlIGNvbXBsZXRlZCBkb3dubG9hZGluZyBhbmQgYnVmZmVyaW5nIHRoZSBzZWdtZW50LCBkaXNwYXRjaCBldmVudCB0byBub3RpZnkgdGhhdCB3ZSBzaG91bGQgcmVjaGVja1xuICAgICAgICAgICAgLy8gd2hldGhlciBvciBub3Qgd2Ugc2hvdWxkIGxvYWQgYW5vdGhlciBzZWdtZW50IGFuZCwgaWYgc28sIHdoaWNoLiAoU2VlOiBfX2NoZWNrU2VnbWVudExvYWRpbmcoKSBtZXRob2QsIGFib3ZlKVxuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5hZGRUb1F1ZXVlKHNlZ21lbnRzVG9CdWZmZXIpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZhaWwoZGF0YSkge1xuICAgICAgICBpZiAoLS1yZXRyeUNvdW50IDw9IDApIHsgcmV0dXJuOyB9XG4gICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBzZWdtZW50IEAgJyArIHNlZ21lbnQuZ2V0VXJsKCkgKyAnLiBSZXF1ZXN0IFN0YXR1czogJyArIGRhdGEuc3RhdHVzKTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJlcXVlc3RTdGFydFRpbWVTZWNvbmRzID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwO1xuICAgICAgICAgICAgc2VsZi5fX3NlZ21lbnRMb2FkWGhyID0gbG9hZFNlZ21lbnQoZGF0YS5yZXF1ZXN0ZWRTZWdtZW50LCBzdWNjZXNzLCBmYWlsLCBzZWxmKTtcbiAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgfVxuXG4gICAgaWYgKGxvYWRJbml0aWFsaXphdGlvbikge1xuICAgICAgICBzZWxmLl9fc2VnbWVudExvYWRYaHIgPSBsb2FkU2VnbWVudChzZWdtZW50TGlzdC5nZXRJbml0aWFsaXphdGlvbigpLCBzdWNjZXNzSW5pdGlhbGl6YXRpb24sIGZhaWwsIHNlbGYpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlcXVlc3RTdGFydFRpbWVTZWNvbmRzID0gbmV3IERhdGUoKS5nZXRUaW1lKCkvMTAwMDtcbiAgICAgICAgc2VsZi5fX3NlZ21lbnRMb2FkWGhyID0gbG9hZFNlZ21lbnQoc2VnbWVudCwgc3VjY2VzcywgZmFpbCwgc2VsZik7XG4gICAgfVxufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhVHlwZUxvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgU291cmNlQnVmZmVyRGF0YVF1ZXVlID0gcmVxdWlyZSgnLi9Tb3VyY2VCdWZmZXJEYXRhUXVldWUuanMnKSxcbiAgICBNZWRpYVR5cGVMb2FkZXIgPSByZXF1aXJlKCcuL01lZGlhVHlwZUxvYWRlci5qcycpLFxuICAgIHNlbGVjdFNlZ21lbnRMaXN0ID0gcmVxdWlyZSgnLi9zZWxlY3RTZWdtZW50TGlzdC5qcycpLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL21hbmlmZXN0L01lZGlhVHlwZXMuanMnKTtcblxuLy8gVE9ETzogTWlncmF0ZSBtZXRob2RzIGJlbG93IHRvIGEgZmFjdG9yeS5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUpIHtcbiAgICB2YXIgc291cmNlQnVmZmVyVHlwZSA9IG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpLmdldFNvdXJjZUJ1ZmZlclR5cGUoKSxcbiAgICAgICAgLy8gVE9ETzogVHJ5L2NhdGNoIGJsb2NrP1xuICAgICAgICBzb3VyY2VCdWZmZXIgPSBtZWRpYVNvdXJjZS5hZGRTb3VyY2VCdWZmZXIoc291cmNlQnVmZmVyVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpIHtcbiAgICB2YXIgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBNZWRpYVR5cGVMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgdGVjaCk7XG59XG5cbi8qKlxuICpcbiAqIEZhY3Rvcnktc3R5bGUgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgc2V0IG9mIE1lZGlhVHlwZUxvYWRlcnMgYmFzZWQgb24gd2hhdCdzIGRlZmluZWQgaW4gdGhlIG1hbmlmZXN0IGFuZCB3aGF0IG1lZGlhIHR5cGVzIGFyZSBzdXBwb3J0ZWQuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQHJldHVybnMge0FycmF5LjxNZWRpYVR5cGVMb2FkZXI+fSAgICAgICAgICAgICAgIFNldCBvZiBNZWRpYVR5cGVMb2FkZXJzIGZvciBsb2FkaW5nIHNlZ21lbnRzIGZvciBhIGdpdmVuIG1lZGlhIHR5cGUgKGUuZy4gYXVkaW8gb3IgdmlkZW8pXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1lZGlhVHlwZUxvYWRlcnMobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBtYXRjaGVkVHlwZXMgPSBtZWRpYVR5cGVzLmZpbHRlcihmdW5jdGlvbihtZWRpYVR5cGUpIHtcbiAgICAgICAgICAgIHZhciBleGlzdHMgPSBleGlzdHkobWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkpO1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0czsgfSksXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlcnMgPSBtYXRjaGVkVHlwZXMubWFwKGZ1bmN0aW9uKG1lZGlhVHlwZSkgeyByZXR1cm4gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFUeXBlTG9hZGVycztcbn1cblxuLyoqXG4gKlxuICogUGxheWxpc3RMb2FkZXIgaGFuZGxlcyB0aGUgdG9wLWxldmVsIGxvYWRpbmcgYW5kIHBsYXliYWNrIG9mIHNlZ21lbnRzIGZvciBhbGwgbWVkaWEgdHlwZXMgKGUuZy4gYm90aCBhdWRpbyBhbmQgdmlkZW8pLlxuICogVGhpcyBpbmNsdWRlcyBjaGVja2luZyBpZiBpdCBzaG91bGQgc3dpdGNoIHNlZ21lbnQgbGlzdHMsIHVwZGF0aW5nL3JldHJpZXZpbmcgZGF0YSByZWxldmFudCB0byB0aGVzZSBkZWNpc2lvbiBmb3JcbiAqIGVhY2ggbWVkaWEgdHlwZS4gSXQgYWxzbyBpbmNsdWRlcyBjaGFuZ2luZyB0aGUgcGxheWJhY2sgcmF0ZSBvZiB0aGUgdmlkZW8gYmFzZWQgb24gZGF0YSBhdmFpbGFibGUgaW4gdGhlIHNvdXJjZSBidWZmZXIuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgdGhpcy5fX21lZGlhVHlwZUxvYWRlcnMgPSBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpO1xuXG4gICAgdmFyIGk7XG5cbiAgICBmdW5jdGlvbiBraWNrb2ZmTWVkaWFUeXBlTG9hZGVyKG1lZGlhVHlwZUxvYWRlcikge1xuICAgICAgICAvLyBNZWRpYVNldC1zcGVjaWZpYyB2YXJpYWJsZXNcbiAgICAgICAgdmFyIGRvd25sb2FkUmF0ZVJhdGlvID0gMS4wLFxuICAgICAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gbWVkaWFUeXBlTG9hZGVyLmdldEN1cnJlbnRCYW5kd2lkdGgoKSxcbiAgICAgICAgICAgIG1lZGlhVHlwZSA9IG1lZGlhVHlwZUxvYWRlci5nZXRNZWRpYVR5cGUoKTtcblxuICAgICAgICAvLyBMaXN0ZW4gZm9yIGV2ZW50IHRlbGxpbmcgdXMgdG8gcmVjaGVjayB3aGljaCBzZWdtZW50IGxpc3QgdGhlIHNlZ21lbnRzIHNob3VsZCBiZSBsb2FkZWQgZnJvbS5cbiAgICAgICAgbWVkaWFUeXBlTG9hZGVyLm9uKG1lZGlhVHlwZUxvYWRlci5ldmVudExpc3QuUkVDSEVDS19DVVJSRU5UX1NFR01FTlRfTElTVCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBtZWRpYVNldCA9IG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpLFxuICAgICAgICAgICAgICAgIGlzRnVsbHNjcmVlbiA9IHRlY2gucGxheWVyKCkuaXNGdWxsc2NyZWVuKCksXG4gICAgICAgICAgICAgICAgZGF0YSA9IHt9LFxuICAgICAgICAgICAgICAgIHNlbGVjdGVkU2VnbWVudExpc3Q7XG5cbiAgICAgICAgICAgIGRhdGEuZG93bmxvYWRSYXRlUmF0aW8gPSBkb3dubG9hZFJhdGVSYXRpbztcbiAgICAgICAgICAgIGRhdGEuY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoO1xuXG4gICAgICAgICAgICAvLyBSYXRoZXIgdGhhbiBtb25pdG9yaW5nIGV2ZW50cy91cGRhdGluZyBzdGF0ZSwgc2ltcGx5IGdldCByZWxldmFudCB2aWRlbyB2aWV3cG9ydCBkaW1zIG9uIHRoZSBmbHkgYXMgbmVlZGVkLlxuICAgICAgICAgICAgZGF0YS53aWR0aCA9IGlzRnVsbHNjcmVlbiA/IHdpbmRvdy5zY3JlZW4ud2lkdGggOiB0ZWNoLnBsYXllcigpLndpZHRoKCk7XG4gICAgICAgICAgICBkYXRhLmhlaWdodCA9IGlzRnVsbHNjcmVlbiA/IHdpbmRvdy5zY3JlZW4uaGVpZ2h0IDogdGVjaC5wbGF5ZXIoKS5oZWlnaHQoKTtcblxuICAgICAgICAgICAgc2VsZWN0ZWRTZWdtZW50TGlzdCA9IHNlbGVjdFNlZ21lbnRMaXN0KG1lZGlhU2V0LCBkYXRhKTtcblxuICAgICAgICAgICAgLy8gVE9ETzogU2hvdWxkIHdlIHJlZmFjdG9yIHRvIHNldCBiYXNlZCBvbiBzZWdtZW50TGlzdCBpbnN0ZWFkP1xuICAgICAgICAgICAgLy8gKFBvdGVudGlhbGx5KSB1cGRhdGUgd2hpY2ggc2VnbWVudCBsaXN0IHRoZSBzZWdtZW50cyBzaG91bGQgYmUgbG9hZGVkIGZyb20gKGJhc2VkIG9uIHNlZ21lbnQgbGlzdCdzIGJhbmR3aWR0aC9iaXRyYXRlKVxuICAgICAgICAgICAgbWVkaWFUeXBlTG9hZGVyLnNldEN1cnJlbnRCYW5kd2lkdGgoc2VsZWN0ZWRTZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgZG93bmxvYWQgcmF0ZSAocm91bmQgdHJpcCB0aW1lIHRvIGRvd25sb2FkIGEgc2VnbWVudCBvZiBhIGdpdmVuIGF2ZXJhZ2UgYmFuZHdpZHRoL2JpdHJhdGUpIHRvIHVzZVxuICAgICAgICAvLyB3aXRoIGNob29zaW5nIHdoaWNoIHN0cmVhbSB2YXJpYW50IHRvIGxvYWQgc2VnbWVudHMgZnJvbS5cbiAgICAgICAgbWVkaWFUeXBlTG9hZGVyLm9uKG1lZGlhVHlwZUxvYWRlci5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBkb3dubG9hZFJhdGVSYXRpbyA9IGV2ZW50LmRhdGEucGxheWJhY2tUaW1lIC8gZXZlbnQuZGF0YS5ydHQ7XG4gICAgICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBldmVudC5kYXRhLmJhbmR3aWR0aDtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gS2lja29mZiBzZWdtZW50IGxvYWRpbmcgZm9yIHRoZSBtZWRpYSB0eXBlLlxuICAgICAgICBtZWRpYVR5cGVMb2FkZXIuc3RhcnRMb2FkaW5nU2VnbWVudHMoKTtcbiAgICB9XG5cbiAgICAvLyBGb3IgZWFjaCBvZiB0aGUgbWVkaWEgdHlwZXMgKGUuZy4gJ2F1ZGlvJyAmICd2aWRlbycpIGluIHRoZSBBQlIgbWFuaWZlc3QuLi5cbiAgICBmb3IgKGk9MDsgaTx0aGlzLl9fbWVkaWFUeXBlTG9hZGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICBraWNrb2ZmTWVkaWFUeXBlTG9hZGVyKHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzW2ldKTtcbiAgICB9XG5cbiAgICAvLyBOT1RFOiBUaGlzIGNvZGUgYmxvY2sgaGFuZGxlcyBwc2V1ZG8tJ3BhdXNpbmcnLyd1bnBhdXNpbmcnIChjaGFuZ2luZyB0aGUgcGxheWJhY2tSYXRlKSBiYXNlZCBvbiB3aGV0aGVyIG9yIG5vdFxuICAgIC8vIHRoZXJlIGlzIGRhdGEgYXZhaWxhYmxlIGluIHRoZSBidWZmZXIsIGJ1dCBpbmRpcmVjdGx5LCBieSBsaXN0ZW5pbmcgdG8gYSBmZXcgZXZlbnRzIGFuZCB1c2luZyB0aGUgdmlkZW8gZWxlbWVudCdzXG4gICAgLy8gcmVhZHkgc3RhdGUuXG4gICAgdmFyIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50cyA9IFsnc2Vla2luZycsICdjYW5wbGF5JywgJ2NhbnBsYXl0aHJvdWdoJ10sXG4gICAgICAgIGV2ZW50VHlwZTtcblxuICAgIGZ1bmN0aW9uIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50c0hhbmRsZXIoZXZlbnQpIHtcbiAgICAgICAgdmFyIHJlYWR5U3RhdGUgPSB0ZWNoLmVsKCkucmVhZHlTdGF0ZSxcbiAgICAgICAgICAgIHBsYXliYWNrUmF0ZSA9IChyZWFkeVN0YXRlID09PSA0KSA/IDEgOiAwO1xuICAgICAgICB0ZWNoLnNldFBsYXliYWNrUmF0ZShwbGF5YmFja1JhdGUpO1xuICAgIH1cblxuICAgIGZvcihpPTA7IGk8Y2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGV2ZW50VHlwZSA9IGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50c1tpXTtcbiAgICAgICAgdGVjaC5vbihldmVudFR5cGUsIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50c0hhbmRsZXIpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi91dGlsL2lzQXJyYXkuanMnKSxcbiAgICBpc051bWJlciA9IHJlcXVpcmUoJy4vdXRpbC9pc051bWJlci5qcycpLFxuICAgIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpO1xuXG5mdW5jdGlvbiBjcmVhdGVUaW1lUmFuZ2VPYmplY3Qoc291cmNlQnVmZmVyLCBpbmRleCwgdHJhbnNmb3JtRm4pIHtcbiAgICBpZiAoIWlzRnVuY3Rpb24odHJhbnNmb3JtRm4pKSB7XG4gICAgICAgIHRyYW5zZm9ybUZuID0gZnVuY3Rpb24odGltZSkgeyByZXR1cm4gdGltZTsgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRTdGFydDogZnVuY3Rpb24oKSB7IHJldHVybiB0cmFuc2Zvcm1Gbihzb3VyY2VCdWZmZXIuYnVmZmVyZWQuc3RhcnQoaW5kZXgpKTsgfSxcbiAgICAgICAgZ2V0RW5kOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRyYW5zZm9ybUZuKHNvdXJjZUJ1ZmZlci5idWZmZXJlZC5lbmQoaW5kZXgpKTsgfSxcbiAgICAgICAgZ2V0SW5kZXg6IGZ1bmN0aW9uKCkgeyByZXR1cm4gaW5kZXg7IH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdWZmZXJlZFRpbWVSYW5nZUxpc3Qoc291cmNlQnVmZmVyLCB0cmFuc2Zvcm1Gbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldExlbmd0aDogZnVuY3Rpb24oKSB7IHJldHVybiBzb3VyY2VCdWZmZXIuYnVmZmVyZWQubGVuZ3RoOyB9LFxuICAgICAgICBnZXRUaW1lUmFuZ2VCeUluZGV4OiBmdW5jdGlvbihpbmRleCkgeyByZXR1cm4gY3JlYXRlVGltZVJhbmdlT2JqZWN0KHNvdXJjZUJ1ZmZlciwgaW5kZXgsIHRyYW5zZm9ybUZuKTsgfSxcbiAgICAgICAgZ2V0VGltZVJhbmdlQnlUaW1lOiBmdW5jdGlvbih0aW1lLCB0b2xlcmFuY2UpIHtcbiAgICAgICAgICAgIGlmICghaXNOdW1iZXIodG9sZXJhbmNlKSkgeyB0b2xlcmFuY2UgPSAwLjE1OyB9XG4gICAgICAgICAgICB2YXIgdGltZVJhbmdlT2JqLFxuICAgICAgICAgICAgICAgIGksXG4gICAgICAgICAgICAgICAgbGVuZ3RoID0gc291cmNlQnVmZmVyLmJ1ZmZlcmVkLmxlbmd0aDtcblxuICAgICAgICAgICAgZm9yIChpPTA7IGk8bGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB0aW1lUmFuZ2VPYmogPSBjcmVhdGVUaW1lUmFuZ2VPYmplY3Qoc291cmNlQnVmZmVyLCBpLCB0cmFuc2Zvcm1Gbik7XG4gICAgICAgICAgICAgICAgaWYgKCh0aW1lUmFuZ2VPYmouZ2V0U3RhcnQoKSAtIHRvbGVyYW5jZSkgPiB0aW1lKSB7IHJldHVybiBudWxsOyB9XG4gICAgICAgICAgICAgICAgaWYgKCh0aW1lUmFuZ2VPYmouZ2V0RW5kKCkgKyB0b2xlcmFuY2UpID4gdGltZSkgeyByZXR1cm4gdGltZVJhbmdlT2JqOyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQWxpZ25lZEJ1ZmZlcmVkVGltZVJhbmdlTGlzdChzb3VyY2VCdWZmZXIsIHNlZ21lbnREdXJhdGlvbikge1xuICAgIGZ1bmN0aW9uIHRpbWVBbGlnblRyYW5zZm9ybUZuKHRpbWUpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucm91bmQodGltZSAvIHNlZ21lbnREdXJhdGlvbikgKiBzZWdtZW50RHVyYXRpb247XG4gICAgfVxuXG4gICAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcmVkVGltZVJhbmdlTGlzdChzb3VyY2VCdWZmZXIsIHRpbWVBbGlnblRyYW5zZm9ybUZuKTtcbn1cblxuLyoqXG4gKiBTb3VyY2VCdWZmZXJEYXRhUXVldWUgYWRkcy9xdWV1ZXMgc2VnbWVudHMgdG8gdGhlIGNvcnJlc3BvbmRpbmcgTVNFIFNvdXJjZUJ1ZmZlciAoTk9URTogVGhlcmUgc2hvdWxkIGJlIG9uZSBwZXIgbWVkaWEgdHlwZS9tZWRpYSBzZXQpXG4gKlxuICogQHBhcmFtIHNvdXJjZUJ1ZmZlciB7U291cmNlQnVmZmVyfSAgIE1TRSBTb3VyY2VCdWZmZXIgaW5zdGFuY2VcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgdHlwZT9cbiAgICBpZiAoIXNvdXJjZUJ1ZmZlcikgeyB0aHJvdyBuZXcgRXJyb3IoICdUaGUgc291cmNlQnVmZmVyIGNvbnN0cnVjdG9yIGFyZ3VtZW50IGNhbm5vdCBiZSBudWxsLicgKTsgfVxuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBkYXRhUXVldWUgPSBbXTtcbiAgICAvLyBUT0RPOiBmaWd1cmUgb3V0IGhvdyB3ZSB3YW50IHRvIHJlc3BvbmQgdG8gb3RoZXIgZXZlbnQgc3RhdGVzICh1cGRhdGVlbmQ/IGVycm9yPyBhYm9ydD8pIChyZXRyeT8gcmVtb3ZlPylcbiAgICBzb3VyY2VCdWZmZXIuYWRkRXZlbnRMaXN0ZW5lcigndXBkYXRlZW5kJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgLy8gVGhlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZSdzIHVwZGF0aW5nIHByb3BlcnR5IHNob3VsZCBhbHdheXMgYmUgZmFsc2UgaWYgdGhpcyBldmVudCB3YXMgZGlzcGF0Y2hlZCxcbiAgICAgICAgLy8gYnV0IGp1c3QgaW4gY2FzZS4uLlxuICAgICAgICBpZiAoZXZlbnQudGFyZ2V0LnVwZGF0aW5nKSB7IHJldHVybjsgfVxuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9BRERFRF9UT19CVUZGRVIsIHRhcmdldDpzZWxmIH0pO1xuXG4gICAgICAgIGlmIChzZWxmLl9fZGF0YVF1ZXVlLmxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKHNlbGYuX19kYXRhUXVldWUuc2hpZnQoKSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gZGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXIgPSBzb3VyY2VCdWZmZXI7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBRVUVVRV9FTVBUWTogJ3F1ZXVlRW1wdHknLFxuICAgIFNFR01FTlRfQURERURfVE9fQlVGRkVSOiAnc2VnbWVudEFkZGVkVG9CdWZmZXInXG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmFkZFRvUXVldWUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIGRhdGFUb0FkZEltbWVkaWF0ZWx5O1xuICAgIGlmICghZXhpc3R5KGRhdGEpIHx8IChpc0FycmF5KGRhdGEpICYmIGRhdGEubGVuZ3RoIDw9IDApKSB7IHJldHVybjsgfVxuICAgIC8vIFRyZWF0IGFsbCBkYXRhIGFzIGFycmF5cyB0byBtYWtlIHN1YnNlcXVlbnQgZnVuY3Rpb25hbGl0eSBnZW5lcmljLlxuICAgIGlmICghaXNBcnJheShkYXRhKSkgeyBkYXRhID0gW2RhdGFdOyB9XG4gICAgLy8gSWYgbm90aGluZyBpcyBpbiB0aGUgcXVldWUsIGdvIGFoZWFkIGFuZCBpbW1lZGlhdGVseSBhcHBlbmQgdGhlIGZpcnN0IGRhdGEgdG8gdGhlIHNvdXJjZSBidWZmZXIuXG4gICAgaWYgKCh0aGlzLl9fZGF0YVF1ZXVlLmxlbmd0aCA9PT0gMCkgJiYgKCF0aGlzLl9fc291cmNlQnVmZmVyLnVwZGF0aW5nKSkgeyBkYXRhVG9BZGRJbW1lZGlhdGVseSA9IGRhdGEuc2hpZnQoKTsgfVxuICAgIC8vIElmIGFueSBvdGhlciBkYXRhIChzdGlsbCkgZXhpc3RzLCBwdXNoIHRoZSByZXN0IG9udG8gdGhlIGRhdGFRdWV1ZS5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gdGhpcy5fX2RhdGFRdWV1ZS5jb25jYXQoZGF0YSk7XG4gICAgaWYgKGV4aXN0eShkYXRhVG9BZGRJbW1lZGlhdGVseSkpIHsgdGhpcy5fX3NvdXJjZUJ1ZmZlci5hcHBlbmRCdWZmZXIoZGF0YVRvQWRkSW1tZWRpYXRlbHkpOyB9XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmNsZWFyUXVldWUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gW107XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBjcmVhdGVCdWZmZXJlZFRpbWVSYW5nZUxpc3QodGhpcy5fX3NvdXJjZUJ1ZmZlcik7XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdEFsaWduZWRUb1NlZ21lbnREdXJhdGlvbiA9IGZ1bmN0aW9uKHNlZ21lbnREdXJhdGlvbikge1xuICAgIHJldHVybiBjcmVhdGVBbGlnbmVkQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHRoaXMuX19zb3VyY2VCdWZmZXIsIHNlZ21lbnREdXJhdGlvbik7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlQnVmZmVyRGF0YVF1ZXVlOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIE1lZGlhU291cmNlID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLk1lZGlhU291cmNlLFxuICAgIE1hbmlmZXN0Q29udHJvbGxlciA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWFuaWZlc3RDb250cm9sbGVyLmpzJyksXG4gICAgUGxheWxpc3RMb2FkZXIgPSByZXF1aXJlKCcuL1BsYXlsaXN0TG9hZGVyLmpzJyk7XG5cbi8vIFRPRE86IERJU1BPU0UgTUVUSE9EXG4vKipcbiAqXG4gKiBDbGFzcyB0aGF0IGRlZmluZXMgdGhlIHJvb3QgY29udGV4dCBmb3IgaGFuZGxpbmcgYSBzcGVjaWZpYyBNUEVHLURBU0ggbWVkaWEgc291cmNlLlxuICpcbiAqIEBwYXJhbSBzb3VyY2UgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHNvdXJjZSwgc3VjaCBhcyB0aGUgdXJpIChzcmMpIGFuZCB0aGUgdHlwZSAodHlwZSlcbiAqIEBwYXJhbSB0ZWNoICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBvYmplY3QgcHJvdmlkaW5nIHRoZSBwb2ludCBvZiBpbnRlcmFjdGlvbiBiZXR3ZWVuIHRoZSBTb3VyY2VIYW5kbGVyIGluc3RhbmNlIGFuZFxuICogICAgICAgICAgICAgICAgICB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nIGUuZy4gdGhlIHZpZGVvIGVsZW1lbnQpXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1hbmlmZXN0Q29udHJvbGxlciA9IG5ldyBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlLnNyYywgZmFsc2UpO1xuXG4gICAgbWFuaWZlc3RDb250cm9sbGVyLm9uZShtYW5pZmVzdENvbnRyb2xsZXIuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgdmFyIG1lZGlhU291cmNlID0gbmV3IE1lZGlhU291cmNlKCksXG4gICAgICAgICAgICBvcGVuTGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1lZGlhU291cmNlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fcGxheWxpc3RMb2FkZXIgPSBuZXcgUGxheWxpc3RMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgY2xvc2UuXG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignd2Via2l0c291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgICAgIHRlY2guc2V0U3JjKFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpKTtcbiAgICB9KTtcblxuICAgIG1hbmlmZXN0Q29udHJvbGxlci5sb2FkKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlSGFuZGxlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCxcbiAgICAvLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lLFxuICAgIFNFQ09ORFNfSU5fWUVBUiA9IDM2NSAqIDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01PTlRIID0gMzAgKiAyNCAqIDYwICogNjAsIC8vIG5vdCBwcmVjaXNlIVxuICAgIFNFQ09ORFNfSU5fREFZID0gMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fSE9VUiA9IDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NSU4gPSA2MCxcbiAgICBNSU5VVEVTX0lOX0hPVVIgPSA2MCxcbiAgICBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUyA9IDEwMDAsXG4gICAgZHVyYXRpb25SZWdleCA9IC9eUCgoW1xcZC5dKilZKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKUQpP1Q/KChbXFxkLl0qKUgpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopUyk/LyxcbiAgICBkYXRlVGltZVJlZ2V4ID0gL14oWzAtOV17NH0pLShbMC05XXsyfSktKFswLTldezJ9KVQoWzAtOV17Mn0pOihbMC05XXsyfSkoPzo6KFswLTldKikoXFwuWzAtOV0qKT8pPyg/OihbKy1dKShbMC05XXsyfSkoWzAtOV17Mn0pKT8vO1xuXG5wYXJzZVJvb3RVcmwgPSBmdW5jdGlvbih1cmwpIHtcbiAgICBpZiAodHlwZW9mIHVybCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignLycpID09PSAtMSkge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCc/JykgIT09IC0xKSB7XG4gICAgICAgIHVybCA9IHVybC5zdWJzdHJpbmcoMCwgdXJsLmluZGV4T2YoJz8nKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVybC5zdWJzdHJpbmcoMCwgdXJsLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn07XG5cbi8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgLy9zdHIgPSBcIlAxMFkxME0xMERUMTBIMTBNMTAuMVNcIjtcbiAgICBpZiAoIXN0cikgeyByZXR1cm4gTnVtYmVyLk5hTjsgfVxuICAgIHZhciBtYXRjaCA9IGR1cmF0aW9uUmVnZXguZXhlYyhzdHIpO1xuICAgIGlmICghbWF0Y2gpIHsgcmV0dXJuIE51bWJlci5OYU47IH1cbiAgICByZXR1cm4gKHBhcnNlRmxvYXQobWF0Y2hbMl0gfHwgMCkgKiBTRUNPTkRTX0lOX1lFQVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzRdIHx8IDApICogU0VDT05EU19JTl9NT05USCArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNl0gfHwgMCkgKiBTRUNPTkRTX0lOX0RBWSArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbOF0gfHwgMCkgKiBTRUNPTkRTX0lOX0hPVVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEwXSB8fCAwKSAqIFNFQ09ORFNfSU5fTUlOICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMl0gfHwgMCkpO1xufTtcblxuLyoqXG4gKiBQYXJzZXIgZm9yIGZvcm1hdHRlZCBkYXRldGltZSBzdHJpbmdzIGNvbmZvcm1pbmcgdG8gdGhlIElTTyA4NjAxIHN0YW5kYXJkLlxuICogR2VuZXJhbCBGb3JtYXQ6ICBZWVlZLU1NLUREVEhIOk1NOlNTWiAoVVRDKSBvciBZWVlZLU1NLUREVEhIOk1NOlNTK0hIOk1NICh0aW1lIHpvbmUgbG9jYWxpemF0aW9uKVxuICogRXggU3RyaW5nOiAgICAgICAyMDE0LTEyLTE3VDE0OjA5OjU4WiAoVVRDKSBvciAyMDE0LTEyLTE3VDE0OjE1OjU4KzA2OjAwICh0aW1lIHpvbmUgbG9jYWxpemF0aW9uKSAvIDIwMTQtMTItMTdUMTQ6MDM6NTgtMDY6MDAgKHRpbWUgem9uZSBsb2NhbGl6YXRpb24pXG4gKlxuICogQHBhcmFtIHN0ciB7c3RyaW5nfSAgSVNPIDg2MDEtY29tcGxpYW50IGRhdGV0aW1lIHN0cmluZy5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IFVUQyBVbml4IHRpbWUuXG4gKi9cbnBhcnNlRGF0ZVRpbWUgPSBmdW5jdGlvbihzdHIpIHtcbiAgICB2YXIgbWF0Y2ggPSBkYXRlVGltZVJlZ2V4LmV4ZWMoc3RyKSxcbiAgICAgICAgdXRjRGF0ZTtcblxuICAgIC8vIElmIHRoZSBzdHJpbmcgZG9lcyBub3QgY29udGFpbiBhIHRpbWV6b25lIG9mZnNldCBkaWZmZXJlbnQgYnJvd3NlcnMgY2FuIGludGVycHJldCBpdCBlaXRoZXJcbiAgICAvLyBhcyBVVEMgb3IgYXMgYSBsb2NhbCB0aW1lIHNvIHdlIGhhdmUgdG8gcGFyc2UgdGhlIHN0cmluZyBtYW51YWxseSB0byBub3JtYWxpemUgdGhlIGdpdmVuIGRhdGUgdmFsdWUgZm9yXG4gICAgLy8gYWxsIGJyb3dzZXJzXG4gICAgdXRjRGF0ZSA9IERhdGUuVVRDKFxuICAgICAgICBwYXJzZUludChtYXRjaFsxXSwgMTApLFxuICAgICAgICBwYXJzZUludChtYXRjaFsyXSwgMTApLTEsIC8vIG1vbnRocyBzdGFydCBmcm9tIHplcm9cbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbM10sIDEwKSxcbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbNF0sIDEwKSxcbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbNV0sIDEwKSxcbiAgICAgICAgKG1hdGNoWzZdICYmIHBhcnNlSW50KG1hdGNoWzZdLCAxMCkgfHwgMCksXG4gICAgICAgIChtYXRjaFs3XSAmJiBwYXJzZUZsb2F0KG1hdGNoWzddKSAqIE1JTExJU0VDT05EU19JTl9TRUNPTkRTKSB8fCAwKTtcbiAgICAvLyBJZiB0aGUgZGF0ZSBoYXMgdGltZXpvbmUgb2Zmc2V0IHRha2UgaXQgaW50byBhY2NvdW50IGFzIHdlbGxcbiAgICBpZiAobWF0Y2hbOV0gJiYgbWF0Y2hbMTBdKSB7XG4gICAgICAgIHZhciB0aW1lem9uZU9mZnNldCA9IHBhcnNlSW50KG1hdGNoWzldLCAxMCkgKiBNSU5VVEVTX0lOX0hPVVIgKyBwYXJzZUludChtYXRjaFsxMF0sIDEwKTtcbiAgICAgICAgdXRjRGF0ZSArPSAobWF0Y2hbOF0gPT09ICcrJyA/IC0xIDogKzEpICogdGltZXpvbmVPZmZzZXQgKiBTRUNPTkRTX0lOX01JTiAqIE1JTExJU0VDT05EU19JTl9TRUNPTkRTO1xuICAgIH1cblxuICAgIHJldHVybiB1dGNEYXRlO1xufTtcblxudmFyIGRhc2hVdGlsID0ge1xuICAgIHBhcnNlUm9vdFVybDogcGFyc2VSb290VXJsLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHBhcnNlRGF0ZVRpbWU6IHBhcnNlRGF0ZVRpbWVcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2V0RGFzaFV0aWwoKSB7IHJldHVybiBkYXNoVXRpbDsgfTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZXRYbWxGdW4gPSByZXF1aXJlKCcuLi8uLi9nZXRYbWxGdW4uanMnKSxcbiAgICB4bWxGdW4gPSBnZXRYbWxGdW4oKSxcbiAgICBnZXREYXNoVXRpbCA9IHJlcXVpcmUoJy4vZ2V0RGFzaFV0aWwuanMnKSxcbiAgICBkYXNoVXRpbCA9IGdldERhc2hVdGlsKCksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi8uLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaXNTdHJpbmcuanMnKSxcbiAgICBwYXJzZVJvb3RVcmwgPSBkYXNoVXRpbC5wYXJzZVJvb3RVcmwsXG4gICAgY3JlYXRlTXBkT2JqZWN0LFxuICAgIGNyZWF0ZVBlcmlvZE9iamVjdCxcbiAgICBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0LFxuICAgIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0LFxuICAgIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSxcbiAgICBnZXRNcGQsXG4gICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSxcbiAgICBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLFxuICAgIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lO1xuXG4vLyBUT0RPOiBTaG91bGQgdGhpcyBleGlzdCBvbiBtcGQgZGF0YXZpZXcgb3IgYXQgYSBoaWdoZXIgbGV2ZWw/XG4vLyBUT0RPOiBSZWZhY3Rvci4gQ291bGQgYmUgbW9yZSBlZmZpY2llbnQgKFJlY3Vyc2l2ZSBmbj8gVXNlIGVsZW1lbnQuZ2V0RWxlbWVudHNCeU5hbWUoJ0Jhc2VVcmwnKVswXT8pLlxuLy8gVE9ETzogQ3VycmVudGx5IGFzc3VtaW5nICpFSVRIRVIqIDxCYXNlVVJMPiBub2RlcyB3aWxsIHByb3ZpZGUgYW4gYWJzb2x1dGUgYmFzZSB1cmwgKGllIHJlc29sdmUgdG8gJ2h0dHA6Ly8nIGV0Yylcbi8vIFRPRE86ICpPUiogd2Ugc2hvdWxkIHVzZSB0aGUgYmFzZSB1cmwgb2YgdGhlIGhvc3Qgb2YgdGhlIE1QRCBtYW5pZmVzdC5cbnZhciBidWlsZEJhc2VVcmwgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgdmFyIGVsZW1IaWVyYXJjaHkgPSBbeG1sTm9kZV0uY29uY2F0KHhtbEZ1bi5nZXRBbmNlc3RvcnMoeG1sTm9kZSkpLFxuICAgICAgICBmb3VuZExvY2FsQmFzZVVybCA9IGZhbHNlO1xuICAgIHZhciBiYXNlVXJscyA9IGVsZW1IaWVyYXJjaHkubWFwKGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKGZvdW5kTG9jYWxCYXNlVXJsKSB7IHJldHVybiAnJzsgfVxuICAgICAgICBpZiAoIWVsZW0uaGFzQ2hpbGROb2RlcygpKSB7IHJldHVybiAnJzsgfVxuICAgICAgICB2YXIgY2hpbGQ7XG4gICAgICAgIGZvciAodmFyIGk9MDsgaTxlbGVtLmNoaWxkTm9kZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNoaWxkID0gZWxlbS5jaGlsZE5vZGVzLml0ZW0oaSk7XG4gICAgICAgICAgICBpZiAoY2hpbGQubm9kZU5hbWUgPT09ICdCYXNlVVJMJykge1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0RWxlbSA9IGNoaWxkLmNoaWxkTm9kZXMuaXRlbSgwKTtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dFZhbHVlID0gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgICAgICBpZiAodGV4dFZhbHVlLmluZGV4T2YoJ2h0dHA6Ly8nKSA9PT0gMCkgeyBmb3VuZExvY2FsQmFzZVVybCA9IHRydWU7IH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAnJztcbiAgICB9KTtcblxuICAgIHZhciBiYXNlVXJsID0gYmFzZVVybHMucmV2ZXJzZSgpLmpvaW4oJycpO1xuICAgIGlmICghYmFzZVVybCkgeyByZXR1cm4gcGFyc2VSb290VXJsKHhtbE5vZGUuYmFzZVVSSSk7IH1cbiAgICByZXR1cm4gYmFzZVVybDtcbn07XG5cbnZhciBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzID0gW1xuICAgICdBZGFwdGF0aW9uU2V0JyxcbiAgICAnUmVwcmVzZW50YXRpb24nLFxuICAgICdTdWJSZXByZXNlbnRhdGlvbidcbl07XG5cbnZhciBoYXNDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzLmluZGV4T2YoZWxlbS5ub2RlTmFtZSkgPj0gMDtcbn07XG5cbnZhciBkb2VzbnRIYXZlQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gIWhhc0NvbW1vblByb3BlcnRpZXMoZWxlbSk7XG59O1xuXG4vLyBDb21tb24gQXR0cnNcbnZhciBnZXRXaWR0aCA9IHhtbEZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnd2lkdGgnKSxcbiAgICBnZXRIZWlnaHQgPSB4bWxGdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2hlaWdodCcpLFxuICAgIGdldEZyYW1lUmF0ZSA9IHhtbEZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnZnJhbWVSYXRlJyksXG4gICAgZ2V0TWltZVR5cGUgPSB4bWxGdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ21pbWVUeXBlJyksXG4gICAgZ2V0Q29kZWNzID0geG1sRnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdjb2RlY3MnKTtcblxudmFyIGdldFNlZ21lbnRUZW1wbGF0ZVhtbExpc3QgPSB4bWxGdW4uZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0KCdTZWdtZW50VGVtcGxhdGUnKTtcblxuLy8gTVBEIEF0dHIgZm5zXG52YXIgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHhtbEZ1bi5nZXRBdHRyRm4oJ21lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24nKSxcbiAgICBnZXRUeXBlID0geG1sRnVuLmdldEF0dHJGbigndHlwZScpLFxuICAgIGdldE1pbmltdW1VcGRhdGVQZXJpb2QgPSB4bWxGdW4uZ2V0QXR0ckZuKCdtaW5pbXVtVXBkYXRlUGVyaW9kJyksXG4gICAgZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lID0geG1sRnVuLmdldEF0dHJGbignYXZhaWxhYmlsaXR5U3RhcnRUaW1lJyksXG4gICAgZ2V0U3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXkgPSB4bWxGdW4uZ2V0QXR0ckZuKCdzdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheScpLFxuICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoID0geG1sRnVuLmdldEF0dHJGbigndGltZVNoaWZ0QnVmZmVyRGVwdGgnKTtcblxuLy8gUmVwcmVzZW50YXRpb24gQXR0ciBmbnNcbnZhciBnZXRJZCA9IHhtbEZ1bi5nZXRBdHRyRm4oJ2lkJyksXG4gICAgZ2V0QmFuZHdpZHRoID0geG1sRnVuLmdldEF0dHJGbignYmFuZHdpZHRoJyk7XG5cbi8vIFNlZ21lbnRUZW1wbGF0ZSBBdHRyIGZuc1xudmFyIGdldEluaXRpYWxpemF0aW9uID0geG1sRnVuLmdldEF0dHJGbignaW5pdGlhbGl6YXRpb24nKSxcbiAgICBnZXRNZWRpYSA9IHhtbEZ1bi5nZXRBdHRyRm4oJ21lZGlhJyksXG4gICAgZ2V0RHVyYXRpb24gPSB4bWxGdW4uZ2V0QXR0ckZuKCdkdXJhdGlvbicpLFxuICAgIGdldFRpbWVzY2FsZSA9IHhtbEZ1bi5nZXRBdHRyRm4oJ3RpbWVzY2FsZScpLFxuICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSB4bWxGdW4uZ2V0QXR0ckZuKCdwcmVzZW50YXRpb25UaW1lT2Zmc2V0JyksXG4gICAgZ2V0U3RhcnROdW1iZXIgPSB4bWxGdW4uZ2V0QXR0ckZuKCdzdGFydE51bWJlcicpO1xuXG4vLyBUT0RPOiBSZXBlYXQgY29kZS4gQWJzdHJhY3QgYXdheSAoUHJvdG90eXBhbCBJbmhlcml0YW5jZS9PTyBNb2RlbD8gT2JqZWN0IGNvbXBvc2VyIGZuPylcbmNyZWF0ZU1wZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UGVyaW9kczogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFR5cGU6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZDogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbmltdW1VcGRhdGVQZXJpb2QsIHhtbE5vZGUpLFxuICAgICAgICBnZXRBdmFpbGFiaWxpdHlTdGFydFRpbWU6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdmFpbGFiaWxpdHlTdGFydFRpbWUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRTdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheTogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldFN1Z2dlc3RlZFByZXNlbnRhdGlvbkRlbGF5LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGg6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlUGVyaW9kT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0czogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGU6IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgICAgIHJldHVybiBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlKHR5cGUsIHhtbE5vZGUpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRNcGQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClcbiAgICB9O1xufTtcblxuY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UmVwcmVzZW50YXRpb25zOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ1JlcHJlc2VudGF0aW9uJywgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QpLFxuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWxMaXN0KHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWxMaXN0KHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SWQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJZCwgeG1sTm9kZSksXG4gICAgICAgIGdldFdpZHRoOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0V2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRGcmFtZVJhdGU6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRGcmFtZVJhdGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRDb2RlY3M6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRDb2RlY3MsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYXNlVXJsOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oYnVpbGRCYXNlVXJsLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWltZVR5cGU6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW1lVHlwZSwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudFRlbXBsYXRlID0gZnVuY3Rpb24oeG1sQXJyYXkpIHtcbiAgICAvLyBFZmZlY3RpdmVseSBhIGZpbmQgZnVuY3Rpb24gKyBhIG1hcCBmdW5jdGlvbi5cbiAgICBmdW5jdGlvbiBnZXRBdHRyRnJvbVhtbEFycmF5KGF0dHJHZXR0ZXJGbiwgeG1sQXJyYXkpIHtcbiAgICAgICAgaWYgKCFpc0FycmF5KHhtbEFycmF5KSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmICghaXNGdW5jdGlvbihhdHRyR2V0dGVyRm4pKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cblxuICAgICAgICB2YXIgaSxcbiAgICAgICAgICAgIGxlbmd0aCA9IHhtbEFycmF5Lmxlbmd0aCxcbiAgICAgICAgICAgIGN1cnJlbnRBdHRyVmFsdWU7XG5cbiAgICAgICAgZm9yIChpPTA7IGk8eG1sQXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnJlbnRBdHRyVmFsdWUgPSBhdHRyR2V0dGVyRm4oeG1sQXJyYXlbaV0pO1xuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGN1cnJlbnRBdHRyVmFsdWUpICYmIGN1cnJlbnRBdHRyVmFsdWUgIT09ICcnKSB7IHJldHVybiBjdXJyZW50QXR0clZhbHVlOyB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sQXJyYXksXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxBcnJheVswXSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbEFycmF5WzBdLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbEFycmF5WzBdLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SW5pdGlhbGl6YXRpb246IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRJbml0aWFsaXphdGlvbiwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRNZWRpYTogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldE1lZGlhLCB4bWxBcnJheSksXG4gICAgICAgIGdldER1cmF0aW9uOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0RHVyYXRpb24sIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0VGltZXNjYWxlOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0VGltZXNjYWxlLCB4bWxBcnJheSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxBcnJheSksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0U3RhcnROdW1iZXIsIHhtbEFycmF5KVxuICAgIH07XG59O1xuXG4vLyBUT0RPOiBDaGFuZ2UgdGhpcyBhcGkgdG8gcmV0dXJuIGEgbGlzdCBvZiBhbGwgbWF0Y2hpbmcgYWRhcHRhdGlvbiBzZXRzIHRvIGFsbG93IGZvciBncmVhdGVyIGZsZXhpYmlsaXR5LlxuZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSA9IGZ1bmN0aW9uKHR5cGUsIHBlcmlvZFhtbCkge1xuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IHBlcmlvZFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnQWRhcHRhdGlvblNldCcpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0LFxuICAgICAgICByZXByZXNlbnRhdGlvbixcbiAgICAgICAgbWltZVR5cGU7XG5cbiAgICBmb3IgKHZhciBpPTA7IGk8YWRhcHRhdGlvblNldHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgYWRhcHRhdGlvblNldCA9IGFkYXB0YXRpb25TZXRzLml0ZW0oaSk7XG4gICAgICAgIC8vIFNpbmNlIHRoZSBtaW1lVHlwZSBjYW4gYmUgZGVmaW5lZCBvbiB0aGUgQWRhcHRhdGlvblNldCBvciBvbiBpdHMgUmVwcmVzZW50YXRpb24gY2hpbGQgbm9kZXMsXG4gICAgICAgIC8vIGNoZWNrIGZvciBtaW1ldHlwZSBvbiBvbmUgb2YgaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkcmVuIHVzaW5nIGdldE1pbWVUeXBlKCksIHdoaWNoIGFzc3VtZXMgdGhlXG4gICAgICAgIC8vIG1pbWVUeXBlIGNhbiBiZSBpbmhlcml0ZWQgYW5kIHdpbGwgY2hlY2sgaXRzZWxmIGFuZCBpdHMgYW5jZXN0b3JzIGZvciB0aGUgYXR0ci5cbiAgICAgICAgcmVwcmVzZW50YXRpb24gPSBhZGFwdGF0aW9uU2V0LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdSZXByZXNlbnRhdGlvbicpWzBdO1xuICAgICAgICAvLyBOZWVkIHRvIGNoZWNrIHRoZSByZXByZXNlbnRhdGlvbiBpbnN0ZWFkIG9mIHRoZSBhZGFwdGF0aW9uIHNldCwgc2luY2UgdGhlIG1pbWVUeXBlIG1heSBub3QgYmUgc3BlY2lmaWVkXG4gICAgICAgIC8vIG9uIHRoZSBhZGFwdGF0aW9uIHNldCBhdCBhbGwgYW5kIG1heSBiZSBzcGVjaWZpZWQgZm9yIGVhY2ggb2YgdGhlIHJlcHJlc2VudGF0aW9ucyBpbnN0ZWFkLlxuICAgICAgICBtaW1lVHlwZSA9IGdldE1pbWVUeXBlKHJlcHJlc2VudGF0aW9uKTtcbiAgICAgICAgaWYgKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKSB7IHJldHVybiBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KGFkYXB0YXRpb25TZXQpOyB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG5nZXRNcGQgPSBmdW5jdGlvbihtYW5pZmVzdFhtbCkge1xuICAgIHJldHVybiBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lKG1hbmlmZXN0WG1sLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KVswXTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8geG1sRnVuIG9yIG93biBtb2R1bGUuXG5nZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lID0gZnVuY3Rpb24ocGFyZW50WG1sLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIHZhciBkZXNjZW5kYW50c1htbEFycmF5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwocGFyZW50WG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKHRhZ05hbWUpKTtcbiAgICAvKmlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHsgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTsgfSovXG4gICAgaWYgKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB2YXIgbWFwcGVkRWxlbSA9IGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTtcbiAgICAgICAgcmV0dXJuICBtYXBwZWRFbGVtO1xuICAgIH1cbiAgICByZXR1cm4gZGVzY2VuZGFudHNYbWxBcnJheTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8geG1sRnVuIG9yIG93biBtb2R1bGUuXG5nZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSA9IGZ1bmN0aW9uIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUsIHRhZ05hbWUsIG1hcEZuKSB7XG4gICAgaWYgKCF0YWdOYW1lIHx8ICF4bWxOb2RlIHx8ICF4bWxOb2RlLnBhcmVudE5vZGUpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBpZiAoIXhtbE5vZGUucGFyZW50Tm9kZS5ub2RlTmFtZSkgeyByZXR1cm4gbnVsbDsgfVxuXG4gICAgaWYgKHhtbE5vZGUucGFyZW50Tm9kZS5ub2RlTmFtZSA9PT0gdGFnTmFtZSkge1xuICAgICAgICByZXR1cm4gaXNGdW5jdGlvbihtYXBGbikgPyBtYXBGbih4bWxOb2RlLnBhcmVudE5vZGUpIDogeG1sTm9kZS5wYXJlbnROb2RlO1xuICAgIH1cbiAgICByZXR1cm4gZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUoeG1sTm9kZS5wYXJlbnROb2RlLCB0YWdOYW1lLCBtYXBGbik7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdldE1wZDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi8uLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGdldFhtbEZ1biA9IHJlcXVpcmUoJy4uLy4uL2dldFhtbEZ1bi5qcycpLFxuICAgIHhtbEZ1biA9IGdldFhtbEZ1bigpLFxuICAgIGdldERhc2hVdGlsID0gcmVxdWlyZSgnLi4vbXBkL2dldERhc2hVdGlsLmpzJyksXG4gICAgZGFzaFV0aWwgPSBnZXREYXNoVXRpbCgpLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGRhc2hVdGlsLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lID0gZGFzaFV0aWwucGFyc2VEYXRlVGltZSxcbiAgICBnZXRTZWdtZW50VGVtcGxhdGUgPSByZXF1aXJlKCcuL2dldFNlZ21lbnRUZW1wbGF0ZScpLFxuICAgIHNlZ21lbnRUZW1wbGF0ZSA9IGdldFNlZ21lbnRUZW1wbGF0ZSgpLFxuICAgIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcixcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVVUQ1dhbGxDbG9ja1RpbWUsXG4gICAgZ2V0VHlwZSxcbiAgICBnZXRJc0xpdmUsXG4gICAgZ2V0QmFuZHdpZHRoLFxuICAgIGdldFdpZHRoLFxuICAgIGdldEhlaWdodCxcbiAgICBnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZSxcbiAgICBnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCxcbiAgICBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsXG4gICAgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsXG4gICAgZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlO1xuXG5cbi8qKlxuICpcbiAqIEZ1bmN0aW9uIHVzZWQgdG8gZ2V0IHRoZSAndHlwZScgb2YgYSBEQVNIIFJlcHJlc2VudGF0aW9uIGluIGEgZm9ybWF0IGV4cGVjdGVkIGJ5IHRoZSBNU0UgU291cmNlQnVmZmVyLiBVc2VkIHRvXG4gKiBjcmVhdGUgU291cmNlQnVmZmVyIGluc3RhbmNlcyB0aGF0IGNvcnJlc3BvbmQgdG8gYSBnaXZlbiBNZWRpYVNldCAoZS5nLiBzZXQgb2YgYXVkaW8gc3RyZWFtIHZhcmlhbnRzLCB2aWRlbyBzdHJlYW1cbiAqIHZhcmlhbnRzLCBldGMuKS5cbiAqXG4gKiBAcGFyYW0gcmVwcmVzZW50YXRpb24gICAgUE9KTyBEQVNIIE1QRCBSZXByZXNlbnRhdGlvblxuICogQHJldHVybnMge3N0cmluZ30gICAgICAgIFRoZSBSZXByZXNlbnRhdGlvbidzICd0eXBlJyBpbiBhIGZvcm1hdCBleHBlY3RlZCBieSB0aGUgTVNFIFNvdXJjZUJ1ZmZlclxuICovXG5nZXRUeXBlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgY29kZWNTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRDb2RlY3MoKTtcbiAgICB2YXIgdHlwZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1pbWVUeXBlKCk7XG5cbiAgICAvL05PVEU6IExFQURJTkcgWkVST1MgSU4gQ09ERUMgVFlQRS9TVUJUWVBFIEFSRSBURUNITklDQUxMWSBOT1QgU1BFQyBDT01QTElBTlQsIEJVVCBHUEFDICYgT1RIRVJcbiAgICAvLyBEQVNIIE1QRCBHRU5FUkFUT1JTIFBST0RVQ0UgVEhFU0UgTk9OLUNPTVBMSUFOVCBWQUxVRVMuIEhBTkRMSU5HIEhFUkUgRk9SIE5PVy5cbiAgICAvLyBTZWU6IFJGQyA2MzgxIFNlYy4gMy40IChodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjM4MSNzZWN0aW9uLTMuNClcbiAgICB2YXIgcGFyc2VkQ29kZWMgPSBjb2RlY1N0ci5zcGxpdCgnLicpLm1hcChmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eMCsoPyFcXC58JCkvLCAnJyk7XG4gICAgfSk7XG4gICAgdmFyIHByb2Nlc3NlZENvZGVjU3RyID0gcGFyc2VkQ29kZWMuam9pbignLicpO1xuXG4gICAgcmV0dXJuICh0eXBlU3RyICsgJztjb2RlY3M9XCInICsgcHJvY2Vzc2VkQ29kZWNTdHIgKyAnXCInKTtcbn07XG5cbmdldElzTGl2ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIChyZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRUeXBlKCkgPT09ICdkeW5hbWljJyk7XG59O1xuXG5nZXRCYW5kd2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBiYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCkgPyBOdW1iZXIoYmFuZHdpZHRoKSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldFdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRXaWR0aCgpO1xuICAgIHJldHVybiBleGlzdHkod2lkdGgpID8gTnVtYmVyKHdpZHRoKSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldEhlaWdodCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGhlaWdodCA9IHJlcHJlc2VudGF0aW9uLmdldEhlaWdodCgpO1xuICAgIHJldHVybiBleGlzdHkoaGVpZ2h0KSA/IE51bWJlcihoZWlnaHQpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgLy8gVE9ETzogU3VwcG9ydCBwZXJpb2QtcmVsYXRpdmUgcHJlc2VudGF0aW9uIHRpbWVcbiAgICB2YXIgbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24oKSxcbiAgICAgICAgcGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGV4aXN0eShtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA/IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbihtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA6IE51bWJlci5OYU4sXG4gICAgICAgIHByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCgpKSB8fCAwO1xuICAgIHJldHVybiBleGlzdHkocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikgPyBOdW1iZXIocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiAtIHByZXNlbnRhdGlvblRpbWVPZmZzZXQpIDogTnVtYmVyLk5hTjtcbn07XG5cbmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHdhbGxDbG9ja1RpbWVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRBdmFpbGFiaWxpdHlTdGFydFRpbWUoKSxcbiAgICAgICAgd2FsbENsb2NrVW5peFRpbWVVdGMgPSBwYXJzZURhdGVUaW1lKHdhbGxDbG9ja1RpbWVTdHIpO1xuICAgIHJldHVybiB3YWxsQ2xvY2tVbml4VGltZVV0Yztcbn07XG5cbmdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgdGltZVNoaWZ0QnVmZmVyRGVwdGhTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCgpLFxuICAgICAgICBwYXJzZWRUaW1lU2hpZnRCdWZmZXJEZXB0aCA9IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbih0aW1lU2hpZnRCdWZmZXJEZXB0aFN0cik7XG4gICAgcmV0dXJuIHBhcnNlZFRpbWVTaGlmdEJ1ZmZlckRlcHRoO1xufTtcblxuZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgc2VnbWVudFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCk7XG4gICAgcmV0dXJuIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0RHVyYXRpb24oKSkgLyBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldFRpbWVzY2FsZSgpKTtcbn07XG5cbmdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTWF0aC5jZWlsKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC8gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG59O1xuXG5nZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRTdGFydE51bWJlcigpKTtcbn07XG5cbmdldEVuZE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSArIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAtIDE7XG59O1xuXG5jcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uWG1sKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0VHlwZTogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHJlcHJlc2VudGF0aW9uWG1sKSxcbiAgICAgICAgZ2V0SXNMaXZlOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SXNMaXZlLCByZXByZXNlbnRhdGlvblhtbCksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgcmVwcmVzZW50YXRpb25YbWwpLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHJlcHJlc2VudGF0aW9uWG1sKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgcmVwcmVzZW50YXRpb25YbWwpLFxuICAgICAgICBnZXRUb3RhbER1cmF0aW9uOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25YbWwpLFxuICAgICAgICBnZXRTZWdtZW50RHVyYXRpb246IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uWG1sKSxcbiAgICAgICAgZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvblhtbCksXG4gICAgICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoOiB4bWxGdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGgsIHJlcHJlc2VudGF0aW9uWG1sKSxcbiAgICAgICAgZ2V0VG90YWxTZWdtZW50Q291bnQ6IHhtbEZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25YbWwpLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvblhtbCksXG4gICAgICAgIGdldEVuZE51bWJlcjogeG1sRnVuLnByZUFwcGx5QXJnc0ZuKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25YbWwpLFxuICAgICAgICAvLyBUT0RPOiBFeHRlcm5hbGl6ZVxuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgaW5pdGlhbGl6YXRpb24gPSB7fTtcbiAgICAgICAgICAgIGluaXRpYWxpemF0aW9uLmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb25YbWwuZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgICAgICAgICByZXByZXNlbnRhdGlvbklkID0gcmVwcmVzZW50YXRpb25YbWwuZ2V0SWQoKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb25YbWwuZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0SW5pdGlhbGl6YXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uSWQpO1xuXG4gICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsLCAnQmFuZHdpZHRoJywgcmVwcmVzZW50YXRpb25YbWwuZ2V0QmFuZHdpZHRoKCkpO1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlVXJsICsgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXR1cm4gaW5pdGlhbGl6YXRpb247XG4gICAgICAgIH0sXG4gICAgICAgIGdldFNlZ21lbnRCeU51bWJlcjogZnVuY3Rpb24obnVtYmVyKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb25YbWwsIG51bWJlcik7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVRpbWU6IGZ1bmN0aW9uKHNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUocmVwcmVzZW50YXRpb25YbWwsIHNlY29uZHMpOyB9LFxuICAgICAgICBnZXRTZWdtZW50QnlVVENXYWxsQ2xvY2tUaW1lOiBmdW5jdGlvbih1dGNNaWxsaXNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVVUQ1dhbGxDbG9ja1RpbWUocmVwcmVzZW50YXRpb25YbWwsIHV0Y01pbGxpc2Vjb25kcyk7IH1cbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIG51bWJlcikge1xuICAgIHZhciBzZWdtZW50ID0ge307XG4gICAgc2VnbWVudC5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICBzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldE1lZGlhKCksXG4gICAgICAgICAgICByZXBsYWNlZElkVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbi5nZXRJZCgpKSxcbiAgICAgICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsO1xuICAgICAgICAgICAgLy8gVE9ETzogU2luY2UgJFRpbWUkLXRlbXBsYXRlZCBzZWdtZW50IFVSTHMgc2hvdWxkIG9ubHkgZXhpc3QgaW4gY29uanVuY3Rpb24gdy9hIDxTZWdtZW50VGltZWxpbmU+LFxuICAgICAgICAgICAgLy8gVE9ETzogY2FuIGN1cnJlbnRseSBhc3N1bWUgYSAkTnVtYmVyJC1iYXNlZCB0ZW1wbGF0ZWQgdXJsLlxuICAgICAgICAgICAgLy8gVE9ETzogRW5mb3JjZSBtaW4vbWF4IG51bWJlciByYW5nZSAoYmFzZWQgb24gc2VnbWVudExpc3Qgc3RhcnROdW1iZXIgJiBlbmROdW1iZXIpXG4gICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkSWRVcmwsICdOdW1iZXInLCBudW1iZXIpO1xuICAgICAgICByZXBsYWNlZFRva2Vuc1VybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShyZXBsYWNlZFRva2Vuc1VybCwgJ0JhbmR3aWR0aCcsIHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcblxuICAgICAgICByZXR1cm4gYmFzZVVybCArIHJlcGxhY2VkVG9rZW5zVXJsO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIChudW1iZXIgLSBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pICsgTWF0aC5yb3VuZCgoKG51bWJlciAtIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSkgKiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKSAqIDEwMDApO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXREdXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBUT0RPOiBWZXJpZnlcbiAgICAgICAgdmFyIHN0YW5kYXJkU2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgICAgIGR1cmF0aW9uLFxuICAgICAgICAgICAgbWVkaWFQcmVzZW50YXRpb25UaW1lLFxuICAgICAgICAgICAgcHJlY2lzaW9uTXVsdGlwbGllcjtcblxuICAgICAgICBpZiAoZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSA9PT0gbnVtYmVyKSB7XG4gICAgICAgICAgICBtZWRpYVByZXNlbnRhdGlvblRpbWUgPSBOdW1iZXIoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xuICAgICAgICAgICAgLy8gSGFuZGxlIGZsb2F0aW5nIHBvaW50IHByZWNpc2lvbiBpc3N1ZVxuICAgICAgICAgICAgcHJlY2lzaW9uTXVsdGlwbGllciA9IDEwMDA7XG4gICAgICAgICAgICBkdXJhdGlvbiA9ICgoKG1lZGlhUHJlc2VudGF0aW9uVGltZSAqIHByZWNpc2lvbk11bHRpcGxpZXIpICUgKHN0YW5kYXJkU2VnbWVudER1cmF0aW9uICogcHJlY2lzaW9uTXVsdGlwbGllcikpIC8gcHJlY2lzaW9uTXVsdGlwbGllciApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZHVyYXRpb24gPSBzdGFuZGFyZFNlZ21lbnREdXJhdGlvbjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZHVyYXRpb247XG4gICAgfTtcbiAgICBzZWdtZW50LmdldE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbnVtYmVyOyB9O1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKSB7XG4gICAgdmFyIHNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHN0YXJ0TnVtYmVyID0gZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIHx8IDAsXG4gICAgICAgIG51bWJlciA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIHNlZ21lbnREdXJhdGlvbikgKyBzdGFydE51bWJlcixcbiAgICAgICAgc2VnbWVudCA9IGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTtcblxuICAgIC8vIElmIHdlJ3JlIHJlYWxseSBjbG9zZSB0byB0aGUgZW5kIHRpbWUgb2YgdGhlIGN1cnJlbnQgc2VnbWVudCAoc3RhcnQgdGltZSArIGR1cmF0aW9uKSxcbiAgICAvLyB0aGlzIG1lYW5zIHdlJ3JlIHJlYWxseSBjbG9zZSB0byB0aGUgc3RhcnQgdGltZSBvZiB0aGUgbmV4dCBzZWdtZW50LlxuICAgIC8vIFRoZXJlZm9yZSwgYXNzdW1lIHRoaXMgaXMgYSBmbG9hdGluZy1wb2ludCBwcmVjaXNpb24gaXNzdWUgd2hlcmUgd2Ugd2VyZSB0cnlpbmcgdG8gZ3JhYiBhIHNlZ21lbnRcbiAgICAvLyBieSBpdHMgc3RhcnQgdGltZSBhbmQgcmV0dXJuIHRoZSBuZXh0IHNlZ21lbnQgaW5zdGVhZC5cbiAgICBpZiAoKChzZWdtZW50LmdldFN0YXJ0VGltZSgpICsgc2VnbWVudC5nZXREdXJhdGlvbigpKSAtIHNlY29uZHMpIDw9IDAuMDAzICkge1xuICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIgKyAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVVUQ1dhbGxDbG9ja1RpbWUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgdW5peFRpbWVVdGNNaWxsaXNlY29uZHMpIHtcbiAgICB2YXIgd2FsbENsb2NrU3RhcnRUaW1lID0gZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZTtcbiAgICBpZiAoaXNOYU4od2FsbENsb2NrU3RhcnRUaW1lKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHByZXNlbnRhdGlvblRpbWUgPSAodW5peFRpbWVVdGNNaWxsaXNlY29uZHMgLSB3YWxsQ2xvY2tTdGFydFRpbWUpLzEwMDA7XG4gICAgaWYgKGlzTmFOKHByZXNlbnRhdGlvblRpbWUpKSB7IHJldHVybiBudWxsOyB9XG4gICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUocmVwcmVzZW50YXRpb24sIHByZXNlbnRhdGlvblRpbWUpO1xufTtcblxuZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIGlmICghcmVwcmVzZW50YXRpb24pIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmIChyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKSkgeyByZXR1cm4gY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pOyB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2VnbWVudFRlbXBsYXRlLFxuICAgIHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlO1xuXG56ZXJvUGFkVG9MZW5ndGggPSBmdW5jdGlvbiAobnVtU3RyLCBtaW5TdHJMZW5ndGgpIHtcbiAgICB3aGlsZSAobnVtU3RyLmxlbmd0aCA8IG1pblN0ckxlbmd0aCkge1xuICAgICAgICBudW1TdHIgPSAnMCcgKyBudW1TdHI7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bVN0cjtcbn07XG5cbnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB0b2tlbiwgdmFsdWUpIHtcblxuICAgIHZhciBzdGFydFBvcyA9IDAsXG4gICAgICAgIGVuZFBvcyA9IDAsXG4gICAgICAgIHRva2VuTGVuID0gdG9rZW4ubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWcgPSAnJTAnLFxuICAgICAgICBmb3JtYXRUYWdMZW4gPSBmb3JtYXRUYWcubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWdQb3MsXG4gICAgICAgIHNwZWNpZmllcixcbiAgICAgICAgd2lkdGgsXG4gICAgICAgIHBhZGRlZFZhbHVlO1xuXG4gICAgLy8ga2VlcCBsb29waW5nIHJvdW5kIHVudGlsIGFsbCBpbnN0YW5jZXMgb2YgPHRva2VuPiBoYXZlIGJlZW5cbiAgICAvLyByZXBsYWNlZC4gb25jZSB0aGF0IGhhcyBoYXBwZW5lZCwgc3RhcnRQb3MgYmVsb3cgd2lsbCBiZSAtMVxuICAgIC8vIGFuZCB0aGUgY29tcGxldGVkIHVybCB3aWxsIGJlIHJldHVybmVkLlxuICAgIHdoaWxlICh0cnVlKSB7XG5cbiAgICAgICAgLy8gY2hlY2sgaWYgdGhlcmUgaXMgYSB2YWxpZCAkPHRva2VuPi4uLiQgaWRlbnRpZmllclxuICAgICAgICAvLyBpZiBub3QsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBzdGFydFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnICsgdG9rZW4pO1xuICAgICAgICBpZiAoc3RhcnRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGUgbmV4dCAnJCcgbXVzdCBiZSB0aGUgZW5kIG9mIHRoZSBpZGVudGlmZXJcbiAgICAgICAgLy8gaWYgdGhlcmUgaXNuJ3Qgb25lLCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgZW5kUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZW5kUG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbm93IHNlZSBpZiB0aGVyZSBpcyBhbiBhZGRpdGlvbmFsIGZvcm1hdCB0YWcgc3VmZml4ZWQgdG9cbiAgICAgICAgLy8gdGhlIGlkZW50aWZpZXIgd2l0aGluIHRoZSBlbmNsb3NpbmcgJyQnIGNoYXJhY3RlcnNcbiAgICAgICAgZm9ybWF0VGFnUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZihmb3JtYXRUYWcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZm9ybWF0VGFnUG9zID4gc3RhcnRQb3MgJiYgZm9ybWF0VGFnUG9zIDwgZW5kUG9zKSB7XG5cbiAgICAgICAgICAgIHNwZWNpZmllciA9IHRlbXBsYXRlU3RyLmNoYXJBdChlbmRQb3MgLSAxKTtcbiAgICAgICAgICAgIHdpZHRoID0gcGFyc2VJbnQodGVtcGxhdGVTdHIuc3Vic3RyaW5nKGZvcm1hdFRhZ1BvcyArIGZvcm1hdFRhZ0xlbiwgZW5kUG9zIC0gMSksIDEwKTtcblxuICAgICAgICAgICAgLy8gc3VwcG9ydCB0aGUgbWluaW11bSBzcGVjaWZpZXJzIHJlcXVpcmVkIGJ5IElFRUUgMTAwMy4xXG4gICAgICAgICAgICAvLyAoZCwgaSAsIG8sIHUsIHgsIGFuZCBYKSBmb3IgY29tcGxldGVuZXNzXG4gICAgICAgICAgICBzd2l0Y2ggKHNwZWNpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIHRyZWF0IGFsbCBpbnQgdHlwZXMgYXMgdWludCxcbiAgICAgICAgICAgICAgICAvLyBoZW5jZSBkZWxpYmVyYXRlIGZhbGx0aHJvdWdoXG4gICAgICAgICAgICAgICAgY2FzZSAnZCc6XG4gICAgICAgICAgICAgICAgY2FzZSAnaSc6XG4gICAgICAgICAgICAgICAgY2FzZSAndSc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAneCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdYJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCkudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnbyc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDgpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVbnN1cHBvcnRlZC9pbnZhbGlkIElFRUUgMTAwMy4xIGZvcm1hdCBpZGVudGlmaWVyIHN0cmluZyBpbiBVUkwnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRlbXBsYXRlU3RyID0gdGVtcGxhdGVTdHIuc3Vic3RyaW5nKDAsIHN0YXJ0UG9zKSArIHBhZGRlZFZhbHVlICsgdGVtcGxhdGVTdHIuc3Vic3RyaW5nKGVuZFBvcyArIDEpO1xuICAgIH1cbn07XG5cbnVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIpIHtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyQkJykuam9pbignJCcpO1xufTtcblxucmVwbGFjZUlERm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHRlbXBsYXRlU3RyLmluZGV4T2YoJyRSZXByZXNlbnRhdGlvbklEJCcpID09PSAtMSkgeyByZXR1cm4gdGVtcGxhdGVTdHI7IH1cbiAgICB2YXIgdiA9IHZhbHVlLnRvU3RyaW5nKCk7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckUmVwcmVzZW50YXRpb25JRCQnKS5qb2luKHYpO1xufTtcblxuc2VnbWVudFRlbXBsYXRlID0ge1xuICAgIHplcm9QYWRUb0xlbmd0aDogemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlOiByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlOiB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlOiByZXBsYWNlSURGb3JUZW1wbGF0ZVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBnZXRTZWdtZW50VGVtcGxhdGUoKSB7IHJldHVybiBzZWdtZW50VGVtcGxhdGU7IH07IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXZlbnRNZ3IgPSByZXF1aXJlKCcuL2V2ZW50TWFuYWdlci5qcycpLFxuICAgIGV2ZW50RGlzcGF0Y2hlck1peGluID0ge1xuICAgICAgICB0cmlnZ2VyOiBmdW5jdGlvbihldmVudE9iamVjdCkgeyBldmVudE1nci50cmlnZ2VyKHRoaXMsIGV2ZW50T2JqZWN0KTsgfSxcbiAgICAgICAgb25lOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uZSh0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb246IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub24odGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9mZjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vZmYodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH1cbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50RGlzcGF0Y2hlck1peGluOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHZpZGVvanMgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JykudmlkZW9qcyxcbiAgICBldmVudE1hbmFnZXIgPSB7XG4gICAgICAgIHRyaWdnZXI6IHZpZGVvanMudHJpZ2dlcixcbiAgICAgICAgb25lOiB2aWRlb2pzLm9uZSxcbiAgICAgICAgb246IHZpZGVvanMub24sXG4gICAgICAgIG9mZjogdmlkZW9qcy5vZmZcbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50TWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxuLy8gVE9ETzogUmVmYWN0b3IgdG8gc2VwYXJhdGUganMgZmlsZXMgJiBtb2R1bGVzICYgcmVtb3ZlIGZyb20gaGVyZS5cblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4vdXRpbC9pc1N0cmluZy5qcycpO1xuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxuZnVuY3Rpb24gcHJlQXBwbHlBcmdzRm4oZnVuIC8qLCBhcmdzICovKSB7XG4gICAgdmFyIHByZUFwcGxpZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAvLyBOT1RFOiB0aGUgKnRoaXMqIHJlZmVyZW5jZSB3aWxsIHJlZmVyIHRvIHRoZSBjbG9zdXJlJ3MgY29udGV4dCB1bmxlc3NcbiAgICAvLyB0aGUgcmV0dXJuZWQgZnVuY3Rpb24gaXMgaXRzZWxmIGNhbGxlZCB2aWEgLmNhbGwoKSBvciAuYXBwbHkoKS4gSWYgeW91XG4gICAgLy8gKm5lZWQqIHRvIHJlZmVyIHRvIGluc3RhbmNlLWxldmVsIHByb3BlcnRpZXMsIGRvIHNvbWV0aGluZyBsaWtlIHRoZSBmb2xsb3dpbmc6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IGZ1bmN0aW9uKGFyZ0MpIHsgcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKS5jYWxsKHRoaXMpOyB9O1xuICAgIC8vXG4gICAgLy8gT3RoZXJ3aXNlLCB5b3Ugc2hvdWxkIGJlIGFibGUgdG8ganVzdCBjYWxsOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pO1xuICAgIC8vXG4gICAgLy8gV2hlcmUgcG9zc2libGUsIGZ1bmN0aW9ucyBhbmQgbWV0aG9kcyBzaG91bGQgbm90IGJlIHJlYWNoaW5nIG91dCB0byBnbG9iYWwgc2NvcGUgYW55d2F5LCBzby4uLlxuICAgIHJldHVybiBmdW5jdGlvbigpIHsgcmV0dXJuIGZ1bi5hcHBseSh0aGlzLCBwcmVBcHBsaWVkQXJncyk7IH07XG59XG5cbi8vIEhpZ2hlci1vcmRlciBYTUwgZnVuY3Rpb25zXG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50c1xudmFyIGdldEFuY2VzdG9ycyA9IGZ1bmN0aW9uKGVsZW0sIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgKGZ1bmN0aW9uIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSwgYW5jZXN0b3JzKSkgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKGV4aXN0eShlbGVtKSAmJiBleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkge1xuICAgICAgICAgICAgYW5jZXN0b3JzLnB1c2goZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgICAgIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfSkoZWxlbSk7XG4gICAgcmV0dXJuIGFuY2VzdG9ycztcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXROb2RlTGlzdEJ5TmFtZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oeG1sT2JqKSB7XG4gICAgICAgIHJldHVybiB4bWxPYmouZ2V0RWxlbWVudHNCeVRhZ05hbWUobmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBoYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lLCB2YWx1ZSkge1xuICAgIGlmICgodHlwZW9mIGF0dHJOYW1lICE9PSAnc3RyaW5nJykgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgaWYgKCFleGlzdHkodmFsdWUpKSB7IHJldHVybiBlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgcmV0dXJuIChlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSkgPT09IHZhbHVlKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEF0dHJGbiA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhdHRyTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbi8vIFRPRE86IEFkZCBzaG91bGRTdG9wUHJlZCAoc2hvdWxkIGZ1bmN0aW9uIHNpbWlsYXJseSB0byBzaG91bGRTdG9wUHJlZCBpbiBnZXRJbmhlcml0YWJsZUVsZW1lbnQsIGJlbG93KVxudmFyIGdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhhdHRyTmFtZSkpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKSkgeyByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50czsgUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEluaGVyaXRhYmxlRWxlbWVudCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHJldHVybiBmdW5jdGlvbiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBtYXRjaGluZ0VsZW1MaXN0ID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSk7XG4gICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtTGlzdCkgJiYgbWF0Y2hpbmdFbGVtTGlzdC5sZW5ndGggPiAwKSB7IHJldHVybiBtYXRjaGluZ0VsZW1MaXN0WzBdOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG52YXIgZ2V0Q2hpbGRFbGVtZW50QnlOb2RlTmFtZSA9IGZ1bmN0aW9uKG5vZGVOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgdmFyIGluaXRpYWxNYXRjaGVzID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSksXG4gICAgICAgICAgICBjdXJyZW50RWxlbTtcbiAgICAgICAgaWYgKCFleGlzdHkoaW5pdGlhbE1hdGNoZXMpIHx8IGluaXRpYWxNYXRjaGVzLmxlbmd0aCA8PSAwKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgY3VycmVudEVsZW0gPSBpbml0aWFsTWF0Y2hlc1swXTtcbiAgICAgICAgcmV0dXJuIChjdXJyZW50RWxlbS5wYXJlbnROb2RlID09PSBlbGVtKSA/IGN1cnJlbnRFbGVtIDogdW5kZWZpbmVkO1xuICAgIH07XG59O1xuXG52YXIgZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0ID0gZnVuY3Rpb24obm9kZU5hbWUsIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgdmFyIGdldE1hdGNoaW5nQ2hpbGROb2RlRm4gPSBnZXRDaGlsZEVsZW1lbnRCeU5vZGVOYW1lKG5vZGVOYW1lKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICB2YXIgY3VycmVudEVsZW0gPSBlbGVtLFxuICAgICAgICAgICAgbXVsdGlMZXZlbEVsZW1MaXN0ID0gW10sXG4gICAgICAgICAgICBtYXRjaGluZ0VsZW07XG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugdy9yZWN1cnNpdmUgZm4/XG4gICAgICAgIHdoaWxlIChleGlzdHkoY3VycmVudEVsZW0pICYmICFzaG91bGRTdG9wUHJlZChjdXJyZW50RWxlbSkpIHtcbiAgICAgICAgICAgIG1hdGNoaW5nRWxlbSA9IGdldE1hdGNoaW5nQ2hpbGROb2RlRm4oY3VycmVudEVsZW0pO1xuICAgICAgICAgICAgaWYgKGV4aXN0eShtYXRjaGluZ0VsZW0pKSB7IG11bHRpTGV2ZWxFbGVtTGlzdC5wdXNoKG1hdGNoaW5nRWxlbSk7IH1cbiAgICAgICAgICAgIGN1cnJlbnRFbGVtID0gY3VycmVudEVsZW0ucGFyZW50Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtdWx0aUxldmVsRWxlbUxpc3QubGVuZ3RoID4gMCA/IG11bHRpTGV2ZWxFbGVtTGlzdCA6IHVuZGVmaW5lZDtcbiAgICB9O1xufTtcblxuLy8gUHVibGlzaCBFeHRlcm5hbCBBUEk6XG52YXIgeG1sRnVuID0ge307XG54bWxGdW4uZXhpc3R5ID0gZXhpc3R5O1xueG1sRnVuLnRydXRoeSA9IHRydXRoeTtcblxueG1sRnVuLmdldE5vZGVMaXN0QnlOYW1lID0gZ2V0Tm9kZUxpc3RCeU5hbWU7XG54bWxGdW4uaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBoYXNNYXRjaGluZ0F0dHJpYnV0ZTtcbnhtbEZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGdldEluaGVyaXRhYmxlQXR0cmlidXRlO1xueG1sRnVuLmdldEFuY2VzdG9ycyA9IGdldEFuY2VzdG9ycztcbnhtbEZ1bi5nZXRBdHRyRm4gPSBnZXRBdHRyRm47XG54bWxGdW4ucHJlQXBwbHlBcmdzRm4gPSBwcmVBcHBseUFyZ3NGbjtcbnhtbEZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBnZXRJbmhlcml0YWJsZUVsZW1lbnQ7XG54bWxGdW4uZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0ID0gZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGdldFhtbEZ1bigpIHsgcmV0dXJuIHhtbEZ1bjsgfTsiLCIvKipcbiAqXG4gKiBtYWluIHNvdXJjZSBmb3IgcGFja2FnZWQgY29kZS4gQXV0by1ib290c3RyYXBzIHRoZSBzb3VyY2UgaGFuZGxpbmcgZnVuY3Rpb25hbGl0eSBieSByZWdpc3RlcmluZyB0aGUgc291cmNlIGhhbmRsZXJcbiAqIHdpdGggdmlkZW8uanMgb24gaW5pdGlhbCBzY3JpcHQgbG9hZCB2aWEgSUlGRS4gKE5PVEU6IFRoaXMgcGxhY2VzIGFuIG9yZGVyIGRlcGVuZGVuY3kgb24gdGhlIHZpZGVvLmpzIGxpYnJhcnksIHdoaWNoXG4gKiBtdXN0IGFscmVhZHkgYmUgbG9hZGVkIGJlZm9yZSB0aGlzIHNjcmlwdCBhdXRvLWV4ZWN1dGVzLilcbiAqXG4gKi9cbjsoZnVuY3Rpb24oKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIHJvb3QgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JyksXG4gICAgICAgIHZpZGVvanMgPSByb290LnZpZGVvanMsXG4gICAgICAgIFNvdXJjZUhhbmRsZXIgPSByZXF1aXJlKCcuL1NvdXJjZUhhbmRsZXInKSxcbiAgICAgICAgQ2FuSGFuZGxlU291cmNlRW51bSA9IHtcbiAgICAgICAgICAgIERPRVNOVF9IQU5ETEVfU09VUkNFOiAnJyxcbiAgICAgICAgICAgIE1BWUJFX0hBTkRMRV9TT1VSQ0U6ICdtYXliZSdcbiAgICAgICAgfTtcblxuICAgIGlmICghdmlkZW9qcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB2aWRlby5qcyBsaWJyYXJ5IG11c3QgYmUgaW5jbHVkZWQgdG8gdXNlIHRoaXMgTVBFRy1EQVNIIHNvdXJjZSBoYW5kbGVyLicpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogVXNlZCBieSBhIHZpZGVvLmpzIHRlY2ggaW5zdGFuY2UgdG8gdmVyaWZ5IHdoZXRoZXIgb3Igbm90IGEgc3BlY2lmaWMgbWVkaWEgc291cmNlIGNhbiBiZSBoYW5kbGVkIGJ5IHRoaXNcbiAgICAgKiBzb3VyY2UgaGFuZGxlci4gSW4gdGhpcyBjYXNlLCBzaG91bGQgcmV0dXJuICdtYXliZScgaWYgdGhlIHNvdXJjZSBpcyBNUEVHLURBU0gsIG90aGVyd2lzZSAnJyAocmVwcmVzZW50aW5nIG5vKS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7b2JqZWN0fSBzb3VyY2UgICAgICAgICAgIHZpZGVvLmpzIHNvdXJjZSBvYmplY3QgcHJvdmlkaW5nIHNvdXJjZSB1cmkgYW5kIHR5cGUgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7Q2FuSGFuZGxlU291cmNlRW51bX0gICBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2Ygd2hldGhlciBvciBub3QgcGFydGljdWxhciBzb3VyY2UgY2FuIGJlIGhhbmRsZWQgYnkgdGhpc1xuICAgICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZSBoYW5kbGVyLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIGNhbkhhbmRsZVNvdXJjZShzb3VyY2UpIHtcbiAgICAgICAgLy8gUmVxdWlyZXMgTWVkaWEgU291cmNlIEV4dGVuc2lvbnNcbiAgICAgICAgaWYgKCEocm9vdC5NZWRpYVNvdXJjZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLkRPRVNOVF9IQU5ETEVfU09VUkNFO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHR5cGUgaXMgc3VwcG9ydGVkXG4gICAgICAgIGlmICgvYXBwbGljYXRpb25cXC9kYXNoXFwreG1sLy50ZXN0KHNvdXJjZS50eXBlKSkge1xuICAgICAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uTUFZQkVfSEFORExFX1NPVVJDRTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4dGVuc2lvbiBtYXRjaGVzXG4gICAgICAgIGlmICgvXFwubXBkJC9pLnRlc3Qoc291cmNlLnNyYykpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLk1BWUJFX0hBTkRMRV9TT1VSQ0U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5ET0VTTlRfSEFORExFX1NPVVJDRTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIENhbGxlZCBieSBhIHZpZGVvLmpzIHRlY2ggaW5zdGFuY2UgdG8gaGFuZGxlIGEgc3BlY2lmaWMgbWVkaWEgc291cmNlLCByZXR1cm5pbmcgYW4gb2JqZWN0IGluc3RhbmNlIHRoYXQgcHJvdmlkZXNcbiAgICAgKiB0aGUgY29udGV4dCBmb3IgaGFuZGxpbmcgc2FpZCBzb3VyY2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc291cmNlICAgICAgICAgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgc291cmNlIHVyaSBhbmQgdHlwZSBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSB0ZWNoICAgICAgICAgICAgICB2aWRlby5qcyB0ZWNoIG9iamVjdCAoaW4gdGhpcyBjYXNlLCBzaG91bGQgYmUgSHRtbDUgdGVjaCkgcHJvdmlkaW5nIHBvaW50IG9mIGludGVyYWN0aW9uXG4gICAgICogICAgICAgICAgICAgICAgICAgICAgICAgIGJldHdlZW4gdGhlIHNvdXJjZSBoYW5kbGVyIGFuZCB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nLCBlLmcuLCB0aGUgdmlkZW8gZWxlbWVudClcbiAgICAgKiBAcmV0dXJucyB7U291cmNlSGFuZGxlcn0gQW4gb2JqZWN0IHRoYXQgZGVmaW5lcyBjb250ZXh0IGZvciBoYW5kbGluZyBhIHBhcnRpY3VsYXIgTVBFRy1EQVNIIHNvdXJjZS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBoYW5kbGVTb3VyY2Uoc291cmNlLCB0ZWNoKSB7XG4gICAgICAgIHJldHVybiBuZXcgU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpO1xuICAgIH1cblxuICAgIC8vIFJlZ2lzdGVyIHRoZSBzb3VyY2UgaGFuZGxlciB0byB0aGUgSHRtbDUgdGVjaCBpbnN0YW5jZS5cbiAgICB2aWRlb2pzLkh0bWw1LnJlZ2lzdGVyU291cmNlSGFuZGxlcih7XG4gICAgICAgIGNhbkhhbmRsZVNvdXJjZTogY2FuSGFuZGxlU291cmNlLFxuICAgICAgICBoYW5kbGVTb3VyY2U6IGhhbmRsZVNvdXJjZVxuICAgIH0sIDApO1xuXG59LmNhbGwodGhpcykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB0cnV0aHkgPSByZXF1aXJlKCcuLi91dGlsL3RydXRoeS5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi4vdXRpbC9pc1N0cmluZy5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgZmluZEVsZW1lbnRJbkFycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9maW5kRWxlbWVudEluQXJyYXkuanMnKSxcbiAgICBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUgPSByZXF1aXJlKCcuLi91dGlsL2dldE1lZGlhVHlwZUZyb21NaW1lVHlwZS5qcycpLFxuICAgIGxvYWRNYW5pZmVzdCA9IHJlcXVpcmUoJy4vbG9hZE1hbmlmZXN0LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBnZXREYXNoVXRpbCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldERhc2hVdGlsLmpzJyksXG4gICAgZGFzaFV0aWwgPSBnZXREYXNoVXRpbCgpLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGRhc2hVdGlsLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGdldE1wZCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIE1lZGlhU2V0ID0gcmVxdWlyZSgnLi4vTWVkaWFTZXQuanMnKSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVzLmpzJyk7XG5cbi8qKlxuICpcbiAqIFRoZSBNYW5pZmVzdENvbnRyb2xsZXIgbG9hZHMsIHN0b3JlcywgYW5kIHByb3ZpZGVzIGRhdGEgdmlld3MgZm9yIHRoZSBNUEQgbWFuaWZlc3QgdGhhdCByZXByZXNlbnRzIHRoZVxuICogTVBFRy1EQVNIIG1lZGlhIHNvdXJjZSBiZWluZyBoYW5kbGVkLlxuICpcbiAqIEBwYXJhbSBzb3VyY2VVcmkge3N0cmluZ31cbiAqIEBwYXJhbSBhdXRvTG9hZCAge2Jvb2xlYW59XG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gTWFuaWZlc3RDb250cm9sbGVyKHNvdXJjZVVyaSwgYXV0b0xvYWQpIHtcbiAgICB0aGlzLl9fYXV0b0xvYWQgPSB0cnV0aHkoYXV0b0xvYWQpO1xuICAgIHRoaXMuc2V0U291cmNlVXJpKHNvdXJjZVVyaSk7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBNQU5JRkVTVF9MT0FERUQ6ICdtYW5pZmVzdExvYWRlZCdcbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0U291cmNlVXJpID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX19zb3VyY2VVcmk7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLnNldFNvdXJjZVVyaSA9IGZ1bmN0aW9uIHNldFNvdXJjZVVyaShzb3VyY2VVcmkpIHtcbiAgICAvLyBUT0RPOiAnZXhpc3R5KCknIGNoZWNrIGZvciBib3RoP1xuICAgIGlmIChzb3VyY2VVcmkgPT09IHRoaXMuX19zb3VyY2VVcmkpIHsgcmV0dXJuOyB9XG5cbiAgICAvLyBUT0RPOiBpc1N0cmluZygpIGNoZWNrPyAnZXhpc3R5KCknIGNoZWNrP1xuICAgIGlmICghc291cmNlVXJpKSB7XG4gICAgICAgIHRoaXMuX19jbGVhclNvdXJjZVVyaSgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTmVlZCB0byBwb3RlbnRpYWxseSByZW1vdmUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgbWFuaWZlc3QgKGluIGNhc2UgaXQgaXMgYSBkeW5hbWljIE1QRClcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICB0aGlzLl9fc291cmNlVXJpID0gc291cmNlVXJpO1xuICAgIC8vIElmIHdlIHNob3VsZCBhdXRvbWF0aWNhbGx5IGxvYWQgdGhlIE1QRCwgZ28gYWhlYWQgYW5kIGtpY2sgb2ZmIGxvYWRpbmcgaXQuXG4gICAgaWYgKHRoaXMuX19hdXRvTG9hZCkge1xuICAgICAgICAvLyBUT0RPOiBJbXBsIGFueSBjbGVhbnVwIGZ1bmN0aW9uYWxpdHkgYXBwcm9wcmlhdGUgYmVmb3JlIGxvYWQuXG4gICAgICAgIHRoaXMubG9hZCgpO1xuICAgIH1cbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuX19jbGVhclNvdXJjZVVyaSA9IGZ1bmN0aW9uIGNsZWFyU291cmNlVXJpKCkge1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBudWxsO1xuICAgIC8vIE5lZWQgdG8gcG90ZW50aWFsbHkgcmVtb3ZlIHVwZGF0ZSBpbnRlcnZhbCBmb3IgcmUtcmVxdWVzdGluZyB0aGUgTVBEIG1hbmlmZXN0IChpbiBjYXNlIGl0IGlzIGEgZHluYW1pYyBNUEQpXG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgLy8gVE9ETzogaW1wbCBhbnkgb3RoZXIgY2xlYW51cCBmdW5jdGlvbmFsaXR5XG59O1xuXG4vKipcbiAqIEtpY2sgb2ZmIGxvYWRpbmcgdGhlIERBU0ggTVBEIE1hbmlmZXN0IChzZXJ2ZWQgQCB0aGUgTWFuaWZlc3RDb250cm9sbGVyIGluc3RhbmNlJ3MgX19zb3VyY2VVcmkpXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uIGxvYWQoKSB7XG4gICAgLy8gVE9ETzogQ3VycmVudGx5IGNsZWFyaW5nICYgcmUtc2V0dGluZyB1cGRhdGUgaW50ZXJ2YWwgYWZ0ZXIgZXZlcnkgcmVxdWVzdC4gRWl0aGVyIHVzZSBzZXRUaW1lb3V0KCkgb3Igb25seSBzZXR1cCBpbnRlcnZhbCBvbmNlXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGxvYWRNYW5pZmVzdChzZWxmLl9fc291cmNlVXJpLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHNlbGYuX19tYW5pZmVzdCA9IGRhdGEubWFuaWZlc3RYbWw7XG4gICAgICAgIC8vIChQb3RlbnRpYWxseSkgc2V0dXAgdGhlIHVwZGF0ZSBpbnRlcnZhbCBmb3IgcmUtcmVxdWVzdGluZyB0aGUgTVBEIChpbiBjYXNlIHRoZSBtYW5pZmVzdCBpcyBkeW5hbWljKVxuICAgICAgICBzZWxmLl9fc2V0dXBVcGRhdGVJbnRlcnZhbCgpO1xuICAgICAgICAvLyBEaXNwYXRjaCBldmVudCB0byBub3RpZnkgdGhhdCB0aGUgbWFuaWZlc3QgaGFzIGxvYWRlZC5cbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5NQU5JRkVTVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlbGYuX19tYW5pZmVzdH0pO1xuICAgIH0pO1xufTtcblxuLyoqXG4gKiAnUHJpdmF0ZScgbWV0aG9kIHRoYXQgcmVtb3ZlcyB0aGUgdXBkYXRlIGludGVydmFsIChpZiBpdCBleGlzdHMpLCBzbyB0aGUgTWFuaWZlc3RDb250cm9sbGVyIGluc3RhbmNlIHdpbGwgbm8gbG9uZ2VyXG4gKiBwZXJpb2RpY2FsbHkgcmUtcmVxdWVzdCB0aGUgbWFuaWZlc3QgKGlmIGl0J3MgZHluYW1pYykuXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCA9IGZ1bmN0aW9uIGNsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCkge1xuICAgIGlmICghZXhpc3R5KHRoaXMuX191cGRhdGVJbnRlcnZhbCkpIHsgcmV0dXJuOyB9XG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpO1xufTtcblxuLyoqXG4gKiBTZXRzIHVwIGFuIGludGVydmFsIHRvIHJlLXJlcXVlc3QgdGhlIG1hbmlmZXN0IChpZiBpdCdzIGR5bmFtaWMpXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuX19zZXR1cFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gc2V0dXBVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICAvLyBJZiB0aGVyZSdzIGFscmVhZHkgYW4gdXBkYXRlSW50ZXJ2YWwgZnVuY3Rpb24sIHJlbW92ZSBpdC5cbiAgICBpZiAodGhpcy5fX3VwZGF0ZUludGVydmFsKSB7IHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpOyB9XG4gICAgLy8gSWYgd2Ugc2hvdWxkbid0IHVwZGF0ZSwganVzdCBiYWlsLlxuICAgIGlmICghdGhpcy5nZXRTaG91bGRVcGRhdGUoKSkgeyByZXR1cm47IH1cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1pblVwZGF0ZVJhdGUgPSAyLFxuICAgICAgICB1cGRhdGVSYXRlID0gTWF0aC5tYXgodGhpcy5nZXRVcGRhdGVSYXRlKCksIG1pblVwZGF0ZVJhdGUpO1xuICAgIC8vIFNldHVwIHRoZSB1cGRhdGUgaW50ZXJ2YWwgYmFzZWQgb24gdGhlIHVwZGF0ZSByYXRlIChkZXRlcm1pbmVkIGZyb20gdGhlIG1hbmlmZXN0KSBvciB0aGUgbWluaW11bSB1cGRhdGUgcmF0ZVxuICAgIC8vICh3aGljaGV2ZXIncyBsYXJnZXIpLlxuICAgIC8vIE5PVEU6IE11c3Qgc3RvcmUgcmVmIHRvIGNyZWF0ZWQgaW50ZXJ2YWwgdG8gcG90ZW50aWFsbHkgY2xlYXIvcmVtb3ZlIGl0IGxhdGVyXG4gICAgdGhpcy5fX3VwZGF0ZUludGVydmFsID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYubG9hZCgpO1xuICAgIH0sIHVwZGF0ZVJhdGUgKiAxMDAwKTtcbn07XG5cbi8qKlxuICogR2V0cyB0aGUgdHlwZSBvZiBwbGF5bGlzdCAoJ3N0YXRpYycgb3IgJ2R5bmFtaWMnLCB3aGljaCBuZWFybHkgaW52YXJpYWJseSBjb3JyZXNwb25kcyB0byBsaXZlIHZzLiB2b2QpIGRlZmluZWQgaW4gdGhlXG4gKiBtYW5pZmVzdC5cbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAgICB0aGUgcGxheWxpc3QgdHlwZSAoZWl0aGVyICdzdGF0aWMnIG9yICdkeW5hbWljJylcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRQbGF5bGlzdFR5cGUgPSBmdW5jdGlvbiBnZXRQbGF5bGlzdFR5cGUoKSB7XG4gICAgdmFyIHBsYXlsaXN0VHlwZSA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFR5cGUoKTtcbiAgICByZXR1cm4gcGxheWxpc3RUeXBlO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRVcGRhdGVSYXRlID0gZnVuY3Rpb24gZ2V0VXBkYXRlUmF0ZSgpIHtcbiAgICB2YXIgbWluaW11bVVwZGF0ZVBlcmlvZFN0ciA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldE1pbmltdW1VcGRhdGVQZXJpb2QoKSxcbiAgICAgICAgbWluaW11bVVwZGF0ZVBlcmlvZCA9IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbihtaW5pbXVtVXBkYXRlUGVyaW9kU3RyKTtcbiAgICByZXR1cm4gbWluaW11bVVwZGF0ZVBlcmlvZCB8fCAwO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRTaG91bGRVcGRhdGUgPSBmdW5jdGlvbiBnZXRTaG91bGRVcGRhdGUoKSB7XG4gICAgdmFyIGlzRHluYW1pYyA9ICh0aGlzLmdldFBsYXlsaXN0VHlwZSgpID09PSAnZHluYW1pYycpLFxuICAgICAgICBoYXNWYWxpZFVwZGF0ZVJhdGUgPSAodGhpcy5nZXRVcGRhdGVSYXRlKCkgPiAwKTtcbiAgICByZXR1cm4gKGlzRHluYW1pYyAmJiBoYXNWYWxpZFVwZGF0ZVJhdGUpO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRNcGQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCk7XG59O1xuXG4vKipcbiAqXG4gKiBAcGFyYW0gdHlwZVxuICogQHJldHVybnMge01lZGlhU2V0fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0QnlUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRCeVR5cGUodHlwZSkge1xuICAgIGlmIChtZWRpYVR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7IHRocm93IG5ldyBFcnJvcignSW52YWxpZCB0eXBlLiBWYWx1ZSBtdXN0IGJlIG9uZSBvZjogJyArIG1lZGlhVHlwZXMuam9pbignLCAnKSk7IH1cbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2ggPSBmaW5kRWxlbWVudEluQXJyYXkoYWRhcHRhdGlvblNldHMsIGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHtcbiAgICAgICAgICAgIHJldHVybiAoZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKGFkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcykgPT09IHR5cGUpO1xuICAgICAgICB9KTtcbiAgICBpZiAoIWV4aXN0eShhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKTtcbn07XG5cbi8qKlxuICpcbiAqIEByZXR1cm5zIHtBcnJheS48TWVkaWFTZXQ+fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0cyA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0cygpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgbWVkaWFTZXRzID0gYWRhcHRhdGlvblNldHMubWFwKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHsgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0KTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0cztcbn07XG5cbi8vIE1peGluIGV2ZW50IGhhbmRsaW5nIGZvciB0aGUgTWFuaWZlc3RDb250cm9sbGVyIG9iamVjdCB0eXBlIGRlZmluaXRpb24uXG5leHRlbmRPYmplY3QoTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hbmlmZXN0Q29udHJvbGxlcjsiLCJtb2R1bGUuZXhwb3J0cyA9IFsndmlkZW8nLCAnYXVkaW8nXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZXREYXNoVXRpbCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldERhc2hVdGlsLmpzJyksXG4gICAgZGFzaFV0aWwgPSBnZXREYXNoVXRpbCgpLFxuICAgIHBhcnNlUm9vdFVybCA9IGRhc2hVdGlsLnBhcnNlUm9vdFVybDtcblxuZnVuY3Rpb24gbG9hZE1hbmlmZXN0KHVybCwgY2FsbGJhY2spIHtcbiAgICB2YXIgYWN0dWFsVXJsID0gcGFyc2VSb290VXJsKHVybCksXG4gICAgICAgIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKSxcbiAgICAgICAgb25sb2FkO1xuXG4gICAgb25sb2FkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAocmVxdWVzdC5zdGF0dXMgPCAyMDAgfHwgcmVxdWVzdC5zdGF0dXMgPiAyOTkpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFjayh7bWFuaWZlc3RYbWw6IHJlcXVlc3QucmVzcG9uc2VYTUwgfSk7IH1cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdC5vbmxvYWQgPSBvbmxvYWQ7XG4gICAgICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICAgICAgcmVxdWVzdC5zZW5kKCk7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJlcXVlc3Qub25lcnJvcigpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsb2FkTWFuaWZlc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpO1xuXG4vKipcbiAqIEdlbmVyaWMgZnVuY3Rpb24gZm9yIGxvYWRpbmcgTVBFRy1EQVNIIHNlZ21lbnRzIChpbmNsdWRpbmcgaW5pdGlhbGl6YXRpb24gc2VnbWVudHMpXG4gKiBAcGFyYW0gc2VnbWVudCB7b2JqZWN0fSAgICAgICBkYXRhIHZpZXcgcmVwcmVzZW50aW5nIGEgc2VnbWVudCAoYW5kIHJlbGV2YW50IGRhdGEgZm9yIHRoYXQgc2VnbWVudClcbiAqIEBwYXJhbSBzdWNjZXNzRm4ge2Z1bmN0aW9ufSAgZnVuY3Rpb24gY2FsbGVkIG9uIHN1Y2Nlc3NmdWwgcmVzcG9uc2VcbiAqIEBwYXJhbSBmYWlsRm4ge2Z1bmN0aW9ufSAgICAgZnVuY3Rpb24gY2FsbGVkIG9uIGZhaWxlZCByZXNwb25zZVxuICogQHBhcmFtIHRoaXNBcmcge29iamVjdH0gICAgICBvYmplY3QgdXNlZCBhcyB0aGUgdGhpcyBjb250ZXh0IGZvciBzdWNjZXNzRm4gYW5kIGZhaWxGblxuICovXG5mdW5jdGlvbiBsb2FkU2VnbWVudChzZWdtZW50LCBzdWNjZXNzRm4sIGZhaWxGbiwgdGhpc0FyZykge1xuICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIHVybCA9IHNlZ21lbnQuZ2V0VXJsKCk7XG5cbiAgICBmdW5jdGlvbiBvbmxvYWQoKSB7XG4gICAgICAgIC8vIElmIHRoZSBsb2FkIHN0YXR1cyB3YXMgb3V0c2lkZSBvZiB0aGUgMjAwcyByYW5nZSwgY29uc2lkZXIgaXQgYSBmYWlsZWQgcmVxdWVzdC5cbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7XG4gICAgICAgICAgICBpZiAoaXNGdW5jdGlvbihmYWlsRm4pKSB7XG4gICAgICAgICAgICAgICAgZmFpbEZuLmNhbGwodGhpc0FyZywgIHtcbiAgICAgICAgICAgICAgICAgICAgcmVxdWVzdGVkU2VnbWVudDogc2VnbWVudCxcbiAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2U6IHJlcXVlc3QucmVzcG9uc2UsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogcmVxdWVzdC5zdGF0dXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChpc0Z1bmN0aW9uKHN1Y2Nlc3NGbikpIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzRm4uY2FsbCh0aGlzQXJnLCB7XG4gICAgICAgICAgICAgICAgICAgIHJlcXVlc3RlZFNlZ21lbnQ6IHNlZ21lbnQsXG4gICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlOiByZXF1ZXN0LnJlc3BvbnNlLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IHJlcXVlc3Quc3RhdHVzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvbmVycm9yKCkge1xuICAgICAgICBpZiAoaXNGdW5jdGlvbihmYWlsRm4pKSB7XG4gICAgICAgICAgICBmYWlsRm4uY2FsbCh0aGlzQXJnLCAge1xuICAgICAgICAgICAgICAgIHJlcXVlc3RlZFNlZ21lbnQ6IHNlZ21lbnQsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2U6IHJlcXVlc3QucmVzcG9uc2UsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiByZXF1ZXN0LnN0YXR1c1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuICAgIHJlcXVlc3Qub25sb2FkID0gb25sb2FkO1xuICAgIHJlcXVlc3Qub25lcnJvciA9IG9uZXJyb3I7XG4gICAgcmVxdWVzdC5zZW5kKCk7XG5cbiAgICByZXR1cm4gcmVxdWVzdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsb2FkU2VnbWVudDsiLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciBiYW5kd2lkdGhBID0gc2VnbWVudExpc3RBLmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBiYW5kd2lkdGhCID0gc2VnbWVudExpc3RCLmdldEJhbmR3aWR0aCgpO1xuICAgIHJldHVybiBiYW5kd2lkdGhBIC0gYmFuZHdpZHRoQjtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5V2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgd2lkdGhBID0gc2VnbWVudExpc3RBLmdldFdpZHRoKCkgfHwgMCxcbiAgICAgICAgd2lkdGhCID0gc2VnbWVudExpc3RCLmdldFdpZHRoKCkgfHwgMDtcbiAgICByZXR1cm4gd2lkdGhBIC0gd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aFRoZW5CYW5kd2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgcmVzb2x1dGlvbkNvbXBhcmUgPSBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qik7XG4gICAgcmV0dXJuIChyZXNvbHV0aW9uQ29tcGFyZSAhPT0gMCkgPyByZXNvbHV0aW9uQ29tcGFyZSA6IGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qik7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclNlZ21lbnRMaXN0c0J5UmVzb2x1dGlvbihzZWdtZW50TGlzdCwgbWF4V2lkdGgsIG1heEhlaWdodCkge1xuICAgIHZhciB3aWR0aCA9IHNlZ21lbnRMaXN0LmdldFdpZHRoKCkgfHwgMCxcbiAgICAgICAgaGVpZ2h0ID0gc2VnbWVudExpc3QuZ2V0SGVpZ2h0KCkgfHwgMDtcbiAgICByZXR1cm4gKCh3aWR0aCA8PSBtYXhXaWR0aCkgJiYgKGhlaWdodCA8PSBtYXhIZWlnaHQpKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QsIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCwgZG93bmxvYWRSYXRlUmF0aW8pIHtcbiAgICB2YXIgc2VnbWVudExpc3RCYW5kd2lkdGggPSBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSxcbiAgICAgICAgc2VnbWVudEJhbmR3aWR0aFJhdGlvID0gc2VnbWVudExpc3RCYW5kd2lkdGggLyBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG4gICAgZG93bmxvYWRSYXRlUmF0aW8gPSBkb3dubG9hZFJhdGVSYXRpbyB8fCBOdW1iZXIuTUFYX1ZBTFVFO1xuICAgIHJldHVybiAoZG93bmxvYWRSYXRlUmF0aW8gPj0gc2VnbWVudEJhbmR3aWR0aFJhdGlvKTtcbn1cblxuLy8gTk9URTogUGFzc2luZyBpbiBtZWRpYVNldCBpbnN0ZWFkIG9mIG1lZGlhU2V0J3MgU2VnbWVudExpc3QgQXJyYXkgc2luY2Ugc29ydCBpcyBkZXN0cnVjdGl2ZSBhbmQgZG9uJ3Qgd2FudCB0byBjbG9uZS5cbi8vICAgICAgQWxzbyBhbGxvd3MgZm9yIGdyZWF0ZXIgZmxleGliaWxpdHkgb2YgZm4uXG5mdW5jdGlvbiBzZWxlY3RTZWdtZW50TGlzdChtZWRpYVNldCwgZGF0YSkge1xuICAgIHZhciBkb3dubG9hZFJhdGVSYXRpbyA9IGRhdGEuZG93bmxvYWRSYXRlUmF0aW8sXG4gICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGRhdGEuY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLFxuICAgICAgICB3aWR0aCA9IGRhdGEud2lkdGgsXG4gICAgICAgIGhlaWdodCA9IGRhdGEuaGVpZ2h0LFxuICAgICAgICBzb3J0ZWRCeUJhbmR3aWR0aCA9IG1lZGlhU2V0LmdldFNlZ21lbnRMaXN0cygpLnNvcnQoY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKSxcbiAgICAgICAgZmlsdGVyZWRCeURvd25sb2FkUmF0ZSxcbiAgICAgICAgZmlsdGVyZWRCeVJlc29sdXRpb24sXG4gICAgICAgIHByb3Bvc2VkU2VnbWVudExpc3Q7XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJCeVJlc29sdXRpb24oc2VnbWVudExpc3QpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlclNlZ21lbnRMaXN0c0J5UmVzb2x1dGlvbihzZWdtZW50TGlzdCwgd2lkdGgsIGhlaWdodCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlclNlZ21lbnRMaXN0c0J5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0LCBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGgsIGRvd25sb2FkUmF0ZVJhdGlvKTtcbiAgICB9XG5cbiAgICBmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlID0gc29ydGVkQnlCYW5kd2lkdGguZmlsdGVyKGZpbHRlckJ5RG93bmxvYWRSYXRlKTtcbiAgICBmaWx0ZXJlZEJ5UmVzb2x1dGlvbiA9IGZpbHRlcmVkQnlEb3dubG9hZFJhdGUuc29ydChjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aFRoZW5CYW5kd2lkdGhBc2NlbmRpbmcpLmZpbHRlcihmaWx0ZXJCeVJlc29sdXRpb24pO1xuXG4gICAgcHJvcG9zZWRTZWdtZW50TGlzdCA9IGZpbHRlcmVkQnlSZXNvbHV0aW9uW2ZpbHRlcmVkQnlSZXNvbHV0aW9uLmxlbmd0aCAtIDFdIHx8IHNvcnRlZEJ5QmFuZHdpZHRoWzBdO1xuXG4gICAgcmV0dXJuIHByb3Bvc2VkU2VnbWVudExpc3Q7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gc2VsZWN0U2VnbWVudExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4gKHggIT09IG51bGwpICYmICh4ICE9PSB1bmRlZmluZWQpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gZXhpc3R5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gRXh0ZW5kIGEgZ2l2ZW4gb2JqZWN0IHdpdGggYWxsIHRoZSBwcm9wZXJ0aWVzIChhbmQgdGhlaXIgdmFsdWVzKSBmb3VuZCBpbiB0aGUgcGFzc2VkLWluIG9iamVjdChzKS5cbnZhciBleHRlbmRPYmplY3QgPSBmdW5jdGlvbihvYmogLyosIGV4dGVuZE9iamVjdDEsIGV4dGVuZE9iamVjdDIsIC4uLiwgZXh0ZW5kT2JqZWN0TiAqLykge1xuICAgIHZhciBleHRlbmRPYmplY3RzQXJyYXkgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICBpLFxuICAgICAgICBsZW5ndGggPSBleHRlbmRPYmplY3RzQXJyYXkubGVuZ3RoLFxuICAgICAgICBleHRlbmRPYmplY3Q7XG5cbiAgICBmb3IoaT0wOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGV4dGVuZE9iamVjdCA9IGV4dGVuZE9iamVjdHNBcnJheVtpXTtcbiAgICAgICAgaWYgKGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgICAgICBvYmpbcHJvcF0gPSBleHRlbmRPYmplY3RbcHJvcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRPYmplY3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJy4vaXNBcnJheS5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuL2lzRnVuY3Rpb24uanMnKSxcbiAgICBmaW5kRWxlbWVudEluQXJyYXk7XG5cbmZpbmRFbGVtZW50SW5BcnJheSA9IGZ1bmN0aW9uKGFycmF5LCBwcmVkaWNhdGVGbikge1xuICAgIGlmICghaXNBcnJheShhcnJheSkgfHwgIWlzRnVuY3Rpb24ocHJlZGljYXRlRm4pKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICB2YXIgaSxcbiAgICAgICAgbGVuZ3RoID0gYXJyYXkubGVuZ3RoLFxuICAgICAgICBlbGVtO1xuXG4gICAgZm9yIChpPTA7IGk8bGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZWxlbSA9IGFycmF5W2ldO1xuICAgICAgICBpZiAocHJlZGljYXRlRm4oZWxlbSwgaSwgYXJyYXkpKSB7IHJldHVybiBlbGVtOyB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZmluZEVsZW1lbnRJbkFycmF5OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vZXhpc3R5LmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuL2lzU3RyaW5nLmpzJyksXG4gICAgZmluZEVsZW1lbnRJbkFycmF5ID0gcmVxdWlyZSgnLi9maW5kRWxlbWVudEluQXJyYXkuanMnKSxcbiAgICBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGU7XG5cbi8qKlxuICpcbiAqIEZ1bmN0aW9uIHVzZWQgdG8gZ2V0IHRoZSBtZWRpYSB0eXBlIGJhc2VkIG9uIHRoZSBtaW1lIHR5cGUuIFVzZWQgdG8gZGV0ZXJtaW5lIHRoZSBtZWRpYSB0eXBlIG9mIEFkYXB0YXRpb24gU2V0c1xuICogb3IgY29ycmVzcG9uZGluZyBkYXRhIHJlcHJlc2VudGF0aW9ucy5cbiAqXG4gKiBAcGFyYW0gbWltZVR5cGUge3N0cmluZ30gbWltZSB0eXBlIGZvciBhIERBU0ggTVBEIEFkYXB0YXRpb24gU2V0IChzcGVjaWZpZWQgYXMgYW4gYXR0cmlidXRlIHN0cmluZylcbiAqIEBwYXJhbSB0eXBlcyB7c3RyaW5nfSAgICBzdXBwb3J0ZWQgbWVkaWEgdHlwZXMgKGUuZy4gJ3ZpZGVvLCcgJ2F1ZGlvLCcpXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAgICAgICAgdGhlIG1lZGlhIHR5cGUgdGhhdCBjb3JyZXNwb25kcyB0byB0aGUgbWltZSB0eXBlLlxuICovXG5nZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUgPSBmdW5jdGlvbihtaW1lVHlwZSwgdHlwZXMpIHtcbiAgICBpZiAoIWlzU3RyaW5nKG1pbWVUeXBlKSkgeyByZXR1cm4gbnVsbDsgfSAgIC8vIFRPRE86IFRocm93IGVycm9yP1xuICAgIHZhciBtYXRjaGVkVHlwZSA9IGZpbmRFbGVtZW50SW5BcnJheSh0eXBlcywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgICByZXR1cm4gKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBtYXRjaGVkVHlwZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc0FycmF5KG9iaikge1xuICAgIHJldHVybiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBBcnJheV0nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXk7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbnZhciBpc0Z1bmN0aW9uID0gZnVuY3Rpb24gaXNGdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbic7XG59O1xuLy8gZmFsbGJhY2sgZm9yIG9sZGVyIHZlcnNpb25zIG9mIENocm9tZSBhbmQgU2FmYXJpXG5pZiAoaXNGdW5jdGlvbigveC8pKSB7XG4gICAgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBGdW5jdGlvbl0nO1xuICAgIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNGdW5jdGlvbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNOdW1iZXIodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgTnVtYmVyXScgfHwgZmFsc2U7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNOdW1iZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbnZhciBpc1N0cmluZyA9IGZ1bmN0aW9uIGlzU3RyaW5nKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IFN0cmluZ10nIHx8IGZhbHNlO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBpc1N0cmluZzsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL2V4aXN0eS5qcycpO1xuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxubW9kdWxlLmV4cG9ydHMgPSB0cnV0aHk7Il19
