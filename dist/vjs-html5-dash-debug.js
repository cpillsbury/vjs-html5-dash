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
    var self = this;

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
        this.one(this.eventList.RECHECK_SEGMENT_LOADING, function(event) {
            self.__tech.setCurrentTime(self.__sourceBufferDataQueue.getBufferedTimeRangeList().getTimeRangeByIndex(0).getStart());
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
            console.log('segmentDownloadDelay: ' + segmentDownloadDelay);
            setTimeout(function() {
                segmentToDownload = self.getNextSegmentToLoad(currentTime, currentSegmentList, timeRangeList);
                downloadPoint = segmentToDownload.getStartTime();
                console.log('downloadPoint: ' + downloadPoint);
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
        console.log('SUCCESSFUL LOADING!');
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            // Once we've completed downloading and buffering the segment, dispatch event to notify that we should recheck
            // whether or not we should load another segment and, if so, which. (See: __checkSegmentLoading() method, above)
            self.trigger({ type:self.eventList.RECHECK_SEGMENT_LOADING, target:self });
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    return hasNextSegment;
};

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
getAncestorObjectByName = function(xmlNode, tagName, mapFn) {
    if (!tagName || !xmlNode || !xmlNode.parentNode) { return null; }
    if (!xmlNode.parentNode.hasOwnProperty('nodeName')) { return null; }

    if (xmlNode.parentNode.nodeName === tagName) {
        return (typeof mapFn === 'function') ? mapFn(xmlNode.parentNode) : xmlNode.parentNode;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0VkE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNySEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsImlmICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSB3aW5kb3c7XG59IGVsc2UgaWYgKHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGdsb2JhbDtcbn0gZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIpe1xuICAgIG1vZHVsZS5leHBvcnRzID0gc2VsZjtcbn0gZWxzZSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSB7fTtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIC8vIFRPRE86IERldGVybWluZSBhcHByb3ByaWF0ZSBkZWZhdWx0IHNpemUgKG9yIGJhc2Ugb24gc2VnbWVudCBuIHggc2l6ZS9kdXJhdGlvbj8pXG4gICAgLy8gTXVzdCBjb25zaWRlciBBQlIgU3dpdGNoaW5nICYgVmlld2luZyBleHBlcmllbmNlIG9mIGFscmVhZHktYnVmZmVyZWQgc2VnbWVudHMuXG4gICAgTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUgPSAyMCxcbiAgICBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSA9IDQwO1xuXG5mdW5jdGlvbiBoYXNWYWx1ZShvYmplY3QsIHZhbHVlKSB7XG4gICAgaWYgKCFleGlzdHkob2JqZWN0KSB8fCAhZXhpc3R5KHZhbHVlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICBmb3IgKHZhciBwcm9wIGluIG9iamVjdCkge1xuICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KHByb3ApICYmIChvYmplY3RbcHJvcF0gPT09IHZhbHVlKSkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICpcbiAqIE1lZGlhVHlwZUxvYWRlciBjb29yZGluYXRlcyBiZXR3ZWVuIHNlZ21lbnQgZG93bmxvYWRpbmcgYW5kIGFkZGluZyBzZWdtZW50cyB0byB0aGUgTVNFIHNvdXJjZSBidWZmZXIgZm9yIGEgZ2l2ZW4gbWVkaWEgdHlwZSAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpLlxuICpcbiAqIEBwYXJhbSBzZWdtZW50TG9hZGVyIHtTZWdtZW50TG9hZGVyfSAgICAgICAgICAgICAgICAgb2JqZWN0IGluc3RhbmNlIHRoYXQgaGFuZGxlcyBkb3dubG9hZGluZyBzZWdtZW50cyBmb3IgdGhlIG1lZGlhIHNldFxuICogQHBhcmFtIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSB7U291cmNlQnVmZmVyRGF0YVF1ZXVlfSBvYmplY3QgaW5zdGFuY2UgdGhhdCBoYW5kbGVzIGFkZGluZyBzZWdtZW50cyB0byBNU0UgU291cmNlQnVmZmVyXG4gKiBAcGFyYW0gbWVkaWFUeXBlIHtzdHJpbmd9ICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIG1lZGlhIHR5cGUgKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKSBmb3IgdGhlIG1lZGlhIHNldFxuICogQHBhcmFtIHRlY2gge29iamVjdH0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIGluc3RhbmNlLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIE1lZGlhVHlwZUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSwgdGVjaCkge1xuICAgIHRoaXMuX19zZWdtZW50TG9hZGVyID0gc2VnbWVudExvYWRlcjtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUkVDSEVDS19TRUdNRU5UX0xPQURJTkc6ICdyZWNoZWNrU2VnbWVudExvYWRpbmcnLFxuICAgIFJFQ0hFQ0tfQ1VSUkVOVF9TRUdNRU5UX0xJU1Q6ICdyZWNoZWNrQ3VycmVudFNlZ21lbnRMaXN0JyxcbiAgICBMT0FEX1NUQVRFX0NIQU5HRUQ6ICdsb2FkU3RhdGVDaGFuZ2VkJ1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5sb2FkU3RhdGVzID0ge1xuICAgIE5PVF9MT0FESU5HOiAtMTAsXG4gICAgV0FJVElOR19UT19DSEVDSzogMCxcbiAgICBDSEVDS0lOR19TVEFSVEVEOiAxMCxcbiAgICBXQUlUSU5HX1RPX0RPV05MT0FEOiAyMCxcbiAgICBET1dOTE9BRF9TVEFSVEVEOiAzMCxcbiAgICBBRERfVE9fQlVGRkVSX1NUQVJURUQ6IDQwLFxuICAgIExPQURJTkdfQ09NUExFVEU6IDUwXG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldExvYWRTdGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fbG9hZFN0YXRlO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zZXRMb2FkU3RhdGUgPSBmdW5jdGlvbihsb2FkU3RhdGUpIHtcbiAgICBpZiAobG9hZFN0YXRlID09PSB0aGlzLl9fbG9hZFN0YXRlIHx8ICFoYXNWYWx1ZSh0aGlzLmxvYWRTdGF0ZXMsIGxvYWRTdGF0ZSkpIHsgcmV0dXJuOyB9XG4gICAgdGhpcy5fX2xvYWRTdGF0ZSA9IGxvYWRTdGF0ZTtcbiAgICB0aGlzLnRyaWdnZXIoeyB0eXBlOnRoaXMuZXZlbnRMaXN0LkxPQURfU1RBVEVfQ0hBTkdFRCwgdGFyZ2V0OnRoaXMsIGRhdGE6bG9hZFN0YXRlIH0pO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19tZWRpYVR5cGU7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U2VnbWVudExvYWRlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXI7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlOyB9O1xuXG4vKipcbiAqIEtpY2tzIG9mZiBzZWdtZW50IGxvYWRpbmcgZm9yIHRoZSBtZWRpYSBzZXRcbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdGFydExvYWRpbmdTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3RhcnRMb2FkaW5nU2VnbWVudHNGb3JTdGF0aWNQbGF5bGlzdCgpO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdGFydExvYWRpbmdTZWdtZW50c0ZvclN0YXRpY1BsYXlsaXN0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gRXZlbnQgbGlzdGVuZXIgZm9yIHJlY2hlY2tpbmcgc2VnbWVudCBsb2FkaW5nLiBUaGlzIGV2ZW50IGlzIGZpcmVkIHdoZW5ldmVyIGEgc2VnbWVudCBoYXMgYmVlbiBzdWNjZXNzZnVsbHlcbiAgICAvLyBkb3dubG9hZGVkIGFuZCBhZGRlZCB0byB0aGUgYnVmZmVyIG9yLCBpZiBub3QgY3VycmVudGx5IGxvYWRpbmcgc2VnbWVudHMgKGJlY2F1c2UgdGhlIGJ1ZmZlciBpcyBzdWZmaWNpZW50bHkgZnVsbFxuICAgIC8vIHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHBsYXliYWNrIHRpbWUpLCB3aGVuZXZlciBzb21lIGFtb3VudCBvZiB0aW1lIGhhcyBlbGFwc2VkIGFuZCB3ZSBzaG91bGQgY2hlY2sgb24gdGhlIGJ1ZmZlclxuICAgIC8vIHN0YXRlIGFnYWluLlxuICAgIC8vIE5PVEU6IFN0b3JlIGEgcmVmZXJlbmNlIHRvIHRoZSBldmVudCBoYW5kbGVyIHRvIHBvdGVudGlhbGx5IHJlbW92ZSBpdCBsYXRlci5cbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19DVVJSRU5UX1NFR01FTlRfTElTVCwgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIHNlbGYuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG4gICAgfTtcblxuICAgIHRoaXMub24odGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcblxuICAgIGlmICh0aGlzLl9fc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRJc0xpdmUoKSkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHNlbGYuX190ZWNoLnNldEN1cnJlbnRUaW1lKHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUuZ2V0QnVmZmVyZWRUaW1lUmFuZ2VMaXN0KCkuZ2V0VGltZVJhbmdlQnlJbmRleCgwKS5nZXRTdGFydCgpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gTWFudWFsbHkgY2hlY2sgb24gbG9hZGluZyBzZWdtZW50cyB0aGUgZmlyc3QgdGltZSBhcm91bmQuXG4gICAgdGhpcy5fX2NoZWNrU2VnbWVudExvYWRpbmcoTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUsIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFKTtcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuc3RvcExvYWRpbmdTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghZXhpc3R5KHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKSkgeyByZXR1cm47IH1cblxuICAgIHRoaXMub2ZmKHRoaXMuZXZlbnRMaXN0LlJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HLCB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcik7XG4gICAgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIgPSB1bmRlZmluZWQ7XG59O1xuXG4vKipcbiAqXG4gKiBAcGFyYW0gbWluRGVzaXJlZEJ1ZmZlclNpemUge251bWJlcn0gVGhlIHN0aXB1bGF0ZWQgbWluaW11bSBhbW91bnQgb2YgdGltZSAoaW4gc2Vjb25kcykgd2Ugd2FudCBpbiB0aGUgcGxheWJhY2sgYnVmZmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHBsYXliYWNrIHRpbWUpIGZvciB0aGUgbWVkaWEgdHlwZS5cbiAqIEBwYXJhbSBtYXhEZXNpcmVkQnVmZmVyU2l6ZSB7bnVtYmVyfSBUaGUgc3RpcHVsYXRlZCBtYXhpbXVtIGFtb3VudCBvZiB0aW1lIChpbiBzZWNvbmRzKSB3ZSB3YW50IGluIHRoZSBwbGF5YmFjayBidWZmZXJcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcGxheWJhY2sgdGltZSkgZm9yIHRoZSBtZWRpYSB0eXBlLlxuICogQHByaXZhdGVcbiAqL1xuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5fX2NoZWNrU2VnbWVudExvYWRpbmcgPSBmdW5jdGlvbihtaW5EZXNpcmVkQnVmZmVyU2l6ZSwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAvLyBUT0RPOiBVc2Ugc2VnbWVudCBkdXJhdGlvbiB3aXRoIGN1cnJlbnRUaW1lICYgY3VycmVudEJ1ZmZlclNpemUgdG8gY2FsY3VsYXRlIHdoaWNoIHNlZ21lbnQgdG8gZ3JhYiB0byBhdm9pZCBlZGdlIGNhc2VzIHcvcm91bmRpbmcgJiBwcmVjaXNpb25cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHRlY2ggPSBzZWxmLl9fdGVjaCxcbiAgICAgICAgc2VnbWVudExvYWRlciA9IHNlbGYuX19zZWdtZW50TG9hZGVyLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLFxuICAgICAgICBjdXJyZW50VGltZSA9IHRlY2guY3VycmVudFRpbWUoKSxcbiAgICAgICAgY3VycmVudEJ1ZmZlclNpemUsXG4gICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdCA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCksXG4gICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IGN1cnJlbnRTZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IGN1cnJlbnRTZWdtZW50TGlzdC5nZXRUb3RhbER1cmF0aW9uKCksXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSxcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXksXG4gICAgICAgIHRpbWVSYW5nZUxpc3QgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWUuZ2V0QnVmZmVyZWRUaW1lUmFuZ2VMaXN0QWxpZ25lZFRvU2VnbWVudER1cmF0aW9uKHNlZ21lbnREdXJhdGlvbiksXG4gICAgICAgIHNlZ21lbnRUb0Rvd25sb2FkID0gc2VsZi5nZXROZXh0U2VnbWVudFRvTG9hZChjdXJyZW50VGltZSwgY3VycmVudFNlZ21lbnRMaXN0LCB0aW1lUmFuZ2VMaXN0KSxcbiAgICAgICAgZG93bmxvYWRQb2ludCA9IHNlZ21lbnRUb0Rvd25sb2FkLmdldFN0YXJ0VGltZSgpO1xuXG4gICAgY3VycmVudEJ1ZmZlclNpemUgPSBleGlzdHkodGltZVJhbmdlTGlzdCkgJiYgdGltZVJhbmdlTGlzdC5nZXRMZW5ndGgoKSA+IDAgPyBkb3dubG9hZFBvaW50IC0gY3VycmVudFRpbWUgOiAwO1xuXG4gICAgLy8gVE9ETzogVWdseSBzZXBhcmF0aW9uIG9mIGxpdmUgdnMuIFZPRC4gUmVmYWN0b3IuXG4gICAgaWYgKGN1cnJlbnRTZWdtZW50TGlzdC5nZXRJc0xpdmUoKSkge1xuICAgICAgICBpZiAoZXhpc3R5KHRpbWVSYW5nZUxpc3QpICYmIHRpbWVSYW5nZUxpc3QuZ2V0TGVuZ3RoKCkgPD0gMCkge1xuICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lID0gc2VnbWVudExvYWRlci5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpO1xuICAgICAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXkgPSBzZWdtZW50RHVyYXRpb24gLSBkb3dubG9hZFJvdW5kVHJpcFRpbWU7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnc2VnbWVudERvd25sb2FkRGVsYXk6ICcgKyBzZWdtZW50RG93bmxvYWREZWxheSk7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHNlZ21lbnRUb0Rvd25sb2FkID0gc2VsZi5nZXROZXh0U2VnbWVudFRvTG9hZChjdXJyZW50VGltZSwgY3VycmVudFNlZ21lbnRMaXN0LCB0aW1lUmFuZ2VMaXN0KTtcbiAgICAgICAgICAgICAgICBkb3dubG9hZFBvaW50ID0gc2VnbWVudFRvRG93bmxvYWQuZ2V0U3RhcnRUaW1lKCk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ2Rvd25sb2FkUG9pbnQ6ICcgKyBkb3dubG9hZFBvaW50KTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBMb2NhbCBmdW5jdGlvbiB1c2VkIHRvIG5vdGlmeSB0aGF0IHdlIHNob3VsZCByZWNoZWNrIHNlZ21lbnQgbG9hZGluZy4gVXNlZCB3aGVuIHdlIGRvbid0IG5lZWQgdG8gY3VycmVudGx5IGxvYWQgc2VnbWVudHMuXG4gICAgZnVuY3Rpb24gZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCkge1xuICAgICAgICB2YXIgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9LCByZWNoZWNrV2FpdFRpbWVNUyk7XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIHByb3Bvc2VkIHRpbWUgdG8gZG93bmxvYWQgaXMgYWZ0ZXIgdGhlIGVuZCB0aW1lIG9mIHRoZSBtZWRpYSBvciB3ZSBoYXZlIG1vcmUgaW4gdGhlIGJ1ZmZlciB0aGFuIHRoZSBtYXggZGVzaXJlZCxcbiAgICAvLyB3YWl0IGEgd2hpbGUgYW5kIHRoZW4gdHJpZ2dlciBhbiBldmVudCBub3RpZnlpbmcgdGhhdCAoaWYgYW55b25lJ3MgbGlzdGVuaW5nKSB3ZSBzaG91bGQgcmVjaGVjayB0byBzZWUgaWYgY29uZGl0aW9uc1xuICAgIC8vIGhhdmUgY2hhbmdlZC5cbiAgICAvLyBUT0RPOiBIYW5kbGUgY29uZGl0aW9uIHdoZXJlIGZpbmFsIHNlZ21lbnQncyBkdXJhdGlvbiBpcyBsZXNzIHRoYW4gMS8yIHN0YW5kYXJkIHNlZ21lbnQncyBkdXJhdGlvbi5cbiAgICBpZiAoZG93bmxvYWRQb2ludCA+PSB0b3RhbER1cmF0aW9uKSB7XG4gICAgICAgIGRlZmVycmVkUmVjaGVja05vdGlmaWNhdGlvbigpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWluRGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDI6IFRoZXJlJ3Mgc29tZXRoaW5nIGluIHRoZSBzb3VyY2UgYnVmZmVyIHN0YXJ0aW5nIGF0IHRoZSBjdXJyZW50IHRpbWUgZm9yIHRoZSBtZWRpYSB0eXBlLCBidXQgaXQnc1xuICAgICAgICAvLyAgICAgICAgICAgICAgYmVsb3cgdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSAoc2Vjb25kcyBvZiBwbGF5YmFjayBpbiB0aGUgYnVmZmVyIGZvciB0aGUgbWVkaWEgdHlwZSlcbiAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgdGltZSkuXG4gICAgICAgIC8vICAgICAgICAgICByaWdodCBub3cuXG4gICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDM6IFRoZSBidWZmZXIgaXMgZnVsbCBtb3JlIHRoYW4gdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSBidXQgbm90IHlldCBtb3JlIHRoYW4gdGhlIG1heGltdW0gZGVzaXJlZFxuICAgICAgICAvLyAgICAgICAgICAgICAgYnVmZmVyIHNpemUuXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSA9IHNlZ21lbnRMb2FkZXIuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKTtcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXkgPSBzZWdtZW50RHVyYXRpb24gLSBkb3dubG9hZFJvdW5kVHJpcFRpbWU7XG4gICAgICAgIGlmIChzZWdtZW50RG93bmxvYWREZWxheSA8PSAwKSB7XG4gICAgICAgICAgICAvLyBDb25kaXRpb24gM2E6IEl0IHRvb2sgYXQgbGVhc3QgYXMgbG9uZyBhcyB0aGUgZHVyYXRpb24gb2YgYSBzZWdtZW50IChpLmUuIHRoZSBhbW91bnQgb2YgdGltZSBpdCB3b3VsZCB0YWtlXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIHRvIHBsYXkgYSBnaXZlbiBzZWdtZW50KSB0byBkb3dubG9hZCB0aGUgcHJldmlvdXMgc2VnbWVudC5cbiAgICAgICAgICAgIC8vIFJlc3BvbnNlOiBEb3dubG9hZCB0aGUgc2VnbWVudCB0aGF0IHdvdWxkIGltbWVkaWF0ZWx5IGZvbGxvdyB0aGUgZW5kIG9mIHRoZSBidWZmZXIgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50XG4gICAgICAgICAgICAvLyAgICAgICAgICAgdGltZSkgcmlnaHQgbm93LlxuICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQ29uZGl0aW9uIDNiOiBEb3dubG9hZGluZyB0aGUgcHJldmlvdXMgc2VnbWVudCB0b29rIGxlc3MgdGltZSB0aGFuIHRoZSBkdXJhdGlvbiBvZiBhIHNlZ21lbnQgKGkuZS4gdGhlIGFtb3VudFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICBvZiB0aW1lIGl0IHdvdWxkIHRha2UgdG8gcGxheSBhIGdpdmVuIHNlZ21lbnQpLlxuICAgICAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnRcbiAgICAgICAgICAgIC8vICAgICAgICAgICB0aW1lKSwgYnV0IHdhaXQgdG8gZG93bmxvYWQgYXQgdGhlIHJhdGUgb2YgcGxheWJhY2sgKHNlZ21lbnQgZHVyYXRpb24gLSB0aW1lIHRvIGRvd25sb2FkKS5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICAgICAgfSwgTWF0aC5mbG9vcihzZWdtZW50RG93bmxvYWREZWxheSAqIDEwMDApKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENvbmRpdGlvbiA0IChkZWZhdWx0KTogVGhlIGJ1ZmZlciBoYXMgYXQgbGVhc3QgdGhlIG1heCBkZXNpcmVkIGJ1ZmZlciBzaXplIGluIGl0IG9yIG5vbmUgb2YgdGhlIGFmb3JlbWVudGlvbmVkXG4gICAgICAgIC8vICAgICAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9ucyB3ZXJlIG1ldC5cbiAgICAgICAgLy8gUmVzcG9uc2U6IFdhaXQgYSB3aGlsZSBhbmQgdGhlbiB0cmlnZ2VyIGFuIGV2ZW50IG5vdGlmeWluZyB0aGF0IChpZiBhbnlvbmUncyBsaXN0ZW5pbmcpIHdlIHNob3VsZCByZWNoZWNrIHRvXG4gICAgICAgIC8vICAgICAgICAgICBzZWUgaWYgY29uZGl0aW9ucyBoYXZlIGNoYW5nZWQuXG4gICAgICAgIGRlZmVycmVkUmVjaGVja05vdGlmaWNhdGlvbigpO1xuICAgIH1cbn07XG5cbi8qKlxuICogRG93bmxvYWQgYSBzZWdtZW50IGZyb20gdGhlIGN1cnJlbnQgc2VnbWVudCBsaXN0IGNvcnJlc3BvbmRpbmcgdG8gdGhlIHN0aXB1bGF0ZWQgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgYW5kIGFkZCBpdFxuICogdG8gdGhlIHNvdXJjZSBidWZmZXIuXG4gKlxuICogQHBhcmFtIHByZXNlbnRhdGlvblRpbWUge251bWJlcn0gVGhlIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIGZvciB3aGljaCB3ZSB3YW50IHRvIGRvd25sb2FkIGFuZCBidWZmZXIgYSBzZWdtZW50XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gICAgICAgICAgICAgICBXaGV0aGVyIG9yIG5vdCB0aGUgdGhlcmUgYXJlIHN1YnNlcXVlbnQgc2VnbWVudHMgaW4gdGhlIHNlZ21lbnQgbGlzdCwgcmVsYXRpdmUgdG8gdGhlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZWRpYSBwcmVzZW50YXRpb24gdGltZSByZXF1ZXN0ZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fbG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbiBsb2FkU2VnbWVudEF0VGltZShwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TG9hZGVyID0gc2VsZi5fX3NlZ21lbnRMb2FkZXIsXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUsXG4gICAgICAgIGhhc05leHRTZWdtZW50ID0gc2VnbWVudExvYWRlci5sb2FkU2VnbWVudEF0VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIGlmICghaGFzTmV4dFNlZ21lbnQpIHsgcmV0dXJuIGhhc05leHRTZWdtZW50OyB9XG5cbiAgICBzZWdtZW50TG9hZGVyLm9uZShzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgZnVuY3Rpb24gc2VnbWVudExvYWRlZEhhbmRsZXIoZXZlbnQpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ1NVQ0NFU1NGVUwgTE9BRElORyEnKTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgLy8gT25jZSB3ZSd2ZSBjb21wbGV0ZWQgZG93bmxvYWRpbmcgYW5kIGJ1ZmZlcmluZyB0aGUgc2VnbWVudCwgZGlzcGF0Y2ggZXZlbnQgdG8gbm90aWZ5IHRoYXQgd2Ugc2hvdWxkIHJlY2hlY2tcbiAgICAgICAgICAgIC8vIHdoZXRoZXIgb3Igbm90IHdlIHNob3VsZCBsb2FkIGFub3RoZXIgc2VnbWVudCBhbmQsIGlmIHNvLCB3aGljaC4gKFNlZTogX19jaGVja1NlZ21lbnRMb2FkaW5nKCkgbWV0aG9kLCBhYm92ZSlcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldE5leHRTZWdtZW50VG9Mb2FkID0gZnVuY3Rpb24oY3VycmVudFRpbWUsIHNlZ21lbnRMaXN0LCBzb3VyY2VCdWZmZXJUaW1lUmFuZ2VMaXN0KSB7XG4gICAgdmFyIHRpbWVSYW5nZU9iaiA9IHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QuZ2V0VGltZVJhbmdlQnlUaW1lKGN1cnJlbnRUaW1lKSxcbiAgICAgICAgcHJldmlvdXNUaW1lUmFuZ2VPYmosXG4gICAgICAgIGksXG4gICAgICAgIGxlbmd0aDtcblxuICAgIGlmICghZXhpc3R5KHRpbWVSYW5nZU9iaikpIHtcbiAgICAgICAgaWYgKHNlZ21lbnRMaXN0LmdldElzTGl2ZSgpKSB7XG4gICAgICAgICAgICB2YXIgbm93U2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWUoRGF0ZS5ub3coKSk7XG4gICAgICAgICAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5TnVtYmVyKG5vd1NlZ21lbnQuZ2V0TnVtYmVyKCkgLSAxKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKGN1cnJlbnRUaW1lKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEZpbmQgdGhlIHRydWUgYnVmZmVyIGVkZ2UsIHNpbmNlIHRoZSBNU0UgYnVmZmVyIHRpbWUgcmFuZ2VzIG1pZ2h0IGJlIGZhbHNlbHkgcmVwb3J0aW5nIHRoYXQgdGhlcmUgYXJlXG4gICAgLy8gbXVsdGlwbGUgdGltZSByYW5nZXMgd2hlbiB0aGV5IGFyZSB0ZW1wb3JhbGx5IGFkamFjZW50LlxuICAgIGxlbmd0aCA9IHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QuZ2V0TGVuZ3RoKCk7XG4gICAgaSA9IHRpbWVSYW5nZU9iai5nZXRJbmRleCgpICsgMTtcbiAgICBmb3IgKDtpPGxlbmd0aDtpKyspIHtcbiAgICAgICAgcHJldmlvdXNUaW1lUmFuZ2VPYmogPSB0aW1lUmFuZ2VPYmo7XG4gICAgICAgIHRpbWVSYW5nZU9iaiA9IHNvdXJjZUJ1ZmZlclRpbWVSYW5nZUxpc3QuZ2V0VGltZVJhbmdlQnlJbmRleChpKTtcbiAgICAgICAgaWYgKCh0aW1lUmFuZ2VPYmouZ2V0U3RhcnQoKSAtIHByZXZpb3VzVGltZVJhbmdlT2JqLmdldEVuZCgpKSA+IDAuMDAzKSB7XG4gICAgICAgICAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShwcmV2aW91c1RpbWVSYW5nZU9iai5nZXRFbmQoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiB3ZSdyZSBoZXJlLCBlaXRoZXIgYSkgdGhlcmUgd2FzIG9ubHkgb25lIHRpbWVSYW5nZSBpbiB0aGUgbGlzdCBvciBiKSBhbGwgb2YgdGhlIHRpbWVSYW5nZXMgaW4gdGhlIGxpc3Qgd2VyZSBhZGphY2VudC5cbiAgICByZXR1cm4gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZSh0aW1lUmFuZ2VPYmouZ2V0RW5kKCkpO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhVHlwZUxvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgU2VnbWVudExvYWRlciA9IHJlcXVpcmUoJy4vc2VnbWVudHMvU2VnbWVudExvYWRlci5qcycpLFxuICAgIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHJlcXVpcmUoJy4vc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcycpLFxuICAgIE1lZGlhVHlwZUxvYWRlciA9IHJlcXVpcmUoJy4vTWVkaWFUeXBlTG9hZGVyLmpzJyksXG4gICAgc2VsZWN0U2VnbWVudExpc3QgPSByZXF1aXJlKCcuL3NlbGVjdFNlZ21lbnRMaXN0LmpzJyksXG4gICAgbWVkaWFUeXBlcyA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWVkaWFUeXBlcy5qcycpO1xuXG4vLyBUT0RPOiBNaWdyYXRlIG1ldGhvZHMgYmVsb3cgdG8gYSBmYWN0b3J5LlxuZnVuY3Rpb24gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSkge1xuICAgIHZhciBzb3VyY2VCdWZmZXJUeXBlID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkuZ2V0U291cmNlQnVmZmVyVHlwZSgpLFxuICAgICAgICAvLyBUT0RPOiBUcnkvY2F0Y2ggYmxvY2s/XG4gICAgICAgIHNvdXJjZUJ1ZmZlciA9IG1lZGlhU291cmNlLmFkZFNvdXJjZUJ1ZmZlcihzb3VyY2VCdWZmZXJUeXBlKTtcbiAgICByZXR1cm4gbmV3IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJGb3JUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSwgdGVjaCkge1xuICAgIHZhciBzZWdtZW50TG9hZGVyID0gbmV3IFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKTtcbiAgICByZXR1cm4gbmV3IE1lZGlhVHlwZUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSwgdGVjaCk7XG59XG5cbi8qKlxuICpcbiAqIEZhY3Rvcnktc3R5bGUgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgc2V0IG9mIE1lZGlhVHlwZUxvYWRlcnMgYmFzZWQgb24gd2hhdCdzIGRlZmluZWQgaW4gdGhlIG1hbmlmZXN0IGFuZCB3aGF0IG1lZGlhIHR5cGVzIGFyZSBzdXBwb3J0ZWQuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQHJldHVybnMge0FycmF5LjxNZWRpYVR5cGVMb2FkZXI+fSAgICAgICAgICAgICAgIFNldCBvZiBNZWRpYVR5cGVMb2FkZXJzIGZvciBsb2FkaW5nIHNlZ21lbnRzIGZvciBhIGdpdmVuIG1lZGlhIHR5cGUgKGUuZy4gYXVkaW8gb3IgdmlkZW8pXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1lZGlhVHlwZUxvYWRlcnMobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBtYXRjaGVkVHlwZXMgPSBtZWRpYVR5cGVzLmZpbHRlcihmdW5jdGlvbihtZWRpYVR5cGUpIHtcbiAgICAgICAgICAgIHZhciBleGlzdHMgPSBleGlzdHkobWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSkpO1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0czsgfSksXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlcnMgPSBtYXRjaGVkVHlwZXMubWFwKGZ1bmN0aW9uKG1lZGlhVHlwZSkgeyByZXR1cm4gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFUeXBlTG9hZGVycztcbn1cblxuLyoqXG4gKlxuICogUGxheWxpc3RMb2FkZXIgaGFuZGxlcyB0aGUgdG9wLWxldmVsIGxvYWRpbmcgYW5kIHBsYXliYWNrIG9mIHNlZ21lbnRzIGZvciBhbGwgbWVkaWEgdHlwZXMgKGUuZy4gYm90aCBhdWRpbyBhbmQgdmlkZW8pLlxuICogVGhpcyBpbmNsdWRlcyBjaGVja2luZyBpZiBpdCBzaG91bGQgc3dpdGNoIHNlZ21lbnQgbGlzdHMsIHVwZGF0aW5nL3JldHJpZXZpbmcgZGF0YSByZWxldmFudCB0byB0aGVzZSBkZWNpc2lvbiBmb3JcbiAqIGVhY2ggbWVkaWEgdHlwZS4gSXQgYWxzbyBpbmNsdWRlcyBjaGFuZ2luZyB0aGUgcGxheWJhY2sgcmF0ZSBvZiB0aGUgdmlkZW8gYmFzZWQgb24gZGF0YSBhdmFpbGFibGUgaW4gdGhlIHNvdXJjZSBidWZmZXIuXG4gKlxuICogQHBhcmFtIG1hbmlmZXN0Q29udHJvbGxlciB7TWFuaWZlc3RDb250cm9sbGVyfSAgIGNvbnRyb2xsZXIgdGhhdCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgQUJSIHBsYXlsaXN0IG1hbmlmZXN0IGRhdGFcbiAqIEBwYXJhbSBtZWRpYVNvdXJjZSB7TWVkaWFTb3VyY2V9ICAgICAgICAgICAgICAgICBNU0UgTWVkaWFTb3VyY2UgaW5zdGFuY2UgY29ycmVzcG9uZGluZyB0byB0aGUgY3VycmVudCBBQlIgcGxheWxpc3RcbiAqIEBwYXJhbSB0ZWNoIHtvYmplY3R9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWRlby5qcyBIdG1sNSB0ZWNoIG9iamVjdCBpbnN0YW5jZVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgdGhpcy5fX21lZGlhVHlwZUxvYWRlcnMgPSBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpO1xuXG4gICAgdmFyIGk7XG5cbiAgICBmdW5jdGlvbiBraWNrb2ZmTWVkaWFUeXBlTG9hZGVyKG1lZGlhVHlwZUxvYWRlcikge1xuICAgICAgICAvLyBNZWRpYVNldC1zcGVjaWZpYyB2YXJpYWJsZXNcbiAgICAgICAgdmFyIHNlZ21lbnRMb2FkZXIgPSBtZWRpYVR5cGVMb2FkZXIuZ2V0U2VnbWVudExvYWRlcigpLFxuICAgICAgICAgICAgZG93bmxvYWRSYXRlUmF0aW8gPSAxLjAsXG4gICAgICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpLFxuICAgICAgICAgICAgbWVkaWFUeXBlID0gbWVkaWFUeXBlTG9hZGVyLmdldE1lZGlhVHlwZSgpO1xuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgZXZlbnQgdGVsbGluZyB1cyB0byByZWNoZWNrIHdoaWNoIHNlZ21lbnQgbGlzdCB0aGUgc2VnbWVudHMgc2hvdWxkIGJlIGxvYWRlZCBmcm9tLlxuICAgICAgICBtZWRpYVR5cGVMb2FkZXIub24obWVkaWFUeXBlTG9hZGVyLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIG1lZGlhU2V0ID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSksXG4gICAgICAgICAgICAgICAgaXNGdWxsc2NyZWVuID0gdGVjaC5wbGF5ZXIoKS5pc0Z1bGxzY3JlZW4oKSxcbiAgICAgICAgICAgICAgICBkYXRhID0ge30sXG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRTZWdtZW50TGlzdDtcblxuICAgICAgICAgICAgZGF0YS5kb3dubG9hZFJhdGVSYXRpbyA9IGRvd25sb2FkUmF0ZVJhdGlvO1xuICAgICAgICAgICAgZGF0YS5jdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG5cbiAgICAgICAgICAgIC8vIFJhdGhlciB0aGFuIG1vbml0b3JpbmcgZXZlbnRzL3VwZGF0aW5nIHN0YXRlLCBzaW1wbHkgZ2V0IHJlbGV2YW50IHZpZGVvIHZpZXdwb3J0IGRpbXMgb24gdGhlIGZseSBhcyBuZWVkZWQuXG4gICAgICAgICAgICBkYXRhLndpZHRoID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi53aWR0aCA6IHRlY2gucGxheWVyKCkud2lkdGgoKTtcbiAgICAgICAgICAgIGRhdGEuaGVpZ2h0ID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi5oZWlnaHQgOiB0ZWNoLnBsYXllcigpLmhlaWdodCgpO1xuXG4gICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0ID0gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpO1xuXG4gICAgICAgICAgICAvLyBUT0RPOiBTaG91bGQgd2UgcmVmYWN0b3IgdG8gc2V0IGJhc2VkIG9uIHNlZ21lbnRMaXN0IGluc3RlYWQ/XG4gICAgICAgICAgICAvLyAoUG90ZW50aWFsbHkpIHVwZGF0ZSB3aGljaCBzZWdtZW50IGxpc3QgdGhlIHNlZ21lbnRzIHNob3VsZCBiZSBsb2FkZWQgZnJvbSAoYmFzZWQgb24gc2VnbWVudCBsaXN0J3MgYmFuZHdpZHRoL2JpdHJhdGUpXG4gICAgICAgICAgICBzZWdtZW50TG9hZGVyLnNldEN1cnJlbnRCYW5kd2lkdGgoc2VsZWN0ZWRTZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgZG93bmxvYWQgcmF0ZSAocm91bmQgdHJpcCB0aW1lIHRvIGRvd25sb2FkIGEgc2VnbWVudCBvZiBhIGdpdmVuIGF2ZXJhZ2UgYmFuZHdpZHRoL2JpdHJhdGUpIHRvIHVzZVxuICAgICAgICAvLyB3aXRoIGNob29zaW5nIHdoaWNoIHN0cmVhbSB2YXJpYW50IHRvIGxvYWQgc2VnbWVudHMgZnJvbS5cbiAgICAgICAgc2VnbWVudExvYWRlci5vbihzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGRvd25sb2FkUmF0ZVJhdGlvID0gZXZlbnQuZGF0YS5wbGF5YmFja1RpbWUgLyBldmVudC5kYXRhLnJ0dDtcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGV2ZW50LmRhdGEuYmFuZHdpZHRoO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBLaWNrb2ZmIHNlZ21lbnQgbG9hZGluZyBmb3IgdGhlIG1lZGlhIHR5cGUuXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlci5zdGFydExvYWRpbmdTZWdtZW50cygpO1xuICAgIH1cblxuICAgIC8vIEZvciBlYWNoIG9mIHRoZSBtZWRpYSB0eXBlcyAoZS5nLiAnYXVkaW8nICYgJ3ZpZGVvJykgaW4gdGhlIEFCUiBtYW5pZmVzdC4uLlxuICAgIGZvciAoaT0wOyBpPHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGtpY2tvZmZNZWRpYVR5cGVMb2FkZXIodGhpcy5fX21lZGlhVHlwZUxvYWRlcnNbaV0pO1xuICAgIH1cblxuICAgIC8vIE5PVEU6IFRoaXMgY29kZSBibG9jayBoYW5kbGVzIHBzZXVkby0ncGF1c2luZycvJ3VucGF1c2luZycgKGNoYW5naW5nIHRoZSBwbGF5YmFja1JhdGUpIGJhc2VkIG9uIHdoZXRoZXIgb3Igbm90XG4gICAgLy8gdGhlcmUgaXMgZGF0YSBhdmFpbGFibGUgaW4gdGhlIGJ1ZmZlciwgYnV0IGluZGlyZWN0bHksIGJ5IGxpc3RlbmluZyB0byBhIGZldyBldmVudHMgYW5kIHVzaW5nIHRoZSB2aWRlbyBlbGVtZW50J3NcbiAgICAvLyByZWFkeSBzdGF0ZS5cbiAgICB2YXIgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzID0gWydzZWVraW5nJywgJ2NhbnBsYXknLCAnY2FucGxheXRocm91Z2gnXSxcbiAgICAgICAgZXZlbnRUeXBlO1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzSGFuZGxlcihldmVudCkge1xuICAgICAgICB2YXIgcmVhZHlTdGF0ZSA9IHRlY2guZWwoKS5yZWFkeVN0YXRlLFxuICAgICAgICAgICAgcGxheWJhY2tSYXRlID0gKHJlYWR5U3RhdGUgPT09IDQpID8gMSA6IDA7XG4gICAgICAgIHRlY2guc2V0UGxheWJhY2tSYXRlKHBsYXliYWNrUmF0ZSk7XG4gICAgfVxuXG4gICAgZm9yKGk9MDsgaTxjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZXZlbnRUeXBlID0gY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzW2ldO1xuICAgICAgICB0ZWNoLm9uKGV2ZW50VHlwZSwgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzSGFuZGxlcik7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFBsYXlsaXN0TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIE1lZGlhU291cmNlID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLk1lZGlhU291cmNlLFxuICAgIE1hbmlmZXN0Q29udHJvbGxlciA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWFuaWZlc3RDb250cm9sbGVyLmpzJyksXG4gICAgUGxheWxpc3RMb2FkZXIgPSByZXF1aXJlKCcuL1BsYXlsaXN0TG9hZGVyLmpzJyk7XG5cbi8vIFRPRE86IERJU1BPU0UgTUVUSE9EXG4vKipcbiAqXG4gKiBDbGFzcyB0aGF0IGRlZmluZXMgdGhlIHJvb3QgY29udGV4dCBmb3IgaGFuZGxpbmcgYSBzcGVjaWZpYyBNUEVHLURBU0ggbWVkaWEgc291cmNlLlxuICpcbiAqIEBwYXJhbSBzb3VyY2UgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHNvdXJjZSwgc3VjaCBhcyB0aGUgdXJpIChzcmMpIGFuZCB0aGUgdHlwZSAodHlwZSlcbiAqIEBwYXJhbSB0ZWNoICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBvYmplY3QgcHJvdmlkaW5nIHRoZSBwb2ludCBvZiBpbnRlcmFjdGlvbiBiZXR3ZWVuIHRoZSBTb3VyY2VIYW5kbGVyIGluc3RhbmNlIGFuZFxuICogICAgICAgICAgICAgICAgICB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nIGUuZy4gdGhlIHZpZGVvIGVsZW1lbnQpXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1hbmlmZXN0Q29udHJvbGxlciA9IG5ldyBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlLnNyYywgZmFsc2UpO1xuXG4gICAgbWFuaWZlc3RDb250cm9sbGVyLm9uZShtYW5pZmVzdENvbnRyb2xsZXIuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgdmFyIG1lZGlhU291cmNlID0gbmV3IE1lZGlhU291cmNlKCksXG4gICAgICAgICAgICBvcGVuTGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1lZGlhU291cmNlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fcGxheWxpc3RMb2FkZXIgPSBuZXcgUGxheWxpc3RMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgY2xvc2UuXG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignd2Via2l0c291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgICAgIHRlY2guc2V0U3JjKFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpKTtcbiAgICB9KTtcblxuICAgIG1hbmlmZXN0Q29udHJvbGxlci5sb2FkKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlSGFuZGxlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pc1N0cmluZy5qcycpLFxuICAgIHBhcnNlUm9vdFVybCA9IHV0aWwucGFyc2VSb290VXJsLFxuICAgIGNyZWF0ZU1wZE9iamVjdCxcbiAgICBjcmVhdGVQZXJpb2RPYmplY3QsXG4gICAgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCxcbiAgICBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCxcbiAgICBjcmVhdGVTZWdtZW50VGVtcGxhdGUsXG4gICAgZ2V0TXBkLFxuICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGUsXG4gICAgZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSxcbiAgICBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZTtcblxuLy8gVE9ETzogU2hvdWxkIHRoaXMgZXhpc3Qgb24gbXBkIGRhdGF2aWV3IG9yIGF0IGEgaGlnaGVyIGxldmVsP1xuLy8gVE9ETzogUmVmYWN0b3IuIENvdWxkIGJlIG1vcmUgZWZmaWNpZW50IChSZWN1cnNpdmUgZm4/IFVzZSBlbGVtZW50LmdldEVsZW1lbnRzQnlOYW1lKCdCYXNlVXJsJylbMF0/KS5cbi8vIFRPRE86IEN1cnJlbnRseSBhc3N1bWluZyAqRUlUSEVSKiA8QmFzZVVSTD4gbm9kZXMgd2lsbCBwcm92aWRlIGFuIGFic29sdXRlIGJhc2UgdXJsIChpZSByZXNvbHZlIHRvICdodHRwOi8vJyBldGMpXG4vLyBUT0RPOiAqT1IqIHdlIHNob3VsZCB1c2UgdGhlIGJhc2UgdXJsIG9mIHRoZSBob3N0IG9mIHRoZSBNUEQgbWFuaWZlc3QuXG52YXIgYnVpbGRCYXNlVXJsID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHZhciBlbGVtSGllcmFyY2h5ID0gW3htbE5vZGVdLmNvbmNhdCh4bWxmdW4uZ2V0QW5jZXN0b3JzKHhtbE5vZGUpKSxcbiAgICAgICAgZm91bmRMb2NhbEJhc2VVcmwgPSBmYWxzZTtcbiAgICB2YXIgYmFzZVVybHMgPSBlbGVtSGllcmFyY2h5Lm1hcChmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmIChmb3VuZExvY2FsQmFzZVVybCkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgaWYgKCFlbGVtLmhhc0NoaWxkTm9kZXMoKSkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgdmFyIGNoaWxkO1xuICAgICAgICBmb3IgKHZhciBpPTA7IGk8ZWxlbS5jaGlsZE5vZGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IGVsZW0uY2hpbGROb2Rlcy5pdGVtKGkpO1xuICAgICAgICAgICAgaWYgKGNoaWxkLm5vZGVOYW1lID09PSAnQmFzZVVSTCcpIHtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dEVsZW0gPSBjaGlsZC5jaGlsZE5vZGVzLml0ZW0oMCk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRWYWx1ZSA9IHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRleHRWYWx1ZS5pbmRleE9mKCdodHRwOi8vJykgPT09IDApIHsgZm91bmRMb2NhbEJhc2VVcmwgPSB0cnVlOyB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfSk7XG5cbiAgICB2YXIgYmFzZVVybCA9IGJhc2VVcmxzLnJldmVyc2UoKS5qb2luKCcnKTtcbiAgICBpZiAoIWJhc2VVcmwpIHsgcmV0dXJuIHBhcnNlUm9vdFVybCh4bWxOb2RlLmJhc2VVUkkpOyB9XG4gICAgcmV0dXJuIGJhc2VVcmw7XG59O1xuXG52YXIgZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcyA9IFtcbiAgICAnQWRhcHRhdGlvblNldCcsXG4gICAgJ1JlcHJlc2VudGF0aW9uJyxcbiAgICAnU3ViUmVwcmVzZW50YXRpb24nXG5dO1xuXG52YXIgaGFzQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcy5pbmRleE9mKGVsZW0ubm9kZU5hbWUpID49IDA7XG59O1xuXG52YXIgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuICFoYXNDb21tb25Qcm9wZXJ0aWVzKGVsZW0pO1xufTtcblxuLy8gQ29tbW9uIEF0dHJzXG52YXIgZ2V0V2lkdGggPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ3dpZHRoJyksXG4gICAgZ2V0SGVpZ2h0ID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdoZWlnaHQnKSxcbiAgICBnZXRGcmFtZVJhdGUgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2ZyYW1lUmF0ZScpLFxuICAgIGdldE1pbWVUeXBlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdtaW1lVHlwZScpLFxuICAgIGdldENvZGVjcyA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnY29kZWNzJyk7XG5cbnZhciBnZXRTZWdtZW50VGVtcGxhdGVYbWxMaXN0ID0geG1sZnVuLmdldE11bHRpTGV2ZWxFbGVtZW50TGlzdCgnU2VnbWVudFRlbXBsYXRlJyk7XG5cbi8vIE1QRCBBdHRyIGZuc1xudmFyIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uJyksXG4gICAgZ2V0VHlwZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3R5cGUnKSxcbiAgICBnZXRNaW5pbXVtVXBkYXRlUGVyaW9kID0geG1sZnVuLmdldEF0dHJGbignbWluaW11bVVwZGF0ZVBlcmlvZCcpLFxuICAgIGdldEF2YWlsYWJpbGl0eVN0YXJ0VGltZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2F2YWlsYWJpbGl0eVN0YXJ0VGltZScpLFxuICAgIGdldFN1Z2dlc3RlZFByZXNlbnRhdGlvbkRlbGF5ID0geG1sZnVuLmdldEF0dHJGbignc3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXknKSxcbiAgICBnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVTaGlmdEJ1ZmZlckRlcHRoJyk7XG5cbi8vIFJlcHJlc2VudGF0aW9uIEF0dHIgZm5zXG52YXIgZ2V0SWQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdpZCcpLFxuICAgIGdldEJhbmR3aWR0aCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2JhbmR3aWR0aCcpO1xuXG4vLyBTZWdtZW50VGVtcGxhdGUgQXR0ciBmbnNcbnZhciBnZXRJbml0aWFsaXphdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2luaXRpYWxpemF0aW9uJyksXG4gICAgZ2V0TWVkaWEgPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYScpLFxuICAgIGdldER1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignZHVyYXRpb24nKSxcbiAgICBnZXRUaW1lc2NhbGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0aW1lc2NhbGUnKSxcbiAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0ID0geG1sZnVuLmdldEF0dHJGbigncHJlc2VudGF0aW9uVGltZU9mZnNldCcpLFxuICAgIGdldFN0YXJ0TnVtYmVyID0geG1sZnVuLmdldEF0dHJGbignc3RhcnROdW1iZXInKTtcblxuLy8gVE9ETzogUmVwZWF0IGNvZGUuIEFic3RyYWN0IGF3YXkgKFByb3RvdHlwYWwgSW5oZXJpdGFuY2UvT08gTW9kZWw/IE9iamVjdCBjb21wb3NlciBmbj8pXG5jcmVhdGVNcGRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFBlcmlvZHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgeG1sTm9kZSksXG4gICAgICAgIGdldE1pbmltdW1VcGRhdGVQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW5pbXVtVXBkYXRlUGVyaW9kLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXZhaWxhYmlsaXR5U3RhcnRUaW1lLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3VnZ2VzdGVkUHJlc2VudGF0aW9uRGVsYXk6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdWdnZXN0ZWRQcmVzZW50YXRpb25EZWxheSwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGgsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sTGlzdCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sTGlzdCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldElkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SWQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRXaWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFdpZHRoLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0SGVpZ2h0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SGVpZ2h0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RnJhbWVSYXRlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RnJhbWVSYXRlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0Q29kZWNzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0Q29kZWNzLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QmFzZVVybDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGJ1aWxkQmFzZVVybCwgeG1sTm9kZSksXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSA9IGZ1bmN0aW9uKHhtbEFycmF5KSB7XG4gICAgLy8gRWZmZWN0aXZlbHkgYSBmaW5kIGZ1bmN0aW9uICsgYSBtYXAgZnVuY3Rpb24uXG4gICAgZnVuY3Rpb24gZ2V0QXR0ckZyb21YbWxBcnJheShhdHRyR2V0dGVyRm4sIHhtbEFycmF5KSB7XG4gICAgICAgIGlmICghaXNBcnJheSh4bWxBcnJheSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoIWlzRnVuY3Rpb24oYXR0ckdldHRlckZuKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG5cbiAgICAgICAgdmFyIGksXG4gICAgICAgICAgICBsZW5ndGggPSB4bWxBcnJheS5sZW5ndGgsXG4gICAgICAgICAgICBjdXJyZW50QXR0clZhbHVlO1xuXG4gICAgICAgIGZvciAoaT0wOyBpPHhtbEFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjdXJyZW50QXR0clZhbHVlID0gYXR0ckdldHRlckZuKHhtbEFycmF5W2ldKTtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhjdXJyZW50QXR0clZhbHVlKSAmJiBjdXJyZW50QXR0clZhbHVlICE9PSAnJykgeyByZXR1cm4gY3VycmVudEF0dHJWYWx1ZTsgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbEFycmF5LFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sQXJyYXlbMF0sICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxBcnJheVswXSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxBcnJheVswXSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0SW5pdGlhbGl6YXRpb24sIHhtbEFycmF5KSxcbiAgICAgICAgZ2V0TWVkaWE6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBdHRyRnJvbVhtbEFycmF5LCBnZXRNZWRpYSwgeG1sQXJyYXkpLFxuICAgICAgICBnZXREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldER1cmF0aW9uLCB4bWxBcnJheSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldFRpbWVzY2FsZSwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QXR0ckZyb21YbWxBcnJheSwgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCwgeG1sQXJyYXkpLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEF0dHJGcm9tWG1sQXJyYXksIGdldFN0YXJ0TnVtYmVyLCB4bWxBcnJheSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUgPSBmdW5jdGlvbih4bWxOb2RlLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIGlmICghdGFnTmFtZSB8fCAheG1sTm9kZSB8fCAheG1sTm9kZS5wYXJlbnROb2RlKSB7IHJldHVybiBudWxsOyB9XG4gICAgaWYgKCF4bWxOb2RlLnBhcmVudE5vZGUuaGFzT3duUHJvcGVydHkoJ25vZGVOYW1lJykpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGlmICh4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUgPT09IHRhZ05hbWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpID8gbWFwRm4oeG1sTm9kZS5wYXJlbnROb2RlKSA6IHhtbE5vZGUucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUucGFyZW50Tm9kZSwgdGFnTmFtZSwgbWFwRm4pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNcGQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsLFxuICAgIC8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHBhcnNlRGF0ZVRpbWUsXG4gICAgU0VDT05EU19JTl9ZRUFSID0gMzY1ICogMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTU9OVEggPSAzMCAqIDI0ICogNjAgKiA2MCwgLy8gbm90IHByZWNpc2UhXG4gICAgU0VDT05EU19JTl9EQVkgPSAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9IT1VSID0gNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01JTiA9IDYwLFxuICAgIE1JTlVURVNfSU5fSE9VUiA9IDYwLFxuICAgIE1JTExJU0VDT05EU19JTl9TRUNPTkRTID0gMTAwMCxcbiAgICBkdXJhdGlvblJlZ2V4ID0gL15QKChbXFxkLl0qKVkpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopRCk/VD8oKFtcXGQuXSopSCk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilTKT8vLFxuICAgIGRhdGVUaW1lUmVnZXggPSAvXihbMC05XXs0fSktKFswLTldezJ9KS0oWzAtOV17Mn0pVChbMC05XXsyfSk6KFswLTldezJ9KSg/OjooWzAtOV0qKShcXC5bMC05XSopPyk/KD86KFsrLV0pKFswLTldezJ9KShbMC05XXsyfSkpPy87XG5cbnBhcnNlUm9vdFVybCA9IGZ1bmN0aW9uKHVybCkge1xuICAgIGlmICh0eXBlb2YgdXJsICE9PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCcvJykgPT09IC0xKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJz8nKSAhPT0gLTEpIHtcbiAgICAgICAgdXJsID0gdXJsLnN1YnN0cmluZygwLCB1cmwuaW5kZXhPZignPycpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdXJsLnN1YnN0cmluZygwLCB1cmwubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufTtcblxuLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAvL3N0ciA9IFwiUDEwWTEwTTEwRFQxMEgxME0xMC4xU1wiO1xuICAgIGlmICghc3RyKSB7IHJldHVybiBOdW1iZXIuTmFOOyB9XG4gICAgdmFyIG1hdGNoID0gZHVyYXRpb25SZWdleC5leGVjKHN0cik7XG4gICAgaWYgKCFtYXRjaCkgeyByZXR1cm4gTnVtYmVyLk5hTjsgfVxuICAgIHJldHVybiAocGFyc2VGbG9hdChtYXRjaFsyXSB8fCAwKSAqIFNFQ09ORFNfSU5fWUVBUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNF0gfHwgMCkgKiBTRUNPTkRTX0lOX01PTlRIICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs2XSB8fCAwKSAqIFNFQ09ORFNfSU5fREFZICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs4XSB8fCAwKSAqIFNFQ09ORFNfSU5fSE9VUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTBdIHx8IDApICogU0VDT05EU19JTl9NSU4gK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEyXSB8fCAwKSk7XG59O1xuXG4vKipcbiAqIFBhcnNlciBmb3IgZm9ybWF0dGVkIGRhdGV0aW1lIHN0cmluZ3MgY29uZm9ybWluZyB0byB0aGUgSVNPIDg2MDEgc3RhbmRhcmQuXG4gKiBHZW5lcmFsIEZvcm1hdDogIFlZWVktTU0tRERUSEg6TU06U1NaIChVVEMpIG9yIFlZWVktTU0tRERUSEg6TU06U1MrSEg6TU0gKHRpbWUgem9uZSBsb2NhbGl6YXRpb24pXG4gKiBFeCBTdHJpbmc6ICAgICAgIDIwMTQtMTItMTdUMTQ6MDk6NThaIChVVEMpIG9yIDIwMTQtMTItMTdUMTQ6MTU6NTgrMDY6MDAgKHRpbWUgem9uZSBsb2NhbGl6YXRpb24pIC8gMjAxNC0xMi0xN1QxNDowMzo1OC0wNjowMCAodGltZSB6b25lIGxvY2FsaXphdGlvbilcbiAqXG4gKiBAcGFyYW0gc3RyIHtzdHJpbmd9ICBJU08gODYwMS1jb21wbGlhbnQgZGF0ZXRpbWUgc3RyaW5nLlxuICogQHJldHVybnMge251bWJlcn0gVVRDIFVuaXggdGltZS5cbiAqL1xucGFyc2VEYXRlVGltZSA9IGZ1bmN0aW9uKHN0cikge1xuICAgIHZhciBtYXRjaCA9IGRhdGVUaW1lUmVnZXguZXhlYyhzdHIpLFxuICAgICAgICB1dGNEYXRlO1xuXG4gICAgLy8gSWYgdGhlIHN0cmluZyBkb2VzIG5vdCBjb250YWluIGEgdGltZXpvbmUgb2Zmc2V0IGRpZmZlcmVudCBicm93c2VycyBjYW4gaW50ZXJwcmV0IGl0IGVpdGhlclxuICAgIC8vIGFzIFVUQyBvciBhcyBhIGxvY2FsIHRpbWUgc28gd2UgaGF2ZSB0byBwYXJzZSB0aGUgc3RyaW5nIG1hbnVhbGx5IHRvIG5vcm1hbGl6ZSB0aGUgZ2l2ZW4gZGF0ZSB2YWx1ZSBmb3JcbiAgICAvLyBhbGwgYnJvd3NlcnNcbiAgICB1dGNEYXRlID0gRGF0ZS5VVEMoXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzFdLCAxMCksXG4gICAgICAgIHBhcnNlSW50KG1hdGNoWzJdLCAxMCktMSwgLy8gbW9udGhzIHN0YXJ0IGZyb20gemVyb1xuICAgICAgICBwYXJzZUludChtYXRjaFszXSwgMTApLFxuICAgICAgICBwYXJzZUludChtYXRjaFs0XSwgMTApLFxuICAgICAgICBwYXJzZUludChtYXRjaFs1XSwgMTApLFxuICAgICAgICAobWF0Y2hbNl0gJiYgcGFyc2VJbnQobWF0Y2hbNl0sIDEwKSB8fCAwKSxcbiAgICAgICAgKG1hdGNoWzddICYmIHBhcnNlRmxvYXQobWF0Y2hbN10pICogTUlMTElTRUNPTkRTX0lOX1NFQ09ORFMpIHx8IDApO1xuICAgIC8vIElmIHRoZSBkYXRlIGhhcyB0aW1lem9uZSBvZmZzZXQgdGFrZSBpdCBpbnRvIGFjY291bnQgYXMgd2VsbFxuICAgIGlmIChtYXRjaFs5XSAmJiBtYXRjaFsxMF0pIHtcbiAgICAgICAgdmFyIHRpbWV6b25lT2Zmc2V0ID0gcGFyc2VJbnQobWF0Y2hbOV0sIDEwKSAqIE1JTlVURVNfSU5fSE9VUiArIHBhcnNlSW50KG1hdGNoWzEwXSwgMTApO1xuICAgICAgICB1dGNEYXRlICs9IChtYXRjaFs4XSA9PT0gJysnID8gLTEgOiArMSkgKiB0aW1lem9uZU9mZnNldCAqIFNFQ09ORFNfSU5fTUlOICogTUlMTElTRUNPTkRTX0lOX1NFQ09ORFM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHV0Y0RhdGU7XG59O1xuXG52YXIgdXRpbCA9IHtcbiAgICBwYXJzZVJvb3RVcmw6IHBhcnNlUm9vdFVybCxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lOiBwYXJzZURhdGVUaW1lXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWw7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXF1aXJlKCcuLi9tcGQvdXRpbC5qcycpLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBwYXJzZURhdGVUaW1lID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZURhdGVUaW1lLFxuICAgIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vc2VnbWVudFRlbXBsYXRlJyksXG4gICAgY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VVRDV2FsbENsb2NrVGltZSxcbiAgICBnZXRUeXBlLFxuICAgIGdldElzTGl2ZSxcbiAgICBnZXRCYW5kd2lkdGgsXG4gICAgZ2V0V2lkdGgsXG4gICAgZ2V0SGVpZ2h0LFxuICAgIGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlLFxuICAgIGdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoLFxuICAgIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSxcbiAgICBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSxcbiAgICBnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGU7XG5cbmdldFR5cGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZ2V0SXNMaXZlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gKHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldFR5cGUoKSA9PT0gJ2R5bmFtaWMnKTtcbn07XG5cbmdldEJhbmR3aWR0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGJhbmR3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKSA/IE51bWJlcihiYW5kd2lkdGgpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0V2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciB3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldFdpZHRoKCk7XG4gICAgcmV0dXJuIGV4aXN0eSh3aWR0aCkgPyBOdW1iZXIod2lkdGgpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0SGVpZ2h0ID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgaGVpZ2h0ID0gcmVwcmVzZW50YXRpb24uZ2V0SGVpZ2h0KCk7XG4gICAgcmV0dXJuIGV4aXN0eShoZWlnaHQpID8gTnVtYmVyKGhlaWdodCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAvLyBUT0RPOiBTdXBwb3J0IHBlcmlvZC1yZWxhdGl2ZSBwcmVzZW50YXRpb24gdGltZVxuICAgIHZhciBtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbigpLFxuICAgICAgICBwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZXhpc3R5KG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pID8gcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pIDogTnVtYmVyLk5hTixcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZU9mZnNldCA9IE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0KCkpIHx8IDA7XG4gICAgcmV0dXJuIGV4aXN0eShwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA/IE51bWJlcihwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uIC0gcHJlc2VudGF0aW9uVGltZU9mZnNldCkgOiBOdW1iZXIuTmFOO1xufTtcblxuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgd2FsbENsb2NrVGltZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldEF2YWlsYWJpbGl0eVN0YXJ0VGltZSgpLFxuICAgICAgICB3YWxsQ2xvY2tVbml4VGltZVV0YyA9IHBhcnNlRGF0ZVRpbWUod2FsbENsb2NrVGltZVN0cik7XG4gICAgcmV0dXJuIHdhbGxDbG9ja1VuaXhUaW1lVXRjO1xufTtcblxuZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciB0aW1lU2hpZnRCdWZmZXJEZXB0aFN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldFRpbWVTaGlmdEJ1ZmZlckRlcHRoKCksXG4gICAgICAgIHBhcnNlZFRpbWVTaGlmdEJ1ZmZlckRlcHRoID0gcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKHRpbWVTaGlmdEJ1ZmZlckRlcHRoU3RyKTtcbiAgICByZXR1cm4gcGFyc2VkVGltZVNoaWZ0QnVmZmVyRGVwdGg7XG59O1xuXG5nZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBzZWdtZW50VGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKTtcbiAgICByZXR1cm4gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXREdXJhdGlvbigpKSAvIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0VGltZXNjYWxlKCkpO1xufTtcblxuZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBNYXRoLmNlaWwoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLyBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKTtcbn07XG5cbmdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldFN0YXJ0TnVtYmVyKCkpO1xufTtcblxuZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pICsgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC0gMTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRJc0xpdmU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJc0xpdmUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRXaWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFNlZ21lbnREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VGltZVNoaWZ0QnVmZmVyRGVwdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUaW1lU2hpZnRCdWZmZXJEZXB0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbFNlZ21lbnRDb3VudDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0RW5kTnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIC8vIFRPRE86IEV4dGVybmFsaXplXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBpbml0aWFsaXphdGlvbiA9IHt9O1xuICAgICAgICAgICAgaW5pdGlhbGl6YXRpb24uZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICAgICAgICAgIHJlcHJlc2VudGF0aW9uSWQgPSByZXByZXNlbnRhdGlvbi5nZXRJZCgpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRJbml0aWFsaXphdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25JZCk7XG5cbiAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwsICdCYW5kd2lkdGgnLCByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBpbml0aWFsaXphdGlvbjtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5TnVtYmVyOiBmdW5jdGlvbihudW1iZXIpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTsgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5VGltZTogZnVuY3Rpb24oc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgc2Vjb25kcyk7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVVUQ1dhbGxDbG9ja1RpbWU6IGZ1bmN0aW9uKHV0Y01pbGxpc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VVRDV2FsbENsb2NrVGltZShyZXByZXNlbnRhdGlvbiwgdXRjTWlsbGlzZWNvbmRzKTsgfVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB7fTtcbiAgICBzZWdtZW50LmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgIHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0TWVkaWEoKSxcbiAgICAgICAgICAgIHJlcGxhY2VkSWRVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uLmdldElkKCkpLFxuICAgICAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmw7XG4gICAgICAgICAgICAvLyBUT0RPOiBTaW5jZSAkVGltZSQtdGVtcGxhdGVkIHNlZ21lbnQgVVJMcyBzaG91bGQgb25seSBleGlzdCBpbiBjb25qdW5jdGlvbiB3L2EgPFNlZ21lbnRUaW1lbGluZT4sXG4gICAgICAgICAgICAvLyBUT0RPOiBjYW4gY3VycmVudGx5IGFzc3VtZSBhICROdW1iZXIkLWJhc2VkIHRlbXBsYXRlZCB1cmwuXG4gICAgICAgICAgICAvLyBUT0RPOiBFbmZvcmNlIG1pbi9tYXggbnVtYmVyIHJhbmdlIChiYXNlZCBvbiBzZWdtZW50TGlzdCBzdGFydE51bWJlciAmIGVuZE51bWJlcilcbiAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRJZFVybCwgJ051bWJlcicsIG51bWJlcik7XG4gICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkVG9rZW5zVXJsLCAnQmFuZHdpZHRoJywgcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuXG4gICAgICAgIHJldHVybiBiYXNlVXJsICsgcmVwbGFjZWRUb2tlbnNVcmw7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gKG51bWJlciAtIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSkgKiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXRVVENXYWxsQ2xvY2tTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZUZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgKyBNYXRoLnJvdW5kKCgobnVtYmVyIC0gZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKSAqIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpICogMTAwMCk7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldER1cmF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIFRPRE86IFZlcmlmeVxuICAgICAgICB2YXIgc3RhbmRhcmRTZWdtZW50RHVyYXRpb24gPSBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICAgICAgZHVyYXRpb24sXG4gICAgICAgICAgICBtZWRpYVByZXNlbnRhdGlvblRpbWUsXG4gICAgICAgICAgICBwcmVjaXNpb25NdWx0aXBsaWVyO1xuXG4gICAgICAgIGlmIChnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pID09PSBudW1iZXIpIHtcbiAgICAgICAgICAgIG1lZGlhUHJlc2VudGF0aW9uVGltZSA9IE51bWJlcihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG4gICAgICAgICAgICAvLyBIYW5kbGUgZmxvYXRpbmcgcG9pbnQgcHJlY2lzaW9uIGlzc3VlXG4gICAgICAgICAgICBwcmVjaXNpb25NdWx0aXBsaWVyID0gMTAwMDtcbiAgICAgICAgICAgIGR1cmF0aW9uID0gKCgobWVkaWFQcmVzZW50YXRpb25UaW1lICogcHJlY2lzaW9uTXVsdGlwbGllcikgJSAoc3RhbmRhcmRTZWdtZW50RHVyYXRpb24gKiBwcmVjaXNpb25NdWx0aXBsaWVyKSkgLyBwcmVjaXNpb25NdWx0aXBsaWVyICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkdXJhdGlvbiA9IHN0YW5kYXJkU2VnbWVudER1cmF0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkdXJhdGlvbjtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0TnVtYmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiBudW1iZXI7IH07XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIHNlY29uZHMpIHtcbiAgICB2YXIgc2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc3RhcnROdW1iZXIgPSBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgfHwgMCxcbiAgICAgICAgbnVtYmVyID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gc2VnbWVudER1cmF0aW9uKSArIHN0YXJ0TnVtYmVyLFxuICAgICAgICBzZWdtZW50ID0gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpO1xuXG4gICAgLy8gSWYgd2UncmUgcmVhbGx5IGNsb3NlIHRvIHRoZSBlbmQgdGltZSBvZiB0aGUgY3VycmVudCBzZWdtZW50IChzdGFydCB0aW1lICsgZHVyYXRpb24pLFxuICAgIC8vIHRoaXMgbWVhbnMgd2UncmUgcmVhbGx5IGNsb3NlIHRvIHRoZSBzdGFydCB0aW1lIG9mIHRoZSBuZXh0IHNlZ21lbnQuXG4gICAgLy8gVGhlcmVmb3JlLCBhc3N1bWUgdGhpcyBpcyBhIGZsb2F0aW5nLXBvaW50IHByZWNpc2lvbiBpc3N1ZSB3aGVyZSB3ZSB3ZXJlIHRyeWluZyB0byBncmFiIGEgc2VnbWVudFxuICAgIC8vIGJ5IGl0cyBzdGFydCB0aW1lIGFuZCByZXR1cm4gdGhlIG5leHQgc2VnbWVudCBpbnN0ZWFkLlxuICAgIGlmICgoKHNlZ21lbnQuZ2V0U3RhcnRUaW1lKCkgKyBzZWdtZW50LmdldER1cmF0aW9uKCkpIC0gc2Vjb25kcykgPD0gMC4wMDMgKSB7XG4gICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlciArIDEpO1xuICAgIH1cblxuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VVRDV2FsbENsb2NrVGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCB1bml4VGltZVV0Y01pbGxpc2Vjb25kcykge1xuICAgIHZhciB3YWxsQ2xvY2tTdGFydFRpbWUgPSBnZXRVVENXYWxsQ2xvY2tTdGFydFRpbWVGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBwcmVzZW50YXRpb25UaW1lO1xuICAgIGlmIChOdW1iZXIuaXNOYU4od2FsbENsb2NrU3RhcnRUaW1lKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHByZXNlbnRhdGlvblRpbWUgPSAodW5peFRpbWVVdGNNaWxsaXNlY29uZHMgLSB3YWxsQ2xvY2tTdGFydFRpbWUpLzEwMDA7XG4gICAgaWYgKE51bWJlci5pc05hTihwcmVzZW50YXRpb25UaW1lKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lKHJlcHJlc2VudGF0aW9uLCBwcmVzZW50YXRpb25UaW1lKTtcbn07XG5cbmZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICBpZiAoIXJlcHJlc2VudGF0aW9uKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTsgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNlZ21lbnRUZW1wbGF0ZSxcbiAgICB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTtcblxuemVyb1BhZFRvTGVuZ3RoID0gZnVuY3Rpb24gKG51bVN0ciwgbWluU3RyTGVuZ3RoKSB7XG4gICAgd2hpbGUgKG51bVN0ci5sZW5ndGggPCBtaW5TdHJMZW5ndGgpIHtcbiAgICAgICAgbnVtU3RyID0gJzAnICsgbnVtU3RyO1xuICAgIH1cblxuICAgIHJldHVybiBudW1TdHI7XG59O1xuXG5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdG9rZW4sIHZhbHVlKSB7XG5cbiAgICB2YXIgc3RhcnRQb3MgPSAwLFxuICAgICAgICBlbmRQb3MgPSAwLFxuICAgICAgICB0b2tlbkxlbiA9IHRva2VuLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnID0gJyUwJyxcbiAgICAgICAgZm9ybWF0VGFnTGVuID0gZm9ybWF0VGFnLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnUG9zLFxuICAgICAgICBzcGVjaWZpZXIsXG4gICAgICAgIHdpZHRoLFxuICAgICAgICBwYWRkZWRWYWx1ZTtcblxuICAgIC8vIGtlZXAgbG9vcGluZyByb3VuZCB1bnRpbCBhbGwgaW5zdGFuY2VzIG9mIDx0b2tlbj4gaGF2ZSBiZWVuXG4gICAgLy8gcmVwbGFjZWQuIG9uY2UgdGhhdCBoYXMgaGFwcGVuZWQsIHN0YXJ0UG9zIGJlbG93IHdpbGwgYmUgLTFcbiAgICAvLyBhbmQgdGhlIGNvbXBsZXRlZCB1cmwgd2lsbCBiZSByZXR1cm5lZC5cbiAgICB3aGlsZSAodHJ1ZSkge1xuXG4gICAgICAgIC8vIGNoZWNrIGlmIHRoZXJlIGlzIGEgdmFsaWQgJDx0b2tlbj4uLi4kIGlkZW50aWZpZXJcbiAgICAgICAgLy8gaWYgbm90LCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgc3RhcnRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJyArIHRva2VuKTtcbiAgICAgICAgaWYgKHN0YXJ0UG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhlIG5leHQgJyQnIG11c3QgYmUgdGhlIGVuZCBvZiB0aGUgaWRlbnRpZmVyXG4gICAgICAgIC8vIGlmIHRoZXJlIGlzbid0IG9uZSwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIGVuZFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGVuZFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG5vdyBzZWUgaWYgdGhlcmUgaXMgYW4gYWRkaXRpb25hbCBmb3JtYXQgdGFnIHN1ZmZpeGVkIHRvXG4gICAgICAgIC8vIHRoZSBpZGVudGlmaWVyIHdpdGhpbiB0aGUgZW5jbG9zaW5nICckJyBjaGFyYWN0ZXJzXG4gICAgICAgIGZvcm1hdFRhZ1BvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoZm9ybWF0VGFnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGZvcm1hdFRhZ1BvcyA+IHN0YXJ0UG9zICYmIGZvcm1hdFRhZ1BvcyA8IGVuZFBvcykge1xuXG4gICAgICAgICAgICBzcGVjaWZpZXIgPSB0ZW1wbGF0ZVN0ci5jaGFyQXQoZW5kUG9zIC0gMSk7XG4gICAgICAgICAgICB3aWR0aCA9IHBhcnNlSW50KHRlbXBsYXRlU3RyLnN1YnN0cmluZyhmb3JtYXRUYWdQb3MgKyBmb3JtYXRUYWdMZW4sIGVuZFBvcyAtIDEpLCAxMCk7XG5cbiAgICAgICAgICAgIC8vIHN1cHBvcnQgdGhlIG1pbmltdW0gc3BlY2lmaWVycyByZXF1aXJlZCBieSBJRUVFIDEwMDMuMVxuICAgICAgICAgICAgLy8gKGQsIGkgLCBvLCB1LCB4LCBhbmQgWCkgZm9yIGNvbXBsZXRlbmVzc1xuICAgICAgICAgICAgc3dpdGNoIChzcGVjaWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyB0cmVhdCBhbGwgaW50IHR5cGVzIGFzIHVpbnQsXG4gICAgICAgICAgICAgICAgLy8gaGVuY2UgZGVsaWJlcmF0ZSBmYWxsdGhyb3VnaFxuICAgICAgICAgICAgICAgIGNhc2UgJ2QnOlxuICAgICAgICAgICAgICAgIGNhc2UgJ2knOlxuICAgICAgICAgICAgICAgIGNhc2UgJ3UnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnWCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ28nOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZyg4KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnVW5zdXBwb3J0ZWQvaW52YWxpZCBJRUVFIDEwMDMuMSBmb3JtYXQgaWRlbnRpZmllciBzdHJpbmcgaW4gVVJMJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICB0ZW1wbGF0ZVN0ciA9IHRlbXBsYXRlU3RyLnN1YnN0cmluZygwLCBzdGFydFBvcykgKyBwYWRkZWRWYWx1ZSArIHRlbXBsYXRlU3RyLnN1YnN0cmluZyhlbmRQb3MgKyAxKTtcbiAgICB9XG59O1xuXG51bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckJCcpLmpvaW4oJyQnKTtcbn07XG5cbnJlcGxhY2VJREZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckUmVwcmVzZW50YXRpb25JRCQnKSA9PT0gLTEpIHsgcmV0dXJuIHRlbXBsYXRlU3RyOyB9XG4gICAgdmFyIHYgPSB2YWx1ZS50b1N0cmluZygpO1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJFJlcHJlc2VudGF0aW9uSUQkJykuam9pbih2KTtcbn07XG5cbnNlZ21lbnRUZW1wbGF0ZSA9IHtcbiAgICB6ZXJvUGFkVG9MZW5ndGg6IHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZTogcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZTogdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTogcmVwbGFjZUlERm9yVGVtcGxhdGVcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gc2VnbWVudFRlbXBsYXRlOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV2ZW50TWdyID0gcmVxdWlyZSgnLi9ldmVudE1hbmFnZXIuanMnKSxcbiAgICBldmVudERpc3BhdGNoZXJNaXhpbiA9IHtcbiAgICAgICAgdHJpZ2dlcjogZnVuY3Rpb24oZXZlbnRPYmplY3QpIHsgZXZlbnRNZ3IudHJpZ2dlcih0aGlzLCBldmVudE9iamVjdCk7IH0sXG4gICAgICAgIG9uZTogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbmUodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9uOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvZmY6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub2ZmKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9XG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudERpc3BhdGNoZXJNaXhpbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB2aWRlb2pzID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLnZpZGVvanMsXG4gICAgZXZlbnRNYW5hZ2VyID0ge1xuICAgICAgICB0cmlnZ2VyOiB2aWRlb2pzLnRyaWdnZXIsXG4gICAgICAgIG9uZTogdmlkZW9qcy5vbmUsXG4gICAgICAgIG9uOiB2aWRlb2pzLm9uLFxuICAgICAgICBvZmY6IHZpZGVvanMub2ZmXG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudE1hbmFnZXI7XG4iLCIvKipcbiAqXG4gKiBtYWluIHNvdXJjZSBmb3IgcGFja2FnZWQgY29kZS4gQXV0by1ib290c3RyYXBzIHRoZSBzb3VyY2UgaGFuZGxpbmcgZnVuY3Rpb25hbGl0eSBieSByZWdpc3RlcmluZyB0aGUgc291cmNlIGhhbmRsZXJcbiAqIHdpdGggdmlkZW8uanMgb24gaW5pdGlhbCBzY3JpcHQgbG9hZCB2aWEgSUlGRS4gKE5PVEU6IFRoaXMgcGxhY2VzIGFuIG9yZGVyIGRlcGVuZGVuY3kgb24gdGhlIHZpZGVvLmpzIGxpYnJhcnksIHdoaWNoXG4gKiBtdXN0IGFscmVhZHkgYmUgbG9hZGVkIGJlZm9yZSB0aGlzIHNjcmlwdCBhdXRvLWV4ZWN1dGVzLilcbiAqXG4gKi9cbjsoZnVuY3Rpb24oKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIHJvb3QgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JyksXG4gICAgICAgIHZpZGVvanMgPSByb290LnZpZGVvanMsXG4gICAgICAgIFNvdXJjZUhhbmRsZXIgPSByZXF1aXJlKCcuL1NvdXJjZUhhbmRsZXInKSxcbiAgICAgICAgQ2FuSGFuZGxlU291cmNlRW51bSA9IHtcbiAgICAgICAgICAgIERPRVNOVF9IQU5ETEVfU09VUkNFOiAnJyxcbiAgICAgICAgICAgIE1BWUJFX0hBTkRMRV9TT1VSQ0U6ICdtYXliZSdcbiAgICAgICAgfTtcblxuICAgIGlmICghdmlkZW9qcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB2aWRlby5qcyBsaWJyYXJ5IG11c3QgYmUgaW5jbHVkZWQgdG8gdXNlIHRoaXMgTVBFRy1EQVNIIHNvdXJjZSBoYW5kbGVyLicpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogVXNlZCBieSBhIHZpZGVvLmpzIHRlY2ggaW5zdGFuY2UgdG8gdmVyaWZ5IHdoZXRoZXIgb3Igbm90IGEgc3BlY2lmaWMgbWVkaWEgc291cmNlIGNhbiBiZSBoYW5kbGVkIGJ5IHRoaXNcbiAgICAgKiBzb3VyY2UgaGFuZGxlci4gSW4gdGhpcyBjYXNlLCBzaG91bGQgcmV0dXJuICdtYXliZScgaWYgdGhlIHNvdXJjZSBpcyBNUEVHLURBU0gsIG90aGVyd2lzZSAnJyAocmVwcmVzZW50aW5nIG5vKS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7b2JqZWN0fSBzb3VyY2UgICAgICAgICAgIHZpZGVvLmpzIHNvdXJjZSBvYmplY3QgcHJvdmlkaW5nIHNvdXJjZSB1cmkgYW5kIHR5cGUgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7Q2FuSGFuZGxlU291cmNlRW51bX0gICBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2Ygd2hldGhlciBvciBub3QgcGFydGljdWxhciBzb3VyY2UgY2FuIGJlIGhhbmRsZWQgYnkgdGhpc1xuICAgICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZSBoYW5kbGVyLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIGNhbkhhbmRsZVNvdXJjZShzb3VyY2UpIHtcbiAgICAgICAgLy8gUmVxdWlyZXMgTWVkaWEgU291cmNlIEV4dGVuc2lvbnNcbiAgICAgICAgaWYgKCEocm9vdC5NZWRpYVNvdXJjZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLkRPRVNOVF9IQU5ETEVfU09VUkNFO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHR5cGUgaXMgc3VwcG9ydGVkXG4gICAgICAgIGlmICgvYXBwbGljYXRpb25cXC9kYXNoXFwreG1sLy50ZXN0KHNvdXJjZS50eXBlKSkge1xuICAgICAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uTUFZQkVfSEFORExFX1NPVVJDRTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4dGVuc2lvbiBtYXRjaGVzXG4gICAgICAgIGlmICgvXFwubXBkJC9pLnRlc3Qoc291cmNlLnNyYykpIHtcbiAgICAgICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLk1BWUJFX0hBTkRMRV9TT1VSQ0U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5ET0VTTlRfSEFORExFX1NPVVJDRTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIENhbGxlZCBieSBhIHZpZGVvLmpzIHRlY2ggaW5zdGFuY2UgdG8gaGFuZGxlIGEgc3BlY2lmaWMgbWVkaWEgc291cmNlLCByZXR1cm5pbmcgYW4gb2JqZWN0IGluc3RhbmNlIHRoYXQgcHJvdmlkZXNcbiAgICAgKiB0aGUgY29udGV4dCBmb3IgaGFuZGxpbmcgc2FpZCBzb3VyY2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc291cmNlICAgICAgICAgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgc291cmNlIHVyaSBhbmQgdHlwZSBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSB0ZWNoICAgICAgICAgICAgICB2aWRlby5qcyB0ZWNoIG9iamVjdCAoaW4gdGhpcyBjYXNlLCBzaG91bGQgYmUgSHRtbDUgdGVjaCkgcHJvdmlkaW5nIHBvaW50IG9mIGludGVyYWN0aW9uXG4gICAgICogICAgICAgICAgICAgICAgICAgICAgICAgIGJldHdlZW4gdGhlIHNvdXJjZSBoYW5kbGVyIGFuZCB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nLCBlLmcuLCB0aGUgdmlkZW8gZWxlbWVudClcbiAgICAgKiBAcmV0dXJucyB7U291cmNlSGFuZGxlcn0gQW4gb2JqZWN0IHRoYXQgZGVmaW5lcyBjb250ZXh0IGZvciBoYW5kbGluZyBhIHBhcnRpY3VsYXIgTVBFRy1EQVNIIHNvdXJjZS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBoYW5kbGVTb3VyY2Uoc291cmNlLCB0ZWNoKSB7XG4gICAgICAgIHJldHVybiBuZXcgU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpO1xuICAgIH1cblxuICAgIC8vIFJlZ2lzdGVyIHRoZSBzb3VyY2UgaGFuZGxlciB0byB0aGUgSHRtbDUgdGVjaCBpbnN0YW5jZS5cbiAgICB2aWRlb2pzLkh0bWw1LnJlZ2lzdGVyU291cmNlSGFuZGxlcih7XG4gICAgICAgIGNhbkhhbmRsZVNvdXJjZTogY2FuSGFuZGxlU291cmNlLFxuICAgICAgICBoYW5kbGVTb3VyY2U6IGhhbmRsZVNvdXJjZVxuICAgIH0sIDApO1xuXG59LmNhbGwodGhpcykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB0cnV0aHkgPSByZXF1aXJlKCcuLi91dGlsL3RydXRoeS5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi4vdXRpbC9pc1N0cmluZy5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgbG9hZE1hbmlmZXN0ID0gcmVxdWlyZSgnLi9sb2FkTWFuaWZlc3QuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL3V0aWwuanMnKS5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uID0gcmVxdWlyZSgnLi4vZGFzaC9zZWdtZW50cy9nZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uLmpzJyksXG4gICAgZ2V0TXBkID0gcmVxdWlyZSgnLi4vZGFzaC9tcGQvZ2V0TXBkLmpzJyksXG4gICAgZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbixcbiAgICBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUsXG4gICAgZmluZEVsZW1lbnRJbkFycmF5LFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL01lZGlhVHlwZXMuanMnKSxcbiAgICBERUZBVUxUX1RZUEUgPSBtZWRpYVR5cGVzWzBdO1xuXG4vKipcbiAqXG4gKiBGdW5jdGlvbiB1c2VkIHRvIGdldCB0aGUgbWVkaWEgdHlwZSBiYXNlZCBvbiB0aGUgbWltZSB0eXBlLiBVc2VkIHRvIGRldGVybWluZSB0aGUgbWVkaWEgdHlwZSBvZiBBZGFwdGF0aW9uIFNldHNcbiAqIG9yIGNvcnJlc3BvbmRpbmcgZGF0YSByZXByZXNlbnRhdGlvbnMuXG4gKlxuICogQHBhcmFtIG1pbWVUeXBlIHtzdHJpbmd9IG1pbWUgdHlwZSBmb3IgYSBEQVNIIE1QRCBBZGFwdGF0aW9uIFNldCAoc3BlY2lmaWVkIGFzIGFuIGF0dHJpYnV0ZSBzdHJpbmcpXG4gKiBAcGFyYW0gdHlwZXMge3N0cmluZ30gICAgc3VwcG9ydGVkIG1lZGlhIHR5cGVzIChlLmcuICd2aWRlbywnICdhdWRpbywnKVxuICogQHJldHVybnMge3N0cmluZ30gICAgICAgIHRoZSBtZWRpYSB0eXBlIHRoYXQgY29ycmVzcG9uZHMgdG8gdGhlIG1pbWUgdHlwZS5cbiAqL1xuZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlID0gZnVuY3Rpb24obWltZVR5cGUsIHR5cGVzKSB7XG4gICAgaWYgKCFpc1N0cmluZyhtaW1lVHlwZSkpIHsgcmV0dXJuIERFRkFVTFRfVFlQRTsgfSAgIC8vIFRPRE86IFRocm93IGVycm9yP1xuICAgIHZhciBtYXRjaGVkVHlwZSA9IGZpbmRFbGVtZW50SW5BcnJheSh0eXBlcywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgICByZXR1cm4gKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBleGlzdHkobWF0Y2hlZFR5cGUpID8gbWF0Y2hlZFR5cGUgOiBERUZBVUxUX1RZUEU7XG59O1xuXG4vKipcbiAqXG4gKiBGdW5jdGlvbiB1c2VkIHRvIGdldCB0aGUgJ3R5cGUnIG9mIGEgREFTSCBSZXByZXNlbnRhdGlvbiBpbiBhIGZvcm1hdCBleHBlY3RlZCBieSB0aGUgTVNFIFNvdXJjZUJ1ZmZlci4gVXNlZCB0b1xuICogY3JlYXRlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZXMgdGhhdCBjb3JyZXNwb25kIHRvIGEgZ2l2ZW4gTWVkaWFTZXQgKGUuZy4gc2V0IG9mIGF1ZGlvIHN0cmVhbSB2YXJpYW50cywgdmlkZW8gc3RyZWFtXG4gKiB2YXJpYW50cywgZXRjLikuXG4gKlxuICogQHBhcmFtIHJlcHJlc2VudGF0aW9uICAgIFBPSk8gREFTSCBNUEQgUmVwcmVzZW50YXRpb25cbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgICAgICBUaGUgUmVwcmVzZW50YXRpb24ncyAndHlwZScgaW4gYSBmb3JtYXQgZXhwZWN0ZWQgYnkgdGhlIE1TRSBTb3VyY2VCdWZmZXJcbiAqL1xuZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbiA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59O1xuXG5maW5kRWxlbWVudEluQXJyYXkgPSBmdW5jdGlvbihhcnJheSwgcHJlZGljYXRlRm4pIHtcbiAgICBpZiAoIWlzQXJyYXkoYXJyYXkpIHx8ICFpc0Z1bmN0aW9uKHByZWRpY2F0ZUZuKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgdmFyIGksXG4gICAgICAgIGxlbmd0aCA9IGFycmF5Lmxlbmd0aCxcbiAgICAgICAgZWxlbTtcblxuICAgIGZvciAoaT0wOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGVsZW0gPSBhcnJheVtpXTtcbiAgICAgICAgaWYgKHByZWRpY2F0ZUZuKGVsZW0sIGksIGFycmF5KSkgeyByZXR1cm4gZWxlbTsgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG4vKipcbiAqXG4gKiBUaGUgTWFuaWZlc3RDb250cm9sbGVyIGxvYWRzLCBzdG9yZXMsIGFuZCBwcm92aWRlcyBkYXRhIHZpZXdzIGZvciB0aGUgTVBEIG1hbmlmZXN0IHRoYXQgcmVwcmVzZW50cyB0aGVcbiAqIE1QRUctREFTSCBtZWRpYSBzb3VyY2UgYmVpbmcgaGFuZGxlZC5cbiAqXG4gKiBAcGFyYW0gc291cmNlVXJpIHtzdHJpbmd9XG4gKiBAcGFyYW0gYXV0b0xvYWQgIHtib29sZWFufVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIE1hbmlmZXN0Q29udHJvbGxlcihzb3VyY2VVcmksIGF1dG9Mb2FkKSB7XG4gICAgdGhpcy5fX2F1dG9Mb2FkID0gdHJ1dGh5KGF1dG9Mb2FkKTtcbiAgICB0aGlzLnNldFNvdXJjZVVyaShzb3VyY2VVcmkpO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgTUFOSUZFU1RfTE9BREVEOiAnbWFuaWZlc3RMb2FkZWQnXG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFNvdXJjZVVyaSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fc291cmNlVXJpO1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5zZXRTb3VyY2VVcmkgPSBmdW5jdGlvbiBzZXRTb3VyY2VVcmkoc291cmNlVXJpKSB7XG4gICAgLy8gVE9ETzogJ2V4aXN0eSgpJyBjaGVjayBmb3IgYm90aD9cbiAgICBpZiAoc291cmNlVXJpID09PSB0aGlzLl9fc291cmNlVXJpKSB7IHJldHVybjsgfVxuXG4gICAgLy8gVE9ETzogaXNTdHJpbmcoKSBjaGVjaz8gJ2V4aXN0eSgpJyBjaGVjaz9cbiAgICBpZiAoIXNvdXJjZVVyaSkge1xuICAgICAgICB0aGlzLl9fY2xlYXJTb3VyY2VVcmkoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE5lZWQgdG8gcG90ZW50aWFsbHkgcmVtb3ZlIHVwZGF0ZSBpbnRlcnZhbCBmb3IgcmUtcmVxdWVzdGluZyB0aGUgTVBEIG1hbmlmZXN0IChpbiBjYXNlIGl0IGlzIGEgZHluYW1pYyBNUEQpXG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IHNvdXJjZVVyaTtcbiAgICAvLyBJZiB3ZSBzaG91bGQgYXV0b21hdGljYWxseSBsb2FkIHRoZSBNUEQsIGdvIGFoZWFkIGFuZCBraWNrIG9mZiBsb2FkaW5nIGl0LlxuICAgIGlmICh0aGlzLl9fYXV0b0xvYWQpIHtcbiAgICAgICAgLy8gVE9ETzogSW1wbCBhbnkgY2xlYW51cCBmdW5jdGlvbmFsaXR5IGFwcHJvcHJpYXRlIGJlZm9yZSBsb2FkLlxuICAgICAgICB0aGlzLmxvYWQoKTtcbiAgICB9XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLl9fY2xlYXJTb3VyY2VVcmkgPSBmdW5jdGlvbiBjbGVhclNvdXJjZVVyaSgpIHtcbiAgICB0aGlzLl9fc291cmNlVXJpID0gbnVsbDtcbiAgICAvLyBOZWVkIHRvIHBvdGVudGlhbGx5IHJlbW92ZSB1cGRhdGUgaW50ZXJ2YWwgZm9yIHJlLXJlcXVlc3RpbmcgdGhlIE1QRCBtYW5pZmVzdCAoaW4gY2FzZSBpdCBpcyBhIGR5bmFtaWMgTVBEKVxuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIC8vIFRPRE86IGltcGwgYW55IG90aGVyIGNsZWFudXAgZnVuY3Rpb25hbGl0eVxufTtcblxuLyoqXG4gKiBLaWNrIG9mZiBsb2FkaW5nIHRoZSBEQVNIIE1QRCBNYW5pZmVzdCAoc2VydmVkIEAgdGhlIE1hbmlmZXN0Q29udHJvbGxlciBpbnN0YW5jZSdzIF9fc291cmNlVXJpKVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbiBsb2FkKCkge1xuICAgIC8vIFRPRE86IEN1cnJlbnRseSBjbGVhcmluZyAmIHJlLXNldHRpbmcgdXBkYXRlIGludGVydmFsIGFmdGVyIGV2ZXJ5IHJlcXVlc3QuIEVpdGhlciB1c2Ugc2V0VGltZW91dCgpIG9yIG9ubHkgc2V0dXAgaW50ZXJ2YWwgb25jZVxuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBsb2FkTWFuaWZlc3Qoc2VsZi5fX3NvdXJjZVVyaSwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICBzZWxmLl9fbWFuaWZlc3QgPSBkYXRhLm1hbmlmZXN0WG1sO1xuICAgICAgICAvLyAoUG90ZW50aWFsbHkpIHNldHVwIHRoZSB1cGRhdGUgaW50ZXJ2YWwgZm9yIHJlLXJlcXVlc3RpbmcgdGhlIE1QRCAoaW4gY2FzZSB0aGUgbWFuaWZlc3QgaXMgZHluYW1pYylcbiAgICAgICAgc2VsZi5fX3NldHVwVXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAgICAgLy8gRGlzcGF0Y2ggZXZlbnQgdG8gbm90aWZ5IHRoYXQgdGhlIG1hbmlmZXN0IGhhcyBsb2FkZWQuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuTUFOSUZFU1RfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWxmLl9fbWFuaWZlc3R9KTtcbiAgICB9KTtcbn07XG5cbi8qKlxuICogJ1ByaXZhdGUnIG1ldGhvZCB0aGF0IHJlbW92ZXMgdGhlIHVwZGF0ZSBpbnRlcnZhbCAoaWYgaXQgZXhpc3RzKSwgc28gdGhlIE1hbmlmZXN0Q29udHJvbGxlciBpbnN0YW5jZSB3aWxsIG5vIGxvbmdlclxuICogcGVyaW9kaWNhbGx5IHJlLXJlcXVlc3QgdGhlIG1hbmlmZXN0IChpZiBpdCdzIGR5bmFtaWMpLlxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBjbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpKSB7IHJldHVybjsgfVxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fX3VwZGF0ZUludGVydmFsKTtcbn07XG5cbi8qKlxuICogU2V0cyB1cCBhbiBpbnRlcnZhbCB0byByZS1yZXF1ZXN0IHRoZSBtYW5pZmVzdCAoaWYgaXQncyBkeW5hbWljKVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLl9fc2V0dXBVcGRhdGVJbnRlcnZhbCA9IGZ1bmN0aW9uIHNldHVwVXBkYXRlSW50ZXJ2YWwoKSB7XG4gICAgLy8gSWYgdGhlcmUncyBhbHJlYWR5IGFuIHVwZGF0ZUludGVydmFsIGZ1bmN0aW9uLCByZW1vdmUgaXQuXG4gICAgaWYgKHRoaXMuX191cGRhdGVJbnRlcnZhbCkgeyB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTsgfVxuICAgIC8vIElmIHdlIHNob3VsZG4ndCB1cGRhdGUsIGp1c3QgYmFpbC5cbiAgICBpZiAoIXRoaXMuZ2V0U2hvdWxkVXBkYXRlKCkpIHsgcmV0dXJuOyB9XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBtaW5VcGRhdGVSYXRlID0gMixcbiAgICAgICAgdXBkYXRlUmF0ZSA9IE1hdGgubWF4KHRoaXMuZ2V0VXBkYXRlUmF0ZSgpLCBtaW5VcGRhdGVSYXRlKTtcbiAgICAvLyBTZXR1cCB0aGUgdXBkYXRlIGludGVydmFsIGJhc2VkIG9uIHRoZSB1cGRhdGUgcmF0ZSAoZGV0ZXJtaW5lZCBmcm9tIHRoZSBtYW5pZmVzdCkgb3IgdGhlIG1pbmltdW0gdXBkYXRlIHJhdGVcbiAgICAvLyAod2hpY2hldmVyJ3MgbGFyZ2VyKS5cbiAgICAvLyBOT1RFOiBNdXN0IHN0b3JlIHJlZiB0byBjcmVhdGVkIGludGVydmFsIHRvIHBvdGVudGlhbGx5IGNsZWFyL3JlbW92ZSBpdCBsYXRlclxuICAgIHRoaXMuX191cGRhdGVJbnRlcnZhbCA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgICBzZWxmLmxvYWQoKTtcbiAgICB9LCB1cGRhdGVSYXRlICogMTAwMCk7XG59O1xuXG4vKipcbiAqIEdldHMgdGhlIHR5cGUgb2YgcGxheWxpc3QgKCdzdGF0aWMnIG9yICdkeW5hbWljJywgd2hpY2ggbmVhcmx5IGludmFyaWFibHkgY29ycmVzcG9uZHMgdG8gbGl2ZSB2cy4gdm9kKSBkZWZpbmVkIGluIHRoZVxuICogbWFuaWZlc3QuXG4gKlxuICogQHJldHVybnMge3N0cmluZ30gICAgdGhlIHBsYXlsaXN0IHR5cGUgKGVpdGhlciAnc3RhdGljJyBvciAnZHluYW1pYycpXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0UGxheWxpc3RUeXBlID0gZnVuY3Rpb24gZ2V0UGxheWxpc3RUeXBlKCkge1xuICAgIHZhciBwbGF5bGlzdFR5cGUgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRUeXBlKCk7XG4gICAgcmV0dXJuIHBsYXlsaXN0VHlwZTtcbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0VXBkYXRlUmF0ZSA9IGZ1bmN0aW9uIGdldFVwZGF0ZVJhdGUoKSB7XG4gICAgdmFyIG1pbmltdW1VcGRhdGVQZXJpb2RTdHIgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRNaW5pbXVtVXBkYXRlUGVyaW9kKCksXG4gICAgICAgIG1pbmltdW1VcGRhdGVQZXJpb2QgPSBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24obWluaW11bVVwZGF0ZVBlcmlvZFN0cik7XG4gICAgcmV0dXJuIG1pbmltdW1VcGRhdGVQZXJpb2Q7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFNob3VsZFVwZGF0ZSA9IGZ1bmN0aW9uIGdldFNob3VsZFVwZGF0ZSgpIHtcbiAgICB2YXIgaXNEeW5hbWljID0gKHRoaXMuZ2V0UGxheWxpc3RUeXBlKCkgPT09ICdkeW5hbWljJyksXG4gICAgICAgIGhhc1ZhbGlkVXBkYXRlUmF0ZSA9ICh0aGlzLmdldFVwZGF0ZVJhdGUoKSA+IDApO1xuICAgIHJldHVybiAoaXNEeW5hbWljICYmIGhhc1ZhbGlkVXBkYXRlUmF0ZSk7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1wZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBnZXRNcGQodGhpcy5fX21hbmlmZXN0KTtcbn07XG5cbi8qKlxuICpcbiAqIEBwYXJhbSB0eXBlXG4gKiBAcmV0dXJucyB7TWVkaWFTZXR9XG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0TWVkaWFTZXRCeVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVNldEJ5VHlwZSh0eXBlKSB7XG4gICAgaWYgKG1lZGlhVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHsgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHR5cGUuIFZhbHVlIG11c3QgYmUgb25lIG9mOiAnICsgbWVkaWFUeXBlcy5qb2luKCcsICcpKTsgfVxuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCA9IGZpbmRFbGVtZW50SW5BcnJheShhZGFwdGF0aW9uU2V0cywgZnVuY3Rpb24oYWRhcHRhdGlvblNldCkge1xuICAgICAgICAgICAgcmV0dXJuIChnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUoYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKSA9PT0gdHlwZSk7XG4gICAgICAgIH0pO1xuICAgIGlmICghZXhpc3R5KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBuZXcgTWVkaWFTZXQoYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2gpO1xufTtcblxuLyoqXG4gKlxuICogQHJldHVybnMge0FycmF5LjxNZWRpYVNldD59XG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0TWVkaWFTZXRzID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRzKCkge1xuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBtZWRpYVNldHMgPSBhZGFwdGF0aW9uU2V0cy5tYXAoZnVuY3Rpb24oYWRhcHRhdGlvblNldCkgeyByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFTZXRzO1xufTtcblxuLy8gTWl4aW4gZXZlbnQgaGFuZGxpbmcgZm9yIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgb2JqZWN0IHR5cGUgZGVmaW5pdGlvbi5cbmV4dGVuZE9iamVjdChNYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbi8vIFRPRE86IE1vdmUgTWVkaWFTZXQgZGVmaW5pdGlvbiB0byBhIHNlcGFyYXRlIC5qcyBmaWxlP1xuLyoqXG4gKlxuICogUHJpbWFyeSBkYXRhIHZpZXcgZm9yIHJlcHJlc2VudGluZyB0aGUgc2V0IG9mIHNlZ21lbnQgbGlzdHMgYW5kIG90aGVyIGdlbmVyYWwgaW5mb3JtYXRpb24gZm9yIGEgZ2l2ZSBtZWRpYSB0eXBlXG4gKiAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpLlxuICpcbiAqIEBwYXJhbSBhZGFwdGF0aW9uU2V0IFRoZSBNUEVHLURBU0ggY29ycmVsYXRlIGZvciBhIGdpdmVuIG1lZGlhIHNldCwgY29udGFpbmluZyBzb21lIHdheSBvZiByZXByZXNlbnRhdGluZyBzZWdtZW50IGxpc3RzXG4gKiAgICAgICAgICAgICAgICAgICAgICBhbmQgYSBzZXQgb2YgcmVwcmVzZW50YXRpb25zIGZvciBlYWNoIHN0cmVhbSB2YXJpYW50LlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpIHtcbiAgICAvLyBUT0RPOiBBZGRpdGlvbmFsIGNoZWNrcyAmIEVycm9yIFRocm93aW5nXG4gICAgdGhpcy5fX2FkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0O1xufVxuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0TWVkaWFUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFUeXBlKCkge1xuICAgIHZhciB0eXBlID0gZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKHRoaXMuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcyk7XG4gICAgcmV0dXJuIHR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0TWltZVR5cGUgPSBmdW5jdGlvbiBnZXRNaW1lVHlwZSgpIHtcbiAgICB2YXIgbWltZVR5cGUgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpO1xuICAgIHJldHVybiBtaW1lVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJUeXBlID0gZnVuY3Rpb24gZ2V0U291cmNlQnVmZmVyVHlwZSgpIHtcbiAgICAvLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlIGNvZGVjcyBhc3NvY2lhdGVkIHdpdGggZWFjaCBzdHJlYW0gdmFyaWFudC9yZXByZXNlbnRhdGlvblxuICAgIC8vIHdpbGwgYmUgc2ltaWxhciBlbm91Z2ggdGhhdCB5b3Ugd29uJ3QgaGF2ZSB0byByZS1jcmVhdGUgdGhlIHNvdXJjZS1idWZmZXIgd2hlbiBzd2l0Y2hpbmdcbiAgICAvLyBiZXR3ZWVuIHRoZW0uXG5cbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc291cmNlQnVmZmVyVHlwZSA9IGdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzb3VyY2VCdWZmZXJUeXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsRHVyYXRpb24gPSBmdW5jdGlvbiBnZXRUb3RhbER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpO1xuICAgIHJldHVybiB0b3RhbER1cmF0aW9uO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFVUQ1dhbGxDbG9ja1N0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB3YWxsQ2xvY2tUaW1lID0gc2VnbWVudExpc3QuZ2V0VVRDV2FsbENsb2NrU3RhcnRUaW1lKCk7XG4gICAgcmV0dXJuIHdhbGxDbG9ja1RpbWU7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbFNlZ21lbnRDb3VudCA9IGZ1bmN0aW9uIGdldFRvdGFsU2VnbWVudENvdW50KCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbFNlZ21lbnRDb3VudCA9IHNlZ21lbnRMaXN0LmdldFRvdGFsU2VnbWVudENvdW50KCk7XG4gICAgcmV0dXJuIHRvdGFsU2VnbWVudENvdW50O1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnREdXJhdGlvbiA9IGZ1bmN0aW9uIGdldFNlZ21lbnREdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudER1cmF0aW9uID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCk7XG4gICAgcmV0dXJuIHNlZ21lbnREdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RTdGFydE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudExpc3RTdGFydE51bWJlciA9IHNlZ21lbnRMaXN0LmdldFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0U3RhcnROdW1iZXI7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdEVuZE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudExpc3RFbmROdW1iZXIgPSBzZWdtZW50TGlzdC5nZXRFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RFbmROdW1iZXI7XG59O1xuXG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdHMgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdHMoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICBzZWdtZW50TGlzdHMgPSByZXByZXNlbnRhdGlvbnMubWFwKGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzZWdtZW50TGlzdHM7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICByZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCA9IGZpbmRFbGVtZW50SW5BcnJheShyZXByZXNlbnRhdGlvbnMsIGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICB2YXIgcmVwcmVzZW50YXRpb25CYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICAgICAgICAgIHJldHVybiAoTnVtYmVyKHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoKSA9PT0gTnVtYmVyKGJhbmR3aWR0aCkpO1xuICAgICAgICB9KSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uIGdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLm1hcChcbiAgICAgICAgZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuICAgIH0pLmZpbHRlcihcbiAgICAgICAgZnVuY3Rpb24oYmFuZHdpZHRoKSB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCk7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYW5pZmVzdENvbnRyb2xsZXI7IiwibW9kdWxlLmV4cG9ydHMgPSBbJ3ZpZGVvJywgJ2F1ZGlvJ107IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsID0gcmVxdWlyZSgnLi4vZGFzaC9tcGQvdXRpbC5qcycpLnBhcnNlUm9vdFVybDtcblxuZnVuY3Rpb24gbG9hZE1hbmlmZXN0KHVybCwgY2FsbGJhY2spIHtcbiAgICB2YXIgYWN0dWFsVXJsID0gcGFyc2VSb290VXJsKHVybCksXG4gICAgICAgIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKSxcbiAgICAgICAgb25sb2FkO1xuXG4gICAgb25sb2FkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAocmVxdWVzdC5zdGF0dXMgPCAyMDAgfHwgcmVxdWVzdC5zdGF0dXMgPiAyOTkpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFjayh7bWFuaWZlc3RYbWw6IHJlcXVlc3QucmVzcG9uc2VYTUwgfSk7IH1cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdC5vbmxvYWQgPSBvbmxvYWQ7XG4gICAgICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICAgICAgcmVxdWVzdC5zZW5kKCk7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJlcXVlc3Qub25lcnJvcigpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsb2FkTWFuaWZlc3Q7IiwiXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc051bWJlciA9IHJlcXVpcmUoJy4uL3V0aWwvaXNOdW1iZXIuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgbG9hZFNlZ21lbnQsXG4gICAgREVGQVVMVF9SRVRSWV9DT1VOVCA9IDMsXG4gICAgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCA9IDI1MDtcblxuLyoqXG4gKiBHZW5lcmljIGZ1bmN0aW9uIGZvciBsb2FkaW5nIE1QRUctREFTSCBzZWdtZW50c1xuICogQHBhcmFtIHNlZ21lbnQge29iamVjdH0gICAgICAgICAgZGF0YSB2aWV3IHJlcHJlc2VudGluZyBhIHNlZ21lbnQgKGFuZCByZWxldmFudCBkYXRhIGZvciB0aGF0IHNlZ21lbnQpXG4gKiBAcGFyYW0gY2FsbGJhY2tGbiB7ZnVuY3Rpb259ICAgICBjYWxsYmFjayBmdW5jdGlvblxuICogQHBhcmFtIHJldHJ5Q291bnQge251bWJlcn0gICAgICAgc3RpcHVsYXRlcyBob3cgbWFueSB0aW1lcyB3ZSBzaG91bGQgdHJ5IHRvIGxvYWQgdGhlIHNlZ21lbnQgYmVmb3JlIGdpdmluZyB1cFxuICogQHBhcmFtIHJldHJ5SW50ZXJ2YWwge251bWJlcn0gICAgc3RpcHVsYXRlcyB0aGUgYW1vdW50IG9mIHRpbWUgKGluIG1pbGxpc2Vjb25kcykgd2Ugc2hvdWxkIHdhaXQgYmVmb3JlIHJldHJ5aW5nIHRvXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb3dubG9hZCB0aGUgc2VnbWVudCBpZi93aGVuIHRoZSBkb3dubG9hZCBhdHRlbXB0IGZhaWxzLlxuICovXG5sb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQsIHJldHJ5SW50ZXJ2YWwpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IG51bGw7XG5cbiAgICB2YXIgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICB1cmwgPSBzZWdtZW50LmdldFVybCgpO1xuICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICByZXF1ZXN0LnJlc3BvbnNlVHlwZSA9ICdhcnJheWJ1ZmZlcic7XG5cbiAgICByZXF1ZXN0Lm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAocmVxdWVzdC5zdGF0dXMgPCAyMDAgfHwgcmVxdWVzdC5zdGF0dXMgPiAyOTkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgICAgICB9LCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzZWxmLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gTnVtYmVyKChuZXcgRGF0ZSgpLmdldFRpbWUoKSkvMTAwMCk7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFja0ZuID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrRm4uY2FsbChzZWxmLCByZXF1ZXN0LnJlc3BvbnNlKTsgfVxuICAgIH07XG4gICAgLy9yZXF1ZXN0Lm9uZXJyb3IgPSByZXF1ZXN0Lm9ubG9hZGVuZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9LCByZXRyeUludGVydmFsKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9O1xuXG4gICAgc2VsZi5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSA9IE51bWJlcigobmV3IERhdGUoKS5nZXRUaW1lKCkpLzEwMDApO1xuICAgIHJlcXVlc3Quc2VuZCgpO1xufTtcblxuLyoqXG4gKlxuICogU2VnbWVudExvYWRlciBoYW5kbGVzIGxvYWRpbmcgc2VnbWVudHMgZnJvbSBzZWdtZW50IGxpc3RzIGZvciBhIGdpdmVuIG1lZGlhIHNldCwgYmFzZWQgb24gdGhlIGN1cnJlbnRseSBzZWxlY3RlZFxuICogc2VnbWVudCBsaXN0ICh3aGljaCBjb3JyZXNwb25kcyB0byB0aGUgY3VycmVudGx5IHNldCBiYW5kd2lkdGgvYml0cmF0ZSlcbiAqXG4gKiBAcGFyYW0gbWFuaWZlc3RDb250cm9sbGVyIHtNYW5pZmVzdENvbnRyb2xsZXJ9XG4gKiBAcGFyYW0gbWVkaWFUeXBlIHtzdHJpbmd9XG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU2VnbWVudExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhVHlwZSkge1xuICAgIGlmICghZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlcikpIHsgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyIG11c3QgYmUgaW5pdGlhbGl6ZWQgd2l0aCBhIG1hbmlmZXN0Q29udHJvbGxlciEnKTsgfVxuICAgIGlmICghZXhpc3R5KG1lZGlhVHlwZSkpIHsgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyIG11c3QgYmUgaW5pdGlhbGl6ZWQgd2l0aCBhIG1lZGlhVHlwZSEnKTsgfVxuICAgIC8vIE5PVEU6IFJhdGhlciB0aGFuIHBhc3NpbmcgaW4gYSByZWZlcmVuY2UgdG8gdGhlIE1lZGlhU2V0IGluc3RhbmNlIGZvciBhIG1lZGlhIHR5cGUsIHdlIHBhc3MgaW4gYSByZWZlcmVuY2UgdG8gdGhlXG4gICAgLy8gY29udHJvbGxlciAmIHRoZSBtZWRpYVR5cGUgc28gdGhhdCB0aGUgU2VnbWVudExvYWRlciBkb2Vzbid0IG5lZWQgdG8gYmUgYXdhcmUgb2Ygc3RhdGUgY2hhbmdlcy91cGRhdGVzIHRvXG4gICAgLy8gdGhlIG1hbmlmZXN0IGRhdGEgKHNheSwgaWYgdGhlIHBsYXlsaXN0IGlzIGR5bmFtaWMvJ2xpdmUnKS5cbiAgICB0aGlzLl9fbWFuaWZlc3QgPSBtYW5pZmVzdENvbnRyb2xsZXI7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICAvLyBUT0RPOiBEb24ndCBsaWtlIHRoaXM6IE5lZWQgdG8gY2VudHJhbGl6ZSBwbGFjZShzKSB3aGVyZSAmIGhvdyBfX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkIGdldHMgc2V0IHRvIHRydWUvZmFsc2UuXG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSB0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKTtcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSB0cnVlO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIElOSVRJQUxJWkFUSU9OX0xPQURFRDogJ2luaXRpYWxpemF0aW9uTG9hZGVkJyxcbiAgICBTRUdNRU5UX0xPQURFRDogJ3NlZ21lbnRMb2FkZWQnLFxuICAgIERPV05MT0FEX0RBVEFfVVBEQVRFOiAnZG93bmxvYWREYXRhVXBkYXRlJ1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuX19nZXRNZWRpYVNldCA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0KCkge1xuICAgIHZhciBtZWRpYVNldCA9IHRoaXMuX19tYW5pZmVzdC5nZXRNZWRpYVNldEJ5VHlwZSh0aGlzLl9fbWVkaWFUeXBlKTtcbiAgICByZXR1cm4gbWVkaWFTZXQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5fX2dldERlZmF1bHRTZWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldERlZmF1bHRTZWdtZW50TGlzdCgpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdHMoKVswXTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50QmFuZHdpZHRoID0gZnVuY3Rpb24gZ2V0Q3VycmVudEJhbmR3aWR0aCgpIHtcbiAgICBpZiAoIWlzTnVtYmVyKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoKSkgeyB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuX19nZXREZWZhdWx0U2VnbWVudExpc3QoKS5nZXRCYW5kd2lkdGgoKTsgfVxuICAgIHJldHVybiB0aGlzLl9fY3VycmVudEJhbmR3aWR0aDtcbn07XG5cbi8qKlxuICogU2V0cyB0aGUgY3VycmVudCBiYW5kd2lkdGgsIHdoaWNoIGNvcnJlc3BvbmRzIHRvIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0IChpLmUuIHRoZSBzZWdtZW50IGxpc3QgaW4gdGhlXG4gKiBtZWRpYSBzZXQgZnJvbSB3aGljaCB3ZSBzaG91bGQgYmUgZG93bmxvYWRpbmcgc2VnbWVudHMpLlxuICogQHBhcmFtIGJhbmR3aWR0aCB7bnVtYmVyfVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5zZXRDdXJyZW50QmFuZHdpZHRoID0gZnVuY3Rpb24gc2V0Q3VycmVudEJhbmR3aWR0aChiYW5kd2lkdGgpIHtcbiAgICBpZiAoIWlzTnVtYmVyKGJhbmR3aWR0aCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyOjpzZXRDdXJyZW50QmFuZHdpZHRoKCkgZXhwZWN0cyBhIG51bWVyaWMgdmFsdWUgZm9yIGJhbmR3aWR0aCEnKTtcbiAgICB9XG4gICAgdmFyIGF2YWlsYWJsZUJhbmR3aWR0aHMgPSB0aGlzLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKTtcbiAgICBpZiAoYXZhaWxhYmxlQmFuZHdpZHRocy5pbmRleE9mKGJhbmR3aWR0aCkgPCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIG11c3QgYmUgc2V0IHRvIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlczogJyArIGF2YWlsYWJsZUJhbmR3aWR0aHMuam9pbignLCAnKSk7XG4gICAgfVxuICAgIGlmIChiYW5kd2lkdGggPT09IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoKSB7IHJldHVybjsgfVxuICAgIC8vIFRyYWNrIHdoZW4gd2UndmUgc3dpdGNoIGJhbmR3aWR0aHMsIHNpbmNlIHdlJ2xsIG5lZWQgdG8gKHJlKWxvYWQgdGhlIGluaXRpYWxpemF0aW9uIHNlZ21lbnQgZm9yIHRoZSBzZWdtZW50IGxpc3RcbiAgICAvLyB3aGVuZXZlciB3ZSBzd2l0Y2ggYmV0d2VlbiBzZWdtZW50IGxpc3RzLiBUaGlzIGFsbG93cyBTZWdtZW50TG9hZGVyIGluc3RhbmNlcyB0byBhdXRvbWF0aWNhbGx5IGRvIHRoaXMsIGhpZGluZyB0aG9zZVxuICAgIC8vIGRldGFpbHMgZnJvbSB0aGUgb3V0c2lkZS5cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSB0cnVlO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gYmFuZHdpZHRoO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9ICB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoKHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGF2YWlsYWJsZUJhbmR3aWR0aHMgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgcmV0dXJuIGF2YWlsYWJsZUJhbmR3aWR0aHM7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRTdGFydE51bWJlciA9IGZ1bmN0aW9uIGdldFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciBzdGFydE51bWJlciA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIoKTtcbiAgICByZXR1cm4gc3RhcnROdW1iZXI7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50KCkge1xuICAgIHZhciBzZWdtZW50ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRTZWdtZW50QnlOdW1iZXIodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyKTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TnVtYmVyID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIoKSB7IHJldHVybiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXI7IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50U3RhcnRUaW1lID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnRTdGFydFRpbWUoKSB7IHJldHVybiB0aGlzLmdldEN1cnJlbnRTZWdtZW50KCkuZ2V0U3RhcnROdW1iZXIoKTsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0RW5kTnVtYmVyID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGVuZE51bWJlciA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0RW5kTnVtYmVyKCk7XG4gICAgcmV0dXJuIGVuZE51bWJlcjtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBleGlzdHkodGhpcy5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSkgPyB0aGlzLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lIDogLTE7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZXhpc3R5KHRoaXMuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUpID8gdGhpcy5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA6IC0xO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRMYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUoKSAtIHRoaXMuZ2V0TGFzdERvd25sb2FkU3RhcnRUaW1lKCk7XG59O1xuXG4vKipcbiAqXG4gKiBNZXRob2QgZm9yIGRvd25sb2FkaW5nIHRoZSBpbml0aWFsaXphdGlvbiBzZWdtZW50IGZvciB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCAod2hpY2ggY29ycmVzcG9uZHMgdG8gdGhlXG4gKiBjdXJyZW50bHkgc2V0IGJhbmR3aWR0aClcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZEluaXRpYWxpemF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCksXG4gICAgICAgIGluaXRpYWxpemF0aW9uID0gc2VnbWVudExpc3QuZ2V0SW5pdGlhbGl6YXRpb24oKTtcblxuICAgIGlmICghaW5pdGlhbGl6YXRpb24pIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBsb2FkU2VnbWVudC5jYWxsKHRoaXMsIGluaXRpYWxpemF0aW9uLCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTppbml0U2VnbWVudH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkTmV4dFNlZ21lbnQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9DdXJyZW50U2VnbWVudE51bWJlciA9IGV4aXN0eSh0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIpLFxuICAgICAgICBudW1iZXIgPSBub0N1cnJlbnRTZWdtZW50TnVtYmVyID8gdGhpcy5nZXRTdGFydE51bWJlcigpIDogdGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyICsgMTtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2VnbWVudEF0TnVtYmVyKG51bWJlcik7XG59O1xuXG4vLyBUT0RPOiBEdXBsaWNhdGUgY29kZSBiZWxvdy4gQWJzdHJhY3QgYXdheS5cbi8qKlxuICpcbiAqIE1ldGhvZCBmb3IgZG93bmxvYWRpbmcgYSBzZWdtZW50IGZyb20gdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgYmFzZWQgb24gaXRzIFwibnVtYmVyXCIgKHNlZSBwYXJhbSBjb21tZW50IGJlbG93KVxuICpcbiAqIEBwYXJhbSBudW1iZXIge251bWJlcn0gICBJbmRleC1saWtlIHZhbHVlIGZvciBzcGVjaWZ5aW5nIHdoaWNoIHNlZ21lbnQgdG8gbG9hZCBmcm9tIHRoZSBzZWdtZW50IGxpc3QuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdE51bWJlciA9IGZ1bmN0aW9uKG51bWJlcikge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpO1xuXG4gICAgaWYgKG51bWJlciA+IHRoaXMuZ2V0RW5kTnVtYmVyKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeU51bWJlcihudW1iZXIpO1xuXG4gICAgLy8gSWYgdGhlIGJhbmR3aWR0aCBoYXMgY2hhbmdlZCBzaW5jZSBvdXIgbGFzdCBkb3dubG9hZCwgYXV0b21hdGljYWxseSBsb2FkIHRoZSBpbml0aWFsaXphdGlvbiBzZWdtZW50IGZvciB0aGUgY29ycmVzcG9uZGluZ1xuICAgIC8vIHNlZ21lbnQgbGlzdCBiZWZvcmUgZG93bmxvYWRpbmcgdGhlIGRlc2lyZWQgc2VnbWVudClcbiAgICBpZiAodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkKSB7XG4gICAgICAgIHRoaXMub25lKHRoaXMuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBpbml0U2VnbWVudCA9IGV2ZW50LmRhdGE7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpbaW5pdFNlZ21lbnQsIHNlZ21lbnREYXRhXSB9KTtcbiAgICAgICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2FkSW5pdGlhbGl6YXRpb24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvLyBEaXNwYXRjaCBldmVudCB0aGF0IHByb3ZpZGVzIG1ldHJpY3Mgb24gZG93bmxvYWQgcm91bmQgdHJpcCB0aW1lICYgYmFuZHdpZHRoIG9mIHNlZ21lbnQgKHVzZWQgd2l0aCBBQlIgc3dpdGNoaW5nIGxvZ2ljKVxuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTpzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSxcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiBzZWxmLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBydHQ6IHNlbGYuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBsYXliYWNrVGltZTogc2VnbWVudC5nZXREdXJhdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmFuZHdpZHRoOiBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLyoqXG4gKlxuICogTWV0aG9kIGZvciBkb3dubG9hZGluZyBhIHNlZ21lbnQgZnJvbSB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCBiYXNlZCBvbiB0aGUgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgdGhhdFxuICogY29ycmVzcG9uZHMgd2l0aCBhIGdpdmVuIHNlZ21lbnQuXG4gKlxuICogQHBhcmFtIHByZXNlbnRhdGlvblRpbWUge251bWJlcn0gbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgY29ycmVzcG9uZGluZyB0byB0aGUgc2VnbWVudCB3ZSdkIGxpa2UgdG8gbG9hZCBmcm9tIHRoZSBzZWdtZW50IGxpc3RcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGlmIChwcmVzZW50YXRpb25UaW1lID4gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKHByZXNlbnRhdGlvblRpbWUpO1xuXG4gICAgLy8gSWYgdGhlIGJhbmR3aWR0aCBoYXMgY2hhbmdlZCBzaW5jZSBvdXIgbGFzdCBkb3dubG9hZCwgYXV0b21hdGljYWxseSBsb2FkIHRoZSBpbml0aWFsaXphdGlvbiBzZWdtZW50IGZvciB0aGUgY29ycmVzcG9uZGluZ1xuICAgIC8vIHNlZ21lbnQgbGlzdCBiZWZvcmUgZG93bmxvYWRpbmcgdGhlIGRlc2lyZWQgc2VnbWVudClcbiAgICBpZiAodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkKSB7XG4gICAgICAgIHRoaXMub25lKHRoaXMuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBpbml0U2VnbWVudCA9IGV2ZW50LmRhdGE7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpbaW5pdFNlZ21lbnQsIHNlZ21lbnREYXRhXSB9KTtcbiAgICAgICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2FkSW5pdGlhbGl6YXRpb24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvLyBEaXNwYXRjaCBldmVudCB0aGF0IHByb3ZpZGVzIG1ldHJpY3Mgb24gZG93bmxvYWQgcm91bmQgdHJpcCB0aW1lICYgYmFuZHdpZHRoIG9mIHNlZ21lbnQgKHVzZWQgd2l0aCBBQlIgc3dpdGNoaW5nIGxvZ2ljKVxuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTpzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSxcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiBzZWxmLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBydHQ6IHNlbGYuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBsYXliYWNrVGltZTogc2VnbWVudC5nZXREdXJhdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmFuZHdpZHRoOiBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWdtZW50RGF0YSB9KTtcbiAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTZWdtZW50TG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlCYW5kd2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgYmFuZHdpZHRoQSA9IHNlZ21lbnRMaXN0QS5nZXRCYW5kd2lkdGgoKSxcbiAgICAgICAgYmFuZHdpZHRoQiA9IHNlZ21lbnRMaXN0Qi5nZXRCYW5kd2lkdGgoKTtcbiAgICByZXR1cm4gYmFuZHdpZHRoQSAtIGJhbmR3aWR0aEI7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKSB7XG4gICAgdmFyIHdpZHRoQSA9IHNlZ21lbnRMaXN0QS5nZXRXaWR0aCgpIHx8IDAsXG4gICAgICAgIHdpZHRoQiA9IHNlZ21lbnRMaXN0Qi5nZXRXaWR0aCgpIHx8IDA7XG4gICAgcmV0dXJuIHdpZHRoQSAtIHdpZHRoQjtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5V2lkdGhUaGVuQmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKSB7XG4gICAgdmFyIHJlc29sdXRpb25Db21wYXJlID0gY29tcGFyZVNlZ21lbnRMaXN0c0J5V2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpO1xuICAgIHJldHVybiAocmVzb2x1dGlvbkNvbXBhcmUgIT09IDApID8gcmVzb2x1dGlvbkNvbXBhcmUgOiBjb21wYXJlU2VnbWVudExpc3RzQnlCYW5kd2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJTZWdtZW50TGlzdHNCeVJlc29sdXRpb24oc2VnbWVudExpc3QsIG1heFdpZHRoLCBtYXhIZWlnaHQpIHtcbiAgICB2YXIgd2lkdGggPSBzZWdtZW50TGlzdC5nZXRXaWR0aCgpIHx8IDAsXG4gICAgICAgIGhlaWdodCA9IHNlZ21lbnRMaXN0LmdldEhlaWdodCgpIHx8IDA7XG4gICAgcmV0dXJuICgod2lkdGggPD0gbWF4V2lkdGgpICYmIChoZWlnaHQgPD0gbWF4SGVpZ2h0KSk7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclNlZ21lbnRMaXN0c0J5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0LCBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGgsIGRvd25sb2FkUmF0ZVJhdGlvKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0QmFuZHdpZHRoID0gc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgIHNlZ21lbnRCYW5kd2lkdGhSYXRpbyA9IHNlZ21lbnRMaXN0QmFuZHdpZHRoIC8gY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoO1xuICAgIHJldHVybiAoZG93bmxvYWRSYXRlUmF0aW8gPj0gc2VnbWVudEJhbmR3aWR0aFJhdGlvKTtcbn1cblxuLy8gTk9URTogUGFzc2luZyBpbiBtZWRpYVNldCBpbnN0ZWFkIG9mIG1lZGlhU2V0J3MgU2VnbWVudExpc3QgQXJyYXkgc2luY2Ugc29ydCBpcyBkZXN0cnVjdGl2ZSBhbmQgZG9uJ3Qgd2FudCB0byBjbG9uZS5cbi8vICAgICAgQWxzbyBhbGxvd3MgZm9yIGdyZWF0ZXIgZmxleGliaWxpdHkgb2YgZm4uXG5mdW5jdGlvbiBzZWxlY3RTZWdtZW50TGlzdChtZWRpYVNldCwgZGF0YSkge1xuICAgIHZhciBkb3dubG9hZFJhdGVSYXRpbyA9IGRhdGEuZG93bmxvYWRSYXRlUmF0aW8sXG4gICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGRhdGEuY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLFxuICAgICAgICB3aWR0aCA9IGRhdGEud2lkdGgsXG4gICAgICAgIGhlaWdodCA9IGRhdGEuaGVpZ2h0LFxuICAgICAgICBzb3J0ZWRCeUJhbmR3aWR0aCA9IG1lZGlhU2V0LmdldFNlZ21lbnRMaXN0cygpLnNvcnQoY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKSxcbiAgICAgICAgc29ydGVkQnlSZXNvbHV0aW9uVGhlbkJhbmR3aWR0aCA9IG1lZGlhU2V0LmdldFNlZ21lbnRMaXN0cygpLnNvcnQoY29tcGFyZVNlZ21lbnRMaXN0c0J5V2lkdGhUaGVuQmFuZHdpZHRoQXNjZW5kaW5nKSxcbiAgICAgICAgZmlsdGVyZWRCeURvd25sb2FkUmF0ZSxcbiAgICAgICAgZmlsdGVyZWRCeVJlc29sdXRpb24sXG4gICAgICAgIHByb3Bvc2VkU2VnbWVudExpc3Q7XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJCeVJlc29sdXRpb24oc2VnbWVudExpc3QpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlclNlZ21lbnRMaXN0c0J5UmVzb2x1dGlvbihzZWdtZW50TGlzdCwgd2lkdGgsIGhlaWdodCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlclNlZ21lbnRMaXN0c0J5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0LCBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGgsIGRvd25sb2FkUmF0ZVJhdGlvKTtcbiAgICB9XG5cbiAgICBmaWx0ZXJlZEJ5UmVzb2x1dGlvbiA9IHNvcnRlZEJ5UmVzb2x1dGlvblRoZW5CYW5kd2lkdGguZmlsdGVyKGZpbHRlckJ5UmVzb2x1dGlvbik7XG4gICAgZmlsdGVyZWRCeURvd25sb2FkUmF0ZSA9IHNvcnRlZEJ5QmFuZHdpZHRoLmZpbHRlcihmaWx0ZXJCeURvd25sb2FkUmF0ZSk7XG5cbiAgICBwcm9wb3NlZFNlZ21lbnRMaXN0ID0gZmlsdGVyZWRCeVJlc29sdXRpb25bZmlsdGVyZWRCeVJlc29sdXRpb24ubGVuZ3RoIC0gMV0gfHwgZmlsdGVyZWRCeURvd25sb2FkUmF0ZVtmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlLmxlbmd0aCAtIDFdIHx8IHNvcnRlZEJ5QmFuZHdpZHRoWzBdO1xuXG4gICAgcmV0dXJuIHByb3Bvc2VkU2VnbWVudExpc3Q7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gc2VsZWN0U2VnbWVudExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGlzQXJyYXkgPSByZXF1aXJlKCcuLi91dGlsL2lzQXJyYXkuanMnKSxcbiAgICBpc051bWJlciA9IHJlcXVpcmUoJy4uL3V0aWwvaXNOdW1iZXIuanMnKSxcbiAgICBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKTtcblxuZnVuY3Rpb24gY3JlYXRlVGltZVJhbmdlT2JqZWN0KHNvdXJjZUJ1ZmZlciwgaW5kZXgsIHRyYW5zZm9ybUZuKSB7XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHRyYW5zZm9ybUZuKSkge1xuICAgICAgICB0cmFuc2Zvcm1GbiA9IGZ1bmN0aW9uKHRpbWUpIHsgcmV0dXJuIHRpbWU7IH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0U3RhcnQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdHJhbnNmb3JtRm4oc291cmNlQnVmZmVyLmJ1ZmZlcmVkLnN0YXJ0KGluZGV4KSk7IH0sXG4gICAgICAgIGdldEVuZDogZnVuY3Rpb24oKSB7IHJldHVybiB0cmFuc2Zvcm1Gbihzb3VyY2VCdWZmZXIuYnVmZmVyZWQuZW5kKGluZGV4KSk7IH0sXG4gICAgICAgIGdldEluZGV4OiBmdW5jdGlvbigpIHsgcmV0dXJuIGluZGV4OyB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHNvdXJjZUJ1ZmZlciwgdHJhbnNmb3JtRm4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRMZW5ndGg6IGZ1bmN0aW9uKCkgeyByZXR1cm4gc291cmNlQnVmZmVyLmJ1ZmZlcmVkLmxlbmd0aDsgfSxcbiAgICAgICAgZ2V0VGltZVJhbmdlQnlJbmRleDogZnVuY3Rpb24oaW5kZXgpIHsgcmV0dXJuIGNyZWF0ZVRpbWVSYW5nZU9iamVjdChzb3VyY2VCdWZmZXIsIGluZGV4LCB0cmFuc2Zvcm1Gbik7IH0sXG4gICAgICAgIGdldFRpbWVSYW5nZUJ5VGltZTogZnVuY3Rpb24odGltZSwgdG9sZXJhbmNlKSB7XG4gICAgICAgICAgICBpZiAoIWlzTnVtYmVyKHRvbGVyYW5jZSkpIHsgdG9sZXJhbmNlID0gMC4xNTsgfVxuICAgICAgICAgICAgdmFyIHRpbWVSYW5nZU9iaixcbiAgICAgICAgICAgICAgICBpLFxuICAgICAgICAgICAgICAgIGxlbmd0aCA9IHNvdXJjZUJ1ZmZlci5idWZmZXJlZC5sZW5ndGg7XG5cbiAgICAgICAgICAgIGZvciAoaT0wOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGltZVJhbmdlT2JqID0gY3JlYXRlVGltZVJhbmdlT2JqZWN0KHNvdXJjZUJ1ZmZlciwgaSwgdHJhbnNmb3JtRm4pO1xuICAgICAgICAgICAgICAgIGlmICgodGltZVJhbmdlT2JqLmdldFN0YXJ0KCkgLSB0b2xlcmFuY2UpID4gdGltZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgICAgICAgICAgICAgIGlmICgodGltZVJhbmdlT2JqLmdldEVuZCgpICsgdG9sZXJhbmNlKSA+IHRpbWUpIHsgcmV0dXJuIHRpbWVSYW5nZU9iajsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUFsaWduZWRCdWZmZXJlZFRpbWVSYW5nZUxpc3Qoc291cmNlQnVmZmVyLCBzZWdtZW50RHVyYXRpb24pIHtcbiAgICBmdW5jdGlvbiB0aW1lQWxpZ25UcmFuc2Zvcm1Gbih0aW1lKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJvdW5kKHRpbWUgLyBzZWdtZW50RHVyYXRpb24pICogc2VnbWVudER1cmF0aW9uO1xuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVCdWZmZXJlZFRpbWVSYW5nZUxpc3Qoc291cmNlQnVmZmVyLCB0aW1lQWxpZ25UcmFuc2Zvcm1Gbik7XG59XG5cbi8qKlxuICogU291cmNlQnVmZmVyRGF0YVF1ZXVlIGFkZHMvcXVldWVzIHNlZ21lbnRzIHRvIHRoZSBjb3JyZXNwb25kaW5nIE1TRSBTb3VyY2VCdWZmZXIgKE5PVEU6IFRoZXJlIHNob3VsZCBiZSBvbmUgcGVyIG1lZGlhIHR5cGUvbWVkaWEgc2V0KVxuICpcbiAqIEBwYXJhbSBzb3VyY2VCdWZmZXIge1NvdXJjZUJ1ZmZlcn0gICBNU0UgU291cmNlQnVmZmVyIGluc3RhbmNlXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU291cmNlQnVmZmVyRGF0YVF1ZXVlKHNvdXJjZUJ1ZmZlcikge1xuICAgIC8vIFRPRE86IENoZWNrIHR5cGU/XG4gICAgaWYgKCFzb3VyY2VCdWZmZXIpIHsgdGhyb3cgbmV3IEVycm9yKCAnVGhlIHNvdXJjZUJ1ZmZlciBjb25zdHJ1Y3RvciBhcmd1bWVudCBjYW5ub3QgYmUgbnVsbC4nICk7IH1cblxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgZGF0YVF1ZXVlID0gW107XG4gICAgLy8gVE9ETzogZmlndXJlIG91dCBob3cgd2Ugd2FudCB0byByZXNwb25kIHRvIG90aGVyIGV2ZW50IHN0YXRlcyAodXBkYXRlZW5kPyBlcnJvcj8gYWJvcnQ/KSAocmV0cnk/IHJlbW92ZT8pXG4gICAgc291cmNlQnVmZmVyLmFkZEV2ZW50TGlzdGVuZXIoJ3VwZGF0ZWVuZCcsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIC8vIFRoZSBTb3VyY2VCdWZmZXIgaW5zdGFuY2UncyB1cGRhdGluZyBwcm9wZXJ0eSBzaG91bGQgYWx3YXlzIGJlIGZhbHNlIGlmIHRoaXMgZXZlbnQgd2FzIGRpc3BhdGNoZWQsXG4gICAgICAgIC8vIGJ1dCBqdXN0IGluIGNhc2UuLi5cbiAgICAgICAgaWYgKGV2ZW50LnRhcmdldC51cGRhdGluZykgeyByZXR1cm47IH1cblxuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfQURERURfVE9fQlVGRkVSLCB0YXJnZXQ6c2VsZiB9KTtcblxuICAgICAgICBpZiAoc2VsZi5fX2RhdGFRdWV1ZS5sZW5ndGggPD0gMCkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzZWxmLl9fc291cmNlQnVmZmVyLmFwcGVuZEJ1ZmZlcihzZWxmLl9fZGF0YVF1ZXVlLnNoaWZ0KCkpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IGRhdGFRdWV1ZTtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyID0gc291cmNlQnVmZmVyO1xufVxuXG4vKipcbiAqIEVudW1lcmF0aW9uIG9mIGV2ZW50cyBpbnN0YW5jZXMgb2YgdGhpcyBvYmplY3Qgd2lsbCBkaXNwYXRjaC5cbiAqL1xuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUVVFVUVfRU1QVFk6ICdxdWV1ZUVtcHR5JyxcbiAgICBTRUdNRU5UX0FEREVEX1RPX0JVRkZFUjogJ3NlZ21lbnRBZGRlZFRvQnVmZmVyJ1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5hZGRUb1F1ZXVlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBkYXRhVG9BZGRJbW1lZGlhdGVseTtcbiAgICBpZiAoIWV4aXN0eShkYXRhKSB8fCAoaXNBcnJheShkYXRhKSAmJiBkYXRhLmxlbmd0aCA8PSAwKSkgeyByZXR1cm47IH1cbiAgICAvLyBUcmVhdCBhbGwgZGF0YSBhcyBhcnJheXMgdG8gbWFrZSBzdWJzZXF1ZW50IGZ1bmN0aW9uYWxpdHkgZ2VuZXJpYy5cbiAgICBpZiAoIWlzQXJyYXkoZGF0YSkpIHsgZGF0YSA9IFtkYXRhXTsgfVxuICAgIC8vIElmIG5vdGhpbmcgaXMgaW4gdGhlIHF1ZXVlLCBnbyBhaGVhZCBhbmQgaW1tZWRpYXRlbHkgYXBwZW5kIHRoZSBmaXJzdCBkYXRhIHRvIHRoZSBzb3VyY2UgYnVmZmVyLlxuICAgIGlmICgodGhpcy5fX2RhdGFRdWV1ZS5sZW5ndGggPT09IDApICYmICghdGhpcy5fX3NvdXJjZUJ1ZmZlci51cGRhdGluZykpIHsgZGF0YVRvQWRkSW1tZWRpYXRlbHkgPSBkYXRhLnNoaWZ0KCk7IH1cbiAgICAvLyBJZiBhbnkgb3RoZXIgZGF0YSAoc3RpbGwpIGV4aXN0cywgcHVzaCB0aGUgcmVzdCBvbnRvIHRoZSBkYXRhUXVldWUuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IHRoaXMuX19kYXRhUXVldWUuY29uY2F0KGRhdGEpO1xuICAgIGlmIChleGlzdHkoZGF0YVRvQWRkSW1tZWRpYXRlbHkpKSB7IHRoaXMuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKGRhdGFUb0FkZEltbWVkaWF0ZWx5KTsgfVxufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5jbGVhclF1ZXVlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IFtdO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5nZXRCdWZmZXJlZFRpbWVSYW5nZUxpc3QgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gY3JlYXRlQnVmZmVyZWRUaW1lUmFuZ2VMaXN0KHRoaXMuX19zb3VyY2VCdWZmZXIpO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5nZXRCdWZmZXJlZFRpbWVSYW5nZUxpc3RBbGlnbmVkVG9TZWdtZW50RHVyYXRpb24gPSBmdW5jdGlvbihzZWdtZW50RHVyYXRpb24pIHtcbiAgICByZXR1cm4gY3JlYXRlQWxpZ25lZEJ1ZmZlcmVkVGltZVJhbmdlTGlzdCh0aGlzLl9fc291cmNlQnVmZmVyLCBzZWdtZW50RHVyYXRpb24pO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTsiLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIGV4aXN0eSh4KSB7IHJldHVybiAoeCAhPT0gbnVsbCkgJiYgKHggIT09IHVuZGVmaW5lZCk7IH1cblxubW9kdWxlLmV4cG9ydHMgPSBleGlzdHk7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBFeHRlbmQgYSBnaXZlbiBvYmplY3Qgd2l0aCBhbGwgdGhlIHByb3BlcnRpZXMgKGFuZCB0aGVpciB2YWx1ZXMpIGZvdW5kIGluIHRoZSBwYXNzZWQtaW4gb2JqZWN0KHMpLlxudmFyIGV4dGVuZE9iamVjdCA9IGZ1bmN0aW9uKG9iaiAvKiwgZXh0ZW5kT2JqZWN0MSwgZXh0ZW5kT2JqZWN0MiwgLi4uLCBleHRlbmRPYmplY3ROICovKSB7XG4gICAgdmFyIGV4dGVuZE9iamVjdHNBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgIGksXG4gICAgICAgIGxlbmd0aCA9IGV4dGVuZE9iamVjdHNBcnJheS5sZW5ndGgsXG4gICAgICAgIGV4dGVuZE9iamVjdDtcblxuICAgIGZvcihpPTA7IGk8bGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZXh0ZW5kT2JqZWN0ID0gZXh0ZW5kT2JqZWN0c0FycmF5W2ldO1xuICAgICAgICBpZiAoZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgICAgIG9ialtwcm9wXSA9IGV4dGVuZE9iamVjdFtwcm9wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvYmo7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZE9iamVjdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNBcnJheShvYmopIHtcbiAgICByZXR1cm4gb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJztcbiAgICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzRnVuY3Rpb247IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IE51bWJlcl0nIHx8IGZhbHNlO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzTnVtYmVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNTdHJpbmcgPSBmdW5jdGlvbiBpc1N0cmluZyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBTdHJpbmddJyB8fCBmYWxzZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gaXNTdHJpbmc7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi9leGlzdHkuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gdHJ1dGh5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gVE9ETzogUmVmYWN0b3IgdG8gc2VwYXJhdGUganMgZmlsZXMgJiBtb2R1bGVzICYgcmVtb3ZlIGZyb20gaGVyZS5cblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4vdXRpbC9pc1N0cmluZy5qcycpO1xuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxuZnVuY3Rpb24gcHJlQXBwbHlBcmdzRm4oZnVuIC8qLCBhcmdzICovKSB7XG4gICAgdmFyIHByZUFwcGxpZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAvLyBOT1RFOiB0aGUgKnRoaXMqIHJlZmVyZW5jZSB3aWxsIHJlZmVyIHRvIHRoZSBjbG9zdXJlJ3MgY29udGV4dCB1bmxlc3NcbiAgICAvLyB0aGUgcmV0dXJuZWQgZnVuY3Rpb24gaXMgaXRzZWxmIGNhbGxlZCB2aWEgLmNhbGwoKSBvciAuYXBwbHkoKS4gSWYgeW91XG4gICAgLy8gKm5lZWQqIHRvIHJlZmVyIHRvIGluc3RhbmNlLWxldmVsIHByb3BlcnRpZXMsIGRvIHNvbWV0aGluZyBsaWtlIHRoZSBmb2xsb3dpbmc6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IGZ1bmN0aW9uKGFyZ0MpIHsgcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKS5jYWxsKHRoaXMpOyB9O1xuICAgIC8vXG4gICAgLy8gT3RoZXJ3aXNlLCB5b3Ugc2hvdWxkIGJlIGFibGUgdG8ganVzdCBjYWxsOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pO1xuICAgIC8vXG4gICAgLy8gV2hlcmUgcG9zc2libGUsIGZ1bmN0aW9ucyBhbmQgbWV0aG9kcyBzaG91bGQgbm90IGJlIHJlYWNoaW5nIG91dCB0byBnbG9iYWwgc2NvcGUgYW55d2F5LCBzby4uLlxuICAgIHJldHVybiBmdW5jdGlvbigpIHsgcmV0dXJuIGZ1bi5hcHBseSh0aGlzLCBwcmVBcHBsaWVkQXJncyk7IH07XG59XG5cbi8vIEhpZ2hlci1vcmRlciBYTUwgZnVuY3Rpb25zXG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50c1xudmFyIGdldEFuY2VzdG9ycyA9IGZ1bmN0aW9uKGVsZW0sIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgKGZ1bmN0aW9uIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSwgYW5jZXN0b3JzKSkgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKGV4aXN0eShlbGVtKSAmJiBleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkge1xuICAgICAgICAgICAgYW5jZXN0b3JzLnB1c2goZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgICAgIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfSkoZWxlbSk7XG4gICAgcmV0dXJuIGFuY2VzdG9ycztcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXROb2RlTGlzdEJ5TmFtZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oeG1sT2JqKSB7XG4gICAgICAgIHJldHVybiB4bWxPYmouZ2V0RWxlbWVudHNCeVRhZ05hbWUobmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBoYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lLCB2YWx1ZSkge1xuICAgIGlmICgodHlwZW9mIGF0dHJOYW1lICE9PSAnc3RyaW5nJykgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgaWYgKCFleGlzdHkodmFsdWUpKSB7IHJldHVybiBlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgcmV0dXJuIChlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSkgPT09IHZhbHVlKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEF0dHJGbiA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhdHRyTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbi8vIFRPRE86IEFkZCBzaG91bGRTdG9wUHJlZCAoc2hvdWxkIGZ1bmN0aW9uIHNpbWlsYXJseSB0byBzaG91bGRTdG9wUHJlZCBpbiBnZXRJbmhlcml0YWJsZUVsZW1lbnQsIGJlbG93KVxudmFyIGdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhhdHRyTmFtZSkpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKSkgeyByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50czsgUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEluaGVyaXRhYmxlRWxlbWVudCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHJldHVybiBmdW5jdGlvbiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBtYXRjaGluZ0VsZW1MaXN0ID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSk7XG4gICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtTGlzdCkgJiYgbWF0Y2hpbmdFbGVtTGlzdC5sZW5ndGggPiAwKSB7IHJldHVybiBtYXRjaGluZ0VsZW1MaXN0WzBdOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG52YXIgZ2V0Q2hpbGRFbGVtZW50QnlOb2RlTmFtZSA9IGZ1bmN0aW9uKG5vZGVOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgdmFyIGluaXRpYWxNYXRjaGVzID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSksXG4gICAgICAgICAgICBjdXJyZW50RWxlbTtcbiAgICAgICAgaWYgKCFleGlzdHkoaW5pdGlhbE1hdGNoZXMpIHx8IGluaXRpYWxNYXRjaGVzLmxlbmd0aCA8PSAwKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgY3VycmVudEVsZW0gPSBpbml0aWFsTWF0Y2hlc1swXTtcbiAgICAgICAgcmV0dXJuIChjdXJyZW50RWxlbS5wYXJlbnROb2RlID09PSBlbGVtKSA/IGN1cnJlbnRFbGVtIDogdW5kZWZpbmVkO1xuICAgIH07XG59O1xuXG52YXIgZ2V0TXVsdGlMZXZlbEVsZW1lbnRMaXN0ID0gZnVuY3Rpb24obm9kZU5hbWUsIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgdmFyIGdldE1hdGNoaW5nQ2hpbGROb2RlRm4gPSBnZXRDaGlsZEVsZW1lbnRCeU5vZGVOYW1lKG5vZGVOYW1lKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICB2YXIgY3VycmVudEVsZW0gPSBlbGVtLFxuICAgICAgICAgICAgbXVsdGlMZXZlbEVsZW1MaXN0ID0gW10sXG4gICAgICAgICAgICBtYXRjaGluZ0VsZW07XG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugdy9yZWN1cnNpdmUgZm4/XG4gICAgICAgIHdoaWxlIChleGlzdHkoY3VycmVudEVsZW0pICYmICFzaG91bGRTdG9wUHJlZChjdXJyZW50RWxlbSkpIHtcbiAgICAgICAgICAgIG1hdGNoaW5nRWxlbSA9IGdldE1hdGNoaW5nQ2hpbGROb2RlRm4oY3VycmVudEVsZW0pO1xuICAgICAgICAgICAgaWYgKGV4aXN0eShtYXRjaGluZ0VsZW0pKSB7IG11bHRpTGV2ZWxFbGVtTGlzdC5wdXNoKG1hdGNoaW5nRWxlbSk7IH1cbiAgICAgICAgICAgIGN1cnJlbnRFbGVtID0gY3VycmVudEVsZW0ucGFyZW50Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtdWx0aUxldmVsRWxlbUxpc3QubGVuZ3RoID4gMCA/IG11bHRpTGV2ZWxFbGVtTGlzdCA6IHVuZGVmaW5lZDtcbiAgICB9O1xufTtcblxuLy8gVE9ETzogSW1wbGVtZW50IG1lIGZvciBCYXNlVVJMIG9yIHVzZSBleGlzdGluZyBmbiAoU2VlOiBtcGQuanMgYnVpbGRCYXNlVXJsKCkpXG4vKnZhciBidWlsZEhpZXJhcmNoaWNhbGx5U3RydWN0dXJlZFZhbHVlID0gZnVuY3Rpb24odmFsdWVGbiwgYnVpbGRGbiwgc3RvcFByZWQpIHtcblxufTsqL1xuXG4vLyBQdWJsaXNoIEV4dGVybmFsIEFQSTpcbnZhciB4bWxmdW4gPSB7fTtcbnhtbGZ1bi5leGlzdHkgPSBleGlzdHk7XG54bWxmdW4udHJ1dGh5ID0gdHJ1dGh5O1xuXG54bWxmdW4uZ2V0Tm9kZUxpc3RCeU5hbWUgPSBnZXROb2RlTGlzdEJ5TmFtZTtcbnhtbGZ1bi5oYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGhhc01hdGNoaW5nQXR0cmlidXRlO1xueG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0QW5jZXN0b3JzID0gZ2V0QW5jZXN0b3JzO1xueG1sZnVuLmdldEF0dHJGbiA9IGdldEF0dHJGbjtcbnhtbGZ1bi5wcmVBcHBseUFyZ3NGbiA9IHByZUFwcGx5QXJnc0ZuO1xueG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCA9IGdldEluaGVyaXRhYmxlRWxlbWVudDtcbnhtbGZ1bi5nZXRNdWx0aUxldmVsRWxlbWVudExpc3QgPSBnZXRNdWx0aUxldmVsRWxlbWVudExpc3Q7XG5cbm1vZHVsZS5leHBvcnRzID0geG1sZnVuOyJdfQ==
