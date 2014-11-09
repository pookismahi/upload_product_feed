fs = require 'fs' 
path = require 'path'
request = require 'request'
moment = require 'moment'
S = require 'string' 
_ = require('underscore')._
async = require 'async' 
csv = require 'csv'
nconf = require 'nconf'
ftp = require 'ftp'
nodemailer = require 'nodemailer'

configDefaults = 
  productFeed:
    outputFolder: '.'
    src: 'original_feed.csv'
  email: 
    service: 'Postmark'

setup = () ->
  nconf.argv().env()
  nconf.file nconf.get('config') if nconf.get('config')
  nconf.defaults configDefaults

downloadFile = (callback) ->
  feedConfig = nconf.get 'productFeed'
  url = feedConfig.gdoc
  destination = path.join feedConfig.outputFolder, feedConfig.src

  request 
    url: url
    followAllRedirects: true
    jar: true
  , (err, response, body) ->
    if not err and response.statusCode is 200
      fs.writeFile destination, body, ->
        return callback(null, body) if body.charAt(0) is '1'
        callback "First line of google docs file was not the number 1", destination

    else
      callback "Unable to download google doc with url - #{url}"

isUPC = (upc) ->
  upc = S(upc)
  upc.isNumeric() or upc.isEmpty()

sanitizeData = (data, callback) ->
  csv.parse data, (err, lines) ->
    # use the last number in the first rows as the column count
    columnCount = S(_.last(lines.shift())).toInt()

    result = _.chain(lines)
      # make sure that all the rows have a consistent number of columns
      .reject (line) -> line.length < columnCount
      # make sure that the product id is numeric
      .filter (line) -> S(line[0]).isNumeric()
      # make sure that the sku number is as valid as we can determine
      .filter (line) -> line[2].search(/^[A-Za-z0-9\-\.]*$/) >= 0
      # check for a valid UPC
      .filter (line) -> isUPC line[25]
      .map (line) -> 
        _.map line, (col) -> col.replace(/\\,/g, ",").trim()
      .value()

    callback(null, result)


outputFeed = (data, callback) ->
  feedConfig = nconf.get 'productFeed'
  filename = path.join feedConfig.outputFolder, uploadFilename()

  csv.stringify [buildHeaderLine(data), data..., buildTerminatingLine(data)],
    delimiter: "|"
  , (err, data) ->
    callback err, filename if err

    fs.writeFile filename, data, (err) ->
      callback err, filename

buildHeaderLine = (data) ->
  ["HDR", nconf.get('merchant:id'), nconf.get('merchant:name'), moment().format("YYYY-MM-DD/HH:mm:ss")]

buildTerminatingLine = (data) ->
  ["TRL", data.length]
  
uploadFilename = ->
  "#{nconf.get('merchant:id')}_nmerchandis#{moment().format('YYYYMMDD')}.txt"

uploadFile = (feedFile, callback) ->
  config = nconf.get 'ftp'
  return callback null, feedFile if config.disabled

  c = new ftp()
  ftpCompleted = false
  c.on "ready", ->
    c.put feedFile, path.basename(feedFile), (err, list) ->
      ftpCompleted = true unless err
      c.end()

  c.on "close", ->
    callback (if ftpCompleted then null else "Could not successfully ftp file"), feedFile

  c.connect config

errorEmail = (msg, resultFile) ->
  console.log "ERROR: #{msg}"
  sendEmail
    subject: "Error processing latest product feed"
    attachments: [path: resultFile]
    text: msg
  , (err) ->
    console.log "Error email sent successfully." unless err

successEmail = (resultFile, callback) ->
  console.log "Sending success email to #{nconf.get('email:to')}"
  sendEmail
    subject: "Completed upload of latest product feed"
    attachments: [path: resultFile]
    text: "Uploaded file attached"
  , callback

sendEmail = (mailOptions, callback) ->
  config = nconf.get 'email'
  return callback null if config.disabled

  emailer = nodemailer.createTransport
    service: config.service
    auth:
      user: config.user
      pass: config.password
  
  _.defaults mailOptions,
    from: config.from
    to: config.to

  emailer.sendMail mailOptions, (err, responseStatus) ->
    emailer.close
    console.log "Email sent successfully" unless err
    callback err

exports.upload = ->
  setup()

  async.waterfall [downloadFile, sanitizeData, outputFeed, uploadFile, successEmail], (err, results) ->
    if err
      errorEmail err, results
      console.log err
    else
      console.log "File uploaded and email sent ... in coffee!"


