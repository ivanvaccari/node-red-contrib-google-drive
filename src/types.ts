import { Credentials } from 'google-auth-library';
import { NodeDef } from 'node-red';

export type GoogleCredentials = Credentials & {
    client_id?: string;
    client_secret?: string;
    csrf_token?: string;
    refresh_token_expiry_date?: number;
};

export type GoogleCredentialsNodeConfig = NodeDef & {
    redirect_uri: string;
    scopes: string;
};
