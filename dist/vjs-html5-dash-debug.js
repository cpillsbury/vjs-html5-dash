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
},{"./events/EventDispatcherMixin.js":9,"./util/existy.js":18,"./util/extendObject.js":19,"./util/isFunction.js":21}],3:[function(require,module,exports){
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
},{"./MediaTypeLoader.js":2,"./manifest/MediaTypes.js":13,"./segments/SegmentLoader.js":15,"./selectSegmentList.js":16,"./sourceBuffer/SourceBufferDataQueue.js":17,"./util/existy.js":18}],4:[function(require,module,exports){
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

},{"./PlaylistLoader.js":3,"./manifest/ManifestController.js":12,"global/window":1}],5:[function(require,module,exports){
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
},{"../../util/isArray.js":20,"../../util/isFunction.js":21,"../../util/isString.js":23,"../../xmlfun.js":25,"./util.js":6}],6:[function(require,module,exports){
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
},{}],7:[function(require,module,exports){
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
    if (Number.isNaN(wallClockStartTime)) { return null; }
    presentationTime = (unixTimeUtcMilliseconds - wallClockStartTime)/1000;
    if (Number.isNaN(presentationTime)) { return null; }
    return createSegmentFromTemplateByTime(representation, presentationTime);
};

function getSegmentListForRepresentation(representation) {
    if (!representation) { return undefined; }
    if (representation.getSegmentTemplate()) { return createSegmentListFromTemplate(representation); }
    return undefined;
}

module.exports = getSegmentListForRepresentation;

},{"../../util/existy.js":18,"../../xmlfun.js":25,"../mpd/util.js":6,"./segmentTemplate":8}],8:[function(require,module,exports){
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
},{}],9:[function(require,module,exports){
'use strict';

var eventMgr = require('./eventManager.js'),
    eventDispatcherMixin = {
        trigger: function(eventObject) { eventMgr.trigger(this, eventObject); },
        one: function(type, listenerFn) { eventMgr.one(this, type, listenerFn); },
        on: function(type, listenerFn) { eventMgr.on(this, type, listenerFn); },
        off: function(type, listenerFn) { eventMgr.off(this, type, listenerFn); }
    };

module.exports = eventDispatcherMixin;
},{"./eventManager.js":10}],10:[function(require,module,exports){
'use strict';

var videojs = require('global/window').videojs,
    eventManager = {
        trigger: videojs.trigger,
        one: videojs.one,
        on: videojs.on,
        off: videojs.off
    };

module.exports = eventManager;

},{"global/window":1}],11:[function(require,module,exports){
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

},{"./SourceHandler":4,"global/window":1}],12:[function(require,module,exports){
'use strict';

var existy = require('../util/existy.js'),
    truthy = require('../util/truthy.js'),
    isString = require('../util/isString.js'),
    isFunction = require('../util/isFunction.js'),
    isArray = require('../util/isArray.js'),
    loadManifest = require('./loadManifest.js'),
    extendObject = require('../util/extendObject.js'),
    parseMediaPresentationDuration = require('../dash/mpd/util.js').parseMediaPresentationDuration,
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    getSegmentListForRepresentation = require('../dash/segments/getSegmentListForRepresentation.js'),
    getMpd = require('../dash/mpd/getMpd.js'),
    getSourceBufferTypeFromRepresentation,
    getMediaTypeFromMimeType,
    findElementInArray,
    mediaTypes = require('./MediaTypes.js'),
    DEFAULT_TYPE = mediaTypes[0];

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
    if (!isString(mimeType)) { return DEFAULT_TYPE; }   // TODO: Throw error?
    var matchedType = findElementInArray(types, function(type) {
        return (!!mimeType && mimeType.indexOf(type) >= 0);
    });

    return existy(matchedType) ? matchedType : DEFAULT_TYPE;
};

/**
 *
 * Function used to get the 'type' of a DASH Representation in a format expected by the MSE SourceBuffer. Used to
 * create SourceBuffer instances that correspond to a given MediaSet (e.g. set of audio stream variants, video stream
 * variants, etc.).
 *
 * @param representation    POJO DASH MPD Representation
 * @returns {string}        The Representation's 'type' in a format expected by the MSE SourceBuffer
 */
getSourceBufferTypeFromRepresentation = function(representation) {
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
    return minimumUpdatePeriod;
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

// TODO: Move MediaSet definition to a separate .js file?
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
        sourceBufferType = getSourceBufferTypeFromRepresentation(representation);
    return sourceBufferType;
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

module.exports = ManifestController;
},{"../dash/mpd/getMpd.js":5,"../dash/mpd/util.js":6,"../dash/segments/getSegmentListForRepresentation.js":7,"../events/EventDispatcherMixin.js":9,"../util/existy.js":18,"../util/extendObject.js":19,"../util/isArray.js":20,"../util/isFunction.js":21,"../util/isString.js":23,"../util/truthy.js":24,"./MediaTypes.js":13,"./loadManifest.js":14}],13:[function(require,module,exports){
module.exports = ['video', 'audio'];
},{}],14:[function(require,module,exports){
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
},{"../dash/mpd/util.js":6}],15:[function(require,module,exports){

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
},{"../events/EventDispatcherMixin.js":9,"../util/existy.js":18,"../util/extendObject.js":19,"../util/isNumber.js":22}],16:[function(require,module,exports){
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
        sortedByResolutionThenBandwidth = mediaSet.getSegmentLists().sort(compareSegmentListsByWidthThenBandwidthAscending),
        filteredByDownloadRate,
        filteredByResolution,
        proposedSegmentList;

    function filterByResolution(segmentList) {
        return filterSegmentListsByResolution(segmentList, width, height);
    }

    function filterByDownloadRate(segmentList) {
        return filterSegmentListsByDownloadRate(segmentList, currentSegmentListBandwidth, downloadRateRatio);
    }

    filteredByResolution = sortedByResolutionThenBandwidth.filter(filterByResolution);
    filteredByDownloadRate = sortedByBandwidth.filter(filterByDownloadRate);

    proposedSegmentList = filteredByResolution[filteredByResolution.length - 1] || filteredByDownloadRate[filteredByDownloadRate.length - 1] || sortedByBandwidth[0];

    return proposedSegmentList;
}

module.exports = selectSegmentList;
},{}],17:[function(require,module,exports){
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
},{"../events/EventDispatcherMixin.js":9,"../util/existy.js":18,"../util/extendObject.js":19,"../util/isArray.js":20,"../util/isFunction.js":21,"../util/isNumber.js":22}],18:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],19:[function(require,module,exports){
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
},{}],20:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],21:[function(require,module,exports){
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
},{}],22:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isNumber(value) {
    return typeof value === 'number' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object Number]' || false;
}

module.exports = isNumber;
},{}],23:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object String]' || false;
};

module.exports = isString;
},{}],24:[function(require,module,exports){
'use strict';

var existy = require('./existy.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

module.exports = truthy;
},{"./existy.js":18}],25:[function(require,module,exports){
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
},{"./util/existy.js":18,"./util/isFunction.js":21,"./util/isString.js":23}]},{},[11])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0VkE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNySEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsImlmICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSB3aW5kb3c7XG59IGVsc2UgaWYgKHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGdsb2JhbDtcbn0gZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIpe1xuICAgIG1vZHVsZS5leHBvcnRzID0gc2VsZjtcbn0gZWxzZSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSB7fTtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIC8vIFRPRE86IERldGVybWluZSBhcHByb3ByaWF0ZSBkZWZhdWx0IHNpemUgKG9yIGJhc2Ugb24gc2VnbWVudCBuIHggc2l6ZS9kdXJhdGlvbj8pXG4gICAgLy8gTXVzdCBjb25zaWRlciBBQlIgU3dpdGNoaW5nICYgVmlld2luZyBleHBlcmllbmNlIG9mIGFscmVhZHktYnVmZmVyZWQgc2VnbWVudHMuXG4gICAgTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUgPSAyMCxcbiAgICBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSA9IDQwO1xuXG5mdW5jdGlvbiBoYXNWYWx1ZShvYmplY3QsIHZhbHVlKSB7XG4gICAgaWYgKCFleGlzdHkob2JqZWN0KSB8fCAhZXhpc3R5KHZhbHVlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICBmb3IgKHZhciBwcm9wIGluIG9iamVjdCkge1xuICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KHByb3ApICYmIChvYmplY3RbcHJvcF0gPT09IHZhbHVlKSkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICpcbiAqIE1lZGlhVHlwZUxvYWRlciBjb29yZGluYXRlcyBiZXR3ZWVuIHNlZ21lbnQgZG93bmxvYWRpbmcgYW5kIGFkZGluZyBzZWdtZW50cyB0byB0aGUgTVNFIHNvdXJjZSBidWZmZXIgZm9yIGEgZ2l2ZW4gbWVkaWEgdHlwZSAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpLlxuICpcbiAqIEBwYXJhbSBzZWdtZW50TG9hZGVyIHtTZWdtZW50TG9hZGVyfSAgICAgICAgICAgICAgICAgb2JqZWN0IGluc3RhbmNlIHRoYXQgaGFuZGxlcyBkb3dubG9hZGluZyBzZWdtZW50cyBmb3IgdGhlIG1lZGlhIHNldFxuICogQHBhcmFtIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSB7U291cmNlQnVmZmVyRGF0YVF1ZXVlfSBvYmplY3QgaW5zdGFuY2UgdGhhdCBoYW5kbGVzIGFkZGluZyBzZWdtZW50cyB0byBNU0UgU291cmNlQnVmZmVyXG4gKiBAcGFyYW0gbWVkaWFUeXBlIHtzdHJpbmd9ICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIG1lZGlhIHR5cGUgKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKSBmb3IgdGhlIG1lZGlhIHNldFxuICogQHBhcmFtIHRlY2gge29iamVjdH0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIGluc3RhbmNlLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIE1lZGlhVHlwZUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSwgdGVjaCkge1xuICAgIHRoaXMuX19zZWdtZW50TG9hZGVyID0gc2VnbWVudExvYWRlcjtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUkVDSEVDS19TRUdNRU5UX0xPQURJTkc6ICdyZWNoZWNrU2VnbWVudExvYWRpbmcnLFxuICAgIFJFQ0hFQ0tfQ1VSUkVOVF9TRUdNRU5UX0xJU1Q6ICdyZWNoZWNrQ3VycmVudFNlZ21lbnRMaXN0JyxcbiAgICBMT0FEX1NUQVRFX0NIQU5HRUQ6ICdsb2FkU3RhdGVDaGFuZ2VkJ1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5sb2FkU3RhdGVzID0ge1xuICAgIE5PVF9MT0FESU5HOiAtMTAsXG4gICAgV0FJVElOR19UT19DSEVDSzogMCxcbiAgICBDSEVDS0lOR19TVEFSVEVEOiAxMCxcbiAgICBXQUlUSU5HX1RPX0RPV05MT0FEOiAyMCxcbiAgICBET1dOTE9BRF9TVEFSVEVEOiAzMCxcbiAgICBBRERfVE9fQlVGRkVSX1NUQVJURUQ6IDQwLFxuICAgIExPQURJTkdfQ09NUExFVEU6IDUwXG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldExvYWRTdGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fbG9hZFN0YXRlO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zZXRMb2FkU3RhdGUgPSBmdW5jdGlvbihsb2FkU3RhdGUpIHtcbiAgICBpZiAobG9hZFN0YXRlID09PSB0aGlzLl9fbG9hZFN0YXRlIHx8ICFoYXNWYWx1ZSh0aGlzLmxvYWRTdGF0ZXMsIGxvYWRTdGF0ZSkpIHsgcmV0dXJuOyB9XG4gICAgdGhpcy5fX2xvYWRTdGF0ZSA9IGxvYWRTdGF0ZTtcbiAgICB0aGlzLnRyaWdnZXIoeyB0eXBlOnRoaXMuZXZlbnRMaXN0LkxPQURfU1RBVEVfQ0hBTkdFRCwgdGFyZ2V0OnRoaXMsIGRhdGE6bG9hZFN0YXRlIH0pO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19tZWRpYVR5cGU7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U2VnbWVudExvYWRlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXI7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlOyB9O1xuXG4vKipcbiAqIEtpY2tzIG9mZiBzZWdtZW50IGxvYWRpbmcgZm9yIHRoZSBtZWRpYSBzZXRcbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdGFydExvYWRpbmdTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3RhcnRMb2FkaW5nU2VnbWVudHNGb3JTdGF0aWNQbGF5bGlzdCgpO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdGFydExvYWRpbmdTZWdtZW50c0ZvclN0YXRpY1BsYXlsaXN0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBub3dVVEM7XG5cbiAgICAvLyBFdmVudCBsaXN0ZW5lciBmb3IgcmVjaGVja2luZyBzZWdtZW50IGxvYWRpbmcuIFRoaXMgZXZlbnQgaXMgZmlyZWQgd2hlbmV2ZXIgYSBzZWdtZW50IGhhcyBiZWVuIHN1Y2Nlc3NmdWxseVxuICAgIC8vIGRvd25sb2FkZWQgYW5kIGFkZGVkIHRvIHRoZSBidWZmZXIgb3IsIGlmIG5vdCBjdXJyZW50bHkgbG9hZGluZyBzZWdtZW50cyAoYmVjYXVzZSB0aGUgYnVmZmVyIGlzIHN1ZmZpY2llbnRseSBmdWxsXG4gICAgLy8gcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcGxheWJhY2sgdGltZSksIHdoZW5ldmVyIHNvbWUgYW1vdW50IG9mIHRpbWUgaGFzIGVsYXBzZWQgYW5kIHdlIHNob3VsZCBjaGVjayBvbiB0aGUgYnVmZmVyXG4gICAgLy8gc3RhdGUgYWdhaW4uXG4gICAgLy8gTk9URTogU3RvcmUgYSByZWZlcmVuY2UgdG8gdGhlIGV2ZW50IGhhbmRsZXIgdG8gcG90ZW50aWFsbHkgcmVtb3ZlIGl0IGxhdGVyLlxuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgc2VsZi5fX2NoZWNrU2VnbWVudExvYWRpbmcoTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUsIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFKTtcbiAgICB9O1xuXG4gICAgdGhpcy5vbih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuXG4gICAgaWYgKHRoaXMuX19zZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldElzTGl2ZSgpKSB7XG4gICAgICAgIG5vd1VUQyA9IERhdGUubm93KCk7XG4gICAgICAgIHRoaXMub25lKHRoaXMuZXZlbnRMaXN0LlJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIHNlZyA9IHNlbGYuX19zZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWUobm93VVRDKSxcbiAgICAgICAgICAgICAgICBzZWdVVENTdGFydFRpbWUgPSBzZWcuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lKCksXG4gICAgICAgICAgICAgICAgdGltZU9mZnNldCA9IChub3dVVEMgLSBzZWdVVENTdGFydFRpbWUpLzEwMDAsXG4gICAgICAgICAgICAgICAgc2Vla1RvVGltZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUuZ2V0QnVmZmVyZWRUaW1lUmFuZ2VMaXN0QWxpZ25lZFRvU2VnbWVudER1cmF0aW9uKHNlZy5nZXREdXJhdGlvbigpKS5nZXRUaW1lUmFuZ2VCeUluZGV4KDApLmdldFN0YXJ0KCkgKyB0aW1lT2Zmc2V0O1xuICAgICAgICAgICAgc2VsZi5fX3RlY2guc2V0Q3VycmVudFRpbWUoc2Vla1RvVGltZSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE1hbnVhbGx5IGNoZWNrIG9uIGxvYWRpbmcgc2VnbWVudHMgdGhlIGZpcnN0IHRpbWUgYXJvdW5kLlxuICAgIHRoaXMuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLnN0b3BMb2FkaW5nU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcikpIHsgcmV0dXJuOyB9XG5cbiAgICB0aGlzLm9mZih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gdW5kZWZpbmVkO1xufTtcblxuLyoqXG4gKlxuICogQHBhcmFtIG1pbkRlc2lyZWRCdWZmZXJTaXplIHtudW1iZXJ9IFRoZSBzdGlwdWxhdGVkIG1pbmltdW0gYW1vdW50IG9mIHRpbWUgKGluIHNlY29uZHMpIHdlIHdhbnQgaW4gdGhlIHBsYXliYWNrIGJ1ZmZlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudCBwbGF5YmFjayB0aW1lKSBmb3IgdGhlIG1lZGlhIHR5cGUuXG4gKiBAcGFyYW0gbWF4RGVzaXJlZEJ1ZmZlclNpemUge251bWJlcn0gVGhlIHN0aXB1bGF0ZWQgbWF4aW11bSBhbW91bnQgb2YgdGltZSAoaW4gc2Vjb25kcykgd2Ugd2FudCBpbiB0aGUgcGxheWJhY2sgYnVmZmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHBsYXliYWNrIHRpbWUpIGZvciB0aGUgbWVkaWEgdHlwZS5cbiAqIEBwcml2YXRlXG4gKi9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuX19jaGVja1NlZ21lbnRMb2FkaW5nID0gZnVuY3Rpb24obWluRGVzaXJlZEJ1ZmZlclNpemUsIG1heERlc2lyZWRCdWZmZXJTaXplKSB7XG4gICAgLy8gVE9ETzogVXNlIHNlZ21lbnQgZHVyYXRpb24gd2l0aCBjdXJyZW50VGltZSAmIGN1cnJlbnRCdWZmZXJTaXplIHRvIGNhbGN1bGF0ZSB3aGljaCBzZWdtZW50IHRvIGdyYWIgdG8gYXZvaWQgZWRnZSBjYXNlcyB3L3JvdW5kaW5nICYgcHJlY2lzaW9uXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICB0ZWNoID0gc2VsZi5fX3RlY2gsXG4gICAgICAgIHNlZ21lbnRMb2FkZXIgPSBzZWxmLl9fc2VnbWVudExvYWRlcixcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc2VsZi5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSxcbiAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCksXG4gICAgICAgIGN1cnJlbnRCdWZmZXJTaXplLFxuICAgICAgICBjdXJyZW50U2VnbWVudExpc3QgPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBjdXJyZW50U2VnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCksXG4gICAgICAgIHRvdGFsRHVyYXRpb24gPSBjdXJyZW50U2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpLFxuICAgICAgICBkb3dubG9hZFJvdW5kVHJpcFRpbWUsXG4gICAgICAgIHNlZ21lbnREb3dubG9hZERlbGF5LFxuICAgICAgICB0aW1lUmFuZ2VMaXN0ID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlLmdldEJ1ZmZlcmVkVGltZVJhbmdlTGlzdEFsaWduZWRUb1NlZ21lbnREdXJhdGlvbihzZWdtZW50RHVyYXRpb24pLFxuICAgICAgICBzZWdtZW50VG9Eb3dubG9hZCA9IHNlbGYuZ2V0TmV4dFNlZ21lbnRUb0xvYWQoY3VycmVudFRpbWUsIGN1cnJlbnRTZWdtZW50TGlzdCwgdGltZVJhbmdlTGlzdCksXG4gICAgICAgIGRvd25sb2FkUG9pbnQgPSBzZWdtZW50VG9Eb3dubG9hZC5nZXRTdGFydFRpbWUoKTtcblxuICAgIGN1cnJlbnRCdWZmZXJTaXplID0gZXhpc3R5KHRpbWVSYW5nZUxpc3QpICYmIHRpbWVSYW5nZUxpc3QuZ2V0TGVuZ3RoKCkgPiAwID8gZG93bmxvYWRQb2ludCAtIGN1cnJlbnRUaW1lIDogMDtcblxuICAgIC8vIFRPRE86IFVnbHkgc2VwYXJhdGlvbiBvZiBsaXZlIHZzLiBWT0QuIFJlZmFjdG9yLlxuICAgIGlmIChjdXJyZW50U2VnbWVudExpc3QuZ2V0SXNMaXZlKCkpIHtcbiAgICAgICAgaWYgKGV4aXN0eSh0aW1lUmFuZ2VMaXN0KSAmJiB0aW1lUmFuZ2VMaXN0LmdldExlbmd0aCgpIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSA9IHNlZ21lbnRMb2FkZXIuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKTtcbiAgICAgICAgICAgIHNlZ21lbnREb3dubG9hZERlbGF5ID0gc2VnbWVudER1cmF0aW9uIC0gZG93bmxvYWRSb3VuZFRyaXBUaW1lO1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBzZWdtZW50VG9Eb3dubG9hZCA9IHNlbGYuZ2V0TmV4dFNlZ21lbnRUb0xvYWQoY3VycmVudFRpbWUsIGN1cnJlbnRTZWdtZW50TGlzdCwgdGltZVJhbmdlTGlzdCk7XG4gICAgICAgICAgICAgICAgZG93bmxvYWRQb2ludCA9IHNlZ21lbnRUb0Rvd25sb2FkLmdldFN0YXJ0VGltZSgpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICAgICAgICAgIH0sIE1hdGguZmxvb3Ioc2VnbWVudERvd25sb2FkRGVsYXkgKiAxMDAwKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIExvY2FsIGZ1bmN0aW9uIHVzZWQgdG8gbm90aWZ5IHRoYXQgd2Ugc2hvdWxkIHJlY2hlY2sgc2VnbWVudCBsb2FkaW5nLiBVc2VkIHdoZW4gd2UgZG9uJ3QgbmVlZCB0byBjdXJyZW50bHkgbG9hZCBzZWdtZW50cy5cbiAgICBmdW5jdGlvbiBkZWZlcnJlZFJlY2hlY2tOb3RpZmljYXRpb24oKSB7XG4gICAgICAgIHZhciByZWNoZWNrV2FpdFRpbWVNUyA9IE1hdGguZmxvb3IoTWF0aC5taW4oc2VnbWVudER1cmF0aW9uLCAyKSAqIDEwMDApO1xuICAgICAgICByZWNoZWNrV2FpdFRpbWVNUyA9IE1hdGguZmxvb3IoTWF0aC5taW4oc2VnbWVudER1cmF0aW9uLCAyKSAqIDEwMDApO1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIH0sIHJlY2hlY2tXYWl0VGltZU1TKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGUgcHJvcG9zZWQgdGltZSB0byBkb3dubG9hZCBpcyBhZnRlciB0aGUgZW5kIHRpbWUgb2YgdGhlIG1lZGlhIG9yIHdlIGhhdmUgbW9yZSBpbiB0aGUgYnVmZmVyIHRoYW4gdGhlIG1heCBkZXNpcmVkLFxuICAgIC8vIHdhaXQgYSB3aGlsZSBhbmQgdGhlbiB0cmlnZ2VyIGFuIGV2ZW50IG5vdGlmeWluZyB0aGF0IChpZiBhbnlvbmUncyBsaXN0ZW5pbmcpIHdlIHNob3VsZCByZWNoZWNrIHRvIHNlZSBpZiBjb25kaXRpb25zXG4gICAgLy8gaGF2ZSBjaGFuZ2VkLlxuICAgIC8vIFRPRE86IEhhbmRsZSBjb25kaXRpb24gd2hlcmUgZmluYWwgc2VnbWVudCdzIGR1cmF0aW9uIGlzIGxlc3MgdGhhbiAxLzIgc3RhbmRhcmQgc2VnbWVudCdzIGR1cmF0aW9uLlxuICAgIGlmIChkb3dubG9hZFBvaW50ID49IHRvdGFsRHVyYXRpb24pIHtcbiAgICAgICAgZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoY3VycmVudEJ1ZmZlclNpemUgPCBtaW5EZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgICAgICAvLyBDb25kaXRpb24gMjogVGhlcmUncyBzb21ldGhpbmcgaW4gdGhlIHNvdXJjZSBidWZmZXIgc3RhcnRpbmcgYXQgdGhlIGN1cnJlbnQgdGltZSBmb3IgdGhlIG1lZGlhIHR5cGUsIGJ1dCBpdCdzXG4gICAgICAgIC8vICAgICAgICAgICAgICBiZWxvdyB0aGUgbWluaW11bSBkZXNpcmVkIGJ1ZmZlciBzaXplIChzZWNvbmRzIG9mIHBsYXliYWNrIGluIHRoZSBidWZmZXIgZm9yIHRoZSBtZWRpYSB0eXBlKVxuICAgICAgICAvLyBSZXNwb25zZTogRG93bmxvYWQgdGhlIHNlZ21lbnQgdGhhdCB3b3VsZCBpbW1lZGlhdGVseSBmb2xsb3cgdGhlIGVuZCBvZiB0aGUgYnVmZmVyIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudCB0aW1lKS5cbiAgICAgICAgLy8gICAgICAgICAgIHJpZ2h0IG5vdy5cbiAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudEJ1ZmZlclNpemUgPCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgICAgICAvLyBDb25kaXRpb24gMzogVGhlIGJ1ZmZlciBpcyBmdWxsIG1vcmUgdGhhbiB0aGUgbWluaW11bSBkZXNpcmVkIGJ1ZmZlciBzaXplIGJ1dCBub3QgeWV0IG1vcmUgdGhhbiB0aGUgbWF4aW11bSBkZXNpcmVkXG4gICAgICAgIC8vICAgICAgICAgICAgICBidWZmZXIgc2l6ZS5cbiAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lID0gc2VnbWVudExvYWRlci5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpO1xuICAgICAgICBzZWdtZW50RG93bmxvYWREZWxheSA9IHNlZ21lbnREdXJhdGlvbiAtIGRvd25sb2FkUm91bmRUcmlwVGltZTtcbiAgICAgICAgaWYgKHNlZ21lbnREb3dubG9hZERlbGF5IDw9IDApIHtcbiAgICAgICAgICAgIC8vIENvbmRpdGlvbiAzYTogSXQgdG9vayBhdCBsZWFzdCBhcyBsb25nIGFzIHRoZSBkdXJhdGlvbiBvZiBhIHNlZ21lbnQgKGkuZS4gdGhlIGFtb3VudCBvZiB0aW1lIGl0IHdvdWxkIHRha2VcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgdG8gcGxheSBhIGdpdmVuIHNlZ21lbnQpIHRvIGRvd25sb2FkIHRoZSBwcmV2aW91cyBzZWdtZW50LlxuICAgICAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnRcbiAgICAgICAgICAgIC8vICAgICAgICAgICB0aW1lKSByaWdodCBub3cuXG4gICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBDb25kaXRpb24gM2I6IERvd25sb2FkaW5nIHRoZSBwcmV2aW91cyBzZWdtZW50IHRvb2sgbGVzcyB0aW1lIHRoYW4gdGhlIGR1cmF0aW9uIG9mIGEgc2VnbWVudCAoaS5lLiB0aGUgYW1vdW50XG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIG9mIHRpbWUgaXQgd291bGQgdGFrZSB0byBwbGF5IGEgZ2l2ZW4gc2VnbWVudCkuXG4gICAgICAgICAgICAvLyBSZXNwb25zZTogRG93bmxvYWQgdGhlIHNlZ21lbnQgdGhhdCB3b3VsZCBpbW1lZGlhdGVseSBmb2xsb3cgdGhlIGVuZCBvZiB0aGUgYnVmZmVyIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudFxuICAgICAgICAgICAgLy8gICAgICAgICAgIHRpbWUpLCBidXQgd2FpdCB0byBkb3dubG9hZCBhdCB0aGUgcmF0ZSBvZiBwbGF5YmFjayAoc2VnbWVudCBkdXJhdGlvbiAtIHRpbWUgdG8gZG93bmxvYWQpLlxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDQgKGRlZmF1bHQpOiBUaGUgYnVmZmVyIGhhcyBhdCBsZWFzdCB0aGUgbWF4IGRlc2lyZWQgYnVmZmVyIHNpemUgaW4gaXQgb3Igbm9uZSBvZiB0aGUgYWZvcmVtZW50aW9uZWRcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgICAgICAgICBjb25kaXRpb25zIHdlcmUgbWV0LlxuICAgICAgICAvLyBSZXNwb25zZTogV2FpdCBhIHdoaWxlIGFuZCB0aGVuIHRyaWdnZXIgYW4gZXZlbnQgbm90aWZ5aW5nIHRoYXQgKGlmIGFueW9uZSdzIGxpc3RlbmluZykgd2Ugc2hvdWxkIHJlY2hlY2sgdG9cbiAgICAgICAgLy8gICAgICAgICAgIHNlZSBpZiBjb25kaXRpb25zIGhhdmUgY2hhbmdlZC5cbiAgICAgICAgZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCk7XG4gICAgfVxufTtcblxuLyoqXG4gKiBEb3dubG9hZCBhIHNlZ21lbnQgZnJvbSB0aGUgY3VycmVudCBzZWdtZW50IGxpc3QgY29ycmVzcG9uZGluZyB0byB0aGUgc3RpcHVsYXRlZCBtZWRpYSBwcmVzZW50YXRpb24gdGltZSBhbmQgYWRkIGl0XG4gKiB0byB0aGUgc291cmNlIGJ1ZmZlci5cbiAqXG4gKiBAcGFyYW0gcHJlc2VudGF0aW9uVGltZSB7bnVtYmVyfSBUaGUgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgZm9yIHdoaWNoIHdlIHdhbnQgdG8gZG93bmxvYWQgYW5kIGJ1ZmZlciBhIHNlZ21lbnRcbiAqIEByZXR1cm5zIHtib29sZWFufSAgICAgICAgICAgICAgIFdoZXRoZXIgb3Igbm90IHRoZSB0aGVyZSBhcmUgc3Vic2VxdWVudCBzZWdtZW50cyBpbiB0aGUgc2VnbWVudCBsaXN0LCByZWxhdGl2ZSB0byB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIHJlcXVlc3RlZC5cbiAqIEBwcml2YXRlXG4gKi9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuX19sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uIGxvYWRTZWdtZW50QXRUaW1lKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMb2FkZXIgPSBzZWxmLl9fc2VnbWVudExvYWRlcixcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc2VsZi5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSxcbiAgICAgICAgaGFzTmV4dFNlZ21lbnQgPSBzZWdtZW50TG9hZGVyLmxvYWRTZWdtZW50QXRUaW1lKHByZXNlbnRhdGlvblRpbWUpO1xuXG4gICAgaWYgKCFoYXNOZXh0U2VnbWVudCkgeyByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7IH1cblxuICAgIHNlZ21lbnRMb2FkZXIub25lKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCBmdW5jdGlvbiBzZWdtZW50TG9hZGVkSGFuZGxlcihldmVudCkge1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUub25lKHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5ldmVudExpc3QuUVVFVUVfRU1QVFksIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAvLyBPbmNlIHdlJ3ZlIGNvbXBsZXRlZCBkb3dubG9hZGluZyBhbmQgYnVmZmVyaW5nIHRoZSBzZWdtZW50LCBkaXNwYXRjaCBldmVudCB0byBub3RpZnkgdGhhdCB3ZSBzaG91bGQgcmVjaGVja1xuICAgICAgICAgICAgLy8gd2hldGhlciBvciBub3Qgd2Ugc2hvdWxkIGxvYWQgYW5vdGhlciBzZWdtZW50IGFuZCwgaWYgc28sIHdoaWNoLiAoU2VlOiBfX2NoZWNrU2VnbWVudExvYWRpbmcoKSBtZXRob2QsIGFib3ZlKVxuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUuYWRkVG9RdWV1ZShldmVudC5kYXRhKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBoYXNOZXh0U2VnbWVudDtcbn07XG5cbi8vIFRPRE86IE5vIGluc3RhbmNlLWxldmVsIGRlcGVuZGVuY2llcy4gTWFrZSBpbmRlcGVuZGVudCBmdW5jdGlvbj9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0TmV4dFNlZ21lbnRUb0xvYWQgPSBmdW5jdGlvbihjdXJyZW50VGltZSwgc2VnbWVudExpc3QsIHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QpIHtcbiAgICB2YXIgdGltZVJhbmdlT2JqID0gc291cmNlQnVmZmVyVGltZVJhbmdlTGlzdC5nZXRUaW1lUmFuZ2VCeVRpbWUoY3VycmVudFRpbWUpLFxuICAgICAgICBwcmV2aW91c1RpbWVSYW5nZU9iaixcbiAgICAgICAgaSxcbiAgICAgICAgbGVuZ3RoO1xuXG4gICAgaWYgKCFleGlzdHkodGltZVJhbmdlT2JqKSkge1xuICAgICAgICBpZiAoc2VnbWVudExpc3QuZ2V0SXNMaXZlKCkpIHtcbiAgICAgICAgICAgIHZhciBub3dTZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VVRDV2FsbENsb2NrVGltZShEYXRlLm5vdygpKTtcbiAgICAgICAgICAgIHJldHVybiBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlOdW1iZXIobm93U2VnbWVudC5nZXROdW1iZXIoKSAtIDEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVRpbWUoY3VycmVudFRpbWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gRmluZCB0aGUgdHJ1ZSBidWZmZXIgZWRnZSwgc2luY2UgdGhlIE1TRSBidWZmZXIgdGltZSByYW5nZXMgbWlnaHQgYmUgZmFsc2VseSByZXBvcnRpbmcgdGhhdCB0aGVyZSBhcmVcbiAgICAvLyBtdWx0aXBsZSB0aW1lIHJhbmdlcyB3aGVuIHRoZXkgYXJlIHRlbXBvcmFsbHkgYWRqYWNlbnQuXG4gICAgbGVuZ3RoID0gc291cmNlQnVmZmVyVGltZVJhbmdlTGlzdC5nZXRMZW5ndGgoKTtcbiAgICBpID0gdGltZVJhbmdlT2JqLmdldEluZGV4KCkgKyAxO1xuICAgIGZvciAoO2k8bGVuZ3RoO2krKykge1xuICAgICAgICBwcmV2aW91c1RpbWVSYW5nZU9iaiA9IHRpbWVSYW5nZU9iajtcbiAgICAgICAgdGltZVJhbmdlT2JqID0gc291cmNlQnVmZmVyVGltZVJhbmdlTGlzdC5nZXRUaW1lUmFuZ2VCeUluZGV4KGkpO1xuICAgICAgICBpZiAoKHRpbWVSYW5nZU9iai5nZXRTdGFydCgpIC0gcHJldmlvdXNUaW1lUmFuZ2VPYmouZ2V0RW5kKCkpID4gMC4wMDMpIHtcbiAgICAgICAgICAgIHJldHVybiBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKHByZXZpb3VzVGltZVJhbmdlT2JqLmdldEVuZCgpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHdlJ3JlIGhlcmUsIGVpdGhlciBhKSB0aGVyZSB3YXMgb25seSBvbmUgdGltZVJhbmdlIGluIHRoZSBsaXN0IG9yIGIpIGFsbCBvZiB0aGUgdGltZVJhbmdlcyBpbiB0aGUgbGlzdCB3ZXJlIGFkamFjZW50LlxuICAgIHJldHVybiBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKHRpbWVSYW5nZU9iai5nZXRFbmQoKSk7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChNZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gTWVkaWFUeXBlTG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBTZWdtZW50TG9hZGVyID0gcmVxdWlyZSgnLi9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzJyksXG4gICAgU291cmNlQnVmZmVyRGF0YVF1ZXVlID0gcmVxdWlyZSgnLi9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzJyksXG4gICAgTWVkaWFUeXBlTG9hZGVyID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVMb2FkZXIuanMnKSxcbiAgICBzZWxlY3RTZWdtZW50TGlzdCA9IHJlcXVpcmUoJy4vc2VsZWN0U2VnbWVudExpc3QuanMnKSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NZWRpYVR5cGVzLmpzJyk7XG5cbi8vIFRPRE86IE1pZ3JhdGUgbWV0aG9kcyBiZWxvdyB0byBhIGZhY3RvcnkuXG5mdW5jdGlvbiBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKSB7XG4gICAgdmFyIHNvdXJjZUJ1ZmZlclR5cGUgPSBtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKS5nZXRTb3VyY2VCdWZmZXJUeXBlKCksXG4gICAgICAgIC8vIFRPRE86IFRyeS9jYXRjaCBibG9jaz9cbiAgICAgICAgc291cmNlQnVmZmVyID0gbWVkaWFTb3VyY2UuYWRkU291cmNlQnVmZmVyKHNvdXJjZUJ1ZmZlclR5cGUpO1xuICAgIHJldHVybiBuZXcgU291cmNlQnVmZmVyRGF0YVF1ZXVlKHNvdXJjZUJ1ZmZlcik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU1lZGlhVHlwZUxvYWRlckZvclR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlLCB0ZWNoKSB7XG4gICAgdmFyIHNlZ21lbnRMb2FkZXIgPSBuZXcgU2VnbWVudExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhVHlwZSksXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUpO1xuICAgIHJldHVybiBuZXcgTWVkaWFUeXBlTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlLCB0ZWNoKTtcbn1cblxuLyoqXG4gKlxuICogRmFjdG9yeS1zdHlsZSBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgYSBzZXQgb2YgTWVkaWFUeXBlTG9hZGVycyBiYXNlZCBvbiB3aGF0J3MgZGVmaW5lZCBpbiB0aGUgbWFuaWZlc3QgYW5kIHdoYXQgbWVkaWEgdHlwZXMgYXJlIHN1cHBvcnRlZC5cbiAqXG4gKiBAcGFyYW0gbWFuaWZlc3RDb250cm9sbGVyIHtNYW5pZmVzdENvbnRyb2xsZXJ9ICAgY29udHJvbGxlciB0aGF0IHByb3ZpZGVzIGRhdGEgdmlld3MgZm9yIHRoZSBBQlIgcGxheWxpc3QgbWFuaWZlc3QgZGF0YVxuICogQHBhcmFtIG1lZGlhU291cmNlIHtNZWRpYVNvdXJjZX0gICAgICAgICAgICAgICAgIE1TRSBNZWRpYVNvdXJjZSBpbnN0YW5jZSBjb3JyZXNwb25kaW5nIHRvIHRoZSBjdXJyZW50IEFCUiBwbGF5bGlzdFxuICogQHBhcmFtIHRlY2gge29iamVjdH0gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZGVvLmpzIEh0bWw1IHRlY2ggb2JqZWN0IGluc3RhbmNlXG4gKiBAcmV0dXJucyB7QXJyYXkuPE1lZGlhVHlwZUxvYWRlcj59ICAgICAgICAgICAgICAgU2V0IG9mIE1lZGlhVHlwZUxvYWRlcnMgZm9yIGxvYWRpbmcgc2VnbWVudHMgZm9yIGEgZ2l2ZW4gbWVkaWEgdHlwZSAoZS5nLiBhdWRpbyBvciB2aWRlbylcbiAqL1xuZnVuY3Rpb24gY3JlYXRlTWVkaWFUeXBlTG9hZGVycyhtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKSB7XG4gICAgdmFyIG1hdGNoZWRUeXBlcyA9IG1lZGlhVHlwZXMuZmlsdGVyKGZ1bmN0aW9uKG1lZGlhVHlwZSkge1xuICAgICAgICAgICAgdmFyIGV4aXN0cyA9IGV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSk7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3RzOyB9KSxcbiAgICAgICAgbWVkaWFUeXBlTG9hZGVycyA9IG1hdGNoZWRUeXBlcy5tYXAoZnVuY3Rpb24obWVkaWFUeXBlKSB7IHJldHVybiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJGb3JUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSwgdGVjaCk7IH0pO1xuICAgIHJldHVybiBtZWRpYVR5cGVMb2FkZXJzO1xufVxuXG4vKipcbiAqXG4gKiBQbGF5bGlzdExvYWRlciBoYW5kbGVzIHRoZSB0b3AtbGV2ZWwgbG9hZGluZyBhbmQgcGxheWJhY2sgb2Ygc2VnbWVudHMgZm9yIGFsbCBtZWRpYSB0eXBlcyAoZS5nLiBib3RoIGF1ZGlvIGFuZCB2aWRlbykuXG4gKiBUaGlzIGluY2x1ZGVzIGNoZWNraW5nIGlmIGl0IHNob3VsZCBzd2l0Y2ggc2VnbWVudCBsaXN0cywgdXBkYXRpbmcvcmV0cmlldmluZyBkYXRhIHJlbGV2YW50IHRvIHRoZXNlIGRlY2lzaW9uIGZvclxuICogZWFjaCBtZWRpYSB0eXBlLiBJdCBhbHNvIGluY2x1ZGVzIGNoYW5naW5nIHRoZSBwbGF5YmFjayByYXRlIG9mIHRoZSB2aWRlbyBiYXNlZCBvbiBkYXRhIGF2YWlsYWJsZSBpbiB0aGUgc291cmNlIGJ1ZmZlci5cbiAqXG4gKiBAcGFyYW0gbWFuaWZlc3RDb250cm9sbGVyIHtNYW5pZmVzdENvbnRyb2xsZXJ9ICAgY29udHJvbGxlciB0aGF0IHByb3ZpZGVzIGRhdGEgdmlld3MgZm9yIHRoZSBBQlIgcGxheWxpc3QgbWFuaWZlc3QgZGF0YVxuICogQHBhcmFtIG1lZGlhU291cmNlIHtNZWRpYVNvdXJjZX0gICAgICAgICAgICAgICAgIE1TRSBNZWRpYVNvdXJjZSBpbnN0YW5jZSBjb3JyZXNwb25kaW5nIHRvIHRoZSBjdXJyZW50IEFCUiBwbGF5bGlzdFxuICogQHBhcmFtIHRlY2gge29iamVjdH0gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZGVvLmpzIEh0bWw1IHRlY2ggb2JqZWN0IGluc3RhbmNlXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gUGxheWxpc3RMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHRoaXMuX190ZWNoID0gdGVjaDtcbiAgICB0aGlzLl9fbWVkaWFUeXBlTG9hZGVycyA9IGNyZWF0ZU1lZGlhVHlwZUxvYWRlcnMobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCk7XG5cbiAgICB2YXIgaTtcblxuICAgIGZ1bmN0aW9uIGtpY2tvZmZNZWRpYVR5cGVMb2FkZXIobWVkaWFUeXBlTG9hZGVyKSB7XG4gICAgICAgIC8vIE1lZGlhU2V0LXNwZWNpZmljIHZhcmlhYmxlc1xuICAgICAgICB2YXIgc2VnbWVudExvYWRlciA9IG1lZGlhVHlwZUxvYWRlci5nZXRTZWdtZW50TG9hZGVyKCksXG4gICAgICAgICAgICBkb3dubG9hZFJhdGVSYXRpbyA9IDEuMCxcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgICAgICBtZWRpYVR5cGUgPSBtZWRpYVR5cGVMb2FkZXIuZ2V0TWVkaWFUeXBlKCk7XG5cbiAgICAgICAgLy8gTGlzdGVuIGZvciBldmVudCB0ZWxsaW5nIHVzIHRvIHJlY2hlY2sgd2hpY2ggc2VnbWVudCBsaXN0IHRoZSBzZWdtZW50cyBzaG91bGQgYmUgbG9hZGVkIGZyb20uXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlci5vbihtZWRpYVR5cGVMb2FkZXIuZXZlbnRMaXN0LlJFQ0hFQ0tfQ1VSUkVOVF9TRUdNRU5UX0xJU1QsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgbWVkaWFTZXQgPSBtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSxcbiAgICAgICAgICAgICAgICBpc0Z1bGxzY3JlZW4gPSB0ZWNoLnBsYXllcigpLmlzRnVsbHNjcmVlbigpLFxuICAgICAgICAgICAgICAgIGRhdGEgPSB7fSxcbiAgICAgICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0O1xuXG4gICAgICAgICAgICBkYXRhLmRvd25sb2FkUmF0ZVJhdGlvID0gZG93bmxvYWRSYXRlUmF0aW87XG4gICAgICAgICAgICBkYXRhLmN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcblxuICAgICAgICAgICAgLy8gUmF0aGVyIHRoYW4gbW9uaXRvcmluZyBldmVudHMvdXBkYXRpbmcgc3RhdGUsIHNpbXBseSBnZXQgcmVsZXZhbnQgdmlkZW8gdmlld3BvcnQgZGltcyBvbiB0aGUgZmx5IGFzIG5lZWRlZC5cbiAgICAgICAgICAgIGRhdGEud2lkdGggPSBpc0Z1bGxzY3JlZW4gPyB3aW5kb3cuc2NyZWVuLndpZHRoIDogdGVjaC5wbGF5ZXIoKS53aWR0aCgpO1xuICAgICAgICAgICAgZGF0YS5oZWlnaHQgPSBpc0Z1bGxzY3JlZW4gPyB3aW5kb3cuc2NyZWVuLmhlaWdodCA6IHRlY2gucGxheWVyKCkuaGVpZ2h0KCk7XG5cbiAgICAgICAgICAgIHNlbGVjdGVkU2VnbWVudExpc3QgPSBzZWxlY3RTZWdtZW50TGlzdChtZWRpYVNldCwgZGF0YSk7XG5cbiAgICAgICAgICAgIC8vIFRPRE86IFNob3VsZCB3ZSByZWZhY3RvciB0byBzZXQgYmFzZWQgb24gc2VnbWVudExpc3QgaW5zdGVhZD9cbiAgICAgICAgICAgIC8vIChQb3RlbnRpYWxseSkgdXBkYXRlIHdoaWNoIHNlZ21lbnQgbGlzdCB0aGUgc2VnbWVudHMgc2hvdWxkIGJlIGxvYWRlZCBmcm9tIChiYXNlZCBvbiBzZWdtZW50IGxpc3QncyBiYW5kd2lkdGgvYml0cmF0ZSlcbiAgICAgICAgICAgIHNlZ21lbnRMb2FkZXIuc2V0Q3VycmVudEJhbmR3aWR0aChzZWxlY3RlZFNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gVXBkYXRlIHRoZSBkb3dubG9hZCByYXRlIChyb3VuZCB0cmlwIHRpbWUgdG8gZG93bmxvYWQgYSBzZWdtZW50IG9mIGEgZ2l2ZW4gYXZlcmFnZSBiYW5kd2lkdGgvYml0cmF0ZSkgdG8gdXNlXG4gICAgICAgIC8vIHdpdGggY2hvb3Npbmcgd2hpY2ggc3RyZWFtIHZhcmlhbnQgdG8gbG9hZCBzZWdtZW50cyBmcm9tLlxuICAgICAgICBzZWdtZW50TG9hZGVyLm9uKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LkRPV05MT0FEX0RBVEFfVVBEQVRFLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgZG93bmxvYWRSYXRlUmF0aW8gPSBldmVudC5kYXRhLnBsYXliYWNrVGltZSAvIGV2ZW50LmRhdGEucnR0O1xuICAgICAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gZXZlbnQuZGF0YS5iYW5kd2lkdGg7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEtpY2tvZmYgc2VnbWVudCBsb2FkaW5nIGZvciB0aGUgbWVkaWEgdHlwZS5cbiAgICAgICAgbWVkaWFUeXBlTG9hZGVyLnN0YXJ0TG9hZGluZ1NlZ21lbnRzKCk7XG4gICAgfVxuXG4gICAgLy8gRm9yIGVhY2ggb2YgdGhlIG1lZGlhIHR5cGVzIChlLmcuICdhdWRpbycgJiAndmlkZW8nKSBpbiB0aGUgQUJSIG1hbmlmZXN0Li4uXG4gICAgZm9yIChpPTA7IGk8dGhpcy5fX21lZGlhVHlwZUxvYWRlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAga2lja29mZk1lZGlhVHlwZUxvYWRlcih0aGlzLl9fbWVkaWFUeXBlTG9hZGVyc1tpXSk7XG4gICAgfVxuXG4gICAgLy8gTk9URTogVGhpcyBjb2RlIGJsb2NrIGhhbmRsZXMgcHNldWRvLSdwYXVzaW5nJy8ndW5wYXVzaW5nJyAoY2hhbmdpbmcgdGhlIHBsYXliYWNrUmF0ZSkgYmFzZWQgb24gd2hldGhlciBvciBub3RcbiAgICAvLyB0aGVyZSBpcyBkYXRhIGF2YWlsYWJsZSBpbiB0aGUgYnVmZmVyLCBidXQgaW5kaXJlY3RseSwgYnkgbGlzdGVuaW5nIHRvIGEgZmV3IGV2ZW50cyBhbmQgdXNpbmcgdGhlIHZpZGVvIGVsZW1lbnQnc1xuICAgIC8vIHJlYWR5IHN0YXRlLlxuICAgIHZhciBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHMgPSBbJ3NlZWtpbmcnLCAnY2FucGxheScsICdjYW5wbGF5dGhyb3VnaCddLFxuICAgICAgICBldmVudFR5cGU7XG5cbiAgICBmdW5jdGlvbiBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHNIYW5kbGVyKGV2ZW50KSB7XG4gICAgICAgIHZhciByZWFkeVN0YXRlID0gdGVjaC5lbCgpLnJlYWR5U3RhdGUsXG4gICAgICAgICAgICBwbGF5YmFja1JhdGUgPSAocmVhZHlTdGF0ZSA9PT0gNCkgPyAxIDogMDtcbiAgICAgICAgY29uc29sZS5sb2coJ0luIFBsYXlsaXN0TG9hZGVyIFBsYXliYWNrIFJhdGUgSGFuZGxlclxcblxcbicpO1xuICAgICAgICBjb25zb2xlLmxvZygncGxheWJhY2tSYXRlOiAnICsgcGxheWJhY2tSYXRlICsgJywgcmVhZHlTdGF0ZTogJyArIHJlYWR5U3RhdGUpO1xuICAgICAgICB0ZWNoLnNldFBsYXliYWNrUmF0ZShwbGF5YmFja1JhdGUpO1xuICAgIH1cblxuICAgIGZvcihpPTA7IGk8Y2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGV2ZW50VHlwZSA9IGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50c1tpXTtcbiAgICAgICAgdGVjaC5vbihldmVudFR5cGUsIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50c0hhbmRsZXIpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS5NZWRpYVNvdXJjZSxcbiAgICBNYW5pZmVzdENvbnRyb2xsZXIgPSByZXF1aXJlKCcuL21hbmlmZXN0L01hbmlmZXN0Q29udHJvbGxlci5qcycpLFxuICAgIFBsYXlsaXN0TG9hZGVyID0gcmVxdWlyZSgnLi9QbGF5bGlzdExvYWRlci5qcycpO1xuXG4vLyBUT0RPOiBESVNQT1NFIE1FVEhPRFxuLyoqXG4gKlxuICogQ2xhc3MgdGhhdCBkZWZpbmVzIHRoZSByb290IGNvbnRleHQgZm9yIGhhbmRsaW5nIGEgc3BlY2lmaWMgTVBFRy1EQVNIIG1lZGlhIHNvdXJjZS5cbiAqXG4gKiBAcGFyYW0gc291cmNlICAgIHZpZGVvLmpzIHNvdXJjZSBvYmplY3QgcHJvdmlkaW5nIGluZm9ybWF0aW9uIGFib3V0IHRoZSBzb3VyY2UsIHN1Y2ggYXMgdGhlIHVyaSAoc3JjKSBhbmQgdGhlIHR5cGUgKHR5cGUpXG4gKiBAcGFyYW0gdGVjaCAgICAgIHZpZGVvLmpzIEh0bWw1IHRlY2ggb2JqZWN0IHByb3ZpZGluZyB0aGUgcG9pbnQgb2YgaW50ZXJhY3Rpb24gYmV0d2VlbiB0aGUgU291cmNlSGFuZGxlciBpbnN0YW5jZSBhbmRcbiAqICAgICAgICAgICAgICAgICAgdGhlIHZpZGVvLmpzIGxpYnJhcnkgKGluY2x1ZGluZyBlLmcuIHRoZSB2aWRlbyBlbGVtZW50KVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFNvdXJjZUhhbmRsZXIoc291cmNlLCB0ZWNoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBtYW5pZmVzdENvbnRyb2xsZXIgPSBuZXcgTWFuaWZlc3RDb250cm9sbGVyKHNvdXJjZS5zcmMsIGZhbHNlKTtcblxuICAgIG1hbmlmZXN0Q29udHJvbGxlci5vbmUobWFuaWZlc3RDb250cm9sbGVyLmV2ZW50TGlzdC5NQU5JRkVTVF9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHZhciBtZWRpYVNvdXJjZSA9IG5ldyBNZWRpYVNvdXJjZSgpLFxuICAgICAgICAgICAgb3Blbkxpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgICAgICBtZWRpYVNvdXJjZS5yZW1vdmVFdmVudExpc3RlbmVyKCdzb3VyY2VvcGVuJywgb3Blbkxpc3RlbmVyLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX3BsYXlsaXN0TG9hZGVyID0gbmV3IFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICBtZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VvcGVuJywgb3Blbkxpc3RlbmVyLCBmYWxzZSk7XG5cbiAgICAgICAgLy8gVE9ETzogSGFuZGxlIGNsb3NlLlxuICAgICAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3dlYmtpdHNvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcblxuICAgICAgICB0ZWNoLnNldFNyYyhVUkwuY3JlYXRlT2JqZWN0VVJMKG1lZGlhU291cmNlKSk7XG4gICAgfSk7XG5cbiAgICBtYW5pZmVzdENvbnRyb2xsZXIubG9hZCgpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUhhbmRsZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICB1dGlsID0gcmVxdWlyZSgnLi91dGlsLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi8uLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaXNTdHJpbmcuanMnKSxcbiAgICBwYXJzZVJvb3RVcmwgPSB1dGlsLnBhcnNlUm9vdFVybCxcbiAgICBjcmVhdGVNcGRPYmplY3QsXG4gICAgY3JlYXRlUGVyaW9kT2JqZWN0LFxuICAgIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QsXG4gICAgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QsXG4gICAgY3JlYXRlU2VnbWVudFRlbXBsYXRlLFxuICAgIGdldE1wZCxcbiAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlLFxuICAgIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsXG4gICAgZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWU7XG5cbi8vIFRPRE86IFNob3VsZCB0aGlzIGV4aXN0IG9uIG1wZCBkYXRhdmlldyBvciBhdCBhIGhpZ2hlciBsZXZlbD9cbi8vIFRPRE86IFJlZmFjdG9yLiBDb3VsZCBiZSBtb3JlIGVmZmljaWVudCAoUmVjdXJzaXZlIGZuPyBVc2UgZWxlbWVudC5nZXRFbGVtZW50c0J5TmFtZSgnQmFzZVVybCcpWzBdPykuXG4vLyBUT0RPOiBDdXJyZW50bHkgYXNzdW1pbmcgKkVJVEhFUiogPEJhc2VVUkw+IG5vZGVzIHdpbGwgcHJvdmlkZSBhbiBhYnNvbHV0ZSBiYXNlIHVybCAoaWUgcmVzb2x2ZSB0byAnaHR0cDovLycgZXRjKVxuLy8gVE9ETzogKk9SKiB3ZSBzaG91bGQgdXNlIHRoZSBiYXNlIHVybCBvZiB0aGUgaG9zdCBvZiB0aGUgTVBEIG1hbmlmZXN0LlxudmFyIGJ1aWxkQmFzZVVybCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICB2YXIgZWxlbUhpZXJhcmNoeSA9IFt4bWxOb2RlXS5jb25jYXQoeG1sZnVuLmdldEFuY2VzdG9ycyh4bWxOb2RlKSksXG4gICAgICAgIGZvdW5kTG9jYWxCYXNlVXJsID0gZmFsc2U7XG4gICAgdmFyIGJhc2VVcmxzID0gZWxlbUhpZXJhcmNoeS5tYXAoZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoZm91bmRMb2NhbEJhc2VVcmwpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIGlmICghZWxlbS5oYXNDaGlsZE5vZGVzKCkpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBjaGlsZDtcbiAgICAgICAgZm9yICh2YXIgaT0wOyBpPGVsZW0uY2hpbGROb2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBlbGVtLmNoaWxkTm9kZXMuaXRlbShpKTtcbiAgICAgICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0Jhc2VVUkwnKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRFbGVtID0gY2hpbGQuY2hpbGROb2Rlcy5pdGVtKDApO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0VmFsdWUgPSB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgICAgIGlmICh0ZXh0VmFsdWUuaW5kZXhPZignaHR0cDovLycpID09PSAwKSB7IGZvdW5kTG9jYWxCYXNlVXJsID0gdHJ1ZTsgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH0pO1xuXG4gICAgdmFyIGJhc2VVcmwgPSBiYXNlVXJscy5yZXZlcnNlKCkuam9pbignJyk7XG4gICAgaWYgKCFiYXNlVXJsKSB7IHJldHVybiBwYXJzZVJvb3RVcmwoeG1sTm9kZS5iYXNlVVJJKTsgfVxuICAgIHJldHVybiBiYXNlVXJsO1xufTtcblxudmFyIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMgPSBbXG4gICAgJ0FkYXB0YXRpb25TZXQnLFxuICAgICdSZXByZXNlbnRhdGlvbicsXG4gICAgJ1N1YlJlcHJlc2VudGF0aW9uJ1xuXTtcblxudmFyIGhhc0NvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMuaW5kZXhPZihlbGVtLm5vZGVOYW1lKSA+PSAwO1xufTtcblxudmFyIGRvZXNudEhhdmVDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiAhaGFzQ29tbW9uUHJvcGVydGllcyhlbGVtKTtcbn07XG5cbi8vIENvbW1vbiBBdHRyc1xudmFyIGdldFdpZHRoID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCd3aWR0aCcpLFxuICAgIGdldEhlaWdodCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnaGVpZ2h0JyksXG4gICAgZ2V0RnJhbWVSYXRlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdmcmFtZVJhdGUnKSxcbiAgICBnZXRNaW1lVHlwZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnbWltZVR5cGUnKSxcbiAgICBnZXRDb2RlY3MgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2NvZGVjcycpO1xuXG52YXIgZ2V0U2VnbWVudFRlbXBsYXRlWG1sTGlzdCA9IHhtbGZ1bi5nZXRNdWx0aUxldmVsRWxlbWVudExpc3QoJ1NlZ21lbnRUZW1wbGF0ZScpO1xuXG4vLyBNUEQgQXR0ciBmbnNcbnZhciBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbicpLFxuICAgIGdldFR5cGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0eXBlJyksXG4gICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21pbmltdW1VcGRhdGVQZXJpb2QnKSxcbiAgICBnZXRBdmFpbGFiaWxpdHlTdGFydFRpbWUgPSB4bWxmdW4uZ2V0QXR0ckZuKCdhdmFpbGFiaWxpdHlTdGFydFRpbWUnKSxcbiAgICBnZXRTdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3N1Z2dlc3RlZFByZXNlbnRhdGlvbkRlbGF5JyksXG4gICAgZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGggPSB4bWxmdW4uZ2V0QXR0ckZuKCd0aW1lU2hpZnRCdWZmZXJEZXB0aCcpO1xuXG4vLyBSZXByZXNlbnRhdGlvbiBBdHRyIGZuc1xudmFyIGdldElkID0geG1sZnVuLmdldEF0dHJGbignaWQnKSxcbiAgICBnZXRCYW5kd2lkdGggPSB4bWxmdW4uZ2V0QXR0ckZuKCdiYW5kd2lkdGgnKTtcblxuLy8gU2VnbWVudFRlbXBsYXRlIEF0dHIgZm5zXG52YXIgZ2V0SW5pdGlhbGl6YXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdpbml0aWFsaXphdGlvbicpLFxuICAgIGdldE1lZGlhID0geG1sZnVuLmdldEF0dHJGbignbWVkaWEnKSxcbiAgICBnZXREdXJhdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2R1cmF0aW9uJyksXG4gICAgZ2V0VGltZXNjYWxlID0geG1sZnVuLmdldEF0dHJGbigndGltZXNjYWxlJyksXG4gICAgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3ByZXNlbnRhdGlvblRpbWVPZmZzZXQnKSxcbiAgICBnZXRTdGFydE51bWJlciA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3N0YXJ0TnVtYmVyJyk7XG5cbi8vIFRPRE86IFJlcGVhdCBjb2RlLiBBYnN0cmFjdCBhd2F5IChQcm90b3R5cGFsIEluaGVyaXRhbmNlL09PIE1vZGVsPyBPYmplY3QgY29tcG9zZXIgZm4/KVxuY3JlYXRlTXBkT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRQZXJpb2RzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0VHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW5pbXVtVXBkYXRlUGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCwgeG1sTm9kZSksXG4gICAgICAgIGdldEF2YWlsYWJpbGl0eVN0YXJ0VGltZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF2YWlsYWJpbGl0eVN0YXJ0VGltZSwgeG1sTm9kZSksXG4gICAgICAgIGdldFN1Z2dlc3RlZFByZXNlbnRhdGlvbkRlbGF5OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXksIHhtbE5vZGUpLFxuICAgICAgICBnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVQZXJpb2RPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXRzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZTogZnVuY3Rpb24odHlwZSkge1xuICAgICAgICAgICAgcmV0dXJuIGdldEFkYXB0YXRpb25TZXRCeVR5cGUodHlwZSwgeG1sTm9kZSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KVxuICAgIH07XG59O1xuXG5jcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRSZXByZXNlbnRhdGlvbnM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUmVwcmVzZW50YXRpb24nLCBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCksXG4gICAgICAgIGdldFNlZ21lbnRUZW1wbGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudFRlbXBsYXRlKGdldFNlZ21lbnRUZW1wbGF0ZVhtbExpc3QoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0TWltZVR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW1lVHlwZSwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFNlZ21lbnRUZW1wbGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudFRlbXBsYXRlKGdldFNlZ21lbnRUZW1wbGF0ZVhtbExpc3QoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElkLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgeG1sTm9kZSksXG4gICAgICAgIGdldEZyYW1lUmF0ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEZyYW1lUmF0ZSwgeG1sTm9kZSksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldENvZGVjczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldENvZGVjcywgeG1sTm9kZSksXG4gICAgICAgIGdldEJhc2VVcmw6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihidWlsZEJhc2VVcmwsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50VGVtcGxhdGUgPSBmdW5jdGlvbih4bWxBcnJheSkge1xuICAgIC8vIEVmZmVjdGl2ZWx5IGEgZmluZCBmdW5jdGlvbiArIGEgbWFwIGZ1bmN0aW9uLlxuICAgIGZ1bmN0aW9uIGdldEF0dHJGcm9tWG1sQXJyYXkoYXR0ckdldHRlckZuLCB4bWxBcnJheSkge1xuICAgICAgICBpZiAoIWlzQXJyYXkoeG1sQXJyYXkpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKCFpc0Z1bmN0aW9uKGF0dHJHZXR0ZXJGbikpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuXG4gICAgICAgIHZhciBpLFxuICAgICAgICAgICAgbGVuZ3RoID0geG1sQXJyYXkubGVuZ3RoLFxuICAgICAgICAgICAgY3VycmVudEF0dHJWYWx1ZTtcblxuICAgICAgICBmb3IgKGk9MDsgaTx4bWxBcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY3VycmVudEF0dHJWYWx1ZSA9IGF0dHJHZXR0ZXJGbih4bWxBcnJheVtpXSk7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcoY3VycmVudEF0dHJWYWx1ZSkgJiYgY3VycmVudEF0dHJWYWx1ZSAhPT0gJycpIHsgcmV0dXJuIGN1cnJlbnRBdHRyVmFsdWU7IH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxBcnJheSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbEFycmF5WzBdLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sQXJyYXlbMF0sICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sQXJyYXlbMF0sICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldEluaXRpYWxpemF0aW9uLCB4bWxBcnJheSksXG4gICAgICAgIGdldE1lZGlhOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0TWVkaWEsIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXREdXJhdGlvbiwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRUaW1lc2NhbGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRUaW1lc2NhbGUsIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQsIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRTdGFydE51bWJlciwgeG1sQXJyYXkpXG4gICAgfTtcbn07XG5cbi8vIFRPRE86IENoYW5nZSB0aGlzIGFwaSB0byByZXR1cm4gYSBsaXN0IG9mIGFsbCBtYXRjaGluZyBhZGFwdGF0aW9uIHNldHMgdG8gYWxsb3cgZm9yIGdyZWF0ZXIgZmxleGliaWxpdHkuXG5nZXRBZGFwdGF0aW9uU2V0QnlUeXBlID0gZnVuY3Rpb24odHlwZSwgcGVyaW9kWG1sKSB7XG4gICAgdmFyIGFkYXB0YXRpb25TZXRzID0gcGVyaW9kWG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKCdBZGFwdGF0aW9uU2V0JyksXG4gICAgICAgIGFkYXB0YXRpb25TZXQsXG4gICAgICAgIHJlcHJlc2VudGF0aW9uLFxuICAgICAgICBtaW1lVHlwZTtcblxuICAgIGZvciAodmFyIGk9MDsgaTxhZGFwdGF0aW9uU2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBhZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldHMuaXRlbShpKTtcbiAgICAgICAgLy8gU2luY2UgdGhlIG1pbWVUeXBlIGNhbiBiZSBkZWZpbmVkIG9uIHRoZSBBZGFwdGF0aW9uU2V0IG9yIG9uIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZCBub2RlcyxcbiAgICAgICAgLy8gY2hlY2sgZm9yIG1pbWV0eXBlIG9uIG9uZSBvZiBpdHMgUmVwcmVzZW50YXRpb24gY2hpbGRyZW4gdXNpbmcgZ2V0TWltZVR5cGUoKSwgd2hpY2ggYXNzdW1lcyB0aGVcbiAgICAgICAgLy8gbWltZVR5cGUgY2FuIGJlIGluaGVyaXRlZCBhbmQgd2lsbCBjaGVjayBpdHNlbGYgYW5kIGl0cyBhbmNlc3RvcnMgZm9yIHRoZSBhdHRyLlxuICAgICAgICByZXByZXNlbnRhdGlvbiA9IGFkYXB0YXRpb25TZXQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ1JlcHJlc2VudGF0aW9uJylbMF07XG4gICAgICAgIC8vIE5lZWQgdG8gY2hlY2sgdGhlIHJlcHJlc2VudGF0aW9uIGluc3RlYWQgb2YgdGhlIGFkYXB0YXRpb24gc2V0LCBzaW5jZSB0aGUgbWltZVR5cGUgbWF5IG5vdCBiZSBzcGVjaWZpZWRcbiAgICAgICAgLy8gb24gdGhlIGFkYXB0YXRpb24gc2V0IGF0IGFsbCBhbmQgbWF5IGJlIHNwZWNpZmllZCBmb3IgZWFjaCBvZiB0aGUgcmVwcmVzZW50YXRpb25zIGluc3RlYWQuXG4gICAgICAgIG1pbWVUeXBlID0gZ2V0TWltZVR5cGUocmVwcmVzZW50YXRpb24pO1xuICAgICAgICBpZiAoISFtaW1lVHlwZSAmJiBtaW1lVHlwZS5pbmRleE9mKHR5cGUpID49IDApIHsgcmV0dXJuIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QoYWRhcHRhdGlvblNldCk7IH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn07XG5cbmdldE1wZCA9IGZ1bmN0aW9uKG1hbmlmZXN0WG1sKSB7XG4gICAgcmV0dXJuIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUobWFuaWZlc3RYbWwsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpWzBdO1xufTtcblxuLy8gVE9ETzogTW92ZSB0byB4bWxmdW4gb3Igb3duIG1vZHVsZS5cbmdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUgPSBmdW5jdGlvbihwYXJlbnRYbWwsIHRhZ05hbWUsIG1hcEZuKSB7XG4gICAgdmFyIGRlc2NlbmRhbnRzWG1sQXJyYXkgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChwYXJlbnRYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUodGFnTmFtZSkpO1xuICAgIC8qaWYgKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykgeyByZXR1cm4gZGVzY2VuZGFudHNYbWxBcnJheS5tYXAobWFwRm4pOyB9Ki9cbiAgICBpZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHZhciBtYXBwZWRFbGVtID0gZGVzY2VuZGFudHNYbWxBcnJheS5tYXAobWFwRm4pO1xuICAgICAgICByZXR1cm4gIG1hcHBlZEVsZW07XG4gICAgfVxuICAgIHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5O1xufTtcblxuLy8gVE9ETzogTW92ZSB0byB4bWxmdW4gb3Igb3duIG1vZHVsZS5cbmdldEFuY2VzdG9yT2JqZWN0QnlOYW1lID0gZnVuY3Rpb24gZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUoeG1sTm9kZSwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICBpZiAoIXRhZ05hbWUgfHwgIXhtbE5vZGUgfHwgIXhtbE5vZGUucGFyZW50Tm9kZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIGlmICgheG1sTm9kZS5wYXJlbnROb2RlLm5vZGVOYW1lKSB7IHJldHVybiBudWxsOyB9XG5cbiAgICBpZiAoeG1sTm9kZS5wYXJlbnROb2RlLm5vZGVOYW1lID09PSB0YWdOYW1lKSB7XG4gICAgICAgIHJldHVybiBpc0Z1bmN0aW9uKG1hcEZuKSA/IG1hcEZuKHhtbE5vZGUucGFyZW50Tm9kZSkgOiB4bWxOb2RlLnBhcmVudE5vZGU7XG4gICAgfVxuICAgIHJldHVybiBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSh4bWxOb2RlLnBhcmVudE5vZGUsIHRhZ05hbWUsIG1hcEZuKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0TXBkOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCxcbiAgICAvLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lLFxuICAgIFNFQ09ORFNfSU5fWUVBUiA9IDM2NSAqIDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01PTlRIID0gMzAgKiAyNCAqIDYwICogNjAsIC8vIG5vdCBwcmVjaXNlIVxuICAgIFNFQ09ORFNfSU5fREFZID0gMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fSE9VUiA9IDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NSU4gPSA2MCxcbiAgICBNSU5VVEVTX0lOX0hPVVIgPSA2MCxcbiAgICBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUyA9IDEwMDAsXG4gICAgZHVyYXRpb25SZWdleCA9IC9eUCgoW1xcZC5dKilZKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKUQpP1Q/KChbXFxkLl0qKUgpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopUyk/LyxcbiAgICBkYXRlVGltZVJlZ2V4ID0gL14oWzAtOV17NH0pLShbMC05XXsyfSktKFswLTldezJ9KVQoWzAtOV17Mn0pOihbMC05XXsyfSkoPzo6KFswLTldKikoXFwuWzAtOV0qKT8pPyg/OihbKy1dKShbMC05XXsyfSkoWzAtOV17Mn0pKT8vO1xuXG5wYXJzZVJvb3RVcmwgPSBmdW5jdGlvbih1cmwpIHtcbiAgICBpZiAodHlwZW9mIHVybCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignLycpID09PSAtMSkge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCc/JykgIT09IC0xKSB7XG4gICAgICAgIHVybCA9IHVybC5zdWJzdHJpbmcoMCwgdXJsLmluZGV4T2YoJz8nKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVybC5zdWJzdHJpbmcoMCwgdXJsLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn07XG5cbi8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgLy9zdHIgPSBcIlAxMFkxME0xMERUMTBIMTBNMTAuMVNcIjtcbiAgICBpZiAoIXN0cikgeyByZXR1cm4gTnVtYmVyLk5hTjsgfVxuICAgIHZhciBtYXRjaCA9IGR1cmF0aW9uUmVnZXguZXhlYyhzdHIpO1xuICAgIGlmICghbWF0Y2gpIHsgcmV0dXJuIE51bWJlci5OYU47IH1cbiAgICByZXR1cm4gKHBhcnNlRmxvYXQobWF0Y2hbMl0gfHwgMCkgKiBTRUNPTkRTX0lOX1lFQVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzRdIHx8IDApICogU0VDT05EU19JTl9NT05USCArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNl0gfHwgMCkgKiBTRUNPTkRTX0lOX0RBWSArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbOF0gfHwgMCkgKiBTRUNPTkRTX0lOX0hPVVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEwXSB8fCAwKSAqIFNFQ09ORFNfSU5fTUlOICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMl0gfHwgMCkpO1xufTtcblxuLyoqXG4gKiBQYXJzZXIgZm9yIGZvcm1hdHRlZCBkYXRldGltZSBzdHJpbmdzIGNvbmZvcm1pbmcgdG8gdGhlIElTTyA4NjAxIHN0YW5kYXJkLlxuICogR2VuZXJhbCBGb3JtYXQ6ICBZWVlZLU1NLUREVEhIOk1NOlNTWiAoVVRDKSBvciBZWVlZLU1NLUREVEhIOk1NOlNTK0hIOk1NICh0aW1lIHpvbmUgbG9jYWxpemF0aW9uKVxuICogRXggU3RyaW5nOiAgICAgICAyMDE0LTEyLTE3VDE0OjA5OjU4WiAoVVRDKSBvciAyMDE0LTEyLTE3VDE0OjE1OjU4KzA2OjAwICh0aW1lIHpvbmUgbG9jYWxpemF0aW9uKSAvIDIwMTQtMTItMTdUMTQ6MDM6NTgtMDY6MDAgKHRpbWUgem9uZSBsb2NhbGl6YXRpb24pXG4gKlxuICogQHBhcmFtIHN0ciB7c3RyaW5nfSAgSVNPIDg2MDEtY29tcGxpYW50IGRhdGV0aW1lIHN0cmluZy5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IFVUQyBVbml4IHRpbWUuXG4gKi9cbnBhcnNlRGF0ZVRpbWUgPSBmdW5jdGlvbihzdHIpIHtcbiAgICB2YXIgbWF0Y2ggPSBkYXRlVGltZVJlZ2V4LmV4ZWMoc3RyKSxcbiAgICAgICAgdXRjRGF0ZTtcblxuICAgIC8vIElmIHRoZSBzdHJpbmcgZG9lcyBub3QgY29udGFpbiBhIHRpbWV6b25lIG9mZnNldCBkaWZmZXJlbnQgYnJvd3NlcnMgY2FuIGludGVycHJldCBpdCBlaXRoZXJcbiAgICAvLyBhcyBVVEMgb3IgYXMgYSBsb2NhbCB0aW1lIHNvIHdlIGhhdmUgdG8gcGFyc2UgdGhlIHN0cmluZyBtYW51YWxseSB0byBub3JtYWxpemUgdGhlIGdpdmVuIGRhdGUgdmFsdWUgZm9yXG4gICAgLy8gYWxsIGJyb3dzZXJzXG4gICAgdXRjRGF0ZSA9IERhdGUuVVRDKFxuICAgICAgICBwYXJzZUludChtYXRjaFsxXSwgMTApLFxuICAgICAgICBwYXJzZUludChtYXRjaFsyXSwgMTApLTEsIC8vIG1vbnRocyBzdGFydCBmcm9tIHplcm9cbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbM10sIDEwKSxcbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbNF0sIDEwKSxcbiAgICAgICAgcGFyc2VJbnQobWF0Y2hbNV0sIDEwKSxcbiAgICAgICAgKG1hdGNoWzZdICYmIHBhcnNlSW50KG1hdGNoWzZdLCAxMCkgfHwgMCksXG4gICAgICAgIChtYXRjaFs3XSAmJiBwYXJzZUZsb2F0KG1hdGNoWzddKSAqIE1JTExJU0VDT05EU19JTl9TRUNPTkRTKSB8fCAwKTtcbiAgICAvLyBJZiB0aGUgZGF0ZSBoYXMgdGltZXpvbmUgb2Zmc2V0IHRha2UgaXQgaW50byBhY2NvdW50IGFzIHdlbGxcbiAgICBpZiAobWF0Y2hbOV0gJiYgbWF0Y2hbMTBdKSB7XG4gICAgICAgIHZhciB0aW1lem9uZU9mZnNldCA9IHBhcnNlSW50KG1hdGNoWzldLCAxMCkgKiBNSU5VVEVTX0lOX0hPVVIgKyBwYXJzZUludChtYXRjaFsxMF0sIDEwKTtcbiAgICAgICAgdXRjRGF0ZSArPSAobWF0Y2hbOF0gPT09ICcrJyA/IC0xIDogKzEpICogdGltZXpvbmVPZmZzZXQgKiBTRUNPTkRTX0lOX01JTiAqIE1JTExJU0VDT05EU19JTl9TRUNPTkRTO1xuICAgIH1cblxuICAgIHJldHVybiB1dGNEYXRlO1xufTtcblxudmFyIHV0aWwgPSB7XG4gICAgcGFyc2VSb290VXJsOiBwYXJzZVJvb3RVcmwsXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgcGFyc2VEYXRlVGltZTogcGFyc2VEYXRlVGltZVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB1dGlsOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgcGFyc2VEYXRlVGltZSA9IHJlcXVpcmUoJy4uL21wZC91dGlsLmpzJykucGFyc2VEYXRlVGltZSxcbiAgICBzZWdtZW50VGVtcGxhdGUgPSByZXF1aXJlKCcuL3NlZ21lbnRUZW1wbGF0ZScpLFxuICAgIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcixcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVVUQ1dhbGxDbG9ja1RpbWUsXG4gICAgZ2V0VHlwZSxcbiAgICBnZXRJc0xpdmUsXG4gICAgZ2V0QmFuZHdpZHRoLFxuICAgIGdldFdpZHRoLFxuICAgIGdldEhlaWdodCxcbiAgICBnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZSxcbiAgICBnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCxcbiAgICBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsXG4gICAgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsXG4gICAgZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlO1xuXG5nZXRUeXBlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgY29kZWNTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRDb2RlY3MoKTtcbiAgICB2YXIgdHlwZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1pbWVUeXBlKCk7XG5cbiAgICAvL05PVEU6IExFQURJTkcgWkVST1MgSU4gQ09ERUMgVFlQRS9TVUJUWVBFIEFSRSBURUNITklDQUxMWSBOT1QgU1BFQyBDT01QTElBTlQsIEJVVCBHUEFDICYgT1RIRVJcbiAgICAvLyBEQVNIIE1QRCBHRU5FUkFUT1JTIFBST0RVQ0UgVEhFU0UgTk9OLUNPTVBMSUFOVCBWQUxVRVMuIEhBTkRMSU5HIEhFUkUgRk9SIE5PVy5cbiAgICAvLyBTZWU6IFJGQyA2MzgxIFNlYy4gMy40IChodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjM4MSNzZWN0aW9uLTMuNClcbiAgICB2YXIgcGFyc2VkQ29kZWMgPSBjb2RlY1N0ci5zcGxpdCgnLicpLm1hcChmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eMCsoPyFcXC58JCkvLCAnJyk7XG4gICAgfSk7XG4gICAgdmFyIHByb2Nlc3NlZENvZGVjU3RyID0gcGFyc2VkQ29kZWMuam9pbignLicpO1xuXG4gICAgcmV0dXJuICh0eXBlU3RyICsgJztjb2RlY3M9XCInICsgcHJvY2Vzc2VkQ29kZWNTdHIgKyAnXCInKTtcbn07XG5cbmdldElzTGl2ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIChyZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRUeXBlKCkgPT09ICdkeW5hbWljJyk7XG59O1xuXG5nZXRCYW5kd2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBiYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCkgPyBOdW1iZXIoYmFuZHdpZHRoKSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldFdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRXaWR0aCgpO1xuICAgIHJldHVybiBleGlzdHkod2lkdGgpID8gTnVtYmVyKHdpZHRoKSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldEhlaWdodCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGhlaWdodCA9IHJlcHJlc2VudGF0aW9uLmdldEhlaWdodCgpO1xuICAgIHJldHVybiBleGlzdHkoaGVpZ2h0KSA/IE51bWJlcihoZWlnaHQpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgLy8gVE9ETzogU3VwcG9ydCBwZXJpb2QtcmVsYXRpdmUgcHJlc2VudGF0aW9uIHRpbWVcbiAgICB2YXIgbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24oKSxcbiAgICAgICAgcGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGV4aXN0eShtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA/IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbihtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA6IE51bWJlci5OYU4sXG4gICAgICAgIHByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCgpKSB8fCAwO1xuICAgIHJldHVybiBleGlzdHkocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikgPyBOdW1iZXIocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiAtIHByZXNlbnRhdGlvblRpbWVPZmZzZXQpIDogTnVtYmVyLk5hTjtcbn07XG5cbmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHdhbGxDbG9ja1RpbWVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRBdmFpbGFiaWxpdHlTdGFydFRpbWUoKSxcbiAgICAgICAgd2FsbENsb2NrVW5peFRpbWVVdGMgPSBwYXJzZURhdGVUaW1lKHdhbGxDbG9ja1RpbWVTdHIpO1xuICAgIHJldHVybiB3YWxsQ2xvY2tVbml4VGltZVV0Yztcbn07XG5cbmdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgdGltZVNoaWZ0QnVmZmVyRGVwdGhTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCgpLFxuICAgICAgICBwYXJzZWRUaW1lU2hpZnRCdWZmZXJEZXB0aCA9IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbih0aW1lU2hpZnRCdWZmZXJEZXB0aFN0cik7XG4gICAgcmV0dXJuIHBhcnNlZFRpbWVTaGlmdEJ1ZmZlckRlcHRoO1xufTtcblxuZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgc2VnbWVudFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCk7XG4gICAgcmV0dXJuIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0RHVyYXRpb24oKSkgLyBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldFRpbWVzY2FsZSgpKTtcbn07XG5cbmdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTWF0aC5jZWlsKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC8gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG59O1xuXG5nZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRTdGFydE51bWJlcigpKTtcbn07XG5cbmdldEVuZE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSArIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAtIDE7XG59O1xuXG5jcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0VHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0SXNMaXZlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SXNMaXZlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTZWdtZW50RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGgsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxTZWdtZW50Q291bnQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEVuZE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICAvLyBUT0RPOiBFeHRlcm5hbGl6ZVxuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgaW5pdGlhbGl6YXRpb24gPSB7fTtcbiAgICAgICAgICAgIGluaXRpYWxpemF0aW9uLmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgICAgICAgICByZXByZXNlbnRhdGlvbklkID0gcmVwcmVzZW50YXRpb24uZ2V0SWQoKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0SW5pdGlhbGl6YXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uSWQpO1xuXG4gICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsLCAnQmFuZHdpZHRoJywgcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlVXJsICsgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXR1cm4gaW5pdGlhbGl6YXRpb247XG4gICAgICAgIH0sXG4gICAgICAgIGdldFNlZ21lbnRCeU51bWJlcjogZnVuY3Rpb24obnVtYmVyKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVRpbWU6IGZ1bmN0aW9uKHNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUocmVwcmVzZW50YXRpb24sIHNlY29uZHMpOyB9LFxuICAgICAgICBnZXRTZWdtZW50QnlVVENXYWxsQ2xvY2tUaW1lOiBmdW5jdGlvbih1dGNNaWxsaXNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVVUQ1dhbGxDbG9ja1RpbWUocmVwcmVzZW50YXRpb24sIHV0Y01pbGxpc2Vjb25kcyk7IH1cbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIG51bWJlcikge1xuICAgIHZhciBzZWdtZW50ID0ge307XG4gICAgc2VnbWVudC5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICBzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldE1lZGlhKCksXG4gICAgICAgICAgICByZXBsYWNlZElkVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbi5nZXRJZCgpKSxcbiAgICAgICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsO1xuICAgICAgICAgICAgLy8gVE9ETzogU2luY2UgJFRpbWUkLXRlbXBsYXRlZCBzZWdtZW50IFVSTHMgc2hvdWxkIG9ubHkgZXhpc3QgaW4gY29uanVuY3Rpb24gdy9hIDxTZWdtZW50VGltZWxpbmU+LFxuICAgICAgICAgICAgLy8gVE9ETzogY2FuIGN1cnJlbnRseSBhc3N1bWUgYSAkTnVtYmVyJC1iYXNlZCB0ZW1wbGF0ZWQgdXJsLlxuICAgICAgICAgICAgLy8gVE9ETzogRW5mb3JjZSBtaW4vbWF4IG51bWJlciByYW5nZSAoYmFzZWQgb24gc2VnbWVudExpc3Qgc3RhcnROdW1iZXIgJiBlbmROdW1iZXIpXG4gICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkSWRVcmwsICdOdW1iZXInLCBudW1iZXIpO1xuICAgICAgICByZXBsYWNlZFRva2Vuc1VybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShyZXBsYWNlZFRva2Vuc1VybCwgJ0JhbmR3aWR0aCcsIHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcblxuICAgICAgICByZXR1cm4gYmFzZVVybCArIHJlcGxhY2VkVG9rZW5zVXJsO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIChudW1iZXIgLSBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pICsgTWF0aC5yb3VuZCgoKG51bWJlciAtIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSkgKiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKSAqIDEwMDApO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXREdXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBUT0RPOiBWZXJpZnlcbiAgICAgICAgdmFyIHN0YW5kYXJkU2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgICAgIGR1cmF0aW9uLFxuICAgICAgICAgICAgbWVkaWFQcmVzZW50YXRpb25UaW1lLFxuICAgICAgICAgICAgcHJlY2lzaW9uTXVsdGlwbGllcjtcblxuICAgICAgICBpZiAoZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSA9PT0gbnVtYmVyKSB7XG4gICAgICAgICAgICBtZWRpYVByZXNlbnRhdGlvblRpbWUgPSBOdW1iZXIoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xuICAgICAgICAgICAgLy8gSGFuZGxlIGZsb2F0aW5nIHBvaW50IHByZWNpc2lvbiBpc3N1ZVxuICAgICAgICAgICAgcHJlY2lzaW9uTXVsdGlwbGllciA9IDEwMDA7XG4gICAgICAgICAgICBkdXJhdGlvbiA9ICgoKG1lZGlhUHJlc2VudGF0aW9uVGltZSAqIHByZWNpc2lvbk11bHRpcGxpZXIpICUgKHN0YW5kYXJkU2VnbWVudER1cmF0aW9uICogcHJlY2lzaW9uTXVsdGlwbGllcikpIC8gcHJlY2lzaW9uTXVsdGlwbGllciApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZHVyYXRpb24gPSBzdGFuZGFyZFNlZ21lbnREdXJhdGlvbjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZHVyYXRpb247XG4gICAgfTtcbiAgICBzZWdtZW50LmdldE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbnVtYmVyOyB9O1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKSB7XG4gICAgdmFyIHNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHN0YXJ0TnVtYmVyID0gZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIHx8IDAsXG4gICAgICAgIG51bWJlciA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIHNlZ21lbnREdXJhdGlvbikgKyBzdGFydE51bWJlcixcbiAgICAgICAgc2VnbWVudCA9IGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTtcblxuICAgIC8vIElmIHdlJ3JlIHJlYWxseSBjbG9zZSB0byB0aGUgZW5kIHRpbWUgb2YgdGhlIGN1cnJlbnQgc2VnbWVudCAoc3RhcnQgdGltZSArIGR1cmF0aW9uKSxcbiAgICAvLyB0aGlzIG1lYW5zIHdlJ3JlIHJlYWxseSBjbG9zZSB0byB0aGUgc3RhcnQgdGltZSBvZiB0aGUgbmV4dCBzZWdtZW50LlxuICAgIC8vIFRoZXJlZm9yZSwgYXNzdW1lIHRoaXMgaXMgYSBmbG9hdGluZy1wb2ludCBwcmVjaXNpb24gaXNzdWUgd2hlcmUgd2Ugd2VyZSB0cnlpbmcgdG8gZ3JhYiBhIHNlZ21lbnRcbiAgICAvLyBieSBpdHMgc3RhcnQgdGltZSBhbmQgcmV0dXJuIHRoZSBuZXh0IHNlZ21lbnQgaW5zdGVhZC5cbiAgICBpZiAoKChzZWdtZW50LmdldFN0YXJ0VGltZSgpICsgc2VnbWVudC5nZXREdXJhdGlvbigpKSAtIHNlY29uZHMpIDw9IDAuMDAzICkge1xuICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIgKyAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVVUQ1dhbGxDbG9ja1RpbWUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgdW5peFRpbWVVdGNNaWxsaXNlY29uZHMpIHtcbiAgICB2YXIgd2FsbENsb2NrU3RhcnRUaW1lID0gZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHdhbGxDbG9ja1N0YXJ0VGltZSkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBwcmVzZW50YXRpb25UaW1lID0gKHVuaXhUaW1lVXRjTWlsbGlzZWNvbmRzIC0gd2FsbENsb2NrU3RhcnRUaW1lKS8xMDAwO1xuICAgIGlmIChOdW1iZXIuaXNOYU4ocHJlc2VudGF0aW9uVGltZSkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgcHJlc2VudGF0aW9uVGltZSk7XG59O1xuXG5mdW5jdGlvbiBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgaWYgKCFyZXByZXNlbnRhdGlvbikgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpKSB7IHJldHVybiBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7IH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb247XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZWdtZW50VGVtcGxhdGUsXG4gICAgemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU7XG5cbnplcm9QYWRUb0xlbmd0aCA9IGZ1bmN0aW9uIChudW1TdHIsIG1pblN0ckxlbmd0aCkge1xuICAgIHdoaWxlIChudW1TdHIubGVuZ3RoIDwgbWluU3RyTGVuZ3RoKSB7XG4gICAgICAgIG51bVN0ciA9ICcwJyArIG51bVN0cjtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVtU3RyO1xufTtcblxucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHRva2VuLCB2YWx1ZSkge1xuXG4gICAgdmFyIHN0YXJ0UG9zID0gMCxcbiAgICAgICAgZW5kUG9zID0gMCxcbiAgICAgICAgdG9rZW5MZW4gPSB0b2tlbi5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZyA9ICclMCcsXG4gICAgICAgIGZvcm1hdFRhZ0xlbiA9IGZvcm1hdFRhZy5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZ1BvcyxcbiAgICAgICAgc3BlY2lmaWVyLFxuICAgICAgICB3aWR0aCxcbiAgICAgICAgcGFkZGVkVmFsdWU7XG5cbiAgICAvLyBrZWVwIGxvb3Bpbmcgcm91bmQgdW50aWwgYWxsIGluc3RhbmNlcyBvZiA8dG9rZW4+IGhhdmUgYmVlblxuICAgIC8vIHJlcGxhY2VkLiBvbmNlIHRoYXQgaGFzIGhhcHBlbmVkLCBzdGFydFBvcyBiZWxvdyB3aWxsIGJlIC0xXG4gICAgLy8gYW5kIHRoZSBjb21wbGV0ZWQgdXJsIHdpbGwgYmUgcmV0dXJuZWQuXG4gICAgd2hpbGUgKHRydWUpIHtcblxuICAgICAgICAvLyBjaGVjayBpZiB0aGVyZSBpcyBhIHZhbGlkICQ8dG9rZW4+Li4uJCBpZGVudGlmaWVyXG4gICAgICAgIC8vIGlmIG5vdCwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIHN0YXJ0UG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcgKyB0b2tlbik7XG4gICAgICAgIGlmIChzdGFydFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoZSBuZXh0ICckJyBtdXN0IGJlIHRoZSBlbmQgb2YgdGhlIGlkZW50aWZlclxuICAgICAgICAvLyBpZiB0aGVyZSBpc24ndCBvbmUsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBlbmRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChlbmRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBub3cgc2VlIGlmIHRoZXJlIGlzIGFuIGFkZGl0aW9uYWwgZm9ybWF0IHRhZyBzdWZmaXhlZCB0b1xuICAgICAgICAvLyB0aGUgaWRlbnRpZmllciB3aXRoaW4gdGhlIGVuY2xvc2luZyAnJCcgY2hhcmFjdGVyc1xuICAgICAgICBmb3JtYXRUYWdQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKGZvcm1hdFRhZywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChmb3JtYXRUYWdQb3MgPiBzdGFydFBvcyAmJiBmb3JtYXRUYWdQb3MgPCBlbmRQb3MpIHtcblxuICAgICAgICAgICAgc3BlY2lmaWVyID0gdGVtcGxhdGVTdHIuY2hhckF0KGVuZFBvcyAtIDEpO1xuICAgICAgICAgICAgd2lkdGggPSBwYXJzZUludCh0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZm9ybWF0VGFnUG9zICsgZm9ybWF0VGFnTGVuLCBlbmRQb3MgLSAxKSwgMTApO1xuXG4gICAgICAgICAgICAvLyBzdXBwb3J0IHRoZSBtaW5pbXVtIHNwZWNpZmllcnMgcmVxdWlyZWQgYnkgSUVFRSAxMDAzLjFcbiAgICAgICAgICAgIC8vIChkLCBpICwgbywgdSwgeCwgYW5kIFgpIGZvciBjb21wbGV0ZW5lc3NcbiAgICAgICAgICAgIHN3aXRjaCAoc3BlY2lmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJlYXQgYWxsIGludCB0eXBlcyBhcyB1aW50LFxuICAgICAgICAgICAgICAgIC8vIGhlbmNlIGRlbGliZXJhdGUgZmFsbHRocm91Z2hcbiAgICAgICAgICAgICAgICBjYXNlICdkJzpcbiAgICAgICAgICAgICAgICBjYXNlICdpJzpcbiAgICAgICAgICAgICAgICBjYXNlICd1JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoKSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd4JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ1gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdvJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoOCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1Vuc3VwcG9ydGVkL2ludmFsaWQgSUVFRSAxMDAzLjEgZm9ybWF0IGlkZW50aWZpZXIgc3RyaW5nIGluIFVSTCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVtcGxhdGVTdHIgPSB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoMCwgc3RhcnRQb3MpICsgcGFkZGVkVmFsdWUgKyB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZW5kUG9zICsgMSk7XG4gICAgfVxufTtcblxudW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0cikge1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJCQnKS5qb2luKCckJyk7XG59O1xuXG5yZXBsYWNlSURGb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdGVtcGxhdGVTdHIuaW5kZXhPZignJFJlcHJlc2VudGF0aW9uSUQkJykgPT09IC0xKSB7IHJldHVybiB0ZW1wbGF0ZVN0cjsgfVxuICAgIHZhciB2ID0gdmFsdWUudG9TdHJpbmcoKTtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyRSZXByZXNlbnRhdGlvbklEJCcpLmpvaW4odik7XG59O1xuXG5zZWdtZW50VGVtcGxhdGUgPSB7XG4gICAgemVyb1BhZFRvTGVuZ3RoOiB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGU6IHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGU6IHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU6IHJlcGxhY2VJREZvclRlbXBsYXRlXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHNlZ21lbnRUZW1wbGF0ZTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBldmVudE1nciA9IHJlcXVpcmUoJy4vZXZlbnRNYW5hZ2VyLmpzJyksXG4gICAgZXZlbnREaXNwYXRjaGVyTWl4aW4gPSB7XG4gICAgICAgIHRyaWdnZXI6IGZ1bmN0aW9uKGV2ZW50T2JqZWN0KSB7IGV2ZW50TWdyLnRyaWdnZXIodGhpcywgZXZlbnRPYmplY3QpOyB9LFxuICAgICAgICBvbmU6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub25lKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvbjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb2ZmOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9mZih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfVxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnREaXNwYXRjaGVyTWl4aW47IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmlkZW9qcyA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS52aWRlb2pzLFxuICAgIGV2ZW50TWFuYWdlciA9IHtcbiAgICAgICAgdHJpZ2dlcjogdmlkZW9qcy50cmlnZ2VyLFxuICAgICAgICBvbmU6IHZpZGVvanMub25lLFxuICAgICAgICBvbjogdmlkZW9qcy5vbixcbiAgICAgICAgb2ZmOiB2aWRlb2pzLm9mZlxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnRNYW5hZ2VyO1xuIiwiLyoqXG4gKlxuICogbWFpbiBzb3VyY2UgZm9yIHBhY2thZ2VkIGNvZGUuIEF1dG8tYm9vdHN0cmFwcyB0aGUgc291cmNlIGhhbmRsaW5nIGZ1bmN0aW9uYWxpdHkgYnkgcmVnaXN0ZXJpbmcgdGhlIHNvdXJjZSBoYW5kbGVyXG4gKiB3aXRoIHZpZGVvLmpzIG9uIGluaXRpYWwgc2NyaXB0IGxvYWQgdmlhIElJRkUuIChOT1RFOiBUaGlzIHBsYWNlcyBhbiBvcmRlciBkZXBlbmRlbmN5IG9uIHRoZSB2aWRlby5qcyBsaWJyYXJ5LCB3aGljaFxuICogbXVzdCBhbHJlYWR5IGJlIGxvYWRlZCBiZWZvcmUgdGhpcyBzY3JpcHQgYXV0by1leGVjdXRlcy4pXG4gKlxuICovXG47KGZ1bmN0aW9uKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciByb290ID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLFxuICAgICAgICB2aWRlb2pzID0gcm9vdC52aWRlb2pzLFxuICAgICAgICBTb3VyY2VIYW5kbGVyID0gcmVxdWlyZSgnLi9Tb3VyY2VIYW5kbGVyJyksXG4gICAgICAgIENhbkhhbmRsZVNvdXJjZUVudW0gPSB7XG4gICAgICAgICAgICBET0VTTlRfSEFORExFX1NPVVJDRTogJycsXG4gICAgICAgICAgICBNQVlCRV9IQU5ETEVfU09VUkNFOiAnbWF5YmUnXG4gICAgICAgIH07XG5cbiAgICBpZiAoIXZpZGVvanMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgdmlkZW8uanMgbGlicmFyeSBtdXN0IGJlIGluY2x1ZGVkIHRvIHVzZSB0aGlzIE1QRUctREFTSCBzb3VyY2UgaGFuZGxlci4nKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIFVzZWQgYnkgYSB2aWRlby5qcyB0ZWNoIGluc3RhbmNlIHRvIHZlcmlmeSB3aGV0aGVyIG9yIG5vdCBhIHNwZWNpZmljIG1lZGlhIHNvdXJjZSBjYW4gYmUgaGFuZGxlZCBieSB0aGlzXG4gICAgICogc291cmNlIGhhbmRsZXIuIEluIHRoaXMgY2FzZSwgc2hvdWxkIHJldHVybiAnbWF5YmUnIGlmIHRoZSBzb3VyY2UgaXMgTVBFRy1EQVNILCBvdGhlcndpc2UgJycgKHJlcHJlc2VudGluZyBubykuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge29iamVjdH0gc291cmNlICAgICAgICAgICB2aWRlby5qcyBzb3VyY2Ugb2JqZWN0IHByb3ZpZGluZyBzb3VyY2UgdXJpIGFuZCB0eXBlIGluZm9ybWF0aW9uXG4gICAgICogQHJldHVybnMge0NhbkhhbmRsZVNvdXJjZUVudW19ICAgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIHdoZXRoZXIgb3Igbm90IHBhcnRpY3VsYXIgc291cmNlIGNhbiBiZSBoYW5kbGVkIGJ5IHRoaXNcbiAgICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2UgaGFuZGxlci5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBjYW5IYW5kbGVTb3VyY2Uoc291cmNlKSB7XG4gICAgICAgIC8vIFJlcXVpcmVzIE1lZGlhIFNvdXJjZSBFeHRlbnNpb25zXG4gICAgICAgIGlmICghKHJvb3QuTWVkaWFTb3VyY2UpKSB7XG4gICAgICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5ET0VTTlRfSEFORExFX1NPVVJDRTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSB0eXBlIGlzIHN1cHBvcnRlZFxuICAgICAgICBpZiAoL2FwcGxpY2F0aW9uXFwvZGFzaFxcK3htbC8udGVzdChzb3VyY2UudHlwZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLk1BWUJFX0hBTkRMRV9TT1VSQ0U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleHRlbnNpb24gbWF0Y2hlc1xuICAgICAgICBpZiAoL1xcLm1wZCQvaS50ZXN0KHNvdXJjZS5zcmMpKSB7XG4gICAgICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5NQVlCRV9IQU5ETEVfU09VUkNFO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uRE9FU05UX0hBTkRMRV9TT1VSQ0U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBDYWxsZWQgYnkgYSB2aWRlby5qcyB0ZWNoIGluc3RhbmNlIHRvIGhhbmRsZSBhIHNwZWNpZmljIG1lZGlhIHNvdXJjZSwgcmV0dXJuaW5nIGFuIG9iamVjdCBpbnN0YW5jZSB0aGF0IHByb3ZpZGVzXG4gICAgICogdGhlIGNvbnRleHQgZm9yIGhhbmRsaW5nIHNhaWQgc291cmNlLlxuICAgICAqXG4gICAgICogQHBhcmFtIHNvdXJjZSAgICAgICAgICAgIHZpZGVvLmpzIHNvdXJjZSBvYmplY3QgcHJvdmlkaW5nIHNvdXJjZSB1cmkgYW5kIHR5cGUgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gdGVjaCAgICAgICAgICAgICAgdmlkZW8uanMgdGVjaCBvYmplY3QgKGluIHRoaXMgY2FzZSwgc2hvdWxkIGJlIEh0bWw1IHRlY2gpIHByb3ZpZGluZyBwb2ludCBvZiBpbnRlcmFjdGlvblxuICAgICAqICAgICAgICAgICAgICAgICAgICAgICAgICBiZXR3ZWVuIHRoZSBzb3VyY2UgaGFuZGxlciBhbmQgdGhlIHZpZGVvLmpzIGxpYnJhcnkgKGluY2x1ZGluZywgZS5nLiwgdGhlIHZpZGVvIGVsZW1lbnQpXG4gICAgICogQHJldHVybnMge1NvdXJjZUhhbmRsZXJ9IEFuIG9iamVjdCB0aGF0IGRlZmluZXMgY29udGV4dCBmb3IgaGFuZGxpbmcgYSBwYXJ0aWN1bGFyIE1QRUctREFTSCBzb3VyY2UuXG4gICAgICovXG4gICAgZnVuY3Rpb24gaGFuZGxlU291cmNlKHNvdXJjZSwgdGVjaCkge1xuICAgICAgICByZXR1cm4gbmV3IFNvdXJjZUhhbmRsZXIoc291cmNlLCB0ZWNoKTtcbiAgICB9XG5cbiAgICAvLyBSZWdpc3RlciB0aGUgc291cmNlIGhhbmRsZXIgdG8gdGhlIEh0bWw1IHRlY2ggaW5zdGFuY2UuXG4gICAgdmlkZW9qcy5IdG1sNS5yZWdpc3RlclNvdXJjZUhhbmRsZXIoe1xuICAgICAgICBjYW5IYW5kbGVTb3VyY2U6IGNhbkhhbmRsZVNvdXJjZSxcbiAgICAgICAgaGFuZGxlU291cmNlOiBoYW5kbGVTb3VyY2VcbiAgICB9LCAwKTtcblxufS5jYWxsKHRoaXMpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgdHJ1dGh5ID0gcmVxdWlyZSgnLi4vdXRpbC90cnV0aHkuanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4uL3V0aWwvaXNTdHJpbmcuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGxvYWRNYW5pZmVzdCA9IHJlcXVpcmUoJy4vbG9hZE1hbmlmZXN0LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbiA9IHJlcXVpcmUoJy4uL2Rhc2gvc2VnbWVudHMvZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbi5qcycpLFxuICAgIGdldE1wZCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIGdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24sXG4gICAgZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlLFxuICAgIGZpbmRFbGVtZW50SW5BcnJheSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVzLmpzJyksXG4gICAgREVGQVVMVF9UWVBFID0gbWVkaWFUeXBlc1swXTtcblxuLyoqXG4gKlxuICogRnVuY3Rpb24gdXNlZCB0byBnZXQgdGhlIG1lZGlhIHR5cGUgYmFzZWQgb24gdGhlIG1pbWUgdHlwZS4gVXNlZCB0byBkZXRlcm1pbmUgdGhlIG1lZGlhIHR5cGUgb2YgQWRhcHRhdGlvbiBTZXRzXG4gKiBvciBjb3JyZXNwb25kaW5nIGRhdGEgcmVwcmVzZW50YXRpb25zLlxuICpcbiAqIEBwYXJhbSBtaW1lVHlwZSB7c3RyaW5nfSBtaW1lIHR5cGUgZm9yIGEgREFTSCBNUEQgQWRhcHRhdGlvbiBTZXQgKHNwZWNpZmllZCBhcyBhbiBhdHRyaWJ1dGUgc3RyaW5nKVxuICogQHBhcmFtIHR5cGVzIHtzdHJpbmd9ICAgIHN1cHBvcnRlZCBtZWRpYSB0eXBlcyAoZS5nLiAndmlkZW8sJyAnYXVkaW8sJylcbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgICAgICB0aGUgbWVkaWEgdHlwZSB0aGF0IGNvcnJlc3BvbmRzIHRvIHRoZSBtaW1lIHR5cGUuXG4gKi9cbmdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSA9IGZ1bmN0aW9uKG1pbWVUeXBlLCB0eXBlcykge1xuICAgIGlmICghaXNTdHJpbmcobWltZVR5cGUpKSB7IHJldHVybiBERUZBVUxUX1RZUEU7IH0gICAvLyBUT0RPOiBUaHJvdyBlcnJvcj9cbiAgICB2YXIgbWF0Y2hlZFR5cGUgPSBmaW5kRWxlbWVudEluQXJyYXkodHlwZXMsIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgcmV0dXJuICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gZXhpc3R5KG1hdGNoZWRUeXBlKSA/IG1hdGNoZWRUeXBlIDogREVGQVVMVF9UWVBFO1xufTtcblxuLyoqXG4gKlxuICogRnVuY3Rpb24gdXNlZCB0byBnZXQgdGhlICd0eXBlJyBvZiBhIERBU0ggUmVwcmVzZW50YXRpb24gaW4gYSBmb3JtYXQgZXhwZWN0ZWQgYnkgdGhlIE1TRSBTb3VyY2VCdWZmZXIuIFVzZWQgdG9cbiAqIGNyZWF0ZSBTb3VyY2VCdWZmZXIgaW5zdGFuY2VzIHRoYXQgY29ycmVzcG9uZCB0byBhIGdpdmVuIE1lZGlhU2V0IChlLmcuIHNldCBvZiBhdWRpbyBzdHJlYW0gdmFyaWFudHMsIHZpZGVvIHN0cmVhbVxuICogdmFyaWFudHMsIGV0Yy4pLlxuICpcbiAqIEBwYXJhbSByZXByZXNlbnRhdGlvbiAgICBQT0pPIERBU0ggTVBEIFJlcHJlc2VudGF0aW9uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAgICAgICAgVGhlIFJlcHJlc2VudGF0aW9uJ3MgJ3R5cGUnIGluIGEgZm9ybWF0IGV4cGVjdGVkIGJ5IHRoZSBNU0UgU291cmNlQnVmZmVyXG4gKi9cbmdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24gPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZmluZEVsZW1lbnRJbkFycmF5ID0gZnVuY3Rpb24oYXJyYXksIHByZWRpY2F0ZUZuKSB7XG4gICAgaWYgKCFpc0FycmF5KGFycmF5KSB8fCAhaXNGdW5jdGlvbihwcmVkaWNhdGVGbikpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHZhciBpLFxuICAgICAgICBsZW5ndGggPSBhcnJheS5sZW5ndGgsXG4gICAgICAgIGVsZW07XG5cbiAgICBmb3IgKGk9MDsgaTxsZW5ndGg7IGkrKykge1xuICAgICAgICBlbGVtID0gYXJyYXlbaV07XG4gICAgICAgIGlmIChwcmVkaWNhdGVGbihlbGVtLCBpLCBhcnJheSkpIHsgcmV0dXJuIGVsZW07IH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufTtcblxuLyoqXG4gKlxuICogVGhlIE1hbmlmZXN0Q29udHJvbGxlciBsb2Fkcywgc3RvcmVzLCBhbmQgcHJvdmlkZXMgZGF0YSB2aWV3cyBmb3IgdGhlIE1QRCBtYW5pZmVzdCB0aGF0IHJlcHJlc2VudHMgdGhlXG4gKiBNUEVHLURBU0ggbWVkaWEgc291cmNlIGJlaW5nIGhhbmRsZWQuXG4gKlxuICogQHBhcmFtIHNvdXJjZVVyaSB7c3RyaW5nfVxuICogQHBhcmFtIGF1dG9Mb2FkICB7Ym9vbGVhbn1cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlVXJpLCBhdXRvTG9hZCkge1xuICAgIHRoaXMuX19hdXRvTG9hZCA9IHRydXRoeShhdXRvTG9hZCk7XG4gICAgdGhpcy5zZXRTb3VyY2VVcmkoc291cmNlVXJpKTtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIE1BTklGRVNUX0xPQURFRDogJ21hbmlmZXN0TG9hZGVkJ1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRTb3VyY2VVcmkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX3NvdXJjZVVyaTtcbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuc2V0U291cmNlVXJpID0gZnVuY3Rpb24gc2V0U291cmNlVXJpKHNvdXJjZVVyaSkge1xuICAgIC8vIFRPRE86ICdleGlzdHkoKScgY2hlY2sgZm9yIGJvdGg/XG4gICAgaWYgKHNvdXJjZVVyaSA9PT0gdGhpcy5fX3NvdXJjZVVyaSkgeyByZXR1cm47IH1cblxuICAgIC8vIFRPRE86IGlzU3RyaW5nKCkgY2hlY2s/ICdleGlzdHkoKScgY2hlY2s/XG4gICAgaWYgKCFzb3VyY2VVcmkpIHtcbiAgICAgICAgdGhpcy5fX2NsZWFyU291cmNlVXJpKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBOZWVkIHRvIHBvdGVudGlhbGx5IHJlbW92ZSB1cGRhdGUgaW50ZXJ2YWwgZm9yIHJlLXJlcXVlc3RpbmcgdGhlIE1QRCBtYW5pZmVzdCAoaW4gY2FzZSBpdCBpcyBhIGR5bmFtaWMgTVBEKVxuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBzb3VyY2VVcmk7XG4gICAgLy8gSWYgd2Ugc2hvdWxkIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgTVBELCBnbyBhaGVhZCBhbmQga2ljayBvZmYgbG9hZGluZyBpdC5cbiAgICBpZiAodGhpcy5fX2F1dG9Mb2FkKSB7XG4gICAgICAgIC8vIFRPRE86IEltcGwgYW55IGNsZWFudXAgZnVuY3Rpb25hbGl0eSBhcHByb3ByaWF0ZSBiZWZvcmUgbG9hZC5cbiAgICAgICAgdGhpcy5sb2FkKCk7XG4gICAgfVxufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX2NsZWFyU291cmNlVXJpID0gZnVuY3Rpb24gY2xlYXJTb3VyY2VVcmkoKSB7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IG51bGw7XG4gICAgLy8gTmVlZCB0byBwb3RlbnRpYWxseSByZW1vdmUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgbWFuaWZlc3QgKGluIGNhc2UgaXQgaXMgYSBkeW5hbWljIE1QRClcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAvLyBUT0RPOiBpbXBsIGFueSBvdGhlciBjbGVhbnVwIGZ1bmN0aW9uYWxpdHlcbn07XG5cbi8qKlxuICogS2ljayBvZmYgbG9hZGluZyB0aGUgREFTSCBNUEQgTWFuaWZlc3QgKHNlcnZlZCBAIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgaW5zdGFuY2UncyBfX3NvdXJjZVVyaSlcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24gbG9hZCgpIHtcbiAgICAvLyBUT0RPOiBDdXJyZW50bHkgY2xlYXJpbmcgJiByZS1zZXR0aW5nIHVwZGF0ZSBpbnRlcnZhbCBhZnRlciBldmVyeSByZXF1ZXN0LiBFaXRoZXIgdXNlIHNldFRpbWVvdXQoKSBvciBvbmx5IHNldHVwIGludGVydmFsIG9uY2VcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgbG9hZE1hbmlmZXN0KHNlbGYuX19zb3VyY2VVcmksIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgc2VsZi5fX21hbmlmZXN0ID0gZGF0YS5tYW5pZmVzdFhtbDtcbiAgICAgICAgLy8gKFBvdGVudGlhbGx5KSBzZXR1cCB0aGUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgKGluIGNhc2UgdGhlIG1hbmlmZXN0IGlzIGR5bmFtaWMpXG4gICAgICAgIHNlbGYuX19zZXR1cFVwZGF0ZUludGVydmFsKCk7XG4gICAgICAgIC8vIERpc3BhdGNoIGV2ZW50IHRvIG5vdGlmeSB0aGF0IHRoZSBtYW5pZmVzdCBoYXMgbG9hZGVkLlxuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VsZi5fX21hbmlmZXN0fSk7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqICdQcml2YXRlJyBtZXRob2QgdGhhdCByZW1vdmVzIHRoZSB1cGRhdGUgaW50ZXJ2YWwgKGlmIGl0IGV4aXN0cyksIHNvIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgaW5zdGFuY2Ugd2lsbCBubyBsb25nZXJcbiAqIHBlcmlvZGljYWxseSByZS1yZXF1ZXN0IHRoZSBtYW5pZmVzdCAoaWYgaXQncyBkeW5hbWljKS5cbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3VwZGF0ZUludGVydmFsKSkgeyByZXR1cm47IH1cbiAgICBjbGVhckludGVydmFsKHRoaXMuX191cGRhdGVJbnRlcnZhbCk7XG59O1xuXG4vKipcbiAqIFNldHMgdXAgYW4gaW50ZXJ2YWwgdG8gcmUtcmVxdWVzdCB0aGUgbWFuaWZlc3QgKGlmIGl0J3MgZHluYW1pYylcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX3NldHVwVXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBzZXR1cFVwZGF0ZUludGVydmFsKCkge1xuICAgIC8vIElmIHRoZXJlJ3MgYWxyZWFkeSBhbiB1cGRhdGVJbnRlcnZhbCBmdW5jdGlvbiwgcmVtb3ZlIGl0LlxuICAgIGlmICh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpIHsgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7IH1cbiAgICAvLyBJZiB3ZSBzaG91bGRuJ3QgdXBkYXRlLCBqdXN0IGJhaWwuXG4gICAgaWYgKCF0aGlzLmdldFNob3VsZFVwZGF0ZSgpKSB7IHJldHVybjsgfVxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWluVXBkYXRlUmF0ZSA9IDIsXG4gICAgICAgIHVwZGF0ZVJhdGUgPSBNYXRoLm1heCh0aGlzLmdldFVwZGF0ZVJhdGUoKSwgbWluVXBkYXRlUmF0ZSk7XG4gICAgLy8gU2V0dXAgdGhlIHVwZGF0ZSBpbnRlcnZhbCBiYXNlZCBvbiB0aGUgdXBkYXRlIHJhdGUgKGRldGVybWluZWQgZnJvbSB0aGUgbWFuaWZlc3QpIG9yIHRoZSBtaW5pbXVtIHVwZGF0ZSByYXRlXG4gICAgLy8gKHdoaWNoZXZlcidzIGxhcmdlcikuXG4gICAgLy8gTk9URTogTXVzdCBzdG9yZSByZWYgdG8gY3JlYXRlZCBpbnRlcnZhbCB0byBwb3RlbnRpYWxseSBjbGVhci9yZW1vdmUgaXQgbGF0ZXJcbiAgICB0aGlzLl9fdXBkYXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgc2VsZi5sb2FkKCk7XG4gICAgfSwgdXBkYXRlUmF0ZSAqIDEwMDApO1xufTtcblxuLyoqXG4gKiBHZXRzIHRoZSB0eXBlIG9mIHBsYXlsaXN0ICgnc3RhdGljJyBvciAnZHluYW1pYycsIHdoaWNoIG5lYXJseSBpbnZhcmlhYmx5IGNvcnJlc3BvbmRzIHRvIGxpdmUgdnMuIHZvZCkgZGVmaW5lZCBpbiB0aGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgIHRoZSBwbGF5bGlzdCB0eXBlIChlaXRoZXIgJ3N0YXRpYycgb3IgJ2R5bmFtaWMnKVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFBsYXlsaXN0VHlwZSA9IGZ1bmN0aW9uIGdldFBsYXlsaXN0VHlwZSgpIHtcbiAgICB2YXIgcGxheWxpc3RUeXBlID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0VHlwZSgpO1xuICAgIHJldHVybiBwbGF5bGlzdFR5cGU7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFVwZGF0ZVJhdGUgPSBmdW5jdGlvbiBnZXRVcGRhdGVSYXRlKCkge1xuICAgIHZhciBtaW5pbXVtVXBkYXRlUGVyaW9kU3RyID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCgpLFxuICAgICAgICBtaW5pbXVtVXBkYXRlUGVyaW9kID0gcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1pbmltdW1VcGRhdGVQZXJpb2RTdHIpO1xuICAgIHJldHVybiBtaW5pbXVtVXBkYXRlUGVyaW9kO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRTaG91bGRVcGRhdGUgPSBmdW5jdGlvbiBnZXRTaG91bGRVcGRhdGUoKSB7XG4gICAgdmFyIGlzRHluYW1pYyA9ICh0aGlzLmdldFBsYXlsaXN0VHlwZSgpID09PSAnZHluYW1pYycpLFxuICAgICAgICBoYXNWYWxpZFVwZGF0ZVJhdGUgPSAodGhpcy5nZXRVcGRhdGVSYXRlKCkgPiAwKTtcbiAgICByZXR1cm4gKGlzRHluYW1pYyAmJiBoYXNWYWxpZFVwZGF0ZVJhdGUpO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRNcGQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCk7XG59O1xuXG4vKipcbiAqXG4gKiBAcGFyYW0gdHlwZVxuICogQHJldHVybnMge01lZGlhU2V0fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0QnlUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRCeVR5cGUodHlwZSkge1xuICAgIGlmIChtZWRpYVR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7IHRocm93IG5ldyBFcnJvcignSW52YWxpZCB0eXBlLiBWYWx1ZSBtdXN0IGJlIG9uZSBvZjogJyArIG1lZGlhVHlwZXMuam9pbignLCAnKSk7IH1cbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2ggPSBmaW5kRWxlbWVudEluQXJyYXkoYWRhcHRhdGlvblNldHMsIGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHtcbiAgICAgICAgICAgIHJldHVybiAoZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKGFkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcykgPT09IHR5cGUpO1xuICAgICAgICB9KTtcbiAgICBpZiAoIWV4aXN0eShhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKTtcbn07XG5cbi8qKlxuICpcbiAqIEByZXR1cm5zIHtBcnJheS48TWVkaWFTZXQ+fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0cyA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0cygpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgbWVkaWFTZXRzID0gYWRhcHRhdGlvblNldHMubWFwKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHsgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0KTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0cztcbn07XG5cbi8vIE1peGluIGV2ZW50IGhhbmRsaW5nIGZvciB0aGUgTWFuaWZlc3RDb250cm9sbGVyIG9iamVjdCB0eXBlIGRlZmluaXRpb24uXG5leHRlbmRPYmplY3QoTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG4vLyBUT0RPOiBNb3ZlIE1lZGlhU2V0IGRlZmluaXRpb24gdG8gYSBzZXBhcmF0ZSAuanMgZmlsZT9cbi8qKlxuICpcbiAqIFByaW1hcnkgZGF0YSB2aWV3IGZvciByZXByZXNlbnRpbmcgdGhlIHNldCBvZiBzZWdtZW50IGxpc3RzIGFuZCBvdGhlciBnZW5lcmFsIGluZm9ybWF0aW9uIGZvciBhIGdpdmUgbWVkaWEgdHlwZVxuICogKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKS5cbiAqXG4gKiBAcGFyYW0gYWRhcHRhdGlvblNldCBUaGUgTVBFRy1EQVNIIGNvcnJlbGF0ZSBmb3IgYSBnaXZlbiBtZWRpYSBzZXQsIGNvbnRhaW5pbmcgc29tZSB3YXkgb2YgcmVwcmVzZW50YXRpbmcgc2VnbWVudCBsaXN0c1xuICogICAgICAgICAgICAgICAgICAgICAgYW5kIGEgc2V0IG9mIHJlcHJlc2VudGF0aW9ucyBmb3IgZWFjaCBzdHJlYW0gdmFyaWFudC5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNZWRpYVNldChhZGFwdGF0aW9uU2V0KSB7XG4gICAgLy8gVE9ETzogQWRkaXRpb25hbCBjaGVja3MgJiBFcnJvciBUaHJvd2luZ1xuICAgIHRoaXMuX19hZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldDtcbn1cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uIGdldE1lZGlhVHlwZSgpIHtcbiAgICB2YXIgdHlwZSA9IGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSh0aGlzLmdldE1pbWVUeXBlKCksIG1lZGlhVHlwZXMpO1xuICAgIHJldHVybiB0eXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1pbWVUeXBlID0gZnVuY3Rpb24gZ2V0TWltZVR5cGUoKSB7XG4gICAgdmFyIG1pbWVUeXBlID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKTtcbiAgICByZXR1cm4gbWltZVR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyVHlwZSA9IGZ1bmN0aW9uIGdldFNvdXJjZUJ1ZmZlclR5cGUoKSB7XG4gICAgLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZSBjb2RlY3MgYXNzb2NpYXRlZCB3aXRoIGVhY2ggc3RyZWFtIHZhcmlhbnQvcmVwcmVzZW50YXRpb25cbiAgICAvLyB3aWxsIGJlIHNpbWlsYXIgZW5vdWdoIHRoYXQgeW91IHdvbid0IGhhdmUgdG8gcmUtY3JlYXRlIHRoZSBzb3VyY2UtYnVmZmVyIHdoZW4gc3dpdGNoaW5nXG4gICAgLy8gYmV0d2VlbiB0aGVtLlxuXG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNvdXJjZUJ1ZmZlclR5cGUgPSBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc291cmNlQnVmZmVyVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0VG90YWxEdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKTtcbiAgICByZXR1cm4gdG90YWxEdXJhdGlvbjtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgd2FsbENsb2NrVGltZSA9IHNlZ21lbnRMaXN0LmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSgpO1xuICAgIHJldHVybiB3YWxsQ2xvY2tUaW1lO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VG90YWxTZWdtZW50Q291bnQgPSBmdW5jdGlvbiBnZXRUb3RhbFNlZ21lbnRDb3VudCgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxTZWdtZW50Q291bnQgPSBzZWdtZW50TGlzdC5nZXRUb3RhbFNlZ21lbnRDb3VudCgpO1xuICAgIHJldHVybiB0b3RhbFNlZ21lbnRDb3VudDtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50RHVyYXRpb24gPSBmdW5jdGlvbiBnZXRTZWdtZW50RHVyYXRpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnREdXJhdGlvbigpO1xuICAgIHJldHVybiBzZWdtZW50RHVyYXRpb247XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RTdGFydE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBzZWdtZW50TGlzdC5nZXRTdGFydE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0RW5kTnVtYmVyID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnRMaXN0RW5kTnVtYmVyID0gc2VnbWVudExpc3QuZ2V0RW5kTnVtYmVyKCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0RW5kTnVtYmVyO1xufTtcblxuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RzID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RzKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKSxcbiAgICAgICAgc2VnbWVudExpc3RzID0gcmVwcmVzZW50YXRpb25zLm1hcChnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RzO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKSxcbiAgICAgICAgcmVwcmVzZW50YXRpb25XaXRoQmFuZHdpZHRoTWF0Y2ggPSBmaW5kRWxlbWVudEluQXJyYXkocmVwcmVzZW50YXRpb25zLCBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgdmFyIHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCk7XG4gICAgICAgICAgICByZXR1cm4gKE51bWJlcihyZXByZXNlbnRhdGlvbkJhbmR3aWR0aCkgPT09IE51bWJlcihiYW5kd2lkdGgpKTtcbiAgICAgICAgfSksXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbiBnZXRBdmFpbGFibGVCYW5kd2lkdGhzKCkge1xuICAgIHJldHVybiB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKS5tYXAoXG4gICAgICAgIGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbiAgICB9KS5maWx0ZXIoXG4gICAgICAgIGZ1bmN0aW9uKGJhbmR3aWR0aCkge1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0eShiYW5kd2lkdGgpO1xuICAgICAgICB9XG4gICAgKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gTWFuaWZlc3RDb250cm9sbGVyOyIsIm1vZHVsZS5leHBvcnRzID0gWyd2aWRlbycsICdhdWRpbyddOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL3V0aWwuanMnKS5wYXJzZVJvb3RVcmw7XG5cbmZ1bmN0aW9uIGxvYWRNYW5pZmVzdCh1cmwsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFjdHVhbFVybCA9IHBhcnNlUm9vdFVybCh1cmwpLFxuICAgICAgICByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIG9ubG9hZDtcblxuICAgIG9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7IHJldHVybjsgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2soe21hbmlmZXN0WG1sOiByZXF1ZXN0LnJlc3BvbnNlWE1MIH0pOyB9XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3Qub25sb2FkID0gb25sb2FkO1xuICAgICAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgICAgIHJlcXVlc3Quc2VuZCgpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgICByZXF1ZXN0Lm9uZXJyb3IoKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gbG9hZE1hbmlmZXN0OyIsIlxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNOdW1iZXIgPSByZXF1aXJlKCcuLi91dGlsL2lzTnVtYmVyLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGxvYWRTZWdtZW50LFxuICAgIERFRkFVTFRfUkVUUllfQ09VTlQgPSAzLFxuICAgIERFRkFVTFRfUkVUUllfSU5URVJWQUwgPSAyNTA7XG5cbi8qKlxuICogR2VuZXJpYyBmdW5jdGlvbiBmb3IgbG9hZGluZyBNUEVHLURBU0ggc2VnbWVudHNcbiAqIEBwYXJhbSBzZWdtZW50IHtvYmplY3R9ICAgICAgICAgIGRhdGEgdmlldyByZXByZXNlbnRpbmcgYSBzZWdtZW50IChhbmQgcmVsZXZhbnQgZGF0YSBmb3IgdGhhdCBzZWdtZW50KVxuICogQHBhcmFtIGNhbGxiYWNrRm4ge2Z1bmN0aW9ufSAgICAgY2FsbGJhY2sgZnVuY3Rpb25cbiAqIEBwYXJhbSByZXRyeUNvdW50IHtudW1iZXJ9ICAgICAgIHN0aXB1bGF0ZXMgaG93IG1hbnkgdGltZXMgd2Ugc2hvdWxkIHRyeSB0byBsb2FkIHRoZSBzZWdtZW50IGJlZm9yZSBnaXZpbmcgdXBcbiAqIEBwYXJhbSByZXRyeUludGVydmFsIHtudW1iZXJ9ICAgIHN0aXB1bGF0ZXMgdGhlIGFtb3VudCBvZiB0aW1lIChpbiBtaWxsaXNlY29uZHMpIHdlIHNob3VsZCB3YWl0IGJlZm9yZSByZXRyeWluZyB0b1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG93bmxvYWQgdGhlIHNlZ21lbnQgaWYvd2hlbiB0aGUgZG93bmxvYWQgYXR0ZW1wdCBmYWlscy5cbiAqL1xubG9hZFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50LCByZXRyeUludGVydmFsKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBudWxsO1xuXG4gICAgdmFyIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKSxcbiAgICAgICAgdXJsID0gc2VnbWVudC5nZXRVcmwoKTtcbiAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuXG4gICAgcmVxdWVzdC5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IE51bWJlcigobmV3IERhdGUoKS5nZXRUaW1lKCkpLzEwMDApO1xuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2tGbiA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFja0ZuLmNhbGwoc2VsZiwgcmVxdWVzdC5yZXNwb25zZSk7IH1cbiAgICB9O1xuICAgIC8vcmVxdWVzdC5vbmVycm9yID0gcmVxdWVzdC5vbmxvYWRlbmQgPSBmdW5jdGlvbigpIHtcbiAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIHNlbGYuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcbiAgICByZXF1ZXN0LnNlbmQoKTtcbn07XG5cbi8qKlxuICpcbiAqIFNlZ21lbnRMb2FkZXIgaGFuZGxlcyBsb2FkaW5nIHNlZ21lbnRzIGZyb20gc2VnbWVudCBsaXN0cyBmb3IgYSBnaXZlbiBtZWRpYSBzZXQsIGJhc2VkIG9uIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWRcbiAqIHNlZ21lbnQgbGlzdCAod2hpY2ggY29ycmVzcG9uZHMgdG8gdGhlIGN1cnJlbnRseSBzZXQgYmFuZHdpZHRoL2JpdHJhdGUpXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfVxuICogQHBhcmFtIG1lZGlhVHlwZSB7c3RyaW5nfVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpIHtcbiAgICBpZiAoIWV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtYW5pZmVzdENvbnRyb2xsZXIhJyk7IH1cbiAgICBpZiAoIWV4aXN0eShtZWRpYVR5cGUpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtZWRpYVR5cGUhJyk7IH1cbiAgICAvLyBOT1RFOiBSYXRoZXIgdGhhbiBwYXNzaW5nIGluIGEgcmVmZXJlbmNlIHRvIHRoZSBNZWRpYVNldCBpbnN0YW5jZSBmb3IgYSBtZWRpYSB0eXBlLCB3ZSBwYXNzIGluIGEgcmVmZXJlbmNlIHRvIHRoZVxuICAgIC8vIGNvbnRyb2xsZXIgJiB0aGUgbWVkaWFUeXBlIHNvIHRoYXQgdGhlIFNlZ21lbnRMb2FkZXIgZG9lc24ndCBuZWVkIHRvIGJlIGF3YXJlIG9mIHN0YXRlIGNoYW5nZXMvdXBkYXRlcyB0b1xuICAgIC8vIHRoZSBtYW5pZmVzdCBkYXRhIChzYXksIGlmIHRoZSBwbGF5bGlzdCBpcyBkeW5hbWljLydsaXZlJykuXG4gICAgdGhpcy5fX21hbmlmZXN0ID0gbWFuaWZlc3RDb250cm9sbGVyO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG4gICAgLy8gVE9ETzogRG9uJ3QgbGlrZSB0aGlzOiBOZWVkIHRvIGNlbnRyYWxpemUgcGxhY2Uocykgd2hlcmUgJiBob3cgX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCBnZXRzIHNldCB0byB0cnVlL2ZhbHNlLlxuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCk7XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gdHJ1ZTtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBJTklUSUFMSVpBVElPTl9MT0FERUQ6ICdpbml0aWFsaXphdGlvbkxvYWRlZCcsXG4gICAgU0VHTUVOVF9MT0FERUQ6ICdzZWdtZW50TG9hZGVkJyxcbiAgICBET1dOTE9BRF9EQVRBX1VQREFURTogJ2Rvd25sb2FkRGF0YVVwZGF0ZSdcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0TWVkaWFTZXQgPSBmdW5jdGlvbiBnZXRNZWRpYVNldCgpIHtcbiAgICB2YXIgbWVkaWFTZXQgPSB0aGlzLl9fbWFuaWZlc3QuZ2V0TWVkaWFTZXRCeVR5cGUodGhpcy5fX21lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuX19nZXREZWZhdWx0U2VnbWVudExpc3QgPSBmdW5jdGlvbiBnZXREZWZhdWx0U2VnbWVudExpc3QoKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0ID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RzKClbMF07XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRCYW5kd2lkdGgoKSB7XG4gICAgaWYgKCFpc051bWJlcih0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkpIHsgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSB0aGlzLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkuZ2V0QmFuZHdpZHRoKCk7IH1cbiAgICByZXR1cm4gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGg7XG59O1xuXG4vKipcbiAqIFNldHMgdGhlIGN1cnJlbnQgYmFuZHdpZHRoLCB3aGljaCBjb3JyZXNwb25kcyB0byB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCAoaS5lLiB0aGUgc2VnbWVudCBsaXN0IGluIHRoZVxuICogbWVkaWEgc2V0IGZyb20gd2hpY2ggd2Ugc2hvdWxkIGJlIGRvd25sb2FkaW5nIHNlZ21lbnRzKS5cbiAqIEBwYXJhbSBiYW5kd2lkdGgge251bWJlcn1cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUuc2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIHNldEN1cnJlbnRCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgaWYgKCFpc051bWJlcihiYW5kd2lkdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIGV4cGVjdHMgYSBudW1lcmljIHZhbHVlIGZvciBiYW5kd2lkdGghJyk7XG4gICAgfVxuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgaWYgKGF2YWlsYWJsZUJhbmR3aWR0aHMuaW5kZXhPZihiYW5kd2lkdGgpIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBtdXN0IGJlIHNldCB0byBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXM6ICcgKyBhdmFpbGFibGVCYW5kd2lkdGhzLmpvaW4oJywgJykpO1xuICAgIH1cbiAgICBpZiAoYmFuZHdpZHRoID09PSB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkgeyByZXR1cm47IH1cbiAgICAvLyBUcmFjayB3aGVuIHdlJ3ZlIHN3aXRjaCBiYW5kd2lkdGhzLCBzaW5jZSB3ZSdsbCBuZWVkIHRvIChyZSlsb2FkIHRoZSBpbml0aWFsaXphdGlvbiBzZWdtZW50IGZvciB0aGUgc2VnbWVudCBsaXN0XG4gICAgLy8gd2hlbmV2ZXIgd2Ugc3dpdGNoIGJldHdlZW4gc2VnbWVudCBsaXN0cy4gVGhpcyBhbGxvd3MgU2VnbWVudExvYWRlciBpbnN0YW5jZXMgdG8gYXV0b21hdGljYWxseSBkbyB0aGlzLCBoaWRpbmcgdGhvc2VcbiAgICAvLyBkZXRhaWxzIGZyb20gdGhlIG91dHNpZGUuXG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gdHJ1ZTtcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IGJhbmR3aWR0aDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TGlzdCgpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSAgdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCh0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKSk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIHJldHVybiBhdmFpbGFibGVCYW5kd2lkdGhzO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTdGFydE51bWJlcigpIHtcbiAgICB2YXIgc3RhcnROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHN0YXJ0TnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnQgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudCgpIHtcbiAgICB2YXIgc2VnbWVudCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0U2VnbWVudEJ5TnVtYmVyKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TnVtYmVyKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudFN0YXJ0VGltZSA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50U3RhcnRUaW1lKCkgeyByZXR1cm4gdGhpcy5nZXRDdXJyZW50U2VnbWVudCgpLmdldFN0YXJ0TnVtYmVyKCk7IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEVuZE51bWJlciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBlbmROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdEVuZE51bWJlcigpO1xuICAgIHJldHVybiBlbmROdW1iZXI7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZXhpc3R5KHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUpID8gdGhpcy5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSA6IC0xO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TGFzdERvd25sb2FkQ29tcGxldGVUaW1lKCkgLSB0aGlzLmdldExhc3REb3dubG9hZFN0YXJ0VGltZSgpO1xufTtcblxuLyoqXG4gKlxuICogTWV0aG9kIGZvciBkb3dubG9hZGluZyB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgKHdoaWNoIGNvcnJlc3BvbmRzIHRvIHRoZVxuICogY3VycmVudGx5IHNldCBiYW5kd2lkdGgpXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRJbml0aWFsaXphdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLFxuICAgICAgICBpbml0aWFsaXphdGlvbiA9IHNlZ21lbnRMaXN0LmdldEluaXRpYWxpemF0aW9uKCk7XG5cbiAgICBpZiAoIWluaXRpYWxpemF0aW9uKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBpbml0aWFsaXphdGlvbiwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6aW5pdFNlZ21lbnR9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZE5leHRTZWdtZW50ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPSBleGlzdHkodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyKSxcbiAgICAgICAgbnVtYmVyID0gbm9DdXJyZW50U2VnbWVudE51bWJlciA/IHRoaXMuZ2V0U3RhcnROdW1iZXIoKSA6IHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciArIDE7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNlZ21lbnRBdE51bWJlcihudW1iZXIpO1xufTtcblxuLy8gVE9ETzogRHVwbGljYXRlIGNvZGUgYmVsb3cuIEFic3RyYWN0IGF3YXkuXG4vKipcbiAqXG4gKiBNZXRob2QgZm9yIGRvd25sb2FkaW5nIGEgc2VnbWVudCBmcm9tIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0IGJhc2VkIG9uIGl0cyBcIm51bWJlclwiIChzZWUgcGFyYW0gY29tbWVudCBiZWxvdylcbiAqXG4gKiBAcGFyYW0gbnVtYmVyIHtudW1iZXJ9ICAgSW5kZXgtbGlrZSB2YWx1ZSBmb3Igc3BlY2lmeWluZyB3aGljaCBzZWdtZW50IHRvIGxvYWQgZnJvbSB0aGUgc2VnbWVudCBsaXN0LlxuICogQHJldHVybnMge2Jvb2xlYW59XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRTZWdtZW50QXROdW1iZXIgPSBmdW5jdGlvbihudW1iZXIpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGlmIChudW1iZXIgPiB0aGlzLmdldEVuZE51bWJlcigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlOdW1iZXIobnVtYmVyKTtcblxuICAgIC8vIElmIHRoZSBiYW5kd2lkdGggaGFzIGNoYW5nZWQgc2luY2Ugb3VyIGxhc3QgZG93bmxvYWQsIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGNvcnJlc3BvbmRpbmdcbiAgICAvLyBzZWdtZW50IGxpc3QgYmVmb3JlIGRvd25sb2FkaW5nIHRoZSBkZXNpcmVkIHNlZ21lbnQpXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgLy8gRGlzcGF0Y2ggZXZlbnQgdGhhdCBwcm92aWRlcyBtZXRyaWNzIG9uIGRvd25sb2FkIHJvdW5kIHRyaXAgdGltZSAmIGJhbmR3aWR0aCBvZiBzZWdtZW50ICh1c2VkIHdpdGggQUJSIHN3aXRjaGluZyBsb2dpYylcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlZ21lbnREYXRhIH0pO1xuICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8qKlxuICpcbiAqIE1ldGhvZCBmb3IgZG93bmxvYWRpbmcgYSBzZWdtZW50IGZyb20gdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgYmFzZWQgb24gdGhlIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIHRoYXRcbiAqIGNvcnJlc3BvbmRzIHdpdGggYSBnaXZlbiBzZWdtZW50LlxuICpcbiAqIEBwYXJhbSBwcmVzZW50YXRpb25UaW1lIHtudW1iZXJ9IG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIGNvcnJlc3BvbmRpbmcgdG8gdGhlIHNlZ21lbnQgd2UnZCBsaWtlIHRvIGxvYWQgZnJvbSB0aGUgc2VnbWVudCBsaXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbihwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCk7XG5cbiAgICBpZiAocHJlc2VudGF0aW9uVGltZSA+IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBzZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIC8vIElmIHRoZSBiYW5kd2lkdGggaGFzIGNoYW5nZWQgc2luY2Ugb3VyIGxhc3QgZG93bmxvYWQsIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGNvcnJlc3BvbmRpbmdcbiAgICAvLyBzZWdtZW50IGxpc3QgYmVmb3JlIGRvd25sb2FkaW5nIHRoZSBkZXNpcmVkIHNlZ21lbnQpXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgLy8gRGlzcGF0Y2ggZXZlbnQgdGhhdCBwcm92aWRlcyBtZXRyaWNzIG9uIGRvd25sb2FkIHJvdW5kIHRyaXAgdGltZSAmIGJhbmR3aWR0aCBvZiBzZWdtZW50ICh1c2VkIHdpdGggQUJSIHN3aXRjaGluZyBsb2dpYylcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU2VnbWVudExvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKSB7XG4gICAgdmFyIGJhbmR3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgIGJhbmR3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0QmFuZHdpZHRoKCk7XG4gICAgcmV0dXJuIGJhbmR3aWR0aEEgLSBiYW5kd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciB3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICB3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0V2lkdGgoKSB8fCAwO1xuICAgIHJldHVybiB3aWR0aEEgLSB3aWR0aEI7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciByZXNvbHV0aW9uQ29tcGFyZSA9IGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbiAgICByZXR1cm4gKHJlc29sdXRpb25Db21wYXJlICE9PSAwKSA/IHJlc29sdXRpb25Db21wYXJlIDogY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0LCBtYXhXaWR0aCwgbWF4SGVpZ2h0KSB7XG4gICAgdmFyIHdpZHRoID0gc2VnbWVudExpc3QuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICBoZWlnaHQgPSBzZWdtZW50TGlzdC5nZXRIZWlnaHQoKSB8fCAwO1xuICAgIHJldHVybiAoKHdpZHRoIDw9IG1heFdpZHRoKSAmJiAoaGVpZ2h0IDw9IG1heEhlaWdodCkpO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbykge1xuICAgIHZhciBzZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBzZWdtZW50QmFuZHdpZHRoUmF0aW8gPSBzZWdtZW50TGlzdEJhbmR3aWR0aCAvIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcbiAgICByZXR1cm4gKGRvd25sb2FkUmF0ZVJhdGlvID49IHNlZ21lbnRCYW5kd2lkdGhSYXRpbyk7XG59XG5cbi8vIE5PVEU6IFBhc3NpbmcgaW4gbWVkaWFTZXQgaW5zdGVhZCBvZiBtZWRpYVNldCdzIFNlZ21lbnRMaXN0IEFycmF5IHNpbmNlIHNvcnQgaXMgZGVzdHJ1Y3RpdmUgYW5kIGRvbid0IHdhbnQgdG8gY2xvbmUuXG4vLyAgICAgIEFsc28gYWxsb3dzIGZvciBncmVhdGVyIGZsZXhpYmlsaXR5IG9mIGZuLlxuZnVuY3Rpb24gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpIHtcbiAgICB2YXIgZG93bmxvYWRSYXRlUmF0aW8gPSBkYXRhLmRvd25sb2FkUmF0ZVJhdGlvLFxuICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBkYXRhLmN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCxcbiAgICAgICAgd2lkdGggPSBkYXRhLndpZHRoLFxuICAgICAgICBoZWlnaHQgPSBkYXRhLmhlaWdodCxcbiAgICAgICAgc29ydGVkQnlCYW5kd2lkdGggPSBtZWRpYVNldC5nZXRTZWdtZW50TGlzdHMoKS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyksXG4gICAgICAgIHNvcnRlZEJ5UmVzb2x1dGlvblRoZW5CYW5kd2lkdGggPSBtZWRpYVNldC5nZXRTZWdtZW50TGlzdHMoKS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyksXG4gICAgICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUsXG4gICAgICAgIGZpbHRlcmVkQnlSZXNvbHV0aW9uLFxuICAgICAgICBwcm9wb3NlZFNlZ21lbnRMaXN0O1xuXG4gICAgZnVuY3Rpb24gZmlsdGVyQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0KSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJTZWdtZW50TGlzdHNCeVJlc29sdXRpb24oc2VnbWVudExpc3QsIHdpZHRoLCBoZWlnaHQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbHRlckJ5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0KSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbyk7XG4gICAgfVxuXG4gICAgZmlsdGVyZWRCeVJlc29sdXRpb24gPSBzb3J0ZWRCeVJlc29sdXRpb25UaGVuQmFuZHdpZHRoLmZpbHRlcihmaWx0ZXJCeVJlc29sdXRpb24pO1xuICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUgPSBzb3J0ZWRCeUJhbmR3aWR0aC5maWx0ZXIoZmlsdGVyQnlEb3dubG9hZFJhdGUpO1xuXG4gICAgcHJvcG9zZWRTZWdtZW50TGlzdCA9IGZpbHRlcmVkQnlSZXNvbHV0aW9uW2ZpbHRlcmVkQnlSZXNvbHV0aW9uLmxlbmd0aCAtIDFdIHx8IGZpbHRlcmVkQnlEb3dubG9hZFJhdGVbZmlsdGVyZWRCeURvd25sb2FkUmF0ZS5sZW5ndGggLSAxXSB8fCBzb3J0ZWRCeUJhbmR3aWR0aFswXTtcblxuICAgIHJldHVybiBwcm9wb3NlZFNlZ21lbnRMaXN0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHNlbGVjdFNlZ21lbnRMaXN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgaXNOdW1iZXIgPSByZXF1aXJlKCcuLi91dGlsL2lzTnVtYmVyLmpzJyksXG4gICAgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZVRpbWVSYW5nZU9iamVjdChzb3VyY2VCdWZmZXIsIGluZGV4LCB0cmFuc2Zvcm1Gbikge1xuICAgIGlmICghaXNGdW5jdGlvbih0cmFuc2Zvcm1GbikpIHtcbiAgICAgICAgdHJhbnNmb3JtRm4gPSBmdW5jdGlvbih0aW1lKSB7IHJldHVybiB0aW1lOyB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIGdldFN0YXJ0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRyYW5zZm9ybUZuKHNvdXJjZUJ1ZmZlci5idWZmZXJlZC5zdGFydChpbmRleCkpOyB9LFxuICAgICAgICBnZXRFbmQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdHJhbnNmb3JtRm4oc291cmNlQnVmZmVyLmJ1ZmZlcmVkLmVuZChpbmRleCkpOyB9LFxuICAgICAgICBnZXRJbmRleDogZnVuY3Rpb24oKSB7IHJldHVybiBpbmRleDsgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1ZmZlcmVkVGltZVJhbmdlTGlzdChzb3VyY2VCdWZmZXIsIHRyYW5zZm9ybUZuKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0TGVuZ3RoOiBmdW5jdGlvbigpIHsgcmV0dXJuIHNvdXJjZUJ1ZmZlci5idWZmZXJlZC5sZW5ndGg7IH0sXG4gICAgICAgIGdldFRpbWVSYW5nZUJ5SW5kZXg6IGZ1bmN0aW9uKGluZGV4KSB7IHJldHVybiBjcmVhdGVUaW1lUmFuZ2VPYmplY3Qoc291cmNlQnVmZmVyLCBpbmRleCwgdHJhbnNmb3JtRm4pOyB9LFxuICAgICAgICBnZXRUaW1lUmFuZ2VCeVRpbWU6IGZ1bmN0aW9uKHRpbWUsIHRvbGVyYW5jZSkge1xuICAgICAgICAgICAgaWYgKCFpc051bWJlcih0b2xlcmFuY2UpKSB7IHRvbGVyYW5jZSA9IDAuMTU7IH1cbiAgICAgICAgICAgIHZhciB0aW1lUmFuZ2VPYmosXG4gICAgICAgICAgICAgICAgaSxcbiAgICAgICAgICAgICAgICBsZW5ndGggPSBzb3VyY2VCdWZmZXIuYnVmZmVyZWQubGVuZ3RoO1xuXG4gICAgICAgICAgICBmb3IgKGk9MDsgaTxsZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHRpbWVSYW5nZU9iaiA9IGNyZWF0ZVRpbWVSYW5nZU9iamVjdChzb3VyY2VCdWZmZXIsIGksIHRyYW5zZm9ybUZuKTtcbiAgICAgICAgICAgICAgICBpZiAoKHRpbWVSYW5nZU9iai5nZXRTdGFydCgpIC0gdG9sZXJhbmNlKSA+IHRpbWUpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgICAgICAgICBpZiAoKHRpbWVSYW5nZU9iai5nZXRFbmQoKSArIHRvbGVyYW5jZSkgPiB0aW1lKSB7IHJldHVybiB0aW1lUmFuZ2VPYmo7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVBbGlnbmVkQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHNvdXJjZUJ1ZmZlciwgc2VnbWVudER1cmF0aW9uKSB7XG4gICAgZnVuY3Rpb24gdGltZUFsaWduVHJhbnNmb3JtRm4odGltZSkge1xuICAgICAgICByZXR1cm4gTWF0aC5yb3VuZCh0aW1lIC8gc2VnbWVudER1cmF0aW9uKSAqIHNlZ21lbnREdXJhdGlvbjtcbiAgICB9XG5cbiAgICByZXR1cm4gY3JlYXRlQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHNvdXJjZUJ1ZmZlciwgdGltZUFsaWduVHJhbnNmb3JtRm4pO1xufVxuXG4vKipcbiAqIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSBhZGRzL3F1ZXVlcyBzZWdtZW50cyB0byB0aGUgY29ycmVzcG9uZGluZyBNU0UgU291cmNlQnVmZmVyIChOT1RFOiBUaGVyZSBzaG91bGQgYmUgb25lIHBlciBtZWRpYSB0eXBlL21lZGlhIHNldClcbiAqXG4gKiBAcGFyYW0gc291cmNlQnVmZmVyIHtTb3VyY2VCdWZmZXJ9ICAgTVNFIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpIHtcbiAgICAvLyBUT0RPOiBDaGVjayB0eXBlP1xuICAgIGlmICghc291cmNlQnVmZmVyKSB7IHRocm93IG5ldyBFcnJvciggJ1RoZSBzb3VyY2VCdWZmZXIgY29uc3RydWN0b3IgYXJndW1lbnQgY2Fubm90IGJlIG51bGwuJyApOyB9XG5cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGRhdGFRdWV1ZSA9IFtdO1xuICAgIC8vIFRPRE86IGZpZ3VyZSBvdXQgaG93IHdlIHdhbnQgdG8gcmVzcG9uZCB0byBvdGhlciBldmVudCBzdGF0ZXMgKHVwZGF0ZWVuZD8gZXJyb3I/IGFib3J0PykgKHJldHJ5PyByZW1vdmU/KVxuICAgIHNvdXJjZUJ1ZmZlci5hZGRFdmVudExpc3RlbmVyKCd1cGRhdGVlbmQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAvLyBUaGUgU291cmNlQnVmZmVyIGluc3RhbmNlJ3MgdXBkYXRpbmcgcHJvcGVydHkgc2hvdWxkIGFsd2F5cyBiZSBmYWxzZSBpZiB0aGlzIGV2ZW50IHdhcyBkaXNwYXRjaGVkLFxuICAgICAgICAvLyBidXQganVzdCBpbiBjYXNlLi4uXG4gICAgICAgIGlmIChldmVudC50YXJnZXQudXBkYXRpbmcpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0FEREVEX1RPX0JVRkZFUiwgdGFyZ2V0OnNlbGYgfSk7XG5cbiAgICAgICAgaWYgKHNlbGYuX19kYXRhUXVldWUubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUVVFVUVfRU1QVFksIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5fX3NvdXJjZUJ1ZmZlci5hcHBlbmRCdWZmZXIoc2VsZi5fX2RhdGFRdWV1ZS5zaGlmdCgpKTtcbiAgICB9KTtcblxuICAgIHRoaXMuX19kYXRhUXVldWUgPSBkYXRhUXVldWU7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlciA9IHNvdXJjZUJ1ZmZlcjtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFFVRVVFX0VNUFRZOiAncXVldWVFbXB0eScsXG4gICAgU0VHTUVOVF9BRERFRF9UT19CVUZGRVI6ICdzZWdtZW50QWRkZWRUb0J1ZmZlcidcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuYWRkVG9RdWV1ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgZGF0YVRvQWRkSW1tZWRpYXRlbHk7XG4gICAgaWYgKCFleGlzdHkoZGF0YSkgfHwgKGlzQXJyYXkoZGF0YSkgJiYgZGF0YS5sZW5ndGggPD0gMCkpIHsgcmV0dXJuOyB9XG4gICAgLy8gVHJlYXQgYWxsIGRhdGEgYXMgYXJyYXlzIHRvIG1ha2Ugc3Vic2VxdWVudCBmdW5jdGlvbmFsaXR5IGdlbmVyaWMuXG4gICAgaWYgKCFpc0FycmF5KGRhdGEpKSB7IGRhdGEgPSBbZGF0YV07IH1cbiAgICAvLyBJZiBub3RoaW5nIGlzIGluIHRoZSBxdWV1ZSwgZ28gYWhlYWQgYW5kIGltbWVkaWF0ZWx5IGFwcGVuZCB0aGUgZmlyc3QgZGF0YSB0byB0aGUgc291cmNlIGJ1ZmZlci5cbiAgICBpZiAoKHRoaXMuX19kYXRhUXVldWUubGVuZ3RoID09PSAwKSAmJiAoIXRoaXMuX19zb3VyY2VCdWZmZXIudXBkYXRpbmcpKSB7IGRhdGFUb0FkZEltbWVkaWF0ZWx5ID0gZGF0YS5zaGlmdCgpOyB9XG4gICAgLy8gSWYgYW55IG90aGVyIGRhdGEgKHN0aWxsKSBleGlzdHMsIHB1c2ggdGhlIHJlc3Qgb250byB0aGUgZGF0YVF1ZXVlLlxuICAgIHRoaXMuX19kYXRhUXVldWUgPSB0aGlzLl9fZGF0YVF1ZXVlLmNvbmNhdChkYXRhKTtcbiAgICBpZiAoZXhpc3R5KGRhdGFUb0FkZEltbWVkaWF0ZWx5KSkgeyB0aGlzLl9fc291cmNlQnVmZmVyLmFwcGVuZEJ1ZmZlcihkYXRhVG9BZGRJbW1lZGlhdGVseSk7IH1cbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuY2xlYXJRdWV1ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX19kYXRhUXVldWUgPSBbXTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZ2V0QnVmZmVyZWRUaW1lUmFuZ2VMaXN0ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcmVkVGltZVJhbmdlTGlzdCh0aGlzLl9fc291cmNlQnVmZmVyKTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZ2V0QnVmZmVyZWRUaW1lUmFuZ2VMaXN0QWxpZ25lZFRvU2VnbWVudER1cmF0aW9uID0gZnVuY3Rpb24oc2VnbWVudER1cmF0aW9uKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUFsaWduZWRCdWZmZXJlZFRpbWVSYW5nZUxpc3QodGhpcy5fX3NvdXJjZUJ1ZmZlciwgc2VnbWVudER1cmF0aW9uKTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VCdWZmZXJEYXRhUXVldWU7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4gKHggIT09IG51bGwpICYmICh4ICE9PSB1bmRlZmluZWQpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gZXhpc3R5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gRXh0ZW5kIGEgZ2l2ZW4gb2JqZWN0IHdpdGggYWxsIHRoZSBwcm9wZXJ0aWVzIChhbmQgdGhlaXIgdmFsdWVzKSBmb3VuZCBpbiB0aGUgcGFzc2VkLWluIG9iamVjdChzKS5cbnZhciBleHRlbmRPYmplY3QgPSBmdW5jdGlvbihvYmogLyosIGV4dGVuZE9iamVjdDEsIGV4dGVuZE9iamVjdDIsIC4uLiwgZXh0ZW5kT2JqZWN0TiAqLykge1xuICAgIHZhciBleHRlbmRPYmplY3RzQXJyYXkgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICBpLFxuICAgICAgICBsZW5ndGggPSBleHRlbmRPYmplY3RzQXJyYXkubGVuZ3RoLFxuICAgICAgICBleHRlbmRPYmplY3Q7XG5cbiAgICBmb3IoaT0wOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGV4dGVuZE9iamVjdCA9IGV4dGVuZE9iamVjdHNBcnJheVtpXTtcbiAgICAgICAgaWYgKGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgICAgICBvYmpbcHJvcF0gPSBleHRlbmRPYmplY3RbcHJvcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRPYmplY3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzQXJyYXkob2JqKSB7XG4gICAgcmV0dXJuIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzRnVuY3Rpb24gPSBmdW5jdGlvbiBpc0Z1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcbn07XG4vLyBmYWxsYmFjayBmb3Igb2xkZXIgdmVyc2lvbnMgb2YgQ2hyb21lIGFuZCBTYWZhcmlcbmlmIChpc0Z1bmN0aW9uKC94LykpIHtcbiAgICBpc0Z1bmN0aW9uID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXSc7XG4gICAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0Z1bmN0aW9uOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc051bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBOdW1iZXJdJyB8fCBmYWxzZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc051bWJlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgU3RyaW5nXScgfHwgZmFsc2U7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzU3RyaW5nOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vZXhpc3R5LmpzJyk7XG5cbi8vIE5PVEU6IFRoaXMgdmVyc2lvbiBvZiB0cnV0aHkgYWxsb3dzIG1vcmUgdmFsdWVzIHRvIGNvdW50XG4vLyBhcyBcInRydWVcIiB0aGFuIHN0YW5kYXJkIEpTIEJvb2xlYW4gb3BlcmF0b3IgY29tcGFyaXNvbnMuXG4vLyBTcGVjaWZpY2FsbHksIHRydXRoeSgpIHdpbGwgcmV0dXJuIHRydWUgZm9yIHRoZSB2YWx1ZXNcbi8vIDAsIFwiXCIsIGFuZCBOYU4sIHdoZXJlYXMgSlMgd291bGQgdHJlYXQgdGhlc2UgYXMgXCJmYWxzeVwiIHZhbHVlcy5cbmZ1bmN0aW9uIHRydXRoeSh4KSB7IHJldHVybiAoeCAhPT0gZmFsc2UpICYmIGV4aXN0eSh4KTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IHRydXRoeTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIFRPRE86IFJlZmFjdG9yIHRvIHNlcGFyYXRlIGpzIGZpbGVzICYgbW9kdWxlcyAmIHJlbW92ZSBmcm9tIGhlcmUuXG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuL3V0aWwvaXNTdHJpbmcuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbmZ1bmN0aW9uIHByZUFwcGx5QXJnc0ZuKGZ1biAvKiwgYXJncyAqLykge1xuICAgIHZhciBwcmVBcHBsaWVkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgLy8gTk9URTogdGhlICp0aGlzKiByZWZlcmVuY2Ugd2lsbCByZWZlciB0byB0aGUgY2xvc3VyZSdzIGNvbnRleHQgdW5sZXNzXG4gICAgLy8gdGhlIHJldHVybmVkIGZ1bmN0aW9uIGlzIGl0c2VsZiBjYWxsZWQgdmlhIC5jYWxsKCkgb3IgLmFwcGx5KCkuIElmIHlvdVxuICAgIC8vICpuZWVkKiB0byByZWZlciB0byBpbnN0YW5jZS1sZXZlbCBwcm9wZXJ0aWVzLCBkbyBzb21ldGhpbmcgbGlrZSB0aGUgZm9sbG93aW5nOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBmdW5jdGlvbihhcmdDKSB7IHByZUFwcGx5QXJnc0ZuKHNvbWVPdGhlckZuLCBhcmdBLCBhcmdCLCAuLi4gYXJnTikuY2FsbCh0aGlzKTsgfTtcbiAgICAvL1xuICAgIC8vIE90aGVyd2lzZSwgeW91IHNob3VsZCBiZSBhYmxlIHRvIGp1c3QgY2FsbDpcbiAgICAvL1xuICAgIC8vIE15VHlwZS5wcm90b3R5cGUuc29tZUZuID0gcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKTtcbiAgICAvL1xuICAgIC8vIFdoZXJlIHBvc3NpYmxlLCBmdW5jdGlvbnMgYW5kIG1ldGhvZHMgc2hvdWxkIG5vdCBiZSByZWFjaGluZyBvdXQgdG8gZ2xvYmFsIHNjb3BlIGFueXdheSwgc28uLi5cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7IHJldHVybiBmdW4uYXBwbHkodGhpcywgcHJlQXBwbGllZEFyZ3MpOyB9O1xufVxuXG4vLyBIaWdoZXItb3JkZXIgWE1MIGZ1bmN0aW9uc1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHNcbnZhciBnZXRBbmNlc3RvcnMgPSBmdW5jdGlvbihlbGVtLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIHZhciBhbmNlc3RvcnMgPSBbXTtcbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIChmdW5jdGlvbiBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0sIGFuY2VzdG9ycykpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmIChleGlzdHkoZWxlbSkgJiYgZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHtcbiAgICAgICAgICAgIGFuY2VzdG9ycy5wdXNoKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgICAgICBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH0pKGVsZW0pO1xuICAgIHJldHVybiBhbmNlc3RvcnM7XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0Tm9kZUxpc3RCeU5hbWUgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHhtbE9iaikge1xuICAgICAgICByZXR1cm4geG1sT2JqLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSwgdmFsdWUpIHtcbiAgICBpZiAoKHR5cGVvZiBhdHRyTmFtZSAhPT0gJ3N0cmluZycpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICAgIGlmICghZXhpc3R5KHZhbHVlKSkgeyByZXR1cm4gZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIHJldHVybiAoZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpID09PSB2YWx1ZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRBdHRyRm4gPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICghaXNTdHJpbmcoYXR0ck5hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhaXNGdW5jdGlvbihlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG4vLyBUT0RPOiBBZGQgc2hvdWxkU3RvcFByZWQgKHNob3VsZCBmdW5jdGlvbiBzaW1pbGFybHkgdG8gc2hvdWxkU3RvcFByZWQgaW4gZ2V0SW5oZXJpdGFibGVFbGVtZW50LCBiZWxvdylcbnZhciBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcoYXR0ck5hbWUpKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSkpIHsgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHM7IFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBmdW5jdGlvbihub2RlTmFtZSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhub2RlTmFtZSkpIHx8IG5vZGVOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICB2YXIgbWF0Y2hpbmdFbGVtTGlzdCA9IGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUobm9kZU5hbWUpO1xuICAgICAgICBpZiAoZXhpc3R5KG1hdGNoaW5nRWxlbUxpc3QpICYmIG1hdGNoaW5nRWxlbUxpc3QubGVuZ3RoID4gMCkgeyByZXR1cm4gbWF0Y2hpbmdFbGVtTGlzdFswXTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxudmFyIGdldENoaWxkRWxlbWVudEJ5Tm9kZU5hbWUgPSBmdW5jdGlvbihub2RlTmFtZSkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhaXNGdW5jdGlvbihlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBpbml0aWFsTWF0Y2hlcyA9IGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUobm9kZU5hbWUpLFxuICAgICAgICAgICAgY3VycmVudEVsZW07XG4gICAgICAgIGlmICghZXhpc3R5KGluaXRpYWxNYXRjaGVzKSB8fCBpbml0aWFsTWF0Y2hlcy5sZW5ndGggPD0gMCkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGN1cnJlbnRFbGVtID0gaW5pdGlhbE1hdGNoZXNbMF07XG4gICAgICAgIHJldHVybiAoY3VycmVudEVsZW0ucGFyZW50Tm9kZSA9PT0gZWxlbSkgPyBjdXJyZW50RWxlbSA6IHVuZGVmaW5lZDtcbiAgICB9O1xufTtcblxudmFyIGdldE11bHRpTGV2ZWxFbGVtZW50TGlzdCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHZhciBnZXRNYXRjaGluZ0NoaWxkTm9kZUZuID0gZ2V0Q2hpbGRFbGVtZW50QnlOb2RlTmFtZShub2RlTmFtZSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgdmFyIGN1cnJlbnRFbGVtID0gZWxlbSxcbiAgICAgICAgICAgIG11bHRpTGV2ZWxFbGVtTGlzdCA9IFtdLFxuICAgICAgICAgICAgbWF0Y2hpbmdFbGVtO1xuICAgICAgICAvLyBUT0RPOiBSZXBsYWNlIHcvcmVjdXJzaXZlIGZuP1xuICAgICAgICB3aGlsZSAoZXhpc3R5KGN1cnJlbnRFbGVtKSAmJiAhc2hvdWxkU3RvcFByZWQoY3VycmVudEVsZW0pKSB7XG4gICAgICAgICAgICBtYXRjaGluZ0VsZW0gPSBnZXRNYXRjaGluZ0NoaWxkTm9kZUZuKGN1cnJlbnRFbGVtKTtcbiAgICAgICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtKSkgeyBtdWx0aUxldmVsRWxlbUxpc3QucHVzaChtYXRjaGluZ0VsZW0pOyB9XG4gICAgICAgICAgICBjdXJyZW50RWxlbSA9IGN1cnJlbnRFbGVtLnBhcmVudE5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbXVsdGlMZXZlbEVsZW1MaXN0Lmxlbmd0aCA+IDAgPyBtdWx0aUxldmVsRWxlbUxpc3QgOiB1bmRlZmluZWQ7XG4gICAgfTtcbn07XG5cbi8vIFRPRE86IEltcGxlbWVudCBtZSBmb3IgQmFzZVVSTCBvciB1c2UgZXhpc3RpbmcgZm4gKFNlZTogbXBkLmpzIGJ1aWxkQmFzZVVybCgpKVxuLyp2YXIgYnVpbGRIaWVyYXJjaGljYWxseVN0cnVjdHVyZWRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlRm4sIGJ1aWxkRm4sIHN0b3BQcmVkKSB7XG5cbn07Ki9cblxuLy8gUHVibGlzaCBFeHRlcm5hbCBBUEk6XG52YXIgeG1sZnVuID0ge307XG54bWxmdW4uZXhpc3R5ID0gZXhpc3R5O1xueG1sZnVuLnRydXRoeSA9IHRydXRoeTtcblxueG1sZnVuLmdldE5vZGVMaXN0QnlOYW1lID0gZ2V0Tm9kZUxpc3RCeU5hbWU7XG54bWxmdW4uaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBoYXNNYXRjaGluZ0F0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGdldEluaGVyaXRhYmxlQXR0cmlidXRlO1xueG1sZnVuLmdldEFuY2VzdG9ycyA9IGdldEFuY2VzdG9ycztcbnhtbGZ1bi5nZXRBdHRyRm4gPSBnZXRBdHRyRm47XG54bWxmdW4ucHJlQXBwbHlBcmdzRm4gPSBwcmVBcHBseUFyZ3NGbjtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBnZXRJbmhlcml0YWJsZUVsZW1lbnQ7XG54bWxmdW4uZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0ID0gZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHhtbGZ1bjsiXX0=
