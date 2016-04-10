var http = require('http');
var fs = require('fs');
var qs = require('querystring');
var exec = require('child_process').exec;

const PORT = 5050;

var destinationPath = '/opt/data/export/pdf/';
var pipePath = '/opt/app/DesiderataLibrary-pdfImporter/pipeline/';

function handleRequest(request, response) {
    if (request.method == 'POST') {
        var body = '';

        request.on('data', function (data) {
            body += data;
        });

        request.on('end', function () {
            var params = qs.parse(body);
            var args = '\''+params.pdf+'\' '+params.isbn+' \''+destinationPath+'\' '+params.callback+' '+params.callbackError+' --replace';
            var pipeLog = destinationPath + 'pdfpipecmd.log';
            fs.appendFileSync(pipeLog, pipePath+'pdfpipe.sh '+args + '\n', 'utf8');
            response.end('ok');
            exec(pipePath+'pdfpipe.sh '+args, function(error, stdout, stderr) {
                fs.appendFile(pipeLog, stdout + '\n--- FINITO ---\n', function (err) {
                    if (err) return console.error(err);
                    console.log('output logged to', pipeLog);
                });
            });
        });
    } else {
        response.end("bad request");
    }
}

var server = http.createServer(handleRequest);

//Start server
server.listen(PORT, function(){
    console.log("Server listening on: %s", PORT);
});
