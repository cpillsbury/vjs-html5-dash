
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