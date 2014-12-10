(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var root = require('./window.js'),

    mediaSourceClassName = 'MediaSource',
    webKitMediaSourceClassName = 'WebKitMediaSource',
    mediaSourceEvents = ['sourceopen', 'sourceclose', 'sourceended'],
    // TODO: Test to verify that webkit prefixes the 'sourceended' event type.
    webKitMediaSourceEvents = ['webkitsourceopen', 'webkitsourceclose', 'webkitsourceended'];

function hasClassReference(object, className) {
    return ((className in object) && (typeof object[className] === 'function'));
}

function createEventsMap(keysArray, valuesArray) {
    if (!keysArray || !valuesArray || keysArray.length !== valuesArray.length) { return null; }
    var map = {};
    for (var i=0; i<keysArray.length; i++) {
        map[keysArray[i]] = valuesArray[i];
    }

    return map;
}

function overrideEventFn(classRef, eventFnName, eventsMap) {
    var originalFn = classRef.prototype[eventFnName];
    classRef.prototype[eventFnName] = function(type /*, callback, useCapture */) {
        originalFn.apply(this, Array.prototype.slice.call(arguments));
        if (!(type in eventsMap)) { return; }
        var restArgsArray = Array.prototype.slice.call(arguments, 1),
            newArgsArray = [eventsMap[type]].concat(restArgsArray);
        originalFn.apply(this, Array.prototype.slice.call(newArgsArray));
    };
}

function getMediaSourceClass(root) {
    // If the root (window) has MediaSource, nothing to do so simply return the ref.
    if (hasClassReference(root, mediaSourceClassName)) { return root[mediaSourceClassName]; }
    // If the root (window) has WebKitMediaSource, override its add/remove event functions to meet the W3C
    // spec for event types and return a ref to it.
    else if (hasClassReference(root, webKitMediaSourceClassName)) {
        var classRef = root[webKitMediaSourceClassName],
            eventsMap = createEventsMap(mediaSourceEvents, webKitMediaSourceEvents);

        overrideEventFn(classRef, 'addEventListener', eventsMap);
        overrideEventFn(classRef, 'removeEventListener', eventsMap);

        return classRef;
    }

    // Otherwise, (standard or nonstandard) MediaSource doesn't appear to be natively supported, so return
    // a generic function that throws an error when called.
    // TODO: Throw error immediately instead (or both)?
    return function() { throw new Error('MediaSource doesn\'t appear to be supported in your environment'); };
}

var MediaSource = getMediaSourceClass(root);

module.exports = MediaSource;
},{"./window.js":3}],2:[function(require,module,exports){
;(function() {
    'use strict';

    var root = require('./window.js'),
        MediaSource = require('./MediaSource');

    function mediaSourceShim(root, mediaSourceClass) {
        root.MediaSource = mediaSourceClass;
    }

    mediaSourceShim(root, MediaSource);
}.call(this));
},{"./MediaSource":1,"./window.js":3}],3:[function(require,module,exports){
(function (global){
// Create a simple module to refer to the window/global object to make mocking the window object and its
// properties cleaner when testing.
'use strict';
module.exports = global;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],4:[function(require,module,exports){
'use strict';

var SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    DownloadRateManager = require('./rules/DownloadRateManager.js'),
    VideoReadyStateRule = require('./rules/downloadRate/VideoReadyStateRule.js'),
    StreamLoader = require('./StreamLoader.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    streamTypes = ['video', 'audio'];

function loadInitialization(segmentLoader, sourceBufferDataQueue) {
    segmentLoader.one(segmentLoader.eventList.INITIALIZATION_LOADED, function(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            loadSegments(segmentLoader, sourceBufferDataQueue);
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });
    segmentLoader.loadInitialization();
}

function loadSegments(segmentLoader, sourceBufferDataQueue) {
    //var segments = [];
    segmentLoader.on(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        //segments.push(event.data);
        //console.log('Current Segment Count: ' + segments.length);
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            var loading = segmentLoader.loadNextSegment();
            if (!loading) {
                segmentLoader.off(segmentLoader.eventList.SEGMENT_LOADED, segmentLoadedHandler);
                /*console.log();
                 console.log();
                 console.log();
                 console.log('Final Segment Count: ' + segments.length);*/
            }
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    segmentLoader.loadNextSegment();
}

// TODO: Move this elsewhere (Where?)
function getSourceBufferTypeFromRepresentation(representation) {
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
}

function createSegmentLoaderByType(manifest, streamType) {
    var adaptationSet = getMpd(manifest).getPeriods()[0].getAdaptationSetByType(streamType);
    return adaptationSet ? new SegmentLoader(adaptationSet) : null;
}

function createSourceBufferDataQueueByType(manifest, mediaSource, streamType) {
    // NOTE: Since codecs of particular representations (stream variants) may vary slightly, need to get specific
    // representation to get type for source buffer.
    var representation = getMpd(manifest).getPeriods()[0].getAdaptationSetByType(streamType).getRepresentations()[0],
        sourceBufferType = getSourceBufferTypeFromRepresentation(representation),
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);

    return sourceBuffer ? new SourceBufferDataQueue(sourceBuffer) : null;
}

function createStreamLoaderForType(manifest, mediaSource, streamType) {
    var segmentLoader,
        sourceBufferDataQueue;

    segmentLoader = createSegmentLoaderByType(manifest, streamType);
    if (!segmentLoader) { return null; }
    sourceBufferDataQueue = createSourceBufferDataQueueByType(manifest, mediaSource, streamType);
    if (!sourceBufferDataQueue) { return null; }
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, streamType);
}

function createStreamLoadersForTypes(manifest, mediaSource, streamTypes) {
    var streamLoaders = [],
        currentStreamLoader;

    streamTypes.forEach(function(streamType) {
        currentStreamLoader = createStreamLoaderForType(manifest, mediaSource, streamType);
        if (currentStreamLoader) { streamLoaders.push(currentStreamLoader); }
    });

    return streamLoaders;
}

function createStreamLoaders(manifest, mediaSource) { return createStreamLoadersForTypes(manifest, mediaSource, streamTypes); }

function PlaylistLoader(manifest, mediaSource, tech) {
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifest, mediaSource);
    this.__streamLoaders.forEach(function(streamLoader) {
        loadInitialization(streamLoader.getSegmentLoader(), streamLoader.getSourceBufferDataQueue());
    });
}

module.exports = PlaylistLoader;
},{"./StreamLoader.js":6,"./dash/mpd/getMpd.js":7,"./rules/DownloadRateManager.js":15,"./rules/downloadRate/VideoReadyStateRule.js":18,"./segments/SegmentLoader.js":19,"./sourceBuffer/SourceBufferDataQueue.js":20}],5:[function(require,module,exports){
'use strict';

var MediaSource = require('./window.js').MediaSource,
    loadManifest = require('./manifest/loadManifest.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

function SourceHandler(source, tech) {
    var self = this;
    loadManifest(source.src, function(data) {
        //load(data.manifestXml, tech);
        var manifest = self.__manifest = data.manifestXml;
        console.log('START');

        var mediaSource = new MediaSource(),
            openListener = function(event) {
                mediaSource.removeEventListener('sourceopen', openListener, false);
                self.__playlistLoader = new PlaylistLoader(manifest, mediaSource, tech);
            };

        mediaSource.addEventListener('sourceopen', openListener, false);

        // TODO: Handle close.
        //mediaSource.addEventListener('webkitsourceclose', closed, false);
        //mediaSource.addEventListener('sourceclose', closed, false);

        tech.setSrc(URL.createObjectURL(mediaSource));
    });
}

module.exports = SourceHandler;
},{"./PlaylistLoader.js":4,"./manifest/loadManifest.js":14,"./window.js":23}],6:[function(require,module,exports){
'use strict';

function StreamLoader(segmentLoader, sourceBufferDataQueue, streamType) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__streamType = streamType;
}

StreamLoader.prototype.getStreamType = function() { return this.__streamType; };

StreamLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

StreamLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

StreamLoader.prototype.getCurrentSegmentNumber = function() { return this.__segmentLoader.getCurrentIndex(); };

module.exports = StreamLoader;
},{}],7:[function(require,module,exports){
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

var getWidth = xmlfun.getInheritableAttribute('width'),
    getHeight = xmlfun.getInheritableAttribute('height'),
    getFrameRate = xmlfun.getInheritableAttribute('frameRate'),
    getMimeType = xmlfun.getInheritableAttribute('mimeType'),
    getCodecs = xmlfun.getInheritableAttribute('codecs');

var getSegmentTemplateXml = xmlfun.getInheritableElement('SegmentTemplate', doesntHaveCommonProperties);

// MPD Attr fns
var getMediaPresentationDuration = xmlfun.getAttrFn('mediaPresentationDuration');

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
        getMediaPresentationDuration: xmlfun.preApplyArgsFn(getMediaPresentationDuration, xmlNode)
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

getDescendantObjectsArrayByName = function(parentXml, tagName, mapFn) {
    var descendantsXmlArray = Array.prototype.slice.call(parentXml.getElementsByTagName(tagName));
    /*if (typeof mapFn === 'function') { return descendantsXmlArray.map(mapFn); }*/
    if (typeof mapFn === 'function') {
        var mappedElem = descendantsXmlArray.map(mapFn);
        return  mappedElem;
    }
    return descendantsXmlArray;
};

getAncestorObjectByName = function(xmlNode, tagName, mapFn) {
    if (!tagName || !xmlNode || !xmlNode.parentNode) { return null; }
    if (!xmlNode.parentNode.hasOwnProperty('nodeName')) { return null; }

    if (xmlNode.parentNode.nodeName === tagName) {
        return (typeof mapFn === 'function') ? mapFn(xmlNode.parentNode) : xmlNode.parentNode;
    }
    return getAncestorObjectByName(xmlNode.parentNode, tagName, mapFn);
};

module.exports = getMpd;
},{"../../xmlfun.js":24,"./util.js":8}],8:[function(require,module,exports){
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
},{}],9:[function(require,module,exports){
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
        number = Math.floor(getTotalDurationFromTemplate(representation) / segmentDuration),
        segment = createSegmentFromTemplateByNumber(representation, number);
    return segment;
};

function getSegmentListForRepresentation(representation) {
    if (!representation) { return undefined; }
    if (representation.getSegmentTemplate()) { return createSegmentListFromTemplate(representation); }
    return undefined;
}

module.exports = getSegmentListForRepresentation;

},{"../../xmlfun.js":24,"../mpd/util.js":8,"./segmentTemplate":10}],10:[function(require,module,exports){
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

var videojs = require('../window.js').videojs,
    eventManager = {
        trigger: videojs.trigger,
        one: videojs.one,
        on: videojs.on,
        off: videojs.off
    };

module.exports = eventManager;
},{"../window.js":23}],13:[function(require,module,exports){
/**
 * Created by cpillsbury on 12/3/14.
 */
;(function() {
    'use strict';

    var root = require('./window'),
        videojs = root.videojs,
        // Note: To use the CommonJS module loader, have to point to the pre-browserified main lib file.
        mse = require('mse.js/src/js/mse.js'),
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
},{"./SourceHandler":5,"./window":23,"mse.js/src/js/mse.js":2}],14:[function(require,module,exports){
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
},{"../dash/mpd/util.js":8}],15:[function(require,module,exports){
'use strict';

var extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    isArray = require('../util/isArray.js'),
    downloadRates = require('./downloadRate/DownloadRates.js'),
    eventList = require('./downloadRate/DownloadRateEventTypes.js');

function addEventHandlerToRule(self, rule) {
    rule.on(self.eventList.DOWNLOAD_RATE_CHANGED, function(event) {
        self.determineDownloadRate();
    });
}

function DownloadRateManager(downloadRateRules) {
    var self = this;
    if (isArray(downloadRateRules)) { this.__downloadRateRules = downloadRateRules; }
    else if (!!downloadRateRules) { this.__downloadRateRules = [downloadRateRules]; }
    else { this.__downloadRateRules = []; }
    //this.__downloadRateRules = isArray(downloadRateRules) || [];
    this.__downloadRateRules.forEach(function(rule) {
        addEventHandlerToRule(self, rule);
    });
    this.__lastDownloadRate = this.downloadRates.DONT_DOWNLOAD;
    this.determineDownloadRate();
}

DownloadRateManager.prototype.eventList = eventList;

DownloadRateManager.prototype.downloadRates = downloadRates;

DownloadRateManager.prototype.determineDownloadRate = function() {
    var self = this,
        currentDownloadRate,
        finalDownloadRate = downloadRates.DONT_DOWNLOAD;

    // TODO: Make relationship between rules smarter once we implement multiple rules.
    self.__downloadRateRules.forEach(function(downloadRateRule) {
        currentDownloadRate = downloadRateRule.getDownloadRate();
        if (currentDownloadRate > finalDownloadRate) { finalDownloadRate = currentDownloadRate; }
    });

    if (finalDownloadRate !== self.__lastDownloadRate) {
        self.__lastDownloadRate = finalDownloadRate;
        self.trigger({
            type:self.eventList.DOWNLOAD_RATE_CHANGED,
            target:self,
            downloadRate:self.__lastDownloadRate
        });
    }

    return finalDownloadRate;
};

DownloadRateManager.prototype.addDownloadRateRule = function(downloadRateRule) {
    var self = this;
    self.__downloadRateRules.push(downloadRateRule);
    addEventHandlerToRule(self, downloadRateRule);
};

// Add event dispatcher functionality to prototype.
extendObject(DownloadRateManager.prototype, EventDispatcherMixin);

module.exports = DownloadRateManager;
},{"../events/EventDispatcherMixin.js":11,"../util/extendObject.js":21,"../util/isArray.js":22,"./downloadRate/DownloadRateEventTypes.js":16,"./downloadRate/DownloadRates.js":17}],16:[function(require,module,exports){
var eventList = {
    DOWNLOAD_RATE_CHANGED: 'downloadRateChanged'
};

module.exports = eventList;
},{}],17:[function(require,module,exports){
'use strict';

var downloadRates = {
    DONT_DOWNLOAD: 0,
    PLAYBACK_RATE: 1000,
    DOWNLOAD_RATE: 10000
};

module.exports = downloadRates;
},{}],18:[function(require,module,exports){
'use strict';

var extendObject = require('../../util/extendObject.js'),
    EventDispatcherMixin = require('../../events/EventDispatcherMixin.js'),
    downloadRates = require('./DownloadRates.js'),
    eventList = require('./DownloadRateEventTypes.js'),
    downloadAndPlaybackEvents = [
        'loadstart',
        'durationchange',
        'loadedmetadata',
        'loadeddata',
        'progress',
        'canplay',
        'canplaythrough'
    ],
    readyStates = {
        HAVE_NOTHING: 0,
        HAVE_METADATA: 1,
        HAVE_CURRENT_DATA: 2,
        HAVE_FUTURE_DATA: 3,
        HAVE_ENOUGH_DATA: 4
    };

function getReadyState(tech) {
    return tech.el().readyState;
}

function VideoReadyStateRule(tech) {
    var self = this;
    // TODO: Null/type check
    this.__tech = tech;
    this.__downloadRate = this.downloadRates.DONT_DOWNLOAD;

    function determineDownloadRate() {
        var downloadRate = (getReadyState(self.__tech) === readyStates.HAVE_ENOUGH_DATA) ?
            self.downloadRates.PLAYBACK_RATE :
            self.downloadRates.DOWNLOAD_RATE;
        return downloadRate;
    }

    function updateDownloadRate() {
        var newDownloadRate = determineDownloadRate();
        if (self.__downloadRate !== newDownloadRate) {
            console.log('DOWNLOAD RATE CHANGED TO: ' + newDownloadRate);
            self.__downloadRate = newDownloadRate;
            self.trigger({
                type:self.eventList.DOWNLOAD_RATE_CHANGED,
                target:self,
                downloadRate:self.__downloadRate
            });
        }
    }

    downloadAndPlaybackEvents.forEach(function(eventName) {
        tech.on(eventName, function() {
            updateDownloadRate();
        });
    });

    updateDownloadRate();
}

VideoReadyStateRule.prototype.eventList = eventList;

// Value Meanings:
//
// DONT_DOWNLOAD -  Should not download segments.
// PLAYBACK_RATE -  Download the next segment at the rate it takes to complete playback of the previous segment.
//                  In other words, once the data for the current segment has been downloaded,
//                  wait until segment.getDuration() seconds of stream playback have elapsed before starting the
//                  download of the next segment.
// DOWNLOAD_RATE -  Download the next segment once the previous segment has finished downloading.
VideoReadyStateRule.prototype.downloadRates = downloadRates;

VideoReadyStateRule.prototype.getDownloadRate = function() {
    return this.__downloadRate;
};

// Add event dispatcher functionality to prototype.
extendObject(VideoReadyStateRule.prototype, EventDispatcherMixin);

module.exports = VideoReadyStateRule;
},{"../../events/EventDispatcherMixin.js":11,"../../util/extendObject.js":21,"./DownloadRateEventTypes.js":16,"./DownloadRates.js":17}],19:[function(require,module,exports){

var extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    getSegmentListForRepresentation = require('../dash/segments/getSegmentListForRepresentation.js'),
    loadSegment,
    DEFAULT_RETRY_COUNT = 3,
    DEFAULT_RETRY_INTERVAL = 250;

loadSegment = function(segment, callbackFn, retryCount, retryInterval) {
    var request = new XMLHttpRequest();
    request.open('GET', segment.getUrl(), true);
    request.responseType = 'arraybuffer';

    request.onload = function() {
        //console.log('Loaded Segment @ URL: ' + segment.getUrl());
        if (request.status < 200 || request.status > 299) {
            console.log('Failed to load Segment @ URL: ' + segment.getUrl());
            if (retryCount > 0) {
                setTimeout(function() {
                    loadSegment(segment, callbackFn, retryCount - 1, retryInterval);
                }, retryInterval);
            } else {
                console.log('FAILED TO LOAD SEGMENT EVEN AFTER RETRIES');
            }
            return;
        }

        if (typeof callbackFn === 'function') { callbackFn(request.response); }
    };
    //request.onerror = request.onloadend = function() {
    request.onerror = function() {
        console.log('Failed to load Segment @ URL: ' + segment.getUrl());
        if (retryCount > 0) {
            setTimeout(function() {
                loadSegment(segment, callbackFn, retryCount - 1, retryInterval);
            }, retryInterval);
        } else {
            console.log('FAILED TO LOAD SEGMENT EVEN AFTER RETRIES');
        }
        return;
    };

    request.send();
};

function SegmentLoader(adaptationSet, /* optional */ currentSegmentNumber) {
    //this.__eventDispatcherDelegate = new EventDispatcherDelegate(this);
    this.__adaptationSet = adaptationSet;
    // Initialize to 0th representation.
    this.__currentRepresentation = adaptationSet.getRepresentations()[0];
    this.__currentSegmentNumber = currentSegmentNumber;
}

SegmentLoader.prototype.eventList = {
    INITIALIZATION_LOADED: 'initializationLoaded',
    SEGMENT_LOADED: 'segmentLoaded'
};

SegmentLoader.prototype.getCurrentRepresentation = function() { return this.__currentRepresentation; };

SegmentLoader.prototype.setCurrentRepresentation = function(representation) { this.__currentRepresentation = representation; };

SegmentLoader.prototype.getCurrentSegment = function() {
    var segmentList = getSegmentListForRepresentation(this.__currentRepresentation);
    var segment = segmentList.getSegmentByNumber(this.__currentSegmentNumber);
    return segment;
};

SegmentLoader.prototype.setCurrentRepresentationByIndex = function(index) {
    var representations = this.__adaptationSet.getRepresentations();
    if (index < 0 || index >= representations.length) {
        throw new Error('index out of bounds');
    }
    this.__currentRepresentation = representations[index];
};

SegmentLoader.prototype.getCurrentSegmentNumber = function() { return this.__currentSegmentNumber; };

SegmentLoader.prototype.getStartSegmentNumber = function() {
    return getSegmentListForRepresentation(this.__currentRepresentation).getStartNumber();
};

SegmentLoader.prototype.getEndSegmentNumber = function() {
    return getSegmentListForRepresentation(this.__currentRepresentation).getEndNumber();
};

SegmentLoader.prototype.loadInitialization = function() {
    var self = this,
        segmentList = getSegmentListForRepresentation(this.__currentRepresentation),
        initialization = segmentList.getInitialization();

    if (!initialization) { return false; }

    loadSegment.call(this, initialization, function(response) {
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.INITIALIZATION_LOADED, target:self, data:initSegment});
    });

    return true;
};

// TODO: Determine how to parameterize by representation variants (bandwidth/bitrate? representation object? index?)
SegmentLoader.prototype.loadNextSegment = function() {
    var noCurrentSegmentNumber = ((this.__currentSegmentNumber === null) || (this.__currentSegmentNumber === undefined)),
        number = noCurrentSegmentNumber ? 0 : this.__currentSegmentNumber + 1;
    return this.loadSegmentAtNumber(number);
};

// TODO: Duplicate code below. Abstract away.
SegmentLoader.prototype.loadSegmentAtNumber = function(number) {
    var self = this,
        segmentList = getSegmentListForRepresentation(this.__currentRepresentation);

    if (number > segmentList.getEndNumber()) { return false; }

    var segment = segmentList.getSegmentByNumber(number);

    loadSegment.call(this, segment, function(response) {
        self.__currentSegmentNumber = segment.getNumber();
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:initSegment});
    }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);

    return true;
};

SegmentLoader.prototype.loadSegmentAtTime = function(presentationTime) {
    var self = this,
        segmentList = getSegmentListForRepresentation(this.__currentRepresentation);

    if (presentationTime > segmentList.getTotalDuration()) { return false; }

    var segment = segmentList.getSegmentByTime(presentationTime);

    loadSegment.call(this, segment, function(response) {
        self.__currentSegmentNumber = segment.getNumber();
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:initSegment});
    }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);

    return true;
};

// Add event dispatcher functionality to prototype.
extendObject(SegmentLoader.prototype, EventDispatcherMixin);

module.exports = SegmentLoader;
},{"../dash/segments/getSegmentListForRepresentation.js":9,"../events/EventDispatcherMixin.js":11,"../util/extendObject.js":21}],20:[function(require,module,exports){
'use strict';

var extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js');

// TODO: This logic should be in mse.js
function appendBytes(buffer, bytes) {
    if ('append' in buffer) {
        buffer.append(bytes);
    } else if ('appendBuffer' in buffer) {
        buffer.appendBuffer(bytes);
    }
}

function SourceBufferDataQueue(sourceBuffer) {
    // TODO: Check type?
    if (!sourceBuffer) { throw new Error( 'The sourceBuffer constructor argument cannot be null.' ); }

    var self = this,
        dataQueue = [];
    // TODO: figure out how we want to respond to other event states (updateend? error? abort?) (retry? remove?)
    sourceBuffer.addEventListener('updateend', function(e) {
        // The SourceBuffer instance's updating property should always be false if this event was dispatched,
        // but just in case...
        if (e.target.updating) { return; }

        self.trigger({ type:self.eventList.SEGMENT_ADDED_TO_BUFFER, target:self });

        if (dataQueue.length <= 0) {
            self.trigger({ type:self.eventList.QUEUE_EMPTY, target:self });
            return;
        }

        appendBytes(e.target, dataQueue.shift());
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
    // TODO: Check for existence/type? Convert to Uint8Array externally or internally? (Currently assuming external)
    // If nothing is in the queue, go ahead and immediately append the segment data to the source buffer.
    if ((this.__dataQueue.length === 0) && (!this.__sourceBuffer.updating)) { appendBytes(this.__sourceBuffer, data); }
    // Otherwise, push onto queue and wait for the next update event before appending segment data to source buffer.
    else { this.__dataQueue.push(data); }
};

SourceBufferDataQueue.prototype.clearQueue = function() {
    this.__dataQueue = [];
};

// Add event dispatcher functionality to prototype.
extendObject(SourceBufferDataQueue.prototype, EventDispatcherMixin);

module.exports = SourceBufferDataQueue;
},{"../events/EventDispatcherMixin.js":11,"../util/extendObject.js":21}],21:[function(require,module,exports){
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
},{}],22:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],23:[function(require,module,exports){
module.exports=require(3)
},{"/Users/cpillsbury/dev/JavaScript/VideoJSHtml5DashWorkspace/vjs-html5-dash/node_modules/mse.js/src/js/window.js":3}],24:[function(require,module,exports){
'use strict';

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
},{}]},{},[13])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvbXNlLmpzL3NyYy9qcy9NZWRpYVNvdXJjZS5qcyIsIm5vZGVfbW9kdWxlcy9tc2UuanMvc3JjL2pzL21zZS5qcyIsIm5vZGVfbW9kdWxlcy9tc2UuanMvc3JjL2pzL3dpbmRvdy5qcyIsInNyYy9qcy9QbGF5bGlzdExvYWRlci5qcyIsInNyYy9qcy9Tb3VyY2VIYW5kbGVyLmpzIiwic3JjL2pzL1N0cmVhbUxvYWRlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvcnVsZXMvRG93bmxvYWRSYXRlTWFuYWdlci5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlRXZlbnRUeXBlcy5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlcy5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvVmlkZW9SZWFkeVN0YXRlUnVsZS5qcyIsInNyYy9qcy9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzIiwic3JjL2pzL3NvdXJjZUJ1ZmZlci9Tb3VyY2VCdWZmZXJEYXRhUXVldWUuanMiLCJzcmMvanMvdXRpbC9leHRlbmRPYmplY3QuanMiLCJzcmMvanMvdXRpbC9pc0FycmF5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNU1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxudmFyIHJvb3QgPSByZXF1aXJlKCcuL3dpbmRvdy5qcycpLFxuXG4gICAgbWVkaWFTb3VyY2VDbGFzc05hbWUgPSAnTWVkaWFTb3VyY2UnLFxuICAgIHdlYktpdE1lZGlhU291cmNlQ2xhc3NOYW1lID0gJ1dlYktpdE1lZGlhU291cmNlJyxcbiAgICBtZWRpYVNvdXJjZUV2ZW50cyA9IFsnc291cmNlb3BlbicsICdzb3VyY2VjbG9zZScsICdzb3VyY2VlbmRlZCddLFxuICAgIC8vIFRPRE86IFRlc3QgdG8gdmVyaWZ5IHRoYXQgd2Via2l0IHByZWZpeGVzIHRoZSAnc291cmNlZW5kZWQnIGV2ZW50IHR5cGUuXG4gICAgd2ViS2l0TWVkaWFTb3VyY2VFdmVudHMgPSBbJ3dlYmtpdHNvdXJjZW9wZW4nLCAnd2Via2l0c291cmNlY2xvc2UnLCAnd2Via2l0c291cmNlZW5kZWQnXTtcblxuZnVuY3Rpb24gaGFzQ2xhc3NSZWZlcmVuY2Uob2JqZWN0LCBjbGFzc05hbWUpIHtcbiAgICByZXR1cm4gKChjbGFzc05hbWUgaW4gb2JqZWN0KSAmJiAodHlwZW9mIG9iamVjdFtjbGFzc05hbWVdID09PSAnZnVuY3Rpb24nKSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50c01hcChrZXlzQXJyYXksIHZhbHVlc0FycmF5KSB7XG4gICAgaWYgKCFrZXlzQXJyYXkgfHwgIXZhbHVlc0FycmF5IHx8IGtleXNBcnJheS5sZW5ndGggIT09IHZhbHVlc0FycmF5Lmxlbmd0aCkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHZhciBtYXAgPSB7fTtcbiAgICBmb3IgKHZhciBpPTA7IGk8a2V5c0FycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIG1hcFtrZXlzQXJyYXlbaV1dID0gdmFsdWVzQXJyYXlbaV07XG4gICAgfVxuXG4gICAgcmV0dXJuIG1hcDtcbn1cblxuZnVuY3Rpb24gb3ZlcnJpZGVFdmVudEZuKGNsYXNzUmVmLCBldmVudEZuTmFtZSwgZXZlbnRzTWFwKSB7XG4gICAgdmFyIG9yaWdpbmFsRm4gPSBjbGFzc1JlZi5wcm90b3R5cGVbZXZlbnRGbk5hbWVdO1xuICAgIGNsYXNzUmVmLnByb3RvdHlwZVtldmVudEZuTmFtZV0gPSBmdW5jdGlvbih0eXBlIC8qLCBjYWxsYmFjaywgdXNlQ2FwdHVyZSAqLykge1xuICAgICAgICBvcmlnaW5hbEZuLmFwcGx5KHRoaXMsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cykpO1xuICAgICAgICBpZiAoISh0eXBlIGluIGV2ZW50c01hcCkpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciByZXN0QXJnc0FycmF5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgICAgIG5ld0FyZ3NBcnJheSA9IFtldmVudHNNYXBbdHlwZV1dLmNvbmNhdChyZXN0QXJnc0FycmF5KTtcbiAgICAgICAgb3JpZ2luYWxGbi5hcHBseSh0aGlzLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChuZXdBcmdzQXJyYXkpKTtcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBnZXRNZWRpYVNvdXJjZUNsYXNzKHJvb3QpIHtcbiAgICAvLyBJZiB0aGUgcm9vdCAod2luZG93KSBoYXMgTWVkaWFTb3VyY2UsIG5vdGhpbmcgdG8gZG8gc28gc2ltcGx5IHJldHVybiB0aGUgcmVmLlxuICAgIGlmIChoYXNDbGFzc1JlZmVyZW5jZShyb290LCBtZWRpYVNvdXJjZUNsYXNzTmFtZSkpIHsgcmV0dXJuIHJvb3RbbWVkaWFTb3VyY2VDbGFzc05hbWVdOyB9XG4gICAgLy8gSWYgdGhlIHJvb3QgKHdpbmRvdykgaGFzIFdlYktpdE1lZGlhU291cmNlLCBvdmVycmlkZSBpdHMgYWRkL3JlbW92ZSBldmVudCBmdW5jdGlvbnMgdG8gbWVldCB0aGUgVzNDXG4gICAgLy8gc3BlYyBmb3IgZXZlbnQgdHlwZXMgYW5kIHJldHVybiBhIHJlZiB0byBpdC5cbiAgICBlbHNlIGlmIChoYXNDbGFzc1JlZmVyZW5jZShyb290LCB3ZWJLaXRNZWRpYVNvdXJjZUNsYXNzTmFtZSkpIHtcbiAgICAgICAgdmFyIGNsYXNzUmVmID0gcm9vdFt3ZWJLaXRNZWRpYVNvdXJjZUNsYXNzTmFtZV0sXG4gICAgICAgICAgICBldmVudHNNYXAgPSBjcmVhdGVFdmVudHNNYXAobWVkaWFTb3VyY2VFdmVudHMsIHdlYktpdE1lZGlhU291cmNlRXZlbnRzKTtcblxuICAgICAgICBvdmVycmlkZUV2ZW50Rm4oY2xhc3NSZWYsICdhZGRFdmVudExpc3RlbmVyJywgZXZlbnRzTWFwKTtcbiAgICAgICAgb3ZlcnJpZGVFdmVudEZuKGNsYXNzUmVmLCAncmVtb3ZlRXZlbnRMaXN0ZW5lcicsIGV2ZW50c01hcCk7XG5cbiAgICAgICAgcmV0dXJuIGNsYXNzUmVmO1xuICAgIH1cblxuICAgIC8vIE90aGVyd2lzZSwgKHN0YW5kYXJkIG9yIG5vbnN0YW5kYXJkKSBNZWRpYVNvdXJjZSBkb2Vzbid0IGFwcGVhciB0byBiZSBuYXRpdmVseSBzdXBwb3J0ZWQsIHNvIHJldHVyblxuICAgIC8vIGEgZ2VuZXJpYyBmdW5jdGlvbiB0aGF0IHRocm93cyBhbiBlcnJvciB3aGVuIGNhbGxlZC5cbiAgICAvLyBUT0RPOiBUaHJvdyBlcnJvciBpbW1lZGlhdGVseSBpbnN0ZWFkIChvciBib3RoKT9cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7IHRocm93IG5ldyBFcnJvcignTWVkaWFTb3VyY2UgZG9lc25cXCd0IGFwcGVhciB0byBiZSBzdXBwb3J0ZWQgaW4geW91ciBlbnZpcm9ubWVudCcpOyB9O1xufVxuXG52YXIgTWVkaWFTb3VyY2UgPSBnZXRNZWRpYVNvdXJjZUNsYXNzKHJvb3QpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhU291cmNlOyIsIjsoZnVuY3Rpb24oKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIHJvb3QgPSByZXF1aXJlKCcuL3dpbmRvdy5qcycpLFxuICAgICAgICBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJy4vTWVkaWFTb3VyY2UnKTtcblxuICAgIGZ1bmN0aW9uIG1lZGlhU291cmNlU2hpbShyb290LCBtZWRpYVNvdXJjZUNsYXNzKSB7XG4gICAgICAgIHJvb3QuTWVkaWFTb3VyY2UgPSBtZWRpYVNvdXJjZUNsYXNzO1xuICAgIH1cblxuICAgIG1lZGlhU291cmNlU2hpbShyb290LCBNZWRpYVNvdXJjZSk7XG59LmNhbGwodGhpcykpOyIsIihmdW5jdGlvbiAoZ2xvYmFsKXtcbi8vIENyZWF0ZSBhIHNpbXBsZSBtb2R1bGUgdG8gcmVmZXIgdG8gdGhlIHdpbmRvdy9nbG9iYWwgb2JqZWN0IHRvIG1ha2UgbW9ja2luZyB0aGUgd2luZG93IG9iamVjdCBhbmQgaXRzXG4vLyBwcm9wZXJ0aWVzIGNsZWFuZXIgd2hlbiB0ZXN0aW5nLlxuJ3VzZSBzdHJpY3QnO1xubW9kdWxlLmV4cG9ydHMgPSBnbG9iYWw7XG59KS5jYWxsKHRoaXMsdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSkiLCIndXNlIHN0cmljdCc7XG5cbnZhciBTZWdtZW50TG9hZGVyID0gcmVxdWlyZSgnLi9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzJyksXG4gICAgU291cmNlQnVmZmVyRGF0YVF1ZXVlID0gcmVxdWlyZSgnLi9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzJyksXG4gICAgRG93bmxvYWRSYXRlTWFuYWdlciA9IHJlcXVpcmUoJy4vcnVsZXMvRG93bmxvYWRSYXRlTWFuYWdlci5qcycpLFxuICAgIFZpZGVvUmVhZHlTdGF0ZVJ1bGUgPSByZXF1aXJlKCcuL3J1bGVzL2Rvd25sb2FkUmF0ZS9WaWRlb1JlYWR5U3RhdGVSdWxlLmpzJyksXG4gICAgU3RyZWFtTG9hZGVyID0gcmVxdWlyZSgnLi9TdHJlYW1Mb2FkZXIuanMnKSxcbiAgICBnZXRNcGQgPSByZXF1aXJlKCcuL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIHN0cmVhbVR5cGVzID0gWyd2aWRlbycsICdhdWRpbyddO1xuXG5mdW5jdGlvbiBsb2FkSW5pdGlhbGl6YXRpb24oc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlKSB7XG4gICAgc2VnbWVudExvYWRlci5vbmUoc2VnbWVudExvYWRlci5ldmVudExpc3QuSU5JVElBTElaQVRJT05fTE9BREVELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUub25lKHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5ldmVudExpc3QuUVVFVUVfRU1QVFksIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBsb2FkU2VnbWVudHMoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5hZGRUb1F1ZXVlKGV2ZW50LmRhdGEpO1xuICAgIH0pO1xuICAgIHNlZ21lbnRMb2FkZXIubG9hZEluaXRpYWxpemF0aW9uKCk7XG59XG5cbmZ1bmN0aW9uIGxvYWRTZWdtZW50cyhzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUpIHtcbiAgICAvL3ZhciBzZWdtZW50cyA9IFtdO1xuICAgIHNlZ21lbnRMb2FkZXIub24oc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIGZ1bmN0aW9uIHNlZ21lbnRMb2FkZWRIYW5kbGVyKGV2ZW50KSB7XG4gICAgICAgIC8vc2VnbWVudHMucHVzaChldmVudC5kYXRhKTtcbiAgICAgICAgLy9jb25zb2xlLmxvZygnQ3VycmVudCBTZWdtZW50IENvdW50OiAnICsgc2VnbWVudHMubGVuZ3RoKTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGxvYWRpbmcgPSBzZWdtZW50TG9hZGVyLmxvYWROZXh0U2VnbWVudCgpO1xuICAgICAgICAgICAgaWYgKCFsb2FkaW5nKSB7XG4gICAgICAgICAgICAgICAgc2VnbWVudExvYWRlci5vZmYoc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHNlZ21lbnRMb2FkZWRIYW5kbGVyKTtcbiAgICAgICAgICAgICAgICAvKmNvbnNvbGUubG9nKCk7XG4gICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCk7XG4gICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCk7XG4gICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGaW5hbCBTZWdtZW50IENvdW50OiAnICsgc2VnbWVudHMubGVuZ3RoKTsqL1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG5cbiAgICBzZWdtZW50TG9hZGVyLmxvYWROZXh0U2VnbWVudCgpO1xufVxuXG4vLyBUT0RPOiBNb3ZlIHRoaXMgZWxzZXdoZXJlIChXaGVyZT8pXG5mdW5jdGlvbiBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVNlZ21lbnRMb2FkZXJCeVR5cGUobWFuaWZlc3QsIHN0cmVhbVR5cGUpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldCA9IGdldE1wZChtYW5pZmVzdCkuZ2V0UGVyaW9kcygpWzBdLmdldEFkYXB0YXRpb25TZXRCeVR5cGUoc3RyZWFtVHlwZSk7XG4gICAgcmV0dXJuIGFkYXB0YXRpb25TZXQgPyBuZXcgU2VnbWVudExvYWRlcihhZGFwdGF0aW9uU2V0KSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIHN0cmVhbVR5cGUpIHtcbiAgICAvLyBOT1RFOiBTaW5jZSBjb2RlY3Mgb2YgcGFydGljdWxhciByZXByZXNlbnRhdGlvbnMgKHN0cmVhbSB2YXJpYW50cykgbWF5IHZhcnkgc2xpZ2h0bHksIG5lZWQgdG8gZ2V0IHNwZWNpZmljXG4gICAgLy8gcmVwcmVzZW50YXRpb24gdG8gZ2V0IHR5cGUgZm9yIHNvdXJjZSBidWZmZXIuXG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gZ2V0TXBkKG1hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldEJ5VHlwZShzdHJlYW1UeXBlKS5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc291cmNlQnVmZmVyVHlwZSA9IGdldFNvdXJjZUJ1ZmZlclR5cGVGcm9tUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBzb3VyY2VCdWZmZXIgPSBtZWRpYVNvdXJjZS5hZGRTb3VyY2VCdWZmZXIoc291cmNlQnVmZmVyVHlwZSk7XG5cbiAgICByZXR1cm4gc291cmNlQnVmZmVyID8gbmV3IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtTG9hZGVyRm9yVHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIHN0cmVhbVR5cGUpIHtcbiAgICB2YXIgc2VnbWVudExvYWRlcixcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuXG4gICAgc2VnbWVudExvYWRlciA9IGNyZWF0ZVNlZ21lbnRMb2FkZXJCeVR5cGUobWFuaWZlc3QsIHN0cmVhbVR5cGUpO1xuICAgIGlmICghc2VnbWVudExvYWRlcikgeyByZXR1cm4gbnVsbDsgfVxuICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIHN0cmVhbVR5cGUpO1xuICAgIGlmICghc291cmNlQnVmZmVyRGF0YVF1ZXVlKSB7IHJldHVybiBudWxsOyB9XG4gICAgcmV0dXJuIG5ldyBTdHJlYW1Mb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBzdHJlYW1UeXBlKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtTG9hZGVyc0ZvclR5cGVzKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgc3RyZWFtVHlwZXMpIHtcbiAgICB2YXIgc3RyZWFtTG9hZGVycyA9IFtdLFxuICAgICAgICBjdXJyZW50U3RyZWFtTG9hZGVyO1xuXG4gICAgc3RyZWFtVHlwZXMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW1UeXBlKSB7XG4gICAgICAgIGN1cnJlbnRTdHJlYW1Mb2FkZXIgPSBjcmVhdGVTdHJlYW1Mb2FkZXJGb3JUeXBlKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgc3RyZWFtVHlwZSk7XG4gICAgICAgIGlmIChjdXJyZW50U3RyZWFtTG9hZGVyKSB7IHN0cmVhbUxvYWRlcnMucHVzaChjdXJyZW50U3RyZWFtTG9hZGVyKTsgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHN0cmVhbUxvYWRlcnM7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbUxvYWRlcnMobWFuaWZlc3QsIG1lZGlhU291cmNlKSB7IHJldHVybiBjcmVhdGVTdHJlYW1Mb2FkZXJzRm9yVHlwZXMobWFuaWZlc3QsIG1lZGlhU291cmNlLCBzdHJlYW1UeXBlcyk7IH1cblxuZnVuY3Rpb24gUGxheWxpc3RMb2FkZXIobWFuaWZlc3QsIG1lZGlhU291cmNlLCB0ZWNoKSB7XG4gICAgdGhpcy5fX2Rvd25sb2FkUmF0ZU1nciA9IG5ldyBEb3dubG9hZFJhdGVNYW5hZ2VyKFtuZXcgVmlkZW9SZWFkeVN0YXRlUnVsZSh0ZWNoKV0pO1xuICAgIHRoaXMuX19zdHJlYW1Mb2FkZXJzID0gY3JlYXRlU3RyZWFtTG9hZGVycyhtYW5pZmVzdCwgbWVkaWFTb3VyY2UpO1xuICAgIHRoaXMuX19zdHJlYW1Mb2FkZXJzLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtTG9hZGVyKSB7XG4gICAgICAgIGxvYWRJbml0aWFsaXphdGlvbihzdHJlYW1Mb2FkZXIuZ2V0U2VnbWVudExvYWRlcigpLCBzdHJlYW1Mb2FkZXIuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlKCkpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFBsYXlsaXN0TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIE1lZGlhU291cmNlID0gcmVxdWlyZSgnLi93aW5kb3cuanMnKS5NZWRpYVNvdXJjZSxcbiAgICBsb2FkTWFuaWZlc3QgPSByZXF1aXJlKCcuL21hbmlmZXN0L2xvYWRNYW5pZmVzdC5qcycpLFxuICAgIFBsYXlsaXN0TG9hZGVyID0gcmVxdWlyZSgnLi9QbGF5bGlzdExvYWRlci5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBsb2FkTWFuaWZlc3Qoc291cmNlLnNyYywgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAvL2xvYWQoZGF0YS5tYW5pZmVzdFhtbCwgdGVjaCk7XG4gICAgICAgIHZhciBtYW5pZmVzdCA9IHNlbGYuX19tYW5pZmVzdCA9IGRhdGEubWFuaWZlc3RYbWw7XG4gICAgICAgIGNvbnNvbGUubG9nKCdTVEFSVCcpO1xuXG4gICAgICAgIHZhciBtZWRpYVNvdXJjZSA9IG5ldyBNZWRpYVNvdXJjZSgpLFxuICAgICAgICAgICAgb3Blbkxpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgICAgICBtZWRpYVNvdXJjZS5yZW1vdmVFdmVudExpc3RlbmVyKCdzb3VyY2VvcGVuJywgb3Blbkxpc3RlbmVyLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX3BsYXlsaXN0TG9hZGVyID0gbmV3IFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgdGVjaCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgY2xvc2UuXG4gICAgICAgIC8vbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignd2Via2l0c291cmNlY2xvc2UnLCBjbG9zZWQsIGZhbHNlKTtcbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgICAgIHRlY2guc2V0U3JjKFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpKTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VIYW5kbGVyOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gU3RyZWFtTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgc3RyZWFtVHlwZSkge1xuICAgIHRoaXMuX19zZWdtZW50TG9hZGVyID0gc2VnbWVudExvYWRlcjtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zdHJlYW1UeXBlID0gc3RyZWFtVHlwZTtcbn1cblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRTdHJlYW1UeXBlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc3RyZWFtVHlwZTsgfTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRTZWdtZW50TG9hZGVyID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc2VnbWVudExvYWRlcjsgfTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRTb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWU7IH07XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zZWdtZW50TG9hZGVyLmdldEN1cnJlbnRJbmRleCgpOyB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmVhbUxvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICB1dGlsID0gcmVxdWlyZSgnLi91dGlsLmpzJyksXG4gICAgcGFyc2VSb290VXJsID0gdXRpbC5wYXJzZVJvb3RVcmwsXG4gICAgY3JlYXRlTXBkT2JqZWN0LFxuICAgIGNyZWF0ZVBlcmlvZE9iamVjdCxcbiAgICBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0LFxuICAgIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0LFxuICAgIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZSxcbiAgICBnZXRNcGQsXG4gICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSxcbiAgICBnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLFxuICAgIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lO1xuXG4vLyBUT0RPOiBTaG91bGQgdGhpcyBleGlzdCBvbiBtcGQgZGF0YXZpZXcgb3IgYXQgYSBoaWdoZXIgbGV2ZWw/XG4vLyBUT0RPOiBSZWZhY3Rvci4gQ291bGQgYmUgbW9yZSBlZmZpY2llbnQgKFJlY3Vyc2l2ZSBmbj8gVXNlIGVsZW1lbnQuZ2V0RWxlbWVudHNCeU5hbWUoJ0Jhc2VVcmwnKVswXT8pLlxuLy8gVE9ETzogQ3VycmVudGx5IGFzc3VtaW5nICpFSVRIRVIqIDxCYXNlVVJMPiBub2RlcyB3aWxsIHByb3ZpZGUgYW4gYWJzb2x1dGUgYmFzZSB1cmwgKGllIHJlc29sdmUgdG8gJ2h0dHA6Ly8nIGV0Yylcbi8vIFRPRE86ICpPUiogd2Ugc2hvdWxkIHVzZSB0aGUgYmFzZSB1cmwgb2YgdGhlIGhvc3Qgb2YgdGhlIE1QRCBtYW5pZmVzdC5cbnZhciBidWlsZEJhc2VVcmwgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgdmFyIGVsZW1IaWVyYXJjaHkgPSBbeG1sTm9kZV0uY29uY2F0KHhtbGZ1bi5nZXRBbmNlc3RvcnMoeG1sTm9kZSkpLFxuICAgICAgICBmb3VuZExvY2FsQmFzZVVybCA9IGZhbHNlO1xuICAgIC8vdmFyIGJhc2VVcmxzID0gXy5tYXAoZWxlbUhpZXJhcmNoeSwgZnVuY3Rpb24oZWxlbSkge1xuICAgIHZhciBiYXNlVXJscyA9IGVsZW1IaWVyYXJjaHkubWFwKGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKGZvdW5kTG9jYWxCYXNlVXJsKSB7IHJldHVybiAnJzsgfVxuICAgICAgICBpZiAoIWVsZW0uaGFzQ2hpbGROb2RlcygpKSB7IHJldHVybiAnJzsgfVxuICAgICAgICB2YXIgY2hpbGQ7XG4gICAgICAgIGZvciAodmFyIGk9MDsgaTxlbGVtLmNoaWxkTm9kZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNoaWxkID0gZWxlbS5jaGlsZE5vZGVzLml0ZW0oaSk7XG4gICAgICAgICAgICBpZiAoY2hpbGQubm9kZU5hbWUgPT09ICdCYXNlVVJMJykge1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0RWxlbSA9IGNoaWxkLmNoaWxkTm9kZXMuaXRlbSgwKTtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dFZhbHVlID0gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgICAgICBpZiAodGV4dFZhbHVlLmluZGV4T2YoJ2h0dHA6Ly8nKSA9PT0gMCkgeyBmb3VuZExvY2FsQmFzZVVybCA9IHRydWU7IH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGV4dEVsZW0ud2hvbGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAnJztcbiAgICB9KTtcblxuICAgIHZhciBiYXNlVXJsID0gYmFzZVVybHMucmV2ZXJzZSgpLmpvaW4oJycpO1xuICAgIGlmICghYmFzZVVybCkgeyByZXR1cm4gcGFyc2VSb290VXJsKHhtbE5vZGUuYmFzZVVSSSk7IH1cbiAgICByZXR1cm4gYmFzZVVybDtcbn07XG5cbnZhciBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzID0gW1xuICAgICdBZGFwdGF0aW9uU2V0JyxcbiAgICAnUmVwcmVzZW50YXRpb24nLFxuICAgICdTdWJSZXByZXNlbnRhdGlvbidcbl07XG5cbnZhciBoYXNDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiBlbGVtc1dpdGhDb21tb25Qcm9wZXJ0aWVzLmluZGV4T2YoZWxlbS5ub2RlTmFtZSkgPj0gMDtcbn07XG5cbnZhciBkb2VzbnRIYXZlQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gIWhhc0NvbW1vblByb3BlcnRpZXMoZWxlbSk7XG59O1xuXG52YXIgZ2V0V2lkdGggPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ3dpZHRoJyksXG4gICAgZ2V0SGVpZ2h0ID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdoZWlnaHQnKSxcbiAgICBnZXRGcmFtZVJhdGUgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2ZyYW1lUmF0ZScpLFxuICAgIGdldE1pbWVUeXBlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdtaW1lVHlwZScpLFxuICAgIGdldENvZGVjcyA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnY29kZWNzJyk7XG5cbnZhciBnZXRTZWdtZW50VGVtcGxhdGVYbWwgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVFbGVtZW50KCdTZWdtZW50VGVtcGxhdGUnLCBkb2VzbnRIYXZlQ29tbW9uUHJvcGVydGllcyk7XG5cbi8vIE1QRCBBdHRyIGZuc1xudmFyIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uJyk7XG5cbi8vIFJlcHJlc2VudGF0aW9uIEF0dHIgZm5zXG52YXIgZ2V0SWQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdpZCcpLFxuICAgIGdldEJhbmR3aWR0aCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2JhbmR3aWR0aCcpO1xuXG4vLyBTZWdtZW50VGVtcGxhdGUgQXR0ciBmbnNcbnZhciBnZXRJbml0aWFsaXphdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2luaXRpYWxpemF0aW9uJyksXG4gICAgZ2V0TWVkaWEgPSB4bWxmdW4uZ2V0QXR0ckZuKCdtZWRpYScpLFxuICAgIGdldER1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignZHVyYXRpb24nKSxcbiAgICBnZXRUaW1lc2NhbGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0aW1lc2NhbGUnKSxcbiAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0ID0geG1sZnVuLmdldEF0dHJGbigncHJlc2VudGF0aW9uVGltZU9mZnNldCcpLFxuICAgIGdldFN0YXJ0TnVtYmVyID0geG1sZnVuLmdldEF0dHJGbignc3RhcnROdW1iZXInKTtcblxuLy8gVE9ETzogUmVwZWF0IGNvZGUuIEFic3RyYWN0IGF3YXkgKFByb3RvdHlwYWwgSW5oZXJpdGFuY2UvT08gTW9kZWw/IE9iamVjdCBjb21wb3NlciBmbj8pXG5jcmVhdGVNcGRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFBlcmlvZHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWwoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElkLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgeG1sTm9kZSksXG4gICAgICAgIGdldEZyYW1lUmF0ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEZyYW1lUmF0ZSwgeG1sTm9kZSksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldENvZGVjczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldENvZGVjcywgeG1sTm9kZSksXG4gICAgICAgIGdldEJhc2VVcmw6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihidWlsZEJhc2VVcmwsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50VGVtcGxhdGUgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SW5pdGlhbGl6YXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRNZWRpYTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVzY2FsZSwgeG1sTm9kZSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlciwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG5nZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lID0gZnVuY3Rpb24ocGFyZW50WG1sLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIHZhciBkZXNjZW5kYW50c1htbEFycmF5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwocGFyZW50WG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKHRhZ05hbWUpKTtcbiAgICAvKmlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHsgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTsgfSovXG4gICAgaWYgKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB2YXIgbWFwcGVkRWxlbSA9IGRlc2NlbmRhbnRzWG1sQXJyYXkubWFwKG1hcEZuKTtcbiAgICAgICAgcmV0dXJuICBtYXBwZWRFbGVtO1xuICAgIH1cbiAgICByZXR1cm4gZGVzY2VuZGFudHNYbWxBcnJheTtcbn07XG5cbmdldEFuY2VzdG9yT2JqZWN0QnlOYW1lID0gZnVuY3Rpb24oeG1sTm9kZSwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICBpZiAoIXRhZ05hbWUgfHwgIXhtbE5vZGUgfHwgIXhtbE5vZGUucGFyZW50Tm9kZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIGlmICgheG1sTm9kZS5wYXJlbnROb2RlLmhhc093blByb3BlcnR5KCdub2RlTmFtZScpKSB7IHJldHVybiBudWxsOyB9XG5cbiAgICBpZiAoeG1sTm9kZS5wYXJlbnROb2RlLm5vZGVOYW1lID09PSB0YWdOYW1lKSB7XG4gICAgICAgIHJldHVybiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSA/IG1hcEZuKHhtbE5vZGUucGFyZW50Tm9kZSkgOiB4bWxOb2RlLnBhcmVudE5vZGU7XG4gICAgfVxuICAgIHJldHVybiBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSh4bWxOb2RlLnBhcmVudE5vZGUsIHRhZ05hbWUsIG1hcEZuKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0TXBkOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCxcbiAgICAvLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBTRUNPTkRTX0lOX1lFQVIgPSAzNjUgKiAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NT05USCA9IDMwICogMjQgKiA2MCAqIDYwLCAvLyBub3QgcHJlY2lzZSFcbiAgICBTRUNPTkRTX0lOX0RBWSA9IDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX0hPVVIgPSA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTUlOID0gNjAsXG4gICAgTUlOVVRFU19JTl9IT1VSID0gNjAsXG4gICAgTUlMTElTRUNPTkRTX0lOX1NFQ09ORFMgPSAxMDAwLFxuICAgIGR1cmF0aW9uUmVnZXggPSAvXlAoKFtcXGQuXSopWSk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilEKT9UPygoW1xcZC5dKilIKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKVMpPy87XG5cbnBhcnNlUm9vdFVybCA9IGZ1bmN0aW9uKHVybCkge1xuICAgIGlmICh0eXBlb2YgdXJsICE9PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCcvJykgPT09IC0xKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJz8nKSAhPT0gLTEpIHtcbiAgICAgICAgdXJsID0gdXJsLnN1YnN0cmluZygwLCB1cmwuaW5kZXhPZignPycpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdXJsLnN1YnN0cmluZygwLCB1cmwubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufTtcblxuLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAvL3N0ciA9IFwiUDEwWTEwTTEwRFQxMEgxME0xMC4xU1wiO1xuICAgIHZhciBtYXRjaCA9IGR1cmF0aW9uUmVnZXguZXhlYyhzdHIpO1xuICAgIHJldHVybiAocGFyc2VGbG9hdChtYXRjaFsyXSB8fCAwKSAqIFNFQ09ORFNfSU5fWUVBUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNF0gfHwgMCkgKiBTRUNPTkRTX0lOX01PTlRIICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs2XSB8fCAwKSAqIFNFQ09ORFNfSU5fREFZICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs4XSB8fCAwKSAqIFNFQ09ORFNfSU5fSE9VUiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTBdIHx8IDApICogU0VDT05EU19JTl9NSU4gK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEyXSB8fCAwKSk7XG59O1xuXG52YXIgdXRpbCA9IHtcbiAgICBwYXJzZVJvb3RVcmw6IHBhcnNlUm9vdFVybCxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvblxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB1dGlsOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcXVpcmUoJy4uL21wZC91dGlsLmpzJykucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vc2VnbWVudFRlbXBsYXRlJyksXG4gICAgY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUsXG4gICAgZ2V0VHlwZSxcbiAgICBnZXRCYW5kd2lkdGgsXG4gICAgZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsXG4gICAgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsXG4gICAgZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlO1xuXG5nZXRUeXBlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgY29kZWNTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRDb2RlY3MoKTtcbiAgICB2YXIgdHlwZVN0ciA9IHJlcHJlc2VudGF0aW9uLmdldE1pbWVUeXBlKCk7XG5cbiAgICAvL05PVEU6IExFQURJTkcgWkVST1MgSU4gQ09ERUMgVFlQRS9TVUJUWVBFIEFSRSBURUNITklDQUxMWSBOT1QgU1BFQyBDT01QTElBTlQsIEJVVCBHUEFDICYgT1RIRVJcbiAgICAvLyBEQVNIIE1QRCBHRU5FUkFUT1JTIFBST0RVQ0UgVEhFU0UgTk9OLUNPTVBMSUFOVCBWQUxVRVMuIEhBTkRMSU5HIEhFUkUgRk9SIE5PVy5cbiAgICAvLyBTZWU6IFJGQyA2MzgxIFNlYy4gMy40IChodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjM4MSNzZWN0aW9uLTMuNClcbiAgICB2YXIgcGFyc2VkQ29kZWMgPSBjb2RlY1N0ci5zcGxpdCgnLicpLm1hcChmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eMCsoPyFcXC58JCkvLCAnJyk7XG4gICAgfSk7XG4gICAgdmFyIHByb2Nlc3NlZENvZGVjU3RyID0gcGFyc2VkQ29kZWMuam9pbignLicpO1xuXG4gICAgcmV0dXJuICh0eXBlU3RyICsgJztjb2RlY3M9XCInICsgcHJvY2Vzc2VkQ29kZWNTdHIgKyAnXCInKTtcbn07XG5cbmdldEJhbmR3aWR0aCA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKSk7XG59O1xuXG5nZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICAvLyBUT0RPOiBTdXBwb3J0IHBlcmlvZC1yZWxhdGl2ZSBwcmVzZW50YXRpb24gdGltZVxuICAgIHZhciBtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVwcmVzZW50YXRpb24uZ2V0TXBkKCkuZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbigpLFxuICAgICAgICBwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gTnVtYmVyKHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbihtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKSksXG4gICAgICAgIHByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCgpKTtcbiAgICByZXR1cm4gTnVtYmVyKHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gLSBwcmVzZW50YXRpb25UaW1lT2Zmc2V0KTtcbn07XG5cbmdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIHNlZ21lbnRUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpO1xuICAgIHJldHVybiBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldER1cmF0aW9uKCkpIC8gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXRUaW1lc2NhbGUoKSk7XG59O1xuXG5nZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE1hdGguY2VpbChnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAvIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikpO1xufTtcblxuZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0U3RhcnROdW1iZXIoKSk7XG59O1xuXG5nZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgKyBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLSAxO1xufTtcblxuY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTZWdtZW50RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxTZWdtZW50Q291bnQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRTdGFydE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldEVuZE51bWJlcjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEVuZE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICAvLyBUT0RPOiBFeHRlcm5hbGl6ZVxuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgaW5pdGlhbGl6YXRpb24gPSB7fTtcbiAgICAgICAgICAgIGluaXRpYWxpemF0aW9uLmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgICAgICAgICByZXByZXNlbnRhdGlvbklkID0gcmVwcmVzZW50YXRpb24uZ2V0SWQoKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0SW5pdGlhbGl6YXRpb24oKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uSWQpO1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlVXJsICsgaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXR1cm4gaW5pdGlhbGl6YXRpb247XG4gICAgICAgIH0sXG4gICAgICAgIGdldFNlZ21lbnRCeU51bWJlcjogZnVuY3Rpb24obnVtYmVyKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7IH0sXG4gICAgICAgIGdldFNlZ21lbnRCeVRpbWU6IGZ1bmN0aW9uKHNlY29uZHMpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUocmVwcmVzZW50YXRpb24sIHNlY29uZHMpOyB9XG4gICAgfTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlciA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpIHtcbiAgICB2YXIgc2VnbWVudCA9IHt9O1xuICAgIHNlZ21lbnQuZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBiYXNlVXJsID0gcmVwcmVzZW50YXRpb24uZ2V0QmFzZVVybCgpLFxuICAgICAgICAgICAgc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRNZWRpYSgpLFxuICAgICAgICAgICAgcmVwbGFjZWRJZFVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlSURGb3JUZW1wbGF0ZShzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24uZ2V0SWQoKSksXG4gICAgICAgICAgICAvLyBUT0RPOiBTaW5jZSAkVGltZSQtdGVtcGxhdGVkIHNlZ21lbnQgVVJMcyBzaG91bGQgb25seSBleGlzdCBpbiBjb25qdW5jdGlvbiB3L2EgPFNlZ21lbnRUaW1lbGluZT4sXG4gICAgICAgICAgICAvLyBUT0RPOiBjYW4gY3VycmVudGx5IGFzc3VtZSBhICROdW1iZXIkLWJhc2VkIHRlbXBsYXRlZCB1cmwuXG4gICAgICAgICAgICAvLyBUT0RPOiBFbmZvcmNlIG1pbi9tYXggbnVtYmVyIHJhbmdlIChiYXNlZCBvbiBzZWdtZW50TGlzdCBzdGFydE51bWJlciAmIGVuZE51bWJlcilcbiAgICAgICAgICAgIHJlcGxhY2VkTnVtYmVyVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlKHJlcGxhY2VkSWRVcmwsICdOdW1iZXInLCBudW1iZXIpO1xuICAgICAgICByZXR1cm4gYmFzZVVybCArIHJlcGxhY2VkTnVtYmVyVXJsO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXRTdGFydFRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG51bWJlciAqIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldER1cmF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIFRPRE86IEhhbmRsZSBsYXN0IHNlZ21lbnQgKGxpa2VseSA8IHNlZ21lbnQgZHVyYXRpb24pXG4gICAgICAgIHJldHVybiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXROdW1iZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIG51bWJlcjsgfTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeVRpbWUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgc2Vjb25kcykge1xuICAgIHZhciBzZWdtZW50RHVyYXRpb24gPSBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pLFxuICAgICAgICBudW1iZXIgPSBNYXRoLmZsb29yKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC8gc2VnbWVudER1cmF0aW9uKSxcbiAgICAgICAgc2VnbWVudCA9IGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cbmZ1bmN0aW9uIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICBpZiAoIXJlcHJlc2VudGF0aW9uKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAocmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTsgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNlZ21lbnRUZW1wbGF0ZSxcbiAgICB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTtcblxuemVyb1BhZFRvTGVuZ3RoID0gZnVuY3Rpb24gKG51bVN0ciwgbWluU3RyTGVuZ3RoKSB7XG4gICAgd2hpbGUgKG51bVN0ci5sZW5ndGggPCBtaW5TdHJMZW5ndGgpIHtcbiAgICAgICAgbnVtU3RyID0gJzAnICsgbnVtU3RyO1xuICAgIH1cblxuICAgIHJldHVybiBudW1TdHI7XG59O1xuXG5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdG9rZW4sIHZhbHVlKSB7XG5cbiAgICB2YXIgc3RhcnRQb3MgPSAwLFxuICAgICAgICBlbmRQb3MgPSAwLFxuICAgICAgICB0b2tlbkxlbiA9IHRva2VuLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnID0gJyUwJyxcbiAgICAgICAgZm9ybWF0VGFnTGVuID0gZm9ybWF0VGFnLmxlbmd0aCxcbiAgICAgICAgZm9ybWF0VGFnUG9zLFxuICAgICAgICBzcGVjaWZpZXIsXG4gICAgICAgIHdpZHRoLFxuICAgICAgICBwYWRkZWRWYWx1ZTtcblxuICAgIC8vIGtlZXAgbG9vcGluZyByb3VuZCB1bnRpbCBhbGwgaW5zdGFuY2VzIG9mIDx0b2tlbj4gaGF2ZSBiZWVuXG4gICAgLy8gcmVwbGFjZWQuIG9uY2UgdGhhdCBoYXMgaGFwcGVuZWQsIHN0YXJ0UG9zIGJlbG93IHdpbGwgYmUgLTFcbiAgICAvLyBhbmQgdGhlIGNvbXBsZXRlZCB1cmwgd2lsbCBiZSByZXR1cm5lZC5cbiAgICB3aGlsZSAodHJ1ZSkge1xuXG4gICAgICAgIC8vIGNoZWNrIGlmIHRoZXJlIGlzIGEgdmFsaWQgJDx0b2tlbj4uLi4kIGlkZW50aWZpZXJcbiAgICAgICAgLy8gaWYgbm90LCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgc3RhcnRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJyArIHRva2VuKTtcbiAgICAgICAgaWYgKHN0YXJ0UG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhlIG5leHQgJyQnIG11c3QgYmUgdGhlIGVuZCBvZiB0aGUgaWRlbnRpZmVyXG4gICAgICAgIC8vIGlmIHRoZXJlIGlzbid0IG9uZSwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIGVuZFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGVuZFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG5vdyBzZWUgaWYgdGhlcmUgaXMgYW4gYWRkaXRpb25hbCBmb3JtYXQgdGFnIHN1ZmZpeGVkIHRvXG4gICAgICAgIC8vIHRoZSBpZGVudGlmaWVyIHdpdGhpbiB0aGUgZW5jbG9zaW5nICckJyBjaGFyYWN0ZXJzXG4gICAgICAgIGZvcm1hdFRhZ1BvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoZm9ybWF0VGFnLCBzdGFydFBvcyArIHRva2VuTGVuKTtcbiAgICAgICAgaWYgKGZvcm1hdFRhZ1BvcyA+IHN0YXJ0UG9zICYmIGZvcm1hdFRhZ1BvcyA8IGVuZFBvcykge1xuXG4gICAgICAgICAgICBzcGVjaWZpZXIgPSB0ZW1wbGF0ZVN0ci5jaGFyQXQoZW5kUG9zIC0gMSk7XG4gICAgICAgICAgICB3aWR0aCA9IHBhcnNlSW50KHRlbXBsYXRlU3RyLnN1YnN0cmluZyhmb3JtYXRUYWdQb3MgKyBmb3JtYXRUYWdMZW4sIGVuZFBvcyAtIDEpLCAxMCk7XG5cbiAgICAgICAgICAgIC8vIHN1cHBvcnQgdGhlIG1pbmltdW0gc3BlY2lmaWVycyByZXF1aXJlZCBieSBJRUVFIDEwMDMuMVxuICAgICAgICAgICAgLy8gKGQsIGkgLCBvLCB1LCB4LCBhbmQgWCkgZm9yIGNvbXBsZXRlbmVzc1xuICAgICAgICAgICAgc3dpdGNoIChzcGVjaWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyB0cmVhdCBhbGwgaW50IHR5cGVzIGFzIHVpbnQsXG4gICAgICAgICAgICAgICAgLy8gaGVuY2UgZGVsaWJlcmF0ZSBmYWxsdGhyb3VnaFxuICAgICAgICAgICAgICAgIGNhc2UgJ2QnOlxuICAgICAgICAgICAgICAgIGNhc2UgJ2knOlxuICAgICAgICAgICAgICAgIGNhc2UgJ3UnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnWCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ28nOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZyg4KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnVW5zdXBwb3J0ZWQvaW52YWxpZCBJRUVFIDEwMDMuMSBmb3JtYXQgaWRlbnRpZmllciBzdHJpbmcgaW4gVVJMJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICB0ZW1wbGF0ZVN0ciA9IHRlbXBsYXRlU3RyLnN1YnN0cmluZygwLCBzdGFydFBvcykgKyBwYWRkZWRWYWx1ZSArIHRlbXBsYXRlU3RyLnN1YnN0cmluZyhlbmRQb3MgKyAxKTtcbiAgICB9XG59O1xuXG51bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckJCcpLmpvaW4oJyQnKTtcbn07XG5cbnJlcGxhY2VJREZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckUmVwcmVzZW50YXRpb25JRCQnKSA9PT0gLTEpIHsgcmV0dXJuIHRlbXBsYXRlU3RyOyB9XG4gICAgdmFyIHYgPSB2YWx1ZS50b1N0cmluZygpO1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJFJlcHJlc2VudGF0aW9uSUQkJykuam9pbih2KTtcbn07XG5cbnNlZ21lbnRUZW1wbGF0ZSA9IHtcbiAgICB6ZXJvUGFkVG9MZW5ndGg6IHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZTogcmVwbGFjZVRva2VuRm9yVGVtcGxhdGUsXG4gICAgdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZTogdW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSxcbiAgICByZXBsYWNlSURGb3JUZW1wbGF0ZTogcmVwbGFjZUlERm9yVGVtcGxhdGVcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gc2VnbWVudFRlbXBsYXRlOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV2ZW50TWdyID0gcmVxdWlyZSgnLi9ldmVudE1hbmFnZXIuanMnKSxcbiAgICBldmVudERpc3BhdGNoZXJNaXhpbiA9IHtcbiAgICAgICAgdHJpZ2dlcjogZnVuY3Rpb24oZXZlbnRPYmplY3QpIHsgZXZlbnRNZ3IudHJpZ2dlcih0aGlzLCBldmVudE9iamVjdCk7IH0sXG4gICAgICAgIG9uZTogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbmUodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9uOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvZmY6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub2ZmKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9XG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudERpc3BhdGNoZXJNaXhpbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB2aWRlb2pzID0gcmVxdWlyZSgnLi4vd2luZG93LmpzJykudmlkZW9qcyxcbiAgICBldmVudE1hbmFnZXIgPSB7XG4gICAgICAgIHRyaWdnZXI6IHZpZGVvanMudHJpZ2dlcixcbiAgICAgICAgb25lOiB2aWRlb2pzLm9uZSxcbiAgICAgICAgb246IHZpZGVvanMub24sXG4gICAgICAgIG9mZjogdmlkZW9qcy5vZmZcbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50TWFuYWdlcjsiLCIvKipcbiAqIENyZWF0ZWQgYnkgY3BpbGxzYnVyeSBvbiAxMi8zLzE0LlxuICovXG47KGZ1bmN0aW9uKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciByb290ID0gcmVxdWlyZSgnLi93aW5kb3cnKSxcbiAgICAgICAgdmlkZW9qcyA9IHJvb3QudmlkZW9qcyxcbiAgICAgICAgLy8gTm90ZTogVG8gdXNlIHRoZSBDb21tb25KUyBtb2R1bGUgbG9hZGVyLCBoYXZlIHRvIHBvaW50IHRvIHRoZSBwcmUtYnJvd3NlcmlmaWVkIG1haW4gbGliIGZpbGUuXG4gICAgICAgIG1zZSA9IHJlcXVpcmUoJ21zZS5qcy9zcmMvanMvbXNlLmpzJyksXG4gICAgICAgIFNvdXJjZUhhbmRsZXIgPSByZXF1aXJlKCcuL1NvdXJjZUhhbmRsZXInKTtcblxuICAgIGlmICghdmlkZW9qcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB2aWRlby5qcyBsaWJyYXJ5IG11c3QgYmUgaW5jbHVkZWQgdG8gdXNlIHRoaXMgTVBFRy1EQVNIIHNvdXJjZSBoYW5kbGVyLicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbkhhbmRsZVNvdXJjZShzb3VyY2UpIHtcbiAgICAgICAgLy8gRXh0ZXJuYWxpemUgaWYgdXNlZCBlbHNld2hlcmUuIFBvdGVudGlhbGx5IHVzZSBjb25zdGFudCBmdW5jdGlvbi5cbiAgICAgICAgdmFyIGRvZXNudEhhbmRsZVNvdXJjZSA9ICcnLFxuICAgICAgICAgICAgbWF5YmVIYW5kbGVTb3VyY2UgPSAnbWF5YmUnLFxuICAgICAgICAgICAgZGVmYXVsdEhhbmRsZVNvdXJjZSA9IGRvZXNudEhhbmRsZVNvdXJjZTtcblxuICAgICAgICAvLyBUT0RPOiBVc2Ugc2FmZXIgdmpzIGNoZWNrIChlLmcuIGhhbmRsZXMgSUUgY29uZGl0aW9ucyk/XG4gICAgICAgIC8vIFJlcXVpcmVzIE1lZGlhIFNvdXJjZSBFeHRlbnNpb25zXG4gICAgICAgIGlmICghKHJvb3QuTWVkaWFTb3VyY2UpKSB7XG4gICAgICAgICAgICByZXR1cm4gZG9lc250SGFuZGxlU291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHR5cGUgaXMgc3VwcG9ydGVkXG4gICAgICAgIGlmICgvYXBwbGljYXRpb25cXC9kYXNoXFwreG1sLy50ZXN0KHNvdXJjZS50eXBlKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ21hdGNoZWQgdHlwZScpO1xuICAgICAgICAgICAgcmV0dXJuIG1heWJlSGFuZGxlU291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGZpbGUgZXh0ZW5zaW9uIG1hdGNoZXNcbiAgICAgICAgaWYgKC9cXC5tcGQkL2kudGVzdChzb3VyY2Uuc3JjKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ21hdGNoZWQgZXh0ZW5zaW9uJyk7XG4gICAgICAgICAgICByZXR1cm4gbWF5YmVIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZGVmYXVsdEhhbmRsZVNvdXJjZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoYW5kbGVTb3VyY2Uoc291cmNlLCB0ZWNoKSB7XG4gICAgICAgIHJldHVybiBuZXcgU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpO1xuICAgIH1cblxuICAgIC8vIFJlZ2lzdGVyIHRoZSBzb3VyY2UgaGFuZGxlclxuICAgIHZpZGVvanMuSHRtbDUucmVnaXN0ZXJTb3VyY2VIYW5kbGVyKHtcbiAgICAgICAgY2FuSGFuZGxlU291cmNlOiBjYW5IYW5kbGVTb3VyY2UsXG4gICAgICAgIGhhbmRsZVNvdXJjZTogaGFuZGxlU291cmNlXG4gICAgfSwgMCk7XG5cbn0uY2FsbCh0aGlzKSk7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsID0gcmVxdWlyZSgnLi4vZGFzaC9tcGQvdXRpbC5qcycpLnBhcnNlUm9vdFVybDtcblxuZnVuY3Rpb24gbG9hZE1hbmlmZXN0KHVybCwgY2FsbGJhY2spIHtcbiAgICB2YXIgYWN0dWFsVXJsID0gcGFyc2VSb290VXJsKHVybCksXG4gICAgICAgIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKSxcbiAgICAgICAgb25sb2FkO1xuXG4gICAgb25sb2FkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAocmVxdWVzdC5zdGF0dXMgPCAyMDAgfHwgcmVxdWVzdC5zdGF0dXMgPiAyOTkpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFjayh7bWFuaWZlc3RYbWw6IHJlcXVlc3QucmVzcG9uc2VYTUwgfSk7IH1cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy90aGlzLmRlYnVnLmxvZygnU3RhcnQgbG9hZGluZyBtYW5pZmVzdDogJyArIHVybCk7XG4gICAgICAgIHJlcXVlc3Qub25sb2FkID0gb25sb2FkO1xuICAgICAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG4gICAgICAgIHJlcXVlc3Quc2VuZCgpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgICByZXF1ZXN0Lm9uZXJyb3IoKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gbG9hZE1hbmlmZXN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBpc0FycmF5ID0gcmVxdWlyZSgnLi4vdXRpbC9pc0FycmF5LmpzJyksXG4gICAgZG93bmxvYWRSYXRlcyA9IHJlcXVpcmUoJy4vZG93bmxvYWRSYXRlL0Rvd25sb2FkUmF0ZXMuanMnKSxcbiAgICBldmVudExpc3QgPSByZXF1aXJlKCcuL2Rvd25sb2FkUmF0ZS9Eb3dubG9hZFJhdGVFdmVudFR5cGVzLmpzJyk7XG5cbmZ1bmN0aW9uIGFkZEV2ZW50SGFuZGxlclRvUnVsZShzZWxmLCBydWxlKSB7XG4gICAgcnVsZS5vbihzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9SQVRFX0NIQU5HRUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHNlbGYuZGV0ZXJtaW5lRG93bmxvYWRSYXRlKCk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIERvd25sb2FkUmF0ZU1hbmFnZXIoZG93bmxvYWRSYXRlUnVsZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKGlzQXJyYXkoZG93bmxvYWRSYXRlUnVsZXMpKSB7IHRoaXMuX19kb3dubG9hZFJhdGVSdWxlcyA9IGRvd25sb2FkUmF0ZVJ1bGVzOyB9XG4gICAgZWxzZSBpZiAoISFkb3dubG9hZFJhdGVSdWxlcykgeyB0aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMgPSBbZG93bmxvYWRSYXRlUnVsZXNdOyB9XG4gICAgZWxzZSB7IHRoaXMuX19kb3dubG9hZFJhdGVSdWxlcyA9IFtdOyB9XG4gICAgLy90aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMgPSBpc0FycmF5KGRvd25sb2FkUmF0ZVJ1bGVzKSB8fCBbXTtcbiAgICB0aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMuZm9yRWFjaChmdW5jdGlvbihydWxlKSB7XG4gICAgICAgIGFkZEV2ZW50SGFuZGxlclRvUnVsZShzZWxmLCBydWxlKTtcbiAgICB9KTtcbiAgICB0aGlzLl9fbGFzdERvd25sb2FkUmF0ZSA9IHRoaXMuZG93bmxvYWRSYXRlcy5ET05UX0RPV05MT0FEO1xuICAgIHRoaXMuZGV0ZXJtaW5lRG93bmxvYWRSYXRlKCk7XG59XG5cbkRvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLmV2ZW50TGlzdCA9IGV2ZW50TGlzdDtcblxuRG93bmxvYWRSYXRlTWFuYWdlci5wcm90b3R5cGUuZG93bmxvYWRSYXRlcyA9IGRvd25sb2FkUmF0ZXM7XG5cbkRvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLmRldGVybWluZURvd25sb2FkUmF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgY3VycmVudERvd25sb2FkUmF0ZSxcbiAgICAgICAgZmluYWxEb3dubG9hZFJhdGUgPSBkb3dubG9hZFJhdGVzLkRPTlRfRE9XTkxPQUQ7XG5cbiAgICAvLyBUT0RPOiBNYWtlIHJlbGF0aW9uc2hpcCBiZXR3ZWVuIHJ1bGVzIHNtYXJ0ZXIgb25jZSB3ZSBpbXBsZW1lbnQgbXVsdGlwbGUgcnVsZXMuXG4gICAgc2VsZi5fX2Rvd25sb2FkUmF0ZVJ1bGVzLmZvckVhY2goZnVuY3Rpb24oZG93bmxvYWRSYXRlUnVsZSkge1xuICAgICAgICBjdXJyZW50RG93bmxvYWRSYXRlID0gZG93bmxvYWRSYXRlUnVsZS5nZXREb3dubG9hZFJhdGUoKTtcbiAgICAgICAgaWYgKGN1cnJlbnREb3dubG9hZFJhdGUgPiBmaW5hbERvd25sb2FkUmF0ZSkgeyBmaW5hbERvd25sb2FkUmF0ZSA9IGN1cnJlbnREb3dubG9hZFJhdGU7IH1cbiAgICB9KTtcblxuICAgIGlmIChmaW5hbERvd25sb2FkUmF0ZSAhPT0gc2VsZi5fX2xhc3REb3dubG9hZFJhdGUpIHtcbiAgICAgICAgc2VsZi5fX2xhc3REb3dubG9hZFJhdGUgPSBmaW5hbERvd25sb2FkUmF0ZTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHtcbiAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfUkFURV9DSEFOR0VELFxuICAgICAgICAgICAgdGFyZ2V0OnNlbGYsXG4gICAgICAgICAgICBkb3dubG9hZFJhdGU6c2VsZi5fX2xhc3REb3dubG9hZFJhdGVcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbmFsRG93bmxvYWRSYXRlO1xufTtcblxuRG93bmxvYWRSYXRlTWFuYWdlci5wcm90b3R5cGUuYWRkRG93bmxvYWRSYXRlUnVsZSA9IGZ1bmN0aW9uKGRvd25sb2FkUmF0ZVJ1bGUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fX2Rvd25sb2FkUmF0ZVJ1bGVzLnB1c2goZG93bmxvYWRSYXRlUnVsZSk7XG4gICAgYWRkRXZlbnRIYW5kbGVyVG9SdWxlKHNlbGYsIGRvd25sb2FkUmF0ZVJ1bGUpO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoRG93bmxvYWRSYXRlTWFuYWdlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBEb3dubG9hZFJhdGVNYW5hZ2VyOyIsInZhciBldmVudExpc3QgPSB7XG4gICAgRE9XTkxPQURfUkFURV9DSEFOR0VEOiAnZG93bmxvYWRSYXRlQ2hhbmdlZCdcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnRMaXN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGRvd25sb2FkUmF0ZXMgPSB7XG4gICAgRE9OVF9ET1dOTE9BRDogMCxcbiAgICBQTEFZQkFDS19SQVRFOiAxMDAwLFxuICAgIERPV05MT0FEX1JBVEU6IDEwMDAwXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRvd25sb2FkUmF0ZXM7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uLy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGRvd25sb2FkUmF0ZXMgPSByZXF1aXJlKCcuL0Rvd25sb2FkUmF0ZXMuanMnKSxcbiAgICBldmVudExpc3QgPSByZXF1aXJlKCcuL0Rvd25sb2FkUmF0ZUV2ZW50VHlwZXMuanMnKSxcbiAgICBkb3dubG9hZEFuZFBsYXliYWNrRXZlbnRzID0gW1xuICAgICAgICAnbG9hZHN0YXJ0JyxcbiAgICAgICAgJ2R1cmF0aW9uY2hhbmdlJyxcbiAgICAgICAgJ2xvYWRlZG1ldGFkYXRhJyxcbiAgICAgICAgJ2xvYWRlZGRhdGEnLFxuICAgICAgICAncHJvZ3Jlc3MnLFxuICAgICAgICAnY2FucGxheScsXG4gICAgICAgICdjYW5wbGF5dGhyb3VnaCdcbiAgICBdLFxuICAgIHJlYWR5U3RhdGVzID0ge1xuICAgICAgICBIQVZFX05PVEhJTkc6IDAsXG4gICAgICAgIEhBVkVfTUVUQURBVEE6IDEsXG4gICAgICAgIEhBVkVfQ1VSUkVOVF9EQVRBOiAyLFxuICAgICAgICBIQVZFX0ZVVFVSRV9EQVRBOiAzLFxuICAgICAgICBIQVZFX0VOT1VHSF9EQVRBOiA0XG4gICAgfTtcblxuZnVuY3Rpb24gZ2V0UmVhZHlTdGF0ZSh0ZWNoKSB7XG4gICAgcmV0dXJuIHRlY2guZWwoKS5yZWFkeVN0YXRlO1xufVxuXG5mdW5jdGlvbiBWaWRlb1JlYWR5U3RhdGVSdWxlKHRlY2gpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gVE9ETzogTnVsbC90eXBlIGNoZWNrXG4gICAgdGhpcy5fX3RlY2ggPSB0ZWNoO1xuICAgIHRoaXMuX19kb3dubG9hZFJhdGUgPSB0aGlzLmRvd25sb2FkUmF0ZXMuRE9OVF9ET1dOTE9BRDtcblxuICAgIGZ1bmN0aW9uIGRldGVybWluZURvd25sb2FkUmF0ZSgpIHtcbiAgICAgICAgdmFyIGRvd25sb2FkUmF0ZSA9IChnZXRSZWFkeVN0YXRlKHNlbGYuX190ZWNoKSA9PT0gcmVhZHlTdGF0ZXMuSEFWRV9FTk9VR0hfREFUQSkgP1xuICAgICAgICAgICAgc2VsZi5kb3dubG9hZFJhdGVzLlBMQVlCQUNLX1JBVEUgOlxuICAgICAgICAgICAgc2VsZi5kb3dubG9hZFJhdGVzLkRPV05MT0FEX1JBVEU7XG4gICAgICAgIHJldHVybiBkb3dubG9hZFJhdGU7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlRG93bmxvYWRSYXRlKCkge1xuICAgICAgICB2YXIgbmV3RG93bmxvYWRSYXRlID0gZGV0ZXJtaW5lRG93bmxvYWRSYXRlKCk7XG4gICAgICAgIGlmIChzZWxmLl9fZG93bmxvYWRSYXRlICE9PSBuZXdEb3dubG9hZFJhdGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdET1dOTE9BRCBSQVRFIENIQU5HRUQgVE86ICcgKyBuZXdEb3dubG9hZFJhdGUpO1xuICAgICAgICAgICAgc2VsZi5fX2Rvd25sb2FkUmF0ZSA9IG5ld0Rvd25sb2FkUmF0ZTtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7XG4gICAgICAgICAgICAgICAgdHlwZTpzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9SQVRFX0NIQU5HRUQsXG4gICAgICAgICAgICAgICAgdGFyZ2V0OnNlbGYsXG4gICAgICAgICAgICAgICAgZG93bmxvYWRSYXRlOnNlbGYuX19kb3dubG9hZFJhdGVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZG93bmxvYWRBbmRQbGF5YmFja0V2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50TmFtZSkge1xuICAgICAgICB0ZWNoLm9uKGV2ZW50TmFtZSwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB1cGRhdGVEb3dubG9hZFJhdGUoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICB1cGRhdGVEb3dubG9hZFJhdGUoKTtcbn1cblxuVmlkZW9SZWFkeVN0YXRlUnVsZS5wcm90b3R5cGUuZXZlbnRMaXN0ID0gZXZlbnRMaXN0O1xuXG4vLyBWYWx1ZSBNZWFuaW5nczpcbi8vXG4vLyBET05UX0RPV05MT0FEIC0gIFNob3VsZCBub3QgZG93bmxvYWQgc2VnbWVudHMuXG4vLyBQTEFZQkFDS19SQVRFIC0gIERvd25sb2FkIHRoZSBuZXh0IHNlZ21lbnQgYXQgdGhlIHJhdGUgaXQgdGFrZXMgdG8gY29tcGxldGUgcGxheWJhY2sgb2YgdGhlIHByZXZpb3VzIHNlZ21lbnQuXG4vLyAgICAgICAgICAgICAgICAgIEluIG90aGVyIHdvcmRzLCBvbmNlIHRoZSBkYXRhIGZvciB0aGUgY3VycmVudCBzZWdtZW50IGhhcyBiZWVuIGRvd25sb2FkZWQsXG4vLyAgICAgICAgICAgICAgICAgIHdhaXQgdW50aWwgc2VnbWVudC5nZXREdXJhdGlvbigpIHNlY29uZHMgb2Ygc3RyZWFtIHBsYXliYWNrIGhhdmUgZWxhcHNlZCBiZWZvcmUgc3RhcnRpbmcgdGhlXG4vLyAgICAgICAgICAgICAgICAgIGRvd25sb2FkIG9mIHRoZSBuZXh0IHNlZ21lbnQuXG4vLyBET1dOTE9BRF9SQVRFIC0gIERvd25sb2FkIHRoZSBuZXh0IHNlZ21lbnQgb25jZSB0aGUgcHJldmlvdXMgc2VnbWVudCBoYXMgZmluaXNoZWQgZG93bmxvYWRpbmcuXG5WaWRlb1JlYWR5U3RhdGVSdWxlLnByb3RvdHlwZS5kb3dubG9hZFJhdGVzID0gZG93bmxvYWRSYXRlcztcblxuVmlkZW9SZWFkeVN0YXRlUnVsZS5wcm90b3R5cGUuZ2V0RG93bmxvYWRSYXRlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX19kb3dubG9hZFJhdGU7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChWaWRlb1JlYWR5U3RhdGVSdWxlLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZGVvUmVhZHlTdGF0ZVJ1bGU7IiwiXG52YXIgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24gPSByZXF1aXJlKCcuLi9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMnKSxcbiAgICBsb2FkU2VnbWVudCxcbiAgICBERUZBVUxUX1JFVFJZX0NPVU5UID0gMyxcbiAgICBERUZBVUxUX1JFVFJZX0lOVEVSVkFMID0gMjUwO1xuXG5sb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQsIHJldHJ5SW50ZXJ2YWwpIHtcbiAgICB2YXIgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgIHJlcXVlc3Qub3BlbignR0VUJywgc2VnbWVudC5nZXRVcmwoKSwgdHJ1ZSk7XG4gICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuXG4gICAgcmVxdWVzdC5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgLy9jb25zb2xlLmxvZygnTG9hZGVkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQoc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2tGbiA9PT0gJ2Z1bmN0aW9uJykgeyBjYWxsYmFja0ZuKHJlcXVlc3QucmVzcG9uc2UpOyB9XG4gICAgfTtcbiAgICAvL3JlcXVlc3Qub25lcnJvciA9IHJlcXVlc3Qub25sb2FkZW5kID0gZnVuY3Rpb24oKSB7XG4gICAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBsb2FkU2VnbWVudChzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9LCByZXRyeUludGVydmFsKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9O1xuXG4gICAgcmVxdWVzdC5zZW5kKCk7XG59O1xuXG5mdW5jdGlvbiBTZWdtZW50TG9hZGVyKGFkYXB0YXRpb25TZXQsIC8qIG9wdGlvbmFsICovIGN1cnJlbnRTZWdtZW50TnVtYmVyKSB7XG4gICAgLy90aGlzLl9fZXZlbnREaXNwYXRjaGVyRGVsZWdhdGUgPSBuZXcgRXZlbnREaXNwYXRjaGVyRGVsZWdhdGUodGhpcyk7XG4gICAgdGhpcy5fX2FkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0O1xuICAgIC8vIEluaXRpYWxpemUgdG8gMHRoIHJlcHJlc2VudGF0aW9uLlxuICAgIHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24gPSBhZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdO1xuICAgIHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciA9IGN1cnJlbnRTZWdtZW50TnVtYmVyO1xufVxuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgSU5JVElBTElaQVRJT05fTE9BREVEOiAnaW5pdGlhbGl6YXRpb25Mb2FkZWQnLFxuICAgIFNFR01FTlRfTE9BREVEOiAnc2VnbWVudExvYWRlZCdcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRSZXByZXNlbnRhdGlvbiA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRSZXByZXNlbnRhdGlvbjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuc2V0Q3VycmVudFJlcHJlc2VudGF0aW9uID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHsgdGhpcy5fX2N1cnJlbnRSZXByZXNlbnRhdGlvbiA9IHJlcHJlc2VudGF0aW9uOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24odGhpcy5fX2N1cnJlbnRSZXByZXNlbnRhdGlvbik7XG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlOdW1iZXIodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyKTtcbiAgICByZXR1cm4gc2VnbWVudDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLnNldEN1cnJlbnRSZXByZXNlbnRhdGlvbkJ5SW5kZXggPSBmdW5jdGlvbihpbmRleCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKTtcbiAgICBpZiAoaW5kZXggPCAwIHx8IGluZGV4ID49IHJlcHJlc2VudGF0aW9ucy5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdpbmRleCBvdXQgb2YgYm91bmRzJyk7XG4gICAgfVxuICAgIHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24gPSByZXByZXNlbnRhdGlvbnNbaW5kZXhdO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0U3RhcnRTZWdtZW50TnVtYmVyID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24odGhpcy5fX2N1cnJlbnRSZXByZXNlbnRhdGlvbikuZ2V0U3RhcnROdW1iZXIoKTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEVuZFNlZ21lbnROdW1iZXIgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbih0aGlzLl9fY3VycmVudFJlcHJlc2VudGF0aW9uKS5nZXRFbmROdW1iZXIoKTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRJbml0aWFsaXphdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24pLFxuICAgICAgICBpbml0aWFsaXphdGlvbiA9IHNlZ21lbnRMaXN0LmdldEluaXRpYWxpemF0aW9uKCk7XG5cbiAgICBpZiAoIWluaXRpYWxpemF0aW9uKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBpbml0aWFsaXphdGlvbiwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6aW5pdFNlZ21lbnR9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLy8gVE9ETzogRGV0ZXJtaW5lIGhvdyB0byBwYXJhbWV0ZXJpemUgYnkgcmVwcmVzZW50YXRpb24gdmFyaWFudHMgKGJhbmR3aWR0aC9iaXRyYXRlPyByZXByZXNlbnRhdGlvbiBvYmplY3Q/IGluZGV4PylcblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWROZXh0U2VnbWVudCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub0N1cnJlbnRTZWdtZW50TnVtYmVyID0gKCh0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPT09IG51bGwpIHx8ICh0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPT09IHVuZGVmaW5lZCkpLFxuICAgICAgICBudW1iZXIgPSBub0N1cnJlbnRTZWdtZW50TnVtYmVyID8gMCA6IHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciArIDE7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNlZ21lbnRBdE51bWJlcihudW1iZXIpO1xufTtcblxuLy8gVE9ETzogRHVwbGljYXRlIGNvZGUgYmVsb3cuIEFic3RyYWN0IGF3YXkuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0TnVtYmVyID0gZnVuY3Rpb24obnVtYmVyKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24odGhpcy5fX2N1cnJlbnRSZXByZXNlbnRhdGlvbik7XG5cbiAgICBpZiAobnVtYmVyID4gc2VnbWVudExpc3QuZ2V0RW5kTnVtYmVyKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeU51bWJlcihudW1iZXIpO1xuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRTZWdtZW50QXRUaW1lID0gZnVuY3Rpb24ocHJlc2VudGF0aW9uVGltZSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24pO1xuXG4gICAgaWYgKHByZXNlbnRhdGlvblRpbWUgPiBzZWdtZW50TGlzdC5nZXRUb3RhbER1cmF0aW9uKCkpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICB2YXIgc2VnbWVudCA9IHNlZ21lbnRMaXN0LmdldFNlZ21lbnRCeVRpbWUocHJlc2VudGF0aW9uVGltZSk7XG5cbiAgICBsb2FkU2VnbWVudC5jYWxsKHRoaXMsIHNlZ21lbnQsIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHNlbGYuX19jdXJyZW50U2VnbWVudE51bWJlciA9IHNlZ21lbnQuZ2V0TnVtYmVyKCk7XG4gICAgICAgIHZhciBpbml0U2VnbWVudCA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6aW5pdFNlZ21lbnR9KTtcbiAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU2VnbWVudExvYWRlci5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50TG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKTtcblxuLy8gVE9ETzogVGhpcyBsb2dpYyBzaG91bGQgYmUgaW4gbXNlLmpzXG5mdW5jdGlvbiBhcHBlbmRCeXRlcyhidWZmZXIsIGJ5dGVzKSB7XG4gICAgaWYgKCdhcHBlbmQnIGluIGJ1ZmZlcikge1xuICAgICAgICBidWZmZXIuYXBwZW5kKGJ5dGVzKTtcbiAgICB9IGVsc2UgaWYgKCdhcHBlbmRCdWZmZXInIGluIGJ1ZmZlcikge1xuICAgICAgICBidWZmZXIuYXBwZW5kQnVmZmVyKGJ5dGVzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZShzb3VyY2VCdWZmZXIpIHtcbiAgICAvLyBUT0RPOiBDaGVjayB0eXBlP1xuICAgIGlmICghc291cmNlQnVmZmVyKSB7IHRocm93IG5ldyBFcnJvciggJ1RoZSBzb3VyY2VCdWZmZXIgY29uc3RydWN0b3IgYXJndW1lbnQgY2Fubm90IGJlIG51bGwuJyApOyB9XG5cbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGRhdGFRdWV1ZSA9IFtdO1xuICAgIC8vIFRPRE86IGZpZ3VyZSBvdXQgaG93IHdlIHdhbnQgdG8gcmVzcG9uZCB0byBvdGhlciBldmVudCBzdGF0ZXMgKHVwZGF0ZWVuZD8gZXJyb3I/IGFib3J0PykgKHJldHJ5PyByZW1vdmU/KVxuICAgIHNvdXJjZUJ1ZmZlci5hZGRFdmVudExpc3RlbmVyKCd1cGRhdGVlbmQnLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIC8vIFRoZSBTb3VyY2VCdWZmZXIgaW5zdGFuY2UncyB1cGRhdGluZyBwcm9wZXJ0eSBzaG91bGQgYWx3YXlzIGJlIGZhbHNlIGlmIHRoaXMgZXZlbnQgd2FzIGRpc3BhdGNoZWQsXG4gICAgICAgIC8vIGJ1dCBqdXN0IGluIGNhc2UuLi5cbiAgICAgICAgaWYgKGUudGFyZ2V0LnVwZGF0aW5nKSB7IHJldHVybjsgfVxuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9BRERFRF9UT19CVUZGRVIsIHRhcmdldDpzZWxmIH0pO1xuXG4gICAgICAgIGlmIChkYXRhUXVldWUubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUVVFVUVfRU1QVFksIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXBwZW5kQnl0ZXMoZS50YXJnZXQsIGRhdGFRdWV1ZS5zaGlmdCgpKTtcbiAgICB9KTtcblxuICAgIHRoaXMuX19kYXRhUXVldWUgPSBkYXRhUXVldWU7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlciA9IHNvdXJjZUJ1ZmZlcjtcbn1cblxuLy8gVE9ETzogQWRkIGFzIFwiY2xhc3NcIiBwcm9wZXJ0aWVzP1xuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgUVVFVUVfRU1QVFk6ICdxdWV1ZUVtcHR5JyxcbiAgICBTRUdNRU5UX0FEREVEX1RPX0JVRkZFUjogJ3NlZ21lbnRBZGRlZFRvQnVmZmVyJ1xufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5hZGRUb1F1ZXVlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIC8vIFRPRE86IENoZWNrIGZvciBleGlzdGVuY2UvdHlwZT8gQ29udmVydCB0byBVaW50OEFycmF5IGV4dGVybmFsbHkgb3IgaW50ZXJuYWxseT8gKEN1cnJlbnRseSBhc3N1bWluZyBleHRlcm5hbClcbiAgICAvLyBJZiBub3RoaW5nIGlzIGluIHRoZSBxdWV1ZSwgZ28gYWhlYWQgYW5kIGltbWVkaWF0ZWx5IGFwcGVuZCB0aGUgc2VnbWVudCBkYXRhIHRvIHRoZSBzb3VyY2UgYnVmZmVyLlxuICAgIGlmICgodGhpcy5fX2RhdGFRdWV1ZS5sZW5ndGggPT09IDApICYmICghdGhpcy5fX3NvdXJjZUJ1ZmZlci51cGRhdGluZykpIHsgYXBwZW5kQnl0ZXModGhpcy5fX3NvdXJjZUJ1ZmZlciwgZGF0YSk7IH1cbiAgICAvLyBPdGhlcndpc2UsIHB1c2ggb250byBxdWV1ZSBhbmQgd2FpdCBmb3IgdGhlIG5leHQgdXBkYXRlIGV2ZW50IGJlZm9yZSBhcHBlbmRpbmcgc2VnbWVudCBkYXRhIHRvIHNvdXJjZSBidWZmZXIuXG4gICAgZWxzZSB7IHRoaXMuX19kYXRhUXVldWUucHVzaChkYXRhKTsgfVxufTtcblxuU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZS5jbGVhclF1ZXVlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IFtdO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoU291cmNlQnVmZmVyRGF0YVF1ZXVlLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIEV4dGVuZCBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgcHJvcGVydGllcyBpbiBwYXNzZWQtaW4gb2JqZWN0KHMpLlxudmFyIGV4dGVuZE9iamVjdCA9IGZ1bmN0aW9uKG9iaiAvKiwgZXh0ZW5kT2JqZWN0MSwgZXh0ZW5kT2JqZWN0MiwgLi4uLCBleHRlbmRPYmplY3ROICovKSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKS5mb3JFYWNoKGZ1bmN0aW9uKGV4dGVuZE9iamVjdCkge1xuICAgICAgICBpZiAoZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgICAgIG9ialtwcm9wXSA9IGV4dGVuZE9iamVjdFtwcm9wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBvYmo7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZE9iamVjdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNBcnJheShvYmopIHtcbiAgICByZXR1cm4gb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gTk9URTogVEFLRU4gRlJPTSBMT0RBU0ggVE8gUkVNT1ZFIERFUEVOREVOQ1lcbi8qKiBgT2JqZWN0I3RvU3RyaW5nYCByZXN1bHQgc2hvcnRjdXRzICovXG52YXIgZnVuY0NsYXNzID0gJ1tvYmplY3QgRnVuY3Rpb25dJyxcbiAgICBzdHJpbmdDbGFzcyA9ICdbb2JqZWN0IFN0cmluZ10nO1xuXG4vKiogVXNlZCB0byByZXNvbHZlIHRoZSBpbnRlcm5hbCBbW0NsYXNzXV0gb2YgdmFsdWVzICovXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIHRvU3RyaW5nLmNhbGwodmFsdWUpID09PSBmdW5jQ2xhc3M7XG4gICAgfTtcbn1cblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHRvU3RyaW5nLmNhbGwodmFsdWUpID09PSBzdHJpbmdDbGFzcyB8fCBmYWxzZTtcbn07XG5cbi8vIE5PVEU6IEVORCBPRiBMT0RBU0gtQkFTRUQgQ09ERVxuXG4vLyBHZW5lcmFsIFV0aWxpdHkgRnVuY3Rpb25zXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4geCAhPT0gbnVsbDsgfVxuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxuZnVuY3Rpb24gcHJlQXBwbHlBcmdzRm4oZnVuIC8qLCBhcmdzICovKSB7XG4gICAgdmFyIHByZUFwcGxpZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAvLyBOT1RFOiB0aGUgKnRoaXMqIHJlZmVyZW5jZSB3aWxsIHJlZmVyIHRvIHRoZSBjbG9zdXJlJ3MgY29udGV4dCB1bmxlc3NcbiAgICAvLyB0aGUgcmV0dXJuZWQgZnVuY3Rpb24gaXMgaXRzZWxmIGNhbGxlZCB2aWEgLmNhbGwoKSBvciAuYXBwbHkoKS4gSWYgeW91XG4gICAgLy8gKm5lZWQqIHRvIHJlZmVyIHRvIGluc3RhbmNlLWxldmVsIHByb3BlcnRpZXMsIGRvIHNvbWV0aGluZyBsaWtlIHRoZSBmb2xsb3dpbmc6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IGZ1bmN0aW9uKGFyZ0MpIHsgcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKS5jYWxsKHRoaXMpOyB9O1xuICAgIC8vXG4gICAgLy8gT3RoZXJ3aXNlLCB5b3Ugc2hvdWxkIGJlIGFibGUgdG8ganVzdCBjYWxsOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pO1xuICAgIC8vXG4gICAgLy8gV2hlcmUgcG9zc2libGUsIGZ1bmN0aW9ucyBhbmQgbWV0aG9kcyBzaG91bGQgbm90IGJlIHJlYWNoaW5nIG91dCB0byBnbG9iYWwgc2NvcGUgYW55d2F5LCBzby4uLlxuICAgIHJldHVybiBmdW5jdGlvbigpIHsgcmV0dXJuIGZ1bi5hcHBseSh0aGlzLCBwcmVBcHBsaWVkQXJncyk7IH07XG59XG5cbi8vIEhpZ2hlci1vcmRlciBYTUwgZnVuY3Rpb25zXG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50c1xudmFyIGdldEFuY2VzdG9ycyA9IGZ1bmN0aW9uKGVsZW0sIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgKGZ1bmN0aW9uIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSwgYW5jZXN0b3JzKSkgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKGV4aXN0eShlbGVtKSAmJiBleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkge1xuICAgICAgICAgICAgYW5jZXN0b3JzLnB1c2goZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgICAgIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfSkoZWxlbSk7XG4gICAgcmV0dXJuIGFuY2VzdG9ycztcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXROb2RlTGlzdEJ5TmFtZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oeG1sT2JqKSB7XG4gICAgICAgIHJldHVybiB4bWxPYmouZ2V0RWxlbWVudHNCeVRhZ05hbWUobmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBoYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lLCB2YWx1ZSkge1xuICAgIGlmICgodHlwZW9mIGF0dHJOYW1lICE9PSAnc3RyaW5nJykgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgaWYgKCFleGlzdHkodmFsdWUpKSB7IHJldHVybiBlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgcmV0dXJuIChlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSkgPT09IHZhbHVlKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEF0dHJGbiA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhdHRyTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbi8vIFRPRE86IEFkZCBzaG91bGRTdG9wUHJlZCAoc2hvdWxkIGZ1bmN0aW9uIHNpbWlsYXJseSB0byBzaG91bGRTdG9wUHJlZCBpbiBnZXRJbmhlcml0YWJsZUVsZW1lbnQsIGJlbG93KVxudmFyIGdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhhdHRyTmFtZSkpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKSkgeyByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50czsgUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEluaGVyaXRhYmxlRWxlbWVudCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHJldHVybiBmdW5jdGlvbiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBtYXRjaGluZ0VsZW1MaXN0ID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSk7XG4gICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtTGlzdCkgJiYgbWF0Y2hpbmdFbGVtTGlzdC5sZW5ndGggPiAwKSB7IHJldHVybiBtYXRjaGluZ0VsZW1MaXN0WzBdOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUT0RPOiBJbXBsZW1lbnQgbWUgZm9yIEJhc2VVUkwgb3IgdXNlIGV4aXN0aW5nIGZuIChTZWU6IG1wZC5qcyBidWlsZEJhc2VVcmwoKSlcbi8qdmFyIGJ1aWxkSGllcmFyY2hpY2FsbHlTdHJ1Y3R1cmVkVmFsdWUgPSBmdW5jdGlvbih2YWx1ZUZuLCBidWlsZEZuLCBzdG9wUHJlZCkge1xuXG59OyovXG5cbi8vIFB1Ymxpc2ggRXh0ZXJuYWwgQVBJOlxudmFyIHhtbGZ1biA9IHt9O1xueG1sZnVuLmV4aXN0eSA9IGV4aXN0eTtcbnhtbGZ1bi50cnV0aHkgPSB0cnV0aHk7XG5cbnhtbGZ1bi5nZXROb2RlTGlzdEJ5TmFtZSA9IGdldE5vZGVMaXN0QnlOYW1lO1xueG1sZnVuLmhhc01hdGNoaW5nQXR0cmlidXRlID0gaGFzTWF0Y2hpbmdBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUgPSBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRBbmNlc3RvcnMgPSBnZXRBbmNlc3RvcnM7XG54bWxmdW4uZ2V0QXR0ckZuID0gZ2V0QXR0ckZuO1xueG1sZnVuLnByZUFwcGx5QXJnc0ZuID0gcHJlQXBwbHlBcmdzRm47XG54bWxmdW4uZ2V0SW5oZXJpdGFibGVFbGVtZW50ID0gZ2V0SW5oZXJpdGFibGVFbGVtZW50O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHhtbGZ1bjsiXX0=
