var PDFReader = require('./readerForCache.js').PDFReader;
var fs = require('fs');

process.chdir(__dirname + '/..');

function deleteFolder(path) {
  if(fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file, index) {
      var curPath = path + "/" + file;
      if(fs.statSync(curPath).isDirectory()) {
        deleteFolder(curPath);
      }
      else {
        fs.unlinkSync(curPath);
      };
    });
    fs.rmdirSync(path);
  };
};

function errorDumper(err, opt) {
  if (err) {
    console.log('something went wrong :/');
    throw err;
  }
  else {
    console.log('finish scale '+opt.scaleVec[opt.j]);
    opt.j++;
    if(opt.j < opt.scaleVec.length) {
      opt.scale = opt.scaleVec[opt.j];
      opt.output = function(pageNum) {
        return opt.dest + '/cache/page_' + pageNum + '_' + opt.scaleVec[opt.j] + '.png';
      };
      opt.pdf.renderAll(opt, errorDumper);
    }
    else {
      console.log('finish all');
    }
  };
};

var params = process.argv.slice(2);
var book = params[0];
var dest = params[1];
var cache = (params[2] == 'true') ? true : false;
var singlePage = params[3];
if(book && dest) {
  fs.stat(dest + '/cache', function(err, stats) {
    if(stats && !cache) {
      console.log('delete cache...')
      deleteFolder(dest + '/cache');
      fs.mkdirSync(dest + '/cache');
    }
    if(!stats) {
      fs.mkdirSync(dest + '/cache');
    }
    var reader = new PDFReader(book);
    reader.on('error', errorDumper);
    reader.on('ready', function(pdf) {
      var scale = [
        1,
        1.25,
        1.5,
        1.75,
        2,
        2.5
      ];
      var opt = {
        bg: true,  /* Enable white background */
        output: function(pageNum) {
          return dest + '/cache/page_' + pageNum + '_' + scale[0] + '.png';
        },
        scale: scale[0],
        dest: dest,
        pdf: pdf,
        scaleVec: scale,
        j: 0,
        singlePage: singlePage,
        cache: cache
      };
      setTimeout(function() {
        pdf.renderAll(opt, errorDumper);
      }, 5000);
    });
  });
}
else {
  console.log('params error')
};
