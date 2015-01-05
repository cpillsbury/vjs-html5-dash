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
        currentBufferSize = sourceBufferDataQueue.determineAmountBufferedFromTime(currentTime),
        segmentDuration = segmentLoader.getCurrentSegmentList().getSegmentDuration(),
        totalDuration = segmentLoader.getCurrentSegmentList().getTotalDuration(),
        downloadPoint = (currentTime + currentBufferSize) + (segmentDuration / 4),
        downloadRoundTripTime,
        segmentDownloadDelay;

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

    if (currentBufferSize <= 0) {
        // Condition 1: Nothing is in the source buffer starting at the current time for the media type
        // Response: Download the segment for the current time right now.
        self.__loadSegmentAtTime(currentTime);
    } else if (currentBufferSize < minDesiredBufferSize) {
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
                currentTime = tech.currentTime();
                currentBufferSize = sourceBufferDataQueue.determineAmountBufferedFromTime(currentTime);
                downloadPoint = (currentTime + currentBufferSize) + (segmentDuration / 2);
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

    // For each of the media types (e.g. 'audio' & 'video') in the ABR manifest...
    this.__mediaTypeLoaders.forEach(function(mediaTypeLoader) {
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
    });

    // NOTE: This code block handles pseudo-'pausing'/'unpausing' (changing the playbackRate) based on whether or not
    // there is data available in the buffer, but indirectly, by listening to a few events and using the video element's
    // ready state.
    var changePlaybackRateEvents = ['seeking', 'canplay', 'canplaythrough'];
    changePlaybackRateEvents.forEach(function(eventType) {
        tech.on(eventType, function(event) {
            var readyState = tech.el().readyState,
                playbackRate = (readyState === 4) ? 1 : 0;
            tech.setPlaybackRate(playbackRate);
        });
    });
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
    //var baseUrls = _.map(elemHierarchy, function(elem) {
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

var getSegmentTemplateXml = xmlfun.getInheritableElement('SegmentTemplate', doesntHaveCommonProperties);

// MPD Attr fns
var getMediaPresentationDuration = xmlfun.getAttrFn('mediaPresentationDuration'),
    getType = xmlfun.getAttrFn('type'),
    getMinimumUpdatePeriod = xmlfun.getAttrFn('minimumUpdatePeriod');

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
        getMinimumUpdatePeriod: xmlfun.preApplyArgsFn(getMinimumUpdatePeriod, xmlNode)
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
            return createSegmentTemplate(getSegmentTemplateXml(xmlNode));
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
            return createSegmentTemplate(getSegmentTemplateXml(xmlNode));
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

createSegmentTemplate = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getAdaptationSet: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlfun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getInitialization: xmlfun.preApplyArgsFn(getInitialization, xmlNode),
        getMedia: xmlfun.preApplyArgsFn(getMedia, xmlNode),
        getDuration: xmlfun.preApplyArgsFn(getDuration, xmlNode),
        getTimescale: xmlfun.preApplyArgsFn(getTimescale, xmlNode),
        getPresentationTimeOffset: xmlfun.preApplyArgsFn(getPresentationTimeOffset, xmlNode),
        getStartNumber: xmlfun.preApplyArgsFn(getStartNumber, xmlNode)
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
},{"../../xmlfun.js":25,"./util.js":6}],6:[function(require,module,exports){
'use strict';

var parseRootUrl,
    // TODO: Should presentationDuration parsing be in util or somewhere else?
    parseMediaPresentationDuration,
    SECONDS_IN_YEAR = 365 * 24 * 60 * 60,
    SECONDS_IN_MONTH = 30 * 24 * 60 * 60, // not precise!
    SECONDS_IN_DAY = 24 * 60 * 60,
    SECONDS_IN_HOUR = 60 * 60,
    SECONDS_IN_MIN = 60,
    MINUTES_IN_HOUR = 60,
    MILLISECONDS_IN_SECONDS = 1000,
    durationRegex = /^P(([\d.]*)Y)?(([\d.]*)M)?(([\d.]*)D)?T?(([\d.]*)H)?(([\d.]*)M)?(([\d.]*)S)?/;

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
    var match = durationRegex.exec(str);
    return (parseFloat(match[2] || 0) * SECONDS_IN_YEAR +
        parseFloat(match[4] || 0) * SECONDS_IN_MONTH +
        parseFloat(match[6] || 0) * SECONDS_IN_DAY +
        parseFloat(match[8] || 0) * SECONDS_IN_HOUR +
        parseFloat(match[10] || 0) * SECONDS_IN_MIN +
        parseFloat(match[12] || 0));
};

var util = {
    parseRootUrl: parseRootUrl,
    parseMediaPresentationDuration: parseMediaPresentationDuration
};

module.exports = util;
},{}],7:[function(require,module,exports){
'use strict';

var existy = require('../../util/existy.js'),
    xmlfun = require('../../xmlfun.js'),
    parseMediaPresentationDuration = require('../mpd/util.js').parseMediaPresentationDuration,
    segmentTemplate = require('./segmentTemplate'),
    createSegmentListFromTemplate,
    createSegmentFromTemplateByNumber,
    createSegmentFromTemplateByTime,
    getType,
    getBandwidth,
    getWidth,
    getHeight,
    getTotalDurationFromTemplate,
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
        parsedMediaPresentationDuration = existy(mediaPresentationDuration) ? Number(parseMediaPresentationDuration(mediaPresentationDuration)) : Number.NaN,
        presentationTimeOffset = Number(representation.getSegmentTemplate().getPresentationTimeOffset());
    return existy(parsedMediaPresentationDuration) ? Number(parsedMediaPresentationDuration - presentationTimeOffset) : Number.NaN;
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
        getBandwidth: xmlfun.preApplyArgsFn(getBandwidth, representation),
        getHeight: xmlfun.preApplyArgsFn(getHeight, representation),
        getWidth: xmlfun.preApplyArgsFn(getWidth, representation),
        getTotalDuration: xmlfun.preApplyArgsFn(getTotalDurationFromTemplate, representation),
        getSegmentDuration: xmlfun.preApplyArgsFn(getSegmentDurationFromTemplate, representation),
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
        getSegmentByTime: function(seconds) { return createSegmentFromTemplateByTime(representation, seconds); }
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
        return number * getSegmentDurationFromTemplate(representation);
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
        number = Math.floor(seconds / segmentDuration),
        segment = createSegmentFromTemplateByNumber(representation, number);
    return segment;
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
    loadManifest = require('./loadManifest.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    getSegmentListForRepresentation = require('../dash/segments/getSegmentListForRepresentation.js'),
    getMpd = require('../dash/mpd/getMpd.js'),
    getSourceBufferTypeFromRepresentation,
    getMediaTypeFromMimeType,
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
    var matchedType = types.find(function(type) {
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
    if (this.__updateInterval) { self.__clearCurrentUpdateInterval(); }
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
    var minimumUpdatePeriod = getMpd(this.__manifest).getMinimumUpdatePeriod();
    return Number(minimumUpdatePeriod);
};

ManifestController.prototype.getShouldUpdate = function getShouldUpdate() {
    var isDynamic = (this.getPlaylistType() === 'dynamic'),
        hasValidUpdateRate = (this.getUpdateRate() > 0);
    return (isDynamic && hasValidUpdateRate);
};

/**
 *
 * @param type
 * @returns {MediaSet}
 */
ManifestController.prototype.getMediaSetByType = function getMediaSetByType(type) {
    if (mediaTypes.indexOf(type) < 0) { throw new Error('Invalid type. Value must be one of: ' + mediaTypes.join(', ')); }
    var adaptationSets = getMpd(this.__manifest).getPeriods()[0].getAdaptationSets(),
        adaptationSetWithTypeMatch = adaptationSets.find(function(adaptationSet) {
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
        representationWithBandwidthMatch = representations.find(function(representation) {
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
},{"../dash/mpd/getMpd.js":5,"../dash/segments/getSegmentListForRepresentation.js":7,"../events/EventDispatcherMixin.js":9,"../util/existy.js":18,"../util/extendObject.js":19,"../util/isFunction.js":21,"../util/isString.js":23,"../util/truthy.js":24,"./MediaTypes.js":13,"./loadManifest.js":14}],13:[function(require,module,exports){
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

    console.log('BANDWIDTH OF SEGMENT BEING REQUESTED: ' + segmentList.getBandwidth());

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

    console.log('BANDWIDTH OF SEGMENT BEING REQUESTED: ' + segmentList.getBandwidth());

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
    existy = require('../util/existy.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js');

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

// TODO: Add as "class" properties?
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

SourceBufferDataQueue.prototype.hasBufferedDataForTime = function(presentationTime) {
    return checkTimeRangesForTime(this.__sourceBuffer.buffered, presentationTime, function(startTime, endTime) {
        return ((startTime >= 0) || (endTime >= 0));
    });
};

SourceBufferDataQueue.prototype.determineAmountBufferedFromTime = function(presentationTime) {
    // If the return value is < 0, no data is buffered @ presentationTime.
    return checkTimeRangesForTime(this.__sourceBuffer.buffered, presentationTime,
        function(startTime, endTime, presentationTime) {
            return endTime - presentationTime;
        }
    );
};

function checkTimeRangesForTime(timeRanges, time, callback) {
    var timeRangesLength = timeRanges.length,
        i = 0,
        currentStartTime,
        currentEndTime;

    for (i; i<timeRangesLength; i++) {
        currentStartTime = timeRanges.start(i);
        currentEndTime = timeRanges.end(i);
        if ((time >= currentStartTime) && (time <= currentEndTime)) {
            return isFunction(callback) ? callback(currentStartTime, currentEndTime, time) : true;
        } else if (currentStartTime > time) {
            // If the currentStartTime is greater than the time we're looking for, that means we've reached a time range
            // that's past the time we're looking for (since TimeRanges should be ordered chronologically). If so, we
            // can short circuit.
            break;
        }
    }

    return isFunction(callback) ? callback(-1, -1, time) : false;
}

// Add event dispatcher functionality to prototype.
extendObject(SourceBufferDataQueue.prototype, EventDispatcherMixin);

module.exports = SourceBufferDataQueue;
},{"../events/EventDispatcherMixin.js":9,"../util/existy.js":18,"../util/extendObject.js":19,"../util/isArray.js":20,"../util/isFunction.js":21}],18:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],19:[function(require,module,exports){
'use strict';

// Extend a given object with all the properties (and their values) found in the passed-in object(s).
var extendObject = function(obj /*, extendObject1, extendObject2, ..., extendObjectN */) {
    Array.prototype.slice.call(arguments, 1).forEach(function(extendObject) {
        if (extendObject) {
            for (var prop in extendObject) {
                obj[prop] = extendObject[prop];
            }
        }
    });
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

module.exports = xmlfun;
},{"./util/existy.js":18,"./util/isFunction.js":21,"./util/isString.js":23}]},{},[11])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekxBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25OQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFRBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiKGZ1bmN0aW9uIChnbG9iYWwpe1xuaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHdpbmRvdztcbn0gZWxzZSBpZiAodHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZ2xvYmFsO1xufSBlbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIil7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBzZWxmO1xufSBlbHNlIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHt9O1xufVxuXG59KS5jYWxsKHRoaXMsdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSkiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICAvLyBUT0RPOiBEZXRlcm1pbmUgYXBwcm9wcmlhdGUgZGVmYXVsdCBzaXplIChvciBiYXNlIG9uIHNlZ21lbnQgbiB4IHNpemUvZHVyYXRpb24/KVxuICAgIC8vIE11c3QgY29uc2lkZXIgQUJSIFN3aXRjaGluZyAmIFZpZXdpbmcgZXhwZXJpZW5jZSBvZiBhbHJlYWR5LWJ1ZmZlcmVkIHNlZ21lbnRzLlxuICAgIE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFID0gMjAsXG4gICAgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUgPSA0MDtcblxuLyoqXG4gKlxuICogTWVkaWFUeXBlTG9hZGVyIGNvb3JkaW5hdGVzIGJldHdlZW4gc2VnbWVudCBkb3dubG9hZGluZyBhbmQgYWRkaW5nIHNlZ21lbnRzIHRvIHRoZSBNU0Ugc291cmNlIGJ1ZmZlciBmb3IgYSBnaXZlbiBtZWRpYSB0eXBlIChlLmcuICdhdWRpbycgb3IgJ3ZpZGVvJykuXG4gKlxuICogQHBhcmFtIHNlZ21lbnRMb2FkZXIge1NlZ21lbnRMb2FkZXJ9ICAgICAgICAgICAgICAgICBvYmplY3QgaW5zdGFuY2UgdGhhdCBoYW5kbGVzIGRvd25sb2FkaW5nIHNlZ21lbnRzIGZvciB0aGUgbWVkaWEgc2V0XG4gKiBAcGFyYW0gc291cmNlQnVmZmVyRGF0YVF1ZXVlIHtTb3VyY2VCdWZmZXJEYXRhUXVldWV9IG9iamVjdCBpbnN0YW5jZSB0aGF0IGhhbmRsZXMgYWRkaW5nIHNlZ21lbnRzIHRvIE1TRSBTb3VyY2VCdWZmZXJcbiAqIEBwYXJhbSBtZWRpYVR5cGUge3N0cmluZ30gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgbWVkaWEgdHlwZSAoZS5nLiAnYXVkaW8nIG9yICd2aWRlbycpIGZvciB0aGUgbWVkaWEgc2V0XG4gKiBAcGFyYW0gdGVjaCB7b2JqZWN0fSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZGVvLmpzIEh0bWw1IHRlY2ggaW5zdGFuY2UuXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gTWVkaWFUeXBlTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX3NlZ21lbnRMb2FkZXIgPSBzZWdtZW50TG9hZGVyO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWU7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBSRUNIRUNLX1NFR01FTlRfTE9BRElORzogJ3JlY2hlY2tTZWdtZW50TG9hZGluZycsXG4gICAgUkVDSEVDS19DVVJSRU5UX1NFR01FTlRfTElTVDogJ3JlY2hlY2tDdXJyZW50U2VnbWVudExpc3QnXG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX21lZGlhVHlwZTsgfTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRTZWdtZW50TG9hZGVyID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc2VnbWVudExvYWRlcjsgfTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWU7IH07XG5cbi8qKlxuICogS2lja3Mgb2ZmIHNlZ21lbnQgbG9hZGluZyBmb3IgdGhlIG1lZGlhIHNldFxuICovXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLnN0YXJ0TG9hZGluZ1NlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gRXZlbnQgbGlzdGVuZXIgZm9yIHJlY2hlY2tpbmcgc2VnbWVudCBsb2FkaW5nLiBUaGlzIGV2ZW50IGlzIGZpcmVkIHdoZW5ldmVyIGEgc2VnbWVudCBoYXMgYmVlbiBzdWNjZXNzZnVsbHlcbiAgICAvLyBkb3dubG9hZGVkIGFuZCBhZGRlZCB0byB0aGUgYnVmZmVyIG9yLCBpZiBub3QgY3VycmVudGx5IGxvYWRpbmcgc2VnbWVudHMgKGJlY2F1c2UgdGhlIGJ1ZmZlciBpcyBzdWZmaWNpZW50bHkgZnVsbFxuICAgIC8vIHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHBsYXliYWNrIHRpbWUpLCB3aGVuZXZlciBzb21lIGFtb3VudCBvZiB0aW1lIGhhcyBlbGFwc2VkIGFuZCB3ZSBzaG91bGQgY2hlY2sgb24gdGhlIGJ1ZmZlclxuICAgIC8vIHN0YXRlIGFnYWluLlxuICAgIC8vIE5PVEU6IFN0b3JlIGEgcmVmZXJlbmNlIHRvIHRoZSBldmVudCBoYW5kbGVyIHRvIHBvdGVudGlhbGx5IHJlbW92ZSBpdCBsYXRlci5cbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19DVVJSRU5UX1NFR01FTlRfTElTVCwgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIHNlbGYuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG4gICAgfTtcblxuICAgIHRoaXMub24odGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcblxuICAgIC8vIE1hbnVhbGx5IGNoZWNrIG9uIGxvYWRpbmcgc2VnbWVudHMgdGhlIGZpcnN0IHRpbWUgYXJvdW5kLlxuICAgIHRoaXMuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLnN0b3BMb2FkaW5nU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcikpIHsgcmV0dXJuOyB9XG5cbiAgICB0aGlzLm9mZih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gdW5kZWZpbmVkO1xufTtcblxuLyoqXG4gKlxuICogQHBhcmFtIG1pbkRlc2lyZWRCdWZmZXJTaXplIHtudW1iZXJ9IFRoZSBzdGlwdWxhdGVkIG1pbmltdW0gYW1vdW50IG9mIHRpbWUgKGluIHNlY29uZHMpIHdlIHdhbnQgaW4gdGhlIHBsYXliYWNrIGJ1ZmZlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudCBwbGF5YmFjayB0aW1lKSBmb3IgdGhlIG1lZGlhIHR5cGUuXG4gKiBAcGFyYW0gbWF4RGVzaXJlZEJ1ZmZlclNpemUge251bWJlcn0gVGhlIHN0aXB1bGF0ZWQgbWF4aW11bSBhbW91bnQgb2YgdGltZSAoaW4gc2Vjb25kcykgd2Ugd2FudCBpbiB0aGUgcGxheWJhY2sgYnVmZmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHBsYXliYWNrIHRpbWUpIGZvciB0aGUgbWVkaWEgdHlwZS5cbiAqIEBwcml2YXRlXG4gKi9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuX19jaGVja1NlZ21lbnRMb2FkaW5nID0gZnVuY3Rpb24obWluRGVzaXJlZEJ1ZmZlclNpemUsIG1heERlc2lyZWRCdWZmZXJTaXplKSB7XG4gICAgLy8gVE9ETzogVXNlIHNlZ21lbnQgZHVyYXRpb24gd2l0aCBjdXJyZW50VGltZSAmIGN1cnJlbnRCdWZmZXJTaXplIHRvIGNhbGN1bGF0ZSB3aGljaCBzZWdtZW50IHRvIGdyYWIgdG8gYXZvaWQgZWRnZSBjYXNlcyB3L3JvdW5kaW5nICYgcHJlY2lzaW9uXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICB0ZWNoID0gc2VsZi5fX3RlY2gsXG4gICAgICAgIHNlZ21lbnRMb2FkZXIgPSBzZWxmLl9fc2VnbWVudExvYWRlcixcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc2VsZi5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSxcbiAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCksXG4gICAgICAgIGN1cnJlbnRCdWZmZXJTaXplID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlLmRldGVybWluZUFtb3VudEJ1ZmZlcmVkRnJvbVRpbWUoY3VycmVudFRpbWUpLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnREdXJhdGlvbigpLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRUb3RhbER1cmF0aW9uKCksXG4gICAgICAgIGRvd25sb2FkUG9pbnQgPSAoY3VycmVudFRpbWUgKyBjdXJyZW50QnVmZmVyU2l6ZSkgKyAoc2VnbWVudER1cmF0aW9uIC8gNCksXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSxcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXk7XG5cbiAgICAvLyBMb2NhbCBmdW5jdGlvbiB1c2VkIHRvIG5vdGlmeSB0aGF0IHdlIHNob3VsZCByZWNoZWNrIHNlZ21lbnQgbG9hZGluZy4gVXNlZCB3aGVuIHdlIGRvbid0IG5lZWQgdG8gY3VycmVudGx5IGxvYWQgc2VnbWVudHMuXG4gICAgZnVuY3Rpb24gZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCkge1xuICAgICAgICB2YXIgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9LCByZWNoZWNrV2FpdFRpbWVNUyk7XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIHByb3Bvc2VkIHRpbWUgdG8gZG93bmxvYWQgaXMgYWZ0ZXIgdGhlIGVuZCB0aW1lIG9mIHRoZSBtZWRpYSBvciB3ZSBoYXZlIG1vcmUgaW4gdGhlIGJ1ZmZlciB0aGFuIHRoZSBtYXggZGVzaXJlZCxcbiAgICAvLyB3YWl0IGEgd2hpbGUgYW5kIHRoZW4gdHJpZ2dlciBhbiBldmVudCBub3RpZnlpbmcgdGhhdCAoaWYgYW55b25lJ3MgbGlzdGVuaW5nKSB3ZSBzaG91bGQgcmVjaGVjayB0byBzZWUgaWYgY29uZGl0aW9uc1xuICAgIC8vIGhhdmUgY2hhbmdlZC5cbiAgICAvLyBUT0RPOiBIYW5kbGUgY29uZGl0aW9uIHdoZXJlIGZpbmFsIHNlZ21lbnQncyBkdXJhdGlvbiBpcyBsZXNzIHRoYW4gMS8yIHN0YW5kYXJkIHNlZ21lbnQncyBkdXJhdGlvbi5cbiAgICBpZiAoZG93bmxvYWRQb2ludCA+PSB0b3RhbER1cmF0aW9uKSB7XG4gICAgICAgIGRlZmVycmVkUmVjaGVja05vdGlmaWNhdGlvbigpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDw9IDApIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDE6IE5vdGhpbmcgaXMgaW4gdGhlIHNvdXJjZSBidWZmZXIgc3RhcnRpbmcgYXQgdGhlIGN1cnJlbnQgdGltZSBmb3IgdGhlIG1lZGlhIHR5cGVcbiAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IGZvciB0aGUgY3VycmVudCB0aW1lIHJpZ2h0IG5vdy5cbiAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGN1cnJlbnRUaW1lKTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWluRGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDI6IFRoZXJlJ3Mgc29tZXRoaW5nIGluIHRoZSBzb3VyY2UgYnVmZmVyIHN0YXJ0aW5nIGF0IHRoZSBjdXJyZW50IHRpbWUgZm9yIHRoZSBtZWRpYSB0eXBlLCBidXQgaXQnc1xuICAgICAgICAvLyAgICAgICAgICAgICAgYmVsb3cgdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSAoc2Vjb25kcyBvZiBwbGF5YmFjayBpbiB0aGUgYnVmZmVyIGZvciB0aGUgbWVkaWEgdHlwZSlcbiAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgdGltZSkuXG4gICAgICAgIC8vICAgICAgICAgICByaWdodCBub3cuXG4gICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDM6IFRoZSBidWZmZXIgaXMgZnVsbCBtb3JlIHRoYW4gdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSBidXQgbm90IHlldCBtb3JlIHRoYW4gdGhlIG1heGltdW0gZGVzaXJlZFxuICAgICAgICAvLyAgICAgICAgICAgICAgYnVmZmVyIHNpemUuXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSA9IHNlZ21lbnRMb2FkZXIuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKTtcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXkgPSBzZWdtZW50RHVyYXRpb24gLSBkb3dubG9hZFJvdW5kVHJpcFRpbWU7XG4gICAgICAgIGlmIChzZWdtZW50RG93bmxvYWREZWxheSA8PSAwKSB7XG4gICAgICAgICAgICAvLyBDb25kaXRpb24gM2E6IEl0IHRvb2sgYXQgbGVhc3QgYXMgbG9uZyBhcyB0aGUgZHVyYXRpb24gb2YgYSBzZWdtZW50IChpLmUuIHRoZSBhbW91bnQgb2YgdGltZSBpdCB3b3VsZCB0YWtlXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIHRvIHBsYXkgYSBnaXZlbiBzZWdtZW50KSB0byBkb3dubG9hZCB0aGUgcHJldmlvdXMgc2VnbWVudC5cbiAgICAgICAgICAgIC8vIFJlc3BvbnNlOiBEb3dubG9hZCB0aGUgc2VnbWVudCB0aGF0IHdvdWxkIGltbWVkaWF0ZWx5IGZvbGxvdyB0aGUgZW5kIG9mIHRoZSBidWZmZXIgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50XG4gICAgICAgICAgICAvLyAgICAgICAgICAgdGltZSkgcmlnaHQgbm93LlxuICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQ29uZGl0aW9uIDNiOiBEb3dubG9hZGluZyB0aGUgcHJldmlvdXMgc2VnbWVudCB0b29rIGxlc3MgdGltZSB0aGFuIHRoZSBkdXJhdGlvbiBvZiBhIHNlZ21lbnQgKGkuZS4gdGhlIGFtb3VudFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICBvZiB0aW1lIGl0IHdvdWxkIHRha2UgdG8gcGxheSBhIGdpdmVuIHNlZ21lbnQpLlxuICAgICAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnRcbiAgICAgICAgICAgIC8vICAgICAgICAgICB0aW1lKSwgYnV0IHdhaXQgdG8gZG93bmxvYWQgYXQgdGhlIHJhdGUgb2YgcGxheWJhY2sgKHNlZ21lbnQgZHVyYXRpb24gLSB0aW1lIHRvIGRvd25sb2FkKS5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCk7XG4gICAgICAgICAgICAgICAgY3VycmVudEJ1ZmZlclNpemUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWUuZGV0ZXJtaW5lQW1vdW50QnVmZmVyZWRGcm9tVGltZShjdXJyZW50VGltZSk7XG4gICAgICAgICAgICAgICAgZG93bmxvYWRQb2ludCA9IChjdXJyZW50VGltZSArIGN1cnJlbnRCdWZmZXJTaXplKSArIChzZWdtZW50RHVyYXRpb24gLyAyKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDQgKGRlZmF1bHQpOiBUaGUgYnVmZmVyIGhhcyBhdCBsZWFzdCB0aGUgbWF4IGRlc2lyZWQgYnVmZmVyIHNpemUgaW4gaXQgb3Igbm9uZSBvZiB0aGUgYWZvcmVtZW50aW9uZWRcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgICAgICAgICBjb25kaXRpb25zIHdlcmUgbWV0LlxuICAgICAgICAvLyBSZXNwb25zZTogV2FpdCBhIHdoaWxlIGFuZCB0aGVuIHRyaWdnZXIgYW4gZXZlbnQgbm90aWZ5aW5nIHRoYXQgKGlmIGFueW9uZSdzIGxpc3RlbmluZykgd2Ugc2hvdWxkIHJlY2hlY2sgdG9cbiAgICAgICAgLy8gICAgICAgICAgIHNlZSBpZiBjb25kaXRpb25zIGhhdmUgY2hhbmdlZC5cbiAgICAgICAgZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCk7XG4gICAgfVxufTtcblxuLyoqXG4gKiBEb3dubG9hZCBhIHNlZ21lbnQgZnJvbSB0aGUgY3VycmVudCBzZWdtZW50IGxpc3QgY29ycmVzcG9uZGluZyB0byB0aGUgc3RpcHVsYXRlZCBtZWRpYSBwcmVzZW50YXRpb24gdGltZSBhbmQgYWRkIGl0XG4gKiB0byB0aGUgc291cmNlIGJ1ZmZlci5cbiAqXG4gKiBAcGFyYW0gcHJlc2VudGF0aW9uVGltZSB7bnVtYmVyfSBUaGUgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgZm9yIHdoaWNoIHdlIHdhbnQgdG8gZG93bmxvYWQgYW5kIGJ1ZmZlciBhIHNlZ21lbnRcbiAqIEByZXR1cm5zIHtib29sZWFufSAgICAgICAgICAgICAgIFdoZXRoZXIgb3Igbm90IHRoZSB0aGVyZSBhcmUgc3Vic2VxdWVudCBzZWdtZW50cyBpbiB0aGUgc2VnbWVudCBsaXN0LCByZWxhdGl2ZSB0byB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lZGlhIHByZXNlbnRhdGlvbiB0aW1lIHJlcXVlc3RlZC5cbiAqIEBwcml2YXRlXG4gKi9cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuX19sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uIGxvYWRTZWdtZW50QXRUaW1lKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMb2FkZXIgPSBzZWxmLl9fc2VnbWVudExvYWRlcixcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc2VsZi5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSxcbiAgICAgICAgaGFzTmV4dFNlZ21lbnQgPSBzZWdtZW50TG9hZGVyLmxvYWRTZWdtZW50QXRUaW1lKHByZXNlbnRhdGlvblRpbWUpO1xuXG4gICAgaWYgKCFoYXNOZXh0U2VnbWVudCkgeyByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7IH1cblxuICAgIHNlZ21lbnRMb2FkZXIub25lKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCBmdW5jdGlvbiBzZWdtZW50TG9hZGVkSGFuZGxlcihldmVudCkge1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUub25lKHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5ldmVudExpc3QuUVVFVUVfRU1QVFksIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAvLyBPbmNlIHdlJ3ZlIGNvbXBsZXRlZCBkb3dubG9hZGluZyBhbmQgYnVmZmVyaW5nIHRoZSBzZWdtZW50LCBkaXNwYXRjaCBldmVudCB0byBub3RpZnkgdGhhdCB3ZSBzaG91bGQgcmVjaGVja1xuICAgICAgICAgICAgLy8gd2hldGhlciBvciBub3Qgd2Ugc2hvdWxkIGxvYWQgYW5vdGhlciBzZWdtZW50IGFuZCwgaWYgc28sIHdoaWNoLiAoU2VlOiBfX2NoZWNrU2VnbWVudExvYWRpbmcoKSBtZXRob2QsIGFib3ZlKVxuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUuYWRkVG9RdWV1ZShldmVudC5kYXRhKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBoYXNOZXh0U2VnbWVudDtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KE1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNZWRpYVR5cGVMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIFNlZ21lbnRMb2FkZXIgPSByZXF1aXJlKCcuL3NlZ21lbnRzL1NlZ21lbnRMb2FkZXIuanMnKSxcbiAgICBTb3VyY2VCdWZmZXJEYXRhUXVldWUgPSByZXF1aXJlKCcuL3NvdXJjZUJ1ZmZlci9Tb3VyY2VCdWZmZXJEYXRhUXVldWUuanMnKSxcbiAgICBNZWRpYVR5cGVMb2FkZXIgPSByZXF1aXJlKCcuL01lZGlhVHlwZUxvYWRlci5qcycpLFxuICAgIHNlbGVjdFNlZ21lbnRMaXN0ID0gcmVxdWlyZSgnLi9zZWxlY3RTZWdtZW50TGlzdC5qcycpLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL21hbmlmZXN0L01lZGlhVHlwZXMuanMnKTtcblxuLy8gVE9ETzogTWlncmF0ZSBtZXRob2RzIGJlbG93IHRvIGEgZmFjdG9yeS5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUpIHtcbiAgICB2YXIgc291cmNlQnVmZmVyVHlwZSA9IG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpLmdldFNvdXJjZUJ1ZmZlclR5cGUoKSxcbiAgICAgICAgLy8gVE9ETzogVHJ5L2NhdGNoIGJsb2NrP1xuICAgICAgICBzb3VyY2VCdWZmZXIgPSBtZWRpYVNvdXJjZS5hZGRTb3VyY2VCdWZmZXIoc291cmNlQnVmZmVyVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpIHtcbiAgICB2YXIgc2VnbWVudExvYWRlciA9IG5ldyBTZWdtZW50TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFUeXBlKSxcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBNZWRpYVR5cGVMb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBtZWRpYVR5cGUsIHRlY2gpO1xufVxuXG4vKipcbiAqXG4gKiBGYWN0b3J5LXN0eWxlIGZ1bmN0aW9uIGZvciBjcmVhdGluZyBhIHNldCBvZiBNZWRpYVR5cGVMb2FkZXJzIGJhc2VkIG9uIHdoYXQncyBkZWZpbmVkIGluIHRoZSBtYW5pZmVzdCBhbmQgd2hhdCBtZWRpYSB0eXBlcyBhcmUgc3VwcG9ydGVkLlxuICpcbiAqIEBwYXJhbSBtYW5pZmVzdENvbnRyb2xsZXIge01hbmlmZXN0Q29udHJvbGxlcn0gICBjb250cm9sbGVyIHRoYXQgcHJvdmlkZXMgZGF0YSB2aWV3cyBmb3IgdGhlIEFCUiBwbGF5bGlzdCBtYW5pZmVzdCBkYXRhXG4gKiBAcGFyYW0gbWVkaWFTb3VyY2Uge01lZGlhU291cmNlfSAgICAgICAgICAgICAgICAgTVNFIE1lZGlhU291cmNlIGluc3RhbmNlIGNvcnJlc3BvbmRpbmcgdG8gdGhlIGN1cnJlbnQgQUJSIHBsYXlsaXN0XG4gKiBAcGFyYW0gdGVjaCB7b2JqZWN0fSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBvYmplY3QgaW5zdGFuY2VcbiAqIEByZXR1cm5zIHtBcnJheS48TWVkaWFUeXBlTG9hZGVyPn0gICAgICAgICAgICAgICBTZXQgb2YgTWVkaWFUeXBlTG9hZGVycyBmb3IgbG9hZGluZyBzZWdtZW50cyBmb3IgYSBnaXZlbiBtZWRpYSB0eXBlIChlLmcuIGF1ZGlvIG9yIHZpZGVvKVxuICovXG5mdW5jdGlvbiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgbWF0Y2hlZFR5cGVzID0gbWVkaWFUeXBlcy5maWx0ZXIoZnVuY3Rpb24obWVkaWFUeXBlKSB7XG4gICAgICAgICAgICB2YXIgZXhpc3RzID0gZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpKTtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHM7IH0pLFxuICAgICAgICBtZWRpYVR5cGVMb2FkZXJzID0gbWF0Y2hlZFR5cGVzLm1hcChmdW5jdGlvbihtZWRpYVR5cGUpIHsgcmV0dXJuIGNyZWF0ZU1lZGlhVHlwZUxvYWRlckZvclR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlLCB0ZWNoKTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhVHlwZUxvYWRlcnM7XG59XG5cbi8qKlxuICpcbiAqIFBsYXlsaXN0TG9hZGVyIGhhbmRsZXMgdGhlIHRvcC1sZXZlbCBsb2FkaW5nIGFuZCBwbGF5YmFjayBvZiBzZWdtZW50cyBmb3IgYWxsIG1lZGlhIHR5cGVzIChlLmcuIGJvdGggYXVkaW8gYW5kIHZpZGVvKS5cbiAqIFRoaXMgaW5jbHVkZXMgY2hlY2tpbmcgaWYgaXQgc2hvdWxkIHN3aXRjaCBzZWdtZW50IGxpc3RzLCB1cGRhdGluZy9yZXRyaWV2aW5nIGRhdGEgcmVsZXZhbnQgdG8gdGhlc2UgZGVjaXNpb24gZm9yXG4gKiBlYWNoIG1lZGlhIHR5cGUuIEl0IGFsc28gaW5jbHVkZXMgY2hhbmdpbmcgdGhlIHBsYXliYWNrIHJhdGUgb2YgdGhlIHZpZGVvIGJhc2VkIG9uIGRhdGEgYXZhaWxhYmxlIGluIHRoZSBzb3VyY2UgYnVmZmVyLlxuICpcbiAqIEBwYXJhbSBtYW5pZmVzdENvbnRyb2xsZXIge01hbmlmZXN0Q29udHJvbGxlcn0gICBjb250cm9sbGVyIHRoYXQgcHJvdmlkZXMgZGF0YSB2aWV3cyBmb3IgdGhlIEFCUiBwbGF5bGlzdCBtYW5pZmVzdCBkYXRhXG4gKiBAcGFyYW0gbWVkaWFTb3VyY2Uge01lZGlhU291cmNlfSAgICAgICAgICAgICAgICAgTVNFIE1lZGlhU291cmNlIGluc3RhbmNlIGNvcnJlc3BvbmRpbmcgdG8gdGhlIGN1cnJlbnQgQUJSIHBsYXlsaXN0XG4gKiBAcGFyYW0gdGVjaCB7b2JqZWN0fSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBvYmplY3QgaW5zdGFuY2VcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xuICAgIHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzID0gY3JlYXRlTWVkaWFUeXBlTG9hZGVycyhtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcblxuICAgIC8vIEZvciBlYWNoIG9mIHRoZSBtZWRpYSB0eXBlcyAoZS5nLiAnYXVkaW8nICYgJ3ZpZGVvJykgaW4gdGhlIEFCUiBtYW5pZmVzdC4uLlxuICAgIHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzLmZvckVhY2goZnVuY3Rpb24obWVkaWFUeXBlTG9hZGVyKSB7XG4gICAgICAgIC8vIE1lZGlhU2V0LXNwZWNpZmljIHZhcmlhYmxlc1xuICAgICAgICB2YXIgc2VnbWVudExvYWRlciA9IG1lZGlhVHlwZUxvYWRlci5nZXRTZWdtZW50TG9hZGVyKCksXG4gICAgICAgICAgICBkb3dubG9hZFJhdGVSYXRpbyA9IDEuMCxcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgICAgICBtZWRpYVR5cGUgPSBtZWRpYVR5cGVMb2FkZXIuZ2V0TWVkaWFUeXBlKCk7XG5cbiAgICAgICAgLy8gTGlzdGVuIGZvciBldmVudCB0ZWxsaW5nIHVzIHRvIHJlY2hlY2sgd2hpY2ggc2VnbWVudCBsaXN0IHRoZSBzZWdtZW50cyBzaG91bGQgYmUgbG9hZGVkIGZyb20uXG4gICAgICAgIG1lZGlhVHlwZUxvYWRlci5vbihtZWRpYVR5cGVMb2FkZXIuZXZlbnRMaXN0LlJFQ0hFQ0tfQ1VSUkVOVF9TRUdNRU5UX0xJU1QsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgbWVkaWFTZXQgPSBtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSxcbiAgICAgICAgICAgICAgICBpc0Z1bGxzY3JlZW4gPSB0ZWNoLnBsYXllcigpLmlzRnVsbHNjcmVlbigpLFxuICAgICAgICAgICAgICAgIGRhdGEgPSB7fSxcbiAgICAgICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0O1xuXG4gICAgICAgICAgICBkYXRhLmRvd25sb2FkUmF0ZVJhdGlvID0gZG93bmxvYWRSYXRlUmF0aW87XG4gICAgICAgICAgICBkYXRhLmN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcblxuICAgICAgICAgICAgLy8gUmF0aGVyIHRoYW4gbW9uaXRvcmluZyBldmVudHMvdXBkYXRpbmcgc3RhdGUsIHNpbXBseSBnZXQgcmVsZXZhbnQgdmlkZW8gdmlld3BvcnQgZGltcyBvbiB0aGUgZmx5IGFzIG5lZWRlZC5cbiAgICAgICAgICAgIGRhdGEud2lkdGggPSBpc0Z1bGxzY3JlZW4gPyB3aW5kb3cuc2NyZWVuLndpZHRoIDogdGVjaC5wbGF5ZXIoKS53aWR0aCgpO1xuICAgICAgICAgICAgZGF0YS5oZWlnaHQgPSBpc0Z1bGxzY3JlZW4gPyB3aW5kb3cuc2NyZWVuLmhlaWdodCA6IHRlY2gucGxheWVyKCkuaGVpZ2h0KCk7XG5cbiAgICAgICAgICAgIHNlbGVjdGVkU2VnbWVudExpc3QgPSBzZWxlY3RTZWdtZW50TGlzdChtZWRpYVNldCwgZGF0YSk7XG5cbiAgICAgICAgICAgIC8vIFRPRE86IFNob3VsZCB3ZSByZWZhY3RvciB0byBzZXQgYmFzZWQgb24gc2VnbWVudExpc3QgaW5zdGVhZD9cbiAgICAgICAgICAgIC8vIChQb3RlbnRpYWxseSkgdXBkYXRlIHdoaWNoIHNlZ21lbnQgbGlzdCB0aGUgc2VnbWVudHMgc2hvdWxkIGJlIGxvYWRlZCBmcm9tIChiYXNlZCBvbiBzZWdtZW50IGxpc3QncyBiYW5kd2lkdGgvYml0cmF0ZSlcbiAgICAgICAgICAgIHNlZ21lbnRMb2FkZXIuc2V0Q3VycmVudEJhbmR3aWR0aChzZWxlY3RlZFNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gVXBkYXRlIHRoZSBkb3dubG9hZCByYXRlIChyb3VuZCB0cmlwIHRpbWUgdG8gZG93bmxvYWQgYSBzZWdtZW50IG9mIGEgZ2l2ZW4gYXZlcmFnZSBiYW5kd2lkdGgvYml0cmF0ZSkgdG8gdXNlXG4gICAgICAgIC8vIHdpdGggY2hvb3Npbmcgd2hpY2ggc3RyZWFtIHZhcmlhbnQgdG8gbG9hZCBzZWdtZW50cyBmcm9tLlxuICAgICAgICBzZWdtZW50TG9hZGVyLm9uKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LkRPV05MT0FEX0RBVEFfVVBEQVRFLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgZG93bmxvYWRSYXRlUmF0aW8gPSBldmVudC5kYXRhLnBsYXliYWNrVGltZSAvIGV2ZW50LmRhdGEucnR0O1xuICAgICAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gZXZlbnQuZGF0YS5iYW5kd2lkdGg7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEtpY2tvZmYgc2VnbWVudCBsb2FkaW5nIGZvciB0aGUgbWVkaWEgdHlwZS5cbiAgICAgICAgbWVkaWFUeXBlTG9hZGVyLnN0YXJ0TG9hZGluZ1NlZ21lbnRzKCk7XG4gICAgfSk7XG5cbiAgICAvLyBOT1RFOiBUaGlzIGNvZGUgYmxvY2sgaGFuZGxlcyBwc2V1ZG8tJ3BhdXNpbmcnLyd1bnBhdXNpbmcnIChjaGFuZ2luZyB0aGUgcGxheWJhY2tSYXRlKSBiYXNlZCBvbiB3aGV0aGVyIG9yIG5vdFxuICAgIC8vIHRoZXJlIGlzIGRhdGEgYXZhaWxhYmxlIGluIHRoZSBidWZmZXIsIGJ1dCBpbmRpcmVjdGx5LCBieSBsaXN0ZW5pbmcgdG8gYSBmZXcgZXZlbnRzIGFuZCB1c2luZyB0aGUgdmlkZW8gZWxlbWVudCdzXG4gICAgLy8gcmVhZHkgc3RhdGUuXG4gICAgdmFyIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50cyA9IFsnc2Vla2luZycsICdjYW5wbGF5JywgJ2NhbnBsYXl0aHJvdWdoJ107XG4gICAgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZXZlbnRUeXBlKSB7XG4gICAgICAgIHRlY2gub24oZXZlbnRUeXBlLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIHJlYWR5U3RhdGUgPSB0ZWNoLmVsKCkucmVhZHlTdGF0ZSxcbiAgICAgICAgICAgICAgICBwbGF5YmFja1JhdGUgPSAocmVhZHlTdGF0ZSA9PT0gNCkgPyAxIDogMDtcbiAgICAgICAgICAgIHRlY2guc2V0UGxheWJhY2tSYXRlKHBsYXliYWNrUmF0ZSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFBsYXlsaXN0TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIE1lZGlhU291cmNlID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLk1lZGlhU291cmNlLFxuICAgIE1hbmlmZXN0Q29udHJvbGxlciA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWFuaWZlc3RDb250cm9sbGVyLmpzJyksXG4gICAgUGxheWxpc3RMb2FkZXIgPSByZXF1aXJlKCcuL1BsYXlsaXN0TG9hZGVyLmpzJyk7XG5cbi8vIFRPRE86IERJU1BPU0UgTUVUSE9EXG4vKipcbiAqXG4gKiBDbGFzcyB0aGF0IGRlZmluZXMgdGhlIHJvb3QgY29udGV4dCBmb3IgaGFuZGxpbmcgYSBzcGVjaWZpYyBNUEVHLURBU0ggbWVkaWEgc291cmNlLlxuICpcbiAqIEBwYXJhbSBzb3VyY2UgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHNvdXJjZSwgc3VjaCBhcyB0aGUgdXJpIChzcmMpIGFuZCB0aGUgdHlwZSAodHlwZSlcbiAqIEBwYXJhbSB0ZWNoICAgICAgdmlkZW8uanMgSHRtbDUgdGVjaCBvYmplY3QgcHJvdmlkaW5nIHRoZSBwb2ludCBvZiBpbnRlcmFjdGlvbiBiZXR3ZWVuIHRoZSBTb3VyY2VIYW5kbGVyIGluc3RhbmNlIGFuZFxuICogICAgICAgICAgICAgICAgICB0aGUgdmlkZW8uanMgbGlicmFyeSAoaW5jbHVkaW5nIGUuZy4gdGhlIHZpZGVvIGVsZW1lbnQpXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1hbmlmZXN0Q29udHJvbGxlciA9IG5ldyBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlLnNyYywgZmFsc2UpO1xuXG4gICAgbWFuaWZlc3RDb250cm9sbGVyLm9uZShtYW5pZmVzdENvbnRyb2xsZXIuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgdmFyIG1lZGlhU291cmNlID0gbmV3IE1lZGlhU291cmNlKCksXG4gICAgICAgICAgICBvcGVuTGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1lZGlhU291cmNlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fcGxheWxpc3RMb2FkZXIgPSBuZXcgUGxheWxpc3RMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgY2xvc2UuXG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignd2Via2l0c291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgICAgIHRlY2guc2V0U3JjKFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpKTtcbiAgICB9KTtcblxuICAgIG1hbmlmZXN0Q29udHJvbGxlci5sb2FkKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlSGFuZGxlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKSxcbiAgICBwYXJzZVJvb3RVcmwgPSB1dGlsLnBhcnNlUm9vdFVybCxcbiAgICBjcmVhdGVNcGRPYmplY3QsXG4gICAgY3JlYXRlUGVyaW9kT2JqZWN0LFxuICAgIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QsXG4gICAgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QsXG4gICAgY3JlYXRlU2VnbWVudFRlbXBsYXRlLFxuICAgIGdldE1wZCxcbiAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlLFxuICAgIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsXG4gICAgZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWU7XG5cbi8vIFRPRE86IFNob3VsZCB0aGlzIGV4aXN0IG9uIG1wZCBkYXRhdmlldyBvciBhdCBhIGhpZ2hlciBsZXZlbD9cbi8vIFRPRE86IFJlZmFjdG9yLiBDb3VsZCBiZSBtb3JlIGVmZmljaWVudCAoUmVjdXJzaXZlIGZuPyBVc2UgZWxlbWVudC5nZXRFbGVtZW50c0J5TmFtZSgnQmFzZVVybCcpWzBdPykuXG4vLyBUT0RPOiBDdXJyZW50bHkgYXNzdW1pbmcgKkVJVEhFUiogPEJhc2VVUkw+IG5vZGVzIHdpbGwgcHJvdmlkZSBhbiBhYnNvbHV0ZSBiYXNlIHVybCAoaWUgcmVzb2x2ZSB0byAnaHR0cDovLycgZXRjKVxuLy8gVE9ETzogKk9SKiB3ZSBzaG91bGQgdXNlIHRoZSBiYXNlIHVybCBvZiB0aGUgaG9zdCBvZiB0aGUgTVBEIG1hbmlmZXN0LlxudmFyIGJ1aWxkQmFzZVVybCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICB2YXIgZWxlbUhpZXJhcmNoeSA9IFt4bWxOb2RlXS5jb25jYXQoeG1sZnVuLmdldEFuY2VzdG9ycyh4bWxOb2RlKSksXG4gICAgICAgIGZvdW5kTG9jYWxCYXNlVXJsID0gZmFsc2U7XG4gICAgLy92YXIgYmFzZVVybHMgPSBfLm1hcChlbGVtSGllcmFyY2h5LCBmdW5jdGlvbihlbGVtKSB7XG4gICAgdmFyIGJhc2VVcmxzID0gZWxlbUhpZXJhcmNoeS5tYXAoZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoZm91bmRMb2NhbEJhc2VVcmwpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIGlmICghZWxlbS5oYXNDaGlsZE5vZGVzKCkpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBjaGlsZDtcbiAgICAgICAgZm9yICh2YXIgaT0wOyBpPGVsZW0uY2hpbGROb2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBlbGVtLmNoaWxkTm9kZXMuaXRlbShpKTtcbiAgICAgICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0Jhc2VVUkwnKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRFbGVtID0gY2hpbGQuY2hpbGROb2Rlcy5pdGVtKDApO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0VmFsdWUgPSB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgICAgIGlmICh0ZXh0VmFsdWUuaW5kZXhPZignaHR0cDovLycpID09PSAwKSB7IGZvdW5kTG9jYWxCYXNlVXJsID0gdHJ1ZTsgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH0pO1xuXG4gICAgdmFyIGJhc2VVcmwgPSBiYXNlVXJscy5yZXZlcnNlKCkuam9pbignJyk7XG4gICAgaWYgKCFiYXNlVXJsKSB7IHJldHVybiBwYXJzZVJvb3RVcmwoeG1sTm9kZS5iYXNlVVJJKTsgfVxuICAgIHJldHVybiBiYXNlVXJsO1xufTtcblxudmFyIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMgPSBbXG4gICAgJ0FkYXB0YXRpb25TZXQnLFxuICAgICdSZXByZXNlbnRhdGlvbicsXG4gICAgJ1N1YlJlcHJlc2VudGF0aW9uJ1xuXTtcblxudmFyIGhhc0NvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMuaW5kZXhPZihlbGVtLm5vZGVOYW1lKSA+PSAwO1xufTtcblxudmFyIGRvZXNudEhhdmVDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiAhaGFzQ29tbW9uUHJvcGVydGllcyhlbGVtKTtcbn07XG5cbi8vIENvbW1vbiBBdHRyc1xudmFyIGdldFdpZHRoID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCd3aWR0aCcpLFxuICAgIGdldEhlaWdodCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnaGVpZ2h0JyksXG4gICAgZ2V0RnJhbWVSYXRlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdmcmFtZVJhdGUnKSxcbiAgICBnZXRNaW1lVHlwZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnbWltZVR5cGUnKSxcbiAgICBnZXRDb2RlY3MgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2NvZGVjcycpO1xuXG52YXIgZ2V0U2VnbWVudFRlbXBsYXRlWG1sID0geG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCgnU2VnbWVudFRlbXBsYXRlJywgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMpO1xuXG4vLyBNUEQgQXR0ciBmbnNcbnZhciBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbicpLFxuICAgIGdldFR5cGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0eXBlJyksXG4gICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21pbmltdW1VcGRhdGVQZXJpb2QnKTtcblxuLy8gUmVwcmVzZW50YXRpb24gQXR0ciBmbnNcbnZhciBnZXRJZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2lkJyksXG4gICAgZ2V0QmFuZHdpZHRoID0geG1sZnVuLmdldEF0dHJGbignYmFuZHdpZHRoJyk7XG5cbi8vIFNlZ21lbnRUZW1wbGF0ZSBBdHRyIGZuc1xudmFyIGdldEluaXRpYWxpemF0aW9uID0geG1sZnVuLmdldEF0dHJGbignaW5pdGlhbGl6YXRpb24nKSxcbiAgICBnZXRNZWRpYSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhJyksXG4gICAgZ2V0RHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdkdXJhdGlvbicpLFxuICAgIGdldFRpbWVzY2FsZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVzY2FsZScpLFxuICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdwcmVzZW50YXRpb25UaW1lT2Zmc2V0JyksXG4gICAgZ2V0U3RhcnROdW1iZXIgPSB4bWxmdW4uZ2V0QXR0ckZuKCdzdGFydE51bWJlcicpO1xuXG4vLyBUT0RPOiBSZXBlYXQgY29kZS4gQWJzdHJhY3QgYXdheSAoUHJvdG90eXBhbCBJbmhlcml0YW5jZS9PTyBNb2RlbD8gT2JqZWN0IGNvbXBvc2VyIGZuPylcbmNyZWF0ZU1wZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UGVyaW9kczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbmltdW1VcGRhdGVQZXJpb2QsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWwoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElkLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgeG1sTm9kZSksXG4gICAgICAgIGdldEZyYW1lUmF0ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEZyYW1lUmF0ZSwgeG1sTm9kZSksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldENvZGVjczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldENvZGVjcywgeG1sTm9kZSksXG4gICAgICAgIGdldEJhc2VVcmw6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihidWlsZEJhc2VVcmwsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50VGVtcGxhdGUgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SW5pdGlhbGl6YXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRNZWRpYTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVzY2FsZSwgeG1sTm9kZSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlciwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUgPSBmdW5jdGlvbih4bWxOb2RlLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIGlmICghdGFnTmFtZSB8fCAheG1sTm9kZSB8fCAheG1sTm9kZS5wYXJlbnROb2RlKSB7IHJldHVybiBudWxsOyB9XG4gICAgaWYgKCF4bWxOb2RlLnBhcmVudE5vZGUuaGFzT3duUHJvcGVydHkoJ25vZGVOYW1lJykpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGlmICh4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUgPT09IHRhZ05hbWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpID8gbWFwRm4oeG1sTm9kZS5wYXJlbnROb2RlKSA6IHhtbE5vZGUucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUucGFyZW50Tm9kZSwgdGFnTmFtZSwgbWFwRm4pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNcGQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsLFxuICAgIC8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIFNFQ09ORFNfSU5fWUVBUiA9IDM2NSAqIDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01PTlRIID0gMzAgKiAyNCAqIDYwICogNjAsIC8vIG5vdCBwcmVjaXNlIVxuICAgIFNFQ09ORFNfSU5fREFZID0gMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fSE9VUiA9IDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NSU4gPSA2MCxcbiAgICBNSU5VVEVTX0lOX0hPVVIgPSA2MCxcbiAgICBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUyA9IDEwMDAsXG4gICAgZHVyYXRpb25SZWdleCA9IC9eUCgoW1xcZC5dKilZKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKUQpP1Q/KChbXFxkLl0qKUgpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopUyk/LztcblxucGFyc2VSb290VXJsID0gZnVuY3Rpb24odXJsKSB7XG4gICAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJy8nKSA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignPycpICE9PSAtMSkge1xuICAgICAgICB1cmwgPSB1cmwuc3Vic3RyaW5nKDAsIHVybC5pbmRleE9mKCc/JykpO1xuICAgIH1cblxuICAgIHJldHVybiB1cmwuc3Vic3RyaW5nKDAsIHVybC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59O1xuXG4vLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZnVuY3Rpb24gKHN0cikge1xuICAgIC8vc3RyID0gXCJQMTBZMTBNMTBEVDEwSDEwTTEwLjFTXCI7XG4gICAgdmFyIG1hdGNoID0gZHVyYXRpb25SZWdleC5leGVjKHN0cik7XG4gICAgcmV0dXJuIChwYXJzZUZsb2F0KG1hdGNoWzJdIHx8IDApICogU0VDT05EU19JTl9ZRUFSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs0XSB8fCAwKSAqIFNFQ09ORFNfSU5fTU9OVEggK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzZdIHx8IDApICogU0VDT05EU19JTl9EQVkgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzhdIHx8IDApICogU0VDT05EU19JTl9IT1VSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMF0gfHwgMCkgKiBTRUNPTkRTX0lOX01JTiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTJdIHx8IDApKTtcbn07XG5cbnZhciB1dGlsID0ge1xuICAgIHBhcnNlUm9vdFVybDogcGFyc2VSb290VXJsLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWw7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXF1aXJlKCcuLi9tcGQvdXRpbC5qcycpLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBzZWdtZW50VGVtcGxhdGUgPSByZXF1aXJlKCcuL3NlZ21lbnRUZW1wbGF0ZScpLFxuICAgIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcixcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lLFxuICAgIGdldFR5cGUsXG4gICAgZ2V0QmFuZHdpZHRoLFxuICAgIGdldFdpZHRoLFxuICAgIGdldEhlaWdodCxcbiAgICBnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSxcbiAgICBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSxcbiAgICBnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGU7XG5cbmdldFR5cGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZ2V0QmFuZHdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgYmFuZHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCk7XG4gICAgcmV0dXJuIGV4aXN0eShiYW5kd2lkdGgpID8gTnVtYmVyKGJhbmR3aWR0aCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRXaWR0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0V2lkdGgoKTtcbiAgICByZXR1cm4gZXhpc3R5KHdpZHRoKSA/IE51bWJlcih3aWR0aCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRIZWlnaHQgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBoZWlnaHQgPSByZXByZXNlbnRhdGlvbi5nZXRIZWlnaHQoKTtcbiAgICByZXR1cm4gZXhpc3R5KGhlaWdodCkgPyBOdW1iZXIoaGVpZ2h0KSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgcGVyaW9kLXJlbGF0aXZlIHByZXNlbnRhdGlvbiB0aW1lXG4gICAgdmFyIG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKCksXG4gICAgICAgIHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBleGlzdHkobWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikgPyBOdW1iZXIocGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pKSA6IE51bWJlci5OYU4sXG4gICAgICAgIHByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCgpKTtcbiAgICByZXR1cm4gZXhpc3R5KHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pID8gTnVtYmVyKHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gLSBwcmVzZW50YXRpb25UaW1lT2Zmc2V0KSA6IE51bWJlci5OYU47XG59O1xuXG5nZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBzZWdtZW50VGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKTtcbiAgICByZXR1cm4gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXREdXJhdGlvbigpKSAvIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0VGltZXNjYWxlKCkpO1xufTtcblxuZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBNYXRoLmNlaWwoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLyBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKTtcbn07XG5cbmdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldFN0YXJ0TnVtYmVyKCkpO1xufTtcblxuZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pICsgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC0gMTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0SGVpZ2h0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SGVpZ2h0LCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0V2lkdGgsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxEdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0U2VnbWVudER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsU2VnbWVudENvdW50OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRFbmROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgLy8gVE9ETzogRXh0ZXJuYWxpemVcbiAgICAgICAgZ2V0SW5pdGlhbGl6YXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGluaXRpYWxpemF0aW9uID0ge307XG4gICAgICAgICAgICBpbml0aWFsaXphdGlvbi5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgICAgICAgICAgcmVwcmVzZW50YXRpb25JZCA9IHJlcHJlc2VudGF0aW9uLmdldElkKCksXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldEluaXRpYWxpemF0aW9uKCksXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbklkKTtcblxuICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUoaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCwgJ0JhbmR3aWR0aCcsIHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYmFzZVVybCArIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmw7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgcmV0dXJuIGluaXRpYWxpemF0aW9uO1xuICAgICAgICB9LFxuICAgICAgICBnZXRTZWdtZW50QnlOdW1iZXI6IGZ1bmN0aW9uKG51bWJlcikgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpOyB9LFxuICAgICAgICBnZXRTZWdtZW50QnlUaW1lOiBmdW5jdGlvbihzZWNvbmRzKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKTsgfVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB7fTtcbiAgICBzZWdtZW50LmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgIHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0TWVkaWEoKSxcbiAgICAgICAgICAgIHJlcGxhY2VkSWRVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uLmdldElkKCkpLFxuICAgICAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmw7XG4gICAgICAgICAgICAvLyBUT0RPOiBTaW5jZSAkVGltZSQtdGVtcGxhdGVkIHNlZ21lbnQgVVJMcyBzaG91bGQgb25seSBleGlzdCBpbiBjb25qdW5jdGlvbiB3L2EgPFNlZ21lbnRUaW1lbGluZT4sXG4gICAgICAgICAgICAvLyBUT0RPOiBjYW4gY3VycmVudGx5IGFzc3VtZSBhICROdW1iZXIkLWJhc2VkIHRlbXBsYXRlZCB1cmwuXG4gICAgICAgICAgICAvLyBUT0RPOiBFbmZvcmNlIG1pbi9tYXggbnVtYmVyIHJhbmdlIChiYXNlZCBvbiBzZWdtZW50TGlzdCBzdGFydE51bWJlciAmIGVuZE51bWJlcilcbiAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRJZFVybCwgJ051bWJlcicsIG51bWJlcik7XG4gICAgICAgIHJlcGxhY2VkVG9rZW5zVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkVG9rZW5zVXJsLCAnQmFuZHdpZHRoJywgcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuXG4gICAgICAgIHJldHVybiBiYXNlVXJsICsgcmVwbGFjZWRUb2tlbnNVcmw7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbnVtYmVyICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0RHVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVE9ETzogVmVyaWZ5XG4gICAgICAgIHZhciBzdGFuZGFyZFNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIG1lZGlhUHJlc2VudGF0aW9uVGltZSxcbiAgICAgICAgICAgIHByZWNpc2lvbk11bHRpcGxpZXI7XG5cbiAgICAgICAgaWYgKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgPT09IG51bWJlcikge1xuICAgICAgICAgICAgbWVkaWFQcmVzZW50YXRpb25UaW1lID0gTnVtYmVyKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKTtcbiAgICAgICAgICAgIC8vIEhhbmRsZSBmbG9hdGluZyBwb2ludCBwcmVjaXNpb24gaXNzdWVcbiAgICAgICAgICAgIHByZWNpc2lvbk11bHRpcGxpZXIgPSAxMDAwO1xuICAgICAgICAgICAgZHVyYXRpb24gPSAoKChtZWRpYVByZXNlbnRhdGlvblRpbWUgKiBwcmVjaXNpb25NdWx0aXBsaWVyKSAlIChzdGFuZGFyZFNlZ21lbnREdXJhdGlvbiAqIHByZWNpc2lvbk11bHRpcGxpZXIpKSAvIHByZWNpc2lvbk11bHRpcGxpZXIgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGR1cmF0aW9uID0gc3RhbmRhcmRTZWdtZW50RHVyYXRpb247XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGR1cmF0aW9uO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXROdW1iZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIG51bWJlcjsgfTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgc2Vjb25kcykge1xuICAgIHZhciBzZWdtZW50RHVyYXRpb24gPSBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBudW1iZXIgPSBNYXRoLmZsb29yKHNlY29uZHMgLyBzZWdtZW50RHVyYXRpb24pLFxuICAgICAgICBzZWdtZW50ID0gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpO1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIGlmICghcmVwcmVzZW50YXRpb24pIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmIChyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKSkgeyByZXR1cm4gY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pOyB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2VnbWVudFRlbXBsYXRlLFxuICAgIHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlO1xuXG56ZXJvUGFkVG9MZW5ndGggPSBmdW5jdGlvbiAobnVtU3RyLCBtaW5TdHJMZW5ndGgpIHtcbiAgICB3aGlsZSAobnVtU3RyLmxlbmd0aCA8IG1pblN0ckxlbmd0aCkge1xuICAgICAgICBudW1TdHIgPSAnMCcgKyBudW1TdHI7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bVN0cjtcbn07XG5cbnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB0b2tlbiwgdmFsdWUpIHtcblxuICAgIHZhciBzdGFydFBvcyA9IDAsXG4gICAgICAgIGVuZFBvcyA9IDAsXG4gICAgICAgIHRva2VuTGVuID0gdG9rZW4ubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWcgPSAnJTAnLFxuICAgICAgICBmb3JtYXRUYWdMZW4gPSBmb3JtYXRUYWcubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWdQb3MsXG4gICAgICAgIHNwZWNpZmllcixcbiAgICAgICAgd2lkdGgsXG4gICAgICAgIHBhZGRlZFZhbHVlO1xuXG4gICAgLy8ga2VlcCBsb29waW5nIHJvdW5kIHVudGlsIGFsbCBpbnN0YW5jZXMgb2YgPHRva2VuPiBoYXZlIGJlZW5cbiAgICAvLyByZXBsYWNlZC4gb25jZSB0aGF0IGhhcyBoYXBwZW5lZCwgc3RhcnRQb3MgYmVsb3cgd2lsbCBiZSAtMVxuICAgIC8vIGFuZCB0aGUgY29tcGxldGVkIHVybCB3aWxsIGJlIHJldHVybmVkLlxuICAgIHdoaWxlICh0cnVlKSB7XG5cbiAgICAgICAgLy8gY2hlY2sgaWYgdGhlcmUgaXMgYSB2YWxpZCAkPHRva2VuPi4uLiQgaWRlbnRpZmllclxuICAgICAgICAvLyBpZiBub3QsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBzdGFydFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnICsgdG9rZW4pO1xuICAgICAgICBpZiAoc3RhcnRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGUgbmV4dCAnJCcgbXVzdCBiZSB0aGUgZW5kIG9mIHRoZSBpZGVudGlmZXJcbiAgICAgICAgLy8gaWYgdGhlcmUgaXNuJ3Qgb25lLCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgZW5kUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZW5kUG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbm93IHNlZSBpZiB0aGVyZSBpcyBhbiBhZGRpdGlvbmFsIGZvcm1hdCB0YWcgc3VmZml4ZWQgdG9cbiAgICAgICAgLy8gdGhlIGlkZW50aWZpZXIgd2l0aGluIHRoZSBlbmNsb3NpbmcgJyQnIGNoYXJhY3RlcnNcbiAgICAgICAgZm9ybWF0VGFnUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZihmb3JtYXRUYWcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZm9ybWF0VGFnUG9zID4gc3RhcnRQb3MgJiYgZm9ybWF0VGFnUG9zIDwgZW5kUG9zKSB7XG5cbiAgICAgICAgICAgIHNwZWNpZmllciA9IHRlbXBsYXRlU3RyLmNoYXJBdChlbmRQb3MgLSAxKTtcbiAgICAgICAgICAgIHdpZHRoID0gcGFyc2VJbnQodGVtcGxhdGVTdHIuc3Vic3RyaW5nKGZvcm1hdFRhZ1BvcyArIGZvcm1hdFRhZ0xlbiwgZW5kUG9zIC0gMSksIDEwKTtcblxuICAgICAgICAgICAgLy8gc3VwcG9ydCB0aGUgbWluaW11bSBzcGVjaWZpZXJzIHJlcXVpcmVkIGJ5IElFRUUgMTAwMy4xXG4gICAgICAgICAgICAvLyAoZCwgaSAsIG8sIHUsIHgsIGFuZCBYKSBmb3IgY29tcGxldGVuZXNzXG4gICAgICAgICAgICBzd2l0Y2ggKHNwZWNpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIHRyZWF0IGFsbCBpbnQgdHlwZXMgYXMgdWludCxcbiAgICAgICAgICAgICAgICAvLyBoZW5jZSBkZWxpYmVyYXRlIGZhbGx0aHJvdWdoXG4gICAgICAgICAgICAgICAgY2FzZSAnZCc6XG4gICAgICAgICAgICAgICAgY2FzZSAnaSc6XG4gICAgICAgICAgICAgICAgY2FzZSAndSc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAneCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdYJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCkudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnbyc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDgpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVbnN1cHBvcnRlZC9pbnZhbGlkIElFRUUgMTAwMy4xIGZvcm1hdCBpZGVudGlmaWVyIHN0cmluZyBpbiBVUkwnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRlbXBsYXRlU3RyID0gdGVtcGxhdGVTdHIuc3Vic3RyaW5nKDAsIHN0YXJ0UG9zKSArIHBhZGRlZFZhbHVlICsgdGVtcGxhdGVTdHIuc3Vic3RyaW5nKGVuZFBvcyArIDEpO1xuICAgIH1cbn07XG5cbnVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIpIHtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyQkJykuam9pbignJCcpO1xufTtcblxucmVwbGFjZUlERm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHRlbXBsYXRlU3RyLmluZGV4T2YoJyRSZXByZXNlbnRhdGlvbklEJCcpID09PSAtMSkgeyByZXR1cm4gdGVtcGxhdGVTdHI7IH1cbiAgICB2YXIgdiA9IHZhbHVlLnRvU3RyaW5nKCk7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckUmVwcmVzZW50YXRpb25JRCQnKS5qb2luKHYpO1xufTtcblxuc2VnbWVudFRlbXBsYXRlID0ge1xuICAgIHplcm9QYWRUb0xlbmd0aDogemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlOiByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlOiB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlOiByZXBsYWNlSURGb3JUZW1wbGF0ZVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBzZWdtZW50VGVtcGxhdGU7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXZlbnRNZ3IgPSByZXF1aXJlKCcuL2V2ZW50TWFuYWdlci5qcycpLFxuICAgIGV2ZW50RGlzcGF0Y2hlck1peGluID0ge1xuICAgICAgICB0cmlnZ2VyOiBmdW5jdGlvbihldmVudE9iamVjdCkgeyBldmVudE1nci50cmlnZ2VyKHRoaXMsIGV2ZW50T2JqZWN0KTsgfSxcbiAgICAgICAgb25lOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uZSh0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb246IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub24odGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9mZjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vZmYodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH1cbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50RGlzcGF0Y2hlck1peGluOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHZpZGVvanMgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JykudmlkZW9qcyxcbiAgICBldmVudE1hbmFnZXIgPSB7XG4gICAgICAgIHRyaWdnZXI6IHZpZGVvanMudHJpZ2dlcixcbiAgICAgICAgb25lOiB2aWRlb2pzLm9uZSxcbiAgICAgICAgb246IHZpZGVvanMub24sXG4gICAgICAgIG9mZjogdmlkZW9qcy5vZmZcbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50TWFuYWdlcjtcbiIsIi8qKlxuICpcbiAqIG1haW4gc291cmNlIGZvciBwYWNrYWdlZCBjb2RlLiBBdXRvLWJvb3RzdHJhcHMgdGhlIHNvdXJjZSBoYW5kbGluZyBmdW5jdGlvbmFsaXR5IGJ5IHJlZ2lzdGVyaW5nIHRoZSBzb3VyY2UgaGFuZGxlclxuICogd2l0aCB2aWRlby5qcyBvbiBpbml0aWFsIHNjcmlwdCBsb2FkIHZpYSBJSUZFLiAoTk9URTogVGhpcyBwbGFjZXMgYW4gb3JkZXIgZGVwZW5kZW5jeSBvbiB0aGUgdmlkZW8uanMgbGlicmFyeSwgd2hpY2hcbiAqIG11c3QgYWxyZWFkeSBiZSBsb2FkZWQgYmVmb3JlIHRoaXMgc2NyaXB0IGF1dG8tZXhlY3V0ZXMuKVxuICpcbiAqL1xuOyhmdW5jdGlvbigpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgcm9vdCA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKSxcbiAgICAgICAgdmlkZW9qcyA9IHJvb3QudmlkZW9qcyxcbiAgICAgICAgU291cmNlSGFuZGxlciA9IHJlcXVpcmUoJy4vU291cmNlSGFuZGxlcicpLFxuICAgICAgICBDYW5IYW5kbGVTb3VyY2VFbnVtID0ge1xuICAgICAgICAgICAgRE9FU05UX0hBTkRMRV9TT1VSQ0U6ICcnLFxuICAgICAgICAgICAgTUFZQkVfSEFORExFX1NPVVJDRTogJ21heWJlJ1xuICAgICAgICB9O1xuXG4gICAgaWYgKCF2aWRlb2pzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlIHZpZGVvLmpzIGxpYnJhcnkgbXVzdCBiZSBpbmNsdWRlZCB0byB1c2UgdGhpcyBNUEVHLURBU0ggc291cmNlIGhhbmRsZXIuJyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBVc2VkIGJ5IGEgdmlkZW8uanMgdGVjaCBpbnN0YW5jZSB0byB2ZXJpZnkgd2hldGhlciBvciBub3QgYSBzcGVjaWZpYyBtZWRpYSBzb3VyY2UgY2FuIGJlIGhhbmRsZWQgYnkgdGhpc1xuICAgICAqIHNvdXJjZSBoYW5kbGVyLiBJbiB0aGlzIGNhc2UsIHNob3VsZCByZXR1cm4gJ21heWJlJyBpZiB0aGUgc291cmNlIGlzIE1QRUctREFTSCwgb3RoZXJ3aXNlICcnIChyZXByZXNlbnRpbmcgbm8pLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtvYmplY3R9IHNvdXJjZSAgICAgICAgICAgdmlkZW8uanMgc291cmNlIG9iamVjdCBwcm92aWRpbmcgc291cmNlIHVyaSBhbmQgdHlwZSBpbmZvcm1hdGlvblxuICAgICAqIEByZXR1cm5zIHtDYW5IYW5kbGVTb3VyY2VFbnVtfSAgIHN0cmluZyByZXByZXNlbnRhdGlvbiBvZiB3aGV0aGVyIG9yIG5vdCBwYXJ0aWN1bGFyIHNvdXJjZSBjYW4gYmUgaGFuZGxlZCBieSB0aGlzXG4gICAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlIGhhbmRsZXIuXG4gICAgICovXG4gICAgZnVuY3Rpb24gY2FuSGFuZGxlU291cmNlKHNvdXJjZSkge1xuICAgICAgICAvLyBSZXF1aXJlcyBNZWRpYSBTb3VyY2UgRXh0ZW5zaW9uc1xuICAgICAgICBpZiAoIShyb290Lk1lZGlhU291cmNlKSkge1xuICAgICAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uRE9FU05UX0hBTkRMRV9TT1VSQ0U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgdHlwZSBpcyBzdXBwb3J0ZWRcbiAgICAgICAgaWYgKC9hcHBsaWNhdGlvblxcL2Rhc2hcXCt4bWwvLnRlc3Qoc291cmNlLnR5cGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gQ2FuSGFuZGxlU291cmNlRW51bS5NQVlCRV9IQU5ETEVfU09VUkNFO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGZpbGUgZXh0ZW5zaW9uIG1hdGNoZXNcbiAgICAgICAgaWYgKC9cXC5tcGQkL2kudGVzdChzb3VyY2Uuc3JjKSkge1xuICAgICAgICAgICAgcmV0dXJuIENhbkhhbmRsZVNvdXJjZUVudW0uTUFZQkVfSEFORExFX1NPVVJDRTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBDYW5IYW5kbGVTb3VyY2VFbnVtLkRPRVNOVF9IQU5ETEVfU09VUkNFO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQ2FsbGVkIGJ5IGEgdmlkZW8uanMgdGVjaCBpbnN0YW5jZSB0byBoYW5kbGUgYSBzcGVjaWZpYyBtZWRpYSBzb3VyY2UsIHJldHVybmluZyBhbiBvYmplY3QgaW5zdGFuY2UgdGhhdCBwcm92aWRlc1xuICAgICAqIHRoZSBjb250ZXh0IGZvciBoYW5kbGluZyBzYWlkIHNvdXJjZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBzb3VyY2UgICAgICAgICAgICB2aWRlby5qcyBzb3VyY2Ugb2JqZWN0IHByb3ZpZGluZyBzb3VyY2UgdXJpIGFuZCB0eXBlIGluZm9ybWF0aW9uXG4gICAgICogQHBhcmFtIHRlY2ggICAgICAgICAgICAgIHZpZGVvLmpzIHRlY2ggb2JqZWN0IChpbiB0aGlzIGNhc2UsIHNob3VsZCBiZSBIdG1sNSB0ZWNoKSBwcm92aWRpbmcgcG9pbnQgb2YgaW50ZXJhY3Rpb25cbiAgICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgYmV0d2VlbiB0aGUgc291cmNlIGhhbmRsZXIgYW5kIHRoZSB2aWRlby5qcyBsaWJyYXJ5IChpbmNsdWRpbmcsIGUuZy4sIHRoZSB2aWRlbyBlbGVtZW50KVxuICAgICAqIEByZXR1cm5zIHtTb3VyY2VIYW5kbGVyfSBBbiBvYmplY3QgdGhhdCBkZWZpbmVzIGNvbnRleHQgZm9yIGhhbmRsaW5nIGEgcGFydGljdWxhciBNUEVHLURBU0ggc291cmNlLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIGhhbmRsZVNvdXJjZShzb3VyY2UsIHRlY2gpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCk7XG4gICAgfVxuXG4gICAgLy8gUmVnaXN0ZXIgdGhlIHNvdXJjZSBoYW5kbGVyIHRvIHRoZSBIdG1sNSB0ZWNoIGluc3RhbmNlLlxuICAgIHZpZGVvanMuSHRtbDUucmVnaXN0ZXJTb3VyY2VIYW5kbGVyKHtcbiAgICAgICAgY2FuSGFuZGxlU291cmNlOiBjYW5IYW5kbGVTb3VyY2UsXG4gICAgICAgIGhhbmRsZVNvdXJjZTogaGFuZGxlU291cmNlXG4gICAgfSwgMCk7XG5cbn0uY2FsbCh0aGlzKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIHRydXRoeSA9IHJlcXVpcmUoJy4uL3V0aWwvdHJ1dGh5LmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuLi91dGlsL2lzU3RyaW5nLmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGxvYWRNYW5pZmVzdCA9IHJlcXVpcmUoJy4vbG9hZE1hbmlmZXN0LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24gPSByZXF1aXJlKCcuLi9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMnKSxcbiAgICBnZXRNcGQgPSByZXF1aXJlKCcuLi9kYXNoL21wZC9nZXRNcGQuanMnKSxcbiAgICBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uLFxuICAgIGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVzLmpzJyksXG4gICAgREVGQVVMVF9UWVBFID0gbWVkaWFUeXBlc1swXTtcblxuLyoqXG4gKlxuICogRnVuY3Rpb24gdXNlZCB0byBnZXQgdGhlIG1lZGlhIHR5cGUgYmFzZWQgb24gdGhlIG1pbWUgdHlwZS4gVXNlZCB0byBkZXRlcm1pbmUgdGhlIG1lZGlhIHR5cGUgb2YgQWRhcHRhdGlvbiBTZXRzXG4gKiBvciBjb3JyZXNwb25kaW5nIGRhdGEgcmVwcmVzZW50YXRpb25zLlxuICpcbiAqIEBwYXJhbSBtaW1lVHlwZSB7c3RyaW5nfSBtaW1lIHR5cGUgZm9yIGEgREFTSCBNUEQgQWRhcHRhdGlvbiBTZXQgKHNwZWNpZmllZCBhcyBhbiBhdHRyaWJ1dGUgc3RyaW5nKVxuICogQHBhcmFtIHR5cGVzIHtzdHJpbmd9ICAgIHN1cHBvcnRlZCBtZWRpYSB0eXBlcyAoZS5nLiAndmlkZW8sJyAnYXVkaW8sJylcbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgICAgICB0aGUgbWVkaWEgdHlwZSB0aGF0IGNvcnJlc3BvbmRzIHRvIHRoZSBtaW1lIHR5cGUuXG4gKi9cbmdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSA9IGZ1bmN0aW9uKG1pbWVUeXBlLCB0eXBlcykge1xuICAgIGlmICghaXNTdHJpbmcobWltZVR5cGUpKSB7IHJldHVybiBERUZBVUxUX1RZUEU7IH0gICAvLyBUT0RPOiBUaHJvdyBlcnJvcj9cbiAgICB2YXIgbWF0Y2hlZFR5cGUgPSB0eXBlcy5maW5kKGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgcmV0dXJuICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gZXhpc3R5KG1hdGNoZWRUeXBlKSA/IG1hdGNoZWRUeXBlIDogREVGQVVMVF9UWVBFO1xufTtcblxuLyoqXG4gKlxuICogRnVuY3Rpb24gdXNlZCB0byBnZXQgdGhlICd0eXBlJyBvZiBhIERBU0ggUmVwcmVzZW50YXRpb24gaW4gYSBmb3JtYXQgZXhwZWN0ZWQgYnkgdGhlIE1TRSBTb3VyY2VCdWZmZXIuIFVzZWQgdG9cbiAqIGNyZWF0ZSBTb3VyY2VCdWZmZXIgaW5zdGFuY2VzIHRoYXQgY29ycmVzcG9uZCB0byBhIGdpdmVuIE1lZGlhU2V0IChlLmcuIHNldCBvZiBhdWRpbyBzdHJlYW0gdmFyaWFudHMsIHZpZGVvIHN0cmVhbVxuICogdmFyaWFudHMsIGV0Yy4pLlxuICpcbiAqIEBwYXJhbSByZXByZXNlbnRhdGlvbiAgICBQT0pPIERBU0ggTVBEIFJlcHJlc2VudGF0aW9uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAgICAgICAgVGhlIFJlcHJlc2VudGF0aW9uJ3MgJ3R5cGUnIGluIGEgZm9ybWF0IGV4cGVjdGVkIGJ5IHRoZSBNU0UgU291cmNlQnVmZmVyXG4gKi9cbmdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24gPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuLyoqXG4gKlxuICogVGhlIE1hbmlmZXN0Q29udHJvbGxlciBsb2Fkcywgc3RvcmVzLCBhbmQgcHJvdmlkZXMgZGF0YSB2aWV3cyBmb3IgdGhlIE1QRCBtYW5pZmVzdCB0aGF0IHJlcHJlc2VudHMgdGhlXG4gKiBNUEVHLURBU0ggbWVkaWEgc291cmNlIGJlaW5nIGhhbmRsZWQuXG4gKlxuICogQHBhcmFtIHNvdXJjZVVyaSB7c3RyaW5nfVxuICogQHBhcmFtIGF1dG9Mb2FkICB7Ym9vbGVhbn1cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlVXJpLCBhdXRvTG9hZCkge1xuICAgIHRoaXMuX19hdXRvTG9hZCA9IHRydXRoeShhdXRvTG9hZCk7XG4gICAgdGhpcy5zZXRTb3VyY2VVcmkoc291cmNlVXJpKTtcbn1cblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBldmVudHMgaW5zdGFuY2VzIG9mIHRoaXMgb2JqZWN0IHdpbGwgZGlzcGF0Y2guXG4gKi9cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIE1BTklGRVNUX0xPQURFRDogJ21hbmlmZXN0TG9hZGVkJ1xufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5nZXRTb3VyY2VVcmkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX3NvdXJjZVVyaTtcbn07XG5cbk1hbmlmZXN0Q29udHJvbGxlci5wcm90b3R5cGUuc2V0U291cmNlVXJpID0gZnVuY3Rpb24gc2V0U291cmNlVXJpKHNvdXJjZVVyaSkge1xuICAgIC8vIFRPRE86ICdleGlzdHkoKScgY2hlY2sgZm9yIGJvdGg/XG4gICAgaWYgKHNvdXJjZVVyaSA9PT0gdGhpcy5fX3NvdXJjZVVyaSkgeyByZXR1cm47IH1cblxuICAgIC8vIFRPRE86IGlzU3RyaW5nKCkgY2hlY2s/ICdleGlzdHkoKScgY2hlY2s/XG4gICAgaWYgKCFzb3VyY2VVcmkpIHtcbiAgICAgICAgdGhpcy5fX2NsZWFyU291cmNlVXJpKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBOZWVkIHRvIHBvdGVudGlhbGx5IHJlbW92ZSB1cGRhdGUgaW50ZXJ2YWwgZm9yIHJlLXJlcXVlc3RpbmcgdGhlIE1QRCBtYW5pZmVzdCAoaW4gY2FzZSBpdCBpcyBhIGR5bmFtaWMgTVBEKVxuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBzb3VyY2VVcmk7XG4gICAgLy8gSWYgd2Ugc2hvdWxkIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgTVBELCBnbyBhaGVhZCBhbmQga2ljayBvZmYgbG9hZGluZyBpdC5cbiAgICBpZiAodGhpcy5fX2F1dG9Mb2FkKSB7XG4gICAgICAgIC8vIFRPRE86IEltcGwgYW55IGNsZWFudXAgZnVuY3Rpb25hbGl0eSBhcHByb3ByaWF0ZSBiZWZvcmUgbG9hZC5cbiAgICAgICAgdGhpcy5sb2FkKCk7XG4gICAgfVxufTtcblxuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX2NsZWFyU291cmNlVXJpID0gZnVuY3Rpb24gY2xlYXJTb3VyY2VVcmkoKSB7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IG51bGw7XG4gICAgLy8gTmVlZCB0byBwb3RlbnRpYWxseSByZW1vdmUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgbWFuaWZlc3QgKGluIGNhc2UgaXQgaXMgYSBkeW5hbWljIE1QRClcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAvLyBUT0RPOiBpbXBsIGFueSBvdGhlciBjbGVhbnVwIGZ1bmN0aW9uYWxpdHlcbn07XG5cbi8qKlxuICogS2ljayBvZmYgbG9hZGluZyB0aGUgREFTSCBNUEQgTWFuaWZlc3QgKHNlcnZlZCBAIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgaW5zdGFuY2UncyBfX3NvdXJjZVVyaSlcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24gbG9hZCgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgbG9hZE1hbmlmZXN0KHNlbGYuX19zb3VyY2VVcmksIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgc2VsZi5fX21hbmlmZXN0ID0gZGF0YS5tYW5pZmVzdFhtbDtcbiAgICAgICAgLy8gKFBvdGVudGlhbGx5KSBzZXR1cCB0aGUgdXBkYXRlIGludGVydmFsIGZvciByZS1yZXF1ZXN0aW5nIHRoZSBNUEQgKGluIGNhc2UgdGhlIG1hbmlmZXN0IGlzIGR5bmFtaWMpXG4gICAgICAgIHNlbGYuX19zZXR1cFVwZGF0ZUludGVydmFsKCk7XG4gICAgICAgIC8vIERpc3BhdGNoIGV2ZW50IHRvIG5vdGlmeSB0aGF0IHRoZSBtYW5pZmVzdCBoYXMgbG9hZGVkLlxuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VsZi5fX21hbmlmZXN0fSk7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqICdQcml2YXRlJyBtZXRob2QgdGhhdCByZW1vdmVzIHRoZSB1cGRhdGUgaW50ZXJ2YWwgKGlmIGl0IGV4aXN0cyksIHNvIHRoZSBNYW5pZmVzdENvbnRyb2xsZXIgaW5zdGFuY2Ugd2lsbCBubyBsb25nZXJcbiAqIHBlcmlvZGljYWxseSByZS1yZXF1ZXN0IHRoZSBtYW5pZmVzdCAoaWYgaXQncyBkeW5hbWljKS5cbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3VwZGF0ZUludGVydmFsKSkgeyByZXR1cm47IH1cbiAgICBjbGVhckludGVydmFsKHRoaXMuX191cGRhdGVJbnRlcnZhbCk7XG59O1xuXG4vKipcbiAqIFNldHMgdXAgYW4gaW50ZXJ2YWwgdG8gcmUtcmVxdWVzdCB0aGUgbWFuaWZlc3QgKGlmIGl0J3MgZHluYW1pYylcbiAqL1xuTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZS5fX3NldHVwVXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBzZXR1cFVwZGF0ZUludGVydmFsKCkge1xuICAgIC8vIElmIHRoZXJlJ3MgYWxyZWFkeSBhbiB1cGRhdGVJbnRlcnZhbCBmdW5jdGlvbiwgcmVtb3ZlIGl0LlxuICAgIGlmICh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpIHsgc2VsZi5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7IH1cbiAgICAvLyBJZiB3ZSBzaG91bGRuJ3QgdXBkYXRlLCBqdXN0IGJhaWwuXG4gICAgaWYgKCF0aGlzLmdldFNob3VsZFVwZGF0ZSgpKSB7IHJldHVybjsgfVxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWluVXBkYXRlUmF0ZSA9IDIsXG4gICAgICAgIHVwZGF0ZVJhdGUgPSBNYXRoLm1heCh0aGlzLmdldFVwZGF0ZVJhdGUoKSwgbWluVXBkYXRlUmF0ZSk7XG4gICAgLy8gU2V0dXAgdGhlIHVwZGF0ZSBpbnRlcnZhbCBiYXNlZCBvbiB0aGUgdXBkYXRlIHJhdGUgKGRldGVybWluZWQgZnJvbSB0aGUgbWFuaWZlc3QpIG9yIHRoZSBtaW5pbXVtIHVwZGF0ZSByYXRlXG4gICAgLy8gKHdoaWNoZXZlcidzIGxhcmdlcikuXG4gICAgLy8gTk9URTogTXVzdCBzdG9yZSByZWYgdG8gY3JlYXRlZCBpbnRlcnZhbCB0byBwb3RlbnRpYWxseSBjbGVhci9yZW1vdmUgaXQgbGF0ZXJcbiAgICB0aGlzLl9fdXBkYXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgc2VsZi5sb2FkKCk7XG4gICAgfSwgdXBkYXRlUmF0ZSAqIDEwMDApO1xufTtcblxuLyoqXG4gKiBHZXRzIHRoZSB0eXBlIG9mIHBsYXlsaXN0ICgnc3RhdGljJyBvciAnZHluYW1pYycsIHdoaWNoIG5lYXJseSBpbnZhcmlhYmx5IGNvcnJlc3BvbmRzIHRvIGxpdmUgdnMuIHZvZCkgZGVmaW5lZCBpbiB0aGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9ICAgIHRoZSBwbGF5bGlzdCB0eXBlIChlaXRoZXIgJ3N0YXRpYycgb3IgJ2R5bmFtaWMnKVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFBsYXlsaXN0VHlwZSA9IGZ1bmN0aW9uIGdldFBsYXlsaXN0VHlwZSgpIHtcbiAgICB2YXIgcGxheWxpc3RUeXBlID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0VHlwZSgpO1xuICAgIHJldHVybiBwbGF5bGlzdFR5cGU7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFVwZGF0ZVJhdGUgPSBmdW5jdGlvbiBnZXRVcGRhdGVSYXRlKCkge1xuICAgIHZhciBtaW5pbXVtVXBkYXRlUGVyaW9kID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCgpO1xuICAgIHJldHVybiBOdW1iZXIobWluaW11bVVwZGF0ZVBlcmlvZCk7XG59O1xuXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldFNob3VsZFVwZGF0ZSA9IGZ1bmN0aW9uIGdldFNob3VsZFVwZGF0ZSgpIHtcbiAgICB2YXIgaXNEeW5hbWljID0gKHRoaXMuZ2V0UGxheWxpc3RUeXBlKCkgPT09ICdkeW5hbWljJyksXG4gICAgICAgIGhhc1ZhbGlkVXBkYXRlUmF0ZSA9ICh0aGlzLmdldFVwZGF0ZVJhdGUoKSA+IDApO1xuICAgIHJldHVybiAoaXNEeW5hbWljICYmIGhhc1ZhbGlkVXBkYXRlUmF0ZSk7XG59O1xuXG4vKipcbiAqXG4gKiBAcGFyYW0gdHlwZVxuICogQHJldHVybnMge01lZGlhU2V0fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0QnlUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRCeVR5cGUodHlwZSkge1xuICAgIGlmIChtZWRpYVR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7IHRocm93IG5ldyBFcnJvcignSW52YWxpZCB0eXBlLiBWYWx1ZSBtdXN0IGJlIG9uZSBvZjogJyArIG1lZGlhVHlwZXMuam9pbignLCAnKSk7IH1cbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2ggPSBhZGFwdGF0aW9uU2V0cy5maW5kKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHtcbiAgICAgICAgICAgIHJldHVybiAoZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKGFkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcykgPT09IHR5cGUpO1xuICAgICAgICB9KTtcbiAgICBpZiAoIWV4aXN0eShhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKTtcbn07XG5cbi8qKlxuICpcbiAqIEByZXR1cm5zIHtBcnJheS48TWVkaWFTZXQ+fVxuICovXG5NYW5pZmVzdENvbnRyb2xsZXIucHJvdG90eXBlLmdldE1lZGlhU2V0cyA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0cygpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgbWVkaWFTZXRzID0gYWRhcHRhdGlvblNldHMubWFwKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHsgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0KTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0cztcbn07XG5cbi8vIE1peGluIGV2ZW50IGhhbmRsaW5nIGZvciB0aGUgTWFuaWZlc3RDb250cm9sbGVyIG9iamVjdCB0eXBlIGRlZmluaXRpb24uXG5leHRlbmRPYmplY3QoTWFuaWZlc3RDb250cm9sbGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG4vLyBUT0RPOiBNb3ZlIE1lZGlhU2V0IGRlZmluaXRpb24gdG8gYSBzZXBhcmF0ZSAuanMgZmlsZT9cbi8qKlxuICpcbiAqIFByaW1hcnkgZGF0YSB2aWV3IGZvciByZXByZXNlbnRpbmcgdGhlIHNldCBvZiBzZWdtZW50IGxpc3RzIGFuZCBvdGhlciBnZW5lcmFsIGluZm9ybWF0aW9uIGZvciBhIGdpdmUgbWVkaWEgdHlwZVxuICogKGUuZy4gJ2F1ZGlvJyBvciAndmlkZW8nKS5cbiAqXG4gKiBAcGFyYW0gYWRhcHRhdGlvblNldCBUaGUgTVBFRy1EQVNIIGNvcnJlbGF0ZSBmb3IgYSBnaXZlbiBtZWRpYSBzZXQsIGNvbnRhaW5pbmcgc29tZSB3YXkgb2YgcmVwcmVzZW50YXRpbmcgc2VnbWVudCBsaXN0c1xuICogICAgICAgICAgICAgICAgICAgICAgYW5kIGEgc2V0IG9mIHJlcHJlc2VudGF0aW9ucyBmb3IgZWFjaCBzdHJlYW0gdmFyaWFudC5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNZWRpYVNldChhZGFwdGF0aW9uU2V0KSB7XG4gICAgLy8gVE9ETzogQWRkaXRpb25hbCBjaGVja3MgJiBFcnJvciBUaHJvd2luZ1xuICAgIHRoaXMuX19hZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldDtcbn1cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uIGdldE1lZGlhVHlwZSgpIHtcbiAgICB2YXIgdHlwZSA9IGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSh0aGlzLmdldE1pbWVUeXBlKCksIG1lZGlhVHlwZXMpO1xuICAgIHJldHVybiB0eXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1pbWVUeXBlID0gZnVuY3Rpb24gZ2V0TWltZVR5cGUoKSB7XG4gICAgdmFyIG1pbWVUeXBlID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKTtcbiAgICByZXR1cm4gbWltZVR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyVHlwZSA9IGZ1bmN0aW9uIGdldFNvdXJjZUJ1ZmZlclR5cGUoKSB7XG4gICAgLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZSBjb2RlY3MgYXNzb2NpYXRlZCB3aXRoIGVhY2ggc3RyZWFtIHZhcmlhbnQvcmVwcmVzZW50YXRpb25cbiAgICAvLyB3aWxsIGJlIHNpbWlsYXIgZW5vdWdoIHRoYXQgeW91IHdvbid0IGhhdmUgdG8gcmUtY3JlYXRlIHRoZSBzb3VyY2UtYnVmZmVyIHdoZW4gc3dpdGNoaW5nXG4gICAgLy8gYmV0d2VlbiB0aGVtLlxuXG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNvdXJjZUJ1ZmZlclR5cGUgPSBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc291cmNlQnVmZmVyVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0VG90YWxEdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKTtcbiAgICByZXR1cm4gdG90YWxEdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsU2VnbWVudENvdW50ID0gZnVuY3Rpb24gZ2V0VG90YWxTZWdtZW50Q291bnQoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHRvdGFsU2VnbWVudENvdW50ID0gc2VnbWVudExpc3QuZ2V0VG90YWxTZWdtZW50Q291bnQoKTtcbiAgICByZXR1cm4gdG90YWxTZWdtZW50Q291bnQ7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0U2VnbWVudER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKTtcbiAgICByZXR1cm4gc2VnbWVudER1cmF0aW9uO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gc2VnbWVudExpc3QuZ2V0U3RhcnROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RTdGFydE51bWJlcjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEVuZE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0RW5kTnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdEVuZE51bWJlciA9IHNlZ21lbnRMaXN0LmdldEVuZE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdEVuZE51bWJlcjtcbn07XG5cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0cyA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0cygpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIHNlZ21lbnRMaXN0cyA9IHJlcHJlc2VudGF0aW9ucy5tYXAoZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbik7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0cztcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aChiYW5kd2lkdGgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoID0gcmVwcmVzZW50YXRpb25zLmZpbmQoZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHZhciByZXByZXNlbnRhdGlvbkJhbmR3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgICAgICAgICAgcmV0dXJuIChOdW1iZXIocmVwcmVzZW50YXRpb25CYW5kd2lkdGgpID09PSBOdW1iZXIoYmFuZHdpZHRoKSk7XG4gICAgICAgIH0pLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb25XaXRoQmFuZHdpZHRoTWF0Y2gpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24gZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpIHtcbiAgICByZXR1cm4gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCkubWFwKFxuICAgICAgICBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG4gICAgfSkuZmlsdGVyKFxuICAgICAgICBmdW5jdGlvbihiYW5kd2lkdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKTtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hbmlmZXN0Q29udHJvbGxlcjsiLCJtb2R1bGUuZXhwb3J0cyA9IFsndmlkZW8nLCAnYXVkaW8nXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwgPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VSb290VXJsO1xuXG5mdW5jdGlvbiBsb2FkTWFuaWZlc3QodXJsLCBjYWxsYmFjaykge1xuICAgIHZhciBhY3R1YWxVcmwgPSBwYXJzZVJvb3RVcmwodXJsKSxcbiAgICAgICAgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICBvbmxvYWQ7XG5cbiAgICBvbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkgeyByZXR1cm47IH1cblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrKHttYW5pZmVzdFhtbDogcmVxdWVzdC5yZXNwb25zZVhNTCB9KTsgfVxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Lm9ubG9hZCA9IG9ubG9hZDtcbiAgICAgICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgICAgICByZXF1ZXN0LnNlbmQoKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgcmVxdWVzdC5vbmVycm9yKCk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxvYWRNYW5pZmVzdDsiLCJcbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGlzTnVtYmVyID0gcmVxdWlyZSgnLi4vdXRpbC9pc051bWJlci5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBsb2FkU2VnbWVudCxcbiAgICBERUZBVUxUX1JFVFJZX0NPVU5UID0gMyxcbiAgICBERUZBVUxUX1JFVFJZX0lOVEVSVkFMID0gMjUwO1xuXG4vKipcbiAqIEdlbmVyaWMgZnVuY3Rpb24gZm9yIGxvYWRpbmcgTVBFRy1EQVNIIHNlZ21lbnRzXG4gKiBAcGFyYW0gc2VnbWVudCB7b2JqZWN0fSAgICAgICAgICBkYXRhIHZpZXcgcmVwcmVzZW50aW5nIGEgc2VnbWVudCAoYW5kIHJlbGV2YW50IGRhdGEgZm9yIHRoYXQgc2VnbWVudClcbiAqIEBwYXJhbSBjYWxsYmFja0ZuIHtmdW5jdGlvbn0gICAgIGNhbGxiYWNrIGZ1bmN0aW9uXG4gKiBAcGFyYW0gcmV0cnlDb3VudCB7bnVtYmVyfSAgICAgICBzdGlwdWxhdGVzIGhvdyBtYW55IHRpbWVzIHdlIHNob3VsZCB0cnkgdG8gbG9hZCB0aGUgc2VnbWVudCBiZWZvcmUgZ2l2aW5nIHVwXG4gKiBAcGFyYW0gcmV0cnlJbnRlcnZhbCB7bnVtYmVyfSAgICBzdGlwdWxhdGVzIHRoZSBhbW91bnQgb2YgdGltZSAoaW4gbWlsbGlzZWNvbmRzKSB3ZSBzaG91bGQgd2FpdCBiZWZvcmUgcmV0cnlpbmcgdG9cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvd25sb2FkIHRoZSBzZWdtZW50IGlmL3doZW4gdGhlIGRvd25sb2FkIGF0dGVtcHQgZmFpbHMuXG4gKi9cbmxvYWRTZWdtZW50ID0gZnVuY3Rpb24oc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCwgcmV0cnlJbnRlcnZhbCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gbnVsbDtcblxuICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIHVybCA9IHNlZ21lbnQuZ2V0VXJsKCk7XG4gICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcblxuICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrRm4gPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2tGbi5jYWxsKHNlbGYsIHJlcXVlc3QucmVzcG9uc2UpOyB9XG4gICAgfTtcbiAgICAvL3JlcXVlc3Qub25lcnJvciA9IHJlcXVlc3Qub25sb2FkZW5kID0gZnVuY3Rpb24oKSB7XG4gICAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH07XG5cbiAgICBzZWxmLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lID0gTnVtYmVyKChuZXcgRGF0ZSgpLmdldFRpbWUoKSkvMTAwMCk7XG4gICAgcmVxdWVzdC5zZW5kKCk7XG59O1xuXG4vKipcbiAqXG4gKiBTZWdtZW50TG9hZGVyIGhhbmRsZXMgbG9hZGluZyBzZWdtZW50cyBmcm9tIHNlZ21lbnQgbGlzdHMgZm9yIGEgZ2l2ZW4gbWVkaWEgc2V0LCBiYXNlZCBvbiB0aGUgY3VycmVudGx5IHNlbGVjdGVkXG4gKiBzZWdtZW50IGxpc3QgKHdoaWNoIGNvcnJlc3BvbmRzIHRvIHRoZSBjdXJyZW50bHkgc2V0IGJhbmR3aWR0aC9iaXRyYXRlKVxuICpcbiAqIEBwYXJhbSBtYW5pZmVzdENvbnRyb2xsZXIge01hbmlmZXN0Q29udHJvbGxlcn1cbiAqIEBwYXJhbSBtZWRpYVR5cGUge3N0cmluZ31cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBTZWdtZW50TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFUeXBlKSB7XG4gICAgaWYgKCFleGlzdHkobWFuaWZlc3RDb250cm9sbGVyKSkgeyB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXIgbXVzdCBiZSBpbml0aWFsaXplZCB3aXRoIGEgbWFuaWZlc3RDb250cm9sbGVyIScpOyB9XG4gICAgaWYgKCFleGlzdHkobWVkaWFUeXBlKSkgeyB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXIgbXVzdCBiZSBpbml0aWFsaXplZCB3aXRoIGEgbWVkaWFUeXBlIScpOyB9XG4gICAgLy8gTk9URTogUmF0aGVyIHRoYW4gcGFzc2luZyBpbiBhIHJlZmVyZW5jZSB0byB0aGUgTWVkaWFTZXQgaW5zdGFuY2UgZm9yIGEgbWVkaWEgdHlwZSwgd2UgcGFzcyBpbiBhIHJlZmVyZW5jZSB0byB0aGVcbiAgICAvLyBjb250cm9sbGVyICYgdGhlIG1lZGlhVHlwZSBzbyB0aGF0IHRoZSBTZWdtZW50TG9hZGVyIGRvZXNuJ3QgbmVlZCB0byBiZSBhd2FyZSBvZiBzdGF0ZSBjaGFuZ2VzL3VwZGF0ZXMgdG9cbiAgICAvLyB0aGUgbWFuaWZlc3QgZGF0YSAoc2F5LCBpZiB0aGUgcGxheWxpc3QgaXMgZHluYW1pYy8nbGl2ZScpLlxuICAgIHRoaXMuX19tYW5pZmVzdCA9IG1hbmlmZXN0Q29udHJvbGxlcjtcbiAgICB0aGlzLl9fbWVkaWFUeXBlID0gbWVkaWFUeXBlO1xuICAgIC8vIFRPRE86IERvbid0IGxpa2UgdGhpczogTmVlZCB0byBjZW50cmFsaXplIHBsYWNlKHMpIHdoZXJlICYgaG93IF9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgZ2V0cyBzZXQgdG8gdHJ1ZS9mYWxzZS5cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG59XG5cbi8qKlxuICogRW51bWVyYXRpb24gb2YgZXZlbnRzIGluc3RhbmNlcyBvZiB0aGlzIG9iamVjdCB3aWxsIGRpc3BhdGNoLlxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgSU5JVElBTElaQVRJT05fTE9BREVEOiAnaW5pdGlhbGl6YXRpb25Mb2FkZWQnLFxuICAgIFNFR01FTlRfTE9BREVEOiAnc2VnbWVudExvYWRlZCcsXG4gICAgRE9XTkxPQURfREFUQV9VUERBVEU6ICdkb3dubG9hZERhdGFVcGRhdGUnXG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5fX2dldE1lZGlhU2V0ID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXQoKSB7XG4gICAgdmFyIG1lZGlhU2V0ID0gdGhpcy5fX21hbmlmZXN0LmdldE1lZGlhU2V0QnlUeXBlKHRoaXMuX19tZWRpYVR5cGUpO1xuICAgIHJldHVybiBtZWRpYVNldDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0cygpWzBdO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRDdXJyZW50QmFuZHdpZHRoKCkge1xuICAgIGlmICghaXNOdW1iZXIodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpKSB7IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5fX2dldERlZmF1bHRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpOyB9XG4gICAgcmV0dXJuIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoO1xufTtcblxuLyoqXG4gKiBTZXRzIHRoZSBjdXJyZW50IGJhbmR3aWR0aCwgd2hpY2ggY29ycmVzcG9uZHMgdG8gdGhlIGN1cnJlbnRseSBzZWxlY3RlZCBzZWdtZW50IGxpc3QgKGkuZS4gdGhlIHNlZ21lbnQgbGlzdCBpbiB0aGVcbiAqIG1lZGlhIHNldCBmcm9tIHdoaWNoIHdlIHNob3VsZCBiZSBkb3dubG9hZGluZyBzZWdtZW50cykuXG4gKiBAcGFyYW0gYmFuZHdpZHRoIHtudW1iZXJ9XG4gKi9cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLnNldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBzZXRDdXJyZW50QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIGlmICghaXNOdW1iZXIoYmFuZHdpZHRoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBleHBlY3RzIGEgbnVtZXJpYyB2YWx1ZSBmb3IgYmFuZHdpZHRoIScpO1xuICAgIH1cbiAgICB2YXIgYXZhaWxhYmxlQmFuZHdpZHRocyA9IHRoaXMuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIGlmIChhdmFpbGFibGVCYW5kd2lkdGhzLmluZGV4T2YoYmFuZHdpZHRoKSA8IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyOjpzZXRDdXJyZW50QmFuZHdpZHRoKCkgbXVzdCBiZSBzZXQgdG8gb25lIG9mIHRoZSBmb2xsb3dpbmcgdmFsdWVzOiAnICsgYXZhaWxhYmxlQmFuZHdpZHRocy5qb2luKCcsICcpKTtcbiAgICB9XG4gICAgaWYgKGJhbmR3aWR0aCA9PT0gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgLy8gVHJhY2sgd2hlbiB3ZSd2ZSBzd2l0Y2ggYmFuZHdpZHRocywgc2luY2Ugd2UnbGwgbmVlZCB0byAocmUpbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIHNlZ21lbnQgbGlzdFxuICAgIC8vIHdoZW5ldmVyIHdlIHN3aXRjaCBiZXR3ZWVuIHNlZ21lbnQgbGlzdHMuIFRoaXMgYWxsb3dzIFNlZ21lbnRMb2FkZXIgaW5zdGFuY2VzIHRvIGF1dG9tYXRpY2FsbHkgZG8gdGhpcywgaGlkaW5nIHRob3NlXG4gICAgLy8gZGV0YWlscyBmcm9tIHRoZSBvdXRzaWRlLlxuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSBiYW5kd2lkdGg7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudExpc3QgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudExpc3QoKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0ID0gIHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgodGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCkpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXZhaWxhYmxlQmFuZHdpZHRocyA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKTtcbiAgICByZXR1cm4gYXZhaWxhYmxlQmFuZHdpZHRocztcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldFN0YXJ0TnVtYmVyID0gZnVuY3Rpb24gZ2V0U3RhcnROdW1iZXIoKSB7XG4gICAgdmFyIHN0YXJ0TnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RTdGFydE51bWJlcigpO1xuICAgIHJldHVybiBzdGFydE51bWJlcjtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50ID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnQoKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeU51bWJlcih0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIpO1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudE51bWJlcigpIHsgcmV0dXJuIHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnRTdGFydFRpbWUgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudFN0YXJ0VGltZSgpIHsgcmV0dXJuIHRoaXMuZ2V0Q3VycmVudFNlZ21lbnQoKS5nZXRTdGFydE51bWJlcigpOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRFbmROdW1iZXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZW5kTnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gZW5kTnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBleGlzdHkodGhpcy5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSkgPyB0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lIDogLTE7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSgpIC0gdGhpcy5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUoKTtcbn07XG5cbi8qKlxuICpcbiAqIE1ldGhvZCBmb3IgZG93bmxvYWRpbmcgdGhlIGluaXRpYWxpemF0aW9uIHNlZ21lbnQgZm9yIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgc2VnbWVudCBsaXN0ICh3aGljaCBjb3JyZXNwb25kcyB0byB0aGVcbiAqIGN1cnJlbnRseSBzZXQgYmFuZHdpZHRoKVxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkSW5pdGlhbGl6YXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKSxcbiAgICAgICAgaW5pdGlhbGl6YXRpb24gPSBzZWdtZW50TGlzdC5nZXRJbml0aWFsaXphdGlvbigpO1xuXG4gICAgaWYgKCFpbml0aWFsaXphdGlvbikgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgaW5pdGlhbGl6YXRpb24sIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciBpbml0U2VnbWVudCA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWROZXh0U2VnbWVudCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub0N1cnJlbnRTZWdtZW50TnVtYmVyID0gZXhpc3R5KHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciksXG4gICAgICAgIG51bWJlciA9IG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPyB0aGlzLmdldFN0YXJ0TnVtYmVyKCkgOiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgKyAxO1xuICAgIHJldHVybiB0aGlzLmxvYWRTZWdtZW50QXROdW1iZXIobnVtYmVyKTtcbn07XG5cbi8vIFRPRE86IER1cGxpY2F0ZSBjb2RlIGJlbG93LiBBYnN0cmFjdCBhd2F5LlxuLyoqXG4gKlxuICogTWV0aG9kIGZvciBkb3dubG9hZGluZyBhIHNlZ21lbnQgZnJvbSB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCBiYXNlZCBvbiBpdHMgXCJudW1iZXJcIiAoc2VlIHBhcmFtIGNvbW1lbnQgYmVsb3cpXG4gKlxuICogQHBhcmFtIG51bWJlciB7bnVtYmVyfSAgIEluZGV4LWxpa2UgdmFsdWUgZm9yIHNwZWNpZnlpbmcgd2hpY2ggc2VnbWVudCB0byBsb2FkIGZyb20gdGhlIHNlZ21lbnQgbGlzdC5cbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0TnVtYmVyID0gZnVuY3Rpb24obnVtYmVyKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCk7XG5cbiAgICBjb25zb2xlLmxvZygnQkFORFdJRFRIIE9GIFNFR01FTlQgQkVJTkcgUkVRVUVTVEVEOiAnICsgc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKCkpO1xuXG4gICAgaWYgKG51bWJlciA+IHRoaXMuZ2V0RW5kTnVtYmVyKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeU51bWJlcihudW1iZXIpO1xuXG4gICAgLy8gSWYgdGhlIGJhbmR3aWR0aCBoYXMgY2hhbmdlZCBzaW5jZSBvdXIgbGFzdCBkb3dubG9hZCwgYXV0b21hdGljYWxseSBsb2FkIHRoZSBpbml0aWFsaXphdGlvbiBzZWdtZW50IGZvciB0aGUgY29ycmVzcG9uZGluZ1xuICAgIC8vIHNlZ21lbnQgbGlzdCBiZWZvcmUgZG93bmxvYWRpbmcgdGhlIGRlc2lyZWQgc2VnbWVudClcbiAgICBpZiAodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkKSB7XG4gICAgICAgIHRoaXMub25lKHRoaXMuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBpbml0U2VnbWVudCA9IGV2ZW50LmRhdGE7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpbaW5pdFNlZ21lbnQsIHNlZ21lbnREYXRhXSB9KTtcbiAgICAgICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2FkSW5pdGlhbGl6YXRpb24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvLyBEaXNwYXRjaCBldmVudCB0aGF0IHByb3ZpZGVzIG1ldHJpY3Mgb24gZG93bmxvYWQgcm91bmQgdHJpcCB0aW1lICYgYmFuZHdpZHRoIG9mIHNlZ21lbnQgKHVzZWQgd2l0aCBBQlIgc3dpdGNoaW5nIGxvZ2ljKVxuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTpzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSxcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiBzZWxmLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBydHQ6IHNlbGYuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBsYXliYWNrVGltZTogc2VnbWVudC5nZXREdXJhdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmFuZHdpZHRoOiBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLyoqXG4gKlxuICogTWV0aG9kIGZvciBkb3dubG9hZGluZyBhIHNlZ21lbnQgZnJvbSB0aGUgY3VycmVudGx5IHNlbGVjdGVkIHNlZ21lbnQgbGlzdCBiYXNlZCBvbiB0aGUgbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgdGhhdFxuICogY29ycmVzcG9uZHMgd2l0aCBhIGdpdmVuIHNlZ21lbnQuXG4gKlxuICogQHBhcmFtIHByZXNlbnRhdGlvblRpbWUge251bWJlcn0gbWVkaWEgcHJlc2VudGF0aW9uIHRpbWUgY29ycmVzcG9uZGluZyB0byB0aGUgc2VnbWVudCB3ZSdkIGxpa2UgdG8gbG9hZCBmcm9tIHRoZSBzZWdtZW50IGxpc3RcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGNvbnNvbGUubG9nKCdCQU5EV0lEVEggT0YgU0VHTUVOVCBCRUlORyBSRVFVRVNURUQ6ICcgKyBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG5cbiAgICBpZiAocHJlc2VudGF0aW9uVGltZSA+IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBzZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIC8vIElmIHRoZSBiYW5kd2lkdGggaGFzIGNoYW5nZWQgc2luY2Ugb3VyIGxhc3QgZG93bmxvYWQsIGF1dG9tYXRpY2FsbHkgbG9hZCB0aGUgaW5pdGlhbGl6YXRpb24gc2VnbWVudCBmb3IgdGhlIGNvcnJlc3BvbmRpbmdcbiAgICAvLyBzZWdtZW50IGxpc3QgYmVmb3JlIGRvd25sb2FkaW5nIHRoZSBkZXNpcmVkIHNlZ21lbnQpXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgLy8gRGlzcGF0Y2ggZXZlbnQgdGhhdCBwcm92aWRlcyBtZXRyaWNzIG9uIGRvd25sb2FkIHJvdW5kIHRyaXAgdGltZSAmIGJhbmR3aWR0aCBvZiBzZWdtZW50ICh1c2VkIHdpdGggQUJSIHN3aXRjaGluZyBsb2dpYylcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU2VnbWVudExvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKSB7XG4gICAgdmFyIGJhbmR3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgIGJhbmR3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0QmFuZHdpZHRoKCk7XG4gICAgcmV0dXJuIGJhbmR3aWR0aEEgLSBiYW5kd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciB3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICB3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0V2lkdGgoKSB8fCAwO1xuICAgIHJldHVybiB3aWR0aEEgLSB3aWR0aEI7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciByZXNvbHV0aW9uQ29tcGFyZSA9IGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbiAgICByZXR1cm4gKHJlc29sdXRpb25Db21wYXJlICE9PSAwKSA/IHJlc29sdXRpb25Db21wYXJlIDogY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0LCBtYXhXaWR0aCwgbWF4SGVpZ2h0KSB7XG4gICAgdmFyIHdpZHRoID0gc2VnbWVudExpc3QuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICBoZWlnaHQgPSBzZWdtZW50TGlzdC5nZXRIZWlnaHQoKSB8fCAwO1xuICAgIHJldHVybiAoKHdpZHRoIDw9IG1heFdpZHRoKSAmJiAoaGVpZ2h0IDw9IG1heEhlaWdodCkpO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbykge1xuICAgIHZhciBzZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBzZWdtZW50QmFuZHdpZHRoUmF0aW8gPSBzZWdtZW50TGlzdEJhbmR3aWR0aCAvIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcbiAgICByZXR1cm4gKGRvd25sb2FkUmF0ZVJhdGlvID49IHNlZ21lbnRCYW5kd2lkdGhSYXRpbyk7XG59XG5cbi8vIE5PVEU6IFBhc3NpbmcgaW4gbWVkaWFTZXQgaW5zdGVhZCBvZiBtZWRpYVNldCdzIFNlZ21lbnRMaXN0IEFycmF5IHNpbmNlIHNvcnQgaXMgZGVzdHJ1Y3RpdmUgYW5kIGRvbid0IHdhbnQgdG8gY2xvbmUuXG4vLyAgICAgIEFsc28gYWxsb3dzIGZvciBncmVhdGVyIGZsZXhpYmlsaXR5IG9mIGZuLlxuZnVuY3Rpb24gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpIHtcbiAgICB2YXIgZG93bmxvYWRSYXRlUmF0aW8gPSBkYXRhLmRvd25sb2FkUmF0ZVJhdGlvLFxuICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBkYXRhLmN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCxcbiAgICAgICAgd2lkdGggPSBkYXRhLndpZHRoLFxuICAgICAgICBoZWlnaHQgPSBkYXRhLmhlaWdodCxcbiAgICAgICAgc29ydGVkQnlCYW5kd2lkdGggPSBtZWRpYVNldC5nZXRTZWdtZW50TGlzdHMoKS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyksXG4gICAgICAgIHNvcnRlZEJ5UmVzb2x1dGlvblRoZW5CYW5kd2lkdGggPSBtZWRpYVNldC5nZXRTZWdtZW50TGlzdHMoKS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyksXG4gICAgICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUsXG4gICAgICAgIGZpbHRlcmVkQnlSZXNvbHV0aW9uLFxuICAgICAgICBwcm9wb3NlZFNlZ21lbnRMaXN0O1xuXG4gICAgZnVuY3Rpb24gZmlsdGVyQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0KSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJTZWdtZW50TGlzdHNCeVJlc29sdXRpb24oc2VnbWVudExpc3QsIHdpZHRoLCBoZWlnaHQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbHRlckJ5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0KSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbyk7XG4gICAgfVxuXG4gICAgZmlsdGVyZWRCeVJlc29sdXRpb24gPSBzb3J0ZWRCeVJlc29sdXRpb25UaGVuQmFuZHdpZHRoLmZpbHRlcihmaWx0ZXJCeVJlc29sdXRpb24pO1xuICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUgPSBzb3J0ZWRCeUJhbmR3aWR0aC5maWx0ZXIoZmlsdGVyQnlEb3dubG9hZFJhdGUpO1xuXG4gICAgcHJvcG9zZWRTZWdtZW50TGlzdCA9IGZpbHRlcmVkQnlSZXNvbHV0aW9uW2ZpbHRlcmVkQnlSZXNvbHV0aW9uLmxlbmd0aCAtIDFdIHx8IGZpbHRlcmVkQnlEb3dubG9hZFJhdGVbZmlsdGVyZWRCeURvd25sb2FkUmF0ZS5sZW5ndGggLSAxXSB8fCBzb3J0ZWRCeUJhbmR3aWR0aFswXTtcblxuICAgIHJldHVybiBwcm9wb3NlZFNlZ21lbnRMaXN0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHNlbGVjdFNlZ21lbnRMaXN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyk7XG5cbmZ1bmN0aW9uIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpIHtcbiAgICAvLyBUT0RPOiBDaGVjayB0eXBlP1xuICAgIGlmICghc291cmNlQnVmZmVyKSB7IHRocm93IG5ldyBFcnJvciggJ1RoZSBzb3VyY2VCdWZmZXIgY29uc3RydWN0b3IgYXJndW1lbnQgY2Fubm90IGJlIG51bGwuJyApOyB9XG5cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGRhdGFRdWV1ZSA9IFtdO1xuICAgIC8vIFRPRE86IGZpZ3VyZSBvdXQgaG93IHdlIHdhbnQgdG8gcmVzcG9uZCB0byBvdGhlciBldmVudCBzdGF0ZXMgKHVwZGF0ZWVuZD8gZXJyb3I/IGFib3J0PykgKHJldHJ5PyByZW1vdmU/KVxuICAgIHNvdXJjZUJ1ZmZlci5hZGRFdmVudExpc3RlbmVyKCd1cGRhdGVlbmQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAvLyBUaGUgU291cmNlQnVmZmVyIGluc3RhbmNlJ3MgdXBkYXRpbmcgcHJvcGVydHkgc2hvdWxkIGFsd2F5cyBiZSBmYWxzZSBpZiB0aGlzIGV2ZW50IHdhcyBkaXNwYXRjaGVkLFxuICAgICAgICAvLyBidXQganVzdCBpbiBjYXNlLi4uXG4gICAgICAgIGlmIChldmVudC50YXJnZXQudXBkYXRpbmcpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0FEREVEX1RPX0JVRkZFUiwgdGFyZ2V0OnNlbGYgfSk7XG5cbiAgICAgICAgaWYgKHNlbGYuX19kYXRhUXVldWUubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUVVFVUVfRU1QVFksIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5fX3NvdXJjZUJ1ZmZlci5hcHBlbmRCdWZmZXIoc2VsZi5fX2RhdGFRdWV1ZS5zaGlmdCgpKTtcbiAgICB9KTtcblxuICAgIHRoaXMuX19kYXRhUXVldWUgPSBkYXRhUXVldWU7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlciA9IHNvdXJjZUJ1ZmZlcjtcbn1cblxuLy8gVE9ETzogQWRkIGFzIFwiY2xhc3NcIiBwcm9wZXJ0aWVzP1xuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUVVFVUVfRU1QVFk6ICdxdWV1ZUVtcHR5JyxcbiAgICBTRUdNRU5UX0FEREVEX1RPX0JVRkZFUjogJ3NlZ21lbnRBZGRlZFRvQnVmZmVyJ1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5hZGRUb1F1ZXVlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBkYXRhVG9BZGRJbW1lZGlhdGVseTtcbiAgICBpZiAoIWV4aXN0eShkYXRhKSB8fCAoaXNBcnJheShkYXRhKSAmJiBkYXRhLmxlbmd0aCA8PSAwKSkgeyByZXR1cm47IH1cbiAgICAvLyBUcmVhdCBhbGwgZGF0YSBhcyBhcnJheXMgdG8gbWFrZSBzdWJzZXF1ZW50IGZ1bmN0aW9uYWxpdHkgZ2VuZXJpYy5cbiAgICBpZiAoIWlzQXJyYXkoZGF0YSkpIHsgZGF0YSA9IFtkYXRhXTsgfVxuICAgIC8vIElmIG5vdGhpbmcgaXMgaW4gdGhlIHF1ZXVlLCBnbyBhaGVhZCBhbmQgaW1tZWRpYXRlbHkgYXBwZW5kIHRoZSBmaXJzdCBkYXRhIHRvIHRoZSBzb3VyY2UgYnVmZmVyLlxuICAgIGlmICgodGhpcy5fX2RhdGFRdWV1ZS5sZW5ndGggPT09IDApICYmICghdGhpcy5fX3NvdXJjZUJ1ZmZlci51cGRhdGluZykpIHsgZGF0YVRvQWRkSW1tZWRpYXRlbHkgPSBkYXRhLnNoaWZ0KCk7IH1cbiAgICAvLyBJZiBhbnkgb3RoZXIgZGF0YSAoc3RpbGwpIGV4aXN0cywgcHVzaCB0aGUgcmVzdCBvbnRvIHRoZSBkYXRhUXVldWUuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IHRoaXMuX19kYXRhUXVldWUuY29uY2F0KGRhdGEpO1xuICAgIGlmIChleGlzdHkoZGF0YVRvQWRkSW1tZWRpYXRlbHkpKSB7IHRoaXMuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKGRhdGFUb0FkZEltbWVkaWF0ZWx5KTsgfVxufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5jbGVhclF1ZXVlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IFtdO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5oYXNCdWZmZXJlZERhdGFGb3JUaW1lID0gZnVuY3Rpb24ocHJlc2VudGF0aW9uVGltZSkge1xuICAgIHJldHVybiBjaGVja1RpbWVSYW5nZXNGb3JUaW1lKHRoaXMuX19zb3VyY2VCdWZmZXIuYnVmZmVyZWQsIHByZXNlbnRhdGlvblRpbWUsIGZ1bmN0aW9uKHN0YXJ0VGltZSwgZW5kVGltZSkge1xuICAgICAgICByZXR1cm4gKChzdGFydFRpbWUgPj0gMCkgfHwgKGVuZFRpbWUgPj0gMCkpO1xuICAgIH0pO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5kZXRlcm1pbmVBbW91bnRCdWZmZXJlZEZyb21UaW1lID0gZnVuY3Rpb24ocHJlc2VudGF0aW9uVGltZSkge1xuICAgIC8vIElmIHRoZSByZXR1cm4gdmFsdWUgaXMgPCAwLCBubyBkYXRhIGlzIGJ1ZmZlcmVkIEAgcHJlc2VudGF0aW9uVGltZS5cbiAgICByZXR1cm4gY2hlY2tUaW1lUmFuZ2VzRm9yVGltZSh0aGlzLl9fc291cmNlQnVmZmVyLmJ1ZmZlcmVkLCBwcmVzZW50YXRpb25UaW1lLFxuICAgICAgICBmdW5jdGlvbihzdGFydFRpbWUsIGVuZFRpbWUsIHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICAgICAgICAgIHJldHVybiBlbmRUaW1lIC0gcHJlc2VudGF0aW9uVGltZTtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG5mdW5jdGlvbiBjaGVja1RpbWVSYW5nZXNGb3JUaW1lKHRpbWVSYW5nZXMsIHRpbWUsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHRpbWVSYW5nZXNMZW5ndGggPSB0aW1lUmFuZ2VzLmxlbmd0aCxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGN1cnJlbnRTdGFydFRpbWUsXG4gICAgICAgIGN1cnJlbnRFbmRUaW1lO1xuXG4gICAgZm9yIChpOyBpPHRpbWVSYW5nZXNMZW5ndGg7IGkrKykge1xuICAgICAgICBjdXJyZW50U3RhcnRUaW1lID0gdGltZVJhbmdlcy5zdGFydChpKTtcbiAgICAgICAgY3VycmVudEVuZFRpbWUgPSB0aW1lUmFuZ2VzLmVuZChpKTtcbiAgICAgICAgaWYgKCh0aW1lID49IGN1cnJlbnRTdGFydFRpbWUpICYmICh0aW1lIDw9IGN1cnJlbnRFbmRUaW1lKSkge1xuICAgICAgICAgICAgcmV0dXJuIGlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soY3VycmVudFN0YXJ0VGltZSwgY3VycmVudEVuZFRpbWUsIHRpbWUpIDogdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50U3RhcnRUaW1lID4gdGltZSkge1xuICAgICAgICAgICAgLy8gSWYgdGhlIGN1cnJlbnRTdGFydFRpbWUgaXMgZ3JlYXRlciB0aGFuIHRoZSB0aW1lIHdlJ3JlIGxvb2tpbmcgZm9yLCB0aGF0IG1lYW5zIHdlJ3ZlIHJlYWNoZWQgYSB0aW1lIHJhbmdlXG4gICAgICAgICAgICAvLyB0aGF0J3MgcGFzdCB0aGUgdGltZSB3ZSdyZSBsb29raW5nIGZvciAoc2luY2UgVGltZVJhbmdlcyBzaG91bGQgYmUgb3JkZXJlZCBjaHJvbm9sb2dpY2FsbHkpLiBJZiBzbywgd2VcbiAgICAgICAgICAgIC8vIGNhbiBzaG9ydCBjaXJjdWl0LlxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjaygtMSwgLTEsIHRpbWUpIDogZmFsc2U7XG59XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VCdWZmZXJEYXRhUXVldWU7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4gKHggIT09IG51bGwpICYmICh4ICE9PSB1bmRlZmluZWQpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gZXhpc3R5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gRXh0ZW5kIGEgZ2l2ZW4gb2JqZWN0IHdpdGggYWxsIHRoZSBwcm9wZXJ0aWVzIChhbmQgdGhlaXIgdmFsdWVzKSBmb3VuZCBpbiB0aGUgcGFzc2VkLWluIG9iamVjdChzKS5cbnZhciBleHRlbmRPYmplY3QgPSBmdW5jdGlvbihvYmogLyosIGV4dGVuZE9iamVjdDEsIGV4dGVuZE9iamVjdDIsIC4uLiwgZXh0ZW5kT2JqZWN0TiAqLykge1xuICAgIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSkuZm9yRWFjaChmdW5jdGlvbihleHRlbmRPYmplY3QpIHtcbiAgICAgICAgaWYgKGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgICAgICBvYmpbcHJvcF0gPSBleHRlbmRPYmplY3RbcHJvcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gb2JqO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRPYmplY3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzQXJyYXkob2JqKSB7XG4gICAgcmV0dXJuIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzRnVuY3Rpb24gPSBmdW5jdGlvbiBpc0Z1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcbn07XG4vLyBmYWxsYmFjayBmb3Igb2xkZXIgdmVyc2lvbnMgb2YgQ2hyb21lIGFuZCBTYWZhcmlcbmlmIChpc0Z1bmN0aW9uKC94LykpIHtcbiAgICBpc0Z1bmN0aW9uID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXSc7XG4gICAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0Z1bmN0aW9uOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc051bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBOdW1iZXJdJyB8fCBmYWxzZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc051bWJlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgU3RyaW5nXScgfHwgZmFsc2U7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzU3RyaW5nOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vZXhpc3R5LmpzJyk7XG5cbi8vIE5PVEU6IFRoaXMgdmVyc2lvbiBvZiB0cnV0aHkgYWxsb3dzIG1vcmUgdmFsdWVzIHRvIGNvdW50XG4vLyBhcyBcInRydWVcIiB0aGFuIHN0YW5kYXJkIEpTIEJvb2xlYW4gb3BlcmF0b3IgY29tcGFyaXNvbnMuXG4vLyBTcGVjaWZpY2FsbHksIHRydXRoeSgpIHdpbGwgcmV0dXJuIHRydWUgZm9yIHRoZSB2YWx1ZXNcbi8vIDAsIFwiXCIsIGFuZCBOYU4sIHdoZXJlYXMgSlMgd291bGQgdHJlYXQgdGhlc2UgYXMgXCJmYWxzeVwiIHZhbHVlcy5cbmZ1bmN0aW9uIHRydXRoeSh4KSB7IHJldHVybiAoeCAhPT0gZmFsc2UpICYmIGV4aXN0eSh4KTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IHRydXRoeTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIFRPRE86IFJlZmFjdG9yIHRvIHNlcGFyYXRlIGpzIGZpbGVzICYgbW9kdWxlcyAmIHJlbW92ZSBmcm9tIGhlcmUuXG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuL3V0aWwvaXNTdHJpbmcuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbmZ1bmN0aW9uIHByZUFwcGx5QXJnc0ZuKGZ1biAvKiwgYXJncyAqLykge1xuICAgIHZhciBwcmVBcHBsaWVkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgLy8gTk9URTogdGhlICp0aGlzKiByZWZlcmVuY2Ugd2lsbCByZWZlciB0byB0aGUgY2xvc3VyZSdzIGNvbnRleHQgdW5sZXNzXG4gICAgLy8gdGhlIHJldHVybmVkIGZ1bmN0aW9uIGlzIGl0c2VsZiBjYWxsZWQgdmlhIC5jYWxsKCkgb3IgLmFwcGx5KCkuIElmIHlvdVxuICAgIC8vICpuZWVkKiB0byByZWZlciB0byBpbnN0YW5jZS1sZXZlbCBwcm9wZXJ0aWVzLCBkbyBzb21ldGhpbmcgbGlrZSB0aGUgZm9sbG93aW5nOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBmdW5jdGlvbihhcmdDKSB7IHByZUFwcGx5QXJnc0ZuKHNvbWVPdGhlckZuLCBhcmdBLCBhcmdCLCAuLi4gYXJnTikuY2FsbCh0aGlzKTsgfTtcbiAgICAvL1xuICAgIC8vIE90aGVyd2lzZSwgeW91IHNob3VsZCBiZSBhYmxlIHRvIGp1c3QgY2FsbDpcbiAgICAvL1xuICAgIC8vIE15VHlwZS5wcm90b3R5cGUuc29tZUZuID0gcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKTtcbiAgICAvL1xuICAgIC8vIFdoZXJlIHBvc3NpYmxlLCBmdW5jdGlvbnMgYW5kIG1ldGhvZHMgc2hvdWxkIG5vdCBiZSByZWFjaGluZyBvdXQgdG8gZ2xvYmFsIHNjb3BlIGFueXdheSwgc28uLi5cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7IHJldHVybiBmdW4uYXBwbHkodGhpcywgcHJlQXBwbGllZEFyZ3MpOyB9O1xufVxuXG4vLyBIaWdoZXItb3JkZXIgWE1MIGZ1bmN0aW9uc1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHNcbnZhciBnZXRBbmNlc3RvcnMgPSBmdW5jdGlvbihlbGVtLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIHZhciBhbmNlc3RvcnMgPSBbXTtcbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIChmdW5jdGlvbiBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0sIGFuY2VzdG9ycykpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmIChleGlzdHkoZWxlbSkgJiYgZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHtcbiAgICAgICAgICAgIGFuY2VzdG9ycy5wdXNoKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgICAgICBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH0pKGVsZW0pO1xuICAgIHJldHVybiBhbmNlc3RvcnM7XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0Tm9kZUxpc3RCeU5hbWUgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHhtbE9iaikge1xuICAgICAgICByZXR1cm4geG1sT2JqLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSwgdmFsdWUpIHtcbiAgICBpZiAoKHR5cGVvZiBhdHRyTmFtZSAhPT0gJ3N0cmluZycpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICAgIGlmICghZXhpc3R5KHZhbHVlKSkgeyByZXR1cm4gZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIHJldHVybiAoZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpID09PSB2YWx1ZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRBdHRyRm4gPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICghaXNTdHJpbmcoYXR0ck5hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhaXNGdW5jdGlvbihlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG4vLyBUT0RPOiBBZGQgc2hvdWxkU3RvcFByZWQgKHNob3VsZCBmdW5jdGlvbiBzaW1pbGFybHkgdG8gc2hvdWxkU3RvcFByZWQgaW4gZ2V0SW5oZXJpdGFibGVFbGVtZW50LCBiZWxvdylcbnZhciBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcoYXR0ck5hbWUpKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSkpIHsgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHM7IFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBmdW5jdGlvbihub2RlTmFtZSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhub2RlTmFtZSkpIHx8IG5vZGVOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICB2YXIgbWF0Y2hpbmdFbGVtTGlzdCA9IGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUobm9kZU5hbWUpO1xuICAgICAgICBpZiAoZXhpc3R5KG1hdGNoaW5nRWxlbUxpc3QpICYmIG1hdGNoaW5nRWxlbUxpc3QubGVuZ3RoID4gMCkgeyByZXR1cm4gbWF0Y2hpbmdFbGVtTGlzdFswXTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxuLy8gVE9ETzogSW1wbGVtZW50IG1lIGZvciBCYXNlVVJMIG9yIHVzZSBleGlzdGluZyBmbiAoU2VlOiBtcGQuanMgYnVpbGRCYXNlVXJsKCkpXG4vKnZhciBidWlsZEhpZXJhcmNoaWNhbGx5U3RydWN0dXJlZFZhbHVlID0gZnVuY3Rpb24odmFsdWVGbiwgYnVpbGRGbiwgc3RvcFByZWQpIHtcblxufTsqL1xuXG4vLyBQdWJsaXNoIEV4dGVybmFsIEFQSTpcbnZhciB4bWxmdW4gPSB7fTtcbnhtbGZ1bi5leGlzdHkgPSBleGlzdHk7XG54bWxmdW4udHJ1dGh5ID0gdHJ1dGh5O1xuXG54bWxmdW4uZ2V0Tm9kZUxpc3RCeU5hbWUgPSBnZXROb2RlTGlzdEJ5TmFtZTtcbnhtbGZ1bi5oYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGhhc01hdGNoaW5nQXR0cmlidXRlO1xueG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0QW5jZXN0b3JzID0gZ2V0QW5jZXN0b3JzO1xueG1sZnVuLmdldEF0dHJGbiA9IGdldEF0dHJGbjtcbnhtbGZ1bi5wcmVBcHBseUFyZ3NGbiA9IHByZUFwcGx5QXJnc0ZuO1xueG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCA9IGdldEluaGVyaXRhYmxlRWxlbWVudDtcblxubW9kdWxlLmV4cG9ydHMgPSB4bWxmdW47Il19
