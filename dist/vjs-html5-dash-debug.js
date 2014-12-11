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

var existy = require('./util/existy.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js'),
    DownloadRateManager = require('./rules/DownloadRateManager.js'),
    VideoReadyStateRule = require('./rules/downloadRate/VideoReadyStateRule.js'),
    StreamLoader = require('./StreamLoader.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    mediaTypes = require('./manifest/MediaTypes.js');

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
    segmentLoader.on(segmentLoader.eventList.SEGMENT_LOADED, function segmentLoadedHandler(event) {
        sourceBufferDataQueue.one(sourceBufferDataQueue.eventList.QUEUE_EMPTY, function(event) {
            var loading = segmentLoader.loadNextSegment();
            if (!loading) {
                segmentLoader.off(segmentLoader.eventList.SEGMENT_LOADED, segmentLoadedHandler);
            }
        });
        sourceBufferDataQueue.addToQueue(event.data);
    });

    segmentLoader.loadNextSegment();
}

function createSourceBufferDataQueueByType(manifest, mediaSource, mediaType) {
    var sourceBufferType = manifest.getMediaSetByType(mediaType).getSourceBufferType(),
        // TODO: Try/catch block?
        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferType);
    return new SourceBufferDataQueue(sourceBuffer);
}

function createStreamLoaderForType(manifest, mediaSource, mediaType) {
    var segmentLoader = new SegmentLoader(manifest, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifest, mediaSource, mediaType);
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType);
}

function createStreamLoaders(manifest, mediaSource) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifest.getMediaSetByType(mediaType));
            return existy; }),
        streamLoaders = matchedTypes.map(function(mediaType) { return createStreamLoaderForType(manifest, mediaSource, mediaType); });
    return streamLoaders;
}

function PlaylistLoader(manifest, mediaSource, tech) {
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifest, mediaSource);
    this.__streamLoaders.forEach(function(streamLoader) {
        loadInitialization(streamLoader.getSegmentLoader(), streamLoader.getSourceBufferDataQueue());
    });
}

module.exports = PlaylistLoader;
},{"./StreamLoader.js":6,"./dash/mpd/getMpd.js":7,"./manifest/MediaTypes.js":15,"./rules/DownloadRateManager.js":17,"./rules/downloadRate/VideoReadyStateRule.js":20,"./segments/SegmentLoader.js":21,"./sourceBuffer/SourceBufferDataQueue.js":22,"./util/existy.js":23}],5:[function(require,module,exports){
'use strict';

var MediaSource = require('./window.js').MediaSource,
    //loadManifest = require('./manifest/loadManifest.js'),
    Manifest = require('./manifest/Manifest.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

function SourceHandler(source, tech) {
    var self = this,
        manifestProvider = new Manifest(source.src, false);
    manifestProvider.load(function(manifest) {
        var mediaSource = new MediaSource(),
            openListener = function(event) {
                mediaSource.removeEventListener('sourceopen', openListener, false);
                self.__playlistLoader = new PlaylistLoader(manifestProvider, mediaSource, tech);
            };

        mediaSource.addEventListener('sourceopen', openListener, false);

        // TODO: Handle close.
        //mediaSource.addEventListener('webkitsourceclose', closed, false);
        //mediaSource.addEventListener('sourceclose', closed, false);

        tech.setSrc(URL.createObjectURL(mediaSource));
    });
}

module.exports = SourceHandler;
},{"./PlaylistLoader.js":4,"./manifest/Manifest.js":14,"./window.js":30}],6:[function(require,module,exports){
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
},{"../../xmlfun.js":31,"./util.js":8}],8:[function(require,module,exports){
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

},{"../../xmlfun.js":31,"../mpd/util.js":8,"./segmentTemplate":10}],10:[function(require,module,exports){
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
},{"../window.js":30}],13:[function(require,module,exports){
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
},{"./SourceHandler":5,"./window":30,"mse.js/src/js/mse.js":2}],14:[function(require,module,exports){
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
        fragmentList = getSegmentListForRepresentation(representation),
        totalDuration = fragmentList.getTotalDuration();
    return totalDuration;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getTotalFragmentCount = function getTotalSegmentCount() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        fragmentList = getSegmentListForRepresentation(representation),
        totalFragmentCount = fragmentList.getTotalSegmentCount();
    return totalFragmentCount;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case in actual practice, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getFragmentDuration = function getFragmentDuration() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        fragmentList = getSegmentListForRepresentation(representation),
        fragmentDuration = fragmentList.getSegmentDuration();
    return fragmentDuration;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case in actual practice, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getFragmentListStartNumber = function getFragmentListStartNumber() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        fragmentList = getSegmentListForRepresentation(representation),
        fragmentListStartNumber = fragmentList.getStartNumber();
    return fragmentListStartNumber;
};

// NOTE: Currently assuming these values will be consistent across all representations. While this is *usually*
// the case in actual practice, the spec *does* allow segments to not align across representations.
// See, for example: @segmentAlignment AdaptationSet attribute, ISO IEC 23009-1 Sec. 5.3.3.2, pp 24-5.
MediaSet.prototype.getFragmentListEndNumber = function getFragmentListEndNumber() {
    var representation = this.__adaptationSet.getRepresentations()[0],
        fragmentList = getSegmentListForRepresentation(representation),
        fragmentListEndNumber = fragmentList.getEndNumber();
    return fragmentListEndNumber;
};

// TODO: Determine whether or not to refactor of segmentList implementation and/or naming conventions
MediaSet.prototype.getFragmentLists = function getFragmentLists() {
    var representations = this.__adaptationSet.getRepresentations(),
        fragmentLists = representations.map(getSegmentListForRepresentation);
    return fragmentLists;
};

MediaSet.prototype.getFragmentListByBandwidth = function getFragmentListByBandwidth(bandwidth) {
    var representations = this.__adaptationSet.getRepresentations(),
        representationWithBandwidthMatch = representations.find(function(representation) {
            var representationBandwidth = representation.getBandwidth();
            return (Number(representationBandwidth) === Number(bandwidth));
        }),
        fragmentList = getSegmentListForRepresentation(representationWithBandwidthMatch);
    return fragmentList;
};

MediaSet.prototype.getAvailableBandwidths = function getAvailableBandwidths() {
    return this.__adaptationSet.getRepresentations().map(
        function(representation) {
            return representation.getBandwidth();
    }).filter(
        function(bandwidth) {
            return existy(bandwidth);
        }
    );
};

module.exports = Manifest;
},{"../dash/mpd/getMpd.js":7,"../dash/segments/getSegmentListForRepresentation.js":9,"../events/EventDispatcherMixin.js":11,"../util/existy.js":23,"../util/extendObject.js":24,"../util/isFunction.js":26,"../util/isString.js":28,"../util/truthy.js":29,"./MediaTypes.js":15,"./loadManifest.js":16}],15:[function(require,module,exports){
module.exports = ['video', 'audio'];
},{}],16:[function(require,module,exports){
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
},{"../dash/mpd/util.js":8}],17:[function(require,module,exports){
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
},{"../events/EventDispatcherMixin.js":11,"../util/extendObject.js":24,"../util/isArray.js":25,"./downloadRate/DownloadRateEventTypes.js":18,"./downloadRate/DownloadRates.js":19}],18:[function(require,module,exports){
var eventList = {
    DOWNLOAD_RATE_CHANGED: 'downloadRateChanged'
};

module.exports = eventList;
},{}],19:[function(require,module,exports){
'use strict';

var downloadRates = {
    DONT_DOWNLOAD: 0,
    PLAYBACK_RATE: 1000,
    DOWNLOAD_RATE: 10000
};

module.exports = downloadRates;
},{}],20:[function(require,module,exports){
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
},{"../../events/EventDispatcherMixin.js":11,"../../util/extendObject.js":24,"./DownloadRateEventTypes.js":18,"./DownloadRates.js":19}],21:[function(require,module,exports){

var existy = require('../util/existy.js'),
    isNumber = require('../util/isNumber.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    loadSegment,
    DEFAULT_RETRY_COUNT = 3,
    DEFAULT_RETRY_INTERVAL = 250;

loadSegment = function(segment, callbackFn, retryCount, retryInterval) {
    var request = new XMLHttpRequest(),
        url = segment.getUrl();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';

    request.onload = function() {
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

function SegmentLoader(manifest, mediaType) {
    if (!existy(manifest)) { throw new Error('SegmentLoader must be initialized with a manifest!'); }
    if (!existy(mediaType)) { throw new Error('SegmentLoader must be initialized with a mediaType!'); }
    this.__manifest = manifest;
    this.__mediaType = mediaType;
    this.__currentBandwidth = this.getCurrentBandwidth();
    this.__currentFragmentNumber = this.getStartNumber();
}

SegmentLoader.prototype.eventList = {
    INITIALIZATION_LOADED: 'initializationLoaded',
    SEGMENT_LOADED: 'segmentLoaded'
};

SegmentLoader.prototype.__getMediaSet = function getMediaSet() {
    var mediaSet = this.__manifest.getMediaSetByType(this.__mediaType);
    return mediaSet;
};

SegmentLoader.prototype.__getDefaultFragmentList = function getDefaultFragmentList() {
    var fragmentList = this.__getMediaSet().getFragmentLists()[0];
    return fragmentList;
};

SegmentLoader.prototype.getCurrentBandwidth = function getCurrentBandwidth() {
    if (!isNumber(this.__currentBandwidth)) { this.__currentBandwidth = this.__getDefaultFragmentList().getBandwidth(); }
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
    this.__currentBandwidth = bandwidth;
};

SegmentLoader.prototype.getCurrentFragmentList = function getCurrentFragmentList() {
    var fragmentList =  this.__getMediaSet().getFragmentListByBandwidth(this.getCurrentBandwidth());
    return fragmentList;
};

SegmentLoader.prototype.getAvailableBandwidths = function() {
    var availableBandwidths = this.__getMediaSet().getAvailableBandwidths();
    return availableBandwidths;
};

SegmentLoader.prototype.getStartNumber = function getStartNumber() {
    var startNumber = this.__getMediaSet().getFragmentListStartNumber();
    return startNumber;
};

SegmentLoader.prototype.getCurrentFragment = function() {
    var fragment = this.getCurrentFragmentList().getSegmentByNumber(this.__currentFragmentNumber);
    return fragment;
};

SegmentLoader.prototype.getCurrentFragmentNumber = function() { return this.__currentFragmentNumber; };

SegmentLoader.prototype.getEndNumber = function() {
    var endNumber = this.__getMediaSet().getFragmentListEndNumber();
    return endNumber;
};

SegmentLoader.prototype.loadInitialization = function() {
    var self = this,
        fragmentList = this.getCurrentFragmentList(),
        initialization = fragmentList.getInitialization();

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
    var self = this;

    if (number > this.getEndNumber()) { return false; }

    var fragment = this.getCurrentFragmentList().getSegmentByNumber(number);

    loadSegment.call(this, fragment, function(response) {
        self.__currentSegmentNumber = fragment.getNumber();
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:initSegment });
    }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);

    return true;
};

SegmentLoader.prototype.loadSegmentAtTime = function(presentationTime) {
    var self = this,
        fragmentList = this.getCurrentFragmentList();

    if (presentationTime > fragmentList.getTotalDuration()) { return false; }

    var fragment = this.getCurrentFragmentList().getSegmentByTime(presentationTime);

    loadSegment.call(this, fragment, function(response) {
        self.__currentSegmentNumber = fragment.getNumber();
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:initSegment});
    }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);

    return true;
};

// Add event dispatcher functionality to prototype.
extendObject(SegmentLoader.prototype, EventDispatcherMixin);

module.exports = SegmentLoader;
},{"../events/EventDispatcherMixin.js":11,"../util/existy.js":23,"../util/extendObject.js":24,"../util/isNumber.js":27}],22:[function(require,module,exports){
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
},{"../events/EventDispatcherMixin.js":11,"../util/extendObject.js":24}],23:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],24:[function(require,module,exports){
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
},{}],25:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],26:[function(require,module,exports){
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
},{}],27:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isNumber(value) {
    return typeof value === 'number' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object Number]' || false;
}

module.exports = isNumber;
},{}],28:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object String]' || false;
};

module.exports = isString;
},{}],29:[function(require,module,exports){
'use strict';

var existy = require('./existy.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

module.exports = truthy;
},{"./existy.js":23}],30:[function(require,module,exports){
module.exports=require(3)
},{"/Users/cpillsbury/dev/JavaScript/VideoJSHtml5DashWorkspace/vjs-html5-dash/node_modules/mse.js/src/js/window.js":3}],31:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvbXNlLmpzL3NyYy9qcy9NZWRpYVNvdXJjZS5qcyIsIm5vZGVfbW9kdWxlcy9tc2UuanMvc3JjL2pzL21zZS5qcyIsIm5vZGVfbW9kdWxlcy9tc2UuanMvc3JjL2pzL3dpbmRvdy5qcyIsInNyYy9qcy9QbGF5bGlzdExvYWRlci5qcyIsInNyYy9qcy9Tb3VyY2VIYW5kbGVyLmpzIiwic3JjL2pzL1N0cmVhbUxvYWRlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdC5qcyIsInNyYy9qcy9tYW5pZmVzdC9NZWRpYVR5cGVzLmpzIiwic3JjL2pzL21hbmlmZXN0L2xvYWRNYW5pZmVzdC5qcyIsInNyYy9qcy9ydWxlcy9Eb3dubG9hZFJhdGVNYW5hZ2VyLmpzIiwic3JjL2pzL3J1bGVzL2Rvd25sb2FkUmF0ZS9Eb3dubG9hZFJhdGVFdmVudFR5cGVzLmpzIiwic3JjL2pzL3J1bGVzL2Rvd25sb2FkUmF0ZS9Eb3dubG9hZFJhdGVzLmpzIiwic3JjL2pzL3J1bGVzL2Rvd25sb2FkUmF0ZS9WaWRlb1JlYWR5U3RhdGVSdWxlLmpzIiwic3JjL2pzL3NlZ21lbnRzL1NlZ21lbnRMb2FkZXIuanMiLCJzcmMvanMvc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcyIsInNyYy9qcy91dGlsL2V4aXN0eS5qcyIsInNyYy9qcy91dGlsL2V4dGVuZE9iamVjdC5qcyIsInNyYy9qcy91dGlsL2lzQXJyYXkuanMiLCJzcmMvanMvdXRpbC9pc0Z1bmN0aW9uLmpzIiwic3JjL2pzL3V0aWwvaXNOdW1iZXIuanMiLCJzcmMvanMvdXRpbC9pc1N0cmluZy5qcyIsInNyYy9qcy91dGlsL3RydXRoeS5qcyIsInNyYy9qcy94bWxmdW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25OQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoUEE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcm9vdCA9IHJlcXVpcmUoJy4vd2luZG93LmpzJyksXG5cbiAgICBtZWRpYVNvdXJjZUNsYXNzTmFtZSA9ICdNZWRpYVNvdXJjZScsXG4gICAgd2ViS2l0TWVkaWFTb3VyY2VDbGFzc05hbWUgPSAnV2ViS2l0TWVkaWFTb3VyY2UnLFxuICAgIG1lZGlhU291cmNlRXZlbnRzID0gWydzb3VyY2VvcGVuJywgJ3NvdXJjZWNsb3NlJywgJ3NvdXJjZWVuZGVkJ10sXG4gICAgLy8gVE9ETzogVGVzdCB0byB2ZXJpZnkgdGhhdCB3ZWJraXQgcHJlZml4ZXMgdGhlICdzb3VyY2VlbmRlZCcgZXZlbnQgdHlwZS5cbiAgICB3ZWJLaXRNZWRpYVNvdXJjZUV2ZW50cyA9IFsnd2Via2l0c291cmNlb3BlbicsICd3ZWJraXRzb3VyY2VjbG9zZScsICd3ZWJraXRzb3VyY2VlbmRlZCddO1xuXG5mdW5jdGlvbiBoYXNDbGFzc1JlZmVyZW5jZShvYmplY3QsIGNsYXNzTmFtZSkge1xuICAgIHJldHVybiAoKGNsYXNzTmFtZSBpbiBvYmplY3QpICYmICh0eXBlb2Ygb2JqZWN0W2NsYXNzTmFtZV0gPT09ICdmdW5jdGlvbicpKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlRXZlbnRzTWFwKGtleXNBcnJheSwgdmFsdWVzQXJyYXkpIHtcbiAgICBpZiAoIWtleXNBcnJheSB8fCAhdmFsdWVzQXJyYXkgfHwga2V5c0FycmF5Lmxlbmd0aCAhPT0gdmFsdWVzQXJyYXkubGVuZ3RoKSB7IHJldHVybiBudWxsOyB9XG4gICAgdmFyIG1hcCA9IHt9O1xuICAgIGZvciAodmFyIGk9MDsgaTxrZXlzQXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgbWFwW2tleXNBcnJheVtpXV0gPSB2YWx1ZXNBcnJheVtpXTtcbiAgICB9XG5cbiAgICByZXR1cm4gbWFwO1xufVxuXG5mdW5jdGlvbiBvdmVycmlkZUV2ZW50Rm4oY2xhc3NSZWYsIGV2ZW50Rm5OYW1lLCBldmVudHNNYXApIHtcbiAgICB2YXIgb3JpZ2luYWxGbiA9IGNsYXNzUmVmLnByb3RvdHlwZVtldmVudEZuTmFtZV07XG4gICAgY2xhc3NSZWYucHJvdG90eXBlW2V2ZW50Rm5OYW1lXSA9IGZ1bmN0aW9uKHR5cGUgLyosIGNhbGxiYWNrLCB1c2VDYXB0dXJlICovKSB7XG4gICAgICAgIG9yaWdpbmFsRm4uYXBwbHkodGhpcywgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSk7XG4gICAgICAgIGlmICghKHR5cGUgaW4gZXZlbnRzTWFwKSkgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHJlc3RBcmdzQXJyYXkgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICAgICAgbmV3QXJnc0FycmF5ID0gW2V2ZW50c01hcFt0eXBlXV0uY29uY2F0KHJlc3RBcmdzQXJyYXkpO1xuICAgICAgICBvcmlnaW5hbEZuLmFwcGx5KHRoaXMsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKG5ld0FyZ3NBcnJheSkpO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGdldE1lZGlhU291cmNlQ2xhc3Mocm9vdCkge1xuICAgIC8vIElmIHRoZSByb290ICh3aW5kb3cpIGhhcyBNZWRpYVNvdXJjZSwgbm90aGluZyB0byBkbyBzbyBzaW1wbHkgcmV0dXJuIHRoZSByZWYuXG4gICAgaWYgKGhhc0NsYXNzUmVmZXJlbmNlKHJvb3QsIG1lZGlhU291cmNlQ2xhc3NOYW1lKSkgeyByZXR1cm4gcm9vdFttZWRpYVNvdXJjZUNsYXNzTmFtZV07IH1cbiAgICAvLyBJZiB0aGUgcm9vdCAod2luZG93KSBoYXMgV2ViS2l0TWVkaWFTb3VyY2UsIG92ZXJyaWRlIGl0cyBhZGQvcmVtb3ZlIGV2ZW50IGZ1bmN0aW9ucyB0byBtZWV0IHRoZSBXM0NcbiAgICAvLyBzcGVjIGZvciBldmVudCB0eXBlcyBhbmQgcmV0dXJuIGEgcmVmIHRvIGl0LlxuICAgIGVsc2UgaWYgKGhhc0NsYXNzUmVmZXJlbmNlKHJvb3QsIHdlYktpdE1lZGlhU291cmNlQ2xhc3NOYW1lKSkge1xuICAgICAgICB2YXIgY2xhc3NSZWYgPSByb290W3dlYktpdE1lZGlhU291cmNlQ2xhc3NOYW1lXSxcbiAgICAgICAgICAgIGV2ZW50c01hcCA9IGNyZWF0ZUV2ZW50c01hcChtZWRpYVNvdXJjZUV2ZW50cywgd2ViS2l0TWVkaWFTb3VyY2VFdmVudHMpO1xuXG4gICAgICAgIG92ZXJyaWRlRXZlbnRGbihjbGFzc1JlZiwgJ2FkZEV2ZW50TGlzdGVuZXInLCBldmVudHNNYXApO1xuICAgICAgICBvdmVycmlkZUV2ZW50Rm4oY2xhc3NSZWYsICdyZW1vdmVFdmVudExpc3RlbmVyJywgZXZlbnRzTWFwKTtcblxuICAgICAgICByZXR1cm4gY2xhc3NSZWY7XG4gICAgfVxuXG4gICAgLy8gT3RoZXJ3aXNlLCAoc3RhbmRhcmQgb3Igbm9uc3RhbmRhcmQpIE1lZGlhU291cmNlIGRvZXNuJ3QgYXBwZWFyIHRvIGJlIG5hdGl2ZWx5IHN1cHBvcnRlZCwgc28gcmV0dXJuXG4gICAgLy8gYSBnZW5lcmljIGZ1bmN0aW9uIHRoYXQgdGhyb3dzIGFuIGVycm9yIHdoZW4gY2FsbGVkLlxuICAgIC8vIFRPRE86IFRocm93IGVycm9yIGltbWVkaWF0ZWx5IGluc3RlYWQgKG9yIGJvdGgpP1xuICAgIHJldHVybiBmdW5jdGlvbigpIHsgdGhyb3cgbmV3IEVycm9yKCdNZWRpYVNvdXJjZSBkb2VzblxcJ3QgYXBwZWFyIHRvIGJlIHN1cHBvcnRlZCBpbiB5b3VyIGVudmlyb25tZW50Jyk7IH07XG59XG5cbnZhciBNZWRpYVNvdXJjZSA9IGdldE1lZGlhU291cmNlQ2xhc3Mocm9vdCk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWVkaWFTb3VyY2U7IiwiOyhmdW5jdGlvbigpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgcm9vdCA9IHJlcXVpcmUoJy4vd2luZG93LmpzJyksXG4gICAgICAgIE1lZGlhU291cmNlID0gcmVxdWlyZSgnLi9NZWRpYVNvdXJjZScpO1xuXG4gICAgZnVuY3Rpb24gbWVkaWFTb3VyY2VTaGltKHJvb3QsIG1lZGlhU291cmNlQ2xhc3MpIHtcbiAgICAgICAgcm9vdC5NZWRpYVNvdXJjZSA9IG1lZGlhU291cmNlQ2xhc3M7XG4gICAgfVxuXG4gICAgbWVkaWFTb3VyY2VTaGltKHJvb3QsIE1lZGlhU291cmNlKTtcbn0uY2FsbCh0aGlzKSk7IiwiKGZ1bmN0aW9uIChnbG9iYWwpe1xuLy8gQ3JlYXRlIGEgc2ltcGxlIG1vZHVsZSB0byByZWZlciB0byB0aGUgd2luZG93L2dsb2JhbCBvYmplY3QgdG8gbWFrZSBtb2NraW5nIHRoZSB3aW5kb3cgb2JqZWN0IGFuZCBpdHNcbi8vIHByb3BlcnRpZXMgY2xlYW5lciB3aGVuIHRlc3RpbmcuXG4ndXNlIHN0cmljdCc7XG5tb2R1bGUuZXhwb3J0cyA9IGdsb2JhbDtcbn0pLmNhbGwodGhpcyx0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDogdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9KSIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4vdXRpbC9leGlzdHkuanMnKSxcbiAgICBTZWdtZW50TG9hZGVyID0gcmVxdWlyZSgnLi9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzJyksXG4gICAgU291cmNlQnVmZmVyRGF0YVF1ZXVlID0gcmVxdWlyZSgnLi9zb3VyY2VCdWZmZXIvU291cmNlQnVmZmVyRGF0YVF1ZXVlLmpzJyksXG4gICAgRG93bmxvYWRSYXRlTWFuYWdlciA9IHJlcXVpcmUoJy4vcnVsZXMvRG93bmxvYWRSYXRlTWFuYWdlci5qcycpLFxuICAgIFZpZGVvUmVhZHlTdGF0ZVJ1bGUgPSByZXF1aXJlKCcuL3J1bGVzL2Rvd25sb2FkUmF0ZS9WaWRlb1JlYWR5U3RhdGVSdWxlLmpzJyksXG4gICAgU3RyZWFtTG9hZGVyID0gcmVxdWlyZSgnLi9TdHJlYW1Mb2FkZXIuanMnKSxcbiAgICBnZXRNcGQgPSByZXF1aXJlKCcuL2Rhc2gvbXBkL2dldE1wZC5qcycpLFxuICAgIG1lZGlhVHlwZXMgPSByZXF1aXJlKCcuL21hbmlmZXN0L01lZGlhVHlwZXMuanMnKTtcblxuZnVuY3Rpb24gbG9hZEluaXRpYWxpemF0aW9uKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSkge1xuICAgIHNlZ21lbnRMb2FkZXIub25lKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgbG9hZFNlZ21lbnRzKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUuYWRkVG9RdWV1ZShldmVudC5kYXRhKTtcbiAgICB9KTtcbiAgICBzZWdtZW50TG9hZGVyLmxvYWRJbml0aWFsaXphdGlvbigpO1xufVxuXG5mdW5jdGlvbiBsb2FkU2VnbWVudHMoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlKSB7XG4gICAgc2VnbWVudExvYWRlci5vbihzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5TRUdNRU5UX0xPQURFRCwgZnVuY3Rpb24gc2VnbWVudExvYWRlZEhhbmRsZXIoZXZlbnQpIHtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLm9uZShzb3VyY2VCdWZmZXJEYXRhUXVldWUuZXZlbnRMaXN0LlFVRVVFX0VNUFRZLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgdmFyIGxvYWRpbmcgPSBzZWdtZW50TG9hZGVyLmxvYWROZXh0U2VnbWVudCgpO1xuICAgICAgICAgICAgaWYgKCFsb2FkaW5nKSB7XG4gICAgICAgICAgICAgICAgc2VnbWVudExvYWRlci5vZmYoc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHNlZ21lbnRMb2FkZWRIYW5kbGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5hZGRUb1F1ZXVlKGV2ZW50LmRhdGEpO1xuICAgIH0pO1xuXG4gICAgc2VnbWVudExvYWRlci5sb2FkTmV4dFNlZ21lbnQoKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU291cmNlQnVmZmVyRGF0YVF1ZXVlQnlUeXBlKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKSB7XG4gICAgdmFyIHNvdXJjZUJ1ZmZlclR5cGUgPSBtYW5pZmVzdC5nZXRNZWRpYVNldEJ5VHlwZShtZWRpYVR5cGUpLmdldFNvdXJjZUJ1ZmZlclR5cGUoKSxcbiAgICAgICAgLy8gVE9ETzogVHJ5L2NhdGNoIGJsb2NrP1xuICAgICAgICBzb3VyY2VCdWZmZXIgPSBtZWRpYVNvdXJjZS5hZGRTb3VyY2VCdWZmZXIoc291cmNlQnVmZmVyVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtTG9hZGVyRm9yVHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSkge1xuICAgIHZhciBzZWdtZW50TG9hZGVyID0gbmV3IFNlZ21lbnRMb2FkZXIobWFuaWZlc3QsIG1lZGlhVHlwZSksXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBTdHJlYW1Mb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBtZWRpYVR5cGUpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW1Mb2FkZXJzKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSkge1xuICAgIHZhciBtYXRjaGVkVHlwZXMgPSBtZWRpYVR5cGVzLmZpbHRlcihmdW5jdGlvbihtZWRpYVR5cGUpIHtcbiAgICAgICAgICAgIHZhciBleGlzdHMgPSBleGlzdHkobWFuaWZlc3QuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSk7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5OyB9KSxcbiAgICAgICAgc3RyZWFtTG9hZGVycyA9IG1hdGNoZWRUeXBlcy5tYXAoZnVuY3Rpb24obWVkaWFUeXBlKSB7IHJldHVybiBjcmVhdGVTdHJlYW1Mb2FkZXJGb3JUeXBlKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKTsgfSk7XG4gICAgcmV0dXJuIHN0cmVhbUxvYWRlcnM7XG59XG5cbmZ1bmN0aW9uIFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0LCBtZWRpYVNvdXJjZSwgdGVjaCkge1xuICAgIHRoaXMuX19kb3dubG9hZFJhdGVNZ3IgPSBuZXcgRG93bmxvYWRSYXRlTWFuYWdlcihbbmV3IFZpZGVvUmVhZHlTdGF0ZVJ1bGUodGVjaCldKTtcbiAgICB0aGlzLl9fc3RyZWFtTG9hZGVycyA9IGNyZWF0ZVN0cmVhbUxvYWRlcnMobWFuaWZlc3QsIG1lZGlhU291cmNlKTtcbiAgICB0aGlzLl9fc3RyZWFtTG9hZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbUxvYWRlcikge1xuICAgICAgICBsb2FkSW5pdGlhbGl6YXRpb24oc3RyZWFtTG9hZGVyLmdldFNlZ21lbnRMb2FkZXIoKSwgc3RyZWFtTG9hZGVyLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSgpKTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJy4vd2luZG93LmpzJykuTWVkaWFTb3VyY2UsXG4gICAgLy9sb2FkTWFuaWZlc3QgPSByZXF1aXJlKCcuL21hbmlmZXN0L2xvYWRNYW5pZmVzdC5qcycpLFxuICAgIE1hbmlmZXN0ID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NYW5pZmVzdC5qcycpLFxuICAgIFBsYXlsaXN0TG9hZGVyID0gcmVxdWlyZSgnLi9QbGF5bGlzdExvYWRlci5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWFuaWZlc3RQcm92aWRlciA9IG5ldyBNYW5pZmVzdChzb3VyY2Uuc3JjLCBmYWxzZSk7XG4gICAgbWFuaWZlc3RQcm92aWRlci5sb2FkKGZ1bmN0aW9uKG1hbmlmZXN0KSB7XG4gICAgICAgIHZhciBtZWRpYVNvdXJjZSA9IG5ldyBNZWRpYVNvdXJjZSgpLFxuICAgICAgICAgICAgb3Blbkxpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgICAgICBtZWRpYVNvdXJjZS5yZW1vdmVFdmVudExpc3RlbmVyKCdzb3VyY2VvcGVuJywgb3Blbkxpc3RlbmVyLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2VsZi5fX3BsYXlsaXN0TG9hZGVyID0gbmV3IFBsYXlsaXN0TG9hZGVyKG1hbmlmZXN0UHJvdmlkZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuXG4gICAgICAgIC8vIFRPRE86IEhhbmRsZSBjbG9zZS5cbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCd3ZWJraXRzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuICAgICAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG5cbiAgICAgICAgdGVjaC5zZXRTcmMoVVJMLmNyZWF0ZU9iamVjdFVSTChtZWRpYVNvdXJjZSkpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUhhbmRsZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBTdHJlYW1Mb2FkZXIoc2VnbWVudExvYWRlciwgc291cmNlQnVmZmVyRGF0YVF1ZXVlLCBzdHJlYW1UeXBlKSB7XG4gICAgdGhpcy5fX3NlZ21lbnRMb2FkZXIgPSBzZWdtZW50TG9hZGVyO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXJEYXRhUXVldWUgPSBzb3VyY2VCdWZmZXJEYXRhUXVldWU7XG4gICAgdGhpcy5fX3N0cmVhbVR5cGUgPSBzdHJlYW1UeXBlO1xufVxuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLmdldFN0cmVhbVR5cGUgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zdHJlYW1UeXBlOyB9O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLmdldFNlZ21lbnRMb2FkZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zZWdtZW50TG9hZGVyOyB9O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZTsgfTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudEluZGV4KCk7IH07XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtTG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKSxcbiAgICBwYXJzZVJvb3RVcmwgPSB1dGlsLnBhcnNlUm9vdFVybCxcbiAgICBjcmVhdGVNcGRPYmplY3QsXG4gICAgY3JlYXRlUGVyaW9kT2JqZWN0LFxuICAgIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QsXG4gICAgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QsXG4gICAgY3JlYXRlU2VnbWVudFRlbXBsYXRlLFxuICAgIGdldE1wZCxcbiAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlLFxuICAgIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsXG4gICAgZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWU7XG5cbi8vIFRPRE86IFNob3VsZCB0aGlzIGV4aXN0IG9uIG1wZCBkYXRhdmlldyBvciBhdCBhIGhpZ2hlciBsZXZlbD9cbi8vIFRPRE86IFJlZmFjdG9yLiBDb3VsZCBiZSBtb3JlIGVmZmljaWVudCAoUmVjdXJzaXZlIGZuPyBVc2UgZWxlbWVudC5nZXRFbGVtZW50c0J5TmFtZSgnQmFzZVVybCcpWzBdPykuXG4vLyBUT0RPOiBDdXJyZW50bHkgYXNzdW1pbmcgKkVJVEhFUiogPEJhc2VVUkw+IG5vZGVzIHdpbGwgcHJvdmlkZSBhbiBhYnNvbHV0ZSBiYXNlIHVybCAoaWUgcmVzb2x2ZSB0byAnaHR0cDovLycgZXRjKVxuLy8gVE9ETzogKk9SKiB3ZSBzaG91bGQgdXNlIHRoZSBiYXNlIHVybCBvZiB0aGUgaG9zdCBvZiB0aGUgTVBEIG1hbmlmZXN0LlxudmFyIGJ1aWxkQmFzZVVybCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICB2YXIgZWxlbUhpZXJhcmNoeSA9IFt4bWxOb2RlXS5jb25jYXQoeG1sZnVuLmdldEFuY2VzdG9ycyh4bWxOb2RlKSksXG4gICAgICAgIGZvdW5kTG9jYWxCYXNlVXJsID0gZmFsc2U7XG4gICAgLy92YXIgYmFzZVVybHMgPSBfLm1hcChlbGVtSGllcmFyY2h5LCBmdW5jdGlvbihlbGVtKSB7XG4gICAgdmFyIGJhc2VVcmxzID0gZWxlbUhpZXJhcmNoeS5tYXAoZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoZm91bmRMb2NhbEJhc2VVcmwpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIGlmICghZWxlbS5oYXNDaGlsZE5vZGVzKCkpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBjaGlsZDtcbiAgICAgICAgZm9yICh2YXIgaT0wOyBpPGVsZW0uY2hpbGROb2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBlbGVtLmNoaWxkTm9kZXMuaXRlbShpKTtcbiAgICAgICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0Jhc2VVUkwnKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRFbGVtID0gY2hpbGQuY2hpbGROb2Rlcy5pdGVtKDApO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0VmFsdWUgPSB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgICAgIGlmICh0ZXh0VmFsdWUuaW5kZXhPZignaHR0cDovLycpID09PSAwKSB7IGZvdW5kTG9jYWxCYXNlVXJsID0gdHJ1ZTsgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH0pO1xuXG4gICAgdmFyIGJhc2VVcmwgPSBiYXNlVXJscy5yZXZlcnNlKCkuam9pbignJyk7XG4gICAgaWYgKCFiYXNlVXJsKSB7IHJldHVybiBwYXJzZVJvb3RVcmwoeG1sTm9kZS5iYXNlVVJJKTsgfVxuICAgIHJldHVybiBiYXNlVXJsO1xufTtcblxudmFyIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMgPSBbXG4gICAgJ0FkYXB0YXRpb25TZXQnLFxuICAgICdSZXByZXNlbnRhdGlvbicsXG4gICAgJ1N1YlJlcHJlc2VudGF0aW9uJ1xuXTtcblxudmFyIGhhc0NvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMuaW5kZXhPZihlbGVtLm5vZGVOYW1lKSA+PSAwO1xufTtcblxudmFyIGRvZXNudEhhdmVDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiAhaGFzQ29tbW9uUHJvcGVydGllcyhlbGVtKTtcbn07XG5cbi8vIENvbW1vbiBBdHRyc1xudmFyIGdldFdpZHRoID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCd3aWR0aCcpLFxuICAgIGdldEhlaWdodCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnaGVpZ2h0JyksXG4gICAgZ2V0RnJhbWVSYXRlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdmcmFtZVJhdGUnKSxcbiAgICBnZXRNaW1lVHlwZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnbWltZVR5cGUnKSxcbiAgICBnZXRDb2RlY3MgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2NvZGVjcycpO1xuXG52YXIgZ2V0U2VnbWVudFRlbXBsYXRlWG1sID0geG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCgnU2VnbWVudFRlbXBsYXRlJywgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMpO1xuXG4vLyBNUEQgQXR0ciBmbnNcbnZhciBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbicpLFxuICAgIGdldFR5cGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0eXBlJyksXG4gICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21pbmltdW1VcGRhdGVQZXJpb2QnKTtcblxuLy8gUmVwcmVzZW50YXRpb24gQXR0ciBmbnNcbnZhciBnZXRJZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2lkJyksXG4gICAgZ2V0QmFuZHdpZHRoID0geG1sZnVuLmdldEF0dHJGbignYmFuZHdpZHRoJyk7XG5cbi8vIFNlZ21lbnRUZW1wbGF0ZSBBdHRyIGZuc1xudmFyIGdldEluaXRpYWxpemF0aW9uID0geG1sZnVuLmdldEF0dHJGbignaW5pdGlhbGl6YXRpb24nKSxcbiAgICBnZXRNZWRpYSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhJyksXG4gICAgZ2V0RHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdkdXJhdGlvbicpLFxuICAgIGdldFRpbWVzY2FsZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVzY2FsZScpLFxuICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdwcmVzZW50YXRpb25UaW1lT2Zmc2V0JyksXG4gICAgZ2V0U3RhcnROdW1iZXIgPSB4bWxmdW4uZ2V0QXR0ckZuKCdzdGFydE51bWJlcicpO1xuXG4vLyBUT0RPOiBSZXBlYXQgY29kZS4gQWJzdHJhY3QgYXdheSAoUHJvdG90eXBhbCBJbmhlcml0YW5jZS9PTyBNb2RlbD8gT2JqZWN0IGNvbXBvc2VyIGZuPylcbmNyZWF0ZU1wZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UGVyaW9kczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbmltdW1VcGRhdGVQZXJpb2QsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWwoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElkLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgeG1sTm9kZSksXG4gICAgICAgIGdldEZyYW1lUmF0ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEZyYW1lUmF0ZSwgeG1sTm9kZSksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldENvZGVjczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldENvZGVjcywgeG1sTm9kZSksXG4gICAgICAgIGdldEJhc2VVcmw6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihidWlsZEJhc2VVcmwsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50VGVtcGxhdGUgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SW5pdGlhbGl6YXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRNZWRpYTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVzY2FsZSwgeG1sTm9kZSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlciwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUgPSBmdW5jdGlvbih4bWxOb2RlLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIGlmICghdGFnTmFtZSB8fCAheG1sTm9kZSB8fCAheG1sTm9kZS5wYXJlbnROb2RlKSB7IHJldHVybiBudWxsOyB9XG4gICAgaWYgKCF4bWxOb2RlLnBhcmVudE5vZGUuaGFzT3duUHJvcGVydHkoJ25vZGVOYW1lJykpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGlmICh4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUgPT09IHRhZ05hbWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpID8gbWFwRm4oeG1sTm9kZS5wYXJlbnROb2RlKSA6IHhtbE5vZGUucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUucGFyZW50Tm9kZSwgdGFnTmFtZSwgbWFwRm4pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNcGQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsLFxuICAgIC8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIFNFQ09ORFNfSU5fWUVBUiA9IDM2NSAqIDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01PTlRIID0gMzAgKiAyNCAqIDYwICogNjAsIC8vIG5vdCBwcmVjaXNlIVxuICAgIFNFQ09ORFNfSU5fREFZID0gMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fSE9VUiA9IDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NSU4gPSA2MCxcbiAgICBNSU5VVEVTX0lOX0hPVVIgPSA2MCxcbiAgICBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUyA9IDEwMDAsXG4gICAgZHVyYXRpb25SZWdleCA9IC9eUCgoW1xcZC5dKilZKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKUQpP1Q/KChbXFxkLl0qKUgpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopUyk/LztcblxucGFyc2VSb290VXJsID0gZnVuY3Rpb24odXJsKSB7XG4gICAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJy8nKSA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignPycpICE9PSAtMSkge1xuICAgICAgICB1cmwgPSB1cmwuc3Vic3RyaW5nKDAsIHVybC5pbmRleE9mKCc/JykpO1xuICAgIH1cblxuICAgIHJldHVybiB1cmwuc3Vic3RyaW5nKDAsIHVybC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59O1xuXG4vLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZnVuY3Rpb24gKHN0cikge1xuICAgIC8vc3RyID0gXCJQMTBZMTBNMTBEVDEwSDEwTTEwLjFTXCI7XG4gICAgdmFyIG1hdGNoID0gZHVyYXRpb25SZWdleC5leGVjKHN0cik7XG4gICAgcmV0dXJuIChwYXJzZUZsb2F0KG1hdGNoWzJdIHx8IDApICogU0VDT05EU19JTl9ZRUFSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs0XSB8fCAwKSAqIFNFQ09ORFNfSU5fTU9OVEggK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzZdIHx8IDApICogU0VDT05EU19JTl9EQVkgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzhdIHx8IDApICogU0VDT05EU19JTl9IT1VSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMF0gfHwgMCkgKiBTRUNPTkRTX0lOX01JTiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTJdIHx8IDApKTtcbn07XG5cbnZhciB1dGlsID0ge1xuICAgIHBhcnNlUm9vdFVybDogcGFyc2VSb290VXJsLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWw7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgc2VnbWVudFRlbXBsYXRlID0gcmVxdWlyZSgnLi9zZWdtZW50VGVtcGxhdGUnKSxcbiAgICBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSxcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSxcbiAgICBnZXRUeXBlLFxuICAgIGdldEJhbmR3aWR0aCxcbiAgICBnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSxcbiAgICBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSxcbiAgICBnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGU7XG5cbmdldFR5cGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZ2V0QmFuZHdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbn07XG5cbmdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgcGVyaW9kLXJlbGF0aXZlIHByZXNlbnRhdGlvbiB0aW1lXG4gICAgdmFyIG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKCksXG4gICAgICAgIHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBOdW1iZXIocGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pKSxcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZU9mZnNldCA9IE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0KCkpO1xuICAgIHJldHVybiBOdW1iZXIocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiAtIHByZXNlbnRhdGlvblRpbWVPZmZzZXQpO1xufTtcblxuZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgc2VnbWVudFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCk7XG4gICAgcmV0dXJuIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0RHVyYXRpb24oKSkgLyBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldFRpbWVzY2FsZSgpKTtcbn07XG5cbmdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTWF0aC5jZWlsKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC8gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG59O1xuXG5nZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRTdGFydE51bWJlcigpKTtcbn07XG5cbmdldEVuZE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSArIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAtIDE7XG59O1xuXG5jcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0VHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFNlZ21lbnREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbFNlZ21lbnRDb3VudDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0RW5kTnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIC8vIFRPRE86IEV4dGVybmFsaXplXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBpbml0aWFsaXphdGlvbiA9IHt9O1xuICAgICAgICAgICAgaW5pdGlhbGl6YXRpb24uZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICAgICAgICAgIHJlcHJlc2VudGF0aW9uSWQgPSByZXByZXNlbnRhdGlvbi5nZXRJZCgpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRJbml0aWFsaXphdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25JZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBpbml0aWFsaXphdGlvbjtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5TnVtYmVyOiBmdW5jdGlvbihudW1iZXIpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTsgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5VGltZTogZnVuY3Rpb24oc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgc2Vjb25kcyk7IH1cbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIG51bWJlcikge1xuICAgIHZhciBzZWdtZW50ID0ge307XG4gICAgc2VnbWVudC5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICBzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldE1lZGlhKCksXG4gICAgICAgICAgICByZXBsYWNlZElkVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbi5nZXRJZCgpKSxcbiAgICAgICAgICAgIC8vIFRPRE86IFNpbmNlICRUaW1lJC10ZW1wbGF0ZWQgc2VnbWVudCBVUkxzIHNob3VsZCBvbmx5IGV4aXN0IGluIGNvbmp1bmN0aW9uIHcvYSA8U2VnbWVudFRpbWVsaW5lPixcbiAgICAgICAgICAgIC8vIFRPRE86IGNhbiBjdXJyZW50bHkgYXNzdW1lIGEgJE51bWJlciQtYmFzZWQgdGVtcGxhdGVkIHVybC5cbiAgICAgICAgICAgIC8vIFRPRE86IEVuZm9yY2UgbWluL21heCBudW1iZXIgcmFuZ2UgKGJhc2VkIG9uIHNlZ21lbnRMaXN0IHN0YXJ0TnVtYmVyICYgZW5kTnVtYmVyKVxuICAgICAgICAgICAgcmVwbGFjZWROdW1iZXJVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRJZFVybCwgJ051bWJlcicsIG51bWJlcik7XG4gICAgICAgIHJldHVybiBiYXNlVXJsICsgcmVwbGFjZWROdW1iZXJVcmw7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbnVtYmVyICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0RHVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVE9ETzogSGFuZGxlIGxhc3Qgc2VnbWVudCAobGlrZWx5IDwgc2VnbWVudCBkdXJhdGlvbilcbiAgICAgICAgcmV0dXJuIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbnVtYmVyOyB9O1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKSB7XG4gICAgdmFyIHNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIG51bWJlciA9IE1hdGguZmxvb3IoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLyBzZWdtZW50RHVyYXRpb24pLFxuICAgICAgICBzZWdtZW50ID0gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpO1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIGlmICghcmVwcmVzZW50YXRpb24pIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmIChyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKSkgeyByZXR1cm4gY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pOyB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2VnbWVudFRlbXBsYXRlLFxuICAgIHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlO1xuXG56ZXJvUGFkVG9MZW5ndGggPSBmdW5jdGlvbiAobnVtU3RyLCBtaW5TdHJMZW5ndGgpIHtcbiAgICB3aGlsZSAobnVtU3RyLmxlbmd0aCA8IG1pblN0ckxlbmd0aCkge1xuICAgICAgICBudW1TdHIgPSAnMCcgKyBudW1TdHI7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bVN0cjtcbn07XG5cbnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB0b2tlbiwgdmFsdWUpIHtcblxuICAgIHZhciBzdGFydFBvcyA9IDAsXG4gICAgICAgIGVuZFBvcyA9IDAsXG4gICAgICAgIHRva2VuTGVuID0gdG9rZW4ubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWcgPSAnJTAnLFxuICAgICAgICBmb3JtYXRUYWdMZW4gPSBmb3JtYXRUYWcubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWdQb3MsXG4gICAgICAgIHNwZWNpZmllcixcbiAgICAgICAgd2lkdGgsXG4gICAgICAgIHBhZGRlZFZhbHVlO1xuXG4gICAgLy8ga2VlcCBsb29waW5nIHJvdW5kIHVudGlsIGFsbCBpbnN0YW5jZXMgb2YgPHRva2VuPiBoYXZlIGJlZW5cbiAgICAvLyByZXBsYWNlZC4gb25jZSB0aGF0IGhhcyBoYXBwZW5lZCwgc3RhcnRQb3MgYmVsb3cgd2lsbCBiZSAtMVxuICAgIC8vIGFuZCB0aGUgY29tcGxldGVkIHVybCB3aWxsIGJlIHJldHVybmVkLlxuICAgIHdoaWxlICh0cnVlKSB7XG5cbiAgICAgICAgLy8gY2hlY2sgaWYgdGhlcmUgaXMgYSB2YWxpZCAkPHRva2VuPi4uLiQgaWRlbnRpZmllclxuICAgICAgICAvLyBpZiBub3QsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBzdGFydFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnICsgdG9rZW4pO1xuICAgICAgICBpZiAoc3RhcnRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGUgbmV4dCAnJCcgbXVzdCBiZSB0aGUgZW5kIG9mIHRoZSBpZGVudGlmZXJcbiAgICAgICAgLy8gaWYgdGhlcmUgaXNuJ3Qgb25lLCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgZW5kUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZW5kUG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbm93IHNlZSBpZiB0aGVyZSBpcyBhbiBhZGRpdGlvbmFsIGZvcm1hdCB0YWcgc3VmZml4ZWQgdG9cbiAgICAgICAgLy8gdGhlIGlkZW50aWZpZXIgd2l0aGluIHRoZSBlbmNsb3NpbmcgJyQnIGNoYXJhY3RlcnNcbiAgICAgICAgZm9ybWF0VGFnUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZihmb3JtYXRUYWcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZm9ybWF0VGFnUG9zID4gc3RhcnRQb3MgJiYgZm9ybWF0VGFnUG9zIDwgZW5kUG9zKSB7XG5cbiAgICAgICAgICAgIHNwZWNpZmllciA9IHRlbXBsYXRlU3RyLmNoYXJBdChlbmRQb3MgLSAxKTtcbiAgICAgICAgICAgIHdpZHRoID0gcGFyc2VJbnQodGVtcGxhdGVTdHIuc3Vic3RyaW5nKGZvcm1hdFRhZ1BvcyArIGZvcm1hdFRhZ0xlbiwgZW5kUG9zIC0gMSksIDEwKTtcblxuICAgICAgICAgICAgLy8gc3VwcG9ydCB0aGUgbWluaW11bSBzcGVjaWZpZXJzIHJlcXVpcmVkIGJ5IElFRUUgMTAwMy4xXG4gICAgICAgICAgICAvLyAoZCwgaSAsIG8sIHUsIHgsIGFuZCBYKSBmb3IgY29tcGxldGVuZXNzXG4gICAgICAgICAgICBzd2l0Y2ggKHNwZWNpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIHRyZWF0IGFsbCBpbnQgdHlwZXMgYXMgdWludCxcbiAgICAgICAgICAgICAgICAvLyBoZW5jZSBkZWxpYmVyYXRlIGZhbGx0aHJvdWdoXG4gICAgICAgICAgICAgICAgY2FzZSAnZCc6XG4gICAgICAgICAgICAgICAgY2FzZSAnaSc6XG4gICAgICAgICAgICAgICAgY2FzZSAndSc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAneCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdYJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCkudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnbyc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDgpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVbnN1cHBvcnRlZC9pbnZhbGlkIElFRUUgMTAwMy4xIGZvcm1hdCBpZGVudGlmaWVyIHN0cmluZyBpbiBVUkwnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRlbXBsYXRlU3RyID0gdGVtcGxhdGVTdHIuc3Vic3RyaW5nKDAsIHN0YXJ0UG9zKSArIHBhZGRlZFZhbHVlICsgdGVtcGxhdGVTdHIuc3Vic3RyaW5nKGVuZFBvcyArIDEpO1xuICAgIH1cbn07XG5cbnVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIpIHtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyQkJykuam9pbignJCcpO1xufTtcblxucmVwbGFjZUlERm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHRlbXBsYXRlU3RyLmluZGV4T2YoJyRSZXByZXNlbnRhdGlvbklEJCcpID09PSAtMSkgeyByZXR1cm4gdGVtcGxhdGVTdHI7IH1cbiAgICB2YXIgdiA9IHZhbHVlLnRvU3RyaW5nKCk7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckUmVwcmVzZW50YXRpb25JRCQnKS5qb2luKHYpO1xufTtcblxuc2VnbWVudFRlbXBsYXRlID0ge1xuICAgIHplcm9QYWRUb0xlbmd0aDogemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlOiByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlOiB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlOiByZXBsYWNlSURGb3JUZW1wbGF0ZVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBzZWdtZW50VGVtcGxhdGU7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXZlbnRNZ3IgPSByZXF1aXJlKCcuL2V2ZW50TWFuYWdlci5qcycpLFxuICAgIGV2ZW50RGlzcGF0Y2hlck1peGluID0ge1xuICAgICAgICB0cmlnZ2VyOiBmdW5jdGlvbihldmVudE9iamVjdCkgeyBldmVudE1nci50cmlnZ2VyKHRoaXMsIGV2ZW50T2JqZWN0KTsgfSxcbiAgICAgICAgb25lOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uZSh0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb246IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub24odGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9mZjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vZmYodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH1cbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50RGlzcGF0Y2hlck1peGluOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHZpZGVvanMgPSByZXF1aXJlKCcuLi93aW5kb3cuanMnKS52aWRlb2pzLFxuICAgIGV2ZW50TWFuYWdlciA9IHtcbiAgICAgICAgdHJpZ2dlcjogdmlkZW9qcy50cmlnZ2VyLFxuICAgICAgICBvbmU6IHZpZGVvanMub25lLFxuICAgICAgICBvbjogdmlkZW9qcy5vbixcbiAgICAgICAgb2ZmOiB2aWRlb2pzLm9mZlxuICAgIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZXZlbnRNYW5hZ2VyOyIsIi8qKlxuICogQ3JlYXRlZCBieSBjcGlsbHNidXJ5IG9uIDEyLzMvMTQuXG4gKi9cbjsoZnVuY3Rpb24oKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIHJvb3QgPSByZXF1aXJlKCcuL3dpbmRvdycpLFxuICAgICAgICB2aWRlb2pzID0gcm9vdC52aWRlb2pzLFxuICAgICAgICAvLyBOb3RlOiBUbyB1c2UgdGhlIENvbW1vbkpTIG1vZHVsZSBsb2FkZXIsIGhhdmUgdG8gcG9pbnQgdG8gdGhlIHByZS1icm93c2VyaWZpZWQgbWFpbiBsaWIgZmlsZS5cbiAgICAgICAgbXNlID0gcmVxdWlyZSgnbXNlLmpzL3NyYy9qcy9tc2UuanMnKSxcbiAgICAgICAgU291cmNlSGFuZGxlciA9IHJlcXVpcmUoJy4vU291cmNlSGFuZGxlcicpO1xuXG4gICAgaWYgKCF2aWRlb2pzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlIHZpZGVvLmpzIGxpYnJhcnkgbXVzdCBiZSBpbmNsdWRlZCB0byB1c2UgdGhpcyBNUEVHLURBU0ggc291cmNlIGhhbmRsZXIuJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FuSGFuZGxlU291cmNlKHNvdXJjZSkge1xuICAgICAgICAvLyBFeHRlcm5hbGl6ZSBpZiB1c2VkIGVsc2V3aGVyZS4gUG90ZW50aWFsbHkgdXNlIGNvbnN0YW50IGZ1bmN0aW9uLlxuICAgICAgICB2YXIgZG9lc250SGFuZGxlU291cmNlID0gJycsXG4gICAgICAgICAgICBtYXliZUhhbmRsZVNvdXJjZSA9ICdtYXliZScsXG4gICAgICAgICAgICBkZWZhdWx0SGFuZGxlU291cmNlID0gZG9lc250SGFuZGxlU291cmNlO1xuXG4gICAgICAgIC8vIFRPRE86IFVzZSBzYWZlciB2anMgY2hlY2sgKGUuZy4gaGFuZGxlcyBJRSBjb25kaXRpb25zKT9cbiAgICAgICAgLy8gUmVxdWlyZXMgTWVkaWEgU291cmNlIEV4dGVuc2lvbnNcbiAgICAgICAgaWYgKCEocm9vdC5NZWRpYVNvdXJjZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBkb2VzbnRIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgdHlwZSBpcyBzdXBwb3J0ZWRcbiAgICAgICAgaWYgKC9hcHBsaWNhdGlvblxcL2Rhc2hcXCt4bWwvLnRlc3Qoc291cmNlLnR5cGUpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnbWF0Y2hlZCB0eXBlJyk7XG4gICAgICAgICAgICByZXR1cm4gbWF5YmVIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleHRlbnNpb24gbWF0Y2hlc1xuICAgICAgICBpZiAoL1xcLm1wZCQvaS50ZXN0KHNvdXJjZS5zcmMpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnbWF0Y2hlZCBleHRlbnNpb24nKTtcbiAgICAgICAgICAgIHJldHVybiBtYXliZUhhbmRsZVNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkZWZhdWx0SGFuZGxlU291cmNlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhhbmRsZVNvdXJjZShzb3VyY2UsIHRlY2gpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCk7XG4gICAgfVxuXG4gICAgLy8gUmVnaXN0ZXIgdGhlIHNvdXJjZSBoYW5kbGVyXG4gICAgdmlkZW9qcy5IdG1sNS5yZWdpc3RlclNvdXJjZUhhbmRsZXIoe1xuICAgICAgICBjYW5IYW5kbGVTb3VyY2U6IGNhbkhhbmRsZVNvdXJjZSxcbiAgICAgICAgaGFuZGxlU291cmNlOiBoYW5kbGVTb3VyY2VcbiAgICB9LCAwKTtcblxufS5jYWxsKHRoaXMpKTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIHRydXRoeSA9IHJlcXVpcmUoJy4uL3V0aWwvdHJ1dGh5LmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuLi91dGlsL2lzU3RyaW5nLmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGxvYWRNYW5pZmVzdCA9IHJlcXVpcmUoJy4vbG9hZE1hbmlmZXN0LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24gPSByZXF1aXJlKCcuLi9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMnKSxcbiAgICBnZXRNcGQgPSByZXF1aXJlKCcuLi9kYXNoL21wZC9nZXRNcGQuanMnKSxcbiAgICBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uLFxuICAgIGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVzLmpzJyksXG4gICAgREVGQVVMVF9UWVBFID0gbWVkaWFUeXBlc1swXTtcblxuZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlID0gZnVuY3Rpb24obWltZVR5cGUsIHR5cGVzKSB7XG4gICAgaWYgKCFpc1N0cmluZyhtaW1lVHlwZSkpIHsgcmV0dXJuIERFRkFVTFRfVFlQRTsgfVxuICAgIHZhciBtYXRjaGVkVHlwZSA9IHR5cGVzLmZpbmQoZnVuY3Rpb24odHlwZSkge1xuICAgICAgICByZXR1cm4gKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBleGlzdHkobWF0Y2hlZFR5cGUpID8gbWF0Y2hlZFR5cGUgOiBERUZBVUxUX1RZUEU7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIG93biBtb2R1bGUgaW4gZGFzaCBwYWNrYWdlIHNvbWV3aGVyZVxuZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbiA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59O1xuXG5cbmZ1bmN0aW9uIE1hbmlmZXN0KHNvdXJjZVVyaSwgYXV0b0xvYWQpIHtcbiAgICB0aGlzLl9fYXV0b0xvYWQgPSB0cnV0aHkoYXV0b0xvYWQpO1xuICAgIHRoaXMuc2V0U291cmNlVXJpKHNvdXJjZVVyaSk7XG59XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgTUFOSUZFU1RfTE9BREVEOiAnbWFuaWZlc3RMb2FkZWQnXG59O1xuXG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRTb3VyY2VVcmkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX3NvdXJjZVVyaTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5zZXRTb3VyY2VVcmkgPSBmdW5jdGlvbiBzZXRTb3VyY2VVcmkoc291cmNlVXJpKSB7XG4gICAgLy8gVE9ETzogJ2V4aXN0eSgpJyBjaGVjayBmb3IgYm90aD9cbiAgICBpZiAoc291cmNlVXJpID09PSB0aGlzLl9fc291cmNlVXJpKSB7IHJldHVybjsgfVxuXG4gICAgLy8gVE9ETzogaXNTdHJpbmcoKSBjaGVjaz8gJ2V4aXN0eSgpJyBjaGVjaz9cbiAgICBpZiAoIXNvdXJjZVVyaSkge1xuICAgICAgICB0aGlzLl9fY2xlYXJTb3VyY2VVcmkoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBzb3VyY2VVcmk7XG4gICAgaWYgKHRoaXMuX19hdXRvTG9hZCkge1xuICAgICAgICAvLyBUT0RPOiBJbXBsIGFueSBjbGVhbnVwIGZ1bmN0aW9uYWxpdHkgYXBwcm9wcmlhdGUgYmVmb3JlIGxvYWQuXG4gICAgICAgIHRoaXMubG9hZCgpO1xuICAgIH1cbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5fX2NsZWFyU291cmNlVXJpID0gZnVuY3Rpb24gY2xlYXJTb3VyY2VVcmkoKSB7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IG51bGw7XG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgLy8gVE9ETzogaW1wbCBhbnkgb3RoZXIgY2xlYW51cCBmdW5jdGlvbmFsaXR5XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uIGxvYWQoLyogb3B0aW9uYWwgKi8gY2FsbGJhY2tGbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBsb2FkTWFuaWZlc3Qoc2VsZi5fX3NvdXJjZVVyaSwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICBzZWxmLl9fbWFuaWZlc3QgPSBkYXRhLm1hbmlmZXN0WG1sO1xuICAgICAgICBzZWxmLl9fc2V0dXBVcGRhdGVJbnRlcnZhbCgpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0Lk1BTklGRVNUX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6c2VsZi5fX21hbmlmZXN0fSk7XG4gICAgICAgIGlmIChpc0Z1bmN0aW9uKGNhbGxiYWNrRm4pKSB7IGNhbGxiYWNrRm4oZGF0YS5tYW5pZmVzdFhtbCk7IH1cbiAgICB9KTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwoKSB7XG4gICAgaWYgKCFleGlzdHkodGhpcy5fX3VwZGF0ZUludGVydmFsKSkgeyByZXR1cm47IH1cbiAgICBjbGVhckludGVydmFsKHRoaXMuX191cGRhdGVJbnRlcnZhbCk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuX19zZXR1cFVwZGF0ZUludGVydmFsID0gZnVuY3Rpb24gc2V0dXBVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICBpZiAodGhpcy5fX3VwZGF0ZUludGVydmFsKSB7IHNlbGYuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpOyB9XG4gICAgaWYgKCF0aGlzLmdldFNob3VsZFVwZGF0ZSgpKSB7IHJldHVybjsgfVxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWluVXBkYXRlUmF0ZSA9IDIsXG4gICAgICAgIHVwZGF0ZVJhdGUgPSBNYXRoLm1heCh0aGlzLmdldFVwZGF0ZVJhdGUoKSwgbWluVXBkYXRlUmF0ZSk7XG4gICAgdGhpcy5fX3VwZGF0ZUludGVydmFsID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYubG9hZCgpO1xuICAgIH0sIHVwZGF0ZVJhdGUpO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldE1lZGlhU2V0QnlUeXBlID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXRCeVR5cGUodHlwZSkge1xuICAgIGlmIChtZWRpYVR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7IHRocm93IG5ldyBFcnJvcignSW52YWxpZCB0eXBlLiBWYWx1ZSBtdXN0IGJlIG9uZSBvZjogJyArIG1lZGlhVHlwZXMuam9pbignLCAnKSk7IH1cbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2ggPSBhZGFwdGF0aW9uU2V0cy5maW5kKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHtcbiAgICAgICAgICAgIHJldHVybiAoZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKGFkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcykgPT09IHR5cGUpO1xuICAgICAgICB9KTtcbiAgICBpZiAoIWV4aXN0eShhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRNZWRpYVNldHMgPSBmdW5jdGlvbiBnZXRNZWRpYVNldHMoKSB7XG4gICAgdmFyIGFkYXB0YXRpb25TZXRzID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdCkuZ2V0UGVyaW9kcygpWzBdLmdldEFkYXB0YXRpb25TZXRzKCksXG4gICAgICAgIG1lZGlhU2V0cyA9IGFkYXB0YXRpb25TZXRzLm1hcChmdW5jdGlvbihhZGFwdGF0aW9uU2V0KSB7IHJldHVybiBuZXcgTWVkaWFTZXQoYWRhcHRhdGlvblNldCk7IH0pO1xuICAgIHJldHVybiBtZWRpYVNldHM7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0U3RyZWFtVHlwZSA9IGZ1bmN0aW9uIGdldFN0cmVhbVR5cGUoKSB7XG4gICAgdmFyIHN0cmVhbVR5cGUgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRUeXBlKCk7XG4gICAgcmV0dXJuIHN0cmVhbVR5cGU7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0VXBkYXRlUmF0ZSA9IGZ1bmN0aW9uIGdldFVwZGF0ZVJhdGUoKSB7XG4gICAgdmFyIG1pbmltdW1VcGRhdGVQZXJpb2QgPSBnZXRNcGQodGhpcy5fX21hbmlmZXN0KS5nZXRNaW5pbXVtVXBkYXRlUGVyaW9kKCk7XG4gICAgcmV0dXJuIE51bWJlcihtaW5pbXVtVXBkYXRlUGVyaW9kKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRTaG91bGRVcGRhdGUgPSBmdW5jdGlvbiBnZXRTaG91bGRVcGRhdGUoKSB7XG4gICAgdmFyIGlzRHluYW1pYyA9ICh0aGlzLmdldFN0cmVhbVR5cGUoKSA9PT0gJ2R5bmFtaWMnKSxcbiAgICAgICAgaGFzVmFsaWRVcGRhdGVSYXRlID0gKHRoaXMuZ2V0VXBkYXRlUmF0ZSgpID4gMCk7XG4gICAgcmV0dXJuIChpc0R5bmFtaWMgJiYgaGFzVmFsaWRVcGRhdGVSYXRlKTtcbn07XG5cbmV4dGVuZE9iamVjdChNYW5pZmVzdC5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxuZnVuY3Rpb24gTWVkaWFTZXQoYWRhcHRhdGlvblNldCkge1xuICAgIC8vIFRPRE86IEFkZGl0aW9uYWwgY2hlY2tzICYgRXJyb3IgVGhyb3dpbmdcbiAgICB0aGlzLl9fYWRhcHRhdGlvblNldCA9IGFkYXB0YXRpb25TZXQ7XG59XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVR5cGUoKSB7XG4gICAgdmFyIHR5cGUgPSBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUodGhpcy5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKTtcbiAgICByZXR1cm4gdHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRNaW1lVHlwZSA9IGZ1bmN0aW9uIGdldE1pbWVUeXBlKCkge1xuICAgIHZhciBtaW1lVHlwZSA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldE1pbWVUeXBlKCk7XG4gICAgcmV0dXJuIG1pbWVUeXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNvdXJjZUJ1ZmZlclR5cGUgPSBmdW5jdGlvbiBnZXRTb3VyY2VCdWZmZXJUeXBlKCkge1xuICAgIC8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGUgY29kZWNzIGFzc29jaWF0ZWQgd2l0aCBlYWNoIHN0cmVhbSB2YXJpYW50L3JlcHJlc2VudGF0aW9uXG4gICAgLy8gd2lsbCBiZSBzaW1pbGFyIGVub3VnaCB0aGF0IHlvdSB3b24ndCBoYXZlIHRvIHJlLWNyZWF0ZSB0aGUgc291cmNlLWJ1ZmZlciB3aGVuIHN3aXRjaGluZ1xuICAgIC8vIGJldHdlZW4gdGhlbS5cblxuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzb3VyY2VCdWZmZXJUeXBlID0gZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbik7XG4gICAgcmV0dXJuIHNvdXJjZUJ1ZmZlclR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VG90YWxEdXJhdGlvbiA9IGZ1bmN0aW9uIGdldFRvdGFsRHVyYXRpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIGZyYWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbER1cmF0aW9uID0gZnJhZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKTtcbiAgICByZXR1cm4gdG90YWxEdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFRvdGFsRnJhZ21lbnRDb3VudCA9IGZ1bmN0aW9uIGdldFRvdGFsU2VnbWVudENvdW50KCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBmcmFnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgdG90YWxGcmFnbWVudENvdW50ID0gZnJhZ21lbnRMaXN0LmdldFRvdGFsU2VnbWVudENvdW50KCk7XG4gICAgcmV0dXJuIHRvdGFsRnJhZ21lbnRDb3VudDtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRGcmFnbWVudER1cmF0aW9uID0gZnVuY3Rpb24gZ2V0RnJhZ21lbnREdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgZnJhZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGZyYWdtZW50RHVyYXRpb24gPSBmcmFnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCk7XG4gICAgcmV0dXJuIGZyYWdtZW50RHVyYXRpb247XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0RnJhZ21lbnRMaXN0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRGcmFnbWVudExpc3RTdGFydE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgZnJhZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGZyYWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gZnJhZ21lbnRMaXN0LmdldFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIGZyYWdtZW50TGlzdFN0YXJ0TnVtYmVyO1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldEZyYWdtZW50TGlzdEVuZE51bWJlciA9IGZ1bmN0aW9uIGdldEZyYWdtZW50TGlzdEVuZE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgZnJhZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGZyYWdtZW50TGlzdEVuZE51bWJlciA9IGZyYWdtZW50TGlzdC5nZXRFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gZnJhZ21lbnRMaXN0RW5kTnVtYmVyO1xufTtcblxuLy8gVE9ETzogRGV0ZXJtaW5lIHdoZXRoZXIgb3Igbm90IHRvIHJlZmFjdG9yIG9mIHNlZ21lbnRMaXN0IGltcGxlbWVudGF0aW9uIGFuZC9vciBuYW1pbmcgY29udmVudGlvbnNcbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRGcmFnbWVudExpc3RzID0gZnVuY3Rpb24gZ2V0RnJhZ21lbnRMaXN0cygpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb25zID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCksXG4gICAgICAgIGZyYWdtZW50TGlzdHMgPSByZXByZXNlbnRhdGlvbnMubWFwKGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24pO1xuICAgIHJldHVybiBmcmFnbWVudExpc3RzO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldEZyYWdtZW50TGlzdEJ5QmFuZHdpZHRoID0gZnVuY3Rpb24gZ2V0RnJhZ21lbnRMaXN0QnlCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9ucyA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpLFxuICAgICAgICByZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCA9IHJlcHJlc2VudGF0aW9ucy5maW5kKGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICB2YXIgcmVwcmVzZW50YXRpb25CYW5kd2lkdGggPSByZXByZXNlbnRhdGlvbi5nZXRCYW5kd2lkdGgoKTtcbiAgICAgICAgICAgIHJldHVybiAoTnVtYmVyKHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoKSA9PT0gTnVtYmVyKGJhbmR3aWR0aCkpO1xuICAgICAgICB9KSxcbiAgICAgICAgZnJhZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCk7XG4gICAgcmV0dXJuIGZyYWdtZW50TGlzdDtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24gZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpIHtcbiAgICByZXR1cm4gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKCkubWFwKFxuICAgICAgICBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpO1xuICAgIH0pLmZpbHRlcihcbiAgICAgICAgZnVuY3Rpb24oYmFuZHdpZHRoKSB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5KGJhbmR3aWR0aCk7XG4gICAgICAgIH1cbiAgICApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYW5pZmVzdDsiLCJtb2R1bGUuZXhwb3J0cyA9IFsndmlkZW8nLCAnYXVkaW8nXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZVJvb3RVcmwgPSByZXF1aXJlKCcuLi9kYXNoL21wZC91dGlsLmpzJykucGFyc2VSb290VXJsO1xuXG5mdW5jdGlvbiBsb2FkTWFuaWZlc3QodXJsLCBjYWxsYmFjaykge1xuICAgIHZhciBhY3R1YWxVcmwgPSBwYXJzZVJvb3RVcmwodXJsKSxcbiAgICAgICAgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICBvbmxvYWQ7XG5cbiAgICBvbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkgeyByZXR1cm47IH1cblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrKHttYW5pZmVzdFhtbDogcmVxdWVzdC5yZXNwb25zZVhNTCB9KTsgfVxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgICAvL3RoaXMuZGVidWcubG9nKCdTdGFydCBsb2FkaW5nIG1hbmlmZXN0OiAnICsgdXJsKTtcbiAgICAgICAgcmVxdWVzdC5vbmxvYWQgPSBvbmxvYWQ7XG4gICAgICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICAgICAgcmVxdWVzdC5zZW5kKCk7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJlcXVlc3Qub25lcnJvcigpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsb2FkTWFuaWZlc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGlzQXJyYXkgPSByZXF1aXJlKCcuLi91dGlsL2lzQXJyYXkuanMnKSxcbiAgICBkb3dubG9hZFJhdGVzID0gcmVxdWlyZSgnLi9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlcy5qcycpLFxuICAgIGV2ZW50TGlzdCA9IHJlcXVpcmUoJy4vZG93bmxvYWRSYXRlL0Rvd25sb2FkUmF0ZUV2ZW50VHlwZXMuanMnKTtcblxuZnVuY3Rpb24gYWRkRXZlbnRIYW5kbGVyVG9SdWxlKHNlbGYsIHJ1bGUpIHtcbiAgICBydWxlLm9uKHNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX1JBVEVfQ0hBTkdFRCwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgc2VsZi5kZXRlcm1pbmVEb3dubG9hZFJhdGUoKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gRG93bmxvYWRSYXRlTWFuYWdlcihkb3dubG9hZFJhdGVSdWxlcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoaXNBcnJheShkb3dubG9hZFJhdGVSdWxlcykpIHsgdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzID0gZG93bmxvYWRSYXRlUnVsZXM7IH1cbiAgICBlbHNlIGlmICghIWRvd25sb2FkUmF0ZVJ1bGVzKSB7IHRoaXMuX19kb3dubG9hZFJhdGVSdWxlcyA9IFtkb3dubG9hZFJhdGVSdWxlc107IH1cbiAgICBlbHNlIHsgdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzID0gW107IH1cbiAgICAvL3RoaXMuX19kb3dubG9hZFJhdGVSdWxlcyA9IGlzQXJyYXkoZG93bmxvYWRSYXRlUnVsZXMpIHx8IFtdO1xuICAgIHRoaXMuX19kb3dubG9hZFJhdGVSdWxlcy5mb3JFYWNoKGZ1bmN0aW9uKHJ1bGUpIHtcbiAgICAgICAgYWRkRXZlbnRIYW5kbGVyVG9SdWxlKHNlbGYsIHJ1bGUpO1xuICAgIH0pO1xuICAgIHRoaXMuX19sYXN0RG93bmxvYWRSYXRlID0gdGhpcy5kb3dubG9hZFJhdGVzLkRPTlRfRE9XTkxPQUQ7XG4gICAgdGhpcy5kZXRlcm1pbmVEb3dubG9hZFJhdGUoKTtcbn1cblxuRG93bmxvYWRSYXRlTWFuYWdlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0gZXZlbnRMaXN0O1xuXG5Eb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZS5kb3dubG9hZFJhdGVzID0gZG93bmxvYWRSYXRlcztcblxuRG93bmxvYWRSYXRlTWFuYWdlci5wcm90b3R5cGUuZGV0ZXJtaW5lRG93bmxvYWRSYXRlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBjdXJyZW50RG93bmxvYWRSYXRlLFxuICAgICAgICBmaW5hbERvd25sb2FkUmF0ZSA9IGRvd25sb2FkUmF0ZXMuRE9OVF9ET1dOTE9BRDtcblxuICAgIC8vIFRPRE86IE1ha2UgcmVsYXRpb25zaGlwIGJldHdlZW4gcnVsZXMgc21hcnRlciBvbmNlIHdlIGltcGxlbWVudCBtdWx0aXBsZSBydWxlcy5cbiAgICBzZWxmLl9fZG93bmxvYWRSYXRlUnVsZXMuZm9yRWFjaChmdW5jdGlvbihkb3dubG9hZFJhdGVSdWxlKSB7XG4gICAgICAgIGN1cnJlbnREb3dubG9hZFJhdGUgPSBkb3dubG9hZFJhdGVSdWxlLmdldERvd25sb2FkUmF0ZSgpO1xuICAgICAgICBpZiAoY3VycmVudERvd25sb2FkUmF0ZSA+IGZpbmFsRG93bmxvYWRSYXRlKSB7IGZpbmFsRG93bmxvYWRSYXRlID0gY3VycmVudERvd25sb2FkUmF0ZTsgfVxuICAgIH0pO1xuXG4gICAgaWYgKGZpbmFsRG93bmxvYWRSYXRlICE9PSBzZWxmLl9fbGFzdERvd25sb2FkUmF0ZSkge1xuICAgICAgICBzZWxmLl9fbGFzdERvd25sb2FkUmF0ZSA9IGZpbmFsRG93bmxvYWRSYXRlO1xuICAgICAgICBzZWxmLnRyaWdnZXIoe1xuICAgICAgICAgICAgdHlwZTpzZWxmLmV2ZW50TGlzdC5ET1dOTE9BRF9SQVRFX0NIQU5HRUQsXG4gICAgICAgICAgICB0YXJnZXQ6c2VsZixcbiAgICAgICAgICAgIGRvd25sb2FkUmF0ZTpzZWxmLl9fbGFzdERvd25sb2FkUmF0ZVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmluYWxEb3dubG9hZFJhdGU7XG59O1xuXG5Eb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZS5hZGREb3dubG9hZFJhdGVSdWxlID0gZnVuY3Rpb24oZG93bmxvYWRSYXRlUnVsZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9fZG93bmxvYWRSYXRlUnVsZXMucHVzaChkb3dubG9hZFJhdGVSdWxlKTtcbiAgICBhZGRFdmVudEhhbmRsZXJUb1J1bGUoc2VsZiwgZG93bmxvYWRSYXRlUnVsZSk7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChEb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERvd25sb2FkUmF0ZU1hbmFnZXI7IiwidmFyIGV2ZW50TGlzdCA9IHtcbiAgICBET1dOTE9BRF9SQVRFX0NIQU5HRUQ6ICdkb3dubG9hZFJhdGVDaGFuZ2VkJ1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBldmVudExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZG93bmxvYWRSYXRlcyA9IHtcbiAgICBET05UX0RPV05MT0FEOiAwLFxuICAgIFBMQVlCQUNLX1JBVEU6IDEwMDAsXG4gICAgRE9XTkxPQURfUkFURTogMTAwMDBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZG93bmxvYWRSYXRlczsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi8uLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgZG93bmxvYWRSYXRlcyA9IHJlcXVpcmUoJy4vRG93bmxvYWRSYXRlcy5qcycpLFxuICAgIGV2ZW50TGlzdCA9IHJlcXVpcmUoJy4vRG93bmxvYWRSYXRlRXZlbnRUeXBlcy5qcycpLFxuICAgIGRvd25sb2FkQW5kUGxheWJhY2tFdmVudHMgPSBbXG4gICAgICAgICdsb2Fkc3RhcnQnLFxuICAgICAgICAnZHVyYXRpb25jaGFuZ2UnLFxuICAgICAgICAnbG9hZGVkbWV0YWRhdGEnLFxuICAgICAgICAnbG9hZGVkZGF0YScsXG4gICAgICAgICdwcm9ncmVzcycsXG4gICAgICAgICdjYW5wbGF5JyxcbiAgICAgICAgJ2NhbnBsYXl0aHJvdWdoJ1xuICAgIF0sXG4gICAgcmVhZHlTdGF0ZXMgPSB7XG4gICAgICAgIEhBVkVfTk9USElORzogMCxcbiAgICAgICAgSEFWRV9NRVRBREFUQTogMSxcbiAgICAgICAgSEFWRV9DVVJSRU5UX0RBVEE6IDIsXG4gICAgICAgIEhBVkVfRlVUVVJFX0RBVEE6IDMsXG4gICAgICAgIEhBVkVfRU5PVUdIX0RBVEE6IDRcbiAgICB9O1xuXG5mdW5jdGlvbiBnZXRSZWFkeVN0YXRlKHRlY2gpIHtcbiAgICByZXR1cm4gdGVjaC5lbCgpLnJlYWR5U3RhdGU7XG59XG5cbmZ1bmN0aW9uIFZpZGVvUmVhZHlTdGF0ZVJ1bGUodGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBUT0RPOiBOdWxsL3R5cGUgY2hlY2tcbiAgICB0aGlzLl9fdGVjaCA9IHRlY2g7XG4gICAgdGhpcy5fX2Rvd25sb2FkUmF0ZSA9IHRoaXMuZG93bmxvYWRSYXRlcy5ET05UX0RPV05MT0FEO1xuXG4gICAgZnVuY3Rpb24gZGV0ZXJtaW5lRG93bmxvYWRSYXRlKCkge1xuICAgICAgICB2YXIgZG93bmxvYWRSYXRlID0gKGdldFJlYWR5U3RhdGUoc2VsZi5fX3RlY2gpID09PSByZWFkeVN0YXRlcy5IQVZFX0VOT1VHSF9EQVRBKSA/XG4gICAgICAgICAgICBzZWxmLmRvd25sb2FkUmF0ZXMuUExBWUJBQ0tfUkFURSA6XG4gICAgICAgICAgICBzZWxmLmRvd25sb2FkUmF0ZXMuRE9XTkxPQURfUkFURTtcbiAgICAgICAgcmV0dXJuIGRvd25sb2FkUmF0ZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVEb3dubG9hZFJhdGUoKSB7XG4gICAgICAgIHZhciBuZXdEb3dubG9hZFJhdGUgPSBkZXRlcm1pbmVEb3dubG9hZFJhdGUoKTtcbiAgICAgICAgaWYgKHNlbGYuX19kb3dubG9hZFJhdGUgIT09IG5ld0Rvd25sb2FkUmF0ZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0RPV05MT0FEIFJBVEUgQ0hBTkdFRCBUTzogJyArIG5ld0Rvd25sb2FkUmF0ZSk7XG4gICAgICAgICAgICBzZWxmLl9fZG93bmxvYWRSYXRlID0gbmV3RG93bmxvYWRSYXRlO1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHtcbiAgICAgICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX1JBVEVfQ0hBTkdFRCxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6c2VsZixcbiAgICAgICAgICAgICAgICBkb3dubG9hZFJhdGU6c2VsZi5fX2Rvd25sb2FkUmF0ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBkb3dubG9hZEFuZFBsYXliYWNrRXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZXZlbnROYW1lKSB7XG4gICAgICAgIHRlY2gub24oZXZlbnROYW1lLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHVwZGF0ZURvd25sb2FkUmF0ZSgpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIHVwZGF0ZURvd25sb2FkUmF0ZSgpO1xufVxuXG5WaWRlb1JlYWR5U3RhdGVSdWxlLnByb3RvdHlwZS5ldmVudExpc3QgPSBldmVudExpc3Q7XG5cbi8vIFZhbHVlIE1lYW5pbmdzOlxuLy9cbi8vIERPTlRfRE9XTkxPQUQgLSAgU2hvdWxkIG5vdCBkb3dubG9hZCBzZWdtZW50cy5cbi8vIFBMQVlCQUNLX1JBVEUgLSAgRG93bmxvYWQgdGhlIG5leHQgc2VnbWVudCBhdCB0aGUgcmF0ZSBpdCB0YWtlcyB0byBjb21wbGV0ZSBwbGF5YmFjayBvZiB0aGUgcHJldmlvdXMgc2VnbWVudC5cbi8vICAgICAgICAgICAgICAgICAgSW4gb3RoZXIgd29yZHMsIG9uY2UgdGhlIGRhdGEgZm9yIHRoZSBjdXJyZW50IHNlZ21lbnQgaGFzIGJlZW4gZG93bmxvYWRlZCxcbi8vICAgICAgICAgICAgICAgICAgd2FpdCB1bnRpbCBzZWdtZW50LmdldER1cmF0aW9uKCkgc2Vjb25kcyBvZiBzdHJlYW0gcGxheWJhY2sgaGF2ZSBlbGFwc2VkIGJlZm9yZSBzdGFydGluZyB0aGVcbi8vICAgICAgICAgICAgICAgICAgZG93bmxvYWQgb2YgdGhlIG5leHQgc2VnbWVudC5cbi8vIERPV05MT0FEX1JBVEUgLSAgRG93bmxvYWQgdGhlIG5leHQgc2VnbWVudCBvbmNlIHRoZSBwcmV2aW91cyBzZWdtZW50IGhhcyBmaW5pc2hlZCBkb3dubG9hZGluZy5cblZpZGVvUmVhZHlTdGF0ZVJ1bGUucHJvdG90eXBlLmRvd25sb2FkUmF0ZXMgPSBkb3dubG9hZFJhdGVzO1xuXG5WaWRlb1JlYWR5U3RhdGVSdWxlLnByb3RvdHlwZS5nZXREb3dubG9hZFJhdGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX2Rvd25sb2FkUmF0ZTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFZpZGVvUmVhZHlTdGF0ZVJ1bGUucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlkZW9SZWFkeVN0YXRlUnVsZTsiLCJcbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIGlzTnVtYmVyID0gcmVxdWlyZSgnLi4vdXRpbC9pc051bWJlci5qcycpLFxuICAgIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBsb2FkU2VnbWVudCxcbiAgICBERUZBVUxUX1JFVFJZX0NPVU5UID0gMyxcbiAgICBERUZBVUxUX1JFVFJZX0lOVEVSVkFMID0gMjUwO1xuXG5sb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQsIHJldHJ5SW50ZXJ2YWwpIHtcbiAgICB2YXIgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpLFxuICAgICAgICB1cmwgPSBzZWdtZW50LmdldFVybCgpO1xuICAgIHJlcXVlc3Qub3BlbignR0VUJywgdXJsLCB0cnVlKTtcbiAgICByZXF1ZXN0LnJlc3BvbnNlVHlwZSA9ICdhcnJheWJ1ZmZlcic7XG5cbiAgICByZXF1ZXN0Lm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAocmVxdWVzdC5zdGF0dXMgPCAyMDAgfHwgcmVxdWVzdC5zdGF0dXMgPiAyOTkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gbG9hZCBTZWdtZW50IEAgVVJMOiAnICsgc2VnbWVudC5nZXRVcmwoKSk7XG4gICAgICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBsb2FkU2VnbWVudChzZWdtZW50LCBjYWxsYmFja0ZuLCByZXRyeUNvdW50IC0gMSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGQUlMRUQgVE8gTE9BRCBTRUdNRU5UIEVWRU4gQUZURVIgUkVUUklFUycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFja0ZuID09PSAnZnVuY3Rpb24nKSB7IGNhbGxiYWNrRm4ocmVxdWVzdC5yZXNwb25zZSk7IH1cbiAgICB9O1xuICAgIC8vcmVxdWVzdC5vbmVycm9yID0gcmVxdWVzdC5vbmxvYWRlbmQgPSBmdW5jdGlvbigpIHtcbiAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50KHNlZ21lbnQsIGNhbGxiYWNrRm4sIHJldHJ5Q291bnQgLSAxLCByZXRyeUludGVydmFsKTtcbiAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZBSUxFRCBUTyBMT0FEIFNFR01FTlQgRVZFTiBBRlRFUiBSRVRSSUVTJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH07XG5cbiAgICByZXF1ZXN0LnNlbmQoKTtcbn07XG5cbmZ1bmN0aW9uIFNlZ21lbnRMb2FkZXIobWFuaWZlc3QsIG1lZGlhVHlwZSkge1xuICAgIGlmICghZXhpc3R5KG1hbmlmZXN0KSkgeyB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXIgbXVzdCBiZSBpbml0aWFsaXplZCB3aXRoIGEgbWFuaWZlc3QhJyk7IH1cbiAgICBpZiAoIWV4aXN0eShtZWRpYVR5cGUpKSB7IHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlciBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYSBtZWRpYVR5cGUhJyk7IH1cbiAgICB0aGlzLl9fbWFuaWZlc3QgPSBtYW5pZmVzdDtcbiAgICB0aGlzLl9fbWVkaWFUeXBlID0gbWVkaWFUeXBlO1xuICAgIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCk7XG4gICAgdGhpcy5fX2N1cnJlbnRGcmFnbWVudE51bWJlciA9IHRoaXMuZ2V0U3RhcnROdW1iZXIoKTtcbn1cblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIElOSVRJQUxJWkFUSU9OX0xPQURFRDogJ2luaXRpYWxpemF0aW9uTG9hZGVkJyxcbiAgICBTRUdNRU5UX0xPQURFRDogJ3NlZ21lbnRMb2FkZWQnXG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5fX2dldE1lZGlhU2V0ID0gZnVuY3Rpb24gZ2V0TWVkaWFTZXQoKSB7XG4gICAgdmFyIG1lZGlhU2V0ID0gdGhpcy5fX21hbmlmZXN0LmdldE1lZGlhU2V0QnlUeXBlKHRoaXMuX19tZWRpYVR5cGUpO1xuICAgIHJldHVybiBtZWRpYVNldDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0RGVmYXVsdEZyYWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldERlZmF1bHRGcmFnbWVudExpc3QoKSB7XG4gICAgdmFyIGZyYWdtZW50TGlzdCA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldEZyYWdtZW50TGlzdHMoKVswXTtcbiAgICByZXR1cm4gZnJhZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRCYW5kd2lkdGgoKSB7XG4gICAgaWYgKCFpc051bWJlcih0aGlzLl9fY3VycmVudEJhbmR3aWR0aCkpIHsgdGhpcy5fX2N1cnJlbnRCYW5kd2lkdGggPSB0aGlzLl9fZ2V0RGVmYXVsdEZyYWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpOyB9XG4gICAgcmV0dXJuIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuc2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIHNldEN1cnJlbnRCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgaWYgKCFpc051bWJlcihiYW5kd2lkdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIGV4cGVjdHMgYSBudW1lcmljIHZhbHVlIGZvciBiYW5kd2lkdGghJyk7XG4gICAgfVxuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgaWYgKGF2YWlsYWJsZUJhbmR3aWR0aHMuaW5kZXhPZihiYW5kd2lkdGgpIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBtdXN0IGJlIHNldCB0byBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXM6ICcgKyBhdmFpbGFibGVCYW5kd2lkdGhzLmpvaW4oJywgJykpO1xuICAgIH1cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IGJhbmR3aWR0aDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRGcmFnbWVudExpc3QgPSBmdW5jdGlvbiBnZXRDdXJyZW50RnJhZ21lbnRMaXN0KCkge1xuICAgIHZhciBmcmFnbWVudExpc3QgPSAgdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0RnJhZ21lbnRMaXN0QnlCYW5kd2lkdGgodGhpcy5nZXRDdXJyZW50QmFuZHdpZHRoKCkpO1xuICAgIHJldHVybiBmcmFnbWVudExpc3Q7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGF2YWlsYWJsZUJhbmR3aWR0aHMgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgcmV0dXJuIGF2YWlsYWJsZUJhbmR3aWR0aHM7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRTdGFydE51bWJlciA9IGZ1bmN0aW9uIGdldFN0YXJ0TnVtYmVyKCkge1xuICAgIHZhciBzdGFydE51bWJlciA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldEZyYWdtZW50TGlzdFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHN0YXJ0TnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudEZyYWdtZW50ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGZyYWdtZW50ID0gdGhpcy5nZXRDdXJyZW50RnJhZ21lbnRMaXN0KCkuZ2V0U2VnbWVudEJ5TnVtYmVyKHRoaXMuX19jdXJyZW50RnJhZ21lbnROdW1iZXIpO1xuICAgIHJldHVybiBmcmFnbWVudDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRGcmFnbWVudE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRGcmFnbWVudE51bWJlcjsgfTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0RW5kTnVtYmVyID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGVuZE51bWJlciA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldEZyYWdtZW50TGlzdEVuZE51bWJlcigpO1xuICAgIHJldHVybiBlbmROdW1iZXI7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkSW5pdGlhbGl6YXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGZyYWdtZW50TGlzdCA9IHRoaXMuZ2V0Q3VycmVudEZyYWdtZW50TGlzdCgpLFxuICAgICAgICBpbml0aWFsaXphdGlvbiA9IGZyYWdtZW50TGlzdC5nZXRJbml0aWFsaXphdGlvbigpO1xuXG4gICAgaWYgKCFpbml0aWFsaXphdGlvbikgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgaW5pdGlhbGl6YXRpb24sIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciBpbml0U2VnbWVudCA9IG5ldyBVaW50OEFycmF5KHJlc3BvbnNlKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50fSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIFRPRE86IERldGVybWluZSBob3cgdG8gcGFyYW1ldGVyaXplIGJ5IHJlcHJlc2VudGF0aW9uIHZhcmlhbnRzIChiYW5kd2lkdGgvYml0cmF0ZT8gcmVwcmVzZW50YXRpb24gb2JqZWN0PyBpbmRleD8pXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkTmV4dFNlZ21lbnQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9DdXJyZW50U2VnbWVudE51bWJlciA9ICgodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID09PSBudWxsKSB8fCAodGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyID09PSB1bmRlZmluZWQpKSxcbiAgICAgICAgbnVtYmVyID0gbm9DdXJyZW50U2VnbWVudE51bWJlciA/IDAgOiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgKyAxO1xuICAgIHJldHVybiB0aGlzLmxvYWRTZWdtZW50QXROdW1iZXIobnVtYmVyKTtcbn07XG5cbi8vIFRPRE86IER1cGxpY2F0ZSBjb2RlIGJlbG93LiBBYnN0cmFjdCBhd2F5LlxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdE51bWJlciA9IGZ1bmN0aW9uKG51bWJlcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIGlmIChudW1iZXIgPiB0aGlzLmdldEVuZE51bWJlcigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIGZyYWdtZW50ID0gdGhpcy5nZXRDdXJyZW50RnJhZ21lbnRMaXN0KCkuZ2V0U2VnbWVudEJ5TnVtYmVyKG51bWJlcik7XG5cbiAgICBsb2FkU2VnbWVudC5jYWxsKHRoaXMsIGZyYWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBmcmFnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTppbml0U2VnbWVudCB9KTtcbiAgICB9LCBERUZBVUxUX1JFVFJZX0NPVU5ULCBERUZBVUxUX1JFVFJZX0lOVEVSVkFMKTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdFRpbWUgPSBmdW5jdGlvbihwcmVzZW50YXRpb25UaW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBmcmFnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRGcmFnbWVudExpc3QoKTtcblxuICAgIGlmIChwcmVzZW50YXRpb25UaW1lID4gZnJhZ21lbnRMaXN0LmdldFRvdGFsRHVyYXRpb24oKSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIHZhciBmcmFnbWVudCA9IHRoaXMuZ2V0Q3VycmVudEZyYWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeVRpbWUocHJlc2VudGF0aW9uVGltZSk7XG5cbiAgICBsb2FkU2VnbWVudC5jYWxsKHRoaXMsIGZyYWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBmcmFnbWVudC5nZXROdW1iZXIoKTtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCB0YXJnZXQ6c2VsZiwgZGF0YTppbml0U2VnbWVudH0pO1xuICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTZWdtZW50TG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpO1xuXG4vLyBUT0RPOiBUaGlzIGxvZ2ljIHNob3VsZCBiZSBpbiBtc2UuanNcbmZ1bmN0aW9uIGFwcGVuZEJ5dGVzKGJ1ZmZlciwgYnl0ZXMpIHtcbiAgICBpZiAoJ2FwcGVuZCcgaW4gYnVmZmVyKSB7XG4gICAgICAgIGJ1ZmZlci5hcHBlbmQoYnl0ZXMpO1xuICAgIH0gZWxzZSBpZiAoJ2FwcGVuZEJ1ZmZlcicgaW4gYnVmZmVyKSB7XG4gICAgICAgIGJ1ZmZlci5hcHBlbmRCdWZmZXIoYnl0ZXMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gU291cmNlQnVmZmVyRGF0YVF1ZXVlKHNvdXJjZUJ1ZmZlcikge1xuICAgIC8vIFRPRE86IENoZWNrIHR5cGU/XG4gICAgaWYgKCFzb3VyY2VCdWZmZXIpIHsgdGhyb3cgbmV3IEVycm9yKCAnVGhlIHNvdXJjZUJ1ZmZlciBjb25zdHJ1Y3RvciBhcmd1bWVudCBjYW5ub3QgYmUgbnVsbC4nICk7IH1cblxuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgZGF0YVF1ZXVlID0gW107XG4gICAgLy8gVE9ETzogZmlndXJlIG91dCBob3cgd2Ugd2FudCB0byByZXNwb25kIHRvIG90aGVyIGV2ZW50IHN0YXRlcyAodXBkYXRlZW5kPyBlcnJvcj8gYWJvcnQ/KSAocmV0cnk/IHJlbW92ZT8pXG4gICAgc291cmNlQnVmZmVyLmFkZEV2ZW50TGlzdGVuZXIoJ3VwZGF0ZWVuZCcsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgLy8gVGhlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZSdzIHVwZGF0aW5nIHByb3BlcnR5IHNob3VsZCBhbHdheXMgYmUgZmFsc2UgaWYgdGhpcyBldmVudCB3YXMgZGlzcGF0Y2hlZCxcbiAgICAgICAgLy8gYnV0IGp1c3QgaW4gY2FzZS4uLlxuICAgICAgICBpZiAoZS50YXJnZXQudXBkYXRpbmcpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5TRUdNRU5UX0FEREVEX1RPX0JVRkZFUiwgdGFyZ2V0OnNlbGYgfSk7XG5cbiAgICAgICAgaWYgKGRhdGFRdWV1ZS5sZW5ndGggPD0gMCkge1xuICAgICAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgdGFyZ2V0OnNlbGYgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhcHBlbmRCeXRlcyhlLnRhcmdldCwgZGF0YVF1ZXVlLnNoaWZ0KCkpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5fX2RhdGFRdWV1ZSA9IGRhdGFRdWV1ZTtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyID0gc291cmNlQnVmZmVyO1xufVxuXG4vLyBUT0RPOiBBZGQgYXMgXCJjbGFzc1wiIHByb3BlcnRpZXM/XG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmV2ZW50TGlzdCA9IHtcbiAgICBRVUVVRV9FTVBUWTogJ3F1ZXVlRW1wdHknLFxuICAgIFNFR01FTlRfQURERURfVE9fQlVGRkVSOiAnc2VnbWVudEFkZGVkVG9CdWZmZXInXG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmFkZFRvUXVldWUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgZm9yIGV4aXN0ZW5jZS90eXBlPyBDb252ZXJ0IHRvIFVpbnQ4QXJyYXkgZXh0ZXJuYWxseSBvciBpbnRlcm5hbGx5PyAoQ3VycmVudGx5IGFzc3VtaW5nIGV4dGVybmFsKVxuICAgIC8vIElmIG5vdGhpbmcgaXMgaW4gdGhlIHF1ZXVlLCBnbyBhaGVhZCBhbmQgaW1tZWRpYXRlbHkgYXBwZW5kIHRoZSBzZWdtZW50IGRhdGEgdG8gdGhlIHNvdXJjZSBidWZmZXIuXG4gICAgaWYgKCh0aGlzLl9fZGF0YVF1ZXVlLmxlbmd0aCA9PT0gMCkgJiYgKCF0aGlzLl9fc291cmNlQnVmZmVyLnVwZGF0aW5nKSkgeyBhcHBlbmRCeXRlcyh0aGlzLl9fc291cmNlQnVmZmVyLCBkYXRhKTsgfVxuICAgIC8vIE90aGVyd2lzZSwgcHVzaCBvbnRvIHF1ZXVlIGFuZCB3YWl0IGZvciB0aGUgbmV4dCB1cGRhdGUgZXZlbnQgYmVmb3JlIGFwcGVuZGluZyBzZWdtZW50IGRhdGEgdG8gc291cmNlIGJ1ZmZlci5cbiAgICBlbHNlIHsgdGhpcy5fX2RhdGFRdWV1ZS5wdXNoKGRhdGEpOyB9XG59O1xuXG5Tb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLmNsZWFyUXVldWUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gW107XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTb3VyY2VCdWZmZXJEYXRhUXVldWUucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gU291cmNlQnVmZmVyRGF0YVF1ZXVlOyIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gZXhpc3R5KHgpIHsgcmV0dXJuICh4ICE9PSBudWxsKSAmJiAoeCAhPT0gdW5kZWZpbmVkKTsgfVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV4aXN0eTsiLCIndXNlIHN0cmljdCc7XG5cbi8vIEV4dGVuZCBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgcHJvcGVydGllcyBpbiBwYXNzZWQtaW4gb2JqZWN0KHMpLlxudmFyIGV4dGVuZE9iamVjdCA9IGZ1bmN0aW9uKG9iaiAvKiwgZXh0ZW5kT2JqZWN0MSwgZXh0ZW5kT2JqZWN0MiwgLi4uLCBleHRlbmRPYmplY3ROICovKSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKS5mb3JFYWNoKGZ1bmN0aW9uKGV4dGVuZE9iamVjdCkge1xuICAgICAgICBpZiAoZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV4dGVuZE9iamVjdCkge1xuICAgICAgICAgICAgICAgIG9ialtwcm9wXSA9IGV4dGVuZE9iamVjdFtwcm9wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBvYmo7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZE9iamVjdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNBcnJheShvYmopIHtcbiAgICByZXR1cm4gb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJztcbiAgICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzRnVuY3Rpb247IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IE51bWJlcl0nIHx8IGZhbHNlO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzTnVtYmVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG52YXIgaXNTdHJpbmcgPSBmdW5jdGlvbiBpc1N0cmluZyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBTdHJpbmddJyB8fCBmYWxzZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gaXNTdHJpbmc7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXhpc3R5ID0gcmVxdWlyZSgnLi9leGlzdHkuanMnKTtcblxuLy8gTk9URTogVGhpcyB2ZXJzaW9uIG9mIHRydXRoeSBhbGxvd3MgbW9yZSB2YWx1ZXMgdG8gY291bnRcbi8vIGFzIFwidHJ1ZVwiIHRoYW4gc3RhbmRhcmQgSlMgQm9vbGVhbiBvcGVyYXRvciBjb21wYXJpc29ucy5cbi8vIFNwZWNpZmljYWxseSwgdHJ1dGh5KCkgd2lsbCByZXR1cm4gdHJ1ZSBmb3IgdGhlIHZhbHVlc1xuLy8gMCwgXCJcIiwgYW5kIE5hTiwgd2hlcmVhcyBKUyB3b3VsZCB0cmVhdCB0aGVzZSBhcyBcImZhbHN5XCIgdmFsdWVzLlxuZnVuY3Rpb24gdHJ1dGh5KHgpIHsgcmV0dXJuICh4ICE9PSBmYWxzZSkgJiYgZXhpc3R5KHgpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gdHJ1dGh5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gTk9URTogVEFLRU4gRlJPTSBMT0RBU0ggVE8gUkVNT1ZFIERFUEVOREVOQ1lcbi8qKiBgT2JqZWN0I3RvU3RyaW5nYCByZXN1bHQgc2hvcnRjdXRzICovXG52YXIgZnVuY0NsYXNzID0gJ1tvYmplY3QgRnVuY3Rpb25dJyxcbiAgICBzdHJpbmdDbGFzcyA9ICdbb2JqZWN0IFN0cmluZ10nO1xuXG4vKiogVXNlZCB0byByZXNvbHZlIHRoZSBpbnRlcm5hbCBbW0NsYXNzXV0gb2YgdmFsdWVzICovXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG52YXIgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xufTtcbi8vIGZhbGxiYWNrIGZvciBvbGRlciB2ZXJzaW9ucyBvZiBDaHJvbWUgYW5kIFNhZmFyaVxuaWYgKGlzRnVuY3Rpb24oL3gvKSkge1xuICAgIGlzRnVuY3Rpb24gPSBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nICYmIHRvU3RyaW5nLmNhbGwodmFsdWUpID09PSBmdW5jQ2xhc3M7XG4gICAgfTtcbn1cblxudmFyIGlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHRvU3RyaW5nLmNhbGwodmFsdWUpID09PSBzdHJpbmdDbGFzcyB8fCBmYWxzZTtcbn07XG5cbi8vIE5PVEU6IEVORCBPRiBMT0RBU0gtQkFTRUQgQ09ERVxuXG4vLyBHZW5lcmFsIFV0aWxpdHkgRnVuY3Rpb25zXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4geCAhPT0gbnVsbDsgfVxuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxuZnVuY3Rpb24gcHJlQXBwbHlBcmdzRm4oZnVuIC8qLCBhcmdzICovKSB7XG4gICAgdmFyIHByZUFwcGxpZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAvLyBOT1RFOiB0aGUgKnRoaXMqIHJlZmVyZW5jZSB3aWxsIHJlZmVyIHRvIHRoZSBjbG9zdXJlJ3MgY29udGV4dCB1bmxlc3NcbiAgICAvLyB0aGUgcmV0dXJuZWQgZnVuY3Rpb24gaXMgaXRzZWxmIGNhbGxlZCB2aWEgLmNhbGwoKSBvciAuYXBwbHkoKS4gSWYgeW91XG4gICAgLy8gKm5lZWQqIHRvIHJlZmVyIHRvIGluc3RhbmNlLWxldmVsIHByb3BlcnRpZXMsIGRvIHNvbWV0aGluZyBsaWtlIHRoZSBmb2xsb3dpbmc6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IGZ1bmN0aW9uKGFyZ0MpIHsgcHJlQXBwbHlBcmdzRm4oc29tZU90aGVyRm4sIGFyZ0EsIGFyZ0IsIC4uLiBhcmdOKS5jYWxsKHRoaXMpOyB9O1xuICAgIC8vXG4gICAgLy8gT3RoZXJ3aXNlLCB5b3Ugc2hvdWxkIGJlIGFibGUgdG8ganVzdCBjYWxsOlxuICAgIC8vXG4gICAgLy8gTXlUeXBlLnByb3RvdHlwZS5zb21lRm4gPSBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pO1xuICAgIC8vXG4gICAgLy8gV2hlcmUgcG9zc2libGUsIGZ1bmN0aW9ucyBhbmQgbWV0aG9kcyBzaG91bGQgbm90IGJlIHJlYWNoaW5nIG91dCB0byBnbG9iYWwgc2NvcGUgYW55d2F5LCBzby4uLlxuICAgIHJldHVybiBmdW5jdGlvbigpIHsgcmV0dXJuIGZ1bi5hcHBseSh0aGlzLCBwcmVBcHBsaWVkQXJncyk7IH07XG59XG5cbi8vIEhpZ2hlci1vcmRlciBYTUwgZnVuY3Rpb25zXG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50c1xudmFyIGdldEFuY2VzdG9ycyA9IGZ1bmN0aW9uKGVsZW0sIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgKGZ1bmN0aW9uIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoc2hvdWxkU3RvcFByZWQoZWxlbSwgYW5jZXN0b3JzKSkgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKGV4aXN0eShlbGVtKSAmJiBleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkge1xuICAgICAgICAgICAgYW5jZXN0b3JzLnB1c2goZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgICAgIGdldEFuY2VzdG9yc1JlY3Vyc2UoZWxlbS5wYXJlbnROb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfSkoZWxlbSk7XG4gICAgcmV0dXJuIGFuY2VzdG9ycztcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBnZXROb2RlTGlzdEJ5TmFtZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oeG1sT2JqKSB7XG4gICAgICAgIHJldHVybiB4bWxPYmouZ2V0RWxlbWVudHNCeVRhZ05hbWUobmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbnZhciBoYXNNYXRjaGluZ0F0dHJpYnV0ZSA9IGZ1bmN0aW9uKGF0dHJOYW1lLCB2YWx1ZSkge1xuICAgIGlmICgodHlwZW9mIGF0dHJOYW1lICE9PSAnc3RyaW5nJykgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uaGFzQXR0cmlidXRlKSB8fCAhZXhpc3R5KGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgaWYgKCFleGlzdHkodmFsdWUpKSB7IHJldHVybiBlbGVtLmhhc0F0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgcmV0dXJuIChlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSkgPT09IHZhbHVlKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEF0dHJGbiA9IGZ1bmN0aW9uKGF0dHJOYW1lKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhdHRyTmFtZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFpc0Z1bmN0aW9uKGVsZW0uZ2V0QXR0cmlidXRlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfTtcbn07XG5cbi8vIFJldHVybnMgZnVuY3Rpb25cbi8vIFRPRE86IEFkZCBzaG91bGRTdG9wUHJlZCAoc2hvdWxkIGZ1bmN0aW9uIHNpbWlsYXJseSB0byBzaG91bGRTdG9wUHJlZCBpbiBnZXRJbmhlcml0YWJsZUVsZW1lbnQsIGJlbG93KVxudmFyIGdldEluaGVyaXRhYmxlQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoKCFpc1N0cmluZyhhdHRyTmFtZSkpIHx8IGF0dHJOYW1lID09PSAnJykgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHJlY3Vyc2VDaGVja0FuY2VzdG9yQXR0cihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKSkgeyByZXR1cm4gZWxlbS5nZXRBdHRyaWJ1dGUoYXR0ck5hbWUpOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRha2VzIGZ1bmN0aW9uKHMpIGFzIGFyZ3VtZW50czsgUmV0dXJucyBmdW5jdGlvblxudmFyIGdldEluaGVyaXRhYmxlRWxlbWVudCA9IGZ1bmN0aW9uKG5vZGVOYW1lLCBzaG91bGRTdG9wUHJlZCkge1xuICAgIGlmICgoIWlzU3RyaW5nKG5vZGVOYW1lKSkgfHwgbm9kZU5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oc2hvdWxkU3RvcFByZWQpKSB7IHNob3VsZFN0b3BQcmVkID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfTsgfVxuICAgIHJldHVybiBmdW5jdGlvbiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHZhciBtYXRjaGluZ0VsZW1MaXN0ID0gZWxlbS5nZXRFbGVtZW50c0J5VGFnTmFtZShub2RlTmFtZSk7XG4gICAgICAgIGlmIChleGlzdHkobWF0Y2hpbmdFbGVtTGlzdCkgJiYgbWF0Y2hpbmdFbGVtTGlzdC5sZW5ndGggPiAwKSB7IHJldHVybiBtYXRjaGluZ0VsZW1MaXN0WzBdOyB9XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0ucGFyZW50Tm9kZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICByZXR1cm4gZ2V0SW5oZXJpdGFibGVFbGVtZW50UmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgIH07XG59O1xuXG4vLyBUT0RPOiBJbXBsZW1lbnQgbWUgZm9yIEJhc2VVUkwgb3IgdXNlIGV4aXN0aW5nIGZuIChTZWU6IG1wZC5qcyBidWlsZEJhc2VVcmwoKSlcbi8qdmFyIGJ1aWxkSGllcmFyY2hpY2FsbHlTdHJ1Y3R1cmVkVmFsdWUgPSBmdW5jdGlvbih2YWx1ZUZuLCBidWlsZEZuLCBzdG9wUHJlZCkge1xuXG59OyovXG5cbi8vIFB1Ymxpc2ggRXh0ZXJuYWwgQVBJOlxudmFyIHhtbGZ1biA9IHt9O1xueG1sZnVuLmV4aXN0eSA9IGV4aXN0eTtcbnhtbGZ1bi50cnV0aHkgPSB0cnV0aHk7XG5cbnhtbGZ1bi5nZXROb2RlTGlzdEJ5TmFtZSA9IGdldE5vZGVMaXN0QnlOYW1lO1xueG1sZnVuLmhhc01hdGNoaW5nQXR0cmlidXRlID0gaGFzTWF0Y2hpbmdBdHRyaWJ1dGU7XG54bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUgPSBnZXRJbmhlcml0YWJsZUF0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRBbmNlc3RvcnMgPSBnZXRBbmNlc3RvcnM7XG54bWxmdW4uZ2V0QXR0ckZuID0gZ2V0QXR0ckZuO1xueG1sZnVuLnByZUFwcGx5QXJnc0ZuID0gcHJlQXBwbHlBcmdzRm47XG54bWxmdW4uZ2V0SW5oZXJpdGFibGVFbGVtZW50ID0gZ2V0SW5oZXJpdGFibGVFbGVtZW50O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHhtbGZ1bjsiXX0=
