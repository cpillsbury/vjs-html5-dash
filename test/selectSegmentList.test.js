var selectSegmentList = require('../src/js/selectSegmentList.js'),
    getMpd = require('../src/js/dash/mpd/getMpd.js'),
    MediaSet = require('../src/js/MediaSet.js');

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

var xmlParser = new DOMParser();

var mpdExampleStaticSegmentTemplateXML = xmlParser.parseFromString(mpdExampleStaticSegmentTemplateString, 'text/xml');

var videoAdaptationSet = getMpd(mpdExampleStaticSegmentTemplateXML).getPeriods()[0].getAdaptationSetByType('video');
var audioAdaptationSet = getMpd(mpdExampleStaticSegmentTemplateXML).getPeriods()[0].getAdaptationSetByType('audio');

var videoMediaSet = new MediaSet(videoAdaptationSet);
var audioMediaSet = new MediaSet(audioAdaptationSet);

QUnit.test('selectSegmentList exists', function(assert) {
    assert.ok(selectSegmentList, 'selectSegmentList does exist!');
});

QUnit.test('selectSegmentList is a function', function(assert) {
    assert.strictEqual(typeof selectSegmentList, 'function', 'selectSegmentList() is a function!');
});

QUnit.test('selectSegmentList() insufficient bandwidth', function(assert) {
    var selectedSegmentList,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 0.5;
    data.width = 1280;
    data.height = 720;

    data.currentSegmentListBandwidth = 1000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 349952, 'selected segment list has expected bandwidth');

    data.currentSegmentListBandwidth = 2000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 1000000, 'selected segment list has expected bandwidth');
});

QUnit.test('selectSegmentList() insufficient bandwidth lowest bandwidth selected', function(assert) {
    var selectedSegmentList,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 0.5;
    data.currentSegmentListBandwidth = 349952;
    data.width = 1280;
    data.height = 720;

    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 349952, 'selected segment list has expected bandwidth');
});

QUnit.test('selectSegmentList() insufficient bandwidth single segment list', function(assert) {
    var selectedSegmentList,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 0.5;
    data.currentSegmentListBandwidth = 56000;

    selectedSegmentList = selectSegmentList(audioMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 56000, 'selected segment list has expected bandwidth');
});

QUnit.test('selectSegmentList() excess bandwidth', function(assert) {
    var selectedSegmentList,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 2.0;
    data.width = 1280;
    data.height = 720;

    data.currentSegmentListBandwidth = 1000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 2000000, 'selected segment list has expected bandwidth');

    data.currentSegmentListBandwidth = 2000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 3000000, 'selected segment list has expected bandwidth');
});

QUnit.test('selectSegmentList() excess bandwidth highest bandwidth selected', function(assert) {
    var selectedSegmentList,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 2.0;
    data.width = 1280;
    data.height = 720;

    data.currentSegmentListBandwidth = 3000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 3000000, 'selected segment list has expected bandwidth');
});

QUnit.test('selectSegmentList() excess bandwidth single segment list', function(assert) {
    var selectedSegmentList,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 2.0;
    data.currentSegmentListBandwidth = 56000;

    selectedSegmentList = selectSegmentList(audioMediaSet, data);
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedBandwidth, 56000, 'selected segment list has expected bandwidth');
});

QUnit.test('selectSegmentList() insufficient width', function(assert) {
    var selectedSegmentList,
        selectedWidth,
        data = {};
    data.downloadRateRatio = 10.0;

    data.width = 768;
    data.height = 432;
    data.currentSegmentListBandwidth = 1000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    assert.strictEqual(selectedWidth, 704, 'selected segment list has expected width');

    data.width = 480;
    data.height = 270;
    data.currentSegmentListBandwidth = 3000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    assert.strictEqual(selectedWidth, 480, 'selected segment list has expected width');
});

QUnit.test('selectSegmentList() insufficient width lowest width selected', function(assert) {
    var selectedSegmentList,
        selectedWidth,
        data = {};
    data.downloadRateRatio = 10.0;

    data.width = 256;
    data.height = 144;
    data.currentSegmentListBandwidth = 349952;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    assert.strictEqual(selectedWidth, 320, 'selected segment list has expected width');
});

QUnit.test('selectSegmentList() excess width', function(assert) {
    var selectedSegmentList,
        selectedWidth,
        data = {};
    data.downloadRateRatio = 10.0;

    data.width = 1920;
    data.height = 1080;
    data.currentSegmentListBandwidth = 1000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    assert.strictEqual(selectedWidth, 1280, 'selected segment list has expected width');

    data.width = 768;
    data.height = 432;
    data.currentSegmentListBandwidth = 349952;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    assert.strictEqual(selectedWidth, 704, 'selected segment list has expected width');
});

QUnit.test('selectSegmentList() excess width highest width selected', function(assert) {
    var selectedSegmentList,
        selectedWidth,
        data = {};
    data.downloadRateRatio = 10.0;

    data.width = 1920;
    data.height = 1080;
    data.currentSegmentListBandwidth = 3000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    assert.strictEqual(selectedWidth, 1280, 'selected segment list has expected width');
});

QUnit.test('selectSegmentList() insufficient width and insufficient bandwidth for lowest segment list', function(assert) {
    var selectedSegmentList,
        selectedWidth,
        selectedBandwidth,
        data = {};
    data.downloadRateRatio = 0.1;
    data.width = 256;
    data.height = 144;
    data.currentSegmentListBandwidth = 3000000;
    selectedSegmentList = selectSegmentList(videoMediaSet, data);
    selectedWidth =selectedSegmentList.getWidth();
    selectedBandwidth =selectedSegmentList.getBandwidth();
    assert.strictEqual(selectedWidth, 320, 'selected segment list has expected width');
    assert.strictEqual(selectedBandwidth, 349952, 'selected segment list has expected bandwidth');
});