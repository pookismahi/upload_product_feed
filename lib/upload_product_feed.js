(function() {

var fs = require('fs');
var request = require('request');
var moment = require('moment');
var S = require('string');
var _ = require('underscore')._;
var async = require("async");

var argv = require('optimist')
  .default('src', "original_feed.csv")
  .default('eservice', "Postmark")
  .demand(['fhost', 'fuser', 'fpass', 'euser', 'epass', 'mid', 'mname', 'gdoc', 'toemail', 'fromemail'])
  .argv;

function downloadFile(callback) {
  var url = argv.gdoc;
  var destination = argv.src;

  request({ url: url,
            followAllRedirects: true,
            jar: true }, 
          function(err, response, body) {
    if (!err && response.statusCode == 200) {
      fs.writeFile(destination, body, function() {
        if (body.charAt(0) === '1')
          return callback(null, body);

        callback("First line of google docs file was not the number 1", destination);
      });
    }
    else {
      callback("Unable to download google doc with url " + url);
    }
  });
}

function readCachedFile(url, destination, callback) {
  fs.readFile(destination, 'utf8', callback);  
}

// in our files, the UPC is either a number or is empty if there isn't an explicit UPC
function isUPC(upc) {
  var upc = S(upc);
  return upc.isNumeric() || upc.isEmpty();
}

function sanitizeData(data, callback) {
  require('csv')()
    .from.string(data)
    .transform(function(row) {
      // there is some old data for a version that had , as \,
      return _.map(row, function(col) { return col.replace(/\\,/g, ',').trim() });
    })
    .to.array(function(lines) { 
      // use the last number in the first rows as the column count
      var columnCount = S(_.last(lines.shift())).toInt();

      var result = _.chain(lines)
        .reject(function(line) { return line.length < columnCount }) // make sure that all the rows have a consistent number of columns
        .filter(function(line) { return S(line[0]).isNumeric() }) // make sure that the product id is numeric
        .filter(function(line) { return line[2].search(/^[A-Za-z0-9\-\.]*$/) >= 0 }) // make sure that the sku number is as valid as we can determine
        .filter(function(line) { return isUPC(line[25]); }) // check for a valid UPC
        .value(); 

      callback(null, result);
  });
}

function outputFeed(data, callback) {
  var lines = _.map(data, function(line) { return line.join('|')});
  lines.unshift(buildHeaderLine(data));
  lines.push(buildTerminatingLine(data));

  var filename = uploadFilename();

  fs.writeFile(filename, lines.join('\n'), 'utf8', function (err) {
    callback(err, filename);
  });

}

function buildHeaderLine(data) {
  return ['HDR', argv.mid, argv.mname, moment().format('YYYY-MM-DD/HH:mm:ss')].join('|');
}

function buildTerminatingLine(data) {
  return ['TRL', data.length].join('|');
}

function uploadFilename() {
  return argv.mid + "_nmerchandis" + moment().format('YYYYMMDD') + ".txt";
}

function uploadFile(feedFile, callback) {	
  var ftp = require('ftp');
  var c = new ftp();
  var ftpCompleted = false;
  
  c.on('ready', function() {
    c.put(feedFile, feedFile, function(err, list) {
      if (!err) ftpCompleted = true;
      c.end();
    });
  });

  c.on('close', function() {
    callback(ftpCompleted ? null : 'Could not successfully ftp file', feedFile);
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
  }, function(err) {
    if (!err) console.log('Error email sent successfully.');
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
  var emailer = require("nodemailer").createTransport("SMTP", {
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

  emailer.sendMail(mailOptions, function(err, responseStatus){
    emailer.close();
    callback(err);
  });  
}

exports.upload = function upload() {
  async.waterfall([
      downloadFile,
      sanitizeData,
      outputFeed,
      uploadFile,
      successEmail
    ], 
    function(err, results) {
      if (err) {
        errorEmail(err, results);
        console.log(err);
      } else {
        console.log("File uploaded and email sent");
      }
  });
};

}).call(this);



