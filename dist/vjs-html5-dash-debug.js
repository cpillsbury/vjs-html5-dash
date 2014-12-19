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
    RECHECK_SEGMENT_LOADING: 'recheckSegmentLoading',
    RECHECK_CURRENT_SEGMENT_LIST: 'recheckCurrentSegmentList',
};

MediaTypeLoader.prototype.getMediaType = function() { return this.__mediaType; };

MediaTypeLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

MediaTypeLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

MediaTypeLoader.prototype.startLoadingSegments = function() {
    var self = this;
    this.__recheckSegmentLoadingHandler = function(event) {
        self.trigger({ type:self.eventList.RECHECK_CURRENT_SEGMENT_LIST, target:self });
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

function PlaylistLoader(manifestController, mediaSource, tech) {
    this.__tech = tech;
    this.__mediaTypeLoaders = createMediaTypeLoaders(manifestController, mediaSource, tech);

    this.__mediaTypeLoaders.forEach(function(mediaTypeLoader) {
        // MediaSet-specific variables
        var segmentLoader = mediaTypeLoader.getSegmentLoader(),
            downloadRateRatio = 1.0,
            currentSegmentListBandwidth = segmentLoader.getCurrentSegmentList().getBandwidth(),
            mediaType = mediaTypeLoader.getMediaType();

        mediaTypeLoader.on(mediaTypeLoader.eventList.RECHECK_CURRENT_SEGMENT_LIST, function(event) {
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
},{"./util/existy.js":18,"./util/isFunction.js":21,"./util/isString.js":23}]},{},[11])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL09BOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKGdsb2JhbCl7XG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gd2luZG93O1xufSBlbHNlIGlmICh0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBnbG9iYWw7XG59IGVsc2UgaWYgKHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiKXtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHNlbGY7XG59IGVsc2Uge1xuICAgIG1vZHVsZS5leHBvcnRzID0ge307XG59XG5cbn0pLmNhbGwodGhpcyx0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDogdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9KSIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFID0gMjAsXG4gICAgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUgPSA0MDtcblxuLy8gVE9ETzogUmVuYW1lIG9iamVjdCB0eXBlIChNZWRpYVR5cGVMb2FkZXI/KVxuZnVuY3Rpb24gTWVkaWFUeXBlTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX3NlZ21lbnRMb2FkZXIgPSBzZWdtZW50TG9hZGVyO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWU7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG59XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HOiAncmVjaGVja1NlZ21lbnRMb2FkaW5nJyxcbiAgICBSRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNUOiAncmVjaGVja0N1cnJlbnRTZWdtZW50TGlzdCcsXG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX21lZGlhVHlwZTsgfTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRTZWdtZW50TG9hZGVyID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc2VnbWVudExvYWRlcjsgfTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWU7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuc3RhcnRMb2FkaW5nU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlJFQ0hFQ0tfQ1VSUkVOVF9TRUdNRU5UX0xJU1QsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICBzZWxmLl9fY2hlY2tTZWdtZW50TG9hZGluZyhNSU5fREVTSVJFRF9CVUZGRVJfU0laRSwgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUpO1xuICAgIH07XG5cbiAgICB0aGlzLm9uKHRoaXMuZXZlbnRMaXN0LlJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HLCB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcik7XG5cbiAgICB0aGlzLl9fY2hlY2tTZWdtZW50TG9hZGluZyhNSU5fREVTSVJFRF9CVUZGRVJfU0laRSwgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUpO1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5zdG9wTG9hZGluZ1NlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpKSB7IHJldHVybjsgfVxuXG4gICAgdGhpcy5vZmYodGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IHVuZGVmaW5lZDtcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuX19jaGVja1NlZ21lbnRMb2FkaW5nID0gZnVuY3Rpb24obWluRGVzaXJlZEJ1ZmZlclNpemUsIG1heERlc2lyZWRCdWZmZXJTaXplKSB7XG4gICAgLy8gVE9ETzogVXNlIHNlZ21lbnQgZHVyYXRpb24gd2l0aCBjdXJyZW50VGltZSAmIGN1cnJlbnRCdWZmZXJTaXplIHRvIGNhbGN1bGF0ZSB3aGljaCBzZWdtZW50IHRvIGdyYWIgdG8gYXZvaWQgZWRnZSBjYXNlcyB3L3JvdW5kaW5nICYgcHJlY2lzaW9uXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICB0ZWNoID0gc2VsZi5fX3RlY2gsXG4gICAgICAgIHNlZ21lbnRMb2FkZXIgPSBzZWxmLl9fc2VnbWVudExvYWRlcixcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc2VsZi5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSxcbiAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCksXG4gICAgICAgIGN1cnJlbnRCdWZmZXJTaXplID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlLmRldGVybWluZUFtb3VudEJ1ZmZlcmVkRnJvbVRpbWUoY3VycmVudFRpbWUpLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnREdXJhdGlvbigpLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRUb3RhbER1cmF0aW9uKCksXG4gICAgICAgIGRvd25sb2FkUG9pbnQgPSAoY3VycmVudFRpbWUgKyBjdXJyZW50QnVmZmVyU2l6ZSkgKyAoc2VnbWVudER1cmF0aW9uIC8gNCksXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSxcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXk7XG5cbiAgICBmdW5jdGlvbiBkZWZlcnJlZFJlY2hlY2tOb3RpZmljYXRpb24oKSB7XG4gICAgICAgIHZhciByZWNoZWNrV2FpdFRpbWVNUyA9IE1hdGguZmxvb3IoTWF0aC5taW4oc2VnbWVudER1cmF0aW9uLCAyKSAqIDEwMDApO1xuICAgICAgICByZWNoZWNrV2FpdFRpbWVNUyA9IE1hdGguZmxvb3IoTWF0aC5taW4oc2VnbWVudER1cmF0aW9uLCAyKSAqIDEwMDApO1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIH0sIHJlY2hlY2tXYWl0VGltZU1TKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGUgcHJvcG9zZWQgdGltZSB0byBkb3dubG9hZCBpcyBhZnRlciB0aGUgZW5kIHRpbWUgb2YgdGhlIG1lZGlhIG9yIHdlIGhhdmUgbW9yZSBpbiB0aGUgYnVmZmVyIHRoYW4gdGhlIG1heCBkZXNpcmVkLFxuICAgIC8vIHdhaXQgYSB3aGlsZSBhbmQgdGhlbiB0cmlnZ2VyIGFuIGV2ZW50IG5vdGlmeWluZyB0aGF0IChpZiBhbnlvbmUncyBsaXN0ZW5pbmcpIHdlIHNob3VsZCByZWNoZWNrIHRvIHNlZSBpZiBjb25kaXRpb25zXG4gICAgLy8gaGF2ZSBjaGFuZ2VkLlxuICAgIC8vIFRPRE86IEhhbmRsZSBjb25kaXRpb24gd2hlcmUgZmluYWwgc2VnbWVudCdzIGR1cmF0aW9uIGlzIGxlc3MgdGhhbiAxLzIgc3RhbmRhcmQgc2VnbWVudCdzIGR1cmF0aW9uLlxuICAgIGlmIChkb3dubG9hZFBvaW50ID49IHRvdGFsRHVyYXRpb24pIHtcbiAgICAgICAgZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoY3VycmVudEJ1ZmZlclNpemUgPD0gMCkge1xuICAgICAgICAvLyBDb25kaXRpb24gMTogTm90aGluZyBpcyBpbiB0aGUgc291cmNlIGJ1ZmZlciBzdGFydGluZyBhdCB0aGUgY3VycmVudCB0aW1lIGZvciB0aGUgbWVkaWEgdHlwZVxuICAgICAgICAvLyBSZXNwb25zZTogRG93bmxvYWQgdGhlIHNlZ21lbnQgZm9yIHRoZSBjdXJyZW50IHRpbWUgcmlnaHQgbm93LlxuICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoY3VycmVudFRpbWUpO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudEJ1ZmZlclNpemUgPCBtaW5EZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgICAgICAvLyBDb25kaXRpb24gMjogVGhlcmUncyBzb21ldGhpbmcgaW4gdGhlIHNvdXJjZSBidWZmZXIgc3RhcnRpbmcgYXQgdGhlIGN1cnJlbnQgdGltZSBmb3IgdGhlIG1lZGlhIHR5cGUsIGJ1dCBpdCdzXG4gICAgICAgIC8vICAgICAgICAgICAgICBiZWxvdyB0aGUgbWluaW11bSBkZXNpcmVkIGJ1ZmZlciBzaXplIChzZWNvbmRzIG9mIHBsYXliYWNrIGluIHRoZSBidWZmZXIgZm9yIHRoZSBtZWRpYSB0eXBlKVxuICAgICAgICAvLyBSZXNwb25zZTogRG93bmxvYWQgdGhlIHNlZ21lbnQgdGhhdCB3b3VsZCBpbW1lZGlhdGVseSBmb2xsb3cgdGhlIGVuZCBvZiB0aGUgYnVmZmVyIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudCB0aW1lKS5cbiAgICAgICAgLy8gICAgICAgICAgIHJpZ2h0IG5vdy5cbiAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudEJ1ZmZlclNpemUgPCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgICAgICAvLyBDb25kaXRpb24gMzogVGhlIGJ1ZmZlciBpcyBmdWxsIG1vcmUgdGhhbiB0aGUgbWluaW11bSBkZXNpcmVkIGJ1ZmZlciBzaXplIGJ1dCBub3QgeWV0IG1vcmUgdGhhbiB0aGUgbWF4aW11bSBkZXNpcmVkXG4gICAgICAgIC8vICAgICAgICAgICAgICBidWZmZXIgc2l6ZS5cbiAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lID0gc2VnbWVudExvYWRlci5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpO1xuICAgICAgICBzZWdtZW50RG93bmxvYWREZWxheSA9IHNlZ21lbnREdXJhdGlvbiAtIGRvd25sb2FkUm91bmRUcmlwVGltZTtcbiAgICAgICAgaWYgKHNlZ21lbnREb3dubG9hZERlbGF5IDw9IDApIHtcbiAgICAgICAgICAgIC8vIENvbmRpdGlvbiAzYTogSXQgdG9vayBhdCBsZWFzdCBhcyBsb25nIGFzIHRoZSBkdXJhdGlvbiBvZiBhIHNlZ21lbnQgKGkuZS4gdGhlIGFtb3VudCBvZiB0aW1lIGl0IHdvdWxkIHRha2VcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgdG8gcGxheSBhIGdpdmVuIHNlZ21lbnQpIHRvIGRvd25sb2FkIHRoZSBwcmV2aW91cyBzZWdtZW50LlxuICAgICAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnRcbiAgICAgICAgICAgIC8vICAgICAgICAgICB0aW1lKSByaWdodCBub3cuXG4gICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBDb25kaXRpb24gM2I6IERvd25sb2FkaW5nIHRoZSBwcmV2aW91cyBzZWdtZW50IHRvb2sgbGVzcyB0aW1lIHRoYW4gdGhlIGR1cmF0aW9uIG9mIGEgc2VnbWVudCAoaS5lLiB0aGUgYW1vdW50XG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIG9mIHRpbWUgaXQgd291bGQgdGFrZSB0byBwbGF5IGEgZ2l2ZW4gc2VnbWVudCkuXG4gICAgICAgICAgICAvLyBSZXNwb25zZTogRG93bmxvYWQgdGhlIHNlZ21lbnQgdGhhdCB3b3VsZCBpbW1lZGlhdGVseSBmb2xsb3cgdGhlIGVuZCBvZiB0aGUgYnVmZmVyIChyZWxhdGl2ZSB0byB0aGUgY3VycmVudFxuICAgICAgICAgICAgLy8gICAgICAgICAgIHRpbWUpLCBidXQgd2FpdCB0byBkb3dubG9hZCBhdCB0aGUgcmF0ZSBvZiBwbGF5YmFjayAoc2VnbWVudCBkdXJhdGlvbiAtIHRpbWUgdG8gZG93bmxvYWQpLlxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50VGltZSA9IHRlY2guY3VycmVudFRpbWUoKTtcbiAgICAgICAgICAgICAgICBjdXJyZW50QnVmZmVyU2l6ZSA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5kZXRlcm1pbmVBbW91bnRCdWZmZXJlZEZyb21UaW1lKGN1cnJlbnRUaW1lKTtcbiAgICAgICAgICAgICAgICBkb3dubG9hZFBvaW50ID0gKGN1cnJlbnRUaW1lICsgY3VycmVudEJ1ZmZlclNpemUpICsgKHNlZ21lbnREdXJhdGlvbiAvIDIpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICAgICAgICAgIH0sIE1hdGguZmxvb3Ioc2VnbWVudERvd25sb2FkRGVsYXkgKiAxMDAwKSk7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDb25kaXRpb24gNCAoZGVmYXVsdCk6IFRoZSBidWZmZXIgaGFzIGF0IGxlYXN0IHRoZSBtYXggZGVzaXJlZCBidWZmZXIgc2l6ZSBpbiBpdCBvciBub25lIG9mIHRoZSBhZm9yZW1lbnRpb25lZFxuICAgICAgICAvLyAgICAgICAgICAgICAgICAgICAgICAgIGNvbmRpdGlvbnMgd2VyZSBtZXQuXG4gICAgICAgIC8vIFJlc3BvbnNlOiBXYWl0IGEgd2hpbGUgYW5kIHRoZW4gdHJpZ2dlciBhbiBldmVudCBub3RpZnlpbmcgdGhhdCAoaWYgYW55b25lJ3MgbGlzdGVuaW5nKSB3ZSBzaG91bGQgcmVjaGVjayB0b1xuICAgICAgICAvLyAgICAgICAgICAgc2VlIGlmIGNvbmRpdGlvbnMgaGF2ZSBjaGFuZ2VkLlxuICAgICAgICBkZWZlcnJlZFJlY2hlY2tOb3RpZmljYXRpb24oKTtcbiAgICB9XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fbG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbiBsb2FkU2VnbWVudEF0VGltZShwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TG9hZGVyID0gc2VsZi5fX3NlZ21lbnRMb2FkZXIsXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUsXG4gICAgICAgIGhhc05leHRTZWdtZW50ID0gc2VnbWVudExvYWRlci5sb2FkU2VnbWVudEF0VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIGlmICghaGFzTmV4dFNlZ21lbnQpIHsgcmV0dXJuIGhhc05leHRTZWdtZW50OyB9XG5cbiAgICBzZWdtZW50TG9hZGVyLm9uZShzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgZnVuY3Rpb24gc2VnbWVudExvYWRlZEhhbmRsZXIoZXZlbnQpIHtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUuYWRkVG9RdWV1ZShldmVudC5kYXRhKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBoYXNOZXh0U2VnbWVudDtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KE1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNZWRpYVR5cGVMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIFNlZ21lbnRMb2FkZXIgPSByZXF1aXJlKCcuL3NlZ21lbnRzL1NlZ21lbnRMb2FkZXIuanMnKSxcbiAgICBTb3VyY2VCdWZmZXJEYXRhUXVldWUgPSByZXF1aXJlKCcuL3NvdXJjZUJ1ZmZlci9Tb3VyY2VCdWZmZXJEYXRhUXVldWUuanMnKSxcbiAgICBNZWRpYVR5cGVMb2FkZXIgPSByZXF1aXJlKCcuL01lZGlhVHlwZUxvYWRlci5qcycpLFxuICAgIHNlbGVjdFNlZ21lbnRMaXN0ID0gcmVxdWlyZSgnLi9zZWxlY3RTZWdtZW50TGlzdC5qcycpLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL21hbmlmZXN0L01lZGlhVHlwZXMuanMnKTtcblxuLy8gVE9ETzogTWlncmF0ZSBtZXRob2RzIGJlbG93IHRvIGEgZmFjdG9yeS5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUpIHtcbiAgICB2YXIgc291cmNlQnVmZmVyVHlwZSA9IG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpLmdldFNvdXJjZUJ1ZmZlclR5cGUoKSxcbiAgICAgICAgLy8gVE9ETzogVHJ5L2NhdGNoIGJsb2NrP1xuICAgICAgICBzb3VyY2VCdWZmZXIgPSBtZWRpYVNvdXJjZS5hZGRTb3VyY2VCdWZmZXIoc291cmNlQnVmZmVyVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWVkaWFUeXBlTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpIHtcbiAgICB2YXIgc2VnbWVudExvYWRlciA9IG5ldyBTZWdtZW50TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFUeXBlKSxcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBNZWRpYVR5cGVMb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBtZWRpYVR5cGUsIHRlY2gpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgbWF0Y2hlZFR5cGVzID0gbWVkaWFUeXBlcy5maWx0ZXIoZnVuY3Rpb24obWVkaWFUeXBlKSB7XG4gICAgICAgICAgICB2YXIgZXhpc3RzID0gZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpKTtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHM7IH0pLFxuICAgICAgICBtZWRpYVR5cGVMb2FkZXJzID0gbWF0Y2hlZFR5cGVzLm1hcChmdW5jdGlvbihtZWRpYVR5cGUpIHsgcmV0dXJuIGNyZWF0ZU1lZGlhVHlwZUxvYWRlckZvclR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlLCB0ZWNoKTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhVHlwZUxvYWRlcnM7XG59XG5cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgdGhpcy5fX21lZGlhVHlwZUxvYWRlcnMgPSBjcmVhdGVNZWRpYVR5cGVMb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpO1xuXG4gICAgdGhpcy5fX21lZGlhVHlwZUxvYWRlcnMuZm9yRWFjaChmdW5jdGlvbihtZWRpYVR5cGVMb2FkZXIpIHtcbiAgICAgICAgLy8gTWVkaWFTZXQtc3BlY2lmaWMgdmFyaWFibGVzXG4gICAgICAgIHZhciBzZWdtZW50TG9hZGVyID0gbWVkaWFUeXBlTG9hZGVyLmdldFNlZ21lbnRMb2FkZXIoKSxcbiAgICAgICAgICAgIGRvd25sb2FkUmF0ZVJhdGlvID0gMS4wLFxuICAgICAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRCYW5kd2lkdGgoKSxcbiAgICAgICAgICAgIG1lZGlhVHlwZSA9IG1lZGlhVHlwZUxvYWRlci5nZXRNZWRpYVR5cGUoKTtcblxuICAgICAgICBtZWRpYVR5cGVMb2FkZXIub24obWVkaWFUeXBlTG9hZGVyLmV2ZW50TGlzdC5SRUNIRUNLX0NVUlJFTlRfU0VHTUVOVF9MSVNULCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIG1lZGlhU2V0ID0gbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKG1lZGlhVHlwZSksXG4gICAgICAgICAgICAgICAgaXNGdWxsc2NyZWVuID0gdGVjaC5wbGF5ZXIoKS5pc0Z1bGxzY3JlZW4oKSxcbiAgICAgICAgICAgICAgICBkYXRhID0ge30sXG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRTZWdtZW50TGlzdDtcblxuICAgICAgICAgICAgZGF0YS5kb3dubG9hZFJhdGVSYXRpbyA9IGRvd25sb2FkUmF0ZVJhdGlvO1xuICAgICAgICAgICAgZGF0YS5jdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG4gICAgICAgICAgICBkYXRhLndpZHRoID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi53aWR0aCA6IHRlY2gucGxheWVyKCkud2lkdGgoKTtcbiAgICAgICAgICAgIGRhdGEuaGVpZ2h0ID0gaXNGdWxsc2NyZWVuID8gd2luZG93LnNjcmVlbi5oZWlnaHQgOiB0ZWNoLnBsYXllcigpLmhlaWdodCgpO1xuXG4gICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0ID0gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpO1xuXG4gICAgICAgICAgICAvLyBUT0RPOiBTaG91bGQgd2UgcmVmYWN0b3IgdG8gc2V0IGJhc2VkIG9uIHNlZ21lbnRMaXN0IGluc3RlYWQ/XG4gICAgICAgICAgICBzZWdtZW50TG9hZGVyLnNldEN1cnJlbnRCYW5kd2lkdGgoc2VsZWN0ZWRTZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHNlZ21lbnRMb2FkZXIub24oc2VnbWVudExvYWRlci5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBkb3dubG9hZFJhdGVSYXRpbyA9IGV2ZW50LmRhdGEucGxheWJhY2tUaW1lIC8gZXZlbnQuZGF0YS5ydHQ7XG4gICAgICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBldmVudC5kYXRhLmJhbmR3aWR0aDtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbWVkaWFUeXBlTG9hZGVyLnN0YXJ0TG9hZGluZ1NlZ21lbnRzKCk7XG4gICAgfSk7XG5cbiAgICB2YXIgY2hhbmdlUGxheWJhY2tSYXRlRXZlbnRzID0gWydzZWVraW5nJywgJ2NhbnBsYXknLCAnY2FucGxheXRocm91Z2gnXTtcbiAgICBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudFR5cGUpIHtcbiAgICAgICAgdGVjaC5vbihldmVudFR5cGUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgcmVhZHlTdGF0ZSA9IHRlY2guZWwoKS5yZWFkeVN0YXRlLFxuICAgICAgICAgICAgICAgIHBsYXliYWNrUmF0ZSA9IChyZWFkeVN0YXRlID09PSA0KSA/IDEgOiAwO1xuICAgICAgICAgICAgdGVjaC5zZXRQbGF5YmFja1JhdGUocGxheWJhY2tSYXRlKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUGxheWxpc3RMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgTWVkaWFTb3VyY2UgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JykuTWVkaWFTb3VyY2UsXG4gICAgTWFuaWZlc3RDb250cm9sbGVyID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMnKSxcbiAgICBQbGF5bGlzdExvYWRlciA9IHJlcXVpcmUoJy4vUGxheWxpc3RMb2FkZXIuanMnKTtcblxuLy8gVE9ETzogRElTUE9TRSBNRVRIT0RcblxuZnVuY3Rpb24gU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1hbmlmZXN0Q29udHJvbGxlciA9IG5ldyBNYW5pZmVzdENvbnRyb2xsZXIoc291cmNlLnNyYywgZmFsc2UpO1xuXG4gICAgbWFuaWZlc3RDb250cm9sbGVyLmxvYWQoZnVuY3Rpb24obWFuaWZlc3QpIHtcbiAgICAgICAgdmFyIG1lZGlhU291cmNlID0gbmV3IE1lZGlhU291cmNlKCksXG4gICAgICAgICAgICBvcGVuTGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1lZGlhU291cmNlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fcGxheWxpc3RMb2FkZXIgPSBuZXcgUGxheWxpc3RMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgdGVjaCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgY2xvc2UuXG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignd2Via2l0c291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgICAgIHRlY2guc2V0U3JjKFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpKTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VIYW5kbGVyO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgdXRpbCA9IHJlcXVpcmUoJy4vdXRpbC5qcycpLFxuICAgIHBhcnNlUm9vdFVybCA9IHV0aWwucGFyc2VSb290VXJsLFxuICAgIGNyZWF0ZU1wZE9iamVjdCxcbiAgICBjcmVhdGVQZXJpb2RPYmplY3QsXG4gICAgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCxcbiAgICBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCxcbiAgICBjcmVhdGVTZWdtZW50VGVtcGxhdGUsXG4gICAgZ2V0TXBkLFxuICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGUsXG4gICAgZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSxcbiAgICBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZTtcblxuLy8gVE9ETzogU2hvdWxkIHRoaXMgZXhpc3Qgb24gbXBkIGRhdGF2aWV3IG9yIGF0IGEgaGlnaGVyIGxldmVsP1xuLy8gVE9ETzogUmVmYWN0b3IuIENvdWxkIGJlIG1vcmUgZWZmaWNpZW50IChSZWN1cnNpdmUgZm4/IFVzZSBlbGVtZW50LmdldEVsZW1lbnRzQnlOYW1lKCdCYXNlVXJsJylbMF0/KS5cbi8vIFRPRE86IEN1cnJlbnRseSBhc3N1bWluZyAqRUlUSEVSKiA8QmFzZVVSTD4gbm9kZXMgd2lsbCBwcm92aWRlIGFuIGFic29sdXRlIGJhc2UgdXJsIChpZSByZXNvbHZlIHRvICdodHRwOi8vJyBldGMpXG4vLyBUT0RPOiAqT1IqIHdlIHNob3VsZCB1c2UgdGhlIGJhc2UgdXJsIG9mIHRoZSBob3N0IG9mIHRoZSBNUEQgbWFuaWZlc3QuXG52YXIgYnVpbGRCYXNlVXJsID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHZhciBlbGVtSGllcmFyY2h5ID0gW3htbE5vZGVdLmNvbmNhdCh4bWxmdW4uZ2V0QW5jZXN0b3JzKHhtbE5vZGUpKSxcbiAgICAgICAgZm91bmRMb2NhbEJhc2VVcmwgPSBmYWxzZTtcbiAgICAvL3ZhciBiYXNlVXJscyA9IF8ubWFwKGVsZW1IaWVyYXJjaHksIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICB2YXIgYmFzZVVybHMgPSBlbGVtSGllcmFyY2h5Lm1hcChmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmIChmb3VuZExvY2FsQmFzZVVybCkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgaWYgKCFlbGVtLmhhc0NoaWxkTm9kZXMoKSkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgdmFyIGNoaWxkO1xuICAgICAgICBmb3IgKHZhciBpPTA7IGk8ZWxlbS5jaGlsZE5vZGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IGVsZW0uY2hpbGROb2Rlcy5pdGVtKGkpO1xuICAgICAgICAgICAgaWYgKGNoaWxkLm5vZGVOYW1lID09PSAnQmFzZVVSTCcpIHtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dEVsZW0gPSBjaGlsZC5jaGlsZE5vZGVzLml0ZW0oMCk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRWYWx1ZSA9IHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRleHRWYWx1ZS5pbmRleE9mKCdodHRwOi8vJykgPT09IDApIHsgZm91bmRMb2NhbEJhc2VVcmwgPSB0cnVlOyB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfSk7XG5cbiAgICB2YXIgYmFzZVVybCA9IGJhc2VVcmxzLnJldmVyc2UoKS5qb2luKCcnKTtcbiAgICBpZiAoIWJhc2VVcmwpIHsgcmV0dXJuIHBhcnNlUm9vdFVybCh4bWxOb2RlLmJhc2VVUkkpOyB9XG4gICAgcmV0dXJuIGJhc2VVcmw7XG59O1xuXG52YXIgZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcyA9IFtcbiAgICAnQWRhcHRhdGlvblNldCcsXG4gICAgJ1JlcHJlc2VudGF0aW9uJyxcbiAgICAnU3ViUmVwcmVzZW50YXRpb24nXG5dO1xuXG52YXIgaGFzQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcy5pbmRleE9mKGVsZW0ubm9kZU5hbWUpID49IDA7XG59O1xuXG52YXIgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuICFoYXNDb21tb25Qcm9wZXJ0aWVzKGVsZW0pO1xufTtcblxuLy8gQ29tbW9uIEF0dHJzXG52YXIgZ2V0V2lkdGggPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ3dpZHRoJyksXG4gICAgZ2V0SGVpZ2h0ID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdoZWlnaHQnKSxcbiAgICBnZXRGcmFtZVJhdGUgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2ZyYW1lUmF0ZScpLFxuICAgIGdldE1pbWVUeXBlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdtaW1lVHlwZScpLFxuICAgIGdldENvZGVjcyA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnY29kZWNzJyk7XG5cbnZhciBnZXRTZWdtZW50VGVtcGxhdGVYbWwgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVFbGVtZW50KCdTZWdtZW50VGVtcGxhdGUnLCBkb2VzbnRIYXZlQ29tbW9uUHJvcGVydGllcyk7XG5cbi8vIE1QRCBBdHRyIGZuc1xudmFyIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uJyksXG4gICAgZ2V0VHlwZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3R5cGUnKSxcbiAgICBnZXRNaW5pbXVtVXBkYXRlUGVyaW9kID0geG1sZnVuLmdldEF0dHJGbignbWluaW11bVVwZGF0ZVBlcmlvZCcpO1xuXG4vLyBSZXByZXNlbnRhdGlvbiBBdHRyIGZuc1xudmFyIGdldElkID0geG1sZnVuLmdldEF0dHJGbignaWQnKSxcbiAgICBnZXRCYW5kd2lkdGggPSB4bWxmdW4uZ2V0QXR0ckZuKCdiYW5kd2lkdGgnKTtcblxuLy8gU2VnbWVudFRlbXBsYXRlIEF0dHIgZm5zXG52YXIgZ2V0SW5pdGlhbGl6YXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdpbml0aWFsaXphdGlvbicpLFxuICAgIGdldE1lZGlhID0geG1sZnVuLmdldEF0dHJGbignbWVkaWEnKSxcbiAgICBnZXREdXJhdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2R1cmF0aW9uJyksXG4gICAgZ2V0VGltZXNjYWxlID0geG1sZnVuLmdldEF0dHJGbigndGltZXNjYWxlJyksXG4gICAgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3ByZXNlbnRhdGlvblRpbWVPZmZzZXQnKSxcbiAgICBnZXRTdGFydE51bWJlciA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3N0YXJ0TnVtYmVyJyk7XG5cbi8vIFRPRE86IFJlcGVhdCBjb2RlLiBBYnN0cmFjdCBhd2F5IChQcm90b3R5cGFsIEluaGVyaXRhbmNlL09PIE1vZGVsPyBPYmplY3QgY29tcG9zZXIgZm4/KVxuY3JlYXRlTXBkT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRQZXJpb2RzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0VHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW5pbXVtVXBkYXRlUGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlUGVyaW9kT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0czogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGU6IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgICAgIHJldHVybiBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlKHR5cGUsIHhtbE5vZGUpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClcbiAgICB9O1xufTtcblxuY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UmVwcmVzZW50YXRpb25zOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ1JlcHJlc2VudGF0aW9uJywgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QpLFxuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWwoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0TWltZVR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW1lVHlwZSwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFNlZ21lbnRUZW1wbGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudFRlbXBsYXRlKGdldFNlZ21lbnRUZW1wbGF0ZVhtbCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldElkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SWQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRXaWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFdpZHRoLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0SGVpZ2h0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SGVpZ2h0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RnJhbWVSYXRlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RnJhbWVSYXRlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0Q29kZWNzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0Q29kZWNzLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0QmFzZVVybDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGJ1aWxkQmFzZVVybCwgeG1sTm9kZSksXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SW5pdGlhbGl6YXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJbml0aWFsaXphdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldE1lZGlhOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWEsIHhtbE5vZGUpLFxuICAgICAgICBnZXREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldER1cmF0aW9uLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0VGltZXNjYWxlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VGltZXNjYWxlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFN0YXJ0TnVtYmVyLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG4vLyBUT0RPOiBDaGFuZ2UgdGhpcyBhcGkgdG8gcmV0dXJuIGEgbGlzdCBvZiBhbGwgbWF0Y2hpbmcgYWRhcHRhdGlvbiBzZXRzIHRvIGFsbG93IGZvciBncmVhdGVyIGZsZXhpYmlsaXR5LlxuZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSA9IGZ1bmN0aW9uKHR5cGUsIHBlcmlvZFhtbCkge1xuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IHBlcmlvZFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnQWRhcHRhdGlvblNldCcpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0LFxuICAgICAgICByZXByZXNlbnRhdGlvbixcbiAgICAgICAgbWltZVR5cGU7XG5cbiAgICBmb3IgKHZhciBpPTA7IGk8YWRhcHRhdGlvblNldHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgYWRhcHRhdGlvblNldCA9IGFkYXB0YXRpb25TZXRzLml0ZW0oaSk7XG4gICAgICAgIC8vIFNpbmNlIHRoZSBtaW1lVHlwZSBjYW4gYmUgZGVmaW5lZCBvbiB0aGUgQWRhcHRhdGlvblNldCBvciBvbiBpdHMgUmVwcmVzZW50YXRpb24gY2hpbGQgbm9kZXMsXG4gICAgICAgIC8vIGNoZWNrIGZvciBtaW1ldHlwZSBvbiBvbmUgb2YgaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkcmVuIHVzaW5nIGdldE1pbWVUeXBlKCksIHdoaWNoIGFzc3VtZXMgdGhlXG4gICAgICAgIC8vIG1pbWVUeXBlIGNhbiBiZSBpbmhlcml0ZWQgYW5kIHdpbGwgY2hlY2sgaXRzZWxmIGFuZCBpdHMgYW5jZXN0b3JzIGZvciB0aGUgYXR0ci5cbiAgICAgICAgcmVwcmVzZW50YXRpb24gPSBhZGFwdGF0aW9uU2V0LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdSZXByZXNlbnRhdGlvbicpWzBdO1xuICAgICAgICAvLyBOZWVkIHRvIGNoZWNrIHRoZSByZXByZXNlbnRhdGlvbiBpbnN0ZWFkIG9mIHRoZSBhZGFwdGF0aW9uIHNldCwgc2luY2UgdGhlIG1pbWVUeXBlIG1heSBub3QgYmUgc3BlY2lmaWVkXG4gICAgICAgIC8vIG9uIHRoZSBhZGFwdGF0aW9uIHNldCBhdCBhbGwgYW5kIG1heSBiZSBzcGVjaWZpZWQgZm9yIGVhY2ggb2YgdGhlIHJlcHJlc2VudGF0aW9ucyBpbnN0ZWFkLlxuICAgICAgICBtaW1lVHlwZSA9IGdldE1pbWVUeXBlKHJlcHJlc2VudGF0aW9uKTtcbiAgICAgICAgaWYgKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKSB7IHJldHVybiBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KGFkYXB0YXRpb25TZXQpOyB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG5nZXRNcGQgPSBmdW5jdGlvbihtYW5pZmVzdFhtbCkge1xuICAgIHJldHVybiBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lKG1hbmlmZXN0WG1sLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KVswXTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8geG1sZnVuIG9yIG93biBtb2R1bGUuXG5nZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lID0gZnVuY3Rpb24ocGFyZW50WG1sLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIHZhciBkZXNjZW5kYW50c1htbEFycmF5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwocGFyZW50WG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKHRhZ05hbWUpKTtcbiAgICAvKmlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHsgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTsgfSovXG4gICAgaWYgKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB2YXIgbWFwcGVkRWxlbSA9IGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTtcbiAgICAgICAgcmV0dXJuICBtYXBwZWRFbGVtO1xuICAgIH1cbiAgICByZXR1cm4gZGVzY2VuZGFudHNYbWxBcnJheTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8geG1sZnVuIG9yIG93biBtb2R1bGUuXG5nZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSA9IGZ1bmN0aW9uKHhtbE5vZGUsIHRhZ05hbWUsIG1hcEZuKSB7XG4gICAgaWYgKCF0YWdOYW1lIHx8ICF4bWxOb2RlIHx8ICF4bWxOb2RlLnBhcmVudE5vZGUpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBpZiAoIXhtbE5vZGUucGFyZW50Tm9kZS5oYXNPd25Qcm9wZXJ0eSgnbm9kZU5hbWUnKSkgeyByZXR1cm4gbnVsbDsgfVxuXG4gICAgaWYgKHhtbE5vZGUucGFyZW50Tm9kZS5ub2RlTmFtZSA9PT0gdGFnTmFtZSkge1xuICAgICAgICByZXR1cm4gKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykgPyBtYXBGbih4bWxOb2RlLnBhcmVudE5vZGUpIDogeG1sTm9kZS5wYXJlbnROb2RlO1xuICAgIH1cbiAgICByZXR1cm4gZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUoeG1sTm9kZS5wYXJlbnROb2RlLCB0YWdOYW1lLCBtYXBGbik7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdldE1wZDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwsXG4gICAgLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgU0VDT05EU19JTl9ZRUFSID0gMzY1ICogMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTU9OVEggPSAzMCAqIDI0ICogNjAgKiA2MCwgLy8gbm90IHByZWNpc2UhXG4gICAgU0VDT05EU19JTl9EQVkgPSAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9IT1VSID0gNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01JTiA9IDYwLFxuICAgIE1JTlVURVNfSU5fSE9VUiA9IDYwLFxuICAgIE1JTExJU0VDT05EU19JTl9TRUNPTkRTID0gMTAwMCxcbiAgICBkdXJhdGlvblJlZ2V4ID0gL15QKChbXFxkLl0qKVkpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopRCk/VD8oKFtcXGQuXSopSCk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilTKT8vO1xuXG5wYXJzZVJvb3RVcmwgPSBmdW5jdGlvbih1cmwpIHtcbiAgICBpZiAodHlwZW9mIHVybCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignLycpID09PSAtMSkge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCc/JykgIT09IC0xKSB7XG4gICAgICAgIHVybCA9IHVybC5zdWJzdHJpbmcoMCwgdXJsLmluZGV4T2YoJz8nKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVybC5zdWJzdHJpbmcoMCwgdXJsLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn07XG5cbi8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgLy9zdHIgPSBcIlAxMFkxME0xMERUMTBIMTBNMTAuMVNcIjtcbiAgICB2YXIgbWF0Y2ggPSBkdXJhdGlvblJlZ2V4LmV4ZWMoc3RyKTtcbiAgICByZXR1cm4gKHBhcnNlRmxvYXQobWF0Y2hbMl0gfHwgMCkgKiBTRUNPTkRTX0lOX1lFQVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzRdIHx8IDApICogU0VDT05EU19JTl9NT05USCArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNl0gfHwgMCkgKiBTRUNPTkRTX0lOX0RBWSArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbOF0gfHwgMCkgKiBTRUNPTkRTX0lOX0hPVVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEwXSB8fCAwKSAqIFNFQ09ORFNfSU5fTUlOICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMl0gfHwgMCkpO1xufTtcblxudmFyIHV0aWwgPSB7XG4gICAgcGFyc2VSb290VXJsOiBwYXJzZVJvb3RVcmwsXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb25cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gdXRpbDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi8uLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcXVpcmUoJy4uL21wZC91dGlsLmpzJykucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vc2VnbWVudFRlbXBsYXRlJyksXG4gICAgY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUsXG4gICAgZ2V0VHlwZSxcbiAgICBnZXRCYW5kd2lkdGgsXG4gICAgZ2V0V2lkdGgsXG4gICAgZ2V0SGVpZ2h0LFxuICAgIGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLFxuICAgIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLFxuICAgIGdldEVuZE51bWJlckZyb21UZW1wbGF0ZTtcblxuZ2V0VHlwZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59O1xuXG5nZXRCYW5kd2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBiYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCkgPyBOdW1iZXIoYmFuZHdpZHRoKSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldFdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRXaWR0aCgpO1xuICAgIHJldHVybiBleGlzdHkod2lkdGgpID8gTnVtYmVyKHdpZHRoKSA6IHVuZGVmaW5lZDtcbn07XG5cbmdldEhlaWdodCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGhlaWdodCA9IHJlcHJlc2VudGF0aW9uLmdldEhlaWdodCgpO1xuICAgIHJldHVybiBleGlzdHkoaGVpZ2h0KSA/IE51bWJlcihoZWlnaHQpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgLy8gVE9ETzogU3VwcG9ydCBwZXJpb2QtcmVsYXRpdmUgcHJlc2VudGF0aW9uIHRpbWVcbiAgICB2YXIgbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24oKSxcbiAgICAgICAgcGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGV4aXN0eShtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSA/IE51bWJlcihwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24obWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikpIDogTnVtYmVyLk5hTixcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZU9mZnNldCA9IE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0KCkpO1xuICAgIHJldHVybiBleGlzdHkocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikgPyBOdW1iZXIocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiAtIHByZXNlbnRhdGlvblRpbWVPZmZzZXQpIDogTnVtYmVyLk5hTjtcbn07XG5cbmdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpO1xuICAgIHJldHVybiBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldER1cmF0aW9uKCkpIC8gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXRUaW1lc2NhbGUoKSk7XG59O1xuXG5nZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE1hdGguY2VpbChnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAvIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xufTtcblxuZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0U3RhcnROdW1iZXIoKSk7XG59O1xuXG5nZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgKyBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLSAxO1xufTtcblxuY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTZWdtZW50RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxTZWdtZW50Q291bnQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEVuZE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICAvLyBUT0RPOiBFeHRlcm5hbGl6ZVxuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgaW5pdGlhbGl6YXRpb24gPSB7fTtcbiAgICAgICAgICAgIGluaXRpYWxpemF0aW9uLmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgICAgICAgICByZXByZXNlbnRhdGlvbklkID0gcmVwcmVzZW50YXRpb24uZ2V0SWQoKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0SW5pdGlhbGl6YXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uSWQpO1xuXG4gICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsLCAnQmFuZHdpZHRoJywgcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlVXJsICsgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXR1cm4gaW5pdGlhbGl6YXRpb247XG4gICAgICAgIH0sXG4gICAgICAgIGdldFNlZ21lbnRCeU51bWJlcjogZnVuY3Rpb24obnVtYmVyKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVRpbWU6IGZ1bmN0aW9uKHNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUocmVwcmVzZW50YXRpb24sIHNlY29uZHMpOyB9XG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlciA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpIHtcbiAgICB2YXIgc2VnbWVudCA9IHt9O1xuICAgIHNlZ21lbnQuZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRNZWRpYSgpLFxuICAgICAgICAgICAgcmVwbGFjZWRJZFVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24uZ2V0SWQoKSksXG4gICAgICAgICAgICByZXBsYWNlZFRva2Vuc1VybDtcbiAgICAgICAgICAgIC8vIFRPRE86IFNpbmNlICRUaW1lJC10ZW1wbGF0ZWQgc2VnbWVudCBVUkxzIHNob3VsZCBvbmx5IGV4aXN0IGluIGNvbmp1bmN0aW9uIHcvYSA8U2VnbWVudFRpbWVsaW5lPixcbiAgICAgICAgICAgIC8vIFRPRE86IGNhbiBjdXJyZW50bHkgYXNzdW1lIGEgJE51bWJlciQtYmFzZWQgdGVtcGxhdGVkIHVybC5cbiAgICAgICAgICAgIC8vIFRPRE86IEVuZm9yY2UgbWluL21heCBudW1iZXIgcmFuZ2UgKGJhc2VkIG9uIHNlZ21lbnRMaXN0IHN0YXJ0TnVtYmVyICYgZW5kTnVtYmVyKVxuICAgICAgICByZXBsYWNlZFRva2Vuc1VybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShyZXBsYWNlZElkVXJsLCAnTnVtYmVyJywgbnVtYmVyKTtcbiAgICAgICAgcmVwbGFjZWRUb2tlbnNVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRUb2tlbnNVcmwsICdCYW5kd2lkdGgnLCByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG5cbiAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyByZXBsYWNlZFRva2Vuc1VybDtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0U3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBudW1iZXIgKiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXREdXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBUT0RPOiBWZXJpZnlcbiAgICAgICAgdmFyIHN0YW5kYXJkU2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgICAgIGR1cmF0aW9uLFxuICAgICAgICAgICAgbWVkaWFQcmVzZW50YXRpb25UaW1lLFxuICAgICAgICAgICAgcHJlY2lzaW9uTXVsdGlwbGllcjtcblxuICAgICAgICBpZiAoZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSA9PT0gbnVtYmVyKSB7XG4gICAgICAgICAgICBtZWRpYVByZXNlbnRhdGlvblRpbWUgPSBOdW1iZXIoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xuICAgICAgICAgICAgLy8gSGFuZGxlIGZsb2F0aW5nIHBvaW50IHByZWNpc2lvbiBpc3N1ZVxuICAgICAgICAgICAgcHJlY2lzaW9uTXVsdGlwbGllciA9IDEwMDA7XG4gICAgICAgICAgICBkdXJhdGlvbiA9ICgoKG1lZGlhUHJlc2VudGF0aW9uVGltZSAqIHByZWNpc2lvbk11bHRpcGxpZXIpICUgKHN0YW5kYXJkU2VnbWVudER1cmF0aW9uICogcHJlY2lzaW9uTXVsdGlwbGllcikpIC8gcHJlY2lzaW9uTXVsdGlwbGllciApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZHVyYXRpb24gPSBzdGFuZGFyZFNlZ21lbnREdXJhdGlvbjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZHVyYXRpb247XG4gICAgfTtcbiAgICBzZWdtZW50LmdldE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbnVtYmVyOyB9O1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKSB7XG4gICAgdmFyIHNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIG51bWJlciA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIHNlZ21lbnREdXJhdGlvbiksXG4gICAgICAgIHNlZ21lbnQgPSBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5mdW5jdGlvbiBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgaWYgKCFyZXByZXNlbnRhdGlvbikgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpKSB7IHJldHVybiBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7IH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb247XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZWdtZW50VGVtcGxhdGUsXG4gICAgemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU7XG5cbnplcm9QYWRUb0xlbmd0aCA9IGZ1bmN0aW9uIChudW1TdHIsIG1pblN0ckxlbmd0aCkge1xuICAgIHdoaWxlIChudW1TdHIubGVuZ3RoIDwgbWluU3RyTGVuZ3RoKSB7XG4gICAgICAgIG51bVN0ciA9ICcwJyArIG51bVN0cjtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVtU3RyO1xufTtcblxucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHRva2VuLCB2YWx1ZSkge1xuXG4gICAgdmFyIHN0YXJ0UG9zID0gMCxcbiAgICAgICAgZW5kUG9zID0gMCxcbiAgICAgICAgdG9rZW5MZW4gPSB0b2tlbi5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZyA9ICclMCcsXG4gICAgICAgIGZvcm1hdFRhZ0xlbiA9IGZvcm1hdFRhZy5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZ1BvcyxcbiAgICAgICAgc3BlY2lmaWVyLFxuICAgICAgICB3aWR0aCxcbiAgICAgICAgcGFkZGVkVmFsdWU7XG5cbiAgICAvLyBrZWVwIGxvb3Bpbmcgcm91bmQgdW50aWwgYWxsIGluc3RhbmNlcyBvZiA8dG9rZW4+IGhhdmUgYmVlblxuICAgIC8vIHJlcGxhY2VkLiBvbmNlIHRoYXQgaGFzIGhhcHBlbmVkLCBzdGFydFBvcyBiZWxvdyB3aWxsIGJlIC0xXG4gICAgLy8gYW5kIHRoZSBjb21wbGV0ZWQgdXJsIHdpbGwgYmUgcmV0dXJuZWQuXG4gICAgd2hpbGUgKHRydWUpIHtcblxuICAgICAgICAvLyBjaGVjayBpZiB0aGVyZSBpcyBhIHZhbGlkICQ8dG9rZW4+Li4uJCBpZGVudGlmaWVyXG4gICAgICAgIC8vIGlmIG5vdCwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIHN0YXJ0UG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcgKyB0b2tlbik7XG4gICAgICAgIGlmIChzdGFydFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoZSBuZXh0ICckJyBtdXN0IGJlIHRoZSBlbmQgb2YgdGhlIGlkZW50aWZlclxuICAgICAgICAvLyBpZiB0aGVyZSBpc24ndCBvbmUsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBlbmRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChlbmRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBub3cgc2VlIGlmIHRoZXJlIGlzIGFuIGFkZGl0aW9uYWwgZm9ybWF0IHRhZyBzdWZmaXhlZCB0b1xuICAgICAgICAvLyB0aGUgaWRlbnRpZmllciB3aXRoaW4gdGhlIGVuY2xvc2luZyAnJCcgY2hhcmFjdGVyc1xuICAgICAgICBmb3JtYXRUYWdQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKGZvcm1hdFRhZywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChmb3JtYXRUYWdQb3MgPiBzdGFydFBvcyAmJiBmb3JtYXRUYWdQb3MgPCBlbmRQb3MpIHtcblxuICAgICAgICAgICAgc3BlY2lmaWVyID0gdGVtcGxhdGVTdHIuY2hhckF0KGVuZFBvcyAtIDEpO1xuICAgICAgICAgICAgd2lkdGggPSBwYXJzZUludCh0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZm9ybWF0VGFnUG9zICsgZm9ybWF0VGFnTGVuLCBlbmRQb3MgLSAxKSwgMTApO1xuXG4gICAgICAgICAgICAvLyBzdXBwb3J0IHRoZSBtaW5pbXVtIHNwZWNpZmllcnMgcmVxdWlyZWQgYnkgSUVFRSAxMDAzLjFcbiAgICAgICAgICAgIC8vIChkLCBpICwgbywgdSwgeCwgYW5kIFgpIGZvciBjb21wbGV0ZW5lc3NcbiAgICAgICAgICAgIHN3aXRjaCAoc3BlY2lmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJlYXQgYWxsIGludCB0eXBlcyBhcyB1aW50LFxuICAgICAgICAgICAgICAgIC8vIGhlbmNlIGRlbGliZXJhdGUgZmFsbHRocm91Z2hcbiAgICAgICAgICAgICAgICBjYXNlICdkJzpcbiAgICAgICAgICAgICAgICBjYXNlICdpJzpcbiAgICAgICAgICAgICAgICBjYXNlICd1JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoKSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd4JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ1gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdvJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoOCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1Vuc3VwcG9ydGVkL2ludmFsaWQgSUVFRSAxMDAzLjEgZm9ybWF0IGlkZW50aWZpZXIgc3RyaW5nIGluIFVSTCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVtcGxhdGVTdHIgPSB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoMCwgc3RhcnRQb3MpICsgcGFkZGVkVmFsdWUgKyB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZW5kUG9zICsgMSk7XG4gICAgfVxufTtcblxudW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0cikge1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJCQnKS5qb2luKCckJyk7XG59O1xuXG5yZXBsYWNlSURGb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdGVtcGxhdGVTdHIuaW5kZXhPZignJFJlcHJlc2VudGF0aW9uSUQkJykgPT09IC0xKSB7IHJldHVybiB0ZW1wbGF0ZVN0cjsgfVxuICAgIHZhciB2ID0gdmFsdWUudG9TdHJpbmcoKTtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyRSZXByZXNlbnRhdGlvbklEJCcpLmpvaW4odik7XG59O1xuXG5zZWdtZW50VGVtcGxhdGUgPSB7XG4gICAgemVyb1BhZFRvTGVuZ3RoOiB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGU6IHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGU6IHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU6IHJlcGxhY2VJREZvclRlbXBsYXRlXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHNlZ21lbnRUZW1wbGF0ZTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBldmVudE1nciA9IHJlcXVpcmUoJy4vZXZlbnRNYW5hZ2VyLmpzJyksXG4gICAgZXZlbnREaXNwYXRjaGVyTWl4aW4gPSB7XG4gICAgICAgIHRyaWdnZXI6IGZ1bmN0aW9uKGV2ZW50T2JqZWN0KSB7IGV2ZW50TWdyLnRyaWdnZXIodGhpcywgZXZlbnRPYmplY3QpOyB9LFxuICAgICAgICBvbmU6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub25lKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvbjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb2ZmOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9mZih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfVxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnREaXNwYXRjaGVyTWl4aW47IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmlkZW9qcyA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS52aWRlb2pzLFxuICAgIGV2ZW50TWFuYWdlciA9IHtcbiAgICAgICAgdHJpZ2dlcjogdmlkZW9qcy50cmlnZ2VyLFxuICAgICAgICBvbmU6IHZpZGVvanMub25lLFxuICAgICAgICBvbjogdmlkZW9qcy5vbixcbiAgICAgICAgb2ZmOiB2aWRlb2pzLm9mZlxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnRNYW5hZ2VyO1xuIiwiLyoqXG4gKiBDcmVhdGVkIGJ5IGNwaWxsc2J1cnkgb24gMTIvMy8xNC5cbiAqL1xuOyhmdW5jdGlvbigpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgcm9vdCA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKSxcbiAgICAgICAgdmlkZW9qcyA9IHJvb3QudmlkZW9qcyxcbiAgICAgICAgU291cmNlSGFuZGxlciA9IHJlcXVpcmUoJy4vU291cmNlSGFuZGxlcicpO1xuXG4gICAgaWYgKCF2aWRlb2pzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlIHZpZGVvLmpzIGxpYnJhcnkgbXVzdCBiZSBpbmNsdWRlZCB0byB1c2UgdGhpcyBNUEVHLURBU0ggc291cmNlIGhhbmRsZXIuJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FuSGFuZGxlU291cmNlKHNvdXJjZSkge1xuICAgICAgICAvLyBFeHRlcm5hbGl6ZSBpZiB1c2VkIGVsc2V3aGVyZS4gUG90ZW50aWFsbHkgdXNlIGNvbnN0YW50IGZ1bmN0aW9uLlxuICAgICAgICB2YXIgZG9lc250SGFuZGxlU291cmNlID0gJycsXG4gICAgICAgICAgICBtYXliZUhhbmRsZVNvdXJjZSA9ICdtYXliZScsXG4gICAgICAgICAgICBkZWZhdWx0SGFuZGxlU291cmNlID0gZG9lc250SGFuZGxlU291cmNlO1xuXG4gICAgICAgIC8vIFRPRE86IFVzZSBzYWZlciB2anMgY2hlY2sgKGUuZy4gaGFuZGxlcyBJRSBjb25kaXRpb25zKT9cbiAgICAgICAgLy8gUmVxdWlyZXMgTWVkaWEgU291cmNlIEV4dGVuc2lvbnNcbiAgICAgICAgaWYgKCEocm9vdC5NZWRpYVNvdXJjZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBkb2VzbnRIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgdHlwZSBpcyBzdXBwb3J0ZWRcbiAgICAgICAgaWYgKC9hcHBsaWNhdGlvblxcL2Rhc2hcXCt4bWwvLnRlc3Qoc291cmNlLnR5cGUpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnbWF0Y2hlZCB0eXBlJyk7XG4gICAgICAgICAgICByZXR1cm4gbWF5YmVIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleHRlbnNpb24gbWF0Y2hlc1xuICAgICAgICBpZiAoL1xcLm1wZCQvaS50ZXN0KHNvdXJjZS5zcmMpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnbWF0Y2hlZCBleHRlbnNpb24nKTtcbiAgICAgICAgICAgIHJldHVybiBtYXliZUhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkZWZhdWx0SGFuZGxlU291cmNlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhhbmRsZVNvdXJjZShzb3VyY2UsIHRlY2gpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCk7XG4gICAgfVxuXG4gICAgLy8gUmVnaXN0ZXIgdGhlIHNvdXJjZSBoYW5kbGVyXG4gICAgdmlkZW9qcy5IdG1sNS5yZWdpc3RlclNvdXJjZUhhbmRsZXIoe1xuICAgICAgICBjYW5IYW5kbGVTb3VyY2U6IGNhbkhhbmRsZVNvdXJjZSxcbiAgICAgICAgaGFuZGxlU291cmNlOiBoYW5kbGVTb3VyY2VcbiAgICB9LCAwKTtcblxufS5jYWxsKHRoaXMpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgdHJ1dGh5ID0gcmVxdWlyZSgnLi4vdXRpbC90cnV0aHkuanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4uL3V0aWwvaXNTdHJpbmcuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgbG9hZE1hbmlmZXN0ID0gcmVxdWlyZSgnLi9sb2FkTWFuaWZlc3QuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbiA9IHJlcXVpcmUoJy4uL2Rhc2gvc2VnbWVudHMvZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbi5qcycpLFxuICAgIGdldE1wZCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIGdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24sXG4gICAgZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL01lZGlhVHlwZXMuanMnKSxcbiAgICBERUZBVUxUX1RZUEUgPSBtZWRpYVR5cGVzWzBdO1xuXG5nZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUgPSBmdW5jdGlvbihtaW1lVHlwZSwgdHlwZXMpIHtcbiAgICBpZiAoIWlzU3RyaW5nKG1pbWVUeXBlKSkgeyByZXR1cm4gREVGQVVMVF9UWVBFOyB9XG4gICAgdmFyIG1hdGNoZWRUeXBlID0gdHlwZXMuZmluZChmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgIHJldHVybiAoISFtaW1lVHlwZSAmJiBtaW1lVHlwZS5pbmRleE9mKHR5cGUpID49IDApO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGV4aXN0eShtYXRjaGVkVHlwZSkgPyBtYXRjaGVkVHlwZSA6IERFRkFVTFRfVFlQRTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8gb3duIG1vZHVsZSBpbiBkYXNoIHBhY2thZ2Ugc29tZXdoZXJlXG5nZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgY29kZWNTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRDb2RlY3MoKTtcbiAgICB2YXIgdHlwZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1pbWVUeXBlKCk7XG5cbiAgICAvL05PVEU6IExFQURJTkcgWkVST1MgSU4gQ09ERUMgVFlQRS9TVUJUWVBFIEFSRSBURUNITklDQUxMWSBOT1QgU1BFQyBDT01QTElBTlQsIEJVVCBHUEFDICYgT1RIRVJcbiAgICAvLyBEQVNIIE1QRCBHRU5FUkFUT1JTIFBST0RVQ0UgVEhFU0UgTk9OLUNPTVBMSUFOVCBWQUxVRVMuIEhBTkRMSU5HIEhFUkUgRk9SIE5PVy5cbiAgICAvLyBTZWU6IFJGQyA2MzgxIFNlYy4gMy40IChodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjM4MSNzZWN0aW9uLTMuNClcbiAgICB2YXIgcGFyc2VkQ29kZWMgPSBjb2RlY1N0ci5zcGxpdCgnLicpLm1hcChmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eMCsoPyFcXC58JCkvLCAnJyk7XG4gICAgfSk7XG4gICAgdmFyIHByb2Nlc3NlZENvZGVjU3RyID0gcGFyc2VkQ29kZWMuam9pbignLicpO1xuXG4gICAgcmV0dXJuICh0eXBlU3RyICsgJztjb2RlY3M9XCInICsgcHJvY2Vzc2VkQ29kZWNTdHIgKyAnXCInKTtcbn07XG5cblxuZnVuY3Rpb24gTWFuaWZlc3Qoc291cmNlVXJpLCBhdXRvTG9hZCkge1xuICAgIHRoaXMuX19hdXRvTG9hZCA9IHRydXRoeShhdXRvTG9hZCk7XG4gICAgdGhpcy5zZXRTb3VyY2VVcmkoc291cmNlVXJpKTtcbn1cblxuTWFuaWZlc3QucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBNQU5JRkVTVF9MT0FERUQ6ICdtYW5pZmVzdExvYWRlZCdcbn07XG5cblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFNvdXJjZVVyaSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fc291cmNlVXJpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLnNldFNvdXJjZVVyaSA9IGZ1bmN0aW9uIHNldFNvdXJjZVVyaShzb3VyY2VVcmkpIHtcbiAgICAvLyBUT0RPOiAnZXhpc3R5KCknIGNoZWNrIGZvciBib3RoP1xuICAgIGlmIChzb3VyY2VVcmkgPT09IHRoaXMuX19zb3VyY2VVcmkpIHsgcmV0dXJuOyB9XG5cbiAgICAvLyBUT0RPOiBpc1N0cmluZygpIGNoZWNrPyAnZXhpc3R5KCknIGNoZWNrP1xuICAgIGlmICghc291cmNlVXJpKSB7XG4gICAgICAgIHRoaXMuX19jbGVhclNvdXJjZVVyaSgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IHNvdXJjZVVyaTtcbiAgICBpZiAodGhpcy5fX2F1dG9Mb2FkKSB7XG4gICAgICAgIC8vIFRPRE86IEltcGwgYW55IGNsZWFudXAgZnVuY3Rpb25hbGl0eSBhcHByb3ByaWF0ZSBiZWZvcmUgbG9hZC5cbiAgICAgICAgdGhpcy5sb2FkKCk7XG4gICAgfVxufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLl9fY2xlYXJTb3VyY2VVcmkgPSBmdW5jdGlvbiBjbGVhclNvdXJjZVVyaSgpIHtcbiAgICB0aGlzLl9fc291cmNlVXJpID0gbnVsbDtcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAvLyBUT0RPOiBpbXBsIGFueSBvdGhlciBjbGVhbnVwIGZ1bmN0aW9uYWxpdHlcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24gbG9hZCgvKiBvcHRpb25hbCAqLyBjYWxsYmFja0ZuKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGxvYWRNYW5pZmVzdChzZWxmLl9fc291cmNlVXJpLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHNlbGYuX19tYW5pZmVzdCA9IGRhdGEubWFuaWZlc3RYbWw7XG4gICAgICAgIHNlbGYuX19zZXR1cFVwZGF0ZUludGVydmFsKCk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuTUFOSUZFU1RfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWxmLl9fbWFuaWZlc3R9KTtcbiAgICAgICAgaWYgKGlzRnVuY3Rpb24oY2FsbGJhY2tGbikpIHsgY2FsbGJhY2tGbihkYXRhLm1hbmlmZXN0WG1sKTsgfVxuICAgIH0pO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBjbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpKSB7IHJldHVybjsgfVxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fX3VwZGF0ZUludGVydmFsKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5fX3NldHVwVXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBzZXR1cFVwZGF0ZUludGVydmFsKCkge1xuICAgIGlmICh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpIHsgc2VsZi5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7IH1cbiAgICBpZiAoIXRoaXMuZ2V0U2hvdWxkVXBkYXRlKCkpIHsgcmV0dXJuOyB9XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBtaW5VcGRhdGVSYXRlID0gMixcbiAgICAgICAgdXBkYXRlUmF0ZSA9IE1hdGgubWF4KHRoaXMuZ2V0VXBkYXRlUmF0ZSgpLCBtaW5VcGRhdGVSYXRlKTtcbiAgICB0aGlzLl9fdXBkYXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgc2VsZi5sb2FkKCk7XG4gICAgfSwgdXBkYXRlUmF0ZSk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0TWVkaWFTZXRCeVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVNldEJ5VHlwZSh0eXBlKSB7XG4gICAgaWYgKG1lZGlhVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHsgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHR5cGUuIFZhbHVlIG11c3QgYmUgb25lIG9mOiAnICsgbWVkaWFUeXBlcy5qb2luKCcsICcpKTsgfVxuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCA9IGFkYXB0YXRpb25TZXRzLmZpbmQoZnVuY3Rpb24oYWRhcHRhdGlvblNldCkge1xuICAgICAgICAgICAgcmV0dXJuIChnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUoYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKSA9PT0gdHlwZSk7XG4gICAgICAgIH0pO1xuICAgIGlmICghZXhpc3R5KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBuZXcgTWVkaWFTZXQoYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2gpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldE1lZGlhU2V0cyA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0cygpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgbWVkaWFTZXRzID0gYWRhcHRhdGlvblNldHMubWFwKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHsgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0KTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0cztcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRTdHJlYW1UeXBlID0gZnVuY3Rpb24gZ2V0U3RyZWFtVHlwZSgpIHtcbiAgICB2YXIgc3RyZWFtVHlwZSA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFR5cGUoKTtcbiAgICByZXR1cm4gc3RyZWFtVHlwZTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRVcGRhdGVSYXRlID0gZnVuY3Rpb24gZ2V0VXBkYXRlUmF0ZSgpIHtcbiAgICB2YXIgbWluaW11bVVwZGF0ZVBlcmlvZCA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldE1pbmltdW1VcGRhdGVQZXJpb2QoKTtcbiAgICByZXR1cm4gTnVtYmVyKG1pbmltdW1VcGRhdGVQZXJpb2QpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFNob3VsZFVwZGF0ZSA9IGZ1bmN0aW9uIGdldFNob3VsZFVwZGF0ZSgpIHtcbiAgICB2YXIgaXNEeW5hbWljID0gKHRoaXMuZ2V0U3RyZWFtVHlwZSgpID09PSAnZHluYW1pYycpLFxuICAgICAgICBoYXNWYWxpZFVwZGF0ZVJhdGUgPSAodGhpcy5nZXRVcGRhdGVSYXRlKCkgPiAwKTtcbiAgICByZXR1cm4gKGlzRHluYW1pYyAmJiBoYXNWYWxpZFVwZGF0ZVJhdGUpO1xufTtcblxuZXh0ZW5kT2JqZWN0KE1hbmlmZXN0LnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5mdW5jdGlvbiBNZWRpYVNldChhZGFwdGF0aW9uU2V0KSB7XG4gICAgLy8gVE9ETzogQWRkaXRpb25hbCBjaGVja3MgJiBFcnJvciBUaHJvd2luZ1xuICAgIHRoaXMuX19hZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldDtcbn1cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uIGdldE1lZGlhVHlwZSgpIHtcbiAgICB2YXIgdHlwZSA9IGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSh0aGlzLmdldE1pbWVUeXBlKCksIG1lZGlhVHlwZXMpO1xuICAgIHJldHVybiB0eXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1pbWVUeXBlID0gZnVuY3Rpb24gZ2V0TWltZVR5cGUoKSB7XG4gICAgdmFyIG1pbWVUeXBlID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKTtcbiAgICByZXR1cm4gbWltZVR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyVHlwZSA9IGZ1bmN0aW9uIGdldFNvdXJjZUJ1ZmZlclR5cGUoKSB7XG4gICAgLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZSBjb2RlY3MgYXNzb2NpYXRlZCB3aXRoIGVhY2ggc3RyZWFtIHZhcmlhbnQvcmVwcmVzZW50YXRpb25cbiAgICAvLyB3aWxsIGJlIHNpbWlsYXIgZW5vdWdoIHRoYXQgeW91IHdvbid0IGhhdmUgdG8gcmUtY3JlYXRlIHRoZSBzb3VyY2UtYnVmZmVyIHdoZW4gc3dpdGNoaW5nXG4gICAgLy8gYmV0d2VlbiB0aGVtLlxuXG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNvdXJjZUJ1ZmZlclR5cGUgPSBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc291cmNlQnVmZmVyVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0VG90YWxEdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKTtcbiAgICByZXR1cm4gdG90YWxEdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsU2VnbWVudENvdW50ID0gZnVuY3Rpb24gZ2V0VG90YWxTZWdtZW50Q291bnQoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHRvdGFsU2VnbWVudENvdW50ID0gc2VnbWVudExpc3QuZ2V0VG90YWxTZWdtZW50Q291bnQoKTtcbiAgICByZXR1cm4gdG90YWxTZWdtZW50Q291bnQ7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0U2VnbWVudER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKTtcbiAgICByZXR1cm4gc2VnbWVudER1cmF0aW9uO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gc2VnbWVudExpc3QuZ2V0U3RhcnROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RTdGFydE51bWJlcjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEVuZE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0RW5kTnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdEVuZE51bWJlciA9IHNlZ21lbnRMaXN0LmdldEVuZE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdEVuZE51bWJlcjtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdHMgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdHMoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICBzZWdtZW50TGlzdHMgPSByZXByZXNlbnRhdGlvbnMubWFwKGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzZWdtZW50TGlzdHM7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICByZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCA9IHJlcHJlc2VudGF0aW9ucy5maW5kKGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICB2YXIgcmVwcmVzZW50YXRpb25CYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICAgICAgICAgIHJldHVybiAoTnVtYmVyKHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoKSA9PT0gTnVtYmVyKGJhbmR3aWR0aCkpO1xuICAgICAgICB9KSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uIGdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLm1hcChcbiAgICAgICAgZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuICAgIH0pLmZpbHRlcihcbiAgICAgICAgZnVuY3Rpb24oYmFuZHdpZHRoKSB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCk7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYW5pZmVzdDsiLCJtb2R1bGUuZXhwb3J0cyA9IFsndmlkZW8nLCAnYXVkaW8nXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwgPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VSb290VXJsO1xuXG5mdW5jdGlvbiBsb2FkTWFuaWZlc3QodXJsLCBjYWxsYmFjaykge1xuICAgIHZhciBhY3R1YWxVcmwgPSBwYXJzZVJvb3RVcmwodXJsKSxcbiAgICAgICAgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICBvbmxvYWQ7XG5cbiAgICBvbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkgeyByZXR1cm47IH1cblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrKHttYW5pZmVzdFhtbDogcmVxdWVzdC5yZXNwb25zZVhNTCB9KTsgfVxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgICAvL3RoaXMuZGVidWcubG9nKCdTdGFydCBsb2FkaW5nIG1hbmlmZXN0OiAnICsgdXJsKTtcbiAgICAgICAgcmVxdWVzdC5vbmxvYWQgPSBvbmxvYWQ7XG4gICAgICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICAgICAgcmVxdWVzdC5zZW5kKCk7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJlcXVlc3Qub25lcnJvcigpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsb2FkTWFuaWZlc3Q7IiwiXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc051bWJlciA9IHJlcXVpcmUoJy4uL3V0aWwvaXNOdW1iZXIuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgbG9hZFNlZ21lbnQsXG4gICAgREVGQVVMVF9SRVRSWV9DT1VOVCA9IDMsXG4gICAgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCA9IDI1MDtcblxubG9hZFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50LCByZXRyeUludGVydmFsKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBudWxsO1xuXG4gICAgdmFyIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKSxcbiAgICAgICAgdXJsID0gc2VnbWVudC5nZXRVcmwoKTtcbiAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuXG4gICAgcmVxdWVzdC5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IE51bWJlcigobmV3IERhdGUoKS5nZXRUaW1lKCkpLzEwMDApO1xuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2tGbiA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFja0ZuLmNhbGwoc2VsZiwgcmVxdWVzdC5yZXNwb25zZSk7IH1cbiAgICB9O1xuICAgIC8vcmVxdWVzdC5vbmVycm9yID0gcmVxdWVzdC5vbmxvYWRlbmQgPSBmdW5jdGlvbigpIHtcbiAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIHNlbGYuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcbiAgICByZXF1ZXN0LnNlbmQoKTtcbn07XG5cbmZ1bmN0aW9uIFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpIHtcbiAgICBpZiAoIWV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtYW5pZmVzdENvbnRyb2xsZXIhJyk7IH1cbiAgICBpZiAoIWV4aXN0eShtZWRpYVR5cGUpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtZWRpYVR5cGUhJyk7IH1cbiAgICB0aGlzLl9fbWFuaWZlc3QgPSBtYW5pZmVzdENvbnRyb2xsZXI7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICAvLyBUT0RPOiBEb24ndCBsaWtlIHRoaXM6IE5lZWQgdG8gY2VudHJhbGl6ZSBwbGFjZShzKSB3aGVyZSAmIGhvdyBfX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkIGdldHMgc2V0IHRvIHRydWUvZmFsc2UuXG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSB0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKTtcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSB0cnVlO1xufVxuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgSU5JVElBTElaQVRJT05fTE9BREVEOiAnaW5pdGlhbGl6YXRpb25Mb2FkZWQnLFxuICAgIFNFR01FTlRfTE9BREVEOiAnc2VnbWVudExvYWRlZCcsXG4gICAgRE9XTkxPQURfREFUQV9VUERBVEU6ICdkb3dubG9hZERhdGFVcGRhdGUnXG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5fX2dldE1lZGlhU2V0ID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXQoKSB7XG4gICAgdmFyIG1lZGlhU2V0ID0gdGhpcy5fX21hbmlmZXN0LmdldE1lZGlhU2V0QnlUeXBlKHRoaXMuX19tZWRpYVR5cGUpO1xuICAgIHJldHVybiBtZWRpYVNldDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0cygpWzBdO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRDdXJyZW50QmFuZHdpZHRoKCkge1xuICAgIGlmICghaXNOdW1iZXIodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpKSB7IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5fX2dldERlZmF1bHRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpOyB9XG4gICAgcmV0dXJuIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuc2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIHNldEN1cnJlbnRCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgaWYgKCFpc051bWJlcihiYW5kd2lkdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIGV4cGVjdHMgYSBudW1lcmljIHZhbHVlIGZvciBiYW5kd2lkdGghJyk7XG4gICAgfVxuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgaWYgKGF2YWlsYWJsZUJhbmR3aWR0aHMuaW5kZXhPZihiYW5kd2lkdGgpIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBtdXN0IGJlIHNldCB0byBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXM6ICcgKyBhdmFpbGFibGVCYW5kd2lkdGhzLmpvaW4oJywgJykpO1xuICAgIH1cbiAgICBpZiAoYmFuZHdpZHRoID09PSB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkgeyByZXR1cm47IH1cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSB0cnVlO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gYmFuZHdpZHRoO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9ICB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoKHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGF2YWlsYWJsZUJhbmR3aWR0aHMgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgcmV0dXJuIGF2YWlsYWJsZUJhbmR3aWR0aHM7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRTdGFydE51bWJlciA9IGZ1bmN0aW9uIGdldFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciBzdGFydE51bWJlciA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIoKTtcbiAgICByZXR1cm4gc3RhcnROdW1iZXI7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50KCkge1xuICAgIHZhciBzZWdtZW50ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRTZWdtZW50QnlOdW1iZXIodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyKTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TnVtYmVyID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIoKSB7IHJldHVybiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXI7IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50U3RhcnRUaW1lID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnRTdGFydFRpbWUoKSB7IHJldHVybiB0aGlzLmdldEN1cnJlbnRTZWdtZW50KCkuZ2V0U3RhcnROdW1iZXIoKTsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0RW5kTnVtYmVyID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGVuZE51bWJlciA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0RW5kTnVtYmVyKCk7XG4gICAgcmV0dXJuIGVuZE51bWJlcjtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBleGlzdHkodGhpcy5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSkgPyB0aGlzLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lIDogLTE7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZXhpc3R5KHRoaXMuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUpID8gdGhpcy5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA6IC0xO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRMYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUoKSAtIHRoaXMuZ2V0TGFzdERvd25sb2FkU3RhcnRUaW1lKCk7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkSW5pdGlhbGl6YXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKSxcbiAgICAgICAgaW5pdGlhbGl6YXRpb24gPSBzZWdtZW50TGlzdC5nZXRJbml0aWFsaXphdGlvbigpO1xuXG4gICAgaWYgKCFpbml0aWFsaXphdGlvbikgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgaW5pdGlhbGl6YXRpb24sIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciBpbml0U2VnbWVudCA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWROZXh0U2VnbWVudCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub0N1cnJlbnRTZWdtZW50TnVtYmVyID0gZXhpc3R5KHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciksXG4gICAgICAgIG51bWJlciA9IG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPyB0aGlzLmdldFN0YXJ0TnVtYmVyKCkgOiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgKyAxO1xuICAgIHJldHVybiB0aGlzLmxvYWRTZWdtZW50QXROdW1iZXIobnVtYmVyKTtcbn07XG5cbi8vIFRPRE86IER1cGxpY2F0ZSBjb2RlIGJlbG93LiBBYnN0cmFjdCBhd2F5LlxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdE51bWJlciA9IGZ1bmN0aW9uKG51bWJlcikge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpO1xuXG4gICAgY29uc29sZS5sb2coJ0JBTkRXSURUSCBPRiBTRUdNRU5UIEJFSU5HIFJFUVVFU1RFRDogJyArIHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpKTtcblxuICAgIGlmIChudW1iZXIgPiB0aGlzLmdldEVuZE51bWJlcigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlOdW1iZXIobnVtYmVyKTtcblxuICAgIGlmICh0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQpIHtcbiAgICAgICAgdGhpcy5vbmUodGhpcy5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gZXZlbnQuZGF0YTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IGZhbHNlO1xuICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOltpbml0U2VnbWVudCwgc2VnbWVudERhdGFdIH0pO1xuICAgICAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmxvYWRJbml0aWFsaXphdGlvbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbihwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCk7XG5cbiAgICBjb25zb2xlLmxvZygnQkFORFdJRFRIIE9GIFNFR01FTlQgQkVJTkcgUkVRVUVTVEVEOiAnICsgc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKCkpO1xuXG4gICAgaWYgKHByZXNlbnRhdGlvblRpbWUgPiBzZWdtZW50TGlzdC5nZXRUb3RhbER1cmF0aW9uKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVRpbWUocHJlc2VudGF0aW9uVGltZSk7XG5cbiAgICBpZiAodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkKSB7XG4gICAgICAgIHRoaXMub25lKHRoaXMuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBpbml0U2VnbWVudCA9IGV2ZW50LmRhdGE7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpbaW5pdFNlZ21lbnQsIHNlZ21lbnREYXRhXSB9KTtcbiAgICAgICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2FkSW5pdGlhbGl6YXRpb24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX0RBVEFfVVBEQVRFLFxuICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHNlbGYsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ0dDogc2VsZi5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGxheWJhY2tUaW1lOiBzZWdtZW50LmdldER1cmF0aW9uKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBiYW5kd2lkdGg6IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlZ21lbnREYXRhIH0pO1xuICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNlZ21lbnRMb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciBiYW5kd2lkdGhBID0gc2VnbWVudExpc3RBLmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBiYW5kd2lkdGhCID0gc2VnbWVudExpc3RCLmdldEJhbmR3aWR0aCgpO1xuICAgIHJldHVybiBiYW5kd2lkdGhBIC0gYmFuZHdpZHRoQjtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5V2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgd2lkdGhBID0gc2VnbWVudExpc3RBLmdldFdpZHRoKCkgfHwgMCxcbiAgICAgICAgd2lkdGhCID0gc2VnbWVudExpc3RCLmdldFdpZHRoKCkgfHwgMDtcbiAgICByZXR1cm4gd2lkdGhBIC0gd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aFRoZW5CYW5kd2lkdGhBc2NlbmRpbmcoc2VnbWVudExpc3RBLCBzZWdtZW50TGlzdEIpIHtcbiAgICB2YXIgcmVzb2x1dGlvbkNvbXBhcmUgPSBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qik7XG4gICAgcmV0dXJuIChyZXNvbHV0aW9uQ29tcGFyZSAhPT0gMCkgPyByZXNvbHV0aW9uQ29tcGFyZSA6IGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qik7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclNlZ21lbnRMaXN0c0J5UmVzb2x1dGlvbihzZWdtZW50TGlzdCwgbWF4V2lkdGgsIG1heEhlaWdodCkge1xuICAgIHZhciB3aWR0aCA9IHNlZ21lbnRMaXN0LmdldFdpZHRoKCkgfHwgMCxcbiAgICAgICAgaGVpZ2h0ID0gc2VnbWVudExpc3QuZ2V0SGVpZ2h0KCkgfHwgMDtcbiAgICByZXR1cm4gKCh3aWR0aCA8PSBtYXhXaWR0aCkgJiYgKGhlaWdodCA8PSBtYXhIZWlnaHQpKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QsIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCwgZG93bmxvYWRSYXRlUmF0aW8pIHtcbiAgICB2YXIgc2VnbWVudExpc3RCYW5kd2lkdGggPSBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSxcbiAgICAgICAgc2VnbWVudEJhbmR3aWR0aFJhdGlvID0gc2VnbWVudExpc3RCYW5kd2lkdGggLyBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGg7XG4gICAgcmV0dXJuIChkb3dubG9hZFJhdGVSYXRpbyA+PSBzZWdtZW50QmFuZHdpZHRoUmF0aW8pO1xufVxuXG4vLyBOT1RFOiBQYXNzaW5nIGluIG1lZGlhU2V0IGluc3RlYWQgb2YgbWVkaWFTZXQncyBTZWdtZW50TGlzdCBBcnJheSBzaW5jZSBzb3J0IGlzIGRlc3RydWN0aXZlIGFuZCBkb24ndCB3YW50IHRvIGNsb25lLlxuLy8gICAgICBBbHNvIGFsbG93cyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eSBvZiBmbi5cbmZ1bmN0aW9uIHNlbGVjdFNlZ21lbnRMaXN0KG1lZGlhU2V0LCBkYXRhKSB7XG4gICAgdmFyIGRvd25sb2FkUmF0ZVJhdGlvID0gZGF0YS5kb3dubG9hZFJhdGVSYXRpbyxcbiAgICAgICAgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoID0gZGF0YS5jdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGgsXG4gICAgICAgIHdpZHRoID0gZGF0YS53aWR0aCxcbiAgICAgICAgaGVpZ2h0ID0gZGF0YS5oZWlnaHQsXG4gICAgICAgIHNvcnRlZEJ5QmFuZHdpZHRoID0gbWVkaWFTZXQuZ2V0U2VnbWVudExpc3RzKCkuc29ydChjb21wYXJlU2VnbWVudExpc3RzQnlCYW5kd2lkdGhBc2NlbmRpbmcpLFxuICAgICAgICBzb3J0ZWRCeVJlc29sdXRpb25UaGVuQmFuZHdpZHRoID0gbWVkaWFTZXQuZ2V0U2VnbWVudExpc3RzKCkuc29ydChjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aFRoZW5CYW5kd2lkdGhBc2NlbmRpbmcpLFxuICAgICAgICBmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlLFxuICAgICAgICBmaWx0ZXJlZEJ5UmVzb2x1dGlvbixcbiAgICAgICAgcHJvcG9zZWRTZWdtZW50TGlzdDtcblxuICAgIGZ1bmN0aW9uIGZpbHRlckJ5UmVzb2x1dGlvbihzZWdtZW50TGlzdCkge1xuICAgICAgICByZXR1cm4gZmlsdGVyU2VnbWVudExpc3RzQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0LCB3aWR0aCwgaGVpZ2h0KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCkge1xuICAgICAgICByZXR1cm4gZmlsdGVyU2VnbWVudExpc3RzQnlEb3dubG9hZFJhdGUoc2VnbWVudExpc3QsIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCwgZG93bmxvYWRSYXRlUmF0aW8pO1xuICAgIH1cblxuICAgIGZpbHRlcmVkQnlSZXNvbHV0aW9uID0gc29ydGVkQnlSZXNvbHV0aW9uVGhlbkJhbmR3aWR0aC5maWx0ZXIoZmlsdGVyQnlSZXNvbHV0aW9uKTtcbiAgICBmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlID0gc29ydGVkQnlCYW5kd2lkdGguZmlsdGVyKGZpbHRlckJ5RG93bmxvYWRSYXRlKTtcblxuICAgIHByb3Bvc2VkU2VnbWVudExpc3QgPSBmaWx0ZXJlZEJ5UmVzb2x1dGlvbltmaWx0ZXJlZEJ5UmVzb2x1dGlvbi5sZW5ndGggLSAxXSB8fCBmaWx0ZXJlZEJ5RG93bmxvYWRSYXRlW2ZpbHRlcmVkQnlEb3dubG9hZFJhdGUubGVuZ3RoIC0gMV0gfHwgc29ydGVkQnlCYW5kd2lkdGhbMF07XG5cbiAgICByZXR1cm4gcHJvcG9zZWRTZWdtZW50TGlzdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzZWxlY3RTZWdtZW50TGlzdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgdHlwZT9cbiAgICBpZiAoIXNvdXJjZUJ1ZmZlcikgeyB0aHJvdyBuZXcgRXJyb3IoICdUaGUgc291cmNlQnVmZmVyIGNvbnN0cnVjdG9yIGFyZ3VtZW50IGNhbm5vdCBiZSBudWxsLicgKTsgfVxuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBkYXRhUXVldWUgPSBbXTtcbiAgICAvLyBUT0RPOiBmaWd1cmUgb3V0IGhvdyB3ZSB3YW50IHRvIHJlc3BvbmQgdG8gb3RoZXIgZXZlbnQgc3RhdGVzICh1cGRhdGVlbmQ/IGVycm9yPyBhYm9ydD8pIChyZXRyeT8gcmVtb3ZlPylcbiAgICBzb3VyY2VCdWZmZXIuYWRkRXZlbnRMaXN0ZW5lcigndXBkYXRlZW5kJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgLy8gVGhlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZSdzIHVwZGF0aW5nIHByb3BlcnR5IHNob3VsZCBhbHdheXMgYmUgZmFsc2UgaWYgdGhpcyBldmVudCB3YXMgZGlzcGF0Y2hlZCxcbiAgICAgICAgLy8gYnV0IGp1c3QgaW4gY2FzZS4uLlxuICAgICAgICBpZiAoZXZlbnQudGFyZ2V0LnVwZGF0aW5nKSB7IHJldHVybjsgfVxuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9BRERFRF9UT19CVUZGRVIsIHRhcmdldDpzZWxmIH0pO1xuXG4gICAgICAgIGlmIChzZWxmLl9fZGF0YVF1ZXVlLmxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKHNlbGYuX19kYXRhUXVldWUuc2hpZnQoKSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gZGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXIgPSBzb3VyY2VCdWZmZXI7XG59XG5cbi8vIFRPRE86IEFkZCBhcyBcImNsYXNzXCIgcHJvcGVydGllcz9cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFFVRVVFX0VNUFRZOiAncXVldWVFbXB0eScsXG4gICAgU0VHTUVOVF9BRERFRF9UT19CVUZGRVI6ICdzZWdtZW50QWRkZWRUb0J1ZmZlcidcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuYWRkVG9RdWV1ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgZGF0YVRvQWRkSW1tZWRpYXRlbHk7XG4gICAgaWYgKCFleGlzdHkoZGF0YSkgfHwgKGlzQXJyYXkoZGF0YSkgJiYgZGF0YS5sZW5ndGggPD0gMCkpIHsgcmV0dXJuOyB9XG4gICAgLy8gVHJlYXQgYWxsIGRhdGEgYXMgYXJyYXlzIHRvIG1ha2Ugc3Vic2VxdWVudCBmdW5jdGlvbmFsaXR5IGdlbmVyaWMuXG4gICAgaWYgKCFpc0FycmF5KGRhdGEpKSB7IGRhdGEgPSBbZGF0YV07IH1cbiAgICAvLyBJZiBub3RoaW5nIGlzIGluIHRoZSBxdWV1ZSwgZ28gYWhlYWQgYW5kIGltbWVkaWF0ZWx5IGFwcGVuZCB0aGUgZmlyc3QgZGF0YSB0byB0aGUgc291cmNlIGJ1ZmZlci5cbiAgICBpZiAoKHRoaXMuX19kYXRhUXVldWUubGVuZ3RoID09PSAwKSAmJiAoIXRoaXMuX19zb3VyY2VCdWZmZXIudXBkYXRpbmcpKSB7IGRhdGFUb0FkZEltbWVkaWF0ZWx5ID0gZGF0YS5zaGlmdCgpOyB9XG4gICAgLy8gSWYgYW55IG90aGVyIGRhdGEgKHN0aWxsKSBleGlzdHMsIHB1c2ggdGhlIHJlc3Qgb250byB0aGUgZGF0YVF1ZXVlLlxuICAgIHRoaXMuX19kYXRhUXVldWUgPSB0aGlzLl9fZGF0YVF1ZXVlLmNvbmNhdChkYXRhKTtcbiAgICBpZiAoZXhpc3R5KGRhdGFUb0FkZEltbWVkaWF0ZWx5KSkgeyB0aGlzLl9fc291cmNlQnVmZmVyLmFwcGVuZEJ1ZmZlcihkYXRhVG9BZGRJbW1lZGlhdGVseSk7IH1cbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuY2xlYXJRdWV1ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX19kYXRhUXVldWUgPSBbXTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuaGFzQnVmZmVyZWREYXRhRm9yVGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICByZXR1cm4gY2hlY2tUaW1lUmFuZ2VzRm9yVGltZSh0aGlzLl9fc291cmNlQnVmZmVyLmJ1ZmZlcmVkLCBwcmVzZW50YXRpb25UaW1lLCBmdW5jdGlvbihzdGFydFRpbWUsIGVuZFRpbWUpIHtcbiAgICAgICAgcmV0dXJuICgoc3RhcnRUaW1lID49IDApIHx8IChlbmRUaW1lID49IDApKTtcbiAgICB9KTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZGV0ZXJtaW5lQW1vdW50QnVmZmVyZWRGcm9tVGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICAvLyBJZiB0aGUgcmV0dXJuIHZhbHVlIGlzIDwgMCwgbm8gZGF0YSBpcyBidWZmZXJlZCBAIHByZXNlbnRhdGlvblRpbWUuXG4gICAgcmV0dXJuIGNoZWNrVGltZVJhbmdlc0ZvclRpbWUodGhpcy5fX3NvdXJjZUJ1ZmZlci5idWZmZXJlZCwgcHJlc2VudGF0aW9uVGltZSxcbiAgICAgICAgZnVuY3Rpb24oc3RhcnRUaW1lLCBlbmRUaW1lLCBwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gZW5kVGltZSAtIHByZXNlbnRhdGlvblRpbWU7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxuZnVuY3Rpb24gY2hlY2tUaW1lUmFuZ2VzRm9yVGltZSh0aW1lUmFuZ2VzLCB0aW1lLCBjYWxsYmFjaykge1xuICAgIHZhciB0aW1lUmFuZ2VzTGVuZ3RoID0gdGltZVJhbmdlcy5sZW5ndGgsXG4gICAgICAgIGkgPSAwLFxuICAgICAgICBjdXJyZW50U3RhcnRUaW1lLFxuICAgICAgICBjdXJyZW50RW5kVGltZTtcblxuICAgIGZvciAoaTsgaTx0aW1lUmFuZ2VzTGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY3VycmVudFN0YXJ0VGltZSA9IHRpbWVSYW5nZXMuc3RhcnQoaSk7XG4gICAgICAgIGN1cnJlbnRFbmRUaW1lID0gdGltZVJhbmdlcy5lbmQoaSk7XG4gICAgICAgIGlmICgodGltZSA+PSBjdXJyZW50U3RhcnRUaW1lKSAmJiAodGltZSA8PSBjdXJyZW50RW5kVGltZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBpc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGN1cnJlbnRTdGFydFRpbWUsIGN1cnJlbnRFbmRUaW1lLCB0aW1lKSA6IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAoY3VycmVudFN0YXJ0VGltZSA+IHRpbWUpIHtcbiAgICAgICAgICAgIC8vIElmIHRoZSBjdXJyZW50U3RhcnRUaW1lIGlzIGdyZWF0ZXIgdGhhbiB0aGUgdGltZSB3ZSdyZSBsb29raW5nIGZvciwgdGhhdCBtZWFucyB3ZSd2ZSByZWFjaGVkIGEgdGltZSByYW5nZVxuICAgICAgICAgICAgLy8gdGhhdCdzIHBhc3QgdGhlIHRpbWUgd2UncmUgbG9va2luZyBmb3IgKHNpbmNlIFRpbWVSYW5nZXMgc2hvdWxkIGJlIG9yZGVyZWQgY2hyb25vbG9naWNhbGx5KS4gSWYgc28sIHdlXG4gICAgICAgICAgICAvLyBjYW4gc2hvcnQgY2lyY3VpdC5cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soLTEsIC0xLCB0aW1lKSA6IGZhbHNlO1xufVxuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlQnVmZmVyRGF0YVF1ZXVlOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gZXhpc3R5KHgpIHsgcmV0dXJuICh4ICE9PSBudWxsKSAmJiAoeCAhPT0gdW5kZWZpbmVkKTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV4aXN0eTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIEV4dGVuZCBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgcHJvcGVydGllcyAoYW5kIHRoZWlyIHZhbHVlcykgZm91bmQgaW4gdGhlIHBhc3NlZC1pbiBvYmplY3QocykuXG52YXIgZXh0ZW5kT2JqZWN0ID0gZnVuY3Rpb24ob2JqIC8qLCBleHRlbmRPYmplY3QxLCBleHRlbmRPYmplY3QyLCAuLi4sIGV4dGVuZE9iamVjdE4gKi8pIHtcbiAgICBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLmZvckVhY2goZnVuY3Rpb24oZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgIGlmIChleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgb2JqW3Byb3BdID0gZXh0ZW5kT2JqZWN0W3Byb3BdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIG9iajtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kT2JqZWN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc0FycmF5KG9iaikge1xuICAgIHJldHVybiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBBcnJheV0nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXk7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbnZhciBpc0Z1bmN0aW9uID0gZnVuY3Rpb24gaXNGdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbic7XG59O1xuLy8gZmFsbGJhY2sgZm9yIG9sZGVyIHZlcnNpb25zIG9mIENocm9tZSBhbmQgU2FmYXJpXG5pZiAoaXNGdW5jdGlvbigveC8pKSB7XG4gICAgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBGdW5jdGlvbl0nO1xuICAgIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNGdW5jdGlvbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNOdW1iZXIodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgTnVtYmVyXScgfHwgZmFsc2U7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNOdW1iZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbnZhciBpc1N0cmluZyA9IGZ1bmN0aW9uIGlzU3RyaW5nKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IFN0cmluZ10nIHx8IGZhbHNlO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBpc1N0cmluZzsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL2V4aXN0eS5qcycpO1xuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxubW9kdWxlLmV4cG9ydHMgPSB0cnV0aHk7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBUT0RPOiBSZWZhY3RvciB0byBzZXBhcmF0ZSBqcyBmaWxlcyAmIG1vZHVsZXMgJiByZW1vdmUgZnJvbSBoZXJlLlxuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi91dGlsL2lzU3RyaW5nLmpzJyk7XG5cbi8vIE5PVEU6IFRoaXMgdmVyc2lvbiBvZiB0cnV0aHkgYWxsb3dzIG1vcmUgdmFsdWVzIHRvIGNvdW50XG4vLyBhcyBcInRydWVcIiB0aGFuIHN0YW5kYXJkIEpTIEJvb2xlYW4gb3BlcmF0b3IgY29tcGFyaXNvbnMuXG4vLyBTcGVjaWZpY2FsbHksIHRydXRoeSgpIHdpbGwgcmV0dXJuIHRydWUgZm9yIHRoZSB2YWx1ZXNcbi8vIDAsIFwiXCIsIGFuZCBOYU4sIHdoZXJlYXMgSlMgd291bGQgdHJlYXQgdGhlc2UgYXMgXCJmYWxzeVwiIHZhbHVlcy5cbmZ1bmN0aW9uIHRydXRoeSh4KSB7IHJldHVybiAoeCAhPT0gZmFsc2UpICYmIGV4aXN0eSh4KTsgfVxuXG5mdW5jdGlvbiBwcmVBcHBseUFyZ3NGbihmdW4gLyosIGFyZ3MgKi8pIHtcbiAgICB2YXIgcHJlQXBwbGllZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgIC8vIE5PVEU6IHRoZSAqdGhpcyogcmVmZXJlbmNlIHdpbGwgcmVmZXIgdG8gdGhlIGNsb3N1cmUncyBjb250ZXh0IHVubGVzc1xuICAgIC8vIHRoZSByZXR1cm5lZCBmdW5jdGlvbiBpcyBpdHNlbGYgY2FsbGVkIHZpYSAuY2FsbCgpIG9yIC5hcHBseSgpLiBJZiB5b3VcbiAgICAvLyAqbmVlZCogdG8gcmVmZXIgdG8gaW5zdGFuY2UtbGV2ZWwgcHJvcGVydGllcywgZG8gc29tZXRoaW5nIGxpa2UgdGhlIGZvbGxvd2luZzpcbiAgICAvL1xuICAgIC8vIE15VHlwZS5wcm90b3R5cGUuc29tZUZuID0gZnVuY3Rpb24oYXJnQykgeyBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pLmNhbGwodGhpcyk7IH07XG4gICAgLy9cbiAgICAvLyBPdGhlcndpc2UsIHlvdSBzaG91bGQgYmUgYWJsZSB0byBqdXN0IGNhbGw6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IHByZUFwcGx5QXJnc0ZuKHNvbWVPdGhlckZuLCBhcmdBLCBhcmdCLCAuLi4gYXJnTik7XG4gICAgLy9cbiAgICAvLyBXaGVyZSBwb3NzaWJsZSwgZnVuY3Rpb25zIGFuZCBtZXRob2RzIHNob3VsZCBub3QgYmUgcmVhY2hpbmcgb3V0IHRvIGdsb2JhbCBzY29wZSBhbnl3YXksIHNvLi4uXG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkgeyByZXR1cm4gZnVuLmFwcGx5KHRoaXMsIHByZUFwcGxpZWRBcmdzKTsgfTtcbn1cblxuLy8gSGlnaGVyLW9yZGVyIFhNTCBmdW5jdGlvbnNcblxuLy8gVGFrZXMgZnVuY3Rpb24ocykgYXMgYXJndW1lbnRzXG52YXIgZ2V0QW5jZXN0b3JzID0gZnVuY3Rpb24oZWxlbSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICB2YXIgYW5jZXN0b3JzID0gW107XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICAoZnVuY3Rpb24gZ2V0QW5jZXN0b3JzUmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtLCBhbmNlc3RvcnMpKSB7IHJldHVybjsgfVxuICAgICAgICBpZiAoZXhpc3R5KGVsZW0pICYmIGV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7XG4gICAgICAgICAgICBhbmNlc3RvcnMucHVzaChlbGVtLnBhcmVudE5vZGUpO1xuICAgICAgICAgICAgZ2V0QW5jZXN0b3JzUmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9KShlbGVtKTtcbiAgICByZXR1cm4gYW5jZXN0b3JzO1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldE5vZGVMaXN0QnlOYW1lID0gZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiBmdW5jdGlvbih4bWxPYmopIHtcbiAgICAgICAgcmV0dXJuIHhtbE9iai5nZXRFbGVtZW50c0J5VGFnTmFtZShuYW1lKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGhhc01hdGNoaW5nQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKCh0eXBlb2YgYXR0ck5hbWUgIT09ICdzdHJpbmcnKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiBmYWxzZTsgfVxuICAgICAgICBpZiAoIWV4aXN0eSh2YWx1ZSkpIHsgcmV0dXJuIGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICByZXR1cm4gKGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKSA9PT0gdmFsdWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0QXR0ckZuID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoIWlzU3RyaW5nKGF0dHJOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWlzRnVuY3Rpb24oZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxuLy8gVE9ETzogQWRkIHNob3VsZFN0b3BQcmVkIChzaG91bGQgZnVuY3Rpb24gc2ltaWxhcmx5IHRvIHNob3VsZFN0b3BQcmVkIGluIGdldEluaGVyaXRhYmxlRWxlbWVudCwgYmVsb3cpXG52YXIgZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICgoIWlzU3RyaW5nKGF0dHJOYW1lKSkgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpKSB7IHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxuLy8gVGFrZXMgZnVuY3Rpb24ocykgYXMgYXJndW1lbnRzOyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0SW5oZXJpdGFibGVFbGVtZW50ID0gZnVuY3Rpb24obm9kZU5hbWUsIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0pKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgdmFyIG1hdGNoaW5nRWxlbUxpc3QgPSBlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5vZGVOYW1lKTtcbiAgICAgICAgaWYgKGV4aXN0eShtYXRjaGluZ0VsZW1MaXN0KSAmJiBtYXRjaGluZ0VsZW1MaXN0Lmxlbmd0aCA+IDApIHsgcmV0dXJuIG1hdGNoaW5nRWxlbUxpc3RbMF07IH1cbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRPRE86IEltcGxlbWVudCBtZSBmb3IgQmFzZVVSTCBvciB1c2UgZXhpc3RpbmcgZm4gKFNlZTogbXBkLmpzIGJ1aWxkQmFzZVVybCgpKVxuLyp2YXIgYnVpbGRIaWVyYXJjaGljYWxseVN0cnVjdHVyZWRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlRm4sIGJ1aWxkRm4sIHN0b3BQcmVkKSB7XG5cbn07Ki9cblxuLy8gUHVibGlzaCBFeHRlcm5hbCBBUEk6XG52YXIgeG1sZnVuID0ge307XG54bWxmdW4uZXhpc3R5ID0gZXhpc3R5O1xueG1sZnVuLnRydXRoeSA9IHRydXRoeTtcblxueG1sZnVuLmdldE5vZGVMaXN0QnlOYW1lID0gZ2V0Tm9kZUxpc3RCeU5hbWU7XG54bWxmdW4uaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBoYXNNYXRjaGluZ0F0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGdldEluaGVyaXRhYmxlQXR0cmlidXRlO1xueG1sZnVuLmdldEFuY2VzdG9ycyA9IGdldEFuY2VzdG9ycztcbnhtbGZ1bi5nZXRBdHRyRm4gPSBnZXRBdHRyRm47XG54bWxmdW4ucHJlQXBwbHlBcmdzRm4gPSBwcmVBcHBseUFyZ3NGbjtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBnZXRJbmhlcml0YWJsZUVsZW1lbnQ7XG5cbm1vZHVsZS5leHBvcnRzID0geG1sZnVuOyJdfQ==
