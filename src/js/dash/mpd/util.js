'use strict';

var parseRootUrl,
    // TODO: Should presentationDuration parsing be in util or somewhere else?
    parseMediaPresentationDuration,
    parseDateTime,
    SECONDS_IN_YEAR = 365 * 24 * 60 * 60,
    SECONDS_IN_MONTH = 30 * 24 * 60 * 60, // not precise!
    SECONDS_IN_DAY = 24 * 60 * 60,
    SECONDS_IN_HOUR = 60 * 60,
    SECONDS_IN_MIN = 60,
    MINUTES_IN_HOUR = 60,
    MILLISECONDS_IN_SECONDS = 1000,
    durationRegex = /^P(([\d.]*)Y)?(([\d.]*)M)?(([\d.]*)D)?T?(([\d.]*)H)?(([\d.]*)M)?(([\d.]*)S)?/,
    dateTimeRegex = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]*)(\.[0-9]*)?)?(?:([+-])([0-9]{2})([0-9]{2}))?/;

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
    if (!str) { return Number.NaN; }
    var match = durationRegex.exec(str);
    if (!match) { return Number.NaN; }
    return (parseFloat(match[2] || 0) * SECONDS_IN_YEAR +
        parseFloat(match[4] || 0) * SECONDS_IN_MONTH +
        parseFloat(match[6] || 0) * SECONDS_IN_DAY +
        parseFloat(match[8] || 0) * SECONDS_IN_HOUR +
        parseFloat(match[10] || 0) * SECONDS_IN_MIN +
        parseFloat(match[12] || 0));
};

/**
 * Parser for formatted datetime strings conforming to the ISO 8601 standard.
 * General Format:  YYYY-MM-DDTHH:MM:SSZ (UTC) or YYYY-MM-DDTHH:MM:SS+HH:MM (time zone localization)
 * Ex String:       2014-12-17T14:09:58Z (UTC) or 2014-12-17T14:15:58+06:00 (time zone localization) / 2014-12-17T14:03:58-06:00 (time zone localization)
 *
 * @param str {string}  ISO 8601-compliant datetime string.
 * @returns {number} UTC Unix time.
 */
parseDateTime = function(str) {
    var match = dateTimeRegex.exec(str),
        utcDate;

    // If the string does not contain a timezone offset different browsers can interpret it either
    // as UTC or as a local time so we have to parse the string manually to normalize the given date value for
    // all browsers
    utcDate = Date.UTC(
        parseInt(match[1], 10),
        parseInt(match[2], 10)-1, // months start from zero
        parseInt(match[3], 10),
        parseInt(match[4], 10),
        parseInt(match[5], 10),
        (match[6] && parseInt(match[6], 10) || 0),
        (match[7] && parseFloat(match[7]) * MILLISECONDS_IN_SECONDS) || 0);
    // If the date has timezone offset take it into account as well
    if (match[9] && match[10]) {
        var timezoneOffset = parseInt(match[9], 10) * MINUTES_IN_HOUR + parseInt(match[10], 10);
        utcDate += (match[8] === '+' ? -1 : +1) * timezoneOffset * SECONDS_IN_MIN * MILLISECONDS_IN_SECONDS;
    }

    return utcDate;
};

var util = {
    parseRootUrl: parseRootUrl,
    parseMediaPresentationDuration: parseMediaPresentationDuration,
    parseDateTime: parseDateTime
};

module.exports = util;