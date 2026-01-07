/**
 * Reads the README.md file, converts it to HTML, and inserts it into the
 * google-drive.html file inside the element with id "google-drive-help"
 */

const markdownit = require('markdown-it');
const fs = require('fs');
const htmlParser = require('node-html-parser');

const readme = fs.readFileSync('./NODE_DOCS.md', 'utf8');
const googleDriveHtml = fs.readFileSync('./dist/google-drive.html', 'utf8');
const googleDriveDoc = htmlParser.parse(googleDriveHtml);

const md = markdownit()
const result = md.render(readme);

googleDriveDoc.querySelector('#google-drive-help').set_content('\n'+result+'\n');

fs.writeFileSync('./dist/google-drive.html', googleDriveDoc.toString(), 'utf8');
