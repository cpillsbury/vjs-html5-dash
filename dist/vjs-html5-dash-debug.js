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

function createStreamLoaderForType(manifestController, mediaSource, mediaType) {
    var segmentLoader = new SegmentLoader(manifestController, mediaType),
        sourceBufferDataQueue = createSourceBufferDataQueueByType(manifestController, mediaSource, mediaType);
    return new StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType);
}

function createStreamLoaders(manifestController, mediaSource) {
    var matchedTypes = mediaTypes.filter(function(mediaType) {
            var exists = existy(manifestController.getMediaSetByType(mediaType));
            return existy; }),
        streamLoaders = matchedTypes.map(function(mediaType) { return createStreamLoaderForType(manifestController, mediaSource, mediaType); });
    return streamLoaders;
}

function PlaylistLoader(manifestController, mediaSource, tech) {
    var self = this;
    this.__downloadRateMgr = new DownloadRateManager([new VideoReadyStateRule(tech)]);
    this.__streamLoaders = createStreamLoaders(manifestController, mediaSource);
    this.__streamLoaders.forEach(function(streamLoader) {
        /*tech.on('timeupdate', function(event) {
            console.log('Current Time: ' + event.target.currentTime);
        });*/
        loadInitialization(streamLoader.getSegmentLoader(), streamLoader.getSourceBufferDataQueue());
    });

    /*this.__downloadRateMgr.on(this.__downloadRateMgr.eventList.DOWNLOAD_RATE_CHANGED, function(event) {
        var self2 = self;
        console.log('Current Time: ' + tech.currentTime());
    });*/

    tech.on('seeked', function(event) {
        var hasData = false;
        console.log('Seeked Current Time: ' + tech.currentTime());
        self.__streamLoaders.forEach(function(streamLoader) {
            hasData = streamLoader.getSourceBufferDataQueue().hasBufferedDataForTime(tech.currentTime());
            console.log('Has Data @ Time? ' + hasData);
        });
    });

    tech.on('seeking', function(event) {
        var hasData = false;
        console.log('Seeking Current Time: ' + tech.currentTime());
        self.__streamLoaders.forEach(function(streamLoader) {
            hasData = streamLoader.getSourceBufferDataQueue().hasBufferedDataForTime(tech.currentTime());
            console.log('Has Data @ Time? ' + hasData);
        });
    });
}

module.exports = PlaylistLoader;
},{"./StreamLoader.js":4,"./dash/mpd/getMpd.js":5,"./manifest/MediaTypes.js":13,"./rules/DownloadRateManager.js":15,"./rules/downloadRate/VideoReadyStateRule.js":18,"./segments/SegmentLoader.js":19,"./sourceBuffer/SourceBufferDataQueue.js":20,"./util/existy.js":21}],3:[function(require,module,exports){
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

function StreamLoader(segmentLoader, sourceBufferDataQueue, mediaType) {
    this.__segmentLoader = segmentLoader;
    this.__sourceBufferDataQueue = sourceBufferDataQueue;
    this.__mediaType = mediaType;
}

StreamLoader.prototype.getMediaType = function() { return this.__mediaType; };

StreamLoader.prototype.getSegmentLoader = function() { return this.__segmentLoader; };

StreamLoader.prototype.getSourceBufferDataQueue = function() { return this.__sourceBufferDataQueue; };

StreamLoader.prototype.getCurrentSegmentNumber = function() { return this.__segmentLoader.getCurrentSegmentNumber(); };

StreamLoader.prototype.getLastDownloadRoundTripTimeSpan = function() {
    return this.__segmentLoader.getLastDownloadStartTime();
};

module.exports = StreamLoader;
},{}],5:[function(require,module,exports){
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
},{"../../xmlfun.js":28,"./util.js":6}],6:[function(require,module,exports){
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

},{"../../xmlfun.js":28,"../mpd/util.js":6,"./segmentTemplate":8}],8:[function(require,module,exports){
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
        self.__manifestController = data.manifestXml;
        self.__setupUpdateInterval();
        self.trigger({ type:self.eventList.MANIFEST_LOADED, target:self, data:self.__manifestController});
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
    var adaptationSets = getMpd(this.__manifestController).getPeriods()[0].getAdaptationSets(),
        adaptationSetWithTypeMatch = adaptationSets.find(function(adaptationSet) {
            return (getMediaTypeFromMimeType(adaptationSet.getMimeType(), mediaTypes) === type);
        });
    if (!existy(adaptationSetWithTypeMatch)) { return null; }
    return new MediaSet(adaptationSetWithTypeMatch);
};

Manifest.prototype.getMediaSets = function getMediaSets() {
    var adaptationSets = getMpd(this.__manifestController).getPeriods()[0].getAdaptationSets(),
        mediaSets = adaptationSets.map(function(adaptationSet) { return new MediaSet(adaptationSet); });
    return mediaSets;
};

Manifest.prototype.getStreamType = function getStreamType() {
    var streamType = getMpd(this.__manifestController).getType();
    return streamType;
};

Manifest.prototype.getUpdateRate = function getUpdateRate() {
    var minimumUpdatePeriod = getMpd(this.__manifestController).getMinimumUpdatePeriod();
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
            return representation.getBandwidth();
    }).filter(
        function(bandwidth) {
            return existy(bandwidth);
        }
    );
};

module.exports = Manifest;
},{"../dash/mpd/getMpd.js":5,"../dash/segments/getSegmentListForRepresentation.js":7,"../events/EventDispatcherMixin.js":9,"../util/existy.js":21,"../util/extendObject.js":22,"../util/isFunction.js":24,"../util/isString.js":26,"../util/truthy.js":27,"./MediaTypes.js":13,"./loadManifest.js":14}],13:[function(require,module,exports){
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
},{"../events/EventDispatcherMixin.js":9,"../util/extendObject.js":22,"../util/isArray.js":23,"./downloadRate/DownloadRateEventTypes.js":16,"./downloadRate/DownloadRates.js":17}],16:[function(require,module,exports){
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
},{"../../events/EventDispatcherMixin.js":9,"../../util/extendObject.js":22,"./DownloadRateEventTypes.js":16,"./DownloadRates.js":17}],19:[function(require,module,exports){

var existy = require('../util/existy.js'),
    isNumber = require('../util/isNumber.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    loadSegment,
    DEFAULT_RETRY_COUNT = 3,
    DEFAULT_RETRY_INTERVAL = 250;

loadSegment = function(segment, callbackFn, retryCount, retryInterval) {
    this.__lastDownloadStartTime = Number((new Date().getTime())/1000);
    this.__lastDownloadCompleteTime = null;

    var request = new XMLHttpRequest(),
        url = segment.getUrl();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';

    request.onload = function() {
        if (request.status < 200 || request.status > 299) {
            console.log('Failed to load Segment @ URL: ' + segment.getUrl());
            if (retryCount > 0) {
                setTimeout(function() {
                    loadSegment.call(this, segment, callbackFn, retryCount - 1, retryInterval);
                }, retryInterval);
            } else {
                console.log('FAILED TO LOAD SEGMENT EVEN AFTER RETRIES');
            }
            return;
        }

        this.__lastDownloadCompleteTime = Number((new Date().getTime())/1000);

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

function SegmentLoader(manifestController, mediaType) {
    if (!existy(manifestController)) { throw new Error('SegmentLoader must be initialized with a manifestController!'); }
    if (!existy(mediaType)) { throw new Error('SegmentLoader must be initialized with a mediaType!'); }
    this.__manifestController = manifestController;
    this.__mediaType = mediaType;
    this.__currentBandwidth = this.getCurrentBandwidth();
}

SegmentLoader.prototype.eventList = {
    INITIALIZATION_LOADED: 'initializationLoaded',
    SEGMENT_LOADED: 'segmentLoaded'
};

SegmentLoader.prototype.__getMediaSet = function getMediaSet() {
    var mediaSet = this.__manifestController.getMediaSetByType(this.__mediaType);
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
    var noCurrentSegmentNumber = ((this.__currentSegmentNumber === null) || (this.__currentSegmentNumber === undefined)),
        number = noCurrentSegmentNumber ? this.getStartNumber() : this.__currentSegmentNumber + 1;
    return this.loadSegmentAtNumber(number);
};

// TODO: Duplicate code below. Abstract away.
SegmentLoader.prototype.loadSegmentAtNumber = function(number) {
    var self = this;

    if (number > this.getEndNumber()) { return false; }

    var segment = this.getCurrentSegmentList().getSegmentByNumber(number);

    loadSegment.call(this, segment, function(response) {
        self.__currentSegmentNumber = segment.getNumber();
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:initSegment });
    }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);

    return true;
};

SegmentLoader.prototype.loadSegmentAtTime = function(presentationTime) {
    var self = this,
        segmentList = this.getCurrentSegmentList();

    if (presentationTime > segmentList.getTotalDuration()) { return false; }

    var segment = segmentList.getSegmentByTime(presentationTime);

    loadSegment.call(this, segment, function(response) {
        self.__currentSegmentNumber = segment.getNumber();
        var initSegment = new Uint8Array(response);
        self.trigger({ type:self.eventList.SEGMENT_LOADED, target:self, data:initSegment });
    }, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_INTERVAL);

    return true;
};

// Add event dispatcher functionality to prototype.
extendObject(SegmentLoader.prototype, EventDispatcherMixin);

module.exports = SegmentLoader;
},{"../events/EventDispatcherMixin.js":9,"../util/existy.js":21,"../util/extendObject.js":22,"../util/isNumber.js":25}],20:[function(require,module,exports){
'use strict';

var extendObject = require('../util/extendObject.js'),
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
    // TODO: Check for existence/type? Convert to Uint8Array externally or internally? (Currently assuming external)
    // If nothing is in the queue, go ahead and immediately append the segment data to the source buffer.
    if ((this.__dataQueue.length === 0) && (!this.__sourceBuffer.updating)) { this.__sourceBuffer.appendBuffer(data); }
    // Otherwise, push onto queue and wait for the next update event before appending segment data to source buffer.
    else { this.__dataQueue.push(data); }
};

SourceBufferDataQueue.prototype.clearQueue = function() {
    this.__dataQueue = [];
};

SourceBufferDataQueue.prototype.hasBufferedDataForTime = function(presentationTime) {
    var timeRanges = this.__sourceBuffer.buffered,
        timeRangesLength = timeRanges.length,
        i = 0,
        currentStartTime,
        currentEndTime;

    for (i; i<timeRangesLength; i++) {
        currentStartTime = timeRanges.start(i);
        currentEndTime = timeRanges.end(i);
        if ((presentationTime >= currentStartTime) && (presentationTime <= currentEndTime)) { return true; }
    }

    return false;
};

// Add event dispatcher functionality to prototype.
extendObject(SourceBufferDataQueue.prototype, EventDispatcherMixin);

module.exports = SourceBufferDataQueue;
},{"../events/EventDispatcherMixin.js":9,"../util/extendObject.js":22}],21:[function(require,module,exports){
'use strict';

function existy(x) { return (x !== null) && (x !== undefined); }

module.exports = existy;
},{}],22:[function(require,module,exports){
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
},{}],23:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isArray(obj) {
    return objectRef.toString.call(obj) === '[object Array]';
}

module.exports = isArray;
},{}],24:[function(require,module,exports){
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
},{}],25:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

function isNumber(value) {
    return typeof value === 'number' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object Number]' || false;
}

module.exports = isNumber;
},{}],26:[function(require,module,exports){
'use strict';

var genericObjType = function(){},
    objectRef = new genericObjType();

var isString = function isString(value) {
    return typeof value === 'string' ||
        value && typeof value === 'object' && objectRef.toString.call(value) === '[object String]' || false;
};

module.exports = isString;
},{}],27:[function(require,module,exports){
'use strict';

var existy = require('./existy.js');

// NOTE: This version of truthy allows more values to count
// as "true" than standard JS Boolean operator comparisons.
// Specifically, truthy() will return true for the values
// 0, "", and NaN, whereas JS would treat these as "falsy" values.
function truthy(x) { return (x !== false) && existy(x); }

module.exports = truthy;
},{"./existy.js":21}],28:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ2xvYmFsL3dpbmRvdy5qcyIsInNyYy9qcy9QbGF5bGlzdExvYWRlci5qcyIsInNyYy9qcy9Tb3VyY2VIYW5kbGVyLmpzIiwic3JjL2pzL1N0cmVhbUxvYWRlci5qcyIsInNyYy9qcy9kYXNoL21wZC9nZXRNcGQuanMiLCJzcmMvanMvZGFzaC9tcGQvdXRpbC5qcyIsInNyYy9qcy9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMiLCJzcmMvanMvZGFzaC9zZWdtZW50cy9zZWdtZW50VGVtcGxhdGUuanMiLCJzcmMvanMvZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzIiwic3JjL2pzL2V2ZW50cy9ldmVudE1hbmFnZXIuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9tYW5pZmVzdC9NYW5pZmVzdENvbnRyb2xsZXIuanMiLCJzcmMvanMvbWFuaWZlc3QvTWVkaWFUeXBlcy5qcyIsInNyYy9qcy9tYW5pZmVzdC9sb2FkTWFuaWZlc3QuanMiLCJzcmMvanMvcnVsZXMvRG93bmxvYWRSYXRlTWFuYWdlci5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlRXZlbnRUeXBlcy5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlcy5qcyIsInNyYy9qcy9ydWxlcy9kb3dubG9hZFJhdGUvVmlkZW9SZWFkeVN0YXRlUnVsZS5qcyIsInNyYy9qcy9zZWdtZW50cy9TZWdtZW50TG9hZGVyLmpzIiwic3JjL2pzL3NvdXJjZUJ1ZmZlci9Tb3VyY2VCdWZmZXJEYXRhUXVldWUuanMiLCJzcmMvanMvdXRpbC9leGlzdHkuanMiLCJzcmMvanMvdXRpbC9leHRlbmRPYmplY3QuanMiLCJzcmMvanMvdXRpbC9pc0FycmF5LmpzIiwic3JjL2pzL3V0aWwvaXNGdW5jdGlvbi5qcyIsInNyYy9qcy91dGlsL2lzTnVtYmVyLmpzIiwic3JjL2pzL3V0aWwvaXNTdHJpbmcuanMiLCJzcmMvanMvdXRpbC90cnV0aHkuanMiLCJzcmMvanMveG1sZnVuLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9PQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiKGZ1bmN0aW9uIChnbG9iYWwpe1xuaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHdpbmRvdztcbn0gZWxzZSBpZiAodHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZ2xvYmFsO1xufSBlbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIil7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBzZWxmO1xufSBlbHNlIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHt9O1xufVxuXG59KS5jYWxsKHRoaXMsdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSkiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgU2VnbWVudExvYWRlciA9IHJlcXVpcmUoJy4vc2VnbWVudHMvU2VnbWVudExvYWRlci5qcycpLFxuICAgIFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IHJlcXVpcmUoJy4vc291cmNlQnVmZmVyL1NvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5qcycpLFxuICAgIERvd25sb2FkUmF0ZU1hbmFnZXIgPSByZXF1aXJlKCcuL3J1bGVzL0Rvd25sb2FkUmF0ZU1hbmFnZXIuanMnKSxcbiAgICBWaWRlb1JlYWR5U3RhdGVSdWxlID0gcmVxdWlyZSgnLi9ydWxlcy9kb3dubG9hZFJhdGUvVmlkZW9SZWFkeVN0YXRlUnVsZS5qcycpLFxuICAgIFN0cmVhbUxvYWRlciA9IHJlcXVpcmUoJy4vU3RyZWFtTG9hZGVyLmpzJyksXG4gICAgZ2V0TXBkID0gcmVxdWlyZSgnLi9kYXNoL21wZC9nZXRNcGQuanMnKSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9tYW5pZmVzdC9NZWRpYVR5cGVzLmpzJyk7XG5cbmZ1bmN0aW9uIGxvYWRJbml0aWFsaXphdGlvbihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUpIHtcbiAgICBzZWdtZW50TG9hZGVyLm9uZShzZWdtZW50TG9hZGVyLmV2ZW50TGlzdC5JTklUSUFMSVpBVElPTl9MT0FERUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5vbmUoc291cmNlQnVmZmVyRGF0YVF1ZXVlLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGxvYWRTZWdtZW50cyhzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgc291cmNlQnVmZmVyRGF0YVF1ZXVlLmFkZFRvUXVldWUoZXZlbnQuZGF0YSk7XG4gICAgfSk7XG4gICAgc2VnbWVudExvYWRlci5sb2FkSW5pdGlhbGl6YXRpb24oKTtcbn1cblxuZnVuY3Rpb24gbG9hZFNlZ21lbnRzKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSkge1xuICAgIHNlZ21lbnRMb2FkZXIub24oc2VnbWVudExvYWRlci5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIGZ1bmN0aW9uIHNlZ21lbnRMb2FkZWRIYW5kbGVyKGV2ZW50KSB7XG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5vbmUoc291cmNlQnVmZmVyRGF0YVF1ZXVlLmV2ZW50TGlzdC5RVUVVRV9FTVBUWSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBsb2FkaW5nID0gc2VnbWVudExvYWRlci5sb2FkTmV4dFNlZ21lbnQoKTtcbiAgICAgICAgICAgIGlmICghbG9hZGluZykge1xuICAgICAgICAgICAgICAgIHNlZ21lbnRMb2FkZXIub2ZmKHNlZ21lbnRMb2FkZXIuZXZlbnRMaXN0LlNFR01FTlRfTE9BREVELCBzZWdtZW50TG9hZGVkSGFuZGxlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBzb3VyY2VCdWZmZXJEYXRhUXVldWUuYWRkVG9RdWV1ZShldmVudC5kYXRhKTtcbiAgICB9KTtcblxuICAgIHNlZ21lbnRMb2FkZXIubG9hZE5leHRTZWdtZW50KCk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdCwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSkge1xuICAgIHZhciBzb3VyY2VCdWZmZXJUeXBlID0gbWFuaWZlc3QuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKS5nZXRTb3VyY2VCdWZmZXJUeXBlKCksXG4gICAgICAgIC8vIFRPRE86IFRyeS9jYXRjaCBibG9jaz9cbiAgICAgICAgc291cmNlQnVmZmVyID0gbWVkaWFTb3VyY2UuYWRkU291cmNlQnVmZmVyKHNvdXJjZUJ1ZmZlclR5cGUpO1xuICAgIHJldHVybiBuZXcgU291cmNlQnVmZmVyRGF0YVF1ZXVlKHNvdXJjZUJ1ZmZlcik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbUxvYWRlckZvclR5cGUobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSwgbWVkaWFUeXBlKSB7XG4gICAgdmFyIHNlZ21lbnRMb2FkZXIgPSBuZXcgU2VnbWVudExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhVHlwZSksXG4gICAgICAgIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGNyZWF0ZVNvdXJjZUJ1ZmZlckRhdGFRdWV1ZUJ5VHlwZShtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCBtZWRpYVR5cGUpO1xuICAgIHJldHVybiBuZXcgU3RyZWFtTG9hZGVyKHNlZ21lbnRMb2FkZXIsIHNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSwgbWVkaWFUeXBlKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtTG9hZGVycyhtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlKSB7XG4gICAgdmFyIG1hdGNoZWRUeXBlcyA9IG1lZGlhVHlwZXMuZmlsdGVyKGZ1bmN0aW9uKG1lZGlhVHlwZSkge1xuICAgICAgICAgICAgdmFyIGV4aXN0cyA9IGV4aXN0eShtYW5pZmVzdENvbnRyb2xsZXIuZ2V0TWVkaWFTZXRCeVR5cGUobWVkaWFUeXBlKSk7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3R5OyB9KSxcbiAgICAgICAgc3RyZWFtTG9hZGVycyA9IG1hdGNoZWRUeXBlcy5tYXAoZnVuY3Rpb24obWVkaWFUeXBlKSB7IHJldHVybiBjcmVhdGVTdHJlYW1Mb2FkZXJGb3JUeXBlKG1hbmlmZXN0Q29udHJvbGxlciwgbWVkaWFTb3VyY2UsIG1lZGlhVHlwZSk7IH0pO1xuICAgIHJldHVybiBzdHJlYW1Mb2FkZXJzO1xufVxuXG5mdW5jdGlvbiBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuX19kb3dubG9hZFJhdGVNZ3IgPSBuZXcgRG93bmxvYWRSYXRlTWFuYWdlcihbbmV3IFZpZGVvUmVhZHlTdGF0ZVJ1bGUodGVjaCldKTtcbiAgICB0aGlzLl9fc3RyZWFtTG9hZGVycyA9IGNyZWF0ZVN0cmVhbUxvYWRlcnMobWFuaWZlc3RDb250cm9sbGVyLCBtZWRpYVNvdXJjZSk7XG4gICAgdGhpcy5fX3N0cmVhbUxvYWRlcnMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW1Mb2FkZXIpIHtcbiAgICAgICAgLyp0ZWNoLm9uKCd0aW1ldXBkYXRlJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdDdXJyZW50IFRpbWU6ICcgKyBldmVudC50YXJnZXQuY3VycmVudFRpbWUpO1xuICAgICAgICB9KTsqL1xuICAgICAgICBsb2FkSW5pdGlhbGl6YXRpb24oc3RyZWFtTG9hZGVyLmdldFNlZ21lbnRMb2FkZXIoKSwgc3RyZWFtTG9hZGVyLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSgpKTtcbiAgICB9KTtcblxuICAgIC8qdGhpcy5fX2Rvd25sb2FkUmF0ZU1nci5vbih0aGlzLl9fZG93bmxvYWRSYXRlTWdyLmV2ZW50TGlzdC5ET1dOTE9BRF9SQVRFX0NIQU5HRUQsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHZhciBzZWxmMiA9IHNlbGY7XG4gICAgICAgIGNvbnNvbGUubG9nKCdDdXJyZW50IFRpbWU6ICcgKyB0ZWNoLmN1cnJlbnRUaW1lKCkpO1xuICAgIH0pOyovXG5cbiAgICB0ZWNoLm9uKCdzZWVrZWQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICB2YXIgaGFzRGF0YSA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLmxvZygnU2Vla2VkIEN1cnJlbnQgVGltZTogJyArIHRlY2guY3VycmVudFRpbWUoKSk7XG4gICAgICAgIHNlbGYuX19zdHJlYW1Mb2FkZXJzLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtTG9hZGVyKSB7XG4gICAgICAgICAgICBoYXNEYXRhID0gc3RyZWFtTG9hZGVyLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSgpLmhhc0J1ZmZlcmVkRGF0YUZvclRpbWUodGVjaC5jdXJyZW50VGltZSgpKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdIYXMgRGF0YSBAIFRpbWU/ICcgKyBoYXNEYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICB0ZWNoLm9uKCdzZWVraW5nJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgdmFyIGhhc0RhdGEgPSBmYWxzZTtcbiAgICAgICAgY29uc29sZS5sb2coJ1NlZWtpbmcgQ3VycmVudCBUaW1lOiAnICsgdGVjaC5jdXJyZW50VGltZSgpKTtcbiAgICAgICAgc2VsZi5fX3N0cmVhbUxvYWRlcnMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW1Mb2FkZXIpIHtcbiAgICAgICAgICAgIGhhc0RhdGEgPSBzdHJlYW1Mb2FkZXIuZ2V0U291cmNlQnVmZmVyRGF0YVF1ZXVlKCkuaGFzQnVmZmVyZWREYXRhRm9yVGltZSh0ZWNoLmN1cnJlbnRUaW1lKCkpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0hhcyBEYXRhIEAgVGltZT8gJyArIGhhc0RhdGEpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQbGF5bGlzdExvYWRlcjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBNZWRpYVNvdXJjZSA9IHJlcXVpcmUoJ2dsb2JhbC93aW5kb3cnKS5NZWRpYVNvdXJjZSxcbiAgICBNYW5pZmVzdENvbnRyb2xsZXIgPSByZXF1aXJlKCcuL21hbmlmZXN0L01hbmlmZXN0Q29udHJvbGxlci5qcycpLFxuICAgIFBsYXlsaXN0TG9hZGVyID0gcmVxdWlyZSgnLi9QbGF5bGlzdExvYWRlci5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VIYW5kbGVyKHNvdXJjZSwgdGVjaCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgbWFuaWZlc3RDb250cm9sbGVyID0gbmV3IE1hbmlmZXN0Q29udHJvbGxlcihzb3VyY2Uuc3JjLCBmYWxzZSk7XG5cbiAgICBtYW5pZmVzdENvbnRyb2xsZXIubG9hZChmdW5jdGlvbihtYW5pZmVzdCkge1xuICAgICAgICB2YXIgbWVkaWFTb3VyY2UgPSBuZXcgTWVkaWFTb3VyY2UoKSxcbiAgICAgICAgICAgIG9wZW5MaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICAgICAgbWVkaWFTb3VyY2UucmVtb3ZlRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIHNlbGYuX19wbGF5bGlzdExvYWRlciA9IG5ldyBQbGF5bGlzdExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhU291cmNlLCB0ZWNoKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsIG9wZW5MaXN0ZW5lciwgZmFsc2UpO1xuXG4gICAgICAgIC8vIFRPRE86IEhhbmRsZSBjbG9zZS5cbiAgICAgICAgLy9tZWRpYVNvdXJjZS5hZGRFdmVudExpc3RlbmVyKCd3ZWJraXRzb3VyY2VjbG9zZScsIGNsb3NlZCwgZmFsc2UpO1xuICAgICAgICAvL21lZGlhU291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ3NvdXJjZWNsb3NlJywgY2xvc2VkLCBmYWxzZSk7XG5cbiAgICAgICAgdGVjaC5zZXRTcmMoVVJMLmNyZWF0ZU9iamVjdFVSTChtZWRpYVNvdXJjZSkpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdXJjZUhhbmRsZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIFN0cmVhbUxvYWRlcihzZWdtZW50TG9hZGVyLCBzb3VyY2VCdWZmZXJEYXRhUXVldWUsIG1lZGlhVHlwZSkge1xuICAgIHRoaXMuX19zZWdtZW50TG9hZGVyID0gc2VnbWVudExvYWRlcjtcbiAgICB0aGlzLl9fc291cmNlQnVmZmVyRGF0YVF1ZXVlID0gc291cmNlQnVmZmVyRGF0YVF1ZXVlO1xuICAgIHRoaXMuX19tZWRpYVR5cGUgPSBtZWRpYVR5cGU7XG59XG5cblN0cmVhbUxvYWRlci5wcm90b3R5cGUuZ2V0TWVkaWFUeXBlID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLl9fbWVkaWFUeXBlOyB9O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLmdldFNlZ21lbnRMb2FkZXIgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuX19zZWdtZW50TG9hZGVyOyB9O1xuXG5TdHJlYW1Mb2FkZXIucHJvdG90eXBlLmdldFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NvdXJjZUJ1ZmZlckRhdGFRdWV1ZTsgfTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5fX3NlZ21lbnRMb2FkZXIuZ2V0Q3VycmVudFNlZ21lbnROdW1iZXIoKTsgfTtcblxuU3RyZWFtTG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fc2VnbWVudExvYWRlci5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUoKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtTG9hZGVyOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHhtbGZ1biA9IHJlcXVpcmUoJy4uLy4uL3htbGZ1bi5qcycpLFxuICAgIHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKSxcbiAgICBwYXJzZVJvb3RVcmwgPSB1dGlsLnBhcnNlUm9vdFVybCxcbiAgICBjcmVhdGVNcGRPYmplY3QsXG4gICAgY3JlYXRlUGVyaW9kT2JqZWN0LFxuICAgIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QsXG4gICAgY3JlYXRlUmVwcmVzZW50YXRpb25PYmplY3QsXG4gICAgY3JlYXRlU2VnbWVudFRlbXBsYXRlLFxuICAgIGdldE1wZCxcbiAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlLFxuICAgIGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsXG4gICAgZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWU7XG5cbi8vIFRPRE86IFNob3VsZCB0aGlzIGV4aXN0IG9uIG1wZCBkYXRhdmlldyBvciBhdCBhIGhpZ2hlciBsZXZlbD9cbi8vIFRPRE86IFJlZmFjdG9yLiBDb3VsZCBiZSBtb3JlIGVmZmljaWVudCAoUmVjdXJzaXZlIGZuPyBVc2UgZWxlbWVudC5nZXRFbGVtZW50c0J5TmFtZSgnQmFzZVVybCcpWzBdPykuXG4vLyBUT0RPOiBDdXJyZW50bHkgYXNzdW1pbmcgKkVJVEhFUiogPEJhc2VVUkw+IG5vZGVzIHdpbGwgcHJvdmlkZSBhbiBhYnNvbHV0ZSBiYXNlIHVybCAoaWUgcmVzb2x2ZSB0byAnaHR0cDovLycgZXRjKVxuLy8gVE9ETzogKk9SKiB3ZSBzaG91bGQgdXNlIHRoZSBiYXNlIHVybCBvZiB0aGUgaG9zdCBvZiB0aGUgTVBEIG1hbmlmZXN0LlxudmFyIGJ1aWxkQmFzZVVybCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICB2YXIgZWxlbUhpZXJhcmNoeSA9IFt4bWxOb2RlXS5jb25jYXQoeG1sZnVuLmdldEFuY2VzdG9ycyh4bWxOb2RlKSksXG4gICAgICAgIGZvdW5kTG9jYWxCYXNlVXJsID0gZmFsc2U7XG4gICAgLy92YXIgYmFzZVVybHMgPSBfLm1hcChlbGVtSGllcmFyY2h5LCBmdW5jdGlvbihlbGVtKSB7XG4gICAgdmFyIGJhc2VVcmxzID0gZWxlbUhpZXJhcmNoeS5tYXAoZnVuY3Rpb24oZWxlbSkge1xuICAgICAgICBpZiAoZm91bmRMb2NhbEJhc2VVcmwpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIGlmICghZWxlbS5oYXNDaGlsZE5vZGVzKCkpIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBjaGlsZDtcbiAgICAgICAgZm9yICh2YXIgaT0wOyBpPGVsZW0uY2hpbGROb2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBlbGVtLmNoaWxkTm9kZXMuaXRlbShpKTtcbiAgICAgICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0Jhc2VVUkwnKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRleHRFbGVtID0gY2hpbGQuY2hpbGROb2Rlcy5pdGVtKDApO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0VmFsdWUgPSB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgICAgIGlmICh0ZXh0VmFsdWUuaW5kZXhPZignaHR0cDovLycpID09PSAwKSB7IGZvdW5kTG9jYWxCYXNlVXJsID0gdHJ1ZTsgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0ZXh0RWxlbS53aG9sZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH0pO1xuXG4gICAgdmFyIGJhc2VVcmwgPSBiYXNlVXJscy5yZXZlcnNlKCkuam9pbignJyk7XG4gICAgaWYgKCFiYXNlVXJsKSB7IHJldHVybiBwYXJzZVJvb3RVcmwoeG1sTm9kZS5iYXNlVVJJKTsgfVxuICAgIHJldHVybiBiYXNlVXJsO1xufTtcblxudmFyIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMgPSBbXG4gICAgJ0FkYXB0YXRpb25TZXQnLFxuICAgICdSZXByZXNlbnRhdGlvbicsXG4gICAgJ1N1YlJlcHJlc2VudGF0aW9uJ1xuXTtcblxudmFyIGhhc0NvbW1vblByb3BlcnRpZXMgPSBmdW5jdGlvbihlbGVtKSB7XG4gICAgcmV0dXJuIGVsZW1zV2l0aENvbW1vblByb3BlcnRpZXMuaW5kZXhPZihlbGVtLm5vZGVOYW1lKSA+PSAwO1xufTtcblxudmFyIGRvZXNudEhhdmVDb21tb25Qcm9wZXJ0aWVzID0gZnVuY3Rpb24oZWxlbSkge1xuICAgIHJldHVybiAhaGFzQ29tbW9uUHJvcGVydGllcyhlbGVtKTtcbn07XG5cbi8vIENvbW1vbiBBdHRyc1xudmFyIGdldFdpZHRoID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCd3aWR0aCcpLFxuICAgIGdldEhlaWdodCA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnaGVpZ2h0JyksXG4gICAgZ2V0RnJhbWVSYXRlID0geG1sZnVuLmdldEluaGVyaXRhYmxlQXR0cmlidXRlKCdmcmFtZVJhdGUnKSxcbiAgICBnZXRNaW1lVHlwZSA9IHhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSgnbWltZVR5cGUnKSxcbiAgICBnZXRDb2RlY3MgPSB4bWxmdW4uZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUoJ2NvZGVjcycpO1xuXG52YXIgZ2V0U2VnbWVudFRlbXBsYXRlWG1sID0geG1sZnVuLmdldEluaGVyaXRhYmxlRWxlbWVudCgnU2VnbWVudFRlbXBsYXRlJywgZG9lc250SGF2ZUNvbW1vblByb3BlcnRpZXMpO1xuXG4vLyBNUEQgQXR0ciBmbnNcbnZhciBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0geG1sZnVuLmdldEF0dHJGbignbWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbicpLFxuICAgIGdldFR5cGUgPSB4bWxmdW4uZ2V0QXR0ckZuKCd0eXBlJyksXG4gICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21pbmltdW1VcGRhdGVQZXJpb2QnKTtcblxuLy8gUmVwcmVzZW50YXRpb24gQXR0ciBmbnNcbnZhciBnZXRJZCA9IHhtbGZ1bi5nZXRBdHRyRm4oJ2lkJyksXG4gICAgZ2V0QmFuZHdpZHRoID0geG1sZnVuLmdldEF0dHJGbignYmFuZHdpZHRoJyk7XG5cbi8vIFNlZ21lbnRUZW1wbGF0ZSBBdHRyIGZuc1xudmFyIGdldEluaXRpYWxpemF0aW9uID0geG1sZnVuLmdldEF0dHJGbignaW5pdGlhbGl6YXRpb24nKSxcbiAgICBnZXRNZWRpYSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ21lZGlhJyksXG4gICAgZ2V0RHVyYXRpb24gPSB4bWxmdW4uZ2V0QXR0ckZuKCdkdXJhdGlvbicpLFxuICAgIGdldFRpbWVzY2FsZSA9IHhtbGZ1bi5nZXRBdHRyRm4oJ3RpbWVzY2FsZScpLFxuICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQgPSB4bWxmdW4uZ2V0QXR0ckZuKCdwcmVzZW50YXRpb25UaW1lT2Zmc2V0JyksXG4gICAgZ2V0U3RhcnROdW1iZXIgPSB4bWxmdW4uZ2V0QXR0ckZuKCdzdGFydE51bWJlcicpO1xuXG4vLyBUT0RPOiBSZXBlYXQgY29kZS4gQWJzdHJhY3QgYXdheSAoUHJvdG90eXBhbCBJbmhlcml0YW5jZS9PTyBNb2RlbD8gT2JqZWN0IGNvbXBvc2VyIGZuPylcbmNyZWF0ZU1wZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0UGVyaW9kczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFR5cGU6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUeXBlLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0TWluaW11bVVwZGF0ZVBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbmltdW1VcGRhdGVQZXJpb2QsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVBlcmlvZE9iamVjdCA9IGZ1bmN0aW9uKHhtbE5vZGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4bWw6IHhtbE5vZGUsXG4gICAgICAgIC8vIERlc2NlbmRhbnRzLCBBbmNlc3RvcnMsICYgU2libGluZ3NcbiAgICAgICAgZ2V0QWRhcHRhdGlvblNldHM6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREZXNjZW5kYW50T2JqZWN0c0FycmF5QnlOYW1lLCB4bWxOb2RlLCAnQWRhcHRhdGlvblNldCcsIGNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QpLFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0QnlUeXBlOiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gZ2V0QWRhcHRhdGlvblNldEJ5VHlwZSh0eXBlLCB4bWxOb2RlKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpXG4gICAgfTtcbn07XG5cbmNyZWF0ZUFkYXB0YXRpb25TZXRPYmplY3QgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldFJlcHJlc2VudGF0aW9uczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldERlc2NlbmRhbnRPYmplY3RzQXJyYXlCeU5hbWUsIHhtbE5vZGUsICdSZXByZXNlbnRhdGlvbicsIGNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0KSxcbiAgICAgICAgZ2V0U2VnbWVudFRlbXBsYXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBjcmVhdGVTZWdtZW50VGVtcGxhdGUoZ2V0U2VnbWVudFRlbXBsYXRlWG1sKHhtbE5vZGUpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldE1pbWVUeXBlOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0TWltZVR5cGUsIHhtbE5vZGUpXG4gICAgfTtcbn07XG5cbmNyZWF0ZVJlcHJlc2VudGF0aW9uT2JqZWN0ID0gZnVuY3Rpb24oeG1sTm9kZSkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHhtbDogeG1sTm9kZSxcbiAgICAgICAgLy8gRGVzY2VuZGFudHMsIEFuY2VzdG9ycywgJiBTaWJsaW5nc1xuICAgICAgICBnZXRTZWdtZW50VGVtcGxhdGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNlZ21lbnRUZW1wbGF0ZShnZXRTZWdtZW50VGVtcGxhdGVYbWwoeG1sTm9kZSkpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBZGFwdGF0aW9uU2V0OiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdBZGFwdGF0aW9uU2V0JywgY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdCksXG4gICAgICAgIGdldFBlcmlvZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lLCB4bWxOb2RlLCAnUGVyaW9kJywgY3JlYXRlUGVyaW9kT2JqZWN0KSxcbiAgICAgICAgZ2V0TXBkOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdNUEQnLCBjcmVhdGVNcGRPYmplY3QpLFxuICAgICAgICAvLyBBdHRyc1xuICAgICAgICBnZXRJZDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldElkLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0V2lkdGg6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRXaWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldEhlaWdodDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEhlaWdodCwgeG1sTm9kZSksXG4gICAgICAgIGdldEZyYW1lUmF0ZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEZyYW1lUmF0ZSwgeG1sTm9kZSksXG4gICAgICAgIGdldEJhbmR3aWR0aDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldEJhbmR3aWR0aCwgeG1sTm9kZSksXG4gICAgICAgIGdldENvZGVjczogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldENvZGVjcywgeG1sTm9kZSksXG4gICAgICAgIGdldEJhc2VVcmw6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihidWlsZEJhc2VVcmwsIHhtbE5vZGUpLFxuICAgICAgICBnZXRNaW1lVHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1pbWVUeXBlLCB4bWxOb2RlKVxuICAgIH07XG59O1xuXG5jcmVhdGVTZWdtZW50VGVtcGxhdGUgPSBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeG1sOiB4bWxOb2RlLFxuICAgICAgICAvLyBEZXNjZW5kYW50cywgQW5jZXN0b3JzLCAmIFNpYmxpbmdzXG4gICAgICAgIGdldEFkYXB0YXRpb25TZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ0FkYXB0YXRpb25TZXQnLCBjcmVhdGVBZGFwdGF0aW9uU2V0T2JqZWN0KSxcbiAgICAgICAgZ2V0UGVyaW9kOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUsIHhtbE5vZGUsICdQZXJpb2QnLCBjcmVhdGVQZXJpb2RPYmplY3QpLFxuICAgICAgICBnZXRNcGQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRBbmNlc3Rvck9iamVjdEJ5TmFtZSwgeG1sTm9kZSwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdCksXG4gICAgICAgIC8vIEF0dHJzXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0SW5pdGlhbGl6YXRpb24sIHhtbE5vZGUpLFxuICAgICAgICBnZXRNZWRpYTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldE1lZGlhLCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0RHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXREdXJhdGlvbiwgeG1sTm9kZSksXG4gICAgICAgIGdldFRpbWVzY2FsZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRpbWVzY2FsZSwgeG1sTm9kZSksXG4gICAgICAgIGdldFByZXNlbnRhdGlvblRpbWVPZmZzZXQ6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0LCB4bWxOb2RlKSxcbiAgICAgICAgZ2V0U3RhcnROdW1iZXI6IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRTdGFydE51bWJlciwgeG1sTm9kZSlcbiAgICB9O1xufTtcblxuLy8gVE9ETzogQ2hhbmdlIHRoaXMgYXBpIHRvIHJldHVybiBhIGxpc3Qgb2YgYWxsIG1hdGNoaW5nIGFkYXB0YXRpb24gc2V0cyB0byBhbGxvdyBmb3IgZ3JlYXRlciBmbGV4aWJpbGl0eS5cbmdldEFkYXB0YXRpb25TZXRCeVR5cGUgPSBmdW5jdGlvbih0eXBlLCBwZXJpb2RYbWwpIHtcbiAgICB2YXIgYWRhcHRhdGlvblNldHMgPSBwZXJpb2RYbWwuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ0FkYXB0YXRpb25TZXQnKSxcbiAgICAgICAgYWRhcHRhdGlvblNldCxcbiAgICAgICAgcmVwcmVzZW50YXRpb24sXG4gICAgICAgIG1pbWVUeXBlO1xuXG4gICAgZm9yICh2YXIgaT0wOyBpPGFkYXB0YXRpb25TZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFkYXB0YXRpb25TZXQgPSBhZGFwdGF0aW9uU2V0cy5pdGVtKGkpO1xuICAgICAgICAvLyBTaW5jZSB0aGUgbWltZVR5cGUgY2FuIGJlIGRlZmluZWQgb24gdGhlIEFkYXB0YXRpb25TZXQgb3Igb24gaXRzIFJlcHJlc2VudGF0aW9uIGNoaWxkIG5vZGVzLFxuICAgICAgICAvLyBjaGVjayBmb3IgbWltZXR5cGUgb24gb25lIG9mIGl0cyBSZXByZXNlbnRhdGlvbiBjaGlsZHJlbiB1c2luZyBnZXRNaW1lVHlwZSgpLCB3aGljaCBhc3N1bWVzIHRoZVxuICAgICAgICAvLyBtaW1lVHlwZSBjYW4gYmUgaW5oZXJpdGVkIGFuZCB3aWxsIGNoZWNrIGl0c2VsZiBhbmQgaXRzIGFuY2VzdG9ycyBmb3IgdGhlIGF0dHIuXG4gICAgICAgIHJlcHJlc2VudGF0aW9uID0gYWRhcHRhdGlvblNldC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnUmVwcmVzZW50YXRpb24nKVswXTtcbiAgICAgICAgLy8gTmVlZCB0byBjaGVjayB0aGUgcmVwcmVzZW50YXRpb24gaW5zdGVhZCBvZiB0aGUgYWRhcHRhdGlvbiBzZXQsIHNpbmNlIHRoZSBtaW1lVHlwZSBtYXkgbm90IGJlIHNwZWNpZmllZFxuICAgICAgICAvLyBvbiB0aGUgYWRhcHRhdGlvbiBzZXQgYXQgYWxsIGFuZCBtYXkgYmUgc3BlY2lmaWVkIGZvciBlYWNoIG9mIHRoZSByZXByZXNlbnRhdGlvbnMgaW5zdGVhZC5cbiAgICAgICAgbWltZVR5cGUgPSBnZXRNaW1lVHlwZShyZXByZXNlbnRhdGlvbik7XG4gICAgICAgIGlmICghIW1pbWVUeXBlICYmIG1pbWVUeXBlLmluZGV4T2YodHlwZSkgPj0gMCkgeyByZXR1cm4gY3JlYXRlQWRhcHRhdGlvblNldE9iamVjdChhZGFwdGF0aW9uU2V0KTsgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuZ2V0TXBkID0gZnVuY3Rpb24obWFuaWZlc3RYbWwpIHtcbiAgICByZXR1cm4gZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZShtYW5pZmVzdFhtbCwgJ01QRCcsIGNyZWF0ZU1wZE9iamVjdClbMF07XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0RGVzY2VuZGFudE9iamVjdHNBcnJheUJ5TmFtZSA9IGZ1bmN0aW9uKHBhcmVudFhtbCwgdGFnTmFtZSwgbWFwRm4pIHtcbiAgICB2YXIgZGVzY2VuZGFudHNYbWxBcnJheSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHBhcmVudFhtbC5nZXRFbGVtZW50c0J5VGFnTmFtZSh0YWdOYW1lKSk7XG4gICAgLyppZiAodHlwZW9mIG1hcEZuID09PSAnZnVuY3Rpb24nKSB7IHJldHVybiBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7IH0qL1xuICAgIGlmICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG1hcHBlZEVsZW0gPSBkZXNjZW5kYW50c1htbEFycmF5Lm1hcChtYXBGbik7XG4gICAgICAgIHJldHVybiAgbWFwcGVkRWxlbTtcbiAgICB9XG4gICAgcmV0dXJuIGRlc2NlbmRhbnRzWG1sQXJyYXk7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIHhtbGZ1biBvciBvd24gbW9kdWxlLlxuZ2V0QW5jZXN0b3JPYmplY3RCeU5hbWUgPSBmdW5jdGlvbih4bWxOb2RlLCB0YWdOYW1lLCBtYXBGbikge1xuICAgIGlmICghdGFnTmFtZSB8fCAheG1sTm9kZSB8fCAheG1sTm9kZS5wYXJlbnROb2RlKSB7IHJldHVybiBudWxsOyB9XG4gICAgaWYgKCF4bWxOb2RlLnBhcmVudE5vZGUuaGFzT3duUHJvcGVydHkoJ25vZGVOYW1lJykpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGlmICh4bWxOb2RlLnBhcmVudE5vZGUubm9kZU5hbWUgPT09IHRhZ05hbWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgbWFwRm4gPT09ICdmdW5jdGlvbicpID8gbWFwRm4oeG1sTm9kZS5wYXJlbnROb2RlKSA6IHhtbE5vZGUucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGdldEFuY2VzdG9yT2JqZWN0QnlOYW1lKHhtbE5vZGUucGFyZW50Tm9kZSwgdGFnTmFtZSwgbWFwRm4pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZXRNcGQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcGFyc2VSb290VXJsLFxuICAgIC8vIFRPRE86IFNob3VsZCBwcmVzZW50YXRpb25EdXJhdGlvbiBwYXJzaW5nIGJlIGluIHV0aWwgb3Igc29tZXdoZXJlIGVsc2U/XG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uLFxuICAgIFNFQ09ORFNfSU5fWUVBUiA9IDM2NSAqIDI0ICogNjAgKiA2MCxcbiAgICBTRUNPTkRTX0lOX01PTlRIID0gMzAgKiAyNCAqIDYwICogNjAsIC8vIG5vdCBwcmVjaXNlIVxuICAgIFNFQ09ORFNfSU5fREFZID0gMjQgKiA2MCAqIDYwLFxuICAgIFNFQ09ORFNfSU5fSE9VUiA9IDYwICogNjAsXG4gICAgU0VDT05EU19JTl9NSU4gPSA2MCxcbiAgICBNSU5VVEVTX0lOX0hPVVIgPSA2MCxcbiAgICBNSUxMSVNFQ09ORFNfSU5fU0VDT05EUyA9IDEwMDAsXG4gICAgZHVyYXRpb25SZWdleCA9IC9eUCgoW1xcZC5dKilZKT8oKFtcXGQuXSopTSk/KChbXFxkLl0qKUQpP1Q/KChbXFxkLl0qKUgpPygoW1xcZC5dKilNKT8oKFtcXGQuXSopUyk/LztcblxucGFyc2VSb290VXJsID0gZnVuY3Rpb24odXJsKSB7XG4gICAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAodXJsLmluZGV4T2YoJy8nKSA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICh1cmwuaW5kZXhPZignPycpICE9PSAtMSkge1xuICAgICAgICB1cmwgPSB1cmwuc3Vic3RyaW5nKDAsIHVybC5pbmRleE9mKCc/JykpO1xuICAgIH1cblxuICAgIHJldHVybiB1cmwuc3Vic3RyaW5nKDAsIHVybC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59O1xuXG4vLyBUT0RPOiBTaG91bGQgcHJlc2VudGF0aW9uRHVyYXRpb24gcGFyc2luZyBiZSBpbiB1dGlsIG9yIHNvbWV3aGVyZSBlbHNlP1xucGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gZnVuY3Rpb24gKHN0cikge1xuICAgIC8vc3RyID0gXCJQMTBZMTBNMTBEVDEwSDEwTTEwLjFTXCI7XG4gICAgdmFyIG1hdGNoID0gZHVyYXRpb25SZWdleC5leGVjKHN0cik7XG4gICAgcmV0dXJuIChwYXJzZUZsb2F0KG1hdGNoWzJdIHx8IDApICogU0VDT05EU19JTl9ZRUFSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFs0XSB8fCAwKSAqIFNFQ09ORFNfSU5fTU9OVEggK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzZdIHx8IDApICogU0VDT05EU19JTl9EQVkgK1xuICAgICAgICBwYXJzZUZsb2F0KG1hdGNoWzhdIHx8IDApICogU0VDT05EU19JTl9IT1VSICtcbiAgICAgICAgcGFyc2VGbG9hdChtYXRjaFsxMF0gfHwgMCkgKiBTRUNPTkRTX0lOX01JTiArXG4gICAgICAgIHBhcnNlRmxvYXQobWF0Y2hbMTJdIHx8IDApKTtcbn07XG5cbnZhciB1dGlsID0ge1xuICAgIHBhcnNlUm9vdFVybDogcGFyc2VSb290VXJsLFxuICAgIHBhcnNlTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbjogcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWw7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgeG1sZnVuID0gcmVxdWlyZSgnLi4vLi4veG1sZnVuLmpzJyksXG4gICAgcGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uID0gcmVxdWlyZSgnLi4vbXBkL3V0aWwuanMnKS5wYXJzZU1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24sXG4gICAgc2VnbWVudFRlbXBsYXRlID0gcmVxdWlyZSgnLi9zZWdtZW50VGVtcGxhdGUnKSxcbiAgICBjcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSxcbiAgICBjcmVhdGVTZWdtZW50RnJvbVRlbXBsYXRlQnlOdW1iZXIsXG4gICAgY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSxcbiAgICBnZXRUeXBlLFxuICAgIGdldEJhbmR3aWR0aCxcbiAgICBnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLFxuICAgIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSxcbiAgICBnZXRUb3RhbFNlZ21lbnRDb3VudEZyb21UZW1wbGF0ZSxcbiAgICBnZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSxcbiAgICBnZXRFbmROdW1iZXJGcm9tVGVtcGxhdGU7XG5cbmdldFR5cGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIHZhciBjb2RlY1N0ciA9IHJlcHJlc2VudGF0aW9uLmdldENvZGVjcygpO1xuICAgIHZhciB0eXBlU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0TWltZVR5cGUoKTtcblxuICAgIC8vTk9URTogTEVBRElORyBaRVJPUyBJTiBDT0RFQyBUWVBFL1NVQlRZUEUgQVJFIFRFQ0hOSUNBTExZIE5PVCBTUEVDIENPTVBMSUFOVCwgQlVUIEdQQUMgJiBPVEhFUlxuICAgIC8vIERBU0ggTVBEIEdFTkVSQVRPUlMgUFJPRFVDRSBUSEVTRSBOT04tQ09NUExJQU5UIFZBTFVFUy4gSEFORExJTkcgSEVSRSBGT1IgTk9XLlxuICAgIC8vIFNlZTogUkZDIDYzODEgU2VjLiAzLjQgKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2MzgxI3NlY3Rpb24tMy40KVxuICAgIHZhciBwYXJzZWRDb2RlYyA9IGNvZGVjU3RyLnNwbGl0KCcuJykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UoL14wKyg/IVxcLnwkKS8sICcnKTtcbiAgICB9KTtcbiAgICB2YXIgcHJvY2Vzc2VkQ29kZWNTdHIgPSBwYXJzZWRDb2RlYy5qb2luKCcuJyk7XG5cbiAgICByZXR1cm4gKHR5cGVTdHIgKyAnO2NvZGVjcz1cIicgKyBwcm9jZXNzZWRDb2RlY1N0ciArICdcIicpO1xufTtcblxuZ2V0QmFuZHdpZHRoID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTnVtYmVyKHJlcHJlc2VudGF0aW9uLmdldEJhbmR3aWR0aCgpKTtcbn07XG5cbmdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUgPSBmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgcGVyaW9kLXJlbGF0aXZlIHByZXNlbnRhdGlvbiB0aW1lXG4gICAgdmFyIG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSByZXByZXNlbnRhdGlvbi5nZXRNcGQoKS5nZXRNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKCksXG4gICAgICAgIHBhcnNlZE1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24gPSBOdW1iZXIocGFyc2VNZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uKG1lZGlhUHJlc2VudGF0aW9uRHVyYXRpb24pKSxcbiAgICAgICAgcHJlc2VudGF0aW9uVGltZU9mZnNldCA9IE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRQcmVzZW50YXRpb25UaW1lT2Zmc2V0KCkpO1xuICAgIHJldHVybiBOdW1iZXIocGFyc2VkTWVkaWFQcmVzZW50YXRpb25EdXJhdGlvbiAtIHByZXNlbnRhdGlvblRpbWVPZmZzZXQpO1xufTtcblxuZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICB2YXIgc2VnbWVudFRlbXBsYXRlID0gcmVwcmVzZW50YXRpb24uZ2V0U2VnbWVudFRlbXBsYXRlKCk7XG4gICAgcmV0dXJuIE51bWJlcihzZWdtZW50VGVtcGxhdGUuZ2V0RHVyYXRpb24oKSkgLyBOdW1iZXIoc2VnbWVudFRlbXBsYXRlLmdldFRpbWVzY2FsZSgpKTtcbn07XG5cbmdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24pIHtcbiAgICByZXR1cm4gTWF0aC5jZWlsKGdldFRvdGFsRHVyYXRpb25Gcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pIC8gZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSk7XG59O1xuXG5nZXRTdGFydE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIE51bWJlcihyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRTdGFydE51bWJlcigpKTtcbn07XG5cbmdldEVuZE51bWJlckZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSArIGdldFN0YXJ0TnVtYmVyRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKSAtIDE7XG59O1xuXG5jcmVhdGVTZWdtZW50TGlzdEZyb21UZW1wbGF0ZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0VHlwZTogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFR5cGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0QmFuZHdpZHRoOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0QmFuZHdpZHRoLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFRvdGFsRHVyYXRpb246IHhtbGZ1bi5wcmVBcHBseUFyZ3NGbihnZXRUb3RhbER1cmF0aW9uRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFNlZ21lbnREdXJhdGlvbjogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZSwgcmVwcmVzZW50YXRpb24pLFxuICAgICAgICBnZXRUb3RhbFNlZ21lbnRDb3VudDogeG1sZnVuLnByZUFwcGx5QXJnc0ZuKGdldFRvdGFsU2VnbWVudENvdW50RnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIGdldFN0YXJ0TnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0U3RhcnROdW1iZXJGcm9tVGVtcGxhdGUsIHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgZ2V0RW5kTnVtYmVyOiB4bWxmdW4ucHJlQXBwbHlBcmdzRm4oZ2V0RW5kTnVtYmVyRnJvbVRlbXBsYXRlLCByZXByZXNlbnRhdGlvbiksXG4gICAgICAgIC8vIFRPRE86IEV4dGVybmFsaXplXG4gICAgICAgIGdldEluaXRpYWxpemF0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBpbml0aWFsaXphdGlvbiA9IHt9O1xuICAgICAgICAgICAgaW5pdGlhbGl6YXRpb24uZ2V0VXJsID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICAgICAgICAgIHJlcHJlc2VudGF0aW9uSWQgPSByZXByZXNlbnRhdGlvbi5nZXRJZCgpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsVGVtcGxhdGUgPSByZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKS5nZXRJbml0aWFsaXphdGlvbigpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKGluaXRpYWxpemF0aW9uUmVsYXRpdmVVcmxUZW1wbGF0ZSwgcmVwcmVzZW50YXRpb25JZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VVcmwgKyBpbml0aWFsaXphdGlvblJlbGF0aXZlVXJsO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBpbml0aWFsaXphdGlvbjtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5TnVtYmVyOiBmdW5jdGlvbihudW1iZXIpIHsgcmV0dXJuIGNyZWF0ZVNlZ21lbnRGcm9tVGVtcGxhdGVCeU51bWJlcihyZXByZXNlbnRhdGlvbiwgbnVtYmVyKTsgfSxcbiAgICAgICAgZ2V0U2VnbWVudEJ5VGltZTogZnVuY3Rpb24oc2Vjb25kcykgeyByZXR1cm4gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZShyZXByZXNlbnRhdGlvbiwgc2Vjb25kcyk7IH1cbiAgICB9O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyID0gZnVuY3Rpb24ocmVwcmVzZW50YXRpb24sIG51bWJlcikge1xuICAgIHZhciBzZWdtZW50ID0ge307XG4gICAgc2VnbWVudC5nZXRVcmwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGJhc2VVcmwgPSByZXByZXNlbnRhdGlvbi5nZXRCYXNlVXJsKCksXG4gICAgICAgICAgICBzZWdtZW50UmVsYXRpdmVVcmxUZW1wbGF0ZSA9IHJlcHJlc2VudGF0aW9uLmdldFNlZ21lbnRUZW1wbGF0ZSgpLmdldE1lZGlhKCksXG4gICAgICAgICAgICByZXBsYWNlZElkVXJsID0gc2VnbWVudFRlbXBsYXRlLnJlcGxhY2VJREZvclRlbXBsYXRlKHNlZ21lbnRSZWxhdGl2ZVVybFRlbXBsYXRlLCByZXByZXNlbnRhdGlvbi5nZXRJZCgpKSxcbiAgICAgICAgICAgIC8vIFRPRE86IFNpbmNlICRUaW1lJC10ZW1wbGF0ZWQgc2VnbWVudCBVUkxzIHNob3VsZCBvbmx5IGV4aXN0IGluIGNvbmp1bmN0aW9uIHcvYSA8U2VnbWVudFRpbWVsaW5lPixcbiAgICAgICAgICAgIC8vIFRPRE86IGNhbiBjdXJyZW50bHkgYXNzdW1lIGEgJE51bWJlciQtYmFzZWQgdGVtcGxhdGVkIHVybC5cbiAgICAgICAgICAgIC8vIFRPRE86IEVuZm9yY2UgbWluL21heCBudW1iZXIgcmFuZ2UgKGJhc2VkIG9uIHNlZ21lbnRMaXN0IHN0YXJ0TnVtYmVyICYgZW5kTnVtYmVyKVxuICAgICAgICAgICAgcmVwbGFjZWROdW1iZXJVcmwgPSBzZWdtZW50VGVtcGxhdGUucmVwbGFjZVRva2VuRm9yVGVtcGxhdGUocmVwbGFjZWRJZFVybCwgJ051bWJlcicsIG51bWJlcik7XG4gICAgICAgIHJldHVybiBiYXNlVXJsICsgcmVwbGFjZWROdW1iZXJVcmw7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldFN0YXJ0VGltZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbnVtYmVyICogZ2V0U2VnbWVudER1cmF0aW9uRnJvbVRlbXBsYXRlKHJlcHJlc2VudGF0aW9uKTtcbiAgICB9O1xuICAgIHNlZ21lbnQuZ2V0RHVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVE9ETzogSGFuZGxlIGxhc3Qgc2VnbWVudCAobGlrZWx5IDwgc2VnbWVudCBkdXJhdGlvbilcbiAgICAgICAgcmV0dXJuIGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbik7XG4gICAgfTtcbiAgICBzZWdtZW50LmdldE51bWJlciA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbnVtYmVyOyB9O1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5VGltZSA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uLCBzZWNvbmRzKSB7XG4gICAgdmFyIHNlZ21lbnREdXJhdGlvbiA9IGdldFNlZ21lbnREdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIG51bWJlciA9IE1hdGguZmxvb3IoZ2V0VG90YWxEdXJhdGlvbkZyb21UZW1wbGF0ZShyZXByZXNlbnRhdGlvbikgLyBzZWdtZW50RHVyYXRpb24pLFxuICAgICAgICBzZWdtZW50ID0gY3JlYXRlU2VnbWVudEZyb21UZW1wbGF0ZUJ5TnVtYmVyKHJlcHJlc2VudGF0aW9uLCBudW1iZXIpO1xuICAgIHJldHVybiBzZWdtZW50O1xufTtcblxuZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgIGlmICghcmVwcmVzZW50YXRpb24pIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmIChyZXByZXNlbnRhdGlvbi5nZXRTZWdtZW50VGVtcGxhdGUoKSkgeyByZXR1cm4gY3JlYXRlU2VnbWVudExpc3RGcm9tVGVtcGxhdGUocmVwcmVzZW50YXRpb24pOyB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2VnbWVudFRlbXBsYXRlLFxuICAgIHplcm9QYWRUb0xlbmd0aCxcbiAgICByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlO1xuXG56ZXJvUGFkVG9MZW5ndGggPSBmdW5jdGlvbiAobnVtU3RyLCBtaW5TdHJMZW5ndGgpIHtcbiAgICB3aGlsZSAobnVtU3RyLmxlbmd0aCA8IG1pblN0ckxlbmd0aCkge1xuICAgICAgICBudW1TdHIgPSAnMCcgKyBudW1TdHI7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bVN0cjtcbn07XG5cbnJlcGxhY2VUb2tlbkZvclRlbXBsYXRlID0gZnVuY3Rpb24gKHRlbXBsYXRlU3RyLCB0b2tlbiwgdmFsdWUpIHtcblxuICAgIHZhciBzdGFydFBvcyA9IDAsXG4gICAgICAgIGVuZFBvcyA9IDAsXG4gICAgICAgIHRva2VuTGVuID0gdG9rZW4ubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWcgPSAnJTAnLFxuICAgICAgICBmb3JtYXRUYWdMZW4gPSBmb3JtYXRUYWcubGVuZ3RoLFxuICAgICAgICBmb3JtYXRUYWdQb3MsXG4gICAgICAgIHNwZWNpZmllcixcbiAgICAgICAgd2lkdGgsXG4gICAgICAgIHBhZGRlZFZhbHVlO1xuXG4gICAgLy8ga2VlcCBsb29waW5nIHJvdW5kIHVudGlsIGFsbCBpbnN0YW5jZXMgb2YgPHRva2VuPiBoYXZlIGJlZW5cbiAgICAvLyByZXBsYWNlZC4gb25jZSB0aGF0IGhhcyBoYXBwZW5lZCwgc3RhcnRQb3MgYmVsb3cgd2lsbCBiZSAtMVxuICAgIC8vIGFuZCB0aGUgY29tcGxldGVkIHVybCB3aWxsIGJlIHJldHVybmVkLlxuICAgIHdoaWxlICh0cnVlKSB7XG5cbiAgICAgICAgLy8gY2hlY2sgaWYgdGhlcmUgaXMgYSB2YWxpZCAkPHRva2VuPi4uLiQgaWRlbnRpZmllclxuICAgICAgICAvLyBpZiBub3QsIHJldHVybiB0aGUgdXJsIGFzIGlzLlxuICAgICAgICBzdGFydFBvcyA9IHRlbXBsYXRlU3RyLmluZGV4T2YoJyQnICsgdG9rZW4pO1xuICAgICAgICBpZiAoc3RhcnRQb3MgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVTdHI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGUgbmV4dCAnJCcgbXVzdCBiZSB0aGUgZW5kIG9mIHRoZSBpZGVudGlmZXJcbiAgICAgICAgLy8gaWYgdGhlcmUgaXNuJ3Qgb25lLCByZXR1cm4gdGhlIHVybCBhcyBpcy5cbiAgICAgICAgZW5kUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZignJCcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZW5kUG9zIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbm93IHNlZSBpZiB0aGVyZSBpcyBhbiBhZGRpdGlvbmFsIGZvcm1hdCB0YWcgc3VmZml4ZWQgdG9cbiAgICAgICAgLy8gdGhlIGlkZW50aWZpZXIgd2l0aGluIHRoZSBlbmNsb3NpbmcgJyQnIGNoYXJhY3RlcnNcbiAgICAgICAgZm9ybWF0VGFnUG9zID0gdGVtcGxhdGVTdHIuaW5kZXhPZihmb3JtYXRUYWcsIHN0YXJ0UG9zICsgdG9rZW5MZW4pO1xuICAgICAgICBpZiAoZm9ybWF0VGFnUG9zID4gc3RhcnRQb3MgJiYgZm9ybWF0VGFnUG9zIDwgZW5kUG9zKSB7XG5cbiAgICAgICAgICAgIHNwZWNpZmllciA9IHRlbXBsYXRlU3RyLmNoYXJBdChlbmRQb3MgLSAxKTtcbiAgICAgICAgICAgIHdpZHRoID0gcGFyc2VJbnQodGVtcGxhdGVTdHIuc3Vic3RyaW5nKGZvcm1hdFRhZ1BvcyArIGZvcm1hdFRhZ0xlbiwgZW5kUG9zIC0gMSksIDEwKTtcblxuICAgICAgICAgICAgLy8gc3VwcG9ydCB0aGUgbWluaW11bSBzcGVjaWZpZXJzIHJlcXVpcmVkIGJ5IElFRUUgMTAwMy4xXG4gICAgICAgICAgICAvLyAoZCwgaSAsIG8sIHUsIHgsIGFuZCBYKSBmb3IgY29tcGxldGVuZXNzXG4gICAgICAgICAgICBzd2l0Y2ggKHNwZWNpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIHRyZWF0IGFsbCBpbnQgdHlwZXMgYXMgdWludCxcbiAgICAgICAgICAgICAgICAvLyBoZW5jZSBkZWxpYmVyYXRlIGZhbGx0aHJvdWdoXG4gICAgICAgICAgICAgICAgY2FzZSAnZCc6XG4gICAgICAgICAgICAgICAgY2FzZSAnaSc6XG4gICAgICAgICAgICAgICAgY2FzZSAndSc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKCksIHdpZHRoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAneCc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDE2KSwgd2lkdGgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdYJzpcbiAgICAgICAgICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB6ZXJvUGFkVG9MZW5ndGgodmFsdWUudG9TdHJpbmcoMTYpLCB3aWR0aCkudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnbyc6XG4gICAgICAgICAgICAgICAgICAgIHBhZGRlZFZhbHVlID0gemVyb1BhZFRvTGVuZ3RoKHZhbHVlLnRvU3RyaW5nKDgpLCB3aWR0aCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVbnN1cHBvcnRlZC9pbnZhbGlkIElFRUUgMTAwMy4xIGZvcm1hdCBpZGVudGlmaWVyIHN0cmluZyBpbiBVUkwnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRlbXBsYXRlU3RyO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFkZGVkVmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRlbXBsYXRlU3RyID0gdGVtcGxhdGVTdHIuc3Vic3RyaW5nKDAsIHN0YXJ0UG9zKSArIHBhZGRlZFZhbHVlICsgdGVtcGxhdGVTdHIuc3Vic3RyaW5nKGVuZFBvcyArIDEpO1xuICAgIH1cbn07XG5cbnVuZXNjYXBlRG9sbGFyc0luVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIpIHtcbiAgICByZXR1cm4gdGVtcGxhdGVTdHIuc3BsaXQoJyQkJykuam9pbignJCcpO1xufTtcblxucmVwbGFjZUlERm9yVGVtcGxhdGUgPSBmdW5jdGlvbiAodGVtcGxhdGVTdHIsIHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHRlbXBsYXRlU3RyLmluZGV4T2YoJyRSZXByZXNlbnRhdGlvbklEJCcpID09PSAtMSkgeyByZXR1cm4gdGVtcGxhdGVTdHI7IH1cbiAgICB2YXIgdiA9IHZhbHVlLnRvU3RyaW5nKCk7XG4gICAgcmV0dXJuIHRlbXBsYXRlU3RyLnNwbGl0KCckUmVwcmVzZW50YXRpb25JRCQnKS5qb2luKHYpO1xufTtcblxuc2VnbWVudFRlbXBsYXRlID0ge1xuICAgIHplcm9QYWRUb0xlbmd0aDogemVyb1BhZFRvTGVuZ3RoLFxuICAgIHJlcGxhY2VUb2tlbkZvclRlbXBsYXRlOiByZXBsYWNlVG9rZW5Gb3JUZW1wbGF0ZSxcbiAgICB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlOiB1bmVzY2FwZURvbGxhcnNJblRlbXBsYXRlLFxuICAgIHJlcGxhY2VJREZvclRlbXBsYXRlOiByZXBsYWNlSURGb3JUZW1wbGF0ZVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBzZWdtZW50VGVtcGxhdGU7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXZlbnRNZ3IgPSByZXF1aXJlKCcuL2V2ZW50TWFuYWdlci5qcycpLFxuICAgIGV2ZW50RGlzcGF0Y2hlck1peGluID0ge1xuICAgICAgICB0cmlnZ2VyOiBmdW5jdGlvbihldmVudE9iamVjdCkgeyBldmVudE1nci50cmlnZ2VyKHRoaXMsIGV2ZW50T2JqZWN0KTsgfSxcbiAgICAgICAgb25lOiBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lckZuKSB7IGV2ZW50TWdyLm9uZSh0aGlzLCB0eXBlLCBsaXN0ZW5lckZuKTsgfSxcbiAgICAgICAgb246IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyRm4pIHsgZXZlbnRNZ3Iub24odGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH0sXG4gICAgICAgIG9mZjogZnVuY3Rpb24odHlwZSwgbGlzdGVuZXJGbikgeyBldmVudE1nci5vZmYodGhpcywgdHlwZSwgbGlzdGVuZXJGbik7IH1cbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50RGlzcGF0Y2hlck1peGluOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHZpZGVvanMgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JykudmlkZW9qcyxcbiAgICBldmVudE1hbmFnZXIgPSB7XG4gICAgICAgIHRyaWdnZXI6IHZpZGVvanMudHJpZ2dlcixcbiAgICAgICAgb25lOiB2aWRlb2pzLm9uZSxcbiAgICAgICAgb246IHZpZGVvanMub24sXG4gICAgICAgIG9mZjogdmlkZW9qcy5vZmZcbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50TWFuYWdlcjtcbiIsIi8qKlxuICogQ3JlYXRlZCBieSBjcGlsbHNidXJ5IG9uIDEyLzMvMTQuXG4gKi9cbjsoZnVuY3Rpb24oKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIHJvb3QgPSByZXF1aXJlKCdnbG9iYWwvd2luZG93JyksXG4gICAgICAgIHZpZGVvanMgPSByb290LnZpZGVvanMsXG4gICAgICAgIFNvdXJjZUhhbmRsZXIgPSByZXF1aXJlKCcuL1NvdXJjZUhhbmRsZXInKTtcblxuICAgIGlmICghdmlkZW9qcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB2aWRlby5qcyBsaWJyYXJ5IG11c3QgYmUgaW5jbHVkZWQgdG8gdXNlIHRoaXMgTVBFRy1EQVNIIHNvdXJjZSBoYW5kbGVyLicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbkhhbmRsZVNvdXJjZShzb3VyY2UpIHtcbiAgICAgICAgLy8gRXh0ZXJuYWxpemUgaWYgdXNlZCBlbHNld2hlcmUuIFBvdGVudGlhbGx5IHVzZSBjb25zdGFudCBmdW5jdGlvbi5cbiAgICAgICAgdmFyIGRvZXNudEhhbmRsZVNvdXJjZSA9ICcnLFxuICAgICAgICAgICAgbWF5YmVIYW5kbGVTb3VyY2UgPSAnbWF5YmUnLFxuICAgICAgICAgICAgZGVmYXVsdEhhbmRsZVNvdXJjZSA9IGRvZXNudEhhbmRsZVNvdXJjZTtcblxuICAgICAgICAvLyBUT0RPOiBVc2Ugc2FmZXIgdmpzIGNoZWNrIChlLmcuIGhhbmRsZXMgSUUgY29uZGl0aW9ucyk/XG4gICAgICAgIC8vIFJlcXVpcmVzIE1lZGlhIFNvdXJjZSBFeHRlbnNpb25zXG4gICAgICAgIGlmICghKHJvb3QuTWVkaWFTb3VyY2UpKSB7XG4gICAgICAgICAgICByZXR1cm4gZG9lc250SGFuZGxlU291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHR5cGUgaXMgc3VwcG9ydGVkXG4gICAgICAgIGlmICgvYXBwbGljYXRpb25cXC9kYXNoXFwreG1sLy50ZXN0KHNvdXJjZS50eXBlKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ21hdGNoZWQgdHlwZScpO1xuICAgICAgICAgICAgcmV0dXJuIG1heWJlSGFuZGxlU291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGZpbGUgZXh0ZW5zaW9uIG1hdGNoZXNcbiAgICAgICAgaWYgKC9cXC5tcGQkL2kudGVzdChzb3VyY2Uuc3JjKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ21hdGNoZWQgZXh0ZW5zaW9uJyk7XG4gICAgICAgICAgICByZXR1cm4gbWF5YmVIYW5kbGVTb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZGVmYXVsdEhhbmRsZVNvdXJjZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoYW5kbGVTb3VyY2Uoc291cmNlLCB0ZWNoKSB7XG4gICAgICAgIHJldHVybiBuZXcgU291cmNlSGFuZGxlcihzb3VyY2UsIHRlY2gpO1xuICAgIH1cblxuICAgIC8vIFJlZ2lzdGVyIHRoZSBzb3VyY2UgaGFuZGxlclxuICAgIHZpZGVvanMuSHRtbDUucmVnaXN0ZXJTb3VyY2VIYW5kbGVyKHtcbiAgICAgICAgY2FuSGFuZGxlU291cmNlOiBjYW5IYW5kbGVTb3VyY2UsXG4gICAgICAgIGhhbmRsZVNvdXJjZTogaGFuZGxlU291cmNlXG4gICAgfSwgMCk7XG5cbn0uY2FsbCh0aGlzKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuLi91dGlsL2V4aXN0eS5qcycpLFxuICAgIHRydXRoeSA9IHJlcXVpcmUoJy4uL3V0aWwvdHJ1dGh5LmpzJyksXG4gICAgaXNTdHJpbmcgPSByZXF1aXJlKCcuLi91dGlsL2lzU3RyaW5nLmpzJyksXG4gICAgaXNGdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvaXNGdW5jdGlvbi5qcycpLFxuICAgIGxvYWRNYW5pZmVzdCA9IHJlcXVpcmUoJy4vbG9hZE1hbmlmZXN0LmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24gPSByZXF1aXJlKCcuLi9kYXNoL3NlZ21lbnRzL2dldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24uanMnKSxcbiAgICBnZXRNcGQgPSByZXF1aXJlKCcuLi9kYXNoL21wZC9nZXRNcGQuanMnKSxcbiAgICBnZXRTb3VyY2VCdWZmZXJUeXBlRnJvbVJlcHJlc2VudGF0aW9uLFxuICAgIGdldE1lZGlhVHlwZUZyb21NaW1lVHlwZSxcbiAgICBtZWRpYVR5cGVzID0gcmVxdWlyZSgnLi9NZWRpYVR5cGVzLmpzJyksXG4gICAgREVGQVVMVF9UWVBFID0gbWVkaWFUeXBlc1swXTtcblxuZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlID0gZnVuY3Rpb24obWltZVR5cGUsIHR5cGVzKSB7XG4gICAgaWYgKCFpc1N0cmluZyhtaW1lVHlwZSkpIHsgcmV0dXJuIERFRkFVTFRfVFlQRTsgfVxuICAgIHZhciBtYXRjaGVkVHlwZSA9IHR5cGVzLmZpbmQoZnVuY3Rpb24odHlwZSkge1xuICAgICAgICByZXR1cm4gKCEhbWltZVR5cGUgJiYgbWltZVR5cGUuaW5kZXhPZih0eXBlKSA+PSAwKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBleGlzdHkobWF0Y2hlZFR5cGUpID8gbWF0Y2hlZFR5cGUgOiBERUZBVUxUX1RZUEU7XG59O1xuXG4vLyBUT0RPOiBNb3ZlIHRvIG93biBtb2R1bGUgaW4gZGFzaCBwYWNrYWdlIHNvbWV3aGVyZVxuZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbiA9IGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgdmFyIGNvZGVjU3RyID0gcmVwcmVzZW50YXRpb24uZ2V0Q29kZWNzKCk7XG4gICAgdmFyIHR5cGVTdHIgPSByZXByZXNlbnRhdGlvbi5nZXRNaW1lVHlwZSgpO1xuXG4gICAgLy9OT1RFOiBMRUFESU5HIFpFUk9TIElOIENPREVDIFRZUEUvU1VCVFlQRSBBUkUgVEVDSE5JQ0FMTFkgTk9UIFNQRUMgQ09NUExJQU5ULCBCVVQgR1BBQyAmIE9USEVSXG4gICAgLy8gREFTSCBNUEQgR0VORVJBVE9SUyBQUk9EVUNFIFRIRVNFIE5PTi1DT01QTElBTlQgVkFMVUVTLiBIQU5ETElORyBIRVJFIEZPUiBOT1cuXG4gICAgLy8gU2VlOiBSRkMgNjM4MSBTZWMuIDMuNCAoaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYzODEjc2VjdGlvbi0zLjQpXG4gICAgdmFyIHBhcnNlZENvZGVjID0gY29kZWNTdHIuc3BsaXQoJy4nKS5tYXAoZnVuY3Rpb24oc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXjArKD8hXFwufCQpLywgJycpO1xuICAgIH0pO1xuICAgIHZhciBwcm9jZXNzZWRDb2RlY1N0ciA9IHBhcnNlZENvZGVjLmpvaW4oJy4nKTtcblxuICAgIHJldHVybiAodHlwZVN0ciArICc7Y29kZWNzPVwiJyArIHByb2Nlc3NlZENvZGVjU3RyICsgJ1wiJyk7XG59O1xuXG5cbmZ1bmN0aW9uIE1hbmlmZXN0KHNvdXJjZVVyaSwgYXV0b0xvYWQpIHtcbiAgICB0aGlzLl9fYXV0b0xvYWQgPSB0cnV0aHkoYXV0b0xvYWQpO1xuICAgIHRoaXMuc2V0U291cmNlVXJpKHNvdXJjZVVyaSk7XG59XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgTUFOSUZFU1RfTE9BREVEOiAnbWFuaWZlc3RMb2FkZWQnXG59O1xuXG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRTb3VyY2VVcmkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fX3NvdXJjZVVyaTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5zZXRTb3VyY2VVcmkgPSBmdW5jdGlvbiBzZXRTb3VyY2VVcmkoc291cmNlVXJpKSB7XG4gICAgLy8gVE9ETzogJ2V4aXN0eSgpJyBjaGVjayBmb3IgYm90aD9cbiAgICBpZiAoc291cmNlVXJpID09PSB0aGlzLl9fc291cmNlVXJpKSB7IHJldHVybjsgfVxuXG4gICAgLy8gVE9ETzogaXNTdHJpbmcoKSBjaGVjaz8gJ2V4aXN0eSgpJyBjaGVjaz9cbiAgICBpZiAoIXNvdXJjZVVyaSkge1xuICAgICAgICB0aGlzLl9fY2xlYXJTb3VyY2VVcmkoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuX19jbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpO1xuICAgIHRoaXMuX19zb3VyY2VVcmkgPSBzb3VyY2VVcmk7XG4gICAgaWYgKHRoaXMuX19hdXRvTG9hZCkge1xuICAgICAgICAvLyBUT0RPOiBJbXBsIGFueSBjbGVhbnVwIGZ1bmN0aW9uYWxpdHkgYXBwcm9wcmlhdGUgYmVmb3JlIGxvYWQuXG4gICAgICAgIHRoaXMubG9hZCgpO1xuICAgIH1cbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5fX2NsZWFyU291cmNlVXJpID0gZnVuY3Rpb24gY2xlYXJTb3VyY2VVcmkoKSB7XG4gICAgdGhpcy5fX3NvdXJjZVVyaSA9IG51bGw7XG4gICAgdGhpcy5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7XG4gICAgLy8gVE9ETzogaW1wbCBhbnkgb3RoZXIgY2xlYW51cCBmdW5jdGlvbmFsaXR5XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uIGxvYWQoLyogb3B0aW9uYWwgKi8gY2FsbGJhY2tGbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBsb2FkTWFuaWZlc3Qoc2VsZi5fX3NvdXJjZVVyaSwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICBzZWxmLl9fbWFuaWZlc3RDb250cm9sbGVyID0gZGF0YS5tYW5pZmVzdFhtbDtcbiAgICAgICAgc2VsZi5fX3NldHVwVXBkYXRlSW50ZXJ2YWwoKTtcbiAgICAgICAgc2VsZi50cmlnZ2VyKHsgdHlwZTpzZWxmLmV2ZW50TGlzdC5NQU5JRkVTVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOnNlbGYuX19tYW5pZmVzdENvbnRyb2xsZXJ9KTtcbiAgICAgICAgaWYgKGlzRnVuY3Rpb24oY2FsbGJhY2tGbikpIHsgY2FsbGJhY2tGbihkYXRhLm1hbmlmZXN0WG1sKTsgfVxuICAgIH0pO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLl9fY2xlYXJDdXJyZW50VXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBjbGVhckN1cnJlbnRVcGRhdGVJbnRlcnZhbCgpIHtcbiAgICBpZiAoIWV4aXN0eSh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpKSB7IHJldHVybjsgfVxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fX3VwZGF0ZUludGVydmFsKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5fX3NldHVwVXBkYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiBzZXR1cFVwZGF0ZUludGVydmFsKCkge1xuICAgIGlmICh0aGlzLl9fdXBkYXRlSW50ZXJ2YWwpIHsgc2VsZi5fX2NsZWFyQ3VycmVudFVwZGF0ZUludGVydmFsKCk7IH1cbiAgICBpZiAoIXRoaXMuZ2V0U2hvdWxkVXBkYXRlKCkpIHsgcmV0dXJuOyB9XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBtaW5VcGRhdGVSYXRlID0gMixcbiAgICAgICAgdXBkYXRlUmF0ZSA9IE1hdGgubWF4KHRoaXMuZ2V0VXBkYXRlUmF0ZSgpLCBtaW5VcGRhdGVSYXRlKTtcbiAgICB0aGlzLl9fdXBkYXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgc2VsZi5sb2FkKCk7XG4gICAgfSwgdXBkYXRlUmF0ZSk7XG59O1xuXG5NYW5pZmVzdC5wcm90b3R5cGUuZ2V0TWVkaWFTZXRCeVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVNldEJ5VHlwZSh0eXBlKSB7XG4gICAgaWYgKG1lZGlhVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHsgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHR5cGUuIFZhbHVlIG11c3QgYmUgb25lIG9mOiAnICsgbWVkaWFUeXBlcy5qb2luKCcsICcpKTsgfVxuICAgIHZhciBhZGFwdGF0aW9uU2V0cyA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3RDb250cm9sbGVyKS5nZXRQZXJpb2RzKClbMF0uZ2V0QWRhcHRhdGlvblNldHMoKSxcbiAgICAgICAgYWRhcHRhdGlvblNldFdpdGhUeXBlTWF0Y2ggPSBhZGFwdGF0aW9uU2V0cy5maW5kKGZ1bmN0aW9uKGFkYXB0YXRpb25TZXQpIHtcbiAgICAgICAgICAgIHJldHVybiAoZ2V0TWVkaWFUeXBlRnJvbU1pbWVUeXBlKGFkYXB0YXRpb25TZXQuZ2V0TWltZVR5cGUoKSwgbWVkaWFUeXBlcykgPT09IHR5cGUpO1xuICAgICAgICB9KTtcbiAgICBpZiAoIWV4aXN0eShhZGFwdGF0aW9uU2V0V2l0aFR5cGVNYXRjaCkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXRXaXRoVHlwZU1hdGNoKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRNZWRpYVNldHMgPSBmdW5jdGlvbiBnZXRNZWRpYVNldHMoKSB7XG4gICAgdmFyIGFkYXB0YXRpb25TZXRzID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdENvbnRyb2xsZXIpLmdldFBlcmlvZHMoKVswXS5nZXRBZGFwdGF0aW9uU2V0cygpLFxuICAgICAgICBtZWRpYVNldHMgPSBhZGFwdGF0aW9uU2V0cy5tYXAoZnVuY3Rpb24oYWRhcHRhdGlvblNldCkgeyByZXR1cm4gbmV3IE1lZGlhU2V0KGFkYXB0YXRpb25TZXQpOyB9KTtcbiAgICByZXR1cm4gbWVkaWFTZXRzO1xufTtcblxuTWFuaWZlc3QucHJvdG90eXBlLmdldFN0cmVhbVR5cGUgPSBmdW5jdGlvbiBnZXRTdHJlYW1UeXBlKCkge1xuICAgIHZhciBzdHJlYW1UeXBlID0gZ2V0TXBkKHRoaXMuX19tYW5pZmVzdENvbnRyb2xsZXIpLmdldFR5cGUoKTtcbiAgICByZXR1cm4gc3RyZWFtVHlwZTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRVcGRhdGVSYXRlID0gZnVuY3Rpb24gZ2V0VXBkYXRlUmF0ZSgpIHtcbiAgICB2YXIgbWluaW11bVVwZGF0ZVBlcmlvZCA9IGdldE1wZCh0aGlzLl9fbWFuaWZlc3RDb250cm9sbGVyKS5nZXRNaW5pbXVtVXBkYXRlUGVyaW9kKCk7XG4gICAgcmV0dXJuIE51bWJlcihtaW5pbXVtVXBkYXRlUGVyaW9kKTtcbn07XG5cbk1hbmlmZXN0LnByb3RvdHlwZS5nZXRTaG91bGRVcGRhdGUgPSBmdW5jdGlvbiBnZXRTaG91bGRVcGRhdGUoKSB7XG4gICAgdmFyIGlzRHluYW1pYyA9ICh0aGlzLmdldFN0cmVhbVR5cGUoKSA9PT0gJ2R5bmFtaWMnKSxcbiAgICAgICAgaGFzVmFsaWRVcGRhdGVSYXRlID0gKHRoaXMuZ2V0VXBkYXRlUmF0ZSgpID4gMCk7XG4gICAgcmV0dXJuIChpc0R5bmFtaWMgJiYgaGFzVmFsaWRVcGRhdGVSYXRlKTtcbn07XG5cbmV4dGVuZE9iamVjdChNYW5pZmVzdC5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxuZnVuY3Rpb24gTWVkaWFTZXQoYWRhcHRhdGlvblNldCkge1xuICAgIC8vIFRPRE86IEFkZGl0aW9uYWwgY2hlY2tzICYgRXJyb3IgVGhyb3dpbmdcbiAgICB0aGlzLl9fYWRhcHRhdGlvblNldCA9IGFkYXB0YXRpb25TZXQ7XG59XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRNZWRpYVR5cGUgPSBmdW5jdGlvbiBnZXRNZWRpYVR5cGUoKSB7XG4gICAgdmFyIHR5cGUgPSBnZXRNZWRpYVR5cGVGcm9tTWltZVR5cGUodGhpcy5nZXRNaW1lVHlwZSgpLCBtZWRpYVR5cGVzKTtcbiAgICByZXR1cm4gdHlwZTtcbn07XG5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRNaW1lVHlwZSA9IGZ1bmN0aW9uIGdldE1pbWVUeXBlKCkge1xuICAgIHZhciBtaW1lVHlwZSA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldE1pbWVUeXBlKCk7XG4gICAgcmV0dXJuIG1pbWVUeXBlO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNvdXJjZUJ1ZmZlclR5cGUgPSBmdW5jdGlvbiBnZXRTb3VyY2VCdWZmZXJUeXBlKCkge1xuICAgIC8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGUgY29kZWNzIGFzc29jaWF0ZWQgd2l0aCBlYWNoIHN0cmVhbSB2YXJpYW50L3JlcHJlc2VudGF0aW9uXG4gICAgLy8gd2lsbCBiZSBzaW1pbGFyIGVub3VnaCB0aGF0IHlvdSB3b24ndCBoYXZlIHRvIHJlLWNyZWF0ZSB0aGUgc291cmNlLWJ1ZmZlciB3aGVuIHN3aXRjaGluZ1xuICAgIC8vIGJldHdlZW4gdGhlbS5cblxuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzb3VyY2VCdWZmZXJUeXBlID0gZ2V0U291cmNlQnVmZmVyVHlwZUZyb21SZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbik7XG4gICAgcmV0dXJuIHNvdXJjZUJ1ZmZlclR5cGU7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0VG90YWxEdXJhdGlvbiA9IGZ1bmN0aW9uIGdldFRvdGFsRHVyYXRpb24oKSB7XG4gICAgdmFyIHJlcHJlc2VudGF0aW9uID0gdGhpcy5fX2FkYXB0YXRpb25TZXQuZ2V0UmVwcmVzZW50YXRpb25zKClbMF0sXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbiksXG4gICAgICAgIHRvdGFsRHVyYXRpb24gPSBzZWdtZW50TGlzdC5nZXRUb3RhbER1cmF0aW9uKCk7XG4gICAgcmV0dXJuIHRvdGFsRHVyYXRpb247XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRUb3RhbFNlZ21lbnRDb3VudCA9IGZ1bmN0aW9uIGdldFRvdGFsU2VnbWVudENvdW50KCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbiA9IHRoaXMuX19hZGFwdGF0aW9uU2V0LmdldFJlcHJlc2VudGF0aW9ucygpWzBdLFxuICAgICAgICBzZWdtZW50TGlzdCA9IGdldFNlZ21lbnRMaXN0Rm9yUmVwcmVzZW50YXRpb24ocmVwcmVzZW50YXRpb24pLFxuICAgICAgICB0b3RhbFNlZ21lbnRDb3VudCA9IHNlZ21lbnRMaXN0LmdldFRvdGFsU2VnbWVudENvdW50KCk7XG4gICAgcmV0dXJuIHRvdGFsU2VnbWVudENvdW50O1xufTtcblxuLy8gTk9URTogQ3VycmVudGx5IGFzc3VtaW5nIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGNvbnNpc3RlbnQgYWNyb3NzIGFsbCByZXByZXNlbnRhdGlvbnMuIFdoaWxlIHRoaXMgaXMgKnVzdWFsbHkqXG4vLyB0aGUgY2FzZSBpbiBhY3R1YWwgcHJhY3RpY2UsIHRoZSBzcGVjICpkb2VzKiBhbGxvdyBzZWdtZW50cyB0byBub3QgYWxpZ24gYWNyb3NzIHJlcHJlc2VudGF0aW9ucy5cbi8vIFNlZSwgZm9yIGV4YW1wbGU6IEBzZWdtZW50QWxpZ25tZW50IEFkYXB0YXRpb25TZXQgYXR0cmlidXRlLCBJU08gSUVDIDIzMDA5LTEgU2VjLiA1LjMuMy4yLCBwcCAyNC01LlxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnREdXJhdGlvbiA9IGZ1bmN0aW9uIGdldFNlZ21lbnREdXJhdGlvbigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudER1cmF0aW9uID0gc2VnbWVudExpc3QuZ2V0U2VnbWVudER1cmF0aW9uKCk7XG4gICAgcmV0dXJuIHNlZ21lbnREdXJhdGlvbjtcbn07XG5cbi8vIE5PVEU6IEN1cnJlbnRseSBhc3N1bWluZyB0aGVzZSB2YWx1ZXMgd2lsbCBiZSBjb25zaXN0ZW50IGFjcm9zcyBhbGwgcmVwcmVzZW50YXRpb25zLiBXaGlsZSB0aGlzIGlzICp1c3VhbGx5KlxuLy8gdGhlIGNhc2UgaW4gYWN0dWFsIHByYWN0aWNlLCB0aGUgc3BlYyAqZG9lcyogYWxsb3cgc2VnbWVudHMgdG8gbm90IGFsaWduIGFjcm9zcyByZXByZXNlbnRhdGlvbnMuXG4vLyBTZWUsIGZvciBleGFtcGxlOiBAc2VnbWVudEFsaWdubWVudCBBZGFwdGF0aW9uU2V0IGF0dHJpYnV0ZSwgSVNPIElFQyAyMzAwOS0xIFNlYy4gNS4zLjMuMiwgcHAgMjQtNS5cbk1lZGlhU2V0LnByb3RvdHlwZS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RTdGFydE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudExpc3RTdGFydE51bWJlciA9IHNlZ21lbnRMaXN0LmdldFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0U3RhcnROdW1iZXI7XG59O1xuXG4vLyBOT1RFOiBDdXJyZW50bHkgYXNzdW1pbmcgdGhlc2UgdmFsdWVzIHdpbGwgYmUgY29uc2lzdGVudCBhY3Jvc3MgYWxsIHJlcHJlc2VudGF0aW9ucy4gV2hpbGUgdGhpcyBpcyAqdXN1YWxseSpcbi8vIHRoZSBjYXNlIGluIGFjdHVhbCBwcmFjdGljZSwgdGhlIHNwZWMgKmRvZXMqIGFsbG93IHNlZ21lbnRzIHRvIG5vdCBhbGlnbiBhY3Jvc3MgcmVwcmVzZW50YXRpb25zLlxuLy8gU2VlLCBmb3IgZXhhbXBsZTogQHNlZ21lbnRBbGlnbm1lbnQgQWRhcHRhdGlvblNldCBhdHRyaWJ1dGUsIElTTyBJRUMgMjMwMDktMSBTZWMuIDUuMy4zLjIsIHBwIDI0LTUuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIgPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdEVuZE51bWJlcigpIHtcbiAgICB2YXIgcmVwcmVzZW50YXRpb24gPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKVswXSxcbiAgICAgICAgc2VnbWVudExpc3QgPSBnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKHJlcHJlc2VudGF0aW9uKSxcbiAgICAgICAgc2VnbWVudExpc3RFbmROdW1iZXIgPSBzZWdtZW50TGlzdC5nZXRFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RFbmROdW1iZXI7XG59O1xuXG5NZWRpYVNldC5wcm90b3R5cGUuZ2V0U2VnbWVudExpc3RzID0gZnVuY3Rpb24gZ2V0U2VnbWVudExpc3RzKCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKSxcbiAgICAgICAgc2VnbWVudExpc3RzID0gcmVwcmVzZW50YXRpb25zLm1hcChnZXRTZWdtZW50TGlzdEZvclJlcHJlc2VudGF0aW9uKTtcbiAgICByZXR1cm4gc2VnbWVudExpc3RzO1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldFNlZ21lbnRMaXN0QnlCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRTZWdtZW50TGlzdEJ5QmFuZHdpZHRoKGJhbmR3aWR0aCkge1xuICAgIHZhciByZXByZXNlbnRhdGlvbnMgPSB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKSxcbiAgICAgICAgcmVwcmVzZW50YXRpb25XaXRoQmFuZHdpZHRoTWF0Y2ggPSByZXByZXNlbnRhdGlvbnMuZmluZChmdW5jdGlvbihyZXByZXNlbnRhdGlvbikge1xuICAgICAgICAgICAgdmFyIHJlcHJlc2VudGF0aW9uQmFuZHdpZHRoID0gcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCk7XG4gICAgICAgICAgICByZXR1cm4gKE51bWJlcihyZXByZXNlbnRhdGlvbkJhbmR3aWR0aCkgPT09IE51bWJlcihiYW5kd2lkdGgpKTtcbiAgICAgICAgfSksXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gZ2V0U2VnbWVudExpc3RGb3JSZXByZXNlbnRhdGlvbihyZXByZXNlbnRhdGlvbldpdGhCYW5kd2lkdGhNYXRjaCk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuTWVkaWFTZXQucHJvdG90eXBlLmdldEF2YWlsYWJsZUJhbmR3aWR0aHMgPSBmdW5jdGlvbiBnZXRBdmFpbGFibGVCYW5kd2lkdGhzKCkge1xuICAgIHJldHVybiB0aGlzLl9fYWRhcHRhdGlvblNldC5nZXRSZXByZXNlbnRhdGlvbnMoKS5tYXAoXG4gICAgICAgIGZ1bmN0aW9uKHJlcHJlc2VudGF0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVwcmVzZW50YXRpb24uZ2V0QmFuZHdpZHRoKCk7XG4gICAgfSkuZmlsdGVyKFxuICAgICAgICBmdW5jdGlvbihiYW5kd2lkdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBleGlzdHkoYmFuZHdpZHRoKTtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hbmlmZXN0OyIsIm1vZHVsZS5leHBvcnRzID0gWyd2aWRlbycsICdhdWRpbyddOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlUm9vdFVybCA9IHJlcXVpcmUoJy4uL2Rhc2gvbXBkL3V0aWwuanMnKS5wYXJzZVJvb3RVcmw7XG5cbmZ1bmN0aW9uIGxvYWRNYW5pZmVzdCh1cmwsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFjdHVhbFVybCA9IHBhcnNlUm9vdFVybCh1cmwpLFxuICAgICAgICByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIG9ubG9hZDtcblxuICAgIG9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc3RhdHVzIDwgMjAwIHx8IHJlcXVlc3Quc3RhdHVzID4gMjk5KSB7IHJldHVybjsgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2soe21hbmlmZXN0WG1sOiByZXF1ZXN0LnJlc3BvbnNlWE1MIH0pOyB9XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vdGhpcy5kZWJ1Zy5sb2coJ1N0YXJ0IGxvYWRpbmcgbWFuaWZlc3Q6ICcgKyB1cmwpO1xuICAgICAgICByZXF1ZXN0Lm9ubG9hZCA9IG9ubG9hZDtcbiAgICAgICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgICAgICByZXF1ZXN0LnNlbmQoKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgcmVxdWVzdC5vbmVycm9yKCk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxvYWRNYW5pZmVzdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleHRlbmRPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZE9iamVjdC5qcycpLFxuICAgIEV2ZW50RGlzcGF0Y2hlck1peGluID0gcmVxdWlyZSgnLi4vZXZlbnRzL0V2ZW50RGlzcGF0Y2hlck1peGluLmpzJyksXG4gICAgaXNBcnJheSA9IHJlcXVpcmUoJy4uL3V0aWwvaXNBcnJheS5qcycpLFxuICAgIGRvd25sb2FkUmF0ZXMgPSByZXF1aXJlKCcuL2Rvd25sb2FkUmF0ZS9Eb3dubG9hZFJhdGVzLmpzJyksXG4gICAgZXZlbnRMaXN0ID0gcmVxdWlyZSgnLi9kb3dubG9hZFJhdGUvRG93bmxvYWRSYXRlRXZlbnRUeXBlcy5qcycpO1xuXG5mdW5jdGlvbiBhZGRFdmVudEhhbmRsZXJUb1J1bGUoc2VsZiwgcnVsZSkge1xuICAgIHJ1bGUub24oc2VsZi5ldmVudExpc3QuRE9XTkxPQURfUkFURV9DSEFOR0VELCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBzZWxmLmRldGVybWluZURvd25sb2FkUmF0ZSgpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBEb3dubG9hZFJhdGVNYW5hZ2VyKGRvd25sb2FkUmF0ZVJ1bGVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChpc0FycmF5KGRvd25sb2FkUmF0ZVJ1bGVzKSkgeyB0aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMgPSBkb3dubG9hZFJhdGVSdWxlczsgfVxuICAgIGVsc2UgaWYgKCEhZG93bmxvYWRSYXRlUnVsZXMpIHsgdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzID0gW2Rvd25sb2FkUmF0ZVJ1bGVzXTsgfVxuICAgIGVsc2UgeyB0aGlzLl9fZG93bmxvYWRSYXRlUnVsZXMgPSBbXTsgfVxuICAgIC8vdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzID0gaXNBcnJheShkb3dubG9hZFJhdGVSdWxlcykgfHwgW107XG4gICAgdGhpcy5fX2Rvd25sb2FkUmF0ZVJ1bGVzLmZvckVhY2goZnVuY3Rpb24ocnVsZSkge1xuICAgICAgICBhZGRFdmVudEhhbmRsZXJUb1J1bGUoc2VsZiwgcnVsZSk7XG4gICAgfSk7XG4gICAgdGhpcy5fX2xhc3REb3dubG9hZFJhdGUgPSB0aGlzLmRvd25sb2FkUmF0ZXMuRE9OVF9ET1dOTE9BRDtcbiAgICB0aGlzLmRldGVybWluZURvd25sb2FkUmF0ZSgpO1xufVxuXG5Eb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZS5ldmVudExpc3QgPSBldmVudExpc3Q7XG5cbkRvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLmRvd25sb2FkUmF0ZXMgPSBkb3dubG9hZFJhdGVzO1xuXG5Eb3dubG9hZFJhdGVNYW5hZ2VyLnByb3RvdHlwZS5kZXRlcm1pbmVEb3dubG9hZFJhdGUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGN1cnJlbnREb3dubG9hZFJhdGUsXG4gICAgICAgIGZpbmFsRG93bmxvYWRSYXRlID0gZG93bmxvYWRSYXRlcy5ET05UX0RPV05MT0FEO1xuXG4gICAgLy8gVE9ETzogTWFrZSByZWxhdGlvbnNoaXAgYmV0d2VlbiBydWxlcyBzbWFydGVyIG9uY2Ugd2UgaW1wbGVtZW50IG11bHRpcGxlIHJ1bGVzLlxuICAgIHNlbGYuX19kb3dubG9hZFJhdGVSdWxlcy5mb3JFYWNoKGZ1bmN0aW9uKGRvd25sb2FkUmF0ZVJ1bGUpIHtcbiAgICAgICAgY3VycmVudERvd25sb2FkUmF0ZSA9IGRvd25sb2FkUmF0ZVJ1bGUuZ2V0RG93bmxvYWRSYXRlKCk7XG4gICAgICAgIGlmIChjdXJyZW50RG93bmxvYWRSYXRlID4gZmluYWxEb3dubG9hZFJhdGUpIHsgZmluYWxEb3dubG9hZFJhdGUgPSBjdXJyZW50RG93bmxvYWRSYXRlOyB9XG4gICAgfSk7XG5cbiAgICBpZiAoZmluYWxEb3dubG9hZFJhdGUgIT09IHNlbGYuX19sYXN0RG93bmxvYWRSYXRlKSB7XG4gICAgICAgIHNlbGYuX19sYXN0RG93bmxvYWRSYXRlID0gZmluYWxEb3dubG9hZFJhdGU7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7XG4gICAgICAgICAgICB0eXBlOnNlbGYuZXZlbnRMaXN0LkRPV05MT0FEX1JBVEVfQ0hBTkdFRCxcbiAgICAgICAgICAgIHRhcmdldDpzZWxmLFxuICAgICAgICAgICAgZG93bmxvYWRSYXRlOnNlbGYuX19sYXN0RG93bmxvYWRSYXRlXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBmaW5hbERvd25sb2FkUmF0ZTtcbn07XG5cbkRvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLmFkZERvd25sb2FkUmF0ZVJ1bGUgPSBmdW5jdGlvbihkb3dubG9hZFJhdGVSdWxlKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX19kb3dubG9hZFJhdGVSdWxlcy5wdXNoKGRvd25sb2FkUmF0ZVJ1bGUpO1xuICAgIGFkZEV2ZW50SGFuZGxlclRvUnVsZShzZWxmLCBkb3dubG9hZFJhdGVSdWxlKTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KERvd25sb2FkUmF0ZU1hbmFnZXIucHJvdG90eXBlLCBFdmVudERpc3BhdGNoZXJNaXhpbik7XG5cbm1vZHVsZS5leHBvcnRzID0gRG93bmxvYWRSYXRlTWFuYWdlcjsiLCJ2YXIgZXZlbnRMaXN0ID0ge1xuICAgIERPV05MT0FEX1JBVEVfQ0hBTkdFRDogJ2Rvd25sb2FkUmF0ZUNoYW5nZWQnXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50TGlzdDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBkb3dubG9hZFJhdGVzID0ge1xuICAgIERPTlRfRE9XTkxPQUQ6IDAsXG4gICAgUExBWUJBQ0tfUkFURTogMTAwMCxcbiAgICBET1dOTE9BRF9SQVRFOiAxMDAwMFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb3dubG9hZFJhdGVzOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4dGVuZE9iamVjdCA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvZXh0ZW5kT2JqZWN0LmpzJyksXG4gICAgRXZlbnREaXNwYXRjaGVyTWl4aW4gPSByZXF1aXJlKCcuLi8uLi9ldmVudHMvRXZlbnREaXNwYXRjaGVyTWl4aW4uanMnKSxcbiAgICBkb3dubG9hZFJhdGVzID0gcmVxdWlyZSgnLi9Eb3dubG9hZFJhdGVzLmpzJyksXG4gICAgZXZlbnRMaXN0ID0gcmVxdWlyZSgnLi9Eb3dubG9hZFJhdGVFdmVudFR5cGVzLmpzJyksXG4gICAgZG93bmxvYWRBbmRQbGF5YmFja0V2ZW50cyA9IFtcbiAgICAgICAgJ2xvYWRzdGFydCcsXG4gICAgICAgICdkdXJhdGlvbmNoYW5nZScsXG4gICAgICAgICdsb2FkZWRtZXRhZGF0YScsXG4gICAgICAgICdsb2FkZWRkYXRhJyxcbiAgICAgICAgJ3Byb2dyZXNzJyxcbiAgICAgICAgJ2NhbnBsYXknLFxuICAgICAgICAnY2FucGxheXRocm91Z2gnXG4gICAgXSxcbiAgICByZWFkeVN0YXRlcyA9IHtcbiAgICAgICAgSEFWRV9OT1RISU5HOiAwLFxuICAgICAgICBIQVZFX01FVEFEQVRBOiAxLFxuICAgICAgICBIQVZFX0NVUlJFTlRfREFUQTogMixcbiAgICAgICAgSEFWRV9GVVRVUkVfREFUQTogMyxcbiAgICAgICAgSEFWRV9FTk9VR0hfREFUQTogNFxuICAgIH07XG5cbmZ1bmN0aW9uIGdldFJlYWR5U3RhdGUodGVjaCkge1xuICAgIHJldHVybiB0ZWNoLmVsKCkucmVhZHlTdGF0ZTtcbn1cblxuZnVuY3Rpb24gVmlkZW9SZWFkeVN0YXRlUnVsZSh0ZWNoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIFRPRE86IE51bGwvdHlwZSBjaGVja1xuICAgIHRoaXMuX190ZWNoID0gdGVjaDtcbiAgICB0aGlzLl9fZG93bmxvYWRSYXRlID0gdGhpcy5kb3dubG9hZFJhdGVzLkRPTlRfRE9XTkxPQUQ7XG5cbiAgICBmdW5jdGlvbiBkZXRlcm1pbmVEb3dubG9hZFJhdGUoKSB7XG4gICAgICAgIHZhciBkb3dubG9hZFJhdGUgPSAoZ2V0UmVhZHlTdGF0ZShzZWxmLl9fdGVjaCkgPT09IHJlYWR5U3RhdGVzLkhBVkVfRU5PVUdIX0RBVEEpID9cbiAgICAgICAgICAgIHNlbGYuZG93bmxvYWRSYXRlcy5QTEFZQkFDS19SQVRFIDpcbiAgICAgICAgICAgIHNlbGYuZG93bmxvYWRSYXRlcy5ET1dOTE9BRF9SQVRFO1xuICAgICAgICByZXR1cm4gZG93bmxvYWRSYXRlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHVwZGF0ZURvd25sb2FkUmF0ZSgpIHtcbiAgICAgICAgdmFyIG5ld0Rvd25sb2FkUmF0ZSA9IGRldGVybWluZURvd25sb2FkUmF0ZSgpO1xuICAgICAgICBpZiAoc2VsZi5fX2Rvd25sb2FkUmF0ZSAhPT0gbmV3RG93bmxvYWRSYXRlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRE9XTkxPQUQgUkFURSBDSEFOR0VEIFRPOiAnICsgbmV3RG93bmxvYWRSYXRlKTtcbiAgICAgICAgICAgIHNlbGYuX19kb3dubG9hZFJhdGUgPSBuZXdEb3dubG9hZFJhdGU7XG4gICAgICAgICAgICBzZWxmLnRyaWdnZXIoe1xuICAgICAgICAgICAgICAgIHR5cGU6c2VsZi5ldmVudExpc3QuRE9XTkxPQURfUkFURV9DSEFOR0VELFxuICAgICAgICAgICAgICAgIHRhcmdldDpzZWxmLFxuICAgICAgICAgICAgICAgIGRvd25sb2FkUmF0ZTpzZWxmLl9fZG93bmxvYWRSYXRlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGRvd25sb2FkQW5kUGxheWJhY2tFdmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudE5hbWUpIHtcbiAgICAgICAgdGVjaC5vbihldmVudE5hbWUsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdXBkYXRlRG93bmxvYWRSYXRlKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgdXBkYXRlRG93bmxvYWRSYXRlKCk7XG59XG5cblZpZGVvUmVhZHlTdGF0ZVJ1bGUucHJvdG90eXBlLmV2ZW50TGlzdCA9IGV2ZW50TGlzdDtcblxuLy8gVmFsdWUgTWVhbmluZ3M6XG4vL1xuLy8gRE9OVF9ET1dOTE9BRCAtICBTaG91bGQgbm90IGRvd25sb2FkIHNlZ21lbnRzLlxuLy8gUExBWUJBQ0tfUkFURSAtICBEb3dubG9hZCB0aGUgbmV4dCBzZWdtZW50IGF0IHRoZSByYXRlIGl0IHRha2VzIHRvIGNvbXBsZXRlIHBsYXliYWNrIG9mIHRoZSBwcmV2aW91cyBzZWdtZW50LlxuLy8gICAgICAgICAgICAgICAgICBJbiBvdGhlciB3b3Jkcywgb25jZSB0aGUgZGF0YSBmb3IgdGhlIGN1cnJlbnQgc2VnbWVudCBoYXMgYmVlbiBkb3dubG9hZGVkLFxuLy8gICAgICAgICAgICAgICAgICB3YWl0IHVudGlsIHNlZ21lbnQuZ2V0RHVyYXRpb24oKSBzZWNvbmRzIG9mIHN0cmVhbSBwbGF5YmFjayBoYXZlIGVsYXBzZWQgYmVmb3JlIHN0YXJ0aW5nIHRoZVxuLy8gICAgICAgICAgICAgICAgICBkb3dubG9hZCBvZiB0aGUgbmV4dCBzZWdtZW50LlxuLy8gRE9XTkxPQURfUkFURSAtICBEb3dubG9hZCB0aGUgbmV4dCBzZWdtZW50IG9uY2UgdGhlIHByZXZpb3VzIHNlZ21lbnQgaGFzIGZpbmlzaGVkIGRvd25sb2FkaW5nLlxuVmlkZW9SZWFkeVN0YXRlUnVsZS5wcm90b3R5cGUuZG93bmxvYWRSYXRlcyA9IGRvd25sb2FkUmF0ZXM7XG5cblZpZGVvUmVhZHlTdGF0ZVJ1bGUucHJvdG90eXBlLmdldERvd25sb2FkUmF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9fZG93bmxvYWRSYXRlO1xufTtcblxuLy8gQWRkIGV2ZW50IGRpc3BhdGNoZXIgZnVuY3Rpb25hbGl0eSB0byBwcm90b3R5cGUuXG5leHRlbmRPYmplY3QoVmlkZW9SZWFkeVN0YXRlUnVsZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWRlb1JlYWR5U3RhdGVSdWxlOyIsIlxudmFyIGV4aXN0eSA9IHJlcXVpcmUoJy4uL3V0aWwvZXhpc3R5LmpzJyksXG4gICAgaXNOdW1iZXIgPSByZXF1aXJlKCcuLi91dGlsL2lzTnVtYmVyLmpzJyksXG4gICAgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpLFxuICAgIGxvYWRTZWdtZW50LFxuICAgIERFRkFVTFRfUkVUUllfQ09VTlQgPSAzLFxuICAgIERFRkFVTFRfUkVUUllfSU5URVJWQUwgPSAyNTA7XG5cbmxvYWRTZWdtZW50ID0gZnVuY3Rpb24oc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCwgcmV0cnlJbnRlcnZhbCkge1xuICAgIHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcbiAgICB0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lID0gbnVsbDtcblxuICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCksXG4gICAgICAgIHVybCA9IHNlZ21lbnQuZ2V0VXJsKCk7XG4gICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcblxuICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChyZXF1ZXN0LnN0YXR1cyA8IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA+IDI5OSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBsb2FkIFNlZ21lbnQgQCBVUkw6ICcgKyBzZWdtZW50LmdldFVybCgpKTtcbiAgICAgICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRTZWdtZW50LmNhbGwodGhpcywgc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIH0sIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX19sYXN0RG93bmxvYWRDb21wbGV0ZVRpbWUgPSBOdW1iZXIoKG5ldyBEYXRlKCkuZ2V0VGltZSgpKS8xMDAwKTtcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrRm4gPT09ICdmdW5jdGlvbicpIHsgY2FsbGJhY2tGbihyZXF1ZXN0LnJlc3BvbnNlKTsgfVxuICAgIH07XG4gICAgLy9yZXF1ZXN0Lm9uZXJyb3IgPSByZXF1ZXN0Lm9ubG9hZGVuZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBjb25zb2xlLmxvZygnRmFpbGVkIHRvIGxvYWQgU2VnbWVudCBAIFVSTDogJyArIHNlZ21lbnQuZ2V0VXJsKCkpO1xuICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgbG9hZFNlZ21lbnQoc2VnbWVudCwgY2FsbGJhY2tGbiwgcmV0cnlDb3VudCAtIDEsIHJldHJ5SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSwgcmV0cnlJbnRlcnZhbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRkFJTEVEIFRPIExPQUQgU0VHTUVOVCBFVkVOIEFGVEVSIFJFVFJJRVMnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIHJlcXVlc3Quc2VuZCgpO1xufTtcblxuZnVuY3Rpb24gU2VnbWVudExvYWRlcihtYW5pZmVzdENvbnRyb2xsZXIsIG1lZGlhVHlwZSkge1xuICAgIGlmICghZXhpc3R5KG1hbmlmZXN0Q29udHJvbGxlcikpIHsgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyIG11c3QgYmUgaW5pdGlhbGl6ZWQgd2l0aCBhIG1hbmlmZXN0Q29udHJvbGxlciEnKTsgfVxuICAgIGlmICghZXhpc3R5KG1lZGlhVHlwZSkpIHsgdGhyb3cgbmV3IEVycm9yKCdTZWdtZW50TG9hZGVyIG11c3QgYmUgaW5pdGlhbGl6ZWQgd2l0aCBhIG1lZGlhVHlwZSEnKTsgfVxuICAgIHRoaXMuX19tYW5pZmVzdENvbnRyb2xsZXIgPSBtYW5pZmVzdENvbnRyb2xsZXI7XG4gICAgdGhpcy5fX21lZGlhVHlwZSA9IG1lZGlhVHlwZTtcbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IHRoaXMuZ2V0Q3VycmVudEJhbmR3aWR0aCgpO1xufVxuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5ldmVudExpc3QgPSB7XG4gICAgSU5JVElBTElaQVRJT05fTE9BREVEOiAnaW5pdGlhbGl6YXRpb25Mb2FkZWQnLFxuICAgIFNFR01FTlRfTE9BREVEOiAnc2VnbWVudExvYWRlZCdcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0TWVkaWFTZXQgPSBmdW5jdGlvbiBnZXRNZWRpYVNldCgpIHtcbiAgICB2YXIgbWVkaWFTZXQgPSB0aGlzLl9fbWFuaWZlc3RDb250cm9sbGVyLmdldE1lZGlhU2V0QnlUeXBlKHRoaXMuX19tZWRpYVR5cGUpO1xuICAgIHJldHVybiBtZWRpYVNldDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLl9fZ2V0RGVmYXVsdFNlZ21lbnRMaXN0ID0gZnVuY3Rpb24gZ2V0RGVmYXVsdFNlZ21lbnRMaXN0KCkge1xuICAgIHZhciBzZWdtZW50TGlzdCA9IHRoaXMuX19nZXRNZWRpYVNldCgpLmdldFNlZ21lbnRMaXN0cygpWzBdO1xuICAgIHJldHVybiBzZWdtZW50TGlzdDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRCYW5kd2lkdGggPSBmdW5jdGlvbiBnZXRDdXJyZW50QmFuZHdpZHRoKCkge1xuICAgIGlmICghaXNOdW1iZXIodGhpcy5fX2N1cnJlbnRCYW5kd2lkdGgpKSB7IHRoaXMuX19jdXJyZW50QmFuZHdpZHRoID0gdGhpcy5fX2dldERlZmF1bHRTZWdtZW50TGlzdCgpLmdldEJhbmR3aWR0aCgpOyB9XG4gICAgcmV0dXJuIHRoaXMuX19jdXJyZW50QmFuZHdpZHRoO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuc2V0Q3VycmVudEJhbmR3aWR0aCA9IGZ1bmN0aW9uIHNldEN1cnJlbnRCYW5kd2lkdGgoYmFuZHdpZHRoKSB7XG4gICAgaWYgKCFpc051bWJlcihiYW5kd2lkdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VnbWVudExvYWRlcjo6c2V0Q3VycmVudEJhbmR3aWR0aCgpIGV4cGVjdHMgYSBudW1lcmljIHZhbHVlIGZvciBiYW5kd2lkdGghJyk7XG4gICAgfVxuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5nZXRBdmFpbGFibGVCYW5kd2lkdGhzKCk7XG4gICAgaWYgKGF2YWlsYWJsZUJhbmR3aWR0aHMuaW5kZXhPZihiYW5kd2lkdGgpIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnRMb2FkZXI6OnNldEN1cnJlbnRCYW5kd2lkdGgoKSBtdXN0IGJlIHNldCB0byBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXM6ICcgKyBhdmFpbGFibGVCYW5kd2lkdGhzLmpvaW4oJywgJykpO1xuICAgIH1cbiAgICB0aGlzLl9fY3VycmVudEJhbmR3aWR0aCA9IGJhbmR3aWR0aDtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldEN1cnJlbnRTZWdtZW50TGlzdCA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TGlzdCgpIHtcbiAgICB2YXIgc2VnbWVudExpc3QgPSAgdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RCeUJhbmR3aWR0aCh0aGlzLmdldEN1cnJlbnRCYW5kd2lkdGgoKSk7XG4gICAgcmV0dXJuIHNlZ21lbnRMaXN0O1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhdmFpbGFibGVCYW5kd2lkdGhzID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0QXZhaWxhYmxlQmFuZHdpZHRocygpO1xuICAgIHJldHVybiBhdmFpbGFibGVCYW5kd2lkdGhzO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0U3RhcnROdW1iZXIgPSBmdW5jdGlvbiBnZXRTdGFydE51bWJlcigpIHtcbiAgICB2YXIgc3RhcnROdW1iZXIgPSB0aGlzLl9fZ2V0TWVkaWFTZXQoKS5nZXRTZWdtZW50TGlzdFN0YXJ0TnVtYmVyKCk7XG4gICAgcmV0dXJuIHN0YXJ0TnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0Q3VycmVudFNlZ21lbnQgPSBmdW5jdGlvbiBnZXRDdXJyZW50U2VnbWVudCgpIHtcbiAgICB2YXIgc2VnbWVudCA9IHRoaXMuZ2V0Q3VycmVudFNlZ21lbnRMaXN0KCkuZ2V0U2VnbWVudEJ5TnVtYmVyKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlcik7XG4gICAgcmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRDdXJyZW50U2VnbWVudE51bWJlciA9IGZ1bmN0aW9uIGdldEN1cnJlbnRTZWdtZW50TnVtYmVyKCkgeyByZXR1cm4gdGhpcy5fX2N1cnJlbnRTZWdtZW50TnVtYmVyOyB9O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRFbmROdW1iZXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZW5kTnVtYmVyID0gdGhpcy5fX2dldE1lZGlhU2V0KCkuZ2V0U2VnbWVudExpc3RFbmROdW1iZXIoKTtcbiAgICByZXR1cm4gZW5kTnVtYmVyO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUuZ2V0TGFzdERvd25sb2FkU3RhcnRUaW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGV4aXN0eSh0aGlzLl9fbGFzdERvd25sb2FkU3RhcnRUaW1lKSA/IHRoaXMuX19sYXN0RG93bmxvYWRTdGFydFRpbWUgOiAtMTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBleGlzdHkodGhpcy5fX2xhc3REb3dubG9hZENvbXBsZXRlVGltZSkgPyB0aGlzLl9fbGFzdERvd25sb2FkQ29tcGxldGVUaW1lIDogLTE7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5nZXRMYXN0RG93bmxvYWRSb3VuZFRyaXBUaW1lU3BhbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldExhc3REb3dubG9hZENvbXBsZXRlVGltZSgpIC0gdGhpcy5nZXRMYXN0RG93bmxvYWRTdGFydFRpbWUoKTtcbn07XG5cblNlZ21lbnRMb2FkZXIucHJvdG90eXBlLmxvYWRJbml0aWFsaXphdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgc2VnbWVudExpc3QgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLFxuICAgICAgICBpbml0aWFsaXphdGlvbiA9IHNlZ21lbnRMaXN0LmdldEluaXRpYWxpemF0aW9uKCk7XG5cbiAgICBpZiAoIWluaXRpYWxpemF0aW9uKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBpbml0aWFsaXphdGlvbiwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgdmFyIGluaXRTZWdtZW50ID0gbmV3IFVpbnQ4QXJyYXkocmVzcG9uc2UpO1xuICAgICAgICBzZWxmLnRyaWdnZXIoeyB0eXBlOnNlbGYuZXZlbnRMaXN0LklOSVRJQUxJWkFUSU9OX0xPQURFRCwgdGFyZ2V0OnNlbGYsIGRhdGE6aW5pdFNlZ21lbnR9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufTtcblxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZE5leHRTZWdtZW50ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPSAoKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciA9PT0gbnVsbCkgfHwgKHRoaXMuX19jdXJyZW50U2VnbWVudE51bWJlciA9PT0gdW5kZWZpbmVkKSksXG4gICAgICAgIG51bWJlciA9IG5vQ3VycmVudFNlZ21lbnROdW1iZXIgPyB0aGlzLmdldFN0YXJ0TnVtYmVyKCkgOiB0aGlzLl9fY3VycmVudFNlZ21lbnROdW1iZXIgKyAxO1xuICAgIHJldHVybiB0aGlzLmxvYWRTZWdtZW50QXROdW1iZXIobnVtYmVyKTtcbn07XG5cbi8vIFRPRE86IER1cGxpY2F0ZSBjb2RlIGJlbG93LiBBYnN0cmFjdCBhd2F5LlxuU2VnbWVudExvYWRlci5wcm90b3R5cGUubG9hZFNlZ21lbnRBdE51bWJlciA9IGZ1bmN0aW9uKG51bWJlcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIGlmIChudW1iZXIgPiB0aGlzLmdldEVuZE51bWJlcigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSB0aGlzLmdldEN1cnJlbnRTZWdtZW50TGlzdCgpLmdldFNlZ21lbnRCeU51bWJlcihudW1iZXIpO1xuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50IH0pO1xuICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5TZWdtZW50TG9hZGVyLnByb3RvdHlwZS5sb2FkU2VnbWVudEF0VGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIHNlZ21lbnRMaXN0ID0gdGhpcy5nZXRDdXJyZW50U2VnbWVudExpc3QoKTtcblxuICAgIGlmIChwcmVzZW50YXRpb25UaW1lID4gc2VnbWVudExpc3QuZ2V0VG90YWxEdXJhdGlvbigpKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgdmFyIHNlZ21lbnQgPSBzZWdtZW50TGlzdC5nZXRTZWdtZW50QnlUaW1lKHByZXNlbnRhdGlvblRpbWUpO1xuXG4gICAgbG9hZFNlZ21lbnQuY2FsbCh0aGlzLCBzZWdtZW50LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICBzZWxmLl9fY3VycmVudFNlZ21lbnROdW1iZXIgPSBzZWdtZW50LmdldE51bWJlcigpO1xuICAgICAgICB2YXIgaW5pdFNlZ21lbnQgPSBuZXcgVWludDhBcnJheShyZXNwb25zZSk7XG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9MT0FERUQsIHRhcmdldDpzZWxmLCBkYXRhOmluaXRTZWdtZW50IH0pO1xuICAgIH0sIERFRkFVTFRfUkVUUllfQ09VTlQsIERFRkFVTFRfUkVUUllfSU5URVJWQUwpO1xuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBBZGQgZXZlbnQgZGlzcGF0Y2hlciBmdW5jdGlvbmFsaXR5IHRvIHByb3RvdHlwZS5cbmV4dGVuZE9iamVjdChTZWdtZW50TG9hZGVyLnByb3RvdHlwZSwgRXZlbnREaXNwYXRjaGVyTWl4aW4pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRMb2FkZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kT2JqZWN0ID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmRPYmplY3QuanMnKSxcbiAgICBFdmVudERpc3BhdGNoZXJNaXhpbiA9IHJlcXVpcmUoJy4uL2V2ZW50cy9FdmVudERpc3BhdGNoZXJNaXhpbi5qcycpO1xuXG5mdW5jdGlvbiBTb3VyY2VCdWZmZXJEYXRhUXVldWUoc291cmNlQnVmZmVyKSB7XG4gICAgLy8gVE9ETzogQ2hlY2sgdHlwZT9cbiAgICBpZiAoIXNvdXJjZUJ1ZmZlcikgeyB0aHJvdyBuZXcgRXJyb3IoICdUaGUgc291cmNlQnVmZmVyIGNvbnN0cnVjdG9yIGFyZ3VtZW50IGNhbm5vdCBiZSBudWxsLicgKTsgfVxuXG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBkYXRhUXVldWUgPSBbXTtcbiAgICAvLyBUT0RPOiBmaWd1cmUgb3V0IGhvdyB3ZSB3YW50IHRvIHJlc3BvbmQgdG8gb3RoZXIgZXZlbnQgc3RhdGVzICh1cGRhdGVlbmQ/IGVycm9yPyBhYm9ydD8pIChyZXRyeT8gcmVtb3ZlPylcbiAgICBzb3VyY2VCdWZmZXIuYWRkRXZlbnRMaXN0ZW5lcigndXBkYXRlZW5kJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgLy8gVGhlIFNvdXJjZUJ1ZmZlciBpbnN0YW5jZSdzIHVwZGF0aW5nIHByb3BlcnR5IHNob3VsZCBhbHdheXMgYmUgZmFsc2UgaWYgdGhpcyBldmVudCB3YXMgZGlzcGF0Y2hlZCxcbiAgICAgICAgLy8gYnV0IGp1c3QgaW4gY2FzZS4uLlxuICAgICAgICBpZiAoZXZlbnQudGFyZ2V0LnVwZGF0aW5nKSB7IHJldHVybjsgfVxuXG4gICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuU0VHTUVOVF9BRERFRF9UT19CVUZGRVIsIHRhcmdldDpzZWxmIH0pO1xuXG4gICAgICAgIGlmIChkYXRhUXVldWUubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgICAgIHNlbGYudHJpZ2dlcih7IHR5cGU6c2VsZi5ldmVudExpc3QuUVVFVUVfRU1QVFksIHRhcmdldDpzZWxmIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZXZlbnQudGFyZ2V0LmFwcGVuZEJ1ZmZlcihkYXRhUXVldWUuc2hpZnQoKSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9fZGF0YVF1ZXVlID0gZGF0YVF1ZXVlO1xuICAgIHRoaXMuX19zb3VyY2VCdWZmZXIgPSBzb3VyY2VCdWZmZXI7XG59XG5cbi8vIFRPRE86IEFkZCBhcyBcImNsYXNzXCIgcHJvcGVydGllcz9cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuZXZlbnRMaXN0ID0ge1xuICAgIFFVRVVFX0VNUFRZOiAncXVldWVFbXB0eScsXG4gICAgU0VHTUVOVF9BRERFRF9UT19CVUZGRVI6ICdzZWdtZW50QWRkZWRUb0J1ZmZlcidcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuYWRkVG9RdWV1ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAvLyBUT0RPOiBDaGVjayBmb3IgZXhpc3RlbmNlL3R5cGU/IENvbnZlcnQgdG8gVWludDhBcnJheSBleHRlcm5hbGx5IG9yIGludGVybmFsbHk/IChDdXJyZW50bHkgYXNzdW1pbmcgZXh0ZXJuYWwpXG4gICAgLy8gSWYgbm90aGluZyBpcyBpbiB0aGUgcXVldWUsIGdvIGFoZWFkIGFuZCBpbW1lZGlhdGVseSBhcHBlbmQgdGhlIHNlZ21lbnQgZGF0YSB0byB0aGUgc291cmNlIGJ1ZmZlci5cbiAgICBpZiAoKHRoaXMuX19kYXRhUXVldWUubGVuZ3RoID09PSAwKSAmJiAoIXRoaXMuX19zb3VyY2VCdWZmZXIudXBkYXRpbmcpKSB7IHRoaXMuX19zb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKGRhdGEpOyB9XG4gICAgLy8gT3RoZXJ3aXNlLCBwdXNoIG9udG8gcXVldWUgYW5kIHdhaXQgZm9yIHRoZSBuZXh0IHVwZGF0ZSBldmVudCBiZWZvcmUgYXBwZW5kaW5nIHNlZ21lbnQgZGF0YSB0byBzb3VyY2UgYnVmZmVyLlxuICAgIGVsc2UgeyB0aGlzLl9fZGF0YVF1ZXVlLnB1c2goZGF0YSk7IH1cbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuY2xlYXJRdWV1ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX19kYXRhUXVldWUgPSBbXTtcbn07XG5cblNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUuaGFzQnVmZmVyZWREYXRhRm9yVGltZSA9IGZ1bmN0aW9uKHByZXNlbnRhdGlvblRpbWUpIHtcbiAgICB2YXIgdGltZVJhbmdlcyA9IHRoaXMuX19zb3VyY2VCdWZmZXIuYnVmZmVyZWQsXG4gICAgICAgIHRpbWVSYW5nZXNMZW5ndGggPSB0aW1lUmFuZ2VzLmxlbmd0aCxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGN1cnJlbnRTdGFydFRpbWUsXG4gICAgICAgIGN1cnJlbnRFbmRUaW1lO1xuXG4gICAgZm9yIChpOyBpPHRpbWVSYW5nZXNMZW5ndGg7IGkrKykge1xuICAgICAgICBjdXJyZW50U3RhcnRUaW1lID0gdGltZVJhbmdlcy5zdGFydChpKTtcbiAgICAgICAgY3VycmVudEVuZFRpbWUgPSB0aW1lUmFuZ2VzLmVuZChpKTtcbiAgICAgICAgaWYgKChwcmVzZW50YXRpb25UaW1lID49IGN1cnJlbnRTdGFydFRpbWUpICYmIChwcmVzZW50YXRpb25UaW1lIDw9IGN1cnJlbnRFbmRUaW1lKSkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn07XG5cbi8vIEFkZCBldmVudCBkaXNwYXRjaGVyIGZ1bmN0aW9uYWxpdHkgdG8gcHJvdG90eXBlLlxuZXh0ZW5kT2JqZWN0KFNvdXJjZUJ1ZmZlckRhdGFRdWV1ZS5wcm90b3R5cGUsIEV2ZW50RGlzcGF0Y2hlck1peGluKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTb3VyY2VCdWZmZXJEYXRhUXVldWU7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBleGlzdHkoeCkgeyByZXR1cm4gKHggIT09IG51bGwpICYmICh4ICE9PSB1bmRlZmluZWQpOyB9XG5cbm1vZHVsZS5leHBvcnRzID0gZXhpc3R5OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gRXh0ZW5kIGEgZ2l2ZW4gb2JqZWN0IHdpdGggYWxsIHRoZSBwcm9wZXJ0aWVzIGluIHBhc3NlZC1pbiBvYmplY3QocykuXG52YXIgZXh0ZW5kT2JqZWN0ID0gZnVuY3Rpb24ob2JqIC8qLCBleHRlbmRPYmplY3QxLCBleHRlbmRPYmplY3QyLCAuLi4sIGV4dGVuZE9iamVjdE4gKi8pIHtcbiAgICBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLmZvckVhY2goZnVuY3Rpb24oZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgIGlmIChleHRlbmRPYmplY3QpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gZXh0ZW5kT2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgb2JqW3Byb3BdID0gZXh0ZW5kT2JqZWN0W3Byb3BdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIG9iajtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kT2JqZWN0OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyaWNPYmpUeXBlID0gZnVuY3Rpb24oKXt9LFxuICAgIG9iamVjdFJlZiA9IG5ldyBnZW5lcmljT2JqVHlwZSgpO1xuXG5mdW5jdGlvbiBpc0FycmF5KG9iaikge1xuICAgIHJldHVybiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBBcnJheV0nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXk7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbnZhciBpc0Z1bmN0aW9uID0gZnVuY3Rpb24gaXNGdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbic7XG59O1xuLy8gZmFsbGJhY2sgZm9yIG9sZGVyIHZlcnNpb25zIG9mIENocm9tZSBhbmQgU2FmYXJpXG5pZiAoaXNGdW5jdGlvbigveC8pKSB7XG4gICAgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicgJiYgb2JqZWN0UmVmLnRvU3RyaW5nLmNhbGwodmFsdWUpID09PSAnW29iamVjdCBGdW5jdGlvbl0nO1xuICAgIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNGdW5jdGlvbjsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmljT2JqVHlwZSA9IGZ1bmN0aW9uKCl7fSxcbiAgICBvYmplY3RSZWYgPSBuZXcgZ2VuZXJpY09ialR5cGUoKTtcblxuZnVuY3Rpb24gaXNOdW1iZXIodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyB8fFxuICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIG9iamVjdFJlZi50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gJ1tvYmplY3QgTnVtYmVyXScgfHwgZmFsc2U7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaXNOdW1iZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZ2VuZXJpY09ialR5cGUgPSBmdW5jdGlvbigpe30sXG4gICAgb2JqZWN0UmVmID0gbmV3IGdlbmVyaWNPYmpUeXBlKCk7XG5cbnZhciBpc1N0cmluZyA9IGZ1bmN0aW9uIGlzU3RyaW5nKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgfHxcbiAgICAgICAgdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBvYmplY3RSZWYudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09ICdbb2JqZWN0IFN0cmluZ10nIHx8IGZhbHNlO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBpc1N0cmluZzsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBleGlzdHkgPSByZXF1aXJlKCcuL2V4aXN0eS5qcycpO1xuXG4vLyBOT1RFOiBUaGlzIHZlcnNpb24gb2YgdHJ1dGh5IGFsbG93cyBtb3JlIHZhbHVlcyB0byBjb3VudFxuLy8gYXMgXCJ0cnVlXCIgdGhhbiBzdGFuZGFyZCBKUyBCb29sZWFuIG9wZXJhdG9yIGNvbXBhcmlzb25zLlxuLy8gU3BlY2lmaWNhbGx5LCB0cnV0aHkoKSB3aWxsIHJldHVybiB0cnVlIGZvciB0aGUgdmFsdWVzXG4vLyAwLCBcIlwiLCBhbmQgTmFOLCB3aGVyZWFzIEpTIHdvdWxkIHRyZWF0IHRoZXNlIGFzIFwiZmFsc3lcIiB2YWx1ZXMuXG5mdW5jdGlvbiB0cnV0aHkoeCkgeyByZXR1cm4gKHggIT09IGZhbHNlKSAmJiBleGlzdHkoeCk7IH1cblxubW9kdWxlLmV4cG9ydHMgPSB0cnV0aHk7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBUT0RPOiBSZWZhY3RvciB0byBzZXBhcmF0ZSBqcyBmaWxlcyAmIG1vZHVsZXMgJiByZW1vdmUgZnJvbSBoZXJlLlxuXG4vLyBOT1RFOiBUQUtFTiBGUk9NIExPREFTSCBUTyBSRU1PVkUgREVQRU5ERU5DWVxuLyoqIGBPYmplY3QjdG9TdHJpbmdgIHJlc3VsdCBzaG9ydGN1dHMgKi9cbnZhciBmdW5jQ2xhc3MgPSAnW29iamVjdCBGdW5jdGlvbl0nLFxuICAgIHN0cmluZ0NsYXNzID0gJ1tvYmplY3QgU3RyaW5nXSc7XG5cbi8qKiBVc2VkIHRvIHJlc29sdmUgdGhlIGludGVybmFsIFtbQ2xhc3NdXSBvZiB2YWx1ZXMgKi9cbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbnZhciBpc0Z1bmN0aW9uID0gZnVuY3Rpb24gaXNGdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbic7XG59O1xuLy8gZmFsbGJhY2sgZm9yIG9sZGVyIHZlcnNpb25zIG9mIENocm9tZSBhbmQgU2FmYXJpXG5pZiAoaXNGdW5jdGlvbigveC8pKSB7XG4gICAgaXNGdW5jdGlvbiA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicgJiYgdG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09IGZ1bmNDbGFzcztcbiAgICB9O1xufVxuXG52YXIgaXNTdHJpbmcgPSBmdW5jdGlvbiBpc1N0cmluZyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09IHN0cmluZ0NsYXNzIHx8IGZhbHNlO1xufTtcblxuLy8gTk9URTogRU5EIE9GIExPREFTSC1CQVNFRCBDT0RFXG5cbi8vIEdlbmVyYWwgVXRpbGl0eSBGdW5jdGlvbnNcbmZ1bmN0aW9uIGV4aXN0eSh4KSB7IHJldHVybiB4ICE9PSBudWxsOyB9XG5cbi8vIE5PVEU6IFRoaXMgdmVyc2lvbiBvZiB0cnV0aHkgYWxsb3dzIG1vcmUgdmFsdWVzIHRvIGNvdW50XG4vLyBhcyBcInRydWVcIiB0aGFuIHN0YW5kYXJkIEpTIEJvb2xlYW4gb3BlcmF0b3IgY29tcGFyaXNvbnMuXG4vLyBTcGVjaWZpY2FsbHksIHRydXRoeSgpIHdpbGwgcmV0dXJuIHRydWUgZm9yIHRoZSB2YWx1ZXNcbi8vIDAsIFwiXCIsIGFuZCBOYU4sIHdoZXJlYXMgSlMgd291bGQgdHJlYXQgdGhlc2UgYXMgXCJmYWxzeVwiIHZhbHVlcy5cbmZ1bmN0aW9uIHRydXRoeSh4KSB7IHJldHVybiAoeCAhPT0gZmFsc2UpICYmIGV4aXN0eSh4KTsgfVxuXG5mdW5jdGlvbiBwcmVBcHBseUFyZ3NGbihmdW4gLyosIGFyZ3MgKi8pIHtcbiAgICB2YXIgcHJlQXBwbGllZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgIC8vIE5PVEU6IHRoZSAqdGhpcyogcmVmZXJlbmNlIHdpbGwgcmVmZXIgdG8gdGhlIGNsb3N1cmUncyBjb250ZXh0IHVubGVzc1xuICAgIC8vIHRoZSByZXR1cm5lZCBmdW5jdGlvbiBpcyBpdHNlbGYgY2FsbGVkIHZpYSAuY2FsbCgpIG9yIC5hcHBseSgpLiBJZiB5b3VcbiAgICAvLyAqbmVlZCogdG8gcmVmZXIgdG8gaW5zdGFuY2UtbGV2ZWwgcHJvcGVydGllcywgZG8gc29tZXRoaW5nIGxpa2UgdGhlIGZvbGxvd2luZzpcbiAgICAvL1xuICAgIC8vIE15VHlwZS5wcm90b3R5cGUuc29tZUZuID0gZnVuY3Rpb24oYXJnQykgeyBwcmVBcHBseUFyZ3NGbihzb21lT3RoZXJGbiwgYXJnQSwgYXJnQiwgLi4uIGFyZ04pLmNhbGwodGhpcyk7IH07XG4gICAgLy9cbiAgICAvLyBPdGhlcndpc2UsIHlvdSBzaG91bGQgYmUgYWJsZSB0byBqdXN0IGNhbGw6XG4gICAgLy9cbiAgICAvLyBNeVR5cGUucHJvdG90eXBlLnNvbWVGbiA9IHByZUFwcGx5QXJnc0ZuKHNvbWVPdGhlckZuLCBhcmdBLCBhcmdCLCAuLi4gYXJnTik7XG4gICAgLy9cbiAgICAvLyBXaGVyZSBwb3NzaWJsZSwgZnVuY3Rpb25zIGFuZCBtZXRob2RzIHNob3VsZCBub3QgYmUgcmVhY2hpbmcgb3V0IHRvIGdsb2JhbCBzY29wZSBhbnl3YXksIHNvLi4uXG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkgeyByZXR1cm4gZnVuLmFwcGx5KHRoaXMsIHByZUFwcGxpZWRBcmdzKTsgfTtcbn1cblxuLy8gSGlnaGVyLW9yZGVyIFhNTCBmdW5jdGlvbnNcblxuLy8gVGFrZXMgZnVuY3Rpb24ocykgYXMgYXJndW1lbnRzXG52YXIgZ2V0QW5jZXN0b3JzID0gZnVuY3Rpb24oZWxlbSwgc2hvdWxkU3RvcFByZWQpIHtcbiAgICB2YXIgYW5jZXN0b3JzID0gW107XG4gICAgaWYgKCFpc0Z1bmN0aW9uKHNob3VsZFN0b3BQcmVkKSkgeyBzaG91bGRTdG9wUHJlZCA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gZmFsc2U7IH07IH1cbiAgICAoZnVuY3Rpb24gZ2V0QW5jZXN0b3JzUmVjdXJzZShlbGVtKSB7XG4gICAgICAgIGlmIChzaG91bGRTdG9wUHJlZChlbGVtLCBhbmNlc3RvcnMpKSB7IHJldHVybjsgfVxuICAgICAgICBpZiAoZXhpc3R5KGVsZW0pICYmIGV4aXN0eShlbGVtLnBhcmVudE5vZGUpKSB7XG4gICAgICAgICAgICBhbmNlc3RvcnMucHVzaChlbGVtLnBhcmVudE5vZGUpO1xuICAgICAgICAgICAgZ2V0QW5jZXN0b3JzUmVjdXJzZShlbGVtLnBhcmVudE5vZGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9KShlbGVtKTtcbiAgICByZXR1cm4gYW5jZXN0b3JzO1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGdldE5vZGVMaXN0QnlOYW1lID0gZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiBmdW5jdGlvbih4bWxPYmopIHtcbiAgICAgICAgcmV0dXJuIHhtbE9iai5nZXRFbGVtZW50c0J5VGFnTmFtZShuYW1lKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxudmFyIGhhc01hdGNoaW5nQXR0cmlidXRlID0gZnVuY3Rpb24oYXR0ck5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKCh0eXBlb2YgYXR0ck5hbWUgIT09ICdzdHJpbmcnKSB8fCBhdHRyTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIHJldHVybiBmdW5jdGlvbihlbGVtKSB7XG4gICAgICAgIGlmICghZXhpc3R5KGVsZW0pIHx8ICFleGlzdHkoZWxlbS5oYXNBdHRyaWJ1dGUpIHx8ICFleGlzdHkoZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiBmYWxzZTsgfVxuICAgICAgICBpZiAoIWV4aXN0eSh2YWx1ZSkpIHsgcmV0dXJuIGVsZW0uaGFzQXR0cmlidXRlKGF0dHJOYW1lKTsgfVxuICAgICAgICByZXR1cm4gKGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKSA9PT0gdmFsdWUpO1xuICAgIH07XG59O1xuXG4vLyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0QXR0ckZuID0gZnVuY3Rpb24oYXR0ck5hbWUpIHtcbiAgICBpZiAoIWlzU3RyaW5nKGF0dHJOYW1lKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWlzRnVuY3Rpb24oZWxlbS5nZXRBdHRyaWJ1dGUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgcmV0dXJuIGVsZW0uZ2V0QXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9O1xufTtcblxuLy8gUmV0dXJucyBmdW5jdGlvblxuLy8gVE9ETzogQWRkIHNob3VsZFN0b3BQcmVkIChzaG91bGQgZnVuY3Rpb24gc2ltaWxhcmx5IHRvIHNob3VsZFN0b3BQcmVkIGluIGdldEluaGVyaXRhYmxlRWxlbWVudCwgYmVsb3cpXG52YXIgZ2V0SW5oZXJpdGFibGVBdHRyaWJ1dGUgPSBmdW5jdGlvbihhdHRyTmFtZSkge1xuICAgIGlmICgoIWlzU3RyaW5nKGF0dHJOYW1lKSkgfHwgYXR0ck5hbWUgPT09ICcnKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICByZXR1cm4gZnVuY3Rpb24gcmVjdXJzZUNoZWNrQW5jZXN0b3JBdHRyKGVsZW0pIHtcbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbSkgfHwgIWV4aXN0eShlbGVtLmhhc0F0dHJpYnV0ZSkgfHwgIWV4aXN0eShlbGVtLmdldEF0dHJpYnV0ZSkpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgICAgICBpZiAoZWxlbS5oYXNBdHRyaWJ1dGUoYXR0ck5hbWUpKSB7IHJldHVybiBlbGVtLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7IH1cbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiByZWN1cnNlQ2hlY2tBbmNlc3RvckF0dHIoZWxlbS5wYXJlbnROb2RlKTtcbiAgICB9O1xufTtcblxuLy8gVGFrZXMgZnVuY3Rpb24ocykgYXMgYXJndW1lbnRzOyBSZXR1cm5zIGZ1bmN0aW9uXG52YXIgZ2V0SW5oZXJpdGFibGVFbGVtZW50ID0gZnVuY3Rpb24obm9kZU5hbWUsIHNob3VsZFN0b3BQcmVkKSB7XG4gICAgaWYgKCghaXNTdHJpbmcobm9kZU5hbWUpKSB8fCBub2RlTmFtZSA9PT0gJycpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmICghaXNGdW5jdGlvbihzaG91bGRTdG9wUHJlZCkpIHsgc2hvdWxkU3RvcFByZWQgPSBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9OyB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldEluaGVyaXRhYmxlRWxlbWVudFJlY3Vyc2UoZWxlbSkge1xuICAgICAgICBpZiAoIWV4aXN0eShlbGVtKSB8fCAhZXhpc3R5KGVsZW0uZ2V0RWxlbWVudHNCeVRhZ05hbWUpKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgaWYgKHNob3VsZFN0b3BQcmVkKGVsZW0pKSB7IHJldHVybiB1bmRlZmluZWQ7IH1cbiAgICAgICAgdmFyIG1hdGNoaW5nRWxlbUxpc3QgPSBlbGVtLmdldEVsZW1lbnRzQnlUYWdOYW1lKG5vZGVOYW1lKTtcbiAgICAgICAgaWYgKGV4aXN0eShtYXRjaGluZ0VsZW1MaXN0KSAmJiBtYXRjaGluZ0VsZW1MaXN0Lmxlbmd0aCA+IDApIHsgcmV0dXJuIG1hdGNoaW5nRWxlbUxpc3RbMF07IH1cbiAgICAgICAgaWYgKCFleGlzdHkoZWxlbS5wYXJlbnROb2RlKSkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgICAgIHJldHVybiBnZXRJbmhlcml0YWJsZUVsZW1lbnRSZWN1cnNlKGVsZW0ucGFyZW50Tm9kZSk7XG4gICAgfTtcbn07XG5cbi8vIFRPRE86IEltcGxlbWVudCBtZSBmb3IgQmFzZVVSTCBvciB1c2UgZXhpc3RpbmcgZm4gKFNlZTogbXBkLmpzIGJ1aWxkQmFzZVVybCgpKVxuLyp2YXIgYnVpbGRIaWVyYXJjaGljYWxseVN0cnVjdHVyZWRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlRm4sIGJ1aWxkRm4sIHN0b3BQcmVkKSB7XG5cbn07Ki9cblxuLy8gUHVibGlzaCBFeHRlcm5hbCBBUEk6XG52YXIgeG1sZnVuID0ge307XG54bWxmdW4uZXhpc3R5ID0gZXhpc3R5O1xueG1sZnVuLnRydXRoeSA9IHRydXRoeTtcblxueG1sZnVuLmdldE5vZGVMaXN0QnlOYW1lID0gZ2V0Tm9kZUxpc3RCeU5hbWU7XG54bWxmdW4uaGFzTWF0Y2hpbmdBdHRyaWJ1dGUgPSBoYXNNYXRjaGluZ0F0dHJpYnV0ZTtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUF0dHJpYnV0ZSA9IGdldEluaGVyaXRhYmxlQXR0cmlidXRlO1xueG1sZnVuLmdldEFuY2VzdG9ycyA9IGdldEFuY2VzdG9ycztcbnhtbGZ1bi5nZXRBdHRyRm4gPSBnZXRBdHRyRm47XG54bWxmdW4ucHJlQXBwbHlBcmdzRm4gPSBwcmVBcHBseUFyZ3NGbjtcbnhtbGZ1bi5nZXRJbmhlcml0YWJsZUVsZW1lbnQgPSBnZXRJbmhlcml0YWJsZUVsZW1lbnQ7XG5cbm1vZHVsZS5leHBvcnRzID0geG1sZnVuOyJdfQ==
