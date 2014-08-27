console._log = console.log;
console.log = function() { var args = arguments; args[0] = '[' + new Date().toISOString() + '] ' + args[0]; console._log.apply(this, arguments); };

var ROLLBAR_TOKEN = 'YOUR_TOKEN_HERE';

var fs = require('fs');
var https = require('https');

var logDir = '/var/tmp';
var scanTimeout;

var logExp = /\.rollbar$/;

console.log('Hello. Monitoring: ' + logDir);
resetErrLogs();
scanForLogs();
fs.watch(logDir, handleWatchEvent);

function resetErrLogs() {
	scanTimeout = false;

	var errLogExp = /\.rollbar\.err$/;
	var files = fs.readdirSync('/var/tmp');
	files.forEach(function(file) {
		if (errLogExp.test(file))
			fs.renameSync(logDir + '/' + file, logDir + '/' + file.replace(/\.err$/, ''));
	});

	scanTimeout = null;
	scanForLogs();

	setTimeout(resetErrLogs, 3600000);
}

function scanForLogs() {
	scanTimeout && clearTimeout(scanTimeout);

	if (scanTimeout === false)
		return;
	scanTimeout = false;
	
	var logFiles = [];
	var files = fs.readdirSync(logDir);
	files.forEach(function(file) {
		if (logExp.test(file))
			logFiles.push(file);
	});
	processLogs(logFiles, function() {
		scanTimeout = setTimeout(scanForLogs, 10000);
	});
}

function handleWatchEvent(e, filename) {
	if (!filename || logExp.test(filename))
		setTimeout(scanForLogs, 100);
}

function processLogs(files, cb) {
	if (files.length == 0)
		return cb();
	processLog(files.shift(), function() {
		processLogs(files, cb);
	});
}

function processLog(file, cb) {
	console.log('Processing file: ' + file);

	var logData = fs.readFileSync(logDir + '/' + file);
	logData = '[' + String(logData).trim().replace(/\n/g, ',') + ']';

	var req = https.request({
		host: 'api.rollbar.com',
		method: 'POST',
		path: '/api/1/item_batch/',
		headers: {
			'X-Rollbar-Access-Token': ROLLBAR_TOKEN
		}
	});
	req.on('response', __handleResponse);
	req.setTimeout(15);
	req.end(logData);

	function __handleResponse(res) {
		if (res.statusCode == 200) {
			console.log('  Success');
			fs.unlinkSync(logDir + '/' + file);
			return cb();
		}
		var result = '';
		res.on('data', function(data) { result += data; });
		res.on('end', function() {
			console.log('  Got unexpected HTTP response code ' + res.statusCode + ':\n' + result);
			fs.renameSync(logDir + '/' + file, logDir + '/' + file + '.err');
			cb();
		});
	}
}
