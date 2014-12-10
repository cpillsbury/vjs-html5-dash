'use strict';

var MediaSource = require('./window.js').MediaSource,
    loadManifest = require('./manifest/loadManifest.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

function SourceHandler(source, tech) {
    var self = this;
    loadManifest(source.src, function(data) {
        //load(data.manifestXml, tech);
        var manifest = self.__manifest = data.manifestXml;
        console.log('START');

        var mediaSource = new MediaSource(),
            openListener = function(event) {
                mediaSource.removeEventListener('sourceopen', openListener, false);
                self.__playlistLoader = new PlaylistLoader(manifest, mediaSource, tech);
            };

        mediaSource.addEventListener('sourceopen', openListener, false);

        // TODO: Handle close.
        //mediaSource.addEventListener('webkitsourceclose', closed, false);
        //mediaSource.addEventListener('sourceclose', closed, false);

        tech.setSrc(URL.createObjectURL(mediaSource));
    });
}

module.exports = SourceHandler;