var loadManifest = require('../src/js/manifest/loadManifest.js');

QUnit.module('loadManifest()');

QUnit.test('loadManifest exists', function(assert) {
    assert.ok(loadManifest, 'loadManifest does exist!');
});

QUnit.test('loadManifest() is a function', function(assert) {
    assert.strictEqual(typeof loadManifest, 'function', 'loadManifest() is a function!');
});

var xhr, requests;

QUnit.module('loadManifest() XHR behavior', {
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

QUnit.test('loadManifest() makes expected XHR request.', function(assert) {
    var sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd';
    loadManifest(sourceUri);
    assert.strictEqual(requests.length, 1, 'request count match');
    assert.strictEqual(requests[0].url, sourceUri, 'url match');
});

QUnit.test('loadManifest() calls callback param with expected args if request was successful.', function(assert) {
    var xmlStr = '<XML>SomeXml</XML>',
        done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        callback = function(data) {
            var dataXml = (new XMLSerializer()).serializeToString(data.manifestXml);
            assert.ok(true, 'callback called!');
            assert.ok(data, 'data passed into callback as arg');
            assert.strictEqual(dataXml, xmlStr, 'data.manifestXml is expected value');
            done();
        };

    loadManifest(sourceUri, callback);

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        xmlStr
    );
});
