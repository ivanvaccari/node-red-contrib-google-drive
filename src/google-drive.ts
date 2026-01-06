import { NodeAPI, NodeDef, type Node } from 'node-red';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCredentials } from './types';
import { google, drive_v3 } from 'googleapis';

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
                    this.node.status({ fill: 'blue', shape: 'dot', text: 'Listing files...' });
                    msg = await this.listFiles(drive, msg);

                    break;
            }

            this.node.status({ fill: 'green', shape: 'dot', text: 'Completed' });
            send(msg);

            if (done) {
                done();
            }
            
        } catch (error: any) {
            this.node.status({ fill: 'red', shape: 'ring', text: `Error: ${error.message}` });
            this.node.error(`Error during operation: ${error.message}`, msg);
            return;
        }
    }

    /**
     * List files in a specified folder
     * 
     * @param drive Google rive client
     * @param msg messae to be populated
     * @returns 
     */
    private async listFiles(drive: drive_v3.Drive, msg: any) {
        const folderId = this.config.folderId || 'root';

        const result = await drive.files.list({
            q: `'${folderId}' in parents`,
            fields: 'files(id, name, mimeType, parents)',
        });

        msg.payload = { files: result.data.files };
        return msg;
    }
}

const _export = function (RED: NodeAPI) {
    GoogleDriveNode.RED = RED;

    // @ts-expect-error ignore typings here
    RED.nodes.registerType('Google Drive', GoogleDriveNode);
};

export = _export;
