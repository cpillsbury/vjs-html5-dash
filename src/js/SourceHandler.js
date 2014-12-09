'use strict';

var MediaSource = require('./window.js').MediaSource,
    loadManifest = require('./manifest/loadManifest.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

function load(manifestXml, tech) {
    console.log('START');

    var mediaSource = new MediaSource(),
        openListener = function(event) {
            mediaSource.removeEventListener('sourceopen', openListener, false);
            var playlistLoader = new PlaylistLoader(manifestXml, mediaSource, tech);
        };

    mediaSource.addEventListener('sourceopen', openListener, false);

    // TODO: Handle close.
    //mediaSource.addEventListener('webkitsourceclose', closed, false);
    //mediaSource.addEventListener('sourceclose', closed, false);

    tech.setSrc(URL.createObjectURL(mediaSource));
}

function SourceHandler(source, tech) {
    loadManifest(source.src, function(data) {
        load(data.manifestXml, tech);
    });
}

module.exports = SourceHandler;