upload_product_feed
==============================

This utility is designed to do the following actions is a way that I can maintain fairly
easily on an ec2 instance as a cron job.  At the moment, it does the following:

* Download a google docs spreadsheet as csv
* Do some modifications on the csv file to make it pipe delimited with a specific header/footer
* Discard any lines that don't match the expected values
* FTP the file with a certain filename
* Send success and failure emails using Postmark  

Your mileage may vary, but I've found it a useful project for getting better with various
node idioms and packaging.

