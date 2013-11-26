#!/usr/local/bin/node

var fs = require('fs');
var request = require('request');
var moment = require('moment');
var S = require('string');
var _ = require('underscore')._;

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

// in our files, the UPC is either a number or is empty if there isn't an explicit UPC
function isUPC(upc) {
  var upc = S(upc);
  return upc.isNumeric() || upc.isEmpty();
}

function sanitizeData(data, callback) {
  var data = data
    .replace(/\\,/g, '###')        // replace any escaped commas with ###
    .replace(/,/g, '|')            // replace any commas that are left with |
    .replace(/###/g, ',')          // convert the escaped commas back to comma
    .replace(/"/g, '')             // remove any double quotes
    .replace(/[ ]*\|[ ]*/g, '|')   // remove any spaces around pipe characters
    .replace(/\n\s*\n*/g, '\n');

  var lines = data.split('\n');
  // use the last number in the first rows as the column count
  var columnCount = S(lines.shift().replace(/^.*\|/, '')).toInt();

  var result = _.chain(data.split('\n'))
  	.map(function(line) { return S(line).trim().split('|'); })  // make sure that we're removing any possible whitespace left
  	.reject(function(line) { return line.length < columnCount }) // make sure that all the rows have a consistent number of columns
  	.filter(function(line) { return S(line[0]).isNumeric() }) // make sure that the product id is numeric
  	.filter(function(line) { return line[2].search(/^[A-Za-z0-9\-\.]*$/) >= 0 }) // make sure that the sku number is as valid as we can determine
  	.filter(function(line) { return isUPC(line[25]); }) // check for a valid UPC
  	.map(function(line) { return line.join('|')}) // make each line pip delimited again
  	.value()
  	.join('\n'); 

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
  var numLines = S(data).count('\n');
  var cols = ['TRL', numLines];
  return cols.join('|');
}

function uploadFilename() {
  return merchantId + "_nmerchandis" + moment().format('YYYYMMDD') + ".txt";
}

function uploadFile(feedFile, callback) {	
  console.log("feedfile %s, username %s, password %s", feedFile, ftpUser, ftpPassword);

  var ftp = require('ftp');
  var c = new ftp();
  
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

// TODO: change this to use async.series

downloadFile(googleDocUrl, originalFile, function(googleCSV) {
  sanitizeData(googleCSV, function(sanitized) {
    outputFeed(sanitized, function(feedFile) {
      uploadFile(feedFile, function() {
        console.log("success!!!!!");         
      });
    })
  });
});


