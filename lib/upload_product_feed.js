exports.upload = function upload() {

var fs = require('fs');
var request = require('request');
var moment = require('moment');
var S = require('string');
var _ = require('underscore')._;
var nodemailer = require("nodemailer");

var argv = require('optimist')
  .default('src', "original_feed.csv")
  .default('eservice', "Postmark")
  .demand(['fhost', 'fuser', 'fpass', 'euser', 'epass', 'mid', 'mname', 'gdoc', 'toemail', 'fromemail'])
  .argv;

function downloadFile(url, destination, callback) {
  request({ url: url,
            followAllRedirects: true,
            jar: true }, 
          function(err, response, body) {
    if (!err && response.statusCode == 200) {
      fs.writeFile(destination, body, function() {
        if (body.charAt(0) === '1')
          return callback(body);

        errorEmail("First line of google docs file was not the number 1", destination);
      });
    }
    else {
      errorEmail("Unable to download google doc with url " + url);
    }
  });
}

// downloadFile = function(url, destination, callback) {
//   fs.readFile(destination, 'utf8', function(err, data) {
//     if (err) {
//       return console.log(err);
//     }
//     callback(data);
//   });
// }

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

  var result = _.chain(lines)
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
  var cols = ['HDR', argv.mid, argv.mname, moment().format('YYYY-MM-DD/HH:mm:ss')];
  return cols.join('|');
}

function buildTerminatingLine(data) {
  var numLines = S(data).count('\n');
  var cols = ['TRL', numLines];
  return cols.join('|');
}

function uploadFilename() {
  return argv.mid + "_nmerchandis" + moment().format('YYYYMMDD') + ".txt";
}

function uploadFile(feedFile, callback) {	
  console.log("FTP to %s with username %s, password %s", argv.fhost, argv.fuser, argv.fpass);

  var ftp = require('ftp');
  var c = new ftp();
  var ftpCompleted = false;
  
  c.on('ready', function() {
    c.put(feedFile, feedFile, function(err, list) {
      if (err) return console.log(err);
      ftpCompleted = true;
      c.end();
      callback(feedFile);
    });
  });

  c.on('close', function() {
    if (!ftpCompleted)
      errorEmail('Could not successfully ftp file');
  });

  c.connect({
    host: argv.fhost,
    user: argv.fuser,
    password: argv.fpass
  });
}

function errorEmail(msg, resultFile) {
  console.log('ERROR: ' + msg);
  sendEmail({
    subject: "Error processing latest product feed", 
    attachments: [ { filePath: resultFile } ],
    text: msg
  }, function() {
    console.log('Error email sent successfully.');
  });
}

function successEmail(resultFile, callback) {
  console.log("Sending success email to %s", argv.toemail);

  sendEmail({
    subject: "Completed upload of latest product feed", 
    attachments: [ { filePath: resultFile } ]    
  }, callback);
}

function sendEmail(mailOptions, callback) {
  var emailer = nodemailer.createTransport("SMTP", {
    service: argv.eservice,
    auth: {
      user: argv.euser,
      pass: argv.epass
    }
  });

  _.defaults(mailOptions, {
    from: "Product Feed <" + argv.fromemail + ">", 
    to: argv.toemail,
  });

  emailer.sendMail(mailOptions, function(error, responseStatus){
    emailer.close();

    if (error)
      return console.log(error);

    callback();
  });  
}

// TODO: change this to use async.series

downloadFile(argv.gdoc, argv.src, function(googleCSV) {
  sanitizeData(googleCSV, function(sanitized) {
    outputFeed(sanitized, function(feedFile) {
      uploadFile(feedFile, function(feedFile) {
        successEmail(feedFile, function() {
          console.log("File uploaded and email sent");
        });
      });
    });
  });
}); 

}



