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

var mpdExampleStaticSegmentTemplateString = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:mpeg:DASH:schema:MPD:2011" xsi:schemaLocation="urn:mpeg:DASH:schema:MPD:2011 DASH-MPD.xsd" type="static" mediaPresentationDuration="PT260.266S" availabilityStartTime="2012-09-05T09:00:00Z" maxSegmentDuration="PT4.080S" minBufferTime="PT5.001S" profiles="urn:mpeg:dash:profile:isoff-live:2011">' +
    '<Period>' +
    '<AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" maxWidth="1280" maxHeight="720" maxFrameRate="25" par="16:9">' +
    '<SegmentTemplate presentationTimeOffset="0" timescale="90000" initialization="$RepresentationID$/Header.m4s" media="$RepresentationID$/$Number$.m4s" duration="360000" startNumber="0"/>' +
    '<Representation id="video1" width="1280" height="720" frameRate="25" sar="1:1" scanType="progressive" bandwidth="3000000" codecs="avc1.4D4020"/>' +
    '<Representation id="video2" width="1024" height="576" frameRate="25" sar="1:1" scanType="progressive" bandwidth="2000000" codecs="avc1.4D401F"/>' +
    '<Representation id="video3" width="704" height="396" frameRate="25" sar="1:1" scanType="progressive" bandwidth="1000000" codecs="avc1.4D401E"/>' +
    '<Representation id="video4" width="480" height="270" frameRate="25" sar="1:1" scanType="progressive" bandwidth="600000" codecs="avc1.4D4015"/>' +
    '<Representation id="video5" width="320" height="180" frameRate="25" sar="1:1" scanType="progressive" bandwidth="349952" codecs="avc1.4D400D"/>' +
    '</AdaptationSet>' +
    '<AdaptationSet mimeType="audio/mp4" lang="en" segmentAlignment="true" startWithSAP="1">' +
    '<SegmentTemplate presentationTimeOffset="0" timescale="48000" initialization="$RepresentationID$/Header.m4s" media="$RepresentationID$/$Number$.m4s" duration="192000" startNumber="0"/>' +
    '<Representation id="audio" audioSamplingRate="48000" bandwidth="56000" codecs="mp4a.40.2">' +
    '<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>' +
    '</Representation>' +
    '</AdaptationSet>' +
    '</Period>' +
    '</MPD>';

// NOTE: the @timeShiftBufferDepth attribute on the MPD node is not from the original MPD XML example, but is from another
// actual example MPD and is a valid value. However, this means the value should not be used in any functional/automated/
// end-to-end testing.
var mpdExampleDynamicSegmentTemplateString = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:mpeg:dash:schema:mpd:2011" xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 http://standards.iso.org/ittf/PubliclyAvailableStandards/MPEG-DASH_schema_files/DASH-MPD.xsd" type="dynamic" minimumUpdatePeriod="PT30S" availabilityStartTime="2014-12-16T21:45:00" minBufferTime="PT12S" timeShiftBufferDepth="PT600S" suggestedPresentationDelay="PT20S" profiles="urn:mpeg:dash:profile:isoff-live:2011">' +
    '<Period start="PT0S" id="1">' +
    '<AdaptationSet mimeType="video/mp4" frameRate="30/1" segmentAlignment="true" subsegmentAlignment="true" startWithSAP="1" subsegmentStartsWithSAP="1" bitstreamSwitching="true">' +
    '<SegmentTemplate timescale="90000" duration="540000" startNumber="1418725768"/>' +
    '<Representation id="1" width="960" height="540" bandwidth="1200000" codecs="avc1.1F024D">' +
    '<SegmentTemplate duration="540000" startNumber="1418725768" media="dash_video1200-20141124T190043-$Number$.mp4" initialization="dash_video1200-20141124T190043-.init"/>' +
    '</Representation>' +
    '<Representation id="2" width="640" height="360" bandwidth="400000" codecs="avc1.1E004D">' +
    '<SegmentTemplate duration="540000" startNumber="1418725768" media="dash_video800-20141124T190043-$Number$.mp4" initialization="dash_video800-20141124T190043-.init"/>' +
    '</Representation>' +
    '<Representation id="3" width="480" height="270" bandwidth="200000" codecs="avc1.1E0042">' +
    '<SegmentTemplate duration="540000" startNumber="1418725768" media="dash_video300-20141124T190043-$Number$.mp4" initialization="dash_video300-20141124T190043-.init"/>' +
    '</Representation>' +
    '</AdaptationSet>' +
    '<AdaptationSet mimeType="audio/mp4" segmentAlignment="0">' +
    '<SegmentTemplate timescale="48000" media="dash_audio64-20141124T190043-$Number$.mp4" initialization="dash_audio64-20141124T190043-.init" duration="288000" startNumber="1418725768"/>' +
    '<Representation id="4" bandwidth="64000" audioSamplingRate="48000" codecs="mp4a.40.2"/>' +
    '</AdaptationSet>' +
    '<AdaptationSet mimeType="audio/mp4" segmentAlignment="0">' +
    '<SegmentTemplate timescale="48000" media="dash_audio128-20141124T190043-$Number$.mp4" initialization="dash_audio128-20141124T190043-.init" duration="288000" startNumber="1418725768"/>' +
    '<Representation id="5" bandwidth="128000" audioSamplingRate="48000" codecs="mp4a.40.2"/>' +
    '</AdaptationSet>' +
    '</Period>' +
    '</MPD>';

QUnit.module('ManifestController XHR & MPD manifest loading Behavior', {
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

QUnit.test('ManifestController automatically requests MPD if autoLoad constructor param is true', function(assert) {
    var sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        autoLoad = true,
        manifestController = new ManifestController(sourceUri, autoLoad);
    assert.strictEqual(requests.length, 1, 'request count match');
    assert.strictEqual(requests[0].url, sourceUri, 'url match');
});

QUnit.test('ManifestController requests MPD if load() method is called', function(assert) {
    var sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);
    manifestController.load();
    assert.strictEqual(requests.length, 1, 'request count match');
    assert.strictEqual(requests[0].url, sourceUri, 'url match');
});

QUnit.test('successful MPD load dispatches expected event', function(assert) {
    var done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        assert.ok(true, 'expected event fired!');
        done();
    });

    manifestController.load();

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        mpdExampleStaticSegmentTemplateString
    );
});

QUnit.test('successful MPD load dispatches expected event', function(assert) {
    var done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        // NOTE: Need to strip CR/LF since this behavior is inconsistent across browsers (CJP).
        var dataXmlStr = (new XMLSerializer()).serializeToString(event.data).replace(/\r?\n|\r/g, '');
        assert.ok(true, 'expected event fired!');
        assert.strictEqual(dataXmlStr, mpdExampleStaticSegmentTemplateString, 'data is expected value');
        done();
    });

    manifestController.load();

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        mpdExampleStaticSegmentTemplateString
    );
});

QUnit.test('successful MPD load dispatches expected event', function(assert) {
    var done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        // NOTE: Need to strip CR/LF since this behavior is inconsistent across browsers (CJP).
        var dataXmlStr = (new XMLSerializer()).serializeToString(event.data).replace(/\r?\n|\r/g, '');
        assert.ok(true, 'expected event fired!');
        assert.strictEqual(dataXmlStr, mpdExampleStaticSegmentTemplateString, 'data is expected value');
        done();
    });

    manifestController.load();

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        mpdExampleStaticSegmentTemplateString
    );
});

QUnit.test('successful static type MPD load updates properties based on XML', function(assert) {
    var done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        var mediaSets = manifestController.getMediaSets(),
            videoMediaSet = manifestController.getMediaSetByType('video'),
            audioMediaSet = manifestController.getMediaSetByType('audio');
        assert.strictEqual(mediaSets.length, 2, '');
        assert.strictEqual(videoMediaSet.getMediaType(), 'video', '');
        assert.strictEqual(audioMediaSet.getMediaType(), 'audio', '');
        assert.strictEqual(videoMediaSet.getMimeType(), 'video/mp4', '');
        assert.strictEqual(audioMediaSet.getMimeType(), 'audio/mp4', '');
        done();
    });

    manifestController.load();

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        mpdExampleStaticSegmentTemplateString
    );
});

QUnit.test('successful MPD load updates media sets based on XML (static/VOD manifest)', function(assert) {
    var done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        assert.strictEqual(manifestController.getShouldUpdate(), false, '');
        assert.strictEqual(manifestController.getUpdateRate(), 0, '');
        assert.strictEqual(manifestController.getPlaylistType(), 'static', '');
        done();
    });

    manifestController.load();

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        mpdExampleStaticSegmentTemplateString
    );
});

QUnit.test('successful MPD load updates media sets based on XML (dynamic/live manifest)', function(assert) {
    var done = assert.async(),
        sourceUri = 'http://dash.edgesuite.net/envivio/dashpr/clear/Manifest.mpd',
        manifestController = new ManifestController(sourceUri);

    manifestController.one(manifestController.eventList.MANIFEST_LOADED, function(event) {
        assert.strictEqual(manifestController.getShouldUpdate(), true, '');
        assert.strictEqual(manifestController.getUpdateRate(), 30, '');
        assert.strictEqual(manifestController.getPlaylistType(), 'dynamic', '');
        done();
    });

    manifestController.load();

    requests[0].respond(
        200,
        { 'Content-Type': 'application/xml' },
        mpdExampleDynamicSegmentTemplateString
    );
});
