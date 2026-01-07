### List files

List files in a specified Google Drive folder. The node uses the first non-null value from (in this order) value of `msg.payload.folderId`, `config.folderId`, `root` as the folder ID to list files from.

You can obtain the folder ID from the Google Drive web interface URL when you open the folder: `https://drive.google.com/drive/folders/FOLDERID`, or by listing the parent folder's contents.

The node returns a message with `msg.payload` containing an array of file metadata objects representing the files in the specified folder.

### Create folder

Create a directory in Google Drive. The node uses the first non-null value from (in this order) value of `config.folderId`, `msg.payload.folderId`, `root` as the parent folder ID where the new folder will be created.

The new folder will be named according to the first non-null value of `config.folderName`, `msg.payload.folderName` or `New Folder`.

The nodes returns a message with `msg.payload` containing the created folder's metadata.

### Create file
Create a file in Google Drive. The node uses the first non-null value from (in this order) value of `config.folderId`, `msg.payload.folderId`,  `root` as the parent folder ID where the new file will be created.

The new file will be named according to the first non-null value of `config.fileName`, `msg.payload.fileName` or `New File.bin`. The content of the file is taken from `msg.payload.content`, which should be a Buffer, readable stream or a value convertible to a readable stream with `stream.Readable.from()`.
The node returns a message with `msg.payload` containing the created file's metadata.


### Read file

Reads a file from Google Drive. The node uses the first non-null value from (in this order) value of `config.fileId`, `msg.payload.fileId`  as the ID of the file to read.

The node returns a message with `msg.payload` containing an object with the following properties: `id`, `name`, `mimeType`, and `content` (a Buffer with the file content).

### Update file

Updates an existing file in Google Drive. The node uses the first non-null value from (in this order) value of `config.fileId` or `msg.payload.fileId` as the ID of the file to update.

You must provide the new content of the file in `msg.payload.content`, which should be a Buffer, readable stream or a value convertible to a readable stream with `stream.Readable.from()`.

The node returns a message with `msg.payload` containing the updated file's metadata.


### Delete file

Deletes a file from Google Drive. The node uses the first non-null value from (in this order) value of `config.fileId` or `msg.payload.fileId` as the ID of the file to delete.

The node returns a message with `msg.payload` containing an object with a single property `deleted` set to `true` upon successful deletion.