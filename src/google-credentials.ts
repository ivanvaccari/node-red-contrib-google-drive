import { NodeAPI, Node, NodeDef } from 'node-red';
import { Credentials, OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import url from 'url';
import { flows, storage } from '@node-red/runtime';
import { GoogleCredentials, GoogleCredentialsNodeConfig } from './types';

var encryptionAlgorithm = 'aes-256-ctr';

/**
 * Shamelessly copy-pasted from nodered source code.
 * Decrypts an object stored as credentials
 *
 * @param key The encryption key
 * @param credentials The object to be decrypted
 * @returns
 */
function decryptCredentials(key: string, credentials: { [key: string]: any }) {
    var creds = credentials['$'];
    var initVector = Buffer.from(creds.substring(0, 32), 'hex');
    creds = creds.substring(32);
    var decipher = crypto.createDecipheriv(encryptionAlgorithm, key, initVector);
    var decrypted = decipher.update(creds, 'base64', 'utf8') + decipher.final('utf8');
    return JSON.parse(decrypted);
}

/**
 * Shamelessly copy-pasted from nodered source code.
 * Encrypts an object to be stored as credentials.
 *
 * @param key  The encryption key
 * @param credentials   The object to be encrypted
 * @returns
 */
function encryptCredentials(key: string, credentials: { [key: string]: any }) {
    var initVector = crypto.randomBytes(16);
    var cipher = crypto.createCipheriv(encryptionAlgorithm, key, initVector);
    return { $: initVector.toString('hex') + cipher.update(JSON.stringify(credentials), 'utf8', 'base64') + cipher.final('base64') };
}

/**
 * Google Credentials Node-RED node
 */
class GoogleCredentialsNode {

    /**
     * Static RED reference for accessing Node-RED APIs
     */
    static RED: NodeAPI;

    /**
     * OAuth2 Client instance
     */
    public oauth2Client: OAuth2Client;

    /**
     * Node instance
     */
    private node: Node;

    /**
     * Construct a Google Credentials Node
     * @param config 
     */
    constructor(private config: GoogleCredentialsNodeConfig) {
        this.node = this as any as Node;

        this.config = config;
        this.config.scopes = this.config.scopes || 'https://www.googleapis.com/auth/drive';

        GoogleCredentialsNode.RED.nodes.createNode(this.node, config);

        // get the credentials from the config node
        let credentials: GoogleCredentials = GoogleCredentialsNode.RED.nodes.getCredentials(this.node.id) as GoogleCredentials;

        // Create the OAuth2 client
        this.oauth2Client = new OAuth2Client(credentials.client_id, credentials.client_secret, this.config.redirect_uri);

        // Load tokens from persisted storage then sets them in the OAuth2 client
        // Also sets the credentials in the node-red credential storage
        this.readPersistedCredentials(this.node.id).then(async (persistedCredentials) => {
            if (persistedCredentials?.access_token && persistedCredentials?.refresh_token) {
                // Sets the persised credentials inn the node-red credential storage. This is needed because access_token and refresh_token
                // are stored in the runtime settings storage to be persistent across restarts, if they were autoupdated, the new values are
                // in that storage only.
                credentials = {
                    ...credentials,
                    ...persistedCredentials,
                };
                GoogleCredentialsNode.RED.nodes.addCredentials(this.node.id, credentials);

                this.oauth2Client.setCredentials({
                    access_token: credentials.access_token!,
                    refresh_token: credentials.refresh_token!,
                });

                if (credentials.expiry_date && Date.now() > credentials.expiry_date) {
                    await this.refreshToken(credentials);
                }
            } else {
                const errorMessage = '[google-credentials] Missing access or refresh token';
                this.node.warn(errorMessage);
            }
        });

        this.mountRoutes();
    }

    /**
     * Uses the refresh token to get a new access token
     * 
     * @param credentials The current credentials
     * @returns 
     */
    public async refreshToken(credentials: GoogleCredentials) {
        try {
            console.log('[google-credentials] Refreshing access token...');
            const { credentials: newTokens } = await this.oauth2Client.refreshAccessToken();

            if (!newTokens.access_token) {
                throw new Error('Failed to refresh access token');
            }

            if (!newTokens.refresh_token) {
                throw new Error('Failed to refresh refresh token');
            }

            credentials.access_token = newTokens.access_token;
            credentials.refresh_token = newTokens.refresh_token;
            credentials.expiry_date = newTokens.expiry_date || new Date().getTime() + 10 * 365 * 24 * 3600 * 1000; // 10 year

            // @ts-expect-error ignore typings here
            const refresh_token_expires_in = newTokens.refresh_token_expires_in;
            if (refresh_token_expires_in) {
                credentials.refresh_token_expiry_date = new Date().getTime() + refresh_token_expires_in * 1000;
            }

            console.log('[google-credentials] Access token refreshed successfully');

            GoogleCredentialsNode.RED.nodes.addCredentials(this.node.id, credentials);
            this.oauth2Client.setCredentials(credentials);
            this.persistCredentials(this.node.id, credentials);
        } catch (err: any) {
            const errorMessage = `Error refreshing access token: ${err.message}`;
            this.node.error(errorMessage);
            console.error(`[google-credentials] ${errorMessage}`);
            return null;
        }
    }

    /**
     * There's literally no way to store credentials using built-in methods, and for seome reason, NR devs purposely omits
     * this to supposely wash their hands in front of security:
     * - https://discourse.nodered.org/t/fr-manipulate-credentials-from-runtime/83683/19
     *
     * Being said that, i'ts imperative for us to store the updated tokens after refreshing them otherwise at every
     * app reboot we would loose them.
     * I choose the settings file for these reasonsons:
     * - it already includes _credentialSecret encryption key. If this value is leaked, the whole NR instance is compromised anyway.
     * - it is programmatically accessible and writeable from runtime
     * 
     * It's still readable by any node, so bad nodes might abuse this, but at least it's stored encrypted and
     * is stored whatever the storage backend is (file, db, etc)

     * @param nodeId The node id to store the credentials for
     * @param credentials The credentials to store
     */
    private async persistCredentials(nodeId: string, credentials: GoogleCredentials) {
        const settings: any = await storage.getSettings();
        let credentialSecret = GoogleCredentialsNode.RED.settings.credentialSecret ?? settings._credentialSecret!;
        credentialSecret = crypto.createHash('sha256').update(credentialSecret).digest();

        settings['google-credentials'] = settings['google-credentials'] || {};
        (settings as any)['google-credentials'][nodeId] = encryptCredentials(credentialSecret, {
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token,
            expiry_date: credentials.expiry_date,
            refresh_token_expiry_date: credentials.refresh_token_expiry_date,
        });

        storage.saveSettings(settings);
    }

    /**
     * Read credentials from runtime settings storage
     *
     * @param nodeId the node id
     * @returns
     */
    private async readPersistedCredentials(nodeId: string): Promise<GoogleCredentials | null> {
        const settings: any = await storage.getSettings();
        let credentialSecret = GoogleCredentialsNode.RED.settings.credentialSecret ?? settings._credentialSecret!;
        const encryptedCredentials = settings['google-credentials']?.[nodeId];
        if (!encryptedCredentials) return null;

        credentialSecret = crypto.createHash('sha256').update(credentialSecret).digest();
        const decrypted = decryptCredentials(credentialSecret, encryptedCredentials);
        return decrypted as GoogleCredentials;
    }


    /**
     * Mount some internal routes for OAuth2 flow and status checking
     */
    private mountRoutes() {
        // ount the route that starts the OAuth2 flow. This is called from the config node edit dialog.
        GoogleCredentialsNode.RED.httpAdmin.get('/google-credentials/auth', (req, res) => {
            console.log('google-credentials/auth');
            const clientId = req.query.clientId as string;
            const nodeId = req.query.id as string;
            const callback = req.query.callback as string;
            const scopes = (req.query.scopes || 'https://www.googleapis.com/auth/drive') as string;
            const credentials: GoogleCredentials = GoogleCredentialsNode.RED.nodes.getCredentials(nodeId);
            const clientSecret = credentials?.client_secret;

            console.log('credentials', credentials);
            const hasMissingParams = [clientId, clientSecret, nodeId, callback].some((param) => !param);
            if (hasMissingParams) {
                res.status(400).send('Missing one or more parameters: clientId, clientSecret, nodeId, callback');
                console.error('[google-credentials] Missing parameters in /auth request');
                return;
            }

            credentials.csrf_token = crypto.randomBytes(18).toString('base64').replace(/\//g, '-').replace(/\+/g, '_');

            res.cookie('csrf', credentials.csrf_token);

            res.redirect(
                url.format({
                    protocol: 'https',
                    hostname: 'accounts.google.com',
                    pathname: '/o/oauth2/v2/auth',
                    query: {
                        access_type: 'offline',
                        prompt: 'consent',
                        scope: scopes,
                        response_type: 'code',
                        client_id: clientId,
                        redirect_uri: callback,
                        state: nodeId + ':' + credentials.csrf_token,
                    },
                })
            );

            GoogleCredentialsNode.RED.nodes.addCredentials(nodeId, credentials);
        });

        // Mount the OAuth2 callback route. Google redirects to this URL after the user authorizes the app.
        GoogleCredentialsNode.RED.httpAdmin.get('/google-credentials/auth/callback', async (req, res) => {
            if (req.query.error) {
                console.error(`[google-credentials] OAuth2 error: ${req.query.error_description}`);
                return res.send(`OAuth2 error: ${req.query.error_description}`);
            }

            if (!req.query.state || typeof req.query.state !== 'string') {
                console.error('[google-credentials] Missing state parameter in OAuth2 callback');
                return res.status(400).send('Missing state parameter');
            }

            const state = req.query.state.split(':');
            const nodeId = state[0];
            if (!nodeId) {
                console.error('[google-credentials] Missing node ID in state parameter');
                return res.status(400).send('Missing node ID in state parameter');
            }

            const node = GoogleCredentialsNode.RED.nodes.getNode(nodeId) as Node & { config: GoogleCredentialsNodeConfig };
            if (!node) {
                console.error(`[google-credentials] Node not found for ID: ${nodeId}`);
                return res.status(400).send('Node not found');
            }

            const credentials: GoogleCredentials = GoogleCredentialsNode.RED.nodes.getCredentials(nodeId);
            if (!credentials.client_id) {
                console.error(`[google-credentials] Missing client_id in credentials for node ID: ${nodeId}`);
                return res.status(400).send('Missing client_id in credentials');
            }

            if (!credentials.client_secret) {
                const errorMessage = `[google-credentials] Missing credentials for node ID: ${nodeId}`;
                console.error(errorMessage);
                return res.status(401).send('Missing credentials');
            }

            if (state[1] !== credentials.csrf_token) {
                const errorMessage = `[google-credentials] CSRF token mismatch for node ID: ${nodeId}`;
                console.error(errorMessage);
                return res.status(401).send('CSRF token mismatch');
            }

            const redirect_uri = node.config.redirect_uri;
            const code = req.query.code as string;
            const oauth2Client = new OAuth2Client(credentials.client_id, credentials.client_secret, redirect_uri);

            try {
                const { tokens } = await oauth2Client.getToken({
                    code: code,
                    redirect_uri: redirect_uri,
                });

                console.log('tokens', tokens);
                if (!tokens.access_token) {
                    throw new Error('No access token received from Google');
                }
                credentials.access_token = tokens.access_token;

                if (!tokens.refresh_token) {
                    console.warn(`[google-credentials] No refresh token received from Google for node ID: ${nodeId}`);
                }
                credentials.refresh_token = tokens.refresh_token ?? credentials.refresh_token!;
                credentials.expiry_date = tokens.expiry_date || new Date().getTime() + 10 * 365 * 24 * 3600 * 1000;

                // @ts-expect-error ignore typings here
                const refresh_token_expires_in = tokens.refresh_token_expires_in;
                if (refresh_token_expires_in) {
                    credentials.refresh_token_expiry_date = new Date().getTime() + refresh_token_expires_in * 1000;
                }

                delete credentials.csrf_token;
                GoogleCredentialsNode.RED.nodes.addCredentials(nodeId, credentials);

                this.persistCredentials(nodeId, credentials);
                res.send('Authorization successful. You can close this window.');
            } catch (error: any) {
                const errorMessage = `[google-credentials] Error exchanging code for tokens: ${error.message}`;
                console.error(errorMessage);
                return res.send('Could not receive tokens');
            }
        });

        // Get method to check authentication status
        GoogleCredentialsNode.RED.httpAdmin.get('/google-credentials/:id/status', (req, res) => {
            const nodeId = req.params.id;
            const node = GoogleCredentialsNode.RED.nodes.getNode(nodeId) as Node;
            if (!node || node.type !== 'google-credentials') {
                console.error(`[google-credentials] Node not found for ID: ${nodeId}`);
                return res.status(400).send('Node not found');
            }

            const credentials = GoogleCredentialsNode.RED.nodes.getCredentials(nodeId) as GoogleCredentials;
            res.json({
                has_access_token: !!credentials?.access_token,
                has_refresh_token: !!credentials?.refresh_token,
                expiry_date: credentials?.expiry_date || null,
                refresh_token_expiry_date: credentials?.refresh_token_expiry_date || null,
            });
        });
    }
}

const _export = function (RED: NodeAPI) {
    GoogleCredentialsNode.RED = RED;

    // @ts-expect-error ignore typings here
    RED.nodes.registerType('google-credentials', GoogleCredentialsNode, {
        credentials: {
            client_id: { type: 'text' },
            client_secret: { type: 'password' },
        },
    });
};

export = _export;
