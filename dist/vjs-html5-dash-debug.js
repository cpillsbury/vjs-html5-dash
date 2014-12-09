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

function load(manifestXml, tech) {
    console.log('START');

    var mediaSource = new MediaSource(),
        openListener = function(event) {
            mediaSource.removeEventListener('sourceopen', openListener, false);
            var playlistLoader = new PlaylistLoader(manifestXml, mediaSource, tech);
        };

    mediaSource.addEventListener('sourceopen', openListener, false);

    // TODO: Handle close.
    //mediaSource.addEventListener('webkitsourceclose', closed, false);
    //mediaSource.addEventListener('sourceclose', closed, false);

    tech.setSrc(URL.createObjectURL(mediaSource));
}

function SourceHandler(source, tech) {
    loadManifest(source.src, function(data) {
        load(data.manifestXml, tech);
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
    return function() { return fun.apply(null, preAppliedArgs); };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvbXNlLmpzL3NyYy9qcy9NZWRpYVNvdXJjZS5qcyIsIm5vZGVfbW9kdWxlcy9tc2UuanMvc3JjL2pzL21zZS5qcyIsIm5vZGVfbW9kdWxlcy9tc2UuanMvc3JjL2pzL3dpbmRvdy5qcyIsInNyYy9qcy9QbGF5bGlzdExvYWRlci5qcyIsInNyYy9qcy9Tb3VyY2VIYW5kbGVyLmpzIiwic3JjL2pzL1N0cmVhbUxvYWRlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvcnVsZXMvRG93bmxvYWRSYXRlTWFuYWdlci5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlRXZlbnRUeXBlcy5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlcy5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvVmlkZW9SZWFkeVN0YXRlUnVsZS5qcyIsInNyYy9qcy9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzIiwic3JjL2pzL3NvdXJjZUJ1ZmZlci9Tb3VyY2VCdWZmZXJEYXRhUXVldWUuanMiLCJzcmMvanMvdXRpbC9leHRlbmRPYmplY3QuanMiLCJzcmMvanMvdXRpbC9pc0FycmF5LmpzIiwic3JjL2pzL3htbGZ1bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XG5cbnZhciByb290ID0gcmVxdWlyZSgnLi93aW5kb3cuanMnKSxcblxuICAgIG1lZGlhU291cmNlQ2xhc3NOYW1lID0gJ01lZGlhU291cmNlJyxcbiAgICB3ZWJLaXRNZWRpYVNvdXJjZUNsYXNzTmFtZSA9ICdXZWJLaXRNZWRpYVNvdXJjZScsXG4gICAgbWVkaWFTb3VyY2VFdmVudHMgPSBbJ3NvdXJjZW9wZW4nLCAnc291cmNlY2xvc2UnLCAnc291cmNlZW5kZWQnXSxcbiAgICAvLyBUT0RPOiBUZXN0IHRvIHZlcmlmeSB0aGF0IHdlYmtpdCBwcmVmaXhlcyB0aGUgJ3NvdXJjZWVuZGVkJyBldmVudCB0eXBlLlxuICAgIHdlYktpdE1lZGlhU291cmNlRXZlbnRzID0gWyd3ZWJraXRzb3VyY2VvcGVuJywgJ3dlYmtpdHNvdXJjZWNsb3NlJywgJ3dlYmtpdHNvdXJjZWVuZGVkJ107XG5cbmZ1bmN0aW9uIGhhc0NsYXNzUmVmZXJlbmNlKG9iamVjdCwgY2xhc3NOYW1lKSB7XG4gICAgcmV0dXJuICgoY2xhc3NOYW1lIGluIG9iamVjdCkgJiYgKHR5cGVvZiBvYmplY3RbY2xhc3NOYW1lXSA9PT0gJ2Z1bmN0aW9uJykpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFdmVudHNNYXAoa2V5c0FycmF5LCB2YWx1ZXNBcnJheSkge1xuICAgIGlmICgha2V5c0FycmF5IHx8ICF2YWx1ZXNBcnJheSB8fCBrZXlzQXJyYXkubGVuZ3RoICE9PSB2YWx1ZXNBcnJheS5sZW5ndGgpIHsgcmV0dXJuIG51bGw7IH1cbiAgICB2YXIgbWFwID0ge307XG4gICAgZm9yICh2YXIgaT0wOyBpPGtleXNBcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICBtYXBba2V5c0FycmF5W2ldXSA9IHZhbHVlc0FycmF5W2ldO1xuICAgIH1cblxuICAgIHJldHVybiBtYXA7XG59XG5cbmZ1bmN0aW9uIG92ZXJyaWRlRXZlbnRGbihjbGFzc1JlZiwgZXZlbnRGbk5hbWUsIGV2ZW50c01hcCkge1xuICAgIHZhciBvcmlnaW5hbEZuID0gY2xhc3NSZWYucHJvdG90eXBlW2V2ZW50Rm5OYW1lXTtcbiAgICBjbGFzc1JlZi5wcm90b3R5cGVbZXZlbnRGbk5hbWVdID0gZnVuY3Rpb24odHlwZSAvKiwgY2FsbGJhY2ssIHVzZUNhcHR1cmUgKi8pIHtcbiAgICAgICAgb3JpZ2luYWxGbi5hcHBseSh0aGlzLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpKTtcbiAgICAgICAgaWYgKCEodHlwZSBpbiBldmVudHNNYXApKSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgcmVzdEFyZ3NBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBuZXdBcmdzQXJyYXkgPSBbZXZlbnRzTWFwW3R5cGVdXS5jb25jYXQocmVzdEFyZ3NBcnJheSk7XG4gICAgICAgIG9yaWdpbmFsRm4uYXBwbHkodGhpcywgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwobmV3QXJnc0FycmF5KSk7XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0TWVkaWFTb3VyY2VDbGFzcyhyb290KSB7XG4gICAgLy8gSWYgdGhlIHJvb3QgKHdpbmRvdykgaGFzIE1lZGlhU291cmNlLCBub3RoaW5nIHRvIGRvIHNvIHNpbXBseSByZXR1cm4gdGhlIHJlZi5cbiAgICBpZiAoaGFzQ2xhc3NSZWZlcmVuY2Uocm9vdCwgbWVkaWFTb3VyY2VDbGFzc05hbWUpKSB7IHJldHVybiByb290W21lZGlhU291cmNlQ2xhc3NOYW1lXTsgfVxuICAgIC8vIElmIHRoZSByb290ICh3aW5kb3cpIGhhcyBXZWJLaXRNZWRpYVNvdXJjZSwgb3ZlcnJpZGUgaXRzIGFkZC9yZW1vdmUgZXZlbnQgZnVuY3Rpb25zIHRvIG1lZXQgdGhlIFczQ1xuICAgIC8vIHNwZWMgZm9yIGV2ZW50IHR5cGVzIGFuZCByZXR1cm4gYSByZWYgdG8gaXQuXG4gICAgZWxzZSBpZiAoaGFzQ2xhc3NSZWZlcmVuY2Uocm9vdCwgd2ViS2l0TWVkaWFTb3VyY2VDbGFzc05hbWUpKSB7XG4gICAgICAgIHZhciBjbGFzc1JlZiA9IHJvb3Rbd2ViS2l0TWVkaWFTb3VyY2VDbGFzc05hbWVdLFxuICAgICAgICAgICAgZXZlbnRzTWFwID0gY3JlYXRlRXZlbnRzTWFwKG1lZGlhU291cmNlRXZlbnRzLCB3ZWJLaXRNZWRpYVNvdXJjZUV2ZW50cyk7XG5cbiAgICAgICAgb3ZlcnJpZGVFdmVudEZuKGNsYXNzUmVmLCAnYWRkRXZlbnRMaXN0ZW5lcicsIGV2ZW50c01hcCk7XG4gICAgICAgIG92ZXJyaWRlRXZlbnRGbihjbGFzc1JlZiwgJ3JlbW92ZUV2ZW50TGlzdGVuZXInLCBldmVudHNNYXApO1xuXG4gICAgICAgIHJldHVybiBjbGFzc1JlZjtcbiAgICB9XG5cbiAgICAvLyBPdGhlcndpc2UsIChzdGFuZGFyZCBvciBub25zdGFuZGFyZCkgTWVkaWFTb3VyY2UgZG9lc24ndCBhcHBlYXIgdG8gYmUgbmF0aXZlbHkgc3VwcG9ydGVkLCBzbyByZXR1cm5cbiAgICAvLyBhIGdlbmVyaWMgZnVuY3Rpb24gdGhhdCB0aHJvd3MgYW4gZXJyb3Igd2hlbiBjYWxsZWQuXG4gICAgLy8gVE9ETzogVGhyb3cgZXJyb3IgaW1tZWRpYXRlbHkgaW5zdGVhZCAob3IgYm90aCk/XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkgeyB0aHJvdyBuZXcgRXJyb3IoJ01lZGlhU291cmNlIGRvZXNuXFwndCBhcHBlYXIgdG8gYmUgc3VwcG9ydGVkIGluIHlvdXIgZW52aXJvbm1lbnQnKTsgfTtcbn1cblxudmFyIE1lZGlhU291cmNlID0gZ2V0TWVkaWFTb3VyY2VDbGFzcyhyb290KTtcblxubW9kdWxlLmV4cG9ydHMgPSBNZWRpYVNvdXJjZTsiLCI7KGZ1bmN0aW9uKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciByb290ID0gcmVxdWlyZSgnLi93aW5kb3cuanMnKSxcbiAgICAgICAgTWVkaWFTb3VyY2UgPSByZXF1aXJlKCcuL01lZGlhU291cmNlJyk7XG5cbiAgICBmdW5jdGlvbiBtZWRpYVNvdXJjZVNoaW0ocm9vdCwgbWVkaWFTb3VyY2VDbGFzcykge1xuICAgICAgICByb290Lk1lZGlhU291cmNlID0gbWVkaWFTb3VyY2VDbGFzcztcbiAgICB9XG5cbiAgICBtZWRpYVNvdXJjZVNoaW0ocm9vdCwgTWVkaWFTb3VyY2UpO1xufS5jYWxsKHRoaXMpKTsiLCIoZnVuY3Rpb24gKGdsb2JhbCl7XG4vLyBDcmVhdGUgYSBzaW1wbGUgbW9kdWxlIHRvIHJlZmVyIHRvIHRoZSB3aW5kb3cvZ2xvYmFsIG9iamVjdCB0byBtYWtlIG1vY2tpbmcgdGhlIHdpbmRvdyBvYmplY3QgYW5kIGl0c1xuLy8gcHJvcGVydGllcyBjbGVhbmVyIHdoZW4gdGVzdGluZy5cbid1c2Ugc3RyaWN0Jztcbm1vZHVsZS5leHBvcnRzID0gZ2xvYmFsO1xufSkuY2FsbCh0aGlzLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30pIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgU2VnbWVudExvYWRlciA9IHJlcXVpcmUoJy4vc2VnbWVudHMvU2VnbWVudExvYWRlci5qcycpLFxuICAgIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHJlcXVpcmUoJy4vc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcycpLFxuICAgIERvd25sb2FkUmF0ZU1hbmFnZXIgPSByZXF1aXJlKCcuL3J1bGVzL0Rvd25sb2FkUmF0ZU1hbmFnZXIuanMnKSxcbiAgICBWaWRlb1JlYWR5U3RhdGVSdWxlID0gcmVxdWlyZSgnLi9ydWxlcy9kb3dubG9hZFJhdGUvVmlkZW9SZWFkeVN0YXRlUnVsZS5qcycpLFxuICAgIFN0cmVhbUxvYWRlciA9IHJlcXVpcmUoJy4vU3RyZWFtTG9hZGVyLmpzJyksXG4gICAgZ2V0TXBkID0gcmVxdWlyZSgnLi9kYXNoL21wZC9nZXRNcGQuanMnKSxcbiAgICBzdHJlYW1UeXBlcyA9IFsndmlkZW8nLCAnYXVkaW8nXTtcblxuZnVuY3Rpb24gbG9hZEluaXRpYWxpemF0aW9uKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSkge1xuICAgIHNlZ21lbnRMb2FkZXIub25lKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgbG9hZFNlZ21lbnRzKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUuYWRkVG9RdWV1ZShldmVudC5kYXRhKTtcbiAgICB9KTtcbiAgICBzZWdtZW50TG9hZGVyLmxvYWRJbml0aWFsaXphdGlvbigpO1xufVxuXG5mdW5jdGlvbiBsb2FkU2VnbWVudHMoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlKSB7XG4gICAgLy92YXIgc2VnbWVudHMgPSBbXTtcbiAgICBzZWdtZW50TG9hZGVyLm9uKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCBmdW5jdGlvbiBzZWdtZW50TG9hZGVkSGFuZGxlcihldmVudCkge1xuICAgICAgICAvL3NlZ21lbnRzLnB1c2goZXZlbnQuZGF0YSk7XG4gICAgICAgIC8vY29uc29sZS5sb2coJ0N1cnJlbnQgU2VnbWVudCBDb3VudDogJyArIHNlZ21lbnRzLmxlbmd0aCk7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5vbmUoc291cmNlQnVmZmVyRGF0YVF1ZXVlLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBsb2FkaW5nID0gc2VnbWVudExvYWRlci5sb2FkTmV4dFNlZ21lbnQoKTtcbiAgICAgICAgICAgIGlmICghbG9hZGluZykge1xuICAgICAgICAgICAgICAgIHNlZ21lbnRMb2FkZXIub2ZmKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCBzZWdtZW50TG9hZGVkSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgLypjb25zb2xlLmxvZygpO1xuICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygpO1xuICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygpO1xuICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRmluYWwgU2VnbWVudCBDb3VudDogJyArIHNlZ21lbnRzLmxlbmd0aCk7Ki9cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5hZGRUb1F1ZXVlKGV2ZW50LmRhdGEpO1xuICAgIH0pO1xuXG4gICAgc2VnbWVudExvYWRlci5sb2FkTmV4dFNlZ21lbnQoKTtcbn1cblxuLy8gVE9ETzogTW92ZSB0aGlzIGVsc2V3aGVyZSAoV2hlcmU/KVxuZnVuY3Rpb24gZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTZWdtZW50TG9hZGVyQnlUeXBlKG1hbmlmZXN0LCBzdHJlYW1UeXBlKSB7XG4gICAgdmFyIGFkYXB0YXRpb25TZXQgPSBnZXRNcGQobWFuaWZlc3QpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0QnlUeXBlKHN0cmVhbVR5cGUpO1xuICAgIHJldHVybiBhZGFwdGF0aW9uU2V0ID8gbmV3IFNlZ21lbnRMb2FkZXIoYWRhcHRhdGlvblNldCkgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3QsIG1lZGlhU291cmNlLCBzdHJlYW1UeXBlKSB7XG4gICAgLy8gTk9URTogU2luY2UgY29kZWNzIG9mIHBhcnRpY3VsYXIgcmVwcmVzZW50YXRpb25zIChzdHJlYW0gdmFyaWFudHMpIG1heSB2YXJ5IHNsaWdodGx5LCBuZWVkIHRvIGdldCBzcGVjaWZpY1xuICAgIC8vIHJlcHJlc2VudGF0aW9uIHRvIGdldCB0eXBlIGZvciBzb3VyY2UgYnVmZmVyLlxuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IGdldE1wZChtYW5pZmVzdCkuZ2V0UGVyaW9kcygpWzBdLmdldEFkYXB0YXRpb25TZXRCeVR5cGUoc3RyZWFtVHlwZSkuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNvdXJjZUJ1ZmZlclR5cGUgPSBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc291cmNlQnVmZmVyID0gbWVkaWFTb3VyY2UuYWRkU291cmNlQnVmZmVyKHNvdXJjZUJ1ZmZlclR5cGUpO1xuXG4gICAgcmV0dXJuIHNvdXJjZUJ1ZmZlciA/IG5ldyBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbUxvYWRlckZvclR5cGUobWFuaWZlc3QsIG1lZGlhU291cmNlLCBzdHJlYW1UeXBlKSB7XG4gICAgdmFyIHNlZ21lbnRMb2FkZXIsXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTtcblxuICAgIHNlZ21lbnRMb2FkZXIgPSBjcmVhdGVTZWdtZW50TG9hZGVyQnlUeXBlKG1hbmlmZXN0LCBzdHJlYW1UeXBlKTtcbiAgICBpZiAoIXNlZ21lbnRMb2FkZXIpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBjcmVhdGVTb3VyY2VCdWZmZXJEYXRhUXVldWVCeVR5cGUobWFuaWZlc3QsIG1lZGlhU291cmNlLCBzdHJlYW1UeXBlKTtcbiAgICBpZiAoIXNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHJldHVybiBuZXcgU3RyZWFtTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgc3RyZWFtVHlwZSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbUxvYWRlcnNGb3JUeXBlcyhtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIHN0cmVhbVR5cGVzKSB7XG4gICAgdmFyIHN0cmVhbUxvYWRlcnMgPSBbXSxcbiAgICAgICAgY3VycmVudFN0cmVhbUxvYWRlcjtcblxuICAgIHN0cmVhbVR5cGVzLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtVHlwZSkge1xuICAgICAgICBjdXJyZW50U3RyZWFtTG9hZGVyID0gY3JlYXRlU3RyZWFtTG9hZGVyRm9yVHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIHN0cmVhbVR5cGUpO1xuICAgICAgICBpZiAoY3VycmVudFN0cmVhbUxvYWRlcikgeyBzdHJlYW1Mb2FkZXJzLnB1c2goY3VycmVudFN0cmVhbUxvYWRlcik7IH1cbiAgICB9KTtcblxuICAgIHJldHVybiBzdHJlYW1Mb2FkZXJzO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW1Mb2FkZXJzKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSkgeyByZXR1cm4gY3JlYXRlU3RyZWFtTG9hZGVyc0ZvclR5cGVzKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgc3RyZWFtVHlwZXMpOyB9XG5cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHRoaXMuX19kb3dubG9hZFJhdGVNZ3IgPSBuZXcgRG93bmxvYWRSYXRlTWFuYWdlcihbbmV3IFZpZGVvUmVhZHlTdGF0ZVJ1bGUodGVjaCldKTtcbiAgICB0aGlzLl9fc3RyZWFtTG9hZGVycyA9IGNyZWF0ZVN0cmVhbUxvYWRlcnMobWFuaWZlc3QsIG1lZGlhU291cmNlKTtcbiAgICB0aGlzLl9fc3RyZWFtTG9hZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbUxvYWRlcikge1xuICAgICAgICBsb2FkSW5pdGlhbGl6YXRpb24oc3RyZWFtTG9hZGVyLmdldFNlZ21lbnRMb2FkZXIoKSwgc3RyZWFtTG9hZGVyLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSgpKTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJy4vd2luZG93LmpzJykuTWVkaWFTb3VyY2UsXG4gICAgbG9hZE1hbmlmZXN0ID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMnKSxcbiAgICBQbGF5bGlzdExvYWRlciA9IHJlcXVpcmUoJy4vUGxheWxpc3RMb2FkZXIuanMnKTtcblxuZnVuY3Rpb24gbG9hZChtYW5pZmVzdFhtbCwgdGVjaCkge1xuICAgIGNvbnNvbGUubG9nKCdTVEFSVCcpO1xuXG4gICAgdmFyIG1lZGlhU291cmNlID0gbmV3IE1lZGlhU291cmNlKCksXG4gICAgICAgIG9wZW5MaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBtZWRpYVNvdXJjZS5yZW1vdmVFdmVudExpc3RlbmVyKCdzb3VyY2VvcGVuJywgb3Blbkxpc3RlbmVyLCBmYWxzZSk7XG4gICAgICAgICAgICB2YXIgcGxheWxpc3RMb2FkZXIgPSBuZXcgUGxheWxpc3RMb2FkZXIobWFuaWZlc3RYbWwsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICAgICAgfTtcblxuICAgIG1lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZW9wZW4nLCBvcGVuTGlzdGVuZXIsIGZhbHNlKTtcblxuICAgIC8vIFRPRE86IEhhbmRsZSBjbG9zZS5cbiAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3dlYmtpdHNvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG4gICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCdzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuXG4gICAgdGVjaC5zZXRTcmMoVVJMLmNyZWF0ZU9iamVjdFVSTChtZWRpYVNvdXJjZSkpO1xufVxuXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIGxvYWRNYW5pZmVzdChzb3VyY2Uuc3JjLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIGxvYWQoZGF0YS5tYW5pZmVzdFhtbCwgdGVjaCk7XG4gICAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlSGFuZGxlcjsiLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIFN0cmVhbUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIHN0cmVhbVR5cGUpIHtcbiAgICB0aGlzLl9fc2VnbWVudExvYWRlciA9IHNlZ21lbnRMb2FkZXI7XG4gICAgdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZTtcbiAgICB0aGlzLl9fc3RyZWFtVHlwZSA9IHN0cmVhbVR5cGU7XG59XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0U3RyZWFtVHlwZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3N0cmVhbVR5cGU7IH07XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0U2VnbWVudExvYWRlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXI7IH07XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlOyB9O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TnVtYmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fc2VnbWVudExvYWRlci5nZXRDdXJyZW50SW5kZXgoKTsgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJlYW1Mb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgdXRpbCA9IHJlcXVpcmUoJy4vdXRpbC5qcycpLFxuICAgIHBhcnNlUm9vdFVybCA9IHV0aWwucGFyc2VSb290VXJsLFxuICAgIGNyZWF0ZU1wZE9iamVjdCxcbiAgICBjcmVhdGVQZXJpb2RPYmplY3QsXG4gICAgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCxcbiAgICBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCxcbiAgICBjcmVhdGVTZWdtZW50VGVtcGxhdGUsXG4gICAgZ2V0TXBkLFxuICAgIGdldEFkYXB0YXRpb25TZXRCeVR5cGUsXG4gICAgZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSxcbiAgICBnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZTtcblxuLy8gVE9ETzogU2hvdWxkIHRoaXMgZXhpc3Qgb24gbXBkIGRhdGF2aWV3IG9yIGF0IGEgaGlnaGVyIGxldmVsP1xuLy8gVE9ETzogUmVmYWN0b3IuIENvdWxkIGJlIG1vcmUgZWZmaWNpZW50IChSZWN1cnNpdmUgZm4/IFVzZSBlbGVtZW50LmdldEVsZW1lbnRzQnlOYW1lKCdCYXNlVXJsJylbMF0/KS5cbi8vIFRPRE86IEN1cnJlbnRseSBhc3N1bWluZyAqRUlUSEVSKiA8QmFzZVVSTD4gbm9kZXMgd2lsbCBwcm92aWRlIGFuIGFic29sdXRlIGJhc2UgdXJsIChpZSByZXNvbHZlIHRvICdodHRwOi8vJyBldGMpXG4vLyBUT0RPOiAqT1IqIHdlIHNob3VsZCB1c2UgdGhlIGJhc2UgdXJsIG9mIHRoZSBob3N0IG9mIHRoZSBNUEQgbWFuaWZlc3QuXG52YXIgYnVpbGRCYXNlVXJsID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHZhciBlbGVtSGllcmFyY2h5ID0gW3htbE5vZGVdLmNvbmNhdCh4bWxmdW4uZ2V0QW5jZXN0b3JzKHhtbE5vZGUpKSxcbiAgICAgICAgZm91bmRMb2NhbEJhc2VVcmwgPSBmYWxzZTtcbiAgICAvL3ZhciBiYXNlVXJscyA9IF8ubWFwKGVsZW1IaWVyYXJjaHksIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICB2YXIgYmFzZVVybHMgPSBlbGVtSGllcmFyY2h5Lm1hcChmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmIChmb3VuZExvY2FsQmFzZVVybCkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgaWYgKCFlbGVtLmhhc0NoaWxkTm9kZXMoKSkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgdmFyIGNoaWxkO1xuICAgICAgICBmb3IgKHZhciBpPTA7IGk8ZWxlbS5jaGlsZE5vZGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IGVsZW0uY2hpbGROb2Rlcy5pdGVtKGkpO1xuICAgICAgICAgICAgaWYgKGNoaWxkLm5vZGVOYW1lID09PSAnQmFzZVVSTCcpIHtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dEVsZW0gPSBjaGlsZC5jaGlsZE5vZGVzLml0ZW0oMCk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRWYWx1ZSA9IHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRleHRWYWx1ZS5pbmRleE9mKCdodHRwOi8vJykgPT09IDApIHsgZm91bmRMb2NhbEJhc2VVcmwgPSB0cnVlOyB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRleHRFbGVtLndob2xlVGV4dC50cmltKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfSk7XG5cbiAgICB2YXIgYmFzZVVybCA9IGJhc2VVcmxzLnJldmVyc2UoKS5qb2luKCcnKTtcbiAgICBpZiAoIWJhc2VVcmwpIHsgcmV0dXJuIHBhcnNlUm9vdFVybCh4bWxOb2RlLmJhc2VVUkkpOyB9XG4gICAgcmV0dXJuIGJhc2VVcmw7XG59O1xuXG52YXIgZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcyA9IFtcbiAgICAnQWRhcHRhdGlvblNldCcsXG4gICAgJ1JlcHJlc2VudGF0aW9uJyxcbiAgICAnU3ViUmVwcmVzZW50YXRpb24nXG5dO1xuXG52YXIgaGFzQ29tbW9uUHJvcGVydGllcyA9IGZ1bmN0aW9uKGVsZW0pIHtcbiAgICByZXR1cm4gZWxlbXNXaXRoQ29tbW9uUHJvcGVydGllcy5pbmRleE9mKGVsZW0ubm9kZU5hbWUpID49IDA7XG59O1xuXG52YXIgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuICFoYXNDb21tb25Qcm9wZXJ0aWVzKGVsZW0pO1xufTtcblxudmFyIGdldFdpZHRoID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCd3aWR0aCcpLFxuICAgIGdldEhlaWdodCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnaGVpZ2h0JyksXG4gICAgZ2V0RnJhbWVSYXRlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdmcmFtZVJhdGUnKSxcbiAgICBnZXRNaW1lVHlwZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnbWltZVR5cGUnKSxcbiAgICBnZXRDb2RlY3MgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2NvZGVjcycpO1xuXG52YXIgZ2V0U2VnbWVudFRlbXBsYXRlWG1sID0geG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCgnU2VnbWVudFRlbXBsYXRlJywgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMpO1xuXG4vLyBNUEQgQXR0ciBmbnNcbnZhciBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbicpO1xuXG4vLyBSZXByZXNlbnRhdGlvbiBBdHRyIGZuc1xudmFyIGdldElkID0geG1sZnVuLmdldEF0dHJGbignaWQnKSxcbiAgICBnZXRCYW5kd2lkdGggPSB4bWxmdW4uZ2V0QXR0ckZuKCdiYW5kd2lkdGgnKTtcblxuLy8gU2VnbWVudFRlbXBsYXRlIEF0dHIgZm5zXG52YXIgZ2V0SW5pdGlhbGl6YXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdpbml0aWFsaXphdGlvbicpLFxuICAgIGdldE1lZGlhID0geG1sZnVuLmdldEF0dHJGbignbWVkaWEnKSxcbiAgICBnZXREdXJhdGlvbiA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2R1cmF0aW9uJyksXG4gICAgZ2V0VGltZXNjYWxlID0geG1sZnVuLmdldEF0dHJGbigndGltZXNjYWxlJyksXG4gICAgZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3ByZXNlbnRhdGlvblRpbWVPZmZzZXQnKSxcbiAgICBnZXRTdGFydE51bWJlciA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3N0YXJ0TnVtYmVyJyk7XG5cbi8vIFRPRE86IFJlcGVhdCBjb2RlLiBBYnN0cmFjdCBhd2F5IChQcm90b3R5cGFsIEluaGVyaXRhbmNlL09PIE1vZGVsPyBPYmplY3QgY29tcG9zZXIgZm4/KVxuY3JlYXRlTXBkT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRQZXJpb2RzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVQZXJpb2RPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXRzOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldEJ5VHlwZTogZnVuY3Rpb24odHlwZSkge1xuICAgICAgICAgICAgcmV0dXJuIGdldEFkYXB0YXRpb25TZXRCeVR5cGUodHlwZSwgeG1sTm9kZSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KVxuICAgIH07XG59O1xuXG5jcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRSZXByZXNlbnRhdGlvbnM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnUmVwcmVzZW50YXRpb24nLCBjcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCksXG4gICAgICAgIGdldFNlZ21lbnRUZW1wbGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gY3JlYXRlU2VnbWVudFRlbXBsYXRlKGdldFNlZ21lbnRUZW1wbGF0ZVhtbCh4bWxOb2RlKSk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVSZXByZXNlbnRhdGlvbk9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRQZXJpb2Q6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ1BlcmlvZCcsIGNyZWF0ZVBlcmlvZE9iamVjdCksXG4gICAgICAgIGdldE1wZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnTVBEJywgY3JlYXRlTXBkT2JqZWN0KSxcbiAgICAgICAgLy8gQXR0cnNcbiAgICAgICAgZ2V0SWQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRJZCwgeG1sTm9kZSksXG4gICAgICAgIGdldFdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0V2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRIZWlnaHQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRIZWlnaHQsIHhtbE5vZGUpLFxuICAgICAgICBnZXRGcmFtZVJhdGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRGcmFtZVJhdGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHhtbE5vZGUpLFxuICAgICAgICBnZXRDb2RlY3M6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRDb2RlY3MsIHhtbE5vZGUpLFxuICAgICAgICBnZXRCYXNlVXJsOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oYnVpbGRCYXNlVXJsLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWltZVR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNaW1lVHlwZSwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudFRlbXBsYXRlID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJbml0aWFsaXphdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEluaXRpYWxpemF0aW9uLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWVkaWE6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRNZWRpYSwgeG1sTm9kZSksXG4gICAgICAgIGdldER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RHVyYXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRUaW1lc2NhbGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUaW1lc2NhbGUsIHhtbE5vZGUpLFxuICAgICAgICBnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0UHJlc2VudGF0aW9uVGltZU9mZnNldCwgeG1sTm9kZSksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXIsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbi8vIFRPRE86IENoYW5nZSB0aGlzIGFwaSB0byByZXR1cm4gYSBsaXN0IG9mIGFsbCBtYXRjaGluZyBhZGFwdGF0aW9uIHNldHMgdG8gYWxsb3cgZm9yIGdyZWF0ZXIgZmxleGliaWxpdHkuXG5nZXRBZGFwdGF0aW9uU2V0QnlUeXBlID0gZnVuY3Rpb24odHlwZSwgcGVyaW9kWG1sKSB7XG4gICAgdmFyIGFkYXB0YXRpb25TZXRzID0gcGVyaW9kWG1sLmdldEVsZW1lbnRzQnlUYWdOYW1lKCdBZGFwdGF0aW9uU2V0JyksXG4gICAgICAgIGFkYXB0YXRpb25TZXQsXG4gICAgICAgIHJlcHJlc2VudGF0aW9uLFxuICAgICAgICBtaW1lVHlwZTtcblxuICAgIGZvciAodmFyIGk9MDsgaTxhZGFwdGF0aW9uU2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBhZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldHMuaXRlbShpKTtcbiAgICAgICAgLy8gU2luY2UgdGhlIG1pbWVUeXBlIGNhbiBiZSBkZWZpbmVkIG9uIHRoZSBBZGFwdGF0aW9uU2V0IG9yIG9uIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZCBub2RlcyxcbiAgICAgICAgLy8gY2hlY2sgZm9yIG1pbWV0eXBlIG9uIG9uZSBvZiBpdHMgUmVwcmVzZW50YXRpb24gY2hpbGRyZW4gdXNpbmcgZ2V0TWltZVR5cGUoKSwgd2hpY2ggYXNzdW1lcyB0aGVcbiAgICAgICAgLy8gbWltZVR5cGUgY2FuIGJlIGluaGVyaXRlZCBhbmQgd2lsbCBjaGVjayBpdHNlbGYgYW5kIGl0cyBhbmNlc3RvcnMgZm9yIHRoZSBhdHRyLlxuICAgICAgICByZXByZXNlbnRhdGlvbiA9IGFkYXB0YXRpb25TZXQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ1JlcHJlc2VudGF0aW9uJylbMF07XG4gICAgICAgIC8vIE5lZWQgdG8gY2hlY2sgdGhlIHJlcHJlc2VudGF0aW9uIGluc3RlYWQgb2YgdGhlIGFkYXB0YXRpb24gc2V0LCBzaW5jZSB0aGUgbWltZVR5cGUgbWF5IG5vdCBiZSBzcGVjaWZpZWRcbiAgICAgICAgLy8gb24gdGhlIGFkYXB0YXRpb24gc2V0IGF0IGFsbCBhbmQgbWF5IGJlIHNwZWNpZmllZCBmb3IgZWFjaCBvZiB0aGUgcmVwcmVzZW50YXRpb25zIGluc3RlYWQuXG4gICAgICAgIG1pbWVUeXBlID0gZ2V0TWltZVR5cGUocmVwcmVzZW50YXRpb24pO1xuICAgICAgICBpZiAoISFtaW1lVHlwZSAmJiBtaW1lVHlwZS5pbmRleE9mKHR5cGUpID49IDApIHsgcmV0dXJuIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QoYWRhcHRhdGlvblNldCk7IH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn07XG5cbmdldE1wZCA9IGZ1bmN0aW9uKG1hbmlmZXN0WG1sKSB7XG4gICAgcmV0dXJuIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUobWFuaWZlc3RYbWwsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpWzBdO1xufTtcblxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG5nZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSA9IGZ1bmN0aW9uKHhtbE5vZGUsIHRhZ05hbWUsIG1hcEZuKSB7XG4gICAgaWYgKCF0YWdOYW1lIHx8ICF4bWxOb2RlIHx8ICF4bWxOb2RlLnBhcmVudE5vZGUpIHsgcmV0dXJuIG51bGw7IH1cbiAgICBpZiAoIXhtbE5vZGUucGFyZW50Tm9kZS5oYXNPd25Qcm9wZXJ0eSgnbm9kZU5hbWUnKSkgeyByZXR1cm4gbnVsbDsgfVxuXG4gICAgaWYgKHhtbE5vZGUucGFyZW50Tm9kZS5ub2RlTmFtZSA9PT0gdGFnTmFtZSkge1xuICAgICAgICByZXR1cm4gKHR5cGVvZiBtYXBGbiA9PT0gJ2Z1bmN0aW9uJykgPyBtYXBGbih4bWxOb2RlLnBhcmVudE5vZGUpIDogeG1sTm9kZS5wYXJlbnROb2RlO1xuICAgIH1cbiAgICByZXR1cm4gZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUoeG1sTm9kZS5wYXJlbnROb2RlLCB0YWdOYW1lLCBtYXBGbik7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdldE1wZDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwsXG4gICAgLy8gVE9ETzogU2hvdWxkIHByZXNlbnRhdGlvbkR1cmF0aW9uIHBhcnNpbmcgYmUgaW4gdXRpbCBvciBzb21ld2hlcmUgZWxzZT9cbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgU0VDT05EU19JTl9ZRUFSID0gMzY1ICogMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fTU9OVEggPSAzMCAqIDI0ICogNjAgKiA2MCwgLy8gbm90IHByZWNpc2UhXG4gICAgU0VDT05EU19JTl9EQVkgPSAyNCAqIDYwICogNjAsXG4gICAgU0VDT05EU19JTl9IT1VSID0gNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01JTiA9IDYwLFxuICAgIE1JTlVURVNfSU5fSE9VUiA9IDYwLFxuICAgIE1JTExJU0VDT05EU19JTl9TRUNPTkRTID0gMTAwMCxcbiAgICBkdXJhdGlvblJlZ2V4ID0gL15QKChbXFxkLl0qKVkpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopRCk/VD8oKFtcXGQuXSopSCk/KChbXFxkLl0qKU0pPygoW1xcZC5dKilTKT8vO1xuXG5wYXJzZVJvb3RVcmwgPSBmdW5jdGlvbih1cmwpIHtcbiAgICBpZiAodHlwZW9mIHVybCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignLycpID09PSAtMSkge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybC5pbmRleE9mKCc/JykgIT09IC0xKSB7XG4gICAgICAgIHVybCA9IHVybC5zdWJzdHJpbmcoMCwgdXJsLmluZGV4T2YoJz8nKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVybC5zdWJzdHJpbmcoMCwgdXJsLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn07XG5cbi8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgLy9zdHIgPSBcIlAxMFkxME0xMERUMTBIMTBNMTAuMVNcIjtcbiAgICB2YXIgbWF0Y2ggPSBkdXJhdGlvblJlZ2V4LmV4ZWMoc3RyKTtcbiAgICByZXR1cm4gKHBhcnNlRmxvYXQobWF0Y2hbMl0gfHwgMCkgKiBTRUNPTkRTX0lOX1lFQVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzRdIHx8IDApICogU0VDT05EU19JTl9NT05USCArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbNl0gfHwgMCkgKiBTRUNPTkRTX0lOX0RBWSArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbOF0gfHwgMCkgKiBTRUNPTkRTX0lOX0hPVVIgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzEwXSB8fCAwKSAqIFNFQ09ORFNfSU5fTUlOICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMl0gfHwgMCkpO1xufTtcblxudmFyIHV0aWwgPSB7XG4gICAgcGFyc2VSb290VXJsOiBwYXJzZVJvb3RVcmwsXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb25cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gdXRpbDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB4bWxmdW4gPSByZXF1aXJlKCcuLi8uLi94bWxmdW4uanMnKSxcbiAgICBwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXF1aXJlKCcuLi9tcGQvdXRpbC5qcycpLnBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbixcbiAgICBzZWdtZW50VGVtcGxhdGUgPSByZXF1aXJlKCcuL3NlZ21lbnRUZW1wbGF0ZScpLFxuICAgIGNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlLFxuICAgIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcixcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lLFxuICAgIGdldFR5cGUsXG4gICAgZ2V0QmFuZHdpZHRoLFxuICAgIGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsXG4gICAgZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLFxuICAgIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlLFxuICAgIGdldEVuZE51bWJlckZyb21UZW1wbGF0ZTtcblxuZ2V0VHlwZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59O1xuXG5nZXRCYW5kd2lkdGggPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBOdW1iZXIocmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCkpO1xufTtcblxuZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgLy8gVE9ETzogU3VwcG9ydCBwZXJpb2QtcmVsYXRpdmUgcHJlc2VudGF0aW9uIHRpbWVcbiAgICB2YXIgbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IHJlcHJlc2VudGF0aW9uLmdldE1wZCgpLmdldE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24oKSxcbiAgICAgICAgcGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiA9IE51bWJlcihwYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24obWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbikpLFxuICAgICAgICBwcmVzZW50YXRpb25UaW1lT2Zmc2V0ID0gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQoKSk7XG4gICAgcmV0dXJuIE51bWJlcihwYXJzZWRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uIC0gcHJlc2VudGF0aW9uVGltZU9mZnNldCk7XG59O1xuXG5nZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBzZWdtZW50VGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKTtcbiAgICByZXR1cm4gTnVtYmVyKHNlZ21lbnRUZW1wbGF0ZS5nZXREdXJhdGlvbigpKSAvIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0VGltZXNjYWxlKCkpO1xufTtcblxuZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHJldHVybiBNYXRoLmNlaWwoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLyBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pKTtcbn07XG5cbmdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldFN0YXJ0TnVtYmVyKCkpO1xufTtcblxuZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pICsgZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC0gMTtcbn07XG5cbmNyZWF0ZVNlZ21lbnRMaXN0RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBnZXRUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VHlwZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRCYW5kd2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRCYW5kd2lkdGgsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0VG90YWxEdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0U2VnbWVudER1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsU2VnbWVudENvdW50OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0VG90YWxTZWdtZW50Q291bnRGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRFbmROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgLy8gVE9ETzogRXh0ZXJuYWxpemVcbiAgICAgICAgZ2V0SW5pdGlhbGl6YXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGluaXRpYWxpemF0aW9uID0ge307XG4gICAgICAgICAgICBpbml0aWFsaXphdGlvbi5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgICAgICAgICAgcmVwcmVzZW50YXRpb25JZCA9IHJlcHJlc2VudGF0aW9uLmdldElkKCksXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldEluaXRpYWxpemF0aW9uKCksXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoaW5pdGlhbGl6YXRpb25SZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbklkKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYmFzZVVybCArIGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmw7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgcmV0dXJuIGluaXRpYWxpemF0aW9uO1xuICAgICAgICB9LFxuICAgICAgICBnZXRTZWdtZW50QnlOdW1iZXI6IGZ1bmN0aW9uKG51bWJlcikgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpOyB9LFxuICAgICAgICBnZXRTZWdtZW50QnlUaW1lOiBmdW5jdGlvbihzZWNvbmRzKSB7IHJldHVybiBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKTsgfVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKSB7XG4gICAgdmFyIHNlZ21lbnQgPSB7fTtcbiAgICBzZWdtZW50LmdldFVybCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYmFzZVVybCA9IHJlcHJlc2VudGF0aW9uLmdldEJhc2VVcmwoKSxcbiAgICAgICAgICAgIHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCkuZ2V0TWVkaWEoKSxcbiAgICAgICAgICAgIHJlcGxhY2VkSWRVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZUlERm9yVGVtcGxhdGUoc2VnbWVudFJlbGF0aXZlVXJsVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uLmdldElkKCkpLFxuICAgICAgICAgICAgLy8gVE9ETzogU2luY2UgJFRpbWUkLXRlbXBsYXRlZCBzZWdtZW50IFVSTHMgc2hvdWxkIG9ubHkgZXhpc3QgaW4gY29uanVuY3Rpb24gdy9hIDxTZWdtZW50VGltZWxpbmU+LFxuICAgICAgICAgICAgLy8gVE9ETzogY2FuIGN1cnJlbnRseSBhc3N1bWUgYSAkTnVtYmVyJC1iYXNlZCB0ZW1wbGF0ZWQgdXJsLlxuICAgICAgICAgICAgLy8gVE9ETzogRW5mb3JjZSBtaW4vbWF4IG51bWJlciByYW5nZSAoYmFzZWQgb24gc2VnbWVudExpc3Qgc3RhcnROdW1iZXIgJiBlbmROdW1iZXIpXG4gICAgICAgICAgICByZXBsYWNlZE51bWJlclVybCA9IHNlZ21lbnRUZW1wbGF0ZS5yZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZShyZXBsYWNlZElkVXJsLCAnTnVtYmVyJywgbnVtYmVyKTtcbiAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyByZXBsYWNlZE51bWJlclVybDtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0U3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBudW1iZXIgKiBnZXRTZWdtZW50RHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pO1xuICAgIH07XG4gICAgc2VnbWVudC5nZXREdXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBUT0RPOiBIYW5kbGUgbGFzdCBzZWdtZW50IChsaWtlbHkgPCBzZWdtZW50IGR1cmF0aW9uKVxuICAgICAgICByZXR1cm4gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0TnVtYmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiBudW1iZXI7IH07XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5jcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlUaW1lID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIHNlY29uZHMpIHtcbiAgICB2YXIgc2VnbWVudER1cmF0aW9uID0gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgbnVtYmVyID0gTWF0aC5mbG9vcihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAvIHNlZ21lbnREdXJhdGlvbiksXG4gICAgICAgIHNlZ21lbnQgPSBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIocmVwcmVzZW50YXRpb24sIG51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5mdW5jdGlvbiBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgaWYgKCFyZXByZXNlbnRhdGlvbikgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgaWYgKHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpKSB7IHJldHVybiBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7IH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb247XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZWdtZW50VGVtcGxhdGUsXG4gICAgemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU7XG5cbnplcm9QYWRUb0xlbmd0aCA9IGZ1bmN0aW9uIChudW1TdHIsIG1pblN0ckxlbmd0aCkge1xuICAgIHdoaWxlIChudW1TdHIubGVuZ3RoIDwgbWluU3RyTGVuZ3RoKSB7XG4gICAgICAgIG51bVN0ciA9ICcwJyArIG51bVN0cjtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVtU3RyO1xufTtcblxucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHRva2VuLCB2YWx1ZSkge1xuXG4gICAgdmFyIHN0YXJ0UG9zID0gMCxcbiAgICAgICAgZW5kUG9zID0gMCxcbiAgICAgICAgdG9rZW5MZW4gPSB0b2tlbi5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZyA9ICclMCcsXG4gICAgICAgIGZvcm1hdFRhZ0xlbiA9IGZvcm1hdFRhZy5sZW5ndGgsXG4gICAgICAgIGZvcm1hdFRhZ1BvcyxcbiAgICAgICAgc3BlY2lmaWVyLFxuICAgICAgICB3aWR0aCxcbiAgICAgICAgcGFkZGVkVmFsdWU7XG5cbiAgICAvLyBrZWVwIGxvb3Bpbmcgcm91bmQgdW50aWwgYWxsIGluc3RhbmNlcyBvZiA8dG9rZW4+IGhhdmUgYmVlblxuICAgIC8vIHJlcGxhY2VkLiBvbmNlIHRoYXQgaGFzIGhhcHBlbmVkLCBzdGFydFBvcyBiZWxvdyB3aWxsIGJlIC0xXG4gICAgLy8gYW5kIHRoZSBjb21wbGV0ZWQgdXJsIHdpbGwgYmUgcmV0dXJuZWQuXG4gICAgd2hpbGUgKHRydWUpIHtcblxuICAgICAgICAvLyBjaGVjayBpZiB0aGVyZSBpcyBhIHZhbGlkICQ8dG9rZW4+Li4uJCBpZGVudGlmaWVyXG4gICAgICAgIC8vIGlmIG5vdCwgcmV0dXJuIHRoZSB1cmwgYXMgaXMuXG4gICAgICAgIHN0YXJ0UG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcgKyB0b2tlbik7XG4gICAgICAgIGlmIChzdGFydFBvcyA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVN0cjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoZSBuZXh0ICckJyBtdXN0IGJlIHRoZSBlbmQgb2YgdGhlIGlkZW50aWZlclxuICAgICAgICAvLyBpZiB0aGVyZSBpc24ndCBvbmUsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBlbmRQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKCckJywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChlbmRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBub3cgc2VlIGlmIHRoZXJlIGlzIGFuIGFkZGl0aW9uYWwgZm9ybWF0IHRhZyBzdWZmaXhlZCB0b1xuICAgICAgICAvLyB0aGUgaWRlbnRpZmllciB3aXRoaW4gdGhlIGVuY2xvc2luZyAnJCcgY2hhcmFjdGVyc1xuICAgICAgICBmb3JtYXRUYWdQb3MgPSB0ZW1wbGF0ZVN0ci5pbmRleE9mKGZvcm1hdFRhZywgc3RhcnRQb3MgKyB0b2tlbkxlbik7XG4gICAgICAgIGlmIChmb3JtYXRUYWdQb3MgPiBzdGFydFBvcyAmJiBmb3JtYXRUYWdQb3MgPCBlbmRQb3MpIHtcblxuICAgICAgICAgICAgc3BlY2lmaWVyID0gdGVtcGxhdGVTdHIuY2hhckF0KGVuZFBvcyAtIDEpO1xuICAgICAgICAgICAgd2lkdGggPSBwYXJzZUludCh0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZm9ybWF0VGFnUG9zICsgZm9ybWF0VGFnTGVuLCBlbmRQb3MgLSAxKSwgMTApO1xuXG4gICAgICAgICAgICAvLyBzdXBwb3J0IHRoZSBtaW5pbXVtIHNwZWNpZmllcnMgcmVxdWlyZWQgYnkgSUVFRSAxMDAzLjFcbiAgICAgICAgICAgIC8vIChkLCBpICwgbywgdSwgeCwgYW5kIFgpIGZvciBjb21wbGV0ZW5lc3NcbiAgICAgICAgICAgIHN3aXRjaCAoc3BlY2lmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJlYXQgYWxsIGludCB0eXBlcyBhcyB1aW50LFxuICAgICAgICAgICAgICAgIC8vIGhlbmNlIGRlbGliZXJhdGUgZmFsbHRocm91Z2hcbiAgICAgICAgICAgICAgICBjYXNlICdkJzpcbiAgICAgICAgICAgICAgICBjYXNlICdpJzpcbiAgICAgICAgICAgICAgICBjYXNlICd1JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoKSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd4JzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ1gnOlxuICAgICAgICAgICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHplcm9QYWRUb0xlbmd0aCh2YWx1ZS50b1N0cmluZygxNiksIHdpZHRoKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdvJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoOCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1Vuc3VwcG9ydGVkL2ludmFsaWQgSUVFRSAxMDAzLjEgZm9ybWF0IGlkZW50aWZpZXIgc3RyaW5nIGluIFVSTCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYWRkZWRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVtcGxhdGVTdHIgPSB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoMCwgc3RhcnRQb3MpICsgcGFkZGVkVmFsdWUgKyB0ZW1wbGF0ZVN0ci5zdWJzdHJpbmcoZW5kUG9zICsgMSk7XG4gICAgfVxufTtcblxudW5lc2NhcGVEb2xsYXJzSW5UZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0cikge1xuICAgIHJldHVybiB0ZW1wbGF0ZVN0ci5zcGxpdCgnJCQnKS5qb2luKCckJyk7XG59O1xuXG5yZXBsYWNlSURGb3JUZW1wbGF0ZSA9IGZ1bmN0aW9uICh0ZW1wbGF0ZVN0ciwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdGVtcGxhdGVTdHIuaW5kZXhPZignJFJlcHJlc2VudGF0aW9uSUQkJykgPT09IC0xKSB7IHJldHVybiB0ZW1wbGF0ZVN0cjsgfVxuICAgIHZhciB2ID0gdmFsdWUudG9TdHJpbmcoKTtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyRSZXByZXNlbnRhdGlvbklEJCcpLmpvaW4odik7XG59O1xuXG5zZWdtZW50VGVtcGxhdGUgPSB7XG4gICAgemVyb1BhZFRvTGVuZ3RoOiB6ZXJvUGFkVG9MZW5ndGgsXG4gICAgcmVwbGFjZVRva2VuRm9yVGVtcGxhdGU6IHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlLFxuICAgIHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGU6IHVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUsXG4gICAgcmVwbGFjZUlERm9yVGVtcGxhdGU6IHJlcGxhY2VJREZvclRlbXBsYXRlXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHNlZ21lbnRUZW1wbGF0ZTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBldmVudE1nciA9IHJlcXVpcmUoJy4vZXZlbnRNYW5hZ2VyLmpzJyksXG4gICAgZXZlbnREaXNwYXRjaGVyTWl4aW4gPSB7XG4gICAgICAgIHRyaWdnZXI6IGZ1bmN0aW9uKGV2ZW50T2JqZWN0KSB7IGV2ZW50TWdyLnRyaWdnZXIodGhpcywgZXZlbnRPYmplY3QpOyB9LFxuICAgICAgICBvbmU6IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub25lKHRoaXMsIHR5cGUsIGxpc3RlbmVyRm4pOyB9LFxuICAgICAgICBvbjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vbih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb2ZmOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9mZih0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfVxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnREaXNwYXRjaGVyTWl4aW47IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmlkZW9qcyA9IHJlcXVpcmUoJy4uL3dpbmRvdy5qcycpLnZpZGVvanMsXG4gICAgZXZlbnRNYW5hZ2VyID0ge1xuICAgICAgICB0cmlnZ2VyOiB2aWRlb2pzLnRyaWdnZXIsXG4gICAgICAgIG9uZTogdmlkZW9qcy5vbmUsXG4gICAgICAgIG9uOiB2aWRlb2pzLm9uLFxuICAgICAgICBvZmY6IHZpZGVvanMub2ZmXG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudE1hbmFnZXI7IiwiLyoqXG4gKiBDcmVhdGVkIGJ5IGNwaWxsc2J1cnkgb24gMTIvMy8xNC5cbiAqL1xuOyhmdW5jdGlvbigpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgcm9vdCA9IHJlcXVpcmUoJy4vd2luZG93JyksXG4gICAgICAgIHZpZGVvanMgPSByb290LnZpZGVvanMsXG4gICAgICAgIC8vIE5vdGU6IFRvIHVzZSB0aGUgQ29tbW9uSlMgbW9kdWxlIGxvYWRlciwgaGF2ZSB0byBwb2ludCB0byB0aGUgcHJlLWJyb3dzZXJpZmllZCBtYWluIGxpYiBmaWxlLlxuICAgICAgICBtc2UgPSByZXF1aXJlKCdtc2UuanMvc3JjL2pzL21zZS5qcycpLFxuICAgICAgICBTb3VyY2VIYW5kbGVyID0gcmVxdWlyZSgnLi9Tb3VyY2VIYW5kbGVyJyk7XG5cbiAgICBpZiAoIXZpZGVvanMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgdmlkZW8uanMgbGlicmFyeSBtdXN0IGJlIGluY2x1ZGVkIHRvIHVzZSB0aGlzIE1QRUctREFTSCBzb3VyY2UgaGFuZGxlci4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjYW5IYW5kbGVTb3VyY2Uoc291cmNlKSB7XG4gICAgICAgIC8vIEV4dGVybmFsaXplIGlmIHVzZWQgZWxzZXdoZXJlLiBQb3RlbnRpYWxseSB1c2UgY29uc3RhbnQgZnVuY3Rpb24uXG4gICAgICAgIHZhciBkb2VzbnRIYW5kbGVTb3VyY2UgPSAnJyxcbiAgICAgICAgICAgIG1heWJlSGFuZGxlU291cmNlID0gJ21heWJlJyxcbiAgICAgICAgICAgIGRlZmF1bHRIYW5kbGVTb3VyY2UgPSBkb2VzbnRIYW5kbGVTb3VyY2U7XG5cbiAgICAgICAgLy8gVE9ETzogVXNlIHNhZmVyIHZqcyBjaGVjayAoZS5nLiBoYW5kbGVzIElFIGNvbmRpdGlvbnMpP1xuICAgICAgICAvLyBSZXF1aXJlcyBNZWRpYSBTb3VyY2UgRXh0ZW5zaW9uc1xuICAgICAgICBpZiAoIShyb290Lk1lZGlhU291cmNlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGRvZXNudEhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSB0eXBlIGlzIHN1cHBvcnRlZFxuICAgICAgICBpZiAoL2FwcGxpY2F0aW9uXFwvZGFzaFxcK3htbC8udGVzdChzb3VyY2UudHlwZSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdtYXRjaGVkIHR5cGUnKTtcbiAgICAgICAgICAgIHJldHVybiBtYXliZUhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4dGVuc2lvbiBtYXRjaGVzXG4gICAgICAgIGlmICgvXFwubXBkJC9pLnRlc3Qoc291cmNlLnNyYykpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdtYXRjaGVkIGV4dGVuc2lvbicpO1xuICAgICAgICAgICAgcmV0dXJuIG1heWJlSGFuZGxlU291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGRlZmF1bHRIYW5kbGVTb3VyY2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGFuZGxlU291cmNlKHNvdXJjZSwgdGVjaCkge1xuICAgICAgICByZXR1cm4gbmV3IFNvdXJjZUhhbmRsZXIoc291cmNlLCB0ZWNoKTtcbiAgICB9XG5cbiAgICAvLyBSZWdpc3RlciB0aGUgc291cmNlIGhhbmRsZXJcbiAgICB2aWRlb2pzLkh0bWw1LnJlZ2lzdGVyU291cmNlSGFuZGxlcih7XG4gICAgICAgIGNhbkhhbmRsZVNvdXJjZTogY2FuSGFuZGxlU291cmNlLFxuICAgICAgICBoYW5kbGVTb3VyY2U6IGhhbmRsZVNvdXJjZVxuICAgIH0sIDApO1xuXG59LmNhbGwodGhpcykpOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL3V0aWwuanMnKS5wYXJzZVJvb3RVcmw7XG5cbmZ1bmN0aW9uIGxvYWRNYW5pZmVzdCh1cmwsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFjdHVhbFVybCA9IHBhcnNlUm9vdFVybCh1cmwpLFxuICAgICAgICByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIG9ubG9hZDtcblxuICAgIG9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7IHJldHVybjsgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2soe21hbmlmZXN0WG1sOiByZXF1ZXN0LnJlc3BvbnNlWE1MIH0pOyB9XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vdGhpcy5kZWJ1Zy5sb2coJ1N0YXJ0IGxvYWRpbmcgbWFuaWZlc3Q6ICcgKyB1cmwpO1xuICAgICAgICByZXF1ZXN0Lm9ubG9hZCA9IG9ubG9hZDtcbiAgICAgICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgICAgICByZXF1ZXN0LnNlbmQoKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgcmVxdWVzdC5vbmVycm9yKCk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxvYWRNYW5pZmVzdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGRvd25sb2FkUmF0ZXMgPSByZXF1aXJlKCcuL2Rvd25sb2FkUmF0ZS9Eb3dubG9hZFJhdGVzLmpzJyksXG4gICAgZXZlbnRMaXN0ID0gcmVxdWlyZSgnLi9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlRXZlbnRUeXBlcy5qcycpO1xuXG5mdW5jdGlvbiBhZGRFdmVudEhhbmRsZXJUb1J1bGUoc2VsZiwgcnVsZSkge1xuICAgIHJ1bGUub24oc2VsZi5ldmVudExpc3QuRE9XTkxPQURfUkFURV9DSEFOR0VELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBzZWxmLmRldGVybWluZURvd25sb2FkUmF0ZSgpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBEb3dubG9hZFJhdGVNYW5hZ2VyKGRvd25sb2FkUmF0ZVJ1bGVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChpc0FycmF5KGRvd25sb2FkUmF0ZVJ1bGVzKSkgeyB0aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMgPSBkb3dubG9hZFJhdGVSdWxlczsgfVxuICAgIGVsc2UgaWYgKCEhZG93bmxvYWRSYXRlUnVsZXMpIHsgdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzID0gW2Rvd25sb2FkUmF0ZVJ1bGVzXTsgfVxuICAgIGVsc2UgeyB0aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMgPSBbXTsgfVxuICAgIC8vdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzID0gaXNBcnJheShkb3dubG9hZFJhdGVSdWxlcykgfHwgW107XG4gICAgdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzLmZvckVhY2goZnVuY3Rpb24ocnVsZSkge1xuICAgICAgICBhZGRFdmVudEhhbmRsZXJUb1J1bGUoc2VsZiwgcnVsZSk7XG4gICAgfSk7XG4gICAgdGhpcy5fX2xhc3REb3dubG9hZFJhdGUgPSB0aGlzLmRvd25sb2FkUmF0ZXMuRE9OVF9ET1dOTE9BRDtcbiAgICB0aGlzLmRldGVybWluZURvd25sb2FkUmF0ZSgpO1xufVxuXG5Eb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZS5ldmVudExpc3QgPSBldmVudExpc3Q7XG5cbkRvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLmRvd25sb2FkUmF0ZXMgPSBkb3dubG9hZFJhdGVzO1xuXG5Eb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZS5kZXRlcm1pbmVEb3dubG9hZFJhdGUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGN1cnJlbnREb3dubG9hZFJhdGUsXG4gICAgICAgIGZpbmFsRG93bmxvYWRSYXRlID0gZG93bmxvYWRSYXRlcy5ET05UX0RPV05MT0FEO1xuXG4gICAgLy8gVE9ETzogTWFrZSByZWxhdGlvbnNoaXAgYmV0d2VlbiBydWxlcyBzbWFydGVyIG9uY2Ugd2UgaW1wbGVtZW50IG11bHRpcGxlIHJ1bGVzLlxuICAgIHNlbGYuX19kb3dubG9hZFJhdGVSdWxlcy5mb3JFYWNoKGZ1bmN0aW9uKGRvd25sb2FkUmF0ZVJ1bGUpIHtcbiAgICAgICAgY3VycmVudERvd25sb2FkUmF0ZSA9IGRvd25sb2FkUmF0ZVJ1bGUuZ2V0RG93bmxvYWRSYXRlKCk7XG4gICAgICAgIGlmIChjdXJyZW50RG93bmxvYWRSYXRlID4gZmluYWxEb3dubG9hZFJhdGUpIHsgZmluYWxEb3dubG9hZFJhdGUgPSBjdXJyZW50RG93bmxvYWRSYXRlOyB9XG4gICAgfSk7XG5cbiAgICBpZiAoZmluYWxEb3dubG9hZFJhdGUgIT09IHNlbGYuX19sYXN0RG93bmxvYWRSYXRlKSB7XG4gICAgICAgIHNlbGYuX19sYXN0RG93bmxvYWRSYXRlID0gZmluYWxEb3dubG9hZFJhdGU7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7XG4gICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX1JBVEVfQ0hBTkdFRCxcbiAgICAgICAgICAgIHRhcmdldDpzZWxmLFxuICAgICAgICAgICAgZG93bmxvYWRSYXRlOnNlbGYuX19sYXN0RG93bmxvYWRSYXRlXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBmaW5hbERvd25sb2FkUmF0ZTtcbn07XG5cbkRvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLmFkZERvd25sb2FkUmF0ZVJ1bGUgPSBmdW5jdGlvbihkb3dubG9hZFJhdGVSdWxlKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX19kb3dubG9hZFJhdGVSdWxlcy5wdXNoKGRvd25sb2FkUmF0ZVJ1bGUpO1xuICAgIGFkZEV2ZW50SGFuZGxlclRvUnVsZShzZWxmLCBkb3dubG9hZFJhdGVSdWxlKTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KERvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gRG93bmxvYWRSYXRlTWFuYWdlcjsiLCJ2YXIgZXZlbnRMaXN0ID0ge1xuICAgIERPV05MT0FEX1JBVEVfQ0hBTkdFRDogJ2Rvd25sb2FkUmF0ZUNoYW5nZWQnXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50TGlzdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBkb3dubG9hZFJhdGVzID0ge1xuICAgIERPTlRfRE9XTkxPQUQ6IDAsXG4gICAgUExBWUJBQ0tfUkFURTogMTAwMCxcbiAgICBET1dOTE9BRF9SQVRFOiAxMDAwMFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb3dubG9hZFJhdGVzOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi8uLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBkb3dubG9hZFJhdGVzID0gcmVxdWlyZSgnLi9Eb3dubG9hZFJhdGVzLmpzJyksXG4gICAgZXZlbnRMaXN0ID0gcmVxdWlyZSgnLi9Eb3dubG9hZFJhdGVFdmVudFR5cGVzLmpzJyksXG4gICAgZG93bmxvYWRBbmRQbGF5YmFja0V2ZW50cyA9IFtcbiAgICAgICAgJ2xvYWRzdGFydCcsXG4gICAgICAgICdkdXJhdGlvbmNoYW5nZScsXG4gICAgICAgICdsb2FkZWRtZXRhZGF0YScsXG4gICAgICAgICdsb2FkZWRkYXRhJyxcbiAgICAgICAgJ3Byb2dyZXNzJyxcbiAgICAgICAgJ2NhbnBsYXknLFxuICAgICAgICAnY2FucGxheXRocm91Z2gnXG4gICAgXSxcbiAgICByZWFkeVN0YXRlcyA9IHtcbiAgICAgICAgSEFWRV9OT1RISU5HOiAwLFxuICAgICAgICBIQVZFX01FVEFEQVRBOiAxLFxuICAgICAgICBIQVZFX0NVUlJFTlRfREFUQTogMixcbiAgICAgICAgSEFWRV9GVVRVUkVfREFUQTogMyxcbiAgICAgICAgSEFWRV9FTk9VR0hfREFUQTogNFxuICAgIH07XG5cbmZ1bmN0aW9uIGdldFJlYWR5U3RhdGUodGVjaCkge1xuICAgIHJldHVybiB0ZWNoLmVsKCkucmVhZHlTdGF0ZTtcbn1cblxuZnVuY3Rpb24gVmlkZW9SZWFkeVN0YXRlUnVsZSh0ZWNoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIFRPRE86IE51bGwvdHlwZSBjaGVja1xuICAgIHRoaXMuX190ZWNoID0gdGVjaDtcbiAgICB0aGlzLl9fZG93bmxvYWRSYXRlID0gdGhpcy5kb3dubG9hZFJhdGVzLkRPTlRfRE9XTkxPQUQ7XG5cbiAgICBmdW5jdGlvbiBkZXRlcm1pbmVEb3dubG9hZFJhdGUoKSB7XG4gICAgICAgIHZhciBkb3dubG9hZFJhdGUgPSAoZ2V0UmVhZHlTdGF0ZShzZWxmLl9fdGVjaCkgPT09IHJlYWR5U3RhdGVzLkhBVkVfRU5PVUdIX0RBVEEpID9cbiAgICAgICAgICAgIHNlbGYuZG93bmxvYWRSYXRlcy5QTEFZQkFDS19SQVRFIDpcbiAgICAgICAgICAgIHNlbGYuZG93bmxvYWRSYXRlcy5ET1dOTE9BRF9SQVRFO1xuICAgICAgICByZXR1cm4gZG93bmxvYWRSYXRlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHVwZGF0ZURvd25sb2FkUmF0ZSgpIHtcbiAgICAgICAgdmFyIG5ld0Rvd25sb2FkUmF0ZSA9IGRldGVybWluZURvd25sb2FkUmF0ZSgpO1xuICAgICAgICBpZiAoc2VsZi5fX2Rvd25sb2FkUmF0ZSAhPT0gbmV3RG93bmxvYWRSYXRlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRE9XTkxPQUQgUkFURSBDSEFOR0VEIFRPOiAnICsgbmV3RG93bmxvYWRSYXRlKTtcbiAgICAgICAgICAgIHNlbGYuX19kb3dubG9hZFJhdGUgPSBuZXdEb3dubG9hZFJhdGU7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoe1xuICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfUkFURV9DSEFOR0VELFxuICAgICAgICAgICAgICAgIHRhcmdldDpzZWxmLFxuICAgICAgICAgICAgICAgIGRvd25sb2FkUmF0ZTpzZWxmLl9fZG93bmxvYWRSYXRlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGRvd25sb2FkQW5kUGxheWJhY2tFdmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudE5hbWUpIHtcbiAgICAgICAgdGVjaC5vbihldmVudE5hbWUsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdXBkYXRlRG93bmxvYWRSYXRlKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgdXBkYXRlRG93bmxvYWRSYXRlKCk7XG59XG5cblZpZGVvUmVhZHlTdGF0ZVJ1bGUucHJvdG90eXBlLmV2ZW50TGlzdCA9IGV2ZW50TGlzdDtcblxuLy8gVmFsdWUgTWVhbmluZ3M6XG4vL1xuLy8gRE9OVF9ET1dOTE9BRCAtICBTaG91bGQgbm90IGRvd25sb2FkIHNlZ21lbnRzLlxuLy8gUExBWUJBQ0tfUkFURSAtICBEb3dubG9hZCB0aGUgbmV4dCBzZWdtZW50IGF0IHRoZSByYXRlIGl0IHRha2VzIHRvIGNvbXBsZXRlIHBsYXliYWNrIG9mIHRoZSBwcmV2aW91cyBzZWdtZW50LlxuLy8gICAgICAgICAgICAgICAgICBJbiBvdGhlciB3b3Jkcywgb25jZSB0aGUgZGF0YSBmb3IgdGhlIGN1cnJlbnQgc2VnbWVudCBoYXMgYmVlbiBkb3dubG9hZGVkLFxuLy8gICAgICAgICAgICAgICAgICB3YWl0IHVudGlsIHNlZ21lbnQuZ2V0RHVyYXRpb24oKSBzZWNvbmRzIG9mIHN0cmVhbSBwbGF5YmFjayBoYXZlIGVsYXBzZWQgYmVmb3JlIHN0YXJ0aW5nIHRoZVxuLy8gICAgICAgICAgICAgICAgICBkb3dubG9hZCBvZiB0aGUgbmV4dCBzZWdtZW50LlxuLy8gRE9XTkxPQURfUkFURSAtICBEb3dubG9hZCB0aGUgbmV4dCBzZWdtZW50IG9uY2UgdGhlIHByZXZpb3VzIHNlZ21lbnQgaGFzIGZpbmlzaGVkIGRvd25sb2FkaW5nLlxuVmlkZW9SZWFkeVN0YXRlUnVsZS5wcm90b3R5cGUuZG93bmxvYWRSYXRlcyA9IGRvd25sb2FkUmF0ZXM7XG5cblZpZGVvUmVhZHlTdGF0ZVJ1bGUucHJvdG90eXBlLmdldERvd25sb2FkUmF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fZG93bmxvYWRSYXRlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoVmlkZW9SZWFkeVN0YXRlUnVsZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWRlb1JlYWR5U3RhdGVSdWxlOyIsIlxudmFyIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uID0gcmVxdWlyZSgnLi4vZGFzaC9zZWdtZW50cy9nZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uLmpzJyksXG4gICAgbG9hZFNlZ21lbnQsXG4gICAgREVGQVVMVF9SRVRSWV9DT1VOVCA9IDMsXG4gICAgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCA9IDI1MDtcblxubG9hZFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50LCByZXRyeUludGVydmFsKSB7XG4gICAgdmFyIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICByZXF1ZXN0Lm9wZW4oJ0dFVCcsIHNlZ21lbnQuZ2V0VXJsKCksIHRydWUpO1xuICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcblxuICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vY29uc29sZS5sb2coJ0xvYWRlZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50KHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgICAgICB9LCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrRm4gPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2tGbihyZXF1ZXN0LnJlc3BvbnNlKTsgfVxuICAgIH07XG4gICAgLy9yZXF1ZXN0Lm9uZXJyb3IgPSByZXF1ZXN0Lm9ubG9hZGVuZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQoc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIHJlcXVlc3Quc2VuZCgpO1xufTtcblxuZnVuY3Rpb24gU2VnbWVudExvYWRlcihhZGFwdGF0aW9uU2V0LCAvKiBvcHRpb25hbCAqLyBjdXJyZW50U2VnbWVudE51bWJlcikge1xuICAgIC8vdGhpcy5fX2V2ZW50RGlzcGF0Y2hlckRlbGVnYXRlID0gbmV3IEV2ZW50RGlzcGF0Y2hlckRlbGVnYXRlKHRoaXMpO1xuICAgIHRoaXMuX19hZGFwdGF0aW9uU2V0ID0gYWRhcHRhdGlvblNldDtcbiAgICAvLyBJbml0aWFsaXplIHRvIDB0aCByZXByZXNlbnRhdGlvbi5cbiAgICB0aGlzLl9fY3VycmVudFJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXTtcbiAgICB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBjdXJyZW50U2VnbWVudE51bWJlcjtcbn1cblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIElOSVRJQUxJWkFUSU9OX0xPQURFRDogJ2luaXRpYWxpemF0aW9uTG9hZGVkJyxcbiAgICBTRUdNRU5UX0xPQURFRDogJ3NlZ21lbnRMb2FkZWQnXG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50UmVwcmVzZW50YXRpb24gPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb247IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLnNldEN1cnJlbnRSZXByZXNlbnRhdGlvbiA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7IHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24gPSByZXByZXNlbnRhdGlvbjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24pO1xuICAgIHZhciBzZWdtZW50ID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudEJ5TnVtYmVyKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5zZXRDdXJyZW50UmVwcmVzZW50YXRpb25CeUluZGV4ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCk7XG4gICAgaWYgKGluZGV4IDwgMCB8fCBpbmRleCA+PSByZXByZXNlbnRhdGlvbnMubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignaW5kZXggb3V0IG9mIGJvdW5kcycpO1xuICAgIH1cbiAgICB0aGlzLl9fY3VycmVudFJlcHJlc2VudGF0aW9uID0gcmVwcmVzZW50YXRpb25zW2luZGV4XTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TnVtYmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXI7IH07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldFN0YXJ0U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24pLmdldFN0YXJ0TnVtYmVyKCk7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRFbmRTZWdtZW50TnVtYmVyID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24odGhpcy5fX2N1cnJlbnRSZXByZXNlbnRhdGlvbikuZ2V0RW5kTnVtYmVyKCk7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkSW5pdGlhbGl6YXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbih0aGlzLl9fY3VycmVudFJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgaW5pdGlhbGl6YXRpb24gPSBzZWdtZW50TGlzdC5nZXRJbml0aWFsaXphdGlvbigpO1xuXG4gICAgaWYgKCFpbml0aWFsaXphdGlvbikgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgaW5pdGlhbGl6YXRpb24sIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciBpbml0U2VnbWVudCA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIFRPRE86IERldGVybWluZSBob3cgdG8gcGFyYW1ldGVyaXplIGJ5IHJlcHJlc2VudGF0aW9uIHZhcmlhbnRzIChiYW5kd2lkdGgvYml0cmF0ZT8gcmVwcmVzZW50YXRpb24gb2JqZWN0PyBpbmRleD8pXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkTmV4dFNlZ21lbnQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9DdXJyZW50U2VnbWVudE51bWJlciA9ICgodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID09PSBudWxsKSB8fCAodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID09PSB1bmRlZmluZWQpKSxcbiAgICAgICAgbnVtYmVyID0gbm9DdXJyZW50U2VnbWVudE51bWJlciA/IDAgOiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgKyAxO1xuICAgIHJldHVybiB0aGlzLmxvYWRTZWdtZW50QXROdW1iZXIobnVtYmVyKTtcbn07XG5cbi8vIFRPRE86IER1cGxpY2F0ZSBjb2RlIGJlbG93LiBBYnN0cmFjdCBhd2F5LlxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdE51bWJlciA9IGZ1bmN0aW9uKG51bWJlcikge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHRoaXMuX19jdXJyZW50UmVwcmVzZW50YXRpb24pO1xuXG4gICAgaWYgKG51bWJlciA+IHNlZ21lbnRMaXN0LmdldEVuZE51bWJlcigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlOdW1iZXIobnVtYmVyKTtcblxuICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgc2VnbWVudCwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgc2VsZi5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID0gc2VnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTppbml0U2VnbWVudH0pO1xuICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbih0aGlzLl9fY3VycmVudFJlcHJlc2VudGF0aW9uKTtcblxuICAgIGlmIChwcmVzZW50YXRpb25UaW1lID4gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKHByZXNlbnRhdGlvblRpbWUpO1xuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSwgREVGQVVMVF9SRVRSWV9DT1VOVCwgREVGQVVMVF9SRVRSWV9JTlRFUlZBTCk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNlZ21lbnRMb2FkZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyk7XG5cbi8vIFRPRE86IFRoaXMgbG9naWMgc2hvdWxkIGJlIGluIG1zZS5qc1xuZnVuY3Rpb24gYXBwZW5kQnl0ZXMoYnVmZmVyLCBieXRlcykge1xuICAgIGlmICgnYXBwZW5kJyBpbiBidWZmZXIpIHtcbiAgICAgICAgYnVmZmVyLmFwcGVuZChieXRlcyk7XG4gICAgfSBlbHNlIGlmICgnYXBwZW5kQnVmZmVyJyBpbiBidWZmZXIpIHtcbiAgICAgICAgYnVmZmVyLmFwcGVuZEJ1ZmZlcihieXRlcyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgdHlwZT9cbiAgICBpZiAoIXNvdXJjZUJ1ZmZlcikgeyB0aHJvdyBuZXcgRXJyb3IoICdUaGUgc291cmNlQnVmZmVyIGNvbnN0cnVjdG9yIGFyZ3VtZW50IGNhbm5vdCBiZSBudWxsLicgKTsgfVxuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBkYXRhUXVldWUgPSBbXTtcbiAgICAvLyBUT0RPOiBmaWd1cmUgb3V0IGhvdyB3ZSB3YW50IHRvIHJlc3BvbmQgdG8gb3RoZXIgZXZlbnQgc3RhdGVzICh1cGRhdGVlbmQ/IGVycm9yPyBhYm9ydD8pIChyZXRyeT8gcmVtb3ZlPylcbiAgICBzb3VyY2VCdWZmZXIuYWRkRXZlbnRMaXN0ZW5lcigndXBkYXRlZW5kJywgZnVuY3Rpb24oZSkge1xuICAgICAgICAvLyBUaGUgU291cmNlQnVmZmVyIGluc3RhbmNlJ3MgdXBkYXRpbmcgcHJvcGVydHkgc2hvdWxkIGFsd2F5cyBiZSBmYWxzZSBpZiB0aGlzIGV2ZW50IHdhcyBkaXNwYXRjaGVkLFxuICAgICAgICAvLyBidXQganVzdCBpbiBjYXNlLi4uXG4gICAgICAgIGlmIChlLnRhcmdldC51cGRhdGluZykgeyByZXR1cm47IH1cblxuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfQURERURfVE9fQlVGRkVSLCB0YXJnZXQ6c2VsZiB9KTtcblxuICAgICAgICBpZiAoZGF0YVF1ZXVlLmxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCB0YXJnZXQ6c2VsZiB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGFwcGVuZEJ5dGVzKGUudGFyZ2V0LCBkYXRhUXVldWUuc2hpZnQoKSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gZGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXIgPSBzb3VyY2VCdWZmZXI7XG59XG5cbi8vIFRPRE86IEFkZCBhcyBcImNsYXNzXCIgcHJvcGVydGllcz9cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFFVRVVFX0VNUFRZOiAncXVldWVFbXB0eScsXG4gICAgU0VHTUVOVF9BRERFRF9UT19CVUZGRVI6ICdzZWdtZW50QWRkZWRUb0J1ZmZlcidcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuYWRkVG9RdWV1ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAvLyBUT0RPOiBDaGVjayBmb3IgZXhpc3RlbmNlL3R5cGU/IENvbnZlcnQgdG8gVWludDhBcnJheSBleHRlcm5hbGx5IG9yIGludGVybmFsbHk/IChDdXJyZW50bHkgYXNzdW1pbmcgZXh0ZXJuYWwpXG4gICAgLy8gSWYgbm90aGluZyBpcyBpbiB0aGUgcXVldWUsIGdvIGFoZWFkIGFuZCBpbW1lZGlhdGVseSBhcHBlbmQgdGhlIHNlZ21lbnQgZGF0YSB0byB0aGUgc291cmNlIGJ1ZmZlci5cbiAgICBpZiAoKHRoaXMuX19kYXRhUXVldWUubGVuZ3RoID09PSAwKSAmJiAoIXRoaXMuX19zb3VyY2VCdWZmZXIudXBkYXRpbmcpKSB7IGFwcGVuZEJ5dGVzKHRoaXMuX19zb3VyY2VCdWZmZXIsIGRhdGEpOyB9XG4gICAgLy8gT3RoZXJ3aXNlLCBwdXNoIG9udG8gcXVldWUgYW5kIHdhaXQgZm9yIHRoZSBuZXh0IHVwZGF0ZSBldmVudCBiZWZvcmUgYXBwZW5kaW5nIHNlZ21lbnQgZGF0YSB0byBzb3VyY2UgYnVmZmVyLlxuICAgIGVsc2UgeyB0aGlzLl9fZGF0YVF1ZXVlLnB1c2goZGF0YSk7IH1cbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuY2xlYXJRdWV1ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX19kYXRhUXVldWUgPSBbXTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VCdWZmZXJEYXRhUXVldWU7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBFeHRlbmQgYSBnaXZlbiBvYmplY3Qgd2l0aCBhbGwgdGhlIHByb3BlcnRpZXMgaW4gcGFzc2VkLWluIG9iamVjdChzKS5cbnZhciBleHRlbmRPYmplY3QgPSBmdW5jdGlvbihvYmogLyosIGV4dGVuZE9iamVjdDEsIGV4dGVuZE9iamVjdDIsIC4uLiwgZXh0ZW5kT2JqZWN0TiAqLykge1xuICAgIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSkuZm9yRWFjaChmdW5jdGlvbihleHRlbmRPYmplY3QpIHtcbiAgICAgICAgaWYgKGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgICAgICBvYmpbcHJvcF0gPSBleHRlbmRPYmplY3RbcHJvcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gb2JqO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRPYmplY3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzQXJyYXkob2JqKSB7XG4gICAgcmV0dXJuIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIE5PVEU6IFRBS0VOIEZST00gTE9EQVNIIFRPIFJFTU9WRSBERVBFTkRFTkNZXG4vKiogYE9iamVjdCN0b1N0cmluZ2AgcmVzdWx0IHNob3J0Y3V0cyAqL1xudmFyIGZ1bmNDbGFzcyA9ICdbb2JqZWN0IEZ1bmN0aW9uXScsXG4gICAgc3RyaW5nQ2xhc3MgPSAnW29iamVjdCBTdHJpbmddJztcblxuLyoqIFVzZWQgdG8gcmVzb2x2ZSB0aGUgaW50ZXJuYWwgW1tDbGFzc11dIG9mIHZhbHVlcyAqL1xudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxudmFyIGlzRnVuY3Rpb24gPSBmdW5jdGlvbiBpc0Z1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcbn07XG4vLyBmYWxsYmFjayBmb3Igb2xkZXIgdmVyc2lvbnMgb2YgQ2hyb21lIGFuZCBTYWZhcmlcbmlmIChpc0Z1bmN0aW9uKC94LykpIHtcbiAgICBpc0Z1bmN0aW9uID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiB0b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gZnVuY0NsYXNzO1xuICAgIH07XG59XG5cbnZhciBpc1N0cmluZyA9IGZ1bmN0aW9uIGlzU3RyaW5nKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gc3RyaW5nQ2xhc3MgfHwgZmFsc2U7XG59O1xuXG4vLyBOT1RFOiBFTkQgT0YgTE9EQVNILUJBU0VEIENPREVcblxuLy8gR2VuZXJhbCBVdGlsaXR5IEZ1bmN0aW9uc1xuZnVuY3Rpb24gZXhpc3R5KHgpIHsgcmV0dXJuIHggIT09IG51bGw7IH1cblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbmZ1bmN0aW9uIHByZUFwcGx5QXJnc0ZuKGZ1biAvKiwgYXJncyAqLykge1xuICAgIHZhciBwcmVBcHBsaWVkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkgeyByZXR1cm4gZnVuLmFwcGx5KG51bGwsIHByZUFwcGxpZWRBcmdzKTsgfTtcbn1cblxuLy8gSGlnaGVyLW9yZGVyIFhNTCBmdW5jdGlvbnNcblxuLy8gVGFrZXMgZnVuY3Rpb24ocykgYXMgYXJndW1lbnRzXG52YXIgZ2V0QW5jZXN0b3JzID0gZnVuY3Rpb24oZWxlbSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICB2YXIgYW5jZXN0b3JzID0gW107XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICAoZnVuY3Rpb24gZ2V0QW5jZXN0b3JzUmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtLCBhbmNlc3RvcnMpKSB7IHJldHVybjsgfVxuICAgICAgICBpZiAoZXhpc3R5KGVsZW0pICYmIGV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7XG4gICAgICAgICAgICBhbmNlc3RvcnMucHVzaChlbGVtLnBhcmVudE5vZGUpO1xuICAgICAgICAgICAgZ2V0QW5jZXN0b3JzUmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9KShlbGVtKTtcbiAgICByZXR1cm4gYW5jZXN0b3JzO1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldE5vZGVMaXN0QnlOYW1lID0gZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiBmdW5jdGlvbih4bWxPYmopIHtcbiAgICAgICAgcmV0dXJuIHhtbE9iai5nZXRFbGVtZW50c0J5VGFnTmFtZShuYW1lKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGhhc01hdGNoaW5nQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKCh0eXBlb2YgYXR0ck5hbWUgIT09ICdzdHJpbmcnKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiBmYWxzZTsgfVxuICAgICAgICBpZiAoIWV4aXN0eSh2YWx1ZSkpIHsgcmV0dXJuIGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICByZXR1cm4gKGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKSA9PT0gdmFsdWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0QXR0ckZuID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoIWlzU3RyaW5nKGF0dHJOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWlzRnVuY3Rpb24oZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxuLy8gVE9ETzogQWRkIHNob3VsZFN0b3BQcmVkIChzaG91bGQgZnVuY3Rpb24gc2ltaWxhcmx5IHRvIHNob3VsZFN0b3BQcmVkIGluIGdldEluaGVyaXRhYmxlRWxlbWVudCwgYmVsb3cpXG52YXIgZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICgoIWlzU3RyaW5nKGF0dHJOYW1lKSkgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpKSB7IHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxuLy8gVGFrZXMgZnVuY3Rpb24ocykgYXMgYXJndW1lbnRzOyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0SW5oZXJpdGFibGVFbGVtZW50ID0gZnVuY3Rpb24obm9kZU5hbWUsIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0pKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgdmFyIG1hdGNoaW5nRWxlbUxpc3QgPSBlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5vZGVOYW1lKTtcbiAgICAgICAgaWYgKGV4aXN0eShtYXRjaGluZ0VsZW1MaXN0KSAmJiBtYXRjaGluZ0VsZW1MaXN0Lmxlbmd0aCA+IDApIHsgcmV0dXJuIG1hdGNoaW5nRWxlbUxpc3RbMF07IH1cbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRPRE86IEltcGxlbWVudCBtZSBmb3IgQmFzZVVSTCBvciB1c2UgZXhpc3RpbmcgZm4gKFNlZTogbXBkLmpzIGJ1aWxkQmFzZVVybCgpKVxuLyp2YXIgYnVpbGRIaWVyYXJjaGljYWxseVN0cnVjdHVyZWRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlRm4sIGJ1aWxkRm4sIHN0b3BQcmVkKSB7XG5cbn07Ki9cblxuLy8gUHVibGlzaCBFeHRlcm5hbCBBUEk6XG52YXIgeG1sZnVuID0ge307XG54bWxmdW4uZXhpc3R5ID0gZXhpc3R5O1xueG1sZnVuLnRydXRoeSA9IHRydXRoeTtcblxueG1sZnVuLmdldE5vZGVMaXN0QnlOYW1lID0gZ2V0Tm9kZUxpc3RCeU5hbWU7XG54bWxmdW4uaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBoYXNNYXRjaGluZ0F0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGdldEluaGVyaXRhYmxlQXR0cmlidXRlO1xueG1sZnVuLmdldEFuY2VzdG9ycyA9IGdldEFuY2VzdG9ycztcbnhtbGZ1bi5nZXRBdHRyRm4gPSBnZXRBdHRyRm47XG54bWxmdW4ucHJlQXBwbHlBcmdzRm4gPSBwcmVBcHBseUFyZ3NGbjtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBnZXRJbmhlcml0YWJsZUVsZW1lbnQ7XG5cbm1vZHVsZS5leHBvcnRzID0geG1sZnVuOyJdfQ==
