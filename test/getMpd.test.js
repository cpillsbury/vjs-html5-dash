var getMpd = require('../src/js/dash/mpd/getMpd.js');

QUnit.module('getMpd()');

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

var xmlParser = new DOMParser();

var mpdExampleStaticSegmentTemplateXML = xmlParser.parseFromString(mpdExampleStaticSegmentTemplateString, 'text/xml');
var mpdExampleDynamicSegmentTemplateXML = xmlParser.parseFromString(mpdExampleDynamicSegmentTemplateString, 'text/xml');

QUnit.test('getMpd exists', function(assert) {
    assert.ok(getMpd, 'getMpd does exist!');
});

QUnit.test('getMpd is a function', function(assert) {
    assert.strictEqual(typeof getMpd, 'function', 'getMpd() is a function!');
});

QUnit.test('getMpd returns an mpd object when passed valid XML', function(assert) {
    var mpd = getMpd(mpdExampleStaticSegmentTemplateXML);
    assert.ok(mpd, 'getMpd() returned an mpd object!');
    assert.ok(mpd.xml, 'has xml property');
    assert.strictEqual(typeof mpd.getPeriods, 'function', 'has getPeriods() function');
    assert.strictEqual(typeof mpd.getMediaPresentationDuration, 'function', 'has getMediaPresentationDuration() function');
    assert.strictEqual(typeof mpd.getType, 'function', 'has getType() function');
    assert.strictEqual(typeof mpd.getMinimumUpdatePeriod, 'function', 'has getMinimumUpdatePeriod() function');
    assert.strictEqual(typeof mpd.getAvailabilityStartTime, 'function', 'has getAvailabilityStartTime() function');
    assert.strictEqual(typeof mpd.getSuggestedPresentationDelay, 'function', 'has getSuggestedPresentationDelay() function');
    assert.strictEqual(typeof mpd.getTimeShiftBufferDepth, 'function', 'has getTimeShiftBufferDepth() function');
});

QUnit.test('mpd.getPeriods() returns expected value', function(assert) {
    var periods = getMpd(mpdExampleStaticSegmentTemplateXML).getPeriods();
    assert.ok(Array.isArray(periods), 'getPeriods() returns an array');
    assert.strictEqual(periods.length, 1, 'getPeriods() array is of expected length');
});

QUnit.test('mpd.getType() returns expected value', function(assert) {
    var mpdType = getMpd(mpdExampleStaticSegmentTemplateXML).getType();
    assert.strictEqual(mpdType, 'static', 'getType() is expected value');
});

QUnit.test('mpd.getMediaPresentationDuration() returns expected value', function(assert) {
    var mediaPresentationDuration = getMpd(mpdExampleStaticSegmentTemplateXML).getMediaPresentationDuration();
    assert.strictEqual(mediaPresentationDuration, 'PT260.266S', 'getMediaPresentationDuration() is expected value');
});

QUnit.test('mpd.getMinimumUpdatePeriod() returns expected value', function(assert) {
    var minimumUpdatePeriod = getMpd(mpdExampleDynamicSegmentTemplateXML).getMinimumUpdatePeriod();
    assert.strictEqual(minimumUpdatePeriod, 'PT30S', 'getMinimumUpdatePeriod() is expected value');
});

QUnit.test('mpd.getAvailabilityStartTime() returns expected value', function(assert) {
    var availabilityStartTime = getMpd(mpdExampleDynamicSegmentTemplateXML).getAvailabilityStartTime();
    assert.strictEqual(availabilityStartTime, '2014-12-16T21:45:00', 'getAvailabilityStartTime() is expected value');
});

QUnit.test('mpd.getSuggestedPresentationDelay() returns expected value', function(assert) {
    var suggestedPresentationDelay = getMpd(mpdExampleDynamicSegmentTemplateXML).getSuggestedPresentationDelay();
    assert.strictEqual(suggestedPresentationDelay, 'PT20S', 'getSuggestedPresentationDelay() is expected value');
});

QUnit.test('mpd.getTimeShiftBufferDepth() returns expected value', function(assert) {
    var timeShiftBufferDepth = getMpd(mpdExampleDynamicSegmentTemplateXML).getTimeShiftBufferDepth();
    assert.strictEqual(timeShiftBufferDepth, 'PT600S', 'getTimeShiftBufferDepth() is expected value');
});