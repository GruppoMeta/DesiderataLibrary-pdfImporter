#!/bin/bash

# Bash PDFPipe for DesiderataLibrary
# Author: danieleverducci
# Date: 2015-11-20

#Bad parameters
if ! [ "$#" -gt 3 ]; then
    echo "
USAGE: pdfpipe.sh PDF_FILE ID_PUBBLICAZIONE DEST CALLBACK_SUCCESS CALLBACK_ERROR [--replace]
ES: pdfpipe.sh myFile.pdf 821684566486564 /home/user/destination/ http://1.2.3.4/callback.php
It will generate a directory in <DEST> named as the <ID_PUBBLICAZIONE> containing the imported book files
If optional parameter <--replace> is added at the end of command line, the destination, if existing, will be removed.
At the end, a request will be sent to the callback url.
All paths and strings containing spaces MUST be enclosed in double quotes."
    exit 2
fi

#Verify paths
SCRIPT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if ! [ -r "$SCRIPT_PATH/config.cfg" ]; then
	echo "Unable to load configuration from file $SCRIPT_PATH/config.cfg" >&2
	exit 1
fi
echo "Loading configuration file config.cfg"
source "$SCRIPT_PATH/config.cfg"
echo "Configuration loaded from file config.cfg" > $log

if ! [ -f "$cachejs" ]; then
	echo "Error: cache.js script not found in $cachejs . The cache.js path can be configured in config.cfg"
	echo "Error: cache.js script not found in $cachejs . The cache.js path can be configured in config.cfg" >> $log
	exit 1
fi
if [ -d "$log" ]; then
	echo "Error: the log path must specify a file name, a directory is currently specified: $log"
	echo "Error: the log path must specify a file name, a directory is currently specified: $log" >> log
	exit 1
fi
if ! [[ -f "${1}" ]]; then
	echo "Error: PDF file not found: $1"
	echo "Error: PDF file not found: $1" >> $log
	exit 1
fi
if ! [ -d "$3" ]; then
	echo "Error: Destination path not found: $3"
	echo "Error: Destination path not found: $3" >> $log
	exit 1
fi
if [ -d "$3/$2" ]; then
	if [ "$6" = "--replace" ]; then
		echo "Replacing existent imported document $2..."
		echo "Replacing existent imported document $2..." >> $log
		rm -R "$3/$2"
	else
		echo "Document $2 exists in destination. Add --replace at the end of command line to force overwrite. Exiting."
		echo "Document $2 exists in destination. Add --replace at the end of command line to force overwrite. Exiting." >> $log
		exit 1
	fi
else
	echo "Creating directory...";
	echo "Creating directory..." >> $log
fi


#Start elaboration
#Create directory
mkdir "$3/$2"
cd "$3/$2"

#echo "Optimizing PDF file with Ghostscript...";
#echo "Optimizing PDF file with Ghostscript..." >> $log
#gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -sOutputFile=maindocument.pdf "${1}" &>> "$log"
cp "${1}" maindocument.pdf

echo "Creating covers...";
echo "Creating covers..." >> $log
pdftk A=maindocument.pdf cat A1 output cover.pdf
convert cover.pdf -resize 500x500  "$2@2x.png"
convert cover.pdf -resize 353x353  "$2_cover.png"
convert cover.pdf -resize 138x138  "$2.png"

echo "Generating cache";
echo "Generating cache" >> $log
mkdir cache
until node $cachejs "$3/$2/maindocument.pdf" "$3/$2" "true"
do
	if [ $? -ne 2 ]; then
		echo "ERROR occurred during cache generation. Will now exit."
		echo "ERROR occurred during cache generation. Will now exit." >> $log
		echo "Sending error callback to url $5"
		echo "Sending error callback to url $5" >> $log
		wget $5 &>> $log
		exit 1
	fi
	echo "Cache generation cycle finished. Cache generation continues..."
	echo "Cache generation cycle finished. Cache generation continues..." >> $log
done
echo "Cache generation complete.";
echo "Cache generation complete." >> $log

echo "Generating thumbnails...";
echo "Generating thumbnails..." >> $log
mkdir thumbs
convert -size 164x164 maindocument.pdf -resize 164x164 +adjoin thumbs/%d.png &>> $log

echo -n "Extracting text from page ";
echo "Extracting text from page " >> $log
mkdir text
pages="$(pdfinfo maindocument.pdf | grep Pages | awk '{print $2}')"
for page in $(seq 1 $pages); do
	pdftotext maindocument.pdf -f $page -l $page "text/$page.txt" >> $log
	echo -n "$page, "
	echo -n "$page, " >> $log
done
echo "done." 
echo "done." >> $log

echo "Sending success callback to url $4"
echo "Sending success callback to url $4" >> $log
wget $4 &>> $log

echo "Import finished. Exiting."
echo "Import finished. Exiting." >> $log

