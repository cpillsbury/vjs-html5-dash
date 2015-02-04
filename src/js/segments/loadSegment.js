'use strict';

var isFunction = require('../util/isFunction.js');

/**
 * Generic function for loading MPEG-DASH segments (including initialization segments)
 * @param segment {object}       data view representing a segment (and relevant data for that segment)
 * @param successFn {function}  function called on successful response
 * @param failFn {function}     function called on failed response
 * @param thisArg {object}      object used as the this context for successFn and failFn
 */
function loadSegment(segment, successFn, failFn, thisArg) {
    var request = new XMLHttpRequest(),
        url = segment.getUrl();

    function onload() {
        // If the load status was outside of the 200s range, consider it a failed request.
        if (request.status < 200 || request.status > 299) {
            if (isFunction(failFn)) {
                failFn.call(thisArg,  {
                    requestedSegment: segment,
                    response: request.response,
                    status: request.status
                });
            }
        } else {
            if (isFunction(successFn)) {
                successFn.call(thisArg, {
                    requestedSegment: segment,
                    response: request.response,
                    status: request.status
                });
            }
        }
    }

    function onerror() {
        if (isFunction(failFn)) {
            failFn.call(thisArg,  {
                requestedSegment: segment,
                response: request.response,
                status: request.status
            });
        }
    }

    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = onload;
    request.onerror = onerror;
    request.send();

    return request;
}

module.exports = loadSegment;