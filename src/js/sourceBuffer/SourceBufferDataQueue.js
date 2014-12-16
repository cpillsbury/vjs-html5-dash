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