
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