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

var MediaSource = require('./window.js').MediaSource,
    xmlfun = require('./xmlfun.js'),
    //URL = require('./window.js').URL,
    loadManifest = require('./manifest/loadManifest.js'),
    getMpd = require('./dash/mpd/getMpd.js'),
    getSegmentListForRepresentation = require('./dash/segments/getSegmentListForRepresentation.js'),
    SegmentLoader = require('./segments/SegmentLoader.js'),
    SourceBufferDataQueue = require('./sourceBuffer/SourceBufferDataQueue.js');

// TODO: Move this elsewhere (Where?)
function getSourceBufferTypeFromRepresentation(representationXml) {
    if (!representationXml) { return null; }
    var codecStr = representationXml.getAttribute('codecs');
    var typeStr = xmlfun.getInheritableAttribute('mimeType')(representationXml);

    //NOTE: LEADING ZEROS IN CODEC TYPE/SUBTYPE ARE TECHNICALLY NOT SPEC COMPLIANT, BUT GPAC & OTHER
    // DASH MPD GENERATORS PRODUCE THESE NON-COMPLIANT VALUES. HANDLING HERE FOR NOW.
    // See: RFC 6381 Sec. 3.4 (https://tools.ietf.org/html/rfc6381#section-3.4)
    var parsedCodec = codecStr.split('.').map(function(str) {
        return str.replace(/^0+(?!\.|$)/, '');
    });
    var processedCodecStr = parsedCodec.join('.');

    return (typeStr + ';codecs="' + processedCodecStr + '"');
}

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

function load(manifestXml, tech) {
    console.log('START');

    var mediaSource = new MediaSource(),
        openListener = function(event) {
            mediaSource.removeEventListener('sourceopen', openListener, false);
            kickoffSegmentLoading('video', manifestXml, mediaSource);
            kickoffSegmentLoading('audio', manifestXml, mediaSource);
        };

    mediaSource.addEventListener('sourceopen', openListener, false);

    // TODO: Handle close.
    //mediaSource.addEventListener('webkitsourceclose', closed, false);
    //mediaSource.addEventListener('sourceclose', closed, false);

    //mediaSourceExtensions.videoElementUtils.attachMediaSource(mediaSource, tech);
    tech.setSrc(URL.createObjectURL(mediaSource));
}

function kickoffSegmentLoading(segmentListType, manifestXml, mediaSource) {
    var adaptationSet = getMpd(manifestXml).getPeriods()[0].getAdaptationSetByType(segmentListType),
        segmentLoader = new SegmentLoader(adaptationSet),
        mimeType = getSourceBufferTypeFromRepresentation(segmentLoader.getCurrentRepresentation().xml),
        sourceBuffer = mediaSource.addSourceBuffer(mimeType),
        sourceBufferDataQueue = new SourceBufferDataQueue(sourceBuffer);

    var segmentList = getSegmentListForRepresentation(adaptationSet.getRepresentations()[0]);
    // NOTE: FOR VERIFICATION PURPOSES ONLY
    console.log('Type: ' + segmentListType);
    console.log('Total Duration: ' + segmentList.getTotalDuration());
    console.log('Segment Duration: ' + segmentList.getSegmentDuration());
    console.log('Total Segment Count: ' + segmentList.getTotalSegmentCount());
    console.log('Start Number: ' + segmentList.getStartNumber());
    console.log('End Number: ' + segmentList.getEndNumber());
    //console.log('MediaSource duration: ' + mediaSource.setDuration(segmentList.getTotalDuration()));

    loadInitialization(segmentLoader, sourceBufferDataQueue);
}

function SourceHandler(source, tech) {
    loadManifest(source.src, function(data) {
        load(data.manifestXml, tech);
    });
}

module.exports = SourceHandler;
},{"./dash/mpd/getMpd.js":5,"./dash/segments/getSegmentListForRepresentation.js":7,"./manifest/loadManifest.js":12,"./segments/SegmentLoader.js":13,"./sourceBuffer/SourceBufferDataQueue.js":14,"./window.js":16,"./xmlfun.js":17}],5:[function(require,module,exports){
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
},{"../../xmlfun.js":17,"./util.js":6}],6:[function(require,module,exports){
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

},{"../../xmlfun.js":17,"../mpd/util.js":6,"./segmentTemplate":8}],8:[function(require,module,exports){
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

var videojs = require('../window.js').videojs,
    eventManager = {
        trigger: videojs.trigger,
        one: videojs.one,
        on: videojs.on,
        off: videojs.off
    };

module.exports = eventManager;
},{"../window.js":16}],11:[function(require,module,exports){
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
},{"./SourceHandler":4,"./window":16,"mse.js/src/js/mse.js":2}],12:[function(require,module,exports){
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
},{"../dash/mpd/util.js":6}],13:[function(require,module,exports){

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
},{"../dash/segments/getSegmentListForRepresentation.js":7,"../events/EventDispatcherMixin.js":9,"../util/extendObject.js":15}],14:[function(require,module,exports){
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
},{"../events/EventDispatcherMixin.js":9,"../util/extendObject.js":15}],15:[function(require,module,exports){
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
},{}],16:[function(require,module,exports){
module.exports=require(3)
},{"/Users/cpillsbury/dev/JavaScript/VideoJSHtml5DashWorkspace/vjs-html5-dash/node_modules/mse.js/src/js/window.js":3}],17:[function(require,module,exports){
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
},{}]},{},[11]);
