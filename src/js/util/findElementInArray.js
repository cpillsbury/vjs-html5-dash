'use strict';

var isArray = require('./isArray.js'),
    isFunction = require('./isFunction.js'),
    findElementInArray;

findElementInArray = function(array, predicateFn) {
    if (!isArray(array) || !isFunction(predicateFn)) { return undefined; }
    var i,
        length = array.length,
        elem;

    for (i=0; i<length; i++) {
        elem = array[i];
        if (predicateFn(elem, i, array)) { return elem; }
    }

    return undefined;
};

module.exports = findElementInArray;