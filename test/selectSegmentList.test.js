var selectSegmentList = require('../src/js/selectSegmentList.js');

var data1 = {
    downloadRateRatio: 2.0,
    currentSegmentListBandwidth: '',
    width: '',
    height: ''
};

var data2 = {
    downloadRateRatio: 0.5,
    currentSegmentListBandwidth: '',
    width: '',
    height: ''
};

QUnit.test('selectSegmentList exists', function(assert) {
    assert.ok(selectSegmentList, 'selectSegmentList does exist!');
});

QUnit.test('selectSegmentList is a function', function(assert) {
    assert.strictEqual(typeof selectSegmentList, 'function', 'selectSegmentList() is a function!');
});