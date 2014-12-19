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
    MIN_DESIRED_BUFFER_SIZE = 20,
    MAX_DESIRED_BUFFER_SIZE = 40;

// TODO: Rename object type (MediaTypeLoader?)
function MediaTypeLoader(segmentLoader, sourceBufferDataQueue, mediaType, tech) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__mediaType = mediaType;
    this.__tech = tech;
}

MediaTypeLoader.prototype.eventList = {
    RECHECK_SEGMENT_LOADING: 'recheckSegmentLoading'
};

MediaTypeLoader.prototype.getMediaType = function() { return this.__mediaType; };

MediaTypeLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

MediaTypeLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

MediaTypeLoader.prototype.startLoadingSegments = function() {
    var self = this;
    this.__recheckSegmentLoadingHandler = function(event) {
        self.__checkSegmentLoading(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
    };

    this.on(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);

    this.__checkSegmentLoading(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
};

MediaTypeLoader.prototype.stopLoadingSegments = function() {
    if (!existy(this.__recheckSegmentLoadingHandler)) { return; }

    this.off(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);
    this.__recheckSegmentLoadingHandler = undefined;
};

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

MediaTypeLoader.prototype.__loadSegmentAtTime = function loadSegmentAtTime(presentationTime) {
    var self = this,
        segmentLoader = self.__segmentLoader,
        sourceBufferDataQueue = self.__sourceBufferDataQueue,
        hasNextSegment = segmentLoader.loadSegmentAtTime(presentationTime);

    if (!hasNextSegment) { return hasNextSegment; }

    segmentLoader.one(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
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

function createMediaTypeLoaders(manifestController, mediaSource, tech) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return exists; }),
        mediaTypeLoaders = matchedTypes.map(function(mediaType) { return createMediaTypeLoaderForType(manifestController, mediaSource, mediaType, tech); });
    return mediaTypeLoaders;
}

function sortSegmentListsByBandwidthAscending(segmentListA, segmentListB) {
    var bandwidthA = segmentListA.getBandwidth(),
        bandwidthB = segmentListB.getBandwidth();
    return bandwidthA - bandwidthB;
}

function sortSegmentListsByResolutionAscending(segmentListA, segmentListB) {
    var widthA = segmentListA.getWidth() || 0,
        widthB = segmentListB.getWidth() || 0;
    return widthA - widthB;
}

function sortSegmentListsByResolutionThenBandwidthAscending(segmentListA, segmentListB) {
    var resolutionCompare = sortSegmentListsByResolutionAscending(segmentListA, segmentListB);
    return (resolutionCompare !== 0) ? resolutionCompare : sortSegmentListsByBandwidthAscending(segmentListA, segmentListB);
}

function filterSegmentListsByResolution(segmentList, maxWidth, maxHeight) {
    var width = segmentList.getWidth() || 0,
        height = segmentList.getHeight() || 0;
    return ((width <= maxWidth) && (height <= maxHeight));
}

function filterSegmentListsByDownloadRate(segmentList, currentSegmentList, downloadRateRatio) {
    var segmentListBandwidth = segmentList.getBandwidth(),
        currentSegmentListBandwidth = currentSegmentList.getBandwidth(),
        segmentBandwidthRatio = segmentListBandwidth / currentSegmentListBandwidth;
    return (downloadRateRatio >= segmentBandwidthRatio);
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    var self = this;
    //this.__downloadRateMonitor = {};
    this.__tech = tech;
    this.__mediaTypeLoaders = createMediaTypeLoaders(manifestController, mediaSource, tech);

    this.__mediaTypeLoaders.forEach(function(mediaTypeLoader) {
        // MediaSet-specific variables
        var segmentLoader = mediaTypeLoader.getSegmentLoader(),
            downloadRateRatio = 1.0,
            currentSegmentListBandwidth = segmentLoader.getCurrentSegmentList().getBandwidth(),
            mediaType = mediaTypeLoader.getMediaType();

        // TODO: Currently an event add order dependency. Refactor MediaTypeLoader & PlaylistLoader to change this?
        mediaTypeLoader.on(mediaTypeLoader.eventList.RECHECK_SEGMENT_LOADING, function(event) {
            var mediaSet = manifestController.getMediaSetByType(mediaType),
                isFullscreen = tech.player().isFullscreen(),
                data = {},
                selectedSegmentList;

            data.downloadRateRatio = downloadRateRatio;
            data.currentSegmentListBandwidth = currentSegmentListBandwidth;
            data.width = isFullscreen ? window.screen.width : tech.player().width();
            data.height = isFullscreen ? window.screen.height : tech.player().height();

            selectedSegmentList = selectSegmentList(mediaSet, data);

            // TODO: Should we refactor to set based on segmentList instead?
            segmentLoader.setCurrentBandwidth(selectedSegmentList.getBandwidth());
        });

        segmentLoader.on(segmentLoader.eventList.DOWNLOAD_DATA_UPDATE, function(event) {
            downloadRateRatio = event.data.playbackTime / event.data.rtt;
            currentSegmentListBandwidth = event.data.bandwidth;
        });

        mediaTypeLoader.startLoadingSegments();
    });

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

function SourceHandler(source, tech) {
    var self = this,
        manifestController = new ManifestController(source.src, false);

    manifestController.load(function(manifest) {
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
        parsedMediaPresentationDuration = Number(parseMediaPresentationDuration(mediaPresentationDuration)),
        presentationTimeOffset = Number(representation.getSegmentTemplate().getPresentationTimeOffset());
    return Number(parsedMediaPresentationDuration - presentationTimeOffset);
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
            // TODO: Since $Time$-templated segment URLs should only exist in conjunction w/a <SegmentTimeline>,
            // TODO: can currently assume a $Number$-based templated url.
            // TODO: Enforce min/max number range (based on segmentList startNumber & endNumber)
            replacedNumberUrl = segmentTemplate.replaceTokenForTemplate(replacedIdUrl, 'Number', number);
        return baseUrl + replacedNumberUrl;
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
 * Created by cpillsbury on 12/3/14.
 */
;(function() {
    'use strict';

    var root = require('global/window'),
        videojs = root.videojs,
        SourceHandler = require('./SourceHandler');

    if (!videojs) {
        throw new Error('The video.js library must be included to use this MPEG-DASH source handler.');
    }

    function canHandleSource(source) {
        // Externalize if used elsewhere. Potentially use constant function.
        var doesntHandleSource = '',
            maybeHandleSource = 'maybe',
            defaultHandleSource = doesntHandleSource;

        // TODO: Use safer vjs check (e.g. handles IE conditions)?
        // Requires Media Source Extensions
        if (!(root.MediaSource)) {
            return doesntHandleSource;
        }

        // Check if the type is supported
        if (/application\/dash\+xml/.test(source.type)) {
            console.log('matched type');
            return maybeHandleSource;
        }

        // Check if the file extension matches
        if (/\.mpd$/i.test(source.src)) {
            console.log('matched extension');
            return maybeHandleSource;
        }

        return defaultHandleSource;
    }

    function handleSource(source, tech) {
        return new SourceHandler(source, tech);
    }

    // Register the source handler
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

getMediaTypeFromMimeType = function(mimeType, types) {
    if (!isString(mimeType)) { return DEFAULT_TYPE; }
    var matchedType = types.find(function(type) {
        return (!!mimeType && mimeType.indexOf(type) >= 0);
    });

    return existy(matchedType) ? matchedType : DEFAULT_TYPE;
};

// TODO: Move to own module in dash package somewhere
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


function Manifest(sourceUri, autoLoad) {
    this.__autoLoad = truthy(autoLoad);
    this.setSourceUri(sourceUri);
}

Manifest.prototype.eventList = {
    MANIFEST_LOADED: 'manifestLoaded'
};


Manifest.prototype.getSourceUri = function() {
    return this.__sourceUri;
};

Manifest.prototype.setSourceUri = function setSourceUri(sourceUri) {
    // TODO: 'existy()' check for both?
    if (sourceUri === this.__sourceUri) { return; }

    // TODO: isString() check? 'existy()' check?
    if (!sourceUri) {
        this.__clearSourceUri();
        return;
    }

    this.__clearCurrentUpdateInterval();
    this.__sourceUri = sourceUri;
    if (this.__autoLoad) {
        // TODO: Impl any cleanup functionality appropriate before load.
        this.load();
    }
};

Manifest.prototype.__clearSourceUri = function clearSourceUri() {
    this.__sourceUri = null;
    this.__clearCurrentUpdateInterval();
    // TODO: impl any other cleanup functionality
};

Manifest.prototype.load = function load(/* optional */ callbackFn) {
    var self = this;
    loadManifest(self.__sourceUri, function(data) {
        self.__manifest = data.manifestXml;
        self.__setupUpdateInterval();
        self.trigger({ type:self.eventList.MANIFEST_LOADED, target:self, data:self.__manifest});
        if (isFunction(callbackFn)) { callbackFn(data.manifestXml); }
    });
};

Manifest.prototype.__clearCurrentUpdateInterval = function clearCurrentUpdateInterval() {
    if (!existy(this.__updateInterval)) { return; }
    clearInterval(this.__updateInterval);
};

Manifest.prototype.__setupUpdateInterval = function setupUpdateInterval() {
    if (this.__updateInterval) { self.__clearCurrentUpdateInterval(); }
    if (!this.getShouldUpdate()) { return; }
    var self = this,
        minUpdateRate = 2,
        updateRate = Math.max(this.getUpdateRate(), minUpdateRate);
    this.__updateInterval = setInterval(function() {
        self.load();
    }, updateRate);
};

Manifest.prototype.getMediaSetByType = function getMediaSetByType(type) {
    if (mediaTypes.indexOf(type) < 0) { throw new Error('Invalid type. Value must be one of: ' + mediaTypes.join(', ')); }
    var adaptationSets = getMpd(this.__manifest).getPeriods()[0].getAdaptationSets(),
        adaptationSetWithTypeMatch = adaptationSets.find(function(adaptationSet) {
            return (getMediaTypeFromMimeType(adaptationSet.getMimeType(), mediaTypes) === type);
        });
    if (!existy(adaptationSetWithTypeMatch)) { return null; }
    return new MediaSet(adaptationSetWithTypeMatch);
};

Manifest.prototype.getMediaSets = function getMediaSets() {
    var adaptationSets = getMpd(this.__manifest).getPeriods()[0].getAdaptationSets(),
        mediaSets = adaptationSets.map(function(adaptationSet) { return new MediaSet(adaptationSet); });
    return mediaSets;
};

Manifest.prototype.getStreamType = function getStreamType() {
    var streamType = getMpd(this.__manifest).getType();
    return streamType;
};

Manifest.prototype.getUpdateRate = function getUpdateRate() {
    var minimumUpdatePeriod = getMpd(this.__manifest).getMinimumUpdatePeriod();
    return Number(minimumUpdatePeriod);
};

Manifest.prototype.getShouldUpdate = function getShouldUpdate() {
    var isDynamic = (this.getStreamType() === 'dynamic'),
        hasValidUpdateRate = (this.getUpdateRate() > 0);
    return (isDynamic && hasValidUpdateRate);
};

extendObject(Manifest.prototype, EventDispatcherMixin);

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

module.exports = Manifest;
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
        //this.debug.log('Start loading manifest: ' + url);
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

function SegmentLoader(manifestController, mediaType) {
    if (!existy(manifestController)) { throw new Error('SegmentLoader must be initialized with a manifestController!'); }
    if (!existy(mediaType)) { throw new Error('SegmentLoader must be initialized with a mediaType!'); }
    this.__manifest = manifestController;
    this.__mediaType = mediaType;
    // TODO: Don't like this: Need to centralize place(s) where & how __currentBandwidthChanged gets set to true/false.
    this.__currentBandwidth = this.getCurrentBandwidth();
    this.__currentBandwidthChanged = true;
}

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

SegmentLoader.prototype.setCurrentBandwidth = function setCurrentBandwidth(bandwidth) {
    if (!isNumber(bandwidth)) {
        throw new Error('SegmentLoader::setCurrentBandwidth() expects a numeric value for bandwidth!');
    }
    var availableBandwidths = this.getAvailableBandwidths();
    if (availableBandwidths.indexOf(bandwidth) < 0) {
        throw new Error('SegmentLoader::setCurrentBandwidth() must be set to one of the following values: ' + availableBandwidths.join(', '));
    }
    if (bandwidth === this.__currentBandwidth) { return; }
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
SegmentLoader.prototype.loadSegmentAtNumber = function(number) {
    var self = this,
        segmentList = this.getCurrentSegmentList();

    console.log('BANDWIDTH OF SEGMENT BEING REQUESTED: ' + segmentList.getBandwidth());

    if (number > this.getEndNumber()) { return false; }

    var segment = segmentList.getSegmentByNumber(number);

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

SegmentLoader.prototype.loadSegmentAtTime = function(presentationTime) {
    var self = this,
        segmentList = this.getCurrentSegmentList();

    console.log('BANDWIDTH OF SEGMENT BEING REQUESTED: ' + segmentList.getBandwidth());

    if (presentationTime > segmentList.getTotalDuration()) { return false; }

    var segment = segmentList.getSegmentByTime(presentationTime);

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
},{"./util/existy.js":18,"./util/isFunction.js":21,"./util/isString.js":23}]},{},[11]);
