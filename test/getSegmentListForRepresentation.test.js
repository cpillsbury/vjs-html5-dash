var getMpd = require('../src/js/dash/mpd/getMpd.js'),
    getSegmentListForRepresentation = require('../src/js/dash/segments/getSegmentListForRepresentation.js');

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

var mpdExampleStaticSegmentTemplateNonCompliantAudioCodecString = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1H44M48S" minBufferTime="PT10.10S" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static">' +
    '<!--  Created with Bento4 mp4-dash.py, VERSION=1.4.0-541   -->' +
    '<Period>' +
        '<AdaptationSet lang="eng" mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1">' +
            '<Representation audioSamplingRate="44100" bandwidth="154734" codecs="mp4a.40.02" id="audio.und">' +
                '<AudioChannelConfiguration schemeIdUri="urn:mpeg:DASH:23003.3:audio_channel_configuration:2011" value="2"/>' +
                '<SegmentTemplate duration="10007" initialization="audio/und/init.mp4" media="audio/und/seg-$Number$.m4f" startNumber="0" timescale="1000"/>' +
            '</Representation>' +
        '</AdaptationSet>' +
        '<AdaptationSet mimeType="video/mp4" scanType="progressive" segmentAlignment="true" startWithSAP="1">' +
            '<Representation bandwidth="3684105" codecs="avc1.4d401e" frameRate="25025" height="320" id="video.1" width="720">' +
                '<SegmentTemplate duration="10097" initialization="video/1/init.mp4" media="video/1/seg-$Number$.m4f" startNumber="0" timescale="1000"/>' +
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

var xmlParser = new DOMParser();

var mpdExampleStaticSegmentTemplateXML = xmlParser.parseFromString(mpdExampleStaticSegmentTemplateString, 'text/xml');
var mpdExampleStaticSegmentTemplateNonCompliantAudioCodecXML = xmlParser.parseFromString(mpdExampleStaticSegmentTemplateNonCompliantAudioCodecString, 'text/xml');
var mpdExampleDynamicSegmentTemplateXML = xmlParser.parseFromString(mpdExampleDynamicSegmentTemplateString, 'text/xml');

var exampleStaticRepresentation = getMpd(mpdExampleStaticSegmentTemplateXML).getPeriods()[0].getAdaptationSetByType('video').getRepresentations()[0];
var exampleDynamicRepresentation = getMpd(mpdExampleDynamicSegmentTemplateXML).getPeriods()[0].getAdaptationSetByType('video').getRepresentations()[0];
var exampleStaticRepresentationNonCompliantAudioCodec = getMpd(mpdExampleStaticSegmentTemplateNonCompliantAudioCodecXML).getPeriods()[0].getAdaptationSetByType('audio').getRepresentations()[0];


    QUnit.test('getSegmentListForRepresentation exists', function(assert) {
    assert.ok(getSegmentListForRepresentation, 'getSegmentListForRepresentation does exist!');
});

QUnit.test('getSegmentListForRepresentation() is a function', function(assert) {
    assert.strictEqual(typeof getSegmentListForRepresentation, 'function', 'segmentTemplate is a function!');
});

QUnit.test('getSegmentListForRepresentation() returns object with expected methods', function(assert) {
    var segmentList = getSegmentListForRepresentation(exampleStaticRepresentation);
    assert.strictEqual(typeof segmentList.getType, 'function', 'getType() is a function!');
    assert.strictEqual(typeof segmentList.getIsLive, 'function', 'getIsLive() is a function!');
    assert.strictEqual(typeof segmentList.getBandwidth, 'function', 'getBandwidth() is a function!');
    assert.strictEqual(typeof segmentList.getHeight, 'function', 'getHeight() is a function!');
    assert.strictEqual(typeof segmentList.getWidth, 'function', 'getWidth() is a function!');
    assert.strictEqual(typeof segmentList.getTotalDuration, 'function', 'getTotalDuration() is a function!');
    assert.strictEqual(typeof segmentList.getSegmentDuration, 'function', 'getSegmentDuration() is a function!');
    assert.strictEqual(typeof segmentList.getUTCWallClockStartTime, 'function', 'getUTCWallClockStartTime() is a function!');
    assert.strictEqual(typeof segmentList.getTimeShiftBufferDepth, 'function', 'getTimeShiftBufferDepth() is a function!');
    assert.strictEqual(typeof segmentList.getTotalSegmentCount, 'function', 'getTotalSegmentCount() is a function!');
    assert.strictEqual(typeof segmentList.getStartNumber, 'function', 'getStartNumber() is a function!');
    assert.strictEqual(typeof segmentList.getEndNumber, 'function', 'getEndNumber() is a function!');
    assert.strictEqual(typeof segmentList.getInitialization, 'function', 'getInitialization() is a function!');
    assert.strictEqual(typeof segmentList.getSegmentByNumber, 'function', 'getSegmentByNumber() is a function!');
    assert.strictEqual(typeof segmentList.getSegmentByTime, 'function', 'getSegmentByTime() is a function!');
    assert.strictEqual(typeof segmentList.getSegmentByUTCWallClockTime, 'function', 'getSegmentByUTCWallClockTime() is a function!');
});

QUnit.test('getType() returns expected value', function(assert) {
    var type = getSegmentListForRepresentation(exampleStaticRepresentation).getType();
    assert.strictEqual(type, 'video/mp4;codecs="avc1.4D4020"', 'getType() returns expected value!');
});

QUnit.test('getType() handles non-compliant preceeding 0\'s in codec', function(assert) {
    var type = getSegmentListForRepresentation(exampleStaticRepresentationNonCompliantAudioCodec).getType();
    assert.strictEqual(type, 'audio/mp4;codecs="mp4a.40.2"', 'getType() handles non-compliant preceeding 0\'s in codec!');
});

// TODO: Figure out browser inconsistencies with mpd
QUnit.test('getIsLive() returns expected value', function(assert) {
    // NOTE: GETTING INCONSITENCIES ACROSS BROWSERS (working in Chrome/Chrome-Canary but not in Safari/FF)
    var isLiveFalse = getSegmentListForRepresentation(exampleStaticRepresentation).getIsLive();
    assert.ok(!isLiveFalse, 'getIsLive() returns expected value!');

    var isLiveTrue = getSegmentListForRepresentation(exampleDynamicRepresentation).getIsLive();
    assert.ok(isLiveTrue, 'getIsLive() returns expected value!');
});

QUnit.test('getBandwidth() returns expected value', function(assert) {
    var bandwidth = getSegmentListForRepresentation(exampleStaticRepresentation).getBandwidth();
    assert.strictEqual(typeof bandwidth, 'number', 'getBandwidth() returns expected type');
    assert.strictEqual(bandwidth, 3000000, 'getBandwidth() returns expected value');
});

QUnit.test('getHeight() returns expected value', function(assert) {
    var height = getSegmentListForRepresentation(exampleStaticRepresentation).getHeight();
    assert.strictEqual(typeof height, 'number', 'getHeight() returns expected type');
    assert.strictEqual(height, 720, 'getHeight() returns expected value');
});

QUnit.test('getWidth() returns expected value', function(assert) {
    var width = getSegmentListForRepresentation(exampleStaticRepresentation).getWidth();
    assert.strictEqual(typeof width, 'number', 'getWidth() returns expected type');
    assert.strictEqual(width, 1280, 'getWidth() returns expected value');
});

QUnit.test('getTotalDuration() returns expected value', function(assert) {
    /*var parser = new DOMParser();
    var xml = parser.parseFromString(mpdExampleStaticSegmentTemplateString, 'text/xml');
    var representation = getMpd(xml).getPeriods()[0].getAdaptationSetByType('video').getRepresentations()[0];
    var value = getSegmentListForRepresentation(representation).getTotalDuration();*/
    var value = getSegmentListForRepresentation(exampleStaticRepresentation).getTotalDuration();
    assert.strictEqual(typeof value, 'number', 'getTotalDuration() returns expected type');
    assert.strictEqual(value, 260.266, 'getTotalDuration() returns expected value');
});

