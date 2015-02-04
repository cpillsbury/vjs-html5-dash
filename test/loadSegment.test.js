var loadSegment = require('../src/js/segments/loadSegment.js');

QUnit.module('loadSegment()');

QUnit.test('loadSegment exists', function(assert) {
    assert.ok(loadSegment, 'loadSegment does exist!');
});

QUnit.test('loadSegment() is a function', function(assert) {
    assert.strictEqual(typeof loadSegment, 'function', 'loadSegment() is a function!');
});

var xhr, requests;
var fakeSegment = {
    getUrl: function() {
        return 'http://dash.brightcove.com/assets/shiv/fire_template_5/video/1/seg-108.m4f';
    }
};

QUnit.module('loadSegment() XHR behavior', {
    beforeEach: function() {
        xhr = sinon.useFakeXMLHttpRequest();
        requests = [];
        xhr.onCreate = function(req) { requests.push(req); };
    },
    afterEach: function() {
        xhr.restore();
        requests = undefined;
    }
});

QUnit.test('loadSegment() makes expected XHR request.', function(assert) {
    loadSegment(fakeSegment);
    assert.strictEqual(requests.length, 1, 'request count match');
    assert.strictEqual(requests[0].url, fakeSegment.getUrl(), 'url match');
});

QUnit.test('loadSegment() calls successFn with expected args if request was successful.', function(assert) {
    var responseData = new ArrayBuffer(20),
        done = assert.async(),
        successFn = function(data) {
            assert.ok(true, 'successFn called!');
            assert.ok(data, 'data passed into successFn as arg');
            assert.strictEqual(data.status, 200, 'data.status is expected value');
            assert.strictEqual(data.response, responseData, 'data.response is expected value');
            assert.strictEqual(data.requestedSegment, fakeSegment, 'data.requestedSegment is expected value');
            done();
        },
        failFn = function(data) {
            assert.ok(false, 'failFn should not be called');
            done();
        };

    loadSegment(fakeSegment, successFn, failFn);

    // Hacky way of getting Sinon's Fake XHR response to behave as expected...
    xhr.prototype.response = responseData;
    requests[0].respond(
        200,
        { 'Content-Type': 'Range' }
    );
});

QUnit.test('loadSegment() calls failFn with expected args if response status was outside of 200 range.', function(assert) {
    var responseData = new ArrayBuffer(20),
        done = assert.async(),
        successFn = function(data) {
            assert.ok(false, 'failFn should not be called');
            done();
        },
        failFn = function(data) {
            assert.ok(true, 'failFn called!');
            assert.ok(data, 'data passed into successFn as arg');
            assert.strictEqual(data.status, 404, 'data.status is expected value');
            assert.strictEqual(data.response, responseData, 'data.response is expected value');
            assert.strictEqual(data.requestedSegment, fakeSegment, 'data.requestedSegment is expected value');
            done();
        };

    loadSegment(fakeSegment, successFn, failFn);

    // Hacky way of getting Sinon's Fake XHR response to behave as expected...
    xhr.prototype.response = responseData;
    requests[0].respond(
        404,
        { 'Content-Type': 'Range' }
    );
});
