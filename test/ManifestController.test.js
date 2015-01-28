var ManifestController = require('../src/js/manifest/ManifestController.js');

QUnit.module('ManifestController');

QUnit.test('ManifestController exists', function(assert) {
    assert.ok(ManifestController, 'ManifestController does exist!');
});

QUnit.test('ManifestController is a (constructor) function', function(assert) {
    assert.strictEqual(typeof ManifestController, 'function', 'ManifestController is a (constructor) function!');
});

QUnit.test('new ManifestController() instantiates a ManifestController instance.', function(assert) {
    var manifestController = new ManifestController();
    assert.ok(manifestController instanceof ManifestController, 'new ManifestController() creates an instance of ManifestController!');
});

QUnit.test('new ManifestController() takes constructor params and updates expected properties.', function(assert) {
    var sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        autoLoad = false,
        manifestController = new ManifestController(sourceUri, autoLoad);
    assert.strictEqual(manifestController.getSourceUri(), sourceUri, 'getSourceUri() returns expected value!');
});

var xhr, requests;

QUnit.module('ManifestController XHR Behavior', {
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

QUnit.test('ManifestController automatically requests Manifest if autoLoad constructor param is true', function(assert) {
    var sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        autoLoad = true,
        manifestController = new ManifestController(sourceUri, autoLoad);
    assert.strictEqual(requests.length, 1, 'request count match');
    assert.strictEqual(requests[0].url, sourceUri, 'url match');
});
