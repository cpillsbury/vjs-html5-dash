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
},{"./dash/segments/getSegmentListForRepresentation.js":8,"./manifest/MediaTypes.js":14,"./util/existy.js":19,"./util/findElementInArray.js":21,"./util/getMediaTypeFromMimeType.js":22}],3:[function(require,module,exports){
'use strict';

var existy = require('./util/existy.js'),
    isFunction = require('./util/isFunction.js'),
    extendObject = require('./util/extendObject.js'),
    EventDispatcherMixin = require('./events/EventDispatcherMixin.js'),
    // TODO: Determine appropriate default size (or base on segment n x size/duration?)
    // Must consider ABR Switching & Viewing experience of already-buffered segments.
    MIN_DESIRED_BUFFER_SIZE = 20,
    MAX_DESIRED_BUFFER_SIZE = 40;

function hasValue(object, value) {
    if (!existy(object) || !existy(value)) { return false; }
    for (var prop in object) {
        if (object.hasOwnProperty(prop) && (object[prop] === value)) { return true; }
    }
    return false;
}

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
    RECHECK_CURRENT_SEGMENT_LIST: 'recheckCurrentSegmentList',
    LOAD_STATE_CHANGED: 'loadStateChanged'
};

MediaTypeLoader.prototype.loadStates = {
    NOT_LOADING: -10,
    WAITING_TO_CHECK: 0,
    CHECKING_STARTED: 10,
    WAITING_TO_DOWNLOAD: 20,
    DOWNLOAD_STARTED: 30,
    ADD_TO_BUFFER_STARTED: 40,
    LOADING_COMPLETE: 50
};

MediaTypeLoader.prototype.getLoadState = function() {
    return this.__loadState;
};

MediaTypeLoader.prototype.setLoadState = function(loadState) {
    if (loadState === this.__loadState || !hasValue(this.loadStates, loadState)) { return; }
    this.__loadState = loadState;
    this.trigger({ type:this.eventList.LOAD_STATE_CHANGED, target:this, data:loadState });
};

MediaTypeLoader.prototype.getMediaType = function() { return this.__mediaType; };

MediaTypeLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

MediaTypeLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

/**
 * Kicks off segment loading for the media set
 */
MediaTypeLoader.prototype.startLoadingSegments = function() {
    this.startLoadingSegmentsForStaticPlaylist();
};

MediaTypeLoader.prototype.startLoadingSegmentsForStaticPlaylist = function() {
    var self = this,
        nowUTC;

    // Event listener for rechecking segment loading. This event is fired whenever a segment has been successfully
    // downloaded and added to the buffer or, if not currently loading segments (because the buffer is sufficiently full
    // relative to the current playback time), whenever some amount of time has elapsed and we should check on the buffer
    // state again.
    // NOTE: Store a reference to the event handler to potentially remove it later.
    this.__recheckSegmentLoadingHandler = function(event) {
        self.trigger({ type:self.eventList.RECHECK_CURRENT_SEGMENT_LIST, target:self });
        self.__checkSegmentLoading(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
    };

    this.on(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);

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
    this.__checkSegmentLoading(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
};

MediaTypeLoader.prototype.stopLoadingSegments = function() {
    if (!existy(this.__recheckSegmentLoadingHandler)) { return; }

    this.off(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);
    this.__recheckSegmentLoadingHandler = undefined;
};

/**
 *
 * @param minDesiredBufferSize {number} The stipulated minimum amount of time (in seconds) we want in the playback buffer
 *                                      (relative to the current playback time) for the media type.
 * @param maxDesiredBufferSize {number} The stipulated maximum amount of time (in seconds) we want in the playback buffer
 *                                      (relative to the current playback time) for the media type.
 * @private
 */
MediaTypeLoader.prototype.__checkSegmentLoading = function(minDesiredBufferSize, maxDesiredBufferSize) {
    // TODO: Use segment duration with currentTime & currentBufferSize to calculate which segment to grab to avoid edge cases w/rounding & precision
    var self = this,
        tech = self.__tech,
        segmentLoader = self.__segmentLoader,
        sourceBufferDataQueue = self.__sourceBufferDataQueue,
        currentTime = tech.currentTime(),
        currentBufferSize,
        currentSegmentList = segmentLoader.getCurrentSegmentList(),
        segmentDuration = currentSegmentList.getSegmentDuration(),
        totalDuration = currentSegmentList.getTotalDuration(),
        downloadRoundTripTime,
        segmentDownloadDelay,
        timeRangeList = sourceBufferDataQueue.getBufferedTimeRangeListAlignedToSegmentDuration(segmentDuration),
        segmentToDownload = self.getNextSegmentToLoad(currentTime, currentSegmentList, timeRangeList),
        downloadPoint = segmentToDownload.getStartTime();

    currentBufferSize = existy(timeRangeList) && timeRangeList.getLength() > 0 ? downloadPoint - currentTime : 0;

    // TODO: Ugly separation of live vs. VOD. Refactor.
    if (currentSegmentList.getIsLive()) {
        if (existy(timeRangeList) && timeRangeList.getLength() <= 0) {
            self.__loadSegmentAtTime(downloadPoint);
        } else {
            downloadRoundTripTime = segmentLoader.getLastDownloadRoundTripTimeSpan();
            segmentDownloadDelay = segmentDuration - downloadRoundTripTime;
            setTimeout(function() {
                segmentToDownload = self.getNextSegmentToLoad(currentTime, currentSegmentList, timeRangeList);
                downloadPoint = segmentToDownload.getStartTime();
                self.__loadSegmentAtTime(downloadPoint);
            }, Math.floor(segmentDownloadDelay * 1000));
        }
        return;
    }

    // Local function used to notify that we should recheck segment loading. Used when we don't need to currently load segments.
    function deferredRecheckNotification() {
        var recheckWaitTimeMS = Math.floor(Math.min(segmentDuration, 2) * 1000);
        recheckWaitTimeMS = Math.floor(Math.min(segmentDuration, 2) * 1000);
        setTimeout(function() {
            self.trigger({ type:self.eventList.RECHECK_SEGMENT_LOADING, target:self });
        }, recheckWaitTimeMS);
    }

    // If the proposed time to download is after the end time of the media or we have more in the buffer than the max desired,
    // wait a while and then trigger an event notifying that (if anyone's listening) we should recheck to see if conditions
    // have changed.
    // TODO: Handle condition where final segment's duration is less than 1/2 standard segment's duration.
    if (downloadPoint >= totalDuration) {
        deferredRecheckNotification();
        return;
    }

    if (currentBufferSize < minDesiredBufferSize) {
        // Condition 2: There's something in the source buffer starting at the current time for the media type, but it's
        //              below the minimum desired buffer size (seconds of playback in the buffer for the media type)
        // Response: Download the segment that would immediately follow the end of the buffer (relative to the current time).
        //           right now.
        self.__loadSegmentAtTime(downloadPoint);
    } else if (currentBufferSize < maxDesiredBufferSize) {
        // Condition 3: The buffer is full more than the minimum desired buffer size but not yet more than the maximum desired
        //              buffer size.
        downloadRoundTripTime = segmentLoader.getLastDownloadRoundTripTimeSpan();
        segmentDownloadDelay = segmentDuration - downloadRoundTripTime;
        if (segmentDownloadDelay <= 0) {
            // Condition 3a: It took at least as long as the duration of a segment (i.e. the amount of time it would take
            //               to play a given segment) to download the previous segment.
            // Response: Download the segment that would immediately follow the end of the buffer (relative to the current
            //           time) right now.
            self.__loadSegmentAtTime(downloadPoint);
        } else {
            // Condition 3b: Downloading the previous segment took less time than the duration of a segment (i.e. the amount
            //               of time it would take to play a given segment).
            // Response: Download the segment that would immediately follow the end of the buffer (relative to the current
            //           time), but wait to download at the rate of playback (segment duration - time to download).
            setTimeout(function() {
                self.__loadSegmentAtTime(downloadPoint);
            }, Math.floor(segmentDownloadDelay * 1000));
        }
    } else {
        // Condition 4 (default): The buffer has at least the max desired buffer size in it or none of the aforementioned
        //                        conditions were met.
        // Response: Wait a while and then trigger an event notifying that (if anyone's listening) we should recheck to
        //           see if conditions have changed.
        deferredRecheckNotification();
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
MediaTypeLoader.prototype.__loadSegmentAtTime = function loadSegmentAtTime(presentationTime) {
    var self = this,
        segmentLoader = self.__segmentLoader,
        sourceBufferDataQueue = self.__sourceBufferDataQueue,
        hasNextSegment = segmentLoader.loadSegmentAtTime(presentationTime);

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

// TODO: No instance-level dependencies. Make independent function?
MediaTypeLoader.prototype.getNextSegmentToLoad = function(currentTime, segmentList, sourceBufferTimeRangeList) {
    var timeRangeObj = sourceBufferTimeRangeList.getTimeRangeByTime(currentTime),
        previousTimeRangeObj,
        i,
        length;

    if (!existy(timeRangeObj)) {
        if (segmentList.getIsLive()) {
            var nowSegment = segmentList.getSegmentByUTCWallClockTime(Date.now());
            return segmentList.getSegmentByNumber(nowSegment.getNumber() - 1);
        } else {
            return segmentList.getSegmentByTime(currentTime);
        }
    }

    // Find the true buffer edge, since the MSE buffer time ranges might be falsely reporting that there are
    // multiple time ranges when they are temporally adjacent.
    length = sourceBufferTimeRangeList.getLength();
    i = timeRangeObj.getIndex() + 1;
    for (;i<length;i++) {
        previousTimeRangeObj = timeRangeObj;
        timeRangeObj = sourceBufferTimeRangeList.getTimeRangeByIndex(i);
        if ((timeRangeObj.getStart() - previousTimeRangeObj.getEnd()) > 0.003) {
            return segmentList.getSegmentByTime(previousTimeRangeObj.getEnd());
        }
    }

    // If we're here, either a) there was only one timeRange in the list or b) all of the timeRanges in the list were adjacent.
    return segmentList.getSegmentByTime(timeRangeObj.getEnd());
};

// Add event dispatcher functionality to prototype.
extendObject(MediaTypeLoader.prototype, EventDispatcherMixin);

module.exports = MediaTypeLoader;
},{"./events/EventDispatcherMixin.js":10,"./util/existy.js":19,"./util/extendObject.js":20,"./util/isFunction.js":24}],4:[function(require,module,exports){
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
        var segmentLoader = mediaTypeLoader.getSegmentLoader(),
            downloadRateRatio = 1.0,
            currentSegmentListBandwidth = segmentLoader.getCurrentSegmentList().getBandwidth(),
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
            segmentLoader.setCurrentBandwidth(selectedSegmentList.getBandwidth());
        });

        // Update the download rate (round trip time to download a segment of a given average bandwidth/bitrate) to use
        // with choosing which stream variant to load segments from.
        segmentLoader.on(segmentLoader.eventList.DOWNLOAD_DATA_UPDATE, function(event) {
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
        console.log('In PlaylistLoader Playback Rate Handler\n\n');
        console.log('playbackRate: ' + playbackRate + ', readyState: ' + readyState);
        tech.setPlaybackRate(playbackRate);
    }

    for(i=0; i<changePlaybackRateEvents.length; i++) {
        eventType = changePlaybackRateEvents[i];
        tech.on(eventType, changePlaybackRateEventsHandler);
    }
}

module.exports = PlaylistLoader;
},{"./MediaTypeLoader.js":3,"./manifest/MediaTypes.js":14,"./segments/SegmentLoader.js":16,"./selectSegmentList.js":17,"./sourceBuffer/SourceBufferDataQueue.js":18,"./util/existy.js":19}],5:[function(require,module,exports){
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

},{"./PlaylistLoader.js":4,"./manifest/ManifestController.js":13,"global/window":1}],6:[function(require,module,exports){
'use strict';

var xmlfun = require('../../xmlfun.js'),
    util = require('./util.js'),
    isArray = require('../../util/isArray.js'),
    isFunction = require('../../util/isFunction.js'),
    isString = require('../../util/isString.js'),
    parseRootUrl = util.parseRootUrl,
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
    var elemHierarchy = [xmlNode].concat(xmlfun.getAncestors(xmlNode)),
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
var getWidth = xmlfun.getInheritableAttribute('width'),
    getHeight = xmlfun.getInheritableAttribute('height'),
    getFrameRate = xmlfun.getInheritableAttribute('frameRate'),
    getMimeType = xmlfun.getInheritableAttribute('mimeType'),
    getCodecs = xmlfun.getInheritableAttribute('codecs');

var getSegmentTemplateXmlList = xmlfun.getMultiLevelElementList('SegmentTemplate');

// MPD Attr fns
var getMediaPresentationDuration = xmlfun.getAttrFn('mediaPresentationDuration'),
    getType = xmlfun.getAttrFn('type'),
    getMinimumUpdatePeriod = xmlfun.getAttrFn('minimumUpdatePeriod'),
    getAvailabilityStartTime = xmlfun.getAttrFn('availabilityStartTime'),
    getSuggestedPresentationDelay = xmlfun.getAttrFn('suggestedPresentationDelay'),
    getTimeShiftBufferDepth = xmlfun.getAttrFn('timeShiftBufferDepth');

// Representation Attr fns
var getId = xmlfun.getAttrFn('id'),
    getBandwidth = xmlfun.getAttrFn('bandwidth');

// SegmentTemplate Attr fns
var getInitialization = xmlfun.getAttrFn('initialization'),
    getMedia = xmlfun.getAttrFn('media'),
    getDuration = xmlfun.getAttrFn('duration'),
    getTimescale = xmlfun.getAttrFn('timescale'),
    getPresentationTimeOffset = xmlfun.getAttrFn('presentationTimeOffset'),
    getStartNumber = xmlfun.getAttrFn('startNumber');

// TODO: Repeat code. Abstract away (Prototypal Inheritance/OO Model? Object composer fn?)
createMpdObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getPeriods: xmlfun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'Period', createPeriodObject),
        getMediaPresentationDuration: xmlfun.preApplyArgsFn(getMediaPresentationDuration, xmlNode),
        getType: xmlfun.preApplyArgsFn(getType, xmlNode),
        getMinimumUpdatePeriod: xmlfun.preApplyArgsFn(getMinimumUpdatePeriod, xmlNode),
        getAvailabilityStartTime: xmlfun.preApplyArgsFn(getAvailabilityStartTime, xmlNode),
        getSuggestedPresentationDelay: xmlfun.preApplyArgsFn(getSuggestedPresentationDelay, xmlNode),
        getTimeShiftBufferDepth: xmlfun.preApplyArgsFn(getTimeShiftBufferDepth, xmlNode)
    };
};

createPeriodObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getAdaptationSets: xmlfun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getAdaptationSetByType: function(type) {
            return getAdaptationSetByType(type, xmlNode);
        },
        getMpd: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject)
    };
};

createAdaptationSetObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getRepresentations: xmlfun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'Representation', createRepresentationObject),
        getSegmentTemplate: function() {
            return createSegmentTemplate(getSegmentTemplateXmlList(xmlNode));
        },
        getPeriod: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getMimeType: xmlfun.preApplyArgsFn(getMimeType, xmlNode)
    };
};

createRepresentationObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getSegmentTemplate: function() {
            return createSegmentTemplate(getSegmentTemplateXmlList(xmlNode));
        },
        getAdaptationSet: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getId: xmlfun.preApplyArgsFn(getId, xmlNode),
        getWidth: xmlfun.preApplyArgsFn(getWidth, xmlNode),
        getHeight: xmlfun.preApplyArgsFn(getHeight, xmlNode),
        getFrameRate: xmlfun.preApplyArgsFn(getFrameRate, xmlNode),
        getBandwidth: xmlfun.preApplyArgsFn(getBandwidth, xmlNode),
        getCodecs: xmlfun.preApplyArgsFn(getCodecs, xmlNode),
        getBaseUrl: xmlfun.preApplyArgsFn(buildBaseUrl, xmlNode),
        getMimeType: xmlfun.preApplyArgsFn(getMimeType, xmlNode)
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
        getAdaptationSet: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'Period', createPeriodObject),
        getMpd: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'MPD', createMpdObject),
        // Attrs
        getInitialization: xmlfun.preApplyArgsFn(getAttrFromXmlArray, getInitialization, xmlArray),
        getMedia: xmlfun.preApplyArgsFn(getAttrFromXmlArray, getMedia, xmlArray),
        getDuration: xmlfun.preApplyArgsFn(getAttrFromXmlArray, getDuration, xmlArray),
        getTimescale: xmlfun.preApplyArgsFn(getAttrFromXmlArray, getTimescale, xmlArray),
        getPresentationTimeOffset: xmlfun.preApplyArgsFn(getAttrFromXmlArray, getPresentationTimeOffset, xmlArray),
        getStartNumber: xmlfun.preApplyArgsFn(getAttrFromXmlArray, getStartNumber, xmlArray)
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

// TODO: Move to xmlfun or own module.
getDescendantObjectsArrayByName = function(parentXml, tagName, mapFn) {
    var descendantsXmlArray = Array.prototype.slice.call(parentXml.getElementsByTagName(tagName));
    /*if (typeof mapFn === 'function') { return descendantsXmlArray.map(mapFn); }*/
    if (typeof mapFn === 'function') {
        var mappedElem = descendantsXmlArray.map(mapFn);
        return  mappedElem;
    }
    return descendantsXmlArray;
};

// TODO: Move to xmlfun or own module.
getAncestorObjectByName = function getAncestorObjectByName(xmlNode, tagName, mapFn) {
    if (!tagName || !xmlNode || !xmlNode.parentNode) { return null; }
    if (!xmlNode.parentNode.nodeName) { return null; }

    if (xmlNode.parentNode.nodeName === tagName) {
        return isFunction(mapFn) ? mapFn(xmlNode.parentNode) : xmlNode.parentNode;
    }
    return getAncestorObjectByName(xmlNode.parentNode, tagName, mapFn);
};

module.exports = getMpd;
},{"../../util/isArray.js":23,"../../util/isFunction.js":24,"../../util/isString.js":26,"../../xmlfun.js":28,"./util.js":7}],7:[function(require,module,exports){
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

var util = {
    parseRootUrl: parseRootUrl,
    parseMediaPresentationDuration: parseMediaPresentationDuration,
    parseDateTime: parseDateTime
};

module.exports = util;
},{}],8:[function(require,module,exports){
'use strict';

var existy = require('../../util/existy.js'),
    xmlfun = require('../../xmlfun.js'),
    parseMediaPresentationDuration = require('../mpd/util.js').parseMediaPresentationDuration,
    parseDateTime = require('../mpd/util.js').parseDateTime,
    segmentTemplate = require('./segmentTemplate'),
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

createSegmentListFromTemplate = function(representation) {
    return {
        getType: xmlfun.preApplyArgsFn(getType, representation),
        getIsLive: xmlfun.preApplyArgsFn(getIsLive, representation),
        getBandwidth: xmlfun.preApplyArgsFn(getBandwidth, representation),
        getHeight: xmlfun.preApplyArgsFn(getHeight, representation),
        getWidth: xmlfun.preApplyArgsFn(getWidth, representation),
        getTotalDuration: xmlfun.preApplyArgsFn(getTotalDurationFromTemplate, representation),
        getSegmentDuration: xmlfun.preApplyArgsFn(getSegmentDurationFromTemplate, representation),
        getUTCWallClockStartTime: xmlfun.preApplyArgsFn(getUTCWallClockStartTimeFromTemplate, representation),
        getTimeShiftBufferDepth: xmlfun.preApplyArgsFn(getTimeShiftBufferDepth, representation),
        getTotalSegmentCount: xmlfun.preApplyArgsFn(getTotalSegmentCountFromTemplate, representation),
        getStartNumber: xmlfun.preApplyArgsFn(getStartNumberFromTemplate, representation),
        getEndNumber: xmlfun.preApplyArgsFn(getEndNumberFromTemplate, representation),
        // TODO: Externalize
        getInitialization: function() {
            var initialization = {};
            initialization.getUrl = function() {
                var baseUrl = representation.getBaseUrl(),
                    representationId = representation.getId(),
                    initializationRelativeUrlTemplate = representation.getSegmentTemplate().getInitialization(),
                    initializationRelativeUrl = segmentTemplate.replaceIDForTemplate(initializationRelativeUrlTemplate, representationId);

                initializationRelativeUrl = segmentTemplate.replaceTokenForTemplate(initializationRelativeUrl, 'Bandwidth', representation.getBandwidth());
                return baseUrl + initializationRelativeUrl;
            };
            return initialization;
        },
        getSegmentByNumber: function(number) { return createSegmentFromTemplateByNumber(representation, number); },
        getSegmentByTime: function(seconds) { return createSegmentFromTemplateByTime(representation, seconds); },
        getSegmentByUTCWallClockTime: function(utcMilliseconds) { return createSegmentFromTemplateByUTCWallClockTime(representation, utcMilliseconds); }
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

},{"../../util/existy.js":19,"../../xmlfun.js":28,"../mpd/util.js":7,"./segmentTemplate":9}],9:[function(require,module,exports){
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

module.exports = segmentTemplate;
},{}],10:[function(require,module,exports){
'use strict';

var eventMgr = require('./eventManager.js'),
    eventDispatcherMixin = {
        trigger: function(eventObject) { eventMgr.trigger(this, eventObject); },
        one: function(type, listenerFn) { eventMgr.one(this, type, listenerFn); },
        on: function(type, listenerFn) { eventMgr.on(this, type, listenerFn); },
        off: function(type, listenerFn) { eventMgr.off(this, type, listenerFn); }
    };

module.exports = eventDispatcherMixin;
},{"./eventManager.js":11}],11:[function(require,module,exports){
'use strict';

var videojs = require('global/window').videojs,
    eventManager = {
        trigger: videojs.trigger,
        one: videojs.one,
        on: videojs.on,
        off: videojs.off
    };

module.exports = eventManager;

},{"global/window":1}],12:[function(require,module,exports){
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

},{"./SourceHandler":5,"global/window":1}],13:[function(require,module,exports){
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
    parseMediaPresentationDuration = require('../dash/mpd/util.js').parseMediaPresentationDuration,
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
},{"../MediaSet.js":2,"../dash/mpd/getMpd.js":6,"../dash/mpd/util.js":7,"../events/EventDispatcherMixin.js":10,"../util/existy.js":19,"../util/extendObject.js":20,"../util/findElementInArray.js":21,"../util/getMediaTypeFromMimeType.js":22,"../util/isArray.js":23,"../util/isFunction.js":24,"../util/isString.js":26,"../util/truthy.js":27,"./MediaTypes.js":14,"./loadManifest.js":15}],14:[function(require,module,exports){
module.exports = ['video', 'audio'];
},{}],15:[function(require,module,exports){
'use strict';

var parseRootUrl = require('../dash/mpd/util.js').parseRootUrl;

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
},{"../dash/mpd/util.js":7}],16:[function(require,module,exports){

var existy = require('../util/existy.js'),
    isNumber = require('../util/isNumber.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    loadSegment,
    DEFAULT_RETRY_COUNT = 3,
    DEFAULT_RETRY_INTERVAL = 250;

/**
 * Generic function for loading MPEG-DASH segments
 * @param segment {object}          data view representing a segment (and relevant data for that segment)
 * @param callbackFn {function}     callback function
 * @param retryCount {number}       stipulates how many times we should try to load the segment before giving up
 * @param retryInterval {number}    stipulates the amount of time (in milliseconds) we should wait before retrying to
 *                                  download the segment if/when the download attempt fails.
 */
loadSegment = function(segment, callbackFn, retryCount, retryInterval) {
    var self = this;
    self.__lastDownloadCompleteTime = null;

    var request = new XMLHttpRequest(),
        url = segment.getUrl();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';

    request.onload = function() {
        if (request.status < 200 || request.status > 299) {
            console.log('Failed to load Segment @ URL: ' + segment.getUrl());
            if (retryCount > 0) {
                setTimeout(function() {
                    loadSegment.call(self, segment, callbackFn, retryCount - 1, retryInterval);
                }, retryInterval);
            } else {
                console.log('FAILED TO LOAD SEGMENT EVEN AFTER RETRIES');
            }
            return;
        }

        self.__lastDownloadCompleteTime = Number((new Date().getTime())/1000);

        if (typeof callbackFn === 'function') { callbackFn.call(self, request.response); }
    };
    //request.onerror = request.onloadend = function() {
    request.onerror = function() {
        console.log('Failed to load Segment @ URL: ' + segment.getUrl());
        if (retryCount > 0) {
            setTimeout(function() {
                loadSegment.call(self, segment, callbackFn, retryCount - 1, retryInterval);
            }, retryInterval);
        } else {
            console.log('FAILED TO LOAD SEGMENT EVEN AFTER RETRIES');
        }
        return;
    };

    self.__lastDownloadStartTime = Number((new Date().getTime())/1000);
    request.send();
};

/**
 *
 * SegmentLoader handles loading segments from segment lists for a given media set, based on the currently selected
 * segment list (which corresponds to the currently set bandwidth/bitrate)
 *
 * @param manifestController {ManifestController}
 * @param mediaType {string}
 * @constructor
 */
function SegmentLoader(manifestController, mediaType) {
    if (!existy(manifestController)) { throw new Error('SegmentLoader must be initialized with a manifestController!'); }
    if (!existy(mediaType)) { throw new Error('SegmentLoader must be initialized with a mediaType!'); }
    // NOTE: Rather than passing in a reference to the MediaSet instance for a media type, we pass in a reference to the
    // controller & the mediaType so that the SegmentLoader doesn't need to be aware of state changes/updates to
    // the manifest data (say, if the playlist is dynamic/'live').
    this.__manifest = manifestController;
    this.__mediaType = mediaType;
    // TODO: Don't like this: Need to centralize place(s) where & how __currentBandwidthChanged gets set to true/false.
    this.__currentBandwidth = this.getCurrentBandwidth();
    this.__currentBandwidthChanged = true;
}

/**
 * Enumeration of events instances of this object will dispatch.
 */
SegmentLoader.prototype.eventList = {
    INITIALIZATION_LOADED: 'initializationLoaded',
    SEGMENT_LOADED: 'segmentLoaded',
    DOWNLOAD_DATA_UPDATE: 'downloadDataUpdate'
};

SegmentLoader.prototype.__getMediaSet = function getMediaSet() {
    var mediaSet = this.__manifest.getMediaSetByType(this.__mediaType);
    return mediaSet;
};

SegmentLoader.prototype.__getDefaultSegmentList = function getDefaultSegmentList() {
    var segmentList = this.__getMediaSet().getSegmentLists()[0];
    return segmentList;
};

SegmentLoader.prototype.getCurrentBandwidth = function getCurrentBandwidth() {
    if (!isNumber(this.__currentBandwidth)) { this.__currentBandwidth = this.__getDefaultSegmentList().getBandwidth(); }
    return this.__currentBandwidth;
};

/**
 * Sets the current bandwidth, which corresponds to the currently selected segment list (i.e. the segment list in the
 * media set from which we should be downloading segments).
 * @param bandwidth {number}
 */
SegmentLoader.prototype.setCurrentBandwidth = function setCurrentBandwidth(bandwidth) {
    if (!isNumber(bandwidth)) {
        throw new Error('SegmentLoader::setCurrentBandwidth() expects a numeric value for bandwidth!');
    }
    var availableBandwidths = this.getAvailableBandwidths();
    if (availableBandwidths.indexOf(bandwidth) < 0) {
        throw new Error('SegmentLoader::setCurrentBandwidth() must be set to one of the following values: ' + availableBandwidths.join(', '));
    }
    if (bandwidth === this.__currentBandwidth) { return; }
    // Track when we've switch bandwidths, since we'll need to (re)load the initialization segment for the segment list
    // whenever we switch between segment lists. This allows SegmentLoader instances to automatically do this, hiding those
    // details from the outside.
    this.__currentBandwidthChanged = true;
    this.__currentBandwidth = bandwidth;
};

SegmentLoader.prototype.getCurrentSegmentList = function getCurrentSegmentList() {
    var segmentList =  this.__getMediaSet().getSegmentListByBandwidth(this.getCurrentBandwidth());
    return segmentList;
};

SegmentLoader.prototype.getAvailableBandwidths = function() {
    var availableBandwidths = this.__getMediaSet().getAvailableBandwidths();
    return availableBandwidths;
};

SegmentLoader.prototype.getStartNumber = function getStartNumber() {
    var startNumber = this.__getMediaSet().getSegmentListStartNumber();
    return startNumber;
};

SegmentLoader.prototype.getCurrentSegment = function getCurrentSegment() {
    var segment = this.getCurrentSegmentList().getSegmentByNumber(this.__currentSegmentNumber);
    return segment;
};

SegmentLoader.prototype.getCurrentSegmentNumber = function getCurrentSegmentNumber() { return this.__currentSegmentNumber; };

SegmentLoader.prototype.getCurrentSegmentStartTime = function getCurrentSegmentStartTime() { return this.getCurrentSegment().getStartNumber(); };

SegmentLoader.prototype.getEndNumber = function() {
    var endNumber = this.__getMediaSet().getSegmentListEndNumber();
    return endNumber;
};

SegmentLoader.prototype.getLastDownloadStartTime = function() {
    return existy(this.__lastDownloadStartTime) ? this.__lastDownloadStartTime : -1;
};

SegmentLoader.prototype.getLastDownloadCompleteTime = function() {
    return existy(this.__lastDownloadCompleteTime) ? this.__lastDownloadCompleteTime : -1;
};

SegmentLoader.prototype.getLastDownloadRoundTripTimeSpan = function() {
    return this.getLastDownloadCompleteTime() - this.getLastDownloadStartTime();
};

/**
 *
 * Method for downloading the initialization segment for the currently selected segment list (which corresponds to the
 * currently set bandwidth)
 *
 * @returns {boolean}
 */
SegmentLoader.prototype.loadInitialization = function() {
    var self = this,
        segmentList = this.getCurrentSegmentList(),
        initialization = segmentList.getInitialization();

    if (!initialization) { return false; }

    loadSegment.call(this, initialization, function(response) {
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.INITIALIZATION_LOADED, target:self, data:initSegment});
    });

    return true;
};

SegmentLoader.prototype.loadNextSegment = function() {
    var noCurrentSegmentNumber = existy(this.__currentSegmentNumber),
        number = noCurrentSegmentNumber ? this.getStartNumber() : this.__currentSegmentNumber + 1;
    return this.loadSegmentAtNumber(number);
};

// TODO: Duplicate code below. Abstract away.
/**
 *
 * Method for downloading a segment from the currently selected segment list based on its "number" (see param comment below)
 *
 * @param number {number}   Index-like value for specifying which segment to load from the segment list.
 * @returns {boolean}
 */
SegmentLoader.prototype.loadSegmentAtNumber = function(number) {
    var self = this,
        segmentList = this.getCurrentSegmentList();

    if (number > this.getEndNumber()) { return false; }

    var segment = segmentList.getSegmentByNumber(number);

    // If the bandwidth has changed since our last download, automatically load the initialization segment for the corresponding
    // segment list before downloading the desired segment)
    if (this.__currentBandwidthChanged) {
        this.one(this.eventList.INITIALIZATION_LOADED, function(event) {
            var initSegment = event.data;
            self.__currentBandwidthChanged = false;
            loadSegment.call(self, segment, function(response) {
                var segmentData = new Uint8Array(response);
                self.__currentSegmentNumber = segment.getNumber();
                self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:[initSegment, segmentData] });
            }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);
        });
        this.loadInitialization();
    } else {
        loadSegment.call(self, segment, function(response) {
            // Dispatch event that provides metrics on download round trip time & bandwidth of segment (used with ABR switching logic)
            self.trigger(
                {
                    type:self.eventList.DOWNLOAD_DATA_UPDATE,
                    target: self,
                    data: {
                        rtt: self.getLastDownloadRoundTripTimeSpan(),
                        playbackTime: segment.getDuration(),
                        bandwidth: segmentList.getBandwidth()
                    }
                }
            );
            var segmentData = new Uint8Array(response);
            self.__currentSegmentNumber = segment.getNumber();
            //
            self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:segmentData });
        }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);
    }

    return true;
};

/**
 *
 * Method for downloading a segment from the currently selected segment list based on the media presentation time that
 * corresponds with a given segment.
 *
 * @param presentationTime {number} media presentation time corresponding to the segment we'd like to load from the segment list
 * @returns {boolean}
 */
SegmentLoader.prototype.loadSegmentAtTime = function(presentationTime) {
    var self = this,
        segmentList = this.getCurrentSegmentList();

    if (presentationTime > segmentList.getTotalDuration()) { return false; }

    var segment = segmentList.getSegmentByTime(presentationTime);

    // If the bandwidth has changed since our last download, automatically load the initialization segment for the corresponding
    // segment list before downloading the desired segment)
    if (this.__currentBandwidthChanged) {
        this.one(this.eventList.INITIALIZATION_LOADED, function(event) {
            var initSegment = event.data;
            self.__currentBandwidthChanged = false;
            loadSegment.call(self, segment, function(response) {
                var segmentData = new Uint8Array(response);
                self.__currentSegmentNumber = segment.getNumber();
                self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:[initSegment, segmentData] });
            }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);
        });
        this.loadInitialization();
    } else {
        loadSegment.call(self, segment, function(response) {
            // Dispatch event that provides metrics on download round trip time & bandwidth of segment (used with ABR switching logic)
            self.trigger(
                {
                    type:self.eventList.DOWNLOAD_DATA_UPDATE,
                    target: self,
                    data: {
                        rtt: self.getLastDownloadRoundTripTimeSpan(),
                        playbackTime: segment.getDuration(),
                        bandwidth: segmentList.getBandwidth()
                    }
                }
            );
            var segmentData = new Uint8Array(response);
            self.__currentSegmentNumber = segment.getNumber();
            self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:segmentData });
        }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);
    }

    return true;
};

// Add event dispatcher functionality to prototype.
extendObject(SegmentLoader.prototype, EventDispatcherMixin);

module.exports = SegmentLoader;
},{"../events/EventDispatcherMixin.js":10,"../util/existy.js":19,"../util/extendObject.js":20,"../util/isNumber.js":25}],17:[function(require,module,exports){
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
},{}],18:[function(require,module,exports){
'use strict';

var isFunction = require('../util/isFunction.js'),
    isArray = require('../util/isArray.js'),
    isNumber = require('../util/isNumber.js'),
    existy = require('../util/existy.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js');

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
},{"../events/EventDispatcherMixin.js":10,"../util/existy.js":19,"../util/extendObject.js":20,"../util/isArray.js":23,"../util/isFunction.js":24,"../util/isNumber.js":25}],19:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],20:[function(require,module,exports){
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
},{}],21:[function(require,module,exports){
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
},{"./isArray.js":23,"./isFunction.js":24}],22:[function(require,module,exports){
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
},{"./existy.js":19,"./findElementInArray.js":21,"./isString.js":26}],23:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],24:[function(require,module,exports){
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
},{}],25:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isNumber(value) {
    return typeof value === 'number' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object Number]' || false;
}

module.exports = isNumber;
},{}],26:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object String]' || false;
};

module.exports = isString;
},{}],27:[function(require,module,exports){
'use strict';

var existy = require('./existy.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

module.exports = truthy;
},{"./existy.js":19}],28:[function(require,module,exports){
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

// TODO: Implement me for BaseURL or use existing fn (See: mpd.js buildBaseUrl())
/*var buildHierarchicallyStructuredValue = function(valueFn, buildFn, stopPred) {

};*/

// Publish External API:
var xmlfun = {};
xmlfun.existy = existy;
xmlfun.truthy = truthy;

xmlfun.getNodeListByName = getNodeListByName;
xmlfun.hasMatchingAttribute = hasMatchingAttribute;
xmlfun.getInheritableAttribute = getInheritableAttribute;
xmlfun.getAncestors = getAncestors;
xmlfun.getAttrFn = getAttrFn;
xmlfun.preApplyArgsFn = preApplyArgsFn;
xmlfun.getInheritableElement = getInheritableElement;
xmlfun.getMultiLevelElementList = getMultiLevelElementList;

module.exports = xmlfun;
},{"./util/existy.js":19,"./util/isFunction.js":24,"./util/isString.js":26}]},{},[12])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVNldC5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvZmluZEVsZW1lbnRJbkFycmF5LmpzIiwic3JjL2pzL3V0aWwvZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlLmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ROQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2S0E7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNySEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHdpbmRvdztcbn0gZWxzZSBpZiAodHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZ2xvYmFsO1xufSBlbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIil7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBzZWxmO1xufSBlbHNlIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHt9O1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSA9IHJlcXVpcmUoJy4vdXRpbC9nZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUuanMnKSxcbiAgICBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uID0gcmVxdWlyZSgnLi9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMnKSxcbiAgICBmaW5kRWxlbWVudEluQXJyYXkgPSByZXF1aXJlKCcuL3V0aWwvZmluZEVsZW1lbnRJbkFycmF5LmpzJyksXG4gICAgbWVkaWFUeXBlcyA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWVkaWFUeXBlcy5qcycpO1xuXG4vKipcbiAqXG4gKiBQcmltYXJ5IGRhdGEgdmlldyBmb3IgcmVwcmVzZW50aW5nIHRoZSBzZXQgb2Ygc2VnbWVudCBsaXN0cyBhbmQgb3RoZXIgZ2VuZXJhbCBpbmZvcm1hdGlvbiBmb3IgYSBnaXZlIG1lZGlhIHR5cGVcbiAqIChlLmcuICdhdWRpbycgb3IgJ3ZpZGVvJykuXG4gKlxuICogQHBhcmFtIGFkYXB0YXRpb25TZXQgVGhlIE1QRUctREFTSCBjb3JyZWxhdGUgZm9yIGEgZ2l2ZW4gbWVkaWEgc2V0LCBjb250YWluaW5nIHNvbWUgd2F5IG9mIHJlcHJlc2VudGF0aW5nIHNlZ21lbnQgbGlzdHNcbiAqICAgICAgICAgICAgICAgICAgICAgIGFuZCBhIHNldCBvZiByZXByZXNlbnRhdGlvbnMgZm9yIGVhY2ggc3RyZWFtIHZhcmlhbnQuXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gTWVkaWFTZXQoYWRhcHRhdGlvblNldCkge1xuICAgIC8vIFRPRE86IEFkZGl0aW9uYWwgY2hlY2tzICYgRXJyb3IgVGhyb3dpbmdcbiAgICB0aGlzLl9fYWRhcHRhdGlvblNldCA9IGFkYXB0YXRpb25TZXQ7XG59XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVR5cGUoKSB7XG4gICAgdmFyIHR5cGUgPSBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUodGhpcy5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKTtcbiAgICByZXR1cm4gdHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRNaW1lVHlwZSA9IGZ1bmN0aW9uIGdldE1pbWVUeXBlKCkge1xuICAgIHZhciBtaW1lVHlwZSA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldE1pbWVUeXBlKCk7XG4gICAgcmV0dXJuIG1pbWVUeXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNvdXJjZUJ1ZmZlclR5cGUgPSBmdW5jdGlvbiBnZXRTb3VyY2VCdWZmZXJUeXBlKCkge1xuICAgIC8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGUgY29kZWNzIGFzc29jaWF0ZWQgd2l0aCBlYWNoIHN0cmVhbSB2YXJpYW50L3JlcHJlc2VudGF0aW9uXG4gICAgLy8gd2lsbCBiZSBzaW1pbGFyIGVub3VnaCB0aGF0IHlvdSB3b24ndCBoYXZlIHRvIHJlLWNyZWF0ZSB0aGUgc291cmNlLWJ1ZmZlciB3aGVuIHN3aXRjaGluZ1xuICAgIC8vIGJldHdlZW4gdGhlbS5cblxuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzZWdtZW50TGlzdC5nZXRUeXBlKCk7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VG90YWxEdXJhdGlvbiA9IGZ1bmN0aW9uIGdldFRvdGFsRHVyYXRpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHRvdGFsRHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRUb3RhbER1cmF0aW9uKCk7XG4gICAgcmV0dXJuIHRvdGFsRHVyYXRpb247XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHdhbGxDbG9ja1RpbWUgPSBzZWdtZW50TGlzdC5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUoKTtcbiAgICByZXR1cm4gd2FsbENsb2NrVGltZTtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsU2VnbWVudENvdW50ID0gZnVuY3Rpb24gZ2V0VG90YWxTZWdtZW50Q291bnQoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHRvdGFsU2VnbWVudENvdW50ID0gc2VnbWVudExpc3QuZ2V0VG90YWxTZWdtZW50Q291bnQoKTtcbiAgICByZXR1cm4gdG90YWxTZWdtZW50Q291bnQ7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0U2VnbWVudER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKTtcbiAgICByZXR1cm4gc2VnbWVudER1cmF0aW9uO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gc2VnbWVudExpc3QuZ2V0U3RhcnROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RTdGFydE51bWJlcjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEVuZE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0RW5kTnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdEVuZE51bWJlciA9IHNlZ21lbnRMaXN0LmdldEVuZE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdEVuZE51bWJlcjtcbn07XG5cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0cyA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0cygpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIHNlZ21lbnRMaXN0cyA9IHJlcHJlc2VudGF0aW9ucy5tYXAoZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbik7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0cztcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aChiYW5kd2lkdGgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoID0gZmluZEVsZW1lbnRJbkFycmF5KHJlcHJlc2VudGF0aW9ucywgZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHZhciByZXByZXNlbnRhdGlvbkJhbmR3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgICAgICAgICAgcmV0dXJuIChOdW1iZXIocmVwcmVzZW50YXRpb25CYW5kd2lkdGgpID09PSBOdW1iZXIoYmFuZHdpZHRoKSk7XG4gICAgICAgIH0pLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb25XaXRoQmFuZHdpZHRoTWF0Y2gpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24gZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpIHtcbiAgICByZXR1cm4gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCkubWFwKFxuICAgICAgICBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgIH0pLmZpbHRlcihcbiAgICAgICAgZnVuY3Rpb24oYmFuZHdpZHRoKSB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCk7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBNZWRpYVNldDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICAvLyBUT0RPOiBEZXRlcm1pbmUgYXBwcm9wcmlhdGUgZGVmYXVsdCBzaXplIChvciBiYXNlIG9uIHNlZ21lbnQgbiB4IHNpemUvZHVyYXRpb24/KVxuICAgIC8vIE11c3QgY29uc2lkZXIgQUJSIFN3aXRjaGluZyAmIFZpZXdpbmcgZXhwZXJpZW5jZSBvZiBhbHJlYWR5LWJ1ZmZlcmVkIHNlZ21lbnRzLlxuICAgIE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFID0gMjAsXG4gICAgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUgPSA0MDtcblxuZnVuY3Rpb24gaGFzVmFsdWUob2JqZWN0LCB2YWx1ZSkge1xuICAgIGlmICghZXhpc3R5KG9iamVjdCkgfHwgIWV4aXN0eSh2YWx1ZSkpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgZm9yICh2YXIgcHJvcCBpbiBvYmplY3QpIHtcbiAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShwcm9wKSAmJiAob2JqZWN0W3Byb3BdID09PSB2YWx1ZSkpIHsgcmV0dXJuIHRydWU7IH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqXG4gKiBNZWRpYVR5cGVMb2FkZXIgY29vcmRpbmF0ZXMgYmV0d2VlbiBzZWdtZW50IGRvd25sb2FkaW5nIGFuZCBhZGRpbmcgc2VnbWVudHMgdG8gdGhlIE1TRSBzb3VyY2UgYnVmZmVyIGZvciBhIGdpdmVuIG1lZGlhIHR5cGUgKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKS5cbiAqXG4gKiBAcGFyYW0gc2VnbWVudExvYWRlciB7U2VnbWVudExvYWRlcn0gICAgICAgICAgICAgICAgIG9iamVjdCBpbnN0YW5jZSB0aGF0IGhhbmRsZXMgZG93bmxvYWRpbmcgc2VnbWVudHMgZm9yIHRoZSBtZWRpYSBzZXRcbiAqIEBwYXJhbSBzb3VyY2VCdWZmZXJEYXRhUXVldWUge1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZX0gb2JqZWN0IGluc3RhbmNlIHRoYXQgaGFuZGxlcyBhZGRpbmcgc2VnbWVudHMgdG8gTVNFIFNvdXJjZUJ1ZmZlclxuICogQHBhcmFtIG1lZGlhVHlwZSB7c3RyaW5nfSAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBtZWRpYSB0eXBlIChlLmcuICdhdWRpbycgb3IgJ3ZpZGVvJykgZm9yIHRoZSBtZWRpYSBzZXRcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBpbnN0YW5jZS5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNZWRpYVR5cGVMb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBtZWRpYVR5cGUsIHRlY2gpIHtcbiAgICB0aGlzLl9fc2VnbWVudExvYWRlciA9IHNlZ21lbnRMb2FkZXI7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTtcbiAgICB0aGlzLl9fbWVkaWFUeXBlID0gbWVkaWFUeXBlO1xuICAgIHRoaXMuX190ZWNoID0gdGVjaDtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HOiAncmVjaGVja1NlZ21lbnRMb2FkaW5nJyxcbiAgICBSRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNUOiAncmVjaGVja0N1cnJlbnRTZWdtZW50TGlzdCcsXG4gICAgTE9BRF9TVEFURV9DSEFOR0VEOiAnbG9hZFN0YXRlQ2hhbmdlZCdcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUubG9hZFN0YXRlcyA9IHtcbiAgICBOT1RfTE9BRElORzogLTEwLFxuICAgIFdBSVRJTkdfVE9fQ0hFQ0s6IDAsXG4gICAgQ0hFQ0tJTkdfU1RBUlRFRDogMTAsXG4gICAgV0FJVElOR19UT19ET1dOTE9BRDogMjAsXG4gICAgRE9XTkxPQURfU1RBUlRFRDogMzAsXG4gICAgQUREX1RPX0JVRkZFUl9TVEFSVEVEOiA0MCxcbiAgICBMT0FESU5HX0NPTVBMRVRFOiA1MFxufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRMb2FkU3RhdGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX2xvYWRTdGF0ZTtcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuc2V0TG9hZFN0YXRlID0gZnVuY3Rpb24obG9hZFN0YXRlKSB7XG4gICAgaWYgKGxvYWRTdGF0ZSA9PT0gdGhpcy5fX2xvYWRTdGF0ZSB8fCAhaGFzVmFsdWUodGhpcy5sb2FkU3RhdGVzLCBsb2FkU3RhdGUpKSB7IHJldHVybjsgfVxuICAgIHRoaXMuX19sb2FkU3RhdGUgPSBsb2FkU3RhdGU7XG4gICAgdGhpcy50cmlnZ2VyKHsgdHlwZTp0aGlzLmV2ZW50TGlzdC5MT0FEX1NUQVRFX0NIQU5HRUQsIHRhcmdldDp0aGlzLCBkYXRhOmxvYWRTdGF0ZSB9KTtcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0TWVkaWFUeXBlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fbWVkaWFUeXBlOyB9O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldFNlZ21lbnRMb2FkZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zZWdtZW50TG9hZGVyOyB9O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZTsgfTtcblxuLyoqXG4gKiBLaWNrcyBvZmYgc2VnbWVudCBsb2FkaW5nIGZvciB0aGUgbWVkaWEgc2V0XG4gKi9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuc3RhcnRMb2FkaW5nU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0YXJ0TG9hZGluZ1NlZ21lbnRzRm9yU3RhdGljUGxheWxpc3QoKTtcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuc3RhcnRMb2FkaW5nU2VnbWVudHNGb3JTdGF0aWNQbGF5bGlzdCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbm93VVRDO1xuXG4gICAgLy8gRXZlbnQgbGlzdGVuZXIgZm9yIHJlY2hlY2tpbmcgc2VnbWVudCBsb2FkaW5nLiBUaGlzIGV2ZW50IGlzIGZpcmVkIHdoZW5ldmVyIGEgc2VnbWVudCBoYXMgYmVlbiBzdWNjZXNzZnVsbHlcbiAgICAvLyBkb3dubG9hZGVkIGFuZCBhZGRlZCB0byB0aGUgYnVmZmVyIG9yLCBpZiBub3QgY3VycmVudGx5IGxvYWRpbmcgc2VnbWVudHMgKGJlY2F1c2UgdGhlIGJ1ZmZlciBpcyBzdWZmaWNpZW50bHkgZnVsbFxuICAgIC8vIHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHBsYXliYWNrIHRpbWUpLCB3aGVuZXZlciBzb21lIGFtb3VudCBvZiB0aW1lIGhhcyBlbGFwc2VkIGFuZCB3ZSBzaG91bGQgY2hlY2sgb24gdGhlIGJ1ZmZlclxuICAgIC8vIHN0YXRlIGFnYWluLlxuICAgIC8vIE5PVEU6IFN0b3JlIGEgcmVmZXJlbmNlIHRvIHRoZSBldmVudCBoYW5kbGVyIHRvIHBvdGVudGlhbGx5IHJlbW92ZSBpdCBsYXRlci5cbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19DVVJSRU5UX1NFR01FTlRfTElTVCwgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIHNlbGYuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG4gICAgfTtcblxuICAgIHRoaXMub24odGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcblxuICAgIGlmICh0aGlzLl9fc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRJc0xpdmUoKSkge1xuICAgICAgICBub3dVVEMgPSBEYXRlLm5vdygpO1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBzZWcgPSBzZWxmLl9fc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRTZWdtZW50QnlVVENXYWxsQ2xvY2tUaW1lKG5vd1VUQyksXG4gICAgICAgICAgICAgICAgc2VnVVRDU3RhcnRUaW1lID0gc2VnLmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSgpLFxuICAgICAgICAgICAgICAgIHRpbWVPZmZzZXQgPSAobm93VVRDIC0gc2VnVVRDU3RhcnRUaW1lKS8xMDAwLFxuICAgICAgICAgICAgICAgIHNlZWtUb1RpbWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdEFsaWduZWRUb1NlZ21lbnREdXJhdGlvbihzZWcuZ2V0RHVyYXRpb24oKSkuZ2V0VGltZVJhbmdlQnlJbmRleCgwKS5nZXRTdGFydCgpICsgdGltZU9mZnNldDtcbiAgICAgICAgICAgIHNlbGYuX190ZWNoLnNldEN1cnJlbnRUaW1lKHNlZWtUb1RpbWUpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBNYW51YWxseSBjaGVjayBvbiBsb2FkaW5nIHNlZ21lbnRzIHRoZSBmaXJzdCB0aW1lIGFyb3VuZC5cbiAgICB0aGlzLl9fY2hlY2tTZWdtZW50TG9hZGluZyhNSU5fREVTSVJFRF9CVUZGRVJfU0laRSwgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUpO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdG9wTG9hZGluZ1NlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpKSB7IHJldHVybjsgfVxuXG4gICAgdGhpcy5vZmYodGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IHVuZGVmaW5lZDtcbn07XG5cbi8qKlxuICpcbiAqIEBwYXJhbSBtaW5EZXNpcmVkQnVmZmVyU2l6ZSB7bnVtYmVyfSBUaGUgc3RpcHVsYXRlZCBtaW5pbXVtIGFtb3VudCBvZiB0aW1lIChpbiBzZWNvbmRzKSB3ZSB3YW50IGluIHRoZSBwbGF5YmFjayBidWZmZXJcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcGxheWJhY2sgdGltZSkgZm9yIHRoZSBtZWRpYSB0eXBlLlxuICogQHBhcmFtIG1heERlc2lyZWRCdWZmZXJTaXplIHtudW1iZXJ9IFRoZSBzdGlwdWxhdGVkIG1heGltdW0gYW1vdW50IG9mIHRpbWUgKGluIHNlY29uZHMpIHdlIHdhbnQgaW4gdGhlIHBsYXliYWNrIGJ1ZmZlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudCBwbGF5YmFjayB0aW1lKSBmb3IgdGhlIG1lZGlhIHR5cGUuXG4gKiBAcHJpdmF0ZVxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fY2hlY2tTZWdtZW50TG9hZGluZyA9IGZ1bmN0aW9uKG1pbkRlc2lyZWRCdWZmZXJTaXplLCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgIC8vIFRPRE86IFVzZSBzZWdtZW50IGR1cmF0aW9uIHdpdGggY3VycmVudFRpbWUgJiBjdXJyZW50QnVmZmVyU2l6ZSB0byBjYWxjdWxhdGUgd2hpY2ggc2VnbWVudCB0byBncmFiIHRvIGF2b2lkIGVkZ2UgY2FzZXMgdy9yb3VuZGluZyAmIHByZWNpc2lvblxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgdGVjaCA9IHNlbGYuX190ZWNoLFxuICAgICAgICBzZWdtZW50TG9hZGVyID0gc2VsZi5fX3NlZ21lbnRMb2FkZXIsXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUsXG4gICAgICAgIGN1cnJlbnRUaW1lID0gdGVjaC5jdXJyZW50VGltZSgpLFxuICAgICAgICBjdXJyZW50QnVmZmVyU2l6ZSxcbiAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0ID0gc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKSxcbiAgICAgICAgc2VnbWVudER1cmF0aW9uID0gY3VycmVudFNlZ21lbnRMaXN0LmdldFNlZ21lbnREdXJhdGlvbigpLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gY3VycmVudFNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKSxcbiAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lLFxuICAgICAgICBzZWdtZW50RG93bmxvYWREZWxheSxcbiAgICAgICAgdGltZVJhbmdlTGlzdCA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5nZXRCdWZmZXJlZFRpbWVSYW5nZUxpc3RBbGlnbmVkVG9TZWdtZW50RHVyYXRpb24oc2VnbWVudER1cmF0aW9uKSxcbiAgICAgICAgc2VnbWVudFRvRG93bmxvYWQgPSBzZWxmLmdldE5leHRTZWdtZW50VG9Mb2FkKGN1cnJlbnRUaW1lLCBjdXJyZW50U2VnbWVudExpc3QsIHRpbWVSYW5nZUxpc3QpLFxuICAgICAgICBkb3dubG9hZFBvaW50ID0gc2VnbWVudFRvRG93bmxvYWQuZ2V0U3RhcnRUaW1lKCk7XG5cbiAgICBjdXJyZW50QnVmZmVyU2l6ZSA9IGV4aXN0eSh0aW1lUmFuZ2VMaXN0KSAmJiB0aW1lUmFuZ2VMaXN0LmdldExlbmd0aCgpID4gMCA/IGRvd25sb2FkUG9pbnQgLSBjdXJyZW50VGltZSA6IDA7XG5cbiAgICAvLyBUT0RPOiBVZ2x5IHNlcGFyYXRpb24gb2YgbGl2ZSB2cy4gVk9ELiBSZWZhY3Rvci5cbiAgICBpZiAoY3VycmVudFNlZ21lbnRMaXN0LmdldElzTGl2ZSgpKSB7XG4gICAgICAgIGlmIChleGlzdHkodGltZVJhbmdlTGlzdCkgJiYgdGltZVJhbmdlTGlzdC5nZXRMZW5ndGgoKSA8PSAwKSB7XG4gICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkb3dubG9hZFJvdW5kVHJpcFRpbWUgPSBzZWdtZW50TG9hZGVyLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCk7XG4gICAgICAgICAgICBzZWdtZW50RG93bmxvYWREZWxheSA9IHNlZ21lbnREdXJhdGlvbiAtIGRvd25sb2FkUm91bmRUcmlwVGltZTtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgc2VnbWVudFRvRG93bmxvYWQgPSBzZWxmLmdldE5leHRTZWdtZW50VG9Mb2FkKGN1cnJlbnRUaW1lLCBjdXJyZW50U2VnbWVudExpc3QsIHRpbWVSYW5nZUxpc3QpO1xuICAgICAgICAgICAgICAgIGRvd25sb2FkUG9pbnQgPSBzZWdtZW50VG9Eb3dubG9hZC5nZXRTdGFydFRpbWUoKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBMb2NhbCBmdW5jdGlvbiB1c2VkIHRvIG5vdGlmeSB0aGF0IHdlIHNob3VsZCByZWNoZWNrIHNlZ21lbnQgbG9hZGluZy4gVXNlZCB3aGVuIHdlIGRvbid0IG5lZWQgdG8gY3VycmVudGx5IGxvYWQgc2VnbWVudHMuXG4gICAgZnVuY3Rpb24gZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCkge1xuICAgICAgICB2YXIgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9LCByZWNoZWNrV2FpdFRpbWVNUyk7XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIHByb3Bvc2VkIHRpbWUgdG8gZG93bmxvYWQgaXMgYWZ0ZXIgdGhlIGVuZCB0aW1lIG9mIHRoZSBtZWRpYSBvciB3ZSBoYXZlIG1vcmUgaW4gdGhlIGJ1ZmZlciB0aGFuIHRoZSBtYXggZGVzaXJlZCxcbiAgICAvLyB3YWl0IGEgd2hpbGUgYW5kIHRoZW4gdHJpZ2dlciBhbiBldmVudCBub3RpZnlpbmcgdGhhdCAoaWYgYW55b25lJ3MgbGlzdGVuaW5nKSB3ZSBzaG91bGQgcmVjaGVjayB0byBzZWUgaWYgY29uZGl0aW9uc1xuICAgIC8vIGhhdmUgY2hhbmdlZC5cbiAgICAvLyBUT0RPOiBIYW5kbGUgY29uZGl0aW9uIHdoZXJlIGZpbmFsIHNlZ21lbnQncyBkdXJhdGlvbiBpcyBsZXNzIHRoYW4gMS8yIHN0YW5kYXJkIHNlZ21lbnQncyBkdXJhdGlvbi5cbiAgICBpZiAoZG93bmxvYWRQb2ludCA+PSB0b3RhbER1cmF0aW9uKSB7XG4gICAgICAgIGRlZmVycmVkUmVjaGVja05vdGlmaWNhdGlvbigpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWluRGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDI6IFRoZXJlJ3Mgc29tZXRoaW5nIGluIHRoZSBzb3VyY2UgYnVmZmVyIHN0YXJ0aW5nIGF0IHRoZSBjdXJyZW50IHRpbWUgZm9yIHRoZSBtZWRpYSB0eXBlLCBidXQgaXQnc1xuICAgICAgICAvLyAgICAgICAgICAgICAgYmVsb3cgdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSAoc2Vjb25kcyBvZiBwbGF5YmFjayBpbiB0aGUgYnVmZmVyIGZvciB0aGUgbWVkaWEgdHlwZSlcbiAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgdGltZSkuXG4gICAgICAgIC8vICAgICAgICAgICByaWdodCBub3cuXG4gICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDM6IFRoZSBidWZmZXIgaXMgZnVsbCBtb3JlIHRoYW4gdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSBidXQgbm90IHlldCBtb3JlIHRoYW4gdGhlIG1heGltdW0gZGVzaXJlZFxuICAgICAgICAvLyAgICAgICAgICAgICAgYnVmZmVyIHNpemUuXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSA9IHNlZ21lbnRMb2FkZXIuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKTtcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXkgPSBzZWdtZW50RHVyYXRpb24gLSBkb3dubG9hZFJvdW5kVHJpcFRpbWU7XG4gICAgICAgIGlmIChzZWdtZW50RG93bmxvYWREZWxheSA8PSAwKSB7XG4gICAgICAgICAgICAvLyBDb25kaXRpb24gM2E6IEl0IHRvb2sgYXQgbGVhc3QgYXMgbG9uZyBhcyB0aGUgZHVyYXRpb24gb2YgYSBzZWdtZW50IChpLmUuIHRoZSBhbW91bnQgb2YgdGltZSBpdCB3b3VsZCB0YWtlXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIHRvIHBsYXkgYSBnaXZlbiBzZWdtZW50KSB0byBkb3dubG9hZCB0aGUgcHJldmlvdXMgc2VnbWVudC5cbiAgICAgICAgICAgIC8vIFJlc3BvbnNlOiBEb3dubG9hZCB0aGUgc2VnbWVudCB0aGF0IHdvdWxkIGltbWVkaWF0ZWx5IGZvbGxvdyB0aGUgZW5kIG9mIHRoZSBidWZmZXIgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50XG4gICAgICAgICAgICAvLyAgICAgICAgICAgdGltZSkgcmlnaHQgbm93LlxuICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQ29uZGl0aW9uIDNiOiBEb3dubG9hZGluZyB0aGUgcHJldmlvdXMgc2VnbWVudCB0b29rIGxlc3MgdGltZSB0aGFuIHRoZSBkdXJhdGlvbiBvZiBhIHNlZ21lbnQgKGkuZS4gdGhlIGFtb3VudFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICBvZiB0aW1lIGl0IHdvdWxkIHRha2UgdG8gcGxheSBhIGdpdmVuIHNlZ21lbnQpLlxuICAgICAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnRcbiAgICAgICAgICAgIC8vICAgICAgICAgICB0aW1lKSwgYnV0IHdhaXQgdG8gZG93bmxvYWQgYXQgdGhlIHJhdGUgb2YgcGxheWJhY2sgKHNlZ21lbnQgZHVyYXRpb24gLSB0aW1lIHRvIGRvd25sb2FkKS5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICAgICAgfSwgTWF0aC5mbG9vcihzZWdtZW50RG93bmxvYWREZWxheSAqIDEwMDApKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENvbmRpdGlvbiA0IChkZWZhdWx0KTogVGhlIGJ1ZmZlciBoYXMgYXQgbGVhc3QgdGhlIG1heCBkZXNpcmVkIGJ1ZmZlciBzaXplIGluIGl0IG9yIG5vbmUgb2YgdGhlIGFmb3JlbWVudGlvbmVkXG4gICAgICAgIC8vICAgICAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9ucyB3ZXJlIG1ldC5cbiAgICAgICAgLy8gUmVzcG9uc2U6IFdhaXQgYSB3aGlsZSBhbmQgdGhlbiB0cmlnZ2VyIGFuIGV2ZW50IG5vdGlmeWluZyB0aGF0IChpZiBhbnlvbmUncyBsaXN0ZW5pbmcpIHdlIHNob3VsZCByZWNoZWNrIHRvXG4gICAgICAgIC8vICAgICAgICAgICBzZWUgaWYgY29uZGl0aW9ucyBoYXZlIGNoYW5nZWQuXG4gICAgICAgIGRlZmVycmVkUmVjaGVja05vdGlmaWNhdGlvbigpO1xuICAgIH1cbn07XG5cbi8qKlxuICogRG93bmxvYWQgYSBzZWdtZW50IGZyb20gdGhlIGN1cnJlbnQgc2VnbWVudCBsaXN0IGNvcnJlc3BvbmRpbmcgdG8gdGhlIHN0aXB1bGF0ZWQgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgYW5kIGFkZCBpdFxuICogdG8gdGhlIHNvdXJjZSBidWZmZXIuXG4gKlxuICogQHBhcmFtIHByZXNlbnRhdGlvblRpbWUge251bWJlcn0gVGhlIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIGZvciB3aGljaCB3ZSB3YW50IHRvIGRvd25sb2FkIGFuZCBidWZmZXIgYSBzZWdtZW50XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gICAgICAgICAgICAgICBXaGV0aGVyIG9yIG5vdCB0aGUgdGhlcmUgYXJlIHN1YnNlcXVlbnQgc2VnbWVudHMgaW4gdGhlIHNlZ21lbnQgbGlzdCwgcmVsYXRpdmUgdG8gdGhlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZWRpYSBwcmVzZW50YXRpb24gdGltZSByZXF1ZXN0ZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fbG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbiBsb2FkU2VnbWVudEF0VGltZShwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TG9hZGVyID0gc2VsZi5fX3NlZ21lbnRMb2FkZXIsXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUsXG4gICAgICAgIGhhc05leHRTZWdtZW50ID0gc2VnbWVudExvYWRlci5sb2FkU2VnbWVudEF0VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIGlmICghaGFzTmV4dFNlZ21lbnQpIHsgcmV0dXJuIGhhc05leHRTZWdtZW50OyB9XG5cbiAgICBzZWdtZW50TG9hZGVyLm9uZShzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgZnVuY3Rpb24gc2VnbWVudExvYWRlZEhhbmRsZXIoZXZlbnQpIHtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgLy8gT25jZSB3ZSd2ZSBjb21wbGV0ZWQgZG93bmxvYWRpbmcgYW5kIGJ1ZmZlcmluZyB0aGUgc2VnbWVudCwgZGlzcGF0Y2ggZXZlbnQgdG8gbm90aWZ5IHRoYXQgd2Ugc2hvdWxkIHJlY2hlY2tcbiAgICAgICAgICAgIC8vIHdoZXRoZXIgb3Igbm90IHdlIHNob3VsZCBsb2FkIGFub3RoZXIgc2VnbWVudCBhbmQsIGlmIHNvLCB3aGljaC4gKFNlZTogX19jaGVja1NlZ21lbnRMb2FkaW5nKCkgbWV0aG9kLCBhYm92ZSlcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7XG59O1xuXG4vLyBUT0RPOiBObyBpbnN0YW5jZS1sZXZlbCBkZXBlbmRlbmNpZXMuIE1ha2UgaW5kZXBlbmRlbnQgZnVuY3Rpb24/XG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldE5leHRTZWdtZW50VG9Mb2FkID0gZnVuY3Rpb24oY3VycmVudFRpbWUsIHNlZ21lbnRMaXN0LCBzb3VyY2VCdWZmZXJUaW1lUmFuZ2VMaXN0KSB7XG4gICAgdmFyIHRpbWVSYW5nZU9iaiA9IHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QuZ2V0VGltZVJhbmdlQnlUaW1lKGN1cnJlbnRUaW1lKSxcbiAgICAgICAgcHJldmlvdXNUaW1lUmFuZ2VPYmosXG4gICAgICAgIGksXG4gICAgICAgIGxlbmd0aDtcblxuICAgIGlmICghZXhpc3R5KHRpbWVSYW5nZU9iaikpIHtcbiAgICAgICAgaWYgKHNlZ21lbnRMaXN0LmdldElzTGl2ZSgpKSB7XG4gICAgICAgICAgICB2YXIgbm93U2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWUoRGF0ZS5ub3coKSk7XG4gICAgICAgICAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5TnVtYmVyKG5vd1NlZ21lbnQuZ2V0TnVtYmVyKCkgLSAxKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKGN1cnJlbnRUaW1lKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEZpbmQgdGhlIHRydWUgYnVmZmVyIGVkZ2UsIHNpbmNlIHRoZSBNU0UgYnVmZmVyIHRpbWUgcmFuZ2VzIG1pZ2h0IGJlIGZhbHNlbHkgcmVwb3J0aW5nIHRoYXQgdGhlcmUgYXJlXG4gICAgLy8gbXVsdGlwbGUgdGltZSByYW5nZXMgd2hlbiB0aGV5IGFyZSB0ZW1wb3JhbGx5IGFkamFjZW50LlxuICAgIGxlbmd0aCA9IHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QuZ2V0TGVuZ3RoKCk7XG4gICAgaSA9IHRpbWVSYW5nZU9iai5nZXRJbmRleCgpICsgMTtcbiAgICBmb3IgKDtpPGxlbmd0aDtpKyspIHtcbiAgICAgICAgcHJldmlvdXNUaW1lUmFuZ2VPYmogPSB0aW1lUmFuZ2VPYmo7XG4gICAgICAgIHRpbWVSYW5nZU9iaiA9IHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QuZ2V0VGltZVJhbmdlQnlJbmRleChpKTtcbiAgICAgICAgaWYgKCh0aW1lUmFuZ2VPYmouZ2V0U3RhcnQoKSAtIHByZXZpb3VzVGltZVJhbmdlT2JqLmdldEVuZCgpKSA+IDAuMDAzKSB7XG4gICAgICAgICAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShwcmV2aW91c1RpbWVSYW5nZU9iai5nZXRFbmQoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiB3ZSdyZSBoZXJlLCBlaXRoZXIgYSkgdGhlcmUgd2FzIG9ubHkgb25lIHRpbWVSYW5nZSBpbiB0aGUgbGlzdCBvciBiKSBhbGwgb2YgdGhlIHRpbWVSYW5nZXMgaW4gdGhlIGxpc3Qgd2VyZSBhZGphY2VudC5cbiAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZSh0aW1lUmFuZ2VPYmouZ2V0RW5kKCkpO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhVHlwZUxvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgU2VnbWVudExvYWRlciA9IHJlcXVpcmUoJy4vc2VnbWVudHMvU2VnbWVudExvYWRlci5qcycpLFxuICAgIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHJlcXVpcmUoJy4vc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcycpLFxuICAgIE1lZGlhVHlwZUxvYWRlciA9IHJlcXVpcmUoJy4vTWVkaWFUeXBlTG9hZGVyLmpzJyksXG4gICAgc2VsZWN0U2VnbWVudExpc3QgPSByZXF1aXJlKCcuL3NlbGVjdFNlZ21lbnRMaXN0LmpzJyksXG4gICAgbWVkaWFUeXBlcyA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWVkaWFUeXBlcy5qcycpO1xuXG4vLyBUT0RPOiBNaWdyYXRlIG1ldGhvZHMgYmVsb3cgdG8gYSBmYWN0b3J5LlxuZnVuY3Rpb24gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSkge1xuICAgIHZhciBzb3VyY2VCdWZmZXJUeXBlID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkuZ2V0U291cmNlQnVmZmVyVHlwZSgpLFxuICAgICAgICAvLyBUT0RPOiBUcnkvY2F0Y2ggYmxvY2s/XG4gICAgICAgIHNvdXJjZUJ1ZmZlciA9IG1lZGlhU291cmNlLmFkZFNvdXJjZUJ1ZmZlcihzb3VyY2VCdWZmZXJUeXBlKTtcbiAgICByZXR1cm4gbmV3IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJGb3JUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSwgdGVjaCkge1xuICAgIHZhciBzZWdtZW50TG9hZGVyID0gbmV3IFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKTtcbiAgICByZXR1cm4gbmV3IE1lZGlhVHlwZUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSwgdGVjaCk7XG59XG5cbi8qKlxuICpcbiAqIEZhY3Rvcnktc3R5bGUgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgc2V0IG9mIE1lZGlhVHlwZUxvYWRlcnMgYmFzZWQgb24gd2hhdCdzIGRlZmluZWQgaW4gdGhlIG1hbmlmZXN0IGFuZCB3aGF0IG1lZGlhIHR5cGVzIGFyZSBzdXBwb3J0ZWQuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQHJldHVybnMge0FycmF5LjxNZWRpYVR5cGVMb2FkZXI+fSAgICAgICAgICAgICAgIFNldCBvZiBNZWRpYVR5cGVMb2FkZXJzIGZvciBsb2FkaW5nIHNlZ21lbnRzIGZvciBhIGdpdmVuIG1lZGlhIHR5cGUgKGUuZy4gYXVkaW8gb3IgdmlkZW8pXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1lZGlhVHlwZUxvYWRlcnMobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBtYXRjaGVkVHlwZXMgPSBtZWRpYVR5cGVzLmZpbHRlcihmdW5jdGlvbihtZWRpYVR5cGUpIHtcbiAgICAgICAgICAgIHZhciBleGlzdHMgPSBleGlzdHkobWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkpO1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0czsgfSksXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlcnMgPSBtYXRjaGVkVHlwZXMubWFwKGZ1bmN0aW9uKG1lZGlhVHlwZSkgeyByZXR1cm4gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFUeXBlTG9hZGVycztcbn1cblxuLyoqXG4gKlxuICogUGxheWxpc3RMb2FkZXIgaGFuZGxlcyB0aGUgdG9wLWxldmVsIGxvYWRpbmcgYW5kIHBsYXliYWNrIG9mIHNlZ21lbnRzIGZvciBhbGwgbWVkaWEgdHlwZXMgKGUuZy4gYm90aCBhdWRpbyBhbmQgdmlkZW8pLlxuICogVGhpcyBpbmNsdWRlcyBjaGVja2luZyBpZiBpdCBzaG91bGQgc3dpdGNoIHNlZ21lbnQgbGlzdHMsIHVwZGF0aW5nL3JldHJpZXZpbmcgZGF0YSByZWxldmFudCB0byB0aGVzZSBkZWNpc2lvbiBmb3JcbiAqIGVhY2ggbWVkaWEgdHlwZS4gSXQgYWxzbyBpbmNsdWRlcyBjaGFuZ2luZyB0aGUgcGxheWJhY2sgcmF0ZSBvZiB0aGUgdmlkZW8gYmFzZWQgb24gZGF0YSBhdmFpbGFibGUgaW4gdGhlIHNvdXJjZSBidWZmZXIuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgdGhpcy5fX21lZGlhVHlwZUxvYWRlcnMgPSBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpO1xuXG4gICAgdmFyIGk7XG5cbiAgICBmdW5jdGlvbiBraWNrb2ZmTWVkaWFUeXBlTG9hZGVyKG1lZGlhVHlwZUxvYWRlcikge1xuICAgICAgICAvLyBNZWRpYVNldC1zcGVjaWZpYyB2YXJpYWJsZXNcbiAgICAgICAgdmFyIHNlZ21lbnRMb2FkZXIgPSBtZWRpYVR5cGVMb2FkZXIuZ2V0U2VnbWVudExvYWRlcigpLFxuICAgICAgICAgICAgZG93bmxvYWRSYXRlUmF0aW8gPSAxLjAsXG4gICAgICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpLFxuICAgICAgICAgICAgbWVkaWFUeXBlID0gbWVkaWFUeXBlTG9hZGVyLmdldE1lZGlhVHlwZSgpO1xuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgZXZlbnQgdGVsbGluZyB1cyB0byByZWNoZWNrIHdoaWNoIHNlZ21lbnQgbGlzdCB0aGUgc2VnbWVudHMgc2hvdWxkIGJlIGxvYWRlZCBmcm9tLlxuICAgICAgICBtZWRpYVR5cGVMb2FkZXIub24obWVkaWFUeXBlTG9hZGVyLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIG1lZGlhU2V0ID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSksXG4gICAgICAgICAgICAgICAgaXNGdWxsc2NyZWVuID0gdGVjaC5wbGF5ZXIoKS5pc0Z1bGxzY3JlZW4oKSxcbiAgICAgICAgICAgICAgICBkYXRhID0ge30sXG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRTZWdtZW50TGlzdDtcblxuICAgICAgICAgICAgZGF0YS5kb3dubG9hZFJhdGVSYXRpbyA9IGRvd25sb2FkUmF0ZVJhdGlvO1xuICAgICAgICAgICAgZGF0YS5jdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG5cbiAgICAgICAgICAgIC8vIFJhdGhlciB0aGFuIG1vbml0b3JpbmcgZXZlbnRzL3VwZGF0aW5nIHN0YXRlLCBzaW1wbHkgZ2V0IHJlbGV2YW50IHZpZGVvIHZpZXdwb3J0IGRpbXMgb24gdGhlIGZseSBhcyBuZWVkZWQuXG4gICAgICAgICAgICBkYXRhLndpZHRoID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi53aWR0aCA6IHRlY2gucGxheWVyKCkud2lkdGgoKTtcbiAgICAgICAgICAgIGRhdGEuaGVpZ2h0ID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi5oZWlnaHQgOiB0ZWNoLnBsYXllcigpLmhlaWdodCgpO1xuXG4gICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0ID0gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpO1xuXG4gICAgICAgICAgICAvLyBUT0RPOiBTaG91bGQgd2UgcmVmYWN0b3IgdG8gc2V0IGJhc2VkIG9uIHNlZ21lbnRMaXN0IGluc3RlYWQ/XG4gICAgICAgICAgICAvLyAoUG90ZW50aWFsbHkpIHVwZGF0ZSB3aGljaCBzZWdtZW50IGxpc3QgdGhlIHNlZ21lbnRzIHNob3VsZCBiZSBsb2FkZWQgZnJvbSAoYmFzZWQgb24gc2VnbWVudCBsaXN0J3MgYmFuZHdpZHRoL2JpdHJhdGUpXG4gICAgICAgICAgICBzZWdtZW50TG9hZGVyLnNldEN1cnJlbnRCYW5kd2lkdGgoc2VsZWN0ZWRTZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgZG93bmxvYWQgcmF0ZSAocm91bmQgdHJpcCB0aW1lIHRvIGRvd25sb2FkIGEgc2VnbWVudCBvZiBhIGdpdmVuIGF2ZXJhZ2UgYmFuZHdpZHRoL2JpdHJhdGUpIHRvIHVzZVxuICAgICAgICAvLyB3aXRoIGNob29zaW5nIHdoaWNoIHN0cmVhbSB2YXJpYW50IHRvIGxvYWQgc2VnbWVudHMgZnJvbS5cbiAgICAgICAgc2VnbWVudExvYWRlci5vbihzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGRvd25sb2FkUmF0ZVJhdGlvID0gZXZlbnQuZGF0YS5wbGF5YmFja1RpbWUgLyBldmVudC5kYXRhLnJ0dDtcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGV2ZW50LmRhdGEuYmFuZHdpZHRoO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBLaWNrb2ZmIHNlZ21lbnQgbG9hZGluZyBmb3IgdGhlIG1lZGlhIHR5cGUuXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlci5zdGFydExvYWRpbmdTZWdtZW50cygpO1xuICAgIH1cblxuICAgIC8vIEZvciBlYWNoIG9mIHRoZSBtZWRpYSB0eXBlcyAoZS5nLiAnYXVkaW8nICYgJ3ZpZGVvJykgaW4gdGhlIEFCUiBtYW5pZmVzdC4uLlxuICAgIGZvciAoaT0wOyBpPHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGtpY2tvZmZNZWRpYVR5cGVMb2FkZXIodGhpcy5fX21lZGlhVHlwZUxvYWRlcnNbaV0pO1xuICAgIH1cblxuICAgIC8vIE5PVEU6IFRoaXMgY29kZSBibG9jayBoYW5kbGVzIHBzZXVkby0ncGF1c2luZycvJ3VucGF1c2luZycgKGNoYW5naW5nIHRoZSBwbGF5YmFja1JhdGUpIGJhc2VkIG9uIHdoZXRoZXIgb3Igbm90XG4gICAgLy8gdGhlcmUgaXMgZGF0YSBhdmFpbGFibGUgaW4gdGhlIGJ1ZmZlciwgYnV0IGluZGlyZWN0bHksIGJ5IGxpc3RlbmluZyB0byBhIGZldyBldmVudHMgYW5kIHVzaW5nIHRoZSB2aWRlbyBlbGVtZW50J3NcbiAgICAvLyByZWFkeSBzdGF0ZS5cbiAgICB2YXIgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzID0gWydzZWVraW5nJywgJ2NhbnBsYXknLCAnY2FucGxheXRocm91Z2gnXSxcbiAgICAgICAgZXZlbnRUeXBlO1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzSGFuZGxlcihldmVudCkge1xuICAgICAgICB2YXIgcmVhZHlTdGF0ZSA9IHRlY2guZWwoKS5yZWFkeVN0YXRlLFxuICAgICAgICAgICAgcGxheWJhY2tSYXRlID0gKHJlYWR5U3RhdGUgPT09IDQpID8gMSA6IDA7XG4gICAgICAgIGNvbnNvbGUubG9nKCdJbiBQbGF5bGlzdExvYWRlciBQbGF5YmFjayBSYXRlIEhhbmRsZXJcXG5cXG4nKTtcbiAgICAgICAgY29uc29sZS5sb2coJ3BsYXliYWNrUmF0ZTogJyArIHBsYXliYWNrUmF0ZSArICcsIHJlYWR5U3RhdGU6ICcgKyByZWFkeVN0YXRlKTtcbiAgICAgICAgdGVjaC5zZXRQbGF5YmFja1JhdGUocGxheWJhY2tSYXRlKTtcbiAgICB9XG5cbiAgICBmb3IoaT0wOyBpPGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBldmVudFR5cGUgPSBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHNbaV07XG4gICAgICAgIHRlY2gub24oZXZlbnRUeXBlLCBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHNIYW5kbGVyKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUGxheWxpc3RMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgTWVkaWFTb3VyY2UgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JykuTWVkaWFTb3VyY2UsXG4gICAgTWFuaWZlc3RDb250cm9sbGVyID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMnKSxcbiAgICBQbGF5bGlzdExvYWRlciA9IHJlcXVpcmUoJy4vUGxheWxpc3RMb2FkZXIuanMnKTtcblxuLy8gVE9ETzogRElTUE9TRSBNRVRIT0Rcbi8qKlxuICpcbiAqIENsYXNzIHRoYXQgZGVmaW5lcyB0aGUgcm9vdCBjb250ZXh0IGZvciBoYW5kbGluZyBhIHNwZWNpZmljIE1QRUctREFTSCBtZWRpYSBzb3VyY2UuXG4gKlxuICogQHBhcmFtIHNvdXJjZSAgICB2aWRlby5qcyBzb3VyY2Ugb2JqZWN0IHByb3ZpZGluZyBpbmZvcm1hdGlvbiBhYm91dCB0aGUgc291cmNlLCBzdWNoIGFzIHRoZSB1cmkgKHNyYykgYW5kIHRoZSB0eXBlICh0eXBlKVxuICogQHBhcmFtIHRlY2ggICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBwcm92aWRpbmcgdGhlIHBvaW50IG9mIGludGVyYWN0aW9uIGJldHdlZW4gdGhlIFNvdXJjZUhhbmRsZXIgaW5zdGFuY2UgYW5kXG4gKiAgICAgICAgICAgICAgICAgIHRoZSB2aWRlby5qcyBsaWJyYXJ5IChpbmNsdWRpbmcgZS5nLiB0aGUgdmlkZW8gZWxlbWVudClcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWFuaWZlc3RDb250cm9sbGVyID0gbmV3IE1hbmlmZXN0Q29udHJvbGxlcihzb3VyY2Uuc3JjLCBmYWxzZSk7XG5cbiAgICBtYW5pZmVzdENvbnRyb2xsZXIub25lKG1hbmlmZXN0Q29udHJvbGxlci5ldmVudExpc3QuTUFOSUZFU1RfTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICB2YXIgbWVkaWFTb3VyY2UgPSBuZXcgTWVkaWFTb3VyY2UoKSxcbiAgICAgICAgICAgIG9wZW5MaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAgICAgbWVkaWFTb3VyY2UucmVtb3ZlRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19wbGF5bGlzdExvYWRlciA9IG5ldyBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuXG4gICAgICAgIC8vIFRPRE86IEhhbmRsZSBjbG9zZS5cbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCd3ZWJraXRzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuICAgICAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG5cbiAgICAgICAgdGVjaC5zZXRTcmMoVVJMLmNyZWF0ZU9iamVjdFVSTChtZWRpYVNvdXJjZSkpO1xuICAgIH0pO1xuXG4gICAgbWFuaWZlc3RDb250cm9sbGVyLmxvYWQoKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VIYW5kbGVyO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgdXRpbCA9IHJlcXVpcmUoJy4vdXRpbC5qcycpLFxuICAgIGlzQXJyYXkgPSByZXF1aXJlKCcuLi8uLi91dGlsL2lzQXJyYXkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuLi8uLi91dGlsL2lzU3RyaW5nLmpzJyksXG4gICAgcGFyc2VSb290VXJsID0gdXRpbC5wYXJzZVJvb3RVcmwsXG4gICAgY3JlYXRlTXBkT2JqZWN0LFxuICAgIGNyZWF0ZVBlcmlvZE9iamVjdCxcbiAgICBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0LFxuICAgIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0LFxuICAgIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSxcbiAgICBnZXRNcGQsXG4gICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSxcbiAgICBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLFxuICAgIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lO1xuXG4vLyBUT0RPOiBTaG91bGQgdGhpcyBleGlzdCBvbiBtcGQgZGF0YXZpZXcgb3IgYXQgYSBoaWdoZXIgbGV2ZWw/XG4vLyBUT0RPOiBSZWZhY3Rvci4gQ291bGQgYmUgbW9yZSBlZmZpY2llbnQgKFJlY3Vyc2l2ZSBmbj8gVXNlIGVsZW1lbnQuZ2V0RWxlbWVudHNCeU5hbWUoJ0Jhc2VVcmwnKVswXT8pLlxuLy8gVE9ETzogQ3VycmVudGx5IGFzc3VtaW5nICpFSVRIRVIqIDxCYXNlVVJMPiBub2RlcyB3aWxsIHByb3ZpZGUgYW4gYWJzb2x1dGUgYmFzZSB1cmwgKGllIHJlc29sdmUgdG8gJ2h0dHA6Ly8nIGV0Yylcbi8vIFRPRE86ICpPUiogd2Ugc2hvdWxkIHVzZSB0aGUgYmFzZSB1cmwgb2YgdGhlIGhvc3Qgb2YgdGhlIE1QRCBtYW5pZmVzdC5cbnZhciBidWlsZEJhc2VVcmwgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgdmFyIGVsZW1IaWVyYXJjaHkgPSBbeG1sTm9kZV0uY29uY2F0KHhtbGZ1bi5nZXRBbmNlc3RvcnMoeG1sTm9kZSkpLFxuICAgICAgICBmb3VuZExvY2FsQmFzZVVybCA9IGZhbHNlO1xuICAgIHZhciBiYXNlVXJscyA9IGVsZW1IaWVyYXJjaHkubWFwKGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKGZvdW5kTG9jYWxCYXNlVXJsKSB7IHJldHVybiAnJzsgfVxuICAgICAgICBpZiAoIWVsZW0uaGFzQ2hpbGROb2RlcygpKSB7IHJldHVybiAnJzsgfVxuICAgICAgICB2YXIgY2hpbGQ7XG4gICAgICAgIGZvciAodmFyIGk9MDsgaTxlbGVtLmNoaWxkTm9kZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNoaWxkID0gZWxlbS5jaGlsZE5vZGVzLml0ZW0oaSk7XG4gICAgICAgICAgICBpZiAoY2hpbGQubm9kZU5hbWUgPT09ICdCYXNlVVJMJykge1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0RWxlbSA9IGNoaWxkLmNoaWxkTm9kZXMuaXRlbSgwKTtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dFZhbHVlID0gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgICAgICBpZiAodGV4dFZhbHVlLmluZGV4T2YoJ2h0dHA6Ly8nKSA9PT0gMCkgeyBmb3VuZExvY2FsQmFzZVVybCA9IHRydWU7IH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAnJztcbiAgICB9KTtcblxuICAgIHZhciBiYXNlVXJsID0gYmFzZVVybHMucmV2ZXJzZSgpLmpvaW4oJycpO1xuICAgIGlmICghYmFzZVVybCkgeyByZXR1cm4gcGFyc2VSb290VXJsKHhtbE5vZGUuYmFzZVVSSSk7IH1cbiAgICByZXR1cm4gYmFzZVVybDtcbn07XG5cbnZhciBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzID0gW1xuICAgICdBZGFwdGF0aW9uU2V0JyxcbiAgICAnUmVwcmVzZW50YXRpb24nLFxuICAgICdTdWJSZXByZXNlbnRhdGlvbidcbl07XG5cbnZhciBoYXNDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzLmluZGV4T2YoZWxlbS5ub2RlTmFtZSkgPj0gMDtcbn07XG5cbnZhciBkb2VzbnRIYXZlQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gIWhhc0NvbW1vblByb3BlcnRpZXMoZWxlbSk7XG59O1xuXG4vLyBDb21tb24gQXR0cnNcbnZhciBnZXRXaWR0aCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnd2lkdGgnKSxcbiAgICBnZXRIZWlnaHQgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2hlaWdodCcpLFxuICAgIGdldEZyYW1lUmF0ZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnZnJhbWVSYXRlJyksXG4gICAgZ2V0TWltZVR5cGUgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ21pbWVUeXBlJyksXG4gICAgZ2V0Q29kZWNzID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdjb2RlY3MnKTtcblxudmFyIGdldFNlZ21lbnRUZW1wbGF0ZVhtbExpc3QgPSB4bWxmdW4uZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0KCdTZWdtZW50VGVtcGxhdGUnKTtcblxuLy8gTVBEIEF0dHIgZm5zXG52YXIgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24nKSxcbiAgICBnZXRUeXBlID0geG1sZnVuLmdldEF0dHJGbigndHlwZScpLFxuICAgIGdldE1pbmltdW1VcGRhdGVQZXJpb2QgPSB4bWxmdW4uZ2V0QXR0ckZuKCdtaW5pbXVtVXBkYXRlUGVyaW9kJyksXG4gICAgZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lID0geG1sZnVuLmdldEF0dHJGbignYXZhaWxhYmlsaXR5U3RhcnRUaW1lJyksXG4gICAgZ2V0U3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXkgPSB4bWxmdW4uZ2V0QXR0ckZuKCdzdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheScpLFxuICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoID0geG1sZnVuLmdldEF0dHJGbigndGltZVNoaWZ0QnVmZmVyRGVwdGgnKTtcblxuLy8gUmVwcmVzZW50YXRpb24gQXR0ciBmbnNcbnZhciBnZXRJZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2lkJyksXG4gICAgZ2V0QmFuZHdpZHRoID0geG1sZnVuLmdldEF0dHJGbignYmFuZHdpZHRoJyk7XG5cbi8vIFNlZ21lbnRUZW1wbGF0ZSBBdHRyIGZuc1xudmFyIGdldEluaXRpYWxpemF0aW9uID0geG1sZnVuLmdldEF0dHJGbignaW5pdGlhbGl6YXRpb24nKSxcbiAgICBnZXRNZWRpYSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhJyksXG4gICAgZ2V0RHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdkdXJhdGlvbicpLFxuICAgIGdldFRpbWVzY2FsZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVzY2FsZScpLFxuICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdwcmVzZW50YXRpb25UaW1lT2Zmc2V0JyksXG4gICAgZ2V0U3RhcnROdW1iZXIgPSB4bWxmdW4uZ2V0QXR0ckZuKCdzdGFydE51bWJlcicpO1xuXG4vLyBUT0RPOiBSZXBlYXQgY29kZS4gQWJzdHJhY3QgYXdheSAoUHJvdG90eXBhbCBJbmhlcml0YW5jZS9PTyBNb2RlbD8gT2JqZWN0IGNvbXBvc2VyIGZuPylcbmNyZWF0ZU1wZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UGVyaW9kczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbmltdW1VcGRhdGVQZXJpb2QsIHhtbE5vZGUpLFxuICAgICAgICBnZXRBdmFpbGFiaWxpdHlTdGFydFRpbWU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdmFpbGFiaWxpdHlTdGFydFRpbWUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRTdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFN1Z2dlc3RlZFByZXNlbnRhdGlvbkRlbGF5LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlUGVyaW9kT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0czogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGU6IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgICAgIHJldHVybiBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlKHR5cGUsIHhtbE5vZGUpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClcbiAgICB9O1xufTtcblxuY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UmVwcmVzZW50YXRpb25zOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ1JlcHJlc2VudGF0aW9uJywgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QpLFxuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWxMaXN0KHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWxMaXN0KHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SWQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJZCwgeG1sTm9kZSksXG4gICAgICAgIGdldFdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0V2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRGcmFtZVJhdGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRGcmFtZVJhdGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRDb2RlY3M6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRDb2RlY3MsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYXNlVXJsOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oYnVpbGRCYXNlVXJsLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWltZVR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW1lVHlwZSwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudFRlbXBsYXRlID0gZnVuY3Rpb24oeG1sQXJyYXkpIHtcbiAgICAvLyBFZmZlY3RpdmVseSBhIGZpbmQgZnVuY3Rpb24gKyBhIG1hcCBmdW5jdGlvbi5cbiAgICBmdW5jdGlvbiBnZXRBdHRyRnJvbVhtbEFycmF5KGF0dHJHZXR0ZXJGbiwgeG1sQXJyYXkpIHtcbiAgICAgICAgaWYgKCFpc0FycmF5KHhtbEFycmF5KSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmICghaXNGdW5jdGlvbihhdHRyR2V0dGVyRm4pKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cblxuICAgICAgICB2YXIgaSxcbiAgICAgICAgICAgIGxlbmd0aCA9IHhtbEFycmF5Lmxlbmd0aCxcbiAgICAgICAgICAgIGN1cnJlbnRBdHRyVmFsdWU7XG5cbiAgICAgICAgZm9yIChpPTA7IGk8eG1sQXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnJlbnRBdHRyVmFsdWUgPSBhdHRyR2V0dGVyRm4oeG1sQXJyYXlbaV0pO1xuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGN1cnJlbnRBdHRyVmFsdWUpICYmIGN1cnJlbnRBdHRyVmFsdWUgIT09ICcnKSB7IHJldHVybiBjdXJyZW50QXR0clZhbHVlOyB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sQXJyYXksXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxBcnJheVswXSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbEFycmF5WzBdLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbEFycmF5WzBdLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SW5pdGlhbGl6YXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRJbml0aWFsaXphdGlvbiwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRNZWRpYTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldE1lZGlhLCB4bWxBcnJheSksXG4gICAgICAgIGdldER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0RHVyYXRpb24sIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0VGltZXNjYWxlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0VGltZXNjYWxlLCB4bWxBcnJheSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxBcnJheSksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0U3RhcnROdW1iZXIsIHhtbEFycmF5KVxuICAgIH07XG59O1xuXG4vLyBUT0RPOiBDaGFuZ2UgdGhpcyBhcGkgdG8gcmV0dXJuIGEgbGlzdCBvZiBhbGwgbWF0Y2hpbmcgYWRhcHRhdGlvbiBzZXRzIHRvIGFsbG93IGZvciBncmVhdGVyIGZsZXhpYmlsaXR5LlxuZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSA9IGZ1bmN0aW9uKHR5cGUsIHBlcmlvZFhtbCkge1xuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IHBlcmlvZFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnQWRhcHRhdGlvblNldCcpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0LFxuICAgICAgICByZXByZXNlbnRhdGlvbixcbiAgICAgICAgbWltZVR5cGU7XG5cbiAgICBmb3IgKHZhciBpPTA7IGk8YWRhcHRhdGlvblNldHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgYWRhcHRhdGlvblNldCA9IGFkYXB0YXRpb25TZXRzLml0ZW0oaSk7XG4gICAgICAgIC8vIFNpbmNlIHRoZSBtaW1lVHlwZSBjYW4gYmUgZGVmaW5lZCBvbiB0aGUgQWRhcHRhdGlvblNldCBvciBvbiBpdHMgUmVwcmVzZW50YXRpb24gY2hpbGQgbm9kZXMsXG4gICAgICAgIC8vIGNoZWNrIGZvciBtaW1ldHlwZSBvbiBvbmUgb2YgaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkcmVuIHVzaW5nIGdldE1pbWVUeXBlKCksIHdoaWNoIGFzc3VtZXMgdGhlXG4gICAgICAgIC8vIG1pbWVUeXBlIGNhbiBiZSBpbmhlcml0ZWQgYW5kIHdpbGwgY2hlY2sgaXRzZWxmIGFuZCBpdHMgYW5jZXN0b3JzIGZvciB0aGUgYXR0ci5cbiAgICAgICAgcmVwcmVzZW50YXRpb24gPSBhZGFwdGF0aW9uU2V0LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdSZXByZXNlbnRhdGlvbicpWzBdO1xuICAgICAgICAvLyBOZWVkIHRvIGNoZWNrIHRoZSByZXByZXNlbnRhdGlvbiBpbnN0ZWFkIG9mIHRoZSBhZGFwdGF0aW9uIHNldCwgc2luY2UgdGhlIG1pbWVUeXBlIG1heSBub3QgYmUgc3BlY2lmaWVkXG4gICAgICAgIC8vIG9uIHRoZSBhZGFwdGF0aW9uIHNldCBhdCBhbGwgYW5kIG1heSBiZSBzcGVjaWZpZWQgZm9yIGVhY2ggb2YgdGhlIHJlcHJlc2VudGF0aW9ucyBpbnN0ZWFkLlxuICAgICAgICBtaW1lVHlwZSA9IGdldE1pbWVUeXBlKHJlcHJlc2VudGF0aW9uKTtcbiAgICAgICAgaWYgKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKSB7IHJldHVybiBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KGFkYXB0YXRpb25TZXQpOyB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG5nZXRNcGQgPSBmdW5jdGlvbihtYW5pZmVzdFhtbCkge1xuICAgIHJldHVybiBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lKG1hbmlmZXN0WG1sLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KVswXTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8geG1sZnVuIG9yIG93biBtb2R1bGUuXG5nZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lID0gZnVuY3Rpb24ocGFyZW50WG1sLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIHZhciBkZXNjZW5kYW50c1htbEFycmF5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwocGFyZW50WG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKHRhZ05hbWUpKTtcbiAgICAvKmlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHsgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTsgfSovXG4gICAgaWYgKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB2YXIgbWFwcGVkRWxlbSA9IGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTtcbiAgICAgICAgcmV0dXJuICBtYXBwZWRFbGVtO1xuICAgIH1cbiAgICByZXR1cm4gZGVzY2VuZGFudHNYbWxBcnJheTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8geG1sZnVuIG9yIG93biBtb2R1bGUuXG5nZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSA9IGZ1bmN0aW9uIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUsIHRhZ05hbWUsIG1hcEZuKSB7XG4gICAgaWYgKCF0YWdOYW1lIHx8ICF4bWxOb2RlIHx8ICF4bWxOb2RlLnBhcmVudE5vZGUpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBpZiAoIXhtbE5vZGUucGFyZW50Tm9kZS5ub2RlTmFtZSkgeyByZXR1cm4gbnVsbDsgfVxuXG4gICAgaWYgKHhtbE5vZGUucGFyZW50Tm9kZS5ub2RlTmFtZSA9PT0gdGFnTmFtZSkge1xuICAgICAgICByZXR1cm4gaXNGdW5jdGlvbihtYXBGbikgPyBtYXBGbih4bWxOb2RlLnBhcmVudE5vZGUpIDogeG1sTm9kZS5wYXJlbnROb2RlO1xuICAgIH1cbiAgICByZXR1cm4gZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUoeG1sTm9kZS5wYXJlbnROb2RlLCB0YWdOYW1lLCBtYXBGbik7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdldE1wZDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwsXG4gICAgLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgcGFyc2VEYXRlVGltZSxcbiAgICBTRUNPTkRTX0lOX1lFQVIgPSAzNjUgKiAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NT05USCA9IDMwICogMjQgKiA2MCAqIDYwLCAvLyBub3QgcHJlY2lzZSFcbiAgICBTRUNPTkRTX0lOX0RBWSA9IDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX0hPVVIgPSA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTUlOID0gNjAsXG4gICAgTUlOVVRFU19JTl9IT1VSID0gNjAsXG4gICAgTUlMTElTRUNPTkRTX0lOX1NFQ09ORFMgPSAxMDAwLFxuICAgIGR1cmF0aW9uUmVnZXggPSAvXlAoKFtcXGQuXSopWSk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilEKT9UPygoW1xcZC5dKilIKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKVMpPy8sXG4gICAgZGF0ZVRpbWVSZWdleCA9IC9eKFswLTldezR9KS0oWzAtOV17Mn0pLShbMC05XXsyfSlUKFswLTldezJ9KTooWzAtOV17Mn0pKD86OihbMC05XSopKFxcLlswLTldKik/KT8oPzooWystXSkoWzAtOV17Mn0pKFswLTldezJ9KSk/LztcblxucGFyc2VSb290VXJsID0gZnVuY3Rpb24odXJsKSB7XG4gICAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJy8nKSA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignPycpICE9PSAtMSkge1xuICAgICAgICB1cmwgPSB1cmwuc3Vic3RyaW5nKDAsIHVybC5pbmRleE9mKCc/JykpO1xuICAgIH1cblxuICAgIHJldHVybiB1cmwuc3Vic3RyaW5nKDAsIHVybC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59O1xuXG4vLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZnVuY3Rpb24gKHN0cikge1xuICAgIC8vc3RyID0gXCJQMTBZMTBNMTBEVDEwSDEwTTEwLjFTXCI7XG4gICAgaWYgKCFzdHIpIHsgcmV0dXJuIE51bWJlci5OYU47IH1cbiAgICB2YXIgbWF0Y2ggPSBkdXJhdGlvblJlZ2V4LmV4ZWMoc3RyKTtcbiAgICBpZiAoIW1hdGNoKSB7IHJldHVybiBOdW1iZXIuTmFOOyB9XG4gICAgcmV0dXJuIChwYXJzZUZsb2F0KG1hdGNoWzJdIHx8IDApICogU0VDT05EU19JTl9ZRUFSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs0XSB8fCAwKSAqIFNFQ09ORFNfSU5fTU9OVEggK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzZdIHx8IDApICogU0VDT05EU19JTl9EQVkgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzhdIHx8IDApICogU0VDT05EU19JTl9IT1VSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMF0gfHwgMCkgKiBTRUNPTkRTX0lOX01JTiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTJdIHx8IDApKTtcbn07XG5cbi8qKlxuICogUGFyc2VyIGZvciBmb3JtYXR0ZWQgZGF0ZXRpbWUgc3RyaW5ncyBjb25mb3JtaW5nIHRvIHRoZSBJU08gODYwMSBzdGFuZGFyZC5cbiAqIEdlbmVyYWwgRm9ybWF0OiAgWVlZWS1NTS1ERFRISDpNTTpTU1ogKFVUQykgb3IgWVlZWS1NTS1ERFRISDpNTTpTUytISDpNTSAodGltZSB6b25lIGxvY2FsaXphdGlvbilcbiAqIEV4IFN0cmluZzogICAgICAgMjAxNC0xMi0xN1QxNDowOTo1OFogKFVUQykgb3IgMjAxNC0xMi0xN1QxNDoxNTo1OCswNjowMCAodGltZSB6b25lIGxvY2FsaXphdGlvbikgLyAyMDE0LTEyLTE3VDE0OjAzOjU4LTA2OjAwICh0aW1lIHpvbmUgbG9jYWxpemF0aW9uKVxuICpcbiAqIEBwYXJhbSBzdHIge3N0cmluZ30gIElTTyA4NjAxLWNvbXBsaWFudCBkYXRldGltZSBzdHJpbmcuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSBVVEMgVW5peCB0aW1lLlxuICovXG5wYXJzZURhdGVUaW1lID0gZnVuY3Rpb24oc3RyKSB7XG4gICAgdmFyIG1hdGNoID0gZGF0ZVRpbWVSZWdleC5leGVjKHN0ciksXG4gICAgICAgIHV0Y0RhdGU7XG5cbiAgICAvLyBJZiB0aGUgc3RyaW5nIGRvZXMgbm90IGNvbnRhaW4gYSB0aW1lem9uZSBvZmZzZXQgZGlmZmVyZW50IGJyb3dzZXJzIGNhbiBpbnRlcnByZXQgaXQgZWl0aGVyXG4gICAgLy8gYXMgVVRDIG9yIGFzIGEgbG9jYWwgdGltZSBzbyB3ZSBoYXZlIHRvIHBhcnNlIHRoZSBzdHJpbmcgbWFudWFsbHkgdG8gbm9ybWFsaXplIHRoZSBnaXZlbiBkYXRlIHZhbHVlIGZvclxuICAgIC8vIGFsbCBicm93c2Vyc1xuICAgIHV0Y0RhdGUgPSBEYXRlLlVUQyhcbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbMV0sIDEwKSxcbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbMl0sIDEwKS0xLCAvLyBtb250aHMgc3RhcnQgZnJvbSB6ZXJvXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzNdLCAxMCksXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzRdLCAxMCksXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzVdLCAxMCksXG4gICAgICAgIChtYXRjaFs2XSAmJiBwYXJzZUludChtYXRjaFs2XSwgMTApIHx8IDApLFxuICAgICAgICAobWF0Y2hbN10gJiYgcGFyc2VGbG9hdChtYXRjaFs3XSkgKiBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUykgfHwgMCk7XG4gICAgLy8gSWYgdGhlIGRhdGUgaGFzIHRpbWV6b25lIG9mZnNldCB0YWtlIGl0IGludG8gYWNjb3VudCBhcyB3ZWxsXG4gICAgaWYgKG1hdGNoWzldICYmIG1hdGNoWzEwXSkge1xuICAgICAgICB2YXIgdGltZXpvbmVPZmZzZXQgPSBwYXJzZUludChtYXRjaFs5XSwgMTApICogTUlOVVRFU19JTl9IT1VSICsgcGFyc2VJbnQobWF0Y2hbMTBdLCAxMCk7XG4gICAgICAgIHV0Y0RhdGUgKz0gKG1hdGNoWzhdID09PSAnKycgPyAtMSA6ICsxKSAqIHRpbWV6b25lT2Zmc2V0ICogU0VDT05EU19JTl9NSU4gKiBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUztcbiAgICB9XG5cbiAgICByZXR1cm4gdXRjRGF0ZTtcbn07XG5cbnZhciB1dGlsID0ge1xuICAgIHBhcnNlUm9vdFVybDogcGFyc2VSb290VXJsLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHBhcnNlRGF0ZVRpbWU6IHBhcnNlRGF0ZVRpbWVcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gdXRpbDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi8uLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcXVpcmUoJy4uL21wZC91dGlsLmpzJykucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHBhcnNlRGF0ZVRpbWUgPSByZXF1aXJlKCcuLi9tcGQvdXRpbC5qcycpLnBhcnNlRGF0ZVRpbWUsXG4gICAgc2VnbWVudFRlbXBsYXRlID0gcmVxdWlyZSgnLi9zZWdtZW50VGVtcGxhdGUnKSxcbiAgICBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSxcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSxcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlVVENXYWxsQ2xvY2tUaW1lLFxuICAgIGdldFR5cGUsXG4gICAgZ2V0SXNMaXZlLFxuICAgIGdldEJhbmR3aWR0aCxcbiAgICBnZXRXaWR0aCxcbiAgICBnZXRIZWlnaHQsXG4gICAgZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUsXG4gICAgZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGgsXG4gICAgZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLFxuICAgIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLFxuICAgIGdldEVuZE51bWJlckZyb21UZW1wbGF0ZTtcblxuXG4vKipcbiAqXG4gKiBGdW5jdGlvbiB1c2VkIHRvIGdldCB0aGUgJ3R5cGUnIG9mIGEgREFTSCBSZXByZXNlbnRhdGlvbiBpbiBhIGZvcm1hdCBleHBlY3RlZCBieSB0aGUgTVNFIFNvdXJjZUJ1ZmZlci4gVXNlZCB0b1xuICogY3JlYXRlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZXMgdGhhdCBjb3JyZXNwb25kIHRvIGEgZ2l2ZW4gTWVkaWFTZXQgKGUuZy4gc2V0IG9mIGF1ZGlvIHN0cmVhbSB2YXJpYW50cywgdmlkZW8gc3RyZWFtXG4gKiB2YXJpYW50cywgZXRjLikuXG4gKlxuICogQHBhcmFtIHJlcHJlc2VudGF0aW9uICAgIFBPSk8gREFTSCBNUEQgUmVwcmVzZW50YXRpb25cbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgICAgICBUaGUgUmVwcmVzZW50YXRpb24ncyAndHlwZScgaW4gYSBmb3JtYXQgZXhwZWN0ZWQgYnkgdGhlIE1TRSBTb3VyY2VCdWZmZXJcbiAqL1xuZ2V0VHlwZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59O1xuXG5nZXRJc0xpdmUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiAocmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0VHlwZSgpID09PSAnZHluYW1pYycpO1xufTtcblxuZ2V0QmFuZHdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgYmFuZHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCk7XG4gICAgcmV0dXJuIGV4aXN0eShiYW5kd2lkdGgpID8gTnVtYmVyKGJhbmR3aWR0aCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRXaWR0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0V2lkdGgoKTtcbiAgICByZXR1cm4gZXhpc3R5KHdpZHRoKSA/IE51bWJlcih3aWR0aCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRIZWlnaHQgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBoZWlnaHQgPSByZXByZXNlbnRhdGlvbi5nZXRIZWlnaHQoKTtcbiAgICByZXR1cm4gZXhpc3R5KGhlaWdodCkgPyBOdW1iZXIoaGVpZ2h0KSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgcGVyaW9kLXJlbGF0aXZlIHByZXNlbnRhdGlvbiB0aW1lXG4gICAgdmFyIG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKCksXG4gICAgICAgIHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBleGlzdHkobWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikgPyBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24obWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikgOiBOdW1iZXIuTmFOLFxuICAgICAgICBwcmVzZW50YXRpb25UaW1lT2Zmc2V0ID0gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQoKSkgfHwgMDtcbiAgICByZXR1cm4gZXhpc3R5KHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pID8gTnVtYmVyKHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gLSBwcmVzZW50YXRpb25UaW1lT2Zmc2V0KSA6IE51bWJlci5OYU47XG59O1xuXG5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciB3YWxsQ2xvY2tUaW1lU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lKCksXG4gICAgICAgIHdhbGxDbG9ja1VuaXhUaW1lVXRjID0gcGFyc2VEYXRlVGltZSh3YWxsQ2xvY2tUaW1lU3RyKTtcbiAgICByZXR1cm4gd2FsbENsb2NrVW5peFRpbWVVdGM7XG59O1xuXG5nZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHRpbWVTaGlmdEJ1ZmZlckRlcHRoU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGgoKSxcbiAgICAgICAgcGFyc2VkVGltZVNoaWZ0QnVmZmVyRGVwdGggPSBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24odGltZVNoaWZ0QnVmZmVyRGVwdGhTdHIpO1xuICAgIHJldHVybiBwYXJzZWRUaW1lU2hpZnRCdWZmZXJEZXB0aDtcbn07XG5cbmdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpO1xuICAgIHJldHVybiBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldER1cmF0aW9uKCkpIC8gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXRUaW1lc2NhbGUoKSk7XG59O1xuXG5nZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE1hdGguY2VpbChnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAvIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xufTtcblxuZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0U3RhcnROdW1iZXIoKSk7XG59O1xuXG5nZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgKyBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLSAxO1xufTtcblxuY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldElzTGl2ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElzTGl2ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0SGVpZ2h0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SGVpZ2h0LCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0V2lkdGgsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxEdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0U2VnbWVudER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsU2VnbWVudENvdW50OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRFbmROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgLy8gVE9ETzogRXh0ZXJuYWxpemVcbiAgICAgICAgZ2V0SW5pdGlhbGl6YXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGluaXRpYWxpemF0aW9uID0ge307XG4gICAgICAgICAgICBpbml0aWFsaXphdGlvbi5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgICAgICAgICAgcmVwcmVzZW50YXRpb25JZCA9IHJlcHJlc2VudGF0aW9uLmdldElkKCksXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldEluaXRpYWxpemF0aW9uKCksXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbklkKTtcblxuICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUoaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCwgJ0JhbmR3aWR0aCcsIHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYmFzZVVybCArIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmw7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgcmV0dXJuIGluaXRpYWxpemF0aW9uO1xuICAgICAgICB9LFxuICAgICAgICBnZXRTZWdtZW50QnlOdW1iZXI6IGZ1bmN0aW9uKG51bWJlcikgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpOyB9LFxuICAgICAgICBnZXRTZWdtZW50QnlUaW1lOiBmdW5jdGlvbihzZWNvbmRzKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKTsgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5VVRDV2FsbENsb2NrVGltZTogZnVuY3Rpb24odXRjTWlsbGlzZWNvbmRzKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlVVENXYWxsQ2xvY2tUaW1lKHJlcHJlc2VudGF0aW9uLCB1dGNNaWxsaXNlY29uZHMpOyB9XG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlciA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpIHtcbiAgICB2YXIgc2VnbWVudCA9IHt9O1xuICAgIHNlZ21lbnQuZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRNZWRpYSgpLFxuICAgICAgICAgICAgcmVwbGFjZWRJZFVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24uZ2V0SWQoKSksXG4gICAgICAgICAgICByZXBsYWNlZFRva2Vuc1VybDtcbiAgICAgICAgICAgIC8vIFRPRE86IFNpbmNlICRUaW1lJC10ZW1wbGF0ZWQgc2VnbWVudCBVUkxzIHNob3VsZCBvbmx5IGV4aXN0IGluIGNvbmp1bmN0aW9uIHcvYSA8U2VnbWVudFRpbWVsaW5lPixcbiAgICAgICAgICAgIC8vIFRPRE86IGNhbiBjdXJyZW50bHkgYXNzdW1lIGEgJE51bWJlciQtYmFzZWQgdGVtcGxhdGVkIHVybC5cbiAgICAgICAgICAgIC8vIFRPRE86IEVuZm9yY2UgbWluL21heCBudW1iZXIgcmFuZ2UgKGJhc2VkIG9uIHNlZ21lbnRMaXN0IHN0YXJ0TnVtYmVyICYgZW5kTnVtYmVyKVxuICAgICAgICByZXBsYWNlZFRva2Vuc1VybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShyZXBsYWNlZElkVXJsLCAnTnVtYmVyJywgbnVtYmVyKTtcbiAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRUb2tlbnNVcmwsICdCYW5kd2lkdGgnLCByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG5cbiAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyByZXBsYWNlZFRva2Vuc1VybDtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0U3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiAobnVtYmVyIC0gZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKSAqIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSArIE1hdGgucm91bmQoKChudW1iZXIgLSBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSkgKiAxMDAwKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0RHVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVE9ETzogVmVyaWZ5XG4gICAgICAgIHZhciBzdGFuZGFyZFNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIG1lZGlhUHJlc2VudGF0aW9uVGltZSxcbiAgICAgICAgICAgIHByZWNpc2lvbk11bHRpcGxpZXI7XG5cbiAgICAgICAgaWYgKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgPT09IG51bWJlcikge1xuICAgICAgICAgICAgbWVkaWFQcmVzZW50YXRpb25UaW1lID0gTnVtYmVyKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKTtcbiAgICAgICAgICAgIC8vIEhhbmRsZSBmbG9hdGluZyBwb2ludCBwcmVjaXNpb24gaXNzdWVcbiAgICAgICAgICAgIHByZWNpc2lvbk11bHRpcGxpZXIgPSAxMDAwO1xuICAgICAgICAgICAgZHVyYXRpb24gPSAoKChtZWRpYVByZXNlbnRhdGlvblRpbWUgKiBwcmVjaXNpb25NdWx0aXBsaWVyKSAlIChzdGFuZGFyZFNlZ21lbnREdXJhdGlvbiAqIHByZWNpc2lvbk11bHRpcGxpZXIpKSAvIHByZWNpc2lvbk11bHRpcGxpZXIgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGR1cmF0aW9uID0gc3RhbmRhcmRTZWdtZW50RHVyYXRpb247XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGR1cmF0aW9uO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXROdW1iZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIG51bWJlcjsgfTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgc2Vjb25kcykge1xuICAgIHZhciBzZWdtZW50RHVyYXRpb24gPSBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzdGFydE51bWJlciA9IGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSB8fCAwLFxuICAgICAgICBudW1iZXIgPSBNYXRoLmZsb29yKHNlY29uZHMgLyBzZWdtZW50RHVyYXRpb24pICsgc3RhcnROdW1iZXIsXG4gICAgICAgIHNlZ21lbnQgPSBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7XG5cbiAgICAvLyBJZiB3ZSdyZSByZWFsbHkgY2xvc2UgdG8gdGhlIGVuZCB0aW1lIG9mIHRoZSBjdXJyZW50IHNlZ21lbnQgKHN0YXJ0IHRpbWUgKyBkdXJhdGlvbiksXG4gICAgLy8gdGhpcyBtZWFucyB3ZSdyZSByZWFsbHkgY2xvc2UgdG8gdGhlIHN0YXJ0IHRpbWUgb2YgdGhlIG5leHQgc2VnbWVudC5cbiAgICAvLyBUaGVyZWZvcmUsIGFzc3VtZSB0aGlzIGlzIGEgZmxvYXRpbmctcG9pbnQgcHJlY2lzaW9uIGlzc3VlIHdoZXJlIHdlIHdlcmUgdHJ5aW5nIHRvIGdyYWIgYSBzZWdtZW50XG4gICAgLy8gYnkgaXRzIHN0YXJ0IHRpbWUgYW5kIHJldHVybiB0aGUgbmV4dCBzZWdtZW50IGluc3RlYWQuXG4gICAgaWYgKCgoc2VnbWVudC5nZXRTdGFydFRpbWUoKSArIHNlZ21lbnQuZ2V0RHVyYXRpb24oKSkgLSBzZWNvbmRzKSA8PSAwLjAwMyApIHtcbiAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyICsgMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlVVENXYWxsQ2xvY2tUaW1lID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIHVuaXhUaW1lVXRjTWlsbGlzZWNvbmRzKSB7XG4gICAgdmFyIHdhbGxDbG9ja1N0YXJ0VGltZSA9IGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHByZXNlbnRhdGlvblRpbWU7XG4gICAgaWYgKGlzTmFOKHdhbGxDbG9ja1N0YXJ0VGltZSkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBwcmVzZW50YXRpb25UaW1lID0gKHVuaXhUaW1lVXRjTWlsbGlzZWNvbmRzIC0gd2FsbENsb2NrU3RhcnRUaW1lKS8xMDAwO1xuICAgIGlmIChpc05hTihwcmVzZW50YXRpb25UaW1lKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lKHJlcHJlc2VudGF0aW9uLCBwcmVzZW50YXRpb25UaW1lKTtcbn07XG5cbmZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICBpZiAoIXJlcHJlc2VudGF0aW9uKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTsgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNlZ21lbnRUZW1wbGF0ZSxcbiAgICB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTtcblxuemVyb1BhZFRvTGVuZ3RoID0gZnVuY3Rpb24gKG51bVN0ciwgbWluU3RyTGVuZ3RoKSB7XG4gICAgd2hpbGUgKG51bVN0ci5sZW5ndGggPCBtaW5TdHJMZW5ndGgpIHtcbiAgICAgICAgbnVtU3RyID0gJzAnICsgbnVtU3RyO1xuICAgIH1cblxuICAgIHJldHVybiBudW1TdHI7XG59O1xuXG5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdG9rZW4sIHZhbHVlKSB7XG5cbiAgICB2YXIgc3RhcnRQb3MgPSAwLFxuICAgICAgICBlbmRQb3MgPSAwLFxuICAgICAgICB0b2tlbkxlbiA9IHRva2VuLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnID0gJyUwJyxcbiAgICAgICAgZm9ybWF0VGFnTGVuID0gZm9ybWF0VGFnLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnUG9zLFxuICAgICAgICBzcGVjaWZpZXIsXG4gICAgICAgIHdpZHRoLFxuICAgICAgICBwYWRkZWRWYWx1ZTtcblxuICAgIC8vIGtlZXAgbG9vcGluZyByb3VuZCB1bnRpbCBhbGwgaW5zdGFuY2VzIG9mIDx0b2tlbj4gaGF2ZSBiZWVuXG4gICAgLy8gcmVwbGFjZWQuIG9uY2UgdGhhdCBoYXMgaGFwcGVuZWQsIHN0YXJ0UG9zIGJlbG93IHdpbGwgYmUgLTFcbiAgICAvLyBhbmQgdGhlIGNvbXBsZXRlZCB1cmwgd2lsbCBiZSByZXR1cm5lZC5cbiAgICB3aGlsZSAodHJ1ZSkge1xuXG4gICAgICAgIC8vIGNoZWNrIGlmIHRoZXJlIGlzIGEgdmFsaWQgJDx0b2tlbj4uLi4kIGlkZW50aWZpZXJcbiAgICAgICAgLy8gaWYgbm90LCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgc3RhcnRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJyArIHRva2VuKTtcbiAgICAgICAgaWYgKHN0YXJ0UG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhlIG5leHQgJyQnIG11c3QgYmUgdGhlIGVuZCBvZiB0aGUgaWRlbnRpZmVyXG4gICAgICAgIC8vIGlmIHRoZXJlIGlzbid0IG9uZSwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIGVuZFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGVuZFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG5vdyBzZWUgaWYgdGhlcmUgaXMgYW4gYWRkaXRpb25hbCBmb3JtYXQgdGFnIHN1ZmZpeGVkIHRvXG4gICAgICAgIC8vIHRoZSBpZGVudGlmaWVyIHdpdGhpbiB0aGUgZW5jbG9zaW5nICckJyBjaGFyYWN0ZXJzXG4gICAgICAgIGZvcm1hdFRhZ1BvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoZm9ybWF0VGFnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGZvcm1hdFRhZ1BvcyA+IHN0YXJ0UG9zICYmIGZvcm1hdFRhZ1BvcyA8IGVuZFBvcykge1xuXG4gICAgICAgICAgICBzcGVjaWZpZXIgPSB0ZW1wbGF0ZVN0ci5jaGFyQXQoZW5kUG9zIC0gMSk7XG4gICAgICAgICAgICB3aWR0aCA9IHBhcnNlSW50KHRlbXBsYXRlU3RyLnN1YnN0cmluZyhmb3JtYXRUYWdQb3MgKyBmb3JtYXRUYWdMZW4sIGVuZFBvcyAtIDEpLCAxMCk7XG5cbiAgICAgICAgICAgIC8vIHN1cHBvcnQgdGhlIG1pbmltdW0gc3BlY2lmaWVycyByZXF1aXJlZCBieSBJRUVFIDEwMDMuMVxuICAgICAgICAgICAgLy8gKGQsIGkgLCBvLCB1LCB4LCBhbmQgWCkgZm9yIGNvbXBsZXRlbmVzc1xuICAgICAgICAgICAgc3dpdGNoIChzcGVjaWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyB0cmVhdCBhbGwgaW50IHR5cGVzIGFzIHVpbnQsXG4gICAgICAgICAgICAgICAgLy8gaGVuY2UgZGVsaWJlcmF0ZSBmYWxsdGhyb3VnaFxuICAgICAgICAgICAgICAgIGNhc2UgJ2QnOlxuICAgICAgICAgICAgICAgIGNhc2UgJ2knOlxuICAgICAgICAgICAgICAgIGNhc2UgJ3UnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnWCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ28nOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZyg4KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnVW5zdXBwb3J0ZWQvaW52YWxpZCBJRUVFIDEwMDMuMSBmb3JtYXQgaWRlbnRpZmllciBzdHJpbmcgaW4gVVJMJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICB0ZW1wbGF0ZVN0ciA9IHRlbXBsYXRlU3RyLnN1YnN0cmluZygwLCBzdGFydFBvcykgKyBwYWRkZWRWYWx1ZSArIHRlbXBsYXRlU3RyLnN1YnN0cmluZyhlbmRQb3MgKyAxKTtcbiAgICB9XG59O1xuXG51bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckJCcpLmpvaW4oJyQnKTtcbn07XG5cbnJlcGxhY2VJREZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckUmVwcmVzZW50YXRpb25JRCQnKSA9PT0gLTEpIHsgcmV0dXJuIHRlbXBsYXRlU3RyOyB9XG4gICAgdmFyIHYgPSB2YWx1ZS50b1N0cmluZygpO1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJFJlcHJlc2VudGF0aW9uSUQkJykuam9pbih2KTtcbn07XG5cbnNlZ21lbnRUZW1wbGF0ZSA9IHtcbiAgICB6ZXJvUGFkVG9MZW5ndGg6IHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZTogcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZTogdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTogcmVwbGFjZUlERm9yVGVtcGxhdGVcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gc2VnbWVudFRlbXBsYXRlOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV2ZW50TWdyID0gcmVxdWlyZSgnLi9ldmVudE1hbmFnZXIuanMnKSxcbiAgICBldmVudERpc3BhdGNoZXJNaXhpbiA9IHtcbiAgICAgICAgdHJpZ2dlcjogZnVuY3Rpb24oZXZlbnRPYmplY3QpIHsgZXZlbnRNZ3IudHJpZ2dlcih0aGlzLCBldmVudE9iamVjdCk7IH0sXG4gICAgICAgIG9uZTogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbmUodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9uOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvZmY6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub2ZmKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9XG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudERpc3BhdGNoZXJNaXhpbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB2aWRlb2pzID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLnZpZGVvanMsXG4gICAgZXZlbnRNYW5hZ2VyID0ge1xuICAgICAgICB0cmlnZ2VyOiB2aWRlb2pzLnRyaWdnZXIsXG4gICAgICAgIG9uZTogdmlkZW9qcy5vbmUsXG4gICAgICAgIG9uOiB2aWRlb2pzLm9uLFxuICAgICAgICBvZmY6IHZpZGVvanMub2ZmXG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudE1hbmFnZXI7XG4iLCIvKipcbiAqXG4gKiBtYWluIHNvdXJjZSBmb3IgcGFja2FnZWQgY29kZS4gQXV0by1ib290c3RyYXBzIHRoZSBzb3VyY2UgaGFuZGxpbmcgZnVuY3Rpb25hbGl0eSBieSByZWdpc3RlcmluZyB0aGUgc291cmNlIGhhbmRsZXJcbiAqIHdpdGggdmlkZW8uanMgb24gaW5pdGlhbCBzY3JpcHQgbG9hZCB2aWEgSUlGRS4gKE5PVEU6IFRoaXMgcGxhY2VzIGFuIG9yZGVyIGRlcGVuZGVuY3kgb24gdGhlIHZpZGVvLmpzIGxpYnJhcnksIHdoaWNoXG4gKiBtdXN0IGFscmVhZHkgYmUgbG9hZGVkIGJlZm9yZSB0aGlzIHNjcmlwdCBhdXRvLWV4ZWN1dGVzLilcbiAqXG4gKi9cbjsoZnVuY3Rpb24oKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIHJvb3QgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JyksXG4gICAgICAgIHZpZGVvanMgPSByb290LnZpZGVvanMsXG4gICAgICAgIFNvdXJjZUhhbmRsZXIgPSByZXF1aXJlKCcuL1NvdXJjZUhhbmRsZXInKSxcbiAgICAgICAgQ2FuSGFuZGxlU291cmNlRW51bSA9IHtcbiAgICAgICAgICAgIERPRVNOVF9IQU5ETEVfU09VUkNFOiAnJyxcbiAgICAgICAgICAgIE1BWUJFX0hBTkRMRV9TT1VSQ0U6ICdtYXliZSdcbiAgICAgICAgfTtcblxuICAgIGlmICghdmlkZW9qcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB2aWRlby5qcyBsaWJyYXJ5IG11c3QgYmUgaW5jbHVkZWQgdG8gdXNlIHRoaXMgTVBFRy1EQVNIIHNvdXJjZSBoYW5kbGVyLicpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogVXNlZCBieSBhIHZpZGVvLmpzIHRlY2ggaW5zdGFuY2UgdG8gdmVyaWZ5IHdoZXRoZXIgb3Igbm90IGEgc3BlY2lmaWMgbWVkaWEgc291cmNlIGNhbiBiZSBoYW5kbGVkIGJ5IHRoaXNcbiAgICAgKiBzb3VyY2UgaGFuZGxlci4gSW4gdGhpcyBjYXNlLCBzaG91bGQgcmV0dXJuICdtYXliZScgaWYgdGhlIHNvdXJjZSBpcyBNUEVHLURBU0gsIG90aGVyd2lzZSAnJyAocmVwcmVzZW50aW5nIG5vKS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7b2JqZWN0fSBzb3VyY2UgICAgICAgICAgIHZpZGVvLmpzIHNvdXJjZSBvYmplY3QgcHJvdmlkaW5nIHNvdXJjZSB1cmkgYW5kIHR5cGUgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7Q2FuSGFuZGxlU291cmNlRW51bX0gICBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2Ygd2hldGhlciBvciBub3QgcGFydGljdWxhciBzb3VyY2UgY2FuIGJlIGhhbmRsZWQgYnkgdGhpc1xuICAgICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZSBoYW5kbGVyLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIGNhbkhhbmRsZVNvdXJjZShzb3VyY2UpIHtcbiAgICAgICAgLy8gUmVxdWlyZXMgTWVkaWEgU291cmNlIEV4dGVuc2lvbnNcbiAgICAgICAgaWYgKCEocm9vdC5NZWRpYVNvdXJjZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLkRPRVNOVF9IQU5ETEVfU09VUkNFO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHR5cGUgaXMgc3VwcG9ydGVkXG4gICAgICAgIGlmICgvYXBwbGljYXRpb25cXC9kYXNoXFwreG1sLy50ZXN0KHNvdXJjZS50eXBlKSkge1xuICAgICAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uTUFZQkVfSEFORExFX1NPVVJDRTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4dGVuc2lvbiBtYXRjaGVzXG4gICAgICAgIGlmICgvXFwubXBkJC9pLnRlc3Qoc291cmNlLnNyYykpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLk1BWUJFX0hBTkRMRV9TT1VSQ0U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5ET0VTTlRfSEFORExFX1NPVVJDRTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIENhbGxlZCBieSBhIHZpZGVvLmpzIHRlY2ggaW5zdGFuY2UgdG8gaGFuZGxlIGEgc3BlY2lmaWMgbWVkaWEgc291cmNlLCByZXR1cm5pbmcgYW4gb2JqZWN0IGluc3RhbmNlIHRoYXQgcHJvdmlkZXNcbiAgICAgKiB0aGUgY29udGV4dCBmb3IgaGFuZGxpbmcgc2FpZCBzb3VyY2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc291cmNlICAgICAgICAgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgc291cmNlIHVyaSBhbmQgdHlwZSBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSB0ZWNoICAgICAgICAgICAgICB2aWRlby5qcyB0ZWNoIG9iamVjdCAoaW4gdGhpcyBjYXNlLCBzaG91bGQgYmUgSHRtbDUgdGVjaCkgcHJvdmlkaW5nIHBvaW50IG9mIGludGVyYWN0aW9uXG4gICAgICogICAgICAgICAgICAgICAgICAgICAgICAgIGJldHdlZW4gdGhlIHNvdXJjZSBoYW5kbGVyIGFuZCB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nLCBlLmcuLCB0aGUgdmlkZW8gZWxlbWVudClcbiAgICAgKiBAcmV0dXJucyB7U291cmNlSGFuZGxlcn0gQW4gb2JqZWN0IHRoYXQgZGVmaW5lcyBjb250ZXh0IGZvciBoYW5kbGluZyBhIHBhcnRpY3VsYXIgTVBFRy1EQVNIIHNvdXJjZS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBoYW5kbGVTb3VyY2Uoc291cmNlLCB0ZWNoKSB7XG4gICAgICAgIHJldHVybiBuZXcgU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpO1xuICAgIH1cblxuICAgIC8vIFJlZ2lzdGVyIHRoZSBzb3VyY2UgaGFuZGxlciB0byB0aGUgSHRtbDUgdGVjaCBpbnN0YW5jZS5cbiAgICB2aWRlb2pzLkh0bWw1LnJlZ2lzdGVyU291cmNlSGFuZGxlcih7XG4gICAgICAgIGNhbkhhbmRsZVNvdXJjZTogY2FuSGFuZGxlU291cmNlLFxuICAgICAgICBoYW5kbGVTb3VyY2U6IGhhbmRsZVNvdXJjZVxuICAgIH0sIDApO1xuXG59LmNhbGwodGhpcykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB0cnV0aHkgPSByZXF1aXJlKCcuLi91dGlsL3RydXRoeS5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi4vdXRpbC9pc1N0cmluZy5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgZmluZEVsZW1lbnRJbkFycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9maW5kRWxlbWVudEluQXJyYXkuanMnKSxcbiAgICBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUgPSByZXF1aXJlKCcuLi91dGlsL2dldE1lZGlhVHlwZUZyb21NaW1lVHlwZS5qcycpLFxuICAgIGxvYWRNYW5pZmVzdCA9IHJlcXVpcmUoJy4vbG9hZE1hbmlmZXN0LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgZ2V0TXBkID0gcmVxdWlyZSgnLi4vZGFzaC9tcGQvZ2V0TXBkLmpzJyksXG4gICAgTWVkaWFTZXQgPSByZXF1aXJlKCcuLi9NZWRpYVNldC5qcycpLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL01lZGlhVHlwZXMuanMnKTtcblxuLyoqXG4gKlxuICogVGhlIE1hbmlmZXN0Q29udHJvbGxlciBsb2Fkcywgc3RvcmVzLCBhbmQgcHJvdmlkZXMgZGF0YSB2aWV3cyBmb3IgdGhlIE1QRCBtYW5pZmVzdCB0aGF0IHJlcHJlc2VudHMgdGhlXG4gKiBNUEVHLURBU0ggbWVkaWEgc291cmNlIGJlaW5nIGhhbmRsZWQuXG4gKlxuICogQHBhcmFtIHNvdXJjZVVyaSB7c3RyaW5nfVxuICogQHBhcmFtIGF1dG9Mb2FkICB7Ym9vbGVhbn1cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlVXJpLCBhdXRvTG9hZCkge1xuICAgIHRoaXMuX19hdXRvTG9hZCA9IHRydXRoeShhdXRvTG9hZCk7XG4gICAgdGhpcy5zZXRTb3VyY2VVcmkoc291cmNlVXJpKTtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIE1BTklGRVNUX0xPQURFRDogJ21hbmlmZXN0TG9hZGVkJ1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRTb3VyY2VVcmkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX3NvdXJjZVVyaTtcbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuc2V0U291cmNlVXJpID0gZnVuY3Rpb24gc2V0U291cmNlVXJpKHNvdXJjZVVyaSkge1xuICAgIC8vIFRPRE86ICdleGlzdHkoKScgY2hlY2sgZm9yIGJvdGg/XG4gICAgaWYgKHNvdXJjZVVyaSA9PT0gdGhpcy5fX3NvdXJjZVVyaSkgeyByZXR1cm47IH1cblxuICAgIC8vIFRPRE86IGlzU3RyaW5nKCkgY2hlY2s/ICdleGlzdHkoKScgY2hlY2s/XG4gICAgaWYgKCFzb3VyY2VVcmkpIHtcbiAgICAgICAgdGhpcy5fX2NsZWFyU291cmNlVXJpKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBOZWVkIHRvIHBvdGVudGlhbGx5IHJlbW92ZSB1cGRhdGUgaW50ZXJ2YWwgZm9yIHJlLXJlcXVlc3RpbmcgdGhlIE1QRCBtYW5pZmVzdCAoaW4gY2FzZSBpdCBpcyBhIGR5bmFtaWMgTVBEKVxuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBzb3VyY2VVcmk7XG4gICAgLy8gSWYgd2Ugc2hvdWxkIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgTVBELCBnbyBhaGVhZCBhbmQga2ljayBvZmYgbG9hZGluZyBpdC5cbiAgICBpZiAodGhpcy5fX2F1dG9Mb2FkKSB7XG4gICAgICAgIC8vIFRPRE86IEltcGwgYW55IGNsZWFudXAgZnVuY3Rpb25hbGl0eSBhcHByb3ByaWF0ZSBiZWZvcmUgbG9hZC5cbiAgICAgICAgdGhpcy5sb2FkKCk7XG4gICAgfVxufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX2NsZWFyU291cmNlVXJpID0gZnVuY3Rpb24gY2xlYXJTb3VyY2VVcmkoKSB7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IG51bGw7XG4gICAgLy8gTmVlZCB0byBwb3RlbnRpYWxseSByZW1vdmUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgbWFuaWZlc3QgKGluIGNhc2UgaXQgaXMgYSBkeW5hbWljIE1QRClcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAvLyBUT0RPOiBpbXBsIGFueSBvdGhlciBjbGVhbnVwIGZ1bmN0aW9uYWxpdHlcbn07XG5cbi8qKlxuICogS2ljayBvZmYgbG9hZGluZyB0aGUgREFTSCBNUEQgTWFuaWZlc3QgKHNlcnZlZCBAIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgaW5zdGFuY2UncyBfX3NvdXJjZVVyaSlcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24gbG9hZCgpIHtcbiAgICAvLyBUT0RPOiBDdXJyZW50bHkgY2xlYXJpbmcgJiByZS1zZXR0aW5nIHVwZGF0ZSBpbnRlcnZhbCBhZnRlciBldmVyeSByZXF1ZXN0LiBFaXRoZXIgdXNlIHNldFRpbWVvdXQoKSBvciBvbmx5IHNldHVwIGludGVydmFsIG9uY2VcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgbG9hZE1hbmlmZXN0KHNlbGYuX19zb3VyY2VVcmksIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgc2VsZi5fX21hbmlmZXN0ID0gZGF0YS5tYW5pZmVzdFhtbDtcbiAgICAgICAgLy8gKFBvdGVudGlhbGx5KSBzZXR1cCB0aGUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgKGluIGNhc2UgdGhlIG1hbmlmZXN0IGlzIGR5bmFtaWMpXG4gICAgICAgIHNlbGYuX19zZXR1cFVwZGF0ZUludGVydmFsKCk7XG4gICAgICAgIC8vIERpc3BhdGNoIGV2ZW50IHRvIG5vdGlmeSB0aGF0IHRoZSBtYW5pZmVzdCBoYXMgbG9hZGVkLlxuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VsZi5fX21hbmlmZXN0fSk7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqICdQcml2YXRlJyBtZXRob2QgdGhhdCByZW1vdmVzIHRoZSB1cGRhdGUgaW50ZXJ2YWwgKGlmIGl0IGV4aXN0cyksIHNvIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgaW5zdGFuY2Ugd2lsbCBubyBsb25nZXJcbiAqIHBlcmlvZGljYWxseSByZS1yZXF1ZXN0IHRoZSBtYW5pZmVzdCAoaWYgaXQncyBkeW5hbWljKS5cbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3VwZGF0ZUludGVydmFsKSkgeyByZXR1cm47IH1cbiAgICBjbGVhckludGVydmFsKHRoaXMuX191cGRhdGVJbnRlcnZhbCk7XG59O1xuXG4vKipcbiAqIFNldHMgdXAgYW4gaW50ZXJ2YWwgdG8gcmUtcmVxdWVzdCB0aGUgbWFuaWZlc3QgKGlmIGl0J3MgZHluYW1pYylcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX3NldHVwVXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBzZXR1cFVwZGF0ZUludGVydmFsKCkge1xuICAgIC8vIElmIHRoZXJlJ3MgYWxyZWFkeSBhbiB1cGRhdGVJbnRlcnZhbCBmdW5jdGlvbiwgcmVtb3ZlIGl0LlxuICAgIGlmICh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpIHsgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7IH1cbiAgICAvLyBJZiB3ZSBzaG91bGRuJ3QgdXBkYXRlLCBqdXN0IGJhaWwuXG4gICAgaWYgKCF0aGlzLmdldFNob3VsZFVwZGF0ZSgpKSB7IHJldHVybjsgfVxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWluVXBkYXRlUmF0ZSA9IDIsXG4gICAgICAgIHVwZGF0ZVJhdGUgPSBNYXRoLm1heCh0aGlzLmdldFVwZGF0ZVJhdGUoKSwgbWluVXBkYXRlUmF0ZSk7XG4gICAgLy8gU2V0dXAgdGhlIHVwZGF0ZSBpbnRlcnZhbCBiYXNlZCBvbiB0aGUgdXBkYXRlIHJhdGUgKGRldGVybWluZWQgZnJvbSB0aGUgbWFuaWZlc3QpIG9yIHRoZSBtaW5pbXVtIHVwZGF0ZSByYXRlXG4gICAgLy8gKHdoaWNoZXZlcidzIGxhcmdlcikuXG4gICAgLy8gTk9URTogTXVzdCBzdG9yZSByZWYgdG8gY3JlYXRlZCBpbnRlcnZhbCB0byBwb3RlbnRpYWxseSBjbGVhci9yZW1vdmUgaXQgbGF0ZXJcbiAgICB0aGlzLl9fdXBkYXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgc2VsZi5sb2FkKCk7XG4gICAgfSwgdXBkYXRlUmF0ZSAqIDEwMDApO1xufTtcblxuLyoqXG4gKiBHZXRzIHRoZSB0eXBlIG9mIHBsYXlsaXN0ICgnc3RhdGljJyBvciAnZHluYW1pYycsIHdoaWNoIG5lYXJseSBpbnZhcmlhYmx5IGNvcnJlc3BvbmRzIHRvIGxpdmUgdnMuIHZvZCkgZGVmaW5lZCBpbiB0aGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgIHRoZSBwbGF5bGlzdCB0eXBlIChlaXRoZXIgJ3N0YXRpYycgb3IgJ2R5bmFtaWMnKVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFBsYXlsaXN0VHlwZSA9IGZ1bmN0aW9uIGdldFBsYXlsaXN0VHlwZSgpIHtcbiAgICB2YXIgcGxheWxpc3RUeXBlID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0VHlwZSgpO1xuICAgIHJldHVybiBwbGF5bGlzdFR5cGU7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFVwZGF0ZVJhdGUgPSBmdW5jdGlvbiBnZXRVcGRhdGVSYXRlKCkge1xuICAgIHZhciBtaW5pbXVtVXBkYXRlUGVyaW9kU3RyID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCgpLFxuICAgICAgICBtaW5pbXVtVXBkYXRlUGVyaW9kID0gcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1pbmltdW1VcGRhdGVQZXJpb2RTdHIpO1xuICAgIHJldHVybiBtaW5pbXVtVXBkYXRlUGVyaW9kIHx8IDA7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFNob3VsZFVwZGF0ZSA9IGZ1bmN0aW9uIGdldFNob3VsZFVwZGF0ZSgpIHtcbiAgICB2YXIgaXNEeW5hbWljID0gKHRoaXMuZ2V0UGxheWxpc3RUeXBlKCkgPT09ICdkeW5hbWljJyksXG4gICAgICAgIGhhc1ZhbGlkVXBkYXRlUmF0ZSA9ICh0aGlzLmdldFVwZGF0ZVJhdGUoKSA+IDApO1xuICAgIHJldHVybiAoaXNEeW5hbWljICYmIGhhc1ZhbGlkVXBkYXRlUmF0ZSk7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1wZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBnZXRNcGQodGhpcy5fX21hbmlmZXN0KTtcbn07XG5cbi8qKlxuICpcbiAqIEBwYXJhbSB0eXBlXG4gKiBAcmV0dXJucyB7TWVkaWFTZXR9XG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0TWVkaWFTZXRCeVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVNldEJ5VHlwZSh0eXBlKSB7XG4gICAgaWYgKG1lZGlhVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHsgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHR5cGUuIFZhbHVlIG11c3QgYmUgb25lIG9mOiAnICsgbWVkaWFUeXBlcy5qb2luKCcsICcpKTsgfVxuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCA9IGZpbmRFbGVtZW50SW5BcnJheShhZGFwdGF0aW9uU2V0cywgZnVuY3Rpb24oYWRhcHRhdGlvblNldCkge1xuICAgICAgICAgICAgcmV0dXJuIChnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUoYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKSA9PT0gdHlwZSk7XG4gICAgICAgIH0pO1xuICAgIGlmICghZXhpc3R5KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBuZXcgTWVkaWFTZXQoYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2gpO1xufTtcblxuLyoqXG4gKlxuICogQHJldHVybnMge0FycmF5LjxNZWRpYVNldD59XG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0TWVkaWFTZXRzID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRzKCkge1xuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBtZWRpYVNldHMgPSBhZGFwdGF0aW9uU2V0cy5tYXAoZnVuY3Rpb24oYWRhcHRhdGlvblNldCkgeyByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFTZXRzO1xufTtcblxuLy8gTWl4aW4gZXZlbnQgaGFuZGxpbmcgZm9yIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgb2JqZWN0IHR5cGUgZGVmaW5pdGlvbi5cbmV4dGVuZE9iamVjdChNYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFuaWZlc3RDb250cm9sbGVyOyIsIm1vZHVsZS5leHBvcnRzID0gWyd2aWRlbycsICdhdWRpbyddOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL3V0aWwuanMnKS5wYXJzZVJvb3RVcmw7XG5cbmZ1bmN0aW9uIGxvYWRNYW5pZmVzdCh1cmwsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFjdHVhbFVybCA9IHBhcnNlUm9vdFVybCh1cmwpLFxuICAgICAgICByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIG9ubG9hZDtcblxuICAgIG9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7IHJldHVybjsgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2soe21hbmlmZXN0WG1sOiByZXF1ZXN0LnJlc3BvbnNlWE1MIH0pOyB9XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3Qub25sb2FkID0gb25sb2FkO1xuICAgICAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgICAgIHJlcXVlc3Quc2VuZCgpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgICByZXF1ZXN0Lm9uZXJyb3IoKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gbG9hZE1hbmlmZXN0OyIsIlxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNOdW1iZXIgPSByZXF1aXJlKCcuLi91dGlsL2lzTnVtYmVyLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGxvYWRTZWdtZW50LFxuICAgIERFRkFVTFRfUkVUUllfQ09VTlQgPSAzLFxuICAgIERFRkFVTFRfUkVUUllfSU5URVJWQUwgPSAyNTA7XG5cbi8qKlxuICogR2VuZXJpYyBmdW5jdGlvbiBmb3IgbG9hZGluZyBNUEVHLURBU0ggc2VnbWVudHNcbiAqIEBwYXJhbSBzZWdtZW50IHtvYmplY3R9ICAgICAgICAgIGRhdGEgdmlldyByZXByZXNlbnRpbmcgYSBzZWdtZW50IChhbmQgcmVsZXZhbnQgZGF0YSBmb3IgdGhhdCBzZWdtZW50KVxuICogQHBhcmFtIGNhbGxiYWNrRm4ge2Z1bmN0aW9ufSAgICAgY2FsbGJhY2sgZnVuY3Rpb25cbiAqIEBwYXJhbSByZXRyeUNvdW50IHtudW1iZXJ9ICAgICAgIHN0aXB1bGF0ZXMgaG93IG1hbnkgdGltZXMgd2Ugc2hvdWxkIHRyeSB0byBsb2FkIHRoZSBzZWdtZW50IGJlZm9yZSBnaXZpbmcgdXBcbiAqIEBwYXJhbSByZXRyeUludGVydmFsIHtudW1iZXJ9ICAgIHN0aXB1bGF0ZXMgdGhlIGFtb3VudCBvZiB0aW1lIChpbiBtaWxsaXNlY29uZHMpIHdlIHNob3VsZCB3YWl0IGJlZm9yZSByZXRyeWluZyB0b1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG93bmxvYWQgdGhlIHNlZ21lbnQgaWYvd2hlbiB0aGUgZG93bmxvYWQgYXR0ZW1wdCBmYWlscy5cbiAqL1xubG9hZFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50LCByZXRyeUludGVydmFsKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBudWxsO1xuXG4gICAgdmFyIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKSxcbiAgICAgICAgdXJsID0gc2VnbWVudC5nZXRVcmwoKTtcbiAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuXG4gICAgcmVxdWVzdC5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IE51bWJlcigobmV3IERhdGUoKS5nZXRUaW1lKCkpLzEwMDApO1xuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2tGbiA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFja0ZuLmNhbGwoc2VsZiwgcmVxdWVzdC5yZXNwb25zZSk7IH1cbiAgICB9O1xuICAgIC8vcmVxdWVzdC5vbmVycm9yID0gcmVxdWVzdC5vbmxvYWRlbmQgPSBmdW5jdGlvbigpIHtcbiAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIHNlbGYuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcbiAgICByZXF1ZXN0LnNlbmQoKTtcbn07XG5cbi8qKlxuICpcbiAqIFNlZ21lbnRMb2FkZXIgaGFuZGxlcyBsb2FkaW5nIHNlZ21lbnRzIGZyb20gc2VnbWVudCBsaXN0cyBmb3IgYSBnaXZlbiBtZWRpYSBzZXQsIGJhc2VkIG9uIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWRcbiAqIHNlZ21lbnQgbGlzdCAod2hpY2ggY29ycmVzcG9uZHMgdG8gdGhlIGN1cnJlbnRseSBzZXQgYmFuZHdpZHRoL2JpdHJhdGUpXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfVxuICogQHBhcmFtIG1lZGlhVHlwZSB7c3RyaW5nfVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpIHtcbiAgICBpZiAoIWV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtYW5pZmVzdENvbnRyb2xsZXIhJyk7IH1cbiAgICBpZiAoIWV4aXN0eShtZWRpYVR5cGUpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtZWRpYVR5cGUhJyk7IH1cbiAgICAvLyBOT1RFOiBSYXRoZXIgdGhhbiBwYXNzaW5nIGluIGEgcmVmZXJlbmNlIHRvIHRoZSBNZWRpYVNldCBpbnN0YW5jZSBmb3IgYSBtZWRpYSB0eXBlLCB3ZSBwYXNzIGluIGEgcmVmZXJlbmNlIHRvIHRoZVxuICAgIC8vIGNvbnRyb2xsZXIgJiB0aGUgbWVkaWFUeXBlIHNvIHRoYXQgdGhlIFNlZ21lbnRMb2FkZXIgZG9lc24ndCBuZWVkIHRvIGJlIGF3YXJlIG9mIHN0YXRlIGNoYW5nZXMvdXBkYXRlcyB0b1xuICAgIC8vIHRoZSBtYW5pZmVzdCBkYXRhIChzYXksIGlmIHRoZSBwbGF5bGlzdCBpcyBkeW5hbWljLydsaXZlJykuXG4gICAgdGhpcy5fX21hbmlmZXN0ID0gbWFuaWZlc3RDb250cm9sbGVyO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG4gICAgLy8gVE9ETzogRG9uJ3QgbGlrZSB0aGlzOiBOZWVkIHRvIGNlbnRyYWxpemUgcGxhY2Uocykgd2hlcmUgJiBob3cgX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCBnZXRzIHNldCB0byB0cnVlL2ZhbHNlLlxuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCk7XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gdHJ1ZTtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBJTklUSUFMSVpBVElPTl9MT0FERUQ6ICdpbml0aWFsaXphdGlvbkxvYWRlZCcsXG4gICAgU0VHTUVOVF9MT0FERUQ6ICdzZWdtZW50TG9hZGVkJyxcbiAgICBET1dOTE9BRF9EQVRBX1VQREFURTogJ2Rvd25sb2FkRGF0YVVwZGF0ZSdcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0TWVkaWFTZXQgPSBmdW5jdGlvbiBnZXRNZWRpYVNldCgpIHtcbiAgICB2YXIgbWVkaWFTZXQgPSB0aGlzLl9fbWFuaWZlc3QuZ2V0TWVkaWFTZXRCeVR5cGUodGhpcy5fX21lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuX19nZXREZWZhdWx0U2VnbWVudExpc3QgPSBmdW5jdGlvbiBnZXREZWZhdWx0U2VnbWVudExpc3QoKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0ID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RzKClbMF07XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRCYW5kd2lkdGgoKSB7XG4gICAgaWYgKCFpc051bWJlcih0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkpIHsgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSB0aGlzLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkuZ2V0QmFuZHdpZHRoKCk7IH1cbiAgICByZXR1cm4gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGg7XG59O1xuXG4vKipcbiAqIFNldHMgdGhlIGN1cnJlbnQgYmFuZHdpZHRoLCB3aGljaCBjb3JyZXNwb25kcyB0byB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCAoaS5lLiB0aGUgc2VnbWVudCBsaXN0IGluIHRoZVxuICogbWVkaWEgc2V0IGZyb20gd2hpY2ggd2Ugc2hvdWxkIGJlIGRvd25sb2FkaW5nIHNlZ21lbnRzKS5cbiAqIEBwYXJhbSBiYW5kd2lkdGgge251bWJlcn1cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUuc2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIHNldEN1cnJlbnRCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgaWYgKCFpc051bWJlcihiYW5kd2lkdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIGV4cGVjdHMgYSBudW1lcmljIHZhbHVlIGZvciBiYW5kd2lkdGghJyk7XG4gICAgfVxuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgaWYgKGF2YWlsYWJsZUJhbmR3aWR0aHMuaW5kZXhPZihiYW5kd2lkdGgpIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBtdXN0IGJlIHNldCB0byBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXM6ICcgKyBhdmFpbGFibGVCYW5kd2lkdGhzLmpvaW4oJywgJykpO1xuICAgIH1cbiAgICBpZiAoYmFuZHdpZHRoID09PSB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkgeyByZXR1cm47IH1cbiAgICAvLyBUcmFjayB3aGVuIHdlJ3ZlIHN3aXRjaCBiYW5kd2lkdGhzLCBzaW5jZSB3ZSdsbCBuZWVkIHRvIChyZSlsb2FkIHRoZSBpbml0aWFsaXphdGlvbiBzZWdtZW50IGZvciB0aGUgc2VnbWVudCBsaXN0XG4gICAgLy8gd2hlbmV2ZXIgd2Ugc3dpdGNoIGJldHdlZW4gc2VnbWVudCBsaXN0cy4gVGhpcyBhbGxvd3MgU2VnbWVudExvYWRlciBpbnN0YW5jZXMgdG8gYXV0b21hdGljYWxseSBkbyB0aGlzLCBoaWRpbmcgdGhvc2VcbiAgICAvLyBkZXRhaWxzIGZyb20gdGhlIG91dHNpZGUuXG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gdHJ1ZTtcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IGJhbmR3aWR0aDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TGlzdCgpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSAgdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCh0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKSk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIHJldHVybiBhdmFpbGFibGVCYW5kd2lkdGhzO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTdGFydE51bWJlcigpIHtcbiAgICB2YXIgc3RhcnROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHN0YXJ0TnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnQgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudCgpIHtcbiAgICB2YXIgc2VnbWVudCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0U2VnbWVudEJ5TnVtYmVyKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TnVtYmVyKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudFN0YXJ0VGltZSA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50U3RhcnRUaW1lKCkgeyByZXR1cm4gdGhpcy5nZXRDdXJyZW50U2VnbWVudCgpLmdldFN0YXJ0TnVtYmVyKCk7IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEVuZE51bWJlciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBlbmROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdEVuZE51bWJlcigpO1xuICAgIHJldHVybiBlbmROdW1iZXI7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZXhpc3R5KHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUpID8gdGhpcy5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSA6IC0xO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TGFzdERvd25sb2FkQ29tcGxldGVUaW1lKCkgLSB0aGlzLmdldExhc3REb3dubG9hZFN0YXJ0VGltZSgpO1xufTtcblxuLyoqXG4gKlxuICogTWV0aG9kIGZvciBkb3dubG9hZGluZyB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgKHdoaWNoIGNvcnJlc3BvbmRzIHRvIHRoZVxuICogY3VycmVudGx5IHNldCBiYW5kd2lkdGgpXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRJbml0aWFsaXphdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLFxuICAgICAgICBpbml0aWFsaXphdGlvbiA9IHNlZ21lbnRMaXN0LmdldEluaXRpYWxpemF0aW9uKCk7XG5cbiAgICBpZiAoIWluaXRpYWxpemF0aW9uKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBpbml0aWFsaXphdGlvbiwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6aW5pdFNlZ21lbnR9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZE5leHRTZWdtZW50ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPSBleGlzdHkodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyKSxcbiAgICAgICAgbnVtYmVyID0gbm9DdXJyZW50U2VnbWVudE51bWJlciA/IHRoaXMuZ2V0U3RhcnROdW1iZXIoKSA6IHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciArIDE7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNlZ21lbnRBdE51bWJlcihudW1iZXIpO1xufTtcblxuLy8gVE9ETzogRHVwbGljYXRlIGNvZGUgYmVsb3cuIEFic3RyYWN0IGF3YXkuXG4vKipcbiAqXG4gKiBNZXRob2QgZm9yIGRvd25sb2FkaW5nIGEgc2VnbWVudCBmcm9tIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0IGJhc2VkIG9uIGl0cyBcIm51bWJlclwiIChzZWUgcGFyYW0gY29tbWVudCBiZWxvdylcbiAqXG4gKiBAcGFyYW0gbnVtYmVyIHtudW1iZXJ9ICAgSW5kZXgtbGlrZSB2YWx1ZSBmb3Igc3BlY2lmeWluZyB3aGljaCBzZWdtZW50IHRvIGxvYWQgZnJvbSB0aGUgc2VnbWVudCBsaXN0LlxuICogQHJldHVybnMge2Jvb2xlYW59XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRTZWdtZW50QXROdW1iZXIgPSBmdW5jdGlvbihudW1iZXIpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGlmIChudW1iZXIgPiB0aGlzLmdldEVuZE51bWJlcigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlOdW1iZXIobnVtYmVyKTtcblxuICAgIC8vIElmIHRoZSBiYW5kd2lkdGggaGFzIGNoYW5nZWQgc2luY2Ugb3VyIGxhc3QgZG93bmxvYWQsIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGNvcnJlc3BvbmRpbmdcbiAgICAvLyBzZWdtZW50IGxpc3QgYmVmb3JlIGRvd25sb2FkaW5nIHRoZSBkZXNpcmVkIHNlZ21lbnQpXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgLy8gRGlzcGF0Y2ggZXZlbnQgdGhhdCBwcm92aWRlcyBtZXRyaWNzIG9uIGRvd25sb2FkIHJvdW5kIHRyaXAgdGltZSAmIGJhbmR3aWR0aCBvZiBzZWdtZW50ICh1c2VkIHdpdGggQUJSIHN3aXRjaGluZyBsb2dpYylcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlZ21lbnREYXRhIH0pO1xuICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8qKlxuICpcbiAqIE1ldGhvZCBmb3IgZG93bmxvYWRpbmcgYSBzZWdtZW50IGZyb20gdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgYmFzZWQgb24gdGhlIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIHRoYXRcbiAqIGNvcnJlc3BvbmRzIHdpdGggYSBnaXZlbiBzZWdtZW50LlxuICpcbiAqIEBwYXJhbSBwcmVzZW50YXRpb25UaW1lIHtudW1iZXJ9IG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIGNvcnJlc3BvbmRpbmcgdG8gdGhlIHNlZ21lbnQgd2UnZCBsaWtlIHRvIGxvYWQgZnJvbSB0aGUgc2VnbWVudCBsaXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbihwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCk7XG5cbiAgICBpZiAocHJlc2VudGF0aW9uVGltZSA+IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBzZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIC8vIElmIHRoZSBiYW5kd2lkdGggaGFzIGNoYW5nZWQgc2luY2Ugb3VyIGxhc3QgZG93bmxvYWQsIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGNvcnJlc3BvbmRpbmdcbiAgICAvLyBzZWdtZW50IGxpc3QgYmVmb3JlIGRvd25sb2FkaW5nIHRoZSBkZXNpcmVkIHNlZ21lbnQpXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgLy8gRGlzcGF0Y2ggZXZlbnQgdGhhdCBwcm92aWRlcyBtZXRyaWNzIG9uIGRvd25sb2FkIHJvdW5kIHRyaXAgdGltZSAmIGJhbmR3aWR0aCBvZiBzZWdtZW50ICh1c2VkIHdpdGggQUJSIHN3aXRjaGluZyBsb2dpYylcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU2VnbWVudExvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKSB7XG4gICAgdmFyIGJhbmR3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgIGJhbmR3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0QmFuZHdpZHRoKCk7XG4gICAgcmV0dXJuIGJhbmR3aWR0aEEgLSBiYW5kd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciB3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICB3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0V2lkdGgoKSB8fCAwO1xuICAgIHJldHVybiB3aWR0aEEgLSB3aWR0aEI7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciByZXNvbHV0aW9uQ29tcGFyZSA9IGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbiAgICByZXR1cm4gKHJlc29sdXRpb25Db21wYXJlICE9PSAwKSA/IHJlc29sdXRpb25Db21wYXJlIDogY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0LCBtYXhXaWR0aCwgbWF4SGVpZ2h0KSB7XG4gICAgdmFyIHdpZHRoID0gc2VnbWVudExpc3QuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICBoZWlnaHQgPSBzZWdtZW50TGlzdC5nZXRIZWlnaHQoKSB8fCAwO1xuICAgIHJldHVybiAoKHdpZHRoIDw9IG1heFdpZHRoKSAmJiAoaGVpZ2h0IDw9IG1heEhlaWdodCkpO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbykge1xuICAgIHZhciBzZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBzZWdtZW50QmFuZHdpZHRoUmF0aW8gPSBzZWdtZW50TGlzdEJhbmR3aWR0aCAvIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcbiAgICBkb3dubG9hZFJhdGVSYXRpbyA9IGRvd25sb2FkUmF0ZVJhdGlvIHx8IE51bWJlci5NQVhfVkFMVUU7XG4gICAgcmV0dXJuIChkb3dubG9hZFJhdGVSYXRpbyA+PSBzZWdtZW50QmFuZHdpZHRoUmF0aW8pO1xufVxuXG4vLyBOT1RFOiBQYXNzaW5nIGluIG1lZGlhU2V0IGluc3RlYWQgb2YgbWVkaWFTZXQncyBTZWdtZW50TGlzdCBBcnJheSBzaW5jZSBzb3J0IGlzIGRlc3RydWN0aXZlIGFuZCBkb24ndCB3YW50IHRvIGNsb25lLlxuLy8gICAgICBBbHNvIGFsbG93cyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eSBvZiBmbi5cbmZ1bmN0aW9uIHNlbGVjdFNlZ21lbnRMaXN0KG1lZGlhU2V0LCBkYXRhKSB7XG4gICAgdmFyIGRvd25sb2FkUmF0ZVJhdGlvID0gZGF0YS5kb3dubG9hZFJhdGVSYXRpbyxcbiAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gZGF0YS5jdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGgsXG4gICAgICAgIHdpZHRoID0gZGF0YS53aWR0aCxcbiAgICAgICAgaGVpZ2h0ID0gZGF0YS5oZWlnaHQsXG4gICAgICAgIHNvcnRlZEJ5QmFuZHdpZHRoID0gbWVkaWFTZXQuZ2V0U2VnbWVudExpc3RzKCkuc29ydChjb21wYXJlU2VnbWVudExpc3RzQnlCYW5kd2lkdGhBc2NlbmRpbmcpLFxuICAgICAgICBmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlLFxuICAgICAgICBmaWx0ZXJlZEJ5UmVzb2x1dGlvbixcbiAgICAgICAgcHJvcG9zZWRTZWdtZW50TGlzdDtcblxuICAgIGZ1bmN0aW9uIGZpbHRlckJ5UmVzb2x1dGlvbihzZWdtZW50TGlzdCkge1xuICAgICAgICByZXR1cm4gZmlsdGVyU2VnbWVudExpc3RzQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0LCB3aWR0aCwgaGVpZ2h0KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCkge1xuICAgICAgICByZXR1cm4gZmlsdGVyU2VnbWVudExpc3RzQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QsIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCwgZG93bmxvYWRSYXRlUmF0aW8pO1xuICAgIH1cblxuICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUgPSBzb3J0ZWRCeUJhbmR3aWR0aC5maWx0ZXIoZmlsdGVyQnlEb3dubG9hZFJhdGUpO1xuICAgIGZpbHRlcmVkQnlSZXNvbHV0aW9uID0gZmlsdGVyZWRCeURvd25sb2FkUmF0ZS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZykuZmlsdGVyKGZpbHRlckJ5UmVzb2x1dGlvbik7XG5cbiAgICBwcm9wb3NlZFNlZ21lbnRMaXN0ID0gZmlsdGVyZWRCeVJlc29sdXRpb25bZmlsdGVyZWRCeVJlc29sdXRpb24ubGVuZ3RoIC0gMV0gfHwgc29ydGVkQnlCYW5kd2lkdGhbMF07XG5cbiAgICByZXR1cm4gcHJvcG9zZWRTZWdtZW50TGlzdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzZWxlY3RTZWdtZW50TGlzdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGlzTnVtYmVyID0gcmVxdWlyZSgnLi4vdXRpbC9pc051bWJlci5qcycpLFxuICAgIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpO1xuXG5mdW5jdGlvbiBjcmVhdGVUaW1lUmFuZ2VPYmplY3Qoc291cmNlQnVmZmVyLCBpbmRleCwgdHJhbnNmb3JtRm4pIHtcbiAgICBpZiAoIWlzRnVuY3Rpb24odHJhbnNmb3JtRm4pKSB7XG4gICAgICAgIHRyYW5zZm9ybUZuID0gZnVuY3Rpb24odGltZSkgeyByZXR1cm4gdGltZTsgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRTdGFydDogZnVuY3Rpb24oKSB7IHJldHVybiB0cmFuc2Zvcm1Gbihzb3VyY2VCdWZmZXIuYnVmZmVyZWQuc3RhcnQoaW5kZXgpKTsgfSxcbiAgICAgICAgZ2V0RW5kOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRyYW5zZm9ybUZuKHNvdXJjZUJ1ZmZlci5idWZmZXJlZC5lbmQoaW5kZXgpKTsgfSxcbiAgICAgICAgZ2V0SW5kZXg6IGZ1bmN0aW9uKCkgeyByZXR1cm4gaW5kZXg7IH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdWZmZXJlZFRpbWVSYW5nZUxpc3Qoc291cmNlQnVmZmVyLCB0cmFuc2Zvcm1Gbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldExlbmd0aDogZnVuY3Rpb24oKSB7IHJldHVybiBzb3VyY2VCdWZmZXIuYnVmZmVyZWQubGVuZ3RoOyB9LFxuICAgICAgICBnZXRUaW1lUmFuZ2VCeUluZGV4OiBmdW5jdGlvbihpbmRleCkgeyByZXR1cm4gY3JlYXRlVGltZVJhbmdlT2JqZWN0KHNvdXJjZUJ1ZmZlciwgaW5kZXgsIHRyYW5zZm9ybUZuKTsgfSxcbiAgICAgICAgZ2V0VGltZVJhbmdlQnlUaW1lOiBmdW5jdGlvbih0aW1lLCB0b2xlcmFuY2UpIHtcbiAgICAgICAgICAgIGlmICghaXNOdW1iZXIodG9sZXJhbmNlKSkgeyB0b2xlcmFuY2UgPSAwLjE1OyB9XG4gICAgICAgICAgICB2YXIgdGltZVJhbmdlT2JqLFxuICAgICAgICAgICAgICAgIGksXG4gICAgICAgICAgICAgICAgbGVuZ3RoID0gc291cmNlQnVmZmVyLmJ1ZmZlcmVkLmxlbmd0aDtcblxuICAgICAgICAgICAgZm9yIChpPTA7IGk8bGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB0aW1lUmFuZ2VPYmogPSBjcmVhdGVUaW1lUmFuZ2VPYmplY3Qoc291cmNlQnVmZmVyLCBpLCB0cmFuc2Zvcm1Gbik7XG4gICAgICAgICAgICAgICAgaWYgKCh0aW1lUmFuZ2VPYmouZ2V0U3RhcnQoKSAtIHRvbGVyYW5jZSkgPiB0aW1lKSB7IHJldHVybiBudWxsOyB9XG4gICAgICAgICAgICAgICAgaWYgKCh0aW1lUmFuZ2VPYmouZ2V0RW5kKCkgKyB0b2xlcmFuY2UpID4gdGltZSkgeyByZXR1cm4gdGltZVJhbmdlT2JqOyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQWxpZ25lZEJ1ZmZlcmVkVGltZVJhbmdlTGlzdChzb3VyY2VCdWZmZXIsIHNlZ21lbnREdXJhdGlvbikge1xuICAgIGZ1bmN0aW9uIHRpbWVBbGlnblRyYW5zZm9ybUZuKHRpbWUpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucm91bmQodGltZSAvIHNlZ21lbnREdXJhdGlvbikgKiBzZWdtZW50RHVyYXRpb247XG4gICAgfVxuXG4gICAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcmVkVGltZVJhbmdlTGlzdChzb3VyY2VCdWZmZXIsIHRpbWVBbGlnblRyYW5zZm9ybUZuKTtcbn1cblxuLyoqXG4gKiBTb3VyY2VCdWZmZXJEYXRhUXVldWUgYWRkcy9xdWV1ZXMgc2VnbWVudHMgdG8gdGhlIGNvcnJlc3BvbmRpbmcgTVNFIFNvdXJjZUJ1ZmZlciAoTk9URTogVGhlcmUgc2hvdWxkIGJlIG9uZSBwZXIgbWVkaWEgdHlwZS9tZWRpYSBzZXQpXG4gKlxuICogQHBhcmFtIHNvdXJjZUJ1ZmZlciB7U291cmNlQnVmZmVyfSAgIE1TRSBTb3VyY2VCdWZmZXIgaW5zdGFuY2VcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgdHlwZT9cbiAgICBpZiAoIXNvdXJjZUJ1ZmZlcikgeyB0aHJvdyBuZXcgRXJyb3IoICdUaGUgc291cmNlQnVmZmVyIGNvbnN0cnVjdG9yIGFyZ3VtZW50IGNhbm5vdCBiZSBudWxsLicgKTsgfVxuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBkYXRhUXVldWUgPSBbXTtcbiAgICAvLyBUT0RPOiBmaWd1cmUgb3V0IGhvdyB3ZSB3YW50IHRvIHJlc3BvbmQgdG8gb3RoZXIgZXZlbnQgc3RhdGVzICh1cGRhdGVlbmQ/IGVycm9yPyBhYm9ydD8pIChyZXRyeT8gcmVtb3ZlPylcbiAgICBzb3VyY2VCdWZmZXIuYWRkRXZlbnRMaXN0ZW5lcigndXBkYXRlZW5kJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgLy8gVGhlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZSdzIHVwZGF0aW5nIHByb3BlcnR5IHNob3VsZCBhbHdheXMgYmUgZmFsc2UgaWYgdGhpcyBldmVudCB3YXMgZGlzcGF0Y2hlZCxcbiAgICAgICAgLy8gYnV0IGp1c3QgaW4gY2FzZS4uLlxuICAgICAgICBpZiAoZXZlbnQudGFyZ2V0LnVwZGF0aW5nKSB7IHJldHVybjsgfVxuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9BRERFRF9UT19CVUZGRVIsIHRhcmdldDpzZWxmIH0pO1xuXG4gICAgICAgIGlmIChzZWxmLl9fZGF0YVF1ZXVlLmxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKHNlbGYuX19kYXRhUXVldWUuc2hpZnQoKSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gZGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXIgPSBzb3VyY2VCdWZmZXI7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBRVUVVRV9FTVBUWTogJ3F1ZXVlRW1wdHknLFxuICAgIFNFR01FTlRfQURERURfVE9fQlVGRkVSOiAnc2VnbWVudEFkZGVkVG9CdWZmZXInXG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmFkZFRvUXVldWUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIGRhdGFUb0FkZEltbWVkaWF0ZWx5O1xuICAgIGlmICghZXhpc3R5KGRhdGEpIHx8IChpc0FycmF5KGRhdGEpICYmIGRhdGEubGVuZ3RoIDw9IDApKSB7IHJldHVybjsgfVxuICAgIC8vIFRyZWF0IGFsbCBkYXRhIGFzIGFycmF5cyB0byBtYWtlIHN1YnNlcXVlbnQgZnVuY3Rpb25hbGl0eSBnZW5lcmljLlxuICAgIGlmICghaXNBcnJheShkYXRhKSkgeyBkYXRhID0gW2RhdGFdOyB9XG4gICAgLy8gSWYgbm90aGluZyBpcyBpbiB0aGUgcXVldWUsIGdvIGFoZWFkIGFuZCBpbW1lZGlhdGVseSBhcHBlbmQgdGhlIGZpcnN0IGRhdGEgdG8gdGhlIHNvdXJjZSBidWZmZXIuXG4gICAgaWYgKCh0aGlzLl9fZGF0YVF1ZXVlLmxlbmd0aCA9PT0gMCkgJiYgKCF0aGlzLl9fc291cmNlQnVmZmVyLnVwZGF0aW5nKSkgeyBkYXRhVG9BZGRJbW1lZGlhdGVseSA9IGRhdGEuc2hpZnQoKTsgfVxuICAgIC8vIElmIGFueSBvdGhlciBkYXRhIChzdGlsbCkgZXhpc3RzLCBwdXNoIHRoZSByZXN0IG9udG8gdGhlIGRhdGFRdWV1ZS5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gdGhpcy5fX2RhdGFRdWV1ZS5jb25jYXQoZGF0YSk7XG4gICAgaWYgKGV4aXN0eShkYXRhVG9BZGRJbW1lZGlhdGVseSkpIHsgdGhpcy5fX3NvdXJjZUJ1ZmZlci5hcHBlbmRCdWZmZXIoZGF0YVRvQWRkSW1tZWRpYXRlbHkpOyB9XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmNsZWFyUXVldWUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gW107XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBjcmVhdGVCdWZmZXJlZFRpbWVSYW5nZUxpc3QodGhpcy5fX3NvdXJjZUJ1ZmZlcik7XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdEFsaWduZWRUb1NlZ21lbnREdXJhdGlvbiA9IGZ1bmN0aW9uKHNlZ21lbnREdXJhdGlvbikge1xuICAgIHJldHVybiBjcmVhdGVBbGlnbmVkQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHRoaXMuX19zb3VyY2VCdWZmZXIsIHNlZ21lbnREdXJhdGlvbik7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlQnVmZmVyRGF0YVF1ZXVlOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gZXhpc3R5KHgpIHsgcmV0dXJuICh4ICE9PSBudWxsKSAmJiAoeCAhPT0gdW5kZWZpbmVkKTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV4aXN0eTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIEV4dGVuZCBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgcHJvcGVydGllcyAoYW5kIHRoZWlyIHZhbHVlcykgZm91bmQgaW4gdGhlIHBhc3NlZC1pbiBvYmplY3QocykuXG52YXIgZXh0ZW5kT2JqZWN0ID0gZnVuY3Rpb24ob2JqIC8qLCBleHRlbmRPYmplY3QxLCBleHRlbmRPYmplY3QyLCAuLi4sIGV4dGVuZE9iamVjdE4gKi8pIHtcbiAgICB2YXIgZXh0ZW5kT2JqZWN0c0FycmF5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgaSxcbiAgICAgICAgbGVuZ3RoID0gZXh0ZW5kT2JqZWN0c0FycmF5Lmxlbmd0aCxcbiAgICAgICAgZXh0ZW5kT2JqZWN0O1xuXG4gICAgZm9yKGk9MDsgaTxsZW5ndGg7IGkrKykge1xuICAgICAgICBleHRlbmRPYmplY3QgPSBleHRlbmRPYmplY3RzQXJyYXlbaV07XG4gICAgICAgIGlmIChleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgb2JqW3Byb3BdID0gZXh0ZW5kT2JqZWN0W3Byb3BdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG9iajtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kT2JqZWN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCcuL2lzQXJyYXkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi9pc0Z1bmN0aW9uLmpzJyksXG4gICAgZmluZEVsZW1lbnRJbkFycmF5O1xuXG5maW5kRWxlbWVudEluQXJyYXkgPSBmdW5jdGlvbihhcnJheSwgcHJlZGljYXRlRm4pIHtcbiAgICBpZiAoIWlzQXJyYXkoYXJyYXkpIHx8ICFpc0Z1bmN0aW9uKHByZWRpY2F0ZUZuKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgdmFyIGksXG4gICAgICAgIGxlbmd0aCA9IGFycmF5Lmxlbmd0aCxcbiAgICAgICAgZWxlbTtcblxuICAgIGZvciAoaT0wOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGVsZW0gPSBhcnJheVtpXTtcbiAgICAgICAgaWYgKHByZWRpY2F0ZUZuKGVsZW0sIGksIGFycmF5KSkgeyByZXR1cm4gZWxlbTsgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZpbmRFbGVtZW50SW5BcnJheTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL2V4aXN0eS5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi9pc1N0cmluZy5qcycpLFxuICAgIGZpbmRFbGVtZW50SW5BcnJheSA9IHJlcXVpcmUoJy4vZmluZEVsZW1lbnRJbkFycmF5LmpzJyksXG4gICAgZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlO1xuXG4vKipcbiAqXG4gKiBGdW5jdGlvbiB1c2VkIHRvIGdldCB0aGUgbWVkaWEgdHlwZSBiYXNlZCBvbiB0aGUgbWltZSB0eXBlLiBVc2VkIHRvIGRldGVybWluZSB0aGUgbWVkaWEgdHlwZSBvZiBBZGFwdGF0aW9uIFNldHNcbiAqIG9yIGNvcnJlc3BvbmRpbmcgZGF0YSByZXByZXNlbnRhdGlvbnMuXG4gKlxuICogQHBhcmFtIG1pbWVUeXBlIHtzdHJpbmd9IG1pbWUgdHlwZSBmb3IgYSBEQVNIIE1QRCBBZGFwdGF0aW9uIFNldCAoc3BlY2lmaWVkIGFzIGFuIGF0dHJpYnV0ZSBzdHJpbmcpXG4gKiBAcGFyYW0gdHlwZXMge3N0cmluZ30gICAgc3VwcG9ydGVkIG1lZGlhIHR5cGVzIChlLmcuICd2aWRlbywnICdhdWRpbywnKVxuICogQHJldHVybnMge3N0cmluZ30gICAgICAgIHRoZSBtZWRpYSB0eXBlIHRoYXQgY29ycmVzcG9uZHMgdG8gdGhlIG1pbWUgdHlwZS5cbiAqL1xuZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlID0gZnVuY3Rpb24obWltZVR5cGUsIHR5cGVzKSB7XG4gICAgaWYgKCFpc1N0cmluZyhtaW1lVHlwZSkpIHsgcmV0dXJuIG51bGw7IH0gICAvLyBUT0RPOiBUaHJvdyBlcnJvcj9cbiAgICB2YXIgbWF0Y2hlZFR5cGUgPSBmaW5kRWxlbWVudEluQXJyYXkodHlwZXMsIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgcmV0dXJuICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbWF0Y2hlZFR5cGU7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNBcnJheShvYmopIHtcbiAgICByZXR1cm4gb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJztcbiAgICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzRnVuY3Rpb247IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IE51bWJlcl0nIHx8IGZhbHNlO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzTnVtYmVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNTdHJpbmcgPSBmdW5jdGlvbiBpc1N0cmluZyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBTdHJpbmddJyB8fCBmYWxzZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gaXNTdHJpbmc7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi9leGlzdHkuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gdHJ1dGh5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gVE9ETzogUmVmYWN0b3IgdG8gc2VwYXJhdGUganMgZmlsZXMgJiBtb2R1bGVzICYgcmVtb3ZlIGZyb20gaGVyZS5cblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4vdXRpbC9pc1N0cmluZy5qcycpO1xuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxuZnVuY3Rpb24gcHJlQXBwbHlBcmdzRm4oZnVuIC8qLCBhcmdzICovKSB7XG4gICAgdmFyIHByZUFwcGxpZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAvLyBOT1RFOiB0aGUgKnRoaXMqIHJlZmVyZW5jZSB3aWxsIHJlZmVyIHRvIHRoZSBjbG9zdXJlJ3MgY29udGV4dCB1bmxlc3NcbiAgICAvLyB0aGUgcmV0dXJuZWQgZnVuY3Rpb24gaXMgaXRzZWxmIGNhbGxlZCB2aWEgLmNhbGwoKSBvciAuYXBwbHkoKS4gSWYgeW91XG4gICAgLy8gKm5lZWQqIHRvIHJlZmVyIHRvIGluc3RhbmNlLWxldmVsIHByb3BlcnRpZXMsIGRvIHNvbWV0aGluZyBsaWtlIHRoZSBmb2xsb3dpbmc6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IGZ1bmN0aW9uKGFyZ0MpIHsgcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKS5jYWxsKHRoaXMpOyB9O1xuICAgIC8vXG4gICAgLy8gT3RoZXJ3aXNlLCB5b3Ugc2hvdWxkIGJlIGFibGUgdG8ganVzdCBjYWxsOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pO1xuICAgIC8vXG4gICAgLy8gV2hlcmUgcG9zc2libGUsIGZ1bmN0aW9ucyBhbmQgbWV0aG9kcyBzaG91bGQgbm90IGJlIHJlYWNoaW5nIG91dCB0byBnbG9iYWwgc2NvcGUgYW55d2F5LCBzby4uLlxuICAgIHJldHVybiBmdW5jdGlvbigpIHsgcmV0dXJuIGZ1bi5hcHBseSh0aGlzLCBwcmVBcHBsaWVkQXJncyk7IH07XG59XG5cbi8vIEhpZ2hlci1vcmRlciBYTUwgZnVuY3Rpb25zXG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50c1xudmFyIGdldEFuY2VzdG9ycyA9IGZ1bmN0aW9uKGVsZW0sIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgKGZ1bmN0aW9uIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSwgYW5jZXN0b3JzKSkgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKGV4aXN0eShlbGVtKSAmJiBleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkge1xuICAgICAgICAgICAgYW5jZXN0b3JzLnB1c2goZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgICAgIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfSkoZWxlbSk7XG4gICAgcmV0dXJuIGFuY2VzdG9ycztcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXROb2RlTGlzdEJ5TmFtZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oeG1sT2JqKSB7XG4gICAgICAgIHJldHVybiB4bWxPYmouZ2V0RWxlbWVudHNCeVRhZ05hbWUobmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBoYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lLCB2YWx1ZSkge1xuICAgIGlmICgodHlwZW9mIGF0dHJOYW1lICE9PSAnc3RyaW5nJykgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgaWYgKCFleGlzdHkodmFsdWUpKSB7IHJldHVybiBlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgcmV0dXJuIChlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSkgPT09IHZhbHVlKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEF0dHJGbiA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhdHRyTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbi8vIFRPRE86IEFkZCBzaG91bGRTdG9wUHJlZCAoc2hvdWxkIGZ1bmN0aW9uIHNpbWlsYXJseSB0byBzaG91bGRTdG9wUHJlZCBpbiBnZXRJbmhlcml0YWJsZUVsZW1lbnQsIGJlbG93KVxudmFyIGdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhhdHRyTmFtZSkpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKSkgeyByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50czsgUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEluaGVyaXRhYmxlRWxlbWVudCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHJldHVybiBmdW5jdGlvbiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBtYXRjaGluZ0VsZW1MaXN0ID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSk7XG4gICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtTGlzdCkgJiYgbWF0Y2hpbmdFbGVtTGlzdC5sZW5ndGggPiAwKSB7IHJldHVybiBtYXRjaGluZ0VsZW1MaXN0WzBdOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG52YXIgZ2V0Q2hpbGRFbGVtZW50QnlOb2RlTmFtZSA9IGZ1bmN0aW9uKG5vZGVOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgdmFyIGluaXRpYWxNYXRjaGVzID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSksXG4gICAgICAgICAgICBjdXJyZW50RWxlbTtcbiAgICAgICAgaWYgKCFleGlzdHkoaW5pdGlhbE1hdGNoZXMpIHx8IGluaXRpYWxNYXRjaGVzLmxlbmd0aCA8PSAwKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgY3VycmVudEVsZW0gPSBpbml0aWFsTWF0Y2hlc1swXTtcbiAgICAgICAgcmV0dXJuIChjdXJyZW50RWxlbS5wYXJlbnROb2RlID09PSBlbGVtKSA/IGN1cnJlbnRFbGVtIDogdW5kZWZpbmVkO1xuICAgIH07XG59O1xuXG52YXIgZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0ID0gZnVuY3Rpb24obm9kZU5hbWUsIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgdmFyIGdldE1hdGNoaW5nQ2hpbGROb2RlRm4gPSBnZXRDaGlsZEVsZW1lbnRCeU5vZGVOYW1lKG5vZGVOYW1lKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICB2YXIgY3VycmVudEVsZW0gPSBlbGVtLFxuICAgICAgICAgICAgbXVsdGlMZXZlbEVsZW1MaXN0ID0gW10sXG4gICAgICAgICAgICBtYXRjaGluZ0VsZW07XG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugdy9yZWN1cnNpdmUgZm4/XG4gICAgICAgIHdoaWxlIChleGlzdHkoY3VycmVudEVsZW0pICYmICFzaG91bGRTdG9wUHJlZChjdXJyZW50RWxlbSkpIHtcbiAgICAgICAgICAgIG1hdGNoaW5nRWxlbSA9IGdldE1hdGNoaW5nQ2hpbGROb2RlRm4oY3VycmVudEVsZW0pO1xuICAgICAgICAgICAgaWYgKGV4aXN0eShtYXRjaGluZ0VsZW0pKSB7IG11bHRpTGV2ZWxFbGVtTGlzdC5wdXNoKG1hdGNoaW5nRWxlbSk7IH1cbiAgICAgICAgICAgIGN1cnJlbnRFbGVtID0gY3VycmVudEVsZW0ucGFyZW50Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtdWx0aUxldmVsRWxlbUxpc3QubGVuZ3RoID4gMCA/IG11bHRpTGV2ZWxFbGVtTGlzdCA6IHVuZGVmaW5lZDtcbiAgICB9O1xufTtcblxuLy8gVE9ETzogSW1wbGVtZW50IG1lIGZvciBCYXNlVVJMIG9yIHVzZSBleGlzdGluZyBmbiAoU2VlOiBtcGQuanMgYnVpbGRCYXNlVXJsKCkpXG4vKnZhciBidWlsZEhpZXJhcmNoaWNhbGx5U3RydWN0dXJlZFZhbHVlID0gZnVuY3Rpb24odmFsdWVGbiwgYnVpbGRGbiwgc3RvcFByZWQpIHtcblxufTsqL1xuXG4vLyBQdWJsaXNoIEV4dGVybmFsIEFQSTpcbnZhciB4bWxmdW4gPSB7fTtcbnhtbGZ1bi5leGlzdHkgPSBleGlzdHk7XG54bWxmdW4udHJ1dGh5ID0gdHJ1dGh5O1xuXG54bWxmdW4uZ2V0Tm9kZUxpc3RCeU5hbWUgPSBnZXROb2RlTGlzdEJ5TmFtZTtcbnhtbGZ1bi5oYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGhhc01hdGNoaW5nQXR0cmlidXRlO1xueG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0QW5jZXN0b3JzID0gZ2V0QW5jZXN0b3JzO1xueG1sZnVuLmdldEF0dHJGbiA9IGdldEF0dHJGbjtcbnhtbGZ1bi5wcmVBcHBseUFyZ3NGbiA9IHByZUFwcGx5QXJnc0ZuO1xueG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCA9IGdldEluaGVyaXRhYmxlRWxlbWVudDtcbnhtbGZ1bi5nZXRNdWx0aUxldmVsRWxlbWVudExpc3QgPSBnZXRNdWx0aUxldmVsRWxlbWVudExpc3Q7XG5cbm1vZHVsZS5leHBvcnRzID0geG1sZnVuOyJdfQ==
