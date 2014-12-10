'use strict';

var loadManifest = require('./loadManifest.js'),
    extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    manifest;

function Manifest(sourceUri, autoLoad) {
    var self = this;

    this.__autoLoad = !!autoLoad;
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
        this.clearSourceUri();
        return;
    }

    this.__sourceUri = sourceUri;
    if (this.__autoLoad) {
        // TODO: Impl any cleanup functionality appropriate before load.
        this.load();
    }
};

Manifest.prototype.clearSourceUri = function clearSourceUri() {
    this.__sourceUri = null;
    // TODO: impl any other cleanup functionality
};

Manifest.prototype.load = function load(/* optional */ callbackFn) {
    var self = this;
    loadManifest(self.__sourceUri, function(data) {
        self.__manifest = data.manifestXml;
        self.trigger({ type:self.eventList.MANIFEST_LOADED, target:self, data:self.__manifest});
    });
};

Manifest.prototype.getMediaSetByType = function getMediaSetByType(mediaType) {

};

function MediaSet(adaptationSet) {

}

MediaSet.prototype.getType = function getType() {

};

MediaSet.prototype.getSourceBufferType = function getSourceBufferType() {

};

MediaSet.prototype.getFragmentLists = function getFragmentLists() {

};

MediaSet.prototype.getFragmentListByBandwidth = function getFragmentListByBandwidth(bandwidth) {

};

extendObject(Manifest.prototype, EventDispatcherMixin);

module.exports = Manifest;