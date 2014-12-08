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