var root = require('global/window');

QUnit.test('Video.js exists', function(assert) {
  assert.ok(root.videojs, 'Video.js exists!');
});