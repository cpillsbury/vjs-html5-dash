'use strict';

var MediaSource = require('global/window').MediaSource,
    //loadManifest = require('./manifest/loadManifest.js'),
    Manifest = require('./manifest/Manifest.js'),
    PlaylistLoader = require('./PlaylistLoader.js');

function SourceHandler(source, tech) {
    var self = this,
        manifestProvider = new Manifest(source.src, false);
    manifestProvider.load(function(manifest) {
        var mediaSource = new MediaSource(),
            openListener = function(event) {
                mediaSource.removeEventListener('sourceopen', openListener, false);
                self.__playlistLoader = new PlaylistLoader(manifestProvider, mediaSource, tech);
            };

        mediaSource.addEventListener('sourceopen', openListener, false);

        // TODO: Handle close.
        //mediaSource.addEventListener('webkitsourceclose', closed, false);
        //mediaSource.addEventListener('sourceclose', closed, false);

        tech.setSrc(URL.createObjectURL(mediaSource));
    });
}

module.exports = SourceHandler;
