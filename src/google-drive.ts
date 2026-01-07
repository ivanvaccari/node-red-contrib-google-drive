import { NodeAPI, NodeDef, type Node } from 'node-red';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCredentials } from './types';
import { google, drive_v3 } from 'googleapis';
import mime from 'mime-types';
import stream from 'stream';

type GoogleDriveNodeConfig = NodeDef & {
    redirect_uri: string;
    scopes: string;
    name: string;
    autoName: string;
    googleCredentials: string;
    operation: 'create' | 'read' | 'update' | 'delete' | 'list' | 'createFolder';
    folderId: string;
    fileId: string;
    fileName: string;
    folderName: string;
};

class GoogleDriveNode {
    static RED: NodeAPI;
    private node: Node;

    constructor(private config: GoogleDriveNodeConfig) {
        this.node = this as any as Node;
        GoogleDriveNode.RED.nodes.createNode(this.node, config);
        this.node.on('input', this.onInput.bind(this));
    }

    private async onInput(msg: any, send: (msg: any) => void, done: (err?: Error) => void) {
        // sets the credentials from the config node
        const googleCredentials = GoogleDriveNode.RED.nodes.getCredentials(this.config.googleCredentials) as GoogleCredentials;
        const googleClient = (GoogleDriveNode.RED.nodes.getNode(this.config.googleCredentials) as any)?.oauth2Client as OAuth2Client;

        if (!googleCredentials.access_token || !googleClient) {
            this.node.status({ fill: 'red', shape: 'ring', text: 'Google Credentials not set or invalid.' });
            this.node.error('Google Credentials not set or invalid. Please configure the Google Credentials node.');
            return;
        }

        const drive: drive_v3.Drive = google.drive({
            version: 'v3',
            auth: googleClient,
        });

        try {
            switch (this.config.operation) {
                case 'list':
                    this.node.status({ fill: 'yellow', shape: 'dot', text: 'Listing files...' });
                    msg = await this.listFiles(drive, msg);
                    break;
                case 'createFolder':
                    this.node.status({ fill: 'yellow', shape: 'dot', text: 'Creating folder...' });
                    msg = await this.createFolder(drive, msg);
                    break;
                case 'create':
                    this.node.status({ fill: 'yellow', shape: 'ring', text: 'Creating file...' });
                    msg = await this.createFile(drive, msg);
                    break;
                case 'read':
                    this.node.status({ fill: 'yellow', shape: 'ring', text: 'Reading file...' });
                    msg = await this.readFile(drive, msg);
                    break;
                case 'update':
                    this.node.status({ fill: 'yellow', shape: 'ring', text: 'Updating file...' });
                    msg = await this.updateFile(drive, msg);
                    break;
                case 'delete':
                    this.node.status({ fill: 'yellow', shape: 'ring', text: 'Deleting file...' });
                    msg = await this.deletefile(drive, msg);
                    break;
            }

            this.node.status({ fill: 'green', shape: 'dot', text: 'Completed' });
            send(msg);

            if (done) {
                done();
            }
        } catch (error: any) {
            this.node.status({ fill: 'red', shape: 'ring', text: `Error: ${error.message}` });
            this.node.error(error);

            return;
        }
    }

    /**
     * List files in a specified folder
     *
     * @param drive Google drive client
     * @param msg Message
     * @returns
     */
    private async listFiles(drive: drive_v3.Drive, msg: any) {
        const folderId = this.config.folderId || msg.payload.folderId || 'root';

        const result = await drive.files.list({
            q: `'${folderId}' in parents`,
            fields: 'files(id, name, mimeType, parents)',
        });

        msg.payload = result.data.files;
        return msg;
    }

    /**
     * Create a folder in Google Drive
     *
     * @param drive Google drive client
     * @param msg Message
     * @returns
     */
    private async createFolder(drive: drive_v3.Drive, msg: any) {
        const folderId = this.config.folderId || msg.payload.folderId || 'root';
        const folderName = this.config.folderName || msg.payload.folderName || 'New Folder';

        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [folderId],
        };
        const result = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, name',
        });
        msg.payload = result.data;
        return msg;
    }

    /**
     * Create a file in Google Drive
     *
     * @param drive Google drive client
     * @param msg Message
     * @returns
     */
    private async createFile(drive: drive_v3.Drive, msg: any) {
        const folderId = this.config.folderId || msg.payload.folderId || 'root';
        const fileName = this.config.fileName || msg.payload.fileName || 'New File.bin';

        if (!msg.payload || !msg.payload.buffer) {
            throw new Error('Message payload must contain a buffer property with file data.');
        }

        let fileStream = null;
        if (stream.isReadable(msg.payload.content)) {
            fileStream = msg.payload.content;
        } else if (Buffer.isBuffer(msg.payload.buffer)) {
            fileStream = stream.Readable.from(msg.payload.buffer);
        } else {
            fileStream = stream.Readable.from(msg.payload.buffer);
        }

        const fileMetadata = {
            name: fileName,
            parents: [folderId],
        };
        const media = {
            mimeType: mime.lookup(fileName) || 'application/octet-stream',
            body: fileStream,
        };
        const result = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name',
        });
        msg.payload = result.data;
        return msg;
    }

    /**
     * Reads a file from Google Drive
     *
     * @param drive The Google Drive client
     * @param msg Message
     */
    private async readFile(drive: drive_v3.Drive, msg: any) {
        const fileId = this.config.fileId || msg.payload.fileId;
        if (!fileId) {
            throw new Error('File ID must be specified in config or msg.payload.fileId');
        }

        this.node.error(`Reading file with ID: ${fileId}`);
        const metadata = await drive.files.get({
            fileId: fileId,
            fields: 'mimeType, name',
        });

        msg.payload = {
            fileId: fileId,
            name: metadata.data.name,
            mimeType: metadata.data.mimeType,
        };

        const stream = await drive.files.get(
            {
                fileId: fileId,
                alt: 'media',
            },
            { responseType: 'stream' }
        );

        const chunks: Buffer[] = [];
        msg.payload.content = await new Promise<any>((resolve, reject) => {
            stream.data.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            stream.data.on('end', () => {
                const fileBuffer = Buffer.concat(chunks);
                resolve(fileBuffer);
            });
            stream.data.on('error', (err: Error) => {
                reject(err);
            });
        });

        return msg;
    }


    /**
     * Update a file in Google Drive
     * @param drive Google drive client
     * @param msg Message
     * @returns 
     */
    async updateFile(drive: drive_v3.Drive, msg: any) {

        const fileId = this.config.fileId || msg.payload.fileId;
        if (!fileId) {
            throw new Error('File ID must be specified in config or msg.payload.fileId');
        }

        if (!msg.payload || !msg.payload.buffer) {
            throw new Error('Message payload must contain a buffer property with file data.');
        }

        let fileStream = null;
        if (stream.isReadable(msg.payload.content)) {
            fileStream = msg.payload.content;
        } else if (Buffer.isBuffer(msg.payload.buffer)) {
            fileStream = stream.Readable.from(msg.payload.buffer);
        } else {
            fileStream = stream.Readable.from(msg.payload.buffer);
        }

        const media = {
            mimeType: mime.lookup(msg.payload.name) || 'application/octet-stream',
            body: fileStream,
        };

        const result = await drive.files.update({
            fileId: fileId,
            media: media,
            fields: 'id, name',
        });
        msg.payload = result.data;

        return msg;
    }

    /**
     * Delete a file from Google Drive
     * 
     * @param drive Google drive client
     * @param msg Message
     * @returns 
     */
    async deletefile(drive: drive_v3.Drive, msg: any) {
        const fileId = this.config.fileId || msg.payload.fileId;
        if (!fileId) {
            throw new Error('File ID must be specified in config or msg.payload.fileId');
        }
        await drive.files.delete({
            fileId: fileId,
        });
        msg.payload = { deleted: true }; // otherwise an exception is thrown
        return msg;
    }

}

const _export = function (RED: NodeAPI) {
    GoogleDriveNode.RED = RED;

    // @ts-expect-error ignore typings here
    RED.nodes.registerType('Google Drive', GoogleDriveNode);
};

export = _export;
