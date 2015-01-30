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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVNldC5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvZmluZEVsZW1lbnRJbkFycmF5LmpzIiwic3JjL2pzL3V0aWwvZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlLmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZLQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJpZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gd2luZG93O1xufSBlbHNlIGlmICh0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBnbG9iYWw7XG59IGVsc2UgaWYgKHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiKXtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHNlbGY7XG59IGVsc2Uge1xuICAgIG1vZHVsZS5leHBvcnRzID0ge307XG59XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlID0gcmVxdWlyZSgnLi91dGlsL2dldE1lZGlhVHlwZUZyb21NaW1lVHlwZS5qcycpLFxuICAgIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24gPSByZXF1aXJlKCcuL2Rhc2gvc2VnbWVudHMvZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbi5qcycpLFxuICAgIGZpbmRFbGVtZW50SW5BcnJheSA9IHJlcXVpcmUoJy4vdXRpbC9maW5kRWxlbWVudEluQXJyYXkuanMnKSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NZWRpYVR5cGVzLmpzJyk7XG5cbi8qKlxuICpcbiAqIFByaW1hcnkgZGF0YSB2aWV3IGZvciByZXByZXNlbnRpbmcgdGhlIHNldCBvZiBzZWdtZW50IGxpc3RzIGFuZCBvdGhlciBnZW5lcmFsIGluZm9ybWF0aW9uIGZvciBhIGdpdmUgbWVkaWEgdHlwZVxuICogKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKS5cbiAqXG4gKiBAcGFyYW0gYWRhcHRhdGlvblNldCBUaGUgTVBFRy1EQVNIIGNvcnJlbGF0ZSBmb3IgYSBnaXZlbiBtZWRpYSBzZXQsIGNvbnRhaW5pbmcgc29tZSB3YXkgb2YgcmVwcmVzZW50YXRpbmcgc2VnbWVudCBsaXN0c1xuICogICAgICAgICAgICAgICAgICAgICAgYW5kIGEgc2V0IG9mIHJlcHJlc2VudGF0aW9ucyBmb3IgZWFjaCBzdHJlYW0gdmFyaWFudC5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNZWRpYVNldChhZGFwdGF0aW9uU2V0KSB7XG4gICAgLy8gVE9ETzogQWRkaXRpb25hbCBjaGVja3MgJiBFcnJvciBUaHJvd2luZ1xuICAgIHRoaXMuX19hZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldDtcbn1cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uIGdldE1lZGlhVHlwZSgpIHtcbiAgICB2YXIgdHlwZSA9IGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSh0aGlzLmdldE1pbWVUeXBlKCksIG1lZGlhVHlwZXMpO1xuICAgIHJldHVybiB0eXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1pbWVUeXBlID0gZnVuY3Rpb24gZ2V0TWltZVR5cGUoKSB7XG4gICAgdmFyIG1pbWVUeXBlID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKTtcbiAgICByZXR1cm4gbWltZVR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyVHlwZSA9IGZ1bmN0aW9uIGdldFNvdXJjZUJ1ZmZlclR5cGUoKSB7XG4gICAgLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZSBjb2RlY3MgYXNzb2NpYXRlZCB3aXRoIGVhY2ggc3RyZWFtIHZhcmlhbnQvcmVwcmVzZW50YXRpb25cbiAgICAvLyB3aWxsIGJlIHNpbWlsYXIgZW5vdWdoIHRoYXQgeW91IHdvbid0IGhhdmUgdG8gcmUtY3JlYXRlIHRoZSBzb3VyY2UtYnVmZmVyIHdoZW4gc3dpdGNoaW5nXG4gICAgLy8gYmV0d2VlbiB0aGVtLlxuXG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbik7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0LmdldFR5cGUoKTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0VG90YWxEdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKTtcbiAgICByZXR1cm4gdG90YWxEdXJhdGlvbjtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgd2FsbENsb2NrVGltZSA9IHNlZ21lbnRMaXN0LmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSgpO1xuICAgIHJldHVybiB3YWxsQ2xvY2tUaW1lO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VG90YWxTZWdtZW50Q291bnQgPSBmdW5jdGlvbiBnZXRUb3RhbFNlZ21lbnRDb3VudCgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxTZWdtZW50Q291bnQgPSBzZWdtZW50TGlzdC5nZXRUb3RhbFNlZ21lbnRDb3VudCgpO1xuICAgIHJldHVybiB0b3RhbFNlZ21lbnRDb3VudDtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50RHVyYXRpb24gPSBmdW5jdGlvbiBnZXRTZWdtZW50RHVyYXRpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnREdXJhdGlvbigpO1xuICAgIHJldHVybiBzZWdtZW50RHVyYXRpb247XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RTdGFydE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBzZWdtZW50TGlzdC5nZXRTdGFydE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0RW5kTnVtYmVyID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnRMaXN0RW5kTnVtYmVyID0gc2VnbWVudExpc3QuZ2V0RW5kTnVtYmVyKCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0RW5kTnVtYmVyO1xufTtcblxuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RzID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RzKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKSxcbiAgICAgICAgc2VnbWVudExpc3RzID0gcmVwcmVzZW50YXRpb25zLm1hcChnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RzO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKSxcbiAgICAgICAgcmVwcmVzZW50YXRpb25XaXRoQmFuZHdpZHRoTWF0Y2ggPSBmaW5kRWxlbWVudEluQXJyYXkocmVwcmVzZW50YXRpb25zLCBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgdmFyIHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCk7XG4gICAgICAgICAgICByZXR1cm4gKE51bWJlcihyZXByZXNlbnRhdGlvbkJhbmR3aWR0aCkgPT09IE51bWJlcihiYW5kd2lkdGgpKTtcbiAgICAgICAgfSksXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbiBnZXRBdmFpbGFibGVCYW5kd2lkdGhzKCkge1xuICAgIHJldHVybiB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKS5tYXAoXG4gICAgICAgIGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbiAgICAgICAgfSkuZmlsdGVyKFxuICAgICAgICBmdW5jdGlvbihiYW5kd2lkdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKTtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhU2V0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIC8vIFRPRE86IERldGVybWluZSBhcHByb3ByaWF0ZSBkZWZhdWx0IHNpemUgKG9yIGJhc2Ugb24gc2VnbWVudCBuIHggc2l6ZS9kdXJhdGlvbj8pXG4gICAgLy8gTXVzdCBjb25zaWRlciBBQlIgU3dpdGNoaW5nICYgVmlld2luZyBleHBlcmllbmNlIG9mIGFscmVhZHktYnVmZmVyZWQgc2VnbWVudHMuXG4gICAgTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUgPSAyMCxcbiAgICBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSA9IDQwO1xuXG52YXIgd2FpdFRpbWVUb1JlY2hlY2tMaXZlID0gZnVuY3Rpb24oY3VycmVudFRpbWUsIGJ1ZmZlcmVkVGltZVJhbmdlcywgc2VnbWVudExpc3QpIHtcbiAgICB2YXIgY3VycmVudFJhbmdlID0gZmluZFRpbWVSYW5nZUVkZ2UoY3VycmVudFRpbWUsIGJ1ZmZlcmVkVGltZVJhbmdlcyksXG4gICAgICAgIG5leHRTZWdtZW50LFxuICAgICAgICBzYWZlTGl2ZUVkZ2UsXG4gICAgICAgIHRpbWVQYXN0U2FmZUxpdmVFZGdlO1xuXG4gICAgaWYgKCFleGlzdHkoY3VycmVudFJhbmdlKSkgeyByZXR1cm4gMDsgfVxuXG4gICAgbmV4dFNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKGN1cnJlbnRSYW5nZS5nZXRFbmQoKSk7XG4gICAgc2FmZUxpdmVFZGdlID0gKERhdGUubm93KCkgLSAoc2VnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCkgKiAxMDAwKSk7XG4gICAgdGltZVBhc3RTYWZlTGl2ZUVkZ2UgPSBuZXh0U2VnbWVudC5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUoKSAtIHNhZmVMaXZlRWRnZTtcblxuICAgIGlmICh0aW1lUGFzdFNhZmVMaXZlRWRnZSA8IDAuMDAzKSB7IHJldHVybiAwOyB9XG5cbiAgICByZXR1cm4gdGltZVBhc3RTYWZlTGl2ZUVkZ2U7XG59O1xuXG52YXIgbmV4dFNlZ21lbnRUb0xvYWQgPSBmdW5jdGlvbihjdXJyZW50VGltZSwgYnVmZmVyZWRUaW1lUmFuZ2VzLCBzZWdtZW50TGlzdCkge1xuICAgIHZhciBjdXJyZW50UmFuZ2UgPSBmaW5kVGltZVJhbmdlRWRnZShjdXJyZW50VGltZSwgYnVmZmVyZWRUaW1lUmFuZ2VzKSxcbiAgICAgICAgc2VnbWVudFRvTG9hZDtcblxuICAgIGlmIChleGlzdHkoY3VycmVudFJhbmdlKSkge1xuICAgICAgICBzZWdtZW50VG9Mb2FkID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShjdXJyZW50UmFuZ2UuZ2V0RW5kKCkpO1xuICAgIH0gZWxzZSBpZiAoc2VnbWVudExpc3QuZ2V0SXNMaXZlKCkpIHtcbiAgICAgICAgc2VnbWVudFRvTG9hZCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWUoRGF0ZS5ub3coKSAtIChzZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKSAqIDEwMDApKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBPdGhlcndpc2UgKGkuZS4gaWYgVk9EL3N0YXRpYyBzdHJlYW1zLCBnZXQgdGhlIHNlZ21lbnQgQCBjdXJyZW50VGltZSkuXG4gICAgICAgIHNlZ21lbnRUb0xvYWQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKGN1cnJlbnRUaW1lKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnbWVudFRvTG9hZDtcbn07XG5cbnZhciBmaW5kVGltZVJhbmdlRWRnZSA9IGZ1bmN0aW9uKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMpIHtcbiAgICB2YXIgY3VycmVudFJhbmdlID0gYnVmZmVyZWRUaW1lUmFuZ2VzLmdldFRpbWVSYW5nZUJ5VGltZShjdXJyZW50VGltZSksXG4gICAgICAgIGksXG4gICAgICAgIGxlbmd0aCxcbiAgICAgICAgdGltZVJhbmdlVG9DaGVjaztcblxuICAgIGlmICghZXhpc3R5KGN1cnJlbnRSYW5nZSkpIHsgcmV0dXJuIGN1cnJlbnRSYW5nZTsgfVxuXG4gICAgaSA9IGN1cnJlbnRSYW5nZS5nZXRJbmRleCgpICsgMTtcbiAgICBsZW5ndGggPSBidWZmZXJlZFRpbWVSYW5nZXMuZ2V0TGVuZ3RoKCk7XG5cbiAgICBmb3IgKDtpPGxlbmd0aDtpKyspIHtcbiAgICAgICAgdGltZVJhbmdlVG9DaGVjayA9IGJ1ZmZlcmVkVGltZVJhbmdlcy5nZXRUaW1lUmFuZ2VCeUluZGV4KGkpO1xuICAgICAgICBpZigodGltZVJhbmdlVG9DaGVjay5nZXRTdGFydCgpIC0gY3VycmVudFJhbmdlLmdldEVuZCgpKSA+IDAuMDAzKSB7IGJyZWFrOyB9XG4gICAgICAgIGN1cnJlbnRSYW5nZSA9IHRpbWVSYW5nZVRvQ2hlY2s7XG4gICAgfVxuXG4gICAgcmV0dXJuIGN1cnJlbnRSYW5nZTtcbn07XG5cbi8qKlxuICpcbiAqIE1lZGlhVHlwZUxvYWRlciBjb29yZGluYXRlcyBiZXR3ZWVuIHNlZ21lbnQgZG93bmxvYWRpbmcgYW5kIGFkZGluZyBzZWdtZW50cyB0byB0aGUgTVNFIHNvdXJjZSBidWZmZXIgZm9yIGEgZ2l2ZW4gbWVkaWEgdHlwZSAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpLlxuICpcbiAqIEBwYXJhbSBzZWdtZW50TG9hZGVyIHtTZWdtZW50TG9hZGVyfSAgICAgICAgICAgICAgICAgb2JqZWN0IGluc3RhbmNlIHRoYXQgaGFuZGxlcyBkb3dubG9hZGluZyBzZWdtZW50cyBmb3IgdGhlIG1lZGlhIHNldFxuICogQHBhcmFtIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSB7U291cmNlQnVmZmVyRGF0YVF1ZXVlfSBvYmplY3QgaW5zdGFuY2UgdGhhdCBoYW5kbGVzIGFkZGluZyBzZWdtZW50cyB0byBNU0UgU291cmNlQnVmZmVyXG4gKiBAcGFyYW0gbWVkaWFUeXBlIHtzdHJpbmd9ICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIG1lZGlhIHR5cGUgKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKSBmb3IgdGhlIG1lZGlhIHNldFxuICogQHBhcmFtIHRlY2gge29iamVjdH0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIGluc3RhbmNlLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIE1lZGlhVHlwZUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSwgdGVjaCkge1xuICAgIHRoaXMuX19zZWdtZW50TG9hZGVyID0gc2VnbWVudExvYWRlcjtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUkVDSEVDS19TRUdNRU5UX0xPQURJTkc6ICdyZWNoZWNrU2VnbWVudExvYWRpbmcnLFxuICAgIFJFQ0hFQ0tfQ1VSUkVOVF9TRUdNRU5UX0xJU1Q6ICdyZWNoZWNrQ3VycmVudFNlZ21lbnRMaXN0J1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19tZWRpYVR5cGU7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U2VnbWVudExvYWRlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXI7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlOyB9O1xuXG4vKipcbiAqIEtpY2tzIG9mZiBzZWdtZW50IGxvYWRpbmcgZm9yIHRoZSBtZWRpYSBzZXRcbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdGFydExvYWRpbmdTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBub3dVVEM7XG5cbiAgICAvLyBFdmVudCBsaXN0ZW5lciBmb3IgcmVjaGVja2luZyBzZWdtZW50IGxvYWRpbmcuIFRoaXMgZXZlbnQgaXMgZmlyZWQgd2hlbmV2ZXIgYSBzZWdtZW50IGhhcyBiZWVuIHN1Y2Nlc3NmdWxseVxuICAgIC8vIGRvd25sb2FkZWQgYW5kIGFkZGVkIHRvIHRoZSBidWZmZXIgb3IsIGlmIG5vdCBjdXJyZW50bHkgbG9hZGluZyBzZWdtZW50cyAoYmVjYXVzZSB0aGUgYnVmZmVyIGlzIHN1ZmZpY2llbnRseSBmdWxsXG4gICAgLy8gcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcGxheWJhY2sgdGltZSksIHdoZW5ldmVyIHNvbWUgYW1vdW50IG9mIHRpbWUgaGFzIGVsYXBzZWQgYW5kIHdlIHNob3VsZCBjaGVjayBvbiB0aGUgYnVmZmVyXG4gICAgLy8gc3RhdGUgYWdhaW4uXG4gICAgLy8gTk9URTogU3RvcmUgYSByZWZlcmVuY2UgdG8gdGhlIGV2ZW50IGhhbmRsZXIgdG8gcG90ZW50aWFsbHkgcmVtb3ZlIGl0IGxhdGVyLlxuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgc2VsZi5fX2NoZWNrU2VnbWVudExvYWRpbmcoc2VsZi5fX3RlY2guY3VycmVudFRpbWUoKSwgTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUsIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFKTtcbiAgICB9O1xuXG4gICAgdGhpcy5vbih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuICAgIHRoaXMuX190ZWNoLm9uKCdzZWVraW5nJywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuXG4gICAgaWYgKHRoaXMuX19zZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldElzTGl2ZSgpKSB7XG4gICAgICAgIG5vd1VUQyA9IERhdGUubm93KCk7XG4gICAgICAgIHRoaXMub25lKHRoaXMuZXZlbnRMaXN0LlJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIHNlZyA9IHNlbGYuX19zZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWUobm93VVRDKSxcbiAgICAgICAgICAgICAgICBzZWdVVENTdGFydFRpbWUgPSBzZWcuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lKCksXG4gICAgICAgICAgICAgICAgdGltZU9mZnNldCA9IChub3dVVEMgLSBzZWdVVENTdGFydFRpbWUpLzEwMDAsXG4gICAgICAgICAgICAgICAgc2Vla1RvVGltZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUuZ2V0QnVmZmVyZWRUaW1lUmFuZ2VMaXN0QWxpZ25lZFRvU2VnbWVudER1cmF0aW9uKHNlZy5nZXREdXJhdGlvbigpKS5nZXRUaW1lUmFuZ2VCeUluZGV4KDApLmdldFN0YXJ0KCkgKyB0aW1lT2Zmc2V0O1xuICAgICAgICAgICAgc2VsZi5fX3RlY2guc2V0Q3VycmVudFRpbWUoc2Vla1RvVGltZSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE1hbnVhbGx5IGNoZWNrIG9uIGxvYWRpbmcgc2VnbWVudHMgdGhlIGZpcnN0IHRpbWUgYXJvdW5kLlxuICAgIHRoaXMuX19jaGVja1NlZ21lbnRMb2FkaW5nKHRoaXMuX190ZWNoLmN1cnJlbnRUaW1lKCksIE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLnN0b3BMb2FkaW5nU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcikpIHsgcmV0dXJuOyB9XG5cbiAgICB0aGlzLm9mZih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuICAgIHRoaXMuX190ZWNoLm9mZignc2Vla2luZycsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IHVuZGVmaW5lZDtcbiAgICBpZiAoZXhpc3R5KHRoaXMuX193YWl0VGltZXJJZCkpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX193YWl0VGltZXJJZCk7XG4gICAgfVxuICAgIHRoaXMuX193YWl0VGltZXJJZCA9IHVuZGVmaW5lZDtcbn07XG5cbnZhciB3YWl0VGltZVRvUmVjaGVja1N0YXRpYyA9IGZ1bmN0aW9uKGN1cnJlbnRUaW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnVmZmVyZWRUaW1lUmFuZ2VzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VnbWVudER1cmF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFzdERvd25sb2FkUm91bmRUcmlwVGltZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1pbkRlc2lyZWRCdWZmZXJTaXplLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICB2YXIgY3VycmVudFJhbmdlID0gZmluZFRpbWVSYW5nZUVkZ2UoY3VycmVudFRpbWUsIGJ1ZmZlcmVkVGltZVJhbmdlcyksXG4gICAgICAgIGJ1ZmZlclNpemU7XG5cbiAgICBpZiAoIWV4aXN0eShjdXJyZW50UmFuZ2UpKSB7IHJldHVybiAwOyB9XG5cbiAgICBidWZmZXJTaXplID0gY3VycmVudFJhbmdlLmdldEVuZCgpIC0gY3VycmVudFRpbWU7XG5cbiAgICBpZiAoYnVmZmVyU2l6ZSA8IG1pbkRlc2lyZWRCdWZmZXJTaXplKSB7IHJldHVybiAwOyB9XG4gICAgZWxzZSBpZiAoYnVmZmVyU2l6ZSA8IG1heERlc2lyZWRCdWZmZXJTaXplKSB7IHJldHVybiAoc2VnbWVudER1cmF0aW9uIC0gbGFzdERvd25sb2FkUm91bmRUcmlwVGltZSkgKiAxMDAwOyB9XG5cbiAgICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLm1pbihzZWdtZW50RHVyYXRpb24sIDIpICogMTAwMCk7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fY2hlY2tTZWdtZW50TG9hZGluZyA9IGZ1bmN0aW9uKGN1cnJlbnRUaW1lLCBtaW5EZXNpcmVkQnVmZmVyU2l6ZSwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICB2YXIgbGFzdERvd25sb2FkUm91bmRUcmlwVGltZSA9IHRoaXMuX19zZWdtZW50TG9hZGVyLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5fX3NlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCksXG4gICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnREdXJhdGlvbigpLFxuICAgICAgICBidWZmZXJlZFRpbWVSYW5nZXMgPSB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdEFsaWduZWRUb1NlZ21lbnREdXJhdGlvbihzZWdtZW50RHVyYXRpb24pLFxuICAgICAgICBpc0xpdmUgPSBzZWdtZW50TGlzdC5nZXRJc0xpdmUoKSxcbiAgICAgICAgd2FpdFRpbWUsXG4gICAgICAgIHNlZ21lbnRUb0Rvd25sb2FkLFxuICAgICAgICBzZWxmID0gdGhpcztcblxuICAgIGlmIChleGlzdHkodGhpcy5fX3dhaXRUaW1lcklkKSkgeyBjbGVhclRpbWVvdXQodGhpcy5fX3dhaXRUaW1lcklkKTsgfVxuXG4gICAgZnVuY3Rpb24gd2FpdEZ1bmN0aW9uKCkge1xuICAgICAgICBzZWxmLl9fY2hlY2tTZWdtZW50TG9hZGluZyhzZWxmLl9fdGVjaC5jdXJyZW50VGltZSgpLCBtaW5EZXNpcmVkQnVmZmVyU2l6ZSwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpO1xuICAgICAgICBzZWxmLl9fd2FpdFRpbWVySWQgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKGlzTGl2ZSkge1xuICAgICAgICB3YWl0VGltZSA9IHdhaXRUaW1lVG9SZWNoZWNrTGl2ZShjdXJyZW50VGltZSwgYnVmZmVyZWRUaW1lUmFuZ2VzLCBzZWdtZW50TGlzdCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgd2FpdFRpbWUgPSB3YWl0VGltZVRvUmVjaGVja1N0YXRpYyhjdXJyZW50VGltZSwgYnVmZmVyZWRUaW1lUmFuZ2VzLCBzZWdtZW50RHVyYXRpb24sIGxhc3REb3dubG9hZFJvdW5kVHJpcFRpbWUsIG1pbkRlc2lyZWRCdWZmZXJTaXplLCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSk7XG4gICAgfVxuXG4gICAgLy8gSWYgd2FpdCB0aW1lIHdhcyBsZXNzIHRoYW4gNTBtcywgYXNzdW1lIHdlIHNob3VsZCBzaW1wbHkgbG9hZCBub3cuXG4gICAgaWYgKHdhaXRUaW1lID4gNTApIHtcbiAgICAgICAgdGhpcy5fX3dhaXRUaW1lcklkID0gc2V0VGltZW91dCh3YWl0RnVuY3Rpb24sIHdhaXRUaW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBzZWdtZW50VG9Eb3dubG9hZCA9IG5leHRTZWdtZW50VG9Mb2FkKGN1cnJlbnRUaW1lLCBidWZmZXJlZFRpbWVSYW5nZXMsIHNlZ21lbnRMaXN0KTtcbiAgICAgICAgaWYgKGV4aXN0eShzZWdtZW50VG9Eb3dubG9hZCkpIHtcbiAgICAgICAgICAgIHRoaXMuX19sb2FkU2VnbWVudChzZWdtZW50VG9Eb3dubG9hZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBBcHBhcmVudGx5IG5vIHNlZ21lbnQgdG8gbG9hZCwgc28gZ28gaW50byBhIGhvbGRpbmcgcGF0dGVybi5cbiAgICAgICAgICAgIHRoaXMud2FpdFRpbWVySWQgPSBzZXRUaW1lb3V0KHdhaXRGdW5jdGlvbiwgMjAwMCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG4vKipcbiAqIERvd25sb2FkIGEgc2VnbWVudCBmcm9tIHRoZSBjdXJyZW50IHNlZ21lbnQgbGlzdCBjb3JyZXNwb25kaW5nIHRvIHRoZSBzdGlwdWxhdGVkIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIGFuZCBhZGQgaXRcbiAqIHRvIHRoZSBzb3VyY2UgYnVmZmVyLlxuICpcbiAqIEBwYXJhbSBwcmVzZW50YXRpb25UaW1lIHtudW1iZXJ9IFRoZSBtZWRpYSBwcmVzZW50YXRpb24gdGltZSBmb3Igd2hpY2ggd2Ugd2FudCB0byBkb3dubG9hZCBhbmQgYnVmZmVyIGEgc2VnbWVudFxuICogQHJldHVybnMge2Jvb2xlYW59ICAgICAgICAgICAgICAgV2hldGhlciBvciBub3QgdGhlIHRoZXJlIGFyZSBzdWJzZXF1ZW50IHNlZ21lbnRzIGluIHRoZSBzZWdtZW50IGxpc3QsIHJlbGF0aXZlIHRvIHRoZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgcmVxdWVzdGVkLlxuICogQHByaXZhdGVcbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5fX2xvYWRTZWdtZW50ID0gZnVuY3Rpb24gbG9hZFNlZ21lbnQoc2VnbWVudCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExvYWRlciA9IHNlbGYuX19zZWdtZW50TG9hZGVyLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLFxuICAgICAgICBoYXNOZXh0U2VnbWVudCA9IHNlZ21lbnRMb2FkZXIubG9hZFNlZ21lbnRBdFRpbWUoc2VnbWVudC5nZXRTdGFydFRpbWUoKSk7XG5cbiAgICBpZiAoIWhhc05leHRTZWdtZW50KSB7IHJldHVybiBoYXNOZXh0U2VnbWVudDsgfVxuXG4gICAgc2VnbWVudExvYWRlci5vbmUoc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIGZ1bmN0aW9uIHNlZ21lbnRMb2FkZWRIYW5kbGVyKGV2ZW50KSB7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5vbmUoc291cmNlQnVmZmVyRGF0YVF1ZXVlLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIC8vIE9uY2Ugd2UndmUgY29tcGxldGVkIGRvd25sb2FkaW5nIGFuZCBidWZmZXJpbmcgdGhlIHNlZ21lbnQsIGRpc3BhdGNoIGV2ZW50IHRvIG5vdGlmeSB0aGF0IHdlIHNob3VsZCByZWNoZWNrXG4gICAgICAgICAgICAvLyB3aGV0aGVyIG9yIG5vdCB3ZSBzaG91bGQgbG9hZCBhbm90aGVyIHNlZ21lbnQgYW5kLCBpZiBzbywgd2hpY2guIChTZWU6IF9fY2hlY2tTZWdtZW50TG9hZGluZygpIG1ldGhvZCwgYWJvdmUpXG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HLCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5hZGRUb1F1ZXVlKGV2ZW50LmRhdGEpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGhhc05leHRTZWdtZW50O1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhVHlwZUxvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgU2VnbWVudExvYWRlciA9IHJlcXVpcmUoJy4vc2VnbWVudHMvU2VnbWVudExvYWRlci5qcycpLFxuICAgIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHJlcXVpcmUoJy4vc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcycpLFxuICAgIE1lZGlhVHlwZUxvYWRlciA9IHJlcXVpcmUoJy4vTWVkaWFUeXBlTG9hZGVyLmpzJyksXG4gICAgc2VsZWN0U2VnbWVudExpc3QgPSByZXF1aXJlKCcuL3NlbGVjdFNlZ21lbnRMaXN0LmpzJyksXG4gICAgbWVkaWFUeXBlcyA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWVkaWFUeXBlcy5qcycpO1xuXG4vLyBUT0RPOiBNaWdyYXRlIG1ldGhvZHMgYmVsb3cgdG8gYSBmYWN0b3J5LlxuZnVuY3Rpb24gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSkge1xuICAgIHZhciBzb3VyY2VCdWZmZXJUeXBlID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkuZ2V0U291cmNlQnVmZmVyVHlwZSgpLFxuICAgICAgICAvLyBUT0RPOiBUcnkvY2F0Y2ggYmxvY2s/XG4gICAgICAgIHNvdXJjZUJ1ZmZlciA9IG1lZGlhU291cmNlLmFkZFNvdXJjZUJ1ZmZlcihzb3VyY2VCdWZmZXJUeXBlKTtcbiAgICByZXR1cm4gbmV3IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJGb3JUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSwgdGVjaCkge1xuICAgIHZhciBzZWdtZW50TG9hZGVyID0gbmV3IFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKTtcbiAgICByZXR1cm4gbmV3IE1lZGlhVHlwZUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSwgdGVjaCk7XG59XG5cbi8qKlxuICpcbiAqIEZhY3Rvcnktc3R5bGUgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgc2V0IG9mIE1lZGlhVHlwZUxvYWRlcnMgYmFzZWQgb24gd2hhdCdzIGRlZmluZWQgaW4gdGhlIG1hbmlmZXN0IGFuZCB3aGF0IG1lZGlhIHR5cGVzIGFyZSBzdXBwb3J0ZWQuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQHJldHVybnMge0FycmF5LjxNZWRpYVR5cGVMb2FkZXI+fSAgICAgICAgICAgICAgIFNldCBvZiBNZWRpYVR5cGVMb2FkZXJzIGZvciBsb2FkaW5nIHNlZ21lbnRzIGZvciBhIGdpdmVuIG1lZGlhIHR5cGUgKGUuZy4gYXVkaW8gb3IgdmlkZW8pXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1lZGlhVHlwZUxvYWRlcnMobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBtYXRjaGVkVHlwZXMgPSBtZWRpYVR5cGVzLmZpbHRlcihmdW5jdGlvbihtZWRpYVR5cGUpIHtcbiAgICAgICAgICAgIHZhciBleGlzdHMgPSBleGlzdHkobWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkpO1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0czsgfSksXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlcnMgPSBtYXRjaGVkVHlwZXMubWFwKGZ1bmN0aW9uKG1lZGlhVHlwZSkgeyByZXR1cm4gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFUeXBlTG9hZGVycztcbn1cblxuLyoqXG4gKlxuICogUGxheWxpc3RMb2FkZXIgaGFuZGxlcyB0aGUgdG9wLWxldmVsIGxvYWRpbmcgYW5kIHBsYXliYWNrIG9mIHNlZ21lbnRzIGZvciBhbGwgbWVkaWEgdHlwZXMgKGUuZy4gYm90aCBhdWRpbyBhbmQgdmlkZW8pLlxuICogVGhpcyBpbmNsdWRlcyBjaGVja2luZyBpZiBpdCBzaG91bGQgc3dpdGNoIHNlZ21lbnQgbGlzdHMsIHVwZGF0aW5nL3JldHJpZXZpbmcgZGF0YSByZWxldmFudCB0byB0aGVzZSBkZWNpc2lvbiBmb3JcbiAqIGVhY2ggbWVkaWEgdHlwZS4gSXQgYWxzbyBpbmNsdWRlcyBjaGFuZ2luZyB0aGUgcGxheWJhY2sgcmF0ZSBvZiB0aGUgdmlkZW8gYmFzZWQgb24gZGF0YSBhdmFpbGFibGUgaW4gdGhlIHNvdXJjZSBidWZmZXIuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgdGhpcy5fX21lZGlhVHlwZUxvYWRlcnMgPSBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpO1xuXG4gICAgdmFyIGk7XG5cbiAgICBmdW5jdGlvbiBraWNrb2ZmTWVkaWFUeXBlTG9hZGVyKG1lZGlhVHlwZUxvYWRlcikge1xuICAgICAgICAvLyBNZWRpYVNldC1zcGVjaWZpYyB2YXJpYWJsZXNcbiAgICAgICAgdmFyIHNlZ21lbnRMb2FkZXIgPSBtZWRpYVR5cGVMb2FkZXIuZ2V0U2VnbWVudExvYWRlcigpLFxuICAgICAgICAgICAgZG93bmxvYWRSYXRlUmF0aW8gPSAxLjAsXG4gICAgICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpLFxuICAgICAgICAgICAgbWVkaWFUeXBlID0gbWVkaWFUeXBlTG9hZGVyLmdldE1lZGlhVHlwZSgpO1xuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgZXZlbnQgdGVsbGluZyB1cyB0byByZWNoZWNrIHdoaWNoIHNlZ21lbnQgbGlzdCB0aGUgc2VnbWVudHMgc2hvdWxkIGJlIGxvYWRlZCBmcm9tLlxuICAgICAgICBtZWRpYVR5cGVMb2FkZXIub24obWVkaWFUeXBlTG9hZGVyLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIG1lZGlhU2V0ID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSksXG4gICAgICAgICAgICAgICAgaXNGdWxsc2NyZWVuID0gdGVjaC5wbGF5ZXIoKS5pc0Z1bGxzY3JlZW4oKSxcbiAgICAgICAgICAgICAgICBkYXRhID0ge30sXG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRTZWdtZW50TGlzdDtcblxuICAgICAgICAgICAgZGF0YS5kb3dubG9hZFJhdGVSYXRpbyA9IGRvd25sb2FkUmF0ZVJhdGlvO1xuICAgICAgICAgICAgZGF0YS5jdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG5cbiAgICAgICAgICAgIC8vIFJhdGhlciB0aGFuIG1vbml0b3JpbmcgZXZlbnRzL3VwZGF0aW5nIHN0YXRlLCBzaW1wbHkgZ2V0IHJlbGV2YW50IHZpZGVvIHZpZXdwb3J0IGRpbXMgb24gdGhlIGZseSBhcyBuZWVkZWQuXG4gICAgICAgICAgICBkYXRhLndpZHRoID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi53aWR0aCA6IHRlY2gucGxheWVyKCkud2lkdGgoKTtcbiAgICAgICAgICAgIGRhdGEuaGVpZ2h0ID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi5oZWlnaHQgOiB0ZWNoLnBsYXllcigpLmhlaWdodCgpO1xuXG4gICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0ID0gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpO1xuXG4gICAgICAgICAgICAvLyBUT0RPOiBTaG91bGQgd2UgcmVmYWN0b3IgdG8gc2V0IGJhc2VkIG9uIHNlZ21lbnRMaXN0IGluc3RlYWQ/XG4gICAgICAgICAgICAvLyAoUG90ZW50aWFsbHkpIHVwZGF0ZSB3aGljaCBzZWdtZW50IGxpc3QgdGhlIHNlZ21lbnRzIHNob3VsZCBiZSBsb2FkZWQgZnJvbSAoYmFzZWQgb24gc2VnbWVudCBsaXN0J3MgYmFuZHdpZHRoL2JpdHJhdGUpXG4gICAgICAgICAgICBzZWdtZW50TG9hZGVyLnNldEN1cnJlbnRCYW5kd2lkdGgoc2VsZWN0ZWRTZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgZG93bmxvYWQgcmF0ZSAocm91bmQgdHJpcCB0aW1lIHRvIGRvd25sb2FkIGEgc2VnbWVudCBvZiBhIGdpdmVuIGF2ZXJhZ2UgYmFuZHdpZHRoL2JpdHJhdGUpIHRvIHVzZVxuICAgICAgICAvLyB3aXRoIGNob29zaW5nIHdoaWNoIHN0cmVhbSB2YXJpYW50IHRvIGxvYWQgc2VnbWVudHMgZnJvbS5cbiAgICAgICAgc2VnbWVudExvYWRlci5vbihzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGRvd25sb2FkUmF0ZVJhdGlvID0gZXZlbnQuZGF0YS5wbGF5YmFja1RpbWUgLyBldmVudC5kYXRhLnJ0dDtcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGV2ZW50LmRhdGEuYmFuZHdpZHRoO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBLaWNrb2ZmIHNlZ21lbnQgbG9hZGluZyBmb3IgdGhlIG1lZGlhIHR5cGUuXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlci5zdGFydExvYWRpbmdTZWdtZW50cygpO1xuICAgIH1cblxuICAgIC8vIEZvciBlYWNoIG9mIHRoZSBtZWRpYSB0eXBlcyAoZS5nLiAnYXVkaW8nICYgJ3ZpZGVvJykgaW4gdGhlIEFCUiBtYW5pZmVzdC4uLlxuICAgIGZvciAoaT0wOyBpPHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGtpY2tvZmZNZWRpYVR5cGVMb2FkZXIodGhpcy5fX21lZGlhVHlwZUxvYWRlcnNbaV0pO1xuICAgIH1cblxuICAgIC8vIE5PVEU6IFRoaXMgY29kZSBibG9jayBoYW5kbGVzIHBzZXVkby0ncGF1c2luZycvJ3VucGF1c2luZycgKGNoYW5naW5nIHRoZSBwbGF5YmFja1JhdGUpIGJhc2VkIG9uIHdoZXRoZXIgb3Igbm90XG4gICAgLy8gdGhlcmUgaXMgZGF0YSBhdmFpbGFibGUgaW4gdGhlIGJ1ZmZlciwgYnV0IGluZGlyZWN0bHksIGJ5IGxpc3RlbmluZyB0byBhIGZldyBldmVudHMgYW5kIHVzaW5nIHRoZSB2aWRlbyBlbGVtZW50J3NcbiAgICAvLyByZWFkeSBzdGF0ZS5cbiAgICB2YXIgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzID0gWydzZWVraW5nJywgJ2NhbnBsYXknLCAnY2FucGxheXRocm91Z2gnXSxcbiAgICAgICAgZXZlbnRUeXBlO1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzSGFuZGxlcihldmVudCkge1xuICAgICAgICB2YXIgcmVhZHlTdGF0ZSA9IHRlY2guZWwoKS5yZWFkeVN0YXRlLFxuICAgICAgICAgICAgcGxheWJhY2tSYXRlID0gKHJlYWR5U3RhdGUgPT09IDQpID8gMSA6IDA7XG4gICAgICAgIHRlY2guc2V0UGxheWJhY2tSYXRlKHBsYXliYWNrUmF0ZSk7XG4gICAgfVxuXG4gICAgZm9yKGk9MDsgaTxjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZXZlbnRUeXBlID0gY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzW2ldO1xuICAgICAgICB0ZWNoLm9uKGV2ZW50VHlwZSwgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzSGFuZGxlcik7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFBsYXlsaXN0TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIE1lZGlhU291cmNlID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLk1lZGlhU291cmNlLFxuICAgIE1hbmlmZXN0Q29udHJvbGxlciA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWFuaWZlc3RDb250cm9sbGVyLmpzJyksXG4gICAgUGxheWxpc3RMb2FkZXIgPSByZXF1aXJlKCcuL1BsYXlsaXN0TG9hZGVyLmpzJyk7XG5cbi8vIFRPRE86IERJU1BPU0UgTUVUSE9EXG4vKipcbiAqXG4gKiBDbGFzcyB0aGF0IGRlZmluZXMgdGhlIHJvb3QgY29udGV4dCBmb3IgaGFuZGxpbmcgYSBzcGVjaWZpYyBNUEVHLURBU0ggbWVkaWEgc291cmNlLlxuICpcbiAqIEBwYXJhbSBzb3VyY2UgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHNvdXJjZSwgc3VjaCBhcyB0aGUgdXJpIChzcmMpIGFuZCB0aGUgdHlwZSAodHlwZSlcbiAqIEBwYXJhbSB0ZWNoICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBvYmplY3QgcHJvdmlkaW5nIHRoZSBwb2ludCBvZiBpbnRlcmFjdGlvbiBiZXR3ZWVuIHRoZSBTb3VyY2VIYW5kbGVyIGluc3RhbmNlIGFuZFxuICogICAgICAgICAgICAgICAgICB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nIGUuZy4gdGhlIHZpZGVvIGVsZW1lbnQpXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1hbmlmZXN0Q29udHJvbGxlciA9IG5ldyBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlLnNyYywgZmFsc2UpO1xuXG4gICAgbWFuaWZlc3RDb250cm9sbGVyLm9uZShtYW5pZmVzdENvbnRyb2xsZXIuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgdmFyIG1lZGlhU291cmNlID0gbmV3IE1lZGlhU291cmNlKCksXG4gICAgICAgICAgICBvcGVuTGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1lZGlhU291cmNlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fcGxheWxpc3RMb2FkZXIgPSBuZXcgUGxheWxpc3RMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgY2xvc2UuXG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignd2Via2l0c291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgICAgIHRlY2guc2V0U3JjKFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpKTtcbiAgICB9KTtcblxuICAgIG1hbmlmZXN0Q29udHJvbGxlci5sb2FkKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlSGFuZGxlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pc1N0cmluZy5qcycpLFxuICAgIHBhcnNlUm9vdFVybCA9IHV0aWwucGFyc2VSb290VXJsLFxuICAgIGNyZWF0ZU1wZE9iamVjdCxcbiAgICBjcmVhdGVQZXJpb2RPYmplY3QsXG4gICAgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCxcbiAgICBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCxcbiAgICBjcmVhdGVTZWdtZW50VGVtcGxhdGUsXG4gICAgZ2V0TXBkLFxuICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGUsXG4gICAgZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSxcbiAgICBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZTtcblxuLy8gVE9ETzogU2hvdWxkIHRoaXMgZXhpc3Qgb24gbXBkIGRhdGF2aWV3IG9yIGF0IGEgaGlnaGVyIGxldmVsP1xuLy8gVE9ETzogUmVmYWN0b3IuIENvdWxkIGJlIG1vcmUgZWZmaWNpZW50IChSZWN1cnNpdmUgZm4/IFVzZSBlbGVtZW50LmdldEVsZW1lbnRzQnlOYW1lKCdCYXNlVXJsJylbMF0/KS5cbi8vIFRPRE86IEN1cnJlbnRseSBhc3N1bWluZyAqRUlUSEVSKiA8QmFzZVVSTD4gbm9kZXMgd2lsbCBwcm92aWRlIGFuIGFic29sdXRlIGJhc2UgdXJsIChpZSByZXNvbHZlIHRvICdodHRwOi8vJyBldGMpXG4vLyBUT0RPOiAqT1IqIHdlIHNob3VsZCB1c2UgdGhlIGJhc2UgdXJsIG9mIHRoZSBob3N0IG9mIHRoZSBNUEQgbWFuaWZlc3QuXG52YXIgYnVpbGRCYXNlVXJsID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHZhciBlbGVtSGllcmFyY2h5ID0gW3htbE5vZGVdLmNvbmNhdCh4bWxmdW4uZ2V0QW5jZXN0b3JzKHhtbE5vZGUpKSxcbiAgICAgICAgZm91bmRMb2NhbEJhc2VVcmwgPSBmYWxzZTtcbiAgICB2YXIgYmFzZVVybHMgPSBlbGVtSGllcmFyY2h5Lm1hcChmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmIChmb3VuZExvY2FsQmFzZVVybCkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgaWYgKCFlbGVtLmhhc0NoaWxkTm9kZXMoKSkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgdmFyIGNoaWxkO1xuICAgICAgICBmb3IgKHZhciBpPTA7IGk8ZWxlbS5jaGlsZE5vZGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IGVsZW0uY2hpbGROb2Rlcy5pdGVtKGkpO1xuICAgICAgICAgICAgaWYgKGNoaWxkLm5vZGVOYW1lID09PSAnQmFzZVVSTCcpIHtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dEVsZW0gPSBjaGlsZC5jaGlsZE5vZGVzLml0ZW0oMCk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRWYWx1ZSA9IHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRleHRWYWx1ZS5pbmRleE9mKCdodHRwOi8vJykgPT09IDApIHsgZm91bmRMb2NhbEJhc2VVcmwgPSB0cnVlOyB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfSk7XG5cbiAgICB2YXIgYmFzZVVybCA9IGJhc2VVcmxzLnJldmVyc2UoKS5qb2luKCcnKTtcbiAgICBpZiAoIWJhc2VVcmwpIHsgcmV0dXJuIHBhcnNlUm9vdFVybCh4bWxOb2RlLmJhc2VVUkkpOyB9XG4gICAgcmV0dXJuIGJhc2VVcmw7XG59O1xuXG52YXIgZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcyA9IFtcbiAgICAnQWRhcHRhdGlvblNldCcsXG4gICAgJ1JlcHJlc2VudGF0aW9uJyxcbiAgICAnU3ViUmVwcmVzZW50YXRpb24nXG5dO1xuXG52YXIgaGFzQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcy5pbmRleE9mKGVsZW0ubm9kZU5hbWUpID49IDA7XG59O1xuXG52YXIgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuICFoYXNDb21tb25Qcm9wZXJ0aWVzKGVsZW0pO1xufTtcblxuLy8gQ29tbW9uIEF0dHJzXG52YXIgZ2V0V2lkdGggPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ3dpZHRoJyksXG4gICAgZ2V0SGVpZ2h0ID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdoZWlnaHQnKSxcbiAgICBnZXRGcmFtZVJhdGUgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2ZyYW1lUmF0ZScpLFxuICAgIGdldE1pbWVUeXBlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdtaW1lVHlwZScpLFxuICAgIGdldENvZGVjcyA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnY29kZWNzJyk7XG5cbnZhciBnZXRTZWdtZW50VGVtcGxhdGVYbWxMaXN0ID0geG1sZnVuLmdldE11bHRpTGV2ZWxFbGVtZW50TGlzdCgnU2VnbWVudFRlbXBsYXRlJyk7XG5cbi8vIE1QRCBBdHRyIGZuc1xudmFyIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uJyksXG4gICAgZ2V0VHlwZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3R5cGUnKSxcbiAgICBnZXRNaW5pbXVtVXBkYXRlUGVyaW9kID0geG1sZnVuLmdldEF0dHJGbignbWluaW11bVVwZGF0ZVBlcmlvZCcpLFxuICAgIGdldEF2YWlsYWJpbGl0eVN0YXJ0VGltZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2F2YWlsYWJpbGl0eVN0YXJ0VGltZScpLFxuICAgIGdldFN1Z2dlc3RlZFByZXNlbnRhdGlvbkRlbGF5ID0geG1sZnVuLmdldEF0dHJGbignc3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXknKSxcbiAgICBnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVTaGlmdEJ1ZmZlckRlcHRoJyk7XG5cbi8vIFJlcHJlc2VudGF0aW9uIEF0dHIgZm5zXG52YXIgZ2V0SWQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdpZCcpLFxuICAgIGdldEJhbmR3aWR0aCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2JhbmR3aWR0aCcpO1xuXG4vLyBTZWdtZW50VGVtcGxhdGUgQXR0ciBmbnNcbnZhciBnZXRJbml0aWFsaXphdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2luaXRpYWxpemF0aW9uJyksXG4gICAgZ2V0TWVkaWEgPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYScpLFxuICAgIGdldER1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignZHVyYXRpb24nKSxcbiAgICBnZXRUaW1lc2NhbGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0aW1lc2NhbGUnKSxcbiAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0ID0geG1sZnVuLmdldEF0dHJGbigncHJlc2VudGF0aW9uVGltZU9mZnNldCcpLFxuICAgIGdldFN0YXJ0TnVtYmVyID0geG1sZnVuLmdldEF0dHJGbignc3RhcnROdW1iZXInKTtcblxuLy8gVE9ETzogUmVwZWF0IGNvZGUuIEFic3RyYWN0IGF3YXkgKFByb3RvdHlwYWwgSW5oZXJpdGFuY2UvT08gTW9kZWw/IE9iamVjdCBjb21wb3NlciBmbj8pXG5jcmVhdGVNcGRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFBlcmlvZHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgeG1sTm9kZSksXG4gICAgICAgIGdldE1pbmltdW1VcGRhdGVQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW5pbXVtVXBkYXRlUGVyaW9kLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXk6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheSwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGgsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sTGlzdCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sTGlzdCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldElkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SWQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRXaWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFdpZHRoLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0SGVpZ2h0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SGVpZ2h0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RnJhbWVSYXRlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RnJhbWVSYXRlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0Q29kZWNzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0Q29kZWNzLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QmFzZVVybDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGJ1aWxkQmFzZVVybCwgeG1sTm9kZSksXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSA9IGZ1bmN0aW9uKHhtbEFycmF5KSB7XG4gICAgLy8gRWZmZWN0aXZlbHkgYSBmaW5kIGZ1bmN0aW9uICsgYSBtYXAgZnVuY3Rpb24uXG4gICAgZnVuY3Rpb24gZ2V0QXR0ckZyb21YbWxBcnJheShhdHRyR2V0dGVyRm4sIHhtbEFycmF5KSB7XG4gICAgICAgIGlmICghaXNBcnJheSh4bWxBcnJheSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoIWlzRnVuY3Rpb24oYXR0ckdldHRlckZuKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG5cbiAgICAgICAgdmFyIGksXG4gICAgICAgICAgICBsZW5ndGggPSB4bWxBcnJheS5sZW5ndGgsXG4gICAgICAgICAgICBjdXJyZW50QXR0clZhbHVlO1xuXG4gICAgICAgIGZvciAoaT0wOyBpPHhtbEFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjdXJyZW50QXR0clZhbHVlID0gYXR0ckdldHRlckZuKHhtbEFycmF5W2ldKTtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhjdXJyZW50QXR0clZhbHVlKSAmJiBjdXJyZW50QXR0clZhbHVlICE9PSAnJykgeyByZXR1cm4gY3VycmVudEF0dHJWYWx1ZTsgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbEFycmF5LFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sQXJyYXlbMF0sICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxBcnJheVswXSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxBcnJheVswXSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0SW5pdGlhbGl6YXRpb24sIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0TWVkaWE6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRNZWRpYSwgeG1sQXJyYXkpLFxuICAgICAgICBnZXREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldER1cmF0aW9uLCB4bWxBcnJheSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldFRpbWVzY2FsZSwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldFN0YXJ0TnVtYmVyLCB4bWxBcnJheSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUgPSBmdW5jdGlvbiBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSh4bWxOb2RlLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIGlmICghdGFnTmFtZSB8fCAheG1sTm9kZSB8fCAheG1sTm9kZS5wYXJlbnROb2RlKSB7IHJldHVybiBudWxsOyB9XG4gICAgaWYgKCF4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGlmICh4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUgPT09IHRhZ05hbWUpIHtcbiAgICAgICAgcmV0dXJuIGlzRnVuY3Rpb24obWFwRm4pID8gbWFwRm4oeG1sTm9kZS5wYXJlbnROb2RlKSA6IHhtbE5vZGUucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUucGFyZW50Tm9kZSwgdGFnTmFtZSwgbWFwRm4pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNcGQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsLFxuICAgIC8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHBhcnNlRGF0ZVRpbWUsXG4gICAgU0VDT05EU19JTl9ZRUFSID0gMzY1ICogMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTU9OVEggPSAzMCAqIDI0ICogNjAgKiA2MCwgLy8gbm90IHByZWNpc2UhXG4gICAgU0VDT05EU19JTl9EQVkgPSAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9IT1VSID0gNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01JTiA9IDYwLFxuICAgIE1JTlVURVNfSU5fSE9VUiA9IDYwLFxuICAgIE1JTExJU0VDT05EU19JTl9TRUNPTkRTID0gMTAwMCxcbiAgICBkdXJhdGlvblJlZ2V4ID0gL15QKChbXFxkLl0qKVkpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopRCk/VD8oKFtcXGQuXSopSCk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilTKT8vLFxuICAgIGRhdGVUaW1lUmVnZXggPSAvXihbMC05XXs0fSktKFswLTldezJ9KS0oWzAtOV17Mn0pVChbMC05XXsyfSk6KFswLTldezJ9KSg/OjooWzAtOV0qKShcXC5bMC05XSopPyk/KD86KFsrLV0pKFswLTldezJ9KShbMC05XXsyfSkpPy87XG5cbnBhcnNlUm9vdFVybCA9IGZ1bmN0aW9uKHVybCkge1xuICAgIGlmICh0eXBlb2YgdXJsICE9PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCcvJykgPT09IC0xKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJz8nKSAhPT0gLTEpIHtcbiAgICAgICAgdXJsID0gdXJsLnN1YnN0cmluZygwLCB1cmwuaW5kZXhPZignPycpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdXJsLnN1YnN0cmluZygwLCB1cmwubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufTtcblxuLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAvL3N0ciA9IFwiUDEwWTEwTTEwRFQxMEgxME0xMC4xU1wiO1xuICAgIGlmICghc3RyKSB7IHJldHVybiBOdW1iZXIuTmFOOyB9XG4gICAgdmFyIG1hdGNoID0gZHVyYXRpb25SZWdleC5leGVjKHN0cik7XG4gICAgaWYgKCFtYXRjaCkgeyByZXR1cm4gTnVtYmVyLk5hTjsgfVxuICAgIHJldHVybiAocGFyc2VGbG9hdChtYXRjaFsyXSB8fCAwKSAqIFNFQ09ORFNfSU5fWUVBUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNF0gfHwgMCkgKiBTRUNPTkRTX0lOX01PTlRIICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs2XSB8fCAwKSAqIFNFQ09ORFNfSU5fREFZICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs4XSB8fCAwKSAqIFNFQ09ORFNfSU5fSE9VUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTBdIHx8IDApICogU0VDT05EU19JTl9NSU4gK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEyXSB8fCAwKSk7XG59O1xuXG4vKipcbiAqIFBhcnNlciBmb3IgZm9ybWF0dGVkIGRhdGV0aW1lIHN0cmluZ3MgY29uZm9ybWluZyB0byB0aGUgSVNPIDg2MDEgc3RhbmRhcmQuXG4gKiBHZW5lcmFsIEZvcm1hdDogIFlZWVktTU0tRERUSEg6TU06U1NaIChVVEMpIG9yIFlZWVktTU0tRERUSEg6TU06U1MrSEg6TU0gKHRpbWUgem9uZSBsb2NhbGl6YXRpb24pXG4gKiBFeCBTdHJpbmc6ICAgICAgIDIwMTQtMTItMTdUMTQ6MDk6NThaIChVVEMpIG9yIDIwMTQtMTItMTdUMTQ6MTU6NTgrMDY6MDAgKHRpbWUgem9uZSBsb2NhbGl6YXRpb24pIC8gMjAxNC0xMi0xN1QxNDowMzo1OC0wNjowMCAodGltZSB6b25lIGxvY2FsaXphdGlvbilcbiAqXG4gKiBAcGFyYW0gc3RyIHtzdHJpbmd9ICBJU08gODYwMS1jb21wbGlhbnQgZGF0ZXRpbWUgc3RyaW5nLlxuICogQHJldHVybnMge251bWJlcn0gVVRDIFVuaXggdGltZS5cbiAqL1xucGFyc2VEYXRlVGltZSA9IGZ1bmN0aW9uKHN0cikge1xuICAgIHZhciBtYXRjaCA9IGRhdGVUaW1lUmVnZXguZXhlYyhzdHIpLFxuICAgICAgICB1dGNEYXRlO1xuXG4gICAgLy8gSWYgdGhlIHN0cmluZyBkb2VzIG5vdCBjb250YWluIGEgdGltZXpvbmUgb2Zmc2V0IGRpZmZlcmVudCBicm93c2VycyBjYW4gaW50ZXJwcmV0IGl0IGVpdGhlclxuICAgIC8vIGFzIFVUQyBvciBhcyBhIGxvY2FsIHRpbWUgc28gd2UgaGF2ZSB0byBwYXJzZSB0aGUgc3RyaW5nIG1hbnVhbGx5IHRvIG5vcm1hbGl6ZSB0aGUgZ2l2ZW4gZGF0ZSB2YWx1ZSBmb3JcbiAgICAvLyBhbGwgYnJvd3NlcnNcbiAgICB1dGNEYXRlID0gRGF0ZS5VVEMoXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzFdLCAxMCksXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzJdLCAxMCktMSwgLy8gbW9udGhzIHN0YXJ0IGZyb20gemVyb1xuICAgICAgICBwYXJzZUludChtYXRjaFszXSwgMTApLFxuICAgICAgICBwYXJzZUludChtYXRjaFs0XSwgMTApLFxuICAgICAgICBwYXJzZUludChtYXRjaFs1XSwgMTApLFxuICAgICAgICAobWF0Y2hbNl0gJiYgcGFyc2VJbnQobWF0Y2hbNl0sIDEwKSB8fCAwKSxcbiAgICAgICAgKG1hdGNoWzddICYmIHBhcnNlRmxvYXQobWF0Y2hbN10pICogTUlMTElTRUNPTkRTX0lOX1NFQ09ORFMpIHx8IDApO1xuICAgIC8vIElmIHRoZSBkYXRlIGhhcyB0aW1lem9uZSBvZmZzZXQgdGFrZSBpdCBpbnRvIGFjY291bnQgYXMgd2VsbFxuICAgIGlmIChtYXRjaFs5XSAmJiBtYXRjaFsxMF0pIHtcbiAgICAgICAgdmFyIHRpbWV6b25lT2Zmc2V0ID0gcGFyc2VJbnQobWF0Y2hbOV0sIDEwKSAqIE1JTlVURVNfSU5fSE9VUiArIHBhcnNlSW50KG1hdGNoWzEwXSwgMTApO1xuICAgICAgICB1dGNEYXRlICs9IChtYXRjaFs4XSA9PT0gJysnID8gLTEgOiArMSkgKiB0aW1lem9uZU9mZnNldCAqIFNFQ09ORFNfSU5fTUlOICogTUlMTElTRUNPTkRTX0lOX1NFQ09ORFM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHV0Y0RhdGU7XG59O1xuXG52YXIgdXRpbCA9IHtcbiAgICBwYXJzZVJvb3RVcmw6IHBhcnNlUm9vdFVybCxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lOiBwYXJzZURhdGVUaW1lXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWw7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXF1aXJlKCcuLi9tcGQvdXRpbC5qcycpLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZURhdGVUaW1lLFxuICAgIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vc2VnbWVudFRlbXBsYXRlJyksXG4gICAgY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VVRDV2FsbENsb2NrVGltZSxcbiAgICBnZXRUeXBlLFxuICAgIGdldElzTGl2ZSxcbiAgICBnZXRCYW5kd2lkdGgsXG4gICAgZ2V0V2lkdGgsXG4gICAgZ2V0SGVpZ2h0LFxuICAgIGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlLFxuICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoLFxuICAgIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSxcbiAgICBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSxcbiAgICBnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGU7XG5cblxuLyoqXG4gKlxuICogRnVuY3Rpb24gdXNlZCB0byBnZXQgdGhlICd0eXBlJyBvZiBhIERBU0ggUmVwcmVzZW50YXRpb24gaW4gYSBmb3JtYXQgZXhwZWN0ZWQgYnkgdGhlIE1TRSBTb3VyY2VCdWZmZXIuIFVzZWQgdG9cbiAqIGNyZWF0ZSBTb3VyY2VCdWZmZXIgaW5zdGFuY2VzIHRoYXQgY29ycmVzcG9uZCB0byBhIGdpdmVuIE1lZGlhU2V0IChlLmcuIHNldCBvZiBhdWRpbyBzdHJlYW0gdmFyaWFudHMsIHZpZGVvIHN0cmVhbVxuICogdmFyaWFudHMsIGV0Yy4pLlxuICpcbiAqIEBwYXJhbSByZXByZXNlbnRhdGlvbiAgICBQT0pPIERBU0ggTVBEIFJlcHJlc2VudGF0aW9uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAgICAgICAgVGhlIFJlcHJlc2VudGF0aW9uJ3MgJ3R5cGUnIGluIGEgZm9ybWF0IGV4cGVjdGVkIGJ5IHRoZSBNU0UgU291cmNlQnVmZmVyXG4gKi9cbmdldFR5cGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZ2V0SXNMaXZlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gKHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldFR5cGUoKSA9PT0gJ2R5bmFtaWMnKTtcbn07XG5cbmdldEJhbmR3aWR0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGJhbmR3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKSA/IE51bWJlcihiYW5kd2lkdGgpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0V2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciB3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldFdpZHRoKCk7XG4gICAgcmV0dXJuIGV4aXN0eSh3aWR0aCkgPyBOdW1iZXIod2lkdGgpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0SGVpZ2h0ID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgaGVpZ2h0ID0gcmVwcmVzZW50YXRpb24uZ2V0SGVpZ2h0KCk7XG4gICAgcmV0dXJuIGV4aXN0eShoZWlnaHQpID8gTnVtYmVyKGhlaWdodCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAvLyBUT0RPOiBTdXBwb3J0IHBlcmlvZC1yZWxhdGl2ZSBwcmVzZW50YXRpb24gdGltZVxuICAgIHZhciBtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbigpLFxuICAgICAgICBwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZXhpc3R5KG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pID8gcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pIDogTnVtYmVyLk5hTixcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZU9mZnNldCA9IE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0KCkpIHx8IDA7XG4gICAgcmV0dXJuIGV4aXN0eShwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA/IE51bWJlcihwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uIC0gcHJlc2VudGF0aW9uVGltZU9mZnNldCkgOiBOdW1iZXIuTmFOO1xufTtcblxuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgd2FsbENsb2NrVGltZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldEF2YWlsYWJpbGl0eVN0YXJ0VGltZSgpLFxuICAgICAgICB3YWxsQ2xvY2tVbml4VGltZVV0YyA9IHBhcnNlRGF0ZVRpbWUod2FsbENsb2NrVGltZVN0cik7XG4gICAgcmV0dXJuIHdhbGxDbG9ja1VuaXhUaW1lVXRjO1xufTtcblxuZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciB0aW1lU2hpZnRCdWZmZXJEZXB0aFN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoKCksXG4gICAgICAgIHBhcnNlZFRpbWVTaGlmdEJ1ZmZlckRlcHRoID0gcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKHRpbWVTaGlmdEJ1ZmZlckRlcHRoU3RyKTtcbiAgICByZXR1cm4gcGFyc2VkVGltZVNoaWZ0QnVmZmVyRGVwdGg7XG59O1xuXG5nZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBzZWdtZW50VGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKTtcbiAgICByZXR1cm4gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXREdXJhdGlvbigpKSAvIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0VGltZXNjYWxlKCkpO1xufTtcblxuZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBNYXRoLmNlaWwoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLyBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKTtcbn07XG5cbmdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldFN0YXJ0TnVtYmVyKCkpO1xufTtcblxuZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pICsgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC0gMTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRJc0xpdmU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJc0xpdmUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRXaWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFNlZ21lbnREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbFNlZ21lbnRDb3VudDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0RW5kTnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIC8vIFRPRE86IEV4dGVybmFsaXplXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBpbml0aWFsaXphdGlvbiA9IHt9O1xuICAgICAgICAgICAgaW5pdGlhbGl6YXRpb24uZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICAgICAgICAgIHJlcHJlc2VudGF0aW9uSWQgPSByZXByZXNlbnRhdGlvbi5nZXRJZCgpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRJbml0aWFsaXphdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25JZCk7XG5cbiAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwsICdCYW5kd2lkdGgnLCByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBpbml0aWFsaXphdGlvbjtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5TnVtYmVyOiBmdW5jdGlvbihudW1iZXIpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTsgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5VGltZTogZnVuY3Rpb24oc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgc2Vjb25kcyk7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWU6IGZ1bmN0aW9uKHV0Y01pbGxpc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VVRDV2FsbENsb2NrVGltZShyZXByZXNlbnRhdGlvbiwgdXRjTWlsbGlzZWNvbmRzKTsgfVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB7fTtcbiAgICBzZWdtZW50LmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgIHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0TWVkaWEoKSxcbiAgICAgICAgICAgIHJlcGxhY2VkSWRVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uLmdldElkKCkpLFxuICAgICAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmw7XG4gICAgICAgICAgICAvLyBUT0RPOiBTaW5jZSAkVGltZSQtdGVtcGxhdGVkIHNlZ21lbnQgVVJMcyBzaG91bGQgb25seSBleGlzdCBpbiBjb25qdW5jdGlvbiB3L2EgPFNlZ21lbnRUaW1lbGluZT4sXG4gICAgICAgICAgICAvLyBUT0RPOiBjYW4gY3VycmVudGx5IGFzc3VtZSBhICROdW1iZXIkLWJhc2VkIHRlbXBsYXRlZCB1cmwuXG4gICAgICAgICAgICAvLyBUT0RPOiBFbmZvcmNlIG1pbi9tYXggbnVtYmVyIHJhbmdlIChiYXNlZCBvbiBzZWdtZW50TGlzdCBzdGFydE51bWJlciAmIGVuZE51bWJlcilcbiAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRJZFVybCwgJ051bWJlcicsIG51bWJlcik7XG4gICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkVG9rZW5zVXJsLCAnQmFuZHdpZHRoJywgcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuXG4gICAgICAgIHJldHVybiBiYXNlVXJsICsgcmVwbGFjZWRUb2tlbnNVcmw7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gKG51bWJlciAtIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSkgKiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgKyBNYXRoLnJvdW5kKCgobnVtYmVyIC0gZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKSAqIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpICogMTAwMCk7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldER1cmF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIFRPRE86IFZlcmlmeVxuICAgICAgICB2YXIgc3RhbmRhcmRTZWdtZW50RHVyYXRpb24gPSBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICAgICAgZHVyYXRpb24sXG4gICAgICAgICAgICBtZWRpYVByZXNlbnRhdGlvblRpbWUsXG4gICAgICAgICAgICBwcmVjaXNpb25NdWx0aXBsaWVyO1xuXG4gICAgICAgIGlmIChnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pID09PSBudW1iZXIpIHtcbiAgICAgICAgICAgIG1lZGlhUHJlc2VudGF0aW9uVGltZSA9IE51bWJlcihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG4gICAgICAgICAgICAvLyBIYW5kbGUgZmxvYXRpbmcgcG9pbnQgcHJlY2lzaW9uIGlzc3VlXG4gICAgICAgICAgICBwcmVjaXNpb25NdWx0aXBsaWVyID0gMTAwMDtcbiAgICAgICAgICAgIGR1cmF0aW9uID0gKCgobWVkaWFQcmVzZW50YXRpb25UaW1lICogcHJlY2lzaW9uTXVsdGlwbGllcikgJSAoc3RhbmRhcmRTZWdtZW50RHVyYXRpb24gKiBwcmVjaXNpb25NdWx0aXBsaWVyKSkgLyBwcmVjaXNpb25NdWx0aXBsaWVyICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkdXJhdGlvbiA9IHN0YW5kYXJkU2VnbWVudER1cmF0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkdXJhdGlvbjtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0TnVtYmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiBudW1iZXI7IH07XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIHNlY29uZHMpIHtcbiAgICB2YXIgc2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc3RhcnROdW1iZXIgPSBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgfHwgMCxcbiAgICAgICAgbnVtYmVyID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gc2VnbWVudER1cmF0aW9uKSArIHN0YXJ0TnVtYmVyLFxuICAgICAgICBzZWdtZW50ID0gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpO1xuXG4gICAgLy8gSWYgd2UncmUgcmVhbGx5IGNsb3NlIHRvIHRoZSBlbmQgdGltZSBvZiB0aGUgY3VycmVudCBzZWdtZW50IChzdGFydCB0aW1lICsgZHVyYXRpb24pLFxuICAgIC8vIHRoaXMgbWVhbnMgd2UncmUgcmVhbGx5IGNsb3NlIHRvIHRoZSBzdGFydCB0aW1lIG9mIHRoZSBuZXh0IHNlZ21lbnQuXG4gICAgLy8gVGhlcmVmb3JlLCBhc3N1bWUgdGhpcyBpcyBhIGZsb2F0aW5nLXBvaW50IHByZWNpc2lvbiBpc3N1ZSB3aGVyZSB3ZSB3ZXJlIHRyeWluZyB0byBncmFiIGEgc2VnbWVudFxuICAgIC8vIGJ5IGl0cyBzdGFydCB0aW1lIGFuZCByZXR1cm4gdGhlIG5leHQgc2VnbWVudCBpbnN0ZWFkLlxuICAgIGlmICgoKHNlZ21lbnQuZ2V0U3RhcnRUaW1lKCkgKyBzZWdtZW50LmdldER1cmF0aW9uKCkpIC0gc2Vjb25kcykgPD0gMC4wMDMgKSB7XG4gICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlciArIDEpO1xuICAgIH1cblxuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VVRDV2FsbENsb2NrVGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCB1bml4VGltZVV0Y01pbGxpc2Vjb25kcykge1xuICAgIHZhciB3YWxsQ2xvY2tTdGFydFRpbWUgPSBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBwcmVzZW50YXRpb25UaW1lO1xuICAgIGlmIChpc05hTih3YWxsQ2xvY2tTdGFydFRpbWUpKSB7IHJldHVybiBudWxsOyB9XG4gICAgcHJlc2VudGF0aW9uVGltZSA9ICh1bml4VGltZVV0Y01pbGxpc2Vjb25kcyAtIHdhbGxDbG9ja1N0YXJ0VGltZSkvMTAwMDtcbiAgICBpZiAoaXNOYU4ocHJlc2VudGF0aW9uVGltZSkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgcHJlc2VudGF0aW9uVGltZSk7XG59O1xuXG5mdW5jdGlvbiBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgaWYgKCFyZXByZXNlbnRhdGlvbikgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpKSB7IHJldHVybiBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7IH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb247XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZWdtZW50VGVtcGxhdGUsXG4gICAgemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU7XG5cbnplcm9QYWRUb0xlbmd0aCA9IGZ1bmN0aW9uIChudW1TdHIsIG1pblN0ckxlbmd0aCkge1xuICAgIHdoaWxlIChudW1TdHIubGVuZ3RoIDwgbWluU3RyTGVuZ3RoKSB7XG4gICAgICAgIG51bVN0ciA9ICcwJyArIG51bVN0cjtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVtU3RyO1xufTtcblxucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHRva2VuLCB2YWx1ZSkge1xuXG4gICAgdmFyIHN0YXJ0UG9zID0gMCxcbiAgICAgICAgZW5kUG9zID0gMCxcbiAgICAgICAgdG9rZW5MZW4gPSB0b2tlbi5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZyA9ICclMCcsXG4gICAgICAgIGZvcm1hdFRhZ0xlbiA9IGZvcm1hdFRhZy5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZ1BvcyxcbiAgICAgICAgc3BlY2lmaWVyLFxuICAgICAgICB3aWR0aCxcbiAgICAgICAgcGFkZGVkVmFsdWU7XG5cbiAgICAvLyBrZWVwIGxvb3Bpbmcgcm91bmQgdW50aWwgYWxsIGluc3RhbmNlcyBvZiA8dG9rZW4+IGhhdmUgYmVlblxuICAgIC8vIHJlcGxhY2VkLiBvbmNlIHRoYXQgaGFzIGhhcHBlbmVkLCBzdGFydFBvcyBiZWxvdyB3aWxsIGJlIC0xXG4gICAgLy8gYW5kIHRoZSBjb21wbGV0ZWQgdXJsIHdpbGwgYmUgcmV0dXJuZWQuXG4gICAgd2hpbGUgKHRydWUpIHtcblxuICAgICAgICAvLyBjaGVjayBpZiB0aGVyZSBpcyBhIHZhbGlkICQ8dG9rZW4+Li4uJCBpZGVudGlmaWVyXG4gICAgICAgIC8vIGlmIG5vdCwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIHN0YXJ0UG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcgKyB0b2tlbik7XG4gICAgICAgIGlmIChzdGFydFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoZSBuZXh0ICckJyBtdXN0IGJlIHRoZSBlbmQgb2YgdGhlIGlkZW50aWZlclxuICAgICAgICAvLyBpZiB0aGVyZSBpc24ndCBvbmUsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBlbmRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChlbmRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBub3cgc2VlIGlmIHRoZXJlIGlzIGFuIGFkZGl0aW9uYWwgZm9ybWF0IHRhZyBzdWZmaXhlZCB0b1xuICAgICAgICAvLyB0aGUgaWRlbnRpZmllciB3aXRoaW4gdGhlIGVuY2xvc2luZyAnJCcgY2hhcmFjdGVyc1xuICAgICAgICBmb3JtYXRUYWdQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKGZvcm1hdFRhZywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChmb3JtYXRUYWdQb3MgPiBzdGFydFBvcyAmJiBmb3JtYXRUYWdQb3MgPCBlbmRQb3MpIHtcblxuICAgICAgICAgICAgc3BlY2lmaWVyID0gdGVtcGxhdGVTdHIuY2hhckF0KGVuZFBvcyAtIDEpO1xuICAgICAgICAgICAgd2lkdGggPSBwYXJzZUludCh0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZm9ybWF0VGFnUG9zICsgZm9ybWF0VGFnTGVuLCBlbmRQb3MgLSAxKSwgMTApO1xuXG4gICAgICAgICAgICAvLyBzdXBwb3J0IHRoZSBtaW5pbXVtIHNwZWNpZmllcnMgcmVxdWlyZWQgYnkgSUVFRSAxMDAzLjFcbiAgICAgICAgICAgIC8vIChkLCBpICwgbywgdSwgeCwgYW5kIFgpIGZvciBjb21wbGV0ZW5lc3NcbiAgICAgICAgICAgIHN3aXRjaCAoc3BlY2lmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJlYXQgYWxsIGludCB0eXBlcyBhcyB1aW50LFxuICAgICAgICAgICAgICAgIC8vIGhlbmNlIGRlbGliZXJhdGUgZmFsbHRocm91Z2hcbiAgICAgICAgICAgICAgICBjYXNlICdkJzpcbiAgICAgICAgICAgICAgICBjYXNlICdpJzpcbiAgICAgICAgICAgICAgICBjYXNlICd1JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoKSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd4JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ1gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdvJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoOCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1Vuc3VwcG9ydGVkL2ludmFsaWQgSUVFRSAxMDAzLjEgZm9ybWF0IGlkZW50aWZpZXIgc3RyaW5nIGluIFVSTCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVtcGxhdGVTdHIgPSB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoMCwgc3RhcnRQb3MpICsgcGFkZGVkVmFsdWUgKyB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZW5kUG9zICsgMSk7XG4gICAgfVxufTtcblxudW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0cikge1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJCQnKS5qb2luKCckJyk7XG59O1xuXG5yZXBsYWNlSURGb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdGVtcGxhdGVTdHIuaW5kZXhPZignJFJlcHJlc2VudGF0aW9uSUQkJykgPT09IC0xKSB7IHJldHVybiB0ZW1wbGF0ZVN0cjsgfVxuICAgIHZhciB2ID0gdmFsdWUudG9TdHJpbmcoKTtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyRSZXByZXNlbnRhdGlvbklEJCcpLmpvaW4odik7XG59O1xuXG5zZWdtZW50VGVtcGxhdGUgPSB7XG4gICAgemVyb1BhZFRvTGVuZ3RoOiB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGU6IHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGU6IHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU6IHJlcGxhY2VJREZvclRlbXBsYXRlXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHNlZ21lbnRUZW1wbGF0ZTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBldmVudE1nciA9IHJlcXVpcmUoJy4vZXZlbnRNYW5hZ2VyLmpzJyksXG4gICAgZXZlbnREaXNwYXRjaGVyTWl4aW4gPSB7XG4gICAgICAgIHRyaWdnZXI6IGZ1bmN0aW9uKGV2ZW50T2JqZWN0KSB7IGV2ZW50TWdyLnRyaWdnZXIodGhpcywgZXZlbnRPYmplY3QpOyB9LFxuICAgICAgICBvbmU6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub25lKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvbjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb2ZmOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9mZih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfVxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnREaXNwYXRjaGVyTWl4aW47IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmlkZW9qcyA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS52aWRlb2pzLFxuICAgIGV2ZW50TWFuYWdlciA9IHtcbiAgICAgICAgdHJpZ2dlcjogdmlkZW9qcy50cmlnZ2VyLFxuICAgICAgICBvbmU6IHZpZGVvanMub25lLFxuICAgICAgICBvbjogdmlkZW9qcy5vbixcbiAgICAgICAgb2ZmOiB2aWRlb2pzLm9mZlxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnRNYW5hZ2VyO1xuIiwiLyoqXG4gKlxuICogbWFpbiBzb3VyY2UgZm9yIHBhY2thZ2VkIGNvZGUuIEF1dG8tYm9vdHN0cmFwcyB0aGUgc291cmNlIGhhbmRsaW5nIGZ1bmN0aW9uYWxpdHkgYnkgcmVnaXN0ZXJpbmcgdGhlIHNvdXJjZSBoYW5kbGVyXG4gKiB3aXRoIHZpZGVvLmpzIG9uIGluaXRpYWwgc2NyaXB0IGxvYWQgdmlhIElJRkUuIChOT1RFOiBUaGlzIHBsYWNlcyBhbiBvcmRlciBkZXBlbmRlbmN5IG9uIHRoZSB2aWRlby5qcyBsaWJyYXJ5LCB3aGljaFxuICogbXVzdCBhbHJlYWR5IGJlIGxvYWRlZCBiZWZvcmUgdGhpcyBzY3JpcHQgYXV0by1leGVjdXRlcy4pXG4gKlxuICovXG47KGZ1bmN0aW9uKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciByb290ID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLFxuICAgICAgICB2aWRlb2pzID0gcm9vdC52aWRlb2pzLFxuICAgICAgICBTb3VyY2VIYW5kbGVyID0gcmVxdWlyZSgnLi9Tb3VyY2VIYW5kbGVyJyksXG4gICAgICAgIENhbkhhbmRsZVNvdXJjZUVudW0gPSB7XG4gICAgICAgICAgICBET0VTTlRfSEFORExFX1NPVVJDRTogJycsXG4gICAgICAgICAgICBNQVlCRV9IQU5ETEVfU09VUkNFOiAnbWF5YmUnXG4gICAgICAgIH07XG5cbiAgICBpZiAoIXZpZGVvanMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgdmlkZW8uanMgbGlicmFyeSBtdXN0IGJlIGluY2x1ZGVkIHRvIHVzZSB0aGlzIE1QRUctREFTSCBzb3VyY2UgaGFuZGxlci4nKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIFVzZWQgYnkgYSB2aWRlby5qcyB0ZWNoIGluc3RhbmNlIHRvIHZlcmlmeSB3aGV0aGVyIG9yIG5vdCBhIHNwZWNpZmljIG1lZGlhIHNvdXJjZSBjYW4gYmUgaGFuZGxlZCBieSB0aGlzXG4gICAgICogc291cmNlIGhhbmRsZXIuIEluIHRoaXMgY2FzZSwgc2hvdWxkIHJldHVybiAnbWF5YmUnIGlmIHRoZSBzb3VyY2UgaXMgTVBFRy1EQVNILCBvdGhlcndpc2UgJycgKHJlcHJlc2VudGluZyBubykuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge29iamVjdH0gc291cmNlICAgICAgICAgICB2aWRlby5qcyBzb3VyY2Ugb2JqZWN0IHByb3ZpZGluZyBzb3VyY2UgdXJpIGFuZCB0eXBlIGluZm9ybWF0aW9uXG4gICAgICogQHJldHVybnMge0NhbkhhbmRsZVNvdXJjZUVudW19ICAgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIHdoZXRoZXIgb3Igbm90IHBhcnRpY3VsYXIgc291cmNlIGNhbiBiZSBoYW5kbGVkIGJ5IHRoaXNcbiAgICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2UgaGFuZGxlci5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBjYW5IYW5kbGVTb3VyY2Uoc291cmNlKSB7XG4gICAgICAgIC8vIFJlcXVpcmVzIE1lZGlhIFNvdXJjZSBFeHRlbnNpb25zXG4gICAgICAgIGlmICghKHJvb3QuTWVkaWFTb3VyY2UpKSB7XG4gICAgICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5ET0VTTlRfSEFORExFX1NPVVJDRTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSB0eXBlIGlzIHN1cHBvcnRlZFxuICAgICAgICBpZiAoL2FwcGxpY2F0aW9uXFwvZGFzaFxcK3htbC8udGVzdChzb3VyY2UudHlwZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLk1BWUJFX0hBTkRMRV9TT1VSQ0U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleHRlbnNpb24gbWF0Y2hlc1xuICAgICAgICBpZiAoL1xcLm1wZCQvaS50ZXN0KHNvdXJjZS5zcmMpKSB7XG4gICAgICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5NQVlCRV9IQU5ETEVfU09VUkNFO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uRE9FU05UX0hBTkRMRV9TT1VSQ0U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBDYWxsZWQgYnkgYSB2aWRlby5qcyB0ZWNoIGluc3RhbmNlIHRvIGhhbmRsZSBhIHNwZWNpZmljIG1lZGlhIHNvdXJjZSwgcmV0dXJuaW5nIGFuIG9iamVjdCBpbnN0YW5jZSB0aGF0IHByb3ZpZGVzXG4gICAgICogdGhlIGNvbnRleHQgZm9yIGhhbmRsaW5nIHNhaWQgc291cmNlLlxuICAgICAqXG4gICAgICogQHBhcmFtIHNvdXJjZSAgICAgICAgICAgIHZpZGVvLmpzIHNvdXJjZSBvYmplY3QgcHJvdmlkaW5nIHNvdXJjZSB1cmkgYW5kIHR5cGUgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gdGVjaCAgICAgICAgICAgICAgdmlkZW8uanMgdGVjaCBvYmplY3QgKGluIHRoaXMgY2FzZSwgc2hvdWxkIGJlIEh0bWw1IHRlY2gpIHByb3ZpZGluZyBwb2ludCBvZiBpbnRlcmFjdGlvblxuICAgICAqICAgICAgICAgICAgICAgICAgICAgICAgICBiZXR3ZWVuIHRoZSBzb3VyY2UgaGFuZGxlciBhbmQgdGhlIHZpZGVvLmpzIGxpYnJhcnkgKGluY2x1ZGluZywgZS5nLiwgdGhlIHZpZGVvIGVsZW1lbnQpXG4gICAgICogQHJldHVybnMge1NvdXJjZUhhbmRsZXJ9IEFuIG9iamVjdCB0aGF0IGRlZmluZXMgY29udGV4dCBmb3IgaGFuZGxpbmcgYSBwYXJ0aWN1bGFyIE1QRUctREFTSCBzb3VyY2UuXG4gICAgICovXG4gICAgZnVuY3Rpb24gaGFuZGxlU291cmNlKHNvdXJjZSwgdGVjaCkge1xuICAgICAgICByZXR1cm4gbmV3IFNvdXJjZUhhbmRsZXIoc291cmNlLCB0ZWNoKTtcbiAgICB9XG5cbiAgICAvLyBSZWdpc3RlciB0aGUgc291cmNlIGhhbmRsZXIgdG8gdGhlIEh0bWw1IHRlY2ggaW5zdGFuY2UuXG4gICAgdmlkZW9qcy5IdG1sNS5yZWdpc3RlclNvdXJjZUhhbmRsZXIoe1xuICAgICAgICBjYW5IYW5kbGVTb3VyY2U6IGNhbkhhbmRsZVNvdXJjZSxcbiAgICAgICAgaGFuZGxlU291cmNlOiBoYW5kbGVTb3VyY2VcbiAgICB9LCAwKTtcblxufS5jYWxsKHRoaXMpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgdHJ1dGh5ID0gcmVxdWlyZSgnLi4vdXRpbC90cnV0aHkuanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4uL3V0aWwvaXNTdHJpbmcuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGZpbmRFbGVtZW50SW5BcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvZmluZEVsZW1lbnRJbkFycmF5LmpzJyksXG4gICAgZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlID0gcmVxdWlyZSgnLi4vdXRpbC9nZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUuanMnKSxcbiAgICBsb2FkTWFuaWZlc3QgPSByZXF1aXJlKCcuL2xvYWRNYW5pZmVzdC5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVxdWlyZSgnLi4vZGFzaC9tcGQvdXRpbC5qcycpLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGdldE1wZCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIE1lZGlhU2V0ID0gcmVxdWlyZSgnLi4vTWVkaWFTZXQuanMnKSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVzLmpzJyk7XG5cbi8qKlxuICpcbiAqIFRoZSBNYW5pZmVzdENvbnRyb2xsZXIgbG9hZHMsIHN0b3JlcywgYW5kIHByb3ZpZGVzIGRhdGEgdmlld3MgZm9yIHRoZSBNUEQgbWFuaWZlc3QgdGhhdCByZXByZXNlbnRzIHRoZVxuICogTVBFRy1EQVNIIG1lZGlhIHNvdXJjZSBiZWluZyBoYW5kbGVkLlxuICpcbiAqIEBwYXJhbSBzb3VyY2VVcmkge3N0cmluZ31cbiAqIEBwYXJhbSBhdXRvTG9hZCAge2Jvb2xlYW59XG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gTWFuaWZlc3RDb250cm9sbGVyKHNvdXJjZVVyaSwgYXV0b0xvYWQpIHtcbiAgICB0aGlzLl9fYXV0b0xvYWQgPSB0cnV0aHkoYXV0b0xvYWQpO1xuICAgIHRoaXMuc2V0U291cmNlVXJpKHNvdXJjZVVyaSk7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBNQU5JRkVTVF9MT0FERUQ6ICdtYW5pZmVzdExvYWRlZCdcbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0U291cmNlVXJpID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX19zb3VyY2VVcmk7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLnNldFNvdXJjZVVyaSA9IGZ1bmN0aW9uIHNldFNvdXJjZVVyaShzb3VyY2VVcmkpIHtcbiAgICAvLyBUT0RPOiAnZXhpc3R5KCknIGNoZWNrIGZvciBib3RoP1xuICAgIGlmIChzb3VyY2VVcmkgPT09IHRoaXMuX19zb3VyY2VVcmkpIHsgcmV0dXJuOyB9XG5cbiAgICAvLyBUT0RPOiBpc1N0cmluZygpIGNoZWNrPyAnZXhpc3R5KCknIGNoZWNrP1xuICAgIGlmICghc291cmNlVXJpKSB7XG4gICAgICAgIHRoaXMuX19jbGVhclNvdXJjZVVyaSgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTmVlZCB0byBwb3RlbnRpYWxseSByZW1vdmUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgbWFuaWZlc3QgKGluIGNhc2UgaXQgaXMgYSBkeW5hbWljIE1QRClcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICB0aGlzLl9fc291cmNlVXJpID0gc291cmNlVXJpO1xuICAgIC8vIElmIHdlIHNob3VsZCBhdXRvbWF0aWNhbGx5IGxvYWQgdGhlIE1QRCwgZ28gYWhlYWQgYW5kIGtpY2sgb2ZmIGxvYWRpbmcgaXQuXG4gICAgaWYgKHRoaXMuX19hdXRvTG9hZCkge1xuICAgICAgICAvLyBUT0RPOiBJbXBsIGFueSBjbGVhbnVwIGZ1bmN0aW9uYWxpdHkgYXBwcm9wcmlhdGUgYmVmb3JlIGxvYWQuXG4gICAgICAgIHRoaXMubG9hZCgpO1xuICAgIH1cbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuX19jbGVhclNvdXJjZVVyaSA9IGZ1bmN0aW9uIGNsZWFyU291cmNlVXJpKCkge1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBudWxsO1xuICAgIC8vIE5lZWQgdG8gcG90ZW50aWFsbHkgcmVtb3ZlIHVwZGF0ZSBpbnRlcnZhbCBmb3IgcmUtcmVxdWVzdGluZyB0aGUgTVBEIG1hbmlmZXN0IChpbiBjYXNlIGl0IGlzIGEgZHluYW1pYyBNUEQpXG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgLy8gVE9ETzogaW1wbCBhbnkgb3RoZXIgY2xlYW51cCBmdW5jdGlvbmFsaXR5XG59O1xuXG4vKipcbiAqIEtpY2sgb2ZmIGxvYWRpbmcgdGhlIERBU0ggTVBEIE1hbmlmZXN0IChzZXJ2ZWQgQCB0aGUgTWFuaWZlc3RDb250cm9sbGVyIGluc3RhbmNlJ3MgX19zb3VyY2VVcmkpXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uIGxvYWQoKSB7XG4gICAgLy8gVE9ETzogQ3VycmVudGx5IGNsZWFyaW5nICYgcmUtc2V0dGluZyB1cGRhdGUgaW50ZXJ2YWwgYWZ0ZXIgZXZlcnkgcmVxdWVzdC4gRWl0aGVyIHVzZSBzZXRUaW1lb3V0KCkgb3Igb25seSBzZXR1cCBpbnRlcnZhbCBvbmNlXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGxvYWRNYW5pZmVzdChzZWxmLl9fc291cmNlVXJpLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHNlbGYuX19tYW5pZmVzdCA9IGRhdGEubWFuaWZlc3RYbWw7XG4gICAgICAgIC8vIChQb3RlbnRpYWxseSkgc2V0dXAgdGhlIHVwZGF0ZSBpbnRlcnZhbCBmb3IgcmUtcmVxdWVzdGluZyB0aGUgTVBEIChpbiBjYXNlIHRoZSBtYW5pZmVzdCBpcyBkeW5hbWljKVxuICAgICAgICBzZWxmLl9fc2V0dXBVcGRhdGVJbnRlcnZhbCgpO1xuICAgICAgICAvLyBEaXNwYXRjaCBldmVudCB0byBub3RpZnkgdGhhdCB0aGUgbWFuaWZlc3QgaGFzIGxvYWRlZC5cbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5NQU5JRkVTVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlbGYuX19tYW5pZmVzdH0pO1xuICAgIH0pO1xufTtcblxuLyoqXG4gKiAnUHJpdmF0ZScgbWV0aG9kIHRoYXQgcmVtb3ZlcyB0aGUgdXBkYXRlIGludGVydmFsIChpZiBpdCBleGlzdHMpLCBzbyB0aGUgTWFuaWZlc3RDb250cm9sbGVyIGluc3RhbmNlIHdpbGwgbm8gbG9uZ2VyXG4gKiBwZXJpb2RpY2FsbHkgcmUtcmVxdWVzdCB0aGUgbWFuaWZlc3QgKGlmIGl0J3MgZHluYW1pYykuXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCA9IGZ1bmN0aW9uIGNsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCkge1xuICAgIGlmICghZXhpc3R5KHRoaXMuX191cGRhdGVJbnRlcnZhbCkpIHsgcmV0dXJuOyB9XG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpO1xufTtcblxuLyoqXG4gKiBTZXRzIHVwIGFuIGludGVydmFsIHRvIHJlLXJlcXVlc3QgdGhlIG1hbmlmZXN0IChpZiBpdCdzIGR5bmFtaWMpXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuX19zZXR1cFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gc2V0dXBVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICAvLyBJZiB0aGVyZSdzIGFscmVhZHkgYW4gdXBkYXRlSW50ZXJ2YWwgZnVuY3Rpb24sIHJlbW92ZSBpdC5cbiAgICBpZiAodGhpcy5fX3VwZGF0ZUludGVydmFsKSB7IHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpOyB9XG4gICAgLy8gSWYgd2Ugc2hvdWxkbid0IHVwZGF0ZSwganVzdCBiYWlsLlxuICAgIGlmICghdGhpcy5nZXRTaG91bGRVcGRhdGUoKSkgeyByZXR1cm47IH1cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1pblVwZGF0ZVJhdGUgPSAyLFxuICAgICAgICB1cGRhdGVSYXRlID0gTWF0aC5tYXgodGhpcy5nZXRVcGRhdGVSYXRlKCksIG1pblVwZGF0ZVJhdGUpO1xuICAgIC8vIFNldHVwIHRoZSB1cGRhdGUgaW50ZXJ2YWwgYmFzZWQgb24gdGhlIHVwZGF0ZSByYXRlIChkZXRlcm1pbmVkIGZyb20gdGhlIG1hbmlmZXN0KSBvciB0aGUgbWluaW11bSB1cGRhdGUgcmF0ZVxuICAgIC8vICh3aGljaGV2ZXIncyBsYXJnZXIpLlxuICAgIC8vIE5PVEU6IE11c3Qgc3RvcmUgcmVmIHRvIGNyZWF0ZWQgaW50ZXJ2YWwgdG8gcG90ZW50aWFsbHkgY2xlYXIvcmVtb3ZlIGl0IGxhdGVyXG4gICAgdGhpcy5fX3VwZGF0ZUludGVydmFsID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYubG9hZCgpO1xuICAgIH0sIHVwZGF0ZVJhdGUgKiAxMDAwKTtcbn07XG5cbi8qKlxuICogR2V0cyB0aGUgdHlwZSBvZiBwbGF5bGlzdCAoJ3N0YXRpYycgb3IgJ2R5bmFtaWMnLCB3aGljaCBuZWFybHkgaW52YXJpYWJseSBjb3JyZXNwb25kcyB0byBsaXZlIHZzLiB2b2QpIGRlZmluZWQgaW4gdGhlXG4gKiBtYW5pZmVzdC5cbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAgICB0aGUgcGxheWxpc3QgdHlwZSAoZWl0aGVyICdzdGF0aWMnIG9yICdkeW5hbWljJylcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRQbGF5bGlzdFR5cGUgPSBmdW5jdGlvbiBnZXRQbGF5bGlzdFR5cGUoKSB7XG4gICAgdmFyIHBsYXlsaXN0VHlwZSA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFR5cGUoKTtcbiAgICByZXR1cm4gcGxheWxpc3RUeXBlO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRVcGRhdGVSYXRlID0gZnVuY3Rpb24gZ2V0VXBkYXRlUmF0ZSgpIHtcbiAgICB2YXIgbWluaW11bVVwZGF0ZVBlcmlvZFN0ciA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldE1pbmltdW1VcGRhdGVQZXJpb2QoKSxcbiAgICAgICAgbWluaW11bVVwZGF0ZVBlcmlvZCA9IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbihtaW5pbXVtVXBkYXRlUGVyaW9kU3RyKTtcbiAgICByZXR1cm4gbWluaW11bVVwZGF0ZVBlcmlvZCB8fCAwO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRTaG91bGRVcGRhdGUgPSBmdW5jdGlvbiBnZXRTaG91bGRVcGRhdGUoKSB7XG4gICAgdmFyIGlzRHluYW1pYyA9ICh0aGlzLmdldFBsYXlsaXN0VHlwZSgpID09PSAnZHluYW1pYycpLFxuICAgICAgICBoYXNWYWxpZFVwZGF0ZVJhdGUgPSAodGhpcy5nZXRVcGRhdGVSYXRlKCkgPiAwKTtcbiAgICByZXR1cm4gKGlzRHluYW1pYyAmJiBoYXNWYWxpZFVwZGF0ZVJhdGUpO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRNcGQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCk7XG59O1xuXG4vKipcbiAqXG4gKiBAcGFyYW0gdHlwZVxuICogQHJldHVybnMge01lZGlhU2V0fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0QnlUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRCeVR5cGUodHlwZSkge1xuICAgIGlmIChtZWRpYVR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7IHRocm93IG5ldyBFcnJvcignSW52YWxpZCB0eXBlLiBWYWx1ZSBtdXN0IGJlIG9uZSBvZjogJyArIG1lZGlhVHlwZXMuam9pbignLCAnKSk7IH1cbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2ggPSBmaW5kRWxlbWVudEluQXJyYXkoYWRhcHRhdGlvblNldHMsIGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHtcbiAgICAgICAgICAgIHJldHVybiAoZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKGFkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcykgPT09IHR5cGUpO1xuICAgICAgICB9KTtcbiAgICBpZiAoIWV4aXN0eShhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKTtcbn07XG5cbi8qKlxuICpcbiAqIEByZXR1cm5zIHtBcnJheS48TWVkaWFTZXQ+fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0cyA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0cygpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgbWVkaWFTZXRzID0gYWRhcHRhdGlvblNldHMubWFwKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHsgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0KTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0cztcbn07XG5cbi8vIE1peGluIGV2ZW50IGhhbmRsaW5nIGZvciB0aGUgTWFuaWZlc3RDb250cm9sbGVyIG9iamVjdCB0eXBlIGRlZmluaXRpb24uXG5leHRlbmRPYmplY3QoTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hbmlmZXN0Q29udHJvbGxlcjsiLCJtb2R1bGUuZXhwb3J0cyA9IFsndmlkZW8nLCAnYXVkaW8nXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwgPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VSb290VXJsO1xuXG5mdW5jdGlvbiBsb2FkTWFuaWZlc3QodXJsLCBjYWxsYmFjaykge1xuICAgIHZhciBhY3R1YWxVcmwgPSBwYXJzZVJvb3RVcmwodXJsKSxcbiAgICAgICAgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICBvbmxvYWQ7XG5cbiAgICBvbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkgeyByZXR1cm47IH1cblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrKHttYW5pZmVzdFhtbDogcmVxdWVzdC5yZXNwb25zZVhNTCB9KTsgfVxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Lm9ubG9hZCA9IG9ubG9hZDtcbiAgICAgICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgICAgICByZXF1ZXN0LnNlbmQoKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgcmVxdWVzdC5vbmVycm9yKCk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxvYWRNYW5pZmVzdDsiLCJcbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGlzTnVtYmVyID0gcmVxdWlyZSgnLi4vdXRpbC9pc051bWJlci5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBsb2FkU2VnbWVudCxcbiAgICBERUZBVUxUX1JFVFJZX0NPVU5UID0gMyxcbiAgICBERUZBVUxUX1JFVFJZX0lOVEVSVkFMID0gMjUwO1xuXG4vKipcbiAqIEdlbmVyaWMgZnVuY3Rpb24gZm9yIGxvYWRpbmcgTVBFRy1EQVNIIHNlZ21lbnRzXG4gKiBAcGFyYW0gc2VnbWVudCB7b2JqZWN0fSAgICAgICAgICBkYXRhIHZpZXcgcmVwcmVzZW50aW5nIGEgc2VnbWVudCAoYW5kIHJlbGV2YW50IGRhdGEgZm9yIHRoYXQgc2VnbWVudClcbiAqIEBwYXJhbSBjYWxsYmFja0ZuIHtmdW5jdGlvbn0gICAgIGNhbGxiYWNrIGZ1bmN0aW9uXG4gKiBAcGFyYW0gcmV0cnlDb3VudCB7bnVtYmVyfSAgICAgICBzdGlwdWxhdGVzIGhvdyBtYW55IHRpbWVzIHdlIHNob3VsZCB0cnkgdG8gbG9hZCB0aGUgc2VnbWVudCBiZWZvcmUgZ2l2aW5nIHVwXG4gKiBAcGFyYW0gcmV0cnlJbnRlcnZhbCB7bnVtYmVyfSAgICBzdGlwdWxhdGVzIHRoZSBhbW91bnQgb2YgdGltZSAoaW4gbWlsbGlzZWNvbmRzKSB3ZSBzaG91bGQgd2FpdCBiZWZvcmUgcmV0cnlpbmcgdG9cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvd25sb2FkIHRoZSBzZWdtZW50IGlmL3doZW4gdGhlIGRvd25sb2FkIGF0dGVtcHQgZmFpbHMuXG4gKi9cbmxvYWRTZWdtZW50ID0gZnVuY3Rpb24oc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCwgcmV0cnlJbnRlcnZhbCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gbnVsbDtcblxuICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIHVybCA9IHNlZ21lbnQuZ2V0VXJsKCk7XG4gICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcblxuICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrRm4gPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2tGbi5jYWxsKHNlbGYsIHJlcXVlc3QucmVzcG9uc2UpOyB9XG4gICAgfTtcbiAgICAvL3JlcXVlc3Qub25lcnJvciA9IHJlcXVlc3Qub25sb2FkZW5kID0gZnVuY3Rpb24oKSB7XG4gICAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH07XG5cbiAgICBzZWxmLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lID0gTnVtYmVyKChuZXcgRGF0ZSgpLmdldFRpbWUoKSkvMTAwMCk7XG4gICAgcmVxdWVzdC5zZW5kKCk7XG59O1xuXG4vKipcbiAqXG4gKiBTZWdtZW50TG9hZGVyIGhhbmRsZXMgbG9hZGluZyBzZWdtZW50cyBmcm9tIHNlZ21lbnQgbGlzdHMgZm9yIGEgZ2l2ZW4gbWVkaWEgc2V0LCBiYXNlZCBvbiB0aGUgY3VycmVudGx5IHNlbGVjdGVkXG4gKiBzZWdtZW50IGxpc3QgKHdoaWNoIGNvcnJlc3BvbmRzIHRvIHRoZSBjdXJyZW50bHkgc2V0IGJhbmR3aWR0aC9iaXRyYXRlKVxuICpcbiAqIEBwYXJhbSBtYW5pZmVzdENvbnRyb2xsZXIge01hbmlmZXN0Q29udHJvbGxlcn1cbiAqIEBwYXJhbSBtZWRpYVR5cGUge3N0cmluZ31cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBTZWdtZW50TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFUeXBlKSB7XG4gICAgaWYgKCFleGlzdHkobWFuaWZlc3RDb250cm9sbGVyKSkgeyB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXIgbXVzdCBiZSBpbml0aWFsaXplZCB3aXRoIGEgbWFuaWZlc3RDb250cm9sbGVyIScpOyB9XG4gICAgaWYgKCFleGlzdHkobWVkaWFUeXBlKSkgeyB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXIgbXVzdCBiZSBpbml0aWFsaXplZCB3aXRoIGEgbWVkaWFUeXBlIScpOyB9XG4gICAgLy8gTk9URTogUmF0aGVyIHRoYW4gcGFzc2luZyBpbiBhIHJlZmVyZW5jZSB0byB0aGUgTWVkaWFTZXQgaW5zdGFuY2UgZm9yIGEgbWVkaWEgdHlwZSwgd2UgcGFzcyBpbiBhIHJlZmVyZW5jZSB0byB0aGVcbiAgICAvLyBjb250cm9sbGVyICYgdGhlIG1lZGlhVHlwZSBzbyB0aGF0IHRoZSBTZWdtZW50TG9hZGVyIGRvZXNuJ3QgbmVlZCB0byBiZSBhd2FyZSBvZiBzdGF0ZSBjaGFuZ2VzL3VwZGF0ZXMgdG9cbiAgICAvLyB0aGUgbWFuaWZlc3QgZGF0YSAoc2F5LCBpZiB0aGUgcGxheWxpc3QgaXMgZHluYW1pYy8nbGl2ZScpLlxuICAgIHRoaXMuX19tYW5pZmVzdCA9IG1hbmlmZXN0Q29udHJvbGxlcjtcbiAgICB0aGlzLl9fbWVkaWFUeXBlID0gbWVkaWFUeXBlO1xuICAgIC8vIFRPRE86IERvbid0IGxpa2UgdGhpczogTmVlZCB0byBjZW50cmFsaXplIHBsYWNlKHMpIHdoZXJlICYgaG93IF9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgZ2V0cyBzZXQgdG8gdHJ1ZS9mYWxzZS5cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgSU5JVElBTElaQVRJT05fTE9BREVEOiAnaW5pdGlhbGl6YXRpb25Mb2FkZWQnLFxuICAgIFNFR01FTlRfTE9BREVEOiAnc2VnbWVudExvYWRlZCcsXG4gICAgRE9XTkxPQURfREFUQV9VUERBVEU6ICdkb3dubG9hZERhdGFVcGRhdGUnXG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5fX2dldE1lZGlhU2V0ID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXQoKSB7XG4gICAgdmFyIG1lZGlhU2V0ID0gdGhpcy5fX21hbmlmZXN0LmdldE1lZGlhU2V0QnlUeXBlKHRoaXMuX19tZWRpYVR5cGUpO1xuICAgIHJldHVybiBtZWRpYVNldDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0cygpWzBdO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRDdXJyZW50QmFuZHdpZHRoKCkge1xuICAgIGlmICghaXNOdW1iZXIodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpKSB7IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5fX2dldERlZmF1bHRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpOyB9XG4gICAgcmV0dXJuIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoO1xufTtcblxuLyoqXG4gKiBTZXRzIHRoZSBjdXJyZW50IGJhbmR3aWR0aCwgd2hpY2ggY29ycmVzcG9uZHMgdG8gdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgKGkuZS4gdGhlIHNlZ21lbnQgbGlzdCBpbiB0aGVcbiAqIG1lZGlhIHNldCBmcm9tIHdoaWNoIHdlIHNob3VsZCBiZSBkb3dubG9hZGluZyBzZWdtZW50cykuXG4gKiBAcGFyYW0gYmFuZHdpZHRoIHtudW1iZXJ9XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLnNldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBzZXRDdXJyZW50QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIGlmICghaXNOdW1iZXIoYmFuZHdpZHRoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBleHBlY3RzIGEgbnVtZXJpYyB2YWx1ZSBmb3IgYmFuZHdpZHRoIScpO1xuICAgIH1cbiAgICB2YXIgYXZhaWxhYmxlQmFuZHdpZHRocyA9IHRoaXMuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIGlmIChhdmFpbGFibGVCYW5kd2lkdGhzLmluZGV4T2YoYmFuZHdpZHRoKSA8IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyOjpzZXRDdXJyZW50QmFuZHdpZHRoKCkgbXVzdCBiZSBzZXQgdG8gb25lIG9mIHRoZSBmb2xsb3dpbmcgdmFsdWVzOiAnICsgYXZhaWxhYmxlQmFuZHdpZHRocy5qb2luKCcsICcpKTtcbiAgICB9XG4gICAgaWYgKGJhbmR3aWR0aCA9PT0gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgLy8gVHJhY2sgd2hlbiB3ZSd2ZSBzd2l0Y2ggYmFuZHdpZHRocywgc2luY2Ugd2UnbGwgbmVlZCB0byAocmUpbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIHNlZ21lbnQgbGlzdFxuICAgIC8vIHdoZW5ldmVyIHdlIHN3aXRjaCBiZXR3ZWVuIHNlZ21lbnQgbGlzdHMuIFRoaXMgYWxsb3dzIFNlZ21lbnRMb2FkZXIgaW5zdGFuY2VzIHRvIGF1dG9tYXRpY2FsbHkgZG8gdGhpcywgaGlkaW5nIHRob3NlXG4gICAgLy8gZGV0YWlscyBmcm9tIHRoZSBvdXRzaWRlLlxuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSBiYW5kd2lkdGg7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudExpc3QgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudExpc3QoKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0ID0gIHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgodGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCkpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXZhaWxhYmxlQmFuZHdpZHRocyA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKTtcbiAgICByZXR1cm4gYXZhaWxhYmxlQmFuZHdpZHRocztcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldFN0YXJ0TnVtYmVyID0gZnVuY3Rpb24gZ2V0U3RhcnROdW1iZXIoKSB7XG4gICAgdmFyIHN0YXJ0TnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RTdGFydE51bWJlcigpO1xuICAgIHJldHVybiBzdGFydE51bWJlcjtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50ID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnQoKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeU51bWJlcih0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIpO1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudE51bWJlcigpIHsgcmV0dXJuIHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnRTdGFydFRpbWUgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudFN0YXJ0VGltZSgpIHsgcmV0dXJuIHRoaXMuZ2V0Q3VycmVudFNlZ21lbnQoKS5nZXRTdGFydE51bWJlcigpOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRFbmROdW1iZXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZW5kTnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gZW5kTnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBleGlzdHkodGhpcy5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSkgPyB0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lIDogLTE7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSgpIC0gdGhpcy5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUoKTtcbn07XG5cbi8qKlxuICpcbiAqIE1ldGhvZCBmb3IgZG93bmxvYWRpbmcgdGhlIGluaXRpYWxpemF0aW9uIHNlZ21lbnQgZm9yIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0ICh3aGljaCBjb3JyZXNwb25kcyB0byB0aGVcbiAqIGN1cnJlbnRseSBzZXQgYmFuZHdpZHRoKVxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkSW5pdGlhbGl6YXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKSxcbiAgICAgICAgaW5pdGlhbGl6YXRpb24gPSBzZWdtZW50TGlzdC5nZXRJbml0aWFsaXphdGlvbigpO1xuXG4gICAgaWYgKCFpbml0aWFsaXphdGlvbikgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgaW5pdGlhbGl6YXRpb24sIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciBpbml0U2VnbWVudCA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWROZXh0U2VnbWVudCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub0N1cnJlbnRTZWdtZW50TnVtYmVyID0gZXhpc3R5KHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciksXG4gICAgICAgIG51bWJlciA9IG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPyB0aGlzLmdldFN0YXJ0TnVtYmVyKCkgOiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgKyAxO1xuICAgIHJldHVybiB0aGlzLmxvYWRTZWdtZW50QXROdW1iZXIobnVtYmVyKTtcbn07XG5cbi8vIFRPRE86IER1cGxpY2F0ZSBjb2RlIGJlbG93LiBBYnN0cmFjdCBhd2F5LlxuLyoqXG4gKlxuICogTWV0aG9kIGZvciBkb3dubG9hZGluZyBhIHNlZ21lbnQgZnJvbSB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCBiYXNlZCBvbiBpdHMgXCJudW1iZXJcIiAoc2VlIHBhcmFtIGNvbW1lbnQgYmVsb3cpXG4gKlxuICogQHBhcmFtIG51bWJlciB7bnVtYmVyfSAgIEluZGV4LWxpa2UgdmFsdWUgZm9yIHNwZWNpZnlpbmcgd2hpY2ggc2VnbWVudCB0byBsb2FkIGZyb20gdGhlIHNlZ21lbnQgbGlzdC5cbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0TnVtYmVyID0gZnVuY3Rpb24obnVtYmVyKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCk7XG5cbiAgICBpZiAobnVtYmVyID4gdGhpcy5nZXRFbmROdW1iZXIoKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBzZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5TnVtYmVyKG51bWJlcik7XG5cbiAgICAvLyBJZiB0aGUgYmFuZHdpZHRoIGhhcyBjaGFuZ2VkIHNpbmNlIG91ciBsYXN0IGRvd25sb2FkLCBhdXRvbWF0aWNhbGx5IGxvYWQgdGhlIGluaXRpYWxpemF0aW9uIHNlZ21lbnQgZm9yIHRoZSBjb3JyZXNwb25kaW5nXG4gICAgLy8gc2VnbWVudCBsaXN0IGJlZm9yZSBkb3dubG9hZGluZyB0aGUgZGVzaXJlZCBzZWdtZW50KVxuICAgIGlmICh0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQpIHtcbiAgICAgICAgdGhpcy5vbmUodGhpcy5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gZXZlbnQuZGF0YTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IGZhbHNlO1xuICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOltpbml0U2VnbWVudCwgc2VnbWVudERhdGFdIH0pO1xuICAgICAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmxvYWRJbml0aWFsaXphdGlvbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIC8vIERpc3BhdGNoIGV2ZW50IHRoYXQgcHJvdmlkZXMgbWV0cmljcyBvbiBkb3dubG9hZCByb3VuZCB0cmlwIHRpbWUgJiBiYW5kd2lkdGggb2Ygc2VnbWVudCAodXNlZCB3aXRoIEFCUiBzd2l0Y2hpbmcgbG9naWMpXG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX0RBVEFfVVBEQVRFLFxuICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHNlbGYsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ0dDogc2VsZi5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGxheWJhY2tUaW1lOiBzZWdtZW50LmdldER1cmF0aW9uKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBiYW5kd2lkdGg6IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWdtZW50RGF0YSB9KTtcbiAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG4vKipcbiAqXG4gKiBNZXRob2QgZm9yIGRvd25sb2FkaW5nIGEgc2VnbWVudCBmcm9tIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0IGJhc2VkIG9uIHRoZSBtZWRpYSBwcmVzZW50YXRpb24gdGltZSB0aGF0XG4gKiBjb3JyZXNwb25kcyB3aXRoIGEgZ2l2ZW4gc2VnbWVudC5cbiAqXG4gKiBAcGFyYW0gcHJlc2VudGF0aW9uVGltZSB7bnVtYmVyfSBtZWRpYSBwcmVzZW50YXRpb24gdGltZSBjb3JyZXNwb25kaW5nIHRvIHRoZSBzZWdtZW50IHdlJ2QgbGlrZSB0byBsb2FkIGZyb20gdGhlIHNlZ21lbnQgbGlzdFxuICogQHJldHVybnMge2Jvb2xlYW59XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRTZWdtZW50QXRUaW1lID0gZnVuY3Rpb24ocHJlc2VudGF0aW9uVGltZSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpO1xuXG4gICAgaWYgKHByZXNlbnRhdGlvblRpbWUgPiBzZWdtZW50TGlzdC5nZXRUb3RhbER1cmF0aW9uKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVRpbWUocHJlc2VudGF0aW9uVGltZSk7XG5cbiAgICAvLyBJZiB0aGUgYmFuZHdpZHRoIGhhcyBjaGFuZ2VkIHNpbmNlIG91ciBsYXN0IGRvd25sb2FkLCBhdXRvbWF0aWNhbGx5IGxvYWQgdGhlIGluaXRpYWxpemF0aW9uIHNlZ21lbnQgZm9yIHRoZSBjb3JyZXNwb25kaW5nXG4gICAgLy8gc2VnbWVudCBsaXN0IGJlZm9yZSBkb3dubG9hZGluZyB0aGUgZGVzaXJlZCBzZWdtZW50KVxuICAgIGlmICh0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQpIHtcbiAgICAgICAgdGhpcy5vbmUodGhpcy5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gZXZlbnQuZGF0YTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IGZhbHNlO1xuICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOltpbml0U2VnbWVudCwgc2VnbWVudERhdGFdIH0pO1xuICAgICAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmxvYWRJbml0aWFsaXphdGlvbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIC8vIERpc3BhdGNoIGV2ZW50IHRoYXQgcHJvdmlkZXMgbWV0cmljcyBvbiBkb3dubG9hZCByb3VuZCB0cmlwIHRpbWUgJiBiYW5kd2lkdGggb2Ygc2VnbWVudCAodXNlZCB3aXRoIEFCUiBzd2l0Y2hpbmcgbG9naWMpXG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX0RBVEFfVVBEQVRFLFxuICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHNlbGYsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ0dDogc2VsZi5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGxheWJhY2tUaW1lOiBzZWdtZW50LmdldER1cmF0aW9uKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBiYW5kd2lkdGg6IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlZ21lbnREYXRhIH0pO1xuICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNlZ21lbnRMb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciBiYW5kd2lkdGhBID0gc2VnbWVudExpc3RBLmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBiYW5kd2lkdGhCID0gc2VnbWVudExpc3RCLmdldEJhbmR3aWR0aCgpO1xuICAgIHJldHVybiBiYW5kd2lkdGhBIC0gYmFuZHdpZHRoQjtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5V2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgd2lkdGhBID0gc2VnbWVudExpc3RBLmdldFdpZHRoKCkgfHwgMCxcbiAgICAgICAgd2lkdGhCID0gc2VnbWVudExpc3RCLmdldFdpZHRoKCkgfHwgMDtcbiAgICByZXR1cm4gd2lkdGhBIC0gd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aFRoZW5CYW5kd2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgcmVzb2x1dGlvbkNvbXBhcmUgPSBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qik7XG4gICAgcmV0dXJuIChyZXNvbHV0aW9uQ29tcGFyZSAhPT0gMCkgPyByZXNvbHV0aW9uQ29tcGFyZSA6IGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qik7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclNlZ21lbnRMaXN0c0J5UmVzb2x1dGlvbihzZWdtZW50TGlzdCwgbWF4V2lkdGgsIG1heEhlaWdodCkge1xuICAgIHZhciB3aWR0aCA9IHNlZ21lbnRMaXN0LmdldFdpZHRoKCkgfHwgMCxcbiAgICAgICAgaGVpZ2h0ID0gc2VnbWVudExpc3QuZ2V0SGVpZ2h0KCkgfHwgMDtcbiAgICByZXR1cm4gKCh3aWR0aCA8PSBtYXhXaWR0aCkgJiYgKGhlaWdodCA8PSBtYXhIZWlnaHQpKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QsIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCwgZG93bmxvYWRSYXRlUmF0aW8pIHtcbiAgICB2YXIgc2VnbWVudExpc3RCYW5kd2lkdGggPSBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSxcbiAgICAgICAgc2VnbWVudEJhbmR3aWR0aFJhdGlvID0gc2VnbWVudExpc3RCYW5kd2lkdGggLyBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG4gICAgZG93bmxvYWRSYXRlUmF0aW8gPSBkb3dubG9hZFJhdGVSYXRpbyB8fCBOdW1iZXIuTUFYX1ZBTFVFO1xuICAgIHJldHVybiAoZG93bmxvYWRSYXRlUmF0aW8gPj0gc2VnbWVudEJhbmR3aWR0aFJhdGlvKTtcbn1cblxuLy8gTk9URTogUGFzc2luZyBpbiBtZWRpYVNldCBpbnN0ZWFkIG9mIG1lZGlhU2V0J3MgU2VnbWVudExpc3QgQXJyYXkgc2luY2Ugc29ydCBpcyBkZXN0cnVjdGl2ZSBhbmQgZG9uJ3Qgd2FudCB0byBjbG9uZS5cbi8vICAgICAgQWxzbyBhbGxvd3MgZm9yIGdyZWF0ZXIgZmxleGliaWxpdHkgb2YgZm4uXG5mdW5jdGlvbiBzZWxlY3RTZWdtZW50TGlzdChtZWRpYVNldCwgZGF0YSkge1xuICAgIHZhciBkb3dubG9hZFJhdGVSYXRpbyA9IGRhdGEuZG93bmxvYWRSYXRlUmF0aW8sXG4gICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGRhdGEuY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLFxuICAgICAgICB3aWR0aCA9IGRhdGEud2lkdGgsXG4gICAgICAgIGhlaWdodCA9IGRhdGEuaGVpZ2h0LFxuICAgICAgICBzb3J0ZWRCeUJhbmR3aWR0aCA9IG1lZGlhU2V0LmdldFNlZ21lbnRMaXN0cygpLnNvcnQoY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKSxcbiAgICAgICAgZmlsdGVyZWRCeURvd25sb2FkUmF0ZSxcbiAgICAgICAgZmlsdGVyZWRCeVJlc29sdXRpb24sXG4gICAgICAgIHByb3Bvc2VkU2VnbWVudExpc3Q7XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJCeVJlc29sdXRpb24oc2VnbWVudExpc3QpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlclNlZ21lbnRMaXN0c0J5UmVzb2x1dGlvbihzZWdtZW50TGlzdCwgd2lkdGgsIGhlaWdodCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlclNlZ21lbnRMaXN0c0J5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0LCBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGgsIGRvd25sb2FkUmF0ZVJhdGlvKTtcbiAgICB9XG5cbiAgICBmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlID0gc29ydGVkQnlCYW5kd2lkdGguZmlsdGVyKGZpbHRlckJ5RG93bmxvYWRSYXRlKTtcbiAgICBmaWx0ZXJlZEJ5UmVzb2x1dGlvbiA9IGZpbHRlcmVkQnlEb3dubG9hZFJhdGUuc29ydChjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aFRoZW5CYW5kd2lkdGhBc2NlbmRpbmcpLmZpbHRlcihmaWx0ZXJCeVJlc29sdXRpb24pO1xuXG4gICAgcHJvcG9zZWRTZWdtZW50TGlzdCA9IGZpbHRlcmVkQnlSZXNvbHV0aW9uW2ZpbHRlcmVkQnlSZXNvbHV0aW9uLmxlbmd0aCAtIDFdIHx8IHNvcnRlZEJ5QmFuZHdpZHRoWzBdO1xuXG4gICAgcmV0dXJuIHByb3Bvc2VkU2VnbWVudExpc3Q7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gc2VsZWN0U2VnbWVudExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGlzQXJyYXkgPSByZXF1aXJlKCcuLi91dGlsL2lzQXJyYXkuanMnKSxcbiAgICBpc051bWJlciA9IHJlcXVpcmUoJy4uL3V0aWwvaXNOdW1iZXIuanMnKSxcbiAgICBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKTtcblxuZnVuY3Rpb24gY3JlYXRlVGltZVJhbmdlT2JqZWN0KHNvdXJjZUJ1ZmZlciwgaW5kZXgsIHRyYW5zZm9ybUZuKSB7XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHRyYW5zZm9ybUZuKSkge1xuICAgICAgICB0cmFuc2Zvcm1GbiA9IGZ1bmN0aW9uKHRpbWUpIHsgcmV0dXJuIHRpbWU7IH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0U3RhcnQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdHJhbnNmb3JtRm4oc291cmNlQnVmZmVyLmJ1ZmZlcmVkLnN0YXJ0KGluZGV4KSk7IH0sXG4gICAgICAgIGdldEVuZDogZnVuY3Rpb24oKSB7IHJldHVybiB0cmFuc2Zvcm1Gbihzb3VyY2VCdWZmZXIuYnVmZmVyZWQuZW5kKGluZGV4KSk7IH0sXG4gICAgICAgIGdldEluZGV4OiBmdW5jdGlvbigpIHsgcmV0dXJuIGluZGV4OyB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHNvdXJjZUJ1ZmZlciwgdHJhbnNmb3JtRm4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRMZW5ndGg6IGZ1bmN0aW9uKCkgeyByZXR1cm4gc291cmNlQnVmZmVyLmJ1ZmZlcmVkLmxlbmd0aDsgfSxcbiAgICAgICAgZ2V0VGltZVJhbmdlQnlJbmRleDogZnVuY3Rpb24oaW5kZXgpIHsgcmV0dXJuIGNyZWF0ZVRpbWVSYW5nZU9iamVjdChzb3VyY2VCdWZmZXIsIGluZGV4LCB0cmFuc2Zvcm1Gbik7IH0sXG4gICAgICAgIGdldFRpbWVSYW5nZUJ5VGltZTogZnVuY3Rpb24odGltZSwgdG9sZXJhbmNlKSB7XG4gICAgICAgICAgICBpZiAoIWlzTnVtYmVyKHRvbGVyYW5jZSkpIHsgdG9sZXJhbmNlID0gMC4xNTsgfVxuICAgICAgICAgICAgdmFyIHRpbWVSYW5nZU9iaixcbiAgICAgICAgICAgICAgICBpLFxuICAgICAgICAgICAgICAgIGxlbmd0aCA9IHNvdXJjZUJ1ZmZlci5idWZmZXJlZC5sZW5ndGg7XG5cbiAgICAgICAgICAgIGZvciAoaT0wOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGltZVJhbmdlT2JqID0gY3JlYXRlVGltZVJhbmdlT2JqZWN0KHNvdXJjZUJ1ZmZlciwgaSwgdHJhbnNmb3JtRm4pO1xuICAgICAgICAgICAgICAgIGlmICgodGltZVJhbmdlT2JqLmdldFN0YXJ0KCkgLSB0b2xlcmFuY2UpID4gdGltZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgICAgICAgICAgICAgIGlmICgodGltZVJhbmdlT2JqLmdldEVuZCgpICsgdG9sZXJhbmNlKSA+IHRpbWUpIHsgcmV0dXJuIHRpbWVSYW5nZU9iajsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUFsaWduZWRCdWZmZXJlZFRpbWVSYW5nZUxpc3Qoc291cmNlQnVmZmVyLCBzZWdtZW50RHVyYXRpb24pIHtcbiAgICBmdW5jdGlvbiB0aW1lQWxpZ25UcmFuc2Zvcm1Gbih0aW1lKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJvdW5kKHRpbWUgLyBzZWdtZW50RHVyYXRpb24pICogc2VnbWVudER1cmF0aW9uO1xuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVCdWZmZXJlZFRpbWVSYW5nZUxpc3Qoc291cmNlQnVmZmVyLCB0aW1lQWxpZ25UcmFuc2Zvcm1Gbik7XG59XG5cbi8qKlxuICogU291cmNlQnVmZmVyRGF0YVF1ZXVlIGFkZHMvcXVldWVzIHNlZ21lbnRzIHRvIHRoZSBjb3JyZXNwb25kaW5nIE1TRSBTb3VyY2VCdWZmZXIgKE5PVEU6IFRoZXJlIHNob3VsZCBiZSBvbmUgcGVyIG1lZGlhIHR5cGUvbWVkaWEgc2V0KVxuICpcbiAqIEBwYXJhbSBzb3VyY2VCdWZmZXIge1NvdXJjZUJ1ZmZlcn0gICBNU0UgU291cmNlQnVmZmVyIGluc3RhbmNlXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU291cmNlQnVmZmVyRGF0YVF1ZXVlKHNvdXJjZUJ1ZmZlcikge1xuICAgIC8vIFRPRE86IENoZWNrIHR5cGU/XG4gICAgaWYgKCFzb3VyY2VCdWZmZXIpIHsgdGhyb3cgbmV3IEVycm9yKCAnVGhlIHNvdXJjZUJ1ZmZlciBjb25zdHJ1Y3RvciBhcmd1bWVudCBjYW5ub3QgYmUgbnVsbC4nICk7IH1cblxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgZGF0YVF1ZXVlID0gW107XG4gICAgLy8gVE9ETzogZmlndXJlIG91dCBob3cgd2Ugd2FudCB0byByZXNwb25kIHRvIG90aGVyIGV2ZW50IHN0YXRlcyAodXBkYXRlZW5kPyBlcnJvcj8gYWJvcnQ/KSAocmV0cnk/IHJlbW92ZT8pXG4gICAgc291cmNlQnVmZmVyLmFkZEV2ZW50TGlzdGVuZXIoJ3VwZGF0ZWVuZCcsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIC8vIFRoZSBTb3VyY2VCdWZmZXIgaW5zdGFuY2UncyB1cGRhdGluZyBwcm9wZXJ0eSBzaG91bGQgYWx3YXlzIGJlIGZhbHNlIGlmIHRoaXMgZXZlbnQgd2FzIGRpc3BhdGNoZWQsXG4gICAgICAgIC8vIGJ1dCBqdXN0IGluIGNhc2UuLi5cbiAgICAgICAgaWYgKGV2ZW50LnRhcmdldC51cGRhdGluZykgeyByZXR1cm47IH1cblxuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfQURERURfVE9fQlVGRkVSLCB0YXJnZXQ6c2VsZiB9KTtcblxuICAgICAgICBpZiAoc2VsZi5fX2RhdGFRdWV1ZS5sZW5ndGggPD0gMCkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzZWxmLl9fc291cmNlQnVmZmVyLmFwcGVuZEJ1ZmZlcihzZWxmLl9fZGF0YVF1ZXVlLnNoaWZ0KCkpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IGRhdGFRdWV1ZTtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyID0gc291cmNlQnVmZmVyO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUVVFVUVfRU1QVFk6ICdxdWV1ZUVtcHR5JyxcbiAgICBTRUdNRU5UX0FEREVEX1RPX0JVRkZFUjogJ3NlZ21lbnRBZGRlZFRvQnVmZmVyJ1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5hZGRUb1F1ZXVlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBkYXRhVG9BZGRJbW1lZGlhdGVseTtcbiAgICBpZiAoIWV4aXN0eShkYXRhKSB8fCAoaXNBcnJheShkYXRhKSAmJiBkYXRhLmxlbmd0aCA8PSAwKSkgeyByZXR1cm47IH1cbiAgICAvLyBUcmVhdCBhbGwgZGF0YSBhcyBhcnJheXMgdG8gbWFrZSBzdWJzZXF1ZW50IGZ1bmN0aW9uYWxpdHkgZ2VuZXJpYy5cbiAgICBpZiAoIWlzQXJyYXkoZGF0YSkpIHsgZGF0YSA9IFtkYXRhXTsgfVxuICAgIC8vIElmIG5vdGhpbmcgaXMgaW4gdGhlIHF1ZXVlLCBnbyBhaGVhZCBhbmQgaW1tZWRpYXRlbHkgYXBwZW5kIHRoZSBmaXJzdCBkYXRhIHRvIHRoZSBzb3VyY2UgYnVmZmVyLlxuICAgIGlmICgodGhpcy5fX2RhdGFRdWV1ZS5sZW5ndGggPT09IDApICYmICghdGhpcy5fX3NvdXJjZUJ1ZmZlci51cGRhdGluZykpIHsgZGF0YVRvQWRkSW1tZWRpYXRlbHkgPSBkYXRhLnNoaWZ0KCk7IH1cbiAgICAvLyBJZiBhbnkgb3RoZXIgZGF0YSAoc3RpbGwpIGV4aXN0cywgcHVzaCB0aGUgcmVzdCBvbnRvIHRoZSBkYXRhUXVldWUuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IHRoaXMuX19kYXRhUXVldWUuY29uY2F0KGRhdGEpO1xuICAgIGlmIChleGlzdHkoZGF0YVRvQWRkSW1tZWRpYXRlbHkpKSB7IHRoaXMuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKGRhdGFUb0FkZEltbWVkaWF0ZWx5KTsgfVxufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5jbGVhclF1ZXVlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IFtdO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5nZXRCdWZmZXJlZFRpbWVSYW5nZUxpc3QgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gY3JlYXRlQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHRoaXMuX19zb3VyY2VCdWZmZXIpO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5nZXRCdWZmZXJlZFRpbWVSYW5nZUxpc3RBbGlnbmVkVG9TZWdtZW50RHVyYXRpb24gPSBmdW5jdGlvbihzZWdtZW50RHVyYXRpb24pIHtcbiAgICByZXR1cm4gY3JlYXRlQWxpZ25lZEJ1ZmZlcmVkVGltZVJhbmdlTGlzdCh0aGlzLl9fc291cmNlQnVmZmVyLCBzZWdtZW50RHVyYXRpb24pO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTsiLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIGV4aXN0eSh4KSB7IHJldHVybiAoeCAhPT0gbnVsbCkgJiYgKHggIT09IHVuZGVmaW5lZCk7IH1cblxubW9kdWxlLmV4cG9ydHMgPSBleGlzdHk7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBFeHRlbmQgYSBnaXZlbiBvYmplY3Qgd2l0aCBhbGwgdGhlIHByb3BlcnRpZXMgKGFuZCB0aGVpciB2YWx1ZXMpIGZvdW5kIGluIHRoZSBwYXNzZWQtaW4gb2JqZWN0KHMpLlxudmFyIGV4dGVuZE9iamVjdCA9IGZ1bmN0aW9uKG9iaiAvKiwgZXh0ZW5kT2JqZWN0MSwgZXh0ZW5kT2JqZWN0MiwgLi4uLCBleHRlbmRPYmplY3ROICovKSB7XG4gICAgdmFyIGV4dGVuZE9iamVjdHNBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgIGksXG4gICAgICAgIGxlbmd0aCA9IGV4dGVuZE9iamVjdHNBcnJheS5sZW5ndGgsXG4gICAgICAgIGV4dGVuZE9iamVjdDtcblxuICAgIGZvcihpPTA7IGk8bGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZXh0ZW5kT2JqZWN0ID0gZXh0ZW5kT2JqZWN0c0FycmF5W2ldO1xuICAgICAgICBpZiAoZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgICAgIG9ialtwcm9wXSA9IGV4dGVuZE9iamVjdFtwcm9wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvYmo7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZE9iamVjdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnLi9pc0FycmF5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vaXNGdW5jdGlvbi5qcycpLFxuICAgIGZpbmRFbGVtZW50SW5BcnJheTtcblxuZmluZEVsZW1lbnRJbkFycmF5ID0gZnVuY3Rpb24oYXJyYXksIHByZWRpY2F0ZUZuKSB7XG4gICAgaWYgKCFpc0FycmF5KGFycmF5KSB8fCAhaXNGdW5jdGlvbihwcmVkaWNhdGVGbikpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHZhciBpLFxuICAgICAgICBsZW5ndGggPSBhcnJheS5sZW5ndGgsXG4gICAgICAgIGVsZW07XG5cbiAgICBmb3IgKGk9MDsgaTxsZW5ndGg7IGkrKykge1xuICAgICAgICBlbGVtID0gYXJyYXlbaV07XG4gICAgICAgIGlmIChwcmVkaWNhdGVGbihlbGVtLCBpLCBhcnJheSkpIHsgcmV0dXJuIGVsZW07IH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmaW5kRWxlbWVudEluQXJyYXk7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi9leGlzdHkuanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4vaXNTdHJpbmcuanMnKSxcbiAgICBmaW5kRWxlbWVudEluQXJyYXkgPSByZXF1aXJlKCcuL2ZpbmRFbGVtZW50SW5BcnJheS5qcycpLFxuICAgIGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZTtcblxuLyoqXG4gKlxuICogRnVuY3Rpb24gdXNlZCB0byBnZXQgdGhlIG1lZGlhIHR5cGUgYmFzZWQgb24gdGhlIG1pbWUgdHlwZS4gVXNlZCB0byBkZXRlcm1pbmUgdGhlIG1lZGlhIHR5cGUgb2YgQWRhcHRhdGlvbiBTZXRzXG4gKiBvciBjb3JyZXNwb25kaW5nIGRhdGEgcmVwcmVzZW50YXRpb25zLlxuICpcbiAqIEBwYXJhbSBtaW1lVHlwZSB7c3RyaW5nfSBtaW1lIHR5cGUgZm9yIGEgREFTSCBNUEQgQWRhcHRhdGlvbiBTZXQgKHNwZWNpZmllZCBhcyBhbiBhdHRyaWJ1dGUgc3RyaW5nKVxuICogQHBhcmFtIHR5cGVzIHtzdHJpbmd9ICAgIHN1cHBvcnRlZCBtZWRpYSB0eXBlcyAoZS5nLiAndmlkZW8sJyAnYXVkaW8sJylcbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgICAgICB0aGUgbWVkaWEgdHlwZSB0aGF0IGNvcnJlc3BvbmRzIHRvIHRoZSBtaW1lIHR5cGUuXG4gKi9cbmdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSA9IGZ1bmN0aW9uKG1pbWVUeXBlLCB0eXBlcykge1xuICAgIGlmICghaXNTdHJpbmcobWltZVR5cGUpKSB7IHJldHVybiBudWxsOyB9ICAgLy8gVE9ETzogVGhyb3cgZXJyb3I/XG4gICAgdmFyIG1hdGNoZWRUeXBlID0gZmluZEVsZW1lbnRJbkFycmF5KHR5cGVzLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgIHJldHVybiAoISFtaW1lVHlwZSAmJiBtaW1lVHlwZS5pbmRleE9mKHR5cGUpID49IDApO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1hdGNoZWRUeXBlO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGU7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzQXJyYXkob2JqKSB7XG4gICAgcmV0dXJuIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzRnVuY3Rpb24gPSBmdW5jdGlvbiBpc0Z1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcbn07XG4vLyBmYWxsYmFjayBmb3Igb2xkZXIgdmVyc2lvbnMgb2YgQ2hyb21lIGFuZCBTYWZhcmlcbmlmIChpc0Z1bmN0aW9uKC94LykpIHtcbiAgICBpc0Z1bmN0aW9uID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXSc7XG4gICAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0Z1bmN0aW9uOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc051bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBOdW1iZXJdJyB8fCBmYWxzZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc051bWJlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgU3RyaW5nXScgfHwgZmFsc2U7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzU3RyaW5nOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vZXhpc3R5LmpzJyk7XG5cbi8vIE5PVEU6IFRoaXMgdmVyc2lvbiBvZiB0cnV0aHkgYWxsb3dzIG1vcmUgdmFsdWVzIHRvIGNvdW50XG4vLyBhcyBcInRydWVcIiB0aGFuIHN0YW5kYXJkIEpTIEJvb2xlYW4gb3BlcmF0b3IgY29tcGFyaXNvbnMuXG4vLyBTcGVjaWZpY2FsbHksIHRydXRoeSgpIHdpbGwgcmV0dXJuIHRydWUgZm9yIHRoZSB2YWx1ZXNcbi8vIDAsIFwiXCIsIGFuZCBOYU4sIHdoZXJlYXMgSlMgd291bGQgdHJlYXQgdGhlc2UgYXMgXCJmYWxzeVwiIHZhbHVlcy5cbmZ1bmN0aW9uIHRydXRoeSh4KSB7IHJldHVybiAoeCAhPT0gZmFsc2UpICYmIGV4aXN0eSh4KTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IHRydXRoeTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIFRPRE86IFJlZmFjdG9yIHRvIHNlcGFyYXRlIGpzIGZpbGVzICYgbW9kdWxlcyAmIHJlbW92ZSBmcm9tIGhlcmUuXG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuL3V0aWwvaXNTdHJpbmcuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbmZ1bmN0aW9uIHByZUFwcGx5QXJnc0ZuKGZ1biAvKiwgYXJncyAqLykge1xuICAgIHZhciBwcmVBcHBsaWVkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgLy8gTk9URTogdGhlICp0aGlzKiByZWZlcmVuY2Ugd2lsbCByZWZlciB0byB0aGUgY2xvc3VyZSdzIGNvbnRleHQgdW5sZXNzXG4gICAgLy8gdGhlIHJldHVybmVkIGZ1bmN0aW9uIGlzIGl0c2VsZiBjYWxsZWQgdmlhIC5jYWxsKCkgb3IgLmFwcGx5KCkuIElmIHlvdVxuICAgIC8vICpuZWVkKiB0byByZWZlciB0byBpbnN0YW5jZS1sZXZlbCBwcm9wZXJ0aWVzLCBkbyBzb21ldGhpbmcgbGlrZSB0aGUgZm9sbG93aW5nOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBmdW5jdGlvbihhcmdDKSB7IHByZUFwcGx5QXJnc0ZuKHNvbWVPdGhlckZuLCBhcmdBLCBhcmdCLCAuLi4gYXJnTikuY2FsbCh0aGlzKTsgfTtcbiAgICAvL1xuICAgIC8vIE90aGVyd2lzZSwgeW91IHNob3VsZCBiZSBhYmxlIHRvIGp1c3QgY2FsbDpcbiAgICAvL1xuICAgIC8vIE15VHlwZS5wcm90b3R5cGUuc29tZUZuID0gcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKTtcbiAgICAvL1xuICAgIC8vIFdoZXJlIHBvc3NpYmxlLCBmdW5jdGlvbnMgYW5kIG1ldGhvZHMgc2hvdWxkIG5vdCBiZSByZWFjaGluZyBvdXQgdG8gZ2xvYmFsIHNjb3BlIGFueXdheSwgc28uLi5cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7IHJldHVybiBmdW4uYXBwbHkodGhpcywgcHJlQXBwbGllZEFyZ3MpOyB9O1xufVxuXG4vLyBIaWdoZXItb3JkZXIgWE1MIGZ1bmN0aW9uc1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHNcbnZhciBnZXRBbmNlc3RvcnMgPSBmdW5jdGlvbihlbGVtLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIHZhciBhbmNlc3RvcnMgPSBbXTtcbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIChmdW5jdGlvbiBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0sIGFuY2VzdG9ycykpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmIChleGlzdHkoZWxlbSkgJiYgZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHtcbiAgICAgICAgICAgIGFuY2VzdG9ycy5wdXNoKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgICAgICBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH0pKGVsZW0pO1xuICAgIHJldHVybiBhbmNlc3RvcnM7XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0Tm9kZUxpc3RCeU5hbWUgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHhtbE9iaikge1xuICAgICAgICByZXR1cm4geG1sT2JqLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSwgdmFsdWUpIHtcbiAgICBpZiAoKHR5cGVvZiBhdHRyTmFtZSAhPT0gJ3N0cmluZycpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICAgIGlmICghZXhpc3R5KHZhbHVlKSkgeyByZXR1cm4gZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIHJldHVybiAoZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpID09PSB2YWx1ZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRBdHRyRm4gPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICghaXNTdHJpbmcoYXR0ck5hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhaXNGdW5jdGlvbihlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG4vLyBUT0RPOiBBZGQgc2hvdWxkU3RvcFByZWQgKHNob3VsZCBmdW5jdGlvbiBzaW1pbGFybHkgdG8gc2hvdWxkU3RvcFByZWQgaW4gZ2V0SW5oZXJpdGFibGVFbGVtZW50LCBiZWxvdylcbnZhciBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcoYXR0ck5hbWUpKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSkpIHsgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHM7IFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBmdW5jdGlvbihub2RlTmFtZSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhub2RlTmFtZSkpIHx8IG5vZGVOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICB2YXIgbWF0Y2hpbmdFbGVtTGlzdCA9IGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUobm9kZU5hbWUpO1xuICAgICAgICBpZiAoZXhpc3R5KG1hdGNoaW5nRWxlbUxpc3QpICYmIG1hdGNoaW5nRWxlbUxpc3QubGVuZ3RoID4gMCkgeyByZXR1cm4gbWF0Y2hpbmdFbGVtTGlzdFswXTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxudmFyIGdldENoaWxkRWxlbWVudEJ5Tm9kZU5hbWUgPSBmdW5jdGlvbihub2RlTmFtZSkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhaXNGdW5jdGlvbihlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBpbml0aWFsTWF0Y2hlcyA9IGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUobm9kZU5hbWUpLFxuICAgICAgICAgICAgY3VycmVudEVsZW07XG4gICAgICAgIGlmICghZXhpc3R5KGluaXRpYWxNYXRjaGVzKSB8fCBpbml0aWFsTWF0Y2hlcy5sZW5ndGggPD0gMCkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGN1cnJlbnRFbGVtID0gaW5pdGlhbE1hdGNoZXNbMF07XG4gICAgICAgIHJldHVybiAoY3VycmVudEVsZW0ucGFyZW50Tm9kZSA9PT0gZWxlbSkgPyBjdXJyZW50RWxlbSA6IHVuZGVmaW5lZDtcbiAgICB9O1xufTtcblxudmFyIGdldE11bHRpTGV2ZWxFbGVtZW50TGlzdCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHZhciBnZXRNYXRjaGluZ0NoaWxkTm9kZUZuID0gZ2V0Q2hpbGRFbGVtZW50QnlOb2RlTmFtZShub2RlTmFtZSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgdmFyIGN1cnJlbnRFbGVtID0gZWxlbSxcbiAgICAgICAgICAgIG11bHRpTGV2ZWxFbGVtTGlzdCA9IFtdLFxuICAgICAgICAgICAgbWF0Y2hpbmdFbGVtO1xuICAgICAgICAvLyBUT0RPOiBSZXBsYWNlIHcvcmVjdXJzaXZlIGZuP1xuICAgICAgICB3aGlsZSAoZXhpc3R5KGN1cnJlbnRFbGVtKSAmJiAhc2hvdWxkU3RvcFByZWQoY3VycmVudEVsZW0pKSB7XG4gICAgICAgICAgICBtYXRjaGluZ0VsZW0gPSBnZXRNYXRjaGluZ0NoaWxkTm9kZUZuKGN1cnJlbnRFbGVtKTtcbiAgICAgICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtKSkgeyBtdWx0aUxldmVsRWxlbUxpc3QucHVzaChtYXRjaGluZ0VsZW0pOyB9XG4gICAgICAgICAgICBjdXJyZW50RWxlbSA9IGN1cnJlbnRFbGVtLnBhcmVudE5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbXVsdGlMZXZlbEVsZW1MaXN0Lmxlbmd0aCA+IDAgPyBtdWx0aUxldmVsRWxlbUxpc3QgOiB1bmRlZmluZWQ7XG4gICAgfTtcbn07XG5cbi8vIFRPRE86IEltcGxlbWVudCBtZSBmb3IgQmFzZVVSTCBvciB1c2UgZXhpc3RpbmcgZm4gKFNlZTogbXBkLmpzIGJ1aWxkQmFzZVVybCgpKVxuLyp2YXIgYnVpbGRIaWVyYXJjaGljYWxseVN0cnVjdHVyZWRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlRm4sIGJ1aWxkRm4sIHN0b3BQcmVkKSB7XG5cbn07Ki9cblxuLy8gUHVibGlzaCBFeHRlcm5hbCBBUEk6XG52YXIgeG1sZnVuID0ge307XG54bWxmdW4uZXhpc3R5ID0gZXhpc3R5O1xueG1sZnVuLnRydXRoeSA9IHRydXRoeTtcblxueG1sZnVuLmdldE5vZGVMaXN0QnlOYW1lID0gZ2V0Tm9kZUxpc3RCeU5hbWU7XG54bWxmdW4uaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBoYXNNYXRjaGluZ0F0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGdldEluaGVyaXRhYmxlQXR0cmlidXRlO1xueG1sZnVuLmdldEFuY2VzdG9ycyA9IGdldEFuY2VzdG9ycztcbnhtbGZ1bi5nZXRBdHRyRm4gPSBnZXRBdHRyRm47XG54bWxmdW4ucHJlQXBwbHlBcmdzRm4gPSBwcmVBcHBseUFyZ3NGbjtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBnZXRJbmhlcml0YWJsZUVsZW1lbnQ7XG54bWxmdW4uZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0ID0gZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHhtbGZ1bjsiXX0=
