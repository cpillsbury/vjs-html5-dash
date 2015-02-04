var getSegmentTemplate = require('../src/js/dash/segments/getSegmentTemplate.js'),
    segmentTemplate = getSegmentTemplate();

QUnit.module('segmentTemplate');

var templateStrNumber = 'ED_512_640K_MPEG2_video_$Number$.mp4';
var templateStrNumberBandwidth = 'video-$Number$_$Bandwidth$bps.mp4';
var templateStrRepresentationIdNumber = '$RepresentationID$/$Number$.m4s';

QUnit.test('getSegmentTemplate exists', function(assert) {
    assert.ok(getSegmentTemplate, 'getSegmentTemplate does exist!');
});

QUnit.test('getSegmentTemplate() is an object', function(assert) {
    assert.strictEqual(typeof getSegmentTemplate, 'function', 'getSegmentTemplate is a function!');
});

QUnit.test('segmentTemplate exists', function(assert) {
    assert.ok(segmentTemplate, 'segmentTemplate does exist!');
});

QUnit.test('segmentTemplate is an object', function(assert) {
    assert.strictEqual(typeof segmentTemplate, 'object', 'segmentTemplate is an object!');
});

QUnit.test('segmentTemplate has expected methods', function(assert) {
    assert.strictEqual(typeof segmentTemplate.zeroPadToLength, 'function', 'zeroPadToLength() is a function!');
    assert.strictEqual(typeof segmentTemplate.replaceTokenForTemplate, 'function', 'replaceTokenForTemplate() is a function!');
    assert.strictEqual(typeof segmentTemplate.unescapeDollarsInTemplate, 'function', 'unescapeDollarsInTemplate() is a function!');
    assert.strictEqual(typeof segmentTemplate.replaceIDForTemplate, 'function', 'replaceIDForTemplate() is a function!');
});

QUnit.test('replaceIDForTemplate() formats as expected', function(assert) {
    var formattedId = segmentTemplate.replaceIDForTemplate(templateStrRepresentationIdNumber, '1');
    assert.strictEqual(formattedId, '1/$Number$.m4s', 'replaceIDForTemplate() formatted correctly');
});

QUnit.test('replaceIDForTemplate() formats with numeric id values', function(assert) {
    var formattedId = segmentTemplate.replaceIDForTemplate(templateStrRepresentationIdNumber, 5);
    assert.strictEqual(formattedId, '5/$Number$.m4s', 'replaceIDForTemplate() formats with numeric id values');
});

QUnit.test('replaceTokenForTemplate() formats $Number$ token', function(assert) {
    var formattedNumber = segmentTemplate.replaceTokenForTemplate(templateStrRepresentationIdNumber, 'Number', '53');
    assert.strictEqual(formattedNumber, '$RepresentationID$/53.m4s', 'replaceTokenForTemplate() formats $Number$ token');

    formattedNumber = segmentTemplate.replaceTokenForTemplate(templateStrNumberBandwidth, 'Number', '75');
    assert.strictEqual(formattedNumber, 'video-75_$Bandwidth$bps.mp4', 'replaceTokenForTemplate() formats $Number$ token');

    formattedNumber = segmentTemplate.replaceTokenForTemplate(templateStrNumber, 'Number', '123456789');
    assert.strictEqual(formattedNumber, 'ED_512_640K_MPEG2_video_123456789.mp4', 'replaceTokenForTemplate() formats $Number$ token');
});

QUnit.test('replaceTokenForTemplate() formats with numeric id values', function(assert) {
    var formattedNumber = segmentTemplate.replaceTokenForTemplate(templateStrRepresentationIdNumber, 'Number', 275);
    assert.strictEqual(formattedNumber, '$RepresentationID$/275.m4s', 'replaceTokenForTemplate() formats $Number$ token using numeric values');
});