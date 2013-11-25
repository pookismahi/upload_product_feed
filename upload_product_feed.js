#!/usr/local/bin/node

// npm install request moment string ftp
var fs = require('fs');
var util = require('util');
var request = require('request');
var moment = require('moment');
var S = require('string');
var Client = require('ftp');

var googleDocUrl = process.argv[5];
var merchantId = process.argv[6];
var originalFile = "original_feed.csv";

var ftpHost = process.argv[2]';
var ftpUser = process.argv[3];
var ftpPassword = process.argv[4];

function downloadFile(url, destination, callback) {
  request(url, function(err, response, body) {
    if (!err && response.statusCode == 200) {
      fs.writeFile(destination, body, function() {
        callback(body);
      });
    }
  });
}

downloadFile = function(url, destination, callback) {
  fs.readFile(destination, 'utf8', function(err, data) {
    if (err) {
      return console.log(err);
    }
    callback(data);
  });
}

function sanitizeData(data, callback) {
  var result = data
    .replace(/.*\n/, '')           // strip off the first line of the file
    .replace(/\\,/g, '###')        // replace any escaped commas with ###
    .replace(/,/g, '|')            // replace any commas that are left with |
    .replace(/###/g, ',')          // convert the escaped commas back to comma
    .replace(/"/g, '')             // remove any double quotes
    .replace(/[ ]*\|[ ]*/g, '|')   // remove any spaces around pipe characters
    .replace(/\n\s*\n*/g, '\n');

  callback(result);
}

function outputFeed(data, callback) {
    var result = S(buildHeaderLine(data)).ensureRight('\n') + S(data).ensureRight('\n') + buildTerminatingLine(data);
    var filename = uploadFilename();

    fs.writeFile(filename, result, 'utf8', function (err) {
      if (err) return console.log(err);
      callback(filename);
    });

}

function buildHeaderLine(data) {
  var cols = ['HDR', merchantId, 'MerchantName', moment().format('YYYY-MM-DD/HH:mm:ss')];
  return cols.join('|');
}

function buildTerminatingLine(data) {
  var numLines = S(data).count('\n') - 1;
  var cols = ['TRL', numLines];
  return cols.join('|');
}

function uploadFilename() {
  return merchantId + "_nmerchandis" + moment().format('YYYYMMDD') + ".txt";
}

function uploadFile(feedFile, callback) {
  var c = new Client();
  
  console.log("feedfile %s, username %s, password %s", feedFile, ftpUser, ftpPassword);

  c.on('ready', function() {
    c.put(feedFile, feedFile, function(err, list) {
      if (err) return console.log(err);
      c.end();
      callback();
    });
  });

  c.connect({
    host: ftpHost,
    user: ftpUser,
    password: ftpPassword
  });
}

downloadFile(googleDocUrl, originalFile, function(googleCSV) {
  sanitizeData(googleCSV, function(sanitized) {
    outputFeed(sanitized, function(feedFile) {
      uploadFile(feedFile, function() {
        console.log("success!!!!!");         
      });
    })
  });
});


