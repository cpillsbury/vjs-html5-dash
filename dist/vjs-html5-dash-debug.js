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
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    StreamLoader = require('./StreamLoader.js'),
    mediaTypes = require('./manifest/MediaTypes.js');

// TODO: Migrate methods below to a factory.
function createSourceBufferDataQueueByType(manifest, mediaSource, mediaType) {
    var sourceBufferType = manifest.getMediaSetByType(mediaType).getSourceBufferType(),
        // TODO: Try/catch block?
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);
    return new SourceBufferDataQueue(sourceBuffer);
}

function createStreamLoaderForType(manifestController, mediaSource, mediaType, tech) {
    var segmentLoader = new SegmentLoader(manifestController, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType);
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType, tech);
}

function createStreamLoaders(manifestController, mediaSource, tech) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return exists; }),
        streamLoaders = matchedTypes.map(function(mediaType) { return createStreamLoaderForType(manifestController, mediaSource, mediaType, tech); });
    return streamLoaders;
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    var self = this;
    this.__tech = tech;
    this.__streamLoaders = createStreamLoaders(manifestController, mediaSource, tech);
    this.__streamLoaders.forEach(function(streamLoader) {
        streamLoader.startLoadingSegments();
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
},{"./StreamLoader.js":4,"./manifest/MediaTypes.js":13,"./segments/SegmentLoader.js":15,"./sourceBuffer/SourceBufferDataQueue.js":16,"./util/existy.js":17}],3:[function(require,module,exports){
'use strict';

var MediaSource = require('global/window').MediaSource,
    ManifestController = require('./manifest/ManifestController.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

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

},{"./PlaylistLoader.js":2,"./manifest/ManifestController.js":12,"global/window":1}],4:[function(require,module,exports){
'use strict';

var existy = require('./util/existy.js'),
    isFunction = require('./util/isFunction.js'),
    extendObject = require('./util/extendObject.js'),
    EventDispatcherMixin = require('./events/EventDispatcherMixin.js'),
    MIN_DESIRED_BUFFER_SIZE = 20,
    MAX_DESIRED_BUFFER_SIZE = 40;

/*function loadSegmentAtTime(segmentLoader, sourceBufferDataQueue, presentationTime, callback, thisArg) {
    var hasNextSegment = segmentLoader.loadSegmentAtTime(presentationTime);
    if (!hasNextSegment) { return hasNextSegment; }

    segmentLoader.one(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            if (isFunction(callback)) { callback(); }
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    return hasNextSegment;
}*/

function StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType, tech) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__mediaType = mediaType;
    this.__tech = tech;
}

StreamLoader.prototype.eventList = {
    RECHECK_SEGMENT_LOADING: 'recheckSegmentLoading'
};

StreamLoader.prototype.getMediaType = function() { return this.__mediaType; };

StreamLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

StreamLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

StreamLoader.prototype.startLoadingSegments = function() {
    //this.__loadingSegmentsMonitor();
    var self = this;
    this.__recheckSegmentLoadingHandler = function(event) {
        self.__checkSegmentLoading(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
    };

    this.on(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);

    this.__checkSegmentLoading(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
};

StreamLoader.prototype.stopLoadingSegments = function() {
    if (!existy(this.__recheckSegmentLoadingHandler)) { return; }

    this.off(this.eventList.RECHECK_SEGMENT_LOADING, this.__recheckSegmentLoadingHandler);
    this.__recheckSegmentLoadingHandler = undefined;
};

StreamLoader.prototype.__checkSegmentLoading = function(minDesiredBufferSize, maxDesiredBufferSize) {
    var self = this,
        tech = self.__tech,
        segmentLoader = self.__segmentLoader,
        sourceBufferDataQueue = self.__sourceBufferDataQueue,
        currentTime = tech.currentTime(),
        currentBufferSize = sourceBufferDataQueue.determineAmountBufferedFromTime(currentTime),
        segmentDuration = segmentLoader.getCurrentSegmentList().getSegmentDuration(),
        totalDuration = segmentLoader.getCurrentSegmentList().getTotalDuration(),
        downloadPoint = (currentTime + currentBufferSize) + (segmentDuration / 2),
        downloadRoundTripTime,
        segmentDownloadDelay;

    if ((downloadPoint >= totalDuration) || (currentBufferSize >= maxDesiredBufferSize)) {
        // Holding pattern. Keep checking at a rate of segmentDuration until the condition changes.
        setTimeout(function() {
            self.trigger({ type:self.eventList.RECHECK_SEGMENT_LOADING, target:self });
        }, Math.floor(segmentDuration * 1000));
        return;
    }

    if (currentBufferSize <= 0) {
        self.__loadSegmentAtTime(currentTime);
    } else if (currentBufferSize < minDesiredBufferSize) {
        self.__loadSegmentAtTime(downloadPoint);
    } else if (currentBufferSize < maxDesiredBufferSize) {
        downloadRoundTripTime = segmentLoader.getLastDownloadRoundTripTimeSpan();
        segmentDownloadDelay = segmentDuration - downloadRoundTripTime;
        if (segmentDownloadDelay <= 0) {
            self.__loadSegmentAtTime(downloadPoint);
        } else {
            setTimeout(function() {
                currentTime = tech.currentTime();
                currentBufferSize = sourceBufferDataQueue.determineAmountBufferedFromTime(currentTime);
                downloadPoint = (currentTime + currentBufferSize) + (segmentDuration / 2);
                self.__loadSegmentAtTime(downloadPoint);
            }, Math.floor(segmentDownloadDelay * 1000));
        }
    }
};

StreamLoader.prototype.__loadSegmentAtTime = function loadSegmentAtTime(presentationTime) {
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

// TODO: MESSY. REFACTOR. (USE EVENTS? PASS IN REFS? PASS IN MIN/MAX BUFFER SIZE? CHECK FOR HALT CONDITION VIA PASSED IN FN?)
/*StreamLoader.prototype.__loadingSegmentsMonitor = function() {
    var self = this,
        segmentLoader = self.__segmentLoader,
        sourceBufferDataQueue = self.__sourceBufferDataQueue,
        tech = self.__tech;

    function keepLoadingSegments(minDesiredBufferSize, maxDesiredBufferSize) {
        var currentTime = tech.currentTime(),
            currentBufferSize = sourceBufferDataQueue.determineAmountBufferedFromTime(currentTime),
            segmentDuration = segmentLoader.getCurrentSegmentList().getSegmentDuration(),
            totalDuration = segmentLoader.getCurrentSegmentList().getTotalDuration(),
            downloadPoint = (currentTime + currentBufferSize) + (segmentDuration / 2),
            downloadRoundTripTime,
            segmentDownloadDelay,
            keepLoadingSegmentsIntern = function() { keepLoadingSegments.call(self, minDesiredBufferSize, maxDesiredBufferSize); },
            loadSegmentAtTimeIntern = function(time) { loadSegmentAtTime(segmentLoader, sourceBufferDataQueue, time, keepLoadingSegmentsIntern); };

        if ((downloadPoint >= totalDuration) || (currentBufferSize >= maxDesiredBufferSize)) {
            // Holding pattern. Keep checking at a rate of segmentDuration until the condition changes.
            setTimeout(keepLoadingSegmentsIntern, Math.floor(segmentDuration * 1000));
            return;
        }

        if (currentBufferSize <= 0) {
            loadSegmentAtTimeIntern(currentTime);
        } else if (currentBufferSize < minDesiredBufferSize) {
            loadSegmentAtTimeIntern(downloadPoint);
        } else if (currentBufferSize < maxDesiredBufferSize) {
            downloadRoundTripTime = segmentLoader.getLastDownloadRoundTripTimeSpan();
            segmentDownloadDelay = segmentDuration - downloadRoundTripTime;
            if (segmentDownloadDelay <= 0) {
                loadSegmentAtTimeIntern(downloadPoint);
            } else {
                setTimeout(function() {
                    currentTime = tech.currentTime();
                    currentBufferSize = sourceBufferDataQueue.determineAmountBufferedFromTime(currentTime);
                    downloadPoint = (currentTime + currentBufferSize) + (segmentDuration / 2);
                    loadSegmentAtTimeIntern(downloadPoint);
                }, Math.floor(segmentDownloadDelay * 1000));
            }
        }
    }

    keepLoadingSegments(MIN_DESIRED_BUFFER_SIZE, MAX_DESIRED_BUFFER_SIZE);
};*/

// Add event dispatcher functionality to prototype.
extendObject(StreamLoader.prototype, EventDispatcherMixin);

module.exports = StreamLoader;
},{"./events/EventDispatcherMixin.js":9,"./util/existy.js":17,"./util/extendObject.js":18,"./util/isFunction.js":20}],5:[function(require,module,exports){
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
},{"../../xmlfun.js":24,"./util.js":6}],6:[function(require,module,exports){
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

var xmlfun = require('../../xmlfun.js'),
    parseMediaPresentationDuration = require('../mpd/util.js').parseMediaPresentationDuration,
    segmentTemplate = require('./segmentTemplate'),
    createSegmentListFromTemplate,
    createSegmentFromTemplateByNumber,
    createSegmentFromTemplateByTime,
    getType,
    getBandwidth,
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
    return Number(representation.getBandwidth());
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
        // TODO: Handle last segment (likely < segment duration)
        return getSegmentDurationFromTemplate(representation);
    };
    segment.getNumber = function() { return number; };
    return segment;
};

createSegmentFromTemplateByTime = function(representation, seconds) {
    var segmentDuration = getSegmentDurationFromTemplate(representation),
        number = Math.floor(seconds / segmentDuration),
        segment = createSegmentFromTemplateByNumber(representation, number);
    console.log('Segment Duration: ' + segmentDuration + ', Seconds: ' + seconds + ', Number: ' + number);
    return segment;
};

function getSegmentListForRepresentation(representation) {
    if (!representation) { return undefined; }
    if (representation.getSegmentTemplate()) { return createSegmentListFromTemplate(representation); }
    return undefined;
}

module.exports = getSegmentListForRepresentation;

},{"../../xmlfun.js":24,"../mpd/util.js":6,"./segmentTemplate":8}],8:[function(require,module,exports){
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

},{"./SourceHandler":3,"global/window":1}],12:[function(require,module,exports){
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
},{"../dash/mpd/getMpd.js":5,"../dash/segments/getSegmentListForRepresentation.js":7,"../events/EventDispatcherMixin.js":9,"../util/existy.js":17,"../util/extendObject.js":18,"../util/isFunction.js":20,"../util/isString.js":22,"../util/truthy.js":23,"./MediaTypes.js":13,"./loadManifest.js":14}],13:[function(require,module,exports){
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
    self.__lastDownloadStartTime = Number((new Date().getTime())/1000);
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

    request.send();
};

function SegmentLoader(manifestController, mediaType) {
    if (!existy(manifestController)) { throw new Error('SegmentLoader must be initialized with a manifestController!'); }
    if (!existy(mediaType)) { throw new Error('SegmentLoader must be initialized with a mediaType!'); }
    this.__manifest = manifestController;
    this.__mediaType = mediaType;
    // TODO: Don't like this but ensures expected properties are set (Add method that setBandwidth() itself calls? Same w/getCurrentBandwidth()?)
    this.__currentBandwidth = this.getCurrentBandwidth();
    this.__currentBandwidthChanged = true;
}

SegmentLoader.prototype.eventList = {
    INITIALIZATION_LOADED: 'initializationLoaded',
    SEGMENT_LOADED: 'segmentLoaded'
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
    var self = this;

    if (number > this.getEndNumber()) { return false; }

    var segment = this.getCurrentSegmentList().getSegmentByNumber(number);

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
},{"../events/EventDispatcherMixin.js":9,"../util/existy.js":17,"../util/extendObject.js":18,"../util/isNumber.js":21}],16:[function(require,module,exports){
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

        if (dataQueue.length <= 0) {
            self.trigger({ type:self.eventList.QUEUE_EMPTY, target:self });
            return;
        }

        event.target.appendBuffer(dataQueue.shift());
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
    if (!existy(data) || (isArray(data) && data.length <= 0)) { return; }
    if (!isArray(data)) { data = [data]; }
    // If nothing is in the queue, go ahead and immediately append the segment data to the source buffer.
    if ((this.__dataQueue.length === 0) && (!this.__sourceBuffer.updating)) { this.__sourceBuffer.appendBuffer(data.shift()); }
    // Otherwise, push onto queue and wait for the next update event before appending segment data to source buffer.
    else { this.__dataQueue = this.__dataQueue.concat(data); }
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
},{"../events/EventDispatcherMixin.js":9,"../util/existy.js":17,"../util/extendObject.js":18,"../util/isArray.js":19,"../util/isFunction.js":20}],17:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],18:[function(require,module,exports){
'use strict';

// Extend a given object with all the properties in passed-in object(s).
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
},{}],19:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],20:[function(require,module,exports){
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
},{}],21:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isNumber(value) {
    return typeof value === 'number' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object Number]' || false;
}

module.exports = isNumber;
},{}],22:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object String]' || false;
};

module.exports = isString;
},{}],23:[function(require,module,exports){
'use strict';

var existy = require('./existy.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

module.exports = truthy;
},{"./existy.js":17}],24:[function(require,module,exports){
'use strict';

// TODO: Refactor to separate js files & modules & remove from here.

// NOTE: TAKEN FROM LODASH TO REMOVE DEPENDENCY
/** `Object#toString` result shortcuts */
var funcClass = '[object Function]',
    stringClass = '[object String]';

/** Used to resolve the internal [[Class]] of values */
var toString = Object.prototype.toString;

var isFunction = function isFunction(value) {
    return typeof value === 'function';
};
// fallback for older versions of Chrome and Safari
if (isFunction(/x/)) {
    isFunction = function(value) {
        return typeof value === 'function' && toString.call(value) === funcClass;
    };
}

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && toString.call(value) === stringClass || false;
};

// NOTE: END OF LODASH-BASED CODE

// General Utility Functions
function existy(x) { return x !== null; }

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
},{}]},{},[11])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9QbGF5bGlzdExvYWRlci5qcyIsInNyYy9qcy9Tb3VyY2VIYW5kbGVyLmpzIiwic3JjL2pzL1N0cmVhbUxvYWRlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvc2VnbWVudHMvU2VnbWVudExvYWRlci5qcyIsInNyYy9qcy9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzIiwic3JjL2pzL3V0aWwvZXhpc3R5LmpzIiwic3JjL2pzL3V0aWwvZXh0ZW5kT2JqZWN0LmpzIiwic3JjL2pzL3V0aWwvaXNBcnJheS5qcyIsInNyYy9qcy91dGlsL2lzRnVuY3Rpb24uanMiLCJzcmMvanMvdXRpbC9pc051bWJlci5qcyIsInNyYy9qcy91dGlsL2lzU3RyaW5nLmpzIiwic3JjL2pzL3V0aWwvdHJ1dGh5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9PQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiKGZ1bmN0aW9uIChnbG9iYWwpe1xuaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHdpbmRvdztcbn0gZWxzZSBpZiAodHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZ2xvYmFsO1xufSBlbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIil7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBzZWxmO1xufSBlbHNlIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHt9O1xufVxuXG59KS5jYWxsKHRoaXMsdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSkiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgU2VnbWVudExvYWRlciA9IHJlcXVpcmUoJy4vc2VnbWVudHMvU2VnbWVudExvYWRlci5qcycpLFxuICAgIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHJlcXVpcmUoJy4vc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcycpLFxuICAgIFN0cmVhbUxvYWRlciA9IHJlcXVpcmUoJy4vU3RyZWFtTG9hZGVyLmpzJyksXG4gICAgbWVkaWFUeXBlcyA9IHJlcXVpcmUoJy4vbWFuaWZlc3QvTWVkaWFUeXBlcy5qcycpO1xuXG4vLyBUT0RPOiBNaWdyYXRlIG1ldGhvZHMgYmVsb3cgdG8gYSBmYWN0b3J5LlxuZnVuY3Rpb24gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKSB7XG4gICAgdmFyIHNvdXJjZUJ1ZmZlclR5cGUgPSBtYW5pZmVzdC5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpLmdldFNvdXJjZUJ1ZmZlclR5cGUoKSxcbiAgICAgICAgLy8gVE9ETzogVHJ5L2NhdGNoIGJsb2NrP1xuICAgICAgICBzb3VyY2VCdWZmZXIgPSBtZWRpYVNvdXJjZS5hZGRTb3VyY2VCdWZmZXIoc291cmNlQnVmZmVyVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtTG9hZGVyRm9yVHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUsIHRlY2gpIHtcbiAgICB2YXIgc2VnbWVudExvYWRlciA9IG5ldyBTZWdtZW50TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFUeXBlKSxcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTdHJlYW1Mb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBtZWRpYVR5cGUsIHRlY2gpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW1Mb2FkZXJzKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgbWF0Y2hlZFR5cGVzID0gbWVkaWFUeXBlcy5maWx0ZXIoZnVuY3Rpb24obWVkaWFUeXBlKSB7XG4gICAgICAgICAgICB2YXIgZXhpc3RzID0gZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlci5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpKTtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHM7IH0pLFxuICAgICAgICBzdHJlYW1Mb2FkZXJzID0gbWF0Y2hlZFR5cGVzLm1hcChmdW5jdGlvbihtZWRpYVR5cGUpIHsgcmV0dXJuIGNyZWF0ZVN0cmVhbUxvYWRlckZvclR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlLCB0ZWNoKTsgfSk7XG4gICAgcmV0dXJuIHN0cmVhbUxvYWRlcnM7XG59XG5cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xuICAgIHRoaXMuX19zdHJlYW1Mb2FkZXJzID0gY3JlYXRlU3RyZWFtTG9hZGVycyhtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICB0aGlzLl9fc3RyZWFtTG9hZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbUxvYWRlcikge1xuICAgICAgICBzdHJlYW1Mb2FkZXIuc3RhcnRMb2FkaW5nU2VnbWVudHMoKTtcbiAgICB9KTtcblxuICAgIHZhciBjaGFuZ2VQbGF5YmFja1JhdGVFdmVudHMgPSBbJ3NlZWtpbmcnLCAnY2FucGxheScsICdjYW5wbGF5dGhyb3VnaCddO1xuICAgIGNoYW5nZVBsYXliYWNrUmF0ZUV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50VHlwZSkge1xuICAgICAgICB0ZWNoLm9uKGV2ZW50VHlwZSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciByZWFkeVN0YXRlID0gdGVjaC5lbCgpLnJlYWR5U3RhdGUsXG4gICAgICAgICAgICAgICAgcGxheWJhY2tSYXRlID0gKHJlYWR5U3RhdGUgPT09IDQpID8gMSA6IDA7XG4gICAgICAgICAgICB0ZWNoLnNldFBsYXliYWNrUmF0ZShwbGF5YmFja1JhdGUpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS5NZWRpYVNvdXJjZSxcbiAgICBNYW5pZmVzdENvbnRyb2xsZXIgPSByZXF1aXJlKCcuL21hbmlmZXN0L01hbmlmZXN0Q29udHJvbGxlci5qcycpLFxuICAgIFBsYXlsaXN0TG9hZGVyID0gcmVxdWlyZSgnLi9QbGF5bGlzdExvYWRlci5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWFuaWZlc3RDb250cm9sbGVyID0gbmV3IE1hbmlmZXN0Q29udHJvbGxlcihzb3VyY2Uuc3JjLCBmYWxzZSk7XG5cbiAgICBtYW5pZmVzdENvbnRyb2xsZXIubG9hZChmdW5jdGlvbihtYW5pZmVzdCkge1xuICAgICAgICB2YXIgbWVkaWFTb3VyY2UgPSBuZXcgTWVkaWFTb3VyY2UoKSxcbiAgICAgICAgICAgIG9wZW5MaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAgICAgbWVkaWFTb3VyY2UucmVtb3ZlRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19wbGF5bGlzdExvYWRlciA9IG5ldyBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuXG4gICAgICAgIC8vIFRPRE86IEhhbmRsZSBjbG9zZS5cbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCd3ZWJraXRzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuICAgICAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG5cbiAgICAgICAgdGVjaC5zZXRTcmMoVVJMLmNyZWF0ZU9iamVjdFVSTChtZWRpYVNvdXJjZSkpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUhhbmRsZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBNSU5fREVTSVJFRF9CVUZGRVJfU0laRSA9IDIwLFxuICAgIE1BWF9ERVNJUkVEX0JVRkZFUl9TSVpFID0gNDA7XG5cbi8qZnVuY3Rpb24gbG9hZFNlZ21lbnRBdFRpbWUoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBwcmVzZW50YXRpb25UaW1lLCBjYWxsYmFjaywgdGhpc0FyZykge1xuICAgIHZhciBoYXNOZXh0U2VnbWVudCA9IHNlZ21lbnRMb2FkZXIubG9hZFNlZ21lbnRBdFRpbWUocHJlc2VudGF0aW9uVGltZSk7XG4gICAgaWYgKCFoYXNOZXh0U2VnbWVudCkgeyByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7IH1cblxuICAgIHNlZ21lbnRMb2FkZXIub25lKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCBmdW5jdGlvbiBzZWdtZW50TG9hZGVkSGFuZGxlcihldmVudCkge1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUub25lKHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5ldmVudExpc3QuUVVFVUVfRU1QVFksIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7XG59Ki9cblxuZnVuY3Rpb24gU3RyZWFtTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX3NlZ21lbnRMb2FkZXIgPSBzZWdtZW50TG9hZGVyO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWU7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG59XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFJFQ0hFQ0tfU0VHTUVOVF9MT0FESU5HOiAncmVjaGVja1NlZ21lbnRMb2FkaW5nJ1xufTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19tZWRpYVR5cGU7IH07XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0U2VnbWVudExvYWRlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXI7IH07XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlOyB9O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLnN0YXJ0TG9hZGluZ1NlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG4gICAgLy90aGlzLl9fbG9hZGluZ1NlZ21lbnRzTW9uaXRvcigpO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHNlbGYuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG4gICAgfTtcblxuICAgIHRoaXMub24odGhpcy5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyKTtcblxuICAgIHRoaXMuX19jaGVja1NlZ21lbnRMb2FkaW5nKE1JTl9ERVNJUkVEX0JVRkZFUl9TSVpFLCBNQVhfREVTSVJFRF9CVUZGRVJfU0laRSk7XG59O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLnN0b3BMb2FkaW5nU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fcmVjaGVja1NlZ21lbnRMb2FkaW5nSGFuZGxlcikpIHsgcmV0dXJuOyB9XG5cbiAgICB0aGlzLm9mZih0aGlzLmV2ZW50TGlzdC5SRUNIRUNLX1NFR01FTlRfTE9BRElORywgdGhpcy5fX3JlY2hlY2tTZWdtZW50TG9hZGluZ0hhbmRsZXIpO1xuICAgIHRoaXMuX19yZWNoZWNrU2VnbWVudExvYWRpbmdIYW5kbGVyID0gdW5kZWZpbmVkO1xufTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5fX2NoZWNrU2VnbWVudExvYWRpbmcgPSBmdW5jdGlvbihtaW5EZXNpcmVkQnVmZmVyU2l6ZSwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHRlY2ggPSBzZWxmLl9fdGVjaCxcbiAgICAgICAgc2VnbWVudExvYWRlciA9IHNlbGYuX19zZWdtZW50TG9hZGVyLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLFxuICAgICAgICBjdXJyZW50VGltZSA9IHRlY2guY3VycmVudFRpbWUoKSxcbiAgICAgICAgY3VycmVudEJ1ZmZlclNpemUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWUuZGV0ZXJtaW5lQW1vdW50QnVmZmVyZWRGcm9tVGltZShjdXJyZW50VGltZSksXG4gICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0U2VnbWVudER1cmF0aW9uKCksXG4gICAgICAgIHRvdGFsRHVyYXRpb24gPSBzZWdtZW50TG9hZGVyLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFRvdGFsRHVyYXRpb24oKSxcbiAgICAgICAgZG93bmxvYWRQb2ludCA9IChjdXJyZW50VGltZSArIGN1cnJlbnRCdWZmZXJTaXplKSArIChzZWdtZW50RHVyYXRpb24gLyAyKSxcbiAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lLFxuICAgICAgICBzZWdtZW50RG93bmxvYWREZWxheTtcblxuICAgIGlmICgoZG93bmxvYWRQb2ludCA+PSB0b3RhbER1cmF0aW9uKSB8fCAoY3VycmVudEJ1ZmZlclNpemUgPj0gbWF4RGVzaXJlZEJ1ZmZlclNpemUpKSB7XG4gICAgICAgIC8vIEhvbGRpbmcgcGF0dGVybi4gS2VlcCBjaGVja2luZyBhdCBhIHJhdGUgb2Ygc2VnbWVudER1cmF0aW9uIHVudGlsIHRoZSBjb25kaXRpb24gY2hhbmdlcy5cbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREdXJhdGlvbiAqIDEwMDApKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50QnVmZmVyU2l6ZSA8PSAwKSB7XG4gICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShjdXJyZW50VGltZSk7XG4gICAgfSBlbHNlIGlmIChjdXJyZW50QnVmZmVyU2l6ZSA8IG1pbkRlc2lyZWRCdWZmZXJTaXplKSB7XG4gICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lID0gc2VnbWVudExvYWRlci5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbigpO1xuICAgICAgICBzZWdtZW50RG93bmxvYWREZWxheSA9IHNlZ21lbnREdXJhdGlvbiAtIGRvd25sb2FkUm91bmRUcmlwVGltZTtcbiAgICAgICAgaWYgKHNlZ21lbnREb3dubG9hZERlbGF5IDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYuX19sb2FkU2VnbWVudEF0VGltZShkb3dubG9hZFBvaW50KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCk7XG4gICAgICAgICAgICAgICAgY3VycmVudEJ1ZmZlclNpemUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWUuZGV0ZXJtaW5lQW1vdW50QnVmZmVyZWRGcm9tVGltZShjdXJyZW50VGltZSk7XG4gICAgICAgICAgICAgICAgZG93bmxvYWRQb2ludCA9IChjdXJyZW50VGltZSArIGN1cnJlbnRCdWZmZXJTaXplKSArIChzZWdtZW50RHVyYXRpb24gLyAyKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fbG9hZFNlZ21lbnRBdFRpbWUoZG93bmxvYWRQb2ludCk7XG4gICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5fX2xvYWRTZWdtZW50QXRUaW1lID0gZnVuY3Rpb24gbG9hZFNlZ21lbnRBdFRpbWUocHJlc2VudGF0aW9uVGltZSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExvYWRlciA9IHNlbGYuX19zZWdtZW50TG9hZGVyLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLFxuICAgICAgICBoYXNOZXh0U2VnbWVudCA9IHNlZ21lbnRMb2FkZXIubG9hZFNlZ21lbnRBdFRpbWUocHJlc2VudGF0aW9uVGltZSk7XG5cbiAgICBpZiAoIWhhc05leHRTZWdtZW50KSB7IHJldHVybiBoYXNOZXh0U2VnbWVudDsgfVxuXG4gICAgc2VnbWVudExvYWRlci5vbmUoc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIGZ1bmN0aW9uIHNlZ21lbnRMb2FkZWRIYW5kbGVyKGV2ZW50KSB7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5vbmUoc291cmNlQnVmZmVyRGF0YVF1ZXVlLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUkVDSEVDS19TRUdNRU5UX0xPQURJTkcsIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaGFzTmV4dFNlZ21lbnQ7XG59O1xuXG4vLyBUT0RPOiBNRVNTWS4gUkVGQUNUT1IuIChVU0UgRVZFTlRTPyBQQVNTIElOIFJFRlM/IFBBU1MgSU4gTUlOL01BWCBCVUZGRVIgU0laRT8gQ0hFQ0sgRk9SIEhBTFQgQ09ORElUSU9OIFZJQSBQQVNTRUQgSU4gRk4/KVxuLypTdHJlYW1Mb2FkZXIucHJvdG90eXBlLl9fbG9hZGluZ1NlZ21lbnRzTW9uaXRvciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExvYWRlciA9IHNlbGYuX19zZWdtZW50TG9hZGVyLFxuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzZWxmLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlLFxuICAgICAgICB0ZWNoID0gc2VsZi5fX3RlY2g7XG5cbiAgICBmdW5jdGlvbiBrZWVwTG9hZGluZ1NlZ21lbnRzKG1pbkRlc2lyZWRCdWZmZXJTaXplLCBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkge1xuICAgICAgICB2YXIgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCksXG4gICAgICAgICAgICBjdXJyZW50QnVmZmVyU2l6ZSA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5kZXRlcm1pbmVBbW91bnRCdWZmZXJlZEZyb21UaW1lKGN1cnJlbnRUaW1lKSxcbiAgICAgICAgICAgIHNlZ21lbnREdXJhdGlvbiA9IHNlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0U2VnbWVudER1cmF0aW9uKCksXG4gICAgICAgICAgICB0b3RhbER1cmF0aW9uID0gc2VnbWVudExvYWRlci5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRUb3RhbER1cmF0aW9uKCksXG4gICAgICAgICAgICBkb3dubG9hZFBvaW50ID0gKGN1cnJlbnRUaW1lICsgY3VycmVudEJ1ZmZlclNpemUpICsgKHNlZ21lbnREdXJhdGlvbiAvIDIpLFxuICAgICAgICAgICAgZG93bmxvYWRSb3VuZFRyaXBUaW1lLFxuICAgICAgICAgICAgc2VnbWVudERvd25sb2FkRGVsYXksXG4gICAgICAgICAgICBrZWVwTG9hZGluZ1NlZ21lbnRzSW50ZXJuID0gZnVuY3Rpb24oKSB7IGtlZXBMb2FkaW5nU2VnbWVudHMuY2FsbChzZWxmLCBtaW5EZXNpcmVkQnVmZmVyU2l6ZSwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpOyB9LFxuICAgICAgICAgICAgbG9hZFNlZ21lbnRBdFRpbWVJbnRlcm4gPSBmdW5jdGlvbih0aW1lKSB7IGxvYWRTZWdtZW50QXRUaW1lKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgdGltZSwga2VlcExvYWRpbmdTZWdtZW50c0ludGVybik7IH07XG5cbiAgICAgICAgaWYgKChkb3dubG9hZFBvaW50ID49IHRvdGFsRHVyYXRpb24pIHx8IChjdXJyZW50QnVmZmVyU2l6ZSA+PSBtYXhEZXNpcmVkQnVmZmVyU2l6ZSkpIHtcbiAgICAgICAgICAgIC8vIEhvbGRpbmcgcGF0dGVybi4gS2VlcCBjaGVja2luZyBhdCBhIHJhdGUgb2Ygc2VnbWVudER1cmF0aW9uIHVudGlsIHRoZSBjb25kaXRpb24gY2hhbmdlcy5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoa2VlcExvYWRpbmdTZWdtZW50c0ludGVybiwgTWF0aC5mbG9vcihzZWdtZW50RHVyYXRpb24gKiAxMDAwKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY3VycmVudEJ1ZmZlclNpemUgPD0gMCkge1xuICAgICAgICAgICAgbG9hZFNlZ21lbnRBdFRpbWVJbnRlcm4oY3VycmVudFRpbWUpO1xuICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWluRGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgICAgIGxvYWRTZWdtZW50QXRUaW1lSW50ZXJuKGRvd25sb2FkUG9pbnQpO1xuICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRCdWZmZXJTaXplIDwgbWF4RGVzaXJlZEJ1ZmZlclNpemUpIHtcbiAgICAgICAgICAgIGRvd25sb2FkUm91bmRUcmlwVGltZSA9IHNlZ21lbnRMb2FkZXIuZ2V0TGFzdERvd25sb2FkUm91bmRUcmlwVGltZVNwYW4oKTtcbiAgICAgICAgICAgIHNlZ21lbnREb3dubG9hZERlbGF5ID0gc2VnbWVudER1cmF0aW9uIC0gZG93bmxvYWRSb3VuZFRyaXBUaW1lO1xuICAgICAgICAgICAgaWYgKHNlZ21lbnREb3dubG9hZERlbGF5IDw9IDApIHtcbiAgICAgICAgICAgICAgICBsb2FkU2VnbWVudEF0VGltZUludGVybihkb3dubG9hZFBvaW50KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFRpbWUgPSB0ZWNoLmN1cnJlbnRUaW1lKCk7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRCdWZmZXJTaXplID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlLmRldGVybWluZUFtb3VudEJ1ZmZlcmVkRnJvbVRpbWUoY3VycmVudFRpbWUpO1xuICAgICAgICAgICAgICAgICAgICBkb3dubG9hZFBvaW50ID0gKGN1cnJlbnRUaW1lICsgY3VycmVudEJ1ZmZlclNpemUpICsgKHNlZ21lbnREdXJhdGlvbiAvIDIpO1xuICAgICAgICAgICAgICAgICAgICBsb2FkU2VnbWVudEF0VGltZUludGVybihkb3dubG9hZFBvaW50KTtcbiAgICAgICAgICAgICAgICB9LCBNYXRoLmZsb29yKHNlZ21lbnREb3dubG9hZERlbGF5ICogMTAwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAga2VlcExvYWRpbmdTZWdtZW50cyhNSU5fREVTSVJFRF9CVUZGRVJfU0laRSwgTUFYX0RFU0lSRURfQlVGRkVSX1NJWkUpO1xufTsqL1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTdHJlYW1Mb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtTG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKSxcbiAgICBwYXJzZVJvb3RVcmwgPSB1dGlsLnBhcnNlUm9vdFVybCxcbiAgICBjcmVhdGVNcGRPYmplY3QsXG4gICAgY3JlYXRlUGVyaW9kT2JqZWN0LFxuICAgIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QsXG4gICAgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QsXG4gICAgY3JlYXRlU2VnbWVudFRlbXBsYXRlLFxuICAgIGdldE1wZCxcbiAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlLFxuICAgIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsXG4gICAgZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWU7XG5cbi8vIFRPRE86IFNob3VsZCB0aGlzIGV4aXN0IG9uIG1wZCBkYXRhdmlldyBvciBhdCBhIGhpZ2hlciBsZXZlbD9cbi8vIFRPRE86IFJlZmFjdG9yLiBDb3VsZCBiZSBtb3JlIGVmZmljaWVudCAoUmVjdXJzaXZlIGZuPyBVc2UgZWxlbWVudC5nZXRFbGVtZW50c0J5TmFtZSgnQmFzZVVybCcpWzBdPykuXG4vLyBUT0RPOiBDdXJyZW50bHkgYXNzdW1pbmcgKkVJVEhFUiogPEJhc2VVUkw+IG5vZGVzIHdpbGwgcHJvdmlkZSBhbiBhYnNvbHV0ZSBiYXNlIHVybCAoaWUgcmVzb2x2ZSB0byAnaHR0cDovLycgZXRjKVxuLy8gVE9ETzogKk9SKiB3ZSBzaG91bGQgdXNlIHRoZSBiYXNlIHVybCBvZiB0aGUgaG9zdCBvZiB0aGUgTVBEIG1hbmlmZXN0LlxudmFyIGJ1aWxkQmFzZVVybCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICB2YXIgZWxlbUhpZXJhcmNoeSA9IFt4bWxOb2RlXS5jb25jYXQoeG1sZnVuLmdldEFuY2VzdG9ycyh4bWxOb2RlKSksXG4gICAgICAgIGZvdW5kTG9jYWxCYXNlVXJsID0gZmFsc2U7XG4gICAgLy92YXIgYmFzZVVybHMgPSBfLm1hcChlbGVtSGllcmFyY2h5LCBmdW5jdGlvbihlbGVtKSB7XG4gICAgdmFyIGJhc2VVcmxzID0gZWxlbUhpZXJhcmNoeS5tYXAoZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoZm91bmRMb2NhbEJhc2VVcmwpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIGlmICghZWxlbS5oYXNDaGlsZE5vZGVzKCkpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBjaGlsZDtcbiAgICAgICAgZm9yICh2YXIgaT0wOyBpPGVsZW0uY2hpbGROb2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBlbGVtLmNoaWxkTm9kZXMuaXRlbShpKTtcbiAgICAgICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0Jhc2VVUkwnKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRFbGVtID0gY2hpbGQuY2hpbGROb2Rlcy5pdGVtKDApO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0VmFsdWUgPSB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgICAgIGlmICh0ZXh0VmFsdWUuaW5kZXhPZignaHR0cDovLycpID09PSAwKSB7IGZvdW5kTG9jYWxCYXNlVXJsID0gdHJ1ZTsgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH0pO1xuXG4gICAgdmFyIGJhc2VVcmwgPSBiYXNlVXJscy5yZXZlcnNlKCkuam9pbignJyk7XG4gICAgaWYgKCFiYXNlVXJsKSB7IHJldHVybiBwYXJzZVJvb3RVcmwoeG1sTm9kZS5iYXNlVVJJKTsgfVxuICAgIHJldHVybiBiYXNlVXJsO1xufTtcblxudmFyIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMgPSBbXG4gICAgJ0FkYXB0YXRpb25TZXQnLFxuICAgICdSZXByZXNlbnRhdGlvbicsXG4gICAgJ1N1YlJlcHJlc2VudGF0aW9uJ1xuXTtcblxudmFyIGhhc0NvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMuaW5kZXhPZihlbGVtLm5vZGVOYW1lKSA+PSAwO1xufTtcblxudmFyIGRvZXNudEhhdmVDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiAhaGFzQ29tbW9uUHJvcGVydGllcyhlbGVtKTtcbn07XG5cbi8vIENvbW1vbiBBdHRyc1xudmFyIGdldFdpZHRoID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCd3aWR0aCcpLFxuICAgIGdldEhlaWdodCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnaGVpZ2h0JyksXG4gICAgZ2V0RnJhbWVSYXRlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdmcmFtZVJhdGUnKSxcbiAgICBnZXRNaW1lVHlwZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnbWltZVR5cGUnKSxcbiAgICBnZXRDb2RlY3MgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2NvZGVjcycpO1xuXG52YXIgZ2V0U2VnbWVudFRlbXBsYXRlWG1sID0geG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCgnU2VnbWVudFRlbXBsYXRlJywgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMpO1xuXG4vLyBNUEQgQXR0ciBmbnNcbnZhciBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbicpLFxuICAgIGdldFR5cGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0eXBlJyksXG4gICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21pbmltdW1VcGRhdGVQZXJpb2QnKTtcblxuLy8gUmVwcmVzZW50YXRpb24gQXR0ciBmbnNcbnZhciBnZXRJZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2lkJyksXG4gICAgZ2V0QmFuZHdpZHRoID0geG1sZnVuLmdldEF0dHJGbignYmFuZHdpZHRoJyk7XG5cbi8vIFNlZ21lbnRUZW1wbGF0ZSBBdHRyIGZuc1xudmFyIGdldEluaXRpYWxpemF0aW9uID0geG1sZnVuLmdldEF0dHJGbignaW5pdGlhbGl6YXRpb24nKSxcbiAgICBnZXRNZWRpYSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhJyksXG4gICAgZ2V0RHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdkdXJhdGlvbicpLFxuICAgIGdldFRpbWVzY2FsZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVzY2FsZScpLFxuICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdwcmVzZW50YXRpb25UaW1lT2Zmc2V0JyksXG4gICAgZ2V0U3RhcnROdW1iZXIgPSB4bWxmdW4uZ2V0QXR0ckZuKCdzdGFydE51bWJlcicpO1xuXG4vLyBUT0RPOiBSZXBlYXQgY29kZS4gQWJzdHJhY3QgYXdheSAoUHJvdG90eXBhbCBJbmhlcml0YW5jZS9PTyBNb2RlbD8gT2JqZWN0IGNvbXBvc2VyIGZuPylcbmNyZWF0ZU1wZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UGVyaW9kczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbmltdW1VcGRhdGVQZXJpb2QsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWwoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElkLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgeG1sTm9kZSksXG4gICAgICAgIGdldEZyYW1lUmF0ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEZyYW1lUmF0ZSwgeG1sTm9kZSksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldENvZGVjczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldENvZGVjcywgeG1sTm9kZSksXG4gICAgICAgIGdldEJhc2VVcmw6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihidWlsZEJhc2VVcmwsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50VGVtcGxhdGUgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SW5pdGlhbGl6YXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRNZWRpYTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVzY2FsZSwgeG1sTm9kZSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlciwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUgPSBmdW5jdGlvbih4bWxOb2RlLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIGlmICghdGFnTmFtZSB8fCAheG1sTm9kZSB8fCAheG1sTm9kZS5wYXJlbnROb2RlKSB7IHJldHVybiBudWxsOyB9XG4gICAgaWYgKCF4bWxOb2RlLnBhcmVudE5vZGUuaGFzT3duUHJvcGVydHkoJ25vZGVOYW1lJykpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGlmICh4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUgPT09IHRhZ05hbWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpID8gbWFwRm4oeG1sTm9kZS5wYXJlbnROb2RlKSA6IHhtbE5vZGUucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUucGFyZW50Tm9kZSwgdGFnTmFtZSwgbWFwRm4pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNcGQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsLFxuICAgIC8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIFNFQ09ORFNfSU5fWUVBUiA9IDM2NSAqIDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01PTlRIID0gMzAgKiAyNCAqIDYwICogNjAsIC8vIG5vdCBwcmVjaXNlIVxuICAgIFNFQ09ORFNfSU5fREFZID0gMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fSE9VUiA9IDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NSU4gPSA2MCxcbiAgICBNSU5VVEVTX0lOX0hPVVIgPSA2MCxcbiAgICBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUyA9IDEwMDAsXG4gICAgZHVyYXRpb25SZWdleCA9IC9eUCgoW1xcZC5dKilZKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKUQpP1Q/KChbXFxkLl0qKUgpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopUyk/LztcblxucGFyc2VSb290VXJsID0gZnVuY3Rpb24odXJsKSB7XG4gICAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJy8nKSA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignPycpICE9PSAtMSkge1xuICAgICAgICB1cmwgPSB1cmwuc3Vic3RyaW5nKDAsIHVybC5pbmRleE9mKCc/JykpO1xuICAgIH1cblxuICAgIHJldHVybiB1cmwuc3Vic3RyaW5nKDAsIHVybC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59O1xuXG4vLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZnVuY3Rpb24gKHN0cikge1xuICAgIC8vc3RyID0gXCJQMTBZMTBNMTBEVDEwSDEwTTEwLjFTXCI7XG4gICAgdmFyIG1hdGNoID0gZHVyYXRpb25SZWdleC5leGVjKHN0cik7XG4gICAgcmV0dXJuIChwYXJzZUZsb2F0KG1hdGNoWzJdIHx8IDApICogU0VDT05EU19JTl9ZRUFSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs0XSB8fCAwKSAqIFNFQ09ORFNfSU5fTU9OVEggK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzZdIHx8IDApICogU0VDT05EU19JTl9EQVkgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzhdIHx8IDApICogU0VDT05EU19JTl9IT1VSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMF0gfHwgMCkgKiBTRUNPTkRTX0lOX01JTiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTJdIHx8IDApKTtcbn07XG5cbnZhciB1dGlsID0ge1xuICAgIHBhcnNlUm9vdFVybDogcGFyc2VSb290VXJsLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWw7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgc2VnbWVudFRlbXBsYXRlID0gcmVxdWlyZSgnLi9zZWdtZW50VGVtcGxhdGUnKSxcbiAgICBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSxcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSxcbiAgICBnZXRUeXBlLFxuICAgIGdldEJhbmR3aWR0aCxcbiAgICBnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSxcbiAgICBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSxcbiAgICBnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGU7XG5cbmdldFR5cGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZ2V0QmFuZHdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbn07XG5cbmdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgcGVyaW9kLXJlbGF0aXZlIHByZXNlbnRhdGlvbiB0aW1lXG4gICAgdmFyIG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKCksXG4gICAgICAgIHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBOdW1iZXIocGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pKSxcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZU9mZnNldCA9IE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0KCkpO1xuICAgIHJldHVybiBOdW1iZXIocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiAtIHByZXNlbnRhdGlvblRpbWVPZmZzZXQpO1xufTtcblxuZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgc2VnbWVudFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCk7XG4gICAgcmV0dXJuIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0RHVyYXRpb24oKSkgLyBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldFRpbWVzY2FsZSgpKTtcbn07XG5cbmdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTWF0aC5jZWlsKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC8gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG59O1xuXG5nZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRTdGFydE51bWJlcigpKTtcbn07XG5cbmdldEVuZE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSArIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAtIDE7XG59O1xuXG5jcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0VHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFNlZ21lbnREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbFNlZ21lbnRDb3VudDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0RW5kTnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIC8vIFRPRE86IEV4dGVybmFsaXplXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBpbml0aWFsaXphdGlvbiA9IHt9O1xuICAgICAgICAgICAgaW5pdGlhbGl6YXRpb24uZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICAgICAgICAgIHJlcHJlc2VudGF0aW9uSWQgPSByZXByZXNlbnRhdGlvbi5nZXRJZCgpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRJbml0aWFsaXphdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25JZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBpbml0aWFsaXphdGlvbjtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5TnVtYmVyOiBmdW5jdGlvbihudW1iZXIpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTsgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5VGltZTogZnVuY3Rpb24oc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgc2Vjb25kcyk7IH1cbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIG51bWJlcikge1xuICAgIHZhciBzZWdtZW50ID0ge307XG4gICAgc2VnbWVudC5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICBzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldE1lZGlhKCksXG4gICAgICAgICAgICByZXBsYWNlZElkVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbi5nZXRJZCgpKSxcbiAgICAgICAgICAgIC8vIFRPRE86IFNpbmNlICRUaW1lJC10ZW1wbGF0ZWQgc2VnbWVudCBVUkxzIHNob3VsZCBvbmx5IGV4aXN0IGluIGNvbmp1bmN0aW9uIHcvYSA8U2VnbWVudFRpbWVsaW5lPixcbiAgICAgICAgICAgIC8vIFRPRE86IGNhbiBjdXJyZW50bHkgYXNzdW1lIGEgJE51bWJlciQtYmFzZWQgdGVtcGxhdGVkIHVybC5cbiAgICAgICAgICAgIC8vIFRPRE86IEVuZm9yY2UgbWluL21heCBudW1iZXIgcmFuZ2UgKGJhc2VkIG9uIHNlZ21lbnRMaXN0IHN0YXJ0TnVtYmVyICYgZW5kTnVtYmVyKVxuICAgICAgICAgICAgcmVwbGFjZWROdW1iZXJVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRJZFVybCwgJ051bWJlcicsIG51bWJlcik7XG4gICAgICAgIHJldHVybiBiYXNlVXJsICsgcmVwbGFjZWROdW1iZXJVcmw7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbnVtYmVyICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0RHVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVE9ETzogSGFuZGxlIGxhc3Qgc2VnbWVudCAobGlrZWx5IDwgc2VnbWVudCBkdXJhdGlvbilcbiAgICAgICAgcmV0dXJuIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbnVtYmVyOyB9O1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKSB7XG4gICAgdmFyIHNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIG51bWJlciA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIHNlZ21lbnREdXJhdGlvbiksXG4gICAgICAgIHNlZ21lbnQgPSBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7XG4gICAgY29uc29sZS5sb2coJ1NlZ21lbnQgRHVyYXRpb246ICcgKyBzZWdtZW50RHVyYXRpb24gKyAnLCBTZWNvbmRzOiAnICsgc2Vjb25kcyArICcsIE51bWJlcjogJyArIG51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5mdW5jdGlvbiBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgaWYgKCFyZXByZXNlbnRhdGlvbikgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpKSB7IHJldHVybiBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7IH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb247XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZWdtZW50VGVtcGxhdGUsXG4gICAgemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU7XG5cbnplcm9QYWRUb0xlbmd0aCA9IGZ1bmN0aW9uIChudW1TdHIsIG1pblN0ckxlbmd0aCkge1xuICAgIHdoaWxlIChudW1TdHIubGVuZ3RoIDwgbWluU3RyTGVuZ3RoKSB7XG4gICAgICAgIG51bVN0ciA9ICcwJyArIG51bVN0cjtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVtU3RyO1xufTtcblxucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHRva2VuLCB2YWx1ZSkge1xuXG4gICAgdmFyIHN0YXJ0UG9zID0gMCxcbiAgICAgICAgZW5kUG9zID0gMCxcbiAgICAgICAgdG9rZW5MZW4gPSB0b2tlbi5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZyA9ICclMCcsXG4gICAgICAgIGZvcm1hdFRhZ0xlbiA9IGZvcm1hdFRhZy5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZ1BvcyxcbiAgICAgICAgc3BlY2lmaWVyLFxuICAgICAgICB3aWR0aCxcbiAgICAgICAgcGFkZGVkVmFsdWU7XG5cbiAgICAvLyBrZWVwIGxvb3Bpbmcgcm91bmQgdW50aWwgYWxsIGluc3RhbmNlcyBvZiA8dG9rZW4+IGhhdmUgYmVlblxuICAgIC8vIHJlcGxhY2VkLiBvbmNlIHRoYXQgaGFzIGhhcHBlbmVkLCBzdGFydFBvcyBiZWxvdyB3aWxsIGJlIC0xXG4gICAgLy8gYW5kIHRoZSBjb21wbGV0ZWQgdXJsIHdpbGwgYmUgcmV0dXJuZWQuXG4gICAgd2hpbGUgKHRydWUpIHtcblxuICAgICAgICAvLyBjaGVjayBpZiB0aGVyZSBpcyBhIHZhbGlkICQ8dG9rZW4+Li4uJCBpZGVudGlmaWVyXG4gICAgICAgIC8vIGlmIG5vdCwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIHN0YXJ0UG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcgKyB0b2tlbik7XG4gICAgICAgIGlmIChzdGFydFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoZSBuZXh0ICckJyBtdXN0IGJlIHRoZSBlbmQgb2YgdGhlIGlkZW50aWZlclxuICAgICAgICAvLyBpZiB0aGVyZSBpc24ndCBvbmUsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBlbmRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChlbmRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBub3cgc2VlIGlmIHRoZXJlIGlzIGFuIGFkZGl0aW9uYWwgZm9ybWF0IHRhZyBzdWZmaXhlZCB0b1xuICAgICAgICAvLyB0aGUgaWRlbnRpZmllciB3aXRoaW4gdGhlIGVuY2xvc2luZyAnJCcgY2hhcmFjdGVyc1xuICAgICAgICBmb3JtYXRUYWdQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKGZvcm1hdFRhZywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChmb3JtYXRUYWdQb3MgPiBzdGFydFBvcyAmJiBmb3JtYXRUYWdQb3MgPCBlbmRQb3MpIHtcblxuICAgICAgICAgICAgc3BlY2lmaWVyID0gdGVtcGxhdGVTdHIuY2hhckF0KGVuZFBvcyAtIDEpO1xuICAgICAgICAgICAgd2lkdGggPSBwYXJzZUludCh0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZm9ybWF0VGFnUG9zICsgZm9ybWF0VGFnTGVuLCBlbmRQb3MgLSAxKSwgMTApO1xuXG4gICAgICAgICAgICAvLyBzdXBwb3J0IHRoZSBtaW5pbXVtIHNwZWNpZmllcnMgcmVxdWlyZWQgYnkgSUVFRSAxMDAzLjFcbiAgICAgICAgICAgIC8vIChkLCBpICwgbywgdSwgeCwgYW5kIFgpIGZvciBjb21wbGV0ZW5lc3NcbiAgICAgICAgICAgIHN3aXRjaCAoc3BlY2lmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJlYXQgYWxsIGludCB0eXBlcyBhcyB1aW50LFxuICAgICAgICAgICAgICAgIC8vIGhlbmNlIGRlbGliZXJhdGUgZmFsbHRocm91Z2hcbiAgICAgICAgICAgICAgICBjYXNlICdkJzpcbiAgICAgICAgICAgICAgICBjYXNlICdpJzpcbiAgICAgICAgICAgICAgICBjYXNlICd1JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoKSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd4JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ1gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdvJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoOCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1Vuc3VwcG9ydGVkL2ludmFsaWQgSUVFRSAxMDAzLjEgZm9ybWF0IGlkZW50aWZpZXIgc3RyaW5nIGluIFVSTCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVtcGxhdGVTdHIgPSB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoMCwgc3RhcnRQb3MpICsgcGFkZGVkVmFsdWUgKyB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZW5kUG9zICsgMSk7XG4gICAgfVxufTtcblxudW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0cikge1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJCQnKS5qb2luKCckJyk7XG59O1xuXG5yZXBsYWNlSURGb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdGVtcGxhdGVTdHIuaW5kZXhPZignJFJlcHJlc2VudGF0aW9uSUQkJykgPT09IC0xKSB7IHJldHVybiB0ZW1wbGF0ZVN0cjsgfVxuICAgIHZhciB2ID0gdmFsdWUudG9TdHJpbmcoKTtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyRSZXByZXNlbnRhdGlvbklEJCcpLmpvaW4odik7XG59O1xuXG5zZWdtZW50VGVtcGxhdGUgPSB7XG4gICAgemVyb1BhZFRvTGVuZ3RoOiB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGU6IHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGU6IHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU6IHJlcGxhY2VJREZvclRlbXBsYXRlXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHNlZ21lbnRUZW1wbGF0ZTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBldmVudE1nciA9IHJlcXVpcmUoJy4vZXZlbnRNYW5hZ2VyLmpzJyksXG4gICAgZXZlbnREaXNwYXRjaGVyTWl4aW4gPSB7XG4gICAgICAgIHRyaWdnZXI6IGZ1bmN0aW9uKGV2ZW50T2JqZWN0KSB7IGV2ZW50TWdyLnRyaWdnZXIodGhpcywgZXZlbnRPYmplY3QpOyB9LFxuICAgICAgICBvbmU6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub25lKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvbjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb2ZmOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9mZih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfVxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnREaXNwYXRjaGVyTWl4aW47IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmlkZW9qcyA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS52aWRlb2pzLFxuICAgIGV2ZW50TWFuYWdlciA9IHtcbiAgICAgICAgdHJpZ2dlcjogdmlkZW9qcy50cmlnZ2VyLFxuICAgICAgICBvbmU6IHZpZGVvanMub25lLFxuICAgICAgICBvbjogdmlkZW9qcy5vbixcbiAgICAgICAgb2ZmOiB2aWRlb2pzLm9mZlxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnRNYW5hZ2VyO1xuIiwiLyoqXG4gKiBDcmVhdGVkIGJ5IGNwaWxsc2J1cnkgb24gMTIvMy8xNC5cbiAqL1xuOyhmdW5jdGlvbigpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgcm9vdCA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKSxcbiAgICAgICAgdmlkZW9qcyA9IHJvb3QudmlkZW9qcyxcbiAgICAgICAgU291cmNlSGFuZGxlciA9IHJlcXVpcmUoJy4vU291cmNlSGFuZGxlcicpO1xuXG4gICAgaWYgKCF2aWRlb2pzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlIHZpZGVvLmpzIGxpYnJhcnkgbXVzdCBiZSBpbmNsdWRlZCB0byB1c2UgdGhpcyBNUEVHLURBU0ggc291cmNlIGhhbmRsZXIuJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FuSGFuZGxlU291cmNlKHNvdXJjZSkge1xuICAgICAgICAvLyBFeHRlcm5hbGl6ZSBpZiB1c2VkIGVsc2V3aGVyZS4gUG90ZW50aWFsbHkgdXNlIGNvbnN0YW50IGZ1bmN0aW9uLlxuICAgICAgICB2YXIgZG9lc250SGFuZGxlU291cmNlID0gJycsXG4gICAgICAgICAgICBtYXliZUhhbmRsZVNvdXJjZSA9ICdtYXliZScsXG4gICAgICAgICAgICBkZWZhdWx0SGFuZGxlU291cmNlID0gZG9lc250SGFuZGxlU291cmNlO1xuXG4gICAgICAgIC8vIFRPRE86IFVzZSBzYWZlciB2anMgY2hlY2sgKGUuZy4gaGFuZGxlcyBJRSBjb25kaXRpb25zKT9cbiAgICAgICAgLy8gUmVxdWlyZXMgTWVkaWEgU291cmNlIEV4dGVuc2lvbnNcbiAgICAgICAgaWYgKCEocm9vdC5NZWRpYVNvdXJjZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBkb2VzbnRIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgdHlwZSBpcyBzdXBwb3J0ZWRcbiAgICAgICAgaWYgKC9hcHBsaWNhdGlvblxcL2Rhc2hcXCt4bWwvLnRlc3Qoc291cmNlLnR5cGUpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnbWF0Y2hlZCB0eXBlJyk7XG4gICAgICAgICAgICByZXR1cm4gbWF5YmVIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleHRlbnNpb24gbWF0Y2hlc1xuICAgICAgICBpZiAoL1xcLm1wZCQvaS50ZXN0KHNvdXJjZS5zcmMpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnbWF0Y2hlZCBleHRlbnNpb24nKTtcbiAgICAgICAgICAgIHJldHVybiBtYXliZUhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkZWZhdWx0SGFuZGxlU291cmNlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhhbmRsZVNvdXJjZShzb3VyY2UsIHRlY2gpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCk7XG4gICAgfVxuXG4gICAgLy8gUmVnaXN0ZXIgdGhlIHNvdXJjZSBoYW5kbGVyXG4gICAgdmlkZW9qcy5IdG1sNS5yZWdpc3RlclNvdXJjZUhhbmRsZXIoe1xuICAgICAgICBjYW5IYW5kbGVTb3VyY2U6IGNhbkhhbmRsZVNvdXJjZSxcbiAgICAgICAgaGFuZGxlU291cmNlOiBoYW5kbGVTb3VyY2VcbiAgICB9LCAwKTtcblxufS5jYWxsKHRoaXMpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgdHJ1dGh5ID0gcmVxdWlyZSgnLi4vdXRpbC90cnV0aHkuanMnKSxcbiAgICBpc1N0cmluZyA9IHJlcXVpcmUoJy4uL3V0aWwvaXNTdHJpbmcuanMnKSxcbiAgICBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgbG9hZE1hbmlmZXN0ID0gcmVxdWlyZSgnLi9sb2FkTWFuaWZlc3QuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbiA9IHJlcXVpcmUoJy4uL2Rhc2gvc2VnbWVudHMvZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbi5qcycpLFxuICAgIGdldE1wZCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIGdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24sXG4gICAgZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL01lZGlhVHlwZXMuanMnKSxcbiAgICBERUZBVUxUX1RZUEUgPSBtZWRpYVR5cGVzWzBdO1xuXG5nZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUgPSBmdW5jdGlvbihtaW1lVHlwZSwgdHlwZXMpIHtcbiAgICBpZiAoIWlzU3RyaW5nKG1pbWVUeXBlKSkgeyByZXR1cm4gREVGQVVMVF9UWVBFOyB9XG4gICAgdmFyIG1hdGNoZWRUeXBlID0gdHlwZXMuZmluZChmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgIHJldHVybiAoISFtaW1lVHlwZSAmJiBtaW1lVHlwZS5pbmRleE9mKHR5cGUpID49IDApO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGV4aXN0eShtYXRjaGVkVHlwZSkgPyBtYXRjaGVkVHlwZSA6IERFRkFVTFRfVFlQRTtcbn07XG5cbi8vIFRPRE86IE1vdmUgdG8gb3duIG1vZHVsZSBpbiBkYXNoIHBhY2thZ2Ugc29tZXdoZXJlXG5nZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgY29kZWNTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRDb2RlY3MoKTtcbiAgICB2YXIgdHlwZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1pbWVUeXBlKCk7XG5cbiAgICAvL05PVEU6IExFQURJTkcgWkVST1MgSU4gQ09ERUMgVFlQRS9TVUJUWVBFIEFSRSBURUNITklDQUxMWSBOT1QgU1BFQyBDT01QTElBTlQsIEJVVCBHUEFDICYgT1RIRVJcbiAgICAvLyBEQVNIIE1QRCBHRU5FUkFUT1JTIFBST0RVQ0UgVEhFU0UgTk9OLUNPTVBMSUFOVCBWQUxVRVMuIEhBTkRMSU5HIEhFUkUgRk9SIE5PVy5cbiAgICAvLyBTZWU6IFJGQyA2MzgxIFNlYy4gMy40IChodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjM4MSNzZWN0aW9uLTMuNClcbiAgICB2YXIgcGFyc2VkQ29kZWMgPSBjb2RlY1N0ci5zcGxpdCgnLicpLm1hcChmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eMCsoPyFcXC58JCkvLCAnJyk7XG4gICAgfSk7XG4gICAgdmFyIHByb2Nlc3NlZENvZGVjU3RyID0gcGFyc2VkQ29kZWMuam9pbignLicpO1xuXG4gICAgcmV0dXJuICh0eXBlU3RyICsgJztjb2RlY3M9XCInICsgcHJvY2Vzc2VkQ29kZWNTdHIgKyAnXCInKTtcbn07XG5cblxuZnVuY3Rpb24gTWFuaWZlc3Qoc291cmNlVXJpLCBhdXRvTG9hZCkge1xuICAgIHRoaXMuX19hdXRvTG9hZCA9IHRydXRoeShhdXRvTG9hZCk7XG4gICAgdGhpcy5zZXRTb3VyY2VVcmkoc291cmNlVXJpKTtcbn1cblxuTWFuaWZlc3QucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBNQU5JRkVTVF9MT0FERUQ6ICdtYW5pZmVzdExvYWRlZCdcbn07XG5cblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFNvdXJjZVVyaSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fc291cmNlVXJpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLnNldFNvdXJjZVVyaSA9IGZ1bmN0aW9uIHNldFNvdXJjZVVyaShzb3VyY2VVcmkpIHtcbiAgICAvLyBUT0RPOiAnZXhpc3R5KCknIGNoZWNrIGZvciBib3RoP1xuICAgIGlmIChzb3VyY2VVcmkgPT09IHRoaXMuX19zb3VyY2VVcmkpIHsgcmV0dXJuOyB9XG5cbiAgICAvLyBUT0RPOiBpc1N0cmluZygpIGNoZWNrPyAnZXhpc3R5KCknIGNoZWNrP1xuICAgIGlmICghc291cmNlVXJpKSB7XG4gICAgICAgIHRoaXMuX19jbGVhclNvdXJjZVVyaSgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IHNvdXJjZVVyaTtcbiAgICBpZiAodGhpcy5fX2F1dG9Mb2FkKSB7XG4gICAgICAgIC8vIFRPRE86IEltcGwgYW55IGNsZWFudXAgZnVuY3Rpb25hbGl0eSBhcHByb3ByaWF0ZSBiZWZvcmUgbG9hZC5cbiAgICAgICAgdGhpcy5sb2FkKCk7XG4gICAgfVxufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLl9fY2xlYXJTb3VyY2VVcmkgPSBmdW5jdGlvbiBjbGVhclNvdXJjZVVyaSgpIHtcbiAgICB0aGlzLl9fc291cmNlVXJpID0gbnVsbDtcbiAgICB0aGlzLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAvLyBUT0RPOiBpbXBsIGFueSBvdGhlciBjbGVhbnVwIGZ1bmN0aW9uYWxpdHlcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24gbG9hZCgvKiBvcHRpb25hbCAqLyBjYWxsYmFja0ZuKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGxvYWRNYW5pZmVzdChzZWxmLl9fc291cmNlVXJpLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHNlbGYuX19tYW5pZmVzdCA9IGRhdGEubWFuaWZlc3RYbWw7XG4gICAgICAgIHNlbGYuX19zZXR1cFVwZGF0ZUludGVydmFsKCk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuTUFOSUZFU1RfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWxmLl9fbWFuaWZlc3R9KTtcbiAgICAgICAgaWYgKGlzRnVuY3Rpb24oY2FsbGJhY2tGbikpIHsgY2FsbGJhY2tGbihkYXRhLm1hbmlmZXN0WG1sKTsgfVxuICAgIH0pO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBjbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpKSB7IHJldHVybjsgfVxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fX3VwZGF0ZUludGVydmFsKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5fX3NldHVwVXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBzZXR1cFVwZGF0ZUludGVydmFsKCkge1xuICAgIGlmICh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpIHsgc2VsZi5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7IH1cbiAgICBpZiAoIXRoaXMuZ2V0U2hvdWxkVXBkYXRlKCkpIHsgcmV0dXJuOyB9XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBtaW5VcGRhdGVSYXRlID0gMixcbiAgICAgICAgdXBkYXRlUmF0ZSA9IE1hdGgubWF4KHRoaXMuZ2V0VXBkYXRlUmF0ZSgpLCBtaW5VcGRhdGVSYXRlKTtcbiAgICB0aGlzLl9fdXBkYXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgc2VsZi5sb2FkKCk7XG4gICAgfSwgdXBkYXRlUmF0ZSk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0TWVkaWFTZXRCeVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVNldEJ5VHlwZSh0eXBlKSB7XG4gICAgaWYgKG1lZGlhVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHsgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHR5cGUuIFZhbHVlIG11c3QgYmUgb25lIG9mOiAnICsgbWVkaWFUeXBlcy5qb2luKCcsICcpKTsgfVxuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCA9IGFkYXB0YXRpb25TZXRzLmZpbmQoZnVuY3Rpb24oYWRhcHRhdGlvblNldCkge1xuICAgICAgICAgICAgcmV0dXJuIChnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUoYWRhcHRhdGlvblNldC5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKSA9PT0gdHlwZSk7XG4gICAgICAgIH0pO1xuICAgIGlmICghZXhpc3R5KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBuZXcgTWVkaWFTZXQoYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2gpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldE1lZGlhU2V0cyA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0cygpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgbWVkaWFTZXRzID0gYWRhcHRhdGlvblNldHMubWFwKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHsgcmV0dXJuIG5ldyBNZWRpYVNldChhZGFwdGF0aW9uU2V0KTsgfSk7XG4gICAgcmV0dXJuIG1lZGlhU2V0cztcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRTdHJlYW1UeXBlID0gZnVuY3Rpb24gZ2V0U3RyZWFtVHlwZSgpIHtcbiAgICB2YXIgc3RyZWFtVHlwZSA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldFR5cGUoKTtcbiAgICByZXR1cm4gc3RyZWFtVHlwZTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRVcGRhdGVSYXRlID0gZnVuY3Rpb24gZ2V0VXBkYXRlUmF0ZSgpIHtcbiAgICB2YXIgbWluaW11bVVwZGF0ZVBlcmlvZCA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3QpLmdldE1pbmltdW1VcGRhdGVQZXJpb2QoKTtcbiAgICByZXR1cm4gTnVtYmVyKG1pbmltdW1VcGRhdGVQZXJpb2QpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFNob3VsZFVwZGF0ZSA9IGZ1bmN0aW9uIGdldFNob3VsZFVwZGF0ZSgpIHtcbiAgICB2YXIgaXNEeW5hbWljID0gKHRoaXMuZ2V0U3RyZWFtVHlwZSgpID09PSAnZHluYW1pYycpLFxuICAgICAgICBoYXNWYWxpZFVwZGF0ZVJhdGUgPSAodGhpcy5nZXRVcGRhdGVSYXRlKCkgPiAwKTtcbiAgICByZXR1cm4gKGlzRHluYW1pYyAmJiBoYXNWYWxpZFVwZGF0ZVJhdGUpO1xufTtcblxuZXh0ZW5kT2JqZWN0KE1hbmlmZXN0LnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5mdW5jdGlvbiBNZWRpYVNldChhZGFwdGF0aW9uU2V0KSB7XG4gICAgLy8gVE9ETzogQWRkaXRpb25hbCBjaGVja3MgJiBFcnJvciBUaHJvd2luZ1xuICAgIHRoaXMuX19hZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldDtcbn1cblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1lZGlhVHlwZSA9IGZ1bmN0aW9uIGdldE1lZGlhVHlwZSgpIHtcbiAgICB2YXIgdHlwZSA9IGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSh0aGlzLmdldE1pbWVUeXBlKCksIG1lZGlhVHlwZXMpO1xuICAgIHJldHVybiB0eXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldE1pbWVUeXBlID0gZnVuY3Rpb24gZ2V0TWltZVR5cGUoKSB7XG4gICAgdmFyIG1pbWVUeXBlID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKTtcbiAgICByZXR1cm4gbWltZVR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyVHlwZSA9IGZ1bmN0aW9uIGdldFNvdXJjZUJ1ZmZlclR5cGUoKSB7XG4gICAgLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZSBjb2RlY3MgYXNzb2NpYXRlZCB3aXRoIGVhY2ggc3RyZWFtIHZhcmlhbnQvcmVwcmVzZW50YXRpb25cbiAgICAvLyB3aWxsIGJlIHNpbWlsYXIgZW5vdWdoIHRoYXQgeW91IHdvbid0IGhhdmUgdG8gcmUtY3JlYXRlIHRoZSBzb3VyY2UtYnVmZmVyIHdoZW4gc3dpdGNoaW5nXG4gICAgLy8gYmV0d2VlbiB0aGVtLlxuXG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNvdXJjZUJ1ZmZlclR5cGUgPSBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc291cmNlQnVmZmVyVHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0VG90YWxEdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxEdXJhdGlvbiA9IHNlZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKTtcbiAgICByZXR1cm4gdG90YWxEdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsU2VnbWVudENvdW50ID0gZnVuY3Rpb24gZ2V0VG90YWxTZWdtZW50Q291bnQoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHRvdGFsU2VnbWVudENvdW50ID0gc2VnbWVudExpc3QuZ2V0VG90YWxTZWdtZW50Q291bnQoKTtcbiAgICByZXR1cm4gdG90YWxTZWdtZW50Q291bnQ7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0U2VnbWVudER1cmF0aW9uKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50RHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50RHVyYXRpb24oKTtcbiAgICByZXR1cm4gc2VnbWVudER1cmF0aW9uO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gc2VnbWVudExpc3QuZ2V0U3RhcnROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RTdGFydE51bWJlcjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdEVuZE51bWJlciA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0RW5kTnVtYmVyKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzZWdtZW50TGlzdEVuZE51bWJlciA9IHNlZ21lbnRMaXN0LmdldEVuZE51bWJlcigpO1xuICAgIHJldHVybiBzZWdtZW50TGlzdEVuZE51bWJlcjtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdHMgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdHMoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICBzZWdtZW50TGlzdHMgPSByZXByZXNlbnRhdGlvbnMubWFwKGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBzZWdtZW50TGlzdHM7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICByZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCA9IHJlcHJlc2VudGF0aW9ucy5maW5kKGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICB2YXIgcmVwcmVzZW50YXRpb25CYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICAgICAgICAgIHJldHVybiAoTnVtYmVyKHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoKSA9PT0gTnVtYmVyKGJhbmR3aWR0aCkpO1xuICAgICAgICB9KSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uV2l0aEJhbmR3aWR0aE1hdGNoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uIGdldEF2YWlsYWJsZUJhbmR3aWR0aHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLm1hcChcbiAgICAgICAgZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xuICAgIH0pLmZpbHRlcihcbiAgICAgICAgZnVuY3Rpb24oYmFuZHdpZHRoKSB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCk7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYW5pZmVzdDsiLCJtb2R1bGUuZXhwb3J0cyA9IFsndmlkZW8nLCAnYXVkaW8nXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwgPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VSb290VXJsO1xuXG5mdW5jdGlvbiBsb2FkTWFuaWZlc3QodXJsLCBjYWxsYmFjaykge1xuICAgIHZhciBhY3R1YWxVcmwgPSBwYXJzZVJvb3RVcmwodXJsKSxcbiAgICAgICAgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICBvbmxvYWQ7XG5cbiAgICBvbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkgeyByZXR1cm47IH1cblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrKHttYW5pZmVzdFhtbDogcmVxdWVzdC5yZXNwb25zZVhNTCB9KTsgfVxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgICAvL3RoaXMuZGVidWcubG9nKCdTdGFydCBsb2FkaW5nIG1hbmlmZXN0OiAnICsgdXJsKTtcbiAgICAgICAgcmVxdWVzdC5vbmxvYWQgPSBvbmxvYWQ7XG4gICAgICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICAgICAgcmVxdWVzdC5zZW5kKCk7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJlcXVlc3Qub25lcnJvcigpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsb2FkTWFuaWZlc3Q7IiwiXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBpc051bWJlciA9IHJlcXVpcmUoJy4uL3V0aWwvaXNOdW1iZXIuanMnKSxcbiAgICBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgbG9hZFNlZ21lbnQsXG4gICAgREVGQVVMVF9SRVRSWV9DT1VOVCA9IDMsXG4gICAgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCA9IDI1MDtcblxubG9hZFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50LCByZXRyeUludGVydmFsKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcbiAgICBzZWxmLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gbnVsbDtcblxuICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIHVybCA9IHNlZ21lbnQuZ2V0VXJsKCk7XG4gICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcblxuICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrRm4gPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2tGbi5jYWxsKHNlbGYsIHJlcXVlc3QucmVzcG9uc2UpOyB9XG4gICAgfTtcbiAgICAvL3JlcXVlc3Qub25lcnJvciA9IHJlcXVlc3Qub25sb2FkZW5kID0gZnVuY3Rpb24oKSB7XG4gICAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH07XG5cbiAgICByZXF1ZXN0LnNlbmQoKTtcbn07XG5cbmZ1bmN0aW9uIFNlZ21lbnRMb2FkZXIobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVR5cGUpIHtcbiAgICBpZiAoIWV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtYW5pZmVzdENvbnRyb2xsZXIhJyk7IH1cbiAgICBpZiAoIWV4aXN0eShtZWRpYVR5cGUpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtZWRpYVR5cGUhJyk7IH1cbiAgICB0aGlzLl9fbWFuaWZlc3QgPSBtYW5pZmVzdENvbnRyb2xsZXI7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICAvLyBUT0RPOiBEb24ndCBsaWtlIHRoaXMgYnV0IGVuc3VyZXMgZXhwZWN0ZWQgcHJvcGVydGllcyBhcmUgc2V0IChBZGQgbWV0aG9kIHRoYXQgc2V0QmFuZHdpZHRoKCkgaXRzZWxmIGNhbGxzPyBTYW1lIHcvZ2V0Q3VycmVudEJhbmR3aWR0aCgpPylcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IHRydWU7XG59XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBJTklUSUFMSVpBVElPTl9MT0FERUQ6ICdpbml0aWFsaXphdGlvbkxvYWRlZCcsXG4gICAgU0VHTUVOVF9MT0FERUQ6ICdzZWdtZW50TG9hZGVkJ1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuX19nZXRNZWRpYVNldCA9IGZ1bmN0aW9uIGdldE1lZGlhU2V0KCkge1xuICAgIHZhciBtZWRpYVNldCA9IHRoaXMuX19tYW5pZmVzdC5nZXRNZWRpYVNldEJ5VHlwZSh0aGlzLl9fbWVkaWFUeXBlKTtcbiAgICByZXR1cm4gbWVkaWFTZXQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5fX2dldERlZmF1bHRTZWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldERlZmF1bHRTZWdtZW50TGlzdCgpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdHMoKVswXTtcbiAgICByZXR1cm4gc2VnbWVudExpc3Q7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50QmFuZHdpZHRoID0gZnVuY3Rpb24gZ2V0Q3VycmVudEJhbmR3aWR0aCgpIHtcbiAgICBpZiAoIWlzTnVtYmVyKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoKSkgeyB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuX19nZXREZWZhdWx0U2VnbWVudExpc3QoKS5nZXRCYW5kd2lkdGgoKTsgfVxuICAgIHJldHVybiB0aGlzLl9fY3VycmVudEJhbmR3aWR0aDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLnNldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBzZXRDdXJyZW50QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIGlmICghaXNOdW1iZXIoYmFuZHdpZHRoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBleHBlY3RzIGEgbnVtZXJpYyB2YWx1ZSBmb3IgYmFuZHdpZHRoIScpO1xuICAgIH1cbiAgICB2YXIgYXZhaWxhYmxlQmFuZHdpZHRocyA9IHRoaXMuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIGlmIChhdmFpbGFibGVCYW5kd2lkdGhzLmluZGV4T2YoYmFuZHdpZHRoKSA8IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyOjpzZXRDdXJyZW50QmFuZHdpZHRoKCkgbXVzdCBiZSBzZXQgdG8gb25lIG9mIHRoZSBmb2xsb3dpbmcgdmFsdWVzOiAnICsgYXZhaWxhYmxlQmFuZHdpZHRocy5qb2luKCcsICcpKTtcbiAgICB9XG4gICAgaWYgKGJhbmR3aWR0aCA9PT0gdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gdHJ1ZTtcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IGJhbmR3aWR0aDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TGlzdCgpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSAgdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCh0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKSk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIHJldHVybiBhdmFpbGFibGVCYW5kd2lkdGhzO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTdGFydE51bWJlcigpIHtcbiAgICB2YXIgc3RhcnROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHN0YXJ0TnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnQgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudCgpIHtcbiAgICB2YXIgc2VnbWVudCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0U2VnbWVudEJ5TnVtYmVyKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TnVtYmVyKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudFN0YXJ0VGltZSA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50U3RhcnRUaW1lKCkgeyByZXR1cm4gdGhpcy5nZXRDdXJyZW50U2VnbWVudCgpLmdldFN0YXJ0TnVtYmVyKCk7IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEVuZE51bWJlciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBlbmROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdEVuZE51bWJlcigpO1xuICAgIHJldHVybiBlbmROdW1iZXI7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZXhpc3R5KHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUpID8gdGhpcy5fX2xhc3REb3dubG9hZFN0YXJ0VGltZSA6IC0xO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZFJvdW5kVHJpcFRpbWVTcGFuID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TGFzdERvd25sb2FkQ29tcGxldGVUaW1lKCkgLSB0aGlzLmdldExhc3REb3dubG9hZFN0YXJ0VGltZSgpO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZEluaXRpYWxpemF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCksXG4gICAgICAgIGluaXRpYWxpemF0aW9uID0gc2VnbWVudExpc3QuZ2V0SW5pdGlhbGl6YXRpb24oKTtcblxuICAgIGlmICghaW5pdGlhbGl6YXRpb24pIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBsb2FkU2VnbWVudC5jYWxsKHRoaXMsIGluaXRpYWxpemF0aW9uLCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTppbml0U2VnbWVudH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkTmV4dFNlZ21lbnQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9DdXJyZW50U2VnbWVudE51bWJlciA9IGV4aXN0eSh0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIpLFxuICAgICAgICBudW1iZXIgPSBub0N1cnJlbnRTZWdtZW50TnVtYmVyID8gdGhpcy5nZXRTdGFydE51bWJlcigpIDogdGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyICsgMTtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2VnbWVudEF0TnVtYmVyKG51bWJlcik7XG59O1xuXG4vLyBUT0RPOiBEdXBsaWNhdGUgY29kZSBiZWxvdy4gQWJzdHJhY3QgYXdheS5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRTZWdtZW50QXROdW1iZXIgPSBmdW5jdGlvbihudW1iZXIpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAobnVtYmVyID4gdGhpcy5nZXRFbmROdW1iZXIoKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBzZWdtZW50ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKS5nZXRTZWdtZW50QnlOdW1iZXIobnVtYmVyKTtcblxuICAgIGlmICh0aGlzLl9fY3VycmVudEJhbmR3aWR0aENoYW5nZWQpIHtcbiAgICAgICAgdGhpcy5vbmUodGhpcy5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gZXZlbnQuZGF0YTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCA9IGZhbHNlO1xuICAgICAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOltpbml0U2VnbWVudCwgc2VnbWVudERhdGFdIH0pO1xuICAgICAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmxvYWRJbml0aWFsaXphdGlvbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvYWRTZWdtZW50LmNhbGwoc2VsZiwgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHZhciBzZWdtZW50RGF0YSA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTpzZWdtZW50RGF0YSB9KTtcbiAgICAgICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGlmIChwcmVzZW50YXRpb25UaW1lID4gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKHByZXNlbnRhdGlvblRpbWUpO1xuXG4gICAgaWYgKHRoaXMuX19jdXJyZW50QmFuZHdpZHRoQ2hhbmdlZCkge1xuICAgICAgICB0aGlzLm9uZSh0aGlzLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBldmVudC5kYXRhO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRCYW5kd2lkdGhDaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkU2VnbWVudC5jYWxsKHNlbGYsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6W2luaXRTZWdtZW50LCBzZWdtZW50RGF0YV0gfSk7XG4gICAgICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9hZEluaXRpYWxpemF0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9hZFNlZ21lbnQuY2FsbChzZWxmLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgdmFyIHNlZ21lbnREYXRhID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlZ21lbnREYXRhIH0pO1xuICAgICAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNlZ21lbnRMb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0Z1bmN0aW9uID0gcmVxdWlyZSgnLi4vdXRpbC9pc0Z1bmN0aW9uLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgdHlwZT9cbiAgICBpZiAoIXNvdXJjZUJ1ZmZlcikgeyB0aHJvdyBuZXcgRXJyb3IoICdUaGUgc291cmNlQnVmZmVyIGNvbnN0cnVjdG9yIGFyZ3VtZW50IGNhbm5vdCBiZSBudWxsLicgKTsgfVxuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBkYXRhUXVldWUgPSBbXTtcbiAgICAvLyBUT0RPOiBmaWd1cmUgb3V0IGhvdyB3ZSB3YW50IHRvIHJlc3BvbmQgdG8gb3RoZXIgZXZlbnQgc3RhdGVzICh1cGRhdGVlbmQ/IGVycm9yPyBhYm9ydD8pIChyZXRyeT8gcmVtb3ZlPylcbiAgICBzb3VyY2VCdWZmZXIuYWRkRXZlbnRMaXN0ZW5lcigndXBkYXRlZW5kJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgLy8gVGhlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZSdzIHVwZGF0aW5nIHByb3BlcnR5IHNob3VsZCBhbHdheXMgYmUgZmFsc2UgaWYgdGhpcyBldmVudCB3YXMgZGlzcGF0Y2hlZCxcbiAgICAgICAgLy8gYnV0IGp1c3QgaW4gY2FzZS4uLlxuICAgICAgICBpZiAoZXZlbnQudGFyZ2V0LnVwZGF0aW5nKSB7IHJldHVybjsgfVxuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9BRERFRF9UT19CVUZGRVIsIHRhcmdldDpzZWxmIH0pO1xuXG4gICAgICAgIGlmIChkYXRhUXVldWUubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUVVFVUVfRU1QVFksIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZXZlbnQudGFyZ2V0LmFwcGVuZEJ1ZmZlcihkYXRhUXVldWUuc2hpZnQoKSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gZGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXIgPSBzb3VyY2VCdWZmZXI7XG59XG5cbi8vIFRPRE86IEFkZCBhcyBcImNsYXNzXCIgcHJvcGVydGllcz9cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFFVRVVFX0VNUFRZOiAncXVldWVFbXB0eScsXG4gICAgU0VHTUVOVF9BRERFRF9UT19CVUZGRVI6ICdzZWdtZW50QWRkZWRUb0J1ZmZlcidcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuYWRkVG9RdWV1ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICBpZiAoIWV4aXN0eShkYXRhKSB8fCAoaXNBcnJheShkYXRhKSAmJiBkYXRhLmxlbmd0aCA8PSAwKSkgeyByZXR1cm47IH1cbiAgICBpZiAoIWlzQXJyYXkoZGF0YSkpIHsgZGF0YSA9IFtkYXRhXTsgfVxuICAgIC8vIElmIG5vdGhpbmcgaXMgaW4gdGhlIHF1ZXVlLCBnbyBhaGVhZCBhbmQgaW1tZWRpYXRlbHkgYXBwZW5kIHRoZSBzZWdtZW50IGRhdGEgdG8gdGhlIHNvdXJjZSBidWZmZXIuXG4gICAgaWYgKCh0aGlzLl9fZGF0YVF1ZXVlLmxlbmd0aCA9PT0gMCkgJiYgKCF0aGlzLl9fc291cmNlQnVmZmVyLnVwZGF0aW5nKSkgeyB0aGlzLl9fc291cmNlQnVmZmVyLmFwcGVuZEJ1ZmZlcihkYXRhLnNoaWZ0KCkpOyB9XG4gICAgLy8gT3RoZXJ3aXNlLCBwdXNoIG9udG8gcXVldWUgYW5kIHdhaXQgZm9yIHRoZSBuZXh0IHVwZGF0ZSBldmVudCBiZWZvcmUgYXBwZW5kaW5nIHNlZ21lbnQgZGF0YSB0byBzb3VyY2UgYnVmZmVyLlxuICAgIGVsc2UgeyB0aGlzLl9fZGF0YVF1ZXVlID0gdGhpcy5fX2RhdGFRdWV1ZS5jb25jYXQoZGF0YSk7IH1cbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuY2xlYXJRdWV1ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX19kYXRhUXVldWUgPSBbXTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuaGFzQnVmZmVyZWREYXRhRm9yVGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICByZXR1cm4gY2hlY2tUaW1lUmFuZ2VzRm9yVGltZSh0aGlzLl9fc291cmNlQnVmZmVyLmJ1ZmZlcmVkLCBwcmVzZW50YXRpb25UaW1lLCBmdW5jdGlvbihzdGFydFRpbWUsIGVuZFRpbWUpIHtcbiAgICAgICAgcmV0dXJuICgoc3RhcnRUaW1lID49IDApIHx8IChlbmRUaW1lID49IDApKTtcbiAgICB9KTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZGV0ZXJtaW5lQW1vdW50QnVmZmVyZWRGcm9tVGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICAvLyBJZiB0aGUgcmV0dXJuIHZhbHVlIGlzIDwgMCwgbm8gZGF0YSBpcyBidWZmZXJlZCBAIHByZXNlbnRhdGlvblRpbWUuXG4gICAgcmV0dXJuIGNoZWNrVGltZVJhbmdlc0ZvclRpbWUodGhpcy5fX3NvdXJjZUJ1ZmZlci5idWZmZXJlZCwgcHJlc2VudGF0aW9uVGltZSxcbiAgICAgICAgZnVuY3Rpb24oc3RhcnRUaW1lLCBlbmRUaW1lLCBwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gZW5kVGltZSAtIHByZXNlbnRhdGlvblRpbWU7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxuZnVuY3Rpb24gY2hlY2tUaW1lUmFuZ2VzRm9yVGltZSh0aW1lUmFuZ2VzLCB0aW1lLCBjYWxsYmFjaykge1xuICAgIHZhciB0aW1lUmFuZ2VzTGVuZ3RoID0gdGltZVJhbmdlcy5sZW5ndGgsXG4gICAgICAgIGkgPSAwLFxuICAgICAgICBjdXJyZW50U3RhcnRUaW1lLFxuICAgICAgICBjdXJyZW50RW5kVGltZTtcblxuICAgIGZvciAoaTsgaTx0aW1lUmFuZ2VzTGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY3VycmVudFN0YXJ0VGltZSA9IHRpbWVSYW5nZXMuc3RhcnQoaSk7XG4gICAgICAgIGN1cnJlbnRFbmRUaW1lID0gdGltZVJhbmdlcy5lbmQoaSk7XG4gICAgICAgIGlmICgodGltZSA+PSBjdXJyZW50U3RhcnRUaW1lKSAmJiAodGltZSA8PSBjdXJyZW50RW5kVGltZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBpc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGN1cnJlbnRTdGFydFRpbWUsIGN1cnJlbnRFbmRUaW1lLCB0aW1lKSA6IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAoY3VycmVudFN0YXJ0VGltZSA+IHRpbWUpIHtcbiAgICAgICAgICAgIC8vIElmIHRoZSBjdXJyZW50U3RhcnRUaW1lIGlzIGdyZWF0ZXIgdGhhbiB0aGUgdGltZSB3ZSdyZSBsb29raW5nIGZvciwgdGhhdCBtZWFucyB3ZSd2ZSByZWFjaGVkIGEgdGltZSByYW5nZVxuICAgICAgICAgICAgLy8gdGhhdCdzIHBhc3QgdGhlIHRpbWUgd2UncmUgbG9va2luZyBmb3IgKHNpbmNlIFRpbWVSYW5nZXMgc2hvdWxkIGJlIG9yZGVyZWQgY2hyb25vbG9naWNhbGx5KS4gSWYgc28sIHdlXG4gICAgICAgICAgICAvLyBjYW4gc2hvcnQgY2lyY3VpdC5cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soLTEsIC0xLCB0aW1lKSA6IGZhbHNlO1xufVxuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlQnVmZmVyRGF0YVF1ZXVlOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gZXhpc3R5KHgpIHsgcmV0dXJuICh4ICE9PSBudWxsKSAmJiAoeCAhPT0gdW5kZWZpbmVkKTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV4aXN0eTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIEV4dGVuZCBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgcHJvcGVydGllcyBpbiBwYXNzZWQtaW4gb2JqZWN0KHMpLlxudmFyIGV4dGVuZE9iamVjdCA9IGZ1bmN0aW9uKG9iaiAvKiwgZXh0ZW5kT2JqZWN0MSwgZXh0ZW5kT2JqZWN0MiwgLi4uLCBleHRlbmRPYmplY3ROICovKSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKS5mb3JFYWNoKGZ1bmN0aW9uKGV4dGVuZE9iamVjdCkge1xuICAgICAgICBpZiAoZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgICAgIG9ialtwcm9wXSA9IGV4dGVuZE9iamVjdFtwcm9wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBvYmo7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZE9iamVjdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNBcnJheShvYmopIHtcbiAgICByZXR1cm4gb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJztcbiAgICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzRnVuY3Rpb247IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IE51bWJlcl0nIHx8IGZhbHNlO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzTnVtYmVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNTdHJpbmcgPSBmdW5jdGlvbiBpc1N0cmluZyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBTdHJpbmddJyB8fCBmYWxzZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gaXNTdHJpbmc7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi9leGlzdHkuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gdHJ1dGh5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gVE9ETzogUmVmYWN0b3IgdG8gc2VwYXJhdGUganMgZmlsZXMgJiBtb2R1bGVzICYgcmVtb3ZlIGZyb20gaGVyZS5cblxuLy8gTk9URTogVEFLRU4gRlJPTSBMT0RBU0ggVE8gUkVNT1ZFIERFUEVOREVOQ1lcbi8qKiBgT2JqZWN0I3RvU3RyaW5nYCByZXN1bHQgc2hvcnRjdXRzICovXG52YXIgZnVuY0NsYXNzID0gJ1tvYmplY3QgRnVuY3Rpb25dJyxcbiAgICBzdHJpbmdDbGFzcyA9ICdbb2JqZWN0IFN0cmluZ10nO1xuXG4vKiogVXNlZCB0byByZXNvbHZlIHRoZSBpbnRlcm5hbCBbW0NsYXNzXV0gb2YgdmFsdWVzICovXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIHRvU3RyaW5nLmNhbGwodmFsdWUpID09PSBmdW5jQ2xhc3M7XG4gICAgfTtcbn1cblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHRvU3RyaW5nLmNhbGwodmFsdWUpID09PSBzdHJpbmdDbGFzcyB8fCBmYWxzZTtcbn07XG5cbi8vIE5PVEU6IEVORCBPRiBMT0RBU0gtQkFTRUQgQ09ERVxuXG4vLyBHZW5lcmFsIFV0aWxpdHkgRnVuY3Rpb25zXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4geCAhPT0gbnVsbDsgfVxuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxuZnVuY3Rpb24gcHJlQXBwbHlBcmdzRm4oZnVuIC8qLCBhcmdzICovKSB7XG4gICAgdmFyIHByZUFwcGxpZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAvLyBOT1RFOiB0aGUgKnRoaXMqIHJlZmVyZW5jZSB3aWxsIHJlZmVyIHRvIHRoZSBjbG9zdXJlJ3MgY29udGV4dCB1bmxlc3NcbiAgICAvLyB0aGUgcmV0dXJuZWQgZnVuY3Rpb24gaXMgaXRzZWxmIGNhbGxlZCB2aWEgLmNhbGwoKSBvciAuYXBwbHkoKS4gSWYgeW91XG4gICAgLy8gKm5lZWQqIHRvIHJlZmVyIHRvIGluc3RhbmNlLWxldmVsIHByb3BlcnRpZXMsIGRvIHNvbWV0aGluZyBsaWtlIHRoZSBmb2xsb3dpbmc6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IGZ1bmN0aW9uKGFyZ0MpIHsgcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKS5jYWxsKHRoaXMpOyB9O1xuICAgIC8vXG4gICAgLy8gT3RoZXJ3aXNlLCB5b3Ugc2hvdWxkIGJlIGFibGUgdG8ganVzdCBjYWxsOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pO1xuICAgIC8vXG4gICAgLy8gV2hlcmUgcG9zc2libGUsIGZ1bmN0aW9ucyBhbmQgbWV0aG9kcyBzaG91bGQgbm90IGJlIHJlYWNoaW5nIG91dCB0byBnbG9iYWwgc2NvcGUgYW55d2F5LCBzby4uLlxuICAgIHJldHVybiBmdW5jdGlvbigpIHsgcmV0dXJuIGZ1bi5hcHBseSh0aGlzLCBwcmVBcHBsaWVkQXJncyk7IH07XG59XG5cbi8vIEhpZ2hlci1vcmRlciBYTUwgZnVuY3Rpb25zXG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50c1xudmFyIGdldEFuY2VzdG9ycyA9IGZ1bmN0aW9uKGVsZW0sIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgKGZ1bmN0aW9uIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSwgYW5jZXN0b3JzKSkgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKGV4aXN0eShlbGVtKSAmJiBleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkge1xuICAgICAgICAgICAgYW5jZXN0b3JzLnB1c2goZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgICAgIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfSkoZWxlbSk7XG4gICAgcmV0dXJuIGFuY2VzdG9ycztcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXROb2RlTGlzdEJ5TmFtZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oeG1sT2JqKSB7XG4gICAgICAgIHJldHVybiB4bWxPYmouZ2V0RWxlbWVudHNCeVRhZ05hbWUobmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBoYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lLCB2YWx1ZSkge1xuICAgIGlmICgodHlwZW9mIGF0dHJOYW1lICE9PSAnc3RyaW5nJykgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgaWYgKCFleGlzdHkodmFsdWUpKSB7IHJldHVybiBlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgcmV0dXJuIChlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSkgPT09IHZhbHVlKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEF0dHJGbiA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhdHRyTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbi8vIFRPRE86IEFkZCBzaG91bGRTdG9wUHJlZCAoc2hvdWxkIGZ1bmN0aW9uIHNpbWlsYXJseSB0byBzaG91bGRTdG9wUHJlZCBpbiBnZXRJbmhlcml0YWJsZUVsZW1lbnQsIGJlbG93KVxudmFyIGdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhhdHRyTmFtZSkpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKSkgeyByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50czsgUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEluaGVyaXRhYmxlRWxlbWVudCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHJldHVybiBmdW5jdGlvbiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBtYXRjaGluZ0VsZW1MaXN0ID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSk7XG4gICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtTGlzdCkgJiYgbWF0Y2hpbmdFbGVtTGlzdC5sZW5ndGggPiAwKSB7IHJldHVybiBtYXRjaGluZ0VsZW1MaXN0WzBdOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUT0RPOiBJbXBsZW1lbnQgbWUgZm9yIEJhc2VVUkwgb3IgdXNlIGV4aXN0aW5nIGZuIChTZWU6IG1wZC5qcyBidWlsZEJhc2VVcmwoKSlcbi8qdmFyIGJ1aWxkSGllcmFyY2hpY2FsbHlTdHJ1Y3R1cmVkVmFsdWUgPSBmdW5jdGlvbih2YWx1ZUZuLCBidWlsZEZuLCBzdG9wUHJlZCkge1xuXG59OyovXG5cbi8vIFB1Ymxpc2ggRXh0ZXJuYWwgQVBJOlxudmFyIHhtbGZ1biA9IHt9O1xueG1sZnVuLmV4aXN0eSA9IGV4aXN0eTtcbnhtbGZ1bi50cnV0aHkgPSB0cnV0aHk7XG5cbnhtbGZ1bi5nZXROb2RlTGlzdEJ5TmFtZSA9IGdldE5vZGVMaXN0QnlOYW1lO1xueG1sZnVuLmhhc01hdGNoaW5nQXR0cmlidXRlID0gaGFzTWF0Y2hpbmdBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUgPSBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRBbmNlc3RvcnMgPSBnZXRBbmNlc3RvcnM7XG54bWxmdW4uZ2V0QXR0ckZuID0gZ2V0QXR0ckZuO1xueG1sZnVuLnByZUFwcGx5QXJnc0ZuID0gcHJlQXBwbHlBcmdzRm47XG54bWxmdW4uZ2V0SW5oZXJpdGFibGVFbGVtZW50ID0gZ2V0SW5oZXJpdGFibGVFbGVtZW50O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHhtbGZ1bjsiXX0=
