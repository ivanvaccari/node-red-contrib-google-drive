import { Credentials } from 'google-auth-library';
import { NodeDef } from 'node-red';

export type GoogleCredentials = Credentials & {
    client_id?: string | undefined;
    client_secret?: string | undefined;
    csrf_token?: string | undefined;
    refresh_token_expiry_date?: number | undefined;
};

export type GoogleCredentialsNodeConfig = NodeDef & {
    redirect_uri: string;
    scopes: string;
};
