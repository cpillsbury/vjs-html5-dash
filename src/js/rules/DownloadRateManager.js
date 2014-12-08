'use strict';

var extendObject = require('../util/extendObject.js'),
    EventDispatcherMixin = require('../events/EventDispatcherMixin.js'),
    downloadRates = require('./downloadRate/DownloadRates.js'),
    eventList = require('./downloadRate/DownloadRateEventTypes.js');

// TODO: Move (make mini-lib for native type-checking? See: xmlfun.js)
function isArray( obj ) {
    return Object.toString.call(obj) === '[object Array]';
}

function addEventHandlerToRule(self, rule) {
    rule.on(self.eventList.DOWNLOAD_RATE_CHANGED, function(event) {
        self.determineDownloadRate();
    });
}

function DownloadRateManager(downloadRateRules) {
    this.__downloadRateRules = isArray(downloadRateRules) || [];
    this.__downloadRateRules.forEach(function(rule) {
        addEventHandlerToRule(this, rule);
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