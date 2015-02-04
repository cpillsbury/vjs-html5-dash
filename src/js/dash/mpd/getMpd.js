'use strict';

var getXmlFun = require('../../getXmlFun.js'),
    xmlFun = getXmlFun(),
    getDashUtil = require('./getDashUtil.js'),
    dashUtil = getDashUtil(),
    isArray = require('../../util/isArray.js'),
    isFunction = require('../../util/isFunction.js'),
    isString = require('../../util/isString.js'),
    parseRootUrl = dashUtil.parseRootUrl,
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
    var elemHierarchy = [xmlNode].concat(xmlFun.getAncestors(xmlNode)),
        foundLocalBaseUrl = false;
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
var getWidth = xmlFun.getInheritableAttribute('width'),
    getHeight = xmlFun.getInheritableAttribute('height'),
    getFrameRate = xmlFun.getInheritableAttribute('frameRate'),
    getMimeType = xmlFun.getInheritableAttribute('mimeType'),
    getCodecs = xmlFun.getInheritableAttribute('codecs');

var getSegmentTemplateXmlList = xmlFun.getMultiLevelElementList('SegmentTemplate');

// MPD Attr fns
var getMediaPresentationDuration = xmlFun.getAttrFn('mediaPresentationDuration'),
    getType = xmlFun.getAttrFn('type'),
    getMinimumUpdatePeriod = xmlFun.getAttrFn('minimumUpdatePeriod'),
    getAvailabilityStartTime = xmlFun.getAttrFn('availabilityStartTime'),
    getSuggestedPresentationDelay = xmlFun.getAttrFn('suggestedPresentationDelay'),
    getTimeShiftBufferDepth = xmlFun.getAttrFn('timeShiftBufferDepth');

// Representation Attr fns
var getId = xmlFun.getAttrFn('id'),
    getBandwidth = xmlFun.getAttrFn('bandwidth');

// SegmentTemplate Attr fns
var getInitialization = xmlFun.getAttrFn('initialization'),
    getMedia = xmlFun.getAttrFn('media'),
    getDuration = xmlFun.getAttrFn('duration'),
    getTimescale = xmlFun.getAttrFn('timescale'),
    getPresentationTimeOffset = xmlFun.getAttrFn('presentationTimeOffset'),
    getStartNumber = xmlFun.getAttrFn('startNumber');

// TODO: Repeat code. Abstract away (Prototypal Inheritance/OO Model? Object composer fn?)
createMpdObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getPeriods: xmlFun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'Period', createPeriodObject),
        getMediaPresentationDuration: xmlFun.preApplyArgsFn(getMediaPresentationDuration, xmlNode),
        getType: xmlFun.preApplyArgsFn(getType, xmlNode),
        getMinimumUpdatePeriod: xmlFun.preApplyArgsFn(getMinimumUpdatePeriod, xmlNode),
        getAvailabilityStartTime: xmlFun.preApplyArgsFn(getAvailabilityStartTime, xmlNode),
        getSuggestedPresentationDelay: xmlFun.preApplyArgsFn(getSuggestedPresentationDelay, xmlNode),
        getTimeShiftBufferDepth: xmlFun.preApplyArgsFn(getTimeShiftBufferDepth, xmlNode)
    };
};

createPeriodObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getAdaptationSets: xmlFun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getAdaptationSetByType: function(type) {
            return getAdaptationSetByType(type, xmlNode);
        },
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject)
    };
};

createAdaptationSetObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getRepresentations: xmlFun.preApplyArgsFn(getDescendantObjectsArrayByName, xmlNode, 'Representation', createRepresentationObject),
        getSegmentTemplate: function() {
            return createSegmentTemplate(getSegmentTemplateXmlList(xmlNode));
        },
        getPeriod: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getMimeType: xmlFun.preApplyArgsFn(getMimeType, xmlNode)
    };
};

createRepresentationObject = function(xmlNode) {
    return {
        xml: xmlNode,
        // Descendants, Ancestors, & Siblings
        getSegmentTemplate: function() {
            return createSegmentTemplate(getSegmentTemplateXmlList(xmlNode));
        },
        getAdaptationSet: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'Period', createPeriodObject),
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlNode, 'MPD', createMpdObject),
        // Attrs
        getId: xmlFun.preApplyArgsFn(getId, xmlNode),
        getWidth: xmlFun.preApplyArgsFn(getWidth, xmlNode),
        getHeight: xmlFun.preApplyArgsFn(getHeight, xmlNode),
        getFrameRate: xmlFun.preApplyArgsFn(getFrameRate, xmlNode),
        getBandwidth: xmlFun.preApplyArgsFn(getBandwidth, xmlNode),
        getCodecs: xmlFun.preApplyArgsFn(getCodecs, xmlNode),
        getBaseUrl: xmlFun.preApplyArgsFn(buildBaseUrl, xmlNode),
        getMimeType: xmlFun.preApplyArgsFn(getMimeType, xmlNode)
    };
};

createSegmentTemplate = function(xmlArray) {
    // Effectively a find function + a map function.
    function getAttrFromXmlArray(attrGetterFn, xmlArray) {
        if (!isArray(xmlArray)) { return undefined; }
        if (!isFunction(attrGetterFn)) { return undefined; }

        var i,
            length = xmlArray.length,
            currentAttrValue;

        for (i=0; i<xmlArray.length; i++) {
            currentAttrValue = attrGetterFn(xmlArray[i]);
            if (isString(currentAttrValue) && currentAttrValue !== '') { return currentAttrValue; }
        }

        return undefined;
    }

    return {
        xml: xmlArray,
        // Descendants, Ancestors, & Siblings
        getAdaptationSet: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'AdaptationSet', createAdaptationSetObject),
        getPeriod: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'Period', createPeriodObject),
        getMpd: xmlFun.preApplyArgsFn(getAncestorObjectByName, xmlArray[0], 'MPD', createMpdObject),
        // Attrs
        getInitialization: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getInitialization, xmlArray),
        getMedia: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getMedia, xmlArray),
        getDuration: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getDuration, xmlArray),
        getTimescale: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getTimescale, xmlArray),
        getPresentationTimeOffset: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getPresentationTimeOffset, xmlArray),
        getStartNumber: xmlFun.preApplyArgsFn(getAttrFromXmlArray, getStartNumber, xmlArray)
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

// TODO: Move to xmlFun or own module.
getDescendantObjectsArrayByName = function(parentXml, tagName, mapFn) {
    var descendantsXmlArray = Array.prototype.slice.call(parentXml.getElementsByTagName(tagName));
    /*if (typeof mapFn === 'function') { return descendantsXmlArray.map(mapFn); }*/
    if (typeof mapFn === 'function') {
        var mappedElem = descendantsXmlArray.map(mapFn);
        return  mappedElem;
    }
    return descendantsXmlArray;
};

// TODO: Move to xmlFun or own module.
getAncestorObjectByName = function getAncestorObjectByName(xmlNode, tagName, mapFn) {
    if (!tagName || !xmlNode || !xmlNode.parentNode) { return null; }
    if (!xmlNode.parentNode.nodeName) { return null; }

    if (xmlNode.parentNode.nodeName === tagName) {
        return isFunction(mapFn) ? mapFn(xmlNode.parentNode) : xmlNode.parentNode;
    }
    return getAncestorObjectByName(xmlNode.parentNode, tagName, mapFn);
};

module.exports = getMpd;