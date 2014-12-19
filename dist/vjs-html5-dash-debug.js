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

function PlaylistLoader(manifestController, mediaSource, tech) {
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
},{"./util/existy.js":18,"./util/isFunction.js":21,"./util/isString.js":23}]},{},[11])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9NZWRpYVR5cGVMb2FkZXIuanMiLCJzcmMvanMvUGxheWxpc3RMb2FkZXIuanMiLCJzcmMvanMvU291cmNlSGFuZGxlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zZWxlY3RTZWdtZW50TGlzdC5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL09BOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKGdsb2JhbCl7XG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gd2luZG93O1xufSBlbHNlIGlmICh0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBnbG9iYWw7XG59IGVsc2UgaWYgKHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiKXtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHNlbGY7XG59IGVsc2Uge1xuICAgIG1vZHVsZS5leHBvcnRzID0ge307XG59XG5cbn0pLmNhbGwodGhpcyx0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDogdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9KSIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFID0gMjAsXG4gICAgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUgPSA0MDtcblxuLy8gVE9ETzogUmVuYW1lIG9iamVjdCB0eXBlIChNZWRpYVR5cGVMb2FkZXI/KVxuZnVuY3Rpb24gTWVkaWFUeXBlTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX3NlZ21lbnRMb2FkZXIgPSBzZWdtZW50TG9hZGVyO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWU7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG59XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HOiAncmVjaGVja1NlZ21lbnRMb2FkaW5nJ1xufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19tZWRpYVR5cGU7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U2VnbWVudExvYWRlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXI7IH07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlOyB9O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLnN0YXJ0TG9hZGluZ1NlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc2VsZi5fX2NoZWNrU2VnbWVudExvYWRpbmcoTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUsIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFKTtcbiAgICB9O1xuXG4gICAgdGhpcy5vbih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuXG4gICAgdGhpcy5fX2NoZWNrU2VnbWVudExvYWRpbmcoTUlOX0RFU0lSRURfQlVGRkVSX1NJWkUsIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFKTtcbn07XG5cbk1lZGlhVHlwZUxvYWRlci5wcm90b3R5cGUuc3RvcExvYWRpbmdTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghZXhpc3R5KHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKSkgeyByZXR1cm47IH1cblxuICAgIHRoaXMub2ZmKHRoaXMuZXZlbnRMaXN0LlJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HLCB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcik7XG4gICAgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIgPSB1bmRlZmluZWQ7XG59O1xuXG5NZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLl9fY2hlY2tTZWdtZW50TG9hZGluZyA9IGZ1bmN0aW9uKG1pbkRlc2lyZWRCdWZmZXJTaXplLCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgIC8vIFRPRE86IFVzZSBzZWdtZW50IGR1cmF0aW9uIHdpdGggY3VycmVudFRpbWUgJiBjdXJyZW50QnVmZmVyU2l6ZSB0byBjYWxjdWxhdGUgd2hpY2ggc2VnbWVudCB0byBncmFiIHRvIGF2b2lkIGVkZ2UgY2FzZXMgdy9yb3VuZGluZyAmIHByZWNpc2lvblxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgdGVjaCA9IHNlbGYuX190ZWNoLFxuICAgICAgICBzZWdtZW50TG9hZGVyID0gc2VsZi5fX3NlZ21lbnRMb2FkZXIsXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNlbGYuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUsXG4gICAgICAgIGN1cnJlbnRUaW1lID0gdGVjaC5jdXJyZW50VGltZSgpLFxuICAgICAgICBjdXJyZW50QnVmZmVyU2l6ZSA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5kZXRlcm1pbmVBbW91bnRCdWZmZXJlZEZyb21UaW1lKGN1cnJlbnRUaW1lKSxcbiAgICAgICAgc2VnbWVudER1cmF0aW9uID0gc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRTZWdtZW50RHVyYXRpb24oKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0VG90YWxEdXJhdGlvbigpLFxuICAgICAgICBkb3dubG9hZFBvaW50ID0gKGN1cnJlbnRUaW1lICsgY3VycmVudEJ1ZmZlclNpemUpICsgKHNlZ21lbnREdXJhdGlvbiAvIDQpLFxuICAgICAgICBkb3dubG9hZFJvdW5kVHJpcFRpbWUsXG4gICAgICAgIHNlZ21lbnREb3dubG9hZERlbGF5O1xuXG4gICAgZnVuY3Rpb24gZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCkge1xuICAgICAgICB2YXIgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgcmVjaGVja1dhaXRUaW1lTVMgPSBNYXRoLmZsb29yKE1hdGgubWluKHNlZ21lbnREdXJhdGlvbiwgMikgKiAxMDAwKTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9LCByZWNoZWNrV2FpdFRpbWVNUyk7XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIHByb3Bvc2VkIHRpbWUgdG8gZG93bmxvYWQgaXMgYWZ0ZXIgdGhlIGVuZCB0aW1lIG9mIHRoZSBtZWRpYSBvciB3ZSBoYXZlIG1vcmUgaW4gdGhlIGJ1ZmZlciB0aGFuIHRoZSBtYXggZGVzaXJlZCxcbiAgICAvLyB3YWl0IGEgd2hpbGUgYW5kIHRoZW4gdHJpZ2dlciBhbiBldmVudCBub3RpZnlpbmcgdGhhdCAoaWYgYW55b25lJ3MgbGlzdGVuaW5nKSB3ZSBzaG91bGQgcmVjaGVjayB0byBzZWUgaWYgY29uZGl0aW9uc1xuICAgIC8vIGhhdmUgY2hhbmdlZC5cbiAgICAvLyBUT0RPOiBIYW5kbGUgY29uZGl0aW9uIHdoZXJlIGZpbmFsIHNlZ21lbnQncyBkdXJhdGlvbiBpcyBsZXNzIHRoYW4gMS8yIHN0YW5kYXJkIHNlZ21lbnQncyBkdXJhdGlvbi5cbiAgICBpZiAoZG93bmxvYWRQb2ludCA+PSB0b3RhbER1cmF0aW9uKSB7XG4gICAgICAgIGRlZmVycmVkUmVjaGVja05vdGlmaWNhdGlvbigpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDw9IDApIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDE6IE5vdGhpbmcgaXMgaW4gdGhlIHNvdXJjZSBidWZmZXIgc3RhcnRpbmcgYXQgdGhlIGN1cnJlbnQgdGltZSBmb3IgdGhlIG1lZGlhIHR5cGVcbiAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IGZvciB0aGUgY3VycmVudCB0aW1lIHJpZ2h0IG5vdy5cbiAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGN1cnJlbnRUaW1lKTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWluRGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDI6IFRoZXJlJ3Mgc29tZXRoaW5nIGluIHRoZSBzb3VyY2UgYnVmZmVyIHN0YXJ0aW5nIGF0IHRoZSBjdXJyZW50IHRpbWUgZm9yIHRoZSBtZWRpYSB0eXBlLCBidXQgaXQnc1xuICAgICAgICAvLyAgICAgICAgICAgICAgYmVsb3cgdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSAoc2Vjb25kcyBvZiBwbGF5YmFjayBpbiB0aGUgYnVmZmVyIGZvciB0aGUgbWVkaWEgdHlwZSlcbiAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgdGltZSkuXG4gICAgICAgIC8vICAgICAgICAgICByaWdodCBub3cuXG4gICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDM6IFRoZSBidWZmZXIgaXMgZnVsbCBtb3JlIHRoYW4gdGhlIG1pbmltdW0gZGVzaXJlZCBidWZmZXIgc2l6ZSBidXQgbm90IHlldCBtb3JlIHRoYW4gdGhlIG1heGltdW0gZGVzaXJlZFxuICAgICAgICAvLyAgICAgICAgICAgICAgYnVmZmVyIHNpemUuXG4gICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSA9IHNlZ21lbnRMb2FkZXIuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKTtcbiAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXkgPSBzZWdtZW50RHVyYXRpb24gLSBkb3dubG9hZFJvdW5kVHJpcFRpbWU7XG4gICAgICAgIGlmIChzZWdtZW50RG93bmxvYWREZWxheSA8PSAwKSB7XG4gICAgICAgICAgICAvLyBDb25kaXRpb24gM2E6IEl0IHRvb2sgYXQgbGVhc3QgYXMgbG9uZyBhcyB0aGUgZHVyYXRpb24gb2YgYSBzZWdtZW50IChpLmUuIHRoZSBhbW91bnQgb2YgdGltZSBpdCB3b3VsZCB0YWtlXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIHRvIHBsYXkgYSBnaXZlbiBzZWdtZW50KSB0byBkb3dubG9hZCB0aGUgcHJldmlvdXMgc2VnbWVudC5cbiAgICAgICAgICAgIC8vIFJlc3BvbnNlOiBEb3dubG9hZCB0aGUgc2VnbWVudCB0aGF0IHdvdWxkIGltbWVkaWF0ZWx5IGZvbGxvdyB0aGUgZW5kIG9mIHRoZSBidWZmZXIgKHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50XG4gICAgICAgICAgICAvLyAgICAgICAgICAgdGltZSkgcmlnaHQgbm93LlxuICAgICAgICAgICAgc2VsZi5fX2xvYWRTZWdtZW50QXRUaW1lKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQ29uZGl0aW9uIDNiOiBEb3dubG9hZGluZyB0aGUgcHJldmlvdXMgc2VnbWVudCB0b29rIGxlc3MgdGltZSB0aGFuIHRoZSBkdXJhdGlvbiBvZiBhIHNlZ21lbnQgKGkuZS4gdGhlIGFtb3VudFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICBvZiB0aW1lIGl0IHdvdWxkIHRha2UgdG8gcGxheSBhIGdpdmVuIHNlZ21lbnQpLlxuICAgICAgICAgICAgLy8gUmVzcG9uc2U6IERvd25sb2FkIHRoZSBzZWdtZW50IHRoYXQgd291bGQgaW1tZWRpYXRlbHkgZm9sbG93IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciAocmVsYXRpdmUgdG8gdGhlIGN1cnJlbnRcbiAgICAgICAgICAgIC8vICAgICAgICAgICB0aW1lKSwgYnV0IHdhaXQgdG8gZG93bmxvYWQgYXQgdGhlIHJhdGUgb2YgcGxheWJhY2sgKHNlZ21lbnQgZHVyYXRpb24gLSB0aW1lIHRvIGRvd25sb2FkKS5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCk7XG4gICAgICAgICAgICAgICAgY3VycmVudEJ1ZmZlclNpemUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWUuZGV0ZXJtaW5lQW1vdW50QnVmZmVyZWRGcm9tVGltZShjdXJyZW50VGltZSk7XG4gICAgICAgICAgICAgICAgZG93bmxvYWRQb2ludCA9IChjdXJyZW50VGltZSArIGN1cnJlbnRCdWZmZXJTaXplKSArIChzZWdtZW50RHVyYXRpb24gLyAyKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ29uZGl0aW9uIDQgKGRlZmF1bHQpOiBUaGUgYnVmZmVyIGhhcyBhdCBsZWFzdCB0aGUgbWF4IGRlc2lyZWQgYnVmZmVyIHNpemUgaW4gaXQgb3Igbm9uZSBvZiB0aGUgYWZvcmVtZW50aW9uZWRcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgICAgICAgICBjb25kaXRpb25zIHdlcmUgbWV0LlxuICAgICAgICAvLyBSZXNwb25zZTogV2FpdCBhIHdoaWxlIGFuZCB0aGVuIHRyaWdnZXIgYW4gZXZlbnQgbm90aWZ5aW5nIHRoYXQgKGlmIGFueW9uZSdzIGxpc3RlbmluZykgd2Ugc2hvdWxkIHJlY2hlY2sgdG9cbiAgICAgICAgLy8gICAgICAgICAgIHNlZSBpZiBjb25kaXRpb25zIGhhdmUgY2hhbmdlZC5cbiAgICAgICAgZGVmZXJyZWRSZWNoZWNrTm90aWZpY2F0aW9uKCk7XG4gICAgfVxufTtcblxuTWVkaWFUeXBlTG9hZGVyLnByb3RvdHlwZS5fX2xvYWRTZWdtZW50QXRUaW1lID0gZnVuY3Rpb24gbG9hZFNlZ21lbnRBdFRpbWUocHJlc2VudGF0aW9uVGltZSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExvYWRlciA9IHNlbGYuX19zZWdtZW50TG9hZGVyLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLFxuICAgICAgICBoYXNOZXh0U2VnbWVudCA9IHNlZ21lbnRMb2FkZXIubG9hZFNlZ21lbnRBdFRpbWUocHJlc2VudGF0aW9uVGltZSk7XG5cbiAgICBpZiAoIWhhc05leHRTZWdtZW50KSB7IHJldHVybiBoYXNOZXh0U2VnbWVudDsgfVxuXG4gICAgc2VnbWVudExvYWRlci5vbmUoc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIGZ1bmN0aW9uIHNlZ21lbnRMb2FkZWRIYW5kbGVyKGV2ZW50KSB7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5vbmUoc291cmNlQnVmZmVyRGF0YVF1ZXVlLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChNZWRpYVR5cGVMb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gTWVkaWFUeXBlTG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBTZWdtZW50TG9hZGVyID0gcmVxdWlyZSgnLi9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzJyksXG4gICAgU291cmNlQnVmZmVyRGF0YVF1ZXVlID0gcmVxdWlyZSgnLi9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzJyksXG4gICAgTWVkaWFUeXBlTG9hZGVyID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVMb2FkZXIuanMnKSxcbiAgICBzZWxlY3RTZWdtZW50TGlzdCA9IHJlcXVpcmUoJy4vc2VsZWN0U2VnbWVudExpc3QuanMnKSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NZWRpYVR5cGVzLmpzJyk7XG5cbi8vIFRPRE86IE1pZ3JhdGUgbWV0aG9kcyBiZWxvdyB0byBhIGZhY3RvcnkuXG5mdW5jdGlvbiBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKSB7XG4gICAgdmFyIHNvdXJjZUJ1ZmZlclR5cGUgPSBtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKS5nZXRTb3VyY2VCdWZmZXJUeXBlKCksXG4gICAgICAgIC8vIFRPRE86IFRyeS9jYXRjaCBibG9jaz9cbiAgICAgICAgc291cmNlQnVmZmVyID0gbWVkaWFTb3VyY2UuYWRkU291cmNlQnVmZmVyKHNvdXJjZUJ1ZmZlclR5cGUpO1xuICAgIHJldHVybiBuZXcgU291cmNlQnVmZmVyRGF0YVF1ZXVlKHNvdXJjZUJ1ZmZlcik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU1lZGlhVHlwZUxvYWRlckZvclR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlLCB0ZWNoKSB7XG4gICAgdmFyIHNlZ21lbnRMb2FkZXIgPSBuZXcgU2VnbWVudExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhVHlwZSksXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUpO1xuICAgIHJldHVybiBuZXcgTWVkaWFUeXBlTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlLCB0ZWNoKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWVkaWFUeXBlTG9hZGVycyhtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKSB7XG4gICAgdmFyIG1hdGNoZWRUeXBlcyA9IG1lZGlhVHlwZXMuZmlsdGVyKGZ1bmN0aW9uKG1lZGlhVHlwZSkge1xuICAgICAgICAgICAgdmFyIGV4aXN0cyA9IGV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSk7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3RzOyB9KSxcbiAgICAgICAgbWVkaWFUeXBlTG9hZGVycyA9IG1hdGNoZWRUeXBlcy5tYXAoZnVuY3Rpb24obWVkaWFUeXBlKSB7IHJldHVybiBjcmVhdGVNZWRpYVR5cGVMb2FkZXJGb3JUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSwgdGVjaCk7IH0pO1xuICAgIHJldHVybiBtZWRpYVR5cGVMb2FkZXJzO1xufVxuXG5mdW5jdGlvbiBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xuICAgIHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzID0gY3JlYXRlTWVkaWFUeXBlTG9hZGVycyhtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcblxuICAgIHRoaXMuX19tZWRpYVR5cGVMb2FkZXJzLmZvckVhY2goZnVuY3Rpb24obWVkaWFUeXBlTG9hZGVyKSB7XG4gICAgICAgIC8vIE1lZGlhU2V0LXNwZWNpZmljIHZhcmlhYmxlc1xuICAgICAgICB2YXIgc2VnbWVudExvYWRlciA9IG1lZGlhVHlwZUxvYWRlci5nZXRTZWdtZW50TG9hZGVyKCksXG4gICAgICAgICAgICBkb3dubG9hZFJhdGVSYXRpbyA9IDEuMCxcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgICAgICBtZWRpYVR5cGUgPSBtZWRpYVR5cGVMb2FkZXIuZ2V0TWVkaWFUeXBlKCk7XG5cbiAgICAgICAgLy8gVE9ETzogQ3VycmVudGx5IGFuIGV2ZW50IGFkZCBvcmRlciBkZXBlbmRlbmN5LiBSZWZhY3RvciBNZWRpYVR5cGVMb2FkZXIgJiBQbGF5bGlzdExvYWRlciB0byBjaGFuZ2UgdGhpcz9cbiAgICAgICAgbWVkaWFUeXBlTG9hZGVyLm9uKG1lZGlhVHlwZUxvYWRlci5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgbWVkaWFTZXQgPSBtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSxcbiAgICAgICAgICAgICAgICBpc0Z1bGxzY3JlZW4gPSB0ZWNoLnBsYXllcigpLmlzRnVsbHNjcmVlbigpLFxuICAgICAgICAgICAgICAgIGRhdGEgPSB7fSxcbiAgICAgICAgICAgICAgICBzZWxlY3RlZFNlZ21lbnRMaXN0O1xuXG4gICAgICAgICAgICBkYXRhLmRvd25sb2FkUmF0ZVJhdGlvID0gZG93bmxvYWRSYXRlUmF0aW87XG4gICAgICAgICAgICBkYXRhLmN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcbiAgICAgICAgICAgIGRhdGEud2lkdGggPSBpc0Z1bGxzY3JlZW4gPyB3aW5kb3cuc2NyZWVuLndpZHRoIDogdGVjaC5wbGF5ZXIoKS53aWR0aCgpO1xuICAgICAgICAgICAgZGF0YS5oZWlnaHQgPSBpc0Z1bGxzY3JlZW4gPyB3aW5kb3cuc2NyZWVuLmhlaWdodCA6IHRlY2gucGxheWVyKCkuaGVpZ2h0KCk7XG5cbiAgICAgICAgICAgIHNlbGVjdGVkU2VnbWVudExpc3QgPSBzZWxlY3RTZWdtZW50TGlzdChtZWRpYVNldCwgZGF0YSk7XG5cbiAgICAgICAgICAgIC8vIFRPRE86IFNob3VsZCB3ZSByZWZhY3RvciB0byBzZXQgYmFzZWQgb24gc2VnbWVudExpc3QgaW5zdGVhZD9cbiAgICAgICAgICAgIHNlZ21lbnRMb2FkZXIuc2V0Q3VycmVudEJhbmR3aWR0aChzZWxlY3RlZFNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgc2VnbWVudExvYWRlci5vbihzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGRvd25sb2FkUmF0ZVJhdGlvID0gZXZlbnQuZGF0YS5wbGF5YmFja1RpbWUgLyBldmVudC5kYXRhLnJ0dDtcbiAgICAgICAgICAgIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCA9IGV2ZW50LmRhdGEuYmFuZHdpZHRoO1xuICAgICAgICB9KTtcblxuICAgICAgICBtZWRpYVR5cGVMb2FkZXIuc3RhcnRMb2FkaW5nU2VnbWVudHMoKTtcbiAgICB9KTtcblxuICAgIHZhciBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHMgPSBbJ3NlZWtpbmcnLCAnY2FucGxheScsICdjYW5wbGF5dGhyb3VnaCddO1xuICAgIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50VHlwZSkge1xuICAgICAgICB0ZWNoLm9uKGV2ZW50VHlwZSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciByZWFkeVN0YXRlID0gdGVjaC5lbCgpLnJlYWR5U3RhdGUsXG4gICAgICAgICAgICAgICAgcGxheWJhY2tSYXRlID0gKHJlYWR5U3RhdGUgPT09IDQpID8gMSA6IDA7XG4gICAgICAgICAgICB0ZWNoLnNldFBsYXliYWNrUmF0ZShwbGF5YmFja1JhdGUpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS5NZWRpYVNvdXJjZSxcbiAgICBNYW5pZmVzdENvbnRyb2xsZXIgPSByZXF1aXJlKCcuL21hbmlmZXN0L01hbmlmZXN0Q29udHJvbGxlci5qcycpLFxuICAgIFBsYXlsaXN0TG9hZGVyID0gcmVxdWlyZSgnLi9QbGF5bGlzdExvYWRlci5qcycpO1xuXG4vLyBUT0RPOiBESVNQT1NFIE1FVEhPRFxuXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWFuaWZlc3RDb250cm9sbGVyID0gbmV3IE1hbmlmZXN0Q29udHJvbGxlcihzb3VyY2Uuc3JjLCBmYWxzZSk7XG5cbiAgICBtYW5pZmVzdENvbnRyb2xsZXIubG9hZChmdW5jdGlvbihtYW5pZmVzdCkge1xuICAgICAgICB2YXIgbWVkaWFTb3VyY2UgPSBuZXcgTWVkaWFTb3VyY2UoKSxcbiAgICAgICAgICAgIG9wZW5MaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAgICAgbWVkaWFTb3VyY2UucmVtb3ZlRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19wbGF5bGlzdExvYWRlciA9IG5ldyBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuXG4gICAgICAgIC8vIFRPRE86IEhhbmRsZSBjbG9zZS5cbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCd3ZWJraXRzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuICAgICAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG5cbiAgICAgICAgdGVjaC5zZXRTcmMoVVJMLmNyZWF0ZU9iamVjdFVSTChtZWRpYVNvdXJjZSkpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUhhbmRsZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICB1dGlsID0gcmVxdWlyZSgnLi91dGlsLmpzJyksXG4gICAgcGFyc2VSb290VXJsID0gdXRpbC5wYXJzZVJvb3RVcmwsXG4gICAgY3JlYXRlTXBkT2JqZWN0LFxuICAgIGNyZWF0ZVBlcmlvZE9iamVjdCxcbiAgICBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0LFxuICAgIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0LFxuICAgIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSxcbiAgICBnZXRNcGQsXG4gICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSxcbiAgICBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLFxuICAgIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lO1xuXG4vLyBUT0RPOiBTaG91bGQgdGhpcyBleGlzdCBvbiBtcGQgZGF0YXZpZXcgb3IgYXQgYSBoaWdoZXIgbGV2ZWw/XG4vLyBUT0RPOiBSZWZhY3Rvci4gQ291bGQgYmUgbW9yZSBlZmZpY2llbnQgKFJlY3Vyc2l2ZSBmbj8gVXNlIGVsZW1lbnQuZ2V0RWxlbWVudHNCeU5hbWUoJ0Jhc2VVcmwnKVswXT8pLlxuLy8gVE9ETzogQ3VycmVudGx5IGFzc3VtaW5nICpFSVRIRVIqIDxCYXNlVVJMPiBub2RlcyB3aWxsIHByb3ZpZGUgYW4gYWJzb2x1dGUgYmFzZSB1cmwgKGllIHJlc29sdmUgdG8gJ2h0dHA6Ly8nIGV0Yylcbi8vIFRPRE86ICpPUiogd2Ugc2hvdWxkIHVzZSB0aGUgYmFzZSB1cmwgb2YgdGhlIGhvc3Qgb2YgdGhlIE1QRCBtYW5pZmVzdC5cbnZhciBidWlsZEJhc2VVcmwgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgdmFyIGVsZW1IaWVyYXJjaHkgPSBbeG1sTm9kZV0uY29uY2F0KHhtbGZ1bi5nZXRBbmNlc3RvcnMoeG1sTm9kZSkpLFxuICAgICAgICBmb3VuZExvY2FsQmFzZVVybCA9IGZhbHNlO1xuICAgIC8vdmFyIGJhc2VVcmxzID0gXy5tYXAoZWxlbUhpZXJhcmNoeSwgZnVuY3Rpb24oZWxlbSkge1xuICAgIHZhciBiYXNlVXJscyA9IGVsZW1IaWVyYXJjaHkubWFwKGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKGZvdW5kTG9jYWxCYXNlVXJsKSB7IHJldHVybiAnJzsgfVxuICAgICAgICBpZiAoIWVsZW0uaGFzQ2hpbGROb2RlcygpKSB7IHJldHVybiAnJzsgfVxuICAgICAgICB2YXIgY2hpbGQ7XG4gICAgICAgIGZvciAodmFyIGk9MDsgaTxlbGVtLmNoaWxkTm9kZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNoaWxkID0gZWxlbS5jaGlsZE5vZGVzLml0ZW0oaSk7XG4gICAgICAgICAgICBpZiAoY2hpbGQubm9kZU5hbWUgPT09ICdCYXNlVVJMJykge1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0RWxlbSA9IGNoaWxkLmNoaWxkTm9kZXMuaXRlbSgwKTtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dFZhbHVlID0gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgICAgICBpZiAodGV4dFZhbHVlLmluZGV4T2YoJ2h0dHA6Ly8nKSA9PT0gMCkgeyBmb3VuZExvY2FsQmFzZVVybCA9IHRydWU7IH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAnJztcbiAgICB9KTtcblxuICAgIHZhciBiYXNlVXJsID0gYmFzZVVybHMucmV2ZXJzZSgpLmpvaW4oJycpO1xuICAgIGlmICghYmFzZVVybCkgeyByZXR1cm4gcGFyc2VSb290VXJsKHhtbE5vZGUuYmFzZVVSSSk7IH1cbiAgICByZXR1cm4gYmFzZVVybDtcbn07XG5cbnZhciBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzID0gW1xuICAgICdBZGFwdGF0aW9uU2V0JyxcbiAgICAnUmVwcmVzZW50YXRpb24nLFxuICAgICdTdWJSZXByZXNlbnRhdGlvbidcbl07XG5cbnZhciBoYXNDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzLmluZGV4T2YoZWxlbS5ub2RlTmFtZSkgPj0gMDtcbn07XG5cbnZhciBkb2VzbnRIYXZlQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gIWhhc0NvbW1vblByb3BlcnRpZXMoZWxlbSk7XG59O1xuXG4vLyBDb21tb24gQXR0cnNcbnZhciBnZXRXaWR0aCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnd2lkdGgnKSxcbiAgICBnZXRIZWlnaHQgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2hlaWdodCcpLFxuICAgIGdldEZyYW1lUmF0ZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnZnJhbWVSYXRlJyksXG4gICAgZ2V0TWltZVR5cGUgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ21pbWVUeXBlJyksXG4gICAgZ2V0Q29kZWNzID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdjb2RlY3MnKTtcblxudmFyIGdldFNlZ21lbnRUZW1wbGF0ZVhtbCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQoJ1NlZ21lbnRUZW1wbGF0ZScsIGRvZXNudEhhdmVDb21tb25Qcm9wZXJ0aWVzKTtcblxuLy8gTVBEIEF0dHIgZm5zXG52YXIgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24nKSxcbiAgICBnZXRUeXBlID0geG1sZnVuLmdldEF0dHJGbigndHlwZScpLFxuICAgIGdldE1pbmltdW1VcGRhdGVQZXJpb2QgPSB4bWxmdW4uZ2V0QXR0ckZuKCdtaW5pbXVtVXBkYXRlUGVyaW9kJyk7XG5cbi8vIFJlcHJlc2VudGF0aW9uIEF0dHIgZm5zXG52YXIgZ2V0SWQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdpZCcpLFxuICAgIGdldEJhbmR3aWR0aCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2JhbmR3aWR0aCcpO1xuXG4vLyBTZWdtZW50VGVtcGxhdGUgQXR0ciBmbnNcbnZhciBnZXRJbml0aWFsaXphdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2luaXRpYWxpemF0aW9uJyksXG4gICAgZ2V0TWVkaWEgPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYScpLFxuICAgIGdldER1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignZHVyYXRpb24nKSxcbiAgICBnZXRUaW1lc2NhbGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0aW1lc2NhbGUnKSxcbiAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0ID0geG1sZnVuLmdldEF0dHJGbigncHJlc2VudGF0aW9uVGltZU9mZnNldCcpLFxuICAgIGdldFN0YXJ0TnVtYmVyID0geG1sZnVuLmdldEF0dHJGbignc3RhcnROdW1iZXInKTtcblxuLy8gVE9ETzogUmVwZWF0IGNvZGUuIEFic3RyYWN0IGF3YXkgKFByb3RvdHlwYWwgSW5oZXJpdGFuY2UvT08gTW9kZWw/IE9iamVjdCBjb21wb3NlciBmbj8pXG5jcmVhdGVNcGRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFBlcmlvZHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgeG1sTm9kZSksXG4gICAgICAgIGdldE1pbmltdW1VcGRhdGVQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW5pbXVtVXBkYXRlUGVyaW9kLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVQZXJpb2RPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXRzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZTogZnVuY3Rpb24odHlwZSkge1xuICAgICAgICAgICAgcmV0dXJuIGdldEFkYXB0YXRpb25TZXRCeVR5cGUodHlwZSwgeG1sTm9kZSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KVxuICAgIH07XG59O1xuXG5jcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRSZXByZXNlbnRhdGlvbnM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUmVwcmVzZW50YXRpb24nLCBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCksXG4gICAgICAgIGdldFNlZ21lbnRUZW1wbGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudFRlbXBsYXRlKGdldFNlZ21lbnRUZW1wbGF0ZVhtbCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SWQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJZCwgeG1sTm9kZSksXG4gICAgICAgIGdldFdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0V2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRGcmFtZVJhdGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRGcmFtZVJhdGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRDb2RlY3M6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRDb2RlY3MsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYXNlVXJsOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oYnVpbGRCYXNlVXJsLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWltZVR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW1lVHlwZSwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudFRlbXBsYXRlID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEluaXRpYWxpemF0aW9uLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWVkaWE6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNZWRpYSwgeG1sTm9kZSksXG4gICAgICAgIGdldER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RHVyYXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRUaW1lc2NhbGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUaW1lc2NhbGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCwgeG1sTm9kZSksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXIsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbi8vIFRPRE86IENoYW5nZSB0aGlzIGFwaSB0byByZXR1cm4gYSBsaXN0IG9mIGFsbCBtYXRjaGluZyBhZGFwdGF0aW9uIHNldHMgdG8gYWxsb3cgZm9yIGdyZWF0ZXIgZmxleGliaWxpdHkuXG5nZXRBZGFwdGF0aW9uU2V0QnlUeXBlID0gZnVuY3Rpb24odHlwZSwgcGVyaW9kWG1sKSB7XG4gICAgdmFyIGFkYXB0YXRpb25TZXRzID0gcGVyaW9kWG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKCdBZGFwdGF0aW9uU2V0JyksXG4gICAgICAgIGFkYXB0YXRpb25TZXQsXG4gICAgICAgIHJlcHJlc2VudGF0aW9uLFxuICAgICAgICBtaW1lVHlwZTtcblxuICAgIGZvciAodmFyIGk9MDsgaTxhZGFwdGF0aW9uU2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBhZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldHMuaXRlbShpKTtcbiAgICAgICAgLy8gU2luY2UgdGhlIG1pbWVUeXBlIGNhbiBiZSBkZWZpbmVkIG9uIHRoZSBBZGFwdGF0aW9uU2V0IG9yIG9uIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZCBub2RlcyxcbiAgICAgICAgLy8gY2hlY2sgZm9yIG1pbWV0eXBlIG9uIG9uZSBvZiBpdHMgUmVwcmVzZW50YXRpb24gY2hpbGRyZW4gdXNpbmcgZ2V0TWltZVR5cGUoKSwgd2hpY2ggYXNzdW1lcyB0aGVcbiAgICAgICAgLy8gbWltZVR5cGUgY2FuIGJlIGluaGVyaXRlZCBhbmQgd2lsbCBjaGVjayBpdHNlbGYgYW5kIGl0cyBhbmNlc3RvcnMgZm9yIHRoZSBhdHRyLlxuICAgICAgICByZXByZXNlbnRhdGlvbiA9IGFkYXB0YXRpb25TZXQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ1JlcHJlc2VudGF0aW9uJylbMF07XG4gICAgICAgIC8vIE5lZWQgdG8gY2hlY2sgdGhlIHJlcHJlc2VudGF0aW9uIGluc3RlYWQgb2YgdGhlIGFkYXB0YXRpb24gc2V0LCBzaW5jZSB0aGUgbWltZVR5cGUgbWF5IG5vdCBiZSBzcGVjaWZpZWRcbiAgICAgICAgLy8gb24gdGhlIGFkYXB0YXRpb24gc2V0IGF0IGFsbCBhbmQgbWF5IGJlIHNwZWNpZmllZCBmb3IgZWFjaCBvZiB0aGUgcmVwcmVzZW50YXRpb25zIGluc3RlYWQuXG4gICAgICAgIG1pbWVUeXBlID0gZ2V0TWltZVR5cGUocmVwcmVzZW50YXRpb24pO1xuICAgICAgICBpZiAoISFtaW1lVHlwZSAmJiBtaW1lVHlwZS5pbmRleE9mKHR5cGUpID49IDApIHsgcmV0dXJuIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QoYWRhcHRhdGlvblNldCk7IH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn07XG5cbmdldE1wZCA9IGZ1bmN0aW9uKG1hbmlmZXN0WG1sKSB7XG4gICAgcmV0dXJuIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUobWFuaWZlc3RYbWwsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpWzBdO1xufTtcblxuLy8gVE9ETzogTW92ZSB0byB4bWxmdW4gb3Igb3duIG1vZHVsZS5cbmdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUgPSBmdW5jdGlvbihwYXJlbnRYbWwsIHRhZ05hbWUsIG1hcEZuKSB7XG4gICAgdmFyIGRlc2NlbmRhbnRzWG1sQXJyYXkgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChwYXJlbnRYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUodGFnTmFtZSkpO1xuICAgIC8qaWYgKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykgeyByZXR1cm4gZGVzY2VuZGFudHNYbWxBcnJheS5tYXAobWFwRm4pOyB9Ki9cbiAgICBpZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHZhciBtYXBwZWRFbGVtID0gZGVzY2VuZGFudHNYbWxBcnJheS5tYXAobWFwRm4pO1xuICAgICAgICByZXR1cm4gIG1hcHBlZEVsZW07XG4gICAgfVxuICAgIHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5O1xufTtcblxuLy8gVE9ETzogTW92ZSB0byB4bWxmdW4gb3Igb3duIG1vZHVsZS5cbmdldEFuY2VzdG9yT2JqZWN0QnlOYW1lID0gZnVuY3Rpb24oeG1sTm9kZSwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICBpZiAoIXRhZ05hbWUgfHwgIXhtbE5vZGUgfHwgIXhtbE5vZGUucGFyZW50Tm9kZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIGlmICgheG1sTm9kZS5wYXJlbnROb2RlLmhhc093blByb3BlcnR5KCdub2RlTmFtZScpKSB7IHJldHVybiBudWxsOyB9XG5cbiAgICBpZiAoeG1sTm9kZS5wYXJlbnROb2RlLm5vZGVOYW1lID09PSB0YWdOYW1lKSB7XG4gICAgICAgIHJldHVybiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSA/IG1hcEZuKHhtbE5vZGUucGFyZW50Tm9kZSkgOiB4bWxOb2RlLnBhcmVudE5vZGU7XG4gICAgfVxuICAgIHJldHVybiBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSh4bWxOb2RlLnBhcmVudE5vZGUsIHRhZ05hbWUsIG1hcEZuKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0TXBkOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCxcbiAgICAvLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBTRUNPTkRTX0lOX1lFQVIgPSAzNjUgKiAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NT05USCA9IDMwICogMjQgKiA2MCAqIDYwLCAvLyBub3QgcHJlY2lzZSFcbiAgICBTRUNPTkRTX0lOX0RBWSA9IDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX0hPVVIgPSA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTUlOID0gNjAsXG4gICAgTUlOVVRFU19JTl9IT1VSID0gNjAsXG4gICAgTUlMTElTRUNPTkRTX0lOX1NFQ09ORFMgPSAxMDAwLFxuICAgIGR1cmF0aW9uUmVnZXggPSAvXlAoKFtcXGQuXSopWSk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilEKT9UPygoW1xcZC5dKilIKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKVMpPy87XG5cbnBhcnNlUm9vdFVybCA9IGZ1bmN0aW9uKHVybCkge1xuICAgIGlmICh0eXBlb2YgdXJsICE9PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCcvJykgPT09IC0xKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJz8nKSAhPT0gLTEpIHtcbiAgICAgICAgdXJsID0gdXJsLnN1YnN0cmluZygwLCB1cmwuaW5kZXhPZignPycpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdXJsLnN1YnN0cmluZygwLCB1cmwubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufTtcblxuLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAvL3N0ciA9IFwiUDEwWTEwTTEwRFQxMEgxME0xMC4xU1wiO1xuICAgIHZhciBtYXRjaCA9IGR1cmF0aW9uUmVnZXguZXhlYyhzdHIpO1xuICAgIHJldHVybiAocGFyc2VGbG9hdChtYXRjaFsyXSB8fCAwKSAqIFNFQ09ORFNfSU5fWUVBUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNF0gfHwgMCkgKiBTRUNPTkRTX0lOX01PTlRIICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs2XSB8fCAwKSAqIFNFQ09ORFNfSU5fREFZICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs4XSB8fCAwKSAqIFNFQ09ORFNfSU5fSE9VUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTBdIHx8IDApICogU0VDT05EU19JTl9NSU4gK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEyXSB8fCAwKSk7XG59O1xuXG52YXIgdXRpbCA9IHtcbiAgICBwYXJzZVJvb3RVcmw6IHBhcnNlUm9vdFVybCxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvblxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB1dGlsOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgc2VnbWVudFRlbXBsYXRlID0gcmVxdWlyZSgnLi9zZWdtZW50VGVtcGxhdGUnKSxcbiAgICBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSxcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSxcbiAgICBnZXRUeXBlLFxuICAgIGdldEJhbmR3aWR0aCxcbiAgICBnZXRXaWR0aCxcbiAgICBnZXRIZWlnaHQsXG4gICAgZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsXG4gICAgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsXG4gICAgZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlO1xuXG5nZXRUeXBlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgY29kZWNTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRDb2RlY3MoKTtcbiAgICB2YXIgdHlwZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1pbWVUeXBlKCk7XG5cbiAgICAvL05PVEU6IExFQURJTkcgWkVST1MgSU4gQ09ERUMgVFlQRS9TVUJUWVBFIEFSRSBURUNITklDQUxMWSBOT1QgU1BFQyBDT01QTElBTlQsIEJVVCBHUEFDICYgT1RIRVJcbiAgICAvLyBEQVNIIE1QRCBHRU5FUkFUT1JTIFBST0RVQ0UgVEhFU0UgTk9OLUNPTVBMSUFOVCBWQUxVRVMuIEhBTkRMSU5HIEhFUkUgRk9SIE5PVy5cbiAgICAvLyBTZWU6IFJGQyA2MzgxIFNlYy4gMy40IChodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjM4MSNzZWN0aW9uLTMuNClcbiAgICB2YXIgcGFyc2VkQ29kZWMgPSBjb2RlY1N0ci5zcGxpdCgnLicpLm1hcChmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eMCsoPyFcXC58JCkvLCAnJyk7XG4gICAgfSk7XG4gICAgdmFyIHByb2Nlc3NlZENvZGVjU3RyID0gcGFyc2VkQ29kZWMuam9pbignLicpO1xuXG4gICAgcmV0dXJuICh0eXBlU3RyICsgJztjb2RlY3M9XCInICsgcHJvY2Vzc2VkQ29kZWNTdHIgKyAnXCInKTtcbn07XG5cbmdldEJhbmR3aWR0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGJhbmR3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKSA/IE51bWJlcihiYW5kd2lkdGgpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0V2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciB3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldFdpZHRoKCk7XG4gICAgcmV0dXJuIGV4aXN0eSh3aWR0aCkgPyBOdW1iZXIod2lkdGgpIDogdW5kZWZpbmVkO1xufTtcblxuZ2V0SGVpZ2h0ID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgaGVpZ2h0ID0gcmVwcmVzZW50YXRpb24uZ2V0SGVpZ2h0KCk7XG4gICAgcmV0dXJuIGV4aXN0eShoZWlnaHQpID8gTnVtYmVyKGhlaWdodCkgOiB1bmRlZmluZWQ7XG59O1xuXG5nZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAvLyBUT0RPOiBTdXBwb3J0IHBlcmlvZC1yZWxhdGl2ZSBwcmVzZW50YXRpb24gdGltZVxuICAgIHZhciBtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbigpLFxuICAgICAgICBwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gTnVtYmVyKHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbihtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSksXG4gICAgICAgIHByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCgpKTtcbiAgICByZXR1cm4gTnVtYmVyKHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gLSBwcmVzZW50YXRpb25UaW1lT2Zmc2V0KTtcbn07XG5cbmdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpO1xuICAgIHJldHVybiBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldER1cmF0aW9uKCkpIC8gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXRUaW1lc2NhbGUoKSk7XG59O1xuXG5nZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE1hdGguY2VpbChnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAvIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xufTtcblxuZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0U3RhcnROdW1iZXIoKSk7XG59O1xuXG5nZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgKyBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLSAxO1xufTtcblxuY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTZWdtZW50RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxTZWdtZW50Q291bnQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEVuZE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICAvLyBUT0RPOiBFeHRlcm5hbGl6ZVxuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgaW5pdGlhbGl6YXRpb24gPSB7fTtcbiAgICAgICAgICAgIGluaXRpYWxpemF0aW9uLmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgICAgICAgICByZXByZXNlbnRhdGlvbklkID0gcmVwcmVzZW50YXRpb24uZ2V0SWQoKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0SW5pdGlhbGl6YXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uSWQpO1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlVXJsICsgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXR1cm4gaW5pdGlhbGl6YXRpb247XG4gICAgICAgIH0sXG4gICAgICAgIGdldFNlZ21lbnRCeU51bWJlcjogZnVuY3Rpb24obnVtYmVyKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVRpbWU6IGZ1bmN0aW9uKHNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUocmVwcmVzZW50YXRpb24sIHNlY29uZHMpOyB9XG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlciA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpIHtcbiAgICB2YXIgc2VnbWVudCA9IHt9O1xuICAgIHNlZ21lbnQuZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRNZWRpYSgpLFxuICAgICAgICAgICAgcmVwbGFjZWRJZFVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24uZ2V0SWQoKSksXG4gICAgICAgICAgICAvLyBUT0RPOiBTaW5jZSAkVGltZSQtdGVtcGxhdGVkIHNlZ21lbnQgVVJMcyBzaG91bGQgb25seSBleGlzdCBpbiBjb25qdW5jdGlvbiB3L2EgPFNlZ21lbnRUaW1lbGluZT4sXG4gICAgICAgICAgICAvLyBUT0RPOiBjYW4gY3VycmVudGx5IGFzc3VtZSBhICROdW1iZXIkLWJhc2VkIHRlbXBsYXRlZCB1cmwuXG4gICAgICAgICAgICAvLyBUT0RPOiBFbmZvcmNlIG1pbi9tYXggbnVtYmVyIHJhbmdlIChiYXNlZCBvbiBzZWdtZW50TGlzdCBzdGFydE51bWJlciAmIGVuZE51bWJlcilcbiAgICAgICAgICAgIHJlcGxhY2VkTnVtYmVyVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkSWRVcmwsICdOdW1iZXInLCBudW1iZXIpO1xuICAgICAgICByZXR1cm4gYmFzZVVybCArIHJlcGxhY2VkTnVtYmVyVXJsO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG51bWJlciAqIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldER1cmF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIFRPRE86IFZlcmlmeVxuICAgICAgICB2YXIgc3RhbmRhcmRTZWdtZW50RHVyYXRpb24gPSBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICAgICAgZHVyYXRpb24sXG4gICAgICAgICAgICBtZWRpYVByZXNlbnRhdGlvblRpbWUsXG4gICAgICAgICAgICBwcmVjaXNpb25NdWx0aXBsaWVyO1xuXG4gICAgICAgIGlmIChnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pID09PSBudW1iZXIpIHtcbiAgICAgICAgICAgIG1lZGlhUHJlc2VudGF0aW9uVGltZSA9IE51bWJlcihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG4gICAgICAgICAgICAvLyBIYW5kbGUgZmxvYXRpbmcgcG9pbnQgcHJlY2lzaW9uIGlzc3VlXG4gICAgICAgICAgICBwcmVjaXNpb25NdWx0aXBsaWVyID0gMTAwMDtcbiAgICAgICAgICAgIGR1cmF0aW9uID0gKCgobWVkaWFQcmVzZW50YXRpb25UaW1lICogcHJlY2lzaW9uTXVsdGlwbGllcikgJSAoc3RhbmRhcmRTZWdtZW50RHVyYXRpb24gKiBwcmVjaXNpb25NdWx0aXBsaWVyKSkgLyBwcmVjaXNpb25NdWx0aXBsaWVyICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkdXJhdGlvbiA9IHN0YW5kYXJkU2VnbWVudER1cmF0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkdXJhdGlvbjtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0TnVtYmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiBudW1iZXI7IH07XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIHNlY29uZHMpIHtcbiAgICB2YXIgc2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgbnVtYmVyID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gc2VnbWVudER1cmF0aW9uKSxcbiAgICAgICAgc2VnbWVudCA9IGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICBpZiAoIXJlcHJlc2VudGF0aW9uKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTsgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNlZ21lbnRUZW1wbGF0ZSxcbiAgICB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTtcblxuemVyb1BhZFRvTGVuZ3RoID0gZnVuY3Rpb24gKG51bVN0ciwgbWluU3RyTGVuZ3RoKSB7XG4gICAgd2hpbGUgKG51bVN0ci5sZW5ndGggPCBtaW5TdHJMZW5ndGgpIHtcbiAgICAgICAgbnVtU3RyID0gJzAnICsgbnVtU3RyO1xuICAgIH1cblxuICAgIHJldHVybiBudW1TdHI7XG59O1xuXG5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdG9rZW4sIHZhbHVlKSB7XG5cbiAgICB2YXIgc3RhcnRQb3MgPSAwLFxuICAgICAgICBlbmRQb3MgPSAwLFxuICAgICAgICB0b2tlbkxlbiA9IHRva2VuLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnID0gJyUwJyxcbiAgICAgICAgZm9ybWF0VGFnTGVuID0gZm9ybWF0VGFnLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnUG9zLFxuICAgICAgICBzcGVjaWZpZXIsXG4gICAgICAgIHdpZHRoLFxuICAgICAgICBwYWRkZWRWYWx1ZTtcblxuICAgIC8vIGtlZXAgbG9vcGluZyByb3VuZCB1bnRpbCBhbGwgaW5zdGFuY2VzIG9mIDx0b2tlbj4gaGF2ZSBiZWVuXG4gICAgLy8gcmVwbGFjZWQuIG9uY2UgdGhhdCBoYXMgaGFwcGVuZWQsIHN0YXJ0UG9zIGJlbG93IHdpbGwgYmUgLTFcbiAgICAvLyBhbmQgdGhlIGNvbXBsZXRlZCB1cmwgd2lsbCBiZSByZXR1cm5lZC5cbiAgICB3aGlsZSAodHJ1ZSkge1xuXG4gICAgICAgIC8vIGNoZWNrIGlmIHRoZXJlIGlzIGEgdmFsaWQgJDx0b2tlbj4uLi4kIGlkZW50aWZpZXJcbiAgICAgICAgLy8gaWYgbm90LCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgc3RhcnRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJyArIHRva2VuKTtcbiAgICAgICAgaWYgKHN0YXJ0UG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhlIG5leHQgJyQnIG11c3QgYmUgdGhlIGVuZCBvZiB0aGUgaWRlbnRpZmVyXG4gICAgICAgIC8vIGlmIHRoZXJlIGlzbid0IG9uZSwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIGVuZFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGVuZFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG5vdyBzZWUgaWYgdGhlcmUgaXMgYW4gYWRkaXRpb25hbCBmb3JtYXQgdGFnIHN1ZmZpeGVkIHRvXG4gICAgICAgIC8vIHRoZSBpZGVudGlmaWVyIHdpdGhpbiB0aGUgZW5jbG9zaW5nICckJyBjaGFyYWN0ZXJzXG4gICAgICAgIGZvcm1hdFRhZ1BvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoZm9ybWF0VGFnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGZvcm1hdFRhZ1BvcyA+IHN0YXJ0UG9zICYmIGZvcm1hdFRhZ1BvcyA8IGVuZFBvcykge1xuXG4gICAgICAgICAgICBzcGVjaWZpZXIgPSB0ZW1wbGF0ZVN0ci5jaGFyQXQoZW5kUG9zIC0gMSk7XG4gICAgICAgICAgICB3aWR0aCA9IHBhcnNlSW50KHRlbXBsYXRlU3RyLnN1YnN0cmluZyhmb3JtYXRUYWdQb3MgKyBmb3JtYXRUYWdMZW4sIGVuZFBvcyAtIDEpLCAxMCk7XG5cbiAgICAgICAgICAgIC8vIHN1cHBvcnQgdGhlIG1pbmltdW0gc3BlY2lmaWVycyByZXF1aXJlZCBieSBJRUVFIDEwMDMuMVxuICAgICAgICAgICAgLy8gKGQsIGkgLCBvLCB1LCB4LCBhbmQgWCkgZm9yIGNvbXBsZXRlbmVzc1xuICAgICAgICAgICAgc3dpdGNoIChzcGVjaWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyB0cmVhdCBhbGwgaW50IHR5cGVzIGFzIHVpbnQsXG4gICAgICAgICAgICAgICAgLy8gaGVuY2UgZGVsaWJlcmF0ZSBmYWxsdGhyb3VnaFxuICAgICAgICAgICAgICAgIGNhc2UgJ2QnOlxuICAgICAgICAgICAgICAgIGNhc2UgJ2knOlxuICAgICAgICAgICAgICAgIGNhc2UgJ3UnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnWCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ28nOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZyg4KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnVW5zdXBwb3J0ZWQvaW52YWxpZCBJRUVFIDEwMDMuMSBmb3JtYXQgaWRlbnRpZmllciBzdHJpbmcgaW4gVVJMJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICB0ZW1wbGF0ZVN0ciA9IHRlbXBsYXRlU3RyLnN1YnN0cmluZygwLCBzdGFydFBvcykgKyBwYWRkZWRWYWx1ZSArIHRlbXBsYXRlU3RyLnN1YnN0cmluZyhlbmRQb3MgKyAxKTtcbiAgICB9XG59O1xuXG51bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckJCcpLmpvaW4oJyQnKTtcbn07XG5cbnJlcGxhY2VJREZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckUmVwcmVzZW50YXRpb25JRCQnKSA9PT0gLTEpIHsgcmV0dXJuIHRlbXBsYXRlU3RyOyB9XG4gICAgdmFyIHYgPSB2YWx1ZS50b1N0cmluZygpO1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJFJlcHJlc2VudGF0aW9uSUQkJykuam9pbih2KTtcbn07XG5cbnNlZ21lbnRUZW1wbGF0ZSA9IHtcbiAgICB6ZXJvUGFkVG9MZW5ndGg6IHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZTogcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZTogdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTogcmVwbGFjZUlERm9yVGVtcGxhdGVcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gc2VnbWVudFRlbXBsYXRlOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV2ZW50TWdyID0gcmVxdWlyZSgnLi9ldmVudE1hbmFnZXIuanMnKSxcbiAgICBldmVudERpc3BhdGNoZXJNaXhpbiA9IHtcbiAgICAgICAgdHJpZ2dlcjogZnVuY3Rpb24oZXZlbnRPYmplY3QpIHsgZXZlbnRNZ3IudHJpZ2dlcih0aGlzLCBldmVudE9iamVjdCk7IH0sXG4gICAgICAgIG9uZTogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbmUodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9uOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvZmY6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub2ZmKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9XG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudERpc3BhdGNoZXJNaXhpbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB2aWRlb2pzID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLnZpZGVvanMsXG4gICAgZXZlbnRNYW5hZ2VyID0ge1xuICAgICAgICB0cmlnZ2VyOiB2aWRlb2pzLnRyaWdnZXIsXG4gICAgICAgIG9uZTogdmlkZW9qcy5vbmUsXG4gICAgICAgIG9uOiB2aWRlb2pzLm9uLFxuICAgICAgICBvZmY6IHZpZGVvanMub2ZmXG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudE1hbmFnZXI7XG4iLCIvKipcbiAqIENyZWF0ZWQgYnkgY3BpbGxzYnVyeSBvbiAxMi8zLzE0LlxuICovXG47KGZ1bmN0aW9uKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciByb290ID0gcmVxdWlyZSgnZ2xvYmFsL3dpbmRvdycpLFxuICAgICAgICB2aWRlb2pzID0gcm9vdC52aWRlb2pzLFxuICAgICAgICBTb3VyY2VIYW5kbGVyID0gcmVxdWlyZSgnLi9Tb3VyY2VIYW5kbGVyJyk7XG5cbiAgICBpZiAoIXZpZGVvanMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgdmlkZW8uanMgbGlicmFyeSBtdXN0IGJlIGluY2x1ZGVkIHRvIHVzZSB0aGlzIE1QRUctREFTSCBzb3VyY2UgaGFuZGxlci4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjYW5IYW5kbGVTb3VyY2Uoc291cmNlKSB7XG4gICAgICAgIC8vIEV4dGVybmFsaXplIGlmIHVzZWQgZWxzZXdoZXJlLiBQb3RlbnRpYWxseSB1c2UgY29uc3RhbnQgZnVuY3Rpb24uXG4gICAgICAgIHZhciBkb2VzbnRIYW5kbGVTb3VyY2UgPSAnJyxcbiAgICAgICAgICAgIG1heWJlSGFuZGxlU291cmNlID0gJ21heWJlJyxcbiAgICAgICAgICAgIGRlZmF1bHRIYW5kbGVTb3VyY2UgPSBkb2VzbnRIYW5kbGVTb3VyY2U7XG5cbiAgICAgICAgLy8gVE9ETzogVXNlIHNhZmVyIHZqcyBjaGVjayAoZS5nLiBoYW5kbGVzIElFIGNvbmRpdGlvbnMpP1xuICAgICAgICAvLyBSZXF1aXJlcyBNZWRpYSBTb3VyY2UgRXh0ZW5zaW9uc1xuICAgICAgICBpZiAoIShyb290Lk1lZGlhU291cmNlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGRvZXNudEhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSB0eXBlIGlzIHN1cHBvcnRlZFxuICAgICAgICBpZiAoL2FwcGxpY2F0aW9uXFwvZGFzaFxcK3htbC8udGVzdChzb3VyY2UudHlwZSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdtYXRjaGVkIHR5cGUnKTtcbiAgICAgICAgICAgIHJldHVybiBtYXliZUhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4dGVuc2lvbiBtYXRjaGVzXG4gICAgICAgIGlmICgvXFwubXBkJC9pLnRlc3Qoc291cmNlLnNyYykpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdtYXRjaGVkIGV4dGVuc2lvbicpO1xuICAgICAgICAgICAgcmV0dXJuIG1heWJlSGFuZGxlU291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlZmF1bHRIYW5kbGVTb3VyY2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGFuZGxlU291cmNlKHNvdXJjZSwgdGVjaCkge1xuICAgICAgICByZXR1cm4gbmV3IFNvdXJjZUhhbmRsZXIoc291cmNlLCB0ZWNoKTtcbiAgICB9XG5cbiAgICAvLyBSZWdpc3RlciB0aGUgc291cmNlIGhhbmRsZXJcbiAgICB2aWRlb2pzLkh0bWw1LnJlZ2lzdGVyU291cmNlSGFuZGxlcih7XG4gICAgICAgIGNhbkhhbmRsZVNvdXJjZTogY2FuSGFuZGxlU291cmNlLFxuICAgICAgICBoYW5kbGVTb3VyY2U6IGhhbmRsZVNvdXJjZVxuICAgIH0sIDApO1xuXG59LmNhbGwodGhpcykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICB0cnV0aHkgPSByZXF1aXJlKCcuLi91dGlsL3RydXRoeS5qcycpLFxuICAgIGlzU3RyaW5nID0gcmVxdWlyZSgnLi4vdXRpbC9pc1N0cmluZy5qcycpLFxuICAgIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBsb2FkTWFuaWZlc3QgPSByZXF1aXJlKCcuL2xvYWRNYW5pZmVzdC5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uID0gcmVxdWlyZSgnLi4vZGFzaC9zZWdtZW50cy9nZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uLmpzJyksXG4gICAgZ2V0TXBkID0gcmVxdWlyZSgnLi4vZGFzaC9tcGQvZ2V0TXBkLmpzJyksXG4gICAgZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbixcbiAgICBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUsXG4gICAgbWVkaWFUeXBlcyA9IHJlcXVpcmUoJy4vTWVkaWFUeXBlcy5qcycpLFxuICAgIERFRkFVTFRfVFlQRSA9IG1lZGlhVHlwZXNbMF07XG5cbmdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSA9IGZ1bmN0aW9uKG1pbWVUeXBlLCB0eXBlcykge1xuICAgIGlmICghaXNTdHJpbmcobWltZVR5cGUpKSB7IHJldHVybiBERUZBVUxUX1RZUEU7IH1cbiAgICB2YXIgbWF0Y2hlZFR5cGUgPSB0eXBlcy5maW5kKGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgICAgcmV0dXJuICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gZXhpc3R5KG1hdGNoZWRUeXBlKSA/IG1hdGNoZWRUeXBlIDogREVGQVVMVF9UWVBFO1xufTtcblxuLy8gVE9ETzogTW92ZSB0byBvd24gbW9kdWxlIGluIGRhc2ggcGFja2FnZSBzb21ld2hlcmVcbmdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24gPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuXG5mdW5jdGlvbiBNYW5pZmVzdChzb3VyY2VVcmksIGF1dG9Mb2FkKSB7XG4gICAgdGhpcy5fX2F1dG9Mb2FkID0gdHJ1dGh5KGF1dG9Mb2FkKTtcbiAgICB0aGlzLnNldFNvdXJjZVVyaShzb3VyY2VVcmkpO1xufVxuXG5NYW5pZmVzdC5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIE1BTklGRVNUX0xPQURFRDogJ21hbmlmZXN0TG9hZGVkJ1xufTtcblxuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0U291cmNlVXJpID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX19zb3VyY2VVcmk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuc2V0U291cmNlVXJpID0gZnVuY3Rpb24gc2V0U291cmNlVXJpKHNvdXJjZVVyaSkge1xuICAgIC8vIFRPRE86ICdleGlzdHkoKScgY2hlY2sgZm9yIGJvdGg/XG4gICAgaWYgKHNvdXJjZVVyaSA9PT0gdGhpcy5fX3NvdXJjZVVyaSkgeyByZXR1cm47IH1cblxuICAgIC8vIFRPRE86IGlzU3RyaW5nKCkgY2hlY2s/ICdleGlzdHkoKScgY2hlY2s/XG4gICAgaWYgKCFzb3VyY2VVcmkpIHtcbiAgICAgICAgdGhpcy5fX2NsZWFyU291cmNlVXJpKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICB0aGlzLl9fc291cmNlVXJpID0gc291cmNlVXJpO1xuICAgIGlmICh0aGlzLl9fYXV0b0xvYWQpIHtcbiAgICAgICAgLy8gVE9ETzogSW1wbCBhbnkgY2xlYW51cCBmdW5jdGlvbmFsaXR5IGFwcHJvcHJpYXRlIGJlZm9yZSBsb2FkLlxuICAgICAgICB0aGlzLmxvYWQoKTtcbiAgICB9XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuX19jbGVhclNvdXJjZVVyaSA9IGZ1bmN0aW9uIGNsZWFyU291cmNlVXJpKCkge1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBudWxsO1xuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIC8vIFRPRE86IGltcGwgYW55IG90aGVyIGNsZWFudXAgZnVuY3Rpb25hbGl0eVxufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbiBsb2FkKC8qIG9wdGlvbmFsICovIGNhbGxiYWNrRm4pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgbG9hZE1hbmlmZXN0KHNlbGYuX19zb3VyY2VVcmksIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgc2VsZi5fX21hbmlmZXN0ID0gZGF0YS5tYW5pZmVzdFhtbDtcbiAgICAgICAgc2VsZi5fX3NldHVwVXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5NQU5JRkVTVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlbGYuX19tYW5pZmVzdH0pO1xuICAgICAgICBpZiAoaXNGdW5jdGlvbihjYWxsYmFja0ZuKSkgeyBjYWxsYmFja0ZuKGRhdGEubWFuaWZlc3RYbWwpOyB9XG4gICAgfSk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCA9IGZ1bmN0aW9uIGNsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCkge1xuICAgIGlmICghZXhpc3R5KHRoaXMuX191cGRhdGVJbnRlcnZhbCkpIHsgcmV0dXJuOyB9XG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLl9fc2V0dXBVcGRhdGVJbnRlcnZhbCA9IGZ1bmN0aW9uIHNldHVwVXBkYXRlSW50ZXJ2YWwoKSB7XG4gICAgaWYgKHRoaXMuX191cGRhdGVJbnRlcnZhbCkgeyBzZWxmLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTsgfVxuICAgIGlmICghdGhpcy5nZXRTaG91bGRVcGRhdGUoKSkgeyByZXR1cm47IH1cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIG1pblVwZGF0ZVJhdGUgPSAyLFxuICAgICAgICB1cGRhdGVSYXRlID0gTWF0aC5tYXgodGhpcy5nZXRVcGRhdGVSYXRlKCksIG1pblVwZGF0ZVJhdGUpO1xuICAgIHRoaXMuX191cGRhdGVJbnRlcnZhbCA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgICBzZWxmLmxvYWQoKTtcbiAgICB9LCB1cGRhdGVSYXRlKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRNZWRpYVNldEJ5VHlwZSA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0QnlUeXBlKHR5cGUpIHtcbiAgICBpZiAobWVkaWFUeXBlcy5pbmRleE9mKHR5cGUpIDwgMCkgeyB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgdHlwZS4gVmFsdWUgbXVzdCBiZSBvbmUgb2Y6ICcgKyBtZWRpYVR5cGVzLmpvaW4oJywgJykpOyB9XG4gICAgdmFyIGFkYXB0YXRpb25TZXRzID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0UGVyaW9kcygpWzBdLmdldEFkYXB0YXRpb25TZXRzKCksXG4gICAgICAgIGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoID0gYWRhcHRhdGlvblNldHMuZmluZChmdW5jdGlvbihhZGFwdGF0aW9uU2V0KSB7XG4gICAgICAgICAgICByZXR1cm4gKGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZShhZGFwdGF0aW9uU2V0LmdldE1pbWVUeXBlKCksIG1lZGlhVHlwZXMpID09PSB0eXBlKTtcbiAgICAgICAgfSk7XG4gICAgaWYgKCFleGlzdHkoYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2gpKSB7IHJldHVybiBudWxsOyB9XG4gICAgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0TWVkaWFTZXRzID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRzKCkge1xuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBtZWRpYVNldHMgPSBhZGFwdGF0aW9uU2V0cy5tYXAoZnVuY3Rpb24oYWRhcHRhdGlvblNldCkgeyByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFTZXRzO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFN0cmVhbVR5cGUgPSBmdW5jdGlvbiBnZXRTdHJlYW1UeXBlKCkge1xuICAgIHZhciBzdHJlYW1UeXBlID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0VHlwZSgpO1xuICAgIHJldHVybiBzdHJlYW1UeXBlO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFVwZGF0ZVJhdGUgPSBmdW5jdGlvbiBnZXRVcGRhdGVSYXRlKCkge1xuICAgIHZhciBtaW5pbXVtVXBkYXRlUGVyaW9kID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCgpO1xuICAgIHJldHVybiBOdW1iZXIobWluaW11bVVwZGF0ZVBlcmlvZCk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0U2hvdWxkVXBkYXRlID0gZnVuY3Rpb24gZ2V0U2hvdWxkVXBkYXRlKCkge1xuICAgIHZhciBpc0R5bmFtaWMgPSAodGhpcy5nZXRTdHJlYW1UeXBlKCkgPT09ICdkeW5hbWljJyksXG4gICAgICAgIGhhc1ZhbGlkVXBkYXRlUmF0ZSA9ICh0aGlzLmdldFVwZGF0ZVJhdGUoKSA+IDApO1xuICAgIHJldHVybiAoaXNEeW5hbWljICYmIGhhc1ZhbGlkVXBkYXRlUmF0ZSk7XG59O1xuXG5leHRlbmRPYmplY3QoTWFuaWZlc3QucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbmZ1bmN0aW9uIE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpIHtcbiAgICAvLyBUT0RPOiBBZGRpdGlvbmFsIGNoZWNrcyAmIEVycm9yIFRocm93aW5nXG4gICAgdGhpcy5fX2FkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0O1xufVxuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0TWVkaWFUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFUeXBlKCkge1xuICAgIHZhciB0eXBlID0gZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKHRoaXMuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcyk7XG4gICAgcmV0dXJuIHR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0TWltZVR5cGUgPSBmdW5jdGlvbiBnZXRNaW1lVHlwZSgpIHtcbiAgICB2YXIgbWltZVR5cGUgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpO1xuICAgIHJldHVybiBtaW1lVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJUeXBlID0gZnVuY3Rpb24gZ2V0U291cmNlQnVmZmVyVHlwZSgpIHtcbiAgICAvLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlIGNvZGVjcyBhc3NvY2lhdGVkIHdpdGggZWFjaCBzdHJlYW0gdmFyaWFudC9yZXByZXNlbnRhdGlvblxuICAgIC8vIHdpbGwgYmUgc2ltaWxhciBlbm91Z2ggdGhhdCB5b3Ugd29uJ3QgaGF2ZSB0byByZS1jcmVhdGUgdGhlIHNvdXJjZS1idWZmZXIgd2hlbiBzd2l0Y2hpbmdcbiAgICAvLyBiZXR3ZWVuIHRoZW0uXG5cbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc291cmNlQnVmZmVyVHlwZSA9IGdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzb3VyY2VCdWZmZXJUeXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsRHVyYXRpb24gPSBmdW5jdGlvbiBnZXRUb3RhbER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpO1xuICAgIHJldHVybiB0b3RhbER1cmF0aW9uO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VG90YWxTZWdtZW50Q291bnQgPSBmdW5jdGlvbiBnZXRUb3RhbFNlZ21lbnRDb3VudCgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxTZWdtZW50Q291bnQgPSBzZWdtZW50TGlzdC5nZXRUb3RhbFNlZ21lbnRDb3VudCgpO1xuICAgIHJldHVybiB0b3RhbFNlZ21lbnRDb3VudDtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50RHVyYXRpb24gPSBmdW5jdGlvbiBnZXRTZWdtZW50RHVyYXRpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnREdXJhdGlvbigpO1xuICAgIHJldHVybiBzZWdtZW50RHVyYXRpb247XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RTdGFydE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBzZWdtZW50TGlzdC5nZXRTdGFydE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0RW5kTnVtYmVyID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHNlZ21lbnRMaXN0RW5kTnVtYmVyID0gc2VnbWVudExpc3QuZ2V0RW5kTnVtYmVyKCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0RW5kTnVtYmVyO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0cyA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0cygpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIHNlZ21lbnRMaXN0cyA9IHJlcHJlc2VudGF0aW9ucy5tYXAoZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbik7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0cztcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aChiYW5kd2lkdGgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoID0gcmVwcmVzZW50YXRpb25zLmZpbmQoZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHZhciByZXByZXNlbnRhdGlvbkJhbmR3aWR0aCA9IHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgICAgICAgICAgcmV0dXJuIChOdW1iZXIocmVwcmVzZW50YXRpb25CYW5kd2lkdGgpID09PSBOdW1iZXIoYmFuZHdpZHRoKSk7XG4gICAgICAgIH0pLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb25XaXRoQmFuZHdpZHRoTWF0Y2gpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24gZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpIHtcbiAgICByZXR1cm4gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCkubWFwKFxuICAgICAgICBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG4gICAgfSkuZmlsdGVyKFxuICAgICAgICBmdW5jdGlvbihiYW5kd2lkdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKTtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hbmlmZXN0OyIsIm1vZHVsZS5leHBvcnRzID0gWyd2aWRlbycsICdhdWRpbyddOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL3V0aWwuanMnKS5wYXJzZVJvb3RVcmw7XG5cbmZ1bmN0aW9uIGxvYWRNYW5pZmVzdCh1cmwsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFjdHVhbFVybCA9IHBhcnNlUm9vdFVybCh1cmwpLFxuICAgICAgICByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIG9ubG9hZDtcblxuICAgIG9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7IHJldHVybjsgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2soe21hbmlmZXN0WG1sOiByZXF1ZXN0LnJlc3BvbnNlWE1MIH0pOyB9XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vdGhpcy5kZWJ1Zy5sb2coJ1N0YXJ0IGxvYWRpbmcgbWFuaWZlc3Q6ICcgKyB1cmwpO1xuICAgICAgICByZXF1ZXN0Lm9ubG9hZCA9IG9ubG9hZDtcbiAgICAgICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgICAgICByZXF1ZXN0LnNlbmQoKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgcmVxdWVzdC5vbmVycm9yKCk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxvYWRNYW5pZmVzdDsiLCJcbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGlzTnVtYmVyID0gcmVxdWlyZSgnLi4vdXRpbC9pc051bWJlci5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBsb2FkU2VnbWVudCxcbiAgICBERUZBVUxUX1JFVFJZX0NPVU5UID0gMyxcbiAgICBERUZBVUxUX1JFVFJZX0lOVEVSVkFMID0gMjUwO1xuXG5sb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQsIHJldHJ5SW50ZXJ2YWwpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IG51bGw7XG5cbiAgICB2YXIgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICB1cmwgPSBzZWdtZW50LmdldFVybCgpO1xuICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICByZXF1ZXN0LnJlc3BvbnNlVHlwZSA9ICdhcnJheWJ1ZmZlcic7XG5cbiAgICByZXF1ZXN0Lm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAocmVxdWVzdC5zdGF0dXMgPCAyMDAgfHwgcmVxdWVzdC5zdGF0dXMgPiAyOTkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgICAgICB9LCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzZWxmLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gTnVtYmVyKChuZXcgRGF0ZSgpLmdldFRpbWUoKSkvMTAwMCk7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFja0ZuID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrRm4uY2FsbChzZWxmLCByZXF1ZXN0LnJlc3BvbnNlKTsgfVxuICAgIH07XG4gICAgLy9yZXF1ZXN0Lm9uZXJyb3IgPSByZXF1ZXN0Lm9ubG9hZGVuZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9LCByZXRyeUludGVydmFsKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9O1xuXG4gICAgc2VsZi5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSA9IE51bWJlcigobmV3IERhdGUoKS5nZXRUaW1lKCkpLzEwMDApO1xuICAgIHJlcXVlc3Quc2VuZCgpO1xufTtcblxuZnVuY3Rpb24gU2VnbWVudExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhVHlwZSkge1xuICAgIGlmICghZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlcikpIHsgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyIG11c3QgYmUgaW5pdGlhbGl6ZWQgd2l0aCBhIG1hbmlmZXN0Q29udHJvbGxlciEnKTsgfVxuICAgIGlmICghZXhpc3R5KG1lZGlhVHlwZSkpIHsgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyIG11c3QgYmUgaW5pdGlhbGl6ZWQgd2l0aCBhIG1lZGlhVHlwZSEnKTsgfVxuICAgIHRoaXMuX19tYW5pZmVzdCA9IG1hbmlmZXN0Q29udHJvbGxlcjtcbiAgICB0aGlzLl9fbWVkaWFUeXBlID0gbWVkaWFUeXBlO1xuICAgIC8vIFRPRE86IERvbid0IGxpa2UgdGhpczogTmVlZCB0byBjZW50cmFsaXplIHBsYWNlKHMpIHdoZXJlICYgaG93IF9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQgZ2V0cyBzZXQgdG8gdHJ1ZS9mYWxzZS5cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG59XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBJTklUSUFMSVpBVElPTl9MT0FERUQ6ICdpbml0aWFsaXphdGlvbkxvYWRlZCcsXG4gICAgU0VHTUVOVF9MT0FERUQ6ICdzZWdtZW50TG9hZGVkJyxcbiAgICBET1dOTE9BRF9EQVRBX1VQREFURTogJ2Rvd25sb2FkRGF0YVVwZGF0ZSdcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0TWVkaWFTZXQgPSBmdW5jdGlvbiBnZXRNZWRpYVNldCgpIHtcbiAgICB2YXIgbWVkaWFTZXQgPSB0aGlzLl9fbWFuaWZlc3QuZ2V0TWVkaWFTZXRCeVR5cGUodGhpcy5fX21lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuX19nZXREZWZhdWx0U2VnbWVudExpc3QgPSBmdW5jdGlvbiBnZXREZWZhdWx0U2VnbWVudExpc3QoKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0ID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RzKClbMF07XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRCYW5kd2lkdGgoKSB7XG4gICAgaWYgKCFpc051bWJlcih0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkpIHsgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSB0aGlzLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkuZ2V0QmFuZHdpZHRoKCk7IH1cbiAgICByZXR1cm4gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGg7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5zZXRDdXJyZW50QmFuZHdpZHRoID0gZnVuY3Rpb24gc2V0Q3VycmVudEJhbmR3aWR0aChiYW5kd2lkdGgpIHtcbiAgICBpZiAoIWlzTnVtYmVyKGJhbmR3aWR0aCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyOjpzZXRDdXJyZW50QmFuZHdpZHRoKCkgZXhwZWN0cyBhIG51bWVyaWMgdmFsdWUgZm9yIGJhbmR3aWR0aCEnKTtcbiAgICB9XG4gICAgdmFyIGF2YWlsYWJsZUJhbmR3aWR0aHMgPSB0aGlzLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKTtcbiAgICBpZiAoYXZhaWxhYmxlQmFuZHdpZHRocy5pbmRleE9mKGJhbmR3aWR0aCkgPCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIG11c3QgYmUgc2V0IHRvIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlczogJyArIGF2YWlsYWJsZUJhbmR3aWR0aHMuam9pbignLCAnKSk7XG4gICAgfVxuICAgIGlmIChiYW5kd2lkdGggPT09IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoKSB7IHJldHVybjsgfVxuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSBiYW5kd2lkdGg7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudExpc3QgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudExpc3QoKSB7XG4gICAgdmFyIHNlZ21lbnRMaXN0ID0gIHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgodGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCkpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXZhaWxhYmxlQmFuZHdpZHRocyA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKTtcbiAgICByZXR1cm4gYXZhaWxhYmxlQmFuZHdpZHRocztcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldFN0YXJ0TnVtYmVyID0gZnVuY3Rpb24gZ2V0U3RhcnROdW1iZXIoKSB7XG4gICAgdmFyIHN0YXJ0TnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RTdGFydE51bWJlcigpO1xuICAgIHJldHVybiBzdGFydE51bWJlcjtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50ID0gZnVuY3Rpb24gZ2V0Q3VycmVudFNlZ21lbnQoKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeU51bWJlcih0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIpO1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudE51bWJlcigpIHsgcmV0dXJuIHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnRTdGFydFRpbWUgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudFN0YXJ0VGltZSgpIHsgcmV0dXJuIHRoaXMuZ2V0Q3VycmVudFNlZ21lbnQoKS5nZXRTdGFydE51bWJlcigpOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRFbmROdW1iZXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZW5kTnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gZW5kTnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBleGlzdHkodGhpcy5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSkgPyB0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lIDogLTE7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSgpIC0gdGhpcy5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUoKTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRJbml0aWFsaXphdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLFxuICAgICAgICBpbml0aWFsaXphdGlvbiA9IHNlZ21lbnRMaXN0LmdldEluaXRpYWxpemF0aW9uKCk7XG5cbiAgICBpZiAoIWluaXRpYWxpemF0aW9uKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBpbml0aWFsaXphdGlvbiwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6aW5pdFNlZ21lbnR9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZE5leHRTZWdtZW50ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPSBleGlzdHkodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyKSxcbiAgICAgICAgbnVtYmVyID0gbm9DdXJyZW50U2VnbWVudE51bWJlciA/IHRoaXMuZ2V0U3RhcnROdW1iZXIoKSA6IHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciArIDE7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNlZ21lbnRBdE51bWJlcihudW1iZXIpO1xufTtcblxuLy8gVE9ETzogRHVwbGljYXRlIGNvZGUgYmVsb3cuIEFic3RyYWN0IGF3YXkuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0TnVtYmVyID0gZnVuY3Rpb24obnVtYmVyKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCk7XG5cbiAgICBjb25zb2xlLmxvZygnQkFORFdJRFRIIE9GIFNFR01FTlQgQkVJTkcgUkVRVUVTVEVEOiAnICsgc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKCkpO1xuXG4gICAgaWYgKG51bWJlciA+IHRoaXMuZ2V0RW5kTnVtYmVyKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeU51bWJlcihudW1iZXIpO1xuXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTpzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9EQVRBX1VQREFURSxcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiBzZWxmLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBydHQ6IHNlbGYuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBsYXliYWNrVGltZTogc2VnbWVudC5nZXREdXJhdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmFuZHdpZHRoOiBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWdtZW50RGF0YSB9KTtcbiAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGNvbnNvbGUubG9nKCdCQU5EV0lEVEggT0YgU0VHTUVOVCBCRUlORyBSRVFVRVNURUQ6ICcgKyBzZWdtZW50TGlzdC5nZXRCYW5kd2lkdGgoKSk7XG5cbiAgICBpZiAocHJlc2VudGF0aW9uVGltZSA+IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBzZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5VGltZShwcmVzZW50YXRpb25UaW1lKTtcblxuICAgIGlmICh0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQpIHtcbiAgICAgICAgdGhpcy5vbmUodGhpcy5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gZXZlbnQuZGF0YTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IGZhbHNlO1xuICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOltpbml0U2VnbWVudCwgc2VnbWVudERhdGFdIH0pO1xuICAgICAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmxvYWRJbml0aWFsaXphdGlvbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcihcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfREFUQV9VUERBVEUsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogc2VsZixcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcnR0OiBzZWxmLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF5YmFja1RpbWU6IHNlZ21lbnQuZ2V0RHVyYXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhbmR3aWR0aDogc2VnbWVudExpc3QuZ2V0QmFuZHdpZHRoKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YXIgc2VnbWVudERhdGEgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VnbWVudERhdGEgfSk7XG4gICAgICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU2VnbWVudExvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKSB7XG4gICAgdmFyIGJhbmR3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0QmFuZHdpZHRoKCksXG4gICAgICAgIGJhbmR3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0QmFuZHdpZHRoKCk7XG4gICAgcmV0dXJuIGJhbmR3aWR0aEEgLSBiYW5kd2lkdGhCO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VnbWVudExpc3RzQnlXaWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciB3aWR0aEEgPSBzZWdtZW50TGlzdEEuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICB3aWR0aEIgPSBzZWdtZW50TGlzdEIuZ2V0V2lkdGgoKSB8fCAwO1xuICAgIHJldHVybiB3aWR0aEEgLSB3aWR0aEI7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyhzZWdtZW50TGlzdEEsIHNlZ21lbnRMaXN0Qikge1xuICAgIHZhciByZXNvbHV0aW9uQ29tcGFyZSA9IGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbiAgICByZXR1cm4gKHJlc29sdXRpb25Db21wYXJlICE9PSAwKSA/IHJlc29sdXRpb25Db21wYXJlIDogY29tcGFyZVNlZ21lbnRMaXN0c0J5QmFuZHdpZHRoQXNjZW5kaW5nKHNlZ21lbnRMaXN0QSwgc2VnbWVudExpc3RCKTtcbn1cblxuZnVuY3Rpb24gZmlsdGVyU2VnbWVudExpc3RzQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0LCBtYXhXaWR0aCwgbWF4SGVpZ2h0KSB7XG4gICAgdmFyIHdpZHRoID0gc2VnbWVudExpc3QuZ2V0V2lkdGgoKSB8fCAwLFxuICAgICAgICBoZWlnaHQgPSBzZWdtZW50TGlzdC5nZXRIZWlnaHQoKSB8fCAwO1xuICAgIHJldHVybiAoKHdpZHRoIDw9IG1heFdpZHRoKSAmJiAoaGVpZ2h0IDw9IG1heEhlaWdodCkpO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbykge1xuICAgIHZhciBzZWdtZW50TGlzdEJhbmR3aWR0aCA9IHNlZ21lbnRMaXN0LmdldEJhbmR3aWR0aCgpLFxuICAgICAgICBzZWdtZW50QmFuZHdpZHRoUmF0aW8gPSBzZWdtZW50TGlzdEJhbmR3aWR0aCAvIGN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aDtcbiAgICByZXR1cm4gKGRvd25sb2FkUmF0ZVJhdGlvID49IHNlZ21lbnRCYW5kd2lkdGhSYXRpbyk7XG59XG5cbi8vIE5PVEU6IFBhc3NpbmcgaW4gbWVkaWFTZXQgaW5zdGVhZCBvZiBtZWRpYVNldCdzIFNlZ21lbnRMaXN0IEFycmF5IHNpbmNlIHNvcnQgaXMgZGVzdHJ1Y3RpdmUgYW5kIGRvbid0IHdhbnQgdG8gY2xvbmUuXG4vLyAgICAgIEFsc28gYWxsb3dzIGZvciBncmVhdGVyIGZsZXhpYmlsaXR5IG9mIGZuLlxuZnVuY3Rpb24gc2VsZWN0U2VnbWVudExpc3QobWVkaWFTZXQsIGRhdGEpIHtcbiAgICB2YXIgZG93bmxvYWRSYXRlUmF0aW8gPSBkYXRhLmRvd25sb2FkUmF0ZVJhdGlvLFxuICAgICAgICBjdXJyZW50U2VnbWVudExpc3RCYW5kd2lkdGggPSBkYXRhLmN1cnJlbnRTZWdtZW50TGlzdEJhbmR3aWR0aCxcbiAgICAgICAgd2lkdGggPSBkYXRhLndpZHRoLFxuICAgICAgICBoZWlnaHQgPSBkYXRhLmhlaWdodCxcbiAgICAgICAgc29ydGVkQnlCYW5kd2lkdGggPSBtZWRpYVNldC5nZXRTZWdtZW50TGlzdHMoKS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeUJhbmR3aWR0aEFzY2VuZGluZyksXG4gICAgICAgIHNvcnRlZEJ5UmVzb2x1dGlvblRoZW5CYW5kd2lkdGggPSBtZWRpYVNldC5nZXRTZWdtZW50TGlzdHMoKS5zb3J0KGNvbXBhcmVTZWdtZW50TGlzdHNCeVdpZHRoVGhlbkJhbmR3aWR0aEFzY2VuZGluZyksXG4gICAgICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUsXG4gICAgICAgIGZpbHRlcmVkQnlSZXNvbHV0aW9uLFxuICAgICAgICBwcm9wb3NlZFNlZ21lbnRMaXN0O1xuXG4gICAgZnVuY3Rpb24gZmlsdGVyQnlSZXNvbHV0aW9uKHNlZ21lbnRMaXN0KSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJTZWdtZW50TGlzdHNCeVJlc29sdXRpb24oc2VnbWVudExpc3QsIHdpZHRoLCBoZWlnaHQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbHRlckJ5RG93bmxvYWRSYXRlKHNlZ21lbnRMaXN0KSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJTZWdtZW50TGlzdHNCeURvd25sb2FkUmF0ZShzZWdtZW50TGlzdCwgY3VycmVudFNlZ21lbnRMaXN0QmFuZHdpZHRoLCBkb3dubG9hZFJhdGVSYXRpbyk7XG4gICAgfVxuXG4gICAgZmlsdGVyZWRCeVJlc29sdXRpb24gPSBzb3J0ZWRCeVJlc29sdXRpb25UaGVuQmFuZHdpZHRoLmZpbHRlcihmaWx0ZXJCeVJlc29sdXRpb24pO1xuICAgIGZpbHRlcmVkQnlEb3dubG9hZFJhdGUgPSBzb3J0ZWRCeUJhbmR3aWR0aC5maWx0ZXIoZmlsdGVyQnlEb3dubG9hZFJhdGUpO1xuXG4gICAgcHJvcG9zZWRTZWdtZW50TGlzdCA9IGZpbHRlcmVkQnlSZXNvbHV0aW9uW2ZpbHRlcmVkQnlSZXNvbHV0aW9uLmxlbmd0aCAtIDFdIHx8IGZpbHRlcmVkQnlEb3dubG9hZFJhdGVbZmlsdGVyZWRCeURvd25sb2FkUmF0ZS5sZW5ndGggLSAxXSB8fCBzb3J0ZWRCeUJhbmR3aWR0aFswXTtcblxuICAgIHJldHVybiBwcm9wb3NlZFNlZ21lbnRMaXN0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHNlbGVjdFNlZ21lbnRMaXN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzRnVuY3Rpb24gPSByZXF1aXJlKCcuLi91dGlsL2lzRnVuY3Rpb24uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyk7XG5cbmZ1bmN0aW9uIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpIHtcbiAgICAvLyBUT0RPOiBDaGVjayB0eXBlP1xuICAgIGlmICghc291cmNlQnVmZmVyKSB7IHRocm93IG5ldyBFcnJvciggJ1RoZSBzb3VyY2VCdWZmZXIgY29uc3RydWN0b3IgYXJndW1lbnQgY2Fubm90IGJlIG51bGwuJyApOyB9XG5cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGRhdGFRdWV1ZSA9IFtdO1xuICAgIC8vIFRPRE86IGZpZ3VyZSBvdXQgaG93IHdlIHdhbnQgdG8gcmVzcG9uZCB0byBvdGhlciBldmVudCBzdGF0ZXMgKHVwZGF0ZWVuZD8gZXJyb3I/IGFib3J0PykgKHJldHJ5PyByZW1vdmU/KVxuICAgIHNvdXJjZUJ1ZmZlci5hZGRFdmVudExpc3RlbmVyKCd1cGRhdGVlbmQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAvLyBUaGUgU291cmNlQnVmZmVyIGluc3RhbmNlJ3MgdXBkYXRpbmcgcHJvcGVydHkgc2hvdWxkIGFsd2F5cyBiZSBmYWxzZSBpZiB0aGlzIGV2ZW50IHdhcyBkaXNwYXRjaGVkLFxuICAgICAgICAvLyBidXQganVzdCBpbiBjYXNlLi4uXG4gICAgICAgIGlmIChldmVudC50YXJnZXQudXBkYXRpbmcpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0FEREVEX1RPX0JVRkZFUiwgdGFyZ2V0OnNlbGYgfSk7XG5cbiAgICAgICAgaWYgKHNlbGYuX19kYXRhUXVldWUubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUVVFVUVfRU1QVFksIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5fX3NvdXJjZUJ1ZmZlci5hcHBlbmRCdWZmZXIoc2VsZi5fX2RhdGFRdWV1ZS5zaGlmdCgpKTtcbiAgICB9KTtcblxuICAgIHRoaXMuX19kYXRhUXVldWUgPSBkYXRhUXVldWU7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlciA9IHNvdXJjZUJ1ZmZlcjtcbn1cblxuLy8gVE9ETzogQWRkIGFzIFwiY2xhc3NcIiBwcm9wZXJ0aWVzP1xuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUVVFVUVfRU1QVFk6ICdxdWV1ZUVtcHR5JyxcbiAgICBTRUdNRU5UX0FEREVEX1RPX0JVRkZFUjogJ3NlZ21lbnRBZGRlZFRvQnVmZmVyJ1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5hZGRUb1F1ZXVlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBkYXRhVG9BZGRJbW1lZGlhdGVseTtcbiAgICBpZiAoIWV4aXN0eShkYXRhKSB8fCAoaXNBcnJheShkYXRhKSAmJiBkYXRhLmxlbmd0aCA8PSAwKSkgeyByZXR1cm47IH1cbiAgICAvLyBUcmVhdCBhbGwgZGF0YSBhcyBhcnJheXMgdG8gbWFrZSBzdWJzZXF1ZW50IGZ1bmN0aW9uYWxpdHkgZ2VuZXJpYy5cbiAgICBpZiAoIWlzQXJyYXkoZGF0YSkpIHsgZGF0YSA9IFtkYXRhXTsgfVxuICAgIC8vIElmIG5vdGhpbmcgaXMgaW4gdGhlIHF1ZXVlLCBnbyBhaGVhZCBhbmQgaW1tZWRpYXRlbHkgYXBwZW5kIHRoZSBmaXJzdCBkYXRhIHRvIHRoZSBzb3VyY2UgYnVmZmVyLlxuICAgIGlmICgodGhpcy5fX2RhdGFRdWV1ZS5sZW5ndGggPT09IDApICYmICghdGhpcy5fX3NvdXJjZUJ1ZmZlci51cGRhdGluZykpIHsgZGF0YVRvQWRkSW1tZWRpYXRlbHkgPSBkYXRhLnNoaWZ0KCk7IH1cbiAgICAvLyBJZiBhbnkgb3RoZXIgZGF0YSAoc3RpbGwpIGV4aXN0cywgcHVzaCB0aGUgcmVzdCBvbnRvIHRoZSBkYXRhUXVldWUuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IHRoaXMuX19kYXRhUXVldWUuY29uY2F0KGRhdGEpO1xuICAgIGlmIChleGlzdHkoZGF0YVRvQWRkSW1tZWRpYXRlbHkpKSB7IHRoaXMuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKGRhdGFUb0FkZEltbWVkaWF0ZWx5KTsgfVxufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5jbGVhclF1ZXVlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IFtdO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5oYXNCdWZmZXJlZERhdGFGb3JUaW1lID0gZnVuY3Rpb24ocHJlc2VudGF0aW9uVGltZSkge1xuICAgIHJldHVybiBjaGVja1RpbWVSYW5nZXNGb3JUaW1lKHRoaXMuX19zb3VyY2VCdWZmZXIuYnVmZmVyZWQsIHByZXNlbnRhdGlvblRpbWUsIGZ1bmN0aW9uKHN0YXJ0VGltZSwgZW5kVGltZSkge1xuICAgICAgICByZXR1cm4gKChzdGFydFRpbWUgPj0gMCkgfHwgKGVuZFRpbWUgPj0gMCkpO1xuICAgIH0pO1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5kZXRlcm1pbmVBbW91bnRCdWZmZXJlZEZyb21UaW1lID0gZnVuY3Rpb24ocHJlc2VudGF0aW9uVGltZSkge1xuICAgIC8vIElmIHRoZSByZXR1cm4gdmFsdWUgaXMgPCAwLCBubyBkYXRhIGlzIGJ1ZmZlcmVkIEAgcHJlc2VudGF0aW9uVGltZS5cbiAgICByZXR1cm4gY2hlY2tUaW1lUmFuZ2VzRm9yVGltZSh0aGlzLl9fc291cmNlQnVmZmVyLmJ1ZmZlcmVkLCBwcmVzZW50YXRpb25UaW1lLFxuICAgICAgICBmdW5jdGlvbihzdGFydFRpbWUsIGVuZFRpbWUsIHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICAgICAgICAgIHJldHVybiBlbmRUaW1lIC0gcHJlc2VudGF0aW9uVGltZTtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG5mdW5jdGlvbiBjaGVja1RpbWVSYW5nZXNGb3JUaW1lKHRpbWVSYW5nZXMsIHRpbWUsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHRpbWVSYW5nZXNMZW5ndGggPSB0aW1lUmFuZ2VzLmxlbmd0aCxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGN1cnJlbnRTdGFydFRpbWUsXG4gICAgICAgIGN1cnJlbnRFbmRUaW1lO1xuXG4gICAgZm9yIChpOyBpPHRpbWVSYW5nZXNMZW5ndGg7IGkrKykge1xuICAgICAgICBjdXJyZW50U3RhcnRUaW1lID0gdGltZVJhbmdlcy5zdGFydChpKTtcbiAgICAgICAgY3VycmVudEVuZFRpbWUgPSB0aW1lUmFuZ2VzLmVuZChpKTtcbiAgICAgICAgaWYgKCh0aW1lID49IGN1cnJlbnRTdGFydFRpbWUpICYmICh0aW1lIDw9IGN1cnJlbnRFbmRUaW1lKSkge1xuICAgICAgICAgICAgcmV0dXJuIGlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soY3VycmVudFN0YXJ0VGltZSwgY3VycmVudEVuZFRpbWUsIHRpbWUpIDogdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50U3RhcnRUaW1lID4gdGltZSkge1xuICAgICAgICAgICAgLy8gSWYgdGhlIGN1cnJlbnRTdGFydFRpbWUgaXMgZ3JlYXRlciB0aGFuIHRoZSB0aW1lIHdlJ3JlIGxvb2tpbmcgZm9yLCB0aGF0IG1lYW5zIHdlJ3ZlIHJlYWNoZWQgYSB0aW1lIHJhbmdlXG4gICAgICAgICAgICAvLyB0aGF0J3MgcGFzdCB0aGUgdGltZSB3ZSdyZSBsb29raW5nIGZvciAoc2luY2UgVGltZVJhbmdlcyBzaG91bGQgYmUgb3JkZXJlZCBjaHJvbm9sb2dpY2FsbHkpLiBJZiBzbywgd2VcbiAgICAgICAgICAgIC8vIGNhbiBzaG9ydCBjaXJjdWl0LlxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjaygtMSwgLTEsIHRpbWUpIDogZmFsc2U7XG59XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VCdWZmZXJEYXRhUXVldWU7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4gKHggIT09IG51bGwpICYmICh4ICE9PSB1bmRlZmluZWQpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gZXhpc3R5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gRXh0ZW5kIGEgZ2l2ZW4gb2JqZWN0IHdpdGggYWxsIHRoZSBwcm9wZXJ0aWVzIChhbmQgdGhlaXIgdmFsdWVzKSBmb3VuZCBpbiB0aGUgcGFzc2VkLWluIG9iamVjdChzKS5cbnZhciBleHRlbmRPYmplY3QgPSBmdW5jdGlvbihvYmogLyosIGV4dGVuZE9iamVjdDEsIGV4dGVuZE9iamVjdDIsIC4uLiwgZXh0ZW5kT2JqZWN0TiAqLykge1xuICAgIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSkuZm9yRWFjaChmdW5jdGlvbihleHRlbmRPYmplY3QpIHtcbiAgICAgICAgaWYgKGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgICAgICBvYmpbcHJvcF0gPSBleHRlbmRPYmplY3RbcHJvcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gb2JqO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRPYmplY3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzQXJyYXkob2JqKSB7XG4gICAgcmV0dXJuIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzRnVuY3Rpb24gPSBmdW5jdGlvbiBpc0Z1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcbn07XG4vLyBmYWxsYmFjayBmb3Igb2xkZXIgdmVyc2lvbnMgb2YgQ2hyb21lIGFuZCBTYWZhcmlcbmlmIChpc0Z1bmN0aW9uKC94LykpIHtcbiAgICBpc0Z1bmN0aW9uID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXSc7XG4gICAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0Z1bmN0aW9uOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc051bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBOdW1iZXJdJyB8fCBmYWxzZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc051bWJlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgU3RyaW5nXScgfHwgZmFsc2U7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzU3RyaW5nOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vZXhpc3R5LmpzJyk7XG5cbi8vIE5PVEU6IFRoaXMgdmVyc2lvbiBvZiB0cnV0aHkgYWxsb3dzIG1vcmUgdmFsdWVzIHRvIGNvdW50XG4vLyBhcyBcInRydWVcIiB0aGFuIHN0YW5kYXJkIEpTIEJvb2xlYW4gb3BlcmF0b3IgY29tcGFyaXNvbnMuXG4vLyBTcGVjaWZpY2FsbHksIHRydXRoeSgpIHdpbGwgcmV0dXJuIHRydWUgZm9yIHRoZSB2YWx1ZXNcbi8vIDAsIFwiXCIsIGFuZCBOYU4sIHdoZXJlYXMgSlMgd291bGQgdHJlYXQgdGhlc2UgYXMgXCJmYWxzeVwiIHZhbHVlcy5cbmZ1bmN0aW9uIHRydXRoeSh4KSB7IHJldHVybiAoeCAhPT0gZmFsc2UpICYmIGV4aXN0eSh4KTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IHRydXRoeTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIFRPRE86IFJlZmFjdG9yIHRvIHNlcGFyYXRlIGpzIGZpbGVzICYgbW9kdWxlcyAmIHJlbW92ZSBmcm9tIGhlcmUuXG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuL3V0aWwvaXNTdHJpbmcuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbmZ1bmN0aW9uIHByZUFwcGx5QXJnc0ZuKGZ1biAvKiwgYXJncyAqLykge1xuICAgIHZhciBwcmVBcHBsaWVkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgLy8gTk9URTogdGhlICp0aGlzKiByZWZlcmVuY2Ugd2lsbCByZWZlciB0byB0aGUgY2xvc3VyZSdzIGNvbnRleHQgdW5sZXNzXG4gICAgLy8gdGhlIHJldHVybmVkIGZ1bmN0aW9uIGlzIGl0c2VsZiBjYWxsZWQgdmlhIC5jYWxsKCkgb3IgLmFwcGx5KCkuIElmIHlvdVxuICAgIC8vICpuZWVkKiB0byByZWZlciB0byBpbnN0YW5jZS1sZXZlbCBwcm9wZXJ0aWVzLCBkbyBzb21ldGhpbmcgbGlrZSB0aGUgZm9sbG93aW5nOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBmdW5jdGlvbihhcmdDKSB7IHByZUFwcGx5QXJnc0ZuKHNvbWVPdGhlckZuLCBhcmdBLCBhcmdCLCAuLi4gYXJnTikuY2FsbCh0aGlzKTsgfTtcbiAgICAvL1xuICAgIC8vIE90aGVyd2lzZSwgeW91IHNob3VsZCBiZSBhYmxlIHRvIGp1c3QgY2FsbDpcbiAgICAvL1xuICAgIC8vIE15VHlwZS5wcm90b3R5cGUuc29tZUZuID0gcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKTtcbiAgICAvL1xuICAgIC8vIFdoZXJlIHBvc3NpYmxlLCBmdW5jdGlvbnMgYW5kIG1ldGhvZHMgc2hvdWxkIG5vdCBiZSByZWFjaGluZyBvdXQgdG8gZ2xvYmFsIHNjb3BlIGFueXdheSwgc28uLi5cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7IHJldHVybiBmdW4uYXBwbHkodGhpcywgcHJlQXBwbGllZEFyZ3MpOyB9O1xufVxuXG4vLyBIaWdoZXItb3JkZXIgWE1MIGZ1bmN0aW9uc1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHNcbnZhciBnZXRBbmNlc3RvcnMgPSBmdW5jdGlvbihlbGVtLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIHZhciBhbmNlc3RvcnMgPSBbXTtcbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIChmdW5jdGlvbiBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0sIGFuY2VzdG9ycykpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmIChleGlzdHkoZWxlbSkgJiYgZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHtcbiAgICAgICAgICAgIGFuY2VzdG9ycy5wdXNoKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgICAgICBnZXRBbmNlc3RvcnNSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH0pKGVsZW0pO1xuICAgIHJldHVybiBhbmNlc3RvcnM7XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0Tm9kZUxpc3RCeU5hbWUgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHhtbE9iaikge1xuICAgICAgICByZXR1cm4geG1sT2JqLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSwgdmFsdWUpIHtcbiAgICBpZiAoKHR5cGVvZiBhdHRyTmFtZSAhPT0gJ3N0cmluZycpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICAgIGlmICghZXhpc3R5KHZhbHVlKSkgeyByZXR1cm4gZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIHJldHVybiAoZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpID09PSB2YWx1ZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRBdHRyRm4gPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICghaXNTdHJpbmcoYXR0ck5hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhaXNGdW5jdGlvbihlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG4vLyBUT0RPOiBBZGQgc2hvdWxkU3RvcFByZWQgKHNob3VsZCBmdW5jdGlvbiBzaW1pbGFybHkgdG8gc2hvdWxkU3RvcFByZWQgaW4gZ2V0SW5oZXJpdGFibGVFbGVtZW50LCBiZWxvdylcbnZhciBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCghaXNTdHJpbmcoYXR0ck5hbWUpKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSkpIHsgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUYWtlcyBmdW5jdGlvbihzKSBhcyBhcmd1bWVudHM7IFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBmdW5jdGlvbihub2RlTmFtZSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhub2RlTmFtZSkpIHx8IG5vZGVOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICB2YXIgbWF0Y2hpbmdFbGVtTGlzdCA9IGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUobm9kZU5hbWUpO1xuICAgICAgICBpZiAoZXhpc3R5KG1hdGNoaW5nRWxlbUxpc3QpICYmIG1hdGNoaW5nRWxlbUxpc3QubGVuZ3RoID4gMCkgeyByZXR1cm4gbWF0Y2hpbmdFbGVtTGlzdFswXTsgfVxuICAgICAgICBpZiAoIWV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxuLy8gVE9ETzogSW1wbGVtZW50IG1lIGZvciBCYXNlVVJMIG9yIHVzZSBleGlzdGluZyBmbiAoU2VlOiBtcGQuanMgYnVpbGRCYXNlVXJsKCkpXG4vKnZhciBidWlsZEhpZXJhcmNoaWNhbGx5U3RydWN0dXJlZFZhbHVlID0gZnVuY3Rpb24odmFsdWVGbiwgYnVpbGRGbiwgc3RvcFByZWQpIHtcblxufTsqL1xuXG4vLyBQdWJsaXNoIEV4dGVybmFsIEFQSTpcbnZhciB4bWxmdW4gPSB7fTtcbnhtbGZ1bi5leGlzdHkgPSBleGlzdHk7XG54bWxmdW4udHJ1dGh5ID0gdHJ1dGh5O1xuXG54bWxmdW4uZ2V0Tm9kZUxpc3RCeU5hbWUgPSBnZXROb2RlTGlzdEJ5TmFtZTtcbnhtbGZ1bi5oYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGhhc01hdGNoaW5nQXR0cmlidXRlO1xueG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0QW5jZXN0b3JzID0gZ2V0QW5jZXN0b3JzO1xueG1sZnVuLmdldEF0dHJGbiA9IGdldEF0dHJGbjtcbnhtbGZ1bi5wcmVBcHBseUFyZ3NGbiA9IHByZUFwcGx5QXJnc0ZuO1xueG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCA9IGdldEluaGVyaXRhYmxlRWxlbWVudDtcblxubW9kdWxlLmV4cG9ydHMgPSB4bWxmdW47Il19
