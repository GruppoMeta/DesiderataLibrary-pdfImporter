/**
 * Module dependencies.
 */

var Canvas = require('canvas')
    , Font = Canvas.Font
    , fs = require('fs')
    , EventEmitter = require('events').EventEmitter
    , util = require('util')
    , jsdom = require('jsdom')
    , zlib = require('zlib')
    ;

var $ = require('jquery').create();

var log_file = fs.createWriteStream('debug.log', {flags : 'w'});

var document = jsdom.jsdom();
var window = document.parentWindow;
jsdom.jQueryify(window, "http://code.jquery.com/jquery-1.10.2.min.js");

// -----------------------------------------------------------------------------
// HACKING :P
// ---
var PDFJS = require('../lib/pdf.js');
var textlayerbuilder = require('./textlayerbuilder.js');

// === Some NODE specific stuff.
// Turn of worker support for now.
PDFJS.disableWorker = true;

PDFJS.createScratchCanvas = function nodeCreateScratchCanvas(width, height) {
    var canvas = new Canvas(width, height);
    return canvas;
};

// Change the font loader logic - THERE IS NO DOM HERE.
PDFJS.FontLoader.bind = function nodeFontLoaderBind(pdf, fonts, callback) {
    if (!Font) {
        throw new Error("Need to compile node-canvas/cairo with font support.");
    }

    for (var i = 0, ii = fonts.length; i < ii; i++) {
        var font = fonts[i];

        // Add the font to the DOM only once or skip if the font
        // is already loaded.
        if (font.attached || font.loading == false) {
            continue;
        }
        font.attached = true;

        var data = font.data;

        // Some fonts don't come with data.
        if (!data) {
            continue;
        }

        var fontName = font.loadedName;
        var fontFile = 'temp/' + pdf._idx + '_' + fontName + '.ttf';

        // Temporary hack for loading the font. Write it to file such that a font
        // object can get created from it and use it on the context.
        var buf = new Buffer(data);

        fs.writeFileSync(fontFile, buf);

        var fontObj = new Font(fontName, fontFile);

        pdf.useFont(fontObj);
    }

    callback();
};

// === Let's get started

var idxCounter = 0

function PDFReader(path) {
    EventEmitter.call(this);

    var self = this;

    this.fontList = [];
    this.busyContextList = [];
    this._useFont = this._useFont.bind(this);
    this._idx = idxCounter++;

    var buf = this._loadPDF(path);

    // PDFJS.getDocument might return right away, but then the listerns
    // for the `ready` event are not bound yet.
    // Delay the function until the next tick.
    process.nextTick(function() {
        // Basic parsing of the PDF document.
        PDFJS.getDocument(buf).then(function(pdf) {
            pdf.useFont = self._useFont;
            pdf._idx = self._idx;

            self.pdf = pdf;
            self.emit('ready', self);

        }, function(err) {
            console.log('error');
            self.emit('error', err);
        });
    });
}

util.inherits(PDFReader, EventEmitter);

PDFReader.prototype._useFont = function(font) {
    this.fontList.push(font);
    this.busyContextList.forEach(function(ctx) {
        ctx.addFont(this);
    }, font);
};

PDFReader.prototype._addBusyContext = function(context) {
    this.busyContextList.push(context);

    // Make context know all already loaded fonts.
    this.fontList.forEach(function(font) {
        context.addFont(font);
    });
};

PDFReader.prototype._removeBusyContext = function(context) {
    var list = this.busyContextList;
    list.splice(list.indexOf(context), 1);
};

PDFReader.prototype._loadPDF = function(path) {
    // TODO: Check file exist.
    var state = fs.statSync(path);
    var size = state.size;
    var buf = new Buffer(size);

    var fd = fs.openSync(path, 'r');
    fs.readSync(fd, buf, 0, size, 0);

    // Set the buffer length, such that the PDF.JS `isArrayBuffer` think it's
    // a real typed-array buffer ;)
    buf.byteLength = size;
    return buf;
};

PDFReader.prototype._pdfNotReady = function(callback) {
    callback('PDF not ready yet');
};

PDFReader.prototype.render = function(pageNum, opt, callback) {
    console.log('start page: %d', pageNum);
    log_file.write('start page: ' + pageNum + '\n');
    var pdf = this.pdf;
    var self = this;

    if (!pdf) {
        return this._pdfNotReady(callback);
    }

    var numPages = pdf.numPages;
    opt.scale = opt.scale || 1.0;

    pdf.getPage(pageNum).then(function(page) {

        var viewport = page.getViewport(opt.scale);
        var canvas = new Canvas(viewport.width, viewport.height);
        var context = canvas.getContext('2d');

        // Store reference to the context, such that new loaded fonts can be
        // registered. Also adds in all already loaded fonts in the PDF on the
        // context.
        self._addBusyContext(context);

        if(opt.bg) {
            context.save();
            context.fillStyle = 'white';
            context.fillRect(0, 0, viewport.width, viewport.height);
            context.restore();
        };

        page.getTextContent().then(function (textContent) {

            //var document = jsdom.jsdom();
            //var window = document.parentWindow;

            //jsdom.jQueryify(window, "http://code.jquery.com/jquery-1.10.2.min.js", function () {
            window.$("body").empty();
            window.$("body").append('<div id="textLayer' + pageNum + '"></div>');
            window.$('#textLayer' + pageNum)
                .css("height", viewport.height + "px")
                .css("width", viewport.width + "px");
            /*var options = {
             textLayerDiv: window.$('#textLayer' + pageNum).get(0),
             pageIndex: 0,
             doc: document
             };*/

            //var textLayer = new textlayerbuilder.TextLayerBuilder(options);
            var textLayer = new textlayerbuilder.TextLayerBuilder(window.$('#textLayer' + pageNum).get(0), 0, document);
            textLayer.setTextContent(textContent);
            var renderContext = {
                canvasContext: context,
                viewport: viewport,
                textLayer: textLayer
            };
            page.render(renderContext).then(function() {//fs.writeFileSync('render.txt', 'window.$("body").toString()');
                var file = '';
                if (typeof opt.output === 'string') {
                    file = opt.output;
                } else {
                    // TODO: Error handling if it's not a function.
                    file = opt.output(pageNum);
                };

                var out = fs.createWriteStream(file);
                var stream = canvas.createPNGStream();
                /*var stream = canvas.createJPEGStream({
                 bufsize: 4096,
                 quality: 90,
                 progressive: true
                 });*/

                stream.on('data', function(chunk){
                    out.write(chunk);
                });

                stream.on('end', function() {
                    console.log('finished page: %d - write to file: %s', pageNum, file);
                    log_file.write('finished page: ' + pageNum+' - write to file: ' + file + '\n');
                    out.end();
                    self._removeBusyContext(context);
                    var info = {
                        dest: opt.dest,
                        page: pageNum,
                        numPages: numPages,
                        scale: opt.scale
                    };

                    callback(null, window.$('#textLayer' + pageNum).get(0), info);
                });

                stream.on('close', function() {
                    console.log('close');
                });

            }, function(error) {
                self._removeBusyContext(context);
                callback(error);
            });
            //});
        });
    });
};

PDFReader.prototype.renderAll = function(opt, callback) {
    if (!this.pdf) {
        return this._pdfNotReady(callback);
    }
    if(opt.singlePage) {
        var numPages = opt.singlePage;
        var i = opt.singlePage;
    }
    else {
        var numPages = this.pdf.numPages;
        var i = 1;
    };
    var next = function() {
        if (i > numPages) {
            callback(null, opt);
            return;
        }


        // var test = false;
        // if(opt.cache) {

        //   var cachePage = opt.dest + '/cache/page_' + i + '_' + opt.scale + '.png';
        //   try {
        //     test = fs.statSync(cachePage);
        //   }
        //   catch(e) {
        //     test = false;
        //   };
        // }
        // if(test) {
        //   console.log('page '+i+' already exist');
        //   i++;
        //   next();
        // }
        // else {

        this.render(i, opt, function(err, data, info) {
            if (err) {
                callback(err);
                return;
            }

            console.log('start layer: %d', info.page);
            log_file.write('start layer: ' + info.page + '\n');
            var cachePages = info.dest + '/cache/pages.txt';
            var cacheLayer = info.dest + '/cache/layer_' + info.page + '_' + info.scale + '.txt.gz';

            fs.stat(cachePages, function(err, stats) {
                if(!stats) {
                    fs.writeFileSync(cachePages, info.numPages);
                }
                var cache = [];
                //console.log('start JSON.stringify layer');
                var layer = JSON.stringify(data, function(key, value) {
                    if (typeof value === 'object' && value !== null) {
                        if (cache.indexOf(value) !== -1) {
                            // Circular reference found, discard key
                            return;
                        }
                        // Store value in our collection
                        cache.push(value);
                    }
                    return value;
                });
                //console.log('finish JSON.stringify layer');
                cache = null;

                //console.log('start shallowStringify layer2');
                var layer2 = shallowStringify(data);
                //console.log('finish shallowStringify layer2');
                //console.log('start JSON.stringify layerProp');
                var layerProp = JSON.stringify(JSON.parse(layer)._ownerDocument._ids);
                //console.log('finish JSON.stringify layer');
                //console.log('start createLayer');
                layer = createLayer(layer, layer2);
                //console.log('finish createLayer');
                //console.log('start zip');
                var out = fs.createWriteStream(cacheLayer);
                var gzip = zlib.createGzip();
                gzip.pipe(out);
                //console.log('end zip 1');
                //fs.writeFileSync(cacheLayer, layer + '###' + layerProp);
                gzip.write(layer + '###' + layerProp);
                //console.log('end zip 2');
                gzip.end();
                //out.end();
                //console.log('finish layer: %d', info.page);
                i++;
                if(i % 100 === 0){
                    console.log('Optimizing perfomance ...');
                    log_file.write('Optimizing perfomance ... \n');
                    process.exit(2);
                } else {
                    next();
                }
            });

        });

        // }

    };

    var test = false;
    if(opt.cache) {
        /** Controlliamo se c'è l'ultima pagina così skippiamo tutto */
        var lastPage = opt.dest + '/cache/page_' + numPages + '_' + opt.scale + '.png';
        try {
            test = fs.statSync(lastPage);
        }
        catch(e) {
            test = false;
        };

        if(test){
            callback(null, opt);
            return;
        }

        for(var j=1; j<=numPages; j++){
            var cachePage = opt.dest + '/cache/page_' + j + '_' + opt.scale + '.png';
            try {
                test = fs.statSync(cachePage);
            }
            catch(e) {
                test = false;
            };
            if(test) {
                console.log('page '+j+' already exist');
            } else{
                i=j;
                break;
            }
        }
    }


    next = next.bind(this);
    next();
};

PDFReader.prototype.getContent = function(pageNum, callback) {
    var pdf = this.pdf;
    if (!pdf) {
        return this._pdfNotReady(callback);
    }

    pdf.getPage(pageNum).then(function(page) {
        page.getTextContent().then(function(arr) {
            // TODO: Handle RTL properly here.
            var content = arr.bidiTexts.map(function(bit) {
                return bit.str;
            }).join(' ');
            callback(null, content, arr);
        }, function(err) {
            callback(err);
        });
    }, function(err) {
        callback(err);
    });
};

function createLayer(layer, layer2) {
    var JSONlayer = JSON.parse(layer);
    //var start = layer2.indexOf("outerHTML", 0);
    //var end = layer2.indexOf("innerHTML", start);
    //var el = layer2.slice(start, end);

    var divs = $(layer2)[0].outerHTML;
    $('body').empty();
    $('body').html(divs);
    $('body').children(0).addClass('textLayer');

    /*var div = el.split("<div");

     var textLayer = $('<div' + div[1].split(',')[0] + '</div>')
     .addClass('textLayer');

     var html = '';
     for (var i=2; i<div.length; i++) {
     html = textLayer.html();
     if(i == div.length-1) {
     textLayer.html(html + "<div" + div[i].slice(0, div[i].lastIndexOf("</div>")));
     }
     else {
     textLayer.html(html + "<div" + div[i]);
     };
     };
     $('body').empty();
     $('body').append(textLayer);*/

    return $('body').html();
};

function shallowStringify(obj, onlyProps, skipTypes) {
    var objType = typeof(obj);
    if(['function', 'undefined'].indexOf(objType)>=0) {
        return objType;
    } else if(['string', 'number', 'boolean'].indexOf(objType)>=0) {
        return obj; // will toString
    }
    // objType == 'object'
    var res = '{';
    for (p in obj) { // property in object
        if(typeof(onlyProps)!=='undefined' && onlyProps) {
            // Only show property names as values may show too much noise.
            // After this you can trace more specific properties to debug
            res += p+', ';
        } else {
            var valType = typeof(obj[p]);
            if(typeof(skipTypes)=='undefined') {
                skipTypes = ['function'];
            }
            if(skipTypes.indexOf(valType)>=0) {
                res += p+': '+valType+', ';
            } else {
                res += p+': '+obj[p]+', ';
            }
        }
    }
    res += '}';
    return res;
};
exports = module.exports = {};
exports.PDFReader = PDFReader;
