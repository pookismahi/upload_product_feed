fs = require('fs')
request = require('request')
moment = require('moment')
S = require('string')
_ = require('underscore')._
async = require('async')
csv = require('csv')

argv = require('optimist')
  .default('src', 'original_feed.csv')
  .default('eservice', 'Postmark')
  .demand(['fhost', 'fuser', 'fpass', 'euser', 'epass', 'mid', 'mname', 'gdoc', 'toemail', 'fromemail'])
  .argv

downloadFile = (callback) ->
  url = argv.gdoc
  destination = argv.src

  request 
    url: url
    followAllRedirects: true
    jar: true
  , (err, response, body) ->
    if not err and response.statusCode is 200
      fs.writeFile destination, body, ->
        return callback(null, body)  if body.charAt(0) is '1'
        callback "First line of google docs file was not the number 1", destination

    else
      callback "Unable to download google doc with url - #{url}"

readCachedFile = (url, destination, callback) ->
  fs.readFile destination, "utf8", callback

isUPC = (upc) ->
  upc = S(upc)
  upc.isNumeric() or upc.isEmpty()

sanitizeData = (data, callback) ->
  csv()
    .from.string(data)
    .transform (row) ->
      # there is some old data for a version that had , as \,
      _.map(row, (col) -> col.replace(/\\,/g, ",").trim())
    .to.array (lines) ->
      # use the last number in the first rows as the column count
      columnCount = S(_.last(lines.shift())).toInt()

      result = _.chain(lines)
        # make sure that all the rows have a consistent number of columns
        .reject((line) -> line.length < columnCount)
        # make sure that the product id is numeric
        .filter((line) -> S(line[0]).isNumeric())
        # make sure that the sku number is as valid as we can determine
        .filter((line) -> line[2].search(/^[A-Za-z0-9\-\.]*$/) >= 0)
        # check for a valid UPC
        .filter((line) -> isUPC line[25])
        .value()

      callback(null, result)


outputFeed = (data, callback) ->
  lineSets = [buildHeaderLines(data), data, buildTerminatingLines(data)]
  filename = uploadFilename()

  csv()
    .from.array(_.flatten(lineSets, true))
    .to(filename, delimiter: "|")
    .on("end", -> callback null, filename)
    .on("error", (err) -> callback err, filename)

buildHeaderLines = (data) ->
  [["HDR", argv.mid, argv.mname, moment().format("YYYY-MM-DD/HH:mm:ss")]]

buildTerminatingLines = (data) ->
  [["TRL", data.length]]
  
uploadFilename = ->
  "#{argv.mid}_nmerchandis#{moment().format('YYYYMMDD')}.txt"

uploadFile = (feedFile, callback) ->
  ftp = require("ftp")
  c = new ftp()
  ftpCompleted = false
  c.on "ready", ->
    c.put feedFile, feedFile, (err, list) ->
      ftpCompleted = true unless err
      c.end()

  c.on "close", ->
    callback (if ftpCompleted then null else "Could not successfully ftp file"), feedFile

  c.connect
    host: argv.fhost
    user: argv.fuser
    password: argv.fpass

errorEmail = (msg, resultFile) ->
  console.log "ERROR: #{msg}"
  sendEmail
    subject: "Error processing latest product feed"
    attachments: [filePath: resultFile]
    text: msg
  , (err) ->
    console.log "Error email sent successfully." unless err

successEmail = (resultFile, callback) ->
  console.log "Sending success email to #{argv.toemail}"
  sendEmail
    subject: "Completed upload of latest product feed"
    attachments: [filePath: resultFile]
  , callback

sendEmail = (mailOptions, callback) ->
  emailer = require("nodemailer").createTransport("SMTP",
    service: argv.eservice
    auth:
      user: argv.euser
      pass: argv.epass
  )
  
  _.defaults mailOptions,
    from: "Product Feed <#{argv.fromemail}>"
    to: argv.toemail

  emailer.sendMail mailOptions, (err, responseStatus) ->
    emailer.close
    callback err

exports.upload = ->
  async.waterfall [downloadFile, sanitizeData, outputFeed, uploadFile, successEmail], (err, results) ->
    if err
      errorEmail err, results
      console.log err
    else
      console.log "File uploaded and email sent ... in coffee!"


